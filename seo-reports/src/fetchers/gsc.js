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

module.exports = { getGscSummary };
