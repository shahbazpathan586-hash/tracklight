const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const puppeteer = require('puppeteer');

const { getGscSummary, getGscKeywordRankings } = require('./fetchers/gsc');
const { getGa4Summary } = require('./fetchers/ga4');
const { getRankings } = require('./fetchers/ranks');
const { getSemrushRankings } = require('./fetchers/semrush');
const { getDocNotes } = require('./fetchers/docNotes');
const { getLlmVisibility } = require('./fetchers/llmCitations');

/**
 * Rank source defaults to Search Console's own per-query position data
 * (free, no API key needed). Set rankSource: "dataforseo" or "semrush" on
 * a site in sites.json to use a live SERP-checking API instead.
 */
function getRankFetcher(site) {
  if (site.rankSource === 'dataforseo') return getRankings;
  if (site.rankSource === 'semrush') return getSemrushRankings;
  return getGscKeywordRankings;
}

function monthRange(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const prevStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const prevEnd = new Date(date.getFullYear(), date.getMonth(), 0);
  const fmt = d => d.toISOString().slice(0, 10);
  return {
    startDate: fmt(start), endDate: fmt(end),
    prevStartDate: fmt(prevStart), prevEndDate: fmt(prevEnd),
    monthLabel: start.toLocaleString('en-US', { month: 'long', year: 'numeric' }).toUpperCase(),
    year: start.getFullYear()
  };
}

function pctDelta(current, previous) {
  if (!previous) return { label: '—', color: '#888' };
  const change = ((current - previous) / previous) * 100;
  const sign = change >= 0 ? '▲' : '▼';
  const color = change >= 0 ? '#2f6b46' : '#b03a2e';
  return { label: `${sign} ${Math.abs(change).toFixed(1)}%`, color };
}

function buildKpis(gsc, ga4) {
  const clicksDelta = pctDelta(gsc.current.clicks, gsc.previous.clicks);
  const kpis = [
    { label: 'Google Clicks', value: Math.round(gsc.current.clicks), delta: clicksDelta.label, deltaColor: clicksDelta.color },
    { label: 'Avg. Position', value: gsc.current.position.toFixed(1), delta: '', deltaColor: '#888' }
  ];
  if (ga4) {
    const sessionsDelta = pctDelta(ga4.current.sessions, ga4.previous.sessions);
    const conversionsDelta = pctDelta(ga4.current.conversions, ga4.previous.conversions);
    kpis.splice(1, 0,
      { label: 'Sessions', value: Math.round(ga4.current.sessions), delta: sessionsDelta.label, deltaColor: sessionsDelta.color },
      { label: 'Conversions', value: Math.round(ga4.current.conversions), delta: conversionsDelta.label, deltaColor: conversionsDelta.color }
    );
  }
  return kpis;
}

function buildRankingSections(rankResults) {
  const ranked = rankResults.filter(r => r.position != null);

  const topRankings = ranked
    .sort((a, b) => a.position - b.position)
    .slice(0, 6)
    .map(r => {
      const improved = r.previousPosition != null && r.position < r.previousPosition;
      const change = r.previousPosition != null ? r.previousPosition - r.position : null;
      return {
        position: r.position,
        keyword: r.keyword,
        colorClass: r.position <= 3 ? '' : 'green',
        changeClass: change > 0 ? 'up' : change < 0 ? 'down' : '',
        changeLabel: change ? `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}` : 'NEW'
      };
    });

  const newRankings = ranked
    .filter(r => r.previousPosition == null)
    .map(r => ({ position: r.position, keyword: r.keyword }));

  const movers = ranked
    .filter(r => r.previousPosition != null && r.position < r.previousPosition)
    .map(r => ({ keyword: r.keyword, from: r.previousPosition, to: r.position, delta: r.previousPosition - r.position }))
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 5);

  const supportingRows = ranked
    .map(r => {
      const diff = r.previousPosition != null ? r.previousPosition - r.position : null;
      return {
        keyword: r.keyword,
        previousPosition: r.previousPosition,
        position: r.position,
        diff,
        isNew: r.previousPosition == null,
        highlighted: diff != null && diff > 0
      };
    })
    .sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0));

  return { topRankings, newRankings, movers, supportingRows };
}

function fmtPct(v) {
  return `${(v * 100).toFixed(1)}%`;
}

function diffCell(current, previous, { invert = false } = {}) {
  const change = current - previous;
  if (!change) return { label: '0', cls: 'd-zero' };
  // invert=true means "lower is better" (e.g. position)
  const good = invert ? change < 0 : change > 0;
  const arrow = change > 0 ? '▲' : '▼';
  return { label: `${arrow} ${Math.abs(Math.round(change * 100) / 100)}`, cls: good ? 'd-up' : 'd-down' };
}

