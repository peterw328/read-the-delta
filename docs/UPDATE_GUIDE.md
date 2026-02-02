# ReadTheDelta Data Update Guide

## Overview

This document defines the safe procedures for updating dataset JSON files. Following these rules ensures data integrity, preserves editorial signals, and maintains schema consistency.

---

## Signal Taxonomy (Controlled Vocabulary)

All signal values must use these exact terms:

| Field | Allowed Values |
|-------|----------------|
| `state` | `accelerating` \| `decelerating` \| `steady` \| `contracting` |
| `pressure` | `tight` \| `neutral` \| `loose` \| `easing` |
| `confidence` | `high` \| `medium` \| `low` |

**Rule:** Signals are editorial input. They are never derived automatically from raw BLS data.

---

## Style Constraints (De-AI)

All editorial text must avoid common AI writing patterns. These rules apply to:
- `headline.title`
- `headline.summary`
- `headline.context`
- `editorial.what_changed`
- `editorial.what_didnt`
- `editorial.why_it_matters`

**Banned patterns:**

| Pattern | Example | Fix |
|---------|---------|-----|
| Em-dashes | "inflation—still above target—remains" | Use commas or parentheses |
| Semicolons | "hiring improved; wages held steady" | Split into two sentences |
| "Furthermore" | "Furthermore, wages increased" | Delete or use "Also" |
| "Moreover" | "Moreover, the data shows" | Delete entirely |
| "Additionally" | "Additionally, core CPI fell" | Delete or use "Also" |
| "It's worth noting" | "It's worth noting that..." | Just state the fact |
| "Notably" | "Notably, unemployment rose" | Delete entirely |
| "Significantly" | "Significantly higher than..." | Use specific numbers |
| "Interestingly" | "Interestingly, wages held" | Delete entirely |
| Exclamation points | "Hiring surged!" | Use a period |
| "This is significant because" | — | Rewrite directly |
| "It should be noted" | — | Just state the fact |

**Preferred style:**
- Short sentences (under 25 words)
- Active voice
- Specific numbers over vague descriptors
- Commas or parentheses for asides
- Split compound thoughts into separate sentences

**Run the linter before deploy:**
```bash
./tools/lint-content.sh
```

---

## Safe Update Prompt Template

Use this prompt when updating dataset files with new release data:

```
Role: Senior Macro Editor
Project: ReadTheDelta.com

Context:
ReadTheDelta is a neutral macroeconomic data explainer.
We use a strict JSON schema with a controlled vocabulary for editorial signals.

Task:
Update an existing dataset JSON file using the canonical ReadTheDelta schema.

Rules:

1. Data Integrity
   - Update values using ONLY the latest release data provided.
   - CRITICAL: Preserve all existing 24-month `trend` arrays EXACTLY as is,
     unless the input explicitly provides a full new array.
     Do not truncate or empty these arrays.
   - CRITICAL: Preserve the `signal` object's structure.
     If the input does not explicitly specify a Signal State/Pressure,
     leave those fields strictly as-is (or empty).
     Do not invent signals.

2. Editorial Standards
   - Editorial text (`what_changed`, `summary`) must be neutral, concise, and factual.
   - No bullish/bearish framing or investment advice.
   - Expectations data (`expectations` object) must be marked as editorial/manual input.

3. Style Constraints (De-AI)
   - No em-dashes (—). Use commas, parentheses, or separate sentences.
   - No semicolons in prose.
   - No "Furthermore," "Moreover," "Additionally," "Notably," "Interestingly"
   - No "It's worth noting," "It should be noted," "This is significant because"
   - No exclamation points.
   - Use specific numbers, not "significantly" or "substantially"
   - Keep sentences under 25 words.

4. Output Constraints
   - Return ONLY valid JSON.
   - No markdown formatting.
   - Preserve all existing schema keys.

Latest Release Data:
[PASTE RAW RELEASE DATA HERE]

Input JSON (Current File):
[PASTE CURRENT JSON HERE]

Output:
- The fully updated JSON file.
```

---

## Update Checklist

### Before Update

- [ ] Copy current JSON file as backup
- [ ] Gather latest BLS release data
- [ ] Determine if signal needs editorial review

