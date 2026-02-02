# ReadTheDelta Style Guide

## Overview

ReadTheDelta uses a neutral, institutional editorial voice. The goal is to sound like a Reuters or Bloomberg explainer: factual, calm, and human-written.

This guide enforces the "de-AI" principle: avoid patterns that signal AI-generated content.

---

## Core Principles

1. **Clarity over cleverness.** Say what changed. Say it simply.
2. **Numbers over adjectives.** "Rose 0.1 percentage point" beats "edged higher."
3. **Short sentences.** If a sentence exceeds 25 words, split it.
4. **Active voice.** "Employers added 165,000 jobs" not "165,000 jobs were added."
5. **No editorializing.** Report the data. Do not predict or advise.

---

## Banned Patterns

These patterns are common in AI-generated text and must be avoided.

### Punctuation

| Banned | Why | Use Instead |
|--------|-----|-------------|
| Em-dash (—) | AI tell | Commas, parentheses, or new sentence |
| Semicolon (;) | Formal/AI feel | Split into two sentences |
| Exclamation point (!) | Unprofessional | Period |
| Ellipsis (...) | Vague | Complete the thought |

### Transition Words

| Banned | Use Instead |
|--------|-------------|
| Furthermore | (delete) or "Also" |
| Moreover | (delete) |
| Additionally | (delete) or "Also" |
| However | (use sparingly, or rewrite) |
| Nevertheless | (delete) |
| Consequently | (delete) or "As a result" |
| Thus | (delete) |
| Hence | (delete) |

### Filler Phrases

| Banned | Why | Fix |
|--------|-----|-----|
| "It's worth noting that" | Padding | State the fact directly |
| "It should be noted that" | Padding | State the fact directly |
| "Notably" | Editorializing | Delete |
| "Significantly" | Vague | Use specific numbers |
| "Interestingly" | Editorializing | Delete |
| "Importantly" | Editorializing | Delete |
| "This is significant because" | AI pattern | Rewrite directly |
| "This suggests that" | Hedging | State the implication |
| "It is important to understand" | Padding | Delete |

### Sentence Starters to Avoid

- "In terms of..."
- "When it comes to..."
- "As for..."
- "With regard to..."
- "In light of..."
- "Given the fact that..."
- "It is clear that..."
- "There is no doubt that..."

### Word Choices

| Avoid | Prefer |
|-------|--------|
| Utilize | Use |
| Leverage | Use |
| Robust | Strong |
| Significant | (specific number) |
| Substantial | (specific number) |
| Considerable | (specific number) |
| Relatively | (delete or quantify) |
| Somewhat | (delete or quantify) |
| Various | (be specific) |
| Numerous | (give count) |

---

## Preferred Patterns

### Good: Specific and direct

```
Payrolls rose by 165,000, a rebound of 22,000 from the prior month.
```

### Bad: Vague and padded

```
It's worth noting that payrolls increased significantly, rising by a substantial 165,000 jobs—a considerable improvement from the prior month.
```

### Good: Short sentences

```
Unemployment rose to 3.9 percent. This is the highest level since March.
```

### Bad: Compound clause

```
Unemployment rose to 3.9 percent, which represents the highest level since March; furthermore, this increase suggests the labor market may be softening.
```

### Good: Parenthetical aside

```
Inflation held at 3.4 percent (unchanged from November) but exceeded the 3.3 percent consensus.
```

### Bad: Em-dash aside

```
Inflation held at 3.4 percent—unchanged from November—but exceeded the 3.3 percent consensus.
```

---

## Headline Rules

Headlines should be:
- Factual, not sensational
- Consistent with the signal badge
- Under 10 words preferred

**Good headlines:**
- "Job Growth Rebounds but Remains Below Trend"
- "Inflation Holds Steady, Remaining Above Fed Target"
- "Unemployment Edges Higher as Hiring Slows"

**Bad headlines:**
- "Jobs Report Delivers Mixed Signals!" (exclamation, editorializing)
- "Inflation Stubbornly Refuses to Budge" (anthropomorphizing)
- "Economy Shows Resilience Amid Challenges" (vague, cliche)

---

## Context Rules

The `headline.context` field explains why the data matters. It should be:
- Release-specific (not boilerplate)
- Policy-relevant
- Under 40 words

**Good:**
```
With inflation stuck at 3.4 percent, well above the Fed's 2 percent goal, progress has stalled. This likely delays any pivot to rate cuts.
```

**Bad:**
```
Inflation affects purchasing power for households and influences Federal Reserve policy on interest rates. Changes in price growth shape borrowing costs, wage negotiations, and business planning.
```

The bad example is generic boilerplate that could apply to any release.

---

## Editorial Section Rules

### what_changed

- Include specific deltas (+22K, -0.1 ppt)
- Reference expectations if there was a miss
- Two to three sentences max

### what_didnt

- Note metrics that held steady
- Highlight surprises (defied expectations)
- One sentence is fine

### why_it_matters

- Interpretive but neutral
- Connect data to policy or trends
- Avoid predictions
- No em-dashes

### revision_note

- State revision direction and magnitude
- One sentence

---

## Validation

Run the content linter before any deploy:

```bash
./tools/lint-content.sh
```

This checks for banned patterns in all JSON files.

---

## Quick Reference Card

**Always:**
- Use periods
- Use commas for pauses
- Use parentheses for asides
- Give specific numbers
- Keep sentences under 25 words

**Never:**
- Em-dashes (—)
- Semicolons (;)
- "Furthermore/Moreover/Additionally"
- "It's worth noting"
- "Significantly" without a number
- Exclamation points
