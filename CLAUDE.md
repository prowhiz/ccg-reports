# CCG Daily Report Parser — Project Context v4.5

> This file is for AI coding assistants (Claude Code, etc.).
> It describes the full architecture, decisions, and conventions so
> context is preserved across sessions without re-explaining history.
> **Read this entire file before making any changes.**

---

## What this project is

A mobile-first progressive web app for **Christ Consulate Global** church.
Assigned department compilers use it to record daily spiritual activity
participation for their members and sync the structured data to Google Sheets
— replacing a messy manual WhatsApp process.

**Live URL:** https://ccg-reports.netlify.app
**Current version:** v4.5

---

## Who uses it

| Role | Responsibility |
|------|---------------|
| **Compiler** | One per department. Opens the app daily, taps checkboxes, syncs to Sheets |
| **Department head** | Receives the formatted WhatsApp summary the compiler copies from the app |
| **Admin (you)** | Manages `_Departments` and `_Members` tabs in Google Sheets directly |
| **Church leadership** | Views the Google Sheet for trend data over time |

---

## Repo structure

```
ccg-reports/
├── index.html                      # HTML structure only — no inline CSS or JS
├── style.css                       # All styles — CSS custom properties, mobile-first
├── app.js                          # All JavaScript — vanilla JS, no frameworks
├── google-apps-script.js           # Paste into Extensions → Apps Script in the Sheet
├── netlify.toml                    # Build config + all API redirect rules
├── .env.example                    # Documents SHEETS_URL (safe to commit)
├── .gitignore                      # Excludes .env and node_modules
├── README.md                       # Deployment and setup instructions
├── CLAUDE.md                       # This file
└── netlify/
    └── functions/
        ├── sync.js                 # POST — sync daily report to Sheets
        ├── members.js              # GET  — fetch active members for a department
        ├── register.js             # POST — register new department with hash
        ├── history.js              # GET  — fetch all history for a department
        └── addMember.js            # POST — batch add new members to _Members
```

---

## Architecture decisions

### Vanilla JS — no React/Vue
Compilers are non-technical, use phones, often have poor signal. No build step,
no bundle size, instant load. The app is a form + localStorage + fetch calls.

### Netlify Function proxies
The Google Apps Script URL (`SHEETS_URL`) is never in client code or the repo.
All API calls go through Netlify Functions which hold the URL via environment
variable. The app calls `/api/*` which Netlify redirects to `/.netlify/functions/*`.

### Passphrase-based auth (zero-knowledge)
Each department has a 4-word passphrase generated on-device using the Web Crypto
API. The raw passphrase never leaves the device — only its SHA-256 hash is sent
to and stored in Google Sheets. The app stores the raw passphrase in localStorage
(`ccg_auth`) for daily use after first registration. Wrong hash = no access.

### Google Apps Script as backend
Free, no server, writes directly to Google Sheets. Each department gets its own
report tab automatically. Two admin tabs (`_Departments`, `_Members`) act as
the source of truth for auth and rosters.

### localStorage for offline resilience
Reports save locally before any network call. A pending queue retries failed
syncs. Full history can be restored from Sheets on a new device via the
authenticated `/api/history` endpoint.

### _Members as admin-only source of truth
Member names are never written by the sync flow. They are:
- Added by the compiler via the explicit "Add Members" batch modal (authenticated)
- Managed by the admin directly in the `_Members` sheet tab
- Fetched by the app on every session load — compilers never type names manually

---

## Google Sheets structure

### `_Departments` tab
| Department | Hash |
|---|---|
| Prayer & Bible | `sha256hex...` |
| Multimedia | `sha256hex...` |

One row per department. Hash is the SHA-256 of the department's passphrase.
Only the admin should edit this tab. To reset a department's passphrase: delete
the hash cell — the compiler can then re-register.

