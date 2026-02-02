# ReadTheDelta

A static, editorial-first macroeconomic data explainer.

## What It Is

ReadTheDelta tracks how key U.S. economic data changes over time, release by release. It answers one question: **what is different now?**

**It is NOT:**
- A dashboard
- A SaaS product
- A news feed
- Investment advice

## Live Site

Deployed on Cloudflare Pages.

## Coverage

| Dataset | Status | Update Frequency |
|---------|--------|------------------|
| Jobs Report | ✅ Live | Monthly (first Friday) |
| Inflation Report | ✅ Live | Monthly (~10th-13th) |

## Project Structure

```
readthedelta/
├── index.html              # Homepage
├── jobs.html               # Jobs Report page
├── inflation.html          # Inflation Report page
├── methodology.html        # Data sources & methods
├── about.html              # About the site
├── legal.html              # Legal disclaimers
├── favicon.ico             # Site favicon
├── data/
│   ├── latest.jobs.json    # Jobs Report data
│   ├── latest.inflation.json # Inflation Report data
│   └── schema.canonical.json # Reference schema
├── src/
│   ├── scripts/
│   │   └── render.js       # Data renderer
│   └── styles/
│       ├── tokens.css      # Design tokens
│       ├── jobs.css        # Data page styles
│       ├── pages.css       # Prose page styles
│       └── home.css        # Homepage styles
├── docs/
│   ├── UPDATE_GUIDE.md     # Safe update procedures
│   ├── SCHEMA.md           # Schema documentation
│   └── STYLE_GUIDE.md      # De-AI writing rules
└── tools/
    └── fetch_bls_jobs.mjs  # BLS data fetcher (future)
```

## Key Features

### Signal Badge

Editorial macro signal displayed as a pill badge:

```
[ State: Decelerating · Pressure: Tight ]
```

**Taxonomy (controlled vocabulary):**
- State: `accelerating` | `decelerating` | `steady` | `contracting`
- Pressure: `tight` | `neutral` | `loose` | `easing`
- Confidence: `high` | `medium` | `low`

### Sparkline Charts

24-month trend lines rendered via Chart.js (loaded dynamically).

### Dynamic Chrome

Header and footer are injected by `render.js` for consistency across all pages.

## Data Schema

See [docs/SCHEMA.md](docs/SCHEMA.md) for the full canonical schema specification.

Key sections:
- `dataset` - Identifies the report type
- `source` - BLS series IDs and attribution
- `release` - Timing metadata
- `headline` - Title, summary, context
- `signal` - Editorial macro signal (protected field)
- `metrics` - Current values
- `comparisons` - Prior release, averages, trends
- `expectations` - Consensus estimates (editorial input)
- `editorial` - What changed, revision notes
- `history` - Previous releases

## Updating Data

See [docs/UPDATE_GUIDE.md](docs/UPDATE_GUIDE.md) for safe update procedures.

**Critical rules:**
1. Never wipe `signal` fields (editorial input only)
2. Never truncate 24-month `trend` arrays
3. Always validate JSON before deploy

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS
- **Charts:** Chart.js 4.x (CDN)
- **Hosting:** Cloudflare Pages
- **Data:** Static JSON files

No build step. No framework. Just files.

## Design Principles

1. **Editorial-first:** Explains what changed, not why
2. **Neutral tone:** No predictions, no investment advice
3. **Institutional aesthetic:** Reuters/Bloomberg explainer style
4. **Minimal:** Rule lines, flush-left, no dashboard chrome
5. **De-AI:** No em-dashes, filler phrases, or AI-tell patterns

## De-AI Writing Rules

Editorial content must avoid patterns that signal AI generation:

- No em-dashes (—). Use commas or parentheses.
- No semicolons in prose.
- No "Furthermore," "Moreover," "Additionally"
- No "It's worth noting" or "Notably"
- Specific numbers over vague descriptors
- Short sentences (under 25 words)

Run `./tools/lint-content.sh` before deploy to validate.

See [docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md) for the full reference.

## Local Development

```bash
# Install dependencies
npm install

# Serve locally
npx serve .

# Validate JSON
npm run validate

# Run content linter
npm run lint
```

## Automation (Newsroom Bot)

The site can be automatically updated via GitHub Actions.

### Architecture

Three-layer data pipeline:

```
Raw Layer        → /data/raw/{dataset}/{yyyy-mm}.json
                   Immutable snapshots from BLS API

Normalized Layer → /data/normalized/{dataset}/{yyyy-mm}.normalized.json
                   Computed deltas, trends, averages

Dataset Layer    → /data/latest.{dataset}.json
                   Production file served to frontend
```

### Scripts

| Script | Purpose |
|--------|---------|
| `scripts/fetch_bls.mjs` | Ingest data from BLS API |
| `scripts/write_update.mjs` | Generate candidate with AI drafting |
| `scripts/review_update.mjs` | Audit candidate for quality |

### Workflow

The GitHub Actions workflow (`.github/workflows/newsroom.yml`):

1. Runs every 30 minutes (cron)
2. Checks BLS API for new data
3. If new data found:
   - Creates release branch
   - Runs Writer Agent (AI drafts editorial)
   - Runs Reviewer Agent (AI audits quality)
4. Decision matrix:
   - **PASS** → Auto-merge to main
   - **FAIL** → Open PR for manual review

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | For AI drafting/review |
| `BLS_API_KEY` | No | Increases BLS rate limits |

Set these as GitHub repository secrets.

### Manual Trigger

```bash
# Trigger workflow manually
gh workflow run newsroom.yml -f dataset=jobs
```

## Deployment

Push to Cloudflare Pages. No build command needed.

## License

Data sourced from U.S. Bureau of Labor Statistics (public domain).
Site content and code: All rights reserved.
