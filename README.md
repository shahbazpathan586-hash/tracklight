# TrackLight Analytics

**Simple, powerful analytics — everything GA4 is missing.**

Built-in heatmaps · Session recording feed · Annotations · Funnel tracking · Real-time · No GA4 complexity · You own your data.

---

## What it does

| Feature | GA4 | TrackLight |
|---|---|---|
| Heatmaps | ❌ Need Hotjar | ✅ Built-in |
| Annotations on timeline | ❌ Removed | ✅ Built-in |
| Real-time data | ⚠ 24hr delay | ✅ Instant |
| Session feed + rage click | ❌ | ✅ Built-in |
| Conversion funnel | ⚠ Complex setup | ✅ Automatic |
| Simple dashboard | ❌ Buried menus | ✅ One screen |
| Shareable client report | ❌ Needs Google login | ✅ Public link |
| You own your data | ❌ Google owns it | ✅ Your server |
| GDPR / no cookies | ❌ Requires consent | ✅ Cookie-free |

---

## Setup (3 steps)

### 1. Install dependencies
```bash
npm install
```

### 2. Start the server
```bash
node server.js
```
Server runs on **http://localhost:3747**

### 3. Add to your website
Paste this before `</body>` on every page:
```html
<script src="http://YOUR_SERVER:3747/tracklight.js?id=SITE_ID" async></script>
```

Open **http://localhost:3747** to see your dashboard.

---

## What the embed script tracks automatically

- **Pageviews** — every page load and SPA navigation
- **Sessions** — unique visits with duration and page depth
- **Scroll depth** — how far users scroll on each page
- **Click heatmap** — x/y coordinates of every click
- **Rage clicks** — 4+ rapid clicks in the same spot (frustration signal)
- **Form starts** — when a user focuses any form field
- **Form completions** — when a form is submitted
- **Phone clicks** — `tel:` link clicks
- **Email clicks** — `mailto:` link clicks
- **Outbound clicks** — links leaving your domain
- **Traffic sources** — referrer-based channel attribution

## Custom events (optional)
```javascript
// Track anything custom
TrackLight.track('button_click', { label: 'hero CTA' });
TrackLight.track('video_play', { title: 'intro video' });
TrackLight.track('plan_selected', { plan: 'pro', price: 49 });

// Identify a logged-in user
TrackLight.identify('user_123', { plan: 'pro', company: 'Acme' });
```

---

## API endpoints

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/collect` | Receive tracking events from embed script |
| POST | `/api/heatmap` | Receive heatmap click data |
| GET | `/api/stats?siteId=X&days=30` | Dashboard stats |
| GET | `/api/heatmap?siteId=X` | Heatmap data for a site |
| GET | `/api/annotations?siteId=X` | Get annotations |
| POST | `/api/annotations` | Add annotation |
| GET | `/api/sites` | List all sites |
| POST | `/api/seed` | Seed demo data |

---

## File structure

```
tracklight/
├── server.js           # Express server + API routes
├── db.js               # Database layer (lowdb / JSON)
├── data.json           # Your data (auto-created)
├── public/
│   ├── index.html      # Dashboard UI
│   └── tracklight.js   # Embed script (put this on client sites)
└── README.md
```

---

## Deploying to a real server

### Option A: VPS (DigitalOcean, Hetzner, etc.)
```bash
# On your server
git clone <your-repo>
cd tracklight
npm install
# Install PM2 to keep it running
npm install -g pm2
pm2 start server.js --name tracklight
pm2 save
```
Then point a subdomain (e.g. `analytics.yourdomain.com`) to your server via nginx:
```nginx
server {
    listen 80;
    server_name analytics.yourdomain.com;
    location / {
        proxy_pass http://localhost:3747;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Option B: Railway / Render / Fly.io (free tier)
Add a `Procfile`:
```
web: node server.js
```
Set `PORT` environment variable — update `server.js` to use `process.env.PORT || 3747`.

---

## Multiple sites

Each site gets its own ID. Pass `?id=YOUR_SITE_ID` in the embed script URL.

To add a site, edit `data.json` and add to the `sites` array:
```json
{ "id": "pilchard", "name": "Pilchard Properties", "domain": "pilchardproperties.com" }
```

Then embed:
```html
<script src="https://analytics.yourdomain.com/tracklight.js?id=pilchard" async></script>
```

---

## Privacy

- No cookies by default — uses `localStorage` for anonymous visitor ID only
- No personal data collected
- All data stored on your own server in `data.json`
- No third-party requests
- GDPR-friendly out of the box

---

Built by Herank SEO Agency.
