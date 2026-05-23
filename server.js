// server.js — TrackLight v2
// Express server with admin auth, share-link auth for client views,
// and all endpoints needed by the dashboard.

const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3747;

// ---------- CONFIG ----------
const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-railway-env';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
// Note: if you don't set ADMIN_PASSWORD via Railway env, the password is "admin123"
// — change it before going live.

// ---------- MIDDLEWARE ----------
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(cookieParser());

// Trust Railway proxy so secure cookies work
app.set('trust proxy', 1);

// ---------- AUTH HELPERS ----------
function issueToken(res) {
  const token = jwt.sign({ admin: true }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('tl_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 86400000,
  });
  return token;
}

function isAuthed(req) {
  const t = req.cookies?.tl_token;
  if (!t) return false;
  try { jwt.verify(t, JWT_SECRET); return true; } catch { return false; }
}

function requireAdmin(req, res, next) {
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// Share-link OR admin auth: allows public read-only access via ?token=
async function requireReadAccess(req, res, next) {
  if (isAuthed(req)) return next();
  const token = req.query.token || req.headers['x-share-token'];
  if (token) {
    const link = await db.getShareLink(token);
    if (link) {
      // Enforce that the request is for that site only
      const askedSite = req.query.siteId || req.params.siteId;
      if (!askedSite || askedSite === link.site_id) {
        req.shareLink = link;
        return next();
      }
    }
  }
  res.status(401).json({ error: 'unauthorized' });
}

// ============================================================
// AUTH ROUTES
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  const { password } = req.body || {};
  if (!password) return res.status(400).json({ error: 'password required' });
  // Plain compare — keep simple. For prod, hash and store in env-set bcrypt hash.
  const ok = password === ADMIN_PASSWORD;
  if (!ok) return res.status(401).json({ error: 'invalid password' });
  issueToken(res);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('tl_token');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  res.json({ authed: isAuthed(req) });
});

// ============================================================
// TRACKING ENDPOINTS (public — anyone can POST events to their site)
// ============================================================
app.post('/api/track', async (req, res) => {
  try {
    const { siteId, visitorId, sessionId, event, page, referrer, country, device, browser, duration, scrollDepth, meta } = req.body || {};
    if (!siteId || !event) return res.status(400).json({ error: 'siteId and event required' });
    await db.trackEvent({ siteId, visitorId, sessionId, event, page, referrer, country, device, browser, duration, scrollDepth, meta });
    res.json({ ok: true });
  } catch (e) {
    console.error('[track]', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/heatmap', async (req, res) => {
  try {
    const { siteId, page, clicks } = req.body || {};
    if (!siteId || !page || !Array.isArray(clicks)) return res.status(400).json({ error: 'siteId, page, clicks[] required' });
    // batch insert
    for (const c of clicks.slice(0, 100)) {
      await db.trackHeatmap({ siteId, page, x: c.x, y: c.y, vw: c.vw, vh: c.vh });
    }
    res.json({ ok: true, stored: Math.min(clicks.length, 100) });
  } catch (e) {
    console.error('[heatmap]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// READ ENDPOINTS (admin OR share-link)
// ============================================================
app.get('/api/sites', requireAdmin, async (req, res) => {
  res.json(await db.listSites());
});

app.get('/api/overview', requireAdmin, async (req, res) => {
  res.json(await db.getAgencyOverview());
});

app.get('/api/stats', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  const days = Number(req.query.days) || 30;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getStats(siteId, days));
});

app.get('/api/realtime', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getRealtime(siteId));
});

app.get('/api/ai-traffic', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  const days = Number(req.query.days) || 30;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getAITraffic(siteId, days));
});

app.get('/api/page-movers', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getPageMovers(siteId));
});

app.get('/api/health-score', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getHealthScore(siteId));
});

app.get('/api/heatmap', requireReadAccess, async (req, res) => {
  const { siteId, page } = req.query;
  if (!siteId || !page) return res.status(400).json({ error: 'siteId and page required' });
  res.json(await db.getHeatmap(siteId, page));
});

app.get('/api/heatmap/pages', requireReadAccess, async (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.getHeatmapPages(siteId));
});

