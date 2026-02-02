#!/usr/bin/env node
/**
 * review_update.mjs - The Reviewer Agent
 * Audits candidate.json for style violations and editorial quality
 * 
 * Exit codes:
 *   0 - PASS (candidate promoted to latest.json)
 *   1 - FAIL (candidate requires manual review)
 * 
 * Environment:
 *   DATASET - Dataset to review (jobs, inflation)
 *   OPENAI_API_KEY - Required for AI audit
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/ → repo root → data/
const DATA_DIR = path.join(__dirname, '..', 'data');

// Configuration
const DATASET = process.env.DATASET || 'jobs';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Critical patterns that fail the build
 */
const CRITICAL_PATTERNS = [
  { pattern: /—/g, name: 'em-dash' },
  { pattern: /;/g, name: 'semicolon' },
  { pattern: /!/g, name: 'exclamation point' }
];

/**
 * Warning patterns that should be flagged
 */
const WARNING_PATTERNS = [
  { pattern: /\bFurthermore\b/gi, name: 'Furthermore' },
  { pattern: /\bMoreover\b/gi, name: 'Moreover' },
  { pattern: /\bAdditionally\b/gi, name: 'Additionally' },
  { pattern: /\bNevertheless\b/gi, name: 'Nevertheless' },
  { pattern: /\bConsequently\b/gi, name: 'Consequently' },
  { pattern: /\bIt'?s worth noting\b/gi, name: "It's worth noting" },
  { pattern: /\bIt should be noted\b/gi, name: 'It should be noted' },
  { pattern: /\bNotably\b/gi, name: 'Notably' },
  { pattern: /\bSignificantly\b/gi, name: 'Significantly' },
  { pattern: /\bInterestingly\b/gi, name: 'Interestingly' },
  { pattern: /\bImportantly\b/gi, name: 'Importantly' },
  { pattern: /\bThis is significant\b/gi, name: 'This is significant' },
  { pattern: /\bIn terms of\b/gi, name: 'In terms of' },
  { pattern: /\butilize\b/gi, name: 'utilize' },
  { pattern: /\bleverage\b/gi, name: 'leverage' },
  { pattern: /\brobust\b/gi, name: 'robust' }
];

/**
 * Extract text fields for linting
 */
function extractTextFields(data) {
  const fields = [
    data.headline?.title,
    data.headline?.summary,
    data.headline?.context,
    data.editorial?.what_changed,
    data.editorial?.what_didnt,
    data.editorial?.why_it_matters,
    data.editorial?.revision_note,
    data.editorial?.editor_note
  ].filter(Boolean);

  return fields.join('\n');
}

/**
 * Run style linter on candidate
 */
function runLinter(candidate) {
  const text = extractTextFields(candidate);
  const errors = [];
  const warnings = [];

  // Check critical patterns
  for (const { pattern, name } of CRITICAL_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      errors.push(`Found ${matches.length} instance(s) of banned pattern: ${name}`);
    }
  }

  // Check warning patterns
  for (const { pattern, name } of WARNING_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      warnings.push(`Found ${matches.length} instance(s) of: ${name}`);
    }
  }

  return { errors, warnings };
}

/**
 * Validate numeric consistency
 * NOTE: Numeric consistency between headline.summary and metrics is enforced
 * exclusively by the AI Reviewer agent. This function is a structural placeholder
 * for any future deterministic checks that may be added.
 */
function validateNumericConsistency(candidate) {
  // Intentionally minimal - AI Reviewer handles numeric validation
  const errors = [];
  return errors;
}

/**
 * REQUIRED SIGNAL SENTENCE - EXACT MATCH
 */
const REQUIRED_SIGNAL_SENTENCE = 'Signal: decelerating and tight.';

/**
 * Validate signal sentence is EXACTLY correct
 * This is a hard fail - no AI interpretation allowed.
 */
function validateSignalSentence(candidate) {
  const context = candidate.headline?.context;
  
  if (!context) {
    return { valid: false, error: 'Missing headline.context' };
  }
  
  if (context !== REQUIRED_SIGNAL_SENTENCE) {
    return { 
      valid: false, 
      error: `Signal sentence mismatch. Expected: "${REQUIRED_SIGNAL_SENTENCE}" Got: "${context}"` 
    };
  }
  
  return { valid: true };
}

