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

/* ============ PRICE CHART (real data) ============ */
function buildChart(){
  const el=document.getElementById('tvChart'); if(!el) return;
  el.innerHTML='';
  // Primary: TradingView Advanced Chart (its own data feed) with our full indicator set.
  if(window.TradingView&&TradingView.widget&&DATA&&DATA.ticker){
    const dk=document.documentElement.dataset.theme==='dark';
    try{
      new TradingView.widget({
        container_id:'tvChart', symbol:DATA.ticker, interval:'D', timezone:'Etc/UTC',
        theme:dk?'dark':'light', style:'1', locale:'en', autosize:true,
        allow_symbol_change:false, hide_side_toolbar:false, withdateranges:true,
        studies:[
          {id:'MASimple@tv-basicstudies',inputs:{length:20}},
          {id:'MASimple@tv-basicstudies',inputs:{length:50}},
          {id:'MASimple@tv-basicstudies',inputs:{length:200}},
          {id:'RSI@tv-basicstudies'},
          {id:'MACD@tv-basicstudies'},
          {id:'BB@tv-basicstudies'},
        ],
      });
      return;
    }catch(e){}
  }
  buildChartYF(el); // fallback below
}
// Fallback: original yfinance lightweight-charts chart, used if TradingView fails to
// load (e.g. offline). Renders its own panes inside the host element.
function buildChartYF(host){
  if(!window.LightweightCharts||!DATA||!DATA.technicals||!DATA.technicals.chart_data){host.innerHTML='<div class="empty"><h3>Chart unavailable</h3><p>Price history not loaded.</p></div>';return;}
  host.innerHTML='<div id="chartContainer"></div><div id="rsiContainer"></div><div id="macdContainer"></div>';
  const el=document.getElementById('chartContainer');
  const cd=DATA.technicals.chart_data.filter(d=>d.close!=null&&d.open!=null&&!isNaN(d.close)); if(!cd.length) return;
  const dk=document.documentElement.dataset.theme==='dark';
  const P=dk?{bg:'#1f232b',txt:'#aeb6c2',grid:'#2a2f39',bd:'#343b46',up:'#2ec27e',dn:'#ef5a6f',s20:'#5b8cff',s50:'#e0a83a',s200:'#a98bff',volU:'rgba(46,194,126,0.26)',volD:'rgba(239,90,111,0.26)'}:{bg:'#ffffff',txt:'#3a3f4b',grid:'#eef0f3',bd:'#e8e8ec',up:'#1f9d57',dn:'#d23a3a',s20:'#2f6df0',s50:'#d98a1a',s200:'#8b5cf6',volU:'rgba(31,157,87,0.32)',volD:'rgba(210,58,58,0.32)'};
  const mk=(node,h,opt)=>LightweightCharts.createChart(node,Object.assign({layout:{background:{color:P.bg},textColor:P.txt},grid:{vertLines:{color:P.grid},horzLines:{color:P.grid}},rightPriceScale:{borderColor:P.bd},timeScale:{borderColor:P.bd,timeVisible:false},width:node.clientWidth,height:h},opt||{}));
  const charts=[];
  const chart=mk(el,320); charts.push(chart);
  const cs=chart.addCandlestickSeries({upColor:P.up,downColor:P.dn,borderUpColor:P.up,borderDownColor:P.dn,wickUpColor:P.up,wickDownColor:P.dn});
  cs.setData(cd.map(d=>({time:d.date,open:d.open,high:d.high,low:d.low,close:d.close})));
  chart.addLineSeries({color:P.s20,lineWidth:1,title:'SMA20'}).setData(cd.filter(d=>d.sma20!=null).map(d=>({time:d.date,value:d.sma20})));
  chart.addLineSeries({color:P.s50,lineWidth:1,title:'SMA50'}).setData(cd.filter(d=>d.sma50!=null).map(d=>({time:d.date,value:d.sma50})));
  if(cd.some(d=>d.sma200!=null)) chart.addLineSeries({color:P.s200,lineWidth:1,title:'SMA200'}).setData(cd.filter(d=>d.sma200!=null).map(d=>({time:d.date,value:d.sma200})));
  const vol=chart.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'vol'});
  vol.setData(cd.map(d=>({time:d.date,value:d.volume,color:d.close>=d.open?P.volU:P.volD})));
  // Confine volume to a slim bottom strip and lift the candles above it so the
  // two never overlap (scaleMargins must be set on the price scale, not the series).
  chart.priceScale('vol').applyOptions({scaleMargins:{top:0.82,bottom:0}});
  chart.priceScale('right').applyOptions({scaleMargins:{top:0.06,bottom:0.22}});
  el.style.position='relative';
  const tip=document.createElement('div');tip.className='cxtip';tip.style.top='10px';el.appendChild(tip);
  chart.subscribeCrosshairMove(p=>{if(!p.time||!p.point||p.point.x<0||p.point.x>el.clientWidth){tip.style.opacity=0;return;}const d=p.seriesData.get(cs);if(!d){tip.style.opacity=0;return;}const up=d.close>=d.open;tip.innerHTML='O '+d.open.toFixed(2)+'  H '+d.high.toFixed(2)+'  L '+d.low.toFixed(2)+'  <span style="color:'+(up?P.up:P.dn)+'">C '+d.close.toFixed(2)+'</span>';tip.style.left=Math.max(70,Math.min(el.clientWidth-70,p.point.x))+'px';tip.style.opacity=1;});
  new ResizeObserver(()=>{try{chart.applyOptions({width:el.clientWidth});}catch(e){}}).observe(el);
  const closes=cd.map(d=>d.close);
  // RSI panel
  const rEl=document.getElementById('rsiContainer');
  if(rEl){const rc=mk(rEl,96,{timeScale:{visible:false,borderColor:P.bd}});charts.push(rc);const rv=computeRSI(closes,14);const off=cd.length-rv.length;rc.addLineSeries({color:P.s20,lineWidth:1,title:'RSI'}).setData(cd.map((d,i)=>i>=off?{time:d.date,value:rv[i-off]}:{time:d.date}));[70,30].forEach(L=>{rc.addLineSeries({color:L===70?'rgba(210,58,58,0.4)':'rgba(31,157,87,0.4)',lineWidth:1,lineStyle:2}).setData(cd.map(d=>({time:d.date,value:L})));});rc.timeScale().fitContent();new ResizeObserver(()=>{try{rc.applyOptions({width:rEl.clientWidth});}catch(e){}}).observe(rEl);}
  // MACD panel
  const mEl=document.getElementById('macdContainer');
  if(mEl){const m2=mk(mEl,96,{timeScale:{visible:false,borderColor:P.bd}});charts.push(m2);const {macdLine,signalLine,histogram}=computeMACD(closes);const off=cd.length-macdLine.length;m2.addLineSeries({color:P.s20,lineWidth:1,title:'MACD'}).setData(cd.map((d,i)=>i>=off?{time:d.date,value:macdLine[i-off]}:{time:d.date}));m2.addLineSeries({color:P.s50,lineWidth:1,title:'Signal'}).setData(cd.map((d,i)=>i>=off?{time:d.date,value:signalLine[i-off]}:{time:d.date}));m2.addHistogramSeries().setData(cd.map((d,i)=>i>=off?{time:d.date,value:histogram[i-off],color:histogram[i-off]>=0?P.volU:P.volD}:{time:d.date}));m2.timeScale().fitContent();new ResizeObserver(()=>{try{m2.applyOptions({width:mEl.clientWidth});}catch(e){}}).observe(mEl);}
  // Sync the time axis (pan/zoom/scroll) across the price, RSI and MACD panes.
  let _sync=false;
  charts.forEach(src=>{src.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(_sync||!range)return;_sync=true;charts.forEach(o=>{if(o!==src){try{o.timeScale().setVisibleLogicalRange(range);}catch(e){}}});_sync=false;});});
  // Default to ~1 year visible; the full ~5y of history is scrollable / zoomable.
  const _win=Math.min(cd.length,252);
  charts.forEach(c=>{try{c.timeScale().setVisibleLogicalRange({from:cd.length-_win,to:cd.length});}catch(e){}});
}

