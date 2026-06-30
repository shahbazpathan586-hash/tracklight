const { google } = require('googleapis');
const { getAuth } = require('../googleAuth');

/**
 * Pulls Search Console totals for the reporting month vs. the prior month,
 * so the report can show clicks/impressions/avg-position deltas.
 */
async function getGscSummary(site, { startDate, endDate, prevStartDate, prevEndDate }) {
  const auth = getAuth(['https://www.googleapis.com/auth/webmasters.readonly']);
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const queryTotals = async (start, end) => {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: site.gscSiteUrl,
      requestBody: { startDate: start, endDate: end, dimensions: [] }
    });
    const row = (res.data.rows || [])[0];
    return row
      ? { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position }
      : { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  };

  const [current, previous] = await Promise.all([
    queryTotals(startDate, endDate),
    queryTotals(prevStartDate, prevEndDate)
  ]);

  return { current, previous };
}

/**
 * Free alternative to a paid SERP-checking API: pulls each tracked keyword's
 * average position directly from Search Console's own per-query data for
 * the current and previous period, in the same {keyword, position,
 * previousPosition} shape the report builder expects.
 */
async function getGscKeywordRankings(site, { startDate, endDate, prevStartDate, prevEndDate }) {
  const auth = getAuth(['https://www.googleapis.com/auth/webmasters.readonly']);
  const searchconsole = google.searchconsole({ version: 'v1', auth });

  const queryMetrics = async (start, end) => {
    const res = await searchconsole.searchanalytics.query({
      siteUrl: site.gscSiteUrl,
      requestBody: {
        startDate: start,
        endDate: end,
        dimensions: ['query'],
        rowLimit: 5000
      }
    });
    const map = new Map();
    for (const row of res.data.rows || []) {
      map.set(row.keys[0].toLowerCase(), {
        position: Math.round(row.position),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr
      });
    }
    return map;
  };

  const [currentMap, previousMap] = await Promise.all([
    queryMetrics(startDate, endDate),
    queryMetrics(prevStartDate, prevEndDate)
  ]);

  return site.keywords.map(keyword => {
    const key = keyword.toLowerCase();
    const cur = currentMap.get(key) || null;
    const prev = previousMap.get(key) || null;
    return {
      keyword,
      position: cur ? cur.position : null,
      previousPosition: prev ? prev.position : null,
      clicks: cur ? cur.clicks : 0,
      previousClicks: prev ? prev.clicks : 0,
      impressions: cur ? cur.impressions : 0,
      previousImpressions: prev ? prev.impressions : 0,
      ctr: cur ? cur.ctr : 0,
      previousCtr: prev ? prev.ctr : 0
    };
  });
}

module.exports = { getGscSummary, getGscKeywordRankings };
