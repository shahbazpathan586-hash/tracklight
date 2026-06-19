const { google } = require('googleapis');
const { getAuth } = require('../googleAuth');

/**
 * Pulls GA4 sessions/users/conversions for the reporting month vs prior month
 * via the Analytics Data API (runReport).
 */
async function getGa4Summary(site, { startDate, endDate, prevStartDate, prevEndDate }) {
  const auth = getAuth(['https://www.googleapis.com/auth/analytics.readonly']);
  const analyticsdata = google.analyticsdata({ version: 'v1beta', auth });
  const property = `properties/${site.ga4PropertyId}`;

  const runTotals = async (start, end) => {
    const res = await analyticsdata.properties.runReport({
      property,
      requestBody: {
        dateRanges: [{ startDate: start, endDate: end }],
        metrics: [
          { name: 'sessions' },
          { name: 'totalUsers' },
          { name: 'conversions' },
          { name: 'engagementRate' }
        ]
      }
    });
    const row = res.data.rows && res.data.rows[0];
    if (!row) return { sessions: 0, users: 0, conversions: 0, engagementRate: 0 };
    const [sessions, users, conversions, engagementRate] = row.metricValues.map(m => Number(m.value));
    return { sessions, users, conversions, engagementRate };
  };

  const [current, previous] = await Promise.all([
    runTotals(startDate, endDate),
    runTotals(prevStartDate, prevEndDate)
  ]);

  return { current, previous };
}

module.exports = { getGa4Summary };
