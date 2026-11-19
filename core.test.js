'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {server,rooms}=require('../server');
const {evaluateHand,compareScores}=require('../engine');
let url;
const card=(rank,suit)=>({rank,suit,joker:false});
const joker=()=>({rank:0,suit:null,joker:true});
async function post(ep,body,expected=200){
  const r=await fetch(url+'/api/'+ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await r.json();assert.equal(r.status,expected,`POST ${ep}: ${JSON.stringify(data)}`);return data;
}
async function snapshot(u){const r=await fetch(url+'/api/state?room='+u.code+'&token='+u.token);assert.equal(r.status,200);return r.json();}
const auth=(s,type,more={})=>({room:s.code,token:s.token,type,...more});
test.before(async()=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;});
test.after(async()=>{for(const g of rooms.values())clearTimeout(g.timer);await new Promise(resolve=>server.close(resolve));});

test('käsien järjestys, 4 kortin suora ja väri, jokerit',()=>{
  const pair=evaluateHand([card(2,'S'),card(2,'H'),card(7,'H'),card(8,'D'),card(11,'C')]);
  const s4=evaluateHand([card(2,'S'),card(3,'H'),card(4,'H'),card(5,'D'),card(11,'C')]);
  const f4=evaluateHand([card(2,'S'),card(5,'S'),card(7,'S'),card(9,'S'),card(11,'C')]);
  const pairs=evaluateHand([card(2,'S'),card(2,'H'),card(8,'C'),card(8,'D'),card(11,'C')]);
  assert.equal(pair.label,'Pari');assert.equal(s4.label,'Neljän suora');assert.equal(f4.label,'Neljän väri');assert.equal(pairs.label,'Kaksi paria');
  assert.ok(compareScores(s4,pair)>0);assert.ok(compareScores(f4,s4)>0);assert.ok(compareScores(pairs,f4)>0);
  assert.equal(evaluateHand([card(8,'S'),card(8,'H'),card(8,'D'),joker(),joker()]).label,'Vitoset');
});

test('huoneet, salaiset kortit, vuorot ja takaisin liittyminen',async()=>{
  const host=await post('create',{name:'Host',maxPlayers:3});
  const p2=await post('join',{name:'Liisa',code:host.code});
  const p3=await post('join',{name:'Matti',code:host.code});
  await post('join',{name:'Ylimääräinen',code:host.code},409);
  await post('action',auth(p2,'start'),403);
  await post('action',auth(host,'dealer',{playerId:p2.playerId}));
  await post('action',auth(host,'start'));
  let a=await snapshot(host),b=await snapshot(p2);
  assert.equal(a.players.length,3);assert.equal(a.activeId,p2.playerId);
  assert.equal(a.players[0].cards.length,5);
  for(const p of a.players)for(const c of p.cards)assert.equal(c,null,'pimeät eivät vuoda API:sta');
  assert.equal(a.stockCount,54-3*5-1);
  assert.ok(a.discardTop);assert.equal(a.pending,null);
  // Active player draws card; only active may see its value.
  await post('action',auth(host,'draw'),403);
  await post('action',auth(p2,'draw'));
  a=await snapshot(host);b=await snapshot(p2);
  assert.equal(a.stage,'decide');assert.ok(b.pending);assert.equal(a.pending,null);assert.equal(a.pendingPresent,true);
  await post('action',auth(p2,'intent',{intent:'flip'}));
  await post('action',auth(p2,'slot',{slot:4}));
  a=await snapshot(host);
  assert.equal(a.players[1].open,1);assert.ok(a.players[1].cards[4]);
  assert.equal(a.activeId,p3.playerId);assert.equal(a.stage,'select');
  await post('action',auth(p3,'take'));
  await post('action',auth(p3,'slot',{slot:1}));
  a=await snapshot(host);
  assert.equal(a.players[2].open,1);assert.equal(a.activeId,host.playerId);
  assert.equal(a.players[0].open,0);
  await post('action',auth(host,'flip'));
  await post('action',auth(host,'slot',{slot:2}));
  a=await snapshot(host);assert.equal(a.activeId,p2.playerId);assert.equal(a.players[0].open,1);
  await post('action',auth(host,'again'),409);
  const mismatch=await fetch(url+'/api/state?room='+host.code+'&token=invalid');assert.equal(mismatch.status,403);
  // Complete the rest of the game via the API: automatic ranking at the end.
  for(let step=0;step<12;step++) {
    const current=await snapshot(host);assert.equal(current.phase,'playing');
    const who=[host,p2,p3].find(s=>s.playerId===current.activeId);
    const pl=current.players.find(p=>p.id===current.activeId);
    const slot=pl.cards.findIndex(c=>!c);
    await post('action',auth(who,'flip'));
    await post('action',auth(who,'slot',{slot}));
  }
  a=await snapshot(host);
  assert.equal(a.phase,'done');assert.equal(a.ranking.length,3);assert.equal(a.players.every(p=>p.open===5),true);
  assert.equal(a.ranking.some(p=>p.winner),true);
  await post('action',auth(host,'again'));
  a=await snapshot(host);assert.equal(a.phase,'lobby');assert.equal(a.players.length,3);
});

test('huonekoodit ovat erilaisia eikä huoneisiin voi liittyä pelin alettua',async()=>{
 const a=await post('create',{name:'A',maxPlayers:2});
 const b=await post('create',{name:'B',maxPlayers:2});
 assert.notEqual(a.code,b.code);
 await post('join',{code:'NOGAME',name:'N'},404);
 await post('join',{code:a.code,name:'C'});
 await post('action',auth(a,'start'));
 await post('join',{code:a.code,name:'D'},409);
});

test('reaaliaikainen tapahtumavirta lähettää huoneen muutokset selaimelle',async()=>{
  const owner=await post('create',{name:'Eetu',maxPlayers:2});
  const uri=url+'/api/events?room='+owner.code+'&token='+owner.token;
  const resp=await fetch(uri);
  assert.equal(resp.status,200);
  assert.match(resp.headers.get('content-type'),/text\/event-stream/);
  const reader=resp.body.getReader();
  const first=await reader.read();
  const initial=new TextDecoder().decode(first.value);
  assert.match(initial,/event: state/);
  const friend=await post('join',{code:owner.code,name:'Roope'});
  let hasJoinEvent=initial.includes('Roope');
  for(let count=0;count<5&&!hasJoinEvent;count++) {
    const part=await reader.read();
    hasJoinEvent=new TextDecoder().decode(part.value).includes('Roope');
  }
  assert.ok(hasJoinEvent,'huoneeseen liittyminen julkaistaan reaaliajassa');
  await reader.cancel();
});
