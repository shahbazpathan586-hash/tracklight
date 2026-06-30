// Renders a sample PDF straight from the template using mock data, so the
// design can be checked without any API keys configured.
const path = require('path');
const { renderPdf } = require('./generateReport');

const data = {
  agencyName: 'GOOD MARKETING',
  agencyTagline: 'Good Marketing for Good Businesses',
  agencyContactLine: 'The Good Marketing Team · questions@thegoodmarketingteam.com',
  clientName: 'Lisa Minardi',
  url: 'https://italyculinaryvacations.com/',
  monthLabel: 'APRIL 2026',
  year: 2026,
  heroHeadline: "Lisa Minardi is ranking higher and showing up where it matters most.",
  kpis: [
    { label: 'Google Clicks', value: 842, delta: '▲ 18.4%', deltaColor: '#2f6b46' },
    { label: 'Sessions', value: 2310, delta: '▲ 9.1%', deltaColor: '#2f6b46' },
    { label: 'Conversions', value: 37, delta: '▼ 2.0%', deltaColor: '#b03a2e' },
    { label: 'Avg. Position', value: '7.4', delta: '', deltaColor: '#888' }
  ],
  topRankings: [
    { position: 1, keyword: 'cooking lessons italy vacation', colorClass: '', changeClass: 'up', changeLabel: '▲ 2' },
    { position: 1, keyword: 'all inclusive cooking vacations italy', colorClass: '', changeClass: 'up', changeLabel: '▲ 2' },
    { position: 2, keyword: 'italian cooking vacation', colorClass: 'green', changeClass: 'up', changeLabel: '▲ 2' }
  ],
  newRankings: [
    { position: 4, keyword: 'cooking tours italy' },
    { position: 3, keyword: 'italy food vacation' },
    { position: 2, keyword: 'italy tour packages with cooking classes' }
  ],
  movers: [
    { keyword: 'culinary vacations packages', from: 31, to: 5, delta: 26 },
    { keyword: 'cooking holidays italy', from: 26, to: 15, delta: 11 }
  ],
  gscPanel: {
    host: 'italyculinaryvacations.com',
    rows: [
      { keyword: 'culinary vacations packages', clicks: 19, clicksDiff: { label: '▲ 19', cls: 'd-up' }, impressions: 884, impressionsDiff: { label: '▲ 213', cls: 'd-up' }, ctr: '2.1%', position: 5, positionDiff: { label: '▲ 26', cls: 'd-up' }, highlighted: true },
      { keyword: 'cooking holidays italy', clicks: 7, clicksDiff: { label: '▲ 5', cls: 'd-up' }, impressions: 412, impressionsDiff: { label: '▲ 88', cls: 'd-up' }, ctr: '1.7%', position: 15, positionDiff: { label: '▲ 11', cls: 'd-up' }, highlighted: true },
      { keyword: 'cooking tours italy', clicks: 0, clicksDiff: { label: '0', cls: 'd-zero' }, impressions: 120, impressionsDiff: { label: '▲ 120', cls: 'd-up' }, ctr: '0.0%', position: 4, positionDiff: { label: 'NEW', cls: 'd-new' }, highlighted: false },
      { keyword: 'italian cooking vacation', clicks: 12, clicksDiff: { label: '▲ 3', cls: 'd-up' }, impressions: 540, impressionsDiff: { label: '▼ 30', cls: 'd-down' }, ctr: '2.2%', position: 2, positionDiff: { label: '▲ 2', cls: 'd-up' }, highlighted: true },
      { keyword: 'cooking lessons italy vacation', clicks: 24, clicksDiff: { label: '▲ 6', cls: 'd-up' }, impressions: 910, impressionsDiff: { label: '▲ 140', cls: 'd-up' }, ctr: '2.6%', position: 1, positionDiff: { label: '▲ 2', cls: 'd-up' }, highlighted: true }
    ]
  },
  ga4Panel: {
    metrics: [
      { label: 'Sessions', value: '2,310', diff: { label: '▲ 9.1%', color: '#2f6b46' } },
      { label: 'Total Users', value: '1,847', diff: { label: '▲ 12.4%', color: '#2f6b46' } },
      { label: 'Conversions', value: '37', diff: { label: '▼ 2.0%', color: '#b03a2e' } },
      { label: 'Engagement Rate', value: '64.2%', diff: { label: '▲ 3.3%', color: '#2f6b46' } }
    ]
  },
  aiPlatforms: [
    { name: 'ChatGPT', icon: '💬', statusLabel: 'BUILDING VISIBILITY', citedClass: 'ai-not-cited', detail: 'Actively building the citation signals needed to appear here.' },
    { name: 'Perplexity', icon: '🔍', statusLabel: 'BUILDING VISIBILITY', citedClass: 'ai-not-cited', detail: 'Actively building the citation signals needed to appear here.' },
    { name: 'Google AI Overview', icon: '✨', statusLabel: 'MANUAL CHECK', citedClass: 'ai-not-cited', detail: 'No public API for AI Overview — check manually.' }
  ],
  notesDone: ['Published 2 new blog posts targeting cooking vacation keywords', 'Fixed 14 technical SEO issues flagged by Search Console', 'Built 6 new backlinks from travel publications'],
  notesNext: ['Launch schema markup for recipe/tour pages', 'Expand content cluster around "Italy food tours"', 'Start outreach for 5 more guest post placements'],
  notesPending: ['Waiting on client to approve new homepage copy']
};

(async () => {
  const outputPath = path.join(__dirname, '..', 'output', 'preview.pdf');
  await renderPdf(data, outputPath);
  console.log('Preview PDF written to', outputPath);
})();
