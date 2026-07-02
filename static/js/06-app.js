/* ============ TOAST + NOTES BADGE ============ */
let toastTimer=null;
function toast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),1900);}
function updateNotesBadge(){const b=document.getElementById('notesCount');if(!b)return;b.textContent=NOTES.length;b.style.display=NOTES.length?'inline-block':'none';b.classList.remove('pulse');void b.offsetWidth;b.classList.add('pulse');}

/* ============ NOTES PERSISTENCE (backend-backed) ============ */
async function loadNotesFromDisk(){
  try{
    const r=await fetch(`${API_BASE}/notes`);
    if(r.ok){
      const saved=await r.json();
      if(Array.isArray(saved)){
        NOTES=saved;
        updateNotesBadge();
        if(CURRENT==='notes')renderSection('notes');
      }
    }
  }catch(e){
    // backend not running yet — start with empty notes
  }
}
async function persistNotes(){
  try{
    await fetch(`${API_BASE}/notes`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(NOTES),
    });
  }catch(e){
    // silent fail — notes still work in memory for this session
  }
}

/* ============ COMPANY BAR (real data) ============ */
function renderCompanyBar(){
  const bar=document.getElementById('companyBar'); if(!bar||!DATA) return;
  document.body.classList.add('has-ticker');   // ticker view is up → reveal the section nav
  const c=DATA.company||{}, q=DATA.quote||{};
  const chg=q.change||0, chgPct=q.change_pct||0;
  const up=chg>=0;
  const volRatio=q.volume_ratio?` (${q.volume_ratio}x avg)`:'';
  const stats=[
    ['Mkt Cap',fmtLarge(q.market_cap)],
    ['Vol',fmtLarge(q.volume)+volRatio],
    ['Beta',q.beta!=null?fmt(q.beta):'—'],
    ['52W',`${fmt(q.week_52_low)} – ${fmt(q.week_52_high)}`],
    ['Short %',q.short_pct_float!=null?(q.short_pct_float*100).toFixed(1)+'%':'—'],
  ];
  bar.innerHTML=`
    <div class="cb-main">
      <div class="cb-top">
        <div class="cb-name">${c.name||DATA.ticker}</div>
        <button class="cb-fav ${isFavoriteAny(DATA.ticker)?'on':''}" data-cbfav="${DATA.ticker}" title="Save to favorites" aria-label="Toggle favorite">${STAR_ICON}</button>
        <div class="cb-ticker">${DATA.ticker} · ${c.exchange||''} · ${c.currency||'USD'}</div>
        <div class="cb-price" id="cbPrice">${q.price!=null?fmtPrice(q.price):'—'}</div>
        <div class="cb-change ${up?'pos':'neg'}" id="cbChange">${up?'▲':'▼'} ${up?'+':''}${fmt(chg)} (${up?'+':''}${fmt(chgPct)}%)</div>
        <span class="mkt" id="mktStatus"></span>
        <span id="extMove"></span>
      </div>
      <div class="cb-stats">${stats.map(s=>`<span><span class="lbl">${s[0]}:</span> ${s[1]}</span>`).join('')}</div>
      <div class="cb-about"><div class="cb-about-inner"><div class="cb-about-pad">
        <div class="cb-desc">${c.description||'—'}</div>
        <div class="cb-meta"><span>CEO <b>${c.ceo||'—'}</b></span><span>HQ <b>${c.headquarters||'—'}</b></span><span>Employees <b>${c.employees?c.employees.toLocaleString():'—'}</b></span><span>Sector <b>${c.sector||'—'}</b></span></div>
      </div></div></div>
    </div>
    <div class="cb-chart">
      <div class="cb-chart-head"><span>Past month · 1D</span><span class="cb-chart-chg" id="cbSparkChg">—</span></div>
      <div id="cbMiniChart" class="cb-minichart"></div>
    </div>`;
  updateMarketStatus();
}

/* ============ MARKET SESSION STATUS ============ */
// US equity sessions in ET. Uses the backend's marketState when present
// (authoritative); otherwise derives the session from the wall clock.
const MKT_HOLIDAYS=['2026-01-01','2026-01-19','2026-02-16','2026-04-03','2026-05-25','2026-06-19','2026-07-03','2026-09-07','2026-11-26','2026-12-25'];
function clockSession(){
  let p={};
  try{const f=new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour12:false,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});f.formatToParts(new Date()).forEach(x=>{p[x.type]=x.value;});}catch(e){return 'closed';}
  let hh=parseInt(p.hour,10); if(hh===24)hh=0; const mins=hh*60+parseInt(p.minute,10);
  const dateStr=p.year+'-'+p.month+'-'+p.day;
  if(p.weekday==='Sat'||p.weekday==='Sun')return 'closed';
  if(MKT_HOLIDAYS.indexOf(dateStr)>=0)return 'holiday';
  if(mins>=570&&mins<960)return 'open';      // 9:30–16:00
  if(mins>=240&&mins<570)return 'pre';       // 4:00–9:30
  if(mins>=960&&mins<1200)return 'after';    // 16:00–20:00
  return 'closed';
}
function marketStatus(){
  const ms=(DATA&&DATA.quote&&DATA.quote.market_state||'').toUpperCase();
  // Trust Yahoo for live sessions; for CLOSED/absent use the clock (holiday/weekend/overnight).
  const live={REGULAR:'open',PRE:'pre',PREPRE:'pre',POST:'after',POSTPOST:'after'};
  const state=live[ms]||clockSession();
  const meta={
    open:{label:'Market Open',sub:'Closes 4:00 PM ET',cls:'open'},
    pre:{label:'Pre-Market',sub:'Opens 9:30 AM ET',cls:'pre'},
    after:{label:'After Hours',sub:'Until 8:00 PM ET',cls:'after'},
    closed:{label:'Market Closed',sub:'Opens 9:30 AM ET',cls:'closed'},
    holiday:{label:'Market Closed',sub:'Holiday',cls:'closed'},
  };
  return meta[state]||meta.closed;
}
// Extended-hours move pill — shows only when the backend supplies pre/post fields.
function extMovePill(){
  const q=DATA&&DATA.quote; if(!q) return '';
  const sess=(q.market_state||'').toUpperCase();
  const pre=(sess.indexOf('PRE')===0)||(!sess&&clockSession()==='pre');
  const post=(sess.indexOf('POST')===0)||(!sess&&clockSession()==='after');
  let label,price,pct;
  if(pre&&q.pre_market_price!=null){label='Pre-Mkt';price=q.pre_market_price;pct=q.pre_market_change_pct;}
  else if(post&&q.post_market_price!=null){label='After-Hrs';price=q.post_market_price;pct=q.post_market_change_pct;}
  else return '';
  const upx=(pct==null||pct>=0);
  const pctTxt=pct!=null?(upx?'▲ +':'▼ −')+fmt(Math.abs(pct))+'%':'';
  return `<span class="ext ${upx?'pos':'neg'}"><span class="el">${label}</span> $${Number(price).toFixed(2)} ${pctTxt}</span>`;
}
function updateMarketStatus(){
  const el=document.getElementById('mktStatus');
  if(el){const m=marketStatus();const showLabel=(m.cls==='pre'||m.cls==='after');   // open/closed: dot alone; pre/after: dot + label
    el.className='mkt '+m.cls;el.innerHTML=`<span class="mdot"></span>${showLabel?`<span class="mlbl">${m.label}</span>`:''}`;el.title='US equity session (NYSE/NASDAQ) · times in ET';}
  const ex=document.getElementById('extMove'); if(ex) ex.innerHTML=extMovePill();
}

/* ============ TOP-RIGHT MINI CHART (TradingView candlesticks · 1mo · 1D) ============ */
// A compact TradingView Advanced Chart in the company bar: daily candles over the
// past month. Daily is the best density for this window — ~22 bars across the month,
// each with a readable body (1H would pack ~150 bars into the box). The header's
// 1-month % is computed from our own daily closes so it stays correct regardless of
// the widget's feed. Falls back to the SVG sparkline offline.
let _miniMode=null;   // 'tv' (widget) | 'svg' (offline fallback)
function setMiniChg(){
  const chgEl=document.getElementById('cbSparkChg'); if(!chgEl) return;
  const cd=DATA&&DATA.technicals&&DATA.technicals.chart_data;
  const closes=(cd?cd.map(d=>d.close).filter(v=>v!=null&&!isNaN(v)):[]).slice(-22);
  if(closes.length<2){chgEl.textContent='—';chgEl.style.color='';return;}
  const chgPct=closes[0]?((closes[closes.length-1]-closes[0])/closes[0]*100):0;
  chgEl.textContent=(chgPct>=0?'+':'')+chgPct.toFixed(1)+'%';
  chgEl.style.color=closes[closes.length-1]<closes[0]?'var(--red)':'var(--green)';
}
function buildMiniChart(){
  const el=document.getElementById('cbMiniChart'); if(!el||!DATA||!DATA.ticker) return;
  setMiniChg();
  if(window.TradingView&&TradingView.widget){
    const dk=document.documentElement.dataset.theme==='dark';
    el.innerHTML='';
    try{
      new TradingView.widget({
        container_id:'cbMiniChart', symbol:DATA.ticker,
        interval:'D',           // daily candles
        range:'1M',             // past month
        style:'1',              // candlesticks
        theme:dk?'dark':'light', locale:'en', timezone:'America/New_York',
        autosize:true, allow_symbol_change:false, withdateranges:false,
        hide_top_toolbar:true, hide_legend:true, hide_side_toolbar:true,
        hide_volume:true, details:false, calendar:false, save_image:false,
      });
      _miniMode='tv'; return;
    }catch(e){}
  }
  _miniMode='svg'; buildSparkline();   // offline fallback
}

