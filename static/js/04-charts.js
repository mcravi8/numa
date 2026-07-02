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

