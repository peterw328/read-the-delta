#!/usr/bin/env node
/**
 * bootstrap_bls_history.mjs - ONE-TIME BOOTSTRAP SCRIPT
 * 
 * Purpose: Backfill 24 months of historical BLS data to seed the automation pipeline.
 * 
 * SAFE TO DELETE AFTER SUCCESSFUL RUN
 * SAFE TO RE-RUN (skips existing files)
 * 
 * This script:
 *   - Fetches historical data from BLS API
 *   - For JOBS: direct metric values from BLS series
 *   - For INFLATION: computes YoY and MoM from raw CPI index levels
 *   - Writes raw snapshots to /data/raw/{dataset}/
 *   - Writes normalized snapshots to /data/normalized/{dataset}/
 *   - Seeds trend arrays with progressive null-padding
 * 
 * Exit codes:
 *   0 - Success
 *   1 - Error (insufficient data, misalignment, API failure)
 * 
 * Environment:
 *   DATASET - Dataset to bootstrap (jobs, inflation)
 *   BLS_API_KEY - Optional, increases rate limits
 *   FORCE - Set to "true" to overwrite existing normalized files
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/ -> repo root -> data/
const DATA_DIR = path.join(__dirname, '..', 'data');

// Configuration
const DATASET = process.env.DATASET || 'jobs';
const BLS_API_KEY = process.env.BLS_API_KEY || '';
const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
const FORCE = process.env.FORCE === 'true';

// Required history length
const HISTORY_LENGTH = 24;

// Period codes (M01-M12 for monthly, M13 for annual - excluded)
const MONTHLY_PERIODS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'];

/**
 * METRIC DEFINITIONS (JOBS only - inflation is computed from indices)
 */
const METRIC_DEFINITIONS = {
  jobs: {
    payrolls: { unit: 'thousands', scale: 1, precision: 0 },
    unemployment_rate: { unit: 'percent', scale: 1, precision: 1 },
    labor_force_participation: { unit: 'percent', scale: 1, precision: 1 },
    average_hourly_earnings: { unit: 'dollars', scale: 1, precision: 2 },
    average_hourly_earnings_yoy: { unit: 'percent', scale: 0.1, precision: 1 }
  }
};

/**
 * INFLATION SERIES CONFIGURATION
 * Raw CPI index series (seasonally adjusted)
 */
const INFLATION_RAW_SERIES = {
  cpi_all_items: 'CUSR0000SA0',
  cpi_core: 'CUSR0000SA0L1E'
};

/**
 * INFLATION DERIVED METRICS
 */
const INFLATION_DERIVED_METRICS = {
  cpi_yoy: { source_index: 'cpi_all_items', computation: 'yoy', unit: 'percent', precision: 1 },
  cpi_mom: { source_index: 'cpi_all_items', computation: 'mom', unit: 'percent', precision: 1 },
  core_yoy: { source_index: 'cpi_core', computation: 'yoy', unit: 'percent', precision: 1 }
};

console.log('='.repeat(60));
console.log('BOOTSTRAP SCRIPT - Historical BLS Backfill');
console.log('Skips existing files. Set FORCE=true to overwrite normalized.');
console.log('='.repeat(60));
console.log('');

/**
 * Load dataset config to get series IDs (jobs only)
 */
