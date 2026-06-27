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

  return { topRankings, newRankings, movers };
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