### `_Members` tab
| Department | Name | Active |
|---|---|---|
| Prayer & Bible | Bro Oscar | TRUE |
| Prayer & Bible | Sis Eniola | TRUE |
| Prayer & Bible | Bro Samuel | FALSE |

- `Active = TRUE` → member appears in the app roster
- `Active = FALSE` → member is hidden from the app (soft delete)
- To deactivate a member: set `Active` to `FALSE` directly in this tab
- To reactivate: set back to `TRUE` — full history preserved
- The app NEVER writes `Active = FALSE` — deactivation is admin-only

### Department report tabs (e.g. `Prayer & Bible`)
| Date | Member | Midnight Prayer | Mid-day Prayer | Bible Reading | Reflection | Confessions | Word Tape | Score | Rate % |
|---|---|---|---|---|---|---|---|---|---|
| 2026-05-06 | Bro Oscar | 1 | 0 | 1 | 0 | 0 | 0 | 2 | 33% |

One row per member per day. Date is repeated on every row (required for
filtering/querying — do not use sparse layout). On re-sync of the same date,
existing rows for that date are deleted and replaced — no duplicates.

---

## Auth flow

### First time / new device
1. App loads → no `ccg_auth` in localStorage → `showOnboarding()` called
2. Onboarding screen renders with department input + two buttons
3. **Register** → `startRegistration()` → passphrase generated → shown once
   → compiler saves it → confirms → hash sent to `/api/register` → stored in
   `_Departments` → `storeAuth(dept, hash)` saves hash to localStorage →
   `hideOnboarding()` → normal entry UI appears
4. **Restore** → `startRestore()` → compiler enters saved passphrase →
   app hashes it → sends to `/api/members` for validation → on success →
   `storeAuth()` → `hideOnboarding()` → prompts to restore history

### Daily use (returning compiler)
1. App loads → `ccg_auth` found → `initDept()` → `fetchMembersForDept()` →
   roster appears → compiler fills grid → generates report → syncs

### Reset to fresh install
`clearHistory()` removes ALL localStorage keys:
- `ccg_history`, `ccg_pending`, `ccg_auth`, `ccg_defaultDept`, `ccg_members`
Then calls `showOnboarding()` immediately — app looks and behaves like new.

---

## localStorage keys

| Key | Type | Contents |
|-----|------|----------|
| `ccg_auth` | Object | `{ "dept name lowercase": "sha256hash" }` |
| `ccg_history` | Array | History entry objects (max 90, newest first) |
| `ccg_pending` | Array | Unsynced payloads — retried by `retryAllPending()` |
| `ccg_defaultDept` | String | Saved department name for auto-fill on load |
| `ccg_members` | — | Legacy key from earlier version — safe to remove if found |

### History entry shape
```json
{
  "key": "Prayer & Bible|2026-05-06",
  "department": "Prayer & Bible",
  "date": "2026-05-06",
  "synced": true,
  "savedAt": "2026-05-06T20:15:00.000Z",
  "rows": [
    {
      "name": "Bro Oscar",
      "Midnight Prayer": true,
      "Mid-day Prayer": false,
      "Bible Reading": true,
      "Reflection": false,
      "Confessions": false,
      "Word Tape": false,
      "score": 2,
      "rate": "33%"
    }
  ]
}
```

### Sync payload shape (sent to `/api/sync`)
```json
{
  "department": "Prayer & Bible",
  "date": "2026-05-06",
  "hash": "sha256hexstring",
  "rows": [ ...same as history rows... ]
}
```

---

## Activities — fixed, must match everywhere

```javascript
const ACTIVITIES = [
  'Midnight Prayer',
  'Mid-day Prayer',
  'Bible Reading',
  'Reflection',
  'Confessions',
  'Word Tape'
];
```

**Critical:** These exact strings are used as keys in localStorage, in the sync
payload, in the Netlify function validator, and in the Apps Script column headers.
Do not rename or reorder without updating all four locations simultaneously.

---

