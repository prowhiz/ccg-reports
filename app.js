/* ══════════════════════════════════════════════════════════════════════════════
   CCG Daily Report Parser — app.js v4.5
   Manual entry only · Passphrase auth · History restore · Sheets sync
══════════════════════════════════════════════════════════════════════════════ */

/* ── API endpoints ───────────────────────────────────────────────────────── */
const API = {
  sync    : '/api/sync',
  members : '/api/members',
  register: '/api/register',
  history  : '/api/history',
  addMember: '/api/addMember',
};

/* ── Activities config ───────────────────────────────────────────────────── */
const ACTIVITIES = ['Midnight Prayer','Mid-day Prayer','Bible Reading','Reflection','Confessions','Word Tape'];
const ACT_ICONS  = ['🌙','☀️','📖','🤔','🙏🏽','🎙'];
const ACT_SHORT  = ['Mid.Pr','Mid-day','Bible','Reflect','Confess','W.Tape'];

/* ── Wordlist for passphrase generation ──────────────────────────────────── */
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
let members        = [];  // canonical list from Sheets for current dept
let manualData     = {};  // { memberName: { activityName: bool } }
let deptFetchTimer = null;

/* ── localStorage helpers ────────────────────────────────────────────────── */
function ls(k, v) {
  if (v === undefined) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
  localStorage.setItem(k, JSON.stringify(v));
}
function getHistory()   { return ls('ccg_history') || []; }
function saveHistory(h) { ls('ccg_history', h); }
function getPending()   { return ls('ccg_pending') || []; }
function savePending(p) { ls('ccg_pending', p); }

/* ── Auth helpers ────────────────────────────────────────────────────────── */
function getStoredHash() {
  const dept = getCurrentDept();
  if (!dept) return null;
  return (ls('ccg_auth') || {})[dept.toLowerCase()] || null;
}

function storeAuth(dept, hash) {
  const auths = ls('ccg_auth') || {};
  auths[dept.toLowerCase()] = hash;
  ls('ccg_auth', auths);
}

async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generatePassphrase() {
  const arr = new Uint32Array(4);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(n => WORDLIST[n % WORDLIST.length]).join('-');
}

/* ── App init ────────────────────────────────────────────────────────────── */
function load() {
  const dd = localStorage.getItem('ccg_defaultDept') || '';
  document.getElementById('defaultDept').value = dd;
  if (dd) document.getElementById('m-dept').value = dd;
}

function saveDefaultDept() {
  const v = document.getElementById('defaultDept').value;
  localStorage.setItem('ccg_defaultDept', v);
  document.getElementById('m-dept').value = v;
}

function getCurrentDept() {
  return document.getElementById('m-dept').value.trim();
}

