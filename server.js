const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Tracking endpoints (called by the embed script) ─────────────────────────
app.post('/api/collect', async (req, res) => {
  try {
    const ua = req.headers['user-agent'] || '';
    const payload = { ...req.body, userAgent: ua };
    const event = await db.trackEvent(payload);
    res.json({ ok: true, id: event.id });
  } catch (e) {
    console.error('collect error:', e.message);
    res.status(500).json({ ok: false });
  }
});

app.post('/api/heatmap', async (req, res) => {
  try {
    await db.trackHeatmap(req.body);
    res.json({ ok: true });
  } catch (e) {
    console.error('heatmap error:', e.message);
    res.status(500).json({ ok: false });
  }
});

// ── Dashboard data endpoints ────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const siteId = req.query.siteId || 'demo';
    const days = parseInt(req.query.days) || 30;
    const stats = await db.getStats(siteId, days);
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/realtime', async (req, res) => {
  try {
    const siteId = req.query.siteId || 'demo';
    const data = await db.getRealtime(siteId);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/heatmap', async (req, res) => {
  const data = await db.getHeatmap(req.query.siteId || 'demo', req.query.url);
  res.json(data);
});

app.get('/api/heatmap/pages', async (req, res) => {
  const pages = await db.getHeatmapPages(req.query.siteId || 'demo');
  res.json(pages);
});

app.get('/api/annotations', async (req, res) => {
  const data = await db.getAnnotations(req.query.siteId || 'demo');
  res.json(data);
});

app.post('/api/annotations', async (req, res) => {
  const ann = await db.addAnnotation({ ...req.body, siteId: req.body.siteId || 'demo' });
  res.json(ann);
});

app.delete('/api/annotations/:id', async (req, res) => {
  await db.deleteAnnotation(req.params.id);
  res.json({ ok: true });
});

// ── Site management ─────────────────────────────────────────────────────────
app.get('/api/sites', async (req, res) => {
  const sites = await db.getSites();
  res.json(sites);
});

app.post('/api/sites', async (req, res) => {
  try {
    const site = await db.addSite(req.body);
    res.json(site);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.delete('/api/sites/:id', async (req, res) => {
  try {
    await db.deleteSite(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Wipe all data for one site (keeps the site itself)
app.post('/api/sites/:id/reset', async (req, res) => {
  try {
    await db.resetSiteData(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Manual seeder (only on demand, NEVER auto) ──────────────────────────────
app.post('/api/seed-demo', async (req, res) => {
  try {
    const { v4: uuidv4 } = require('uuid');
    const SITE = 'demo';

    // Wipe existing demo data so seed is reproducible
    await db.resetSiteData(SITE);

    // Single read into memory, then batch all writes, single flush at the end.
    await db._read();

    const now = Date.now();
    const pages = ['/', '/about', '/contact', '/pricing', '/blog/getting-started', '/blog/case-study', '/features', '/signup'];
    const cities = ['Seattle', 'New York', 'London', 'Karachi', 'Toronto', 'Berlin', 'Sydney'];
    const refs = [
      '', '', '', '',
      'https://google.com/search', 'https://google.com/search', 'https://google.com/',
      'https://facebook.com/', 'https://instagram.com/', 'https://twitter.com/',
      'https://reddit.com/r/seo', 'https://linkedin.com/feed/'
    ];

    for (let day = 29; day >= 0; day--) {
      const base = 60 + Math.floor((29 - day) * 1.8);
      const visitCount = base + Math.floor(Math.random() * 40);

      for (let v = 0; v < visitCount; v++) {
        const visitorId = uuidv4();
        const sessionId = uuidv4();
        const tsBase = now - day * 86400000 - Math.random() * 86400000;
        const ts = new Date(tsBase).toISOString();

        const page = pages[Math.floor(Math.random() * pages.length)];
        const ref = refs[Math.floor(Math.random() * refs.length)];
        const city = cities[Math.floor(Math.random() * cities.length)];
        const pageCount = 1 + Math.floor(Math.random() * 5);
        const duration = 10 + Math.floor(Math.random() * 400);
        const scrollDepth = 20 + Math.floor(Math.random() * 80);
        const converted = Math.random() < 0.012;
        const rageClick = !converted && Math.random() < 0.04;

        await db.trackEvent({
          siteId: SITE, type: 'pageview',
          url: 'https://example.com' + page,
          referrer: ref, sessionId, visitorId, city, country: 'Unknown',
          duration, scrollDepth
        }, { ts, batch: true });

        for (let p = 1; p < pageCount; p++) {
          const p2 = pages[Math.floor(Math.random() * pages.length)];
          const ts2 = new Date(tsBase + p * 60000).toISOString();
          await db.trackEvent({
            siteId: SITE, type: 'pageview',
            url: 'https://example.com' + p2,
            referrer: ref, sessionId, visitorId, city, country: 'Unknown',
            duration, scrollDepth
          }, { ts: ts2, batch: true });
        }

        if (pageCount > 2 && Math.random() > 0.75) {
          await db.trackEvent({
            siteId: SITE, type: 'form_start',
            url: 'https://example.com/contact',
            referrer: ref, sessionId, visitorId, city, country: 'Unknown'
          }, { ts: new Date(tsBase + 120000).toISOString(), batch: true });
        }

        if (converted) {
          await db.trackEvent({
            siteId: SITE, type: 'form_complete',
            url: 'https://example.com/contact',
            referrer: ref, sessionId, visitorId, city, country: 'Unknown'
          }, { ts: new Date(tsBase + 180000).toISOString(), batch: true });
        }

        if (rageClick) {
          await db.trackEvent({
            siteId: SITE, type: 'rage_click',
            url: 'https://example.com' + page,
            referrer: ref, sessionId, visitorId, city, country: 'Unknown',
            rageClick: true
          }, { ts, batch: true });
        }

        if (Math.random() > 0.5) {
          const clickCount = 1 + Math.floor(Math.random() * 3);
          for (let c = 0; c < clickCount; c++) {
            const r = Math.random();
            let x, y;
            if (r < 0.6) { x = 45 + Math.random() * 15; y = 18 + Math.random() * 12; }
            else if (r < 0.8) { x = 30 + Math.random() * 40; y = 40 + Math.random() * 20; }
            else { x = Math.random() * 100; y = Math.random() * 100; }
            await db.trackHeatmap({
              siteId: SITE, url: 'https://example.com/contact',
              x: Math.round(x), y: Math.round(y), type: 'click'
            }, { ts, batch: true });
          }
        }
      }
    }

    // Single flush
    await db._write();

    // Annotations (non-batch is fine — only 3)
    await db.addAnnotation({ siteId: SITE, text: 'Launched new homepage', color: 'blue', date: new Date(now - 20 * 86400000).toISOString().split('T')[0] });
    await db.addAnnotation({ siteId: SITE, text: 'Started Google Ads campaign', color: 'green', date: new Date(now - 10 * 86400000).toISOString().split('T')[0] });
    await db.addAnnotation({ siteId: SITE, text: 'Fixed contact form bug', color: 'amber', date: new Date(now - 4 * 86400000).toISOString().split('T')[0] });

    res.json({ ok: true, message: 'Demo data seeded for site "demo"' });
  } catch (e) {
    console.error('seed error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3747;

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`TrackLight running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to start:', err);
  process.exit(1);
});
