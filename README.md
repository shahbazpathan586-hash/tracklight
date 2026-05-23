# TrackLight v2 — Agency Analytics

A self-hosted analytics platform for SEO agencies. Manage all your client sites in one dashboard. Track what GA4 misses — including **AI referral traffic from ChatGPT, Claude, Perplexity, Gemini, Copilot, and more.**

## What's new in v2

| Feature | v1 | v2 |
|---|---|---|
| Storage | `data.json` (wiped on redeploy) | **PostgreSQL** (persistent) |
| Login | None — anyone could see data | **None** (open access by design — see warning below) |
| Sites view | Single hardcoded site | **Multi-site agency overview** with health status |
| AI traffic | Lumped into "Direct" | **AI traffic dashboard** — ChatGPT, Claude, Perplexity, Gemini, Copilot, You.com, Phind, DeepSeek, Grok, Poe |
| Health score | None | **0–100 score** per site combining traffic, forms, conversions, bounce rate, freshness |
| Page movers | None | **Gainers / losers** week over week |
| Alerts | None | **Form-bug, traffic-drop, no-conversion** rules with history |
| Client sharing | None | **Public share links** — read-only report per site, no client login |
| Form bug detection | Banner only | **Auto-alert** when form_starts > 0 and form_completes = 0 |
| Seed performance | ~60s | **~1.1s** (batch insert) |

## Tracking script features

- Pageviews, sessions, unique visitors (anonymous, no cookies)
- **AI source classification** — automatically tags traffic from ChatGPT, Claude, Perplexity, Gemini, Copilot, etc.
- Form starts and completes (detects the Pilchard/Chambers honeypot-bug pattern)
- Rage click detection (4+ clicks in 1s at same spot)
- Click heatmaps
- Scroll depth, time on page
- SPA support (React, Vue, Next.js — listens to `pushState`/`replaceState`/`popstate`)
- `sendBeacon` for reliable delivery on page unload
- Skips localhost preview by default (override with `?track=1`)

## Deployment to Railway

### Step 1 — Add a Postgres database

In your Railway project: **+ New** → **Database** → **Add PostgreSQL**.

### Step 2 — Link the database to your service

In your TrackLight service: **Variables** → **Add Reference** → pick `DATABASE_URL` from the Postgres service.

That's it. Railway redeploys → open your `.railway.app` URL → you're in.

### ⚠️ Open access — no login

This build has **no password and no login screen**. Anyone with your Railway URL can see all client data and add/delete sites.

If you want to keep it private:
- Don't share or post the URL publicly
- Don't let it get indexed by search engines (add `noindex` meta tag if concerned)
- Consider using Railway's built-in URL randomization (the default `.up.railway.app` subdomains are unguessable, but treat the URL like a password)
- If your agency grows, you can re-enable login later — the auth code is just stubbed out, not deleted

### What you get on first load

- Login screen (admin password gate)
- Empty agency overview — add your first site via "+ Add Site"
- Demo data is **not** loaded automatically. To load it, add the site `demo` first, then click "Load demo data" on its empty state.

## Installing the tracking script on client sites

For each site you add, the **Install Code** tab shows you a one-line snippet:

```html
<script src="https://your-app.railway.app/tracklight.js?id=YOUR_SITE_ID" async></script>
```

Paste it before `</head>` on every page. Step-by-step instructions for WordPress, Shopify, Wix, and Squarespace are shown inside the dashboard.

## Sharing reports with clients

Sites → **Share Links** tab → **+ Create Share Link** → copy the URL → send to client.

Client opens the URL → sees a read-only public report with their site health score, AI traffic breakdown, top pages, sources. No login needed on their end. Link can be revoked anytime.

## Local development

```bash
npm install
export DATABASE_URL="postgresql://postgres:password@localhost:5432/tracklight"
export PGSSL=false       # disable SSL for local postgres
npm start
```

Open `http://localhost:3747`.

## API quick reference

All endpoints under `/api/`. **No authentication required** — anyone with the URL can call any endpoint.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/auth/me` | GET | Returns `{authed: true}` always (stub) |
| `/api/track` | POST | Tracking event ingestion (called by embed script) |
| `/api/heatmap` | POST | Heatmap click batch ingestion |
| `/api/overview` | GET | All sites with health status |
| `/api/stats?siteId=&days=` | GET | Full stats for a site |
| `/api/realtime?siteId=` | GET | Online visitors, last 20 min |
| `/api/ai-traffic?siteId=&days=` | GET | AI referral breakdown |
| `/api/page-movers?siteId=` | GET | Week-over-week gainers / losers |
| `/api/health-score?siteId=` | GET | 0–100 score with breakdown |
| `/api/sites` | GET / POST | List / add sites |
| `/api/sites/:id` | DELETE | Delete site + all data |
| `/api/sites/:id/reset` | POST | Wipe events but keep site |
| `/api/annotations?siteId=` | GET / POST | Timeline annotations |
| `/api/alerts` | GET / POST | Alert rules CRUD |
| `/api/alerts/evaluate` | POST | Run alert checks now (also runs every 15min) |
| `/api/alert-history` | GET | Recent triggers |
| `/api/share-links?siteId=` | GET / POST | Share link CRUD |
| `/api/share-info?token=` | GET | Resolve token to site (for public report) |
| `/api/seed-demo` | POST | Load 30 days of demo data into the `demo` site |
| `/api/health` | GET | Liveness check |

## Important warnings

- **No login.** Anyone who finds your Railway URL has full control.
- **Without Postgres, data lives in memory and disappears on restart.** Always link a Postgres database in production.
- **Tracking endpoints have no validation** beyond `siteId` + `event` — they have to be reachable by any browser visiting any tracked site.

## Tech stack

- Node.js 18+ + Express 4
- PostgreSQL (via `pg`)
- Chart.js (CDN) for client-side charts
- Single-page vanilla JS dashboard — no React, no build step
- No authentication (open access)

---

Built for use, not for VC funding. If you find bugs, the right move is to read the code — it's ~800 lines of `server.js` and `db.js`, nothing magic.
