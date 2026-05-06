/* ══════════════════════════════════════════════════════════════════════════════
   CCG Daily Report Parser — app.js v4.0
   Passphrase auth, department registration, history restore, Sheets sync
══════════════════════════════════════════════════════════════════════════════ */

/* ── API endpoints ───────────────────────────────────────────────────────── */
const API = {
  sync    : '/api/sync',
  members : '/api/members',
  register: '/api/register',
  history : '/api/history',
};

/* ── Activities config ───────────────────────────────────────────────────── */
const ACTIVITIES = ['Midnight Prayer','Mid-day Prayer','Bible Reading','Reflection','Confessions','Word Tape'];
const ACT_ICONS  = ['🌙','☀️','📖','🤔','🙏🏽','🎙'];
const ACT_SHORT  = ['Mid.Pr','Mid-day','Bible','Reflect','Confess','W.Tape'];

/* ── Wordlist for passphrase generation (200 common, memorable words) ─────── */
const WORDLIST = [
  'amber','anchor','angel','apple','arrow','atlas','azure','badge','basin','beach',
  'bells','birch','blade','blaze','blend','bloom','board','brave','bread','brief',
  'brook','brush','cabin','cable','camel','canoe','cargo','cedar','chalk','charm',
  'chase','cheek','chess','chief','child','chord','civil','claim','clamp','clasp',
  'clean','clear','clerk','cliff','cloak','clock','cloud','clove','coach','coast',
  'coral','comet','crane','crest','crisp','cross','crown','crush','crust','curve',
  'cycle','daisy','dance','delta','depot','depth','derby','divan','dogma','draft',
  'drain','drake','drift','drill','drink','drive','drone','dunes','dusk','eagle',
  'earth','elder','ember','empty','epoch','equal','event','fable','faint','faith',
  'falls','fancy','feast','fence','fetch','field','fifth','flame','flare','flash',
  'flask','fleet','flesh','flint','float','flock','flood','floor','flora','flour',
  'flute','focal','foggy','forge','forte','forum','found','frame','frank','frost',
  'froze','fruit','fungi','fused','gable','gains','gamma','gauze','ghost','glade',
  'gland','gleam','glide','globe','gloom','glory','gloss','glove','glyph','grace',
  'grade','grain','grand','grant','graph','grasp','grass','gravel','graze','great',
  'green','greet','grove','grown','guard','guide','guild','guile','guise','gulch',
  'haven','heart','helix','hills','hinge','honor','horse','human','humid','ideal',
  'image','index','inlet','inter','ivory','jewel','joins','joint','judge','karma',
  'kneel','knoll','kudos','lance','lapis','laser','latch','layer','ledge','light',
];

/* ── State ───────────────────────────────────────────────────────────────── */
let members        = [];
let manualData     = {};
let parsedRows     = [];
let deptFetchTimer = null;

/* ── localStorage helpers ────────────────────────────────────────────────── */
function ls(k, v) {
  if (v === undefined) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  localStorage.setItem(k, JSON.stringify(v));
}
function getHistory()   { return ls('ccg_history')  || []; }
function saveHistory(h) { ls('ccg_history', h); }
function getPending()   { return ls('ccg_pending')  || []; }
function savePending(p) { ls('ccg_pending', p); }

/* ── Auth helpers ────────────────────────────────────────────────────────── */

/** Returns the stored hash for the current department, or null */
function getStoredHash() {
  const dept = getCurrentDept();
  if (!dept) return null;
  const auths = ls('ccg_auth') || {};
  return auths[dept.toLowerCase()] || null;
}

/** Stores hash for a department */
function storeAuth(dept, hash) {
  const auths = ls('ccg_auth') || {};
  auths[dept.toLowerCase()] = hash;
  ls('ccg_auth', auths);
}

/** SHA-256 hash a string, returns lowercase hex */
async function sha256(str) {
  const buf  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a 4-word hyphen-separated passphrase */
function generatePassphrase() {
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => WORDLIST[n % WORDLIST.length]).join('-');
}

/* ── App init ────────────────────────────────────────────────────────────── */
function load() {
  const dd = localStorage.getItem('ccg_defaultDept') || '';
  document.getElementById('defaultDept').value = dd;
  if (dd) {
    document.getElementById('m-dept').value = dd;
    document.getElementById('p-dept').value = dd;
  }
}

