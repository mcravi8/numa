/* ============ NUMA — context-aware AI chat (real Claude streaming) ============ */
const aip=document.getElementById('aip'), scrim=document.getElementById('aipScrim'), thread=document.getElementById('thread');
let NUMA_MODE='island';          // single docked panel ("island" kept as the internal name); "watching" lives in the bottom-right bubble
let NUMA_SCOPE='whole';          // 'section' = just the section on screen | 'whole' = the whole ticker (all sections). Resets to 'whole' on open.
let NUMA_SEEN={};                // per-ticker: has the user opened the watching popover yet (stops the pulse)
let NUMA_SELECTED=new Set();     // tab ids included in the conversation
function islandTabs(){ const sel=TABS.filter(t=>t.data&&t.ticker&&NUMA_SELECTED.has(t.id)); return sel.length?sel:(activeTab&&activeTab.data?[activeTab]:TABS.filter(t=>t.data&&t.ticker)); }
// ----- docked panel width (resizable, persisted) -----
const NUMA_W_MIN=360, NUMA_W_KEY='numa_w';
function numaWMax(){ return Math.min(1000, Math.round(window.innerWidth*0.8)); }
function setNumaWidth(px,persist){
  const w=Math.max(NUMA_W_MIN, Math.min(numaWMax(), Math.round(px)));
  document.documentElement.style.setProperty('--numa-w', w+'px');
  if(persist){ try{ localStorage.setItem(NUMA_W_KEY, String(w)); }catch(e){} }
  return w;
}
(function initNumaWidth(){ const s=parseInt(localStorage.getItem(NUMA_W_KEY),10); if(s>0) document.documentElement.style.setProperty('--numa-w', Math.max(NUMA_W_MIN,Math.min(1000,s))+'px'); })();
// Drag the left edge to resize the panel; the page reflows live (split view).
(function wireNumaResize(){
  const grip=document.getElementById('aipGrip'); if(!grip) return;
  let dragging=false;
  grip.addEventListener('pointerdown',e=>{ if(aip.classList.contains('maxed'))return; dragging=true; document.body.classList.add('numa-resizing'); grip.setPointerCapture(e.pointerId); e.preventDefault(); });
  grip.addEventListener('pointermove',e=>{ if(!dragging)return; setNumaWidth(window.innerWidth-e.clientX, false); });
  const end=e=>{ if(!dragging)return; dragging=false; document.body.classList.remove('numa-resizing'); const w=parseInt(getComputedStyle(document.documentElement).getPropertyValue('--numa-w'),10); setNumaWidth(w,true); window.dispatchEvent(new Event('resize')); };
  grip.addEventListener('pointerup',end); grip.addEventListener('pointercancel',end);
})();
// Fullscreen toggle: expand to a wide overlay (stops pushing, dims the page) and back to docked.
function toggleNumaFull(on){
  const want = on!=null ? on : !aip.classList.contains('maxed');
  aip.classList.toggle('maxed', want);
  document.body.classList.toggle('numa-maxed', want);
  document.body.classList.toggle('numa-open', !want);   // docked pushes; maxed overlays
  scrim.classList.toggle('show', want);
  setTimeout(()=>window.dispatchEvent(new Event('resize')),360);
}
const CTXNAMES={overview:'Overview',chart:'Chart',options:'Options Flow',insider:'Insider',news:'News',peers:'Peers',earnings:'Earnings',congress:'Congress',macro:'Macro',skills:'Skills',notes:'Notes'};
const SECTION_CHIPS={
  overview:["What's the bull case?","What's the key risk?","Is this expensive?"],
  chart:["What pattern is this?","Where's my stop?","Do signals agree?"],
  options:["What does the flow say?","Any unusual prints?","Where's max pain?"],
  insider:["What are insiders signalling?","Is CEO selling unusual?"],
  news:["What's the dominant narrative?","Any catalysts ahead?"],
  peers:["Is this cheap vs peers?","Who's winning the group?"],
  earnings:["What's the implied move?","Is the setup bullish?"],
  congress:["How to read the filings?"],
  macro:["Is this a good rate environment?","Where is money rotating?","What's the DCF read?"],
  skills:["What skills should I run?"],
  notes:["Summarize my saved notes"],
};
function updateChatCtx(){
  const e=document.getElementById('chatCtx'),h=document.getElementById('chatHint');
  const names=islandTabs().map(t=>t.ticker).join(' + ')||(DATA?DATA.ticker:'—');
  if(NUMA_SCOPE==='whole'){
    if(e)e.textContent=names+' · all sections';
    if(h)h.textContent='Numa sees the full 360° data for '+names;
  }else{
    if(e)e.textContent=names+' · '+(CTXNAMES[CURRENT]||'Overview');
    if(h)h.textContent='Numa sees the '+(CTXNAMES[CURRENT]||'Overview')+' data for '+names+' · ~$0.01–0.03 per answer';
  }
}
// SCOPE BAR — pick which open tickers Numa considers (single or several) + Section vs Whole-ticker breadth.
function renderScope(){
  const bar=document.getElementById('numaScope'), box=document.getElementById('numaTabSelect'); if(!bar||!box) return;
  const tabs=TABS.filter(t=>t.data&&t.ticker);
  if(!tabs.length){ bar.style.display='none'; box.innerHTML=''; return; }
  bar.style.display='flex';
  box.innerHTML=tabs.map(t=>`<button class="nts-chip${NUMA_SELECTED.has(t.id)?' on':''}" data-numatab="${t.id}"><span class="nts-cur">$</span>${t.ticker}</button>`).join('');
  renderScopeSeg();
}
// "Section" means "the section on screen", which only makes sense for the ticker the page is actually
// showing. So it's available only when exactly one ticker is selected AND it's the on-screen (active) one.
function sectionAllowed(){ const t=islandTabs(); return t.length===1 && !!DATA && t[0].data===DATA; }
function renderScopeSeg(){
  const ok=sectionAllowed();
  if(!ok && NUMA_SCOPE==='section') NUMA_SCOPE='whole';
  document.querySelectorAll('#numaScopeSeg .nsc-seg-btn').forEach(b=>{
    const s=b.dataset.scope;
    b.classList.toggle('on', s===NUMA_SCOPE);
    if(s==='section'){ b.disabled=!ok; b.title=ok?'Just the section on screen':'Select the on-screen ticker to scope Numa to one section'; }
  });
}
function setNumaScope(s){
  if(s==='section' && !sectionAllowed()) s='whole';
  NUMA_SCOPE=s; renderScopeSeg(); renderScopeChips(); updateChatCtx(); showNumaEmpty();
}
// Quick-prompt chips reflect the active scope.
function renderScopeChips(){
  const c=document.getElementById('chatChips'); if(!c) return;
  if(NUMA_SCOPE==='whole'){
    const multi=islandTabs().length>1;
    const qs=multi?["Which is the better buy?","Compare valuations","Compare growth & margins"]:["What's the overall picture?","Biggest risk right now?","Bull vs bear case"];
    c.innerHTML=qs.map(q=>`<button class="chip-q">${q}</button>`).join('');
  }else{
    const list=SECTION_CHIPS[CURRENT]||SECTION_CHIPS.overview;
    c.innerHTML=list.map(q=>`<button class="chip-q">${q}</button>`).join('');
  }
}
function renderChips(){ renderScopeChips(); }   // back-compat alias
// Top-right button → the docked, resizable Numa panel. The page reflows into a split view (push).
function openIsland(){
  NUMA_MODE='island';
  NUMA_SCOPE='whole';                                    // every open defaults to the whole current ticker
  // default selection = active ticker; prune any closed tabs
  NUMA_SELECTED.forEach(id=>{ if(!TABS.find(t=>t.id===id&&t.data)) NUMA_SELECTED.delete(id); });
  if(!NUMA_SELECTED.size && activeTab && activeTab.data) NUMA_SELECTED.add(activeTab.id);
  aip.classList.remove('maxed'); document.body.classList.remove('numa-maxed','numa-island');
  scrim.classList.remove('show');
  document.body.classList.add('numa-open'); aip.classList.add('show');   // push the page + slide the panel in
  renderScope(); renderScopeChips(); updateChatCtx(); showNumaEmpty();
  setTimeout(()=>{const i=document.getElementById('chatInput');if(i)i.focus();window.dispatchEvent(new Event('resize'));},160);
}
function closePanel(){
  aip.classList.remove('show','maxed'); scrim.classList.remove('show');
  document.body.classList.remove('numa-open','numa-maxed','numa-island');
  clearTimeout(typeTimer); updateNumaEdge();
  setTimeout(()=>{ window.dispatchEvent(new Event('resize')); },430);
}