/**
 * Validate no forbidden phrases in editorial
 */
function validateNoInterpretation(candidate) {
  const forbidden = [
    'informs policy',
    'suggests implications',
    'affects decisions',
    'points to',
    'indicates that',
    'implies',
    'signals that'
  ];
  
  const editorial = candidate.editorial || {};
  const allText = [
    editorial.what_changed,
    editorial.what_didnt,
    editorial.why_it_matters
  ].filter(Boolean).join(' ').toLowerCase();
  
  for (const phrase of forbidden) {
    if (allText.includes(phrase.toLowerCase())) {
      return { valid: false, error: `Forbidden phrase found: "${phrase}"` };
    }
  }
  
  return { valid: true };
}

/**
 * Run AI audit on candidate
 */
async function runAIAudit(candidate) {
  // DETERMINISTIC PRE-CHECKS (run before AI)
  
  // 1. Signal sentence must be exact
  const signalCheck = validateSignalSentence(candidate);
  if (!signalCheck.valid) {
    return {
      status: 'FAIL',
      reason: signalCheck.error,
      flags: ['SIGNAL_MISMATCH']
    };
  }
  
  // 2. No interpretation phrases
  const interpretCheck = validateNoInterpretation(candidate);
  if (!interpretCheck.valid) {
    return {
      status: 'FAIL',
      reason: interpretCheck.error,
      flags: ['FORBIDDEN_INTERPRETATION']
    };
  }
  
  if (!OPENAI_API_KEY) {
    console.warn('[review_update] No OPENAI_API_KEY, skipping AI audit');
    return {
      status: 'PASS',
      reason: 'AI audit skipped (no API key). Deterministic checks passed.',
      flags: ['NO_AI_AUDIT']
    };
  }

  const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

  const signal = candidate.signal || {};
  const signalContext = signal.state && signal.pressure
    ? `Signal: State=${signal.state}, Pressure=${signal.pressure}`
    : 'Signal: Not set';

  const systemPrompt = `You are the Editorial Quality Reviewer for ReadTheDelta.com.

Task: Audit the candidate JSON for publication readiness.

FAIL CRITERIA (any of these = FAIL):

1. Signal Conflict: Headline or editorial contradicts the locked Signal.
   - Example: Signal says "decelerating" but headline says "surges" or "accelerates"
   - REQUIRED: The editorial or headline context MUST contain one explicit mechanical signal sentence like:
     "Signal: decelerating with tight pressure." or "Signal remains decelerating and tight."
   - Subjective paraphrase ("signs of deceleration...") is NOT acceptable.

2. Numeric Mismatch: Any number stated must match either:
   - A LEVEL from candidate.metrics[*].value (when describing a level/standing value), OR
   - A DELTA from candidate.comparisons.prior_release[*].delta (when describing a change).
   
   Rules:
   - If the text says "rose by / fell by / added / shed / increased by / declined by", it MUST match a delta.
   - If the text says "stands at / is at / reached / totaled", it MUST match a level.
   - Confusing a level for a delta (or vice versa) is a FAIL.

3. Non-neutral Tone: Investment advice, predictions, speculation, or sensationalism.

4. Style Violations: Em-dashes (—), semicolons (;), filler phrases ("it is worth noting", "moreover", "overall").

OUTPUT: Return ONLY a valid JSON object:
{
  "status": "PASS" or "FAIL",
  "reason": "Brief explanation",
  "flags": ["LIST", "OF", "SPECIFIC", "ISSUES"]
}`;

  const userPrompt = `${signalContext}

Headline: ${candidate.headline?.title}
Summary: ${candidate.headline?.summary}
Context: ${candidate.headline?.context}

Metrics (levels):
${JSON.stringify(candidate.metrics, null, 2)}

Comparisons (deltas + context):
${JSON.stringify(candidate.comparisons, null, 2)}

Editorial:
${JSON.stringify(candidate.editorial, null, 2)}

Audit this content.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const response = completion.choices[0].message.content;
    const parsed = JSON.parse(response);

    // Validate structure
    if (!parsed.status || !['PASS', 'FAIL'].includes(parsed.status)) {
      throw new Error('Invalid AI response structure');
    }

    return {
      status: parsed.status,
      reason: parsed.reason || '',
      flags: parsed.flags || []
    };
  } catch (err) {
    console.error(`[review_update] AI audit error: ${err.message}`);
    return {
      status: 'FAIL',
      reason: `AI audit error: ${err.message}`,
      flags: ['AI_ERROR']
    };
  }
}

/**
 * Main execution
 */
async function main() {
  console.log(`[review_update] Starting review for dataset: ${DATASET}`);

  // Load candidate
  const candidatePath = path.join(DATA_DIR, `latest.${DATASET}.candidate.json`);
  let candidate;
  try {
    const content = await fs.readFile(candidatePath, 'utf-8');
    candidate = JSON.parse(content);
  } catch (err) {
    console.error(`[review_update] Failed to load candidate: ${err.message}`);
    process.exit(1);
  }

  // Initialize review result
  const review = {
    timestamp: new Date().toISOString(),
    dataset: DATASET,
    candidate_path: candidatePath,
    linter: { errors: [], warnings: [] },
    numeric_check: [],
    ai_audit: null,
    final_status: 'PENDING'
  };

  // Run linter
  console.log('[review_update] Running style linter...');
  review.linter = runLinter(candidate);
  console.log(`[review_update] Linter: ${review.linter.errors.length} errors, ${review.linter.warnings.length} warnings`);

  // Fail fast on linter errors
  if (review.linter.errors.length > 0) {
    console.error('[review_update] FAIL: Linter found critical errors');
    review.linter.errors.forEach(e => console.error(`  - ${e}`));
    review.final_status = 'FAIL';
    review.fail_reason = 'Linter errors';
  } else {
    // Run numeric consistency check
    console.log('[review_update] Running numeric consistency check...');
    review.numeric_check = validateNumericConsistency(candidate);

    // Run AI audit
    console.log('[review_update] Running AI audit...');
    review.ai_audit = await runAIAudit(candidate);
    console.log(`[review_update] AI audit: ${review.ai_audit.status}`);

    if (review.ai_audit.status === 'FAIL') {
      review.final_status = 'FAIL';
      review.fail_reason = review.ai_audit.reason;
    } else if (review.numeric_check.length > 0) {
      review.final_status = 'FAIL';
      review.fail_reason = 'Numeric inconsistencies';
    } else {
      review.final_status = 'PASS';
    }
  }

  // Always write review file for auditability
  const reviewPath = path.join(DATA_DIR, `latest.${DATASET}.review.json`);
  await fs.writeFile(reviewPath, JSON.stringify(review, null, 2));
  console.log(`[review_update] Wrote review: ${reviewPath}`);

  // Take action based on result
  if (review.final_status === 'PASS') {
    console.log('[review_update] PASS: Promoting candidate to production');
    
    const latestPath = path.join(DATA_DIR, `latest.${DATASET}.json`);
    
    // Use fs.rename for ATOMIC promotion
    await fs.rename(candidatePath, latestPath);
    console.log(`[review_update] Promoted (atomic rename): ${latestPath}`);

    // Set output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `review_status=PASS\n`);
    }

    process.exit(0);
  } else {
    console.error(`[review_update] FAIL: ${review.fail_reason}`);
    console.error('[review_update] Candidate file preserved for manual review');

    // Log all issues
    if (review.linter.errors.length > 0) {
      console.error('Linter errors:');
      review.linter.errors.forEach(e => console.error(`  - ${e}`));
    }
    if (review.linter.warnings.length > 0) {
      console.warn('Linter warnings:');
      review.linter.warnings.forEach(w => console.warn(`  - ${w}`));
    }
    if (review.ai_audit?.flags?.length > 0) {
      console.error('AI audit flags:');
      review.ai_audit.flags.forEach(f => console.error(`  - ${f}`));
    }

    // Set output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `review_status=FAIL\n`);
      await fs.appendFile(process.env.GITHUB_OUTPUT, `fail_reason=${review.fail_reason}\n`);
    }

    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[review_update] Fatal error: ${err.message}`);
  process.exit(1);
});
