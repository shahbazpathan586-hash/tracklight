# TrackLight Analytics

**Simple, real-data analytics — everything GA4 is missing, none of the complexity.**

Built-in heatmaps · Real-time visitor count · Annotations · Funnel tracking · Session feed · Multi-site · Privacy-first · You own your data.

---

## What's new in this build

| | |
|---|---|
| ✅ **Only real data shown** | Removed all `Math.random()` fake numbers from the dashboard |
| ✅ **Real online count** | Counts actual visitors active in the last 5 minutes via `/api/realtime` |
| ✅ **Real per-minute chart** | Pageviews per minute, last 20 minutes — no fake bars |
| ✅ **Real heatmap intensity** | Based on click density (clustering), not random values |
| ✅ **Multi-site UI** | Add, switch, reset, delete sites from the UI — no JSON editing |
| ✅ **No auto-seed** | Demo data only loads when you click the button. Real sites stay clean |
| ✅ **Per-site reset** | Wipe one site's data without affecting others |
| ✅ **Persistent site selection** | Dashboard remembers the last site you viewed |
| ✅ **Heartbeat events** | More accurate session duration |
| ✅ **Form bug detection banner** | Warns when form starts > 0 but completes = 0 (the Pilchard / Chambers honeypot pattern) |
| ✅ **Agency overview** | All sites in one screen with visitors, conversions, AI sessions, health score and alerts |
| ✅ **AI traffic dashboard** | ChatGPT, Claude, Perplexity, Gemini and other AI referrals with conversion quality |
| ✅ **Website health score** | 0-100 score per site using tracking, traffic, CRO, UX and intelligence coverage |
| ✅ **Smart alerts** | Flags tracking gaps, form bugs, traffic drops, conversion drops and UX friction |
| ✅ **Funnel drop-off analysis** | Shows diagnosis, exit pages, friction pages and source/device conversion comparison |
| ✅ **Dead-click + hesitation tracking** | Captures repeated non-working clicks and CTA hover hesitation signals |
| ✅ **Client report view** | Clean report page for meetings with health, traffic, conversions, AI traffic and alerts |
| ✅ **Tracking checklist** | Confirms script, pageviews, forms, conversions, heatmap, screenshot and friction signals |

---

## Setup (local laptop)

```bash
npm install
node server.js
```

Open **http://localhost:3747**

First time, you'll see "Welcome to TrackLight — add your first site." Click **Add site**, give it a name like "Pilchard Properties" and an ID like `pilchard`. The dashboard will show you the exact tracking script to paste.

## Add a site (no JSON editing)

1. Click **Sites** in the sidebar (or the site pill at the bottom)
2. Click **Add site**
3. Fill in name + ID
4. The next screen shows your tracking snippet — copy it and paste before `</body>` on your site

## Want to preview the dashboard with sample data?

Switch to the `demo` site and click **Load sample data** on the empty state. It seeds 30 days into the demo site only — your real sites stay untouched.

---

## Deploying to Railway

The setup you already have works. After the redeploy:

1. Add a **volume** in Railway → your service → Variables → Volumes — mount it at `/app` so `data.json` survives redeploys. (Without a volume, Railway wipes the file every time you push to GitHub.)
2. Visit your live URL, add a site through the UI, install the script.

---

## API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/collect` | Tracking events from embed |
| POST | `/api/heatmap` | Heatmap clicks |
| GET | `/api/stats?siteId=X&days=30` | Dashboard stats |
| GET | `/api/realtime?siteId=X` | Online count + per-minute pageviews |
| GET | `/api/heatmap?siteId=X` | Heatmap points |
| GET | `/api/heatmap/pages?siteId=X` | Click counts per page |
| GET | `/api/heatmap/screenshot?siteId=X&url=/page` | Saved screenshot for a heatmap page |
| POST | `/api/heatmap/screenshot` | Save a screenshot for a heatmap page |
| GET | `/api/page-movers?siteId=X` | Page gainers/losers week over week |
| GET | `/api/agency-overview?days=7` | All-site agency health overview |
| GET | `/api/ai-traffic?siteId=X&days=30` | AI referral traffic, platforms, landing pages, conversions |
| GET | `/api/health-score?siteId=X&days=7` | 0-100 website health score and breakdown |
| GET | `/api/insights?siteId=X&days=7` | Smart alerts and next actions |
| GET | `/api/funnel-analysis?siteId=X&days=30` | Drop-off, exits, friction, source/device comparison |
| GET | `/api/onboarding?siteId=X` | Tracking setup checklist |
| GET | `/api/client-report?siteId=X&days=30` | Client-ready report data |
| GET | `/api/annotations?siteId=X` | List annotations |
| POST | `/api/annotations` | Add annotation |
| DELETE | `/api/annotations/:id` | Delete annotation |
| GET | `/api/sites` | List sites |
| POST | `/api/sites` | Add site |
| DELETE | `/api/sites/:id` | Delete site + all its data |
| POST | `/api/sites/:id/reset` | Wipe data, keep site |
| POST | `/api/seed-demo` | Manually load sample data into `demo` |
| GET | `/api/health` | Uptime check |

## What the embed script tracks automatically

- Pageviews (including SPA pushState navigation)
- Session duration (with periodic heartbeat)
- Scroll depth
- Click heatmap coordinates
- Rage clicks (4 clicks within 1s in a 40px radius)
- Form starts (focusin on input/textarea/select)
- Form completes + conversion (submit event)
- Phone clicks (`tel:`)
- Email clicks (`mailto:`)
- Outbound link clicks
- Dead clicks (repeated clicks on non-interactive elements)
- CTA/form hesitation (hover for 3+ seconds without clicking)

## Custom events from your site

```javascript
TrackLight.track('button_click', { label: 'hero CTA' });
TrackLight.track('plan_selected', { plan: 'pro', price: 49 });
TrackLight.identify('user_123', { plan: 'pro' });
```

---

## File structure

```
tracklight/
├── server.js                 # Express server + API
├── db.js                     # Storage layer
├── data.json                 # Created on first run (in .gitignore)
├── public/
│   ├── index.html            # Dashboard UI
│   └── tracklight.js         # Embed script
├── package.json
├── Procfile                  # For Railway/Heroku
└── README.md
```

---

## Privacy

- No cookies. Anonymous visitor ID in localStorage.
- No personal data collected by default.
- Data lives on your server only.
- GDPR-friendly out of the box.