/* ============ AMBIENT: proactive insights, edge badge, inline explain, nav dots ============ */
// Cross-signal observations computed locally from DATA (free, instant). Numa
// "leads" with these so the rail is never a blank prompt.
function computeInsights(){
  if(!DATA) return [];
  const t=DATA.technicals||{},o=DATA.options_flow||{},ins=DATA.insider_activity||{},f=DATA.financials||{},e=DATA.earnings||{},n=DATA.news_sentiment||{},pr=DATA.peers||{},ar=DATA.analyst_ratings||{};
  const out=[];
  const optBull=(o.overall_sentiment||'').includes('Bull'),optBear=(o.overall_sentiment||'').includes('Bear');
  const net=ins.net_buying_30d;
  const insBear=ins.sentiment==='Bearish'||(net!=null&&net<0), insBull=ins.sentiment==='Bullish'||(net!=null&&net>0);
  if(optBull&&insBear&&net!=null) out.push({tone:'warn',section:'insider',text:`Insiders sold $${fmtLarge(Math.abs(net))} (30d) while options positioning reads ${o.overall_sentiment.toLowerCase()} — a conflict worth resolving before trusting either signal.`});
  else if(optBear&&insBull) out.push({tone:'warn',section:'options',text:`Options skew ${o.overall_sentiment.toLowerCase()} but insiders are net buyers — smart money disagrees with the tape.`});
  const _vv=valuationVerdict(f,pr);
  if(_vv.tone==='warn'&&f.pe_trailing!=null) out.push({tone:'warn',section:'peers',text:`At ${fmt(f.pe_trailing)}× trailing P/E${f.peg_ratio!=null&&f.peg_ratio>0?` (PEG ${fmt(f.peg_ratio)})`:''}, the multiple runs ahead of the growth — ${_vv.basis}.`});
  else if(_vv.tone==='pos'&&f.peg_ratio!=null&&f.peg_ratio>0&&f.peg_ratio<1) out.push({tone:'pos',section:'peers',text:`Don't be fooled by the ${fmt(f.pe_trailing)}× trailing P/E — a PEG of ${fmt(f.peg_ratio)} says growth more than covers it${f.pe_forward!=null?` (forward P/E just ${fmt(f.pe_forward)}×)`:''}.`});
  if(t.rsi!=null&&t.rsi>70) out.push({tone:'warn',section:'chart',text:`RSI ${fmt(t.rsi)} is overbought${t.price_vs_sma50==='above'?' and price is extended above its 50-day':''} — momentum may be peaking.`});
  else if(t.rsi!=null&&t.rsi<30) out.push({tone:'pos',section:'chart',text:`RSI ${fmt(t.rsi)} is oversold — watch for a mean-reversion bounce off support.`});
  if(e.days_until_earnings!=null&&e.days_until_earnings>=0&&e.days_until_earnings<=10) out.push({tone:'warn',section:'earnings',text:`Earnings in ${e.days_until_earnings} day${e.days_until_earnings===1?'':'s'}${e.beat_rate_pct!=null?` — ${e.beat_rate_pct}% historical beat rate`:''}. Expect elevated implied vol into the print.`});
  if(ar.upside_pct!=null&&Math.abs(ar.upside_pct)>=10) out.push({tone:ar.upside_pct>0?'pos':'warn',section:'overview',text:`Street target implies ${ar.upside_pct>0?'+':''}${fmt(ar.upside_pct)}% to $${fmt(ar.target_price_mean)} (${ar.consensus}, ${ar.total_analysts} analysts).`});
  const mr=MACRO_DATA&&MACRO_DATA.rates&&MACRO_DATA.rates.treasury_10y?MACRO_DATA.rates.treasury_10y.value:null;
  if(mr!=null&&mr>4&&f.pe_trailing!=null&&f.pe_trailing>30) out.push({tone:'neutral',section:'macro',text:`A ${mr}% 10-year is a headwind for a ${fmt(f.pe_trailing)}× multiple — long-duration growth gets repriced when the discount rate is this high.`});
  return out;
}
// "Numa is watching" — genuine AI judgments. On first open for a ticker, Claude reads
// the full dataset and writes the sharpest cross-signal observations (real analysis,
// real delay, with a scanning animation). Cached per ticker; falls back to the local
// computeInsights() rules when there's no API key. computeInsights() also powers the
// edge badge so a count shows instantly before the AI pass finishes.
let NUMA_INSIGHTS={};
function tone3(t){t=String(t||'').toLowerCase();return ['pos','warn','neutral'].includes(t)?t:'neutral';}
function parseInsightLines(text){
  return String(text||'').split('\n').map(l=>l.trim()).filter(l=>l.includes('|')).map(l=>{
    const p=l.split('|'); if(p.length<3) return null;
    const txt=p.slice(2).join('|').trim(); if(!txt||txt.length<8) return null;
    return {tone:tone3(p[0]), section:p[1].trim().toLowerCase(), text:txt};
  }).filter(Boolean).slice(0,4);
}
// Tone glyphs lead each insight: trend up/down, caution, or "watching" eye for neutral.
const NI_ICON={
  pos:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
  neg:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>',
  warn:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
  neutral:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>'
};
const NI_CHEV='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
function renderInsightCards(box, all){
  if(box._scanT){clearInterval(box._scanT);box._scanT=null;}
  if(!all||!all.length){ box.style.display='none'; box.innerHTML=''; return; }
  const rel=all.filter(i=>i.section===CURRENT), oth=all.filter(i=>i.section!==CURRENT);
  const show=[...rel,...oth].slice(0,3);
  box.style.display='block';
  box.innerHTML=`<div class="ni-head"><span class="ni-spark">${VEST}</span> Numa is watching <span class="ni-ctx">${CTXNAMES[CURRENT]||''}</span></div>`+
    show.map((i,idx)=>{const tone=i.tone||'neutral';return `<button class="ni-card ni-${tone} ni-in" style="animation-delay:${(idx*0.1).toFixed(2)}s" data-insight="${encodeURIComponent(i.text)}" aria-label="Ask Numa about this observation"><span class="ni-ic">${NI_ICON[tone]||NI_ICON.neutral}</span><span class="ni-body"><span class="ni-txt">${renderMDLite(i.text)}</span></span><span class="ni-go">${NI_CHEV}</span></button>`;}).join('');
}
function showInsightScan(box){
  box.style.display='block';
  const steps=['Reading the price action','Checking options flow','Scanning insider filings','Weighing the valuation','Reading the news tone','Cross-referencing the macro backdrop'];
  box.innerHTML=`<div class="ni-head"><span class="ni-spark">${VEST}</span> Numa is watching <span class="ni-ctx">${CTXNAMES[CURRENT]||''}</span></div><div class="ni-scan"><span class="numa-pulse" style="width:16px;height:16px;">${VEST}</span><span class="ni-scan-lbl">${steps[0]}…</span></div>`;
  const lbl=box.querySelector('.ni-scan-lbl'); let i=0;
  if(box._scanT)clearInterval(box._scanT);
  box._scanT=setInterval(()=>{ i=Math.min(i+1,steps.length-1); if(lbl)lbl.textContent=steps[i]+'…'; },900);
}
let _insightGen={};
// Generate insights with NO UI (runs in the background the moment a ticker loads).
// Returns the array — LLM if a key is set, else the instant local rules.
async function fetchInsights(tk){
  const key=localStorage.getItem('numa_api_key');
  if(!key) return computeInsights();
  const sys=`You are Numa, a sharp buy-side analyst watching ${tk}. Below is the full live dataset on the user's screen.\n\n${tickerBlock(DATA)}\n${buildMacroContextBlock()}\n\nSurface the 3 MOST valuable observations a sharp analyst would flag right now. Prioritise CONFLICTS between signals (flow vs insiders vs chart vs valuation), standout extremes, and non-obvious risks — avoid the obvious, find the tension. Each must be ONE punchy sentence (max ~22 words) citing at least one specific number from the data. Output ONLY up to 3 lines, each EXACTLY as TONE|SECTION|TEXT with no preamble, numbering or markdown. TONE is one of: pos, warn, neutral. SECTION is one of: overview, chart, options, insider, news, peers, earnings, macro.`;
  try{
    const resp=await fetch(`${API_BASE}/numa`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({api_key:key,model:'claude-sonnet-4-6',max_tokens:500,system:sys,messages:[{role:'user',content:`What are you watching on ${tk} right now?`}]})});
    if(!resp.ok||!resp.body) throw new Error('bad');
    const reader=resp.body.getReader(),dec=new TextDecoder();let buf='',full='';
    while(true){const {done:rd,value}=await reader.read();if(rd)break;buf+=dec.decode(value,{stream:true});const lines=buf.split('\n');buf=lines.pop();for(const line of lines){if(!line.startsWith('data:'))continue;const p=line.slice(5).trim();if(!p||p==='[DONE]')continue;let j;try{j=JSON.parse(p);}catch(e){continue;}if(j.token)full+=j.token;else if(j.error)throw new Error(j.error);}}
    const parsed=parseInsightLines(full);
    return parsed.length?parsed:computeInsights();
  }catch(e){ return computeInsights(); }
}
// Light the bottom-right bubble once ready; if its popover is open on this ticker, render in place.
function afterInsights(tk){
  updateNumaEdge();
  const pop=document.getElementById('numaPop'), box=document.getElementById('numaInsights');
  if(pop && box && pop.classList.contains('show') && DATA && DATA.ticker===tk) renderInsightCards(box, NUMA_INSIGHTS[tk]);
}
// Kick off (or reuse) background generation for a ticker. Deduped per ticker.
function ensureInsights(tk){
  if(!tk) return;
  if(NUMA_INSIGHTS[tk]){ afterInsights(tk); return; }
  if(_insightGen[tk]) return;
  _insightGen[tk]=true;
  fetchInsights(tk).then(fin=>{ NUMA_INSIGHTS[tk]=fin; delete _insightGen[tk]; afterInsights(tk); }).catch(()=>{ delete _insightGen[tk]; });
}
function refreshInsights(){
  const box=document.getElementById('numaInsights'); if(!box) return;
  if(!DATA||!DATA.ticker){ box.style.display='none'; box.innerHTML=''; if(box._scanT){clearInterval(box._scanT);box._scanT=null;} return; }
  const tk=DATA.ticker;
  if(NUMA_INSIGHTS[tk]){ renderInsightCards(box, NUMA_INSIGHTS[tk]); return; }   // already done → instant, no scan
  if(!box._scanT) showInsightScan(box);                                          // opened before the background pass finished
  ensureInsights(tk);
}
// Bottom-right bubble: appears (and pulses) only once this ticker's insights are ready;
// the pulse stops once the user has opened the popover for this ticker.
function updateNumaEdge(){
  const bubble=document.getElementById('numaBubble'), b=document.getElementById('numaEdgeCount'); if(!bubble||!b) return;
  const tk=DATA&&DATA.ticker; const list=tk?NUMA_INSIGHTS[tk]:null; const n=list?list.length:0;
  b.textContent=n>9?'9+':String(n);
  b.classList.toggle('show', n>0);
  bubble.classList.toggle('show', n>0);
  bubble.classList.toggle('has-new', n>0 && !(tk&&NUMA_SEEN[tk]));
}
// Open/close the watching popover.
function toggleNumaPop(open){
  const pop=document.getElementById('numaPop'); if(!pop) return;
  const show = open!=null ? open : !pop.classList.contains('show');
  pop.classList.toggle('show', show);
  const bubble=document.getElementById('numaBubble');
  if(bubble) bubble.classList.toggle('revealing', show);   // morph the vest icon into the landing "Numa" reveal
  if(show){ if(DATA&&DATA.ticker)NUMA_SEEN[DATA.ticker]=true; updateNumaEdge(); refreshInsights(); }
  else { resetPopMini(); }   // closing the popover discards the brief in-popover chat
}

