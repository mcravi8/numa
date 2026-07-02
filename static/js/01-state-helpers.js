/* ============ STATE ============ */
const API_BASE = window.location.origin === 'null'
  ? 'http://localhost:8000'   // fallback for file:// opens
  : window.location.origin;   // uses whatever port it's served on
let DATA = null;
let CURRENT = "overview";
let PREMIUM_MODE = localStorage.getItem("terminal_mode") === "premium";
let NOTES = [];
let numaHistory = [];
let totalSpend = 0;
let TICK_PRICE = 0, TICK_STARTED = false;
let HEADER_P = 0;   // remembered header-collapse amount (0=open, 1=collapsed); persists across section switches
let typeTimer = null;

/* ============ ICONS ============ */
const I={
  trend:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l5-5 4 4 8-9"/><path d="M21 7v5h-5"/></svg>',
  layers:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18"/><path d="M5 8l7-5 7 5"/><path d="M5 16l7 5 7-5"/></svg>',
  stack:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="13" height="13" rx="2"/><rect x="8" y="8" width="13" height="13" rx="2"/></svg>',
  levels:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h18"/></svg>',
  scale:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 7l7-4 7 4M3 11h6l-3 6-3-6M15 11h6l-3 6-3-6"/></svg>',
  bolt:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>',
  eye:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
  users:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/></svg>',
  news:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  cal:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  flag:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/></svg>',
  brain:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18h6M10 22h4M12 2a7 7 0 00-4 12c1 1 1 2 1 3h6c0-1 0-2 1-3a7 7 0 00-4-12z"/></svg>',
  building:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V5a2 2 0 012-2h10a2 2 0 012 2v16M9 7h.01M13 7h.01M9 11h.01M13 11h.01M9 15h.01M13 15h.01"/></svg>',
};
const VEST='<svg viewBox="50 31 100 134" fill="none" stroke="currentColor" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"><path d="M 100 160 L 60 160 Q 55 160 55 155 L 55 95 Q 75 75 55 55 L 84 52 Q 100 62 116 52 L 145 55 Q 125 75 145 95 L 145 155 Q 145 160 140 160 Z"/><path d="M 84 52 L 84 36 L 116 36 L 116 52"/><path d="M 100 36 L 100 160"/><path d="M 70 115 L 70 145"/><path d="M 130 115 L 130 145"/></svg>';
const CHATICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>';

