'use strict';
  const SUITS = [
    {id: 'S', symbol: '♠', name: 'pata'},
    {id: 'H', symbol: '♥', name: 'hertta'},
    {id: 'D', symbol: '♦', name: 'ruutu'},
    {id: 'C', symbol: '♣', name: 'risti'}
  ];
  const RANK_NAMES = {11:'J',12:'Q',13:'K',14:'A'};
  const CATEGORIES = [
    'Hai', 'Pari', 'Neljän suora', 'Neljän väri', 'Kaksi paria',
    'Kolmoset', 'Suora', 'Väri', 'Täyskäsi', 'Neloset', 'Värisuora', 'Vitoset'
  ];
  const OPTIONS = [];
  for (let r = 2; r <= 14; r++) for (const suit of SUITS) OPTIONS.push({rank:r, suit:suit.id, joker:false});
  let game = null;
  let config = {count: 2, dealer: 0, names: ['Pelaaja 1','Pelaaja 2','Pelaaja 3','Pelaaja 4','Pelaaja 5','Pelaaja 6']};

  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const rankText = r => RANK_NAMES[r] || String(r);
  const suitSymbol = s => SUITS.find(x => x.id === s)?.symbol || '';
  const cardText = c => c.joker ? 'Jokeri' : `${rankText(c.rank)}${suitSymbol(c.suit)}`;

  function shuffle(cards) {
    for (let i=cards.length-1;i>0;i--) {
      const j=require('node:crypto').randomInt(i+1);
      [cards[i],cards[j]]=[cards[j],cards[i]];
    }
    return cards;
  }
  function newDeck() {
    const deck=OPTIONS.map((c,i) => ({...c,id:`K${i}`}));
    deck.push({id:'J1',joker:true,rank:0,suit:null},{id:'J2',joker:true,rank:0,suit:null});
    return shuffle(deck);
  }
  function compareScores(a,b) {
    if (a.category !== b.category) return a.category - b.category;
    for (let i=0;i<Math.max(a.tie.length,b.tie.length);i++) {
      const d=(a.tie[i]||0)-(b.tie[i]||0);
      if (d) return d;
    }
    return 0;
  }
  function straightScore(ranks, length) {
    const set=new Set(ranks);
    if(set.has(14))set.add(1);
    for(let start=15-length;start>=1;start--) {
      const seq=Array.from({length},(_,i)=>start+i);
      if(seq.every(r=>set.has(r))) {
        const used = seq.map(r=>r===1?14:r);
        const remaining=[...ranks];
        for(const v of used)remaining.splice(remaining.indexOf(v),1);
        return {high:start+length-1,kickers:remaining.sort((a,b)=>b-a)};
      }
    }
    return null;
  }
  function scoreNatural(cards) {
    const ranks=cards.map(c=>c.rank).sort((a,b)=>b-a);
    const counts=new Map();
    for(const r of ranks)counts.set(r,(counts.get(r)||0)+1);
    const groups=[...counts].map(([rank,count])=>({rank,count}))
      .sort((a,b)=>b.count-a.count || b.rank-a.rank);
    const allSuit=cards.every(c=>c.suit===cards[0].suit);
    const run5=straightScore(ranks,5);
    if(groups[0].count===5)return {category:11,tie:[groups[0].rank]};
    if(allSuit&&run5)return {category:10,tie:[run5.high]};
    if(groups[0].count===4)return {category:9,tie:[groups[0].rank,groups[1].rank]};
    if(groups[0].count===3&&groups[1].count===2)return {category:8,tie:[groups[0].rank,groups[1].rank]};
    if(allSuit)return {category:7,tie:ranks};
    if(run5)return {category:6,tie:[run5.high]};
    if(groups[0].count===3)return {category:5,tie:[groups[0].rank,...groups.slice(1).map(g=>g.rank).sort((a,b)=>b-a)]};
    if(groups[0].count===2&&groups[1].count===2) {
      const pairs=groups.slice(0,2).map(g=>g.rank).sort((a,b)=>b-a);
      return {category:4,tie:[...pairs,groups[2].rank]};
    }
    // Neljän kortin väri tai suora on parempi kuin pari, mutta huonompi kuin kaksi paria.
    for(const suit of SUITS) {
      const suited=cards.filter(c=>c.suit===suit.id);
      if(suited.length>=4) {
        const best4=suited.map(c=>c.rank).sort((a,b)=>b-a).slice(0,4);
        const other=cards.filter(c=>!suited.some(d=>d===c)).map(c=>c.rank);
        return {category:3,tie:[...best4,...other]};
      }
    }
    const run4=straightScore(ranks,4);
    if(run4)return {category:2,tie:[run4.high,...run4.kickers]};
    if(groups[0].count===2)return {category:1,tie:[groups[0].rank,...groups.slice(1).map(g=>g.rank).sort((a,b)=>b-a)]};
    return {category:0,tie:ranks};
  }
  function evaluateHand(cards) {
    if (!Array.isArray(cards)||cards.length!==5) throw new Error('Kädessä pitää olla viisi korttia.');
    const jokers=cards.filter(c=>c.joker);
    const regular=cards.filter(c=>!c.joker);
    if(jokers.length===0) {
      const score=scoreNatural(regular);
      return {...score,label:CATEGORIES[score.category],wildcards:[]};
    }
    let best=null;
    if(jokers.length===1) {
      for (const candidate of OPTIONS) {
        const score=scoreNatural([...regular,candidate]);
        if(!best||compareScores(score,best)>0)best={...score,wildcards:[candidate]};
      }
    } else {
      for(const c1 of OPTIONS)for(const c2 of OPTIONS) {
        const score=scoreNatural([...regular,c1,c2]);
        if(!best||compareScores(score,best)>0)best={...score,wildcards:[c1,c2]};
      }
    }
    return {...best,label:CATEGORIES[best.category]};
  }

module.exports={newDeck,evaluateHand,compareScores,CATEGORIES};
