const { Low } = require('lowdb');
const { JSONFile } = require('lowdb/node');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const adapter = new JSONFile(path.join(__dirname, 'data.json'));
const db = new Low(adapter, {
  sites: [],
  events: [],
  sessions: [],
  annotations: [],
  heatmap: [],
  heatmapScreenshots: []
});

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await db.read();
  db.data ||= {};
  ensureCollections();
  // Do NOT auto-seed. Start clean. User must add sites manually.
  if (!db.data.sites.length) {
    db.data.sites.push({
      id: 'demo',
      name: 'Demo (sample data)',
      domain: 'example.com',
      createdAt: new Date().toISOString()
    });
  }
  await db.write();
}

function ensureCollections() {
  db.data.sites ||= [];
  db.data.events ||= [];
  db.data.sessions ||= [];
  db.data.annotations ||= [];
  db.data.heatmap ||= [];
  db.data.heatmapScreenshots ||= [];
}

function normalizePage(url) {
  if (!url) return '/';
  let value = String(url).trim();
  try {
    if (/^https?:\/\//i.test(value)) value = new URL(value).pathname;
  } catch (e) {
    value = value.replace(/^https?:\/\/[^/]+/i, '');
  }
  value = value.replace(/^https?:\/\/[^/]+/i, '').split('?')[0].split('#')[0];
  if (!value || value[0] !== '/') value = '/' + value.replace(/^\/+/, '');
  return value || '/';
}

// ── Site management ─────────────────────────────────────────────────────────
async function addSite({ id, name, domain }) {
  await db.read();
  ensureCollections();
  const cleanId = (id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!cleanId) throw new Error('Site ID required (letters/numbers/dash/underscore only)');
  if (db.data.sites.find(s => s.id === cleanId)) {
    throw new Error('A site with this ID already exists');
  }
  const site = {
    id: cleanId,
    name: name || cleanId,
    domain: (domain || '').replace(/^https?:\/\//, '').replace(/\/$/, ''),
    createdAt: new Date().toISOString()
  };
  db.data.sites.push(site);
  await db.write();
  return site;
}

async function deleteSite(siteId) {
  await db.read();
  ensureCollections();
  db.data.sites = db.data.sites.filter(s => s.id !== siteId);
  db.data.events = db.data.events.filter(e => e.siteId !== siteId);
  db.data.sessions = db.data.sessions.filter(s => s.siteId !== siteId);
  db.data.heatmap = db.data.heatmap.filter(h => h.siteId !== siteId);
  db.data.heatmapScreenshots = db.data.heatmapScreenshots.filter(h => h.siteId !== siteId);
  db.data.annotations = db.data.annotations.filter(a => a.siteId !== siteId);
  await db.write();
}

async function getSites() {
  await db.read();
  ensureCollections();
  return db.data.sites;
}

// ── Event tracking ──────────────────────────────────────────────────────────
async function trackEvent(payload, options = {}) {
  if (!options.batch) {
    await db.read();
    ensureCollections();
  }
  const ts = options.ts || payload.ts || new Date().toISOString();
  const siteId = payload.siteId || 'demo';
  const sessionId = payload.sessionId || uuidv4();
  const visitorId = payload.visitorId || sessionId;
  const event = {
    id: uuidv4(),
    siteId,
    type: payload.type,
    url: payload.url || '',
    page: normalizePage(payload.url),
    referrer: payload.referrer || '',
    userAgent: payload.userAgent || '',
    sessionId,
    visitorId,
    country: payload.country || 'Unknown',
    city: payload.city || 'Unknown',
    duration: payload.duration || 0,
    scrollDepth: payload.scrollDepth || 0,
    meta: payload.meta || {},
    ts
  };
  db.data.events.push(event);
  upsertSession({ ...payload, siteId, sessionId, visitorId }, ts);
  if (!options.batch) await db.write();
  return event;
}

async function trackHeatmap(payload, options = {}) {
  if (!options.batch) {
    await db.read();
    ensureCollections();
  }
  const x = Math.max(0, Math.min(100, Number(payload.x) || 0));
  const y = Math.max(0, Math.min(100, Number(payload.y) || 0));
  db.data.heatmap.push({
    id: uuidv4(),
    siteId: payload.siteId || 'demo',
    url: payload.url || '',
    page: normalizePage(payload.url),
    x,
    y,
    type: payload.type || 'click',
    ts: options.ts || new Date().toISOString()
  });
  if (!options.batch) await db.write();
}

// Expose lowdb read/write so the seeder can batch many writes
async function _read() { await db.read(); ensureCollections(); }
async function _write() { await db.write(); }

function upsertSession(payload, ts) {
  const existing = db.data.sessions.find(s => s.id === payload.sessionId);
  if (existing) {
    if (payload.type === 'pageview') existing.pageCount = (existing.pageCount || 1) + 1;
    existing.lastSeen = ts;
    existing.lastPage = payload.url || existing.lastPage;
    if (payload.duration) existing.duration = Math.max(existing.duration || 0, payload.duration);
    if (payload.scrollDepth) existing.scrollDepth = Math.max(existing.scrollDepth || 0, payload.scrollDepth);
    if (payload.type === 'conversion' || payload.type === 'form_complete') existing.converted = true;
    if (payload.type === 'rage_click' || payload.rageClick) existing.rageClick = true;
  } else {
    db.data.sessions.push({
      id: payload.sessionId,
      siteId: payload.siteId || 'demo',
      visitorId: payload.visitorId,
      startPage: payload.url || '',
      lastPage: payload.url || '',
      pageCount: payload.type === 'pageview' ? 1 : 0,
      duration: payload.duration || 0,
      scrollDepth: payload.scrollDepth || 0,
      converted: payload.type === 'conversion' || payload.type === 'form_complete',
      rageClick: payload.type === 'rage_click' || !!payload.rageClick,
      referrer: payload.referrer || '',
      userAgent: payload.userAgent || '',
      country: payload.country || 'Unknown',
      city: payload.city || 'Unknown',
      startedAt: ts,
      lastSeen: ts
    });
  }
}

// ── Annotations ─────────────────────────────────────────────────────────────
async function addAnnotation(data) {
  await db.read();
  ensureCollections();
  const ann = {
    id: uuidv4(),
    siteId: data.siteId || 'demo',
    text: data.text || '',
    color: data.color || 'blue',
    date: data.date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };
  db.data.annotations.push(ann);
  await db.write();
  return ann;
}

async function getAnnotations(siteId) {
  await db.read();
  ensureCollections();
  return (db.data.annotations || []).filter(a => a.siteId === siteId);
}

async function deleteAnnotation(id) {
  await db.read();
  ensureCollections();
  db.data.annotations = (db.data.annotations || []).filter(a => a.id !== id);
  await db.write();
}

// ── Source classifier ───────────────────────────────────────────────────────
function classifySource(referrer) {
  if (!referrer) return 'Direct';
  const r = referrer.toLowerCase();
  // AI / LLM referrals — checked first so they take priority over generic "search"
  if (r.includes('chatgpt.com') || r.includes('chat.openai.com')) return 'AI: ChatGPT';
  if (r.includes('claude.ai')) return 'AI: Claude';
  if (r.includes('perplexity.ai')) return 'AI: Perplexity';
  if (r.includes('gemini.google.com') || r.includes('bard.google.com')) return 'AI: Gemini';
  if (r.includes('copilot.microsoft.com') || r.includes('bing.com/chat')) return 'AI: Copilot';
  if (r.includes('you.com')) return 'AI: You.com';
  if (r.includes('phind.com')) return 'AI: Phind';
  if (r.includes('deepseek.com')) return 'AI: DeepSeek';
  if (r.includes('poe.com')) return 'AI: Poe';
  if (r.includes('grok.com') || r.includes('grok.x.ai')) return 'AI: Grok';
  if (r.includes('google.') || r.includes('bing.') || r.includes('yahoo.') ||
      r.includes('duckduckgo.') || r.includes('ecosia.') || r.includes('yandex.')) return 'Organic';
  if (r.includes('facebook.') || r.includes('instagram.') || r.includes('twitter.') ||
      r.includes('x.com') || r.includes('linkedin.') || r.includes('tiktok.') ||
      r.includes('youtube.') || r.includes('reddit.') || r.includes('pinterest.')) return 'Social';
  if (r.includes('mail.') || r.includes('outlook.') || r.includes('gmail.')) return 'Email';
  return 'Referral';
}

// ── Stats: main dashboard ───────────────────────────────────────────────────
async function getStats(siteId, days) {
  await db.read();
  ensureCollections();
  const sinceMs = Date.now() - (days || 30) * 86400000;
  const todayKey = new Date().toISOString().split('T')[0];

  const events = db.data.events.filter(e =>
    e.siteId === siteId && new Date(e.ts).getTime() >= sinceMs
  );
  const sessions = db.data.sessions.filter(s =>
    s.siteId === siteId && new Date(s.startedAt).getTime() >= sinceMs
  );

  const pageviews = events.filter(e => e.type === 'pageview');
  const uniqueVisitors = new Set(events.map(e => e.visitorId).filter(Boolean)).size;
  const conversions = sessions.filter(s => s.converted).length;
  const rageSessions = sessions.filter(s => s.rageClick).length;
  const bounced = sessions.filter(s => (s.pageCount || 0) <= 1).length;
  const bounceRate = sessions.length ? Math.round((bounced / sessions.length) * 100) : 0;

  // Today's real visitors (not total/30)
  const todayVisitors = new Set(
    events.filter(e => e.ts.startsWith(todayKey)).map(e => e.visitorId).filter(Boolean)
  ).size;
  const todayPageviews = pageviews.filter(e => e.ts.startsWith(todayKey)).length;

  // Daily breakdown
  const dailyMap = {};
  pageviews.forEach(e => {
    const day = e.ts.split('T')[0];
    dailyMap[day] = (dailyMap[day] || 0) + 1;
  });
  const daily = [];
  for (let i = (days || 30) - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    daily.push({ date: key, visitors: dailyMap[key] || 0 });
  }

  // Top pages (normalize path)
  const pageMap = {};
  pageviews.forEach(e => {
    const p = e.page || normalizePage(e.url);
    pageMap[p] = (pageMap[p] || 0) + 1;
  });
  const topPages = Object.entries(pageMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([page, views]) => ({ page, views }));

  // Sources
  const srcMap = {};
  sessions.forEach(s => {
    const src = classifySource(s.referrer);
    srcMap[src] = (srcMap[src] || 0) + 1;
  });

  // Funnel
  const formStarts = events.filter(e => e.type === 'form_start').length;
  const formCompletes = events.filter(e => e.type === 'form_complete').length;

  // Countries / cities
  const countryMap = {};
  sessions.forEach(s => {
    const c = s.country || 'Unknown';
    countryMap[c] = (countryMap[c] || 0) + 1;
  });
  const topCountries = Object.entries(countryMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([country, count]) => ({ country, count }));

  return {
    visitors: uniqueVisitors,
    sessions: sessions.length,
    pageviews: pageviews.length,
    bounceRate,
    conversions,
    rageSessions,
    todayVisitors,
    todayPageviews,
    conversionRate: sessions.length ? +((conversions / sessions.length) * 100).toFixed(2) : 0,
    avgDuration: sessions.length
      ? Math.round(sessions.reduce((a, s) => a + (s.duration || 0), 0) / sessions.length)
      : 0,
    avgScrollDepth: sessions.length
      ? Math.round(sessions.reduce((a, s) => a + (s.scrollDepth || 0), 0) / sessions.length)
      : 0,
    daily,
    topPages,
    sources: srcMap,
    funnel: {
      sessions: sessions.length,
      pageviews: pageviews.length,
      formStarts,
      formCompletes,
      conversions
    },
    topCountries,
    recentSessions: sessions
      .slice()
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 20)
  };
}

// ── Real-time stats ─────────────────────────────────────────────────────────
async function getRealtime(siteId) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const fiveMinAgo = now - 5 * 60 * 1000;
  const twentyMinAgo = now - 20 * 60 * 1000;

  const recentEvents = db.data.events.filter(e =>
    e.siteId === siteId && new Date(e.ts).getTime() >= twentyMinAgo
  );

  // Online = unique visitors with an event in the last 5 minutes
  const online = new Set(
    recentEvents
      .filter(e => new Date(e.ts).getTime() >= fiveMinAgo)
      .map(e => e.visitorId)
      .filter(Boolean)
  ).size;

  // Pageviews per minute, last 20 minutes
  const buckets = Array(20).fill(0);
  recentEvents.forEach(e => {
    if (e.type !== 'pageview') return;
    const ageMin = Math.floor((now - new Date(e.ts).getTime()) / 60000);
    if (ageMin >= 0 && ageMin < 20) buckets[19 - ageMin]++;
  });

  // Active pages right now (last 5 min)
  const pageMap = {};
  recentEvents.filter(e => new Date(e.ts).getTime() >= fiveMinAgo && e.type === 'pageview')
    .forEach(e => {
      const p = e.page || normalizePage(e.url);
      pageMap[p] = (pageMap[p] || 0) + 1;
    });
  const activePages = Object.entries(pageMap)
    .sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([page, views]) => ({ page, views }));

  return { online, perMinute: buckets, activePages };
}