/* ============ ANNOTATED ANALYSIS — fib · regression channel · psych levels · candle signals ============ */
// A dedicated lightweight-charts canvas (the TradingView widget above is an iframe
// we can't draw on) where the backend-computed geometry is rendered ON the price.
// Toggles in #ovrToolbar show/hide each overlay; redrawn from OVR_STATE.
let OVR_STATE={channel:true,fib:true,psych:false,candles:true};
function _ovrPalette(){const dk=document.documentElement.dataset.theme==='dark';return dk
  ?{bg:'#1f232b',txt:'#aeb6c2',grid:'#2a2f39',bd:'#343b46',up:'#2ec27e',dn:'#ef5a6f',s20:'#5b8cff',s50:'#e0a83a',s200:'#a98bff',chan:'#5b8cff',fib:'#e0a83a',psych:'rgba(174,182,194,0.55)'}
  :{bg:'#ffffff',txt:'#3a3f4b',grid:'#eef0f3',bd:'#e8e8ec',up:'#1f9d57',dn:'#d23a3a',s20:'#2f6df0',s50:'#d98a1a',s200:'#8b5cf6',chan:'#2f6df0',fib:'#c47d12',psych:'rgba(120,120,130,0.5)'};}
function buildOverlayChart(){
  const el=document.getElementById('ovrChart'); if(!el) return;
  if(!window.LightweightCharts||!DATA||!DATA.technicals||!DATA.technicals.chart_data){el.innerHTML='<div class="empty" style="padding:30px;"><p>Overlay chart unavailable — price history not loaded.</p></div>';return;}
  const t=DATA.technicals;
  const cd=t.chart_data.filter(d=>d.close!=null&&d.open!=null&&!isNaN(d.close)); if(!cd.length) return;
  const P=_ovrPalette();
  const chart=LightweightCharts.createChart(el,{layout:{background:{color:P.bg},textColor:P.txt},grid:{vertLines:{color:P.grid},horzLines:{color:P.grid}},rightPriceScale:{borderColor:P.bd},timeScale:{borderColor:P.bd,timeVisible:false},width:el.clientWidth,height:400});
  const cs=chart.addCandlestickSeries({upColor:P.up,downColor:P.dn,borderUpColor:P.up,borderDownColor:P.dn,wickUpColor:P.up,wickDownColor:P.dn});
  cs.setData(cd.map(d=>({time:d.date,open:d.open,high:d.high,low:d.low,close:d.close})));
  // SMAs intentionally omitted here — this chart is for the overlay geometry
  // (channel / fib / psych / candle signals); the SMA stack lives on the
  // TradingView Price Chart and the Technical Summary above.
  let chanSeries=[],fibLines=[],psychLines=[];
  function clearOverlays(){chanSeries.forEach(s=>{try{chart.removeSeries(s);}catch(e){}});chanSeries=[];fibLines.forEach(l=>{try{cs.removePriceLine(l);}catch(e){}});fibLines=[];psychLines.forEach(l=>{try{cs.removePriceLine(l);}catch(e){}});psychLines=[];try{cs.setMarkers([]);}catch(e){}}
  function drawOverlays(){
    clearOverlays();
    const rc=t.regression_channel;
    if(OVR_STATE.channel&&rc&&rc.start_date){
      const seg=(a,b,style)=>{const s=chart.addLineSeries({color:P.chan,lineWidth:style===0?2:1,lineStyle:style,priceLineVisible:false,lastValueVisible:false,crosshairMarkerVisible:false});s.setData([{time:rc.start_date,value:a},{time:rc.end_date,value:b}]);chanSeries.push(s);};
      seg(rc.upper_start,rc.upper_end,2); seg(rc.mid_start,rc.mid_end,0); seg(rc.lower_start,rc.lower_end,2);
    }
    if(OVR_STATE.fib&&t.fib&&t.fib.levels){t.fib.levels.forEach(l=>{if(l.price==null)return;fibLines.push(cs.createPriceLine({price:l.price,color:P.fib,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'fib '+l.label}));});}
    if(OVR_STATE.psych&&t.psych_levels){t.psych_levels.forEach(v=>{psychLines.push(cs.createPriceLine({price:v,color:P.psych,lineWidth:1,lineStyle:3,axisLabelVisible:true,title:'$'+v}));});}
    if(OVR_STATE.candles&&t.candle_patterns&&t.candle_patterns.length){const mks=t.candle_patterns.map(c=>({time:c.date,position:c.direction==='bearish'?'aboveBar':'belowBar',color:c.direction==='bullish'?P.up:c.direction==='bearish'?P.dn:P.txt,shape:c.direction==='bullish'?'arrowUp':c.direction==='bearish'?'arrowDown':'circle',text:c.pattern}));try{cs.setMarkers(mks);}catch(e){}}
  }
  drawOverlays();
  const tb=document.getElementById('ovrToolbar');
  if(tb) tb.querySelectorAll('.ovr-tg').forEach(btn=>btn.onclick=()=>{const k=btn.dataset.ovr;OVR_STATE[k]=!OVR_STATE[k];btn.classList.toggle('on',OVR_STATE[k]);drawOverlays();});
  const _win=Math.min(cd.length,180);
  try{chart.timeScale().setVisibleLogicalRange({from:cd.length-_win,to:cd.length});}catch(e){}
  new ResizeObserver(()=>{try{chart.applyOptions({width:el.clientWidth});}catch(e){}}).observe(el);
}

