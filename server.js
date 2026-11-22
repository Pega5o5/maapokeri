'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {newDeck, evaluateHand, compareScores} = require('./engine');
const PORT = Number(process.env.PORT || 3000);
const TURN_MS = Number(process.env.TURN_MS || 30000);
const rooms = new Map();
const codeChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const suitMarks = {S:'♠',H:'♥',D:'♦',C:'♣'};
const label = c => c.joker ? 'Jokeri' : `${{11:'J',12:'Q',13:'K',14:'A'}[c.rank]||c.rank}${suitMarks[c.suit]}`;
const pub = c => c ? {rank:c.rank,suit:c.suit,joker:c.joker} : null;
const openCount = p => p.cards.filter(c=>c.faceUp).length;
const token = () => crypto.randomBytes(24).toString('base64url');
function fail(message,status=400){throw Object.assign(new Error(message),{status});}
function nameOf(value){
  const name=typeof value==='string'?value.trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,24):'';
  if(!name)fail('Kirjoita pelaajan nimi.');
  return name;
}
function newCode(){
  for(let i=0;i<30;i++){
    const code=Array.from({length:6},()=>codeChars[crypto.randomInt(codeChars.length)]).join('');
    if(!rooms.has(code))return code;
  }
  fail('Huonekoodin luominen epäonnistui.',503);
}
function roomOf(code){const g=rooms.get(String(code||'').toUpperCase());if(!g)fail('Huonetta ei löytynyt.',404);return g;}
function auth(room,t){const g=roomOf(room),p=g.players.find(p=>p.token===t);if(!p)fail('Pääsy huoneeseen ei ole voimassa.',403);return {g,p};}
function log(g,line){g.history.unshift(line);g.history.length=Math.min(g.history.length,10);}
function sessionState(g,viewer){
  const dealt=g.phase!=='lobby';
  return {
    code:g.code,phase:g.phase,maxPlayers:g.maxPlayers,hostId:g.hostId,dealerId:g.dealerId,
    activeId:g.phase==='playing'?g.players[g.active].id:null,stage:g.stage,
    deadline:g.phase==='playing'?g.deadline:null,turnSeconds:TURN_MS/1000,serverNow:Date.now(),
    turns:g.turns,handId:g.handId,revision:g.revision,me:{id:viewer.id,name:viewer.name},
    players:g.players.map(p=>({id:p.id,name:p.name,cards:dealt?p.cards.map(c=>c.faceUp?pub(c):null):[],
      open:dealt?openCount(p):0,online:[...g.subscribers].some(s=>s.playerId===p.id)})),
    stockCount:dealt?g.stock.length:null,discardCount:dealt?g.discard.length:null,
    discardTop:dealt?pub(g.discard.at(-1)):null,
    pending:g.phase==='playing'&&g.pending?pub(g.pending.card):null,
    pendingPresent:g.phase==='playing'&&!!g.pending,
    pendingSource:g.pending?.source||null,intent:g.intent,
    history:dealt?g.history:[],ranking:g.phase==='done'?g.ranking:null,
    chat:g.chat
  };
}
function broadcast(g){
  g.revision++;
  for(const client of [...g.subscribers]){
    const p=g.players.find(p=>p.id===client.playerId);
    if(!p||client.res.destroyed){g.subscribers.delete(client);continue;}
    try{client.res.write('event: state\ndata: '+JSON.stringify(sessionState(g,p))+'\n\n');}
    catch{g.subscribers.delete(client);}
  }
}
function player(name){return {id:crypto.randomUUID(),name:nameOf(name),token:token(),cards:[],lastChat:0};}
function create(body){
  if(rooms.size>=500)fail('Palvelin on täynnä.',503);
  const maxPlayers=Number(body.maxPlayers);
  if(!Number.isInteger(maxPlayers)||maxPlayers<2||maxPlayers>6)fail('Pelaajamäärä on 2–6.');
  const p=player(body.name);
  const g={code:newCode(),phase:'lobby',stage:null,maxPlayers,hostId:p.id,dealerId:p.id,players:[p],
    stock:[],discard:[],active:0,deadline:null,timer:null,pending:null,intent:null,turns:0,handId:0,
    ranking:null,history:[],chat:[],chatSeq:0,revision:0,subscribers:new Set(),updated:Date.now()};
  rooms.set(g.code,g);return {code:g.code,token:p.token,playerId:p.id};
}
function join(body){
  const g=roomOf(body.code);
  if(g.phase!=='lobby')fail('Peli on jo alkanut.',409);
  if(g.players.length>=g.maxPlayers)fail('Huone on täynnä.',409);
  const p=player(body.name);g.players.push(p);g.updated=Date.now();broadcast(g);
  return {code:g.code,token:p.token,playerId:p.id};
}
function draw(g){
  if(!g.stock.length&&g.discard.length>1){
    const top=g.discard.pop();g.stock=g.discard;g.discard=[top];
    for(let i=g.stock.length-1;i>0;i--){const j=crypto.randomInt(i+1);[g.stock[i],g.stock[j]]=[g.stock[j],g.stock[i]];}
    log(g,'Avopakan alemmat kortit sekoitettiin nostopakaksi.');
  }
  return g.stock.pop()||null;
}
function begin(g,index){
  clearTimeout(g.timer);g.active=index;g.stage='select';g.deadline=Date.now()+TURN_MS;
  g.timer=setTimeout(()=>{if(g.phase==='playing'){autoFlip(g);broadcast(g);}},TURN_MS);
  g.timer.unref();
}
function finish(g){
  clearTimeout(g.timer);g.timer=null;g.phase='done';g.stage='done';g.deadline=null;g.pending=null;g.intent=null;
  const ordered=g.players.map(p=>({p,score:evaluateHand(p.cards)})).sort((a,b)=>compareScores(b.score,a.score));
  g.ranking=ordered.map(({p,score})=>({id:p.id,name:p.name,hand:score.label,cards:p.cards.map(pub),
    place:1+ordered.filter(a=>compareScores(a.score,score)>0).length,winner:compareScores(score,ordered[0].score)===0}));
  log(g,'Kaikki kortit ovat auki. Peli päättyi.');
}
function complete(g){
  g.pending=null;g.intent=null;g.turns++;
  if(g.players.every(p=>openCount(p)===5)){finish(g);return;}
  for(let i=1;i<=g.players.length;i++){
    const index=(g.active+i)%g.players.length;
    if(openCount(g.players[index])<5){begin(g,index);return;}
  }
}
function autoFlip(g){
  const p=g.players[g.active],slot=p.cards.findIndex(c=>!c.faceUp);
  // Jos nostettu kortti oli nostopakasta, hylätään juuri se — ei nosteta toista.
  if(g.pending?.source==='stock')g.discard.push(g.pending.card);
  else{
    if(g.pending?.source==='discard')g.discard.push(g.pending.card);
    const c=draw(g);if(c)g.discard.push(c);
  }
  if(slot>=0){p.cards[slot].faceUp=true;log(g,`${p.name}: aika loppui. ${label(p.cards[slot])} kääntyi automaattisesti.`);}
  complete(g);g.updated=Date.now();
}
function start(g,p){
  if(p.id!==g.hostId)fail('Vain järjestäjä voi aloittaa.',403);
  if(g.phase!=='lobby'||g.players.length<2)fail('Tarvitaan vähintään kaksi pelaajaa odotushuoneeseen.',409);
  const deck=newDeck();
  for(const pl of g.players)pl.cards=Array.from({length:5},()=>({...deck.pop(),faceUp:false}));
  g.discard=[deck.pop()];g.stock=deck;g.phase='playing';g.handId++;g.turns=0;g.history=[];g.ranking=null;g.pending=null;g.intent=null;
  log(g,'Uusi jako. Jakaja aloittaa.');begin(g,g.players.findIndex(pl=>pl.id===g.dealerId));
}
function action(g,p,b){
  const type=b.type;
  if(type==='chat'){
    const message=typeof b.message==='string'?b.message.trim().replace(/[\x00-\x1f\x7f]/g,' ').slice(0,300):'';
    if(!message)fail('Kirjoita viesti.');
    if(Date.now()-p.lastChat<500)fail('Odota hetki ennen uutta viestiä.',429);
    p.lastChat=Date.now();g.chat.push({id:++g.chatSeq,playerId:p.id,name:p.name,message,time:Date.now()});
    if(g.chat.length>100)g.chat.shift();
  }else if(type==='start')start(g,p);
  else if(type==='dealer'){
    if(g.phase!=='lobby'||p.id!==g.hostId)fail('Jakajaa ei voi vaihtaa.',403);
    if(!g.players.some(x=>x.id===b.playerId))fail('Pelaajaa ei löydy.');
    g.dealerId=b.playerId;
  }else if(type==='again'){
    if(g.phase!=='done'||p.id!==g.hostId)fail('Uusi jako ei ole mahdollinen.',409);
    g.phase='lobby';g.stage=null;g.stock=[];g.discard=[];g.history=[];g.ranking=null;
    g.players.forEach(p=>p.cards=[]);
  }else{
    if(g.phase!=='playing')fail('Peli ei ole käynnissä.',409);
    if(p.id!==g.players[g.active].id)fail('Ei ole sinun vuorosi.',403);
    if(b.handId!==undefined&&b.handId!==g.handId||b.turn!==undefined&&b.turn!==g.turns)fail('Vuoro on jo vaihtunut.',409);
    if(Date.now()>=g.deadline){autoFlip(g);broadcast(g);fail('Aika loppui.',409);}
    if(type==='take'||type==='draw'||type==='flip'){
      if(g.stage!=='select')fail('Olet jo nostanut kortin.',409);
      const c=type==='take'?g.discard.pop():draw(g);
      if(!c)fail('Pakassa ei ole kortteja.',409);
      g.pending={card:c,source:type==='take'?'discard':'stock'};
      g.intent=type==='take'?'swap':type==='flip'?'flip':null;
      g.stage=type==='draw'?'decide':'choose';
    }else if(type==='intent'){
      if(g.stage!=='decide'||!['swap','flip'].includes(b.intent))fail('Valinta ei ole mahdollinen.',409);
      g.intent=b.intent;g.stage='choose';
    }else if(type==='slot'){
      if(g.stage!=='choose'||!g.pending||!Number.isInteger(b.slot)||b.slot<0||b.slot>4)fail('Valitse pimeä kortti.',409);
      const old=p.cards[b.slot];if(old.faceUp)fail('Kortti on jo auki.',409);
      if(g.intent==='swap'){
        p.cards[b.slot]={...g.pending.card,faceUp:true};g.discard.push(old);
        log(g,`${p.name} vaihtoi kortin: ${label(p.cards[b.slot])}.`);
      }else if(g.intent==='flip'){
        old.faceUp=true;g.discard.push(g.pending.card);log(g,`${p.name} käänsi kortin: ${label(old)}.`);
      }else fail('Valitse ensin kortin käyttö.');
      complete(g);
    }else fail('Tuntematon toiminto.');
  }
  g.updated=Date.now();broadcast(g);
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
function bodyOf(req){return new Promise((resolve,reject)=>{
  let raw='';req.on('data',s=>{raw+=s;if(raw.length>16000){reject(Object.assign(new Error('Liian suuri pyyntö.'),{status:413}));req.destroy();}});
  req.on('end',()=>{try{const b=JSON.parse(raw);if(!b||typeof b!=='object')throw Error();resolve(b);}catch{reject(Object.assign(new Error('Virheellinen pyyntö.'),{status:400}));}});
  req.on('error',reject);
});}
function stream(req,res,g,p){
  res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','Connection':'keep-alive','X-Accel-Buffering':'no'});
  res.write('retry: 1200\n\n');const client={playerId:p.id,res};g.subscribers.add(client);broadcast(g);
  const interval=setInterval(()=>{if(!res.destroyed)res.write(': ping\n\n');},15000);interval.unref();
  res.on('close',()=>{clearInterval(interval);g.subscribers.delete(client);broadcast(g);});
}
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css'};
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
function serve(res,pathname){
  const f=files[pathname];if(!f)return json(res,404,{error:'Tiedostoa ei löydy.'});
  fs.readFile(path.join(__dirname,'public',f),(err,buf)=>{
    if(err){console.error('Puuttuva tiedosto:',f,err.message);return json(res,500,{error:'Palvelinvirhe: käyttöliittymän tiedosto puuttuu.'});}
    res.writeHead(200,{'Content-Type':mime[path.extname(f)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
      'Content-Security-Policy':"default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'"});
    res.end(buf);
  });
}
const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://localhost'),p=u.pathname;
    if(req.method==='GET'&&p==='/health')return json(res,200,{ok:true});
    if(req.method==='GET'&&(p==='/api/state'||p==='/api/events')){
      const {g,p:viewer}=auth(u.searchParams.get('room'),u.searchParams.get('token'));
      return p==='/api/events'?stream(req,res,g,viewer):json(res,200,sessionState(g,viewer));
    }
    if(req.method==='POST'&&p.startsWith('/api/')){
      if(!String(req.headers['content-type']||'').startsWith('application/json'))fail('Lähetä JSON-pyyntö.',415);
      const b=await bodyOf(req);
      if(p==='/api/create')return json(res,200,create(b));
      if(p==='/api/join')return json(res,200,join(b));
      if(p==='/api/action'){const {g,p:viewer}=auth(b.room,b.token);action(g,viewer,b);return json(res,200,{ok:true});}
      return json(res,404,{error:'Tuntematon osoite.'});
    }
    if(req.method==='GET')return serve(res,p);
    json(res,405,{error:'Toiminto ei ole sallittu.'});
  }catch(e){if(!res.headersSent){if(!e.status)console.error(e);json(res,e.status||500,{error:e.status?e.message:'Palvelimen sisäinen virhe.'});}}
});
const cleanup=setInterval(()=>{for(const [code,g] of rooms)if(!g.subscribers.size&&Date.now()-g.updated>86400000){clearTimeout(g.timer);rooms.delete(code);}},3600000);
cleanup.unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log('Maapokeri 2.0: portti '+PORT));
module.exports={server,rooms,sessionState,autoFlip};