## App tabs

| Tab | Pane ID | Purpose |
|-----|---------|---------|
| ✏️ Entry | `pane-manual` | Primary daily use — tap checkboxes, generate, sync |
| 🗂 History | `pane-history` | View past reports, retry pending syncs, restore from Sheets, reset device |
| ⚙️ Setup | `pane-settings` | Default dept name, offline member fallback, activities reference |

The AI Paste tab was removed in v4.1. Do not re-add it.

---

## Key functions in app.js

### Onboarding
| Function | Description |
|----------|-------------|
| `showOnboarding()` | Renders welcome screen in Manual tab — called on fresh install or reset |
| `hideOnboarding()` | Dismisses welcome screen, shows normal entry UI |
| `toggleOnboardingBtns()` | Shows/hides action buttons based on dept input |
| `onboardRegister()` | Copies onboard dept to main input, calls `startRegistration()` |
| `onboardRestore()` | Copies onboard dept to main input, calls `startRestore()` |

### Auth
| Function | Description |
|----------|-------------|
| `getStoredHash()` | Returns SHA-256 hash for current dept from `ccg_auth` or null |
| `storeAuth(dept, hash)` | Saves hash to `ccg_auth` in localStorage |
| `sha256(str)` | Async — hashes a string using Web Crypto API |
| `generatePassphrase()` | Generates a 4-word hyphen-separated passphrase using `crypto.getRandomValues` |
| `startRegistration()` | Shows passphrase modal with copy + confirmation checkbox |
| `confirmRegistration(dept, passphrase, hash)` | POSTs hash to `/api/register`, stores auth on success |
| `startRestore()` | Shows passphrase input modal |
| `confirmRestore(dept)` | Hashes input, validates via `/api/members`, stores auth on success |

### Members
| Function | Description |
|----------|-------------|
| `onDeptInput()` | Debounced (700ms) — calls `initDept()` when dept field changes |
| `initDept(dept)` | Checks stored auth; calls `fetchMembersForDept` or `showAuthPrompt` |
| `fetchMembersForDept(dept, hash)` | GET `/api/members` — populates `members` array |
| `showAddMembersModal()` | Opens batch add modal with multi-line textarea |
| `submitNewMembers(dept)` | Validates online status, POSTs to `/api/addMember`, refreshes roster |
| `renderManualGrid()` | Rebuilds checkbox grid from `members` + `manualData` |

### Daily entry
| Function | Description |
|----------|-------------|
| `toggleCheck(member, activity)` | Flips one checkbox in `manualData`, updates DOM in place |
| `markAbsent(member)` | Sets all activities to false for one member |
| `generateFromManual()` | Builds rows from `manualData`, calls `renderResults()` |
| `onDateChange()` | Loads history entry for dept+date if one exists, clears grid if not |
| `resetManual()` | Clears `manualData`, hides result card |

### Sync & history
| Function | Description |
|----------|-------------|
| `syncToSheets()` | POSTs payload with hash to `/api/sync`; saves to history; queues if offline |
| `saveToHistory(payload, synced)` | Upserts entry in `ccg_history` by key (dept\|date) |
| `retryAllPending()` | Loops `ccg_pending`, retries each sync, removes successes |
| `restoreHistoryFromSheets()` | GET `/api/history` — merges remote entries into local history |
| `clearHistory()` | Wipes ALL localStorage keys, resets all state, calls `showOnboarding()` |
| `renderHistory()` | Renders History tab entries + pending banner |
| `reSync(i)` | Re-syncs a single history entry by index |

---

## Netlify functions

All functions read `process.env.SHEETS_URL`. All return `{ status, message }`.
All validate their inputs before forwarding to Google Apps Script.