/* ============ FORMAT + INDICATOR HELPERS (preserved) ============ */
function fmt(n){if(n==null||isNaN(n))return"—";if(Math.abs(n)>=100)return Math.round(n).toLocaleString();if(Math.abs(n)>=10)return n.toFixed(1);return n.toFixed(2);}
// Share price: ALWAYS show cents (2 decimals) with thousands separators — e.g. 210.69, 1,685.20.
function fmtPrice(n){if(n==null||isNaN(n))return"—";return Number(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtLarge(n){if(n==null||isNaN(n))return"—";const abs=Math.abs(n);const sign=n<0?"-":"";if(abs>=1e12)return sign+(abs/1e12).toFixed(2)+"T";if(abs>=1e9)return sign+(abs/1e9).toFixed(2)+"B";if(abs>=1e6)return sign+(abs/1e6).toFixed(1)+"M";if(abs>=1e3)return sign+(abs/1e3).toFixed(0)+"K";return sign+Math.round(abs).toLocaleString();}
function computeRSI(closes,period=14){const gains=[],losses=[];for(let i=1;i<closes.length;i++){const d=closes[i]-closes[i-1];gains.push(d>0?d:0);losses.push(d<0?-d:0);}const rsi=[];if(gains.length<period)return rsi;let avgGain=gains.slice(0,period).reduce((a,b)=>a+b,0)/period;let avgLoss=losses.slice(0,period).reduce((a,b)=>a+b,0)/period;for(let i=period;i<gains.length;i++){avgGain=(avgGain*(period-1)+gains[i])/period;avgLoss=(avgLoss*(period-1)+losses[i])/period;const rs=avgLoss===0?100:avgGain/avgLoss;rsi.push(100-100/(1+rs));}return rsi;}
function computeMACD(closes){const ema=(data,span)=>{const k=2/(span+1);const r=[data[0]];for(let i=1;i<data.length;i++)r.push(data[i]*k+r[i-1]*(1-k));return r;};const e12=ema(closes,12),e26=ema(closes,26);const macdLine=e12.slice(25).map((v,i)=>v-e26[i+25]);const signalLine=ema(macdLine,9);const histogram=macdLine.slice(8).map((v,i)=>v-signalLine[i+8]);return{macdLine:macdLine.slice(8),signalLine:signalLine.slice(8),histogram};}
// Fast inline-only renderer used DURING streaming (no block/table reflow per token).
function renderMDLite(t){return (t||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\*\*([^*]+?)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+?)\*/g,'<em>$1</em>').replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\n/g,'<br>');}
// Full markdown -> HTML: headings, pipe tables, bullet/numbered lists, rules, bold/
// italic/code. Used for finished answers and saved notes.
function renderMD(src){
  if(!src) return '';
  const esc=s=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const inline=s=>esc(s).replace(/`([^`]+)`/g,'<code>$1</code>').replace(/\*\*([^*]+?)\*\*/g,'<strong>$1</strong>').replace(/\*([^*\n]+?)\*/g,'<em>$1</em>');
  const splitRow=l=>l.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(c=>c.trim());
  const isSep=l=>/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(l);
  const lines=String(src).split('\n');
  let html='',i=0;
  while(i<lines.length){
    const line=lines[i];
    if(/^\s*$/.test(line)){i++;continue;}
    if(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)){html+='<hr>';i++;continue;}
    const h=line.match(/^\s*(#{1,6})\s+(.*)$/);
    if(h){const lvl=Math.min(6,h[1].length+2);html+='<h'+lvl+'>'+inline(h[2].trim())+'</h'+lvl+'>';i++;continue;}
    if(line.includes('|')&&i+1<lines.length&&isSep(lines[i+1])){
      const head=splitRow(line);i+=2;const rows=[];
      while(i<lines.length&&lines[i].includes('|')&&!/^\s*$/.test(lines[i])){rows.push(splitRow(lines[i]));i++;}
      html+='<table><thead><tr>'+head.map(c=>'<th>'+inline(c)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+inline(c)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
      continue;
    }
    if(/^\s*[-*]\s+/.test(line)){
      const items=[];while(i<lines.length&&/^\s*[-*]\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*[-*]\s+/,''));i++;}
      html+='<ul>'+items.map(it=>'<li>'+inline(it)+'</li>').join('')+'</ul>';continue;
    }
    if(/^\s*\d+\.\s+/.test(line)){
      const items=[];while(i<lines.length&&/^\s*\d+\.\s+/.test(lines[i])){items.push(lines[i].replace(/^\s*\d+\.\s+/,''));i++;}
      html+='<ol>'+items.map(it=>'<li>'+inline(it)+'</li>').join('')+'</ol>';continue;
    }
    const para=[];
    while(i<lines.length&&!/^\s*$/.test(lines[i])&&!/^\s*#{1,6}\s+/.test(lines[i])&&!/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(lines[i])&&!/^\s*[-*]\s+/.test(lines[i])&&!/^\s*\d+\.\s+/.test(lines[i])&&!(lines[i].includes('|')&&i+1<lines.length&&isSep(lines[i+1]))){para.push(lines[i]);i++;}
    if(para.length)html+='<p>'+para.map(inline).join('<br>')+'</p>';
  }
  return html;
}
const renderMarkdown=renderMD;

/* ============ AI ACTION METADATA (titles/icons/cost & token estimates) ============ */
const AI={
  pattern:{title:'Pattern Recognition',icon:I.trend,cost:0.02,tok:712},
  confluence:{title:'Signal Confluence',icon:I.layers,cost:0.02,tok:768},
  overlay:{title:'Options × Chart Read',icon:I.stack,cost:0.03,tok:961},
  levels:{title:'Level Mapping',icon:I.levels,cost:0.02,tok:805},
  bullbear:{title:'Bull vs Bear',icon:I.scale,cost:0.03,tok:1040},
  valverdict:{title:'Valuation Verdict',icon:I.scale,cost:0.02,tok:760},
  flowread:{title:'Flow Interpretation',icon:I.stack,cost:0.02,tok:790},
  unusual:{title:'Unusual Activity Read',icon:I.bolt,cost:0.03,tok:980},
  intent:{title:'Insider Intent',icon:I.eye,cost:0.03,tok:910},
  cluster:{title:'Cluster Detection',icon:I.users,cost:0.02,tok:740},
  narrative:{title:'Narrative Summary',icon:I.news,cost:0.02,tok:830},
  catalyst:{title:'Catalyst Scan',icon:I.bolt,cost:0.03,tok:900},
  relval:{title:'Relative Value Read',icon:I.scale,cost:0.03,tok:950},
  winning:{title:"Who's Winning",icon:I.users,cost:0.02,tok:720},
  preearnings:{title:'Pre-Earnings Setup',icon:I.cal,cost:0.04,tok:1180},
  surprise:{title:'Surprise Pattern',icon:I.cal,cost:0.02,tok:760},
  polflow:{title:'Political Flow Read',icon:I.building,cost:0.03,tok:880},
  divergence:{title:'Smart Money Divergence',icon:I.bolt,cost:0.03,tok:1024},
  thesis:{title:'Thesis Check',icon:I.brain,cost:0.03,tok:990},
  rateimpact:{title:'Rate Impact on Sectors',icon:I.scale,cost:0.03,tok:2800},
  rotationsignal:{title:'Rotation Signal',icon:I.layers,cost:0.03,tok:2800},
  dcfread:{title:'DCF Environment',icon:I.trend,cost:0.02,tok:2100},
};
const ACT_DESC={
  pattern:'Name the dominant chart structure from 1Y OHLCV.',
  confluence:'Reconcile RSI, MACD, BB, SMAs into one verdict.',
  overlay:'Do the flow and the tape agree? Where do they conflict?',
  levels:'Actionable levels, risk-per-share & stop logic.',
  bullbear:'Strongest bull case vs strongest bear case.',
  valverdict:'Is the multiple justified by the growth?',
  flowread:'What does the put/call & volume actually imply?',
  unusual:'Which unusual prints are real institutional size?',
  intent:'What are insiders actually signalling here?',
  cluster:'Detect buy/sell clustering patterns.',
  narrative:'The dominant story across recent articles.',
  catalyst:'Upcoming catalysts ranked by impact.',
  relval:'Is it cheap or dear vs its peers?',
  winning:'Who is gaining and losing in the group.',
  preearnings:'Implied move vs history & technical posture.',
  surprise:'Beat pattern and the post-print reaction edge.',
  polflow:'How to read the congressional filings.',
  rateimpact:'Which sectors benefit or suffer at current rate levels.',
  rotationsignal:'Where is institutional money likely rotating right now.',
  dcfread:'What discount rate does to growth stock multiples at current yields.',
};
const ACT_TOPIC={pattern:'technical',confluence:'technical',overlay:'options',levels:'technical',bullbear:'verdict',valverdict:'valuation',flowread:'options',unusual:'options',intent:'insider',cluster:'insider',narrative:'news',catalyst:'news',relval:'peers',winning:'peers',preearnings:'earnings',surprise:'earnings',polflow:'general',divergence:'options',thesis:'verdict',rateimpact:'macro',rotationsignal:'macro',dcfread:'macro'};

/* ============ ACTION PROMPTS (sent to Claude) ============ */
function tk(){return DATA?DATA.ticker:'this stock';}
const ACT_PROMPTS={
  pattern:()=>`Read the chart STRUCTURE for ${tk()} using the computed geometry in the data — the regression channel (trend + where price sits in it), the Fibonacci levels off the dominant swing, the recent candle signals, and the algorithmic chart-pattern candidates. Treat the candidates' confidence honestly: validate or reject each against the actual price action rather than repeating them. Name the dominant structure, say where price sits within it, and give the most likely next move with a specific level.`,
  confluence:()=>`Reconcile every technical signal for ${tk()} — RSI, MACD, Bollinger, the SMA stack, volume, the regression channel (trend + position), the Fibonacci levels and any candle / chart-pattern signals. Which confirm each other, which conflict, and what is the net technical verdict?`,
  overlay:()=>`Compare the options flow with the chart structure for ${tk()} (regression channel, fib levels, pattern candidates). Do they agree or conflict? If they conflict, which interpretation is more credible given insider activity?`,
  levels:()=>`Map the key price levels for ${tk()} using ALL the computed levels in the data: the Fibonacci retracement levels, the psychological round numbers, the regression-channel band edges, the support/resistance shelves and options max pain. Call out where several levels CLUSTER (that makes a level stronger). Identify primary support and resistance and why; if entering today, give the natural stop, first target, and risk per share.`,
  bullbear:()=>`Give me the strongest bull case AND the strongest bear case for ${tk()} right now, each in 2-3 sentences, using specific numbers from the loaded data. End with the net read.`,
  valverdict:()=>`Is ${tk()}'s current valuation justified by its growth profile? Use EV/EBITDA, P/E (trailing & forward), P/S and revenue growth, compare to the sector average, AND check the trailing P/E against the stock's OWN history (the HISTORICAL P/E percentile in the data — cheap or expensive vs where it has traded?). Give a verdict.`,
  flowread:()=>`What does the options flow imply for ${tk()}? Interpret the put/call ratio, the unusual contract activity, and max pain together. What is the net read?`,
  unusual:()=>`Which unusual options contracts for ${tk()} look like genuine institutional positioning vs noise? Walk through the top flagged contracts and assess their significance.`,
  intent:()=>`What are the insiders at ${tk()} actually signalling? Interpret the net buying/selling over 30 and 90 days and whether this is routine or meaningful.`,
  cluster:()=>`Detect any clustering in ${tk()} insider transactions. Are multiple insiders acting together, and what does the timing suggest?`,
  narrative:()=>`What is the dominant news narrative for ${tk()} right now? Summarize the key story across recent headlines and name the 2 most important upcoming catalysts.`,
  catalyst:()=>`Rank the upcoming catalysts for ${tk()} by potential impact, including earnings and any company-specific events in the loaded data.`,
  relval:()=>`Is ${tk()} cheap or expensive relative to its peers? Use P/E, EV/EBITDA and P/S, normalize for growth differences, and give a verdict.`,
  winning:()=>`Who is gaining and losing share in ${tk()}'s peer group? Use revenue growth and margins to rank the group.`,
  preearnings:()=>`Generate a pre-earnings setup for ${tk()}: days to the print, the EPS estimate, the historical beat rate and average surprise, and the current technical posture into earnings.`,
  surprise:()=>`Analyze ${tk()}'s earnings beat/miss pattern. What edge, if any, is in the historical surprise rate, and what does it imply for the next print?`,
  polflow:()=>`How should I read the congressional trading filings for ${tk()}? Which activity is notable and why?`,
  divergence:()=>`Run a smart-money divergence check on ${tk()}: compare options flow sentiment vs the chart trend vs insider net buying. Are they aligned or conflicting, and what does the conflict imply?`,
  thesis:()=>`I want to stress-test a thesis on ${tk()}. Based on the loaded data, tell me what supports a bullish thesis, what contradicts it, what would have to be true for it to play out, and the earliest signal it is breaking down.`,
  rateimpact:()=>{const r=(MACRO_DATA&&MACRO_DATA.rates)||{},inf=(MACRO_DATA&&MACRO_DATA.inflation)||{};const ff=r.fed_funds&&r.fed_funds.value!=null?r.fed_funds.value+'%':'current levels';const t10=r.treasury_10y&&r.treasury_10y.value!=null?r.treasury_10y.value+'%':'current levels';const cpi=inf.cpi_yoy!=null?inf.cpi_yoy+'%':'current levels';return `Given current macro conditions — Fed Funds at ${ff}, 10Y at ${t10}, yield curve ${r.yield_curve_signal||'as shown'}, CPI YoY at ${cpi} — which sectors benefit and which face headwinds? Explain the mechanical transmission from rates to sector performance. Be specific about rotation direction.`;},
  rotationsignal:()=>`Based on the current macro data — rate environment, labor conditions, inflation trajectory, VIX level, dollar direction — what is the dominant money-flow signal right now? Where is institutional money likely rotating into and out of?`,
  dcfread:()=>{const r=(MACRO_DATA&&MACRO_DATA.rates)||{};const t10=r.treasury_10y&&r.treasury_10y.value!=null?r.treasury_10y.value+'%':'current levels';const erp=r.equity_risk_premium!=null?'~'+r.equity_risk_premium+'%':'the prevailing level';return `At a 10Y yield of ${t10} and an implied equity risk premium of ${erp}, how does this affect the present value of long-duration growth stocks? Compare to a 1.5% rate environment. Which P/E multiples are justified at current rates for different growth rates (20%, 40%, 80% revenue growth)?`;},
};
function inputsLineFor(topic){const D=DATA;if(!D)return null;const t=D.technicals||{},o=D.options_flow||{},ins=D.insider_activity||{},f=D.financials||{},e=D.earnings||{},n=D.news_sentiment||{},pr=D.peers||{};const lead='<b>INPUTS</b> · ';
  switch(topic){
    case'technical':return lead+'1Y OHLCV · RSI '+fmt(t.rsi)+' · MACD '+(t.macd_trend||'—')+' · regression channel · fib · psych levels · candle + chart patterns';
    case'options':return lead+'PCR '+(o.put_call_ratio!=null?o.put_call_ratio:'—')+' · '+(o.unusual_contracts_count||0)+' unusual · max pain $'+(o.max_pain!=null?o.max_pain:'—');
    case'insider':return lead+'net 30d $'+fmtLarge(ins.net_buying_30d)+' · '+(ins.buy_count_90d||0)+' buys / '+(ins.sell_count_90d||0)+' sells (90d)';
    case'valuation':return lead+'P/E '+fmt(f.pe_trailing)+' / fwd '+fmt(f.pe_forward)+' · EV/EBITDA '+fmt(f.ev_ebitda)+' · sector P/E '+fmt(pr.sector_avg_pe);
    case'news':return lead+(n.articles_count||0)+' articles · sentiment '+(n.sentiment&&n.sentiment.score!=null?n.sentiment.score:'—')+' · buzz '+(n.buzz_score?fmt(n.buzz_score):'—');
    case'peers':return lead+tk()+' vs '+(((pr.companies||[]).filter(c=>!c.is_target).map(c=>c.ticker).slice(0,5).join('/'))||'peers');
    case'earnings':return lead+'next '+(e.next_earnings_date||'TBD')+' · beat rate '+(e.beat_rate_pct!=null?e.beat_rate_pct+'%':'—')+' · '+((e.history||[]).length)+'q history';
    case'verdict':return lead+'fundamentals · chart · flow · insiders · analyst consensus';
    default:return lead+'all loaded '+tk()+' data';
  }
}

