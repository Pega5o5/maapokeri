'use strict';
process.env.TURN_MS='170';
const test=require('node:test');
const assert=require('node:assert/strict');
const {server,rooms}=require('../server');
let base;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function post(ep,body){const response=await fetch(base+'/api/'+ep,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;}
async function get(s){return fetch(base+'/api/state?room='+s.code+'&token='+s.token).then(r=>r.json());}
test.before(async()=>{await new Promise(ok=>server.listen(0,'127.0.0.1',ok));base='http://127.0.0.1:'+server.address().port;});
test.after(async()=>{for(const g of rooms.values())clearTimeout(g.timer);await new Promise(ok=>server.close(ok));});
test('vuoron päättyessä 1 pimeä kääntyy itsestään, seuraavan aika alkaa',async()=>{
  const a=await post('create',{name:'Alice',maxPlayers:2});const b=await post('join',{code:a.code,name:'Bob'});
  await post('action',{room:a.code,token:a.token,type:'start'});
  const original=await get(a);assert.equal(original.players[0].open,0);
  await delay(225);
  const current=await get(a);
  assert.equal(current.players[0].open,1);
  assert.ok(current.players[0].cards[0]);
  assert.equal(current.players[0].cards[1],null);
  assert.equal(current.activeId,b.playerId);
  assert.match(current.history[0],/automaattisesti/);
  assert.equal(current.discardCount,2);
});
test('aikakatkaisu säilyttää avopakan ja nostetun kortin, kun valinta jäi kesken',async()=>{
 const a=await post('create',{name:'A',maxPlayers:2});const b=await post('join',{code:a.code,name:'B'});
 await post('action',{room:a.code,token:a.token,type:'start'});
 let before=await get(a);
 await post('action',{room:a.code,token:a.token,type:'take'});
 let during=await get(a);assert.equal(during.discardTop,null);
 await delay(250);
 let after=await get(a);
 assert.equal(after.players[0].open,1);
 assert.ok(after.discardTop);assert.equal(after.discardCount,before.discardCount+1);
 assert.equal(after.activeId,b.playerId);
});
