const SHEETS_URL = '/api/sync';
const ACTIVITIES = ["Midnight Prayer","Mid-day Prayer","Bible Reading","Reflection","Confessions","Word Tape"];
const ACT_ICONS  = ["🌙","☀️","📖","🤔","🙏🏽","🎙"];
const ACT_SHORT  = ["Mid.Pr","Mid-day","Bible","Reflect","Confess","W.Tape"];

let members = [];
let manualData = {};
let parsedRows = [];
let lastManualRows = [];

/* ── Storage helpers ─────────────────── */
function ls(k,v){ if(v===undefined){try{return JSON.parse(localStorage.getItem(k));}catch{return null;}} localStorage.setItem(k,JSON.stringify(v)); }
function getHistory(){ return ls('ccg_history')||[]; }
function saveHistory(h){ ls('ccg_history',h); }
function getPending(){ return ls('ccg_pending')||[]; }
function savePending(p){ ls('ccg_pending',p); }

function load(){
  members = ls('ccg_members')||[];
  const dd = localStorage.getItem('ccg_defaultDept')||'';
  document.getElementById('defaultDept').value=dd;
  if(dd){document.getElementById('m-dept').value=dd;document.getElementById('p-dept').value=dd;}
}

function save(){ ls('ccg_members',members); }
function saveDefaultDept(){
  const v=document.getElementById('defaultDept').value;
  localStorage.setItem('ccg_defaultDept',v);
  document.getElementById('m-dept').value=v;
  document.getElementById('p-dept').value=v;
}