/* ============ SPARKLINE (offline fallback · real 1-month closes) ============ */
// Catmull-Rom → cubic bezier for a smooth sparkline (no angular kinks).
function smoothPath(pts){
  if(pts.length<2) return 'M'+pts.map(p=>p[0].toFixed(1)+','+p[1].toFixed(1)).join(' L');
  let d='M'+pts[0][0].toFixed(1)+','+pts[0][1].toFixed(1);
  for(let i=0;i<pts.length-1;i++){
    const p0=pts[i-1]||pts[i],p1=pts[i],p2=pts[i+1],p3=pts[i+2]||p2;
    const c1x=p1[0]+(p2[0]-p0[0])/6,c1y=p1[1]+(p2[1]-p0[1])/6;
    const c2x=p2[0]-(p3[0]-p1[0])/6,c2y=p2[1]-(p3[1]-p1[1])/6;
    d+=' C'+c1x.toFixed(1)+','+c1y.toFixed(1)+' '+c2x.toFixed(1)+','+c2y.toFixed(1)+' '+p2[0].toFixed(1)+','+p2[1].toFixed(1);
  }
  return d;
}
function buildSparkline(){
  const el=document.getElementById('cbMiniChart'); if(!el||!DATA||!DATA.technicals||!DATA.technicals.chart_data) return;
  const closes=DATA.technicals.chart_data.map(d=>d.close).filter(v=>v!=null&&!isNaN(v));
  const data=closes.slice(-22); if(data.length<2) return;
  // Render at the real container width so the geometry isn't horizontally
  // stretched (keeps the end dot a circle, the curve proportional).
  const W=Math.max(180,Math.round(el.clientWidth||290)),H=64,pad=8;
  const min=Math.min(...data),max=Math.max(...data);
  const x=i=>pad+i*(W-2*pad)/(data.length-1);
  const y=v=>pad+(1-(v-min)/(max-min||1))*(H-2*pad);
  const pts=data.map((v,i)=>[x(i),y(v)]);
  const line=smoothPath(pts);
  const lastx=x(data.length-1),lasty=y(data[data.length-1]);
  const area=line+' L'+lastx.toFixed(1)+','+H+' L'+x(0).toFixed(1)+','+H+' Z';
  const down=data[data.length-1]<data[0];
  const col=down?'var(--red)':'var(--green)',fill=down?'var(--red-tint)':'var(--green-tint)';
  const chgPct=data[0]?((data[data.length-1]-data[0])/data[0]*100):0;
  const chgEl=document.getElementById('cbSparkChg'); if(chgEl){chgEl.textContent=(chgPct>=0?'+':'')+chgPct.toFixed(1)+'%';chgEl.style.color=col;}
  el.innerHTML='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:'+H+'px;display:block;">'+
    '<path class="spark-area" d="'+area+'" fill="'+fill+'"/>'+
    '<path class="spark-line" pathLength="1" d="'+line+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>'+
    '<circle class="spark-dot" cx="'+lastx.toFixed(1)+'" cy="'+lasty.toFixed(1)+'" r="3" fill="'+col+'"/></svg>';
  const tip=document.createElement('div');tip.className='spk-tip';el.appendChild(tip);
  const dot=document.createElement('div');dot.className='spk-dot2';el.appendChild(dot);
  el.onmousemove=ev=>{const r=el.getBoundingClientRect();const idx=Math.max(0,Math.min(data.length-1,Math.round((ev.clientX-r.left)/r.width*(data.length-1))));const px=idx/(data.length-1)*r.width;const py=(1-(data[idx]-min)/(max-min||1))*H;tip.textContent='$'+data[idx].toFixed(2);tip.style.left=px+'px';tip.style.opacity=1;dot.style.left=px+'px';dot.style.top=py+'px';dot.style.opacity=1;};
  el.onmouseleave=()=>{tip.style.opacity=0;dot.style.opacity=0;};
}
let _sparkRz=null;
addEventListener('resize',()=>{clearTimeout(_sparkRz);_sparkRz=setTimeout(()=>{if(DATA&&activeTab&&!activeTab.loading&&_miniMode==='svg')buildSparkline();},160);});
// LIVE price ticks: poll the backend for the real last trade and update the
// price + change pill in place. Only runs while a US session is live (regular,
// pre, or after hours); when the market is closed there are no ticks and the
// price stays frozen at its last value. No simulated drift, ever.
function isLiveSession(){const s=clockSession();return s==='open'||s==='pre'||s==='after';}
let _quoteBusy=false;
async function priceTick(){
  if(!DATA||!DATA.ticker) return;        // nothing loaded yet
  if(!isLiveSession()) return;           // market closed → no ticks
  if(_quoteBusy) return;                 // don't stack overlapping requests
  const tk=DATA.ticker; _quoteBusy=true;
  try{
    const r=await fetch(`${API_BASE}/quote/${encodeURIComponent(tk)}`);
    if(!r.ok) return;
    const q=await r.json();
    if(!DATA||DATA.ticker!==tk) return;  // user switched tabs mid-request
    if(q&&q.price!=null) applyLiveQuote(q);
  }catch(e){}
  finally{ _quoteBusy=false; }
}
// Push a fresh real quote into the company bar (price number + change pill) and
// the in-memory DATA so Numa's context stays current. Flashes on a real change.
function applyLiveQuote(q){
  const price=q.price;
  const prevShown=TICK_PRICE||((DATA.quote&&DATA.quote.price)||price);
  const chg=q.change!=null?q.change:(DATA.quote&&DATA.quote.prev_close?+(price-DATA.quote.prev_close).toFixed(2):(DATA.quote?DATA.quote.change:0));
  const chgPct=q.change_pct!=null?q.change_pct:(DATA.quote?DATA.quote.change_pct:0);
  if(DATA.quote){ DATA.quote.price=price; DATA.quote.change=chg; DATA.quote.change_pct=chgPct; if(q.prev_close!=null)DATA.quote.prev_close=q.prev_close; }
  TICK_PRICE=price;
  const el=document.getElementById('cbPrice');
  if(el){
    const moved=Math.abs(price-prevShown)>=0.005;
    el.textContent=fmtPrice(price);   // cents + separators so live ticks are visible (fmt() rounds ≥100 to whole)
    el.classList.remove('flash-up','flash-down'); void el.offsetWidth;
    if(moved){ el.classList.add(price>=prevShown?'flash-up':'flash-down'); setTimeout(()=>el.classList.remove('flash-up','flash-down'),520); }
  }
  const ce=document.getElementById('cbChange');
  if(ce){ const up=chg>=0; ce.className='cb-change '+(up?'pos':'neg'); ce.innerHTML=`${up?'▲':'▼'} ${up?'+':''}${fmt(chg)} (${up?'+':''}${fmt(chgPct)}%)`; }
}