/**
 * Builds a panel that mirrors the Google Search Console "Performance"
 * table (with Compare mode columns + a faux browser/sidebar chrome), from
 * the same per-keyword API metrics — so the report shows a dashboard-style
 * graphic generated from real data instead of a manual screenshot.
 * Returns null for non-GSC rank sources (no per-keyword clicks/impressions).
 */
function buildGscPanel(rankResults, site) {
  const hasMetrics = rankResults.some(r => r.clicks !== undefined);
  if (!hasMetrics) return null;

  const rows = rankResults.map(r => {
    const posDiff = r.previousPosition != null && r.position != null
      ? r.previousPosition - r.position : null;
    return {
      keyword: r.keyword,
      clicks: Math.round(r.clicks || 0),
      clicksDiff: diffCell(r.clicks || 0, r.previousClicks || 0),
      impressions: Math.round(r.impressions || 0),
      impressionsDiff: diffCell(r.impressions || 0, r.previousImpressions || 0),
      ctr: fmtPct(r.ctr || 0),
      position: r.position != null ? r.position : '—',
      positionDiff: r.position != null && r.previousPosition != null
        ? diffCell(r.position, r.previousPosition, { invert: true })
        : { label: r.position != null ? 'NEW' : '—', cls: 'd-new' },
      highlighted: posDiff != null && posDiff > 0
    };
  });

  let host = site.url;
  try { host = new URL(site.url).hostname; } catch {}

  return { host, rows };
}

/**
 * Builds a GA4-styled metrics panel (sessions / users / conversions /
 * engagement) for the reporting month vs. the prior month. Returns null
 * when GA4 isn't connected for the site.
 */
function buildGa4Panel(ga4) {
  if (!ga4) return null;
  const metric = (label, cur, prev, isPct = false) => ({
    label,
    value: isPct ? fmtPct(cur) : Math.round(cur).toLocaleString('en-US'),
    diff: pctDelta(cur, prev)
  });
  return {
    metrics: [
      metric('Sessions', ga4.current.sessions, ga4.previous.sessions),
      metric('Total Users', ga4.current.users, ga4.previous.users),
      metric('Conversions', ga4.current.conversions, ga4.previous.conversions),
      metric('Engagement Rate', ga4.current.engagementRate, ga4.previous.engagementRate, true)
    ]
  };
}

function buildHeroHeadline(site, rankingSections) {
  if (rankingSections.movers.length) {
    return `${site.clientName} is ranking higher and showing up where it matters most.`;
  }
  if (rankingSections.topRankings.length) {
    return `${site.clientName} continues to hold strong rankings on Google this month.`;
  }
  return `We're actively building ${site.clientName}'s visibility on Google this month.`;
}

async function gatherData(site, agency) {
  const range = monthRange();

  const fetchRankings = getRankFetcher(site);
  const [gsc, ga4, rankResults, notes, aiPlatforms] = await Promise.all([
    getGscSummary(site, range),
    site.ga4PropertyId ? getGa4Summary(site, range) : Promise.resolve(null),
    fetchRankings(site, range),
    getDocNotes(site),
    getLlmVisibility(site)
  ]);

  const rankingSections = buildRankingSections(rankResults);

  return {
    agencyName: agency.name,
    agencyTagline: agency.tagline,
    agencyContactLine: agency.contactLine,
    clientName: site.clientName,
    url: site.url,
    monthLabel: range.monthLabel,
    year: range.year,
    heroHeadline: buildHeroHeadline(site, rankingSections),
    kpis: buildKpis(gsc, ga4),
    ...rankingSections,
    gscPanel: buildGscPanel(rankResults, site),
    ga4Panel: buildGa4Panel(ga4),
    aiPlatforms,
    notesDone: notes.done.length ? notes.done : ['No notes added for this period yet.'],
    notesNext: notes.next.length ? notes.next : ['No notes added for this period yet.'],
    notesPending: notes.pending
  };
}

async function renderPdf(data, outputPath) {
  const templatePath = path.join(__dirname, 'template.html');
  const templateSource = fs.readFileSync(templatePath, 'utf8');
  const template = Handlebars.compile(templateSource);
  const html = template(data);

  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    await page.pdf({ path: outputPath, format: 'A4', printBackground: true });
  } finally {
    await browser.close();
  }
  return outputPath;
}

async function generateReportForSite(site, agency, outputDir) {
  const data = await gatherData(site, agency);
  const outputPath = path.join(outputDir, `${site.id}-${data.monthLabel.replace(/\s+/g, '-').toLowerCase()}.pdf`);
  await renderPdf(data, outputPath);
  return { outputPath, data };
}

module.exports = { generateReportForSite, gatherData, renderPdf, monthRange };
