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

function classifyDevice(userAgent) {
  const ua = String(userAgent || '').toLowerCase();
  if (/ipad|tablet|kindle|playbook/.test(ua)) return 'Tablet';
  if (/mobile|iphone|android.*mobile|blackberry|phone/.test(ua)) return 'Mobile';
  if (/bot|crawl|spider|slurp/.test(ua)) return 'Bot';
  return 'Desktop';
}

function isAISource(source) {
  return String(source || '').startsWith('AI:');
}

function periodSummary(siteId, startMs, endMs = Date.now()) {
  const events = (db.data.events || []).filter(e => {
    const t = new Date(e.ts).getTime();
    return e.siteId === siteId && t >= startMs && t < endMs;
  });
  const sessions = (db.data.sessions || []).filter(s => {
    const t = new Date(s.startedAt || s.lastSeen).getTime();
    return s.siteId === siteId && t >= startMs && t < endMs;
  });
  const pageviews = events.filter(e => e.type === 'pageview');
  const formStarts = events.filter(e => e.type === 'form_start').length;
  const formCompletes = events.filter(e => e.type === 'form_complete').length;
  const deadClicks = events.filter(e => e.type === 'dead_click').length;
  const hesitations = events.filter(e => e.type === 'hesitation').length;
  const rageEvents = events.filter(e => e.type === 'rage_click').length;
  const conversions = sessions.filter(s => s.converted).length;
  const visitors = new Set(events.map(e => e.visitorId).filter(Boolean)).size;
  const bounced = sessions.filter(s => (s.pageCount || 0) <= 1).length;
  const aiSessions = sessions.filter(s => isAISource(classifySource(s.referrer)));
  const deviceMap = {};
  sessions.forEach(s => {
    const device = classifyDevice(s.userAgent);
    deviceMap[device] = (deviceMap[device] || 0) + 1;
  });
  const sourceMap = {};
  sessions.forEach(s => {
    const source = classifySource(s.referrer);
    sourceMap[source] = (sourceMap[source] || 0) + 1;
  });
  const pageMap = {};
  pageviews.forEach(e => {
    const page = e.page || normalizePage(e.url);
    pageMap[page] = (pageMap[page] || 0) + 1;
  });
  const heatmapClicks = (db.data.heatmap || []).filter(h => {
    const t = new Date(h.ts).getTime();
    return h.siteId === siteId && t >= startMs && t < endMs;
  }).length;

  return {
    events,
    sessions,
    pageviews,
    visitors,
    sessionCount: sessions.length,
    pageviewCount: pageviews.length,
    conversions,
    conversionRate: sessions.length ? +((conversions / sessions.length) * 100).toFixed(2) : 0,
    bounceRate: sessions.length ? Math.round((bounced / sessions.length) * 100) : 0,
    avgDuration: sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.duration || 0), 0) / sessions.length) : 0,
    avgScrollDepth: sessions.length ? Math.round(sessions.reduce((a, s) => a + (s.scrollDepth || 0), 0) / sessions.length) : 0,
    formStarts,
    formCompletes,
    deadClicks,
    hesitations,
    rageEvents,
    rageSessions: sessions.filter(s => s.rageClick).length,
    heatmapClicks,
    aiSessions: aiSessions.length,
    aiConversions: aiSessions.filter(s => s.converted).length,
    devices: deviceMap,
    sources: sourceMap,
    topPages: Object.entries(pageMap).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([page, views]) => ({ page, views }))
  };
}

