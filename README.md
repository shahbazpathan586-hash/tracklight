# TrackLight v2 — Agency Analytics

A self-hosted analytics platform for SEO agencies. Manage all your client sites in one dashboard. Track what GA4 misses — including **AI referral traffic from ChatGPT, Claude, Perplexity, Gemini, Copilot, and more.**

## What's new in v2

| Feature | v1 | v2 |
|---|---|---|
| Storage | `data.json` (wiped on redeploy) | **PostgreSQL** (persistent) |
| Login | None — anyone could see data | **Admin password required** |
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

Railway creates a `DATABASE_URL` variable automatically. You don't need to copy it — the next step links it.

### Step 2 — Link the database to your service

In your TrackLight service: **Variables** → **Add Reference** → pick `DATABASE_URL` from the Postgres service.

### Step 3 — Set the admin password

In **Variables**, add:

```
ADMIN_PASSWORD=YOUR_STRONG_PASSWORD_HERE
JWT_SECRET=any-random-long-string-here
NODE_ENV=production
```

Railway will redeploy. Done. Open your `.railway.app` URL → log in.

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
# Install postgres locally and create a tracklight db
npm install
export DATABASE_URL="postgresql://postgres:password@localhost:5432/tracklight"
export ADMIN_PASSWORD="admin123"
export PGSSL=false       # disable SSL for local postgres
npm start
```

Open `http://localhost:3747`.

## API quick reference

All endpoints under `/api/`. Most require either an admin session cookie or a `?token=SHARE_TOKEN`.

| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/auth/login` | POST | none | `{password}` → sets session cookie |
| `/api/auth/logout` | POST | session | Clears session |
| `/api/auth/me` | GET | none | `{authed: bool}` |
| `/api/track` | POST | none | Tracking event ingestion (called by embed script) |
| `/api/heatmap` | POST | none | Heatmap click batch ingestion |
| `/api/overview` | GET | admin | All sites with health status |
| `/api/stats?siteId=&days=` | GET | admin or token | Full stats for a site |
| `/api/realtime?siteId=` | GET | admin or token | Online visitors, last 20 min |
| `/api/ai-traffic?siteId=&days=` | GET | admin or token | AI referral breakdown |
| `/api/page-movers?siteId=` | GET | admin or token | Week-over-week gainers / losers |
| `/api/health-score?siteId=` | GET | admin or token | 0–100 score with breakdown |
| `/api/sites` | GET / POST | admin | List / add sites |
| `/api/sites/:id` | DELETE | admin | Delete site + all data |
| `/api/sites/:id/reset` | POST | admin | Wipe events but keep site |
| `/api/annotations?siteId=` | GET | admin or token | Timeline annotations |
| `/api/alerts` | GET / POST | admin | Alert rules CRUD |
| `/api/alerts/evaluate` | POST | admin | Run alert checks now (also runs every 15min automatically) |
| `/api/alert-history` | GET | admin | Recent triggers |
| `/api/share-links?siteId=` | GET / POST | admin | Share link CRUD |
| `/api/share-info?token=` | GET | none | Resolve token to site (for public report) |
| `/api/seed-demo` | POST | admin | Load 30 days of demo data into the `demo` site |
| `/api/health` | GET | none | Liveness check |

## Important warnings

- **Default password is `admin123`** if you don't set `ADMIN_PASSWORD`. Change it before going live.
- **`JWT_SECRET` defaults to a placeholder.** Set it to anything random and long.
- **Tracking endpoints are intentionally unauthenticated** — they have to be reachable by any browser visiting any tracked site. We just record what comes in; the embed script only reports what you tell it to.
- **Without Postgres, data lives in memory and disappears on restart.** Always link a Postgres database in production.

## Tech stack

- Node.js 18+ + Express 4
- PostgreSQL (via `pg`)
- JWT auth via `jsonwebtoken` + `cookie-parser`
- Chart.js (CDN) for client-side charts
- Single-page vanilla JS dashboard — no React, no build step

---

Built for use, not for VC funding. If you find bugs, the right move is to read the code — it's ~800 lines of `server.js` and `db.js`, nothing magic.