/* ===== POPOVER MINI-CHAT =====
   A brief, ephemeral chat that lives INSIDE the insights popover. Clicking an
   insight streams a short answer here instead of opening the docked sidebar.
   POP_HISTORY holds the mini-conversation; it is discarded when the popover
   closes (resetPopMini, via toggleNumaPop) unless the user clicks "Continue in
   chat", which lifts the whole thread into the real sidebar (promotePopToChat). */
let POP_HISTORY=[];        // [{role, content, label?}] — ephemeral, popover-only
let _popStreaming=false;
function scrollPop(){ const s=document.querySelector('.numa-pop-scroll'); if(s) s.scrollTop=s.scrollHeight; }
// Render a data chart inside a popover turn — same chart engine (topicChartFor/renderChart)
// the sidebar uses. The popover scrolls/grows (max-height + overflow) so charts fit.
function appendPopChart(turn, topic){
  const c=topicChartFor(topic); if(!c) return;
  const html=renderChart(c); if(!html) return;
  const a=turn.querySelector('.nm-a'); if(!a) return;
  const w=document.createElement('div'); w.className='nm-chart'; w.innerHTML=html;
  a.appendChild(w); scrollPop();
}
function resetPopMini(){
  POP_HISTORY=[]; _popStreaming=false;
  const mini=document.getElementById('numaMini'), foot=document.getElementById('numaMiniFoot');
  if(mini){ mini.innerHTML=''; mini.style.display='none'; }
  if(foot) foot.style.display='none';
}
async function askNumaPop(userMessage, label){
  const key=localStorage.getItem('numa_api_key');
  // No key → fall back to the sidebar flow, which knows how to prompt for one.
  if(!key){ toggleNumaPop(false); askNuma(userMessage,{label:label||'This insight',action:true,topic:'verdict'}); return; }
  if(_popStreaming) return;                              // one mini-stream at a time
  const mini=document.getElementById('numaMini'), foot=document.getElementById('numaMiniFoot');
  if(!mini) return;
  mini.style.display='block'; if(foot) foot.style.display='block';
  const turn=document.createElement('div'); turn.className='nm-turn';
  turn.innerHTML=`<div class="nm-q">${renderMDLite(label||userMessage)}</div><div class="nm-a"><div class="nm-a-think"><span class="numa-pulse">${VEST}</span> Numa is thinking…</div><div class="nm-a-body" style="display:none;"></div></div>`;
  mini.appendChild(turn); scrollPop();
  const thinkEl=turn.querySelector('.nm-a-think'), bodyEl=turn.querySelector('.nm-a-body');
  POP_HISTORY.push({role:'user',content:userMessage,label:label||userMessage});
  _popStreaming=true;
  let fullText='', inTok=0, outTok=0, errored=false, wantCharts=[];
  try{
    const resp=await fetch(`${API_BASE}/numa`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({api_key:key,model:'claude-sonnet-4-6',max_tokens:1024,system:numaSystemPrompt(),messages:POP_HISTORY.map(m=>({role:m.role,content:m.content}))})
    });
    if(!resp.ok||!resp.body){let msg='HTTP '+resp.status;try{const j=await resp.json();msg=(j.error&&j.error.message)||j.error||msg;}catch(e){}throw new Error(msg);}
    const reader=resp.body.getReader(), dec=new TextDecoder(); let buf='';
    while(true){
      const {done,value}=await reader.read(); if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        const p=line.slice(5).trim(); if(!p||p==='[DONE]')continue;
        let j; try{j=JSON.parse(p);}catch(e){continue;}
        if(j.token){ fullText+=j.token; thinkEl.style.display='none'; bodyEl.style.display='block'; bodyEl.textContent=fullText; scrollPop(); }
        else if(j.usage){ inTok=j.usage.input_tokens||inTok; outTok=j.usage.output_tokens||outTok; }
        else if(j.error){ throw new Error(j.error); }
      }
    }
    const _ex=extractCharts(fullText); fullText=_ex.cleaned; wantCharts=_ex.charts.slice(0,2);
    bodyEl.style.display='block'; bodyEl.innerHTML=renderMD(fullText);
    wantCharts.forEach(tp=>appendPopChart(turn,tp));     // render charts inline; popover grows/scrolls to fit
  }catch(err){
    errored=true; thinkEl.style.display='none'; bodyEl.style.display='block';
    bodyEl.innerHTML='<span style="color:var(--red);">'+(err.message||'Request failed')+'</span> <span style="color:var(--text-4);">— check your API key &amp; that the backend is running.</span>';
  }
  if(!errored){
    POP_HISTORY.push({role:'assistant',content:fullText,charts:wantCharts});
    if(!inTok)inTok=Math.round(numaSystemPrompt().length/4);
    if(!outTok)outTok=Math.round(fullText.length/4);
    totalSpend+=(inTok*3+outTok*15)/1e6;
    const sp=document.getElementById('spendAmt'); if(sp)sp.textContent=fmtSpend();
  }else{
    POP_HISTORY.pop();                                  // drop the failed user turn so a promote stays clean
    if(!POP_HISTORY.length && foot) foot.style.display='none';
  }
  _popStreaming=false; scrollPop();
}
// "Continue in chat" — move the whole mini-thread into the docked sidebar and keep going there.
function promotePopToChat(){
  const hist=POP_HISTORY.filter(m=>m.role==='user'||m.role==='assistant');
  if(!hist.length) return;
  toggleNumaPop(false);                                 // closes + resets the popover (hist already copied above)
  openIsland();
  hist.forEach(m=>{
    if(m.role==='user'){
      addUser((m.label||m.content).replace(/\*\*/g,''), true);
      numaHistory.push({role:'user',content:m.content});
    }else{
      const node=addAI('claude-sonnet-4-6');
      const mt=node.querySelector('.mtext'); mt.innerHTML='<div class="mtext-out"></div>';
      mt.querySelector('.mtext-out').innerHTML=renderMD(m.content);
      node._note={title:(m.content||'').slice(0,70),text:m.content,cost:0,icon:CHATICON};
      numaHistory.push({role:'assistant',content:m.content});
      (m.charts||[]).slice(0,2).forEach(tp=>appendChart(node,tp));   // re-render the popover's charts in the sidebar
    }
  });
  scrollThread();
}
function askExplain(ctx){
  if(!ctx) return;
  // askNuma opens the panel itself (preserving the current scope if it's already open) — don't force a fresh open.
  askNuma(`Explain "${ctx}" for ${tk()} — what does this specific figure mean right now, and is it bullish, bearish, or neutral? Keep it to 2-3 sentences.`,{label:'Explain: '+ctx.slice(0,42),action:true,topic:topicOf(ctx)});
}
// Color each nav dot by its section's live signal (green bull / red bear / amber mixed).
function updateNavDots(){
  if(!DATA) return;
  const t=DATA.technicals||{},o=DATA.options_flow||{},ins=DATA.insider_activity||{},n=DATA.news_sentiment||{},f=DATA.financials||{},pr=DATA.peers||{},e=DATA.earnings||{},ar=DATA.analyst_ratings||{};
  const G='var(--green)',R='var(--red)',A='var(--amber)',N='var(--text-4)';
  const sc=n.sentiment?n.sentiment.score:null;
  const mr=MACRO_DATA&&MACRO_DATA.market_conditions?MACRO_DATA.market_conditions.market_regime:null;
  const C={
    overview:(ar.consensus||'').includes('Buy')?G:(ar.consensus||'').includes('Sell')?R:A,
    chart:(t.macd_trend==='Bullish'&&t.price_vs_sma50==='above')?G:(t.macd_trend==='Bearish'&&t.price_vs_sma50==='below')?R:A,
    options:(o.overall_sentiment||'').includes('Bull')?G:(o.overall_sentiment||'').includes('Bear')?R:A,
    insider:ins.sentiment==='Bullish'?G:ins.sentiment==='Bearish'?R:A,
    news:sc>0.1?G:sc<-0.1?R:A,
    peers:(function(){const tn=valuationVerdict(f,pr).tone;return tn==='pos'?G:tn==='warn'?A:N;})(),
    earnings:(e.days_until_earnings!=null&&e.days_until_earnings<14)?A:N,
    congress:N,
    macro:mr==='Bull'?G:mr==='Bear'?R:N,
  };
  document.querySelectorAll('.topnav .nav-item').forEach(it=>{const s=it.dataset.section,dot=it.querySelector('.nav-dot');if(dot&&C[s])dot.style.background=C[s];});
}
// "Pin latest question to top" — like ChatGPT/Claude. When a question is asked we
// scroll it to the top of the thread; a trailing spacer guarantees there's room to
// do so even when the answer is short. While a Q&A is active, scrollThread() keeps
// the question pinned instead of jumping to the bottom.
let _pinNode=null, _spacer=null;
function ensureSpacer(){ if(!_spacer){_spacer=document.createElement('div');_spacer.className='thread-spacer';} thread.appendChild(_spacer); return _spacer; }
function fitSpacer(){ const sp=ensureSpacer(); sp.style.height='0px';
  if(_pinNode&&thread.contains(_pinNode)){ const below=thread.scrollHeight - _pinNode.offsetTop; sp.style.height=Math.max(0, thread.clientHeight - below - 14)+'px'; } }
