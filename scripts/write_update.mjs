#!/usr/bin/env node
/**
 * write_update.mjs - The Writer Agent
 * Generates latest.{dataset}.candidate.json using normalized data and deterministic templates
 * 
 * Exit codes:
 *   0 - Success (candidate file generated)
 *   1 - Error
 * 
 * Environment:
 *   DATASET - Dataset to update (jobs, inflation)
 *   NEW_PERIOD - Reference period in YYYY-MM format (optional, auto-detected if not set)
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/ → repo root → data/
const DATA_DIR = path.join(__dirname, '..', 'data');

// Configuration
const DATASET = process.env.DATASET || 'jobs';
let NEW_PERIOD = process.env.NEW_PERIOD;

// Month names for display
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

/**
 * Format YYYY-MM as "Month YYYY" for display in AI prompts only
 */
function formatPeriodForDisplay(yyyymm) {
  const [year, month] = yyyymm.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Format date as ISO date string
 */
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Calculate BLS release date for a given reference period
 * Jobs: First Friday of the following month
 * Inflation: Typically 10th-13th of the following month (we'll use 12th as default)
 */
function calculateReleaseDate(dataset, referencePeriod) {
  const [year, month] = referencePeriod.split('-').map(Number);
  
  // Release is in the month AFTER reference period
  let releaseYear = year;
  let releaseMonth = month + 1;
  if (releaseMonth > 12) {
    releaseMonth = 1;
    releaseYear += 1;
  }
  
  if (dataset === 'jobs') {
    // First Friday of release month
    const firstDay = new Date(releaseYear, releaseMonth - 1, 1);
    const dayOfWeek = firstDay.getDay();
    
    // Calculate days until Friday (5)
    let daysUntilFriday = (5 - dayOfWeek + 7) % 7;
    if (daysUntilFriday === 0) daysUntilFriday = 0; // If 1st is Friday
    
    const firstFriday = 1 + daysUntilFriday;
    return formatDate(new Date(releaseYear, releaseMonth - 1, firstFriday));
  }
  
  if (dataset === 'inflation') {
    // Typically 12th of release month
    return formatDate(new Date(releaseYear, releaseMonth - 1, 12));
  }
  
  // Default fallback
  return formatDate(new Date(releaseYear, releaseMonth - 1, 1));
}

/**
 * Calculate NEXT release date (one month after current release)
 */
function calculateNextRelease(dataset, currentReferencePeriod) {
  const [year, month] = currentReferencePeriod.split('-').map(Number);
  
  // Next release is for the NEXT month's data
  let nextYear = year;
  let nextMonth = month + 1;
  if (nextMonth > 12) {
    nextMonth = 1;
    nextYear += 1;
  }
  
  const nextPeriod = `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
  return calculateReleaseDate(dataset, nextPeriod);
}

/**
 * Auto-detect the most recent normalized file for the dataset
 * Returns YYYY-MM period string or null if none found
 */
async function detectLatestPeriod(dataset) {
  const normalizedDir = path.join(DATA_DIR, 'normalized', dataset);
  
  try {
    const files = await fs.readdir(normalizedDir);
    
    // Filter to normalized files and extract periods
    const periods = files
      .filter(f => f.endsWith('.normalized.json'))
      .map(f => f.replace('.normalized.json', ''))
      .filter(p => /^\d{4}-\d{2}$/.test(p))
      .sort()
      .reverse();
    
    if (periods.length === 0) {
      return null;
    }
    
    // Return most recent (first after reverse sort)
    return periods[0];
  } catch (err) {
    // Directory doesn't exist or not readable
    return null;
  }
}

/**
 * Load existing latest.json
 */
async function loadExistingLatest(dataset) {
  const latestPath = path.join(DATA_DIR, `latest.${dataset}.json`);
  try {
    const content = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[write_update] Failed to load ${latestPath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Load normalized data for the new period
 */
async function loadNormalized(dataset, period) {
  const normalizedPath = path.join(DATA_DIR, 'normalized', dataset, `${period}.normalized.json`);
  try {
    const content = await fs.readFile(normalizedPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[write_update] Failed to load ${normalizedPath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Build metrics object from normalized data
 */
function buildMetrics(normalized, existingMetrics) {
  const metrics = {};

  for (const [key, existingMeta] of Object.entries(existingMetrics)) {
    const metric = normalized.metrics[key];
    
    // Extract display_value from structured format, fallback to legacy formats
    let value = null;
    if (metric !== undefined && metric !== null) {
      if (typeof metric === 'object') {
        value = metric.display_value ?? metric.value ?? null;
      } else {
        value = metric;
      }
    }
    
    metrics[key] = {
      label: existingMeta.label,
      qualifier: existingMeta.qualifier,
      value: value,
      unit: existingMeta.unit,
      precision: existingMeta.precision
    };
  }

  return metrics;
}

/**
 * Build comparisons object from normalized data
 * trend is a SIMPLE MAP of arrays - no "months" wrapper
 */
function buildComparisons(normalized, existingLatest) {
  const priorRelease = {
    date: existingLatest.release.date,
    reference_period: existingLatest.release.reference_period
  };

  // Add per-metric prior values and deltas
  // Use top-level deltas (preferred) or fallback to comparisons.prior_release
  const deltas = normalized.deltas ?? normalized.comparisons?.prior_release ?? {};
  for (const key of Object.keys(normalized.metrics)) {
    const delta = deltas[key];
    
    // Extract display_value from structured format, fallback to legacy formats
    let deltaValue = 0;
    if (delta !== undefined && delta !== null) {
      if (typeof delta === 'object') {
        deltaValue = delta.display_value ?? delta.value ?? 0;
      } else {
        deltaValue = delta;
      }
    }
    
    priorRelease[key] = {
      value: existingLatest.metrics?.[key]?.value ?? null,
      delta: deltaValue
    };
  }

  return {
    prior_release: priorRelease,
    twelve_month_average: normalized.comparisons?.twelve_month_average ?? {},
    // SIMPLE MAP of arrays - no months key, no wrapper
    trend: normalized.comparisons?.trend ?? {}
  };
}

/**
 * Build expectations with nulled values
 */
function buildExpectations(existingExpectations) {
  const expectations = {
    _note: existingExpectations._note || 'Editorial input. Values sourced manually from consensus surveys. Not first-party data.'
  };

  for (const [key, value] of Object.entries(existingExpectations)) {
    if (key === '_note') continue;
    
    if (typeof value === 'object') {
      expectations[key] = {};
      for (const subKey of Object.keys(value)) {
        expectations[key][subKey] = null;
      }
    }
  }

  return expectations;
}

/**
 * Build history with new release appended
 * MUST use reference_period (YYYY-MM), NOT execution date
 * PREVENTS DUPLICATES by checking if period already exists
 */
function buildHistory(existingHistory, newReferencePeriod) {
  const previousReleases = existingHistory.previous_releases || [];
  
  // Format label from YYYY-MM for display
  const [year, month] = newReferencePeriod.split('-').map(Number);
  const label = `${MONTH_NAMES[month - 1]} ${year}`;

  // Check if this period already exists in history
  const alreadyExists = previousReleases.some(r => r.date === newReferencePeriod);
  
  if (alreadyExists) {
    // Period already in history, don't add duplicate
    console.log(`[write_update] Period ${newReferencePeriod} already in history, skipping duplicate`);
    return { previous_releases: previousReleases };
  }

  // Prepend new release (most recent first)
  // date field uses reference_period (YYYY-MM) to match file system
  const updatedReleases = [
    { date: newReferencePeriod, label },
    ...previousReleases.slice(0, 4) // Keep last 5 total
  ];

  return { previous_releases: updatedReleases };
}

/**
 * SIGNAL SENTENCE - HARDCODED CONSTANT
 * MUST appear exactly as written. No variations.
 */
const SIGNAL_SENTENCE = 'Signal: decelerating and tight.';

/**
 * FAIL-SAFE DEFAULT TEXT
 * Used when data is missing or invalid.
 */
const FALLBACK_TEXT = 'No material changes were recorded in this release.';

/**
 * CHECK IF VALUE EXISTS AND IS VALID
 * Returns false for null, undefined, zero, NaN
 */
function hasValue(val) {
  if (val === null || val === undefined) return false;
  if (typeof val === 'number' && (isNaN(val) || val === 0)) return false;
  return true;
}

/**
 * EXTRACT DISPLAY VALUE - returns null if missing
 */
function extractValue(metric) {
  if (!metric) return null;
  const val = metric.display_value ?? metric.value ?? metric;
  if (typeof val !== 'number' || isNaN(val)) return null;
  return val;
}

/**
 * FORMAT NUMBER WITH COMMAS - returns null if invalid
 */
function formatNumber(value) {
  if (!hasValue(value)) return null;
  return Math.abs(value).toLocaleString('en-US');
}

/**
 * BUILD PAYROLLS SENTENCE - DELTA ONLY
 * Template: "Nonfarm payrolls {increased by|declined by} X,XXX."
 * Returns null if delta is missing/zero.
 */
function buildPayrollsSentence(normalized) {
  const delta = extractValue(normalized.deltas?.payrolls);
  if (!hasValue(delta)) return null;
  
  const verb = delta > 0 ? 'increased by' : 'declined by';
  const formatted = formatNumber(delta);
  if (!formatted) return null;
  
  return `Nonfarm payrolls ${verb} ${formatted}.`;
}

/**
 * BUILD UNEMPLOYMENT SENTENCE - STRICT TEMPLATES
 * LEVEL: "The unemployment rate stands at X percent."
 * DELTA: "The unemployment rate declined by X percentage point."
 * Returns null if both are missing.
 */
function buildUnemploymentSentence(normalized) {
  const level = extractValue(normalized.metrics?.unemployment_rate);
  const delta = extractValue(normalized.deltas?.unemployment_rate);
  
  // If delta exists and is non-zero, use delta template
  if (hasValue(delta)) {
    const verb = delta > 0 ? 'increased by' : 'declined by';
    const formatted = Math.abs(delta);
    return `The unemployment rate ${verb} ${formatted} percentage point.`;
  }
  
  // If level exists, use level template
  if (hasValue(level)) {
    return `The unemployment rate stands at ${level} percent.`;
  }
  
  // Neither exists - return null (SILENCE)
  return null;
}

/**
 * BUILD PARTICIPATION SENTENCE - LEVEL ONLY
 * Template: "Labor force participation stands at X percent."
 * Returns null if missing.
 */
function buildParticipationSentence(normalized) {
  const level = extractValue(normalized.metrics?.labor_force_participation);
  if (!hasValue(level)) return null;
  
  return `Labor force participation stands at ${level} percent.`;
}

/**
 * BUILD WAGES SENTENCE - DELTA ONLY
 * Template: "Average hourly earnings increased by X percent."
 * Returns null if delta is missing/zero.
 */
function buildWagesSentence(normalized) {
  const delta = extractValue(normalized.deltas?.average_hourly_earnings_yoy);
  if (!hasValue(delta)) return null;
  
  const verb = delta > 0 ? 'increased by' : 'declined by';
  const formatted = Math.abs(delta).toFixed(1);
  
  return `Average hourly earnings ${verb} ${formatted} percent.`;
}

/**
 * BUILD CPI SENTENCE - LEVEL ONLY
 * Template: "The Consumer Price Index stands at X percent year-over-year."
 * Returns null if missing.
 */
function buildCpiSentence(normalized) {
  const level = extractValue(normalized.metrics?.cpi_all_items_yoy);
  if (!hasValue(level)) return null;
  
  return `The Consumer Price Index stands at ${level} percent year-over-year.`;
}

/**
 * BUILD CORE CPI SENTENCE - LEVEL ONLY
 * Template: "Core CPI stands at X percent year-over-year."
 * Returns null if missing.
 */
function buildCoreCpiSentence(normalized) {
  const level = extractValue(normalized.metrics?.cpi_core_yoy);
  if (!hasValue(level)) return null;
  
  return `Core CPI stands at ${level} percent year-over-year.`;
}

/**
 * BUILD CPI MOM SENTENCE - DELTA ONLY
 * Template: "Monthly prices {increased by|declined by} X percent."
 * Returns null if delta is missing/zero.
 */
function buildCpiMomSentence(normalized) {
  const delta = extractValue(normalized.deltas?.cpi_mom);
  if (!hasValue(delta)) return null;
  
  const verb = delta > 0 ? 'increased by' : 'declined by';
  const formatted = Math.abs(delta).toFixed(1);
  
  return `Monthly prices ${verb} ${formatted} percent.`;
}

/**
 * BUILD HEADLINE - DETERMINISTIC
 * Uses DELTA for payrolls title. SILENCE on missing data.
 */
function buildHeadline(dataset, normalized) {
  const period = formatPeriodForDisplay(normalized.reference_period);
  
  if (dataset === 'jobs') {
    const delta = extractValue(normalized.deltas?.payrolls);
    
    // If delta missing, use fallback
    if (!hasValue(delta)) {
      return {
        title: `Jobs Report: ${period}`,
        summary: FALLBACK_TEXT,
        context: SIGNAL_SENTENCE
      };
    }
    
    const verb = delta > 0 ? 'increased by' : 'declined by';
    const formatted = formatNumber(delta);
    
    // Build summary from available sentences
    const payrollsSentence = buildPayrollsSentence(normalized);
    const unemploymentSentence = buildUnemploymentSentence(normalized);
    
    const summaryParts = [payrollsSentence, unemploymentSentence].filter(Boolean);
    const summary = summaryParts.length > 0 ? summaryParts.join(' ') : FALLBACK_TEXT;
    
    return {
      title: `Payrolls ${verb} ${formatted} in ${period}`,
      summary: summary,
      context: SIGNAL_SENTENCE
    };
  }
  
  if (dataset === 'inflation') {
    const level = extractValue(normalized.metrics?.cpi_all_items_yoy);
    
    if (!hasValue(level)) {
      return {
        title: `Inflation Report: ${period}`,
        summary: FALLBACK_TEXT,
        context: SIGNAL_SENTENCE
      };
    }
    
    // Build summary with both YoY and MoM when available
    const cpiSentence = buildCpiSentence(normalized);
    const cpiMomSentence = buildCpiMomSentence(normalized);
    
    const summaryParts = [cpiSentence, cpiMomSentence].filter(Boolean);
    const summary = summaryParts.length > 0 ? summaryParts.join(' ') : FALLBACK_TEXT;
    
    return {
      title: `Inflation measured ${level} percent year-over-year in ${period}`,
      summary: summary,
      context: SIGNAL_SENTENCE
    };
  }
  
  return {
    title: `${dataset} Report: ${period}`,
    summary: FALLBACK_TEXT,
    context: SIGNAL_SENTENCE
  };
}

/**
 * BUILD CPI MOM SENTENCE - DELTA ONLY
 * Template: "Monthly prices {rose|fell} by X percent."
 * Returns null if delta is missing/zero.
 */
function buildCpiMomSentence(normalized) {
  const delta = extractValue(normalized.deltas?.cpi_mom);
  if (!hasValue(delta)) return null;
  
  const verb = delta > 0 ? 'rose by' : 'fell by';
  const formatted = Math.abs(delta).toFixed(1);
  
  return `Monthly prices ${verb} ${formatted} percent.`;
}

/**
 * BUILD EDITORIAL - DETERMINISTIC
 * SILENCE on missing data. NO interpretation. NO why_it_matters.
 */
function buildEditorial(dataset, normalized) {
  if (dataset === 'jobs') {
    const payrollsSentence = buildPayrollsSentence(normalized);
    const unemploymentSentence = buildUnemploymentSentence(normalized);
    const wagesSentence = buildWagesSentence(normalized);
    const participationSentence = buildParticipationSentence(normalized);
    
    // what_changed: all three main metrics (payrolls, unemployment, wages)
    const changedParts = [payrollsSentence, unemploymentSentence, wagesSentence].filter(Boolean);
    const what_changed = changedParts.length > 0 ? changedParts.join(' ') : FALLBACK_TEXT;
    
    // what_didnt: participation (if available)
    const what_didnt = participationSentence || '';
    
    return {
      what_changed: what_changed,
      what_didnt: what_didnt,
      why_it_matters: '',
      revision_note: '',
      editor_note: ''
    };
  }
  
  if (dataset === 'inflation') {
    const cpiSentence = buildCpiSentence(normalized);
    const cpiMomSentence = buildCpiMomSentence(normalized);
    const coreSentence = buildCoreCpiSentence(normalized);
    
    // what_changed: YoY CPI + MoM change
    const changedParts = [cpiSentence, cpiMomSentence].filter(Boolean);
    const what_changed = changedParts.length > 0 ? changedParts.join(' ') : FALLBACK_TEXT;
    
    // what_didnt: Core inflation (as stability/context)
    const what_didnt = coreSentence || '';
    
    return {
      what_changed: what_changed,
      what_didnt: what_didnt,
      why_it_matters: '',
      revision_note: '',
      editor_note: ''
    };
  }
  
  return {
    what_changed: FALLBACK_TEXT,
    what_didnt: '',
    why_it_matters: '',
    revision_note: '',
    editor_note: ''
  };
}

/**
 * Draft editorial content - FULLY DETERMINISTIC
 * No AI. All templates hardcoded. Signal injected unconditionally.
 */
async function draftEditorial(dataset, normalized, existingLatest, signal) {
  const headline = buildHeadline(dataset, normalized);
  const editorial = buildEditorial(dataset, normalized);
  
  // FORCE signal sentence - override any other value
  headline.context = SIGNAL_SENTENCE;
  
  return { headline, editorial };
}

/**
 * Build complete candidate JSON
 */
async function buildCandidate(dataset, normalized, existingLatest) {
  // Calculate proper BLS release date based on reference period
  const releaseDate = calculateReleaseDate(dataset, normalized.reference_period);
  
  // Calculate next release date
  const nextReleaseDate = calculateNextRelease(dataset, normalized.reference_period);
  
  // Locked fields: Copy exactly from existing
  const locked = {
    dataset: existingLatest.dataset,
    source: existingLatest.source,
    signal: existingLatest.signal,
    methodology_notes: existingLatest.methodology_notes
  };

  // Computed fields from normalized data
  const metrics = buildMetrics(normalized, existingLatest.metrics);
  const comparisons = buildComparisons(normalized, existingLatest);
  const expectations = buildExpectations(existingLatest.expectations);
  const history = buildHistory(existingLatest.history, normalized.reference_period);

  // Draft editorial content via AI
  const drafted = await draftEditorial(dataset, normalized, existingLatest, existingLatest.signal);

  // Assemble complete candidate
  const candidate = {
    dataset: locked.dataset,
    source: locked.source,
    release: {
      date: releaseDate,
      reference_period: normalized.reference_period,  // YYYY-MM format per spec
      next_release: nextReleaseDate,  // Calculated next first Friday/12th
      generated_at: new Date().toISOString()
    },
    headline: drafted.headline,
    signal: locked.signal,
    metrics,
    comparisons,
    expectations,
    editorial: drafted.editorial,
    history,
    methodology_notes: locked.methodology_notes
  };

  return candidate;
}

/**
 * Main execution
 */
async function main() {
  console.log(`[write_update] Starting writer for dataset: ${DATASET}`);

  // Auto-detect NEW_PERIOD if not provided
  if (!NEW_PERIOD) {
    console.log('[write_update] NEW_PERIOD not set, auto-detecting from normalized files...');
    NEW_PERIOD = await detectLatestPeriod(DATASET);
    
    if (!NEW_PERIOD) {
      console.error(`[write_update] No normalized files found for dataset: ${DATASET}`);
      console.error(`[write_update] Expected location: ${path.join(DATA_DIR, 'normalized', DATASET)}/`);
      console.error('[write_update] Run fetch_bls.mjs first to ingest data');
      process.exit(1);
    }
    
    console.log(`[write_update] Auto-detected period: ${NEW_PERIOD}`);
  }

  console.log(`[write_update] Processing period: ${NEW_PERIOD}`);

  // Load data
  const existingLatest = await loadExistingLatest(DATASET);
  const normalized = await loadNormalized(DATASET, NEW_PERIOD);

  // Build candidate
  const candidate = await buildCandidate(DATASET, normalized, existingLatest);

  // Write candidate file
  const candidatePath = path.join(DATA_DIR, `latest.${DATASET}.candidate.json`);
  await fs.writeFile(candidatePath, JSON.stringify(candidate, null, 2));
  console.log(`[write_update] Wrote candidate: ${candidatePath}`);

  // Set output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `candidate_path=${candidatePath}\n`);
  }

  console.log('[write_update] Writer complete');
}

main().catch(err => {
  console.error(`[write_update] Fatal error: ${err.message}`);
  process.exit(1);
});