/* ── Tab switching ───────────────────── */
function switchTab(name){
  const names=['manual','paste','history','settings'];
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',names[i]===name));
  document.querySelectorAll('.tab-pane').forEach(p=>p.classList.remove('active'));
  document.getElementById('pane-'+name).classList.add('active');
  if(name==='history') renderHistory();
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ── Roster / settings ───────────────── */
function renderRoster(){
  const list=document.getElementById('rosterList');
  if(!members.length){list.innerHTML='<p style="font-size:13px;color:var(--text-light);padding:6px 0;">No members yet.</p>';return;}
  list.innerHTML=members.map((m,i)=>`<div class="roster-item"><span>${esc(m)}</span><button onclick="removeMember(${i})">✕</button></div>`).join('');
}

function renderActivityList(){
  document.getElementById('activityList').innerHTML=ACTIVITIES.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(15,31,61,0.06);">
      <span style="font-size:15px;">${ACT_ICONS[i]}</span>
      <span style="font-size:13px;">${a}</span>
    </div>`).join('');
}

function addMember(){
  const inp=document.getElementById('newMemberInput');
  const name=inp.value.trim();
  if(!name) return;
  if(members.map(m=>m.toLowerCase()).includes(name.toLowerCase())){showToast('Already in roster');return;}
  members.push(name);save();inp.value='';renderRoster();renderManualGrid();
}

function removeMember(i){members.splice(i,1);save();renderRoster();renderManualGrid();}

/* ── Manual grid ─────────────────────── */
function renderManualGrid(){
  const grid=document.getElementById('entryGrid');
  const hint=document.getElementById('noMembersHint');
  const hdr=document.getElementById('actHeader');
  const btn=document.getElementById('generateBtn');
  if(!members.length){hint.style.display='block';hdr.style.display='none';grid.innerHTML='';btn.style.display='none';return;}
  hint.style.display='none';hdr.style.display='flex';btn.style.display='flex';
  document.getElementById('actHeaderCols').innerHTML=ACT_ICONS.map((ic,i)=>`<div class="act-col-lbl">${ic}<br>${ACT_SHORT[i]}</div>`).join('');
  members.forEach(m=>{
    if(!manualData[m])manualData[m]={};
    ACTIVITIES.forEach(a=>{if(manualData[m][a]===undefined)manualData[m][a]=false;});
  });
  grid.innerHTML=members.map(m=>`
    <div class="member-row">
      <div class="member-name">${esc(m)}</div>
      <div class="checks">${ACTIVITIES.map((a,ai)=>`
        <div class="chk-wrap">
          <div class="chk-box ${manualData[m][a]?'checked':''}"
               onclick="toggleCheck('${escAttr(m)}','${escAttr(a)}')"
               data-member="${escAttr(m)}" data-act="${escAttr(a)}">
            ${manualData[m][a]?'✅':''}
          </div>
        </div>`).join('')}
      </div>
      <button class="absent-btn" onclick="markAbsent('${escAttr(m)}')">✕ none</button>
    </div>`).join('');
}

function toggleCheck(member,activity){
  if(!manualData[member])manualData[member]={};
  manualData[member][activity]=!manualData[member][activity];
  document.querySelectorAll(`.chk-box[data-member="${escAttr(member)}"][data-act="${escAttr(activity)}"]`).forEach(el=>{
    const c=manualData[member][activity];
    el.className='chk-box'+(c?' checked':'');
    el.textContent=c?'✅':'';
  });
}

function markAbsent(member){
  ACTIVITIES.forEach(a=>{manualData[member][a]=false;});
  document.querySelectorAll(`.chk-box[data-member="${escAttr(member)}"]`).forEach(el=>{el.className='chk-box';el.textContent='';});
}

function generateFromManual(){
  lastManualRows=members.map(m=>({name:m,...Object.fromEntries(ACTIVITIES.map(a=>[a,manualData[m]?.[a]||false]))}));
  const dept=document.getElementById('m-dept').value.trim()||'Department';
  const ddate=document.getElementById('m-date').value||today();
  renderResults(lastManualRows,dept,ddate,'manual');
  setSyncStrip('manual','idle');
  document.getElementById('resultSection').style.display='block';
  setTimeout(()=>document.getElementById('resultSection').scrollIntoView({behavior:'smooth',block:'start'}),80);
}

function resetManual(){
  manualData={};renderManualGrid();
  document.getElementById('resultSection').style.display='none';
  window.scrollTo({top:0,behavior:'smooth'});
}

/* ── AI Paste ────────────────────────── */
async function runParse(){
  const raw=document.getElementById('raw').value.trim();
  if(!raw){showError('Please paste the WhatsApp report text first.');return;}
  const btn=document.getElementById('parseBtn');
  btn.classList.add('loading');btn.disabled=true;hideError();
  const dept=document.getElementById('p-dept').value.trim()||'Department';
  const ddate=document.getElementById('p-date').value||today();
  const prompt=`You are a church participation report parser. Extract each member's participation.
Activities (map variations):
- "Midnight Prayer": midnight prayer, mid night prayer
- "Mid-day Prayer": midday prayer, mid-day prayer
- "Bible Reading": bible reading, bible study
- "Reflection": reflection
- "Confessions": confessions, confession
- "Word Tape": word tape
Rules:
1. Only ❌ = all false.
2. ✅ next to activity = true for that activity, others false.
3. Ignore headers, dates.
4. Preserve names exactly.
Return ONLY valid JSON array, no markdown.
Format:[{"name":"Bro Oscar","Midnight Prayer":true,"Mid-day Prayer":false,"Bible Reading":true,"Reflection":false,"Confessions":false,"Word Tape":false},...]
Report:\n${raw}`;
  try{
    const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({model:'claude-sonnet-4-20250514',max_tokens:1000,messages:[{role:'user',content:prompt}]})});
    if(!res.ok) throw new Error(`API ${res.status}`);
    const data=await res.json();
    const text=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
    parsedRows=JSON.parse(text.replace(/```json|```/g,'').trim());
    renderResults(parsedRows,dept,ddate,'paste');
    setSyncStrip('paste','idle');
    document.getElementById('resultSectionPaste').style.display='block';
    setTimeout(()=>document.getElementById('resultSectionPaste').scrollIntoView({behavior:'smooth',block:'start'}),80);
  }catch(e){showError('Could not parse. Check internet connection. ('+e.message+')');}
  btn.classList.remove('loading');btn.disabled=false;
}

function resetPaste(){
  document.getElementById('raw').value='';
  document.getElementById('resultSectionPaste').style.display='none';
  parsedRows=[];hideError();window.scrollTo({top:0,behavior:'smooth'});
}

/* ── Shared render ───────────────────── */
function renderResults(rows,dept,ddate,mode){
  const pfx=mode==='manual'?'m-':'p-';
  const total=rows.length;
  const participated=rows.filter(r=>ACTIVITIES.some(a=>r[a])).length;
  const checks=rows.reduce((s,r)=>s+ACTIVITIES.filter(a=>r[a]).length,0);
  const rate=total?Math.round((checks/(total*ACTIVITIES.length))*100):0;
  document.getElementById(pfx+'statMembers').textContent=total;
  document.getElementById(pfx+'statPresent').textContent=participated;
  document.getElementById(pfx+'statRate').textContent=rate+'%';
  const fmt=new Date(ddate+'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  document.getElementById(pfx+'resultTitle').textContent=dept;
  document.getElementById(pfx+'resultSub').textContent=fmt+' · '+total+' members';
  let html='<thead><tr><th>Member</th>';
  ACT_ICONS.forEach((ic,i)=>html+=`<th>${ic} ${ACT_SHORT[i]}</th>`);
  html+='<th>Score</th></tr></thead><tbody>';
  rows.forEach(r=>{
    const score=ACTIVITIES.filter(a=>r[a]).length;
    const cls=score>=4?'score-high':score>=2?'score-mid':'score-low';
    html+=`<tr><td class="name-cell">${esc(r.name)}</td>`;
    ACTIVITIES.forEach(a=>{html+=r[a]?`<td><span class="check">✅</span></td>`:`<td><span class="cross-icon">✕</span></td>`;});
    html+=`<td><span class="score-pill ${cls}">${score}/6</span></td></tr>`;
  });
  html+='</tbody>';
  document.getElementById(pfx+'resultTable').innerHTML=html;
}

/* ── Sync to Google Sheets ───────────── */
async function syncToSheets(mode){
  const rows=mode==='manual'?getRows('manual'):parsedRows;
  const dept=getDept(mode);
  const ddate=getDate(mode);
  if(!rows.length){showToast('No data to sync');return;}

  const btn=document.getElementById(mode==='manual'?'m-syncBtn':'p-syncBtn');
  btn.classList.add('loading');btn.disabled=true;
  setSyncStrip(mode,'syncing');
  setDot('pending');

  const payload={
    department:dept,
    date:ddate,
    rows:rows.map(r=>({
      name:r.name,
      ...Object.fromEntries(ACTIVITIES.map(a=>[a,r[a]||false])),
      score:ACTIVITIES.filter(a=>r[a]).length,
      rate:Math.round((ACTIVITIES.filter(a=>r[a]).length/ACTIVITIES.length)*100)+'%'
    }))
  };

  try{
    const res=await fetch(SHEETS_URL,{method:'POST',body:JSON.stringify(payload)});
    const json=await res.json();
    if(json.status==='ok'){
      setSyncStrip(mode,'done');
      setDot('ok');
      saveToHistory(payload,true);
      showToast('✅ Saved to Google Sheets!');
    } else {
      throw new Error(json.message||'Unknown error');
    }
  }catch(e){
    setSyncStrip(mode,'fail');
    setDot('error');
    saveToHistory(payload,false);
    addToPending(payload);
    showToast('Saved locally — will retry when online');
  }
  btn.classList.remove('loading');btn.disabled=false;
}

function setSyncStrip(mode,state){
  const el=document.getElementById(mode==='manual'?'m-syncStrip':'p-syncStrip');
  el.className='sync-strip '+state;
  const msgs={
    idle:'☁️ Ready to sync to Google Sheets',
    syncing:'⏳ Syncing to Google Sheets…',
    done:'✅ Saved to Google Sheets successfully',
    fail:'⚠️ Offline — saved locally, will sync later'
  };
  el.textContent=msgs[state]||'';
}

function setDot(state){
  const d=document.getElementById('syncDot');
  d.className='sync-dot'+(state==='ok'?' ok':state==='pending'?' pending':state==='error'?' error':'');
}

/* ── Local history ───────────────────── */
function saveToHistory(payload,synced){
  const h=getHistory();
  const key=payload.department+'|'+payload.date;
  const idx=h.findIndex(e=>e.key===key);
  const entry={key,department:payload.department,date:payload.date,rows:payload.rows,synced,savedAt:new Date().toISOString()};
  if(idx>=0) h[idx]=entry; else h.unshift(entry);
  if(h.length>90) h.splice(90);
  saveHistory(h);
}

function addToPending(payload){
  const p=getPending();
  const key=payload.department+'|'+payload.date;
  if(!p.find(e=>e.key===key)) p.push({...payload,key});
  savePending(p);
  renderPendingBanner();
}

async function retryAllPending(){
  const p=getPending();
  if(!p.length) return;
  let succeeded=0;
  for(const payload of p){
    try{
      const res=await fetch(SHEETS_URL,{method:'POST',body:JSON.stringify(payload)});
      const json=await res.json();
      if(json.status==='ok'){
        succeeded++;
        saveToHistory(payload,true);
        const h=getHistory();
        const idx=h.findIndex(e=>e.key===payload.key);
        if(idx>=0){h[idx].synced=true;saveHistory(h);}
      }
    }catch{}
  }
  if(succeeded>0){
    const remaining=p.filter(async payload=>{
      try{const r=await fetch(SHEETS_URL,{method:'POST',body:JSON.stringify(payload)});return (await r.json()).status!=='ok';}catch{return true;}
    });
    savePending(getPending().slice(succeeded));
    showToast(`${succeeded} report(s) synced!`);
    if(succeeded===p.length){setDot('ok');}
  } else {
    showToast('Still offline — try again later');
  }
  renderHistory();
  renderPendingBanner();
}

function renderPendingBanner(){
  const p=getPending();
  const banner=document.getElementById('pendingBanner');
  const msg=document.getElementById('pendingMsg');
  if(p.length){
    banner.style.display='flex';
    msg.textContent=`${p.length} report${p.length>1?'s':''} saved locally, not yet synced to Sheets.`;
    setDot('pending');
  } else {
    banner.style.display='none';
  }
}

function renderHistory(){
  renderPendingBanner();
  const h=getHistory();
  const list=document.getElementById('historyList');
  if(!h.length){
    list.innerHTML='<div class="history-empty">No reports saved yet.<br>Generate and sync your first report to see history here.</div>';
    return;
  }
  list.innerHTML=h.map((entry,i)=>{
    const fmt=new Date(entry.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short',year:'numeric'});
    const participated=entry.rows.filter(r=>ACTIVITIES.some(a=>r[a])).length;
    const rate=entry.rows.length?Math.round((entry.rows.reduce((s,r)=>s+(parseInt(r.score)||0),0)/(entry.rows.length*ACTIVITIES.length))*100):0;
    return `
    <div class="history-day">
      <div class="history-day-header" onclick="toggleHistory(${i})">
        <div>
          <h3>${esc(entry.department)}</h3>
          <p>${fmt} · ${participated}/${entry.rows.length} participated · ${rate}% rate</p>
        </div>
        <div class="h-badges">
          <span class="h-badge ${entry.synced?'synced':'local'}">${entry.synced?'Synced':'Local only'}</span>
          <span style="font-size:14px;color:var(--text-light);">›</span>
        </div>
      </div>
      <div class="history-day-body" id="hbody-${i}">
        <table class="h-mini-table">
          ${entry.rows.map(r=>{
            const done=ACTIVITIES.filter(a=>r[a]);
            return `<tr>
              <td>${esc(r.name)}</td>
              <td>${done.length?done.map(a=>ACT_ICONS[ACTIVITIES.indexOf(a)]).join(' '):'❌ Absent'}</td>
              <td style="color:var(--text-muted);text-align:right;">${r.score}/6</td>
            </tr>`;
          }).join('')}
        </table>
        <div class="h-action-row">
          <button class="btn-secondary" onclick="reShareWhatsApp(${i})">Copy for WhatsApp</button>
          ${!entry.synced?`<button class="btn-secondary" style="color:var(--green);border-color:rgba(22,101,52,0.3);" onclick="reSync(${i})">Sync to Sheets</button>`:''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistory(i){
  const body=document.getElementById('hbody-'+i);
  body.classList.toggle('open');
}

function reShareWhatsApp(i){
  const h=getHistory();
  const entry=h[i];
  const fmt=new Date(entry.date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const total=entry.rows.length;
  const participated=entry.rows.filter(r=>ACTIVITIES.some(a=>r[a])).length;
  const rate=total?Math.round((entry.rows.reduce((s,r)=>s+(parseInt(r.score)||0),0)/(total*ACTIVITIES.length))*100):0;
  let msg=`✝ *${entry.department} — Daily Report*\n📅 ${fmt}\n\n`;
  entry.rows.forEach(r=>{
    const done=ACTIVITIES.filter(a=>r[a]);
    msg+=done.length===0?`❌ ${r.name}\n`:`✅ ${r.name}: ${done.join(', ')}\n`;
  });
  msg+=`\n📊 *Summary:* ${participated}/${total} participated · ${rate}% overall rate`;
  copyText(msg,'WhatsApp summary copied!');
}

async function reSync(i){
  const h=getHistory();
  const entry=h[i];
  try{
    const res=await fetch(SHEETS_URL,{method:'POST',body:JSON.stringify({department:entry.department,date:entry.date,rows:entry.rows})});
    const json=await res.json();
    if(json.status==='ok'){
      h[i].synced=true;saveHistory(h);
      const p=getPending().filter(e=>e.key!==entry.key);savePending(p);
      showToast('✅ Synced!');renderHistory();setDot('ok');
    } else throw new Error();
  }catch{ showToast('Still offline — try again later'); }
}

function clearHistory(){
  if(!confirm('Clear all local history? This does not delete data already synced to Google Sheets.')) return;
  saveHistory([]);savePending([]);renderHistory();showToast('Local history cleared');
}

/* ── Copy helpers ────────────────────── */
function getRows(mode){
  if(mode==='manual') return members.map(m=>({name:m,...Object.fromEntries(ACTIVITIES.map(a=>[a,manualData[m]?.[a]||false]))}));
  return parsedRows;
}

function getDept(mode){ return document.getElementById(mode==='manual'?'m-dept':'p-dept').value.trim()||'Department'; }
function getDate(mode){ return document.getElementById(mode==='manual'?'m-date':'p-date').value||today(); }

function copyCSV(mode){
  const rows=getRows(mode),dept=getDept(mode),ddate=getDate(mode);
  if(!rows.length) return;
  let csv=`Department,Date,Member,${ACTIVITIES.join(',')},Score\n`;
  rows.forEach(r=>{const score=ACTIVITIES.filter(a=>r[a]).length;csv+=`${dept},${ddate},${r.name},${ACTIVITIES.map(a=>r[a]?1:0).join(',')},${score}\n`;});
  copyText(csv,'CSV copied');
}

function copyWhatsApp(mode){
  const rows=getRows(mode),dept=getDept(mode),ddate=getDate(mode);
  if(!rows.length) return;
  const fmt=new Date(ddate+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const total=rows.length;
  const participated=rows.filter(r=>ACTIVITIES.some(a=>r[a])).length;
  const checks=rows.reduce((s,r)=>s+ACTIVITIES.filter(a=>r[a]).length,0);
  const rate=total?Math.round((checks/(total*ACTIVITIES.length))*100):0;
  let msg=`✝ *${dept} — Daily Report*\n📅 ${fmt}\n\n`;
  rows.forEach(r=>{const done=ACTIVITIES.filter(a=>r[a]);msg+=done.length===0?`❌ ${r.name}\n`:`✅ ${r.name}: ${done.join(', ')}\n`;});
  msg+=`\n📊 *Summary:* ${participated}/${total} participated · ${rate}% overall rate`;
  copyText(msg,'WhatsApp summary copied!');
}

function copyText(text,toastMsg){
  const go=()=>showToast(toastMsg);
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(go).catch(fallback);}else{fallback();}
  function fallback(){const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0;';document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);go();}
}

/* ── Utilities ───────────────────────── */
function today(){return new Date().toISOString().split('T')[0];}
function esc(s){return String(s).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));}
function escAttr(s){return String(s).replace(/['"]/g,c=>c==='"'?'&quot;':"&#39;");}
function showToast(msg){const t=document.getElementById('toast');t.textContent=msg;t.classList.add('show');setTimeout(()=>t.classList.remove('show'),2800);}
function showError(msg){const e=document.getElementById('errorBox');e.textContent=msg;e.style.display='block';}
function hideError(){document.getElementById('errorBox').style.display='none';}


/* ── Date-change: load history if exists ───── */
function onDateChange(){
  const dept = document.getElementById('m-dept').value.trim();
  const ddate = document.getElementById('m-date').value;
  if(!dept || !ddate) return;
  const key = dept + '|' + ddate;
  const h = getHistory();
  const entry = h.find(e => e.key === key);
  const badge = document.getElementById('historyLoadedBadge');
  const resultSection = document.getElementById('resultSection');

  if(entry){
    // Hydrate manualData from history entry
    manualData = {};
    entry.rows.forEach(r => {
      manualData[r.name] = {};
      ACTIVITIES.forEach(a => { manualData[r.name][a] = !!(r[a]); });
    });
    badge.style.display = 'block';
    // Re-render the grid with loaded values
    renderManualGrid();
    // Also show the result card pre-populated
    const rows = entry.rows.map(r => ({
      name: r.name,
      ...Object.fromEntries(ACTIVITIES.map(a => [a, !!(r[a])]))
    }));
    renderResults(rows, dept, ddate, 'manual');
    setSyncStrip('manual', entry.synced ? 'done' : 'idle');
    resultSection.style.display = 'block';
    showToast('📂 Loaded report for ' + new Date(ddate + 'T12:00:00').toLocaleDateString('en-GB',{day:'numeric',month:'short'}));
  } else {
    // No history for this date — clear everything
    manualData = {};
    members.forEach(m => { manualData[m] = {}; ACTIVITIES.forEach(a => { manualData[m][a] = false; }); });
    badge.style.display = 'none';
    resultSection.style.display = 'none';
    renderManualGrid();
  }
}

/* ── Init ────────────────────────────── */
document.getElementById('m-date').valueAsDate=new Date();
document.getElementById('p-date').valueAsDate=new Date();
load();renderRoster();renderManualGrid();renderActivityList();
renderPendingBanner();