// ── Heatmap ─────────────────────────────────────────────────────────────────
async function getHeatmap(siteId, url) {
  await db.read();
  ensureCollections();
  const page = url ? normalizePage(url) : null;
  return db.data.heatmap.filter(h =>
    h.siteId === siteId && (!page || (h.page || normalizePage(h.url)) === page)
  );
}

async function getHeatmapPages(siteId) {
  await db.read();
  ensureCollections();
  const map = {};
  db.data.heatmap
    .filter(h => h.siteId === siteId)
    .forEach(h => {
      const u = h.page || normalizePage(h.url);
      map[u] = (map[u] || 0) + 1;
    });
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([page, clicks]) => ({ page, clicks }));
}

async function getHeatmapScreenshot(siteId, url) {
  await db.read();
  ensureCollections();
  const page = normalizePage(url);
  const shot = db.data.heatmapScreenshots.find(s => s.siteId === siteId && s.page === page);
  return shot || null;
}

async function setHeatmapScreenshot({ siteId, url, imageData }) {
  await db.read();
  ensureCollections();
  const page = normalizePage(url);
  if (!siteId) throw new Error('siteId required');
  if (!imageData || !/^data:image\/(png|jpeg|jpg|webp);base64,/i.test(imageData)) {
    throw new Error('A PNG, JPG, or WebP screenshot is required');
  }
  if (imageData.length > 2500000) {
    throw new Error('Screenshot is too large. Please upload an image under 2.5 MB.');
  }
  db.data.heatmapScreenshots = db.data.heatmapScreenshots.filter(s => !(s.siteId === siteId && s.page === page));
  const shot = {
    id: uuidv4(),
    siteId,
    page,
    imageData,
    updatedAt: new Date().toISOString()
  };
  db.data.heatmapScreenshots.push(shot);
  await db.write();
  return { id: shot.id, siteId, page, updatedAt: shot.updatedAt };
}

