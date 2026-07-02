/* ============ VALUATION VERDICT (growth-adjusted, robust to cyclical outliers) ============ */
// Robust peer P/E benchmark: MEDIAN of peers' trailing P/E, excluding the target itself
// and non-meaningful values (<=0 or >80 — usually trough/NM earnings, e.g. a cyclical semi
// at 179x). A plain mean of trailing P/Es is junk for cyclicals; one outlier poisons it.
function peerPEMedian(pr){
  const vals=(((pr||{}).companies)||[]).filter(c=>!c.is_target&&c.pe_trailing!=null&&c.pe_trailing>0&&c.pe_trailing<=80).map(c=>c.pe_trailing).sort((a,b)=>a-b);
  if(!vals.length) return null;
  const m=Math.floor(vals.length/2);
  return vals.length%2?vals[m]:(vals[m-1]+vals[m])/2;
}
// Growth-adjusted valuation verdict. PEG-led (a high multiple with fast growth is NOT a
// "discount"); falls back to forward P/E, then trailing P/E, each vs the robust peer median.
// Returns {label,color,tone,basis}. Never paints an absolutely-high multiple green as cheap.
function valuationVerdict(f,pr){
  f=f||{};
  const peg=f.peg_ratio, petr=f.pe_trailing, pefw=f.pe_forward, med=peerPEMedian(pr);
  if(peg!=null&&peg>0){
    if(peg<1)  return {label:'Cheap',    color:'var(--green)',tone:'pos',    basis:`PEG ${fmt(peg)} — growth more than covers the ${petr!=null?fmt(petr)+'×':''} multiple`};
    if(peg>2)  return {label:'Expensive',color:'var(--amber)',tone:'warn',   basis:`PEG ${fmt(peg)} — the multiple runs ahead of growth`};
    return       {label:'Fair',     color:'var(--text)', tone:'neutral',basis:`PEG ${fmt(peg)} — the multiple roughly tracks growth`};
  }
  if(pefw!=null&&med!=null){
    if(pefw<med*0.9) return {label:'Cheap',    color:'var(--green)',tone:'pos', basis:`${fmt(pefw)}× fwd P/E vs ${fmt(med)}× peer median`};
    if(pefw>med*1.1) return {label:'Expensive',color:'var(--amber)',tone:'warn',basis:`${fmt(pefw)}× fwd P/E vs ${fmt(med)}× peer median`};
    return            {label:'Fair',     color:'var(--text)', tone:'neutral',basis:`${fmt(pefw)}× fwd P/E ≈ ${fmt(med)}× peer median`};
  }
  if(petr!=null&&med!=null){
    if(petr>med*1.1) return {label:'Rich',       color:'var(--amber)',tone:'warn',   basis:`${fmt(petr)}× trailing vs ${fmt(med)}× peer median`};
    if(petr<med*0.9) return {label:'Below peers',color:'var(--text)', tone:'neutral',basis:`${fmt(petr)}× trailing vs ${fmt(med)}× peer median`};
    return            {label:'In-line',   color:'var(--text)', tone:'neutral',basis:`${fmt(petr)}× trailing vs ${fmt(med)}× peer median`};
  }
  return {label:'—',color:'var(--text)',tone:'neutral',basis:''};
}

