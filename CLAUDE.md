# CCG Daily Report Parser — Project Context

> This file is for AI coding assistants (Claude Code, Copilot, etc.).
> It describes the project architecture, decisions, and conventions so
> context is preserved across sessions without re-explaining history.

---

## What this project is

A mobile-first progressive web app for **Christ Consulate Global** church.
It allows assigned department compilers to record daily spiritual activity
participation for their department members and sync the data to Google Sheets
for longitudinal tracking — replacing a messy manual WhatsApp process.

**Live URL:** https://ccg-reports.netlify.app

---

## Who uses it

- **Compiler** — one person per department, assigned to record participation daily
- **Department head** — receives the WhatsApp summary the compiler copies from the app
- **Church leadership** — views the Google Sheet for trend data over time

---

## Repo structure

```
ccg-reports/
├── index.html                  # HTML structure only — no inline CSS or JS
├── style.css                   # All styles — CSS custom properties, mobile-first
├── app.js                      # All JavaScript — vanilla JS, no frameworks
├── netlify.toml                # Netlify build config + /api/sync redirect rule
├── .env.example                # Documents SHEETS_URL env variable (safe to commit)
├── .gitignore                  # Excludes .env and node_modules
├── README.md                   # Deployment and setup instructions
├── CLAUDE.md                   # This file
└── netlify/
    └── functions/
        └── sync.js             # Serverless proxy — validates payload, forwards to Google
```

---

## Architecture decisions

### Why vanilla JS (no React/Vue)
The compiler is non-technical, uses the app on a phone, and needs it to work
fast on low-end devices. A framework would add unnecessary complexity and bundle
size for what is essentially a form + local storage app.

### Why a Netlify Function proxy
The Google Apps Script URL must never appear in client-side code or the GitHub
repo. `netlify/functions/sync.js` holds the URL via the `SHEETS_URL` environment
variable (set in Netlify dashboard, never committed). The app posts to `/api/sync`
which Netlify redirects to `/.netlify/functions/sync`.

### Why Google Apps Script as the backend
Free, no server needed, writes directly to a Google Sheet the church already
uses. Each department gets its own tab in the Sheet automatically.

### Why localStorage for history
The app needs to work offline (compilers may have poor signal). Every generated
report is saved locally first, then synced to Sheets. A pending queue retries
failed syncs automatically.

---

## Key data structures

### History entry (stored in localStorage as `ccg_history`)
```json
{
  "key": "Prayer & Bible|2026-05-06",
  "department": "Prayer & Bible",
  "date": "2026-05-06",
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
  ],
  "synced": true,
  "savedAt": "2026-05-06T20:15:00.000Z"
}
```

### Pending queue (stored in localStorage as `ccg_pending`)
Same shape as a history entry. Entries are removed when successfully synced.

### Payload sent to `/api/sync`
```json
{
  "department": "Prayer & Bible",
  "date": "2026-05-06",
  "rows": [ ...same as history rows above... ]
}
```

---

## Activities tracked

These are fixed and must match exactly across the app, the Netlify function
validator, and the Google Apps Script:

```javascript
const ACTIVITIES = [
  "Midnight Prayer",
  "Mid-day Prayer",
  "Bible Reading",
  "Reflection",
  "Confessions",
  "Word Tape"
];
```

Do not rename or reorder these without updating all three locations.

---

## localStorage keys

| Key | Contents |
|-----|----------|
| `ccg_members` | JSON array of member name strings |
| `ccg_history` | JSON array of history entry objects (max 90) |
| `ccg_pending` | JSON array of unsynced payloads |
| `ccg_defaultDept` | String — default department name |

---

## Design tokens (CSS custom properties)

Defined in `:root` in `style.css`. Always use these — never hardcode colours.

```css
--navy: #0f1f3d        /* primary brand, header, buttons */
--gold: #c9972a        /* accent, section labels */
--cream: #faf8f4       /* page background */
--green: #166534       /* success, sync confirmed */
--red: #991b1b         /* error, absent */
--amber: #92400e       /* warning, tip boxes */
--blue: #1e40af        /* info, history loaded badge */
```