// ── Maintenance ─────────────────────────────────────────────────────────────
async function resetSiteData(siteId) {
  await db.read();
  ensureCollections();
  db.data.events = db.data.events.filter(e => e.siteId !== siteId);
  db.data.sessions = db.data.sessions.filter(s => s.siteId !== siteId);
  db.data.heatmap = db.data.heatmap.filter(h => h.siteId !== siteId);
  db.data.heatmapScreenshots = db.data.heatmapScreenshots.filter(h => h.siteId !== siteId);
  db.data.annotations = db.data.annotations.filter(a => a.siteId !== siteId);
  await db.write();
}

// ── Site health enrichment (additive) ────────────────────────────────────
// Returns each input site with extra fields: lastEvent, eventCount24h,
// formStarts24h, formCompletes24h, status. Original fields are preserved.
async function getSitesWithHealth(sites) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  return sites.map(s => {
    const siteEvents = (db.data.events || []).filter(e => e.siteId === s.id);
    const last24 = siteEvents.filter(e => now - new Date(e.ts).getTime() < day);
    const lastEventTs = siteEvents.length
      ? siteEvents.reduce((a, e) => Math.max(a, new Date(e.ts).getTime()), 0)
      : null;
    const formStarts24h = last24.filter(e => e.type === 'form_start').length;
    const formCompletes24h = last24.filter(e => e.type === 'form_complete').length;
    const hoursSinceLast = lastEventTs ? (now - lastEventTs) / 3600000 : null;

    // Health status logic
    let status = 'idle';
    if (lastEventTs && hoursSinceLast < 48) status = 'healthy';
    if (formStarts24h >= 3 && formCompletes24h === 0) status = 'warning'; // form bug
    if (hoursSinceLast !== null && hoursSinceLast > 48) status = 'idle'; // no recent data

    return {
      ...s,
      lastEvent: lastEventTs ? new Date(lastEventTs).toISOString() : null,
      eventCount24h: last24.length,
      formStarts24h,
      formCompletes24h,
      status,
    };
  });
}

