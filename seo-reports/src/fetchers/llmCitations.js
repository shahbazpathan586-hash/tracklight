const axios = require('axios');

/**
 * Sends each configured prompt to ChatGPT and Perplexity, then checks
 * whether the response mentions any of the site's brand terms/domain.
 * Google AI Overview has no public API, so it's reported manually
 * ("check Google search with AI Overview on") unless DataForSEO's
 * AI Overview endpoint is enabled for the account.
 */
async function checkOpenAI(prompts, brandTerms) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return prompts.map(p => ({ prompt: p, cited: false, skipped: true }));

  const out = [];
  for (const prompt of prompts) {
    const res = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: prompt }] },
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const text = res.data.choices?.[0]?.message?.content || '';
    const cited = brandTerms.some(term => text.toLowerCase().includes(term.toLowerCase()));
    out.push({ prompt, cited, snippet: text.slice(0, 200) });
  }
  return out;
}

async function checkPerplexity(prompts, brandTerms) {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return prompts.map(p => ({ prompt: p, cited: false, skipped: true }));

  const out = [];
  for (const prompt of prompts) {
    const res = await axios.post(
      'https://api.perplexity.ai/chat/completions',
      { model: 'sonar', messages: [{ role: 'user', content: prompt }] },
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const text = res.data.choices?.[0]?.message?.content || '';
    const cited = brandTerms.some(term => text.toLowerCase().includes(term.toLowerCase()));
    out.push({ prompt, cited, snippet: text.slice(0, 200) });
  }
  return out;
}

function summarize(results, platformName, icon) {
  const skipped = results.every(r => r.skipped);
  const citedCount = results.filter(r => r.cited).length;

  if (skipped) {
    return {
      name: platformName,
      icon,
      statusLabel: 'NOT CONFIGURED',
      citedClass: 'ai-not-cited',
      detail: `No API key set for ${platformName} — add it to .env to enable automatic checks.`
    };
  }
  if (citedCount > 0) {
    return {
      name: platformName,
      icon,
      statusLabel: 'CITED THIS MONTH',
      citedClass: 'ai-cited',
      detail: `Cited in ${citedCount}/${results.length} tracked prompts this month.`
    };
  }
  return {
    name: platformName,
    icon,
    statusLabel: 'BUILDING VISIBILITY',
    citedClass: 'ai-not-cited',
    detail: 'Actively building the citation signals needed to appear here.'
  };
}

async function getLlmVisibility(site) {
  const { brandTerms = [], prompts = [] } = site.llmCheck || {};
  if (!prompts.length) {
    return [
      { name: 'ChatGPT', icon: '💬', statusLabel: 'NOT CONFIGURED', citedClass: 'ai-not-cited', detail: 'Add llmCheck.prompts in sites.json to enable.' },
      { name: 'Perplexity', icon: '🔍', statusLabel: 'NOT CONFIGURED', citedClass: 'ai-not-cited', detail: 'Add llmCheck.prompts in sites.json to enable.' },
      { name: 'Google AI Overview', icon: '✨', statusLabel: 'MANUAL CHECK', citedClass: 'ai-not-cited', detail: 'No public API — check manually via Google search.' }
    ];
  }

  const [openaiResults, perplexityResults] = await Promise.all([
    checkOpenAI(prompts, brandTerms),
    checkPerplexity(prompts, brandTerms)
  ]);

  return [
    summarize(openaiResults, 'ChatGPT', '💬'),
    summarize(perplexityResults, 'Perplexity', '🔍'),
    { name: 'Google AI Overview', icon: '✨', statusLabel: 'MANUAL CHECK', citedClass: 'ai-not-cited', detail: 'No public API for AI Overview — check manually or enable DataForSEO\'s AI Overview endpoint.' }
  ];
}

module.exports = { getLlmVisibility };