function pinToTop(node){ if(node&&thread.contains(node)) thread.scrollTop=Math.max(0, node.offsetTop - 14); }
function scrollThread(){ if(_pinNode&&thread.contains(_pinNode)){ fitSpacer(); pinToTop(_pinNode); } else { thread.scrollTop=thread.scrollHeight; } }
function pinLatest(node){ _pinNode=node; ensureSpacer(); fitSpacer(); pinToTop(node); }
// Reusable vest+"Numa" lockup. Pass a size class (e.g. 'numa-lockup-lg').
function numaLockupHTML(cls){ return `<span class="numa-lockup ${cls||''}"><span class="nl-mark">${VEST}</span><span class="nl-word">Numa</span></span>`; }
function showNumaEmpty(){
  if(!thread||thread.querySelector('.msg')) return;   // only when the thread is truly empty
  const names=islandTabs().map(t=>t.ticker);
  let sub;
  if(!names.length){ sub='Load a ticker, then ask me anything about it.'; }
  else if(names.length>1){ const tickers=names.map(n=>`<b>$${n}</b>`).join(' & '); sub=`Comparing ${tickers} across every section — ask me which wins on any dimension.`; }
  else if(NUMA_SCOPE==='section'){ sub=`Scoped to <b>$${names[0]}</b>'s <b>${CTXNAMES[CURRENT]||'Overview'}</b> — ask about what's on screen, or switch to the whole ticker.`; }
  else { sub=`Ask anything about <b>$${names[0]}</b> — I see every section that's loaded.`; }
  thread.innerHTML=`<div class="numa-empty">${numaLockupHTML('numa-lockup-lg')}<p class="numa-empty-sub">Your AI research analyst. ${sub}</p></div>`;
}
function clearNumaEmpty(){ const e=thread&&thread.querySelector('.numa-empty'); if(e) e.remove(); }
function addUser(text,action){clearNumaEmpty();const d=document.createElement('div');d.className='msg user';d.innerHTML=`<div class="ubub${action?' action':''}">${action?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px;flex:none;"><path d="M5 3l14 9-14 9z"/></svg>':''}<span>${text}</span></div>`;thread.appendChild(d);scrollThread();return d;}
function addAI(meta,inputs){const d=document.createElement('div');d.className='msg ai';d.innerHTML=`<div class="av">${VEST}</div><div class="mbody">${meta?`<div class="mmeta">${meta}</div>`:''}${inputs?`<div class="minputs">${inputs}</div>`:''}<div class="mtext"></div><div class="mactions"><button data-copybtn><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg>Copy</button><button data-savebtn><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg>Save to notes</button></div></div>`;thread.appendChild(d);scrollThread();return d;}

