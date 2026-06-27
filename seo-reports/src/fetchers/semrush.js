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
 * Looks up each tracked keyword's current organic position via SEMrush's
 * Analytics API ("phrase_organic" report — top 100 organic results for a
 * keyword), and diffs against the position recorded last time this ran for
 * the same site (output/rank-history.json, shared with the DataForSEO
 * fetcher) to surface new rankings and best movers.
 *
 * Note: this uses pay-per-request API units on your SEMrush plan, not the
 * Position Tracking dashboard product — no project setup needed, just an
 * API key with Analytics API access.
 */
async function getSemrushRankings(site) {
  const apiKey = process.env.SEMRUSH_API_KEY;
  if (!apiKey) throw new Error('Missing SEMRUSH_API_KEY in .env');

  const database = (site.semrush && site.semrush.database) || 'us';
  const targetHost = new URL(site.url).hostname.replace(/^www\./, '');

  const history = loadHistory();
  const prevForSite = history[site.id] || {};
  const nowForSite = {};
  const results = [];

  for (const keyword of site.keywords) {
    const res = await axios.get('https://api.semrush.com/', {
      params: {
        type: 'phrase_organic',
        key: apiKey,
        phrase: keyword,
        database,
        export_columns: 'Dn,Po,Ur',
        display_limit: 100
      }
    });

    const lines = String(res.data).trim().split('\n').slice(1); // drop header row
    let position = null;
    for (const line of lines) {
      const [domain, pos] = line.split(';');
      if (domain && domain.replace(/^www\./, '') === targetHost) {
        position = Number(pos);
        break;
      }
    }

    nowForSite[keyword] = position;
    const previousPosition = prevForSite[keyword] ?? null;
    results.push({ keyword, position, previousPosition });
  }

  history[site.id] = nowForSite;
  saveHistory(history);

  return results;
}

module.exports = { getSemrushRankings };