/* ============ ANALYZE FLOW ============ */
// Full-area loading view with a 0→100% progress ring. While loading we add
// body.loading, which hides the (stale) company bar so the whole lower
// region reads as one cohesive loading state.
const _LOADC=2*Math.PI*54;
function renderLoading(ticker){
  resetLoadFX();
  document.body.classList.add('loading');
  document.body.classList.remove('on-landing');
  document.body.classList.remove('has-ticker');   // hide the section nav while data is still loading
  document.getElementById('content').innerHTML=`
    <div class="loadwrap">
      <div class="loadfx" id="loadFx"></div>
      <div class="loadring" id="loadRing">
        <svg viewBox="0 0 120 120"><circle class="lr-bg" cx="60" cy="60" r="54"/><circle class="lr-fg" id="loadFg" cx="60" cy="60" r="54" stroke-dasharray="${_LOADC}" stroke-dashoffset="${_LOADC}"/></svg>
        <div class="lr-center"><span class="lrv-ic">${VEST}</span><span class="lr-pct" id="loadPct">0%</span></div>
      </div>
      <div class="loadtick"><span class="loadtick-cur">$</span>${ticker}</div>
      <div class="loaddeck">
        <div class="loadcard">
          <div class="lc-grip"></div>
          <div class="lc-row lc-anim" id="loadRow">
            <div class="lc-icon" id="loadIcon">📡</div>
            <div class="lc-meta">
              <div class="lc-title" id="loadTitle">Connecting…</div>
              <div class="lc-sub" id="loadSub">Opening data stream</div>
            </div>
            <div class="lc-spin"></div>
          </div>
        </div>
      </div>
    </div>`;
  buildLoadFX();
}
// Morph the landing "Numa" vest into the loading ring: fly the vest from its lockup
// position to the ring's center while the ring grows in around it. (FLIP overlay.)
// The flying clone lives on <body>, so the ring's progress-circle rotation never
// touches it, and the vest stays upright the whole way in.
function flipVestIntoRing(src){
  if(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const ring=document.getElementById('loadRing'); const dstEl=ring&&ring.querySelector('.lrv-ic'); if(!ring||!dstEl) return;
  const d=dstEl.getBoundingClientRect(); if(!d.width) return;
  ring.classList.add('forming'); dstEl.style.opacity='0';
  const o=document.createElement('div'); o.className='vest-fly'; o.innerHTML=VEST;
  o.style.cssText='position:fixed;left:0;top:0;width:'+src.width+'px;height:'+src.height+'px;color:var(--accent);z-index:200;pointer-events:none;transform-origin:top left;transform:translate('+src.left+'px,'+src.top+'px);';
  document.body.appendChild(o);
  requestAnimationFrame(()=>requestAnimationFrame(()=>{
    o.style.transition='transform .52s cubic-bezier(.5,0,.18,1)';
    o.style.transform='translate('+d.left+'px,'+d.top+'px) scale('+(d.width/src.width)+')';
    ring.classList.remove('forming');
  }));
  setTimeout(()=>{ try{dstEl.style.opacity='';}catch(e){} if(o.parentNode)o.parentNode.removeChild(o); },580);
}

/* ambient data-ingestion field: scrolling source feeds flanking the loader */
function lxMarket(tk){return [
  `${tk} <b>134.22</b> <span class="up">▲0.74%</span>`,
  `VWAP <b>133.18</b>`,
  `VOL <b>38.4M</b> / 52.1M`,
  `BID 134.20 × ASK 134.24`,
  `OPT C140 IV <b>.51</b> OI 12,480`,
  `OPT P125 IV .58 OI 8,210`,
  `DARK · $24.6M @134.18`,
  `RSI <b>61.4</b> · MACD <span class="up">+</span>`,
  `SMA20 131.4 · SMA50 128.9`,
  `RANGE 129.80 – 135.02`,
  `52W <b>140.76</b> / 39.23`,
  `BETA 1.74 · ATR 4.12`,
  `${tk} <b>134.31</b> <span class="up">▲0.81%</span>`,
  `FLOW C/P <b>1.84</b>`,
  `GEX <span class="up">+2.1B</span>`,
  `MKT CAP <b>3.29T</b>`,
];}
function lxFilings(tk){return [
  `SEC 4 · CEO <span class="up">BUY</span> +9,400`,
  `SEC 4 · DIR <span class="dn">SELL</span> −2,100`,
  `10-Q FY24 Q3 · filed`,
  `8-K · item 2.02`,
  `NEWS · "guidance raised"`,
  `NEWS · downgrade @ 130`,
  `ERN Q3 · Nov 19 · est <b>0.74</b>`,
  `BEAT rate <b>88%</b>`,
  `CONGRESS · P.Buy 50–100K`,
  `13F · +1.2M sh (Q2)`,
  `FRED 10Y <b>4.21%</b> <span class="up">▲3bp</span>`,
  `FRED 2Y 4.62%`,
  `CPI 3.1% YoY`,
  `VIX <b>13.8</b> <span class="dn">▼0.4</span>`,
  `INSIDER net <span class="dn">−$1.4M</span>`,
  `PEERS AMD 142 · AVGO 1.6k`,
];}
function railStream(lines){const blk=lines.map(l=>`<div class="lx-tape">${l}</div>`).join('');return `<div class="lx-stream">${blk}${blk}</div>`;}
function buildLoadFX(){
  const fx=document.getElementById('loadFx'); if(!fx) return;
  const tk=(((document.querySelector('.loadtick')||{}).textContent)||'NVDA').replace(/[^A-Z]/g,'')||'NVDA';
  fx.innerHTML=
    `<div class="lx-rail left"><div class="lx-railhdr">MARKET FEED</div><div class="lx-railclip">${railStream(lxMarket(tk))}</div></div>`+
    `<div class="lx-rail right"><div class="lx-railhdr">FILINGS · MACRO</div><div class="lx-railclip">${railStream(lxFilings(tk))}</div></div>`;
}
function resetLoadFX(){}
function setActiveChip(){}

// Per-module card content shown during loading (icon + title + sub).
const LOAD_MODULES={
  'Quote & Profile':{icon:'🏢',sub:'Company snapshot'},
  'Financials':{icon:'💰',sub:'Income · balance · cash'},
  'Technicals':{icon:'📈',sub:'Indicators · key levels'},
  'Options Chain':{icon:'🎯',sub:'Flow · unusual activity'},
  'Insider Filings':{icon:'🧾',sub:'SEC Form 4 activity'},
  'News':{icon:'📰',sub:'Headlines · sentiment'},
  'Peer Comparison':{icon:'⚖️',sub:'Relative multiples'},
  'Earnings':{icon:'📅',sub:'History · estimates'},
  'Dark Pool':{icon:'🌑',sub:'Off-exchange prints'},
  'Gamma Exposure':{icon:'⚡',sub:'Dealer positioning'},
  'Congress':{icon:'🏛️',sub:'Disclosures'},
};
const LC_CHECK='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
// Build a fresh front card for a module (spinner = still loading).
function loadCardEl(label){
  const m=LOAD_MODULES[label]||{icon:'📡',sub:'Loading…'};
  const card=document.createElement('div');
  card.className='loadcard lc-enter';
  card.innerHTML=`<div class="lc-grip"></div><div class="lc-row"><div class="lc-icon">${m.icon}</div><div class="lc-meta"><div class="lc-title">${label}</div><div class="lc-sub">${m.sub}</div></div><div class="lc-spin"></div></div>`;
  return card;
}
// Deck advance: mark the current card done (✓) and recede it into the stack,
// then pop a new card up to the front for the next module.
function setLoadingModule(label){
  const deck=document.querySelector('.loaddeck');if(!deck)return;
  const cur=deck.querySelector('.loadcard:not(.lc-exit)');
  if(cur){
    const sp=cur.querySelector('.lc-spin'); if(sp){sp.classList.remove('lc-spin');sp.classList.add('lc-done');sp.innerHTML=LC_CHECK;}
    cur.classList.remove('lc-enter');cur.classList.add('lc-exit');
    const old=cur; setTimeout(()=>{ if(old&&old.parentNode) old.parentNode.removeChild(old); },440);
  }
  deck.appendChild(loadCardEl(label));
  setActiveChip(label);
}
function setLoadingProgress(pct){pct=Math.max(0,Math.min(100,pct));const fg=document.getElementById('loadFg'),t=document.getElementById('loadPct');if(fg)fg.style.strokeDashoffset=String(_LOADC*(1-pct/100));if(t)t.textContent=Math.round(pct)+'%';}
function endLoading(){document.body.classList.remove('loading');}

// Assemble DATA from the SSE stream. Used as a fallback when GET /analyze
// fails (the stream serializes with default=str, so it survives data the
// plain endpoint can't JSON-encode). Frontend-only — main.py is untouched.
// onProgress(pct) is driven by real per-module completion events.
async function streamAnalyze(ticker,mode,onProgress){
  const res=await fetch(`${API_BASE}/analyze/stream/${ticker}?mode=${mode}`);
  if(!res.ok||!res.body) throw new Error('stream unavailable');
  const out={ticker,mode,company:null,quote:null,financials:null,technicals:null,options_flow:null,insider_activity:null,news_sentiment:null,peers:null,earnings:null,analyst_ratings:null,dark_pool:null,gamma_exposure:null,congressional_trades:null,error:null};
  const total=mode==='premium'?13:10; let nDone=0;
  const reader=res.body.getReader(),dec=new TextDecoder();let buf='';
  while(true){const {done:rdone,value}=await reader.read();if(rdone)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.startsWith('data:'))continue;let p=line.slice(5).trim();if(!p||p==='[DONE]')continue;p=p.replace(/\b-?Infinity\b/g,'null').replace(/\bNaN\b/g,'null');let j;try{j=JSON.parse(p);}catch(e){continue;}
    if(j.status==='fetching'&&j.label){setLoadingModule(j.label);}
    else if(j.status==='error'){out.error=j.error;}
    else if(j.module&&j.status==='done'){out[j.module]=j.data;nDone++;if(onProgress)onProgress(Math.min(99,nDone/total*100));}
  }}
  const b=v=>v==='True'?true:v==='False'?false:(v===true||v===false?v:null);
  if(out.technicals&&typeof out.technicals.golden_cross==='string')out.technicals.golden_cross=b(out.technicals.golden_cross);
  if(out.earnings&&Array.isArray(out.earnings.history))out.earnings.history.forEach(h=>{if(typeof h.beat==='string')h.beat=b(h.beat);});
  return out;
}
/* ============ TICKER TABS (Chrome-style) ============ */
let TABS=[], activeTab=null, _tabSeq=0;
const OFFLINE_HTML=`<div class="empty"><h3>Backend offline</h3><p>Run: <span class="mono" style="color:var(--accent-2);">uvicorn main:app --reload --port 8000</span></p><button class="askbtn" data-demo style="margin-top:16px;cursor:pointer;">▶ Preview loading animation</button></div>`;
/* ---- preview-only: simulate the loading sequence so the ingestion field can be seen without a backend ---- */
let _demoT=null;
function playLoadDemo(ticker){
  ticker=(ticker||(document.getElementById('tickerInput')||{}).value||'NVDA').toUpperCase();
  clearTimeout(_demoT);
  renderLoading(ticker); setLoadingProgress(0);
  const seq=['Quote & Profile','Financials','Technicals','Options Chain','Insider Filings','News','Peer Comparison','Earnings','Congress'];
  let i=0;
  function step(){
    if(i>=seq.length){ setLoadingProgress(100); _demoT=setTimeout(()=>{ endLoading(); const c=document.getElementById('content'); if(c) c.innerHTML=OFFLINE_HTML; }, 750); return; }
    setLoadingModule(seq[i]); setLoadingProgress(Math.round((i+1)/seq.length*96));
    i++; _demoT=setTimeout(step, 760);
  }
  _demoT=setTimeout(step, 650);
}
document.addEventListener('click',e=>{ if(e.target.closest('[data-demo]')){ e.preventDefault(); playLoadDemo(); } });
function newTab(ticker){const t={id:++_tabSeq,ticker:ticker||null,mode:PREMIUM_MODE?'premium':'free',data:null,numaHistory:[],section:'overview',scrollTop:0,loading:false,error:null,seq:0};TABS.push(t);return t;}
function renderTabs(){
  const bar=document.getElementById('tabGroup'); if(!bar) return;
  bar.innerHTML=TABS.map(t=>{
    let lead='';
    if(t.loading) lead='<span class="tab-spin"></span>';
    else if(t.data&&t.data.quote){const up=(t.data.quote.change||0)>=0;lead=`<span class="tab-dot" style="background:${up?'var(--green)':'var(--red)'};"></span>`;}
    const label=t.ticker?`<span class="tab-cur">$</span>${t.ticker}`:'New Tab';
    return `<div class="tab${t===activeTab?' active':''}" data-tab="${t.id}">${lead}<span class="tab-tk">${label}</span><span class="tab-x" data-tabx="${t.id}">×</span></div>`;
  }).join('')+`<button class="tab-add" id="tabAdd" title="New ticker tab">+</button>`;
  buildTape();
}
// Always-on scrolling market tape ($SYM price ▲/▼ %). Showcases YOUR favorites
// (indexes + stocks) with live prices, refreshed periodically; whichever ticker is
// currently analyzed merges in with its freshest quote.
let TAPE_QUOTES={};   // sym -> {p, c} from the live /quotes batch
function tapeSymbols(){
  const f=getFavs(); const seen=new Set(), out=[];
  [...(f.indexes||[]),...(f.stocks||[])].forEach(s=>{ s=(s||'').toUpperCase(); if(s&&!seen.has(s)){seen.add(s);out.push(s);} });
  return out;
}
function tapeLabel(s){ return FAV_LABEL[s]||s.replace(/^\^/,''); }   // friendly index names, no caret
function tapeFmt(p){return p>=1000?p.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):p.toFixed(2);}
function tapeItem(sym,price,chg){
  if(price==null) return `<span class="tape-item"><span class="ti-sym"><span class="d">$</span>${sym}</span><span class="ti-px" style="color:var(--text-4);">—</span></span>`;
  const up=(chg||0)>=0;
  return `<span class="tape-item"><span class="ti-sym"><span class="d">$</span>${sym}</span><span class="ti-px">${tapeFmt(price)}</span><span class="ti-ch" style="color:${up?'var(--green)':'var(--red)'};">${up?'▲':'▼'}${Math.abs(chg||0).toFixed(2)}%</span></span>`;
}
function tapeAbsorb(quotes){   // pull live prices out of a /quotes response into TAPE_QUOTES
  if(!quotes) return;
  Object.keys(quotes).forEach(s=>{ const d=quotes[s]; if(d&&d.price!=null) TAPE_QUOTES[s.toUpperCase()]={p:d.price,c:(d.change_pct!=null?d.change_pct:(d.change!=null?d.change:0))}; });
}
function buildTape(){
  const track=document.getElementById('tapeTrack'); if(!track) return;
  const syms=tapeSymbols();
  if(!syms.length){ track.innerHTML=''; return; }
  const map=new Map(syms.map(s=>{ const q=TAPE_QUOTES[s]||{}; return [s,{p:(q.p!=null?q.p:null),c:(q.c!=null?q.c:null)}]; }));
  // a ticker that's currently analyzed has the freshest live quote — prefer it
  TABS.filter(t=>t.data&&t.ticker&&t.data.quote).forEach(t=>{ if(!map.has(t.ticker))return; const q=t.data.quote; map.set(t.ticker,{p:(q.price!=null?q.price:map.get(t.ticker).p),c:(q.change_pct!=null?q.change_pct:(q.change!=null?q.change:map.get(t.ticker).c))}); });
  const items=[...map.entries()].map(([s,v])=>tapeItem(tapeLabel(s),v.p,v.c)).join('');
  track.innerHTML=items+items;   // duplicated for a seamless loop
  setTimeout(()=>{ const half=track.scrollWidth/2; if(half>0) track.style.animationDuration=Math.max(16,Math.round(half/70))+'s'; },60);
}
async function refreshTape(){
  const syms=tapeSymbols(); if(!syms.length){ buildTape(); return; }
  try{
    const r=await fetch(`${API_BASE}/quotes?symbols=`+encodeURIComponent(syms.join(',')));
    if(r.ok) tapeAbsorb((await r.json()).quotes);
  }catch(e){}
  buildTape();
}
function getRecents(){ try{return JSON.parse(localStorage.getItem('numai_recents')||'[]');}catch(e){return [];} }
function pushRecent(t){ if(!t)return; let r=getRecents().filter(x=>x!==t); r.unshift(t); r=r.slice(0,8); try{localStorage.setItem('numai_recents',JSON.stringify(r));}catch(e){} }
function goTicker(t){ t=(t||'').trim().toUpperCase(); if(!t)return; const i=document.getElementById('tickerInput'); if(i)i.value=t; analyze(); }