/* ============ SMALL BUILDERS ============ */
function aiBar(label,sub,inputs,acts){
  return `<div class="ai-bar">
    <div class="ai-bar-head">
      <div class="spark">⚡</div>
      <div class="t" style="flex:1;">AI Actions · <b>${label}</b></div>
      <span class="skill-launch" data-skilllaunch><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg> Skills</span>
      <div class="dormant"><span class="d"></span> Claude idle</div>
    </div>
    <div class="ai-acts">
      ${acts.map(k=>{const a=AI[k];return `<button class="ai-act" data-act="${k}">
        <div class="top"><span class="ic">${a.icon}</span><span class="nm">${a.title}</span></div>
        <div class="ds">${ACT_DESC[k]}</div>
        <div class="cost">~$${a.cost.toFixed(2)} · ~${a.tok} tok <span class="run">Run ↗</span></div>
      </button>`}).join('')}
    </div>
  </div>`;
}
function st(l,v){return `<div class="stat" data-explain="${l}: ${v}"><span class="l">${l}</span><span class="v">${v}</span><span class="xspark" title="Ask Numa">✦</span></div>`;}
function sig(goto,lbl,icon,verdict,color,sub){return `<button class="sig" data-goto="${goto}" data-explain="${lbl}: ${verdict} (${sub})"><div class="sig-top"><span class="sig-ic">${icon}</span><span class="sig-lbl">${lbl}</span><span class="sig-arrow">→</span></div><div class="sig-verdict" style="color:${color};">${verdict}</div><div class="sig-sub">${sub}</div><span class="xspark" title="Ask Numa">✦</span></button>`;}
function pnews(c,h,m){return `<div class="pnews"><span class="d" style="background:${c};"></span><div><div class="h">${h}</div><div class="m">${m}</div></div></div>`;}
function prow(tk,pe,g,tgt){return `<tr><td class="mono" style="font-weight:${tgt?700:500};color:var(--text);">${tk}</td><td class="mono" style="text-align:right;color:var(--text-2);">${pe}</td><td class="mono" style="text-align:right;color:${(g||'').startsWith('-')?'var(--red)':'var(--green)'};">${g}</td></tr>`;}
function pcng(name,type,amt){const buy=type==='Purchase';return `<div class="pcng"><span style="color:var(--text);font-weight:500;">${name}</span><span class="badge ${buy?'badge-green':'badge-red'}">${buy?'BUY':'SELL'}</span><span class="mono" style="color:var(--text-3);margin-left:auto;">${amt}</span></div>`;}
function tr(l,v,c){return `<div class="tech-row" data-explain="${l}: ${v}"><span class="tech-indicator">${l}</span><span class="tech-value" ${c?`style="color:${c};"`:''}>${v}</span><span class="xspark" title="Ask Numa">✦</span></div>`;}
function ucRow(t,k,e,v,oi,r,n){return `<tr style="border-left:2px solid ${t==='call'?'var(--green)':'var(--red)'};"><td><span class="badge ${t==='call'?'badge-green':'badge-red'}">${t.toUpperCase()}</span></td><td class="num">${k}</td><td class="mono" style="color:var(--text-3);">${e}</td><td class="num">${v}</td><td class="num">${oi}</td><td class="num" style="color:var(--amber);">${r}</td><td class="num">${n}</td></tr>`;}
function insRow(d,nm,t,ty,sh,val){const buy=ty==='P';const sell=ty==='S';const col=buy?'var(--green)':sell?'var(--red)':'var(--border-strong)';const bcls=buy?'badge-green':sell?'badge-red':'badge-grey';return `<tr style="border-left:2px solid ${col};"><td class="mono" style="color:var(--text-3);">${d}</td><td style="color:var(--text);">${nm}</td><td style="font-size:11px;color:var(--text-4);">${t}</td><td><span class="badge ${bcls}">${(ty==='P'?'BUY':ty==='S'?'SELL':ty)}</span></td><td class="num">${sh}</td><td class="num ${buy?'pos':sell?'neg':''}">${val}</td></tr>`;}
function sentColor(s){return s==='Bullish'?'var(--green)':s==='Bearish'?'var(--red)':s==='Neutral'?'var(--amber)':null;}
function nws(c,h,m,url,sent){const sc=sentColor(sent);const head=url?`<a href="${url}" target="_blank" rel="noopener">${h}</a>`:h;const badge=sc?`<span style="font-size:9px;padding:1px 5px;border:1px solid ${sc};border-radius:3px;margin-left:7px;color:${sc};font-family:var(--font-mono);letter-spacing:.3px;vertical-align:middle;">${sent}</span>`:'';return `<div class="news-item"><div class="news-dot" style="background:${sc||c};"></div><div><div class="news-headline">${head}${badge}</div><div class="news-meta">${m}</div></div></div>`;}
function ern(q,a,e,s,beat){return `<tr><td class="mono" style="color:var(--text-3);">${q}</td><td class="num">${a}</td><td class="num">${e}</td><td class="num ${(s||'').startsWith('+')?'pos':(s||'').startsWith('-')?'neg':''}">${s}</td><td><span class="badge ${beat===true?'badge-green':beat===false?'badge-red':'badge-grey'}">${beat===true?'BEAT':beat===false?'MISS':'—'}</span></td></tr>`;}
function cng(d,lag,nm,p,ch,ty,amt){const buy=String(ty||'').startsWith('Purchase');const slow=lag!=null&&lag>=30;const ld=lag==null?'—':lag+'d';return `<tr style="border-left:2px solid ${buy?'var(--green)':'var(--red)'};"><td class="mono" style="color:var(--text-3);">${d}</td><td class="mono" style="color:${slow?'var(--amber)':'var(--text-3)'};" title="Days between the trade and its public disclosure (STOCK Act allows up to 45)">${ld}</td><td style="color:var(--text);">${nm}</td><td><span class="badge ${p==='D'?'badge-blue':'badge-red'}">${p}</span></td><td style="font-size:11px;color:var(--text-3);">${ch}</td><td><span class="badge ${buy?'badge-green':'badge-red'}">${String(ty||'—').toUpperCase()}</span></td><td class="mono" style="color:var(--text-2);">${amt}</td></tr>`;}
function skillCard(key,nm,tags,ds){return `<div class="skill-card"><div class="sh"><span class="si">${AI[key].icon}</span><div><div class="nm">${nm}</div><div class="tg">${tags}</div></div></div><div class="ds">${ds}</div><div class="sf"><button class="runbtn" data-act="${key}">Run on ${tk()}</button><span class="cost">~$${AI[key].cost.toFixed(2)}</span></div></div>`;}

