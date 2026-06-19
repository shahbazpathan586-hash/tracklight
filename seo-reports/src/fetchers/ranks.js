const axios = require('axios');
const fs = require('fs');
const path = require('path');

const HISTORY_FILE = path.join(__dirname, '..', '..', 'output', 'rank-history.json');

function loadHistory() {
  try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch { return {}; }
}

function saveHistory(history) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

/**
 * Checks live Google SERP position for each keyword via DataForSEO's
 * SERP API, and diffs against the position we recorded last time we ran
 * this for the same site (stored locally in output/rank-history.json) so
 * the report can show "new this month" and "best movers".
 */
async function getRankings(site) {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new Error('Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in .env');

  const auth = Buffer.from(`${login}:${password}`).toString('base64');
  const { locationCode = 2840, languageCode = 'en' } = site.dataforseo || {};

  const tasks = site.keywords.map(keyword => ({
    keyword,
    location_code: locationCode,
    language_code: languageCode,
    device: 'desktop',
    target: new URL(site.url).hostname
  }));

  const res = await axios.post(
    'https://api.dataforseo.com/v3/serp/google/organic/live/advanced',
    tasks,
    { headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' } }
  );

  const history = loadHistory();
  const prevForSite = history[site.id] || {};
  const nowForSite = {};
  const results = [];

  for (const task of res.data.tasks || []) {
    const keyword = task.data && task.data.keyword;
    const items = (task.result && task.result[0] && task.result[0].items) || [];
    const targetHost = new URL(site.url).hostname.replace(/^www\./, '');
    const match = items.find(it => it.type === 'organic' && (it.domain || '').replace(/^www\./, '') === targetHost);
    const position = match ? match.rank_absolute : null;

    nowForSite[keyword] = position;
    const previousPosition = prevForSite[keyword] ?? null;

    results.push({ keyword, position, previousPosition });
  }

  history[site.id] = nowForSite;
  saveHistory(history);

  return results;
}

module.exports = { getRankings };
