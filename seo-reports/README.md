# SEO Monthly Report Automation

Generates a branded, client-ready monthly SEO performance PDF (same layout as
your Good Marketing / Italy Culinary Vacations report — hero card, ranking
cards, position movers, AI search visibility, progress notes) for every site
you manage, and emails it out automatically.

Runs each site through:

1. **Google Search Console** — clicks, impressions, avg. position (this month vs. last)
2. **Google Analytics 4** — sessions, users, conversions
3. **DataForSEO** — live Google SERP position per tracked keyword, diffed against last run to find new rankings and best movers
4. **Google Docs** — reads your team's monthly notes doc and splits it into "Completed / Next / Pending" by heading
5. **ChatGPT + Perplexity APIs** — checks whether the client's brand/domain is mentioned in answers to a few tracked prompts (Google AI Overview has no public API, so it's flagged as a manual check)
6. **Puppeteer** — renders the filled template to PDF
7. **Nodemailer** — emails the PDF to the agency contact(s)

## Setup

```bash
cd seo-reports
npm install
cp .env.example .env            # fill in real credentials
cp config/sites.example.json config/sites.json   # add your real clients
```

### 1. Google service account (GSC + GA4 + Docs)

- Create a service account in Google Cloud Console, enable the **Search
  Console API**, **Google Analytics Data API**, and **Google Docs API**.
- Download its JSON key → put the `client_email` and `private_key` into `.env`.
- For **each client site**: add the service account email as a restricted/viewer user on their GSC property and GA4 property, and share their monthly notes Google Doc with it (Viewer access).

### 2. DataForSEO (rank tracking)

- Sign up at dataforseo.com, grab API login/password from the dashboard, put in `.env`.
- Pay-per-query — cheaper than SEMrush/Ahrefs API tiers at ~30 sites.

### 3. LLM citation checks (optional)

- Add `OPENAI_API_KEY` and/or `PERPLEXITY_API_KEY` to `.env`. If left blank, that platform's card shows "NOT CONFIGURED" instead of failing the whole report.
- Google AI Overview has no public API — that card always shows as a manual check.

### 4. Email delivery

- Fill in `SMTP_HOST/PORT/USER/PASS` (Gmail app password, SendGrid SMTP, etc.) and `REPORT_FROM_*` in `.env`.

### 5. `config/sites.json`

One entry per client site — see `config/sites.example.json` for the shape. Key fields:

| Field | Purpose |
|---|---|
| `gscSiteUrl` | exact property URL as it appears in Search Console |
| `ga4PropertyId` | numeric GA4 property ID |
| `googleDocId` | the ID from the notes doc's URL |
| `keywords` | keywords to rank-check on Google each month |
| `llmCheck.prompts` / `llmCheck.brandTerms` | what to ask ChatGPT/Perplexity and what counts as a "citation" |
| `reportTo` | email recipients for this site's report |

## Running it

```bash
# Preview the PDF design with mock data (no credentials needed)
node src/preview.js

# Generate + email reports for every site in config/sites.json
node src/index.js

# Just one site, no email (useful while testing a new client)
node src/index.js --site italyculinaryvacations --no-email
```

Generated PDFs land in `output/`. Rank history (used to detect new rankings
and movers month over month) is stored in `output/rank-history.json` — don't
delete it between runs, that's what makes "▲ 2" deltas possible.

## Scheduling — runs automatically on the 27th

`.github/workflows/monthly-seo-report.yml` runs this on GitHub Actions at
09:00 UTC on the 27th of every month. Add all the `.env` values as **repository
secrets** (Settings → Secrets and variables → Actions) with the same names,
and commit your real `config/sites.json` (or load it from a secret/private
source if it contains sensitive client data).

You can also trigger it manually any time from the Actions tab
("Run workflow") to test before the 27th rolls around.

## Notes on accuracy

- Position deltas and "new rankings" depend on having a previous run's data in `rank-history.json` — the very first report for a site won't show movers, only current positions.
- If a fetcher fails for one site (bad GSC permission, wrong GA4 ID, etc.) the script logs the error and continues with the remaining sites — check the run summary at the end for failures instead of assuming all 30 sites succeeded.
