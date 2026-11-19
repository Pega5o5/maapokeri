'use strict';
// Maapokeri: palvelimen hallitsema peli. Ei ulkoisia npm-riippuvuuksia.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {newDeck, evaluateHand, compareScores} = require('./engine');

const PORT = Number(process.env.PORT || 3000);
const TURN_MS = Number(process.env.TURN_MS || 30000);
const MAX_ROOMS = 500;
const ROOM_TTL = 24 * 60 * 60 * 1000;
const rooms = new Map();
const publicDir = path.join(__dirname, 'public');
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const suitMarks = {S:'♠',H:'♥',D:'♦',C:'♣'};
const shortName = card => card.joker ? 'Jokeri' : `${{11:'J',12:'Q',13:'K',14:'A'}[card.rank]||card.rank}${suitMarks[card.suit]}`;

function fail(message, status=400) {const err = new Error(message); err.status=status; throw err;}
function newCode() {
  for (let j=0;j<30;j++) {
    const code=Array.from({length:6},()=>codeChars[crypto.randomInt(codeChars.length)]).join('');
    if(!rooms.has(code))return code;
  }
  fail('Huonekoodia ei voitu luoda.',500);
}
function cleanName(input) {
  if (typeof input!=='string') fail('Kirjoita pelaajan nimi.');
  const name=input.trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,24);
  if(!name)fail('Kirjoita pelaajan nimi.');
  return name;
}
function token() {return crypto.randomBytes(24).toString('base64url');}
function visibleCount(p) {return p.cards.filter(c=>c.faceUp).length;}
function allDone(g) {return g.players.every(p=>visibleCount(p)===5);}
function appendLog(g,msg) {g.history.unshift(msg);g.history.length=Math.min(10,g.history.length);}
function playerByToken(g, auth) {const p=g.players.find(p=>p.token===auth);if(!p)fail('Pääsy huoneeseen ei ole voimassa.',403);return p;}
function getRoom(code) {const g=rooms.get(String(code||'').toUpperCase());if(!g)fail('Huonetta ei löytynyt.',404);return g;}
function onlineCount(g,pid) {return [...g.subscribers].filter(s=>s.playerId===pid).length;}
function sessionState(g,viewer) {
  const playing=g.phase!=='lobby';
  return {
    code:g.code,phase:g.phase,maxPlayers:g.maxPlayers,hostId:g.hostId,
    dealerId:g.dealerId,activeId:playing ? g.players[g.active]?.id : null,
    stage:playing ? g.stage : null,
    deadline:g.phase==='playing'?g.deadline:null,
    turnSeconds:TURN_MS/1000,serverNow:Date.now(),turns:g.turns,
    me:{id:viewer.id,name:viewer.name},
    players:g.players.map(p=>({id:p.id,name:p.name,
      cards:playing?p.cards.map(c=>c.faceUp?publicCard(c):null):[],
      open:playing?visibleCount(p):0,
      online:onlineCount(g,p.id)>0,
    })),
    stockCount:playing?g.stock.length:null,
    discardTop:playing&&g.discard.length?publicCard(g.discard.at(-1)):null,
    discardCount:playing?g.discard.length:null,
    pending:(g.phase==='playing'&&g.players[g.active].id===viewer.id&&g.pending)
      ?publicCard(g.pending.card):null,
    pendingPresent:g.phase==='playing'&&Boolean(g.pending),
    history:playing?g.history:[],
    ranking:g.phase==='done'?g.ranking:null,
  };
}
function publicCard(c) {return c?{rank:c.rank,suit:c.suit,joker:c.joker}:null;}
function broadcast(g) {
  for(const client of [...g.subscribers]) {
    try {
      const p=g.players.find(p=>p.id===client.playerId);
      if(!p)continue;
      client.res.write(`event: state\ndata: ${JSON.stringify(sessionState(g,p))}\n\n`);
    }catch {g.subscribers.delete(client);}
  }
}
function makeRoom({name,maxPlayers}) {
  if(rooms.size>=MAX_ROOMS)fail('Palvelin on täynnä. Kokeile myöhemmin.',503);
  const cap=Number(maxPlayers);
  if(!Number.isInteger(cap)||cap<2||cap>6)fail('Huoneen pelaajamäärän tulee olla 2–6.');
  const host={id:crypto.randomUUID(),name:cleanName(name),token:token(),cards:[]};
  const g={code:newCode(),phase:'lobby',maxPlayers:cap,players:[host],hostId:host.id,dealerId:host.id,
    subscribers:new Set(),stock:[],discard:[],active:0,stage:null,pending:null,intent:null,
    deadline:null,timer:null,history:[],turns:0,ranking:null,updated:Date.now()};
  rooms.set(g.code,g);
  return {code:g.code,token:host.token,playerId:host.id};
}
function joinRoom({code,name}) {
  const g=getRoom(code);
  if(g.phase!=='lobby')fail('Peli on jo alkanut. Et voi liittyä uutena pelaajana.',409);
  if(g.players.length>=g.maxPlayers)fail('Huone on täynnä.',409);
  const p={id:crypto.randomUUID(),name:cleanName(name),token:token(),cards:[]};
  g.players.push(p);g.updated=Date.now();broadcast(g);
  return {code:g.code,token:p.token,playerId:p.id};
}
function putBackAndDraw(g) {
  if(g.pending) {
    g.discard.push(g.pending.card);
    g.pending=null;
  }
  const fresh=drawStock(g);
  if(fresh)g.discard.push(fresh);
}
function refill(g) {
  if(g.stock.length || g.discard.length<=1) return;
  const top=g.discard.pop();
  g.stock=g.discard;
  for(let i=g.stock.length-1;i>0;i--) {
    const j=crypto.randomInt(i+1);
    [g.stock[i],g.stock[j]]=[g.stock[j],g.stock[i]];
  }
  g.discard=[top];
  appendLog(g,'Avopakan alemmat kortit sekoitettiin nostopakaksi.');
}
function drawStock(g) {refill(g);return g.stock.pop()||null;}
function finish(g) {
  g.phase='done';g.stage='done';g.deadline=null;g.pending=null;g.intent=null;
  clearTimeout(g.timer);g.timer=null;
  const order=g.players.map(p=>({id:p.id,name:p.name,score:evaluateHand(p.cards),cards:p.cards.map(publicCard)}))
    .sort((a,b)=>compareScores(b.score,a.score));
  g.ranking=order.map((x,i)=>({id:x.id,name:x.name,hand:x.score.label,tie:x.score.tie,
    winner:compareScores(x.score,order[0].score)===0,cards:x.cards,place:1+order.filter(y=>compareScores(y.score,x.score)>0).length}));
  appendLog(g, 'Peli päättyi – kaikki kortit ovat auki.');
}
function nextOpenPlayer(g) {
  for(let shift=1;shift<=g.players.length;shift++) {
    const idx=(g.active+shift)%g.players.length;
    if(visibleCount(g.players[idx])<5)return idx;
  }
  return -1;
}
function completeTurn(g) {
  g.turns++;
  g.pending=null;g.intent=null;
  if(allDone(g)) {finish(g);return;}
  const next=nextOpenPlayer(g);
  if(next<0) {finish(g);return;}
  beginTurn(g,next);
}
function beginTurn(g,idx) {
  clearTimeout(g.timer);
  g.active=idx;g.stage='select';g.deadline=Date.now()+TURN_MS;
  g.timer=setTimeout(()=>{
    if(g.phase==='playing'&&Date.now()>=g.deadline){autoFlip(g);broadcast(g);}
  },TURN_MS+10);
  // An active room should not prevent process termination during tests.
  g.timer.unref();
}
function autoFlip(g) {
  const p=g.players[g.active];
  const slot=p.cards.findIndex(c=>!c.faceUp);
  if(slot<0){completeTurn(g);return;}
  putBackAndDraw(g);
  p.cards[slot].faceUp=true;
  appendLog(g,`${p.name}: 30 sekuntia kului. Kortti ${slot+1} (${shortName(p.cards[slot])}) kääntyi automaattisesti.`);
  completeTurn(g);g.updated=Date.now();
}
function start(g,actor) {
  if(actor.id!==g.hostId)fail('Vain huoneen luoja voi aloittaa pelin.',403);
  if(g.phase!=='lobby')fail('Peli on jo käynnissä.',409);
  if(g.players.length<2)fail('Peliin tarvitaan vähintään kaksi pelaajaa.',409);
  const cards=newDeck();
  g.players.forEach(p=>{p.cards=Array.from({length:5},()=>({...cards.pop(),faceUp:false}));});
  g.discard=[cards.pop()];g.stock=cards;g.turns=0;g.phase='playing';g.history=[];g.ranking=null;
  appendLog(g,`Aloituskortti: ${shortName(g.discard[0])}. Jakaja aloittaa.`);
  beginTurn(g,g.players.findIndex(p=>p.id===g.dealerId));
}
function action(g,actor,type,payload) {
  if(type==='dealer') {
    if(g.phase!=='lobby')fail('Jakajaa voi vaihtaa vain odotushuoneessa.',409);
    if(actor.id!==g.hostId)fail('Vain huoneen luoja voi valita jakajan.',403);
    if(!g.players.some(p=>p.id===payload.playerId))fail('Pelaajaa ei löydy.');
    g.dealerId=payload.playerId;
  } else if(type==='start') {
    start(g,actor);
  } else if(type==='again') {
    if(actor.id!==g.hostId)fail('Vain huoneen luoja voi aloittaa uuden jaon.',403);
    if(g.phase!=='done')fail('Uuden jaon voi aloittaa vasta pelin päätyttyä.',409);
    g.phase='lobby';g.stage=null;g.stock=[];g.discard=[];g.deadline=null;g.history=[];
    g.ranking=null;g.players.forEach(p=>p.cards=[]);
  } else {
    if(g.phase!=='playing')fail('Peli ei ole käynnissä.',409);
    if(g.players[g.active].id!==actor.id)fail('Ei ole sinun vuorosi.',403);
    if(Date.now()>=g.deadline) {
      autoFlip(g);broadcast(g);fail('Vuoro ehti päättyä. Pimeä kortti kääntyi automaattisesti.',409);
    }
    if(type==='take') {
      if(g.stage!=='select')fail('Valinta ei ole nyt mahdollinen.',409);
      const picked=g.discard.pop();if(!picked)fail('Avopakka on tyhjä.',409);
      g.pending={card:picked,source:'discard'};g.stage='choose';g.intent='swap';
    } else if(type==='draw'||type==='flip') {
      if(g.stage!=='select')fail('Valinta ei ole nyt mahdollinen.',409);
      const picked=drawStock(g);if(!picked)fail('Nostopakassa ei ole kortteja.',409);
      g.pending={card:picked,source:'stock'};g.stage=type==='draw'?'decide':'choose';g.intent=type==='flip'?'flip':null;
    } else if(type==='intent') {
      if(g.stage!=='decide')fail('Valinta ei ole nyt mahdollinen.',409);
      if(!['swap','flip'].includes(payload.intent))fail('Tuntematon toiminto.');
      g.stage='choose';g.intent=payload.intent;
    } else if(type==='slot') {
      if(g.stage!=='choose'||!g.pending)fail('Valinta ei ole nyt mahdollinen.',409);
      const idx=payload.slot;
      if(!Number.isInteger(idx)||idx<0||idx>4)fail('Valitse jokin viidestä kortista.');
      const old=actor.cards[idx];
      if(old.faceUp)fail('Voit valita vain pimeän kortin.',409);
      if(g.intent==='swap') {
        actor.cards[idx]={...g.pending.card,faceUp:true};
        g.discard.push(old);
        appendLog(g,`${actor.name} vaihtoi kortin ${shortName(actor.cards[idx])} paikalle ${idx+1}; ${shortName(old)} meni avopakkaan.`);
      } else if(g.intent==='flip') {
        old.faceUp=true;g.discard.push(g.pending.card);
        appendLog(g,`${actor.name} käänsi kortin ${idx+1} (${shortName(old)}); nostettu kortti meni avopakkaan.`);
      } else fail('Kortin käyttöä ei valittu.',409);
      completeTurn(g);
    } else fail('Tuntematon toiminto.');
  }
  g.updated=Date.now();broadcast(g);
}
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let raw='';
    req.on('data',part=>{raw+=part;if(raw.length>16000){reject(Object.assign(new Error('Liian suuri pyyntö.'),{status:413}));req.destroy();}});
    req.on('end',()=>{try{resolve(JSON.parse(raw));}catch{reject(Object.assign(new Error('Virheellinen pyyntö.'),{status:400}));}});
    req.on('error',reject);
  });
}
function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(JSON.stringify(data));
}
function authenticated(payload) {
  const g=getRoom(payload.room);
  const p=playerByToken(g,payload.token);
  return {g,p};
}
function stream(req,res,url) {
  const {g,p}=authenticated({room:url.searchParams.get('room'),token:url.searchParams.get('token')});
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',
    'Connection':'keep-alive','X-Accel-Buffering':'no','X-Content-Type-Options':'nosniff'});
  res.write('retry: 1500\n\n');
  const client={playerId:p.id,res};
  g.subscribers.add(client);
  res.write(`event: state\ndata: ${JSON.stringify(sessionState(g,p))}\n\n`);
  broadcast(g); // päivitä läsnäolo myös muille pelaajille
  const heartbeat=setInterval(()=>{try {res.write(': ping\n\n');}catch {clearInterval(heartbeat);}},15000);
  heartbeat.unref();
  req.on('close',()=>{clearInterval(heartbeat);g.subscribers.delete(client);broadcast(g);});
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
function serve(res,url) {
  const pathname=url.pathname==='/'?'/index.html':url.pathname;
  if(!['/index.html','/app.js','/style.css'].includes(pathname)) {json(res,404,{error:'Tiedostoa ei löydy.'});return;}
  const file=path.join(publicDir,pathname.slice(1));
  fs.readFile(file,(err,buf)=>{
    if(err){json(res,500,{error:'Palvelinvirhe.'});return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"});
    res.end(buf);
  });
}
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET'&&url.pathname==='/api/events')return stream(req,res,url);
    if(req.method==='GET'&&url.pathname==='/api/state') {
      const {g,p}=authenticated({room:url.searchParams.get('room'),token:url.searchParams.get('token')});
      return json(res,200,sessionState(g,p));
    }
    if(req.method==='POST'&&url.pathname.startsWith('/api/')) {
      if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('Lähetä JSON-pyyntö.',415);
      const body=await readBody(req);
      if(url.pathname==='/api/create')return json(res,200,makeRoom(body));
      if(url.pathname==='/api/join')return json(res,200,joinRoom(body));
      if(url.pathname==='/api/action'){
        const {g,p}=authenticated(body);action(g,p,body.type,body);
        return json(res,200,{ok:true});
      }
      return json(res,404,{error:'Tuntematon osoite.'});
    }
    if(req.method==='GET')return serve(res,url);
    json(res,405,{error:'Toiminto ei ole sallittu.'});
  }catch(err){if(!res.headersSent)json(res,err.status||500,{error:err.status?err.message:'Palvelimen sisäinen virhe.'});}
});
// Unohda käyttämättömät pelihuoneet. Palvelimen uudelleenkäynnistys tyhjentää huoneet.
const cleanup=setInterval(()=>{
  const now=Date.now();
  for(const [code,g] of rooms)if(now-g.updated>ROOM_TTL&&g.subscribers.size===0){clearTimeout(g.timer);rooms.delete(code);}
},60*60*1000);
cleanup.unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log(`Maapokeri: http://localhost:${PORT}`));
module.exports={server,rooms,action,autoFlip,makeRoom,joinRoom,sessionState};