// ============================================================
// ADMIN-ONLY WRITE ENDPOINTS
// ============================================================
app.post('/api/sites', requireAdmin, async (req, res) => {
  try {
    const { id, name, domain } = req.body || {};
    const site = await db.addSite({ id, name, domain });
    res.json(site);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/sites/:id', requireAdmin, async (req, res) => {
  await db.deleteSite(req.params.id);
  res.json({ ok: true });
});

app.post('/api/sites/:id/reset', requireAdmin, async (req, res) => {
  await db.resetSiteData(req.params.id);
  res.json({ ok: true });
});

// Annotations
app.get('/api/annotations', requireReadAccess, async (req, res) => {
  res.json(await db.listAnnotations(req.query.siteId));
});

app.post('/api/annotations', requireAdmin, async (req, res) => {
  const { siteId, date, text } = req.body || {};
  if (!siteId || !date || !text) return res.status(400).json({ error: 'siteId, date, text required' });
  res.json(await db.addAnnotation({ siteId, date, text }));
});

app.delete('/api/annotations/:id', requireAdmin, async (req, res) => {
  await db.deleteAnnotation(req.params.id);
  res.json({ ok: true });
});

// Alerts
app.get('/api/alerts', requireAdmin, async (req, res) => {
  res.json(await db.listAlerts());
});

app.post('/api/alerts', requireAdmin, async (req, res) => {
  const { siteId, name, ruleType, threshold, windowHours } = req.body || {};
  if (!name || !ruleType) return res.status(400).json({ error: 'name and ruleType required' });
  res.json(await db.addAlert({ siteId, name, ruleType, threshold, windowHours }));
});

app.delete('/api/alerts/:id', requireAdmin, async (req, res) => {
  await db.deleteAlert(req.params.id);
  res.json({ ok: true });
});

app.post('/api/alerts/:id/toggle', requireAdmin, async (req, res) => {
  await db.toggleAlert(req.params.id, !!req.body.enabled);
  res.json({ ok: true });
});

app.get('/api/alert-history', requireAdmin, async (req, res) => {
  res.json(await db.getAlertHistory(50));
});

app.post('/api/alert-history/:id/ack', requireAdmin, async (req, res) => {
  await db.ackAlert(req.params.id);
  res.json({ ok: true });
});

app.post('/api/alerts/evaluate', requireAdmin, async (req, res) => {
  const fired = await db.evaluateAlerts();
  res.json({ ok: true, fired });
});

// Resolve a share token to its site (used by the public report view)
app.get('/api/share-info', async (req, res) => {
  const token = req.query.token;
  if (!token) return res.status(400).json({ error: 'token required' });
  const link = await db.getShareLink(token);
  if (!link) return res.status(404).json({ error: 'invalid or expired' });
  const sites = await db.listSites();
  const site = sites.find(s => s.id === link.site_id);
  res.json({ siteId: link.site_id, siteName: site?.name || link.site_id });
});

// Share links
app.get('/api/share-links', requireAdmin, async (req, res) => {
  const siteId = req.query.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.listShareLinks(siteId));
});

app.post('/api/share-links', requireAdmin, async (req, res) => {
  const { siteId, expiresInDays } = req.body || {};
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  res.json(await db.createShareLink(siteId, expiresInDays || 90));
});

app.delete('/api/share-links/:token', requireAdmin, async (req, res) => {
  await db.deleteShareLink(req.params.token);
  res.json({ ok: true });
});

