# CCG Daily Report Parser

A mobile-first web app for Christ Consulate Global department compilers to record and track daily spiritual activity participation — without WhatsApp chaos.

## Features

- ✏️ **Manual entry** — tap checkboxes per member per activity, no typing
- 📋 **AI paste** — paste raw WhatsApp report text, AI extracts the data
- 🗂 **History** — every report saved locally, viewable any time
- 📤 **Google Sheets sync** — one tap sends structured data to a live Sheet
- 📵 **Offline resilience** — saves locally if no internet, retries later

## Repo structure

```
ccg-reports/
├── index.html                  # The full web app
├── netlify.toml                # Netlify build + routing config
├── .env.example                # Documents required environment variable
├── .gitignore                  # Keeps .env and node_modules out of git
└── netlify/
    └── functions/
        └── sync.js             # Serverless proxy — holds the secret URL
```

## Deployment

### 1. Clone and push to GitHub

```bash
git clone https://github.com/YOUR_USERNAME/ccg-reports.git
cd ccg-reports
git add .
git commit -m "Initial deploy"
git push
```

### 2. Connect to Netlify

1. Log in to [netlify.com](https://netlify.com)
2. Click **Add new site → Import an existing project**
3. Choose **GitHub** and select this repo
4. Build settings are auto-detected from `netlify.toml` — leave defaults
5. Click **Deploy site**

### 3. Add the environment variable

This is the critical step that keeps your Google Apps Script URL private.

1. In Netlify, go to **Site configuration → Environment variables**
2. Click **Add a variable**
3. Key: `SHEETS_URL`
4. Value: your full Google Apps Script Web App URL
5. Click **Save**
6. Go to **Deploys → Trigger deploy → Deploy site** to apply the variable

### 4. (Optional) Set a custom subdomain

In Netlify: **Domain management → Options → Edit site name**  
e.g. `ccg-reports.netlify.app`

---

## Local development

To run locally with the sync function working:

```bash
npm install -g netlify-cli
cp .env.example .env
# Edit .env and add your real SHEETS_URL
netlify dev
```

The app will be available at `http://localhost:8888`.

---

## Google Sheets setup

The sync function posts to a Google Apps Script Web App. Each department's data lands in its own sheet tab automatically.

See the Apps Script code in the project wiki or ask your administrator for the script.

---

## Security

- The Google Apps Script URL is **never in the HTML or GitHub repo**
- It lives only in Netlify's encrypted environment variables
- The serverless function validates every payload before forwarding:
  - Correct HTTP method
  - Valid date format
  - Member names under 100 characters
  - Only the 6 known activities accepted
  - Row count capped at 50