function changePct(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function healthLabel(score) {
  if (score >= 80) return 'Healthy';
  if (score >= 60) return 'Watch';
  if (score >= 40) return 'Risk';
  return 'Broken';
}

function buildAlerts(siteId, current, previous, lastEventTs, healthScore) {
  const alerts = [];
  const now = Date.now();
  const hoursSinceLast = lastEventTs ? (now - lastEventTs) / 3600000 : null;
  const push = (severity, type, title, detail, action) => {
    alerts.push({ severity, type, title, detail, action, siteId });
  };

  if (!lastEventTs) {
    push('critical', 'tracking_missing', 'No tracking data yet', 'No events have been received for this site.', 'Install the snippet and visit the live site once.');
  } else if (hoursSinceLast > 72) {
    push('critical', 'tracking_stopped', 'Tracking may be broken', `Last event was ${Math.round(hoursSinceLast)} hours ago.`, 'Check whether the script is still installed and the site is live.');
  } else if (hoursSinceLast > 24) {
    push('warning', 'tracking_slow', 'No recent events', `Last event was ${Math.round(hoursSinceLast)} hours ago.`, 'Open the live site and confirm a new event appears.');
  }

  if (current.formStarts >= 3 && current.formCompletes === 0) {
    push('critical', 'form_bug', 'Forms started but none completed', `${current.formStarts} form starts with 0 completes in this period.`, 'Test the form, validation, honeypot, thank-you redirect, and submit handler.');
  }

  const trafficChange = changePct(current.visitors, previous.visitors);
  if (previous.visitors >= 10 && trafficChange <= -35) {
    push('warning', 'traffic_drop', 'Traffic dropped sharply', `Visitors are down ${Math.abs(trafficChange)}% versus the previous period.`, 'Check top landing pages, rankings, recent deploys, and tracking status.');
  }

  const convChange = changePct(current.conversions, previous.conversions);
  if (previous.conversions >= 3 && convChange <= -35) {
    push('warning', 'conversion_drop', 'Conversions dropped', `Conversions are down ${Math.abs(convChange)}% versus the previous period.`, 'Review funnel drop-off, form behavior, and recent site changes.');
  }

  if (current.rageEvents + current.deadClicks >= 10) {
    push('warning', 'ux_friction', 'High frustration signals', `${current.rageEvents} rage clicks and ${current.deadClicks} dead clicks detected.`, 'Open Heatmaps and fix the elements users are trying to click.');
  }

  if (current.hesitations >= 10) {
    push('info', 'hesitation', 'CTA hesitation detected', `${current.hesitations} hesitation signals captured.`, 'Review CTAs with high hesitation and add trust cues or clearer copy.');
  }

  const aiChange = changePct(current.aiSessions, previous.aiSessions);
  if (current.aiSessions >= 5 && aiChange >= 60) {
    push('info', 'ai_spike', 'AI traffic is growing', `AI-referred sessions are up ${aiChange}% versus the previous period.`, 'Check which AI platforms and landing pages are converting.');
  } else if (previous.aiSessions >= 5 && aiChange <= -50) {
    push('warning', 'ai_drop', 'AI traffic dropped', `AI-referred sessions are down ${Math.abs(aiChange)}%.`, 'Review pages that used to receive AI referrals and update topical coverage.');
  }

  if (current.pageviewCount >= 20 && current.heatmapClicks === 0) {
    push('info', 'heatmap_missing', 'No heatmap clicks yet', 'Traffic exists, but no click heatmap data was captured.', 'Confirm the latest tracking script is installed and visitors are clicking tracked pages.');
  }

  if (healthScore < 50) {
    push('warning', 'low_health', 'Low health score', `This site health score is ${healthScore}/100.`, 'Fix critical alerts first, then review CRO and UX signals.');
  }

  const order = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

function scoreSite(siteId, current, previous, lastEventTs) {
  const now = Date.now();
  const hoursSinceLast = lastEventTs ? (now - lastEventTs) / 3600000 : null;
  const trafficChange = changePct(current.visitors, previous.visitors);
  const convChange = changePct(current.conversions, previous.conversions);

  let tracking = 0;
  if (hoursSinceLast === null) tracking = 0;
  else if (hoursSinceLast <= 6) tracking = 20;
  else if (hoursSinceLast <= 24) tracking = 16;
  else if (hoursSinceLast <= 72) tracking = 9;
  else tracking = 3;

  let traffic = current.visitors > 0 ? 12 : 0;
  if (current.visitors >= 20) traffic += 4;
  if (trafficChange >= 0) traffic += 4;
  else if (trafficChange > -25) traffic += 2;
  traffic = Math.min(20, traffic);

  let cro = 10;
  if (current.conversionRate >= 3) cro += 7;
  else if (current.conversionRate >= 1) cro += 4;
  if (current.formStarts > 0 && current.formCompletes === 0) cro -= 8;
  if (convChange < -35 && previous.conversions >= 3) cro -= 4;
  cro = Math.max(0, Math.min(20, cro));

  let ux = 12;
  if (current.bounceRate <= 55) ux += 3;
  if (current.avgScrollDepth >= 50) ux += 3;
  if (current.avgDuration >= 45) ux += 2;
  if (current.rageEvents + current.deadClicks > 10) ux -= 6;
  if (current.hesitations > 15) ux -= 3;
  ux = Math.max(0, Math.min(20, ux));

  let intelligence = 6;
  if (current.heatmapClicks > 0) intelligence += 5;
  if (current.aiSessions > 0) intelligence += 5;
  if (current.topPages.length >= 3) intelligence += 4;
  intelligence = Math.max(0, Math.min(20, intelligence));

  const score = Math.round(tracking + traffic + cro + ux + intelligence);
  const breakdown = [
    { label: 'Tracking', score: tracking, max: 20 },
    { label: 'Traffic', score: traffic, max: 20 },
    { label: 'CRO', score: cro, max: 20 },
    { label: 'UX', score: ux, max: 20 },
    { label: 'Intelligence', score: intelligence, max: 20 }
  ];
  const alerts = buildAlerts(siteId, current, previous, lastEventTs, score);
  return { score, label: healthLabel(score), breakdown, alerts, trafficChange, conversionChange: convChange };
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

async function getHealthScore(siteId, days = 7) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const span = (days || 7) * 86400000;
  const current = periodSummary(siteId, now - span, now);
  const previous = periodSummary(siteId, now - (span * 2), now - span);
  const allEvents = (db.data.events || []).filter(e => e.siteId === siteId);
  const lastEventTs = allEvents.length
    ? allEvents.reduce((a, e) => Math.max(a, new Date(e.ts).getTime()), 0)
    : null;
  const health = scoreSite(siteId, current, previous, lastEventTs);
  return {
    ...health,
    siteId,
    periodDays: days || 7,
    lastEvent: lastEventTs ? new Date(lastEventTs).toISOString() : null,
    summary: {
      visitors: current.visitors,
      sessions: current.sessionCount,
      pageviews: current.pageviewCount,
      conversions: current.conversions,
      conversionRate: current.conversionRate,
      bounceRate: current.bounceRate,
      aiSessions: current.aiSessions,
      heatmapClicks: current.heatmapClicks,
      rageClicks: current.rageEvents,
      deadClicks: current.deadClicks,
      hesitations: current.hesitations
    }
  };
}

async function getInsights(siteId, days = 7) {
  const health = await getHealthScore(siteId, days);
  return {
    siteId,
    periodDays: days || 7,
    score: health.score,
    label: health.label,
    alerts: health.alerts,
    nextActions: health.alerts.slice(0, 5).map(a => a.action)
  };
}

async function getAgencyOverview(days = 7) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const span = (days || 7) * 86400000;
  const sites = db.data.sites || [];
  const rows = sites.map(site => {
    const current = periodSummary(site.id, now - span, now);
    const previous = periodSummary(site.id, now - (span * 2), now - span);
    const allEvents = (db.data.events || []).filter(e => e.siteId === site.id);
    const lastEventTs = allEvents.length
      ? allEvents.reduce((a, e) => Math.max(a, new Date(e.ts).getTime()), 0)
      : null;
    const health = scoreSite(site.id, current, previous, lastEventTs);
    const criticalCount = health.alerts.filter(a => a.severity === 'critical').length;
    const warningCount = health.alerts.filter(a => a.severity === 'warning').length;
    return {
      ...site,
      healthScore: health.score,
      healthLabel: health.label,
      visitors: current.visitors,
      pageviews: current.pageviewCount,
      sessions: current.sessionCount,
      conversions: current.conversions,
      conversionRate: current.conversionRate,
      aiSessions: current.aiSessions,
      trafficChange: health.trafficChange,
      conversionChange: health.conversionChange,
      lastEvent: lastEventTs ? new Date(lastEventTs).toISOString() : null,
      alerts: health.alerts.slice(0, 3),
      criticalCount,
      warningCount
    };
  }).sort((a, b) => {
    if (a.criticalCount !== b.criticalCount) return b.criticalCount - a.criticalCount;
    if (a.warningCount !== b.warningCount) return b.warningCount - a.warningCount;
    return a.healthScore - b.healthScore;
  });

  return {
    periodDays: days || 7,
    totals: {
      sites: rows.length,
      visitors: rows.reduce((a, s) => a + s.visitors, 0),
      pageviews: rows.reduce((a, s) => a + s.pageviews, 0),
      conversions: rows.reduce((a, s) => a + s.conversions, 0),
      aiSessions: rows.reduce((a, s) => a + s.aiSessions, 0),
      critical: rows.reduce((a, s) => a + s.criticalCount, 0),
      warnings: rows.reduce((a, s) => a + s.warningCount, 0)
    },
    sites: rows
  };
}

async function getAITraffic(siteId, days = 30) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const since = now - (days || 30) * 86400000;
  const sessions = (db.data.sessions || []).filter(s => {
    const t = new Date(s.startedAt || s.lastSeen).getTime();
    return s.siteId === siteId && t >= since;
  });
  const aiSessions = sessions.filter(s => isAISource(classifySource(s.referrer)));
  const nonAiSessions = sessions.filter(s => !isAISource(classifySource(s.referrer)));
  const byPlatform = {};
  const landingPages = {};
  const dailyMap = {};
  aiSessions.forEach(s => {
    const platform = classifySource(s.referrer);
    const page = normalizePage(s.startPage || s.lastPage);
    const day = (s.startedAt || s.lastSeen || '').split('T')[0];
    byPlatform[platform] ||= { platform, sessions: 0, conversions: 0, avgDuration: 0, avgScrollDepth: 0 };
    byPlatform[platform].sessions++;
    if (s.converted) byPlatform[platform].conversions++;
    byPlatform[platform].avgDuration += s.duration || 0;
    byPlatform[platform].avgScrollDepth += s.scrollDepth || 0;
    landingPages[page] ||= { page, sessions: 0, conversions: 0 };
    landingPages[page].sessions++;
    if (s.converted) landingPages[page].conversions++;
    if (day) dailyMap[day] = (dailyMap[day] || 0) + 1;
  });
  const platforms = Object.values(byPlatform).map(p => ({
    ...p,
    conversionRate: p.sessions ? +((p.conversions / p.sessions) * 100).toFixed(2) : 0,
    avgDuration: p.sessions ? Math.round(p.avgDuration / p.sessions) : 0,
    avgScrollDepth: p.sessions ? Math.round(p.avgScrollDepth / p.sessions) : 0
  })).sort((a, b) => b.sessions - a.sessions);
  const trend = [];
  for (let i = (days || 30) - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    trend.push({ date: key, sessions: dailyMap[key] || 0 });
  }
  const aiConversions = aiSessions.filter(s => s.converted).length;
  const nonAiConversions = nonAiSessions.filter(s => s.converted).length;
  return {
    siteId,
    periodDays: days || 30,
    totalAISessions: aiSessions.length,
    totalAIConversions: aiConversions,
    aiConversionRate: aiSessions.length ? +((aiConversions / aiSessions.length) * 100).toFixed(2) : 0,
    nonAIConversionRate: nonAiSessions.length ? +((nonAiConversions / nonAiSessions.length) * 100).toFixed(2) : 0,
    aiShare: sessions.length ? +((aiSessions.length / sessions.length) * 100).toFixed(2) : 0,
    avgDuration: aiSessions.length ? Math.round(aiSessions.reduce((a, s) => a + (s.duration || 0), 0) / aiSessions.length) : 0,
    avgScrollDepth: aiSessions.length ? Math.round(aiSessions.reduce((a, s) => a + (s.scrollDepth || 0), 0) / aiSessions.length) : 0,
    platforms,
    landingPages: Object.values(landingPages).sort((a, b) => b.sessions - a.sessions).slice(0, 10),
    trend,
    recentSessions: aiSessions.slice().sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen)).slice(0, 15)
  };
}