// Per-ticker data block (used by both rail and island contexts).
function tickerBlock(D){
  if(!D) return '';
  const t=D.technicals||{},o=D.options_flow||{},ins=D.insider_activity||{},ar=D.analyst_ratings||{},f=D.financials||{},q=D.quote||{},c=D.company||{},n=D.news_sentiment||{},pr=D.peers||{},e=D.earnings||{};
  const m=(f.margins&&f.margins[0])||{};
  const bb=o.biggest_bet;
  // Full on-screen tables — give Numa the exact rows the user can see, not just summaries.
  const peerRows=(pr.companies||[]).map(p=>`  - ${p.ticker}${p.is_target?' (TARGET='+D.ticker+')':''}: P/E ${p.pe_trailing!=null?p.pe_trailing:'N/A'} | fwd P/E ${p.pe_forward!=null?p.pe_forward:'N/A'} | EV/EBITDA ${p.ev_ebitda!=null?p.ev_ebitda:'N/A'} | P/S ${p.ps_ratio!=null?p.ps_ratio:'N/A'} | gross ${p.gross_margin!=null?p.gross_margin+'%':'N/A'} | rev growth ${p.revenue_growth!=null?(p.revenue_growth>0?'+':'')+p.revenue_growth+'%':'N/A'} | mkt cap ${fmtLarge(p.market_cap)}`).join('\n')||'  (no peer companies loaded)';
  const ucRows=(o.unusual_contracts||[]).slice(0,8).map(u=>`  - ${(u.type||'').toUpperCase()} $${u.strike} exp ${u.expiry}: vol ${u.volume!=null?u.volume.toLocaleString():'?'} | OI ${u.open_interest!=null?u.open_interest.toLocaleString():'?'} | vol/OI ${u.vol_oi_ratio!=null?u.vol_oi_ratio:'?'} | ${u.moneyness||''} | ~$${fmtLarge(u.estimated_notional)} notional`).join('\n')||'  (none flagged)';
  const insRows=(ins.transactions||[]).slice(0,8).map(x=>`  - ${x.transaction_date} ${x.insider_name} (${x.title||'—'}): ${x.transaction_type_label||x.transaction_type} ${x.shares!=null?x.shares.toLocaleString():'?'} sh @ $${x.price_per_share!=null?x.price_per_share:'?'} = $${fmtLarge(x.total_value)}`).join('\n')||'  (no recent transactions)';
  const ernRows=(e.history||[]).slice(0,8).map(h=>`  - ${h.period}: EPS ${h.eps_actual!=null?'$'+h.eps_actual:'N/A'} vs est ${h.eps_estimate!=null?'$'+h.eps_estimate:'N/A'} (${h.surprise_pct!=null?(h.surprise_pct>0?'+':'')+h.surprise_pct+'%':'?'}${h.beat===true?' BEAT':h.beat===false?' MISS':''})`).join('\n')||'  (no earnings history)';
  const newsRows=(n.articles||[]).slice(0,8).map(a=>`  - ${a.headline||''} — ${a.source||''} (${a.datetime||''})`).join('\n')||'  (no headlines loaded)';
  const rc=t.regression_channel, fb=t.fib, peh=t.pe_history;
  const chanStr=rc?`${rc.trend} regression channel, price ${rc.position}, slope ${rc.slope_pct_annual!=null?(rc.slope_pct_annual>0?'+':'')+rc.slope_pct_annual+'%/yr':'n/a'}, band $${rc.lower_end}–$${rc.upper_end}`:'n/a';
  const fibStr=fb?`${fb.direction} swing $${fb.swing_low}–$${fb.swing_high}; ${fb.levels.filter(l=>l.ratio>0&&l.ratio<1).map(l=>l.label+' $'+l.price).join(', ')}`:'n/a';
  const psychStr=(t.psych_levels||[]).map(v=>'$'+v).join(', ')||'n/a';
  const candStr=(t.candle_patterns||[]).slice(-6).map(x=>`${x.date} ${x.pattern}(${x.direction})`).join(', ')||'none';
  const patStr=(t.chart_patterns||[]).map(p=>`${p.pattern} [${p.direction}, conf ${Math.round((p.confidence||0)*100)}%${p.target!=null?', target $'+p.target:''}]`).join('; ')||'none detected';
  const peStr=peh?`current ${peh.current}× at ${peh.percentile}th percentile of its ${peh.years}y range (${peh.min}–${peh.max}×, median ${peh.median}×) → ${peh.verdict}`:'n/a';
  return `=== ${D.ticker} — ${c.name||'—'} (${c.sector||'—'} / ${c.industry||'—'}) ===
CEO: ${c.ceo||'—'} | HQ: ${c.headquarters||'—'} | Employees: ${c.employees?c.employees.toLocaleString():'—'}
QUOTE: $${q.price} | ${q.change_pct>0?'+':''}${q.change_pct}% | Vol ${q.volume_ratio}x avg | Mkt cap ${fmtLarge(q.market_cap)} | Beta ${q.beta} | Short float ${q.short_pct_float!=null?(q.short_pct_float*100).toFixed(1)+'%':'N/A'}
TECHNICALS: RSI ${t.rsi} (${t.rsi_signal}) | MACD ${t.macd_trend} | Bollinger ${t.bb_position} | vs SMA20/50/200 ${t.price_vs_sma20}/${t.price_vs_sma50}/${t.price_vs_sma200} | Golden cross ${t.golden_cross} | Support ${(t.support_levels||[]).join(', ')} | Resistance ${(t.resistance_levels||[]).join(', ')}
TECHNICAL OVERLAYS (computed geometry, same as drawn on the Annotated Analysis chart): channel — ${chanStr} | fibonacci — ${fibStr} | psychological levels — ${psychStr}
CANDLE SIGNALS (recent): ${candStr}
CHART PATTERN CANDIDATES (algorithmic & low-confidence — VALIDATE or reject each against the actual price action, never assert as fact): ${patStr}
HISTORICAL P/E (trailing P/E vs its OWN range — use this for 'is it cheap/expensive vs history' questions): ${peStr}
OPTIONS: PCR ${o.put_call_ratio} | ${o.overall_sentiment} | ${o.unusual_contracts_count} unusual | Max pain $${o.max_pain} (${o.max_pain_distance_pct}% from current) | Biggest bet ${bb?`${(bb.type||'').toUpperCase()} $${bb.strike} ${bb.expiry} ~$${fmtLarge(bb.estimated_notional)}`:'none'}
UNUSUAL OPTIONS CONTRACTS (top flagged):
${ucRows}
INSIDER: Net buying 30d $${fmtLarge(ins.net_buying_30d)} | ${ins.sentiment} | Buy/sell 90d ${ins.buy_sell_ratio_90d} | ${ins.buy_count_90d} buys / ${ins.sell_count_90d} sells
INSIDER TRANSACTIONS (recent Form 4):
${insRows}
FINANCIALS: P/E ${f.pe_trailing} trail / ${f.pe_forward} fwd | EV/EBITDA ${f.ev_ebitda} | P/S ${f.ps_ratio} | PEG ${f.peg_ratio} | Gross ${m.gross_margin}% | Net ${m.net_margin}% | Net debt ${fmtLarge(f.net_debt)}
PEERS: peer median P/E (ex-outliers) ${peerPEMedian(pr)!=null?fmt(peerPEMedian(pr))+'x':'N/A'} | raw sector avg P/E ${pr.sector_avg_pe} (note: a simple mean is distorted by trough-earnings cyclicals with NM/triple-digit P/Es — prefer the median, PEG and forward P/E) | ${D.ticker} premium/discount to peers ${pr.premium_discount_to_peers}%
PEER TABLE (the exact per-company multiples on the Peers page — use THESE numbers for any peer question, e.g. AMD's P/E):
${peerRows}
EARNINGS: next ${e.next_earnings_date} (in ${e.days_until_earnings} days) | beat rate ${e.beat_rate_pct}% | avg surprise ${e.avg_surprise_pct}%
EARNINGS HISTORY:
${ernRows}
ANALYST: ${ar.consensus} | Target $${ar.target_price_mean} (${ar.upside_pct}% upside) | ${ar.total_analysts} analysts
NEWS: sentiment ${n.sentiment?n.sentiment.score:'N/A'} (${n.sentiment?n.sentiment.label:''}) | ${n.articles_count} articles (30d)
RECENT HEADLINES:
${newsRows}`;
}
// ANALYTICAL FRAMEWORK — shared by both Numa chat prompts (rail + island).
// Every rule grounds on fields already present in tickerBlock() above:
// sector/industry, RSI/MACD/Bollinger, net_buying_30d, quote price, analyst
// target, support/resistance. Keep these field references in sync with
// tickerBlock(). Deliberately NOT used by the 3-line auto-insight generator,
// whose strict TONE|SECTION|TEXT format must stay intact.
const NUMA_FRAMEWORK = `ANALYTICAL FRAMEWORK — when the user asks for a view, outlook, verdict, or "what do you think" on a name (skip this for pure factual lookups like "what's the P/E?"), structure the analysis as follows, and let it override the brevity default:
• BUSINESS MODEL FIRST: classify the company from its sector/industry (lender/bank, SaaS, manufacturer, consumer, commodity, insurer, etc.) and apply sector-specific macro logic. For LENDERS/BANKS specifically, reason explicitly about net interest margin — NIM = the yield earned on loans/assets minus the cost of deposits/funding — and how the Fed Funds rate moves each side: higher rates can widen asset yields but lift funding costs and credit losses, while falling rates compress yields but ease funding pressure and default risk.
• SEPARATE BY TIMEFRAME, using these exact buckets: SHORT-TERM (days–weeks: flow, technicals, imminent catalysts), MEDIUM-TERM (1–3 months: earnings, positioning), LONG-TERM (6–12 months: fundamentals, valuation, macro). The same signal can be bullish on one horizon and bearish on another — say so when it is.
• TECHNICAL CONFLUENCE: when RSI, MACD, and Bollinger position are all present in the data, state explicitly whether they CONFIRM or CONFLICT with one another before delivering any technical verdict.
• INSIDER HEADLINE-RISK RULE: if 30-day net insider buying is below -$50M (i.e., net selling exceeding $50M), flag it as a headline risk regardless of how bullish every other signal is.
• CLOSE WITH RISK/REWARD: give a bull-case target, a bear-case target, and the current price; assign rough probabilities to each case; then state the probability-weighted expected value and the reward-to-risk ratio. Anchor targets to real numbers in the data (analyst target, support/resistance, regression/fib bands) — never invent levels.`;

// RAIL: section-aware, single active ticker.
function buildNumaContext(){
  if(!DATA) return "No ticker loaded. Ask the user to analyze a ticker first.";
  return `You are Numa, a sharp financial research assistant embedded in a personal stock terminal.
You have access to all currently loaded data for ${DATA.ticker}.

${tickerBlock(DATA)}
${buildMacroContextBlock()}

Current section the user is viewing: ${CURRENT}
When reasoning about valuation or any high-growth / long-duration stock, factor in the MACRO ENVIRONMENT above — the rate environment sets the discount rate that anchors every DCF.

Answer the user's EXACT question first and directly, using the specific numbers in the data above. The data above is exactly what the user sees on screen right now — if they reference a peer's P/E, a specific insider trade, an options contract, an earnings quarter, or a headline, it IS in the tables above (e.g. the PEER TABLE has each peer's P/E). Find it there before ever saying you don't have it. Only say something is unavailable if it is genuinely absent above. Be direct and investment-grade. Keep direct, factual answers tight (3-6 sentences); when the user asks for a view or verdict, follow the ANALYTICAL FRAMEWORK below and give the answer the structure it needs. Use **bold** for the key conclusion. Never fabricate data.
${NUMA_FRAMEWORK}

When a single small visual would genuinely strengthen the answer, add a chart directive on its OWN line: [[chart:TYPE]] where TYPE is one of: valuation (P/E vs peers), peers (revenue growth across the group), options (call vs put volume), insider (buys vs sells), earnings (EPS surprise history), technical (recent candles + key levels), news (sentiment gauge), verdict (net bull/bear gauge). Use at most ONE, and only when it adds real insight to THIS question — most answers need none. It renders as a chart below your text, so don't describe or mention it.`;
}
// ISLAND: whole-ticker (all sections), one or several selected tickers at once.
function buildIslandContext(){
  const tabs=islandTabs();
  if(!tabs.length) return buildNumaContext();
  const multi=tabs.length>1;
  const names=tabs.map(t=>t.ticker).join(', ');
  return `You are Numa, a sharp financial research assistant embedded in a personal stock terminal.
You have the FULL 360° dataset — fundamentals, technicals, options flow, insider activity, peers, earnings, analyst ratings and news — for ${multi?`these ${tabs.length} tickers`:'this ticker'}: ${names}.
${multi?'The user has selected them to be considered together — compare and contrast across every dimension.':''}

${tabs.map(t=>tickerBlock(t.data)).join('\n\n')}
${buildMacroContextBlock()}

You are NOT scoped to any single view — reason across every section${multi?' and across every selected ticker':''}. When reasoning about valuation or any high-growth / long-duration name, factor in the MACRO ENVIRONMENT above.

Answer the user's exact question first, with the specific numbers in the data above. The data above is exactly what's on screen — peer P/Es, insider trades, headlines, earnings quarters and options contracts are all in the tables above; find a referenced figure there before saying it's unavailable. Be direct and investment-grade. Use **bold** for the key conclusion.${multi?' When comparing, be explicit about which ticker wins on each dimension and end with a net call.':''} Never fabricate data.
${NUMA_FRAMEWORK}

When a single small visual would genuinely strengthen the answer, add a chart directive on its OWN line: [[chart:TYPE]] where TYPE is one of: valuation, peers, options, insider, earnings, technical, news, verdict. Use at most ONE, only when it adds real insight to THIS question (most answers need none). It renders as a chart below your text, so don't mention it.`;
}
function numaSystemPrompt(){ return NUMA_SCOPE==='section' ? buildNumaContext() : buildIslandContext(); }

