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
  heatmap: []
});

async function init() {
  await db.read();
  db.data ||= { sites: [], events: [], sessions: [], annotations: [], heatmap: [] };
  if (!db.data.sites.length) {
    db.data.sites.push({
      id: 'demo',
      name: 'Demo Site',
      domain: 'yourdomain.com',
      createdAt: new Date().toISOString()
    });
  }
  await db.write();
}

async function trackEvent(payload) {
  await db.read();
  const event = {
    id: uuidv4(),
    siteId: payload.siteId || 'demo',
    type: payload.type,
    url: payload.url,
    referrer: payload.referrer || '',
    userAgent: payload.userAgent || '',
    sessionId: payload.sessionId,
    visitorId: payload.visitorId,
    country: payload.country || 'Unknown',
    city: payload.city || 'Unknown',
    duration: payload.duration || 0,
    scrollDepth: payload.scrollDepth || 0,
    meta: payload.meta || {},
    ts: new Date().toISOString()
  };
  db.data.events.push(event);
  await upsertSession(payload);
  await db.write();
  return event;
}

async function trackHeatmap(payload) {
  await db.read();
  db.data.heatmap.push({
    id: uuidv4(),
    siteId: payload.siteId || 'demo',
    url: payload.url,
    x: payload.x,
    y: payload.y,
    type: payload.type || 'click',
    ts: new Date().toISOString()
  });
  await db.write();
}

async function upsertSession(payload) {
  const existing = db.data.sessions.find(s => s.id === payload.sessionId);
  if (existing) {
    existing.pageCount = (existing.pageCount || 1) + (payload.type === 'pageview' ? 1 : 0);
    existing.lastSeen = new Date().toISOString();
    existing.duration = payload.duration || existing.duration;
    existing.scrollDepth = Math.max(existing.scrollDepth || 0, payload.scrollDepth || 0);
    if (payload.type === 'conversion') existing.converted = true;
    if (payload.rageClick) existing.rageClick = true;
  } else {
    db.data.sessions.push({
      id: payload.sessionId,
      siteId: payload.siteId || 'demo',
      visitorId: payload.visitorId,
      startPage: payload.url,
      lastPage: payload.url,
      pageCount: 1,
      duration: 0,
      scrollDepth: 0,
      converted: false,
      rageClick: false,
      referrer: payload.referrer || '',
      userAgent: payload.userAgent || '',
      country: payload.country || 'Unknown',
      city: payload.city || 'Unknown',
      startedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString()
    });
  }
}

async function addAnnotation(data) {
  await db.read();
  const ann = {
    id: uuidv4(),
    siteId: data.siteId || 'demo',
    text: data.text,
    color: data.color || 'blue',
    date: data.date || new Date().toISOString().split('T')[0],
    createdAt: new Date().toISOString()
  };
  db.data.annotations.push(ann);
  await db.write();
  return ann;
}

async function getStats(siteId, days) {
  await db.read();
  const since = new Date();
  since.setDate(since.getDate() - (days || 30));

  const events = db.data.events.filter(e =>
    e.siteId === siteId && new Date(e.ts) >= since
  );
  const sessions = db.data.sessions.filter(s =>
    s.siteId === siteId && new Date(s.startedAt) >= since
  );

  const pageviews = events.filter(e => e.type === 'pageview');
  const uniqueVisitors = new Set(events.map(e => e.visitorId)).size;
  const conversions = sessions.filter(s => s.converted).length;
  const rageSessions = sessions.filter(s => s.rageClick).length;
  const bounced = sessions.filter(s => s.pageCount <= 1).length;
  const bounceRate = sessions.length ? Math.round((bounced / sessions.length) * 100) : 0;

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

  // Top pages
  const pageMap = {};
  pageviews.forEach(e => {
    const p = e.url.replace(/https?:\/\/[^/]+/, '') || '/';
    pageMap[p] = (pageMap[p] || 0) + 1;
  });
  const topPages = Object.entries(pageMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([page, views]) => ({ page, views }));

  // Sources
  const srcMap = {};
  sessions.forEach(s => {
    let src = 'Direct';
    if (s.referrer) {
      if (s.referrer.includes('google') || s.referrer.includes('bing') || s.referrer.includes('yahoo')) src = 'Organic';
      else if (s.referrer.includes('facebook') || s.referrer.includes('instagram') || s.referrer.includes('twitter') || s.referrer.includes('linkedin')) src = 'Social';
      else if (s.referrer.includes('mail') || s.referrer.includes('email')) src = 'Email';
      else src = 'Referral';
    }
    srcMap[src] = (srcMap[src] || 0) + 1;
  });

  // Funnel
  const formStarts = events.filter(e => e.type === 'form_start').length;
  const formCompletes = events.filter(e => e.type === 'form_complete').length;

  return {
    visitors: uniqueVisitors,
    sessions: sessions.length,
    pageviews: pageviews.length,
    bounceRate,
    conversions,
    rageSessions,
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
    recentSessions: sessions
      .sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))
      .slice(0, 10)
  };
}

async function getHeatmap(siteId, url) {
  await db.read();
  return db.data.heatmap.filter(h =>
    h.siteId === siteId && (!url || h.url === url)
  );
}

async function getAnnotations(siteId) {
  await db.read();
  return (db.data.annotations || []).filter(a => a.siteId === siteId);
}

async function getSites() {
  await db.read();
  return db.data.sites;
}

module.exports = { init, trackEvent, trackHeatmap, addAnnotation, getStats, getHeatmap, getAnnotations, getSites };
