/* ============================================================
   07-research.js — Skills section (research engine front-end)
   ------------------------------------------------------------
   CLASSIC SCRIPT, loaded after 06-app.js. Top-level `function`s become
   window globals and top-level let/const join the shared global scope, exactly
   like 01–06 (see README + the frontend-split memory). NO module / IIFE / defer
   — inline handlers and cross-file refs depend on the global-scope contract.

   Drives the Skills section over the R1–R3 backend:
     GET/POST/PUT/DELETE /skills      · saved pipelines (CRUD)
     POST /skills/propose             · planner drafts a plan from a sentence
     POST /research/run + SSE stream  · run a skill on a ticker, live
   Reuses existing globals: SECTIONS, renderSection, CURRENT, DATA, API_BASE,
   renderMD, toast, NOTES/updateNotesBadge/persistNotes, LC_CHECK.
   ============================================================ */

/* ---- Tool catalog — mirrors the backend ALLOWED_TOOLS (MODULE_REGISTRY keys
   + macro + reason). Keep in sync with app/routes/analyze.py MODULE_REGISTRY. -- */
const RSK_TOOLS = [
  {v:'technicals',          l:'Technicals'},
  {v:'financials',          l:'Financials'},
  {v:'options_flow',        l:'Options flow'},
  {v:'insider_activity',    l:'Insider activity'},
  {v:'news_sentiment',      l:'News & sentiment'},
  {v:'peers',               l:'Peer comparison'},
  {v:'earnings',            l:'Earnings'},
  {v:'analyst_ratings',     l:'Analyst ratings'},
  {v:'company',             l:'Company profile'},
  {v:'quote',               l:'Quote'},
  {v:'congressional_trades',l:'Congress'},
  {v:'dark_pool',           l:'Dark pool'},
  {v:'gamma_exposure',      l:'Gamma exposure'},
  {v:'macro',               l:'Macro dashboard'},
  {v:'reason',              l:'Reason · analyze prior steps'},
];
const RSK_FETCH = new Set(RSK_TOOLS.map(t=>t.v).filter(v=>v!=='reason')); // fetch tools incl. macro
const RSK_BOLT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>';

// Section sub-view + transient run/edit state (one Skills section, four views).
let RESEARCH = {skills:null, loading:false, view:'list', editing:null, run:null, proposeText:''};

