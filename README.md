# ReadTheDelta.com

A calm, editorial explainer for US economic data. Starting with the BLS Jobs Report.

## Philosophy

- **Editorial System, Not Dashboard**: The data tells a story. The UI gets out of the way.
- **Separation of Concerns**: Data (`.json`) drives Content (`.html`). All calculations occur in the fetch script.
- **Read-Only Artifact**: Zero interactivity. The page is a static document.
- **Calm Design**: Whitespace and typography over complexity.

## Project Structure

```
readthedelta/
├── data/
│   ├── schema.jobs.json      # JSON schema definition
│   └── latest.jobs.json      # Generated data artifact
├── src/
│   ├── pages/
│   │   └── jobs.html         # Jobs report page
│   ├── scripts/
│   │   └── render.js         # Frontend rendering logic
│   └── styles/
│       └── tokens.css        # Design tokens
├── tools/
│   └── fetch_bls_jobs.mjs    # BLS data fetcher
└── README.md
```

## Usage

### Fetch Data

```bash
# Without API key (10 requests/day limit)
node tools/fetch_bls_jobs.mjs

# With API key (500 requests/day limit)
BLS_API_KEY=your_key_here node tools/fetch_bls_jobs.mjs
```

The script will:
1. Attempt to fetch live data from BLS API
2. Fall back to realistic placeholder data if API is unreachable
3. Calculate delta, 12-month average, and min/max range
4. Output to `data/latest.jobs.json`

### Edit Narrative

After running the fetch script, edit `data/latest.jobs.json` to fill in:
- `meta.releaseDate` - Date of the BLS release (YYYY-MM-DD)
- `meta.nextRelease` - Expected next release date
- `narrative.headline` - Neutral factual headline
- `narrative.lede` - Contextual summary
- `narrative.whyItMatters` - Educational anchor (keep under 50 words)

### Serve Locally

```bash
# Any static server works
npx serve .
# or
python3 -m http.server 8000
```

## BLS Series

| Metric | Series ID | Unit |
|--------|-----------|------|
| Total Nonfarm Payroll | CES0000000001 | thousands |
| Unemployment Rate | LNS14000000 | percent |
| Avg Hourly Earnings | CES0500000003 | dollars |

## Data Schema

See `data/schema.jobs.json` for the complete schema definition.

Key structure:
- `meta` - Release dates, generation timestamp, data source flag
- `narrative` - Headline, lede, whyItMatters (human-edited)
- `series` - payrolls, unemployment, wages (each with value, delta, trend, context)

## De-AI Writing Rules

For narrative fields, follow these rules:
- No em-dashes. Use periods. Break thoughts cleanly.
- No smoothing transitions ("While X, Y..."). Use juxtaposition.
- No filler adjectives ("notable," "significant," "meaningful").
- `whyItMatters` must be under 50 words.