/* ============ VALUATION — historical P/E vs. its own range ============ */
function buildPEChart(){
  const el=document.getElementById('peChart'); if(!el) return;
  const pe=DATA&&DATA.technicals&&DATA.technicals.pe_history;
  if(!window.LightweightCharts||!pe||!pe.series||pe.series.length<2){el.style.display='none';return;}
  const dk=document.documentElement.dataset.theme==='dark';
  const P=dk?{bg:'#1f232b',txt:'#aeb6c2',grid:'#2a2f39',bd:'#343b46',line:'#5b8cff',med:'rgba(174,182,194,0.6)'}:{bg:'#ffffff',txt:'#3a3f4b',grid:'#eef0f3',bd:'#e8e8ec',line:'#2f6df0',med:'rgba(120,120,130,0.55)'};
  const now=pe.percentile<25?'#1f9d57':pe.percentile>75?'#d23a3a':'#c47d12';
  const chart=LightweightCharts.createChart(el,{layout:{background:{color:P.bg},textColor:P.txt},grid:{vertLines:{color:P.grid},horzLines:{color:P.grid}},rightPriceScale:{borderColor:P.bd},timeScale:{borderColor:P.bd,timeVisible:false},width:el.clientWidth,height:240});
  const ls=chart.addLineSeries({color:P.line,lineWidth:2,priceLineVisible:false,title:'P/E'});
  ls.setData(pe.series.map(d=>({time:d.date,value:d.pe})));
  try{ls.createPriceLine({price:pe.median,color:P.med,lineWidth:1,lineStyle:2,axisLabelVisible:true,title:'median '+pe.median});}catch(e){}
  try{ls.createPriceLine({price:pe.current,color:now,lineWidth:2,lineStyle:0,axisLabelVisible:true,title:'now '+pe.current});}catch(e){}
  chart.timeScale().fitContent();
  new ResizeObserver(()=>{try{chart.applyOptions({width:el.clientWidth});}catch(e){}}).observe(el);
}

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
