const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Tracking endpoints ──────────────────────────────────────────────────────

// Main event collector — called by the embed script
app.post('/api/collect', async (req, res) => {
  try {
    const ua = req.headers['user-agent'] || '';
    const payload = { ...req.body, userAgent: ua };
    const event = await db.trackEvent(payload);
    res.json({ ok: true, id: event.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Heatmap click/move collector
app.post('/api/heatmap', async (req, res) => {
  try {
    await db.trackHeatmap(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false });
  }
});

// ── Dashboard API ───────────────────────────────────────────────────────────

app.get('/api/stats', async (req, res) => {
  const siteId = req.query.siteId || 'demo';
  const days = parseInt(req.query.days) || 30;
  const stats = await db.getStats(siteId, days);
  res.json(stats);
});

app.get('/api/heatmap', async (req, res) => {
  const data = await db.getHeatmap(req.query.siteId || 'demo', req.query.url);
  res.json(data);
});

app.get('/api/annotations', async (req, res) => {
  const data = await db.getAnnotations(req.query.siteId || 'demo');
  res.json(data);
});

app.post('/api/annotations', async (req, res) => {
  const ann = await db.addAnnotation({ ...req.body, siteId: req.body.siteId || 'demo' });
  res.json(ann);
});

app.get('/api/sites', async (req, res) => {
  const sites = await db.getSites();
  res.json(sites);
});

// Seed demo data so dashboard has something to show immediately
app.post('/api/seed', async (req, res) => {
  const { v4: uuidv4 } = require('uuid');
  const now = Date.now();
  const pages = ['/', '/about', '/contact', '/home-valuation', '/blog/marysville-guide', '/neighborhoods/snohomish', '/sellers-guide', '/buyers-guide'];
  const cities = ['Seattle', 'Everett', 'Marysville', 'Monroe', 'Snohomish', 'Lynnwood'];
  const refs = ['', '', '', 'https://google.com', 'https://google.com', 'https://google.com', 'https://facebook.com', 'https://instagram.com'];

  for (let day = 29; day >= 0; day--) {
    const visitCount = Math.floor(80 + Math.random() * 100 + (29 - day) * 2.5);
    for (let v = 0; v < visitCount; v++) {
      const visitorId = uuidv4();
      const sessionId = uuidv4();
      const ts = new Date(now - day * 86400000 - Math.random() * 86400000);
      const page = pages[Math.floor(Math.random() * pages.length)];
      const ref = refs[Math.floor(Math.random() * refs.length)];
      const city = cities[Math.floor(Math.random() * cities.length)];
      const pageCount = Math.floor(1 + Math.random() * 5);
      const duration = Math.floor(10 + Math.random() * 400);
      const scrollDepth = Math.floor(20 + Math.random() * 80);
      const converted = Math.random() < 0.004;
      const rageClick = !converted && Math.random() < 0.05;

      await db.trackEvent({
        siteId: 'demo', type: 'pageview', url: 'https://yourdomain.com' + page,
        referrer: ref, sessionId, visitorId, city, country: 'US',
        duration, scrollDepth, meta: {}
      });

      if (pageCount > 2 && Math.random() > 0.7) {
        await db.trackEvent({
          siteId: 'demo', type: 'form_start', url: 'https://yourdomain.com/contact',
          referrer: ref, sessionId, visitorId, city, country: 'US', meta: {}
        });
      }

      if (converted) {
        await db.trackEvent({
          siteId: 'demo', type: 'form_complete', url: 'https://yourdomain.com/contact',
          referrer: ref, sessionId, visitorId, city, country: 'US', meta: {}
        });
        await db.trackEvent({
          siteId: 'demo', type: 'conversion', url: 'https://yourdomain.com/contact',
          referrer: ref, sessionId, visitorId, city, country: 'US', meta: {}
        });
      }

      // Heatmap
      if (Math.random() > 0.6) {
        await db.trackHeatmap({
          siteId: 'demo', url: 'https://yourdomain.com/contact',
          x: Math.round(20 + Math.random() * 60),
          y: Math.round(10 + Math.random() * 80),
          type: 'click'
        });
      }
    }
  }

  // Seed annotations
  const existing = await db.getAnnotations('demo');
  if (!existing.length) {
    await db.addAnnotation({ siteId: 'demo', text: 'Published first blog post', color: 'blue', date: new Date(now - 20 * 86400000).toISOString().split('T')[0] });
    await db.addAnnotation({ siteId: 'demo', text: 'Fixed homepage CTA button', color: 'green', date: new Date(now - 10 * 86400000).toISOString().split('T')[0] });
    await db.addAnnotation({ siteId: 'demo', text: 'Instagram post went viral', color: 'amber', date: new Date(now - 7 * 86400000).toISOString().split('T')[0] });
  }

  res.json({ ok: true });
});

// ── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3747;

db.init().then(() => {
  app.listen(PORT, () => {
    console.log(`TrackLight running on http://localhost:${PORT}`);
  });
});