/* ============ SECTION RENDERERS (real data) ============ */
const SECTIONS={
  overview:()=>{
    const D=DATA, f=D.financials||{}, q=D.quote||{}, ar=D.analyst_ratings||{}, e=D.earnings||{}, o=D.options_flow||{}, ins=D.insider_activity||{}, t=D.technicals||{}, n=D.news_sentiment||{}, pr=D.peers||{}, c=D.company||{};
    const margin=(f.margins&&f.margins[0])||{};
    const sc=n.sentiment?n.sentiment.score:null;
    const techV=(t.macd_trend==='Bullish'&&t.price_vs_sma50==='above')?['Bullish','var(--green)']:(t.macd_trend==='Bearish'&&t.price_vs_sma50==='below')?['Bearish','var(--red)']:['Mixed','var(--amber)'];
    const optV=(o.overall_sentiment||'').includes('Bull')?[o.overall_sentiment,'var(--green)']:(o.overall_sentiment||'').includes('Bear')?[o.overall_sentiment,'var(--red)']:[o.overall_sentiment||'Neutral','var(--amber)'];
    const insV=ins.sentiment==='Bullish'?['Bullish','var(--green)']:ins.sentiment==='Bearish'?['Bearish','var(--red)']:['Neutral','var(--amber)'];
    const newsV=sc>0.1?['Positive','var(--green)']:sc<-0.1?['Negative','var(--red)']:['Neutral','var(--amber)'];
    const _vv=valuationVerdict(f,pr); const valV=[_vv.label,_vv.color];
    const earnColor=(e.days_until_earnings!=null&&e.days_until_earnings<30)?'var(--red)':(e.days_until_earnings!=null&&e.days_until_earnings<60)?'var(--amber)':'var(--text)';
    const netSign=(ins.net_buying_30d||0)>=0?'+':'−';
    const sb=ar.strong_buy_count||0,bu=ar.buy_count||0,ho=ar.hold_count||0,se=ar.sell_count||0,ss=ar.strong_sell_count||0;
    const ratebar=`<div class="rate-bar">${sb?`<div style="flex:${sb};background:var(--green);"></div>`:''}${bu?`<div style="flex:${bu};background:var(--green);opacity:.55;"></div>`:''}${ho?`<div style="flex:${ho};background:var(--text-4);"></div>`:''}${se?`<div style="flex:${se};background:var(--red);opacity:.6;"></div>`:''}${ss?`<div style="flex:${ss};background:var(--red);"></div>`:''}</div>`;
    const consColor=(ar.consensus||'').includes('Buy')?'badge-green':(ar.consensus||'').includes('Sell')?'badge-red':'badge-grey';
    const arts=(n.articles||[]).slice(0,3).map(a=>pnews('var(--text-4)',a.headline||'—',`${a.source||''} · ${a.datetime||''}`)).join('')||'<div style="font-size:12px;color:var(--text-4);">No headlines loaded.</div>';
    const peerRows=(pr.companies||[]).slice(0,4).map(p=>prow(p.ticker,p.pe_trailing!=null?fmt(p.pe_trailing)+'×':'—',p.revenue_growth!=null?(p.revenue_growth>0?'+':'')+fmt(p.revenue_growth)+'%':'—',p.is_target)).join('');
    let congPrev;
    const cg=D.congressional_trades;
    if(cg&&cg.trades&&cg.trades.length){congPrev=cg.trades.slice(0,4).map(tt=>pcng(tt.politician,tt.type,tt.amount_range)).join('');}
    else{congPrev=`<div style="font-size:12px;color:var(--text-4);line-height:1.5;">Enable <b style="color:var(--text-2);">Premium</b> for congressional trade disclosures.</div>`;}
    return aiBar('Overview','A 360° snapshot is loaded & free. Synthesize it only when you want.',inputsLineFor('verdict'),['bullbear','valverdict'])+`
    <div class="card" style="padding:16px 18px;"><div class="card-title">360° Signal Summary <span class="free">every domain at a glance · click any tile to drill in</span></div>
      <div class="sig-grid">
        ${sig('chart','Technicals',I.trend,techV[0],techV[1],`RSI ${fmt(t.rsi)} · ${t.price_vs_sma50==='above'?'above':'below'} SMA50`)}
        ${sig('options','Options Flow',I.stack,optV[0]||'—',optV[1],`PCR ${o.put_call_ratio!=null?o.put_call_ratio:'—'} · ${o.unusual_contracts_count||0} unusual`)}
        ${sig('insider','Insider',I.eye,insV[0],insV[1],`${netSign}$${fmtLarge(Math.abs(ins.net_buying_30d||0))} · ${ins.buy_count_90d||0} buys (90d)`)}
        ${sig('news','News',I.news,newsV[0],newsV[1],`${sc!=null?(sc>0?'+':'')+sc:'—'} · ${n.articles_count||0} articles`)}
        ${sig('earnings','Earnings',I.cal,e.next_earnings_date||'TBD',earnColor,e.days_until_earnings!=null?`in ${e.days_until_earnings} days`:'date TBD')}
        ${sig('peers','Valuation',I.scale,valV[0],valV[1],`${fmt(f.pe_trailing)}× P/E · PEG ${f.peg_ratio!=null?fmt(f.peg_ratio):'—'}`)}
      </div>
    </div>
    ${macroStripHTML()}
    <div class="ov-cols">
      <div>
        <div class="card"><div class="card-title">Key Metrics <span class="free">free · yfinance</span></div>
          <div class="statlist">
            ${st('P/E Trailing',f.pe_trailing!=null?fmt(f.pe_trailing):'—')}${st('P/E Forward',f.pe_forward!=null?fmt(f.pe_forward):'—')}
            ${st('EV/EBITDA',f.ev_ebitda!=null?fmt(f.ev_ebitda)+'×':'—')}${st('P/S Ratio',f.ps_ratio!=null?fmt(f.ps_ratio)+'×':'—')}
            ${st('PEG Ratio',f.peg_ratio!=null?fmt(f.peg_ratio):'—')}${st('Rev Growth',(f.revenue_growth_yoy&&f.revenue_growth_yoy[0]!=null)?(f.revenue_growth_yoy[0]>0?'+':'')+f.revenue_growth_yoy[0]+'%':'—')}
            ${st('Gross Margin',margin.gross_margin!=null?margin.gross_margin+'%':'—')}${st('Net Margin',margin.net_margin!=null?margin.net_margin+'%':'—')}
            ${st('EPS Fwd',f.eps_forward!=null?'$'+fmt(f.eps_forward):'—')}${st('Net Debt',f.net_debt!=null?fmtLarge(f.net_debt):'—')}
            ${st('Beta',q.beta!=null?fmt(q.beta):'—')}${st('Short Float',q.short_pct_float!=null?(q.short_pct_float*100).toFixed(1)+'%':'—')}
          </div>
        </div>
      </div>
      <div>
        <div class="card"><div class="card-title">Analyst View</div>
          <div class="analyst-tgt">
            <div><div class="metric-label">Consensus</div><div style="margin-top:5px;"><span class="badge ${consColor}" style="font-size:12px;padding:3px 11px;">${ar.consensus||'—'}</span></div></div>
            <div style="margin-left:auto;text-align:right;"><div class="metric-label">12-mo Target</div><div class="metric-value" style="font-size:18px;margin-top:3px;">${ar.target_price_mean!=null?'$'+fmt(ar.target_price_mean):'—'} <span style="font-size:12px;color:${(ar.upside_pct||0)>=0?'var(--green)':'var(--red)'};">${ar.upside_pct!=null?(ar.upside_pct>0?'+':'')+fmt(ar.upside_pct)+'%':''}</span></div></div>
          </div>
          ${ratebar}
          <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;font-family:var(--font-mono);color:var(--text-3);"><span style="color:var(--green);">${sb} Strong Buy</span><span style="color:var(--green);">${bu} Buy</span><span>${ho} Hold</span><span style="color:var(--red);">${se+ss} Sell</span><span style="margin-left:auto;color:var(--text-4);">${ar.total_analysts||0} analysts</span></div>
        </div>
        <div class="card"><div class="card-title">Next Earnings</div>
          <div class="kv">
            <div><div class="metric-label">Date</div><div class="metric-value" style="font-size:17px;color:${earnColor};">${e.next_earnings_date||'TBD'}</div></div>
            <div><div class="metric-label">In</div><div class="metric-value" style="font-size:17px;">${e.days_until_earnings!=null?e.days_until_earnings+' days':'—'}</div></div>
            <div><div class="metric-label">EPS Est</div><div class="metric-value" style="font-size:17px;">${e.eps_estimate_next!=null?'$'+fmt(e.eps_estimate_next):'—'}</div></div>
            <div><div class="metric-label">Beat Rate</div><div class="metric-value" style="font-size:17px;color:var(--green);">${e.beat_rate_pct!=null?e.beat_rate_pct+'%':'—'}</div></div>
          </div>
        </div>
      </div>
    </div>
    <div class="prev-grid">
      <div class="card prev" data-goto="news"><div class="card-title">Top News <span class="viewall">View all →</span></div>${arts}</div>
      <div class="card prev" data-goto="peers"><div class="card-title">Peers <span class="viewall">View all →</span></div>
        <table class="mini"><thead><tr><th style="text-align:left;padding:0 2px 6px;">Ticker</th><th style="text-align:right;padding:0 2px 6px;">P/E</th><th style="text-align:right;padding:0 2px 6px;">Rev Gr</th></tr></thead><tbody>${peerRows}</tbody></table>
      </div>
      <div class="card prev" data-goto="congress"><div class="card-title">Congress <span class="viewall">View all →</span></div>${congPrev}</div>
    </div>`;
  },

  chart:()=>{
    const t=DATA.technicals||{};
    if(t.error||!t.chart_data) return aiBar('Chart','Indicators computed locally & free.',inputsLineFor('technical'),['pattern','confluence','overlay','levels'])+`<div class="card"><div class="empty"><h3>No technical data</h3><p>${t.error||'Price history unavailable for this ticker.'}</p></div></div>`;
    const sup=(t.support_levels||[]).map(s=>'$'+s).join(' · ')||'—';
    const res=(t.resistance_levels||[]).map(s=>'$'+s).join(' · ')||'—';
    const macdC=t.macd_trend==='Bullish'?'var(--green)':'var(--red)';
    const rc=t.regression_channel,fb=t.fib,pe=t.pe_history,pats=t.chart_patterns||[];
    const chLegend=rc?`<div class="ovr-legend"><span style="color:var(--accent-2);font-weight:600;">▱ Regression channel</span><span class="sep">·</span><span>${rc.trend} trend</span><span class="sep">·</span><span>price ${rc.position}</span>${rc.slope_pct_annual!=null?`<span class="sep">·</span><span>slope ${rc.slope_pct_annual>0?'+':''}${rc.slope_pct_annual}%/yr</span>`:''}<span class="sep">·</span><span>band $${rc.lower_end}–$${rc.upper_end}</span></div>`:'';
    const fbLegend=fb?`<div class="ovr-legend"><span style="color:var(--amber);font-weight:600;">⊹ Fibonacci</span><span class="sep">·</span><span>${fb.direction==='up'?'↑ $'+fb.swing_low+'→$'+fb.swing_high:'↓ $'+fb.swing_high+'→$'+fb.swing_low}</span><span class="sep">·</span><span>${fb.levels.filter(l=>l.ratio>0&&l.ratio<1).map(l=>l.label+' $'+l.price).join(' · ')}</span></div>`:'';
    const patChips=pats.length?`<div class="pat-wrap"><div class="pat-head">⚑ Pattern candidates <span style="font-weight:500;text-transform:none;letter-spacing:0;color:var(--text-4);">— algorithmic, verify before trusting</span></div><div class="pat-grid">${pats.map(p=>`<div class="pat-chip"><span class="pc-name">${p.pattern}</span><span class="pc-dir ${p.direction==='bullish'?'bull':'bear'}">${p.direction}</span><span class="pc-conf">conf ${Math.round((p.confidence||0)*100)}%${p.target!=null?' · target $'+p.target:''}</span><span class="pc-note">${p.note||''}</span></div>`).join('')}</div></div>`:`<div class="pat-wrap"><div class="pat-head">⚑ Pattern candidates</div><div style="font-size:12px;color:var(--text-4);">No clean head-and-shoulders, double-top/bottom or cup-and-handle in the recent swing structure.</div></div>`;
    let peCard;
    if(pe){const cls=pe.percentile<25?'cheap':pe.percentile>75?'rich':'fair';const lab=pe.percentile<25?'CHEAP vs its history':pe.percentile>75?'EXPENSIVE vs its history':'FAIR vs its history';
      peCard=`<div class="card"><div class="card-title">Valuation — P/E vs. its own history <span class="free">computed locally · no AI</span></div><div class="pe-summary"><span class="pe-badge ${cls}">${lab}</span><div class="pe-stats"><span><span class="lbl">Current</span>${pe.current}×</span><span><span class="lbl">Percentile</span>${pe.percentile}th</span><span><span class="lbl">${pe.years}y range</span>${pe.min}–${pe.max}×</span><span><span class="lbl">Median</span>${pe.median}×</span></div></div><div id="peChart"></div><div style="margin-top:10px;font-size:11.5px;color:var(--text-4);line-height:1.55;">Trailing P/E = price ÷ TTM EPS over ${pe.years}y (${pe.method==='ttm_reported_eps'?'reported quarterly EPS':'annual EPS'}). Today's ${pe.current}× sits at the ${pe.percentile}th percentile of that range — <b style="color:var(--text-2);">${pe.verdict}</b>. A low percentile can flag a bargain OR a market pricing in falling earnings — read it alongside growth and the rate backdrop.</div></div>`;
    } else { peCard=`<div class="card"><div class="card-title">Valuation — P/E vs. its own history</div><div style="font-size:12px;color:var(--text-4);">Historical P/E unavailable — no usable EPS history (unprofitable, newly listed, or an ETF/index).</div></div>`; }
    return aiBar('Chart','Indicators are computed locally & free. Run an analysis only when you want it.',inputsLineFor('technical'),['pattern','confluence','overlay','levels'])+`
    <div class="card"><div class="card-title">Price Chart <span class="free">TradingView</span></div><div id="tvChart" class="tvchart"></div></div>
    <div class="card"><div class="card-title">Annotated Analysis <span class="free">channel · fibonacci · psych levels · candle signals</span></div><div class="ovr-toolbar" id="ovrToolbar"><button class="ovr-tg on" data-ovr="channel">Channel</button><button class="ovr-tg on" data-ovr="fib">Fibonacci</button><button class="ovr-tg" data-ovr="psych">Psych levels</button><button class="ovr-tg on" data-ovr="candles">Candle signals</button></div><div id="ovrChart"></div>${chLegend}${fbLegend}${patChips}</div>
    ${peCard}
    <div class="card"><div class="card-title">Technical Summary <span class="free">computed locally · no AI</span></div>
      <div class="tech-table">
        ${tr('RSI (14)',`${fmt(t.rsi)} · ${t.rsi_signal||''}`,t.rsi_signal==='Overbought'?'var(--red)':t.rsi_signal==='Oversold'?'var(--green)':'')}
        ${tr('MACD',`${t.macd_trend||'—'} (${t.macd!=null?(t.macd>0?'+':'')+fmt(t.macd):'—'})`,macdC)}
        ${tr('Bollinger',t.bb_position||'—')}
        ${tr('SMA 20',t.price_vs_sma20==='above'?'Above ▲':'Below ▼',t.price_vs_sma20==='above'?'var(--green)':'var(--red)')}
        ${tr('SMA 50',t.price_vs_sma50==='above'?'Above ▲':'Below ▼',t.price_vs_sma50==='above'?'var(--green)':'var(--red)')}
        ${tr('SMA 200',t.price_vs_sma200?(t.price_vs_sma200==='above'?'Above ▲':'Below ▼'):'N/A',t.price_vs_sma200==='above'?'var(--green)':'var(--red)')}
        ${tr('Golden Cross',t.golden_cross===true?'Yes ✓':t.golden_cross===false?'No ✗':'N/A',t.golden_cross?'var(--green)':'var(--red)')}
        ${tr('Volume',`${fmt(t.volume_ratio)}× avg`,t.volume_ratio>1.5?'var(--amber)':'')}
        ${tr('Trend',t.volume_trend||'—')}
      </div>
      <div style="margin-top:12px;display:flex;gap:14px;font-size:11px;font-family:var(--font-mono);flex-wrap:wrap;">
        <span style="color:var(--text-4);">Support:</span><span style="color:var(--green);">${sup}</span>
        <span style="color:var(--text-4);margin-left:8px;">Resistance:</span><span style="color:var(--red);">${res}</span>
      </div>
    </div>`;
  },

  options:()=>{
    const o=DATA.options_flow||{};
    if(o.error) return aiBar('Options Flow','Chain & flow loaded & free.',inputsLineFor('options'),['flowread','unusual'])+`<div class="card"><div class="empty"><h3>No options data</h3><p>${o.error}</p></div></div>`;
    const tot=(o.total_call_volume||0)+(o.total_put_volume||0)||1;
    const cp=Math.round((o.total_call_volume||0)/tot*100);
    const sentCls=(o.overall_sentiment||'').includes('Bull')?'badge-green':(o.overall_sentiment||'').includes('Bear')?'badge-red':'badge-amber';
    const pcrColor=o.put_call_ratio==null?'var(--text)':o.put_call_ratio<0.7?'var(--green)':o.put_call_ratio>1.2?'var(--red)':'var(--amber)';
    const rows=(o.unusual_contracts||[]).slice(0,12).map(c=>ucRow(c.type,'$'+c.strike,c.expiry,fmtLarge(c.volume),fmtLarge(c.open_interest),c.vol_oi_ratio!=null?c.vol_oi_ratio+'×':'—','$'+fmtLarge(c.estimated_notional))).join('')||`<tr><td colspan="7" style="color:var(--text-4);text-align:center;padding:18px;">No unusual contracts flagged.</td></tr>`;
    return aiBar('Options Flow','Chain & flow are loaded & free. Interpret them only when you want.',inputsLineFor('options'),['flowread','unusual'])+`
    <div class="card"><div class="card-title">Options Flow Summary <span class="free">free · yfinance</span></div>
      <div class="kv" style="margin-bottom:16px;">
        <div><div class="metric-label">Put/Call Ratio</div><div class="metric-value" style="color:${pcrColor};">${o.put_call_ratio!=null?o.put_call_ratio:'—'}</div></div>
        <div><div class="metric-label">Sentiment</div><div class="metric-value"><span class="badge ${sentCls}">${o.overall_sentiment||'—'}</span></div></div>
        <div><div class="metric-label">Unusual</div><div class="metric-value" style="color:var(--amber);">${o.unusual_contracts_count||0}</div></div>
        <div><div class="metric-label">Max Pain</div><div class="metric-value">${o.max_pain!=null?'$'+o.max_pain:'—'} <span style="font-size:12px;color:var(--text-3);">${o.max_pain_distance_pct!=null?'('+(o.max_pain_distance_pct>0?'+':'')+o.max_pain_distance_pct+'%)':''}</span></div></div>
        <div><div class="metric-label">Call Vol</div><div class="metric-value">${fmtLarge(o.total_call_volume)}</div></div>
        <div><div class="metric-label">Put Vol</div><div class="metric-value">${fmtLarge(o.total_put_volume)}</div></div>
      </div>
      <div class="pcr-bar"><div class="pcr-bull" style="width:${cp}%;">CALL ${cp}%</div><div class="pcr-bear" style="width:${100-cp}%;">PUT ${100-cp}%</div></div>
    </div>
    <div class="card"><div class="card-title">Unusual Activity — Smart Money Signals</div>
      <table><thead><tr><th>Type</th><th>Strike</th><th>Expiry</th><th class="right">Volume</th><th class="right">OI</th><th class="right">Vol/OI</th><th class="right">Notional</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  },

  insider:()=>{
    const ins=DATA.insider_activity||{};
    if(ins.error) return aiBar('Insider','SEC Form 4 filings loaded & free.',inputsLineFor('insider'),['intent','cluster'])+`<div class="card"><div class="empty"><h3>No insider data</h3><p>${ins.error}</p></div></div>`;
    const sCls=ins.sentiment==='Bullish'?'badge-green':ins.sentiment==='Bearish'?'badge-red':'badge-grey';
    const rows=(ins.transactions||[]).slice(0,12).map(t=>insRow(t.transaction_date,t.insider_name,t.title,t.transaction_type,t.shares!=null?t.shares.toLocaleString():'—',t.total_value?'$'+fmtLarge(t.total_value):'—')).join('')||`<tr><td colspan="6" style="color:var(--text-4);text-align:center;padding:18px;">No recent Form 4 transactions.</td></tr>`;
    return aiBar('Insider','SEC Form 4 filings are loaded & free. Read intent only when you want.',inputsLineFor('insider'),['intent','cluster'])+`
    <div class="card"><div class="card-title">Insider Activity Summary <span class="free">free · SEC EDGAR</span></div>
      <div class="kv">
        <div><div class="metric-label">Net Buying (30d)</div><div class="metric-value" style="color:${(ins.net_buying_30d||0)>=0?'var(--green)':'var(--red)'};">${(ins.net_buying_30d||0)>=0?'+':'−'}$${fmtLarge(Math.abs(ins.net_buying_30d||0))}</div></div>
        <div><div class="metric-label">Buy/Sell (90d)</div><div class="metric-value">${ins.buy_sell_ratio_90d!=null?ins.buy_sell_ratio_90d:'—'}</div></div>
        <div><div class="metric-label">Sentiment</div><div class="metric-value"><span class="badge ${sCls}">${ins.sentiment||'—'}</span></div></div>
        <div><div class="metric-label">Buys (90d)</div><div class="metric-value" style="color:var(--green);">${ins.buy_count_90d||0}</div></div>
        <div><div class="metric-label">Sells (90d)</div><div class="metric-value" style="color:var(--red);">${ins.sell_count_90d||0}</div></div>
      </div>
    </div>
    <div class="card"><div class="card-title">Recent Transactions</div>
      <table><thead><tr><th>Date</th><th>Insider</th><th>Title</th><th>Type</th><th class="right">Shares</th><th class="right">Value</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  },

  news:()=>{
    const n=DATA.news_sentiment||{};
    if(n.error) return aiBar('News','Articles & sentiment loaded & free.',inputsLineFor('news'),['narrative','catalyst'])+`<div class="card"><div class="empty"><h3>No news data</h3><p>${n.error}</p></div></div>`;
    const sc=n.sentiment?n.sentiment.score:null;
    const pos=sc!=null?Math.round((sc+1)/2*100):50;
    const sCol=sc>0.1?'var(--green)':sc<-0.1?'var(--red)':'var(--amber)';
    const items=(n.articles||[]).map(a=>nws('var(--text-4)',a.headline||'—',`${a.source||''} · ${a.datetime||''}`,a.url,a.sentiment)).join('')||`<div style="font-size:12px;color:var(--text-4);">No headlines loaded.</div>`;
    const se=n.sentiment||{};
    const srcTag=se.source==='Claude'?'free · AI-scored (Claude)':'free · Finnhub / yfinance';
    const cases=(se.bull_case||se.bear_case)?`
      <div style="display:flex;gap:12px;margin-top:14px;flex-wrap:wrap;">
        <div style="flex:1;min-width:220px;border-left:2px solid var(--green);padding:6px 10px;background:rgba(0,200,120,.05);"><div style="font-size:10px;font-family:var(--font-mono);color:var(--green);letter-spacing:.5px;margin-bottom:3px;">BULL CASE</div><div style="font-size:12px;color:var(--text-2);line-height:1.45;">${se.bull_case||'—'}</div></div>
        <div style="flex:1;min-width:220px;border-left:2px solid var(--red);padding:6px 10px;background:rgba(230,70,70,.05);"><div style="font-size:10px;font-family:var(--font-mono);color:var(--red);letter-spacing:.5px;margin-bottom:3px;">BEAR CASE</div><div style="font-size:12px;color:var(--text-2);line-height:1.45;">${se.bear_case||'—'}</div></div>
      </div>`:'';
    return aiBar('News','Articles & sentiment are loaded & free. Summarize them only when you want.',inputsLineFor('news'),['narrative','catalyst'])+`
    <div class="card"><div class="card-title">News Sentiment <span class="free">${srcTag}</span></div>
      <div class="gauge-wrap"><div class="gauge-bar"><div class="gauge-marker" style="left:${pos}%;"></div></div><div class="gauge-label" style="color:${sCol};">${se.label||'—'}</div></div>
      <div style="display:flex;gap:20px;font-family:var(--font-mono);font-size:11px;color:var(--text-2);flex-wrap:wrap;">
        <span>Score: <span style="color:${sCol};">${sc!=null?(sc>0?'+':'')+sc:'—'}</span></span><span>Buzz: <span style="color:var(--text);">${n.buzz_score?fmt(n.buzz_score):'—'}</span></span>
        <span>Articles (30d): <span style="color:var(--text);">${n.articles_count||0}</span></span><span>This week: <span style="color:var(--text);">${n.articles_this_week||0}</span></span>
      </div>${cases}
    </div>
    <div class="card"><div class="card-title">Recent Headlines</div>${items}</div>`;
  },

  peers:()=>{
    const pr=DATA.peers||{};
    if(pr.error) return aiBar('Peers','Comparables loaded & free.',inputsLineFor('peers'),['relval','winning'])+`<div class="card"><div class="empty"><h3>No peer data</h3><p>${pr.error}</p></div></div>`;
    const comps=pr.companies||[];
    const metrics=['pe_trailing','pe_forward','ev_ebitda','ps_ratio','gross_margin','revenue_growth'];
    const labels=['P/E','P/E Fwd','EV/EBITDA','P/S','Gross %','Rev Gr'];
    const higher={gross_margin:1,revenue_growth:1};
    const best={},worst={};
    metrics.forEach(m=>{const vals=comps.map(c=>c[m]).filter(v=>v!=null&&!isNaN(v));if(!vals.length)return;best[m]=higher[m]?Math.max(...vals):Math.min(...vals);worst[m]=higher[m]?Math.min(...vals):Math.max(...vals);});
    const body=comps.map(c=>{
      const cells=metrics.map(m=>{const v=c[m];if(v==null||isNaN(v))return `<td class="num">—</td>`;const isB=best[m]!=null&&Math.abs(v-best[m])<0.01;const isW=worst[m]!=null&&Math.abs(v-worst[m])<0.01&&best[m]!==worst[m];const cls=isB?'num best':isW?'num worst':'num';const disp=(m==='gross_margin'||m==='revenue_growth')?(v>0?'+':'')+fmt(v)+'%':fmt(v);return `<td class="${cls}">${disp}</td>`;}).join('');
      return `<tr style="${c.is_target?'border-left:2px solid var(--accent);background:var(--accent-soft);':''}"><td class="mono" style="font-weight:${c.is_target?700:500};color:var(--text);">${c.ticker}</td><td class="num">${fmtLarge(c.market_cap)}</td>${cells}</tr>`;
    }).join('');
    return aiBar('Peers','Comparable metrics are loaded & free. Compare them only when you want.',inputsLineFor('peers'),['relval','winning'])+`
    <div class="card"><div class="card-title">Peer Comparison <span class="free">free · yfinance</span></div>
      ${(()=>{const med=peerPEMedian(pr);const prem=(med!=null&&DATA.financials&&DATA.financials.pe_trailing!=null)?Math.round((DATA.financials.pe_trailing/med-1)*100):null;return `<div style="font-size:11px;font-family:var(--font-mono);color:var(--text-4);margin-bottom:10px;">Peer median P/E: ${med!=null?fmt(med)+'×':'—'} <span title="excludes negative & >80× trailing P/Es (trough-earnings outliers)" style="opacity:.7;">(ex-outliers)</span> · ${tk()} ${prem!=null?(prem>=0?'+'+prem+'% vs median':prem+'% vs median'):''}</div>`;})()}
      <table><thead><tr><th>Company</th><th class="right">Mkt Cap</th>${labels.map(l=>`<th class="right">${l}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table>
      <div style="margin-top:8px;font-size:10px;color:var(--text-4);"><span style="color:var(--green);">■</span> Best in group &nbsp; <span style="color:var(--red);">■</span> Worst in group</div>
    </div>`;
  },

  earnings:()=>{
    const e=DATA.earnings||{};
    if(e.error) return aiBar('Earnings','Calendar & history loaded & free.',inputsLineFor('earnings'),['preearnings','surprise'])+`<div class="card"><div class="empty"><h3>No earnings data</h3><p>${e.error}</p></div></div>`;
    const earnColor=(e.days_until_earnings!=null&&e.days_until_earnings<30)?'var(--red)':(e.days_until_earnings!=null&&e.days_until_earnings<60)?'var(--amber)':'var(--text)';
    const track=(e.history||[]).map(q=>{const cls=q.beat===true?'beat':q.beat===false?'miss':'na';return `<div class="beat-circle ${cls}" title="${q.period}">${cls==='beat'?'✓':cls==='miss'?'✗':'—'}</div>`;}).join('')||'<span style="font-size:12px;color:var(--text-4);">No history</span>';
    const rows=(e.history||[]).map(q=>ern(q.period,q.eps_actual!=null?'$'+fmt(q.eps_actual):'—',q.eps_estimate!=null?'$'+fmt(q.eps_estimate):'—',q.surprise_pct!=null?(q.surprise_pct>0?'+':'')+fmt(q.surprise_pct)+'%':'—',q.beat)).join('')||`<tr><td colspan="5" style="color:var(--text-4);text-align:center;padding:18px;">No earnings history.</td></tr>`;
    return aiBar('Earnings','Calendar & history are loaded & free. Run a setup analysis only when you want.',inputsLineFor('earnings'),['preearnings','surprise'])+`
    <div class="card"><div class="card-title">Earnings Calendar <span class="free">free · yfinance</span></div>
      <div class="kv" style="margin-bottom:14px;">
        <div><div class="metric-label">Next Earnings</div><div class="metric-value" style="color:${earnColor};">${e.next_earnings_date||'TBD'}</div>${e.days_until_earnings!=null?`<div style="font-family:var(--font-mono);font-size:11px;color:${earnColor};">in ${e.days_until_earnings} days</div>`:''}</div>
        <div><div class="metric-label">EPS Estimate</div><div class="metric-value">${e.eps_estimate_next!=null?'$'+fmt(e.eps_estimate_next):'—'}</div></div>
        <div><div class="metric-label">Beat Rate</div><div class="metric-value" style="color:var(--green);">${e.beat_rate_pct!=null?e.beat_rate_pct+'%':'—'}</div></div>
        <div><div class="metric-label">Avg Surprise</div><div class="metric-value" style="color:${(e.avg_surprise_pct||0)>=0?'var(--green)':'var(--red)'};">${e.avg_surprise_pct!=null?(e.avg_surprise_pct>0?'+':'')+fmt(e.avg_surprise_pct)+'%':'—'}</div></div>
      </div>
      <div class="metric-label" style="margin-bottom:6px;">Beat / Miss — last ${(e.history||[]).length} quarters</div>
      <div class="beat-track">${track}</div>
    </div>
    <div class="card"><div class="card-title">Earnings History</div>
      <table><thead><tr><th>Quarter</th><th class="right">EPS Actual</th><th class="right">Estimate</th><th class="right">Surprise</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  },

  congress:()=>{
    const cg=DATA.congressional_trades;
    if(!cg||!cg.trades){
      return `<div class="card"><div class="card-title">Congressional Trading</div><div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h.01M13 7h.01M9 11h.01M13 11h.01"/></svg><h3>Premium data</h3><p>Congressional trade disclosures are available in <b style="color:var(--text-2);">Premium</b> mode. Toggle Premium in the header, then re-analyze.</p></div></div>`;
    }
    const s=cg.summary||{};
    const rows=(cg.trades||[]).map(t=>cng(t.disclosure_date,t.disclosure_lag_days,`${t.politician}`,t.party,t.chamber,t.type,t.amount_range)).join('');
    return aiBar('Congress','Disclosure filings are loaded. Interpret them only when you want.',inputsLineFor('default'),['polflow'])+`
    <div class="card"><div class="card-title">Congressional Trading — ${tk()} <span class="free">${cg.demo?'demo':'live · Quiver'}</span></div>
      <div class="kv" style="margin-bottom:14px;">
        <div><div class="metric-label">Purchases (90d)</div><div class="metric-value" style="color:var(--green);">${s.total_purchases_90d!=null?s.total_purchases_90d:'—'}</div></div>
        <div><div class="metric-label">Sales (90d)</div><div class="metric-value" style="color:var(--red);">${s.total_sales_90d!=null?s.total_sales_90d:'—'}</div></div>
        <div><div class="metric-label">Net Sentiment</div><div class="metric-value"><span class="badge ${s.net_sentiment==='Bearish'?'badge-red':s.net_sentiment==='Bullish'?'badge-green':'badge-amber'}">${s.net_sentiment||'—'}</span></div></div>
        <div><div class="metric-label">Avg Disclosure Lag</div><div class="metric-value">${s.avg_disclosure_lag_days!=null?s.avg_disclosure_lag_days+'d':'—'}</div></div>
      </div>
      ${s.notable_flag?`<div style="background:var(--amber-tint);border-radius:9px;padding:10px 12px;margin-bottom:12px;font-size:12px;color:var(--amber);">◈ ${s.notable_flag}</div>`:''}
      <table><thead><tr><th>Filed</th><th>Lag</th><th>Member</th><th>Party</th><th>Chamber</th><th>Type</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  },

  macro:()=>{
    if(!MACRO_DATA) return macroSkeleton();
    if(MACRO_DATA.error) return `<div class="card"><div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg><h3>Macro data unavailable</h3><p>${MACRO_DATA.error}</p><p style="margin-top:6px;color:var(--text-3);">Check <span class="mono">FRED_API_KEY</span> in .env</p></div></div>`;
    return buildMacroHTML(MACRO_DATA);
  },

  skills:()=>`<div class="page-head"><h1><span style="width:22px;height:22px;color:var(--violet);display:inline-grid;place-items:center;">${I.bolt}</span> Skills</h1><p>Saved analytical routines — a named prompt template with defined inputs. One click runs it on the current ticker via Numa.</p></div>
    <div class="skill-grid">
      ${skillCard('divergence','Smart Money Divergence','options + chart + insiders','Catches options activity that conflicts with the chart and insider flow, and tells you which side to trust.')}
      ${skillCard('preearnings','Pre-Earnings Setup','chart + chain + history','Implied move vs historical, technical posture into earnings, and what the options market is pricing.')}
      ${skillCard('thesis','Thesis Check','your thesis + data','Type your thesis in plain English; Claude stress-tests it against the live data and names the earliest break signal.')}
      <div class="skill-card new" data-newskill><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg><div style="font-weight:600;">Create a new Skill</div><div style="font-size:11.5px;">Name it, write the prompt, pick the inputs</div></div>
    </div>`,

  notes:()=>{
    if(!NOTES.length) return `<div class="page-head"><h1>Notes</h1><p>Saved AI outputs land here. Run an analysis, then hit "Save to notes".</p></div>
      <div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg><h3>No notes yet</h3><p>Saved analyses are stored per ticker so you can compare your thinking over time.</p></div>`;
    return `<div class="page-head"><h1>Notes</h1><p>${NOTES.length} saved ${NOTES.length===1?'analysis':'analyses'}</p></div>`+
      NOTES.map((n,i)=>`<div class="note-card"><div class="nh"><span class="ni">${n.icon}</span><div><div class="nt">${n.title}</div><div class="nm">${n.ticker} · ${n.time} · $${(n.cost||0).toFixed(3)}</div></div><span class="nx" data-delnote="${i}">×</span></div><div class="nb">${renderMD(n.text)}</div></div>`).join('');
  },
};

/* ============ NAV + RENDER ============ */
// Staggered "data streaming in" reveal — runs on every section render so each
// view feels pulled live in the moment, the way the Overview tiles already do.
// (.sig tiles keep their own CSS cascade; this covers every other data item.)
function revealContent(){
  const c=document.getElementById('content'); if(!c) return;
  const items=c.querySelectorAll('.ai-act,.metric-card,.statlist .stat,.tech-row,table tbody tr,.kv>div,.beat-circle,.news-item,.pnews,.pcng,.skill-card,.note-card,.cb-stats span,.gauge-wrap,.pcr-bar');
  items.forEach((el,i)=>{
    el.style.animation='rise .44s cubic-bezier(.4,0,.2,1) both';
    el.style.animationDelay=(Math.min(i,20)*0.028)+'s';
  });
}
function renderSection(id){
  const prevSection=CURRENT;
  CURRENT=id;
  document.querySelectorAll('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.section===id));
  const c=document.getElementById('content');
  if(!DATA && id!=='skills' && id!=='notes' && id!=='macro'){ c.innerHTML='<div class="empty"><h3>Loading…</h3><p>Fetching data.</p></div>'; updateNavPill(); return; }
  const prevScroll=c.scrollTop;
  const fn=SECTIONS[id]; c.innerHTML=fn?fn():'<div class="empty"><h3>Section not found</h3></div>';
  // Switching sections scrolls the content back to the beginning. A re-render of
  // the SAME section (theme switch, macro late-load) keeps your place. The header's
  // collapse state is preserved either way — it's gesture-driven, not scroll-driven.
  c.scrollTop = (id===prevSection) ? prevScroll : 0;
  onContentScroll();
  revealContent();
  if(id==='chart'){ setTimeout(buildChart,30); setTimeout(()=>{buildOverlayChart();buildPEChart();},45); }
  if((id==='overview'||id==='macro') && !MACRO_DATA && !MACRO_LOADING){
    MACRO_LOADING=true;
    loadMacro().then(()=>{ MACRO_LOADING=false; updateNavDots(); updateNumaEdge(); if(CURRENT==='overview'||CURRENT==='macro') renderSection(CURRENT); });
  }
  if(id==='macro' && MACRO_DATA && !MACRO_DATA.error){ setTimeout(buildMacroCharts,40); }
  updateNavPill();
  updateChatCtx();
  if(document.getElementById('aip').classList.contains('show')){ renderScope(); renderScopeChips(); updateChatCtx(); }
  if(document.getElementById('numaPop').classList.contains('show')){ refreshInsights(); }
  updateNavDots(); updateNumaEdge();
}
document.getElementById('sidebar').addEventListener('click',e=>{const it=e.target.closest('.nav-item');if(!it)return;renderSection(it.dataset.section);});
function updateNavPill(){const nav=document.getElementById('sidebar');const act=nav&&nav.querySelector('.nav-item.active');const pill=document.getElementById('navPill');if(!act||!pill)return;pill.style.left=act.offsetLeft+'px';pill.style.top=act.offsetTop+'px';pill.style.width=act.offsetWidth+'px';pill.style.height=act.offsetHeight+'px';pill.style.opacity='1';}
addEventListener('resize',updateNavPill);