| Function file | Method | Auth required | Action |
|---|---|---|---|
| `sync.js` | POST | hash in body | Sync daily report rows |
| `members.js` | GET | hash in query | Fetch active members for dept |
| `register.js` | POST | none (hash IS the credential) | Register new dept + hash |
| `history.js` | GET | hash in query | Fetch all history rows for dept |
| `addMember.js` | POST | hash in body | Batch add new members to `_Members` |

---

## Google Apps Script actions

### GET actions
| `action` param | Auth needed | Description |
|---|---|---|
| `register` | No | Adds dept + hash to `_Departments`. Rejects if dept already exists |
| `getMembers` | Yes | Returns active members for dept from `_Members` |
| `getHistory` | Yes | Returns all report rows grouped by date, newest first |

### POST actions (action field in body)
| `action` field | Auth needed | Description |
|---|---|---|
| `addMembers` | Yes | Appends new names to `_Members` with `Active = TRUE`. Skips duplicates (checks all rows, active or not) |
| _(default/omitted)_ | Yes | Sync report — deletes existing rows for date, appends fresh rows |

### Key rules
- Hash validation: matches dept name (case-insensitive) + hash against `_Departments`
- `getMembersForDept` filters `Active != 'FALSE'` — missing or TRUE = active
- `addMembersForDept` checks ALL existing rows (active + inactive) for duplicates
- On re-sync: existing rows for the date are deleted before appending — prevents duplicates
- `autoRegisterMembers` does NOT exist — members are never added as a side effect of syncing

---

## Environment variables

| Variable | Where | Value |
|---|---|---|
| `SHEETS_URL` | Netlify dashboard → Site config → Env vars | Google Apps Script Web App URL |

Never commit the real URL. `.env.example` shows the key name only.

For local dev:
```bash
cp .env.example .env
# Add real SHEETS_URL value
netlify dev   # runs at http://localhost:8888
```

---

## Design tokens (always use these, never hardcode)

```css
--navy: #0f1f3d        /* header, primary buttons, table headers */
--navy-mid: #1a3260    /* loading states */
--gold: #c9972a        /* accent, card-label text */
--gold-pale: #fdf6e3   /* card-label rule line */
--cream: #faf8f4       /* page background, input backgrounds */
--green: #166534       /* success states, sync confirmed */
--green-bg: #dcfce7    /* success background */
--red: #991b1b         /* errors, absent indicator */
--red-bg: #fee2e2      /* error background */
--amber: #92400e       /* warnings, tip boxes */
--amber-bg: #fef3c7    /* warning background */
--blue: #1e40af        /* info, history loaded badge */
--blue-bg: #dbeafe     /* info background */
--border: rgba(15,31,61,0.12)
--radius: 14px
--radius-sm: 8px
```

---

## Coding conventions

- **No frameworks** — vanilla HTML, CSS, JS only. No React, Vue, jQuery.
- **No build step** — files are served as-is. What you write is what runs.
- **Mobile-first** — design for ~390px width first, scale up with media queries
- **CSS custom properties** — always use design tokens. Never hardcode colours, radii, or shadows.
- **camelCase, verb-first** — `renderX`, `saveX`, `fetchX`, `showX`, `onX`, `submitX`
- **try/catch on all fetches** — user always gets feedback, never a silent failure
- **Offline-first** — check `navigator.onLine` before member management operations. Save locally before network calls for reports.
- **No TypeScript** — keep barrier to contribution low
- **No Prettier/ESLint enforcement** — add locally if preferred, not in CI

---

## Things intentionally NOT in this project

- No login/accounts — passphrase per department is the access control
- No multi-department per device — one `ccg_auth` key per device session
- No push notifications — out of scope
- No AI Paste tab — removed in v4.1, do not re-add
- No `autoRegisterMembers` — removed in v4.2, members are never auto-added via sync

---

## Possible future features

- Admin dashboard showing all departments' data in one view
- Monthly PDF export of a department's report
- Push notification reminders to compilers at end of day
- Member activity streaks and personal history view
- Multi-department support from a single device (requires auth refactor)