/* ── Tab switching ───────────────────────────────────────────────────────── */
function switchTab(name) {
  const names = ['manual','history','settings'];
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', names[i] === name));
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById('pane-' + name).classList.add('active');
  if (name === 'history')  renderHistory();
  if (name === 'settings') renderSetupRoster();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ── Department input ────────────────────────────────────────────────────── */
async function onDeptInput() {
  clearTimeout(deptFetchTimer);
  const dept = getCurrentDept();
  if (!dept) return;
  deptFetchTimer = setTimeout(() => initDept(dept), 700);
}

async function initDept(dept) {
  const hash = getStoredHash();
  if (hash) {
    await fetchMembersForDept(dept, hash);
    onDateChange();
  } else {
    showAuthPrompt(dept);
  }
}

/* ── Auth prompt ─────────────────────────────────────────────────────────── */
function showAuthPrompt(dept) {
  setRosterStatus('warn',
    `"${esc(dept)}" is not registered on this device. ` +
    `<button onclick="startRegistration()" class="inline-btn">Register new department</button> ` +
    `&nbsp;or&nbsp; ` +
    `<button onclick="startRestore()" class="inline-btn inline-btn--blue">Restore with passphrase</button>`
  );
  members = [];
  renderManualGrid();
}

/* ── Registration flow ───────────────────────────────────────────────────── */
async function startRegistration() {
  const dept       = getCurrentDept();
  if (!dept) return;
  const passphrase = generatePassphrase();
  const hash       = await sha256(passphrase);

  showModal({
    title  : '🔑 Your Department Passphrase',
    body   : `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.6;">
        This passphrase is the key to <strong>${esc(dept)}</strong>.<br>
        Write it down or save it in a secure place.<br><br>
        <strong style="color:var(--red);">We cannot recover it if lost.</strong>
      </p>
      <div class="passphrase-display">${esc(passphrase)}</div>
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
  document.getElementById('confirmRegisterBtn').disabled = !document.getElementById('savedConfirm').checked;
}

function copyPassphrase(phrase) { copyText(phrase, '✅ Passphrase copied!'); }

async function confirmRegistration(dept, passphrase, hash) {
  const btn = document.getElementById('confirmRegisterBtn');
  btn.classList.add('loading'); btn.disabled = true;
  try {
    const res  = await fetch(API.register, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ department: dept, hash }),
    });
    const json = await res.json();
    if (json.status === 'ok') {
      storeAuth(dept, hash);
      closeModal();
      hideOnboarding();
      setRosterStatus('ok', `✅ "${esc(dept)}" registered. Members will appear after your first sync.`);
      showToast('Department registered!');
      members = [];
      renderManualGrid();
    } else {
      btn.classList.remove('loading'); btn.disabled = false;
      showModalError(json.message || 'Registration failed');
    }
  } catch {
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
        Enter your saved passphrase for <strong>${esc(dept)}</strong> to restore access on this device.
      </p>
      <div class="field">
        <label>Passphrase</label>
        <input id="restoreInput" type="text" placeholder="word-word-word-word"
               style="width:100%;height:44px;border:1px solid var(--border);border-radius:var(--radius-sm);
                      padding:0 12px;font-size:15px;font-family:monospace;letter-spacing:0.03em;"
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
  try {
    const res  = await fetch(`${API.members}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();
    if (json.status === 'ok') {
      storeAuth(dept, hash);
      members = json.members || [];
      closeModal();
      hideOnboarding();
      showToast('✅ Access restored!');
      setRosterStatus('ok', `${members.length} members loaded from Google Sheets`);
      renderManualGrid();
      onDateChange();
      setTimeout(() => {
        if (confirm('Restore full history from Google Sheets for this department?')) restoreHistoryFromSheets();
      }, 400);
    } else {
      btn.classList.remove('loading'); btn.disabled = false;
      showModalError('Incorrect passphrase. Please check and try again.');
    }
  } catch {
    btn.classList.remove('loading'); btn.disabled = false;
    showModalError('Could not connect. Check your internet connection.');
  }
}

/* ── Fetch members from Sheets ───────────────────────────────────────────── */
async function fetchMembersForDept(dept, hash) {
  setRosterStatus('loading', `Loading members for "${esc(dept)}"…`);
  try {
    const res  = await fetch(`${API.members}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();
    if (json.status === 'ok') {
      members = json.members || [];
      setRosterStatus(
        members.length ? 'ok' : 'warn',
        members.length
          ? `${members.length} members loaded from Google Sheets`
          : `No members found for "${esc(dept)}" yet — they'll appear after your first sync.`
      );
      manualData = {};
    } else if (json.message === 'Unauthorized') {
      const auths = ls('ccg_auth') || {};
      delete auths[dept.toLowerCase()];
      ls('ccg_auth', auths);
      showAuthPrompt(dept);
    } else {
      throw new Error(json.message);
    }
  } catch (err) {
    setRosterStatus('error', `Could not load members (${err.message}). Working offline — add members in Setup as a fallback.`);
  }
  renderManualGrid();
}

function setRosterStatus(type, html) {
  const el = document.getElementById('rosterStatus');
  if (!el) return;
  el.className = 'roster-status roster-status--' + type;
  el.style.display = 'block';
  el.innerHTML = html;
}

/* ── History restore from Sheets ─────────────────────────────────────────── */
async function restoreHistoryFromSheets() {
  const dept = getCurrentDept();
  const hash = getStoredHash();
  if (!dept || !hash) { showToast('No registered department selected'); return; }

  const btn = document.getElementById('restoreHistoryBtn');
  if (btn) { btn.classList.add('loading'); btn.disabled = true; }

  try {
    const res  = await fetch(`${API.history}?department=${encodeURIComponent(dept)}&hash=${encodeURIComponent(hash)}`);
    const json = await res.json();
    if (json.status === 'ok') {
      const entries = json.entries || [];
      if (!entries.length) { showToast('No history found in Google Sheets for this department'); return; }

      const local = getHistory();
      let added = 0;
      entries.forEach(entry => {
        const key = entry.department + '|' + entry.date;
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
      local.sort((a, b) => b.date.localeCompare(a.date));
      if (local.length > 90) local.splice(90);
      saveHistory(local);
      showToast(`✅ ${added} report${added !== 1 ? 's' : ''} restored from Google Sheets`);
      renderHistory();
    } else {
      showToast('Could not restore: ' + (json.message || 'Unknown error'));
    }
  } catch {
    showToast('Restore failed — check your connection');
  }

  if (btn) { btn.classList.remove('loading'); btn.disabled = false; }
}

/* ── Add Members: batch add new members to department ────────────────────── */
function showAddMembersModal() {
  const dept = getCurrentDept();
  if (!dept) return;

  showModal({
    title  : '➕ Add New Members',
    body   : `
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;line-height:1.6;">
        Enter one name per line. Names will be added permanently to
        <strong>${esc(dept)}</strong> in Google Sheets.
      </p>
      <div class="field">
        <label>New member names</label>
        <textarea id="newMembersInput"
          style="width:100%;min-height:120px;border:1px solid var(--border);border-radius:var(--radius-sm);
                 padding:10px 12px;font-size:14px;font-family:'DM Sans',sans-serif;resize:vertical;
                 background:var(--cream);color:var(--text);line-height:1.8;"
          placeholder="Bro Samuel&#10;Sis Grace&#10;Bro Emmanuel"></textarea>
      </div>
      <div id="addMembersError" style="display:none;margin-top:8px;font-size:12px;color:var(--red);"></div>`,
    actions: `
      <button class="btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn-primary" id="confirmAddMembersBtn" onclick="submitNewMembers('${escAttr(dept)}')">
        <div class="spinner"></div>
        <span class="btn-label">Add Members</span>
      </button>`,
  });
  setTimeout(() => document.getElementById('newMembersInput')?.focus(), 100);
}

async function submitNewMembers(dept) {
  // Offline check
  if (!navigator.onLine) {
    document.getElementById('addMembersError').style.display = 'block';
    document.getElementById('addMembersError').textContent =
      'No internet connection. Member management requires a connection — please try again when online.';
    return;
  }

  const raw = (document.getElementById('newMembersInput')?.value || '');
  const names = raw.split('\n').map(n => n.trim()).filter(n => n.length > 0);

  if (!names.length) {
    document.getElementById('addMembersError').style.display = 'block';
    document.getElementById('addMembersError').textContent = 'Please enter at least one name.';
    return;
  }

  const hash = getStoredHash();
  if (!hash) { showToast('Department not registered'); return; }

  const btn = document.getElementById('confirmAddMembersBtn');
  btn.classList.add('loading'); btn.disabled = true;

  try {
    const res  = await fetch(API.addMember, {
      method : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body   : JSON.stringify({ department: dept, hash, names }),
    });
    const json = await res.json();

    if (json.status === 'ok') {
      closeModal();
      const added      = json.added || 0;
      const duplicates = json.duplicates || 0;
      let msg = `✅ ${added} member${added !== 1 ? 's' : ''} added`;
      if (duplicates > 0) msg += ` · ${duplicates} already existed`;
      showToast(msg);
      // Refresh roster from Sheets so new members appear immediately
      await fetchMembersForDept(dept, hash);
      onDateChange();
    } else {
      btn.classList.remove('loading'); btn.disabled = false;
      document.getElementById('addMembersError').style.display = 'block';
      document.getElementById('addMembersError').textContent = json.message || 'Failed to add members';
    }
  } catch (err) {
    btn.classList.remove('loading'); btn.disabled = false;
    document.getElementById('addMembersError').style.display = 'block';
    document.getElementById('addMembersError').textContent = 'Could not connect. Check your internet connection.';
  }
}

/* ── Onboarding screen ───────────────────────────────────────────────────── */
function showOnboarding() {
  switchTab('manual');
  document.getElementById('entryCards').style.display = 'none';

  let screen = document.getElementById('onboardingScreen');
  if (!screen) {
    screen = document.createElement('div');
    screen.id = 'onboardingScreen';
    document.getElementById('pane-manual').prepend(screen);
  }

  screen.style.display = 'block';
  screen.innerHTML = `
    <div class="onboarding-wrap">

      <div class="onboarding-brand">
        <div class="cross-badge" style="width:52px;height:52px;border-radius:14px;margin:0 auto 14px;">
          <svg viewBox="0 0 24 24" style="width:28px;height:28px;fill:white;">
            <path d="M11 2h2v7h7v2h-7v11h-2V11H4V9h7z"/>
          </svg>
        </div>
        <h1 style="font-family:'Playfair Display',serif;font-size:22px;font-weight:700;
                   color:var(--navy);margin-bottom:6px;">Daily Report Parser</h1>
        <p style="font-size:13px;color:var(--text-muted);line-height:1.5;">
          Christ Consulate Global
        </p>
      </div>

      <div class="onboarding-card">
        <p style="font-size:13px;color:var(--text-muted);line-height:1.7;text-align:center;">
          Welcome. To get started, enter your department name below
          then either <strong>register</strong> it as new or
          <strong>restore</strong> an existing one using your saved passphrase.
        </p>
      </div>

      <div class="onboarding-card">
        <div class="field">
          <label style="font-size:12px;font-weight:500;color:var(--text-muted);
                        letter-spacing:0.05em;text-transform:uppercase;display:block;margin-bottom:6px;">
            Department name
          </label>
          <input id="onboardDept" type="text"
                 placeholder="e.g. Prayer &amp; Bible"
                 style="width:100%;height:46px;border:1px solid var(--border);
                        border-radius:var(--radius-sm);padding:0 14px;font-size:15px;
                        font-family:'DM Sans',sans-serif;background:var(--cream);
                        color:var(--text);"
                 oninput="toggleOnboardingBtns()" />
        </div>
      </div>

      <div id="onboardingActions" style="display:none;">
        <button class="btn-primary" onclick="onboardRegister()"
                style="background:var(--navy);">
          <span class="btn-label">🔑 Register new department</span>
        </button>
        <button class="btn-primary" onclick="onboardRestore()"
                style="background:transparent;color:var(--navy);
                       border:1px solid var(--border);box-shadow:none;">
          <span class="btn-label">🔓 Restore with passphrase</span>
        </button>
      </div>

      <p style="font-size:11px;color:var(--text-light);text-align:center;margin-top:20px;line-height:1.6;">
        First time? Register your department to generate a secure passphrase.<br>
        Returning on a new device? Restore using your saved passphrase.
      </p>

    </div>`;

  toggleOnboardingBtns();
}

function toggleOnboardingBtns() {
  const val     = (document.getElementById('onboardDept')?.value || '').trim();
  const actions = document.getElementById('onboardingActions');
  if (actions) actions.style.display = val.length > 0 ? 'flex' : 'none';
}

function onboardRegister() {
  const dept = (document.getElementById('onboardDept')?.value || '').trim();
  if (!dept) return;
  // Copy dept into the main input so startRegistration() picks it up
  document.getElementById('m-dept').value = dept;
  startRegistration();
}

function onboardRestore() {
  const dept = (document.getElementById('onboardDept')?.value || '').trim();
  if (!dept) return;
  document.getElementById('m-dept').value = dept;
  startRestore();
}

function hideOnboarding() {
  const screen = document.getElementById('onboardingScreen');
  if (screen) screen.style.display = 'none';
  document.getElementById('entryCards').style.display = '';
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

/* ── Setup tab ───────────────────────────────────────────────────────────── */
function renderSetupRoster() {
  const list = document.getElementById('rosterList');
  if (!members.length) {
    list.innerHTML = '<p style="font-size:13px;color:var(--text-light);padding:6px 0;">No members loaded. Type a registered department name in the Manual tab.</p>';
    return;
  }
  list.innerHTML = members.map(m => `
    <div class="roster-item">
      <span>${esc(m)}</span>
    </div>`).join('');
}

function renderActivityList() {
  document.getElementById('activityList').innerHTML = ACTIVITIES.map((a, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(15,31,61,0.06);">
      <span style="font-size:15px;">${ACT_ICONS[i]}</span>
      <span style="font-size:13px;">${a}</span>
    </div>`).join('');
}


/* ── Manual entry grid ───────────────────────────────────────────────────── */
function buildRows() {
  return members.map(m => ({
    name: m,
    ...Object.fromEntries(ACTIVITIES.map(a => [a, manualData[m]?.[a] || false]))
  }));
}

function renderManualGrid() {
  const grid = document.getElementById('entryGrid');
  const hint = document.getElementById('noMembersHint');
  const hdr  = document.getElementById('actHeader');
  const btn  = document.getElementById('generateBtn');

  if (!members.length) {
    hint.style.display = 'block'; hdr.style.display = 'none';
    grid.innerHTML = ''; btn.style.display = 'none';
    const addBtn = document.getElementById('addMembersBtn');
    if (addBtn) addBtn.style.display = 'none';
    return;
  }
  hint.style.display = 'none'; hdr.style.display = 'flex'; btn.style.display = 'flex';
  // Show/hide Add Members button
  const addBtn = document.getElementById('addMembersBtn');
  if (addBtn) addBtn.style.display = 'flex';

  document.getElementById('actHeaderCols').innerHTML = ACT_ICONS.map((ic, i) =>
    `<div class="act-header__col">${ic}<br>${ACT_SHORT[i]}</div>`).join('');

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
  const rows  = buildRows();
  renderResults(rows, dept, ddate);
  setSyncStrip('idle');
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
    renderResults(rows, dept, ddate);
    setSyncStrip(entry.synced ? 'done' : 'idle');
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

/* ── Result renderer ─────────────────────────────────────────────────────── */
function renderResults(rows, dept, ddate) {
  const total        = rows.length;
  const participated = rows.filter(r => ACTIVITIES.some(a => r[a])).length;
  const checks       = rows.reduce((s, r) => s + ACTIVITIES.filter(a => r[a]).length, 0);
  const rate         = total ? Math.round((checks / (total * ACTIVITIES.length)) * 100) : 0;

  document.getElementById('m-statMembers').textContent = total;
  document.getElementById('m-statPresent').textContent = participated;
  document.getElementById('m-statRate').textContent    = rate + '%';

  const fmt = new Date(ddate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  document.getElementById('m-resultTitle').textContent = dept;
  document.getElementById('m-resultSub').textContent   = fmt + ' · ' + total + ' members';

  let html = '<thead><tr><th>Member</th>';
  ACT_ICONS.forEach((ic, i) => html += `<th>${ic} ${ACT_SHORT[i]}</th>`);
  html += '<th>Score</th></tr></thead><tbody>';
  rows.forEach(r => {
    const score = ACTIVITIES.filter(a => r[a]).length;
    const cls   = score >= 4 ? 'score-pill--high' : score >= 2 ? 'score-pill--mid' : 'score-pill--low';
    html += `<tr><td class="name-cell">${esc(r.name)}</td>`;
    ACTIVITIES.forEach(a => { html += r[a] ? '<td><span class="check">✅</span></td>' : '<td><span class="cross-icon">✕</span></td>'; });
    html += `<td><span class="score-pill ${cls}">${score}/6</span></td></tr>`;
  });
  html += '</tbody>';
  document.getElementById('m-resultTable').innerHTML = html;
}

/* ── Sync to Google Sheets ───────────────────────────────────────────────── */
async function syncToSheets() {
  const dept  = getCurrentDept();
  const ddate = document.getElementById('m-date').value || today();
  const hash  = getStoredHash();
  const rows  = buildRows();

  if (!rows.length) { showToast('No data to sync'); return; }
  if (!hash)        { showToast('Register this department first'); return; }

  const btn = document.getElementById('m-syncBtn');
  btn.classList.add('loading'); btn.disabled = true;
  setSyncStrip('syncing'); setDot('pending');

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
      setSyncStrip('done'); setDot('ok');
      saveToHistory(payload, true);
      showToast('✅ Saved to Google Sheets!');
    } else throw new Error(json.message || 'Unknown error');
  } catch {
    setSyncStrip('fail'); setDot('error');
    saveToHistory(payload, false);
    addToPending(payload);
    showToast('Saved locally — will retry when online');
  }
  btn.classList.remove('loading'); btn.disabled = false;
}

function setSyncStrip(state) {
  const el   = document.getElementById('m-syncStrip');
  el.className = 'sync-strip sync-strip--' + state;
  const msgs = {
    idle   : '☁️ Ready to sync to Google Sheets',
    syncing: '⏳ Syncing…',
    done   : '✅ Saved to Google Sheets successfully',
    fail   : '⚠️ Offline — saved locally, will sync later',
  };
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
  const succeededKeys = new Set();
  for (const payload of p) {
    try {
      const res  = await fetch(API.sync, { method: 'POST', body: JSON.stringify(payload) });
      const json = await res.json();
      if (json.status === 'ok') {
        succeededKeys.add(payload.key);
        saveToHistory(payload, true);
        const h = getHistory(); const idx = h.findIndex(e => e.key === payload.key);
        if (idx >= 0) { h[idx].synced = true; saveHistory(h); }
      }
    } catch { /* offline */ }
  }
  if (succeededKeys.size > 0) {
    savePending(getPending().filter(e => !succeededKeys.has(e.key)));
    showToast(`${succeededKeys.size} report(s) synced!`);
    if (succeededKeys.size === p.length) setDot('ok');
  } else {
    showToast('Still offline — try again later');
  }
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
      <div class="history-day__header" onclick="toggleHistory(${i})">
        <div>
          <h3>${esc(entry.department)}</h3>
          <p>${fmt} · ${participated}/${entry.rows.length} participated · ${rate}% rate</p>
        </div>
        <div class="history-day__badges">
          <span class="history-day__badge ${entry.synced ? 'history-day__badge--synced' : 'history-day__badge--local'}">${entry.synced ? 'Synced' : 'Local only'}</span>
          <span style="font-size:14px;color:var(--text-light);">›</span>
        </div>
      </div>
      <div class="history-day__body" id="hbody-${i}">
        <table class="history-day__table">
          ${entry.rows.map(r => { const done = ACTIVITIES.filter(a => r[a]); return `<tr>
            <td>${esc(r.name)}</td>
            <td>${done.length ? done.map(a => ACT_ICONS[ACTIVITIES.indexOf(a)]).join(' ') : '❌ Absent'}</td>
            <td style="color:var(--text-muted);text-align:right;">${r.score}/6</td></tr>`; }).join('')}
        </table>
        <div class="history-day__actions">
          <button class="btn-secondary" onclick="reShareWhatsApp(${i})">Copy for WhatsApp</button>
          ${!entry.synced ? `<button class="btn-secondary" style="color:var(--green);border-color:rgba(22,101,52,0.3);" onclick="reSync(${i})">Sync to Sheets</button>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

function toggleHistory(i) { document.getElementById('hbody-' + i).classList.toggle('history-day__body--open'); }

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
  if (!confirm(
    'Reset to fresh install?\n\n' +
    'This removes all local data from this device — history, ' +
    'passphrase, and department settings.\n\n' +
    'Your data in Google Sheets is completely untouched. ' +
    'Use "Restore from Google Sheets" after re-registering to reload it.'
  )) return;

  localStorage.removeItem('ccg_history');
  localStorage.removeItem('ccg_pending');
  localStorage.removeItem('ccg_auth');
  localStorage.removeItem('ccg_defaultDept');
  localStorage.removeItem('ccg_members'); // legacy key — safe to remove

  members    = [];
  manualData = {};

  document.getElementById('m-dept').value    = '';
  document.getElementById('m-date').valueAsDate = new Date();
  document.getElementById('defaultDept').value = '';

  document.getElementById('resultSection').style.display      = 'none';
  document.getElementById('historyLoadedBadge').style.display = 'none';
  const rs = document.getElementById('rosterStatus');
  if (rs) { rs.style.display = 'none'; rs.className = 'roster-status'; }

  setDot('');

  renderManualGrid();
  renderSetupRoster();
  renderHistory();
  showOnboarding();
}

/* ── Copy helpers ────────────────────────────────────────────────────────── */
function copyWhatsApp() {
  const dept  = getCurrentDept() || 'Department';
  const ddate = document.getElementById('m-date').value || today();
  const rows  = buildRows();
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

function copyCSV() {
  const dept  = getCurrentDept() || 'Department';
  const ddate = document.getElementById('m-date').value || today();
  const rows  = buildRows();
  if (!rows.length) return;
  let csv = `Department,Date,Member,${ACTIVITIES.join(',')},Score\n`;
  rows.forEach(r => { const score = ACTIVITIES.filter(a => r[a]).length; csv += `${dept},${ddate},${r.name},${ACTIVITIES.map(a => r[a] ? 1 : 0).join(',')},${score}\n`; });
  copyText(csv, 'CSV copied');
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

/* ── Init ────────────────────────────────────────────────────────────────── */
document.getElementById('m-date').valueAsDate = new Date();
load();
renderSetupRoster();
renderManualGrid();
renderActivityList();
renderPendingBanner();

// Check if any department is registered on this device
const _initDept = getCurrentDept();
const _hasAuth  = _initDept && (ls('ccg_auth') || {})[_initDept.toLowerCase()];

if (_initDept && _hasAuth) {
  // Returning user — fetch roster and continue normally
  initDept(_initDept);
} else {
  // Brand new install or post-reset — show onboarding
  showOnboarding();
}