### During Update

- [ ] Update `release.date` to new release date
- [ ] Update `release.reference_period` (e.g., "December 2025")
- [ ] Update `release.next_release` date
- [ ] Update `release.generated_at` timestamp
- [ ] Update `headline.title` (neutral, factual, signal-consistent)
- [ ] Update `headline.summary` (the lede with specific numbers)
- [ ] Update `headline.context` (release-specific, not boilerplate)
- [ ] Update all `metrics[key].value` fields
- [ ] Update all `comparisons.prior_release[key]` values and deltas
- [ ] Update `comparisons.twelve_month_average` values
- [ ] Append new value to each `trend` array (remove oldest if > 24)
- [ ] Update `editorial.what_changed` (include specific deltas and expectations)
- [ ] Update `editorial.what_didnt` (what stayed the same)
- [ ] Update `editorial.why_it_matters` (interpretive context)
- [ ] Update `editorial.revision_note` if applicable
- [ ] Update `expectations` with new consensus (mark as editorial)
- [ ] Review `signal` — update ONLY if editorial decision made
- [ ] Verify headline/signal consistency (no conflicts)

### After Update

- [ ] Validate JSON syntax
- [ ] Run `./tools/lint-content.sh` to check for AI-tells
- [ ] Verify trend arrays have exactly 24 values
- [ ] Verify signal values match taxonomy
- [ ] Test render locally before deploy

---

## Protected Fields

These fields must NEVER be wiped or auto-generated:

| Field | Reason |
|-------|--------|
| `signal.state` | Editorial input only |
| `signal.pressure` | Editorial input only |
| `signal.confidence` | Editorial input only |
| `comparisons.trend.*` | 24-month history, append only |
| `history.previous_releases` | Archive reference |

---

## Trend Array Management

Each trend array must contain exactly 24 values (24 months of history).

**To update:**
1. Append new value to end of array
2. Remove first (oldest) value
3. Result: array length stays at 24

**Example:**
```javascript
// Before (24 values, oldest is 256)
"payrolls": [256, 210, 175, ..., 143, 165]

// After adding new value 180 (still 24 values)
"payrolls": [210, 175, ..., 143, 165, 180]
```

**NEVER:**
- Truncate to fewer than 24 values
- Replace with placeholder data
- Empty the array

---

## File Locations

| File | Purpose |
|------|---------|
| `/data/latest.jobs.json` | Jobs Report data |
| `/data/latest.inflation.json` | Inflation Report data |
| `/data/schema.canonical.json` | Reference schema (do not modify) |

---

## Example: Updating Jobs Report

### Input: New BLS Release

```
Release Date: February 7, 2026
Reference Period: January 2026
Payrolls: +180,000
Unemployment: 4.0%
Wages: 4.2% YoY
Prior month revision: +12,000
```

### Signal Decision (Editorial)

Based on the data:
- Payrolls up → but still below long-term average
- Unemployment ticked up → labor market softening

**Editorial call:** Keep `state: "decelerating"`, `pressure: "tight"`

### Update Actions

1. `release.date`: "2026-02-07"
2. `release.reference_period`: "January 2026"
3. `metrics.payrolls.value`: 180
4. `comparisons.prior_release.payrolls.value`: 165
5. `comparisons.prior_release.payrolls.delta`: 15
6. Append 180 to `trend.payrolls`, remove oldest
7. `headline.title`: "Job Growth Rebounds as Unemployment Edges Higher"
8. `editorial.revision_note`: "Prior month revised up by 12,000."

---

## Validation Commands

```bash
# Validate JSON syntax
node -e "JSON.parse(require('fs').readFileSync('data/latest.jobs.json')); console.log('Valid')"

# Check for AI-tells (em-dashes, filler phrases, etc.)
./tools/lint-content.sh

# Check trend array length
node -e "const d = require('./data/latest.jobs.json'); console.log('Payrolls trend:', d.comparisons.trend.payrolls.length)"
```

---

## Emergency Recovery

If a bad update is deployed:

1. Restore from backup JSON
2. Or manually fix the specific field
3. Re-deploy to Cloudflare

Keep dated backups: `latest.jobs.2026-01-10.json`