// ============================================================
// DEMO SEEDER — only for the 'demo' site, never auto-runs
// ============================================================
app.post('/api/seed-demo', requireAdmin, async (req, res) => {
  try {
    const start = Date.now();
    try { await db.addSite({ id: 'demo', name: 'Demo (sample data)', domain: 'example.com' }); } catch {}
    await db.resetSiteData('demo');

    const pages = ['/', '/pricing', '/features', '/blog', '/contact', '/about', '/signup', '/blog/seo-guide', '/blog/ai-search'];
    const referrers = [
      null, null, null,
      'https://www.google.com/search?q=tracklight', 'https://www.google.com/search?q=analytics',
      'https://chatgpt.com/c/abc', 'https://chatgpt.com/share/xyz',
      'https://www.perplexity.ai/search/analytics', 'https://claude.ai/share/abc',
      'https://gemini.google.com/app',
      'https://www.facebook.com/', 'https://www.linkedin.com/feed/', 'https://twitter.com/home',
      'https://news.ycombinator.com/',
    ];
    const countries = ['United States', 'United Kingdom', 'India', 'Pakistan', 'Canada', 'Germany', 'Australia'];
    const devices = ['Desktop', 'Mobile', 'Tablet'];
    const browsers = ['Chrome', 'Safari', 'Firefox', 'Edge'];

    const now = new Date();
    const events = [];
    let totalVisitors = 0;

    for (let dayBack = 30; dayBack >= 0; dayBack--) {
      const trend = 70 + Math.round((30 - dayBack) * 6);
      const visitorsToday = Math.max(20, trend + Math.floor((Math.random() - 0.5) * 40));

      for (let v = 0; v < visitorsToday; v++) {
        const visitorId = `v_${dayBack}_${v}_${Math.random().toString(36).slice(2, 8)}`;
        const sessionId = `s_${dayBack}_${v}_${Math.random().toString(36).slice(2, 8)}`;

        const aiShare = 0.01 + ((30 - dayBack) / 30) * 0.17;
        const useAI = Math.random() < aiShare;
        const refIdx = useAI
          ? 5 + Math.floor(Math.random() * 5)
          : Math.floor(Math.random() * referrers.length);
        const referrer = referrers[refIdx];
        const country = countries[Math.floor(Math.random() * countries.length)];
        const device = devices[Math.floor(Math.random() * devices.length)];
        const browser = browsers[Math.floor(Math.random() * browsers.length)];

        const pvCount = 1 + Math.floor(Math.random() * 5);
        for (let p = 0; p < pvCount; p++) {
          const page = pages[Math.floor(Math.random() * pages.length)];
          const ts = new Date(now);
          ts.setDate(ts.getDate() - dayBack);
          ts.setHours(Math.floor(Math.random() * 24), Math.floor(Math.random() * 60));
          const tsISO = ts.toISOString();

          events.push({
            siteId: 'demo', visitorId, sessionId, event: 'pageview',
            page, referrer, country, device, browser, ts: tsISO,
          });

          if ((page === '/signup' || page === '/contact') && Math.random() < 0.15) {
            events.push({
              siteId: 'demo', visitorId, sessionId, event: 'form_start',
              page, referrer, country, device, browser, ts: tsISO,
            });
            if (Math.random() < 0.08) {
              events.push({
                siteId: 'demo', visitorId, sessionId, event: 'form_complete',
                page, referrer, country, device, browser, ts: tsISO,
              });
              events.push({
                siteId: 'demo', visitorId, sessionId, event: 'conversion',
                page, referrer, country, device, browser, ts: tsISO,
              });
            }
          }

          if (Math.random() < 0.8) {
            events.push({
              siteId: 'demo', visitorId, sessionId, event: 'pageleave',
              page, referrer, country, device, browser,
              duration: 10 + Math.floor(Math.random() * 180),
              scrollDepth: Math.floor(Math.random() * 100),
              ts: tsISO,
            });
          }
        }
        totalVisitors++;
      }
    }

    // Bulk-insert in chunks of 500 to keep Postgres parameter count under limit
    const CHUNK = 500;
    for (let i = 0; i < events.length; i += CHUNK) {
      await db.trackEventsBulk(events.slice(i, i + CHUNK));
    }

    res.json({
      ok: true,
      message: 'Demo data seeded',
      stats: { visitors: totalVisitors, events: events.length, ms: Date.now() - start },
    });
  } catch (e) {
    console.error('[seed-demo]', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// PUBLIC HEALTH CHECK
// ============================================================
app.get('/api/health', (req, res) => {
  res.json({ ok: true, pg: db.USE_PG, ts: new Date().toISOString() });
});

// ============================================================
// STATIC FILES
// ============================================================
app.use(express.static(path.join(__dirname, 'public')));

// Catch-all for SPA-style routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ============================================================
// ALERT EVALUATION LOOP (every 15 min)
// ============================================================
async function startAlertLoop() {
  setInterval(async () => {
    try {
      const fired = await db.evaluateAlerts();
      if (fired.length > 0) console.log(`[alerts] Fired ${fired.length} alerts`);
    } catch (e) { console.error('[alerts]', e.message); }
  }, 15 * 60 * 1000);
}

// ============================================================
// STARTUP
// ============================================================
(async () => {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`TrackLight v2 running on port ${PORT}`);
      console.log(`Storage: ${db.USE_PG ? 'Postgres' : 'in-memory (data will be lost on restart)'}`);
      console.log(`Admin password: ${ADMIN_PASSWORD === 'admin123' ? '⚠️  default "admin123" — set ADMIN_PASSWORD env var' : 'set via env'}`);
    });
    startAlertLoop();
  } catch (e) {
    console.error('[startup]', e);
    process.exit(1);
  }
})();
