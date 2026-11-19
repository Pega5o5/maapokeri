(() => {
  'use strict';
  const app=document.querySelector('#app');
  const toast=document.querySelector('#toast');
  const SUITS={S:'♠',H:'♥',D:'♦',C:'♣'};
  const RANK={11:'J',12:'Q',13:'K',14:'A'};
  let state=null, session=null, events=null, serverOffset=0, connected=false;
  let busy=false, noticeTimeout=null, actionInFlight=false;
  const clean=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cardLabel=c=>!c?'Pimeä':c.joker?'Jokeri':`${RANK[c.rank]||c.rank}${SUITS[c.suit]}`;
  const roomFromUrl=()=>new URLSearchParams(location.search).get('huone')?.trim().toUpperCase()||'';
  function showToast(message) {
    toast.textContent=message;toast.classList.add('show');clearTimeout(noticeTimeout);
    noticeTimeout=setTimeout(()=>toast.classList.remove('show'),3600);
  }
  async function api(endpoint,data) {
    const res=await fetch('/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    let answer={};try{answer=await res.json();}catch{}
    if(!res.ok)throw new Error(answer.error||'Verkkovirhe.');
    return answer;
  }
  function getStoredSession(code) {
    try {const s=JSON.parse(localStorage.getItem('maapokeri:huone:'+code));return s&&s.code===code&&s.token?s:null;}catch{return null;}
  }
  function saveSession(s){localStorage.setItem('maapokeri:huone:'+s.code,JSON.stringify(s));}
  function clearConn() {if(events){events.close();events=null;}connected=false;}
  async function connect(s) {
    clearConn();session=s;busy=false;
    history.replaceState({},'',location.pathname+'?huone='+encodeURIComponent(s.code));
    const url='/api/state?room='+encodeURIComponent(s.code)+'&token='+encodeURIComponent(s.token);
    try {
      const res=await fetch(url,{cache:'no-store'});
      const result=await res.json();
      if(!res.ok)throw new Error(result.error||'Huoneen haku epäonnistui.');
      updateState(result);
      events=new EventSource('/api/events?room='+encodeURIComponent(s.code)+'&token='+encodeURIComponent(s.token));
      events.addEventListener('state',ev=>{try{updateState(JSON.parse(ev.data));}catch(e){console.error(e);}});
      events.onopen=()=>{connected=true;renderConnection();};
      events.onerror=()=>{connected=false;renderConnection();};
    }catch(e){
      clearConn();session=null;state=null;
      localStorage.removeItem('maapokeri:huone:'+s.code);
      renderHome(s.code);showToast(e.message);
    }
  }
  function updateState(value) {
    const was=state?.phase;
    state=value;
    serverOffset=value.serverNow-Date.now();
    if(value.phase==='done' && was==='playing') showToast('Peli päättyi – tulokset ovat valmiit!');
    render();
  }
  function cardHtml(c,extra='') {
    if(!c)return `<span class="card back ${extra}" aria-label="Pimeä kortti"><span class="back-pattern">♠</span></span>`;
    if(c.joker)return `<span class="card joker ${extra}" aria-label="Jokeri"><b>★</b><strong>✦</strong><small>JOKERI</small></span>`;
    const red=c.suit==='H'||c.suit==='D';
    return `<span class="card ${red?'red':''} ${extra}" aria-label="${cardLabel(c)}"><b>${RANK[c.rank]||c.rank}<small>${SUITS[c.suit]}</small></b><strong>${SUITS[c.suit]}</strong></span>`;
  }
  function logo() {return `<span class="brand-icon">♠</span><span class="brand-name">MAAPOKERI</span>`;}
  function header(right) {return `<header class="header"><div class="brand">${logo()}</div>${right||''}</header>`;}
  function renderHome(code='') {
    app.innerHTML=`<div class="start-screen">${header('<span class="mini-tag">VERKKOPELI</span>')}
      <section class="welcome"><div class="welcome-illustration" aria-hidden="true">♠ <span>♥</span> ♣</div><p class="eyebrow">KAVEREIDEN KANSSA · OMILLA PUHELIMILLA</p>
        <h1>Viisi pimeää.<br>30 sekuntia per vuoro.</h1>
        <p class="lead">Luo pelihuone, jaa koodi kavereille ja pelaa maapokeria reaaliajassa.</p></section>
      <div class="entry-grid"><form id="create-form" class="form-card"><h2>Luo huone</h2>
          <label for="host-name">Oma nimi</label><input id="host-name" maxlength="24" placeholder="Esim. Matti" required autocomplete="nickname" />
          <label for="max-players">Enintään pelaajia</label><select id="max-players"><option>2</option><option>3</option><option>4</option><option>5</option><option selected>6</option></select>
          <button class="btn gold" type="submit">Luo pelihuone</button></form>
        <form id="join-form" class="form-card"><h2>Liity kaverin peliin</h2>
          <label for="room-code">Huonekoodi</label><input id="room-code" maxlength="6" value="${clean(code)}" placeholder="ESIM. K7MN2T" autocapitalize="characters" required />
          <label for="join-name">Oma nimi</label><input id="join-name" maxlength="24" placeholder="Esim. Liisa" required autocomplete="nickname" />
          <button class="btn green" type="submit">Liity huoneeseen</button></form></div>
      <details class="rules"><summary>Pelisäännöt ja käsien arvojärjestys</summary><div class="rule-copy">${rules()}</div></details>
      <footer>2–6 pelaajaa · 54 korttia, myös 2 jokeria · 30 s / vuoro</footer>
    </div>`;
  }
  function rules() {return `<p>Jakaja aloittaa. Kaikilla on aluksi viisi pimeää korttia, ja avopakan päällä on yksi avoin kortti.</p>
    <p>Ota avopakan päällimmäinen ja vaihda se pimeään korttiin <em>tai</em> nosta nostopakasta ja päätä vaihdatko kortin vai hylkäätkö sen kääntääksesi oman pimeän kortin. Voit myös valita suoraan ”Käännä pimeä”, jolloin nostettu kortti hylätään.</p>
    <p>Vaihdetun pimeän kortin tilalle tulee ottamasi kortti kuvapuoli ylöspäin. Vaihdettu kortti siirtyy avopakan päällimmäiseksi. Jokaisella vuorolla avautuu yksi kortti. Jos 30 sekuntia päättyy, ensimmäinen jäljellä oleva pimeä kortti käännetään automaattisesti ja nostettu kortti hylätään.</p>
    <p>Peli päättyy, kun kaikki viisi korttia ovat auki jokaisella pelaajalla. Käsien arvojärjestys huonoimmasta parhaaseen: <strong>hai → pari → neljän suora → neljän väri → kaksi paria → kolmoset → suora → väri → täyskäsi → neloset → värisuora → vitoset.</strong> Jokerit ovat villejä kortteja. Ässä voi olla suoran suurin tai pienin.</p>`;}
  function lobbyView() {
    const isHost=state.me.id===state.hostId;
    const share=location.origin+'/?huone='+encodeURIComponent(state.code);
    return `<div class="lobby-screen">${header('<span class="mini-tag">ODOTUSHUONE</span>')}
      <section class="lobby-panel"><p class="eyebrow">KUTSU KAVERIT MUKAAN</p><h1>Pelihuone <span>${state.code}</span></h1>
        <p class="subtext">Jaa huonekoodi tai kutsulinkki kavereille. Jokainen pelaa omalla puhelimellaan.</p>
        <div class="room-code">${state.code}</div><div class="lobby-actions">
          <button class="btn gold" data-act="share" data-share="${clean(share)}">Kopioi kutsulinkki</button>
          <button class="btn ghost" data-act="code">Kopioi koodi</button></div>
        <h2>Pelaajat ${state.players.length}/${state.maxPlayers}</h2>
        <div class="lobby-players">${state.players.map((p,i)=>`<div class="lobby-player"><span class="number">${i+1}</span><strong>${clean(p.name)}</strong>${p.id===state.me.id?'<span class="you">SINÄ</span>':''}${p.id===state.hostId?'<span class="host-tag">JÄRJESTÄJÄ</span>':''}</div>`).join('')}</div>
        ${isHost?`<label for="dealer-select">Jakaja / ensimmäinen pelaaja</label><select id="dealer-select">${state.players.map(p=>`<option value="${clean(p.id)}" ${p.id===state.dealerId?'selected':''}>${clean(p.name)}</option>`).join('')}</select>
          <button class="btn gold big" data-act="start" ${state.players.length<2?'disabled':''}>Aloita peli (${state.players.length} pelaajaa)</button>
          <p class="subtext">Pelin voi aloittaa, kun vähintään kaksi pelaajaa on liittynyt.</p>`:
          `<div class="waiting-note">⏳ Odotetaan, että järjestäjä aloittaa pelin…</div>`}
        <button class="btn link-button" data-act="leave">Takaisin aloitukseen</button>
      </section></div>`;
  }
  function playerTile(p) {
    const active=state.activeId===p.id&&state.phase==='playing';
    const me=p.id===state.me.id;
    return `<div class="opponent ${active?'active':''}" title="${clean(p.name)}">
      <div class="player-label"><strong>${clean(p.name)}${me?' (sinä)':''}</strong><span>${active?'● ':''}${p.open}/5</span></div>
      <div class="cards-mini">${p.cards.map(c=>cardHtml(c,'mini-card')).join('')}</div>
    </div>`;
  }
  function myCardsView(me) {
    const canChoose=state.phase==='playing'&&state.me.id===state.activeId&&state.stage==='choose';
    return `<section class="my-area"><div class="my-heading"><strong>OMAT KORTIT</strong><span>${me.open}/5 avattu ${canChoose?'· Valitse pimeä kortti':''}</span></div>
      <div class="cards-large">${me.cards.map((c,i)=>{
        const selectable=canChoose&&!c;
        return `<button data-slot="${i}" class="own-card ${selectable?'selectable':''}" ${selectable?'':'disabled'} aria-label="Oma kortti ${i+1}, ${cardLabel(c)}${selectable?', valitse':''}">
          ${cardHtml(c,'big-card')}<span class="slot-index">${i+1}</span></button>`;
      }).join('')}</div></section>`;
  }
  function pilesView() {
    const canAct=state.me.id===state.activeId&&state.phase==='playing'&&state.stage==='select';
    return `<section class="center-piles" aria-label="Nosto- ja avopakka">
      <div class="pile"><div class="pile-title">NOSTOPAKKA</div>${state.stockCount>0?cardHtml(null,'pile-card'):cardHtml(null,'pile-card empty-pile')}<div class="pile-info">${state.stockCount} korttia</div></div>
      <div class="pile"><div class="pile-title">AVOPAKKA</div>${state.discardTop?cardHtml(state.discardTop,'pile-card'):'<span class="card pile-card empty-pile">—</span>'}<div class="pile-info">${state.discardTop?cardLabel(state.discardTop):'Tyhjä'}</div></div>
      ${state.pendingPresent?`<div class="pile pending-pile"><div class="pile-title">NOSTETTU</div>${state.pending?cardHtml(state.pending,'pile-card'):cardHtml(null,'pile-card')}<div class="pile-info">${state.pending?cardLabel(state.pending):'Pimeä'}</div></div>`:''}
    </section>`;
  }
  function controlsView() {
    const playing=state.phase==='playing';
    const mine=state.me.id===state.activeId&&playing;
    if(!playing)return `<section class="controls"><div class="control-message">🏆 Kaikki kortit ovat auki. Katso lopputulos alta.</div></section>`;
    if(!mine)return `<section class="controls waiting-controls"><div class="control-message">Odota vuoroasi. <strong>${clean(state.players.find(p=>p.id===state.activeId)?.name)}</strong> tekee siirtoa.</div><div class="control-tip">Näet muiden pelaajien avatut kortit yllä.</div></section>`;
    if(state.stage==='select')return `<section class="controls"><div class="control-message">Valitse vuoron toiminto</div><div class="action-buttons">
       <button class="btn gold" data-move="take" ${state.discardTop?'':'disabled'}>Ota avopakasta</button>
       <button class="btn green" data-move="draw">Nosta pakasta</button>
       <button class="btn outline" data-move="flip">Käännä pimeä</button></div></section>`;
    if(state.stage==='decide')return `<section class="controls"><div class="control-message">Nostit ${cardLabel(state.pending)}. Mitä teet sillä?</div><div class="action-buttons two">
       <button class="btn gold" data-move="swap">Vaihda korttiin</button><button class="btn green" data-move="discard">Hylkää ja käännä</button></div></section>`;
    if(state.stage==='choose')return `<section class="controls"><div class="control-message">${state.pending?`Kortti ${cardLabel(state.pending)}: `:''}Kosketa yhtä oman rivin pimeää korttia.</div><div class="control-tip">Valittu kortti avataan tai korvataan. Vuoro päättyy heti.</div></section>`;
    return `<section class="controls"><div class="control-message">Odota…</div></section>`;
  }
  function resultsView() {
    const winners=state.ranking.filter(p=>p.winner).map(p=>p.name).join(' ja ');
    return `<section class="results"><h2>🏆 ${state.ranking.filter(p=>p.winner).length>1?'Tasapeli':'Voittaja'}: ${clean(winners)}</h2>
      <div class="ranking">${state.ranking.map(p=>`<div class="result ${p.winner?'winner':''}"><div><strong>${p.place}. ${clean(p.name)}</strong><span>${p.cards.map(cardLabel).join(' · ')}</span></div><b>${clean(p.hand)}</b></div>`).join('')}</div>
      ${state.me.id===state.hostId?'<button data-act="again" class="btn gold">Uusi jako samoilla pelaajilla</button>':'<p class="subtext">Järjestäjä voi aloittaa uuden jaon.</p>'}
    </section>`;
  }
  function gameView() {
    const me=state.players.find(p=>p.id===state.me.id);
    const others=state.players.filter(p=>p.id!==state.me.id);
    const active=state.players.find(p=>p.id===state.activeId);
    const isMine=active?.id===state.me.id;
    const playing=state.phase==='playing';
    const remaining=playing?Math.max(0,Math.ceil((state.deadline-(Date.now()+serverOffset))/1000)):0;
    return `<div class="game-screen">
      ${header(`<div class="header-right"><span class="room-chip">HUONE ${state.code}</span><span id="network" class="network ${connected?'online':'offline'}" title="Yhteys palvelimeen"></span></div>`)}
      <section class="turn-bar"><div class="turn-heading"><span>${playing?(isMine?'SINUN VUOROSI':`VUOROSSA: ${clean(active?.name)}`):'PELI PÄÄTTYNYT'}</span><strong id="seconds">${playing?remaining+' s':'✓'}</strong></div>
        <div class="time-track"><div id="time-progress" style="width:${playing?remaining/30*100:100}%"></div></div>
        <div class="turn-sub">${playing?`Kierroksella avattu ${state.players.reduce((sum,p)=>sum+p.open,0)}/${state.players.length*5} korttia`: 'Kaikki kortit käännetty'}</div></section>
      <section class="table-area">
        <div class="rivals" style="--rival-rows:${Math.ceil(others.length/2)}">${others.map(playerTile).join('')}</div>
        ${pilesView()}${myCardsView(me)}
      </section>
      ${controlsView()}
      ${state.phase==='done'?'<div class="finished-scroll">'+resultsView()+'</div>':''}
      <div class="game-menu"><button data-act="copy" title="Kopioi kutsulinkki">Kopioi huonekoodi</button><span>${clean(state.me.name)}</span><button data-act="leave">Poistu näkymästä</button></div>
    </div>`;
  }
  function render() {
    if(!state) return renderHome(roomFromUrl());
    app.innerHTML=state.phase==='lobby'?lobbyView():gameView();
    updateClock();
    renderConnection();
  }
  function renderConnection() {
    const label=document.querySelector('#network');
    if(label){label.className='network '+(connected?'online':'offline');label.title=connected?'Yhdistetty':'Yhteys katkesi – yritetään yhdistää uudelleen';}
  }
  function updateClock() {
    if(!state||state.phase!=='playing')return;
    const seconds=Math.max(0,Math.ceil((state.deadline-Date.now()-serverOffset)/1000));
    const el=document.querySelector('#seconds'),bar=document.querySelector('#time-progress');
    if(el){el.textContent=seconds+' s';el.classList.toggle('urgent',seconds<=7);}
    if(bar){bar.style.width=Math.min(100,Math.max(0,(state.deadline-Date.now()-serverOffset)/30000*100))+'%';bar.classList.toggle('urgent',seconds<=7);}
  }
  async function doAction(type,additional={}) {
    if(busy||!session)return;
    busy=true;
    try {await api('action',{room:session.code,token:session.token,type,...additional});}
    catch(e){showToast(e.message);}
    finally{busy=false;}
  }
  async function shareText(text,label) {
    try {await navigator.clipboard.writeText(text);showToast(label+' kopioitu!');}
    catch {window.prompt('Kopioi tästä:',text);}
  }
  app.addEventListener('submit',async e=>{
    const form=e.target;if(!['create-form','join-form'].includes(form.id))return;
    e.preventDefault();if(busy)return;
    busy=true;
    const button=form.querySelector('button[type=submit]');button.disabled=true;
    try {
      let s;
      if(form.id==='create-form')s=await api('create',{name:form.querySelector('#host-name').value,maxPlayers:Number(form.querySelector('#max-players').value)});
      else s=await api('join',{name:form.querySelector('#join-name').value,code:form.querySelector('#room-code').value.toUpperCase()});
      saveSession(s);await connect(s);
    }catch(err){showToast(err.message);}finally{busy=false;if(button.isConnected)button.disabled=false;}
  });
  app.addEventListener('change',e=>{
    if(e.target.id==='dealer-select')doAction('dealer',{playerId:e.target.value});
  });
  app.addEventListener('click',e=>{
    const slot=e.target.closest('[data-slot]');
    if(slot){if(!slot.disabled)doAction('slot',{slot:Number(slot.dataset.slot)});return;}
    const move=e.target.closest('[data-move]');
    if(move){if(move.disabled)return;
      const kind=move.dataset.move;
      if(kind==='swap'||kind==='discard')doAction('intent',{intent:kind==='swap'?'swap':'flip'});
      else doAction(kind);
      return;
    }
    const btn=e.target.closest('[data-act]');if(!btn)return;
    if(btn.dataset.act==='share'||btn.dataset.act==='copy')shareText(location.origin+'/?huone='+state.code,'Kutsulinkki');
    if(btn.dataset.act==='code')shareText(state.code,'Huonekoodi');
    if(btn.dataset.act==='start')doAction('start');
    if(btn.dataset.act==='again')doAction('again');
    if(btn.dataset.act==='leave'){
      // Huoneen jäsenyys säilyy: samaan huoneeseen voi palata samalla selaimella.
      clearConn();session=null;state=null;history.replaceState({},'',location.pathname);renderHome('');
    }
  });
  setInterval(updateClock,100);
  const code=roomFromUrl();const saved=code&&getStoredSession(code);
  if(saved)connect(saved);
  else renderHome(code);
})();
