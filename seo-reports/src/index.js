require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { generateReportForSite } = require('./generateReport');
const { sendReportEmail } = require('./sendEmail');

const AGENCY = {
  name: process.env.REPORT_FROM_NAME || 'Your Agency',
  tagline: 'Good Marketing for Good Businesses',
  contactLine: `${process.env.REPORT_FROM_NAME || 'Your Agency'} · ${process.env.REPORT_FROM_EMAIL || ''}`
};

function loadSites() {
  const configPath = path.join(__dirname, '..', 'config', 'sites.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Missing config/sites.json — copy config/sites.example.json and fill in your client details.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

async function run() {
  const onlySiteId = process.argv.includes('--site') ? process.argv[process.argv.indexOf('--site') + 1] : null;
  const skipEmail = process.argv.includes('--no-email');

  const sites = loadSites().filter(s => !onlySiteId || s.id === onlySiteId);
  if (!sites.length) throw new Error(`No matching site found${onlySiteId ? ` for id "${onlySiteId}"` : ''}.`);

  const outputDir = path.join(__dirname, '..', 'output');
  const results = { ok: [], failed: [] };

  for (const site of sites) {
    try {
      console.log(`[${site.id}] generating report...`);
      const { outputPath, data } = await generateReportForSite(site, AGENCY, outputDir);
      console.log(`[${site.id}] PDF ready: ${outputPath}`);

      if (!skipEmail) {
        await sendReportEmail(site, outputPath, data);
        console.log(`[${site.id}] emailed to ${(site.reportTo || []).join(', ')}`);
      }
      results.ok.push(site.id);
    } catch (err) {
      console.error(`[${site.id}] FAILED: ${err.message}`);
      results.failed.push({ id: site.id, error: err.message });
    }
  }

  console.log('\n── Summary ──');
  console.log(`Succeeded: ${results.ok.length} (${results.ok.join(', ') || 'none'})`);
  console.log(`Failed: ${results.failed.length}`);
  results.failed.forEach(f => console.log(`  - ${f.id}: ${f.error}`));

  if (results.failed.length) process.exitCode = 1;
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exitCode = 1;
});