async function loadDatasetConfig(dataset) {
  const latestPath = path.join(DATA_DIR, `latest.${dataset}.json`);
  try {
    const content = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[bootstrap] Failed to load ${latestPath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Fetch data from BLS API using axios
 */
async function fetchBLS(seriesIds, startYear, endYear) {
  console.log(`[bootstrap] Fetching BLS data for ${startYear}-${endYear}...`);
  
  const payload = {
    seriesid: seriesIds,
    startyear: String(startYear),
    endyear: String(endYear)
  };

  if (BLS_API_KEY) {
    payload.registrationkey = BLS_API_KEY;
  }

  const response = await axios.post(BLS_API_URL, payload, {
    headers: { 'Content-Type': 'application/json' }
  });

  if (response.data.status !== 'REQUEST_SUCCEEDED') {
    throw new Error(`BLS API returned status: ${response.data.status} - ${JSON.stringify(response.data.message)}`);
  }

  return response.data.Results.series;
}

/**
 * Convert BLS period to YYYY-MM format
 */
function periodToYYYYMM(year, period) {
  const monthNum = MONTHLY_PERIODS.indexOf(period) + 1;
  return `${year}-${String(monthNum).padStart(2, '0')}`;
}

/**
 * Get the YYYY-MM that is N months before a given YYYY-MM
 */
function monthsAgo(yyyymm, n) {
  let [year, month] = yyyymm.split('-').map(Number);
  month -= n;
  while (month <= 0) {
    month += 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Build a lookup map of all monthly values for a BLS series
 * Returns: { "YYYY-MM": float_value, ... }
 */
function buildSeriesLookup(seriesData, seriesId) {
  const lookup = {};
  for (const series of seriesData) {
    if (series.seriesID !== seriesId) continue;
    for (const dataPoint of series.data) {
      if (!MONTHLY_PERIODS.includes(dataPoint.period)) continue;
      const yyyymm = periodToYYYYMM(dataPoint.year, dataPoint.period);
      lookup[yyyymm] = parseFloat(dataPoint.value);
    }
  }
  return lookup;
}

/**
 * Extract and align monthly data across all series (JOBS only)
 * Returns array of { yyyymm, values: { metricKey: value } } sorted oldest to newest
 */
function extractAlignedMonths(seriesData, seriesMapping) {
  const seriesByMonth = {};
  
  for (const series of seriesData) {
    const seriesId = series.seriesID;
    seriesByMonth[seriesId] = {};
    
    for (const dataPoint of series.data) {
      if (!MONTHLY_PERIODS.includes(dataPoint.period)) continue;
      const yyyymm = periodToYYYYMM(dataPoint.year, dataPoint.period);
      seriesByMonth[seriesId][yyyymm] = parseFloat(dataPoint.value);
    }
  }
  
  const seriesIds = Object.keys(seriesByMonth);
  const allMonths = new Set();
  
  for (const seriesId of seriesIds) {
    for (const yyyymm of Object.keys(seriesByMonth[seriesId])) {
      allMonths.add(yyyymm);
    }
  }
  
  const alignedMonths = [];
  for (const yyyymm of allMonths) {
    const hasAll = seriesIds.every(id => seriesByMonth[id][yyyymm] !== undefined);
    if (hasAll) {
      const values = {};
      for (const [metricKey, seriesId] of Object.entries(seriesMapping)) {
        values[metricKey] = seriesByMonth[seriesId][yyyymm];
      }
      alignedMonths.push({ yyyymm, values });
    }
  }
  
  alignedMonths.sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));
  return alignedMonths;
}

/**
 * Compute inflation derived metrics for a set of aligned months
 * Requires raw index lookups and at least 13 months of prior data for YoY
 * Returns array of { yyyymm, values: { cpi_yoy, cpi_mom, core_yoy } }
 */
function computeInflationMonths(seriesData, targetMonths) {
  // Build lookups for each raw index series
  const lookups = {};
  for (const [indexKey, seriesId] of Object.entries(INFLATION_RAW_SERIES)) {
    lookups[indexKey] = buildSeriesLookup(seriesData, seriesId);
  }
  
  const results = [];
  
  for (const yyyymm of targetMonths) {
    const values = {};
    let allValid = true;
    
    for (const [displayKey, config] of Object.entries(INFLATION_DERIVED_METRICS)) {
      const lookup = lookups[config.source_index];
      const currentValue = lookup[yyyymm];
      
      if (currentValue === undefined) {
        console.warn(`[bootstrap] Missing index value for ${config.source_index} at ${yyyymm}`);
        allValid = false;
        break;
      }
      
      if (config.computation === 'yoy') {
        const priorYYYYMM = monthsAgo(yyyymm, 12);
        const priorValue = lookup[priorYYYYMM];
        if (priorValue === undefined) {
          console.warn(`[bootstrap] Missing 12-month-ago value for ${config.source_index} at ${priorYYYYMM} (needed for ${yyyymm})`);
          allValid = false;
          break;
        }
        values[displayKey] = Math.round(((currentValue / priorValue - 1) * 100) * Math.pow(10, config.precision)) / Math.pow(10, config.precision);
      }
      
      if (config.computation === 'mom') {
        const priorYYYYMM = monthsAgo(yyyymm, 1);
        const priorValue = lookup[priorYYYYMM];
        if (priorValue === undefined) {
          console.warn(`[bootstrap] Missing prior-month value for ${config.source_index} at ${priorYYYYMM} (needed for ${yyyymm})`);
          allValid = false;
          break;
        }
        values[displayKey] = Math.round(((currentValue / priorValue - 1) * 100) * Math.pow(10, config.precision)) / Math.pow(10, config.precision);
      }
    }
    
    if (allValid) {
      results.push({ yyyymm, values });
    }
  }
  
  return results;
}

/**
 * Check if file already exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write raw snapshot for a single month
 */
async function writeRawSnapshot(dataset, yyyymm, values, seriesMapping) {
  const rawDir = path.join(DATA_DIR, 'raw', dataset);
  const rawPath = path.join(rawDir, `${yyyymm}.json`);
  
  if (await fileExists(rawPath)) {
    console.log(`[bootstrap] Skipping raw (exists): ${yyyymm}`);
    return false;
  }
  
  await fs.mkdir(rawDir, { recursive: true });
  
  const rawData = {
    fetched_at: new Date().toISOString(),
    source: 'BLS API (bootstrap backfill)',
    reference_period: yyyymm,
    values: values,
    series_ids: seriesMapping
  };
  
  await fs.writeFile(rawPath, JSON.stringify(rawData, null, 2));
  console.log(`[bootstrap] + raw ${yyyymm}`);
  return true;
}

/**
 * Transform raw values into structured metrics (JOBS only)
 */
function transformToStructuredMetrics(dataset, rawValues) {
  const definitions = METRIC_DEFINITIONS[dataset] || {};
  const metrics = {};
  
  for (const [key, raw_value] of Object.entries(rawValues)) {
    const def = definitions[key] || { unit: 'number', scale: 1, precision: 2 };
    const display_value = Math.round(raw_value * def.scale * Math.pow(10, def.precision)) / Math.pow(10, def.precision);
    
    metrics[key] = {
      raw_value,
      display_value,
      unit: def.unit,
      scale: def.scale,
      precision: def.precision
    };
  }
  
  return metrics;
}

/**
 * Transform inflation computed values into structured metrics
 */
function transformInflationMetrics(computedValues) {
  const metrics = {};
  
  for (const [key, value] of Object.entries(computedValues)) {
    const config = INFLATION_DERIVED_METRICS[key];
    if (!config) continue;
    
    metrics[key] = {
      raw_value: value,
      display_value: value,
      unit: config.unit,
      scale: 1,
      precision: config.precision
    };
  }
  
  return metrics;
}

/**
 * Write normalized snapshot for a single month
 */
async function writeNormalizedSnapshot(dataset, yyyymm, structuredMetrics, trendHistory, priorStructuredMetrics) {
  const normalizedDir = path.join(DATA_DIR, 'normalized', dataset);
  const normalizedPath = path.join(normalizedDir, `${yyyymm}.normalized.json`);
  
  if (!FORCE && await fileExists(normalizedPath)) {
    console.log(`[bootstrap] Skipping normalized (exists): ${yyyymm}`);
    return false;
  }
  
  await fs.mkdir(normalizedDir, { recursive: true });
  
  const metrics = structuredMetrics;
  
  // Compute deltas from prior month
  const deltas = {};
  if (priorStructuredMetrics) {
    for (const [key, metric] of Object.entries(metrics)) {
      const priorMetric = priorStructuredMetrics[key];
      if (priorMetric) {
        const delta_raw = metric.display_value - priorMetric.display_value;
        deltas[key] = {
          raw_value: delta_raw,
          display_value: Math.round(delta_raw * Math.pow(10, metric.precision)) / Math.pow(10, metric.precision),
          unit: metric.unit,
          precision: metric.precision
        };
      }
    }
  }
  
  // Build 24-month trends with null padding
  const trends = {};
  for (const key of Object.keys(metrics)) {
    const history = trendHistory.map(h => h?.[key]?.display_value ?? null);
    history.push(metrics[key].display_value);
    
    if (history.length < HISTORY_LENGTH) {
      const padding = new Array(HISTORY_LENGTH - history.length).fill(null);
      trends[key] = [...padding, ...history];
    } else {
      trends[key] = history.slice(-HISTORY_LENGTH);
    }
  }
  
  // Compute 12-month averages
  const twelveMonthAvg = {};
  for (const [key, trendValues] of Object.entries(trends)) {
    const last12 = trendValues.slice(-12).filter(v => v !== null);
    if (last12.length > 0) {
      const avg = last12.reduce((a, b) => a + b, 0) / last12.length;
      const metricDef = INFLATION_DERIVED_METRICS[key] || METRIC_DEFINITIONS[dataset]?.[key] || { precision: 1 };
      const prec = metricDef.precision ?? 1;
      twelveMonthAvg[key] = Math.round(avg * Math.pow(10, prec)) / Math.pow(10, prec);
    }
  }
  
  const normalizedData = {
    reference_period: yyyymm,
    fetched_at: new Date().toISOString(),
    metrics: metrics,
    deltas: deltas,
    comparisons: {
      prior_release: deltas,
      twelve_month_average: twelveMonthAvg,
      trend: trends
    }
  };
  
  await fs.writeFile(normalizedPath, JSON.stringify(normalizedData, null, 2));
  console.log(`[bootstrap] + normalized ${yyyymm}`);
  return { metrics };
}

/**
 * Main execution
 */
async function main() {
  console.log(`[bootstrap] Dataset: ${DATASET}`);
  console.log(`[bootstrap] Required history: ${HISTORY_LENGTH} months`);
  if (FORCE) console.log(`[bootstrap] FORCE mode: will overwrite existing normalized files`);
  console.log('');
  
  let seriesIds;
  let seriesMapping;
  let isInflation = DATASET === 'inflation';
  
  if (isInflation) {
    // Inflation: use hardcoded SA series
    seriesMapping = INFLATION_RAW_SERIES;
    seriesIds = Object.values(INFLATION_RAW_SERIES);
    console.log(`[bootstrap] Inflation mode: fetching raw CPI index series`);
    console.log(`[bootstrap] Series: ${JSON.stringify(INFLATION_RAW_SERIES)}`);
  } else {
    // Jobs: use series IDs from latest.json
    const config = await loadDatasetConfig(DATASET);
    seriesMapping = config.source?.series_ids;
    
    if (!seriesMapping || Object.keys(seriesMapping).length === 0) {
      console.error(`[bootstrap] No series_ids found in latest.${DATASET}.json`);
      process.exit(1);
    }
    
    seriesIds = Object.values(seriesMapping);
    console.log(`[bootstrap] Series IDs: ${seriesIds.join(', ')}`);
    console.log(`[bootstrap] Metrics: ${Object.keys(seriesMapping).join(', ')}`);
  }
  console.log('');
  
  // Determine year range
  // For inflation YoY we need 12 months before the earliest target month
  // So fetch 4 years to be safe (24 months output + 12 months lookback + buffer)
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 3;
  const endYear = currentYear;
  
  // Fetch from BLS
  let seriesData;
  try {
    seriesData = await fetchBLS(seriesIds, startYear, endYear);
  } catch (err) {
    console.error(`[bootstrap] BLS API error: ${err.message}`);
    process.exit(1);
  }
  
  // Build the list of months to process
  let monthsToProcess;
  
  if (isInflation) {
    // For inflation, find all available months in the data, then compute derived metrics
    // We need to figure out what months have data for both series
    const cpiLookup = buildSeriesLookup(seriesData, INFLATION_RAW_SERIES.cpi_all_items);
    const coreLookup = buildSeriesLookup(seriesData, INFLATION_RAW_SERIES.cpi_core);
    
    // Find months where both series have data
    const allMonths = new Set([...Object.keys(cpiLookup), ...Object.keys(coreLookup)]);
    const alignedMonths = [...allMonths]
      .filter(m => cpiLookup[m] !== undefined && coreLookup[m] !== undefined)
      .sort();
    
    console.log(`[bootstrap] Found ${alignedMonths.length} months with both CPI series`);
    
    // We want the last 24 months as output targets
    // But we need 12 months prior for YoY, so start computing from further back
    const targetMonths = alignedMonths.slice(-HISTORY_LENGTH);
    
    if (targetMonths.length < HISTORY_LENGTH) {
      console.error(`[bootstrap] ABORT: Only ${targetMonths.length} target months available, need ${HISTORY_LENGTH}`);
      process.exit(1);
    }
    
    console.log(`[bootstrap] Target months: ${targetMonths[0]} -> ${targetMonths[targetMonths.length - 1]}`);
    
    // Compute inflation metrics for each target month
    monthsToProcess = computeInflationMonths(seriesData, targetMonths);
    
    if (monthsToProcess.length < HISTORY_LENGTH) {
      console.error(`[bootstrap] ABORT: Only ${monthsToProcess.length} months could be computed (need ${HISTORY_LENGTH})`);
      console.error(`[bootstrap] This usually means insufficient lookback data for YoY computation`);
      process.exit(1);
    }
    
    // Take the last 24
    monthsToProcess = monthsToProcess.slice(-HISTORY_LENGTH);
    
  } else {
    // Jobs: use the old alignment logic
    const alignedMonths = extractAlignedMonths(seriesData, seriesMapping);
    console.log(`[bootstrap] Found ${alignedMonths.length} aligned months`);
    
    if (alignedMonths.length < HISTORY_LENGTH) {
      console.error(`[bootstrap] ABORT: Insufficient data. Need ${HISTORY_LENGTH} months, found ${alignedMonths.length}`);
      process.exit(1);
    }
    
    monthsToProcess = alignedMonths.slice(-HISTORY_LENGTH);
  }
  
  console.log(`[bootstrap] Processing ${monthsToProcess.length} months: ${monthsToProcess[0].yyyymm} -> ${monthsToProcess[monthsToProcess.length - 1].yyyymm}`);
  console.log('');
  
  // Process each month in chronological order
  let rawWritten = 0;
  let normalizedWritten = 0;
  const trendHistory = [];
  let priorStructuredMetrics = null;
  
  for (let i = 0; i < monthsToProcess.length; i++) {
    const { yyyymm, values } = monthsToProcess[i];
    
    // Write raw snapshot
    if (await writeRawSnapshot(DATASET, yyyymm, values, seriesMapping)) {
      rawWritten++;
    }
    
    // Build structured metrics
    let structuredMetrics;
    if (isInflation) {
      structuredMetrics = transformInflationMetrics(values);
    } else {
      structuredMetrics = transformToStructuredMetrics(DATASET, values);
    }
    
    // Write normalized snapshot with trend history
    const result = await writeNormalizedSnapshot(DATASET, yyyymm, structuredMetrics, trendHistory, priorStructuredMetrics);
    if (result) {
      normalizedWritten++;
      trendHistory.push(result.metrics);
      priorStructuredMetrics = result.metrics;
    } else {
      // Even if we skipped writing, still track for trend continuity
      trendHistory.push(structuredMetrics);
      priorStructuredMetrics = structuredMetrics;
    }
  }
  
  console.log('');
  console.log('='.repeat(60));
  console.log('BOOTSTRAP COMPLETE');
  console.log('='.repeat(60));
  console.log(`Raw snapshots written: ${rawWritten}`);
  console.log(`Normalized snapshots written: ${normalizedWritten}`);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Run: $env:DATASET="inflation"; node scripts/write_update.mjs');
  console.log('  2. Run: $env:DATASET="inflation"; node scripts/review_update.mjs');
  console.log('');
}

main().catch(err => {
  console.error(`[bootstrap] Fatal error: ${err.message}`);
  process.exit(1);
});