function fmtSpend(){return '$'+(totalSpend<1?totalSpend.toFixed(3):totalSpend.toFixed(2));}

async function askNuma(userMessage, opts){
  opts=opts||{};
  const key=localStorage.getItem('numa_api_key');
  // Open the docked Numa panel if it isn't already showing.
  const ensureNumaOpen=()=>{ if(!aip.classList.contains('show'))openIsland(); };
  if(!key){ ensureNumaOpen(); showKeyPrompt(userMessage, opts); if(opts.onDone)opts.onDone(); return; }
  ensureNumaOpen();
  const userNode=addUser(opts.label||userMessage, !!opts.action);
  numaHistory.push({role:'user',content:userMessage});
  const topic=opts.topic||topicOf(userMessage);
  const node=addAI('claude-sonnet-4-6', opts.inputs||null);
  pinLatest(userNode); // ChatGPT-style: bring the new question to the top of the thread
  const t0=performance.now();
  runThinking(node, topic, async (ui)=>{
    let fullText='', inTok=0, outTok=0, errored=false, wantCharts=[];
    try{
      // Proxied through the local backend (/numa) to avoid browser CORS to
      // api.anthropic.com. Backend streams {token} / {usage} / {error} / [DONE].
      const resp=await fetch(`${API_BASE}/numa`,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({api_key:key,model:'claude-sonnet-4-6',max_tokens:8192,system:numaSystemPrompt(),messages:numaHistory})
      });
      if(!resp.ok||!resp.body){let msg='HTTP '+resp.status;try{const j=await resp.json();msg=(j.error&&j.error.message)||j.error||msg;}catch(e){}throw new Error(msg);}
      const reader=resp.body.getReader(), dec=new TextDecoder(); let buf='';
      while(true){
        const {done,value}=await reader.read(); if(done)break;
        buf+=dec.decode(value,{stream:true});
        const lines=buf.split('\n'); buf=lines.pop();
        for(const line of lines){
          if(!line.startsWith('data:'))continue;
          const p=line.slice(5).trim(); if(!p||p==='[DONE]')continue;
          let j; try{j=JSON.parse(p);}catch(e){continue;}
          if(j.token){fullText+=j.token;ui.preview(fullText);}
          else if(j.usage){inTok=j.usage.input_tokens||inTok;outTok=j.usage.output_tokens||outTok;}
          else if(j.error){throw new Error(j.error);}
        }
      }
      const _ex=extractCharts(fullText); fullText=_ex.cleaned; wantCharts=_ex.charts;
      ui.finish(renderMD(fullText));
    }catch(err){errored=true;ui.error('<span style="color:var(--red);">'+(err.message||'Request failed')+'</span> <span style="color:var(--text-4);">— check your API key &amp; that the backend is running.</span>');}
    if(!errored){
      numaHistory.push({role:'assistant',content:fullText});
      if(!inTok)inTok=Math.round(buildNumaContext().length/4);
      if(!outTok)outTok=Math.round(fullText.length/4);
      const callCost=(inTok*3+outTok*15)/1e6;
      totalSpend+=callCost;
      const sp=document.getElementById('spendAmt'); if(sp)sp.textContent=fmtSpend();
      const secs=((performance.now()-t0)/1000).toFixed(1);
      const mm=node.querySelector('.mmeta'); if(mm)mm.innerHTML='claude-sonnet-4-6 <span>'+(inTok+outTok).toLocaleString()+' tok</span> <span class="cost">$'+callCost.toFixed(3)+'</span> <span>'+secs+'s</span>';
      node._note={title:(opts.noteTitle||userMessage).slice(0,70),text:fullText,cost:callCost,icon:opts.action?(AI[opts.actKey]&&AI[opts.actKey].icon||CHATICON):CHATICON};
      // Claude decides whether a chart helps (and which) via [[chart:TYPE]] directives.
      // Fall back to an explicit action's own topic if it requested none.
      (wantCharts.length?wantCharts:(opts.action?[topic]:[])).slice(0,2).forEach(tp=>appendChart(node,tp));
    }
    if(opts.onDone)opts.onDone();
  });
}
function askFree(q){q=(q||'').trim();if(!q)return;askNuma(q,{});}

let PENDING_ASK=null;
function showKeyPrompt(pendingMsg, opts){
  clearNumaEmpty();
  PENDING_ASK=(pendingMsg!=null)?{msg:pendingMsg,opts:opts||{}}:null;
  // Only ever show ONE key prompt. Without this, repeated asks stack multiple
  // prompts that all share id="keyPromptMsg"/"numaKeyInput", and Save reads the
  // FIRST (empty) input via getElementById — so it silently never saves.
  thread.querySelectorAll('#keyPromptMsg').forEach(el=>el.remove());
  const d=document.createElement('div');d.className='msg ai';d.id='keyPromptMsg';
  d.innerHTML=`<div class="av">${VEST}</div><div class="mbody"><div class="mmeta">Numa</div><div class="mtext">To get started, enter your Anthropic API key. It's saved on this device and sent only to your local backend, which calls api.anthropic.com. Clear it anytime in Settings.</div>
    <div class="keybox"><input type="password" id="numaKeyInput" placeholder="sk-ant-..."><button onclick="saveNumaKey(this)">Save</button></div></div>`;
  thread.appendChild(d);scrollThread();
  setTimeout(()=>{const i=document.getElementById('numaKeyInput');if(i){i.focus();i.addEventListener('keydown',e=>{if(e.key==='Enter')saveNumaKey(i);});}},80);
}
function saveNumaKey(el){
  // Read the input next to the clicked Save button (robust even if prompts stack).
  const box=el&&el.closest?el.closest('.keybox'):null;
  const inp=(box&&box.querySelector('input'))||document.getElementById('numaKeyInput');
  const k=inp&&inp.value.trim();if(!k)return;
  localStorage.setItem('numa_api_key',k);
  toast('API key saved for this session');
  thread.querySelectorAll('#keyPromptMsg').forEach(m=>m.remove());
  const pend=PENDING_ASK; PENDING_ASK=null;
  if(pend) askNuma(pend.msg, pend.opts);
}

function runAction(key, btn){
  const a=AI[key]; if(!a) return;
  let restore=null;
  if(btn&&btn.classList.contains('ai-act')){const ic=btn.querySelector('.ic');const h=ic.innerHTML;ic.innerHTML='<div class="spin"></div>';const ds=btn.querySelector('.ds');const od=ds?ds.textContent:'';if(ds)ds.textContent='Analyzing…';btn.classList.add('busy');restore=()=>{ic.innerHTML=h;if(ds)ds.textContent=od;btn.classList.remove('busy');};}
  const topic=ACT_TOPIC[key]||'general';
  const prompt=ACT_PROMPTS[key]?ACT_PROMPTS[key]():a.title;
  askNuma(prompt,{label:a.title,action:true,topic:topic,inputs:inputsLineFor(topic),noteTitle:a.title,actKey:key,onDone:()=>{if(restore)setTimeout(restore,300);}});
}

/* ============ REASONING TRACE ============ */
function topicOf(s){s=(s||'').toLowerCase();
  if(/segment|revenue mix|breakdown|business mix|by segment|composition|revenue by/.test(s))return'segments';
  if(/valuat|expensive|cheap|p\/e|multiple|overvalu|worth/.test(s))return'valuation';
  if(/option|flow|call|put|sweep|gamma|max pain/.test(s))return'options';
  if(/insider|selling|buying|form 4|10b5/.test(s))return'insider';
  if(/earning|report|print|implied move|surprise/.test(s))return'earnings';
  if(/risk|downside|worry|tail|bear/.test(s))return'risk';
  if(/peer|compar|competitor|vs /.test(s))return'peers';
  if(/chart|technical|rsi|macd|trend|pattern|support|resist|level|stop/.test(s))return'technical';
  if(/news|narrative|catalyst|story/.test(s))return'news';
  if(/macro|rate|fed|fomc|inflation|cpi|pce|treasury|yield|rotat|discount|10.?year|2.?year|recession|economy/.test(s))return'macro';
  if(/buy|sell|should i|enter|position|thesis/.test(s))return'verdict';
  return'general';}