/* ============ TICKER AUTOCOMPLETE ============
   Type a company name OR a partial symbol and get live ticker suggestions
   (backed by /search → Yahoo). One shared dropdown, anchored under the focused
   input. Keyboard: ↑/↓ move, Enter picks the highlighted match, Esc closes.
   If the backend is offline the dropdown just stays empty and Enter falls back
   to the existing "analyze whatever was typed" behavior. */
let _tacPop=null,_tacInput=null,_tacOnPick=null,_tacItems=[],_tacIdx=-1,_tacSeq=0,_tacTimer=null;
const _tacCache=new Map();   // query(lower) -> results, so re-typing/backspacing is instant (no refetch)
const _tacEsc=s=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function _tacEl(){
  if(_tacPop) return _tacPop;
  _tacPop=document.createElement('div'); _tacPop.className='tac-pop'; _tacPop.id='tickerAC';
  document.body.appendChild(_tacPop);
  // mousedown (not click) so the input's blur handler doesn't close us first.
  _tacPop.addEventListener('mousedown',e=>{ const it=e.target.closest('.tac-item'); if(!it)return; e.preventDefault(); _tacChoose(+it.dataset.i); });
  return _tacPop;
}
function _tacPlace(){ if(!_tacInput||!_tacPop)return; const r=_tacInput.getBoundingClientRect(); _tacPop.style.left=r.left+'px'; _tacPop.style.top=(r.bottom+6)+'px'; _tacPop.style.width=Math.max(r.width,290)+'px'; }
function _tacClose(){ _tacSeq++; _tacItems=[]; _tacIdx=-1; if(_tacPop){ _tacPop.classList.remove('show'); _tacPop.innerHTML=''; } }
function _tacRender(){
  const pop=_tacEl();
  if(!_tacItems.length){ _tacClose(); return; }
  pop.innerHTML=_tacItems.map((x,i)=>{
    const badge=x.exchange||x.type||'';
    return `<div class="tac-item${i===_tacIdx?' active':''}" data-i="${i}">`
      +`<span class="tac-sym">${_tacEsc(x.symbol)}</span>`
      +`<span class="tac-name">${_tacEsc(x.name||'')}</span>`
      +(badge?`<span class="tac-badge">${_tacEsc(badge)}</span>`:'')+`</div>`;
  }).join('');
  _tacPlace(); pop.classList.add('show');
}
function _tacChoose(i){ const x=_tacItems[i]; if(!x)return; const cb=_tacOnPick; if(_tacInput)_tacInput.value=x.symbol; _tacClose(); if(cb)cb(x.symbol); }
async function _tacFetch(q){
  const key=q.toLowerCase();
  const hit=_tacCache.get(key);
  if(hit){ if(_tacInput===document.activeElement){ _tacItems=hit; _tacIdx=hit.length?0:-1; _tacRender(); } return; }
  const myseq=++_tacSeq;
  try{
    const r=await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}&limit=8`);
    if(!r.ok) throw 0;
    const d=await r.json();
    const results=d.results||[];
    _tacCache.set(key,results);   // remember for instant replays
    if(myseq!==_tacSeq||_tacInput!==document.activeElement) return;   // superseded keystroke / focus moved
    _tacItems=results; _tacIdx=_tacItems.length?0:-1; _tacRender();
  }catch(e){ if(myseq===_tacSeq)_tacClose(); }
}
// Must be attached BEFORE the existing Enter→analyze listener on the same element
// so stopImmediatePropagation() here can pre-empt it when a suggestion is
// highlighted (same-element listeners fire in registration order, not by phase).
function attachTickerSearch(input,onPick){
  if(!input||input._tacBound) return; input._tacBound=true;
  input.setAttribute('autocomplete','off'); input.setAttribute('spellcheck','false');
  input.addEventListener('input',()=>{
    _tacInput=input; _tacOnPick=onPick;
    const q=(input.value||'').trim();
    clearTimeout(_tacTimer);
    if(!q){ _tacClose(); return; }
    const hit=_tacCache.get(q.toLowerCase());
    if(hit){ _tacItems=hit; _tacIdx=hit.length?0:-1; _tacRender(); return; }   // cached → show instantly, no debounce/fetch
    _tacTimer=setTimeout(()=>_tacFetch(q),70);
  });
  input.addEventListener('keydown',e=>{
    const open=_tacPop&&_tacPop.classList.contains('show')&&_tacItems.length;
    if(e.key==='ArrowDown'){ if(open){ e.preventDefault(); _tacIdx=(_tacIdx+1)%_tacItems.length; _tacRender(); } }
    else if(e.key==='ArrowUp'){ if(open){ e.preventDefault(); _tacIdx=(_tacIdx-1+_tacItems.length)%_tacItems.length; _tacRender(); } }
    else if(e.key==='Enter'){ if(open&&_tacIdx>=0){ e.preventDefault(); e.stopImmediatePropagation(); _tacChoose(_tacIdx); } }
    else if(e.key==='Escape'){ if(open){ e.stopImmediatePropagation(); _tacClose(); } }
  });
  input.addEventListener('focus',()=>{ _tacInput=input; _tacOnPick=onPick; });
  input.addEventListener('blur',()=>{ setTimeout(()=>{ if(_tacInput===input)_tacClose(); },120); });
}
window.addEventListener('scroll',()=>{ if(_tacPop&&_tacPop.classList.contains('show'))_tacPlace(); },true);
window.addEventListener('resize',()=>{ if(_tacPop&&_tacPop.classList.contains('show'))_tacPlace(); });
/* ===== FAVORITES — two curated groups (Indexes & Stocks), each with a + to add via mini-search.
   Pre-seeded with sensible defaults; persisted in localStorage. ===== */
const STAR_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
// Friendly chip labels for index symbols that aren't self-explanatory.
const FAV_LABEL={'^IXIC':'NASDAQ','^DJI':'DJI','^GSPC':'S&P 500','^RUT':'RUSSELL','^VIX':'VIX','^NDX':'NASDAQ 100'};
// Full company/fund names shown next to the ticker (instant for known symbols; the
// /quotes batch fills in any the user adds that aren't listed here).
const SYM_NAME={
  'QQQ':'Invesco QQQ Trust','^IXIC':'Nasdaq Composite','SPY':'SPDR S&P 500 ETF','^DJI':'Dow Jones Industrial','DIA':'SPDR Dow Jones ETF','IWM':'iShares Russell 2000','^GSPC':'S&P 500 Index','^RUT':'Russell 2000','^VIX':'CBOE Volatility','^NDX':'Nasdaq 100',
  'NVDA':'NVIDIA Corporation','TSLA':'Tesla, Inc.','AAPL':'Apple Inc.','MSFT':'Microsoft Corp.','GOOGL':'Alphabet Inc.','GOOG':'Alphabet Inc.','AMZN':'Amazon.com, Inc.','META':'Meta Platforms','PLTR':'Palantir Technologies','MU':'Micron Technology','AMD':'Advanced Micro Devices','AVGO':'Broadcom Inc.','TSM':'Taiwan Semiconductor','MRVL':'Marvell Technology','ARM':'Arm Holdings','SMCI':'Super Micro Computer','ASML':'ASML Holding','ORCL':'Oracle Corp.','SNOW':'Snowflake Inc.','CRWD':'CrowdStrike','ANET':'Arista Networks','DELL':'Dell Technologies','SPCX':'SPAC & New Issue ETF',
  'RIVN':'Rivian Automotive','CVNA':'Carvana Co.','COST':'Costco Wholesale','PLUG':'Plug Power','RACE':'Ferrari N.V.','LITE':'Lumentum Holdings','INTC':'Intel Corp.','SOFI':'SoFi Technologies','NFLX':'Netflix, Inc.','UBER':'Uber Technologies','COIN':'Coinbase Global','SHOP':'Shopify Inc.'
};
const FAV_DEFAULTS={
  indexes:['QQQ','^IXIC','SPY','^DJI'],
  stocks:['NVDA','TSLA','AAPL','MSFT','GOOGL','AMZN','META','PLTR','MU','AMD','AVGO','TSM','MRVL','ARM','SMCI','ASML','ORCL','SNOW','CRWD','ANET','DELL','SPCX']
};
const FAV_KEY='numa_favs';
// Used by the company-bar star (no section context) to pick a bucket automatically.
const INDEX_SYMS=new Set(['SPY','QQQ','DIA','IWM','VOO','VTI','RSP','SOXX','SMH','XLK','XLF','XLE','XLV','GLD','SLV','TLT','HYG','EEM','EFA','VXX','ARKK','SPX','NDX','DJI','RUT','VIX']);
function isIndexSym(t){ t=(t||'').toUpperCase(); return t.charAt(0)==='^' || INDEX_SYMS.has(t); }
function getFavs(){ try{const o=JSON.parse(localStorage.getItem(FAV_KEY)); if(o&&typeof o==='object'&&Array.isArray(o.indexes)&&Array.isArray(o.stocks)) return {indexes:o.indexes.slice(),stocks:o.stocks.slice()};}catch(e){} return {indexes:FAV_DEFAULTS.indexes.slice(),stocks:FAV_DEFAULTS.stocks.slice()}; }
function setFavs(o){ try{localStorage.setItem(FAV_KEY,JSON.stringify(o));}catch(e){} }
function isFavoriteAny(s){ s=(s||'').toUpperCase(); const f=getFavs(); return f.indexes.indexOf(s)>=0||f.stocks.indexOf(s)>=0; }
function addFavoriteTo(cat,s){ s=(s||'').trim().toUpperCase(); if(!s)return false; if(cat!=='indexes'&&cat!=='stocks')cat='stocks'; const f=getFavs(); if(f.indexes.indexOf(s)>=0||f.stocks.indexOf(s)>=0)return false; f[cat].push(s); setFavs(f); return true; }
function removeFavorite(s){ s=(s||'').toUpperCase(); const f=getFavs(); f.indexes=f.indexes.filter(x=>x!==s); f.stocks=f.stocks.filter(x=>x!==s); setFavs(f); }
function toggleFavoriteAuto(s){ s=(s||'').trim().toUpperCase(); if(!s)return false; if(isFavoriteAny(s)){removeFavorite(s);return false;} addFavoriteTo(isIndexSym(s)?'indexes':'stocks',s); return true; }
let _favAddOpen=null;   // which category's mini-search is currently open
function favAvatarColor(s){ let h=0; s=String(s); for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))%360; return 'hsl('+h+',50%,46%)'; }
function favRow(s){
  const lbl=FAV_LABEL[s]||s; const name=SYM_NAME[s]||'';
  const mono=(lbl.replace(/[^A-Za-z0-9]/g,'').charAt(0)||'?').toUpperCase();
  return `<div class="wl-row" data-lticker="${s}" data-sym="${s}" role="button" tabindex="0">
    <span class="wl-av" style="background:${favAvatarColor(s)}">${mono}</span>
    <span class="wl-mid">
      <span class="wl-l1"><span class="wl-sym">${lbl}</span><span class="wl-last" data-wl="last">—</span></span>
      <span class="wl-l2"><span class="wl-name" data-wl="name">${name}</span><span class="wl-chgp" data-wl="chgp"></span></span>
    </span>
    <button class="wl-rm" data-favrm="${s}" title="Remove ${lbl}" aria-label="Remove ${lbl}">×</button>
  </div>`;
}
function favSectionHTML(cat,label,syms){
  const open=_favAddOpen===cat;
  const rows=syms.length?syms.map(favRow).join(''):'<div class="fav-none">Nothing here yet — tap + to add.</div>';
  return `<div class="landing-section wl-group wl-group-${cat}">
    <div class="fav-head"><span class="landing-label">${label}</span><button class="fav-add ${open?'on':''}" data-favadd="${cat}" title="Add to ${label}" aria-label="Add to ${label}">+</button></div>
    <div class="fav-addrow ${open?'open':''}"><input class="fav-addinput" data-favcat="${cat}" maxlength="40" placeholder="Add a ticker or company to ${label}…" autocomplete="off" spellcheck="false"></div>
    <div class="wl-list">${rows}</div>
  </div>`;
}
function favSectionsHTML(){ const f=getFavs(); return favSectionHTML('indexes','Indexes',f.indexes)+favSectionHTML('stocks','Stocks',f.stocks); }
function renderFavWrap(){ const w=document.getElementById('favWrap'); if(!w)return; w.innerHTML=favSectionsHTML(); wireFavSearch(); if(_favAddOpen){ const inp=w.querySelector('.fav-addinput[data-favcat="'+_favAddOpen+'"]'); if(inp) setTimeout(()=>{try{inp.focus();}catch(e){}},0); } loadWatchlistQuotes(); }
// Give each favorites "add" box the same ticker/company typeahead as the main search,
// but picking a suggestion ADDS it to that section's watchlist instead of analyzing.
function wireFavSearch(){
  document.querySelectorAll('#favWrap .fav-addinput').forEach(inp=>{
    attachTickerSearch(inp,(sym)=>{
      const cat=inp.dataset.favcat;
      if(addFavoriteTo(cat,sym)){ _favAddOpen=cat; renderFavWrap(); toast('★ Added '+sym); }
      else { toast(sym+' is already a favorite'); }
    });
  });
}
// Fill the watchlist's Last / Chg / Chg% (and any missing company names) from one batch call.
async function loadWatchlistQuotes(){
  const w=document.getElementById('favWrap'); if(!w) return;
  const rows=Array.from(w.querySelectorAll('.wl-row')); if(!rows.length) return;
  const syms=rows.map(r=>r.dataset.sym);
  const need=syms.filter(s=>!SYM_NAME[s]);
  try{
    const url=API_BASE+'/quotes?symbols='+encodeURIComponent(syms.join(','))+(need.length?'&names='+encodeURIComponent(need.join(',')):'');
    const r=await fetch(url); if(!r.ok) return;
    const q=(await r.json()).quotes||{};
    rows.forEach(row=>{
      const d=q[row.dataset.sym]; if(!d) return;
      if(d.name && !SYM_NAME[row.dataset.sym]){ SYM_NAME[row.dataset.sym]=d.name; const ne=row.querySelector('[data-wl=name]'); if(ne)ne.textContent=d.name; }
      const last=row.querySelector('[data-wl=last]'), chg=row.querySelector('[data-wl=chg]'), chgp=row.querySelector('[data-wl=chgp]');
      if(last) last.textContent=d.price!=null?fmtPrice(d.price):'—';
      const up=(d.change||0)>=0, cls=up?'wl-up':'wl-down';
      if(chg){ chg.className='wl-chg '+(d.change!=null?cls:''); chg.textContent=d.change!=null?((up?'+':'')+fmt(d.change)):''; }
      if(chgp){ chgp.className='wl-chgp '+(d.change_pct!=null?cls:''); chgp.textContent=d.change_pct!=null?((up?'+':'')+fmt(d.change_pct)+'%'):''; }
    });
    tapeAbsorb(q); buildTape();   // same favorites → feed the live tape from this batch
  }catch(e){}
}
// Front page — also the blank-tab view. Choose what to study instead of auto-loading.
function blankTabView(){
  document.body.classList.remove('has-ticker');   // landing screen → no section nav
  document.body.classList.add('on-landing');      // page itself stays fixed; only the stocks list scrolls
  document.getElementById('companyBar').innerHTML='';
  const ti=document.getElementById('tickerInput'); if(ti)ti.value='';
  document.getElementById('content').innerHTML=`
    <div class="landing">
      <div class="landing-inner">
        <div class="landing-hero">
          <div class="landing-mark"><div class="numa-reveal" role="img" aria-label="Numa"><div class="nr-lockup"><div class="nr-vest"><div class="nr-vest-in">${VEST}</div></div><div class="nr-word"><span>Numa</span></div></div></div></div>
          <h1 class="landing-title">Your own AInalyst.<br>On every ticker, every section, every time.</h1>
          <p class="landing-sub">Technicals · Fundamentals · Options · Insiders · Macro · AI synthesis.</p>
          <div class="landing-search">
            <input id="landingInput" maxlength="40" placeholder="Search a ticker or company — e.g. NVDA or Apple" autocomplete="off" spellcheck="false">
            <button id="landingGo">Analyze</button>
          </div>
        </div>
        <div id="favWrap" class="landing-fav">${favSectionsHTML()}</div>
      </div>
    </div>`;
  const inp=document.getElementById('landingInput');
  if(inp){ setTimeout(()=>{try{inp.focus();}catch(e){}},60); attachTickerSearch(inp,(s)=>goTicker(s)); inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); goTicker(inp.value); } }); }
  const go=document.getElementById('landingGo'); if(go) go.addEventListener('click',()=>goTicker((document.getElementById('landingInput')||{}).value));
  wireFavSearch();         // ticker/company typeahead on the favorites add boxes
  loadWatchlistQuotes();   // fill the watchlist's live Last/Chg/Chg% columns
}
function persistActive(){
  if(!activeTab) return;
  activeTab.section=CURRENT; activeTab.numaHistory=numaHistory;
  if(activeTab.data) activeTab.data=DATA;
  const c=document.getElementById('content'); if(c) activeTab.scrollTop=c.scrollTop;
}
function showTab(t){
  activeTab=t;
  document.body.classList.remove('has-ticker');   // reset; renderCompanyBar re-adds it only for a loaded ticker
  document.getElementById('tickerInput').value=t.ticker||'';
  DATA=t.data; CURRENT=t.section||'overview'; numaHistory=t.numaHistory||[];
  renderTabs();
  if(t.loading){ renderLoading(t.ticker); return; }
  endLoading();
  document.body.classList.remove('on-landing');   // page can scroll again on real views
  if(t.error){ document.getElementById('companyBar').innerHTML=''; document.getElementById('content').innerHTML=`<div class="empty"><h3>Could not load ${t.ticker}</h3><p>${t.error}</p></div>`; return; }
  if(!t.data){ blankTabView(); return; }
  renderCompanyBar(); buildMiniChart();
  TICK_PRICE=(DATA.quote&&DATA.quote.price)||0;
  renderSection(CURRENT); updateChatCtx();
  ensureInsights(t.ticker);   // cached → badge instantly; else generate in background
  const c=document.getElementById('content'); c.scrollTop=t.scrollTop||0; onContentScroll();
}
function switchTab(id){ const t=TABS.find(x=>x.id===id); if(!t||t===activeTab) return; persistActive(); if(document.getElementById('aip').classList.contains('show'))closePanel(); showTab(t); }
function addBlankTab(){ persistActive(); if(document.getElementById('aip').classList.contains('show'))closePanel(); showTab(newTab(null)); document.getElementById('tickerInput').focus(); }
function closeTab(id){
  const i=TABS.findIndex(x=>x.id===id); if(i<0) return;
  const wasActive=TABS[i]===activeTab; TABS.splice(i,1);
  if(!TABS.length){ activeTab=null; showTab(newTab(null)); return; }
  if(wasActive){ activeTab=null; showTab(TABS[Math.min(i,TABS.length-1)]); }
  else renderTabs();
}

/* ============ ANALYZE (targets the active tab) ============ */
async function analyze(){
  const ticker=(document.getElementById('tickerInput').value||'').trim().toUpperCase();
  if(!ticker)return;
  if(!activeTab) activeTab=newTab(ticker);
  const tab=activeTab, mode=PREMIUM_MODE?'premium':'free';
  tab.ticker=ticker; tab.mode=mode; tab.error=null; tab.loading=true;
  const myseq=++tab.seq;
  const active=()=>activeTab===tab&&tab.seq===myseq;
  document.getElementById('tickerInput').value=ticker;
  const btn=document.getElementById('analyzeBtn'); btn.disabled=true;
  // Capture the landing vest's screen position BEFORE renderLoading wipes it, so we
  // can fly it into the loading ring (only present when coming from the landing).
  let _vsrc=null; try{const sv=document.querySelector('.numa-reveal .nr-vest'); if(sv){const r=sv.getBoundingClientRect(); if(r.width>4)_vsrc={left:r.left,top:r.top,width:r.width,height:r.height};}}catch(e){}
  renderTabs(); renderLoading(ticker);
  if(_vsrc) flipVestIntoRing(_vsrc);
  try{
    let res=null;
    try{ res=await streamAnalyze(ticker,mode,p=>{if(active())setLoadingProgress(p);}); }catch(e){ res=null; }
    if(tab.seq!==myseq) return;
    if(!res){ try{const r=await fetch(`${API_BASE}/analyze/${ticker}?mode=${mode}`);if(r.ok)res=await r.json();}catch(e){} }
    if(tab.seq!==myseq) return;
    if(!res){ tab.loading=false; tab.error='Backend offline'; renderTabs(); if(activeTab===tab){endLoading();document.getElementById('companyBar').innerHTML='';document.getElementById('content').innerHTML=OFFLINE_HTML;} return; }
    if(res.error){ tab.loading=false; tab.data=null; tab.error=res.error; renderTabs(); if(activeTab===tab){endLoading();document.getElementById('companyBar').innerHTML='';document.getElementById('content').innerHTML=`<div class="empty"><h3>Could not load ${ticker}</h3><p>${res.error}</p></div>`;} return; }
    tab.data=res; tab.numaHistory=[]; tab.loading=false; tab.error=null;
    if(active()){
      DATA=res; numaHistory=tab.numaHistory;
      setLoadingProgress(100);
      await new Promise(r=>setTimeout(r,320));
      if(active()){
        endLoading();
        HEADER_P=0;   // a freshly loaded ticker starts with the full header expanded
        renderCompanyBar(); buildMiniChart();
        const p=document.getElementById('cbPrice'); if(p&&DATA.quote&&DATA.quote.price!=null)countUp(p,DATA.quote.price,800,v=>fmtPrice(v));
        TICK_PRICE=(DATA.quote&&DATA.quote.price)||0;
        renderSection(CURRENT); updateChatCtx(); onContentScroll();
        if(!TICK_STARTED){TICK_STARTED=true;setTimeout(()=>{priceTick();setInterval(priceTick,5000);},1500);}
        pushRecent(ticker);
        ensureInsights(ticker);   // generate "Numa is watching" in the background now
        toast('Loaded '+ticker);
      }
    }
    renderTabs();
  }catch(e){
    tab.loading=false; tab.error='Backend offline'; renderTabs();
    if(activeTab===tab){endLoading();document.getElementById('companyBar').innerHTML='';document.getElementById('content').innerHTML=OFFLINE_HTML;}
  }finally{ if(activeTab===tab) btn.disabled=false; }
}

/* ============ COLLAPSING HEADER (gesture-driven, independent of content) ============ */
// HEADER_P (0=open, 1=collapsed) is driven ONLY by scroll/swipe gestures over the
// company bar itself. Scrolling the content area below no longer collapses it.
const HEADER_GESTURE_PX=160;   // wheel/swipe distance for a full collapse or expand
function applyHeaderCollapse(p){
  const bar=document.getElementById('companyBar'); if(!bar) return;
  bar.style.paddingTop=(14-7*p)+'px'; bar.style.paddingBottom=(14-7*p)+'px';   // trim vertical dead space when compact
  const about=bar.querySelector('.cb-about'), chart=bar.querySelector('.cb-chart');
  if(about){ about.style.gridTemplateRows=(1-p)+'fr'; about.style.opacity=String(1-p); }
  if(chart){ chart.style.flexGrow=String(1-p); chart.style.flexBasis=((1-p)*320)+'px'; chart.style.maxHeight=((1-p)*500)+'px'; chart.style.marginLeft=((1-p)*24)+'px'; chart.style.paddingLeft=((1-p)*24)+'px'; chart.style.opacity=String(Math.max(0,1-p*1.3)); chart.style.borderLeftWidth=(p>0.04?0:1)+'px'; }
}
// Re-apply the current header state (after a section/tab render). Kept under the
// old name so existing callers stay valid; it no longer reads content scroll.
function onContentScroll(){ applyHeaderCollapse(HEADER_P); }
// Snap the header fully open or fully closed — never rest in between.
function snapHeader(open){ const p=open?0:1; if(p===HEADER_P)return; HEADER_P=p; applyHeaderCollapse(HEADER_P); }
// Scroll/swipe ON the company bar collapses or expands the header (and nothing else).
(function(){
  const bar=document.getElementById('companyBar'); if(!bar) return;
  bar.addEventListener('wheel',e=>{
    if(Math.abs(e.deltaY)<Math.abs(e.deltaX)) return;   // horizontal intent → leave it
    e.preventDefault();                                  // the header owns vertical gestures over itself
    const px=e.deltaMode===1?e.deltaY*16:(e.deltaMode===2?e.deltaY*bar.clientHeight:e.deltaY);
    if(px>1) snapHeader(false);        // slide up → close fully
    else if(px<-1) snapHeader(true);   // slide down → open fully
  },{passive:false});
  let ty=null;
  bar.addEventListener('touchstart',e=>{ ty=e.touches[0].clientY; },{passive:true});
  bar.addEventListener('touchmove',e=>{
    if(ty==null) return;
    const dy=ty-e.touches[0].clientY;                    // swipe up (dy>0) collapses, down expands
    ty=e.touches[0].clientY;
    if((dy>0&&HEADER_P>=1)||(dy<0&&HEADER_P<=0)) return; // at a bound → let the gesture pass through
    e.preventDefault();
    if(dy>1) snapHeader(false);        // swipe up → close fully
    else if(dy<-1) snapHeader(true);   // swipe down → open fully
  },{passive:false});
  bar.addEventListener('touchend',()=>{ ty=null; });
})();

/* ============ EVENT WIRING ============ */
document.addEventListener('click',e=>{
  const sp=document.getElementById('settingsPop'); if(sp&&sp.classList.contains('show')&&!e.target.closest('#settingsPop')&&!e.target.closest('#settingsBtn')) sp.classList.remove('show');
  const np=document.getElementById('numaPop'); if(np&&np.classList.contains('show')&&!e.target.closest('#numaPop')&&!e.target.closest('#numaBubble')) toggleNumaPop(false);
  const nt=e.target.closest('[data-numatab]'); if(nt){const id=+nt.dataset.numatab; if(NUMA_SELECTED.has(id)){ if(NUMA_SELECTED.size>1) NUMA_SELECTED.delete(id); } else NUMA_SELECTED.add(id); renderScope(); renderScopeChips(); updateChatCtx(); showNumaEmpty(); return;}
  const sg=e.target.closest('#numaScopeSeg .nsc-seg-btn'); if(sg){ if(!sg.disabled) setNumaScope(sg.dataset.scope); return;}
  const xs=e.target.closest('.xspark'); if(xs){e.stopPropagation();const host=xs.closest('[data-explain]');if(host)askExplain(host.dataset.explain);return;}
  if(e.target.closest('[data-continuechat]')){promotePopToChat();return;}
  const ni=e.target.closest('[data-insight]'); if(ni){const ins=decodeURIComponent(ni.dataset.insight);askNumaPop('In 2-3 sentences, explain what this observation means and whether it is bullish, bearish or neutral right now: "'+ins+'". Keep it brief — no timeframe breakdown or risk/reward sections. Add one small chart with [[chart:TYPE]] if it genuinely helps.', ins);return;}
  const frm=e.target.closest('[data-favrm]'); if(frm){e.stopPropagation();removeFavorite(frm.dataset.favrm);renderFavWrap();return;}
  const fadd=e.target.closest('[data-favadd]'); if(fadd){e.stopPropagation();const cat=fadd.dataset.favadd;_favAddOpen=(_favAddOpen===cat?null:cat);renderFavWrap();return;}
  const cbf=e.target.closest('[data-cbfav]'); if(cbf){const on=toggleFavoriteAuto(cbf.dataset.cbfav);cbf.classList.toggle('on',on);refreshTape();toast(on?('★ Saved '+cbf.dataset.cbfav):('Removed '+cbf.dataset.cbfav));return;}
  const lt=e.target.closest('[data-lticker]'); if(lt){goTicker(lt.dataset.lticker);return;}
  const go=e.target.closest('[data-goto]'); if(go){renderSection(go.dataset.goto);return;}
  const cq=e.target.closest('.chip-q'); if(cq){askFree(cq.textContent);return;}
  const cp=e.target.closest('[data-copybtn]'); if(cp){const n=cp.closest('.msg.ai');const t=((n&&n._note)?n._note.text:n.querySelector('.mtext, .mtext-out')?.textContent||'').replace(/\*/g,'');if(navigator.clipboard)navigator.clipboard.writeText(t);toast('Copied');return;}
  const sv=e.target.closest('[data-savebtn]'); if(sv){const n=sv.closest('.msg.ai');if(n&&n._note){NOTES.unshift({title:n._note.title,text:n._note.text,icon:n._note.icon,cost:n._note.cost,ticker:DATA?DATA.ticker:'—',time:new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})});updateNotesBadge();persistNotes();const o=sv.innerHTML;sv.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>Saved';sv.style.color='var(--green)';setTimeout(()=>{sv.innerHTML=o;sv.style.color='';},1500);}return;}
  const act=e.target.closest('[data-act]'); if(act){runAction(act.dataset.act,act);return;}
  if(e.target.closest('[data-skilllaunch]')){document.getElementById('skillPop').classList.toggle('show');return;}
  if(e.target.closest('[data-newskill]')){toast('Skill builder — name it, write the prompt, pick inputs');return;}
  const del=e.target.closest('[data-delnote]'); if(del){NOTES.splice(+del.dataset.delnote,1);updateNotesBadge();persistNotes();if(CURRENT==='notes')renderSection('notes');return;}
});
// Favorites mini-search: Enter adds the typed ticker to its section; Escape closes it.
document.addEventListener('keydown',e=>{
  const inp=e.target.closest&&e.target.closest('.fav-addinput'); if(!inp)return;
  if(e.key==='Enter'){ e.preventDefault(); const cat=inp.dataset.favcat, v=(inp.value||'').trim().toUpperCase();
    if(!v)return; if(addFavoriteTo(cat,v)){ _favAddOpen=cat; renderFavWrap(); toast('★ Added '+v); } else { toast(v+' is already a favorite'); inp.select(); } }
  else if(e.key==='Escape'){ _favAddOpen=null; renderFavWrap(); }
});
document.getElementById('aipClose').addEventListener('click',closePanel);
document.getElementById('aipFull').addEventListener('click',()=>toggleNumaFull());
scrim.addEventListener('click',()=>{ if(aip.classList.contains('maxed')) toggleNumaFull(false); else closePanel(); });   // tapping the dim restores from fullscreen, or closes the narrow-screen overlay
document.getElementById('askAi').addEventListener('click',openIsland);
// keep the docked width inside bounds when the window shrinks
addEventListener('resize',()=>{ const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--numa-w'),10); if(w>0) setNumaWidth(w,false); });
document.getElementById('numaBubble').addEventListener('click',e=>{e.stopPropagation();toggleNumaPop();});
document.getElementById('chatSend').addEventListener('click',()=>{const i=document.getElementById('chatInput');askFree(i.value);i.value='';i.style.height='auto';});
document.getElementById('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();const i=e.target;askFree(i.value);i.value='';i.style.height='auto';}});
document.getElementById('chatInput').addEventListener('input',e=>{e.target.style.height='auto';e.target.style.height=Math.min(e.target.scrollHeight,120)+'px';});
document.getElementById('skillClose').addEventListener('click',()=>document.getElementById('skillPop').classList.remove('show'));
document.querySelectorAll('#skillPop .skill-row').forEach(r=>r.addEventListener('click',()=>{document.getElementById('skillPop').classList.remove('show');runAction(r.dataset.skill,null);}));
/* ============ SETTINGS ============ */
function setTheme(t){
  document.documentElement.dataset.theme=t;
  localStorage.setItem('theme',t);
  refreshSettings();
  if(DATA){ renderCompanyBar(); buildMiniChart(); renderSection(CURRENT); onContentScroll(); }
}
function setMode(premium){
  PREMIUM_MODE=premium;
  localStorage.setItem('terminal_mode',premium?'premium':'free');
  refreshSettings();
  if(activeTab&&activeTab.ticker){ document.getElementById('tickerInput').value=activeTab.ticker; analyze(); }
}
function refreshSettings(){
  const th=document.documentElement.dataset.theme||'light';
  document.querySelectorAll('#segTheme button').forEach(b=>b.classList.toggle('on',b.dataset.themeVal===th));
  document.querySelectorAll('#segMode button').forEach(b=>b.classList.toggle('on',(b.dataset.modeVal==='premium')===PREMIUM_MODE));
  const has=!!localStorage.getItem('numa_api_key');
  const ks=document.getElementById('keyStatus'),ka=document.getElementById('keyAction');
  if(ks)ks.textContent=has?'Saved on this device':'Not set';
  if(ka)ka.textContent=has?'Clear':'Set key';
}
document.getElementById('settingsBtn').addEventListener('click',()=>{const p=document.getElementById('settingsPop');const show=!p.classList.contains('show');p.classList.toggle('show',show);if(show)refreshSettings();});
document.getElementById('settingsClose').addEventListener('click',()=>document.getElementById('settingsPop').classList.remove('show'));
document.getElementById('segTheme').addEventListener('click',e=>{const b=e.target.closest('[data-theme-val]');if(b)setTheme(b.dataset.themeVal);});
document.getElementById('segMode').addEventListener('click',e=>{const b=e.target.closest('[data-mode-val]');if(b)setMode(b.dataset.modeVal==='premium');});
document.getElementById('keyAction').addEventListener('click',()=>{if(localStorage.getItem('numa_api_key')){localStorage.removeItem('numa_api_key');toast('API key cleared');refreshSettings();}else{document.getElementById('settingsPop').classList.remove('show');openIsland();showKeyPrompt(null,{});}});
document.getElementById('analyzeBtn').addEventListener('click',analyze);
const _tin=document.getElementById('tickerInput');
attachTickerSearch(_tin,()=>analyze());   // before the Enter→analyze handler below, so a highlighted suggestion wins
_tin.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();analyze();}});
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();_tin.focus();_tin.select();}
  else if(e.key==='Escape'){if(aip.classList.contains('show')){closePanel();}else if(document.activeElement===_tin){_tin.blur();}}
});

/* ============ BOOT ============ */
refreshSettings();
setInterval(updateMarketStatus,30000);
refreshTape();                       // live prices for the favorites tape on boot
setInterval(refreshTape,45000);      // keep the tape's prices fresh
// Tab bar interactions
document.getElementById('tabbar').addEventListener('click',e=>{
  const x=e.target.closest('[data-tabx]'); if(x){e.stopPropagation();closeTab(+x.dataset.tabx);return;}
  if(e.target.closest('#tabAdd')){addBlankTab();return;}
  const tb=e.target.closest('[data-tab]'); if(tb){switchTab(+tb.dataset.tab);return;}
});
// (Header collapse is now driven by gestures on the company bar, not content scroll.)
window.addEventListener('load',()=>{ loadNotesFromDisk(); activeTab=newTab(null); renderTabs(); showTab(activeTab); });

// Register service worker for PWA support.
// Auto-reload when a NEW service worker takes control (i.e. an update shipped),
// so frontend changes appear on the next reload without a manual hard-reload /
// unregister. The hadController guard skips the very first install (no reload
// loop, no double-load on first visit).
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let _swReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (_swReloaded) return; _swReloaded = true;
    if (hadController) window.location.reload();
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => { try { reg.update(); } catch (e) {} console.log('SW registered:', reg.scope); })
      .catch(err => console.warn('SW registration failed:', err));
  });
}