/* ---- small helpers ---- */
function rskEsc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function rskAttr(s){return rskEsc(s).replace(/"/g,'&quot;');}
function rskSlug(s){return String(s==null?'':s).replace(/[^a-zA-Z0-9_-]/g,'_');}
// Mirror of app/research/executor.resolve_tool — WYSIWYG: what a step runs.
function resolveToolJS(name){
  const n=String(name||'').trim().toLowerCase().replace(/[\s-]+/g,'_').replace(/_?\d+$/,'');
  return RSK_FETCH.has(n)?n:'reason';
}
function rskToolLabel(v){const t=RSK_TOOLS.find(x=>x.v===v);return t?t.l:v;}
function rskUniqueName(base, taken){
  if(taken.indexOf(base)<0) return base;
  let i=2; while(taken.indexOf(base+'_'+i)>=0) i++; return base+'_'+i;
}
// Trim a name to <=max chars on a word boundary (never a hard mid-word slice).
function rskTrimName(s, max){
  s=String(s||'').trim();
  if(s.length<=max) return s;
  const cut=s.slice(0,max), sp=cut.lastIndexOf(' ');
  return (sp>Math.floor(max*0.5)?cut.slice(0,sp):cut).trim();
}
// Step names must be unique: they key the run's progress rows AND the backend's
// outputs/depends_on (see executor). Rename later duplicates in place.
function rskDedupeNames(subs){
  const seen=[];
  subs.forEach(s=>{ if(seen.indexOf(s.name)>=0) s.name=rskUniqueName(s.name, seen); seen.push(s.name); });
}
function rskBlankSubtask(){return {name:'reason', description:'', depends_on:[]};}
function rskBlankSkill(){
  return {id:null, name:'', description:'', version:1, plan:{subtasks:[
    {name:'technicals', description:'Pull the technical setup for {ticker}.', depends_on:[]},
    {name:'reason',     description:'Summarize the read on {ticker} and name the key risk.', depends_on:['technicals']},
  ]}};
}
function rskCurrentTicker(){
  const el=document.getElementById('tickerInput');
  return ((el&&el.value)||(DATA&&DATA.ticker)||'').toUpperCase().trim()||'AAPL';
}

/* ============ DATA LOAD ============ */
async function loadSkills(){
  if(RESEARCH.loading) return;
  RESEARCH.loading=true;
  try{
    const r=await fetch(`${API_BASE}/skills`);
    RESEARCH.skills = r.ok ? await r.json() : [];
  }catch(e){ RESEARCH.skills=[]; }
  RESEARCH.loading=false;
  rskUpdateNavBadge();
  if(CURRENT==='skills') renderSection('skills');
}
function rskUpdateNavBadge(){
  const b=document.querySelector('.nav-item[data-section="skills"] .pro');
  if(!b) return;
  const n=(RESEARCH.skills||[]).length;
  b.textContent=n; b.style.display=n?'inline-block':'none';
}

/* ============ SECTION OVERRIDE ============
   Replace the demo skills grid (defined in 03-render.js SECTIONS) with the real,
   data-driven view. SECTIONS is a const object but mutable; this runs at load. */
SECTIONS.skills = function(){
  if(RESEARCH.skills===null){ loadSkills(); return rskSkeleton(); }
  if(RESEARCH.view==='edit')    return rskEditorHTML();
  if(RESEARCH.view==='propose') return rskProposeHTML();
  if(RESEARCH.view==='run')     return rskRunHTML();
  return rskListHTML();
};

function rskHead(title, sub, back){
  return `<div class="page-head rsk-head">
    ${back?`<button class="rsk-back" data-rsk="cancel">← Skills</button>`:''}
    <h1><span class="rsk-h-ic">${RSK_BOLT}</span> ${rskEsc(title)}</h1>
    <p>${rskEsc(sub)}</p></div>`;
}
function rskSkeleton(){
  return `${rskHead('Skills','Loading your saved pipelines…')}
    <div class="skill-grid">${'<div class="skill-card rsk-skel"></div>'.repeat(2)}</div>`;
}

/* ============ LIST ============ */
function rskListHTML(){
  const skills=RESEARCH.skills||[];
  const cards=skills.map(s=>{
    const steps=(s.plan&&s.plan.subtasks)||[];
    const tools=steps.map(st=>rskToolLabel(resolveToolJS(st.name))).join(' · ')||'—';
    const n=steps.length;
    return `<div class="skill-card rsk-card">
      <div class="sh"><span class="si">${RSK_BOLT}</span><div>
        <div class="nm">${rskEsc(s.name)}</div>
        <div class="tg">${n} step${n===1?'':'s'} · v${s.version||1}</div></div></div>
      <div class="ds">${rskEsc(s.description||'No description.')}</div>
      <div class="rsk-toolline">${rskEsc(tools)}</div>
      <div class="sf">
        <button class="runbtn" data-rsk="run" data-id="${rskAttr(s.id)}">Run</button>
        <button class="rsk-btn ghost" data-rsk="edit" data-id="${rskAttr(s.id)}">Edit</button>
        <button class="rsk-btn ghost danger" data-rsk="delete" data-id="${rskAttr(s.id)}">Delete</button>
      </div></div>`;
  }).join('');
  const intro = skills.length
    ? `${skills.length} saved ${skills.length===1?'pipeline':'pipelines'}. Run one on the header ticker.`
    : 'No skills yet — describe one in a sentence and Numa drafts the pipeline.';
  return `${rskHead('Skills', intro)}
    <div class="skill-grid">
      ${cards}
      <div class="skill-card new" data-rsk="new">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
        <div style="font-weight:600;">New skill</div>
        <div style="font-size:11.5px;">Describe it → Numa drafts the plan</div>
      </div>
    </div>`;
}

/* ============ PROPOSE ============ */
function rskProposeHTML(){
  return `${rskHead('New skill','Describe what this skill should do. Numa proposes an ordered plan you can edit before saving.',true)}
    <div class="rsk-panel">
      <label class="rsk-label">Describe the skill</label>
      <textarea id="rskProposeText" class="rsk-textarea" rows="3" placeholder="e.g. Pre-earnings setup — options-implied move vs history, technical posture into the print, and the single biggest risk.">${rskEsc(RESEARCH.proposeText||'')}</textarea>
      <div class="rsk-actions">
        <button class="rsk-btn primary" data-rsk="propose-go">✦ Propose pipeline</button>
        <button class="rsk-btn ghost" data-rsk="blank">Build manually instead</button>
      </div>
      <div id="rskProposeStatus" class="rsk-status"></div>
    </div>`;
}
async function rskProposeGo(){
  const ta=document.getElementById('rskProposeText');
  const desc=((ta&&ta.value)||'').trim();
  RESEARCH.proposeText=desc;
  if(!desc){ toast('Describe the skill first'); return; }
  const st=document.getElementById('rskProposeStatus');
  if(st) st.innerHTML=`<span class="rsk-spin-inline"></span> Numa is drafting the pipeline…`;
  try{
    const r=await fetch(`${API_BASE}/skills/propose`,{
      method:'POST', headers:{'Content-Type':'application/json'},
      // Send the current ticker so the backend's safety net can scrub it out of
      // the reusable draft (name + step descriptions).
      body:JSON.stringify({description:desc, tickers:[rskCurrentTicker()]})});
    if(!r.ok) throw new Error('propose failed');
    const draft=await r.json();
    // The backend returns a short Title-Case name; fall back to a word-boundary
    // trim of the description (never a hard mid-word slice).
    const name=(draft.name&&draft.name.trim())||rskTrimName(desc,40);
    RESEARCH.editing=rskNormalizeSkill({
      id:null, name, description:draft.description||desc,
      version:1, plan:draft.plan});
    RESEARCH.view='edit';
    renderSection('skills');
  }catch(e){
    if(st) st.innerHTML=`<span class="rsk-err">Couldn't reach the planner. You can still build the skill manually.</span>`;
  }
}
function rskNormalizeSkill(s){
  const subs=((s.plan&&s.plan.subtasks)||[]).map(t=>({
    name:String(t.name||'reason'), description:String(t.description||''),
    depends_on:Array.isArray(t.depends_on)?t.depends_on.slice():[]}));
  if(!subs.length) subs.push(rskBlankSubtask());
  return {id:s.id||null, name:String(s.name||''), description:String(s.description||''),
          version:s.version||1, plan:{subtasks:subs}};
}

/* ============ EDITOR ============ */
function rskEditorHTML(){
  const ed=RESEARCH.editing||rskBlankSkill();
  const names=ed.plan.subtasks.map(s=>s.name);
  const cards=ed.plan.subtasks.map((st,i)=>rskSubtaskCard(st,i,names)).join('');
  const isNew=!ed.id;
  return `${rskHead(isNew?'New skill':'Edit skill', isNew?'Draft the pipeline, then save it.':'Tweak the pipeline. Saving bumps the version.', true)}
    <div class="rsk-panel">
      <label class="rsk-label">Name</label>
      <input id="rskName" class="rsk-input" value="${rskAttr(ed.name)}" placeholder="Skill name" maxlength="48">
      <label class="rsk-label">Description</label>
      <textarea id="rskDesc" class="rsk-textarea" rows="2" placeholder="What this skill answers. Use {ticker} where the symbol should go.">${rskEsc(ed.description)}</textarea>
      <div class="rsk-plan-head">
        <span class="rsk-label">Plan · ${ed.plan.subtasks.length} step${ed.plan.subtasks.length===1?'':'s'}</span>
        <span class="rsk-hint">Runs top to bottom · {ticker} is filled in per run</span>
      </div>
      <div class="rsk-subtasks">${cards}</div>
      <button class="rsk-btn ghost add" data-rsk="add-subtask">+ Add step</button>
      <div class="rsk-actions rsk-actions-foot">
        <button class="rsk-btn primary" data-rsk="save">${isNew?'Save skill':'Save changes'}</button>
        <button class="rsk-btn ghost" data-rsk="cancel">Cancel</button>
      </div>
    </div>`;
}
function rskSubtaskCard(st,i,names){
  const tool=resolveToolJS(st.name);
  const opts=RSK_TOOLS.map(t=>`<option value="${t.v}"${t.v===tool?' selected':''}>${rskEsc(t.l)}</option>`).join('');
  const prior=names.slice(0,i).filter(Boolean);
  const deps=prior.length
    ? prior.map(nm=>{
        const on=(st.depends_on||[]).indexOf(nm)>=0;
        return `<label class="rsk-dep"><input type="checkbox" data-rsk-dep="${i}" value="${rskAttr(nm)}"${on?' checked':''}> ${rskEsc(nm)}</label>`;
      }).join('')
    : `<span class="rsk-hint">First step — no dependencies.</span>`;
  const n=names.length;
  return `<div class="rsk-sub" data-i="${i}">
    <div class="rsk-sub-top">
      <span class="rsk-step">${i+1}</span>
      <select class="rsk-select" data-rsk-tool="${i}">${opts}</select>
      <input class="rsk-input name" data-rsk-name="${i}" value="${rskAttr(st.name)}" placeholder="step name" title="Identifier used by depends-on">
      <span class="rsk-sub-move">
        <button class="rsk-icon" data-rsk="up" data-i="${i}" ${i===0?'disabled':''} title="Move up">▲</button>
        <button class="rsk-icon" data-rsk="down" data-i="${i}" ${i===n-1?'disabled':''} title="Move down">▼</button>
        <button class="rsk-icon danger" data-rsk="del-subtask" data-i="${i}" ${n===1?'disabled':''} title="Remove step">×</button>
      </span>
    </div>
    <textarea class="rsk-textarea sub" data-rsk-sdesc="${i}" rows="2" placeholder="What this step does">${rskEsc(st.description)}</textarea>
    <div class="rsk-deps"><span class="rsk-deps-lbl">Depends on</span>${deps}</div>
  </div>`;
}
// Read every editor field back into RESEARCH.editing (called before any structural
// change / save so typed-but-unsaved text survives the re-render).
function rskSyncEditorFromDOM(){
  const ed=RESEARCH.editing; if(!ed) return;
  const nEl=document.getElementById('rskName'); if(nEl) ed.name=nEl.value;
  const dEl=document.getElementById('rskDesc'); if(dEl) ed.description=dEl.value;
  ed.plan.subtasks.forEach((st,i)=>{
    const nm=document.querySelector(`[data-rsk-name="${i}"]`);
    const ds=document.querySelector(`[data-rsk-sdesc="${i}"]`);
    if(nm) st.name=nm.value.trim()||st.name;
    if(ds) st.description=ds.value;
    const boxes=document.querySelectorAll(`[data-rsk-dep="${i}"]`);
    if(boxes.length) st.depends_on=Array.from(boxes).filter(b=>b.checked).map(b=>b.value);
  });
}
async function rskSaveSkill(){
  rskSyncEditorFromDOM();
  const ed=RESEARCH.editing;
  if(!ed.name||!ed.name.trim()){ toast('Name the skill first'); return; }
  rskDedupeNames(ed.plan.subtasks); // guarantee unique step names before persisting
  // Prune depends_on to names of strictly-earlier steps (keeps the plan a valid DAG).
  const names=ed.plan.subtasks.map(s=>s.name);
  ed.plan.subtasks.forEach((s,i)=>{
    const prior=new Set(names.slice(0,i));
    s.depends_on=(s.depends_on||[]).filter(d=>prior.has(d));
  });
  const body={name:ed.name.trim(), description:ed.description||'', plan:{subtasks:
    ed.plan.subtasks.map(s=>({name:s.name, description:s.description||'', depends_on:s.depends_on||[]}))}};
  try{
    const url=ed.id?`${API_BASE}/skills/${ed.id}`:`${API_BASE}/skills`;
    const r=await fetch(url,{method:ed.id?'PUT':'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(!r.ok) throw new Error('save failed');
    toast(ed.id?'Skill updated':'Skill saved');
    RESEARCH.view='list'; RESEARCH.editing=null;
    await loadSkills();
    if(CURRENT==='skills') renderSection('skills');
  }catch(e){ toast('Could not save skill'); }
}
function rskEditSkill(id){
  const s=(RESEARCH.skills||[]).find(x=>x.id===id);
  if(!s){ toast('Skill not found'); return; }
  RESEARCH.editing=rskNormalizeSkill(JSON.parse(JSON.stringify(s)));
  RESEARCH.view='edit'; renderSection('skills');
}
async function rskDeleteSkill(id){
  try{
    const r=await fetch(`${API_BASE}/skills/${id}`,{method:'DELETE'});
    if(!r.ok) throw new Error('delete failed');
    toast('Skill deleted');
    await loadSkills();
    if(CURRENT==='skills') renderSection('skills');
  }catch(e){ toast('Could not delete'); }
}

/* ============ RUN ============ */
function rskRenderPlan(plan, ticker){
  return {subtasks:((plan&&plan.subtasks)||[]).map(s=>({
    name:s.name, description:String(s.description||'').replace(/\{ticker\}/g,ticker),
    depends_on:s.depends_on||[]}))};
}
function rskStartRun(id){
  const s=(RESEARCH.skills||[]).find(x=>x.id===id);
  if(!s){ toast('Skill not found'); return; }
  RESEARCH.run={skill:s, ticker:rskCurrentTicker(), phase:'confirm', memoRaw:'', saved:false, runId:null, _memoDirty:false};
  RESEARCH.view='run'; renderSection('skills');
}
function rskRunHTML(){
  const run=RESEARCH.run; if(!run) return rskListHTML();
  const s=run.skill, ticker=run.ticker;
  const rplan=rskRenderPlan(s.plan, ticker);

  if(run.phase==='confirm'){
    const steps=rplan.subtasks.map((st,i)=>{
      const tool=resolveToolJS(st.name);
      return `<div class="rsk-prow"><span class="rsk-prow-ic static">${i+1}</span>
        <div class="rsk-prow-body">
          <div class="rsk-prow-title">${rskEsc(rskToolLabel(tool))} <span class="rsk-prow-name">${rskEsc(st.name)}</span></div>
          <div class="rsk-prow-sub">${rskEsc(st.description||'—')}</div></div></div>`;
    }).join('');
    return `${rskHead('Run · '+s.name,'Confirm the resolved plan, then Numa runs it live.',true)}
      <div class="rsk-panel">
        <div class="rsk-run-meta">
          <span class="rsk-chip ticker">${rskEsc(ticker)}</span>
          <span class="rsk-hint">Resolved for the header ticker · change it there and re-open Run.</span></div>
        <div class="rsk-run-steps">${steps}</div>
        <div class="rsk-actions rsk-actions-foot">
          <button class="rsk-btn primary" data-rsk="run-confirm">▶ Run on ${rskEsc(ticker)}</button>
          <button class="rsk-btn ghost" data-rsk="cancel">Cancel</button>
        </div>
      </div>`;
  }

  // running | done — progress rows + memo, streamed into by id.
  const done=run.phase==='done';
  return `${rskHead((done?'Result · ':'Running · ')+s.name, s.description||'', true)}
    <div class="rsk-panel">
      <div class="rsk-run-meta">
        <span class="rsk-chip ticker">${rskEsc(ticker)}</span>
        <span id="rskRunPhase" class="rsk-hint">${done?'Complete':'Streaming…'}</span></div>
      <div class="rsk-run-steps" id="rskRunRows"></div>
      <div class="rsk-memo-wrap">
        <div class="rsk-memo-head"><span class="rsk-label">Memo</span></div>
        <div class="rsk-memo" id="rskMemo">${done?renderMD(run.memoRaw):'<span class="rsk-hint">Waiting for synthesis…</span>'}</div>
      </div>
      <div class="rsk-actions rsk-actions-foot" id="rskRunFoot" ${done?'':'style="display:none;"'}>
        <button class="rsk-btn primary" data-rsk="save-note" ${run.saved?'disabled':''}>${run.saved?'✓ Saved to Notes':'Save to Notes'}</button>
        <button class="rsk-btn ghost" data-rsk="run-again">Run again</button>
        <button class="rsk-btn ghost" data-rsk="cancel">Done</button>
      </div>
    </div>`;
}
async function rskRunConfirm(){
  const run=RESEARCH.run; if(!run) return;
  const ticker=run.ticker;
  const rplan=rskRenderPlan(run.skill.plan, ticker);
  const objective=`${run.skill.name}: ${String(run.skill.description||'').replace(/\{ticker\}/g,ticker)} (${ticker})`.trim();
  const mode=(typeof PREMIUM_MODE!=='undefined'&&PREMIUM_MODE)?'premium':'free';
  run.phase='running'; run.memoRaw=''; run.saved=false; run._memoDirty=false;
  renderSection('skills'); // lay out #rskRunRows + #rskMemo before streaming
  let runId;
  try{
    const r=await fetch(`${API_BASE}/research/run`,{method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({plan:rplan, tickers:[ticker], objective, mode})});
    if(!r.ok) throw new Error('run start failed');
    runId=(await r.json()).run_id;
  }catch(e){ rskRunError('Could not start the run — is the backend up?'); return; }
  run.runId=runId;
  rskStreamResearch(runId);
}
async function rskStreamResearch(runId){
  const run=RESEARCH.run;
  let res;
  try{ res=await fetch(`${API_BASE}/research/stream/${runId}`); }
  catch(e){ rskRunError('Stream unavailable.'); return; }
  if(!res.ok||!res.body){ rskRunError('Stream unavailable.'); return; }
  const reader=res.body.getReader(), dec=new TextDecoder(); let buf='';
  while(true){
    let chunk;
    try{ chunk=await reader.read(); }catch(e){ break; }
    if(chunk.done) break;
    buf+=dec.decode(chunk.value,{stream:true});
    const lines=buf.split('\n'); buf=lines.pop();
    for(const line of lines){
      if(!line.startsWith('data:')) continue;
      let p=line.slice(5).trim();
      if(!p||p==='[DONE]') continue;
      p=p.replace(/\b-?Infinity\b/g,'null').replace(/\bNaN\b/g,'null');
      let ev; try{ ev=JSON.parse(p); }catch(e){ continue; }
      rskHandleEvent(ev);
    }
  }
  // Stream ended: if no fatal error already flipped us to done, finalize.
  if(RESEARCH.run===run && run.phase!=='done') rskRunFinish();
}
function rskHandleEvent(ev){
  const run=RESEARCH.run; if(!run) return;
  if(ev.type==='subtask_started'){
    const rows=document.getElementById('rskRunRows'); if(!rows) return;
    const tool=ev.tool||resolveToolJS(ev.name);
    const row=document.createElement('div');
    row.className='rsk-prow live'; row.id='rskrow-'+rskSlug(ev.name);
    row.innerHTML=`<span class="rsk-prow-ic"><span class="lc-spin"></span></span>
      <div class="rsk-prow-body">
        <div class="rsk-prow-title">${rskEsc(rskToolLabel(tool))} <span class="rsk-prow-name">${rskEsc(ev.name)}</span></div>
        <div class="rsk-prow-sub">${rskEsc(ev.description||'')}</div></div>`;
    rows.appendChild(row);
  } else if(ev.type==='subtask_completed'){
    const row=document.getElementById('rskrow-'+rskSlug(ev.name)); if(!row) return;
    const err=ev.data&&ev.data.error;
    const ic=row.querySelector('.rsk-prow-ic');
    if(ic) ic.innerHTML=err?'<span class="rsk-x">!</span>':`<span class="lc-done">${LC_CHECK}</span>`;
    row.classList.remove('live'); row.classList.add(err?'err':'done');
    if(err){ const sub=row.querySelector('.rsk-prow-sub'); if(sub) sub.textContent='Error: '+err; }
  } else if(ev.type==='synthesis_token'){
    run.memoRaw+=ev.token||''; run._memoDirty=true; requestAnimationFrame(rskFlushMemo);
  } else if(ev.type==='complete'){
    if(typeof ev.synthesis==='string'&&ev.synthesis) run.memoRaw=ev.synthesis;
    run._memoDirty=true; rskFlushMemo();
  } else if(ev.type==='error'){
    rskRunError(ev.error||'Run error');
  }
}
function rskFlushMemo(){
  const run=RESEARCH.run; if(!run||!run._memoDirty) return;
  run._memoDirty=false;
  const m=document.getElementById('rskMemo');
  if(m) m.innerHTML=renderMD(run.memoRaw)||'<span class="rsk-hint">…</span>';
}
function rskRunFinish(){
  const run=RESEARCH.run; if(!run) return;
  run.phase='done';
  const ph=document.getElementById('rskRunPhase'); if(ph) ph.textContent='Complete';
  const foot=document.getElementById('rskRunFoot'); if(foot) foot.style.display='';
  rskFlushMemo();
}
function rskRunError(msg){
  const run=RESEARCH.run; if(run) run.phase='done';
  const m=document.getElementById('rskMemo'); if(m) m.innerHTML=`<span class="rsk-err">${rskEsc(msg)}</span>`;
  const ph=document.getElementById('rskRunPhase'); if(ph) ph.textContent='Error';
  const foot=document.getElementById('rskRunFoot'); if(foot) foot.style.display='';
}
function rskSaveNote(){
  const run=RESEARCH.run;
  if(!run||!run.memoRaw){ toast('Nothing to save yet'); return; }
  NOTES.unshift({title:run.skill.name+' · '+run.ticker, text:run.memoRaw, icon:RSK_BOLT,
    cost:0, ticker:run.ticker,
    time:new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})});
  updateNotesBadge(); persistNotes();
  run.saved=true;
  const b=document.querySelector('[data-rsk="save-note"]');
  if(b){ b.disabled=true; b.textContent='✓ Saved to Notes'; }
  toast('Saved to Notes');
}

/* ============ EVENT DELEGATION ============
   One click listener for every data-rsk action + one change listener for the
   per-step Tool select. Unique attribute names → no collision with 06-app.js. */
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-rsk]'); if(!el) return;
  const action=el.getAttribute('data-rsk');
  const id=el.getAttribute('data-id');
  const i=el.hasAttribute('data-i')?+el.getAttribute('data-i'):-1;
  const ed=RESEARCH.editing;

  if(action==='new'){ RESEARCH.view='propose'; RESEARCH.proposeText=''; renderSection('skills'); return; }
  if(action==='blank'){ RESEARCH.editing=rskBlankSkill(); RESEARCH.view='edit'; renderSection('skills'); return; }
  if(action==='propose-go'){ rskProposeGo(); return; }
  if(action==='edit'){ rskEditSkill(id); return; }
  if(action==='delete'){
    if(el.dataset.armed==='1'){ rskDeleteSkill(id); return; }
    el.dataset.armed='1'; el.textContent='Confirm?'; el.classList.add('armed');
    setTimeout(()=>{ try{ el.dataset.armed='0'; el.textContent='Delete'; el.classList.remove('armed'); }catch(_){} },2600);
    return;
  }
  if(action==='save'){ rskSaveSkill(); return; }
  if(action==='cancel'){ RESEARCH.view='list'; RESEARCH.editing=null; RESEARCH.run=null; renderSection('skills'); return; }
  if(action==='add-subtask'){ if(!ed)return; rskSyncEditorFromDOM(); const nm=rskUniqueName('reason', ed.plan.subtasks.map(s=>s.name)); ed.plan.subtasks.push({name:nm, description:'', depends_on:[]}); renderSection('skills'); return; }
  if(action==='del-subtask'){ if(!ed)return; rskSyncEditorFromDOM(); ed.plan.subtasks.splice(i,1); if(!ed.plan.subtasks.length) ed.plan.subtasks.push(rskBlankSubtask()); renderSection('skills'); return; }
  if(action==='up'||action==='down'){
    if(!ed)return; rskSyncEditorFromDOM();
    const j=action==='up'?i-1:i+1, a=ed.plan.subtasks;
    if(j<0||j>=a.length) return;
    const t=a[i]; a[i]=a[j]; a[j]=t; renderSection('skills'); return;
  }
  if(action==='run'){ rskStartRun(id); return; }
  if(action==='run-confirm'){ rskRunConfirm(); return; }
  if(action==='run-again'){ if(RESEARCH.run){ RESEARCH.run.phase='confirm'; RESEARCH.run.saved=false; } renderSection('skills'); return; }
  if(action==='save-note'){ rskSaveNote(); return; }
});
// Tool select drives the step name (name is the backend's tool selector).
document.addEventListener('change',e=>{
  const ts=e.target.closest('[data-rsk-tool]'); if(!ts) return;
  const ed=RESEARCH.editing; if(!ed) return;
  rskSyncEditorFromDOM();
  const idx=+ts.getAttribute('data-rsk-tool');
  const others=ed.plan.subtasks.map((s,j)=>j===idx?null:s.name).filter(Boolean);
  ed.plan.subtasks[idx].name=rskUniqueName(ts.value, others);
  renderSection('skills');
});

