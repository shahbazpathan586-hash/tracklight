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