async function getFunnelAnalysis(siteId, days = 30) {
  await db.read();
  ensureCollections();
  const now = Date.now();
  const since = now - (days || 30) * 86400000;
  const events = (db.data.events || []).filter(e => e.siteId === siteId && new Date(e.ts).getTime() >= since);
  const sessions = (db.data.sessions || []).filter(s => {
    const t = new Date(s.startedAt || s.lastSeen).getTime();
    return s.siteId === siteId && t >= since;
  });
  const pageviews = events.filter(e => e.type === 'pageview').length;
  const formStarts = events.filter(e => e.type === 'form_start').length;
  const formCompletes = events.filter(e => e.type === 'form_complete').length;
  const conversions = sessions.filter(s => s.converted).length;
  const steps = [
    { key: 'sessions', label: 'Sessions', count: sessions.length },
    { key: 'pageviews', label: 'Pageviews', count: pageviews },
    { key: 'formStarts', label: 'Form started', count: formStarts },
    { key: 'formCompletes', label: 'Form completed', count: formCompletes },
    { key: 'conversions', label: 'Converted', count: conversions }
  ].map((step, i, arr) => {
    const prev = i ? arr[i - 1].count : null;
    return {
      ...step,
      dropFromPrevious: prev != null ? Math.max(0, prev - step.count) : 0,
      dropRate: prev ? Math.round((1 - (step.count / prev)) * 100) : 0
    };
  });

  const exitMap = {};
  sessions.filter(s => !s.converted).forEach(s => {
    const page = normalizePage(s.lastPage || s.startPage);
    exitMap[page] ||= { page, exits: 0, avgDuration: 0 };
    exitMap[page].exits++;
    exitMap[page].avgDuration += s.duration || 0;
  });
  const exitPages = Object.values(exitMap).map(p => ({
    ...p,
    avgDuration: p.exits ? Math.round(p.avgDuration / p.exits) : 0
  })).sort((a, b) => b.exits - a.exits).slice(0, 10);

  const sourceMap = {};
  const deviceMap = {};
  sessions.forEach(s => {
    const source = classifySource(s.referrer);
    const device = classifyDevice(s.userAgent);
    sourceMap[source] ||= { label: source, sessions: 0, conversions: 0 };
    deviceMap[device] ||= { label: device, sessions: 0, conversions: 0 };
    sourceMap[source].sessions++;
    deviceMap[device].sessions++;
    if (s.converted) {
      sourceMap[source].conversions++;
      deviceMap[device].conversions++;
    }
  });
  const withRate = row => ({
    ...row,
    conversionRate: row.sessions ? +((row.conversions / row.sessions) * 100).toFixed(2) : 0
  });
  const frictionMap = {};
  events.filter(e => ['rage_click', 'dead_click', 'hesitation'].includes(e.type)).forEach(e => {
    const page = e.page || normalizePage(e.url);
    frictionMap[page] ||= { page, rageClicks: 0, deadClicks: 0, hesitations: 0, total: 0 };
    if (e.type === 'rage_click') frictionMap[page].rageClicks++;
    if (e.type === 'dead_click') frictionMap[page].deadClicks++;
    if (e.type === 'hesitation') frictionMap[page].hesitations++;
    frictionMap[page].total++;
  });

  return {
    siteId,
    periodDays: days || 30,
    steps,
    exitPages,
    bySource: Object.values(sourceMap).map(withRate).sort((a, b) => b.sessions - a.sessions),
    byDevice: Object.values(deviceMap).map(withRate).sort((a, b) => b.sessions - a.sessions),
    frictionPages: Object.values(frictionMap).sort((a, b) => b.total - a.total).slice(0, 10),
    diagnosis: formStarts >= 3 && formCompletes === 0
      ? 'Visitors are starting forms but nobody is completing them. This usually means validation, honeypot, submit handling, or thank-you redirect is broken.'
      : conversions === 0 && sessions.length >= 20
        ? 'Traffic exists but no conversions were recorded. Check whether conversion tracking is installed and whether the primary CTA works.'
        : 'Funnel data is flowing. Focus on the largest drop-off step and the top exit pages.'
  };
}