/* ============================================================
   CHAT AUTO-RESEARCH (the automatic door)
   ============================================================
   The /numa chat may deploy a throwaway research plan for clearly multi-step
   questions instead of a direct answer. A cheap LOCAL heuristic gates simple
   questions out with NO backend call (identical latency); only complex-looking
   questions consult the backend classifier via POST /numa/research. On deploy we
   render live progress rows + streamed synthesis + cost into the chat bubble and
   offer "Save as skill". Mirrors app/research/classifier._signals_complexity. */

const NUMA_COMPLEX_RE = /\b(compare|vs\.?|versus|deep[\s-]?dive|build (?:a|the) case|make (?:a|the) case|bull (?:and|&|\/) bear|bear (?:and|&|\/) bull|walk me through|step[\s-]?by[\s-]?step|comprehensive|full (?:analysis|breakdown|picture|report|dd)|thesis|everything (?:about|on)|end[\s-]?to[\s-]?end)\b/i;

function numaSignalsComplexity(question, tickers){
  if((tickers||[]).length >= 2) return true;
  if(NUMA_COMPLEX_RE.test(question||'')) return true;
  return (question||'').trim().split(/\s+/).filter(Boolean).length >= 45;
}
function numaScopeTickers(){
  const tabs = (typeof islandTabs==='function') ? islandTabs() : [];
  return [...new Set(tabs.map(t=>t&&t.ticker).filter(Boolean).map(t=>t.toUpperCase()))];
}