// ── Page gainers / losers (week over week) ──────────────────────────────
async function getPageMovers(siteId) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const week = 7 * 24 * 3600 * 1000;
  const events = (db.data.events || []).filter(e => e.siteId === siteId && e.type === 'pageview');

  const thisWeek = {};
  const lastWeek = {};
  events.forEach(e => {
    const age = now - new Date(e.ts).getTime();
    const page = e.page || normalizePage(e.url);
    if (age < week) thisWeek[page] = (thisWeek[page] || 0) + 1;
    else if (age < 2 * week) lastWeek[page] = (lastWeek[page] || 0) + 1;
  });

  const allPages = new Set([...Object.keys(thisWeek), ...Object.keys(lastWeek)]);
  const movers = [];
  allPages.forEach(p => {
    const t = thisWeek[p] || 0;
    const l = lastWeek[p] || 0;
    const change = t - l;
    if (t + l >= 5) { // ignore noise
      const changePct = l > 0 ? Math.round((change / l) * 100) : null;
      movers.push({ page: p, thisWeek: t, lastWeek: l, change, changePct });
    }
  });

  return {
    gainers: movers.filter(m => m.change > 0).sort((a, b) => b.change - a.change).slice(0, 10),
    losers: movers.filter(m => m.change < 0).sort((a, b) => a.change - b.change).slice(0, 10),
  };
}

module.exports = {
  init, trackEvent, trackHeatmap, addAnnotation, deleteAnnotation,
  getStats, getRealtime, getHeatmap, getHeatmapPages,
  getHeatmapScreenshot, setHeatmapScreenshot,
  getAnnotations, getSites, addSite, deleteSite, resetSiteData,
  getSitesWithHealth, getPageMovers,
  _read, _write
};