function saveDefaultDept() {
  const v = document.getElementById('defaultDept').value;
  localStorage.setItem('ccg_defaultDept', v);
  document.getElementById('m-dept').value = v;
  document.getElementById('p-dept').value = v;
}

function getCurrentDept() {
  return document.getElementById('m-dept').value.trim();
}

/* ── Tab switching ───────────────────────────────────────────────────────── */
function switchTab(name) {
  const names = ['manual','paste','history','settings'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pane-' + name).classList.add('active');
  if (name === 'history') renderHistory();
  if (name === 'settings') renderSetupRoster();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Department input: fetch members with debounce ───────────────────────── */
async function onDeptInput() {
  clearTimeout(deptFetchTimer);
  const dept = getCurrentDept();
  if (!dept) return;
  deptFetchTimer = setTimeout(() => initDept(dept), 700);
}

/**
 * Called when dept name is settled. Checks for stored auth:
 * - If auth exists → fetch members from Sheets
 * - If no auth → show registration / restore prompt
 */
async function initDept(dept) {
  const hash = getStoredHash();
  if (hash) {
    await fetchMembersForDept(dept, hash);
    onDateChange();
  } else {
    showAuthPrompt(dept);
  }
}

/* ── Auth prompt: register or restore ───────────────────────────────────── */
function showAuthPrompt(dept) {
  setRosterStatus('warn',
    `"${dept}" is not registered on this device. ` +
    `<button onclick="startRegistration()" class="inline-btn">Register new department</button> ` +
    `&nbsp;or&nbsp; ` +
    `<button onclick="startRestore()" class="inline-btn inline-btn--blue">Restore with passphrase</button>`
  );
  members = [];
  renderManualGrid();
}

/* ── Registration flow ───────────────────────────────────────────────────── */
async function startRegistration() {
  const dept = getCurrentDept();
  if (!dept) return;

  const passphrase = generatePassphrase();
  const hash       = await sha256(passphrase);

  showModal({
    title  : '🔑 Your Department Passphrase',
    body   : `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.6;">
        This passphrase is your key to <strong>${esc(dept)}</strong>. 
        Write it down or save it somewhere safe.<br><br>
        <strong style="color:var(--red);">We cannot recover it if lost.</strong>
      </p>
      <div class="passphrase-display" id="passphraseDisplay">${esc(passphrase)}</div>
      <button class="btn-secondary" style="width:100%;margin-top:10px;" onclick="copyPassphrase('${escAttr(passphrase)}')">
        📋 Copy passphrase
      </button>
      <label class="confirm-check" style="margin-top:16px;display:flex;align-items:center;gap:10px;cursor:pointer;">
        <input type="checkbox" id="savedConfirm" onchange="toggleRegisterBtn()" />
        <span style="font-size:13px;">I have saved my passphrase securely</span>
      </label>`,
    actions: `
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="confirmRegisterBtn" disabled
              onclick="confirmRegistration('${escAttr(dept)}','${escAttr(passphrase)}','${hash}')">
        <div class="spinner"></div>
        <span class="btn-label">Register Department</span>
      </button>`,
  });
}

function toggleRegisterBtn() {
  const checked = document.getElementById('savedConfirm').checked;
  document.getElementById('confirmRegisterBtn').disabled = !checked;
}

function copyPassphrase(phrase) {
  copyText(phrase, '✅ Passphrase copied!');
}

async function confirmRegistration(dept, passphrase, hash) {
  const btn = document.getElementById('confirmRegisterBtn');
  btn.classList.add('loading'); btn.disabled = true;

  try {
    const res  = await fetch(API.register, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: dept, hash }),
    });
    const json = await res.json();

    if (json.status === 'ok') {
      storeAuth(dept, hash);
      closeModal();
      setRosterStatus('ok', `✅ "${dept}" registered successfully. Members will appear as you sync reports.`);
      showToast('Department registered!');
      members = [];
      renderManualGrid();
    } else {
      btn.classList.remove('loading'); btn.disabled = false;
      showModalError(json.message || 'Registration failed');
    }
  } catch (err) {
    btn.classList.remove('loading'); btn.disabled = false;
    showModalError('Could not connect. Check your internet connection.');
  }
}

