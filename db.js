// db.js — Postgres-backed database for TrackLight v2
// Auto-creates schema on first run. Works with Railway free Postgres.
// Falls back to in-memory store if DATABASE_URL is not set (local dev only).

const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const USE_PG = !!process.env.DATABASE_URL;
let pool;

if (USE_PG) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false },
    max: 10,
  });
}

// ---------- IN-MEMORY FALLBACK ----------
const mem = {
  sites: [],
  events: [],
  annotations: [],
  alerts: [],
  alertHistory: [],
  shareLinks: [],
  heatmap: [],
};

// ============================================================
// SCHEMA
// ============================================================
async function init() {
  if (!USE_PG) {
    console.log('[db] No DATABASE_URL — using in-memory store (data will NOT persist).');
    if (!mem.sites.find(s => s.id === 'demo')) {
      mem.sites.push({
        id: 'demo',
        name: 'Demo (sample data)',
        domain: 'example.com',
        created_at: new Date().toISOString(),
      });
    }
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      visitor_id TEXT,
      session_id TEXT,
      event TEXT NOT NULL,
      page TEXT,
      referrer TEXT,
      source TEXT,
      country TEXT,
      device TEXT,
      browser TEXT,
      duration INT,
      scroll_depth INT,
      meta JSONB,
      ts TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_events_site_ts ON events(site_id, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_events_site_event ON events(site_id, event);
    CREATE INDEX IF NOT EXISTS idx_events_visitor ON events(site_id, visitor_id);

    CREATE TABLE IF NOT EXISTS heatmap_clicks (
      id BIGSERIAL PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      page TEXT NOT NULL,
      x INT, y INT, vw INT, vh INT,
      ts TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_heatmap_site_page ON heatmap_clicks(site_id, page);

    CREATE TABLE IF NOT EXISTS annotations (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      date DATE NOT NULL,
      text TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      site_id TEXT REFERENCES sites(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      rule_type TEXT NOT NULL,
      threshold NUMERIC,
      window_hours INT DEFAULT 24,
      enabled BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS alert_history (
      id BIGSERIAL PRIMARY KEY,
      alert_id TEXT REFERENCES alerts(id) ON DELETE CASCADE,
      site_id TEXT,
      message TEXT,
      severity TEXT,
      acknowledged BOOLEAN DEFAULT FALSE,
      triggered_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_alert_hist_site ON alert_history(site_id, triggered_at DESC);

    CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await pool.query(`
    INSERT INTO sites (id, name, domain)
    VALUES ('demo', 'Demo (sample data)', 'example.com')
    ON CONFLICT (id) DO NOTHING
  `);

  console.log('[db] Postgres ready.');
}

// ============================================================
// HELPERS
// ============================================================
// Source classifier — includes LLM detection (ChatGPT, Claude, Perplexity, Gemini, Copilot, etc.)
// This is the key gap GA4 doesn't fill — AI referral traffic is invisible there.
function classifySource(referrer) {
  if (!referrer) return 'Direct';
  try {
    const u = new URL(referrer);
    const h = u.hostname.toLowerCase();

    // AI / LLM referrals — checked FIRST so they take priority over generic "search"
    if (/chatgpt\.com|chat\.openai\.com|openai\.com/.test(h)) return 'AI: ChatGPT';
    if (/claude\.ai|anthropic\.com/.test(h)) return 'AI: Claude';
    if (/perplexity\.ai/.test(h)) return 'AI: Perplexity';
    if (/gemini\.google\.com|bard\.google\.com/.test(h)) return 'AI: Gemini';
    if (/copilot\.microsoft\.com|bing\.com\/chat/.test(h)) return 'AI: Copilot';
    if (/you\.com/.test(h)) return 'AI: You.com';
    if (/phind\.com/.test(h)) return 'AI: Phind';
    if (/deepseek\.com/.test(h)) return 'AI: DeepSeek';
    if (/grok\.x\.ai|grok\.com/.test(h)) return 'AI: Grok';
    if (/poe\.com/.test(h)) return 'AI: Poe';
    if (/kagi\.com\/assistant/.test(h)) return 'AI: Kagi';

    // Organic search
    if (/google\.|bing\.|yahoo\.|duckduckgo\.|ecosia\.|yandex\.|baidu\.|kagi\.com|brave\.com\/search/.test(h)) return 'Organic';

    // Social
    if (/facebook\.|fb\.com|instagram\.|twitter\.|x\.com|linkedin\.|tiktok\.|youtube\.|reddit\.|pinterest\.|threads\.net|mastodon\./.test(h)) return 'Social';

    // Email
    if (/mail\.|gmail\.|outlook\.|yahoo\.com\/mail/.test(h)) return 'Email';

    return 'Referral';
  } catch { return 'Direct'; }
}

// True if a source string represents an AI/LLM referral (used for filtering)
function isAISource(source) {
  return typeof source === 'string' && source.startsWith('AI:');
}

async function q(sql, params = []) {
  if (!USE_PG) throw new Error('PG only');
  const r = await pool.query(sql, params);
  return r.rows;
}

// ============================================================
// SITES
// ============================================================
async function listSites() {
  if (!USE_PG) return [...mem.sites].sort((a, b) => a.name.localeCompare(b.name));
  return q(`SELECT id, name, domain, created_at FROM sites ORDER BY name ASC`);
}

async function addSite({ id, name, domain }) {
  if (!id || !name) throw new Error('id and name required');
  if (!/^[a-z0-9-_]+$/i.test(id)) throw new Error('id must be alphanumeric/dash/underscore');

  if (!USE_PG) {
    if (mem.sites.find(s => s.id === id)) throw new Error('Site already exists');
    const site = { id, name, domain: domain || null, created_at: new Date().toISOString() };
    mem.sites.push(site);
    return site;
  }

  const r = await q(
    `INSERT INTO sites (id, name, domain) VALUES ($1, $2, $3)
     ON CONFLICT (id) DO NOTHING
     RETURNING id, name, domain, created_at`,
    [id, name, domain || null]
  );
  if (!r[0]) throw new Error('Site already exists');
  return r[0];
}

async function deleteSite(id) {
  if (!USE_PG) {
    mem.sites = mem.sites.filter(s => s.id !== id);
    mem.events = mem.events.filter(e => e.site_id !== id);
    return;
  }
  await q(`DELETE FROM sites WHERE id = $1`, [id]);
}

async function resetSiteData(id) {
  if (!USE_PG) {
    mem.events = mem.events.filter(e => e.site_id !== id);
    return;
  }
  await q(`DELETE FROM events WHERE site_id = $1`, [id]);
  await q(`DELETE FROM heatmap_clicks WHERE site_id = $1`, [id]);
}

// ============================================================
// EVENTS
// ============================================================
async function trackEvent({ siteId, visitorId, sessionId, event, page, referrer, country, device, browser, duration, scrollDepth, meta, ts }) {
  if (!siteId || !event) return;
  const source = classifySource(referrer);
  const when = ts ? new Date(ts) : new Date();

  if (!USE_PG) {
    mem.events.push({
      site_id: siteId, visitor_id: visitorId, session_id: sessionId,
      event, page, referrer, source, country, device, browser,
      duration, scroll_depth: scrollDepth, meta, ts: when.toISOString(),
    });
    return;
  }

  await q(
    `INSERT INTO events
     (site_id, visitor_id, session_id, event, page, referrer, source, country, device, browser, duration, scroll_depth, meta, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [siteId, visitorId, sessionId, event, page, referrer, source, country, device, browser, duration, scrollDepth, meta || null, when]
  );
}

// Bulk insert many events in ONE query. Used by the seeder; ~100x faster.
async function trackEventsBulk(events) {
  if (!events.length) return;
  if (!USE_PG) {
    for (const e of events) await trackEvent(e);
    return;
  }
  const cols = ['site_id','visitor_id','session_id','event','page','referrer','source','country','device','browser','duration','scroll_depth','meta','ts'];
  const values = [];
  const params = [];
  let i = 1;
  for (const e of events) {
    const source = classifySource(e.referrer);
    const when = e.ts ? new Date(e.ts) : new Date();
    const placeholders = cols.map(() => `$${i++}`).join(',');
    values.push(`(${placeholders})`);
    params.push(
      e.siteId, e.visitorId || null, e.sessionId || null, e.event, e.page || null,
      e.referrer || null, source, e.country || null, e.device || null, e.browser || null,
      e.duration ?? null, e.scrollDepth ?? null, e.meta || null, when
    );
  }
  await q(`INSERT INTO events (${cols.join(',')}) VALUES ${values.join(',')}`, params);
}

async function trackHeatmap({ siteId, page, x, y, vw, vh, ts }) {
  if (!siteId || !page) return;
  const when = ts ? new Date(ts) : new Date();
  if (!USE_PG) return;
  await q(
    `INSERT INTO heatmap_clicks (site_id, page, x, y, vw, vh, ts)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [siteId, page, x, y, vw, vh, when]
  );
}

// ============================================================
// STATS
// ============================================================
async function getStats(siteId, days = 30) {
  if (!USE_PG) return _statsFromArray(mem.events.filter(e => e.site_id === siteId), days);

  const since = `NOW() - INTERVAL '${Number(days) || 30} days'`;
  const today = `NOW() - INTERVAL '1 day'`;

  const [overview, daily, topPages, sources, devices, countries, funnel] = await Promise.all([
    q(`SELECT
        COUNT(DISTINCT visitor_id) AS visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) FILTER (WHERE event='pageview') AS pageviews,
        COUNT(*) FILTER (WHERE event='conversion') AS conversions,
        COUNT(*) FILTER (WHERE event='rage_click') AS rage_clicks,
        COALESCE(AVG(duration) FILTER (WHERE event='pageleave'), 0)::INT AS avg_duration,
        COALESCE(AVG(scroll_depth) FILTER (WHERE event='pageleave'), 0)::INT AS avg_scroll
       FROM events WHERE site_id=$1 AND ts > ${since}`, [siteId]),
    q(`SELECT DATE(ts) AS date, COUNT(DISTINCT visitor_id) AS visitors
       FROM events WHERE site_id=$1 AND ts > ${since}
       GROUP BY DATE(ts) ORDER BY date ASC`, [siteId]),
    q(`SELECT page, COUNT(*) AS views FROM events
       WHERE site_id=$1 AND event='pageview' AND ts > ${since}
       GROUP BY page ORDER BY views DESC LIMIT 10`, [siteId]),
    q(`SELECT source, COUNT(DISTINCT visitor_id) AS visitors
       FROM events WHERE site_id=$1 AND ts > ${since}
       GROUP BY source ORDER BY visitors DESC`, [siteId]),
    q(`SELECT device, COUNT(DISTINCT visitor_id) AS visitors
       FROM events WHERE site_id=$1 AND device IS NOT NULL AND ts > ${since}
       GROUP BY device ORDER BY visitors DESC`, [siteId]),
    q(`SELECT country, COUNT(DISTINCT visitor_id) AS visitors
       FROM events WHERE site_id=$1 AND country IS NOT NULL AND ts > ${since}
       GROUP BY country ORDER BY visitors DESC LIMIT 10`, [siteId]),
    q(`SELECT
        COUNT(*) FILTER (WHERE event='pageview') AS pageviews,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) FILTER (WHERE event='form_start') AS form_starts,
        COUNT(*) FILTER (WHERE event='form_complete') AS form_completes,
        COUNT(*) FILTER (WHERE event='conversion') AS conversions
       FROM events WHERE site_id=$1 AND ts > ${since}`, [siteId]),
  ]);

  const todayRow = (await q(
    `SELECT COUNT(DISTINCT visitor_id) AS v FROM events WHERE site_id=$1 AND ts > ${today}`,
    [siteId]
  ))[0];

  const bounceRow = (await q(`
    WITH s AS (
      SELECT session_id, COUNT(*) FILTER (WHERE event='pageview') AS pv
      FROM events WHERE site_id=$1 AND ts > ${since} AND session_id IS NOT NULL
      GROUP BY session_id
    )
    SELECT COUNT(*) FILTER (WHERE pv <= 1)::FLOAT / NULLIF(COUNT(*),0) AS bounce FROM s
  `, [siteId]))[0];

  const ov = overview[0];
  const f = funnel[0];

  const dailyMap = new Map(daily.map(d => [d.date.toISOString().slice(0, 10), Number(d.visitors)]));
  const dailySeries = [];
  for (let i = (Number(days) || 30) - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    dailySeries.push({ date: key, visitors: dailyMap.get(key) || 0 });
  }

  return {
    visitors: Number(ov.visitors) || 0,
    sessions: Number(ov.sessions) || 0,
    pageviews: Number(ov.pageviews) || 0,
    conversions: Number(ov.conversions) || 0,
    rageSessions: Number(ov.rage_clicks) || 0,
    todayVisitors: Number(todayRow.v) || 0,
    avgDuration: Number(ov.avg_duration) || 0,
    avgScrollDepth: Number(ov.avg_scroll) || 0,
    bounceRate: Math.round((Number(bounceRow.bounce) || 0) * 100),
    conversionRate: ov.sessions > 0 ? Math.round((ov.conversions / ov.sessions) * 10000) / 100 : 0,
    daily: dailySeries,
    topPages: topPages.map(r => ({ page: r.page, views: Number(r.views) })),
    sources: Object.fromEntries(sources.map(r => [r.source, Number(r.visitors)])),
    devices: Object.fromEntries(devices.map(r => [r.device, Number(r.visitors)])),
    topCountries: countries.map(r => ({ country: r.country, visitors: Number(r.visitors) })),
    funnel: {
      sessions: Number(f.sessions) || 0,
      pageviews: Number(f.pageviews) || 0,
      formStarts: Number(f.form_starts) || 0,
      formCompletes: Number(f.form_completes) || 0,
      conversions: Number(f.conversions) || 0,
    },
  };
}

function _statsFromArray(evs, days) {
  const visitors = new Set(evs.map(e => e.visitor_id).filter(Boolean));
  const sessions = new Set(evs.map(e => e.session_id).filter(Boolean));
  const pv = evs.filter(e => e.event === 'pageview').length;
  return {
    visitors: visitors.size, sessions: sessions.size, pageviews: pv,
    conversions: 0, rageSessions: 0, todayVisitors: 0,
    avgDuration: 0, avgScrollDepth: 0, bounceRate: 0, conversionRate: 0,
    daily: [], topPages: [], sources: {}, devices: {}, topCountries: [],
    funnel: { sessions: sessions.size, pageviews: pv, formStarts: 0, formCompletes: 0, conversions: 0 },
  };
}

// ============================================================
// REAL-TIME
// ============================================================
async function getRealtime(siteId) {
  if (!USE_PG) return { online: 0, perMinute: Array(20).fill(0), activePages: [] };

  const [online, perMin, pages] = await Promise.all([
    q(`SELECT COUNT(DISTINCT visitor_id) AS c FROM events
       WHERE site_id=$1 AND ts > NOW() - INTERVAL '5 minutes'`, [siteId]),
    q(`SELECT DATE_TRUNC('minute', ts) AS m, COUNT(*) AS c
       FROM events
       WHERE site_id=$1 AND event='pageview' AND ts > NOW() - INTERVAL '20 minutes'
       GROUP BY m ORDER BY m ASC`, [siteId]),
    q(`SELECT page, COUNT(DISTINCT visitor_id) AS c FROM events
       WHERE site_id=$1 AND event='pageview' AND ts > NOW() - INTERVAL '5 minutes'
       GROUP BY page ORDER BY c DESC LIMIT 5`, [siteId]),
  ]);

  const buckets = Array(20).fill(0);
  const now = new Date();
  for (const row of perMin) {
    const diff = Math.floor((now - new Date(row.m)) / 60000);
    if (diff >= 0 && diff < 20) buckets[19 - diff] = Number(row.c);
  }

  return {
    online: Number(online[0].c) || 0,
    perMinute: buckets,
    activePages: pages.map(p => ({ page: p.page, visitors: Number(p.c) })),
  };
}

// ============================================================
// AGENCY OVERVIEW
// ============================================================
async function getAgencyOverview() {
  if (!USE_PG) {
    return mem.sites.map(s => ({
      id: s.id, name: s.name, domain: s.domain,
      todayVisitors: 0, yesterdayVisitors: 0, trend: 0,
      conversions7d: 0, online: 0, status: 'idle', issues: ['No data yet'], lastEvent: null,
    }));
  }

  const rows = await q(`
    WITH t AS (
      SELECT site_id,
        COUNT(DISTINCT visitor_id) FILTER (WHERE ts > NOW() - INTERVAL '1 day') AS today_v,
        COUNT(DISTINCT visitor_id) FILTER (WHERE ts > NOW() - INTERVAL '2 days' AND ts <= NOW() - INTERVAL '1 day') AS yesterday_v,
        COUNT(DISTINCT visitor_id) FILTER (WHERE ts > NOW() - INTERVAL '5 minutes') AS online,
        COUNT(*) FILTER (WHERE event='conversion' AND ts > NOW() - INTERVAL '7 days') AS conv_7d,
        COUNT(*) FILTER (WHERE event='form_start' AND ts > NOW() - INTERVAL '24 hours') AS form_start_24h,
        COUNT(*) FILTER (WHERE event='form_complete' AND ts > NOW() - INTERVAL '24 hours') AS form_complete_24h,
        MAX(ts) AS last_event
      FROM events GROUP BY site_id
    )
    SELECT s.id, s.name, s.domain,
           COALESCE(t.today_v, 0) AS today_v,
           COALESCE(t.yesterday_v, 0) AS yesterday_v,
           COALESCE(t.online, 0) AS online,
           COALESCE(t.conv_7d, 0) AS conv_7d,
           COALESCE(t.form_start_24h, 0) AS form_start_24h,
           COALESCE(t.form_complete_24h, 0) AS form_complete_24h,
           t.last_event
    FROM sites s LEFT JOIN t ON t.site_id = s.id
    ORDER BY s.name ASC
  `);

  return rows.map(r => {
    const today = Number(r.today_v);
    const yesterday = Number(r.yesterday_v);
    let trend = 0;
    if (yesterday > 0) trend = Math.round(((today - yesterday) / yesterday) * 100);

    let status = 'healthy';
    const issues = [];

    if (Number(r.form_start_24h) >= 5 && Number(r.form_complete_24h) === 0) {
      status = 'warning';
      issues.push('Form starts but no completes in 24h');
    }
    if (yesterday >= 10 && today < yesterday * 0.5) {
      status = 'warning';
      issues.push(`Traffic down ${Math.abs(trend)}% vs yesterday`);
    }
    if (!r.last_event) {
      status = 'idle';
      issues.push('No data yet — install snippet');
    } else {
      const hours = (Date.now() - new Date(r.last_event).getTime()) / 3600000;
      if (hours > 48) { status = 'idle'; issues.push(`No events for ${Math.round(hours)}h`); }
    }

    return {
      id: r.id, name: r.name, domain: r.domain,
      todayVisitors: today, yesterdayVisitors: yesterday, trend,
      online: Number(r.online), conversions7d: Number(r.conv_7d),
      lastEvent: r.last_event, status, issues,
    };
  });
}

// ============================================================
// HEATMAP
// ============================================================
async function getHeatmap(siteId, page) {
  if (!USE_PG) return { clicks: [] };
  const rows = await q(
    `SELECT x, y, vw, vh FROM heatmap_clicks
     WHERE site_id=$1 AND page=$2 AND ts > NOW() - INTERVAL '30 days'
     LIMIT 5000`,
    [siteId, page]
  );
  return { clicks: rows };
}

async function getHeatmapPages(siteId) {
  if (!USE_PG) return [];
  return q(
    `SELECT page, COUNT(*) AS clicks FROM heatmap_clicks
     WHERE site_id=$1 GROUP BY page ORDER BY clicks DESC LIMIT 20`,
    [siteId]
  );
}

// ============================================================
// ANNOTATIONS
// ============================================================
async function listAnnotations(siteId) {
  if (!USE_PG) return [];
  return q(
    `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, text, created_at FROM annotations
     WHERE site_id=$1 ORDER BY date DESC`,
    [siteId]
  );
}

async function addAnnotation({ siteId, date, text }) {
  const id = randomUUID();
  if (!USE_PG) return { id, site_id: siteId, date, text };
  const r = await q(
    `INSERT INTO annotations (id, site_id, date, text)
     VALUES ($1,$2,$3,$4)
     RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') AS date, text, created_at`,
    [id, siteId, date, text]
  );
  return r[0];
}

async function deleteAnnotation(id) {
  if (!USE_PG) return;
  await q(`DELETE FROM annotations WHERE id=$1`, [id]);
}

// ============================================================
// ALERTS
// ============================================================
async function listAlerts() {
  if (!USE_PG) return [];
  return q(`SELECT a.*, s.name AS site_name FROM alerts a
            LEFT JOIN sites s ON s.id = a.site_id
            ORDER BY a.created_at DESC`);
}

async function addAlert({ siteId, name, ruleType, threshold, windowHours }) {
  const id = randomUUID();
  if (!USE_PG) return { id, site_id: siteId, name, rule_type: ruleType, threshold, window_hours: windowHours, enabled: true };
  const r = await q(
    `INSERT INTO alerts (id, site_id, name, rule_type, threshold, window_hours)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [id, siteId || null, name, ruleType, threshold, windowHours || 24]
  );
  return r[0];
}

async function deleteAlert(id) {
  if (!USE_PG) return;
  await q(`DELETE FROM alerts WHERE id=$1`, [id]);
}

async function toggleAlert(id, enabled) {
  if (!USE_PG) return;
  await q(`UPDATE alerts SET enabled=$1 WHERE id=$2`, [enabled, id]);
}

async function getAlertHistory(limit = 50) {
  if (!USE_PG) return [];
  return q(
    `SELECT h.*, s.name AS site_name FROM alert_history h
     LEFT JOIN sites s ON s.id = h.site_id
     ORDER BY triggered_at DESC LIMIT $1`,
    [limit]
  );
}

async function recordAlertTrigger({ alertId, siteId, message, severity }) {
  if (!USE_PG) return;
  await q(
    `INSERT INTO alert_history (alert_id, site_id, message, severity)
     VALUES ($1,$2,$3,$4)`,
    [alertId, siteId, message, severity || 'warning']
  );
}

async function ackAlert(id) {
  if (!USE_PG) return;
  await q(`UPDATE alert_history SET acknowledged = TRUE WHERE id=$1`, [id]);
}

// ============================================================
// SHARE LINKS
// ============================================================
async function createShareLink(siteId, expiresInDays = 90) {
  const token = randomUUID().replace(/-/g, '').slice(0, 24);
  const expires = expiresInDays ? new Date(Date.now() + expiresInDays * 86400000) : null;
  if (!USE_PG) return { token, site_id: siteId, expires_at: expires };
  await q(
    `INSERT INTO share_links (token, site_id, expires_at) VALUES ($1,$2,$3)`,
    [token, siteId, expires]
  );
  return { token, site_id: siteId, expires_at: expires };
}

async function getShareLink(token) {
  if (!USE_PG) return null;
  const r = await q(
    `SELECT token, site_id, expires_at FROM share_links
     WHERE token=$1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [token]
  );
  return r[0] || null;
}

async function listShareLinks(siteId) {
  if (!USE_PG) return [];
  return q(
    `SELECT token, expires_at, created_at FROM share_links
     WHERE site_id=$1 ORDER BY created_at DESC`,
    [siteId]
  );
}

async function deleteShareLink(token) {
  if (!USE_PG) return;
  await q(`DELETE FROM share_links WHERE token=$1`, [token]);
}

// ============================================================
// ALERT EVALUATION
// ============================================================
async function evaluateAlerts() {
  if (!USE_PG) return [];
  const rules = await q(`SELECT * FROM alerts WHERE enabled = TRUE`);
  const triggered = [];

  for (const rule of rules) {
    let fire = false, msg = '';
    const win = Number(rule.window_hours) || 24;

    if (rule.rule_type === 'form_breakage') {
      const r = await q(`
        SELECT COUNT(*) FILTER (WHERE event='form_start') AS starts,
               COUNT(*) FILTER (WHERE event='form_complete') AS completes
        FROM events
        WHERE ($1::TEXT IS NULL OR site_id=$1)
          AND ts > NOW() - INTERVAL '${win} hours'
      `, [rule.site_id]);
      const starts = Number(r[0].starts), completes = Number(r[0].completes);
      const threshold = Number(rule.threshold) || 5;
      if (starts >= threshold && completes === 0) {
        fire = true;
        msg = `${starts} form starts but 0 completes in last ${win}h — possible form bug`;
      }
    }

    if (rule.rule_type === 'traffic_drop') {
      const r = await q(`
        SELECT COUNT(DISTINCT visitor_id) FILTER (WHERE ts > NOW() - INTERVAL '24 hours') AS today,
               COUNT(DISTINCT visitor_id) FILTER (WHERE ts > NOW() - INTERVAL '48 hours' AND ts <= NOW() - INTERVAL '24 hours') AS yesterday
        FROM events WHERE ($1::TEXT IS NULL OR site_id=$1)
      `, [rule.site_id]);
      const today = Number(r[0].today), yesterday = Number(r[0].yesterday);
      const dropPct = Number(rule.threshold) || 50;
      if (yesterday >= 10 && today < yesterday * (1 - dropPct / 100)) {
        fire = true;
        msg = `Traffic dropped ${Math.round(((yesterday - today) / yesterday) * 100)}% (yesterday ${yesterday}, today ${today})`;
      }
    }

    if (rule.rule_type === 'no_conversions') {
      const r = await q(`
        SELECT COUNT(*) AS conv FROM events
        WHERE ($1::TEXT IS NULL OR site_id=$1)
          AND event='conversion' AND ts > NOW() - INTERVAL '${win} hours'
      `, [rule.site_id]);
      if (Number(r[0].conv) === 0) {
        fire = true;
        msg = `No conversions recorded in last ${win}h`;
      }
    }

    if (fire) {
      const recent = await q(
        `SELECT id FROM alert_history
         WHERE alert_id=$1 AND triggered_at > NOW() - INTERVAL '${win} hours'
         LIMIT 1`,
        [rule.id]
      );
      if (recent.length === 0) {
        await recordAlertTrigger({ alertId: rule.id, siteId: rule.site_id, message: msg, severity: 'warning' });
        triggered.push({ ...rule, message: msg });
      }
    }
  }

  return triggered;
}

// ============================================================
// AI TRAFFIC BREAKDOWN
// ============================================================
async function getAITraffic(siteId, days = 30) {
  if (!USE_PG) return { total: 0, byPlatform: [], byPage: [], conversionRate: 0 };
  const since = `NOW() - INTERVAL '${Number(days) || 30} days'`;

  const [totals, byPlatform, byPage, conv] = await Promise.all([
    q(`SELECT
        COUNT(DISTINCT visitor_id) AS visitors,
        COUNT(DISTINCT session_id) AS sessions,
        COUNT(*) FILTER (WHERE event='pageview') AS pageviews
       FROM events
       WHERE site_id=$1 AND ts > ${since} AND source LIKE 'AI:%'`, [siteId]),
    q(`SELECT source, COUNT(DISTINCT visitor_id) AS visitors,
              COUNT(DISTINCT session_id) AS sessions,
              COUNT(*) FILTER (WHERE event='conversion') AS conversions
       FROM events WHERE site_id=$1 AND ts > ${since} AND source LIKE 'AI:%'
       GROUP BY source ORDER BY visitors DESC`, [siteId]),
    q(`SELECT page, COUNT(*) AS views FROM events
       WHERE site_id=$1 AND ts > ${since} AND source LIKE 'AI:%' AND event='pageview'
       GROUP BY page ORDER BY views DESC LIMIT 10`, [siteId]),
    q(`SELECT
        COUNT(DISTINCT session_id) FILTER (WHERE source LIKE 'AI:%') AS ai_sessions,
        COUNT(*) FILTER (WHERE event='conversion' AND source LIKE 'AI:%') AS ai_conversions
       FROM events WHERE site_id=$1 AND ts > ${since}`, [siteId]),
  ]);

  const aiSessions = Number(conv[0].ai_sessions);
  const aiConversions = Number(conv[0].ai_conversions);

  return {
    visitors: Number(totals[0].visitors) || 0,
    sessions: Number(totals[0].sessions) || 0,
    pageviews: Number(totals[0].pageviews) || 0,
    conversions: aiConversions,
    conversionRate: aiSessions > 0 ? Math.round((aiConversions / aiSessions) * 10000) / 100 : 0,
    byPlatform: byPlatform.map(r => ({
      platform: r.source.replace('AI: ', ''),
      visitors: Number(r.visitors),
      sessions: Number(r.sessions),
      conversions: Number(r.conversions),
    })),
    topPages: byPage.map(r => ({ page: r.page, views: Number(r.views) })),
  };
}

// ============================================================
// PAGE GAINERS / LOSERS (week over week)
// ============================================================
async function getPageMovers(siteId) {
  if (!USE_PG) return { gainers: [], losers: [] };

  const rows = await q(`
    WITH this_week AS (
      SELECT page, COUNT(*) AS views
      FROM events WHERE site_id=$1 AND event='pageview' AND ts > NOW() - INTERVAL '7 days'
      GROUP BY page
    ),
    last_week AS (
      SELECT page, COUNT(*) AS views
      FROM events WHERE site_id=$1 AND event='pageview'
        AND ts > NOW() - INTERVAL '14 days' AND ts <= NOW() - INTERVAL '7 days'
      GROUP BY page
    )
    SELECT
      COALESCE(t.page, l.page) AS page,
      COALESCE(t.views, 0) AS this_week,
      COALESCE(l.views, 0) AS last_week,
      COALESCE(t.views, 0) - COALESCE(l.views, 0) AS change
    FROM this_week t FULL OUTER JOIN last_week l ON t.page = l.page
    WHERE COALESCE(t.views, 0) + COALESCE(l.views, 0) >= 5
    ORDER BY change DESC
  `, [siteId]);

  const all = rows.map(r => ({
    page: r.page,
    thisWeek: Number(r.this_week),
    lastWeek: Number(r.last_week),
    change: Number(r.change),
    changePct: Number(r.last_week) > 0
      ? Math.round((Number(r.change) / Number(r.last_week)) * 100)
      : null,
  }));

  return {
    gainers: all.filter(r => r.change > 0).slice(0, 10),
    losers: all.filter(r => r.change < 0).reverse().slice(0, 10),
  };
}

// ============================================================
// AI WEBSITE HEALTH SCORE — single 0-100 number per site
// Combines: traffic trend + form health + conversion rate + bounce rate + data freshness
// ============================================================
async function getHealthScore(siteId) {
  if (!USE_PG) return { score: 0, breakdown: [], status: 'unknown' };

  const stats = await getStats(siteId, 30);
  const overview = (await getAgencyOverview()).find(s => s.id === siteId);

  if (!overview || !overview.lastEvent) {
    return {
      score: 0,
      status: 'idle',
      breakdown: [{ label: 'No data yet', score: 0, max: 100, note: 'Install snippet to start tracking' }],
    };
  }

  const breakdown = [];

  // 1. Traffic trend (25 points) — today vs 7-day average
  const dailyVisitors = stats.daily.slice(-7).map(d => d.visitors);
  const avg7 = dailyVisitors.reduce((a, b) => a + b, 0) / 7;
  const todayV = overview.todayVisitors;
  let trafficScore = 25;
  let trafficNote = 'Traffic is stable';
  if (avg7 > 5) {
    const ratio = todayV / avg7;
    if (ratio >= 0.8) { trafficScore = 25; trafficNote = `On par with 7-day average (${Math.round(avg7)})`; }
    else if (ratio >= 0.5) { trafficScore = 15; trafficNote = `Below 7-day average (${todayV} vs ${Math.round(avg7)})`; }
    else { trafficScore = 5; trafficNote = `Sharp drop vs 7-day average (${todayV} vs ${Math.round(avg7)})`; }
  } else {
    trafficScore = 15; trafficNote = 'Not enough data for trend yet';
  }
  breakdown.push({ label: 'Traffic trend', score: trafficScore, max: 25, note: trafficNote });

  // 2. Form / conversion health (25 points)
  let formScore = 25;
  let formNote = 'Forms converting normally';
  const f = stats.funnel;
  if (f.formStarts >= 5 && f.formCompletes === 0) {
    formScore = 0;
    formNote = `${f.formStarts} form starts, 0 completes — possible form bug`;
  } else if (f.formStarts >= 10 && f.formCompletes / f.formStarts < 0.05) {
    formScore = 8;
    formNote = `Form completion rate very low (${Math.round((f.formCompletes / f.formStarts) * 100)}%)`;
  } else if (f.formStarts === 0 && f.conversions === 0) {
    formScore = 15;
    formNote = 'No form/conversion events tracked yet';
  }
  breakdown.push({ label: 'Form health', score: formScore, max: 25, note: formNote });

  // 3. Conversion rate (20 points) — score against industry benchmark (~2%)
  let convScore = 0;
  let convNote = '';
  const cr = stats.conversionRate;
  if (cr >= 3) { convScore = 20; convNote = `Excellent (${cr}%)`; }
  else if (cr >= 1.5) { convScore = 15; convNote = `Good (${cr}%)`; }
  else if (cr >= 0.5) { convScore = 10; convNote = `Below average (${cr}%)`; }
  else if (cr > 0) { convScore = 5; convNote = `Low (${cr}%)`; }
  else { convScore = 8; convNote = 'No conversions tracked — verify setup'; }
  breakdown.push({ label: 'Conversion rate', score: convScore, max: 20, note: convNote });

  // 4. Engagement (bounce rate) (15 points) — lower is better
  let bounceScore = 15;
  let bounceNote = '';
  const br = stats.bounceRate;
  if (br <= 40) { bounceScore = 15; bounceNote = `Excellent (${br}%)`; }
  else if (br <= 60) { bounceScore = 11; bounceNote = `Good (${br}%)`; }
  else if (br <= 75) { bounceScore = 7; bounceNote = `High bounce (${br}%)`; }
  else { bounceScore = 3; bounceNote = `Very high bounce (${br}%)`; }
  breakdown.push({ label: 'Engagement', score: bounceScore, max: 15, note: bounceNote });

  // 5. Data freshness (15 points) — is tracking actually firing?
  let freshScore = 15;
  let freshNote = 'Tracking is live';
  const hoursSinceLast = (Date.now() - new Date(overview.lastEvent).getTime()) / 3600000;
  if (hoursSinceLast > 48) { freshScore = 0; freshNote = `No events for ${Math.round(hoursSinceLast)}h — check snippet`; }
  else if (hoursSinceLast > 12) { freshScore = 7; freshNote = `Last event ${Math.round(hoursSinceLast)}h ago`; }
  breakdown.push({ label: 'Data freshness', score: freshScore, max: 15, note: freshNote });

  const total = breakdown.reduce((a, b) => a + b.score, 0);
  let status = 'excellent';
  if (total < 50) status = 'poor';
  else if (total < 70) status = 'fair';
  else if (total < 85) status = 'good';

  return { score: total, status, breakdown };
}

module.exports = {
  init,
  listSites, addSite, deleteSite, resetSiteData,
  trackEvent, trackEventsBulk, trackHeatmap,
  getStats, getRealtime, getAgencyOverview,
  getHeatmap, getHeatmapPages,
  listAnnotations, addAnnotation, deleteAnnotation,
  listAlerts, addAlert, deleteAlert, toggleAlert, getAlertHistory, ackAlert, evaluateAlerts, recordAlertTrigger,
  createShareLink, getShareLink, listShareLinks, deleteShareLink,
  getAITraffic, getPageMovers, getHealthScore,
  classifySource, isAISource, USE_PG, _pool: () => pool,
};