async function getOnboardingStatus(siteId) {
  await db.read();
  ensureCollections();
  const site = (db.data.sites || []).find(s => s.id === siteId);
  const events = (db.data.events || []).filter(e => e.siteId === siteId);
  const heatmap = (db.data.heatmap || []).filter(h => h.siteId === siteId);
  const shots = (db.data.heatmapScreenshots || []).filter(s => s.siteId === siteId);
  const lastEventTs = events.length ? events.reduce((a, e) => Math.max(a, new Date(e.ts).getTime()), 0) : null;
  const steps = [
    { key: 'site_created', label: 'Site created', done: !!site, detail: site ? site.name : 'Add this site in TrackLight' },
    { key: 'script_seen', label: 'Tracking script received data', done: !!lastEventTs, detail: lastEventTs ? new Date(lastEventTs).toISOString() : 'No events yet' },
    { key: 'pageviews', label: 'Pageviews captured', done: events.some(e => e.type === 'pageview'), detail: `${events.filter(e => e.type === 'pageview').length} pageviews` },
    { key: 'form_start', label: 'Form start tracking', done: events.some(e => e.type === 'form_start'), detail: `${events.filter(e => e.type === 'form_start').length} starts` },
    { key: 'conversions', label: 'Conversion/form completion tracking', done: events.some(e => e.type === 'form_complete' || e.type === 'conversion'), detail: `${events.filter(e => e.type === 'form_complete' || e.type === 'conversion').length} conversion events` },
    { key: 'heatmap', label: 'Heatmap clicks captured', done: heatmap.length > 0, detail: `${heatmap.length} clicks` },
    { key: 'screenshot', label: 'Heatmap screenshot uploaded', done: shots.length > 0, detail: `${shots.length} screenshots` },
    { key: 'friction', label: 'Friction signals enabled', done: events.some(e => e.type === 'rage_click' || e.type === 'dead_click' || e.type === 'hesitation'), detail: `${events.filter(e => ['rage_click', 'dead_click', 'hesitation'].includes(e.type)).length} signals` }
  ];
  const required = steps.filter(s => s.key !== 'screenshot');
  return {
    siteId,
    completion: Math.round((required.filter(s => s.done).length / required.length) * 100),
    lastEvent: lastEventTs ? new Date(lastEventTs).toISOString() : null,
    steps
  };
}

async function getClientReport(siteId, days = 30) {
  const [stats, health, ai, funnel, movers, onboarding] = await Promise.all([
    getStats(siteId, days),
    getHealthScore(siteId, Math.min(days || 30, 14)),
    getAITraffic(siteId, days),
    getFunnelAnalysis(siteId, days),
    getPageMovers(siteId),
    getOnboardingStatus(siteId)
  ]);
  return { siteId, periodDays: days || 30, stats, health, ai, funnel, movers, onboarding };
}

module.exports = {
  init, trackEvent, trackHeatmap, addAnnotation, deleteAnnotation,
  getStats, getRealtime, getHeatmap, getHeatmapPages,
  getHeatmapScreenshot, setHeatmapScreenshot,
  getAnnotations, getSites, addSite, deleteSite, resetSiteData,
  getSitesWithHealth, getPageMovers, getAgencyOverview, getAITraffic,
  getHealthScore, getInsights, getFunnelAnalysis, getOnboardingStatus,
  getClientReport,
  _read, _write
};