// Returns true if it handled the question as a research run (chat should stop).
async function numaTryAutoResearch(question){
  question=(question||'').trim();
  if(!question) return false;
  const tickers=numaScopeTickers();
  if(!numaSignalsComplexity(question, tickers)) return false;   // simple → never leaves
  let decision;
  try{
    const mode=(typeof PREMIUM_MODE!=='undefined'&&PREMIUM_MODE)?'premium':'free';
    const r=await fetch(`${API_BASE}/numa/research`,{method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({question, tickers, mode})});
    if(!r.ok) return false;
    decision=await r.json();
  }catch(e){ return false; }
  if(!decision || !decision.deploy || !decision.run_id) return false;
  await numaRunResearchInChat(question, decision);
  return true;
}

async function numaRunResearchInChat(question, decision){
  const userNode = addUser(question);
  if(typeof numaHistory!=='undefined') numaHistory.push({role:'user', content:question});
  const node = addAI('research');
  if(typeof pinLatest==='function') pinLatest(userNode);
  const mtext = node.querySelector('.mtext');
  const nSteps = ((decision.plan&&decision.plan.subtasks)||[]).length;
  mtext.innerHTML = `<div class="rsk-chat-run">
    <div class="rsk-chat-plan">Numa deployed a ${nSteps}-step research plan</div>
    <div class="rsk-run-steps" id="numaRunRows"></div>
    <div class="rsk-memo rsk-chat-memo" id="numaMemo" style="display:none;"></div>
  </div>`;
  const rows = mtext.querySelector('#numaRunRows'), memoEl = mtext.querySelector('#numaMemo');
  const t0 = (typeof performance!=='undefined') ? performance.now() : 0;
  const run = {memoRaw:'', usage:null, _dirty:false};

  try{
    const res = await fetch(`${API_BASE}/research/stream/${decision.run_id}`);
    if(!res.ok||!res.body) throw new Error('stream unavailable');
    const reader=res.body.getReader(), dec=new TextDecoder(); let buf='';
    while(true){
      let chunk; try{ chunk=await reader.read(); }catch(e){ break; }
      if(chunk.done) break;
      buf+=dec.decode(chunk.value,{stream:true});
      const lines=buf.split('\n'); buf=lines.pop();
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        let p=line.slice(5).trim(); if(!p||p==='[DONE]')continue;
        p=p.replace(/\b-?Infinity\b/g,'null').replace(/\bNaN\b/g,'null');
        let ev; try{ ev=JSON.parse(p); }catch(e){ continue; }
        numaHandleResearchEvent(ev, rows, memoEl, run);
      }
    }
  }catch(err){
    memoEl.style.display=''; memoEl.innerHTML='<span class="rsk-err">Research run failed: '+rskEsc(err.message||'error')+'</span>';
  }
  numaFlushChatMemo(memoEl, run);

  // Finalize: history, note (Save to notes), cost meta + header spend, Save-as-skill.
  const memo = run.memoRaw||'';
  if(typeof numaHistory!=='undefined') numaHistory.push({role:'assistant', content:memo});
  const u = run.usage || {input_tokens:0, output_tokens:0, cost_usd:0};
  node._note = {title:question.slice(0,70), text:memo, cost:u.cost_usd||0, icon:RSK_BOLT};
  if(typeof totalSpend!=='undefined'){
    totalSpend += u.cost_usd||0;
    const sp=document.getElementById('spendAmt'); if(sp&&typeof fmtSpend==='function') sp.textContent=fmtSpend();
  }
  const secs = t0 ? ((performance.now()-t0)/1000).toFixed(1) : '';
  const mm = node.querySelector('.mmeta');
  if(mm) mm.innerHTML = 'research · '+(((u.input_tokens||0)+(u.output_tokens||0))).toLocaleString()+
    ' tok <span class="cost">$'+(u.cost_usd||0).toFixed(3)+'</span>'+(secs?' <span>'+secs+'s</span>':'');
  numaAddSaveSkillButton(node, question, decision);
  if(typeof scrollThread==='function') scrollThread();
}