---

## App tabs and their responsibilities

| Tab | ID | Purpose |
|-----|----|---------|
| Manual Entry | `pane-manual` | Primary daily use — tap checkboxes per member |
| AI Paste | `pane-paste` | Fallback — paste raw WhatsApp text, AI parses it |
| History | `pane-history` | View all past reports, retry pending syncs |
| Setup | `pane-settings` | Add/remove members, set default department |

---

## Key functions in app.js

| Function | What it does |
|----------|-------------|
| `onDateChange()` | Fires when date or dept changes — loads history entry if one exists for that key, clears grid if not |
| `renderManualGrid()` | Rebuilds the tap-to-toggle checkbox grid from `members` and `manualData` |
| `generateFromManual()` | Reads `manualData`, renders result card, shows sync button |
| `syncToSheets(mode)` | POSTs to `/api/sync`, saves to history, handles offline fallback |
| `saveToHistory(payload, synced)` | Upserts entry in `ccg_history` by key |
| `renderHistory()` | Renders the History tab, including pending banner |
| `retryAllPending()` | Loops pending queue and retries each sync |
| `runParse()` | Calls Anthropic API with raw WhatsApp text, extracts structured rows |
| `renderResults(rows, dept, date, mode)` | Renders the result table and summary stats |

---

## Netlify function: sync.js

Located at `netlify/functions/sync.js`. Validates:
- HTTP method is POST
- `SHEETS_URL` env var exists
- `department` is a non-empty string under 100 chars
- `date` matches `YYYY-MM-DD` format
- `rows` is an array between 1–50 entries
- Each row's activity values are booleans
- Only the 6 known activity names are accepted

If validation passes, forwards the payload to Google Apps Script.

---

## Google Apps Script (in the Google Sheet)

The script (`Extensions → Apps Script` in the Sheet) receives the payload and:
1. Gets or creates a sheet tab named after the department
2. Deletes any existing rows for that date (prevents duplicates on re-sync)
3. Appends fresh rows — one per member

**Deployment:** The script is deployed as a Web App. When updating the script,
always edit the existing deployment (not create a new one) to preserve the URL.
The URL is stored only in Netlify's environment variables as `SHEETS_URL`.

---

## Environment variables

| Variable | Where set | Value |
|----------|-----------|-------|
| `SHEETS_URL` | Netlify dashboard → Site config → Environment variables | Google Apps Script Web App URL |

Never commit the real URL. The `.env.example` file shows the variable name only.

---

## Local development

```bash
npm install -g netlify-cli
cp .env.example .env
# Add real SHEETS_URL to .env
netlify dev
# App runs at http://localhost:8888
# Function runs at http://localhost:8888/api/sync
```

---

## Coding conventions

- **No frameworks** — vanilla HTML, CSS, JS only
- **No build step** — what you write is what gets served
- **Mobile-first** — default styles target small screens, adjust up with media queries
- **CSS custom properties** — always use design tokens, never hardcode colours or radii
- **Accessible markup** — use semantic elements, proper labels on all inputs
- **Function naming** — camelCase, verb-first (`renderX`, `saveX`, `loadX`, `onX`)
- **Error handling** — all fetch calls wrapped in try/catch, user always gets feedback
- **Offline first** — save locally before attempting any network call

---

## What's been intentionally left simple

- No authentication — the app is distributed directly to one trusted compiler per dept
- No multi-user sync conflicts — one compiler per department, one device
- No build tooling — Prettier/ESLint can be added locally but are not enforced
- No TypeScript — keep the barrier to contribution low

---

## Possible future features (not yet built)

- Multi-department support from a single app instance (currently one roster per device)
- Admin view showing all departments' data in one dashboard
- Push notification reminders for compilers at end of day
- Export full month as PDF report
- Member profile pages with personal participation history
