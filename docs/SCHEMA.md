# ReadTheDelta Canonical JSON Schema

## Overview

This document defines the authoritative JSON schema for all ReadTheDelta datasets. This schema supersedes all prior schemas.

**Governance Rules:**
- This canonical schema is the single source of truth
- Older schemas must not be extended, merged, or referenced
- The schema is a structural contract, not a place to hardcode data
- All values in dataset JSON files are replaceable per release

---

## Top-Level Structure

```json
{
  "dataset": {},
  "source": {},
  "release": {},
  "headline": {},
  "signal": {},
  "metrics": {},
  "comparisons": {},
  "expectations": {},
  "editorial": {},
  "history": {},
  "methodology_notes": {}
}
```

---

## Section Definitions

### dataset

Identifies the dataset type.

```json
{
  "dataset": {
    "id": "jobs",
    "name": "U.S. Jobs Report",
    "category": "Economy",
    "frequency": "monthly"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., "jobs", "inflation") |
| `name` | string | Human-readable name |
| `category` | string | Topic category |
| `frequency` | string | Update frequency |

---

### source

Official data source attribution.

```json
{
  "source": {
    "agency": "Bureau of Labor Statistics",
    "url": "https://www.bls.gov/news.release/empsit.nr0.htm",
    "series_ids": {
      "payrolls": "CES0000000001",
      "unemployment": "LNS14000000",
      "wages": "CES0500000003"
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `agency` | string | Source agency name |
| `url` | string | Link to official release |
| `series_ids` | object | BLS series IDs per metric |

---

### release

Release timing metadata.

```json
{
  "release": {
    "date": "2026-01-10",
    "reference_period": "December 2025",
    "next_release": "2026-02-07",
    "generated_at": "2026-01-22T21:00:00.000Z"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `date` | string (ISO date) | Official release date |
| `reference_period` | string | Data period covered |
| `next_release` | string (ISO date) | Next scheduled release |
| `generated_at` | string (ISO timestamp) | When JSON was last updated |

---

### headline

Editorial headline content.

```json
{
  "headline": {
    "title": "Hiring Picks Up as Unemployment Edges Higher",
    "summary": "Employers added 165,000 jobs, up from the prior month, while the unemployment rate rose to 3.9 percent.",
    "context": "Monthly job figures shape employer hiring decisions..."
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `title` | string | Headline (neutral, factual) |
| `summary` | string | Lede paragraph |
| `context` | string | "Why It Matters" explanation |

---

### signal

Editorial macro signal (controlled vocabulary).

```json
{
  "signal": {
    "_note": "Editorial input. Optional in Phase 1.",
    "state": "decelerating",
    "pressure": "tight",
    "confidence": "medium"
  }
}
```

| Field | Type | Allowed Values |
|-------|------|----------------|
| `_note` | string | Documentation (preserved) |
| `state` | string | `accelerating` \| `decelerating` \| `steady` \| `contracting` |
| `pressure` | string | `tight` \| `neutral` \| `loose` \| `easing` |
| `confidence` | string | `high` \| `medium` \| `low` |

**Rules:**
- Signal is ALWAYS editorial input (never automated)
- Empty strings are allowed to preserve schema shape
- Do not invent signals from raw data

---

### metrics

Current values for each tracked metric.

```json
{
  "metrics": {
    "payrolls": {
      "label": "Monthly Job Change",
      "qualifier": "Nonfarm Payrolls",
      "value": 165,
      "unit": "thousands",
      "precision": 0
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `label` | string | Display label |
| `qualifier` | string | Secondary label |
| `value` | number | Current value |
| `unit` | string | `thousands` \| `percent` \| `dollars` |
| `precision` | number | Decimal places for display |

**Metric keys by dataset:**

| Dataset | Keys |
|---------|------|
| Jobs | `payrolls`, `unemployment`, `wages` |
| Inflation | `cpi_yoy`, `cpi_mom`, `core_yoy` |

---

### comparisons

Historical context and trends.

```json
{
  "comparisons": {
    "prior_release": {
      "date": "2025-12-06",
      "reference_period": "November 2025",
      "payrolls": {
        "value": 143,
        "delta": 22
      }
    },
    "twelve_month_average": {
      "payrolls": 182,
      "unemployment": 3.9,
      "wages": 4.2
    },
    "trend": {
      "payrolls": [256, 210, 175, ...],
      "unemployment": [3.7, 3.7, 3.8, ...],
      "wages": [4.4, 4.3, 4.3, ...],
      "months": 24
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `prior_release` | object | Previous release comparison |
| `twelve_month_average` | object | Rolling averages |
| `trend` | object | 24-month value arrays |

**Trend array rules:**
- Must contain exactly 24 values
- Oldest value at index 0, newest at index 23
- Append new, remove oldest on update

---

### expectations

Consensus estimates (editorial input).

```json
{
  "expectations": {
    "_note": "Editorial input. Values sourced manually from consensus surveys.",
    "payrolls": {
      "consensus": 170,
      "range_low": 150,
      "range_high": 190
    },
    "unemployment": {
      "consensus": 3.8
    }
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `_note` | string | Marks as editorial input |
| `[metric].consensus` | number | Median estimate |
| `[metric].range_low` | number | Low end (optional) |
| `[metric].range_high` | number | High end (optional) |

**Rules:**
- Expectations are ALWAYS manual/editorial input
- Never treated as first-party data
- Source implied as consensus/news-based

---

### editorial

Editor-written content.

```json
{
  "editorial": {
    "what_changed": "Payrolls rose by 165,000, a +22,000 rebound from the prior month, though this slightly missed the consensus forecast of 170,000.",
    "what_didnt": "Wage growth held firm at 4.1 percent year-over-year, defying expectations for a slowdown.",
    "why_it_matters": "The mixed signal (better hiring but rising unemployment) suggests the labor market is softening without collapsing.",
    "revision_note": "Prior month payrolls revised down by 7,000.",
    "editor_note": ""
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `what_changed` | string | Summary of changes with specific deltas |
| `what_didnt` | string | What remained stable or defied expectations |
| `why_it_matters` | string | Interpretive context for the release |
| `revision_note` | string | Notes on data revisions |
| `editor_note` | string | Additional editorial notes |

**Rules:**
- All fields are single strings (not arrays)
- Empty strings are allowed
- Tone must be neutral and factual
- Include specific numbers and deltas, not vague descriptors

---

### history

Archive of previous releases.

```json
{
  "history": {
    "previous_releases": [
      { "date": "2025-12-06", "label": "December 6, 2025" },
      { "date": "2025-11-01", "label": "November 1, 2025" },
      { "date": "2025-10-04", "label": "October 4, 2025" }
    ]
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `previous_releases` | array | List of past releases |
| `[].date` | string | Release date |
| `[].label` | string | Formatted display label |

---

### methodology_notes

Per-metric definitions.

```json
{
  "methodology_notes": {
    "payrolls": "Monthly change in total nonfarm employment. Seasonally adjusted.",
    "unemployment": "Percentage of labor force that is jobless and actively seeking work.",
    "wages": "Year-over-year percent change in average hourly earnings."
  }
}
```

---

## Renderer Compatibility

The `render.js` script maps schema fields to HTML elements:

| Schema Path | HTML Element |
|-------------|--------------|
| `release.date` | `#release-date` |
| `release.generated_at` | `#generated-at` |
| `headline.title` | `#headline` |
| `headline.summary` | `#lede` |
| `headline.context` | `#why-it-matters-text` |
| `signal.*` | `.signal-badge` (injected) |
| `metrics[key].value` | `#${key}-value` |
| `comparisons.prior_release[key].delta` | `#${key}-delta` |
| `comparisons.twelve_month_average[key]` | `#${key}-context` |
| `comparisons.trend[key]` | `.sparkline-wrap[data-series="${key}"]` |
| `editorial.what_changed` | `.change-list` |
| `history.previous_releases` | `.release-list` |
| `release.next_release` | `#next-release` |

**Note:** HTML IDs match JSON keys exactly (e.g., `cpi_yoy` → `#cpi_yoy-value`). No casing conversion is performed.