const TRACE={
  valuation:{sources:['Valuation block','Margins','Sector P/E','PEG'],steps:['Reading loaded fundamentals','Comparing multiples to the sector','Growth-adjusting the P/E']},
  options:{sources:['Options chain','Unusual flow','Insider filings'],steps:['Reading the options chain','Scanning unusual prints','Checking flow vs insider activity']},
  insider:{sources:['SEC Form 4','30d net flow','Buy/sell counts'],steps:['Pulling recent Form 4 filings','Separating buys from sells','Weighing the net signal']},
  earnings:{sources:['Calendar','Beat history','Consensus'],steps:['Reading the next print date','Comparing to historical surprises','Reviewing the setup']},
  risk:{sources:['Chart structure','Balance sheet','Beta / short interest'],steps:['Mapping the downside levels','Checking the balance-sheet cushion','Weighing positioning risk']},
  peers:{sources:['Peer multiples','Margins','Growth'],steps:['Loading peer comparables','Normalizing for growth','Ranking the group']},
  technical:{sources:['1Y OHLCV','RSI / MACD','S/R levels'],steps:['Reading the price structure','Reconciling the indicators','Locating the key levels']},
  news:{sources:['Recent articles','Sentiment','Catalysts'],steps:['Scanning recent headlines','Scoring sentiment & buzz','Flagging upcoming catalysts']},
  verdict:{sources:['Fundamentals','Chart','Flow','Insiders'],steps:['Reading everything on screen','Weighing bull vs bear','Forming a balanced read']},
  macro:{sources:['Rates & curve','Inflation','Labor','Fed path'],steps:['Reading the rate environment','Checking inflation vs target','Weighing the Fed path']},
  general:{sources:['All loaded data'],steps:['Reading everything on screen','Synthesizing across domains']},
};
// Working visual: a compact box with a rotating status (the topic's reasoning steps,
// then generic "writing" phrases) and a faint, markdown-stripped live preview of the
// latest text. The full STYLED answer is revealed only when generation completes
// (ui.finish) — the raw markdown is never shown mid-stream.
function runThinking(node,topic,cb){
  const t=TRACE[topic]||TRACE.general;
  const el=node.querySelector('.mtext');
  const av=node.querySelector('.av'); if(av) av.classList.add('av-thinking');   // pulse the avatar vest while working
  const t0=performance.now();
  const phrases=[...t.steps,'Cross-checking the numbers','Drafting the analysis','Formatting the answer'];
  const stripMD=s=>String(s||'').replace(/\[\[chart:[^\]]*\]\]/gi,'').replace(/[#*`>_~]/g,'').replace(/\|/g,' ').replace(/\s+/g,' ').trim();
  el.innerHTML='<div class="gen"><div class="gen-top"><span class="gen-lbl"></span></div><div class="gen-preview"></div></div>';
  const lblEl=el.querySelector('.gen-lbl'), pvEl=el.querySelector('.gen-preview');
  let pi=0, stopped=false;
  lblEl.textContent=phrases[0]+'…';
  // Advance forward through the stages once, then hold on the last one (never wrap
  // back to the start — that looked like it was going backwards).
  const tick=()=>{ if(stopped)return; if(pi<phrases.length-1){pi++;lblEl.textContent=phrases[pi]+'…';} typeTimer=setTimeout(tick,1300); };
  typeTimer=setTimeout(tick,1300);
  cb({
    // live, plain-text peek of the tail (cheap: only strips the last ~220 chars)
    preview(text){ if(stopped||!pvEl)return; pvEl.textContent=stripMD(String(text).slice(-220)).slice(-110); scrollThread(); },
    finish(html){ if(stopped)return; stopped=true; clearTimeout(typeTimer); if(av)av.classList.remove('av-thinking'); const secs=((performance.now()-t0)/1000).toFixed(1);
      el.innerHTML='<div class="thought">✦ Thought for '+secs+'s · '+t.sources.length+' source'+(t.sources.length>1?'s':'')+'</div><div class="mtext-out gen-reveal"></div>';
      el.querySelector('.mtext-out').innerHTML=html; scrollThread(); },
    error(html){ if(stopped)return; stopped=true; clearTimeout(typeTimer); if(av)av.classList.remove('av-thinking'); el.innerHTML='<div class="mtext-out"></div>'; el.querySelector('.mtext-out').innerHTML=html; scrollThread(); }
  });
}
function countUp(el,target,dur,fmt){const s=performance.now();const step=now=>{const p=Math.min((now-s)/dur,1);const e=1-Math.pow(1-p,3);el.textContent=fmt(target*e);if(p<1)requestAnimationFrame(step);};requestAnimationFrame(step);}

/* ============ IN-CHAT CHARTS (derived from real DATA) ============ */
function topicChartFor(topic){
  if(topic==='macro'){
    const r=(MACRO_DATA&&MACRO_DATA.rates)||{};
    const v=o=>o&&o.value!=null?o.value:null;
    const pts=[['Fed',v(r.fed_funds)],['2Y',v(r.treasury_2y)],['10Y',v(r.treasury_10y)],['30Y',v(r.treasury_30y)]].filter(p=>p[1]!=null);
    if(!pts.length)return null;
    return{type:'bars',title:'Rate curve (%)',max:Math.max(...pts.map(p=>p[1])),data:pts.map(p=>({label:p[0],value:p[1],color:'var(--accent)',disp:fmt(p[1])+'%'}))};
  }
  if(!DATA)return null;
  const f=DATA.financials||{},q=DATA.quote||{},o=DATA.options_flow||{},ins=DATA.insider_activity||{},e=DATA.earnings||{},n=DATA.news_sentiment||{},pr=DATA.peers||{},ar=DATA.analyst_ratings||{},t=DATA.technicals||{};
  const T=DATA.ticker;
  if(topic==='valuation'){const comps=(pr.companies||[]).filter(c=>c.pe_trailing!=null).slice(0,4);const data=comps.map(c=>({label:c.ticker,value:c.pe_trailing,color:c.is_target?'var(--accent)':'var(--text-3)',disp:fmt(c.pe_trailing)}));const med=peerPEMedian(pr);if(med!=null)data.push({label:'Peer med',value:med,color:'var(--text-4)',disp:fmt(med)});if(!data.length)return null;return{type:'bars',title:'P/E — '+T+' vs peers (median ex-outliers)',max:Math.max(...data.map(d=>d.value)),data};}
  if(topic==='options'){if(o.total_call_volume==null)return null;const tot=(o.total_call_volume||0)+(o.total_put_volume||0)||1;const cp=Math.round((o.total_call_volume||0)/tot*100);return{type:'split',title:'Option volume — calls vs puts',left:{pct:cp,label:'CALL '+cp+'%',color:'var(--green)'},right:{label:'PUT '+(100-cp)+'%',color:'var(--red)'}};}
  if(topic==='insider'){return{type:'bars',title:'Insider transactions (90d)',max:Math.max(1,ins.sell_count_90d||0,ins.buy_count_90d||0),data:[{label:'Buys',value:Math.max(0.12,ins.buy_count_90d||0),color:'var(--green)',disp:String(ins.buy_count_90d||0)},{label:'Sells',value:Math.max(0.12,ins.sell_count_90d||0),color:'var(--red)',disp:String(ins.sell_count_90d||0)}]};}
  if(topic==='earnings'){const h=(e.history||[]).filter(x=>x.surprise_pct!=null).slice(0,6).reverse();if(!h.length)return null;return{type:'diverge',title:'EPS surprise vs estimate',max:Math.max(...h.map(x=>Math.abs(x.surprise_pct)),1),data:h.map(x=>({label:x.period,value:x.surprise_pct,disp:(x.surprise_pct>0?'+':'')+fmt(x.surprise_pct)+'%'}))};}
  if(topic==='peers'){const comps=(pr.companies||[]).filter(c=>c.revenue_growth!=null).slice(0,4);if(!comps.length)return null;return{type:'bars',title:'Revenue growth (YoY)',max:Math.max(...comps.map(c=>Math.abs(c.revenue_growth)),1),data:comps.map(c=>({label:c.ticker,value:c.revenue_growth,color:c.is_target?'var(--accent)':'var(--text-3)',disp:(c.revenue_growth>0?'+':'')+fmt(c.revenue_growth)+'%'}))};}
  if(topic==='technical'){const cd=(t.chart_data||[]).filter(d=>d.close!=null&&d.open!=null&&!isNaN(d.close));if(cd.length<6)return null;const recent=cd.slice(-18);const vals=recent.flatMap(d=>[d.high,d.low]);const min=Math.min(...vals),max=Math.max(...vals);const levels=[];if(t.resistance_levels&&t.resistance_levels.length){const r=t.resistance_levels[t.resistance_levels.length-1];levels.push({v:r,label:'R $'+r,color:'var(--red)'});}if(t.support_levels&&t.support_levels.length){const s=t.support_levels[0];levels.push({v:s,label:'S $'+s,color:'var(--green)'});}return{type:'candle',title:T+' — recent price & key levels',min:min-2,max:max+2,candles:recent.map(d=>({o:d.open,h:d.high,l:d.low,c:d.close})),levels};}
  if(topic==='news'){const s=n.sentiment?n.sentiment.score:null;if(s==null)return null;const pct=Math.round((s+1)/2*100);return{type:'gauge',title:'News sentiment',grad:'linear-gradient(90deg,var(--red),var(--amber),var(--green))',pct,label:(s>0?'+':'')+s+' '+((n.sentiment&&n.sentiment.label)||''),color:s>0.1?'var(--green)':s<-0.1?'var(--red)':'var(--amber)',lo:'Bearish',hi:'Bullish'};}
  if(topic==='risk'){const beta=q.beta||1;const pct=Math.min(92,Math.max(8,Math.round(beta*42)));return{type:'gauge',title:'Risk skew (beta-based)',grad:'linear-gradient(90deg,var(--green),var(--amber),var(--red))',pct,label:pct>66?'Elevated':pct<34?'Low':'Moderate',color:pct>66?'var(--red)':pct<34?'var(--green)':'var(--amber)',lo:'Low',hi:'High'};}
  if(topic==='verdict'){let b=0,tot=0;const add=c=>{tot++;if(c)b++;};add((o.overall_sentiment||'').includes('Bull'));add(ins.sentiment==='Bullish');add((n.sentiment&&n.sentiment.score||0)>0.1);add(t.macd_trend==='Bullish');add(t.price_vs_sma50==='above');add((ar.upside_pct||0)>0);const pct=tot?Math.round(b/tot*100):50;return{type:'gauge',title:'Net setup',grad:'linear-gradient(90deg,var(--red),var(--amber),var(--green))',pct,label:pct>=66?'Bullish':pct<=33?'Bearish':'Mixed / cautious',color:pct>=66?'var(--green)':pct<=33?'var(--red)':'var(--amber)',lo:'Bearish',hi:'Bullish'};}
  if(topic==='general'){if(!ar.total_analysts)return null;return{type:'bars',title:'Analyst ratings ('+ar.total_analysts+')',max:Math.max(ar.strong_buy_count||0,ar.buy_count||0,ar.hold_count||0,ar.sell_count||0,1),data:[{label:'Strong Buy',value:ar.strong_buy_count||0,color:'var(--green)',disp:String(ar.strong_buy_count||0)},{label:'Buy',value:ar.buy_count||0,color:'var(--green)',disp:String(ar.buy_count||0)},{label:'Hold',value:ar.hold_count||0,color:'var(--text-4)',disp:String(ar.hold_count||0)},{label:'Sell',value:(ar.sell_count||0)+(ar.strong_sell_count||0),color:'var(--red)',disp:String((ar.sell_count||0)+(ar.strong_sell_count||0))}]};}
  return null;
}
function renderChart(c){
  if(!c)return'';
  if(c.type==='bars'){
    const max=c.max||Math.max(...c.data.map(d=>Math.abs(d.value)));
    return '<div class="achart"><div class="achart-t">'+c.title+'</div>'+c.data.map((d,i)=>'<div class="abar"><span class="l">'+d.label+'</span><span class="track"><span class="fill" style="width:'+Math.max(3,Math.abs(d.value)/max*100).toFixed(1)+'%;background:'+(d.color||'var(--accent)')+';animation-delay:'+(i*0.06).toFixed(2)+'s;"></span></span><span class="v">'+(d.disp!=null?d.disp:d.value)+'</span></div>').join('')+'</div>';
  }
  if(c.type==='split'){
    return '<div class="achart"><div class="achart-t">'+c.title+'</div><div class="asplit"><div style="width:'+c.left.pct+'%;background:'+c.left.color+';">'+c.left.label+'</div><div style="width:'+(100-c.left.pct)+'%;background:'+c.right.color+';justify-content:flex-end;">'+c.right.label+'</div></div></div>';
  }
  if(c.type==='gauge'){
    return '<div class="achart"><div class="achart-t">'+c.title+'</div><div class="agauge" style="background:'+(c.grad||'linear-gradient(90deg,var(--red),var(--amber),var(--green))')+';"><span class="mk" style="left:'+c.pct+'%;"></span></div><div class="agauge-lbl"><span>'+(c.lo||'')+'</span><span style="color:'+(c.color||'var(--text-2)')+';font-weight:600;">'+(c.label||'')+'</span><span>'+(c.hi||'')+'</span></div></div>';
  }
  if(c.type==='candle'){
    const W=440,H=132,pad=8,padB=8;const min=c.min,max=c.max;const n=c.candles.length;const cw=(W-2*pad)/n;const bw=Math.min(13,cw*0.62);
    const ys=v=>pad+(1-(v-min)/(max-min))*(H-pad-padB);
    const lv=(c.levels||[]).map(L=>{const y=ys(L.v).toFixed(1);return '<line x1="'+pad+'" y1="'+y+'" x2="'+(W-pad)+'" y2="'+y+'" stroke="'+L.color+'" stroke-width="1" stroke-dasharray="4 3" opacity="0.6"/><text x="'+(W-pad)+'" y="'+(+y-3)+'" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="9" fill="'+L.color+'">'+L.label+'</text>';}).join('');
    const cs=c.candles.map((d,i)=>{const cx=pad+cw*i+cw/2;const up=d.c>=d.o;const col=up?'var(--green)':'var(--red)';const yH=ys(d.h),yL=ys(d.l),yO=ys(d.o),yC=ys(d.c);const top=Math.min(yO,yC);const bh=Math.max(1.5,Math.abs(yC-yO));return '<line x1="'+cx.toFixed(1)+'" y1="'+yH.toFixed(1)+'" x2="'+cx.toFixed(1)+'" y2="'+yL.toFixed(1)+'" stroke="'+col+'" stroke-width="1.2"/><rect x="'+(cx-bw/2).toFixed(1)+'" y="'+top.toFixed(1)+'" width="'+bw.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="1" fill="'+col+'"/>';}).join('');
    return '<div class="achart"><div class="achart-t">'+c.title+'</div><svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:132px;display:block;">'+lv+cs+'</svg></div>';
  }
  if(c.type==='donut'){
    const total=c.data.reduce((s,d)=>s+d.value,0)||1;const r=38,cx=46,cy=46,circ=2*Math.PI*r;let off=0;
    const segs=c.data.map(d=>{const dash=d.value/total*circ;const s='<circle cx="'+cx+'" cy="'+cy+'" r="'+r+'" fill="none" stroke="'+d.color+'" stroke-width="14" stroke-dasharray="'+dash.toFixed(2)+' '+(circ-dash).toFixed(2)+'" stroke-dashoffset="'+(-off).toFixed(2)+'" transform="rotate(-90 '+cx+' '+cy+')"/>';off+=dash;return s;}).join('');
    const legend=c.data.map(d=>'<div style="display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-2);margin-bottom:7px;"><span style="width:9px;height:9px;border-radius:2px;background:'+d.color+';flex:none;"></span><span style="flex:1;min-width:0;">'+d.label+'</span><span class="mono" style="color:var(--text);font-size:11px;">'+(d.disp!=null?d.disp:Math.round(d.value/total*100)+'%')+'</span></div>').join('');
    return '<div class="achart"><div class="achart-t">'+c.title+'</div><div style="display:flex;align-items:center;gap:20px;"><svg viewBox="0 0 92 92" style="width:92px;height:92px;flex:none;">'+segs+'</svg><div style="flex:1;min-width:0;">'+legend+'</div></div></div>';
  }
  if(c.type==='diverge'){
    const max=c.max||Math.max(...c.data.map(d=>Math.abs(d.value)));
    return '<div class="achart"><div class="achart-t">'+c.title+'</div>'+c.data.map((d,i)=>{const pct=Math.abs(d.value)/max*50;const pos=d.value>=0;return '<div class="abar"><span class="l">'+d.label+'</span><span class="dvtrack"><span class="dvmid"></span><span class="dvfill" style="'+(pos?'left:50%':'right:50%')+';width:'+pct.toFixed(1)+'%;background:'+(pos?'var(--green)':'var(--red)')+';transform-origin:'+(pos?'left':'right')+';animation-delay:'+(i*0.06).toFixed(2)+'s;"></span></span><span class="v" style="color:'+(pos?'var(--green)':'var(--red)')+';">'+(d.disp!=null?d.disp:d.value)+'</span></div>';}).join('')+'</div>';
  }
  return'';
}
function appendChart(node,topic){const c=topicChartFor(topic);if(!c)return;const html=renderChart(c);if(!html)return;const w=document.createElement('div');w.innerHTML=html;const mb=node.querySelector('.mbody');mb.insertBefore(w.firstChild,mb.querySelector('.mactions'));scrollThread();}
// Claude can request a chart inline with [[chart:TYPE]]; pull those directives out of
// the answer text (so the user sees the rendered chart, never the raw marker).
function extractCharts(text){
  const charts=[];
  const cleaned=String(text||'').replace(/\[\[\s*chart\s*:\s*([a-z_]+)\s*\]\]/gi,(m,t)=>{charts.push(t.toLowerCase());return '';}).replace(/\n{3,}/g,'\n\n').trim();
  return {cleaned,charts};
}

