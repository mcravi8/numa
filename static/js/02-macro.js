/* ============ MACRO LAYER (free FRED + yfinance dashboard) ============ */
let MACRO_DATA=null, MACRO_LOADING=false;
async function loadMacro(){
  if(MACRO_DATA) return MACRO_DATA; // cached for the session
  try{
    const r=await fetch(`${API_BASE}/macro`);
    MACRO_DATA=await r.json();
  }catch(e){ MACRO_DATA={error:e.message||'fetch failed'}; }
  return MACRO_DATA;
}
// small macro formatters (fmt() rounds away decimals at >=100, so use these)
const mNum=(v,d)=>(v==null||isNaN(v))?'—':Number(v).toFixed(d==null?2:d);
const mSign=(v,d,suf)=>(v==null||isNaN(v))?'—':((v>0?'+':'')+Number(v).toFixed(d==null?2:d)+(suf||''));
const mBps=(v)=>(v==null||isNaN(v))?'—':((v>0?'+':'')+Math.round(v*100)+'bps');
function fmtEventDate(d){const M=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];const p=(d||'').split('-');return p.length<3?d:M[parseInt(p[1],10)-1]+' '+p[2];}
// generic SVG sparkline from [{date,value}] (reuses smoothPath, hoisted)
function macroSpark(hist,opts){
  opts=opts||{};
  const data=(hist||[]).map(d=>d.value).filter(v=>v!=null&&!isNaN(v));
  if(data.length<2) return '<span style="color:var(--text-4);font-size:11px;">— no history</span>';
  const W=opts.w||220,H=opts.h||40,pad=4;
  const min=Math.min(...data),max=Math.max(...data);
  const x=i=>pad+i*(W-2*pad)/(data.length-1), y=v=>pad+(1-(v-min)/(max-min||1))*(H-2*pad);
  const pts=data.map((v,i)=>[x(i),y(v)]);
  const line=smoothPath(pts);
  const up=data[data.length-1]>=data[0];
  const col=opts.color||(up?'var(--green)':'var(--red)');
  const fill=opts.fill||(up?'var(--green-tint)':'var(--red-tint)');
  const lx=x(data.length-1),ly=y(data[data.length-1]);
  const area=line+' L'+lx.toFixed(1)+','+H+' L'+x(0).toFixed(1)+','+H+' Z';
  return '<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none" style="width:100%;height:'+H+'px;display:block;"><path d="'+area+'" fill="'+fill+'"/><path pathLength="1" d="'+line+'" fill="none" stroke="'+col+'" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/><circle cx="'+lx.toFixed(1)+'" cy="'+ly.toFixed(1)+'" r="2.5" fill="'+col+'"/></svg>';
}
// small vertical bar chart from [{date,value}]
function macroMiniBars(hist,n,color){
  const data=(hist||[]).slice(-n).filter(d=>d.value!=null&&!isNaN(d.value));
  if(data.length<2) return '<span style="color:var(--text-4);font-size:11px;">— no history</span>';
  const max=Math.max(...data.map(d=>d.value)),min=Math.min(...data.map(d=>d.value)),range=max-min||1;
  return '<div style="display:flex;align-items:flex-end;gap:6px;height:64px;">'+data.map(d=>{const h=18+(d.value-min)/range*38;return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;"><div style="width:100%;background:'+(color||'var(--accent)')+';border-radius:3px 3px 0 0;height:'+h.toFixed(0)+'px;opacity:.85;"></div><div style="font-size:8.5px;font-family:var(--font-mono);color:var(--text-4);">'+((d.date||'').slice(2,7))+'</div></div>';}).join('')+'</div>';
}
function mCard(label,value,sub,cls){return '<div class="metric-card '+(cls||'')+'" data-explain="'+label+'"><div class="metric-label">'+label+'</div><div class="metric-value">'+value+'</div>'+(sub?'<div style="font-size:10.5px;font-family:var(--font-mono);color:var(--text-4);margin-top:5px;">'+sub+'</div>':'')+'<span class="xspark" title="Ask Numa">✦</span></div>';}
function curveBadge(sig){if(!sig)return '<span class="badge badge-grey">—</span>';const s=sig.toLowerCase();const cls=s.includes('invert')?'badge-red':s.includes('flat')?'badge-amber':'badge-green';return '<span class="badge '+cls+'">'+sig+'</span>';}
function fomcRow(m){
  const hold=m.prob_hold,cut=m.prob_cut_25bps,has=hold!=null&&cut!=null;
  const bar=has?'<span style="display:inline-flex;width:118px;height:8px;border-radius:9999px;overflow:hidden;background:var(--border-soft);"><span style="width:'+hold+'%;background:var(--text-4);"></span><span style="width:'+cut+'%;background:var(--accent);"></span></span>':'';
  return '<div style="display:flex;align-items:center;gap:13px;padding:8px 0;border-bottom:1px solid var(--border-soft);font-size:12.5px;"><span class="mono" style="width:74px;color:var(--text);font-weight:600;">'+m.meeting+'</span><span class="mono" style="width:74px;color:var(--text-3);">'+(has?hold+'% hold':'—')+'</span><span class="mono" style="width:64px;color:var(--accent-2);">'+(has?cut+'% cut':'')+'</span><span style="margin-left:auto;">'+bar+'</span></div>';
}
function dcfImplication(t10){
  if(t10==null) return '10Y yield unavailable — add a FRED API key to compute the discount-rate implication.';
  if(t10<2) return 'Low discount rate environment. Growth stock multiples historically stretched higher. Long-duration assets favored.';
  if(t10<3.5) return 'Moderate discount rate. Balanced environment for growth vs value.';
  if(t10<5) return 'Elevated discount rate. Cash flows beyond year 8-10 face significant present value headwinds. Growth premium compressed.';
  return 'High discount rate. Severe multiple compression for long-duration assets. Value and dividend stocks favored.';
}
function inflationSignal(inf){
  const core=inf.pce_core_yoy!=null?inf.pce_core_yoy:inf.cpi_core_yoy;
  if(core==null) return 'Inflation data requires a FRED API key.';
  const dist=Math.round((core-2)*100);
  if(core>3) return 'Core inflation at '+core+'% — well above the Fed 2% target ('+dist+'bps over). Restrictive policy likely sustained; cuts require clear disinflation.';
  if(core>2.3) return 'Core PCE at '+core+'% — '+dist+'bps above the Fed 2% target. Cuts require further progress; market pricing assumes disinflation continues.';
  if(core>=1.7) return 'Core inflation at '+core+'% — effectively at the Fed 2% target. Policy has room to ease if labor softens.';
  return 'Core inflation at '+core+'% — below the Fed 2% target. Disinflation gives the Fed latitude to cut.';
}
function riskSignal(mc){
  if(!mc||mc.vix==null) return 'Market-condition data unavailable.';
  const vol=mc.vix_20d_avg!=null?(mc.vix<mc.vix_20d_avg?'VIX below its 20-day average — volatility compressing, risk-on tone.':'VIX above its 20-day average — volatility expanding, risk-off tone.'):('VIX at '+mc.vix+'.');
  const reg=mc.spy_vs_200ma_pct!=null?(' SPY '+(mc.spy_vs_200ma_pct>0?'above':'below')+' its 200-day MA confirms a '+String(mc.market_regime||'').toLowerCase()+' regime.'):'';
  const dxy=mc.dxy_change_1m!=null?(' Dollar '+(mc.dxy_change_1m<0?'weakening — tailwind for US multinationals.':'strengthening — headwind for US multinationals.')):'';
  return vol+reg+dxy;
}
function pceTargetBadge(core){if(core==null)return '<span class="badge badge-grey">—</span>';if(core<=2.2)return '<span class="badge badge-green">On target</span>';if(core<=3)return '<span class="badge badge-amber">Above</span>';return '<span class="badge badge-red">Well Above</span>';}
function growthBadge(y){if(y==null)return '<span class="badge badge-grey">—</span>';if(y>2)return '<span class="badge badge-green">Expansion</span>';if(y>=0)return '<span class="badge badge-amber">Slow Growth</span>';return '<span class="badge badge-red">Contraction</span>';}
function eventTypeBadge(type){const map={fomc:['badge-red','FOMC'],inflation:['badge-amber','INFLATION'],labor:['badge-blue','LABOR'],growth:['badge-green','GROWTH']};const m=map[type]||['badge-grey',String(type||'').toUpperCase()];return '<span class="badge '+m[0]+'">'+m[1]+'</span>';}
function eventRow(e){
  const days=e.days_away,crit=e.type==='fomc';
  let rs='',dc='var(--text-3)';
  if(days<=3){rs='border-left:3px solid var(--red);background:var(--red-tint);';dc='var(--red)';}
  else if(days<=7){rs='border-left:3px solid var(--amber);background:var(--amber-tint);';dc='var(--amber)';}
  const away=days<=0?'today':'in '+days+' day'+(days===1?'':'s');
  return '<div style="display:flex;align-items:center;gap:13px;padding:9px 12px;border-radius:8px;'+rs+'font-size:12.5px;margin-bottom:5px;"><span class="mono" style="width:56px;color:var(--text-2);">'+fmtEventDate(e.date)+'</span><span style="flex:1;color:var(--text);font-weight:500;">'+(crit?'<span style="color:var(--red);">★</span> ':'')+e.event+'</span><span class="mono" style="width:84px;text-align:right;color:'+dc+';">'+away+'</span>'+(crit?'<span class="badge badge-red">★ CRITICAL</span>':eventTypeBadge(e.type))+'</div>';
}
function macroSkeleton(){
  return '<div class="skel" style="height:92px;margin-bottom:16px;"></div>'+
    '<div class="skel" style="height:300px;margin-bottom:16px;"></div>'+
    '<div class="skel" style="height:240px;margin-bottom:16px;"></div>'+
    '<div class="skel" style="height:200px;margin-bottom:16px;"></div>'+
    '<div class="skel" style="height:200px;"></div>';
}
// Compact macro strip for the Overview — global rate/inflation/vol backdrop.
function macroStripHTML(){
  if(MACRO_DATA&&MACRO_DATA.error) return '';
  const m=MACRO_DATA||{},r=m.rates||{},inf=m.inflation||{},mc=m.market_conditions||{},fp=m.fed_probabilities||{};
  const v=o=>o&&o.value!=null?o.value:null;
  const head='<div class="card-title">Macro Backdrop <span class="viewall">View all →</span></div>';
  if(!MACRO_DATA){
    return `<div class="card prev" data-goto="macro" style="margin-bottom:16px;">${head}<div style="font-size:12px;color:var(--text-4);">Loading macro environment…</div></div>`;
  }
  const d='—';
  const t10=v(r.treasury_10y),t2=v(r.treasury_2y),ff=v(r.fed_funds);
  const sig=r.yield_curve_signal||'';
  const curveCol=sig.toLowerCase().includes('invert')?'var(--red)':sig.toLowerCase().includes('flat')?'var(--amber)':sig?'var(--green)':'var(--text-3)';
  const regCol=mc.market_regime==='Bull'?'var(--green)':mc.market_regime==='Bear'?'var(--red)':'var(--text-3)';
  const vixCol=mc.vix_signal==='Elevated'?'var(--red)':mc.vix_signal==='Low'?'var(--green)':'var(--amber)';
  const pill=(lbl,val,col)=>`<span><span class="lbl">${lbl}:</span> <span${col?` style="color:${col};"`:''}>${val}</span></span>`;
  const pills=[
    pill('10Y',t10!=null?mNum(t10)+'%':d),
    pill('2Y',t2!=null?mNum(t2)+'%':d),
    pill('Curve',(r.spread_10y_2y!=null?mBps(r.spread_10y_2y):d)+(sig?' '+sig:''),curveCol),
    pill('Fed',fp.current_range||(ff!=null?mNum(ff)+'%':d)),
    pill('CPI',inf.cpi_yoy!=null?mSign(inf.cpi_yoy,1,'%'):d),
    pill('Core PCE',inf.pce_core_yoy!=null?mSign(inf.pce_core_yoy,1,'%'):d),
    pill('VIX',mc.vix!=null?mNum(mc.vix,1):d,vixCol),
    pill('Regime',mc.market_regime||d,regCol),
  ].join('');
  return `<div class="card prev" data-goto="macro" style="margin-bottom:16px;">${head}<div class="cb-stats" style="margin-top:0;">${pills}</div></div>`;
}
function buildMacroHTML(m){
  const r=m.rates||{},l=m.labor||{},inf=m.inflation||{},g=m.growth||{},mc=m.market_conditions||{},fp=m.fed_probabilities||{};
  const v=o=>o&&o.value!=null?o.value:null;
  const t10=v(r.treasury_10y),t2=v(r.treasury_2y),t30=v(r.treasury_30y),ff=v(r.fed_funds),mort=v(r.mortgage_30y);
  const inputs=`10Y ${t10!=null?t10+'%':'—'} · Fed ${ff!=null?ff+'%':'—'} · CPI ${inf.cpi_yoy!=null?inf.cpi_yoy+'%':'—'} · VIX ${mc.vix!=null?mc.vix:'—'}`;
  const spreadTxt=r.spread_10y_2y!=null?mBps(r.spread_10y_2y):'—';
  const fedVal=fp.current_range||(ff!=null?mNum(ff)+'%':'—');
  const impliedDR=t10!=null?(t10+5):null;
  const fomcRows=(fp.meetings||[]).map(fomcRow).join('')||'<div style="font-size:12px;color:var(--text-4);">FOMC probabilities require Fed funds futures data.</div>';

  // ── Fed & Rates ──
  const ratesCard=`<div class="card"><div class="card-title">Fed &amp; Rates <span class="free">free · FRED + futures</span></div>
    <div class="metrics-grid" style="margin-bottom:14px;">
      ${mCard('Fed Funds',fedVal,r.fed_funds&&r.fed_funds.date?'as of '+r.fed_funds.date:'effective rate','blue')}
      ${mCard('10Y Treasury',t10!=null?mNum(t10)+'%':'—',r.treasury_10y&&r.treasury_10y.change!=null?mBps(r.treasury_10y.change)+' vs prior':'',t10!=null?'amber':'')}
      ${mCard('2Y Treasury',t2!=null?mNum(t2)+'%':'—',r.treasury_2y&&r.treasury_2y.change!=null?mBps(r.treasury_2y.change)+' vs prior':'',t2!=null?'amber':'')}
    </div>
    <div class="statlist" style="margin-bottom:16px;">
      <div class="stat"><span class="l">Yield Curve (10Y–2Y)</span><span class="v">${spreadTxt} &nbsp; ${curveBadge(r.yield_curve_signal)}</span></div>
      <div class="stat"><span class="l">Equity Risk Premium</span><span class="v">${r.equity_risk_premium!=null?mSign(r.equity_risk_premium,2,'%'):'—'}</span></div>
      <div class="stat"><span class="l">S&amp;P 500 Earnings Yield</span><span class="v">${r.sp500_earnings_yield!=null?mNum(r.sp500_earnings_yield)+'%':'—'}</span></div>
      <div class="stat"><span class="l">30Y Treasury</span><span class="v">${t30!=null?mNum(t30)+'%':'—'}</span></div>
      <div class="stat"><span class="l">30Y Mortgage</span><span class="v">${mort!=null?mNum(mort)+'%':'—'}</span></div>
      <div class="stat"><span class="l">Implied discount rate (10Y+5% ERP)</span><span class="v">${impliedDR!=null?'~'+mNum(impliedDR)+'%':'—'}</span></div>
    </div>
    <div class="section-header">FOMC Probability</div>
    ${fomcRows}
    <div class="section-header" style="margin-top:16px;">DCF Implication</div>
    <div style="background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:10px;padding:12px 14px;font-size:12.5px;color:var(--text-2);line-height:1.6;">
      ${impliedDR!=null?'<b style="color:var(--text);">Implied discount rate (10Y + 5% ERP): ~'+mNum(impliedDR)+'%</b><br>':''}
      ${dcfImplication(t10)}
    </div>
  </div>`;

  // ── Yield Curve chart ──
  const hasCurveHist=(r.t10y_history||[]).length>1;
  const curveCard=`<div class="card"><div class="card-title">Yield Curve — 10Y vs 2Y (1Y) <span class="free">blue 10Y · amber 2Y · spread below</span></div>
    ${hasCurveHist?'<div id="macroYieldChart" style="height:260px;background:var(--bg);border:1px solid var(--border-soft);border-radius:12px;"></div><div id="macroSpreadChart" style="height:92px;background:var(--bg);border:1px solid var(--border-soft);border-radius:12px;margin-top:8px;"></div>':'<div class="empty" style="padding:34px 20px;"><h3>No yield history</h3><p>Treasury yield history requires a FRED API key.</p></div>'}
  </div>`;

  // ── Labor ──
  const u3=v(l.unemployment_rate),u6=v(l.u6_rate),claims=v(l.initial_claims),jolts=v(l.jolts_openings);
  const u3chg=l.unemployment_rate&&l.unemployment_rate.change!=null?l.unemployment_rate.change:null;
  const laborCard=`<div class="card"><div class="card-title">Labor Market <span class="free">free · FRED (BLS)</span></div>
    <div class="metrics-grid" style="margin-bottom:14px;">
      ${mCard('Unemployment (U-3)',u3!=null?mNum(u3,1)+'%':'—',u3chg!=null?(u3chg>0?'▲ +':'▼ ')+mNum(u3chg,1)+'pp':'',u3chg!=null?(u3chg>0?'red':'green'):'')}
      ${mCard('Underemployment (U-6)',u6!=null?mNum(u6,1)+'%':'—','broadest measure')}
      ${mCard('NFP — last print',l.nfp_change_mom!=null?(l.nfp_change_mom>0?'+':'')+l.nfp_change_mom.toLocaleString():'—','month-over-month',l.nfp_change_mom!=null?(l.nfp_change_mom>0?'green':'red'):'')}
    </div>
    <div class="statlist" style="margin-bottom:14px;">
      <div class="stat"><span class="l">Initial Jobless Claims (weekly)</span><span class="v">${claims!=null?Math.round(claims).toLocaleString():'—'}</span></div>
      <div class="stat"><span class="l">JOLTS Job Openings</span><span class="v">${jolts!=null?fmtLarge(jolts*1000):'—'}</span></div>
    </div>
    <div class="metric-label" style="margin-bottom:6px;">Unemployment — 24-month trend</div>
    ${macroSpark(l.unrate_history,{color:'var(--accent)',fill:'var(--accent-soft)'})}
  </div>`;

  // ── Inflation ──
  const corePCE=inf.pce_core_yoy!=null?inf.pce_core_yoy:null;
  const gaugeCore=corePCE!=null?corePCE:(inf.cpi_core_yoy!=null?inf.cpi_core_yoy:null);
  const gpos=gaugeCore!=null?Math.max(2,Math.min(98,gaugeCore/5*100)):null;
  const inflCard=`<div class="card"><div class="card-title">Inflation <span class="free">free · FRED (BLS/BEA)</span></div>
    <div class="metrics-grid" style="margin-bottom:14px;">
      ${mCard('CPI (YoY)',inf.cpi_yoy!=null?mSign(inf.cpi_yoy,1,'%'):'—','headline')}
      ${mCard('Core CPI (YoY)',inf.cpi_core_yoy!=null?mSign(inf.cpi_core_yoy,1,'%'):'—','ex food &amp; energy')}
      ${mCard('PCE (YoY)',inf.pce_yoy!=null?mSign(inf.pce_yoy,1,'%'):'—','headline')}
      ${mCard('Core PCE (YoY)',corePCE!=null?mSign(corePCE,1,'%'):'—','Fed&#39;s preferred',corePCE!=null?(corePCE>2.2?'amber':'green'):'')}
      ${mCard('PPI',inf.ppi&&inf.ppi.value!=null?mNum(inf.ppi.value,1):'—','all commodities')}
      ${mCard('Core PCE vs Target','&nbsp;',pceTargetBadge(corePCE))}
    </div>
    <div class="metric-label" style="margin-bottom:6px;">Distance from Fed 2% target (0–5%)</div>
    <div style="position:relative;height:8px;border-radius:9999px;background:linear-gradient(90deg,var(--green),var(--amber),var(--red));margin:6px 0 4px;">
      <span style="position:absolute;left:40%;top:-4px;width:2px;height:16px;background:var(--text);opacity:.55;" title="2% target"></span>
      ${gpos!=null?'<span class="gauge-marker" style="left:'+gpos+'%;"></span>':''}
    </div>
    <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-4);margin-bottom:12px;"><span>0%</span><span style="color:var(--text-3);">Fed 2% target</span><span>5%</span></div>
    <div style="background:var(--bg-subtle);border:1px solid var(--border-soft);border-radius:9px;padding:11px 13px;font-size:12.5px;color:var(--text-2);line-height:1.6;"><b style="color:var(--text);">Rate signal:</b> ${inflationSignal(inf)}</div>
  </div>`;

  // ── Growth ──
  const gdpLast=g.gdp_real&&g.gdp_real.value!=null?g.gdp_real.value:null;
  const growthCard=`<div class="card"><div class="card-title">Growth <span class="free">free · FRED (BEA)</span></div>
    <div class="metrics-grid" style="margin-bottom:14px;">
      ${mCard('Real GDP (YoY)',g.gdp_yoy!=null?mSign(g.gdp_yoy,1,'%'):'—','&nbsp;'+'',g.gdp_yoy!=null?(g.gdp_yoy>0?'green':'red'):'')}
      ${mCard('Consumer Sentiment',g.consumer_sentiment&&g.consumer_sentiment.value!=null?mNum(g.consumer_sentiment.value,1):'—','U Michigan')}
      ${mCard('Real GDP (level)',gdpLast!=null?fmtLarge(gdpLast*1e9):'—','last quarter, real')}
    </div>
    <div class="statlist" style="margin-bottom:14px;">
      <div class="stat"><span class="l">Expansion / Contraction</span><span class="v">${growthBadge(g.gdp_yoy)}</span></div>
      <div class="stat"><span class="l">Retail Sales (index)</span><span class="v">${g.retail_sales&&g.retail_sales.value!=null?fmtLarge(g.retail_sales.value*1e6):'—'}</span></div>
    </div>
    <div class="metric-label" style="margin-bottom:8px;">Real GDP — recent quarters</div>
    ${macroMiniBars(g.gdp_history,8,'var(--accent)')}
  </div>`;

  // ── Market Conditions ──
  const mktCard=`<div class="card"><div class="card-title">Market Conditions <span class="free">free · yfinance indices</span></div>
    <div class="metrics-grid" style="margin-bottom:14px;">
      ${mCard('VIX',mc.vix!=null?mNum(mc.vix,1):'—',(mc.vix_20d_avg!=null?'20d avg '+mNum(mc.vix_20d_avg,1)+' · ':'')+(mc.vix_signal||''),mc.vix_signal==='Elevated'?'red':mc.vix_signal==='Low'?'green':'amber')}
      ${mCard('SPY vs 200MA',mc.spy_vs_200ma_pct!=null?mSign(mc.spy_vs_200ma_pct,1,'%'):'—',mc.market_regime?mc.market_regime+' regime':'',mc.spy_vs_200ma_pct!=null?(mc.spy_vs_200ma_pct>0?'green':'red'):'')}
      ${mCard('Dollar (DXY)',mc.dxy!=null?mNum(mc.dxy,1):'—',mc.dxy_change_1m!=null?mSign(mc.dxy_change_1m,1,'%')+' 1M':'',mc.dxy_change_1m!=null?(mc.dxy_change_1m<0?'green':'red'):'')}
      ${mCard('Long Bonds (TLT)',mc.tlt_price!=null?'$'+mNum(mc.tlt_price,2):'—',mc.tlt_change_1m!=null?mSign(mc.tlt_change_1m,1,'%')+' 1M':'',mc.tlt_change_1m!=null?(mc.tlt_change_1m>0?'green':'red'):'')}
      ${mCard('Market Regime','&nbsp;',mc.market_regime||'—')}
      ${mCard('SPY',mc.spy_price!=null?'$'+mNum(mc.spy_price,2):'—','S&amp;P 500 proxy')}
    </div>
    <div class="metric-label" style="margin-bottom:6px;">VIX — last 30 days</div>
    ${macroSpark(mc.vix_history,{color:'var(--violet)',fill:'var(--violet-tint)'})}
    <div style="background:var(--bg-subtle);border:1px solid var(--border-soft);border-radius:9px;padding:11px 13px;font-size:12.5px;color:var(--text-2);line-height:1.6;margin-top:14px;"><b style="color:var(--text);">Risk signal:</b> ${riskSignal(mc)}</div>
  </div>`;

  // ── Events ──
  let evs=(m.upcoming_events||[]).filter(e=>e.days_away<=62);
  if(!evs.length) evs=(m.upcoming_events||[]);
  const eventsCard=`<div class="card"><div class="card-title">Events Calendar (Next 60 Days) <span class="free">${evs.length} releases</span></div>
    ${evs.length?evs.map(eventRow).join(''):'<div style="font-size:12px;color:var(--text-4);">No upcoming events in window.</div>'}
    <div style="margin-top:10px;font-size:10px;color:var(--text-4);"><span style="color:var(--red);">■</span> ≤3 days &nbsp; <span style="color:var(--amber);">■</span> ≤7 days &nbsp; ★ FOMC critical</div>
  </div>`;

  return aiBar('Macro','Indicators are loaded &amp; free. Interpret implications only when you want.',inputs,['rateimpact','rotationsignal','dcfread'])
    +ratesCard+curveCard+laborCard+inflCard+growthCard+mktCard+eventsCard;
}
// Yield-curve chart (10Y + 2Y lines) with a spread histogram sub-panel.
function buildMacroCharts(){
  const el=document.getElementById('macroYieldChart');
  if(!el||!window.LightweightCharts||!MACRO_DATA||!MACRO_DATA.rates) return;
  const r=MACRO_DATA.rates;
  const h10=(r.t10y_history||[]).filter(d=>d.value!=null&&!isNaN(d.value));
  const h2=(r.t2y_history||[]).filter(d=>d.value!=null&&!isNaN(d.value));
  if(h10.length<2) return;
  const dk=document.documentElement.dataset.theme==='dark';
  const P=dk?{bg:'#1f232b',txt:'#aeb6c2',grid:'#2a2f39',bd:'#343b46',s10:'#5b8cff',s2:'#e0a83a',up:'rgba(46,194,126,0.5)',dn:'rgba(239,90,111,0.5)'}:{bg:'#ffffff',txt:'#3a3f4b',grid:'#eef0f3',bd:'#e8e8ec',s10:'#2f6df0',s2:'#d98a1a',up:'rgba(31,157,87,0.55)',dn:'rgba(210,58,58,0.55)'};
  const mk=(node,h,opt)=>LightweightCharts.createChart(node,Object.assign({layout:{background:{color:P.bg},textColor:P.txt},grid:{vertLines:{color:P.grid},horzLines:{color:P.grid}},rightPriceScale:{borderColor:P.bd},timeScale:{borderColor:P.bd,timeVisible:false},width:node.clientWidth,height:h},opt||{}));
  try{
    el.innerHTML='';
    const chart=mk(el,260); const charts=[chart];
    chart.addLineSeries({color:P.s10,lineWidth:2,title:'10Y'}).setData(h10.map(d=>({time:d.date,value:d.value})));
    chart.addLineSeries({color:P.s2,lineWidth:2,title:'2Y'}).setData(h2.map(d=>({time:d.date,value:d.value})));
    chart.timeScale().fitContent();
    new ResizeObserver(()=>{try{chart.applyOptions({width:el.clientWidth});}catch(e){}}).observe(el);
    const sEl=document.getElementById('macroSpreadChart');
    if(sEl){
      sEl.innerHTML='';
      const sc=mk(sEl,92,{timeScale:{visible:false,borderColor:P.bd}}); charts.push(sc);
      const m2=new Map(h2.map(d=>[d.date,d.value]));
      const spread=h10.filter(d=>m2.has(d.date)).map(d=>{const s=+(d.value-m2.get(d.date)).toFixed(3);return {time:d.date,value:s,color:s>=0?P.up:P.dn};});
      sc.addHistogramSeries({priceFormat:{type:'price',precision:2,minMove:0.01}}).setData(spread);
      sc.timeScale().fitContent();
      new ResizeObserver(()=>{try{sc.applyOptions({width:sEl.clientWidth});}catch(e){}}).observe(sEl);
      let _s=false;
      charts.forEach(src=>{src.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(_s||!range)return;_s=true;charts.forEach(o=>{if(o!==src){try{o.timeScale().setVisibleLogicalRange(range);}catch(e){}}});_s=false;});});
    }
  }catch(e){}
}
// Macro snapshot injected into Numa's context on every call.
function buildMacroContextBlock(){
  if(!MACRO_DATA) return "\nMACRO: Not loaded. If the user asks about the rate environment, the Fed, or macro conditions, tell them they can load the live macro snapshot by clicking the Macro tab.";
  if(MACRO_DATA.error) return "\nMACRO: Unavailable ("+MACRO_DATA.error+").";
  const r=MACRO_DATA.rates||{},l=MACRO_DATA.labor||{},inf=MACRO_DATA.inflation||{},mc=MACRO_DATA.market_conditions||{},fp=MACRO_DATA.fed_probabilities||{};
  const t10=r.treasury_10y?r.treasury_10y.value:null;
  const m0=(fp.meetings||[])[0];
  const dr=(t10!=null&&r.equity_risk_premium!=null)?(t10+(r.equity_risk_premium>0?5:4)).toFixed(1)+'%':'N/A';
  const disc=t10!=null?Math.round((1-Math.pow(1/(1+t10/100),10))*100):'N/A';
  return `
MACRO ENVIRONMENT:
Fed Funds: ${fp.current_range||(r.fed_funds&&r.fed_funds.value!=null?r.fed_funds.value+'%':'N/A')} | Next FOMC: ${m0?m0.meeting:'N/A'}${m0&&m0.prob_hold!=null?' ('+m0.prob_hold+'% hold, '+m0.prob_cut_25bps+'% cut)':''}
10Y Treasury: ${t10!=null?t10+'%':'N/A'} | 2Y Treasury: ${r.treasury_2y&&r.treasury_2y.value!=null?r.treasury_2y.value+'%':'N/A'} | Spread: ${r.spread_10y_2y!=null?(r.spread_10y_2y>0?'+':'')+Math.round(r.spread_10y_2y*100)+'bps':'N/A'} (${r.yield_curve_signal||'N/A'})
Equity Risk Premium: ${r.equity_risk_premium!=null?(r.equity_risk_premium>0?'+':'')+r.equity_risk_premium+'%':'N/A'} | Implied discount rate: ~${dr}

INFLATION: CPI YoY ${inf.cpi_yoy!=null?inf.cpi_yoy+'%':'N/A'} | Core CPI ${inf.cpi_core_yoy!=null?inf.cpi_core_yoy+'%':'N/A'} | PCE ${inf.pce_yoy!=null?inf.pce_yoy+'%':'N/A'} | Core PCE ${inf.pce_core_yoy!=null?inf.pce_core_yoy+'%':'N/A'}
LABOR: Unemployment ${l.unemployment_rate&&l.unemployment_rate.value!=null?l.unemployment_rate.value+'%':'N/A'} | NFP last: ${l.nfp_change_mom!=null?(l.nfp_change_mom>0?'+':'')+l.nfp_change_mom.toLocaleString()+' jobs':'N/A'} | Initial claims ${l.initial_claims&&l.initial_claims.value!=null?Math.round(l.initial_claims.value).toLocaleString():'N/A'}
MARKET: VIX ${mc.vix!=null?mc.vix:'N/A'}${mc.vix_20d_avg!=null?' (20d avg '+mc.vix_20d_avg+')':''} | SPY vs 200MA: ${mc.spy_vs_200ma_pct!=null?(mc.spy_vs_200ma_pct>0?'+':'')+mc.spy_vs_200ma_pct+'% ('+(mc.market_regime||'')+')':'N/A'} | DXY ${mc.dxy!=null?mc.dxy:'N/A'}${mc.dxy_change_1m!=null?' ('+(mc.dxy_change_1m>0?'+':'')+mc.dxy_change_1m+'% 1M)':''}

DCF CONTEXT: At a 10Y yield of ${t10!=null?t10+'%':'N/A'}, cash flows 10+ years out are discounted ${disc}${disc!=='N/A'?'%':''} relative to par. Growth-stock multiples face a structural headwind at yields above 4%.`;
}