function numaHandleResearchEvent(ev, rows, memoEl, run){
  if(ev.type==='subtask_started'){
    const tool=ev.tool||resolveToolJS(ev.name);
    const row=document.createElement('div');
    row.className='rsk-prow live'; row.id='numarow-'+rskSlug(ev.name);
    row.innerHTML=`<span class="rsk-prow-ic"><span class="lc-spin"></span></span>
      <div class="rsk-prow-body"><div class="rsk-prow-title">${rskEsc(rskToolLabel(tool))} <span class="rsk-prow-name">${rskEsc(ev.name)}</span></div>
      <div class="rsk-prow-sub">${rskEsc(ev.description||'')}</div></div>`;
    rows.appendChild(row); if(typeof scrollThread==='function') scrollThread();
  } else if(ev.type==='subtask_completed'){
    const row=document.getElementById('numarow-'+rskSlug(ev.name)); if(!row) return;
    const err=ev.data&&ev.data.error, ic=row.querySelector('.rsk-prow-ic');
    if(ic) ic.innerHTML=err?'<span class="rsk-x">!</span>':`<span class="lc-done">${LC_CHECK}</span>`;
    row.classList.remove('live'); row.classList.add(err?'err':'done');
  } else if(ev.type==='synthesis_token'){
    memoEl.style.display=''; run.memoRaw+=ev.token||''; run._dirty=true;
    requestAnimationFrame(()=>numaFlushChatMemo(memoEl, run));
  } else if(ev.type==='complete'){
    if(typeof ev.synthesis==='string'&&ev.synthesis) run.memoRaw=ev.synthesis;
    run._dirty=true; numaFlushChatMemo(memoEl, run);
  } else if(ev.type==='usage'){
    run.usage=ev;
  } else if(ev.type==='error'){
    memoEl.style.display=''; memoEl.innerHTML='<span class="rsk-err">'+rskEsc(ev.error||'error')+'</span>';
  }
}
function numaFlushChatMemo(memoEl, run){
  if(!run._dirty) return; run._dirty=false;
  memoEl.style.display=''; memoEl.innerHTML=renderMD(run.memoRaw)||'';
  if(typeof scrollThread==='function') scrollThread();
}

