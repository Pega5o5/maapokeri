(()=>{
  'use strict';
  const app=document.querySelector('#app'),toast=document.querySelector('#toast'),chatPanel=document.querySelector('#chat-panel');
  const chatMessages=document.querySelector('#chat-messages'),chatInput=document.querySelector('#chat-input');
  const suits={S:'♠',H:'♥',D:'♦',C:'♣'},ranks={11:'J',12:'Q',13:'K',14:'A'};
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cardText=c=>!c?'Pimeä':c.joker?'Jokeri':`${ranks[c.rank]||c.rank}${suits[c.suit]}`;
  const codeFromUrl=()=>new URLSearchParams(location.search).get('huone')?.toUpperCase()||'';
  let state=null,session=null,events=null,connected=false,offset=0,busy=false,chatBusy=false;
  let seenChat=0,results=false,chatOpen=false,toastTimer,boardKey='',openedAt=0,retryTimer,connectionGeneration=0;
  let flipKeys=new Set(),pendingFlip=false,audio=null,sound=true;
  try{sound=localStorage.getItem('maapokeri:sound')!=='off';}catch{}
  function notify(message){toast.textContent=message;toast.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('visible'),3200);}
  function unlockAudio(){
    if(!sound)return;
    try{audio ||= new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume().catch(()=>{});}catch{}
  }
  document.addEventListener('pointerdown',unlockAudio,{passive:true});
  document.addEventListener('keydown',unlockAudio,{passive:true});
  function tone(freq,delay,dur,vol=.035,type='sine'){
    if(!audio||audio.state!=='running'||!sound)return;
    const t=audio.currentTime+delay,o=audio.createOscillator(),g=audio.createGain();
    o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.012);g.gain.exponentialRampToValueAtTime(.0001,t+dur);
    o.connect(g).connect(audio.destination);o.start(t);o.stop(t+dur+.01);
  }
  function cardSound(){
    if(!audio||audio.state!=='running'||!sound)return;
    const frames=Math.floor(audio.sampleRate*.13),b=audio.createBuffer(1,frames,audio.sampleRate),data=b.getChannelData(0);
    for(let i=0;i<frames;i++)data[i]=(Math.random()*2-1)*Math.pow(1-i/frames,2);
    const source=audio.createBufferSource(),filter=audio.createBiquadFilter(),gain=audio.createGain();
    source.buffer=b;filter.type='bandpass';filter.frequency.value=1800;filter.Q.value=.65;gain.gain.value=.11;source.connect(filter).connect(gain).connect(audio.destination);source.start();
    tone(230,.08,.11,.028,'triangle');
  }
  function turnSound(){tone(587,0,.2);tone(784,.15,.25);}
  function finishSound(){[523,659,784,1047].forEach((f,i)=>tone(f,i*.12,.28,.04,'triangle'));}
  async function api(endpoint,body){
    const res=await fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    let data={};try{data=await res.json();}catch{}
    if(!res.ok)throw Object.assign(new Error(data.error||'Verkkovirhe.'),{status:res.status});return data;
  }
  function stored(code){try{return JSON.parse(localStorage.getItem('maapokeri:huone:'+code));}catch{return null;}}
  function save(s){try{localStorage.setItem('maapokeri:huone:'+s.code,JSON.stringify(s));}catch{}}
  function stopConnection(){connectionGeneration++;clearTimeout(retryTimer);events?.close();events=null;connected=false;}
  async function connect(s){
    stopConnection();const generation=connectionGeneration;session=s;
    history.replaceState({},'',location.pathname+'?huone='+encodeURIComponent(s.code));
    const query='room='+encodeURIComponent(s.code)+'&token='+encodeURIComponent(s.token);
    try{
      const res=await fetch('/api/state?'+query,{cache:'no-store'}),data=await res.json();
      if(generation!==connectionGeneration)return;
      if(!res.ok)throw Object.assign(new Error(data.error),{status:res.status});
      update(data);
      events=new EventSource('/api/events?'+query);
      events.addEventListener('state',ev=>{if(generation===connectionGeneration)try{update(JSON.parse(ev.data));}catch(e){console.error(e);}});
      events.onopen=()=>{connected=true;drawConnection();};
      events.onerror=()=>{connected=false;drawConnection();};
    }catch(e){
      if(generation!==connectionGeneration)return;
      if([403,404].includes(e.status)){try{localStorage.removeItem('maapokeri:huone:'+s.code);}catch{}session=null;state=null;home(s.code);notify(e.message);}
      else{notify('Yhteys katkesi — yritetään uudelleen.');retryTimer=setTimeout(()=>connect(s),2200);}
    }
  }
  function visualKey(s){return JSON.stringify([s.phase,s.handId,s.turns,s.stage,s.activeId,s.deadline,s.pending,s.intent,s.discardTop,s.stockCount,s.dealerId,s.players.map(p=>[p.id,p.name,p.cards])]);}
  function update(next){
    if(state&&next.code===state.code&&next.revision<state.revision)return;
    const old=state,oldKey=boardKey;
    const sameHand=old?.handId===next.handId&&old?.code===next.code;
    state=next;offset=next.serverNow-Date.now();
    if(!old||old.code!==next.code){seenChat=next.chat?.at(-1)?.id||0;results=false;}
    const key=visualKey(next);
    if(key!==oldKey){
      flipKeys=new Set();pendingFlip=false;
      if(sameHand&&old.phase==='playing'){
        for(const p of next.players){
          const before=old.players.find(x=>x.id===p.id);
          p.cards.forEach((c,i)=>{if(c&&!before?.cards[i])flipKeys.add(p.id+':'+i);});
        }
        pendingFlip=!!next.pending&&!old.pendingPresent&&next.pendingSource==='stock';
        if(flipKeys.size||pendingFlip)cardSound();
        if(next.phase==='done'){
          results=false;openedAt=Date.now();setTimeout(()=>{if(state?.phase==='done'){finishSound();const button=document.querySelector('[data-act="results"]');if(button)button.disabled=false;}},700);
        }else if(next.activeId===next.me.id&&old.activeId!==next.activeId)turnSound();
      }
      if(!sameHand||next.phase==='lobby')results=false;
      boardKey=key;render();
    }
    updateChat();
  }
  function card(c,cls='',animate=false){
    const face=()=>{
      if(!c)return '<span class="card-back"><i>♠</i></span>';
      if(c.joker)return '<span class="card-face joker"><span class="corner"><b>★</b><small>✦</small></span><span class="joker-emblem">✧</span><span class="joker-caption">JOKER</span><span class="corner bottom"><b>★</b><small>✦</small></span></span>';
      const r=ranks[c.rank]||c.rank,s=suits[c.suit],red=['H','D'].includes(c.suit);
      return `<span class="card-face ${red?'red':''}"><span class="corner"><b>${r}</b><small>${s}</small></span><span class="card-center ${c.rank>=11&&c.rank<=13?'court':''}">${c.rank>=11&&c.rank<=13?`<em>${r}</em>`:'<i>'+s+'</i>'}</span><span class="corner bottom"><b>${r}</b><small>${s}</small></span></span>`;
    };
    return `<span class="card ${cls}${animate&&c?' turning':''}" aria-label="${cardText(c)}">${animate&&c?'<span class="flip-back"><span class="card-back"><i>♠</i></span></span>':''}${face()}</span>`;
  }
  function header(right=''){return `<header class="header"><div class="brand"><span class="brand-icon">♠</span><span>MAAPOKERI</span><small>2.0</small></div><div class="header-tools">${right}<button data-act="sound" class="icon-btn" aria-label="${sound?'Mykistä äänet':'Ota äänet käyttöön'}" title="Peliäänet">${sound?'♪':'♪̶'}</button>${state?'<button data-act="chat" class="icon-btn chat-trigger" aria-label="Avaa chat">☏<span class="unread" hidden></span></button>':''}</div></header>`;}
  function home(code=''){
    app.innerHTML=`<div class="start-screen">${header()}<section class="welcome"><div class="suits">♠ <span>♥</span> ♣</div><div class="eyebrow">KAVEREIDEN KANSSA · OMILLA PUHELIMILLA</div><h1>Viisi pimeää.<br>30 sekuntia per vuoro.</h1><p>Luo huone ja kutsu kaverit korttipöytään.</p></section><div class="entry-grid">
      <form id="create-form" class="panel"><h2>Luo huone</h2><label for="host-name">Oma nimi</label><input id="host-name" required maxlength="24" placeholder="Pelaajan nimi"><label for="max-players">Enintään pelaajia</label><select id="max-players">${[2,3,4,5,6].map(n=>`<option ${n===6?'selected':''}>${n}</option>`).join('')}</select><button class="btn gold">Luo pelihuone</button></form>
      <form id="join-form" class="panel"><h2>Liity peliin</h2><label for="room-code">Huonekoodi</label><input id="room-code" maxlength="6" required value="${esc(code)}" placeholder="ABC123" autocapitalize="characters"><label for="join-name">Oma nimi</label><input id="join-name" maxlength="24" required placeholder="Pelaajan nimi"><button class="btn green">Liity huoneeseen</button></form></div>
      <details class="rules"><summary>Pelisäännöt</summary><p>Jakaja aloittaa. Viisi pimeää korttia jokaiselle. Paina avopakkaa ja vaihda kortti tai paina nostopakkaa, katso kortti ja päätä, vaihdatko sen vai käännätkö oman pimeän kortin. Aika 30 s; ajan loppuessa yksi pimeä kortti avataan automaattisesti.</p><p>Hai → pari → neljän suora → neljän väri → kaksi paria → kolmoset → suora → väri → täyskäsi → neloset → värisuora → vitoset. Kaksi villeinä toimivaa jokeria.</p></details></div>`;
  }
  function lobby(){
    const host=state.me.id===state.hostId;
    return `<div class="start-screen">${header()}<section class="lobby panel"><div class="eyebrow">KUTSU KAVERIT MUKAAN</div><h1>Pelihuone</h1><div class="room-code">${state.code}</div><div class="lobby-buttons"><button class="btn gold" data-act="share">Kopioi kutsulinkki</button><button class="btn green" data-act="code">Kopioi koodi</button></div><h2>Pelaajat ${state.players.length}/${state.maxPlayers}</h2><div class="lobby-list">${state.players.map((p,i)=>`<div><span>${i+1}.</span><b>${esc(p.name)}</b>${p.id===state.me.id?'<small>SINÄ</small>':''}${p.id===state.hostId?'<small>JÄRJESTÄJÄ</small>':''}</div>`).join('')}</div>
      ${host?`<label for="dealer-select">Jakaja / aloittaja</label><select id="dealer-select">${state.players.map(p=>`<option value="${p.id}" ${p.id===state.dealerId?'selected':''}>${esc(p.name)}</option>`).join('')}</select><button class="btn gold start" data-act="start" ${state.players.length<2?'disabled':''}>Aloita peli</button>`:'<p>Odotetaan järjestäjää…</p>'}
      <button class="text-btn" data-act="leave">Takaisin aloitukseen</button></section></div>`;
  }
  function rival(p){
    const active=p.id===state.activeId;
    return `<section class="rival ${active?'active':''}"><div class="player-line"><b>${esc(p.name)}</b><span>${active?'● ':''}${p.open}/5</span></div><div class="rival-cards">${p.cards.map((c,i)=>card(c,'mini',flipKeys.has(p.id+':'+i))).join('')}</div></section>`;
  }
  function own(me){
    const allowed=state.phase==='playing'&&state.activeId===me.id&&state.stage==='choose';
    return `<section class="own-area"><div class="player-line"><b>OMAT KORTIT · ${esc(me.name)}</b><span>${me.open}/5</span></div><div class="own-cards">${me.cards.map((c,i)=>`<button class="own-slot ${allowed&&!c?'selectable':''}" data-slot="${i}" ${allowed&&!c?'':'disabled'} aria-label="Kortti ${i+1}: ${cardText(c)}">${card(c,'large',flipKeys.has(me.id+':'+i))}</button>`).join('')}</div></section>`;
  }
  function piles(){
    const can=state.phase==='playing'&&state.activeId===state.me.id&&state.stage==='select';
    const canDraw=state.stockCount>0||state.discardCount>1;
    return `<section class="piles"><button class="pile ${can&&canDraw?'available':''}" data-move="draw" ${can&&canDraw?'':'disabled'} aria-label="Nosta nostopakasta"><span>NOSTOPAKKA</span>${canDraw?card(null,'pile-card'):'<span class="empty pile-card">—</span>'}<small>${state.stockCount} korttia</small></button>
      <button class="pile ${can&&state.discardTop?'available':''}" data-move="take" ${can&&state.discardTop?'':'disabled'} aria-label="Ota avopakasta"><span>AVOPAKKA</span>${state.discardTop?card(state.discardTop,'pile-card'):'<span class="empty pile-card">—</span>'}<small>${state.discardTop?cardText(state.discardTop):'Tyhjä'}</small></button>
      ${state.pendingPresent?`<div class="pile pending"><span>NOSTETTU</span>${card(state.pending,'pile-card',pendingFlip)}<small>${cardText(state.pending)}</small></div>`:''}</section>`;
  }
  function controls(){
    if(state.phase==='done')return '<div class="controls done"><div><b>Jako päättyi!</b><small>Loppukädet näkyvät pöydällä.</small></div><button class="btn gold" data-act="results" '+(Date.now()-openedAt<700?'disabled':'')+'>Katso tulokset →</button></div>';
    if(state.activeId!==state.me.id){
      const p=state.players.find(p=>p.id===state.activeId);
      const what=state.stage==='decide'?'miettii nostettua korttia…':state.stage==='choose'?'valitsee pimeää korttia…':'valitsee pakan…';
      return `<div class="controls waiting"><b>${esc(p?.name)} ${what}</b><small>Odota omaa vuoroasi.</small></div>`;
    }
    if(state.stage==='select')return '<div class="controls waiting"><b>Sinun vuorosi — paina jompaakumpaa pakkaa.</b><small>Avopakasta vaihdat kortin, nostopakasta saat valita.</small></div>';
    if(state.stage==='decide')return `<div class="controls decision"><b>Pidätkö kortin ${cardText(state.pending)}?</b><div class="actions"><button class="btn gold" data-move="swap">Pidä kortti</button><button class="btn green" data-move="discard">Hylkää ja käännä</button></div></div>`;
    return `<div class="controls waiting"><b>${state.intent==='swap'?'Valitse pimeä kortti, jonka korvaat.':'Valitse pimeä kortti, jonka käännät.'}</b><small>Kosketa korostettua korttia omalta riviltä.</small></div>`;
  }
  function resultView(){
    if(!results||!state.ranking)return '';
    const leaders=state.ranking.filter(p=>p.winner);
    return `<section class="result-overlay"><div class="result-heading"><div><div class="eyebrow">JAON TULOKSET</div><h2>🏆 ${leaders.length===1?'Voittaja':'Tasapeli'}: ${esc(leaders.map(p=>p.name).join(' ja '))}</h2></div><button class="icon-btn" data-act="table" aria-label="Näytä pöytä">×</button></div>
      <div class="ranking">${state.ranking.map(p=>`<div class="result-row ${p.winner?'winner':''}"><div><b>${p.place}. ${esc(p.name)}</b><small>${p.cards.map(cardText).join(' · ')}</small></div><strong>${esc(p.hand)}</strong></div>`).join('')}</div>
      <button class="btn green wide" data-act="table">← Takaisin korttipöytään</button>${state.me.id===state.hostId?'<button class="btn gold wide" data-act="again">Uusi jako</button>':'<p class="muted">Järjestäjä voi aloittaa uuden jaon.</p>'}</section>`;
  }
  function game(){
    const me=state.players.find(p=>p.id===state.me.id),others=state.players.filter(p=>p.id!==me.id);
    const active=state.players.find(p=>p.id===state.activeId),mine=state.activeId===me.id;
    return `<div class="game-screen players-${state.players.length}">
      ${header('<span class="room-chip">'+state.code+'</span><span id="network" class="network" title="Yhteys"></span>')}
      <section class="turn-bar"><div><b class="${mine?'your-turn':''}">${state.phase==='done'?'JAKO PÄÄTTYI':mine?'SINUN VUOROSI':'VUOROSSA: '+esc(active?.name)}</b><strong id="seconds">—</strong></div><div class="time-track"><i id="time-fill"></i></div></section>
      <div class="table-area"><div class="rivals">${others.map(rival).join('')}</div>${piles()}${own(me)}</div>
      ${controls()}<div class="foot"><button data-act="share">Kutsu</button><span>${esc(state.history[0]||'')}</span><button data-act="leave">Poistu</button></div>${resultView()}</div>`;
  }
  function render(){
    if(!state){home(codeFromUrl());return;}
    app.innerHTML=state.phase==='lobby'?lobby():game();clock();drawConnection();updateChatBadge();
  }
  function drawConnection(){const el=document.querySelector('#network');if(el){el.classList.toggle('online',connected);el.title=connected?'Yhdistetty':'Yhdistetään uudelleen';}}
  function clock(){
    if(!state)return;const el=document.querySelector('#seconds'),fill=document.querySelector('#time-fill');if(!el||!fill)return;
    const ms=state.phase==='playing'?Math.max(0,state.deadline-Date.now()-offset):0;
    el.textContent=state.phase==='playing'?Math.ceil(ms/1000)+' s':'✓';fill.style.width=(state.phase==='playing'?Math.min(100,ms/(state.turnSeconds*10)):100)+'%';
    el.classList.toggle('urgent',state.phase==='playing'&&ms<7000);fill.classList.toggle('urgent',state.phase==='playing'&&ms<7000);
  }
  function updateChatBadge(){
    const count=(state?.chat||[]).filter(m=>m.id>seenChat&&m.playerId!==state.me.id).length;
    const el=document.querySelector('.unread');if(el){el.hidden=!count;el.textContent=count>9?'9+':count;}
  }
  function updateChat(){
    if(!state)return;
    if(chatOpen){
      const nearEnd=chatMessages.scrollHeight-chatMessages.scrollTop-chatMessages.clientHeight<80;
      const msgs=state.chat||[],last=msgs.at(-1)?.id||0;
      const changed=chatMessages.dataset.last!==String(last);
      if(changed){
        chatMessages.innerHTML=msgs.length?msgs.map(m=>`<div class="message ${m.playerId===state.me.id?'mine':''}"><span>${esc(m.name)} · ${new Date(m.time).toLocaleTimeString('fi-FI',{hour:'2-digit',minute:'2-digit'})}</span><p>${esc(m.message)}</p></div>`).join(''):'<p class="muted">Aloita pöytäpuhe! 👋</p>';
        chatMessages.dataset.last=String(last);if(nearEnd||!seenChat)chatMessages.scrollTop=chatMessages.scrollHeight;
      }
      seenChat=last;
    }
    updateChatBadge();
  }
  function toggleChat(open){
    chatOpen=open;chatPanel.hidden=!open;
    if(open){document.querySelector('#chat-room').textContent='HUONE '+state.code;chatMessages.dataset.last='';updateChat();chatMessages.scrollTop=chatMessages.scrollHeight;}
  }
  async function action(type,extra={}){
    if(busy||!session)return;busy=true;
    try{await api('action',{room:session.code,token:session.token,type,handId:state?.handId,turn:state?.turns,...extra});}
    catch(e){notify(e.message);}finally{busy=false;}
  }
  async function copy(value){try{await navigator.clipboard.writeText(value);notify('Kopioitu!');}catch{window.prompt('Kopioi tästä:',value);}}
  app.addEventListener('submit',async e=>{
    const form=e.target;if(!['create-form','join-form'].includes(form.id))return;e.preventDefault();if(busy)return;busy=true;
    const btn=form.querySelector('button');btn.disabled=true;
    try{
      const s=form.id==='create-form'?await api('create',{name:form.querySelector('#host-name').value,maxPlayers:Number(form.querySelector('#max-players').value)}):await api('join',{code:form.querySelector('#room-code').value.toUpperCase(),name:form.querySelector('#join-name').value});
      save(s);await connect(s);
    }catch(e){notify(e.message);}finally{busy=false;if(btn.isConnected)btn.disabled=false;}
  });
  app.addEventListener('change',e=>{if(e.target.id==='dealer-select')action('dealer',{playerId:e.target.value});});
  app.addEventListener('click',e=>{
    const slot=e.target.closest('[data-slot]');if(slot){if(!slot.disabled)action('slot',{slot:Number(slot.dataset.slot)});return;}
    const move=e.target.closest('[data-move]');if(move){if(move.disabled)return;const m=move.dataset.move;if(m==='swap'||m==='discard')action('intent',{intent:m==='swap'?'swap':'flip'});else action(m);return;}
    const btn=e.target.closest('[data-act]');if(!btn||btn.disabled)return;
    switch(btn.dataset.act){
      case 'sound':sound=!sound;try{localStorage.setItem('maapokeri:sound',sound?'on':'off');}catch{}if(sound){unlockAudio();tone(659,0,.16);}btn.textContent=sound?'♪':'♪̶';btn.setAttribute('aria-label',sound?'Mykistä äänet':'Ota äänet käyttöön');notify(sound?'Äänet päällä':'Äänet pois');break;
      case 'chat':toggleChat(!chatOpen);break;
      case 'share':copy(location.origin+'/?huone='+state.code);break;
      case 'code':copy(state.code);break;
      case 'start':action('start');break;
      case 'again':action('again');break;
      case 'results':if(Date.now()-openedAt<700)return;results=true;flipKeys.clear();pendingFlip=false;render();break;
      case 'table':results=false;flipKeys.clear();render();break;
      case 'leave':toggleChat(false);stopConnection();state=null;session=null;boardKey='';history.replaceState({},'',location.pathname);home();break;
    }
  });
  document.querySelector('#chat-close').addEventListener('click',()=>toggleChat(false));
  document.querySelector('#chat-form').addEventListener('submit',async e=>{
    e.preventDefault();if(chatBusy||!session)return;const message=chatInput.value.trim();if(!message)return;chatBusy=true;
    try{await api('action',{room:session.code,token:session.token,type:'chat',message});if(chatInput.value.trim()===message)chatInput.value='';}
    catch(err){notify(err.message);}finally{chatBusy=false;}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&chatOpen)toggleChat(false);});
  setInterval(clock,100);
  const code=codeFromUrl(),s=code&&stored(code);if(s){home(code);connect(s);}else home(code);
})();