/* ── Restore flow ────────────────────────────────────────────────────────── */
function startRestore() {
  const dept = getCurrentDept();
  showModal({
    title  : '🔓 Restore Department Access',
    body   : `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">
        Enter your saved passphrase for <strong>${esc(dept)}</strong> to restore access and history on this device.
      </p>
      <div class="field">
        <label>Passphrase</label>
        <input id="restoreInput" type="text" placeholder="word-word-word-word"
               style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);padding:0 12px;font-size:15px;font-family:var(--font-mono, monospace);letter-spacing:0.03em;"
               onkeydown="if(event.key==='Enter') confirmRestore('${escAttr(dept)}')" />
      </div>
      <div id="restoreError" style="display:none;margin-top:8px;font-size:12px;color:var(--red);"></div>`,
    actions: `
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="confirmRestoreBtn" onclick="confirmRestore('${escAttr(dept)}')">
        <div class="spinner"></div>
        <span class="btn-label">Restore Access</span>
      </button>`,
  });
  setTimeout(() => document.getElementById('restoreInput')?.focus(), 100);
}

async function confirmRestore(dept) {
  const passphrase = (document.getElementById('restoreInput')?.value || '').trim();
  if (!passphrase) { showModalError('Please enter your passphrase.'); return; }

  const btn = document.getElementById('confirmRestoreBtn');
  btn.classList.add('loading'); btn.disabled = true;

  const hash = await sha256(passphrase);

  // Validate by attempting a members fetch — if hash is wrong, server rejects it
  try {
    const res  = await fetch(`${API.members}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();

    if (json.status === 'ok') {
      storeAuth(dept, hash);
      members = json.members || [];
      closeModal();
      showToast('✅ Access restored!');
      setRosterStatus('ok', `${members.length} members loaded from Google Sheets`);
      renderManualGrid();
      onDateChange();
      // Prompt to restore history
      setTimeout(() => {
        if (confirm('Restore full history from Google Sheets for this department?')) {
          restoreHistoryFromSheets();
        }
      }, 400);
    } else {
      btn.classList.remove('loading'); btn.disabled = false;
      showModalError('Incorrect passphrase. Please check and try again.');
    }
  } catch (err) {
    btn.classList.remove('loading'); btn.disabled = false;
    showModalError('Could not connect. Check your internet connection.');
  }
}

/* ── Fetch members from Sheets ───────────────────────────────────────────── */
async function fetchMembersForDept(dept, hash) {
  setRosterStatus('loading', `Loading members for "${dept}"…`);
  try {
    const res  = await fetch(`${API.members}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();

    if (json.status === 'ok') {
      members = json.members || [];
      if (members.length === 0) {
        setRosterStatus('warn', `No members found for "${dept}" yet. They'll appear automatically after your first sync.`);
      } else {
        setRosterStatus('ok', `${members.length} members loaded from Google Sheets`);
      }
      manualData = {};
    } else if (json.message === 'Unauthorized') {
      // Hash mismatch — stored hash is stale, clear it and prompt again
      const auths = ls('ccg_auth') || {};
      delete auths[dept.toLowerCase()];
      ls('ccg_auth', auths);
      showAuthPrompt(dept);
    } else {
      throw new Error(json.message);
    }
  } catch (err) {
    setRosterStatus('error', `Could not load members (${err.message}). Working offline — add members in Setup as fallback.`);
  }
  renderManualGrid();
}

function setRosterStatus(type, html) {
  const el = document.getElementById('rosterStatus');
  if (!el) return;
  const bg = { loading:'var(--amber-bg)', ok:'var(--green-bg)', warn:'var(--amber-bg)', error:'var(--red-bg)' };
  const co = { loading:'var(--amber)', ok:'var(--green)', warn:'var(--amber)', error:'var(--red)' };
  const bo = { loading:'rgba(146,64,14,0.2)', ok:'rgba(22,101,52,0.2)', warn:'rgba(146,64,14,0.2)', error:'rgba(153,27,27,0.2)' };
  el.style.cssText = `display:block;margin-top:10px;padding:8px 12px;border:1px solid ${bo[type]};border-radius:var(--radius-sm);font-size:12px;line-height:1.6;background:${bg[type]};color:${co[type]};`;
  el.innerHTML = html;
}

/* ── History restore from Sheets ─────────────────────────────────────────── */
async function restoreHistoryFromSheets() {
  const dept = getCurrentDept();
  const hash = getStoredHash();
  if (!dept || !hash) { showToast('No department selected'); return; }

  const btn = document.getElementById('restoreHistoryBtn');
  if (btn) { btn.textContent = 'Restoring…'; btn.disabled = true; }

  try {
    const res  = await fetch(`${API.history}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();

    if (json.status === 'ok') {
      const entries = json.entries || [];
      if (entries.length === 0) {
        showToast('No history found in Google Sheets for this department');
        return;
      }
      // Merge into local history — remote data fills gaps, local data wins on conflict
      const local = getHistory();
      let added = 0;
      entries.forEach(entry => {
        const key = entry.department + '|' + entry.date;
        // Add score/rate to each row if missing
        entry.rows = entry.rows.map(r => ({
          ...r,
          score: r.score ?? ACTIVITIES.filter(a => r[a]).length,
          rate : r.rate  ?? Math.round((ACTIVITIES.filter(a => r[a]).length / ACTIVITIES.length) * 100) + '%',
        }));
        if (!local.find(e => e.key === key)) {
          local.unshift({ key, ...entry, synced: true, savedAt: new Date().toISOString() });
          added++;
        }
      });
      // Sort by date descending
      local.sort((a, b) => b.date.localeCompare(a.date));
      if (local.length > 90) local.splice(90);
      saveHistory(local);
      showToast(`✅ ${added} report${added !== 1 ? 's' : ''} restored from Google Sheets`);
      renderHistory();
    } else {
      showToast('Could not restore history: ' + (json.message || 'Unknown error'));
    }
  } catch (err) {
    showToast('Restore failed — check your connection');
  }

  if (btn) { btn.textContent = '☁️ Restore history from Google Sheets'; btn.disabled = false; }
}

/* ── Modal helpers ───────────────────────────────────────────────────────── */
function showModal({ title, body, actions }) {
  document.getElementById('modalTitle').innerHTML   = title;
  document.getElementById('modalBody').innerHTML    = body;
  document.getElementById('modalActions').innerHTML = actions;
  document.getElementById('modalOverlay').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
  document.body.style.overflow = '';
}

function showModalError(msg) {
  let el = document.getElementById('modalErrorMsg');
  if (!el) {
    el = document.createElement('p');
    el.id = 'modalErrorMsg';
    el.style.cssText = 'font-size:12px;color:var(--red);margin-top:10px;text-align:center;';
    document.getElementById('modalActions').prepend(el);
  }
  el.textContent = msg;
}

/* ── Setup tab roster ────────────────────────────────────────────────────── */
function renderSetupRoster() {
  const list = document.getElementById('rosterList');
  if (!members.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-light);padding:6px 0;">No members loaded yet. Type a department name in the Manual tab.</p>';
    return;
  }
  list.innerHTML = members.map((m, i) => `
    <div class="roster-item">
      <span>${esc(m)}</span>
      <button onclick="removeMemberLocal(${i})" title="Remove from local session">✕</button>
    </div>`).join('');
}

function renderActivityList() {
  document.getElementById('activityList').innerHTML = ACTIVITIES.map((a, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(15,31,61,0.06);">
      <span style="font-size:15px;">${ACT_ICONS[i]}</span>
      <span style="font-size:13px;">${a}</span>
    </div>`).join('');
}

function addMemberLocal() {
  const inp  = document.getElementById('newMemberInput');
  const name = inp.value.trim();
  if (!name) return;
  if (members.map(m => m.toLowerCase()).includes(name.toLowerCase())) { showToast('Already in roster'); return; }
  members.push(name);
  inp.value = '';
  renderSetupRoster();
  renderManualGrid();
}

function removeMemberLocal(i) {
  members.splice(i, 1);
  renderSetupRoster();
  renderManualGrid();
}

/* ── Manual entry grid ───────────────────────────────────────────────────── */
function renderManualGrid() {
  const grid = document.getElementById('entryGrid');
  const hint = document.getElementById('noMembersHint');
  const hdr  = document.getElementById('actHeader');
  const btn  = document.getElementById('generateBtn');

  if (!members.length) {
    hint.style.display = 'block'; hdr.style.display = 'none';
    grid.innerHTML = ''; btn.style.display = 'none'; return;
  }
  hint.style.display = 'none'; hdr.style.display = 'flex'; btn.style.display = 'flex';

  document.getElementById('actHeaderCols').innerHTML = ACT_ICONS.map((ic, i) =>
    `<div class="act-col-lbl">${ic}<br>${ACT_SHORT[i]}</div>`).join('');

  members.forEach(m => {
    if (!manualData[m]) manualData[m] = {};
    ACTIVITIES.forEach(a => { if (manualData[m][a] === undefined) manualData[m][a] = false; });
  });

  grid.innerHTML = members.map(m => `
    <div class="member-row">
      <div class="member-name">${esc(m)}</div>
      <div class="checks">
        ${ACTIVITIES.map(a => `
          <div class="chk-wrap">
            <div class="chk-box ${manualData[m][a] ? 'checked' : ''}"
                 onclick="toggleCheck('${escAttr(m)}','${escAttr(a)}')"
                 data-member="${escAttr(m)}" data-act="${escAttr(a)}">
              ${manualData[m][a] ? '✅' : ''}
            </div>
          </div>`).join('')}
      </div>
      <button class="absent-btn" onclick="markAbsent('${escAttr(m)}')">✕ none</button>
    </div>`).join('');
}

function toggleCheck(member, activity) {
  if (!manualData[member]) manualData[member] = {};
  manualData[member][activity] = !manualData[member][activity];
  document.querySelectorAll(`.chk-box[data-member="${escAttr(member)}"][data-act="${escAttr(activity)}"]`).forEach(el => {
    const c = manualData[member][activity];
    el.className = 'chk-box' + (c ? ' checked' : '');
    el.textContent = c ? '✅' : '';
  });
}

function markAbsent(member) {
  ACTIVITIES.forEach(a => { manualData[member][a] = false; });
  document.querySelectorAll(`.chk-box[data-member="${escAttr(member)}"]`).forEach(el => {
    el.className = 'chk-box'; el.textContent = '';
  });
}

function generateFromManual() {
  const dept  = getCurrentDept() || 'Department';
  const ddate = document.getElementById('m-date').value || today();
  const rows  = members.map(m => ({ name: m, ...Object.fromEntries(ACTIVITIES.map(a => [a, manualData[m]?.[a] || false])) }));
  renderResults(rows, dept, ddate, 'manual');
  setSyncStrip('manual', 'idle');
  document.getElementById('resultSection').style.display = 'block';
  setTimeout(() => document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
}

function resetManual() {
  manualData = {};
  renderManualGrid();
  document.getElementById('resultSection').style.display = 'none';
  document.getElementById('historyLoadedBadge').style.display = 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Date change: load history if exists ─────────────────────────────────── */
function onDateChange() {
  const dept  = getCurrentDept();
  const ddate = document.getElementById('m-date').value;
  if (!dept || !ddate) return;

  const key   = dept + '|' + ddate;
  const entry = getHistory().find(e => e.key === key);
  const badge = document.getElementById('historyLoadedBadge');

  if (entry) {
    manualData = {};
    entry.rows.forEach(r => {
      manualData[r.name] = {};
      ACTIVITIES.forEach(a => { manualData[r.name][a] = !!(r[a]); });
    });
    if (!members.length) members = entry.rows.map(r => r.name);
    badge.style.display = 'block';
    renderManualGrid();
    const rows = entry.rows.map(r => ({ name: r.name, ...Object.fromEntries(ACTIVITIES.map(a => [a, !!(r[a])])) }));
    renderResults(rows, dept, ddate, 'manual');
    setSyncStrip('manual', entry.synced ? 'done' : 'idle');
    document.getElementById('resultSection').style.display = 'block';
    showToast('📂 Loaded ' + new Date(ddate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  } else {
    manualData = {};
    members.forEach(m => { manualData[m] = {}; ACTIVITIES.forEach(a => { manualData[m][a] = false; }); });
    badge.style.display = 'none';
    document.getElementById('resultSection').style.display = 'none';
    renderManualGrid();
  }
}

/* ── AI Paste ────────────────────────────────────────────────────────────── */
async function runParse() {
  const raw = document.getElementById('raw').value.trim();
  if (!raw) { showError('Please paste the WhatsApp report text first.'); return; }

  const btn = document.getElementById('parseBtn');
  btn.classList.add('loading'); btn.disabled = true; hideError();

  const dept  = document.getElementById('p-dept').value.trim() || 'Department';
  const ddate = document.getElementById('p-date').value || today();

  const prompt = `You are a church participation report parser. Extract each member's participation.
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

  try {
    const res  = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`API ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    parsedRows = JSON.parse(text.replace(/```json|```/g, '').trim());
    renderResults(parsedRows, dept, ddate, 'paste');
    setSyncStrip('paste', 'idle');
    document.getElementById('resultSectionPaste').style.display = 'block';
    setTimeout(() => document.getElementById('resultSectionPaste').scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  } catch (e) { showError('Could not parse. (' + e.message + ')'); }

  btn.classList.remove('loading'); btn.disabled = false;
}

function resetPaste() {
  document.getElementById('raw').value = '';
  document.getElementById('resultSectionPaste').style.display = 'none';
  parsedRows = []; hideError();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Shared result renderer ──────────────────────────────────────────────── */
function renderResults(rows, dept, ddate, mode) {
  const pfx          = mode === 'manual' ? 'm-' : 'p-';
  const total        = rows.length;
  const participated = rows.filter(r => ACTIVITIES.some(a => r[a])).length;
  const checks       = rows.reduce((s, r) => s + ACTIVITIES.filter(a => r[a]).length, 0);
  const rate         = total ? Math.round((checks / (total * ACTIVITIES.length)) * 100) : 0;

  document.getElementById(pfx + 'statMembers').textContent = total;
  document.getElementById(pfx + 'statPresent').textContent = participated;
  document.getElementById(pfx + 'statRate').textContent    = rate + '%';

  const fmt = new Date(ddate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById(pfx + 'resultTitle').textContent = dept;
  document.getElementById(pfx + 'resultSub').textContent   = fmt + ' · ' + total + ' members';

  let html = '<thead><tr><th>Member</th>';
  ACT_ICONS.forEach((ic, i) => html += `<th>${ic} ${ACT_SHORT[i]}</th>`);
  html += '<th>Score</th></tr></thead><tbody>';
  rows.forEach(r => {
    const score = ACTIVITIES.filter(a => r[a]).length;
    const cls   = score >= 4 ? 'score-high' : score >= 2 ? 'score-mid' : 'score-low';
    html += `<tr><td class="name-cell">${esc(r.name)}</td>`;
    ACTIVITIES.forEach(a => { html += r[a] ? '<td><span class="check">✅</span></td>' : '<td><span class="cross-icon">✕</span></td>'; });
    html += `<td><span class="score-pill ${cls}">${score}/6</span></td></tr>`;
  });
  html += '</tbody>';
  document.getElementById(pfx + 'resultTable').innerHTML = html;
}

/* ── Sync to Google Sheets ───────────────────────────────────────────────── */
async function syncToSheets(mode) {
  const rows  = getRows(mode);
  const dept  = getDept(mode);
  const ddate = getDate(mode);
  const hash  = getStoredHash();

  if (!rows.length) { showToast('No data to sync'); return; }
  if (!hash) { showToast('Register this department first'); return; }

  const btn = document.getElementById(mode === 'manual' ? 'm-syncBtn' : 'p-syncBtn');
  btn.classList.add('loading'); btn.disabled = true;
  setSyncStrip(mode, 'syncing'); setDot('pending');

  const payload = {
    department: dept, date: ddate, hash,
    rows: rows.map(r => ({
      name: r.name,
      ...Object.fromEntries(ACTIVITIES.map(a => [a, r[a] || false])),
      score: ACTIVITIES.filter(a => r[a]).length,
      rate : Math.round((ACTIVITIES.filter(a => r[a]).length / ACTIVITIES.length) * 100) + '%',
    })),
  };

  try {
    const res  = await fetch(API.sync, { method: 'POST', body: JSON.stringify(payload) });
    const json = await res.json();
    if (json.status === 'ok') {
      setSyncStrip(mode, 'done'); setDot('ok');
      saveToHistory(payload, true);
      showToast('✅ Saved to Google Sheets!');
    } else throw new Error(json.message || 'Unknown error');
  } catch {
    setSyncStrip(mode, 'fail'); setDot('error');
    saveToHistory(payload, false);
    addToPending(payload);
    showToast('Saved locally — will retry when online');
  }
  btn.classList.remove('loading'); btn.disabled = false;
}

function setSyncStrip(mode, state) {
  const el   = document.getElementById(mode === 'manual' ? 'm-syncStrip' : 'p-syncStrip');
  el.className = 'sync-strip ' + state;
  const msgs = { idle:'☁️ Ready to sync to Google Sheets', syncing:'⏳ Syncing…', done:'✅ Saved successfully', fail:'⚠️ Offline — saved locally' };
  el.textContent = msgs[state] || '';
}

function setDot(state) {
  const d = document.getElementById('syncDot');
  d.className = 'sync-dot' + (state === 'ok' ? ' ok' : state === 'pending' ? ' pending' : state === 'error' ? ' error' : '');
}

/* ── Local history ───────────────────────────────────────────────────────── */
function saveToHistory(payload, synced) {
  const h   = getHistory();
  const key = payload.department + '|' + payload.date;
  const idx = h.findIndex(e => e.key === key);
  const entry = { key, department: payload.department, date: payload.date, rows: payload.rows, synced, savedAt: new Date().toISOString() };
  if (idx >= 0) h[idx] = entry; else h.unshift(entry);
  if (h.length > 90) h.splice(90);
  saveHistory(h);
}

function addToPending(payload) {
  const p   = getPending();
  const key = payload.department + '|' + payload.date;
  if (!p.find(e => e.key === key)) p.push({ ...payload, key });
  savePending(p); renderPendingBanner();
}

async function retryAllPending() {
  const p = getPending();
  if (!p.length) return;
  let succeeded = 0;
  for (const payload of p) {
    try {
      const res  = await fetch(API.sync, { method: 'POST', body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.status === 'ok') {
        succeeded++;
        saveToHistory(payload, true);
        const h = getHistory(); const idx = h.findIndex(e => e.key === payload.key);
        if (idx >= 0) { h[idx].synced = true; saveHistory(h); }
      }
    } catch { /* still offline */ }
  }
  if (succeeded > 0) { savePending(getPending().slice(succeeded)); showToast(`${succeeded} report(s) synced!`); if (succeeded === p.length) setDot('ok'); }
  else showToast('Still offline — try again later');
  renderHistory(); renderPendingBanner();
}

function renderPendingBanner() {
  const p      = getPending();
  const banner = document.getElementById('pendingBanner');
  const msg    = document.getElementById('pendingMsg');
  if (p.length) { banner.style.display = 'flex'; msg.textContent = `${p.length} report${p.length > 1 ? 's' : ''} not yet synced.`; setDot('pending'); }
  else banner.style.display = 'none';
}

function renderHistory() {
  renderPendingBanner();
  const h    = getHistory();
  const list = document.getElementById('historyList');
  if (!h.length) {
    list.innerHTML = '<div class="history-empty">No reports saved yet.<br>Generate and sync your first report to see history here.</div>';
    return;
  }
  list.innerHTML = h.map((entry, i) => {
    const fmt          = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    const participated = entry.rows.filter(r => ACTIVITIES.some(a => r[a])).length;
    const rate         = entry.rows.length ? Math.round((entry.rows.reduce((s, r) => s + (parseInt(r.score) || 0), 0) / (entry.rows.length * ACTIVITIES.length)) * 100) : 0;
    return `
    <div class="history-day">
      <div class="history-day-header" onclick="toggleHistory(${i})">
        <div>
          <h3>${esc(entry.department)}</h3>
          <p>${fmt} · ${participated}/${entry.rows.length} participated · ${rate}% rate</p>
        </div>
        <div class="h-badges">
          <span class="h-badge ${entry.synced ? 'synced' : 'local'}">${entry.synced ? 'Synced' : 'Local only'}</span>
          <span style="font-size:14px;color:var(--text-light);">›</span>
        </div>
      </div>
      <div class="history-day-body" id="hbody-${i}">
        <table class="h-mini-table">
          ${entry.rows.map(r => { const done = ACTIVITIES.filter(a => r[a]); return `<tr>
            <td>${esc(r.name)}</td>
            <td>${done.length ? done.map(a => ACT_ICONS[ACTIVITIES.indexOf(a)]).join(' ') : '❌ Absent'}</td>
            <td style="color:var(--text-muted);text-align:right;">${r.score}/6</td></tr>`; }).join('')}
        </table>
        <div class="h-action-row">
          <button class="btn-secondary" onclick="reShareWhatsApp(${i})">Copy for WhatsApp</button>
          ${!entry.synced ? `<button class="btn-secondary" style="color:var(--green);border-color:rgba(22,101,52,0.3);" onclick="reSync(${i})">Sync to Sheets</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistory(i) { document.getElementById('hbody-' + i).classList.toggle('open'); }

function reShareWhatsApp(i) {
  const entry = getHistory()[i];
  const fmt   = new Date(entry.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const total = entry.rows.length;
  const participated = entry.rows.filter(r => ACTIVITIES.some(a => r[a])).length;
  const rate  = total ? Math.round((entry.rows.reduce((s, r) => s + (parseInt(r.score) || 0), 0) / (total * ACTIVITIES.length)) * 100) : 0;
  let msg = `✝ *${entry.department} — Daily Report*\n📅 ${fmt}\n\n`;
  entry.rows.forEach(r => { const done = ACTIVITIES.filter(a => r[a]); msg += done.length === 0 ? `❌ ${r.name}\n` : `✅ ${r.name}: ${done.join(', ')}\n`; });
  msg += `\n📊 *Summary:* ${participated}/${total} participated · ${rate}% overall rate`;
  copyText(msg, 'WhatsApp summary copied!');
}

async function reSync(i) {
  const h = getHistory(); const entry = h[i];
  try {
    const res  = await fetch(API.sync, { method: 'POST', body: JSON.stringify({ department: entry.department, date: entry.date, hash: getStoredHash(), rows: entry.rows }) });
    const json = await res.json();
    if (json.status === 'ok') { h[i].synced = true; saveHistory(h); savePending(getPending().filter(e => e.key !== entry.key)); showToast('✅ Synced!'); renderHistory(); setDot('ok'); }
    else throw new Error();
  } catch { showToast('Still offline — try again later'); }
}

function clearHistory() {
  if (!confirm('Clear all local history? This does not delete data already synced to Google Sheets.')) return;
  saveHistory([]); savePending([]); renderHistory(); showToast('Local history cleared');
}

/* ── Copy helpers ────────────────────────────────────────────────────────── */
function getRows(mode) {
  if (mode === 'manual') return members.map(m => ({ name: m, ...Object.fromEntries(ACTIVITIES.map(a => [a, manualData[m]?.[a] || false])) }));
  return parsedRows;
}
function getDept(mode) { return document.getElementById(mode === 'manual' ? 'm-dept' : 'p-dept').value.trim() || 'Department'; }
function getDate(mode) { return document.getElementById(mode === 'manual' ? 'm-date' : 'p-date').value || today(); }

function copyCSV(mode) {
  const rows = getRows(mode), dept = getDept(mode), ddate = getDate(mode);
  if (!rows.length) return;
  let csv = `Department,Date,Member,${ACTIVITIES.join(',')},Score\n`;
  rows.forEach(r => { const score = ACTIVITIES.filter(a => r[a]).length; csv += `${dept},${ddate},${r.name},${ACTIVITIES.map(a => r[a] ? 1 : 0).join(',')},${score}\n`; });
  copyText(csv, 'CSV copied');
}

function copyWhatsApp(mode) {
  const rows  = getRows(mode), dept = getDept(mode), ddate = getDate(mode);
  if (!rows.length) return;
  const fmt          = new Date(ddate + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const total        = rows.length;
  const participated = rows.filter(r => ACTIVITIES.some(a => r[a])).length;
  const checks       = rows.reduce((s, r) => s + ACTIVITIES.filter(a => r[a]).length, 0);
  const rate         = total ? Math.round((checks / (total * ACTIVITIES.length)) * 100) : 0;
  let msg = `✝ *${dept} — Daily Report*\n📅 ${fmt}\n\n`;
  rows.forEach(r => { const done = ACTIVITIES.filter(a => r[a]); msg += done.length === 0 ? `❌ ${r.name}\n` : `✅ ${r.name}: ${done.join(', ')}\n`; });
  msg += `\n📊 *Summary:* ${participated}/${total} participated · ${rate}% overall rate`;
  copyText(msg, 'WhatsApp summary copied!');
}

function copyText(text, toastMsg) {
  const go = () => showToast(toastMsg);
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(go).catch(fallback); } else { fallback(); }
  function fallback() { const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); go(); }
}

/* ── Utilities ───────────────────────────────────────────────────────────── */
function today()    { return new Date().toISOString().split('T')[0]; }
function esc(s)     { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }
function escAttr(s) { return String(s).replace(/['"]/g, c => c === '"' ? '&quot;' : '&#39;'); }
function showToast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); setTimeout(() => t.classList.remove('show'), 2800); }
function showError(msg) { const e = document.getElementById('errorBox'); e.textContent = msg; e.style.display = 'block'; }
function hideError()    { document.getElementById('errorBox').style.display = 'none'; }

/* ── Init ────────────────────────────────────────────────────────────────── */
document.getElementById('m-date').valueAsDate = new Date();
document.getElementById('p-date').valueAsDate = new Date();
load();
renderSetupRoster();
renderManualGrid();
renderActivityList();
renderPendingBanner();

// Auto-init if default dept already stored
const _initDept = getCurrentDept();
if (_initDept) initDept(_initDept);