/* ---- Save-as-skill: generalize the used plan's tickers → {ticker}, POST /skills ---- */
function numaAddSaveSkillButton(node, question, decision){
  const acts=node.querySelector('.mactions'); if(!acts) return;
  const b=document.createElement('button');
  b.setAttribute('data-numaskill','1');
  b._question=question; b._plan=decision.plan; b._tickers=decision.tickers||[];
  b.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>Save as skill';
  acts.appendChild(b);
}
function numaGeneralizePlan(plan, tickers){
  const syms=(tickers||[]).map(t=>String(t).toUpperCase()).filter(Boolean);
  const gen=s=>{ let out=String(s||''); syms.forEach(sym=>{
    out=out.replace(new RegExp('\\$?\\b'+sym.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\b','ig'),'{ticker}'); }); return out; };
  return {subtasks:((plan&&plan.subtasks)||[]).map(s=>({name:s.name, description:gen(s.description), depends_on:s.depends_on||[]}))};
}
function numaSkillName(question){
  const words=String(question||'').replace(/[^\w\s]/g,' ').trim().split(/\s+/).filter(Boolean).slice(0,6);
  let n=words.map(w=>w.charAt(0).toUpperCase()+w.slice(1)).join(' ');
  return rskTrimName(n, 40) || 'Chat Research';
}
async function numaSaveAsSkill(btn){
  const body={name:numaSkillName(btn._question), description:btn._question,
              plan:numaGeneralizePlan(btn._plan, btn._tickers)};
  try{
    const r=await fetch(`${API_BASE}/skills`,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body)});
    if(!r.ok) throw new Error('save failed');
    if(typeof toast==='function') toast('Saved as skill · edit it in Skills');
    btn.disabled=true; btn.innerHTML='✓ Saved as skill';
    if(typeof loadSkills==='function') loadSkills();
  }catch(e){ if(typeof toast==='function') toast('Could not save skill'); }
}
document.addEventListener('click',e=>{
  const sk=e.target.closest('[data-numaskill]'); if(sk){ numaSaveAsSkill(sk); }
});

/* ============ INIT ============ */
// Populate the nav badge + cache on load (DOM is ready — scripts are at body end).
loadSkills();
