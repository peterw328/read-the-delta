#!/usr/bin/env node
/**
 * bootstrap_bls_history.mjs - ONE-TIME BOOTSTRAP SCRIPT
 * 
 * Purpose: Backfill 24 months of historical BLS data to seed the automation pipeline.
 * 
 * SAFE TO DELETE AFTER SUCCESSFUL RUN
 * 
 * This script:
 *   - Fetches 24 months of historical data from BLS API
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
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// scripts/ → repo root → data/
const DATA_DIR = path.join(__dirname, '..', 'data');

// Configuration
const DATASET = process.env.DATASET || 'jobs';
const BLS_API_KEY = process.env.BLS_API_KEY || '';
const BLS_API_URL = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';

// Required history length
const HISTORY_LENGTH = 24;

// Period codes (M01-M12 for monthly, M13 for annual - excluded)
const MONTHLY_PERIODS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'];

/**
 * METRIC DEFINITIONS
 * Defines unit, scale, and precision for each metric.
 */
const METRIC_DEFINITIONS = {
  jobs: {
    payrolls: { unit: 'thousands', scale: 1, precision: 0 },
    unemployment_rate: { unit: 'percent', scale: 1, precision: 1 },
    labor_force_participation: { unit: 'percent', scale: 1, precision: 1 },
    average_hourly_earnings: { unit: 'dollars', scale: 1, precision: 2 },
    average_hourly_earnings_yoy: { unit: 'percent', scale: 0.1, precision: 1 }
  },
  inflation: {
    cpi_all_items: { unit: 'index', scale: 1, precision: 1 },
    cpi_all_items_yoy: { unit: 'percent', scale: 1, precision: 1 },
    cpi_core: { unit: 'index', scale: 1, precision: 1 },
    cpi_core_yoy: { unit: 'percent', scale: 1, precision: 1 },
    cpi_mom: { unit: 'percent', scale: 1, precision: 1 }
  }
};

console.log('='.repeat(60));
console.log('ONE-TIME BOOTSTRAP SCRIPT - Historical BLS Backfill');
console.log('SAFE TO DELETE AFTER SUCCESSFUL RUN');
console.log('='.repeat(60));
console.log('');

/**
 * Load dataset config to get series IDs
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
 * Extract and align monthly data across all series
 * Returns array of { yyyymm, values: { seriesId: value } } sorted oldest to newest
 */
function extractAlignedMonths(seriesData, seriesMapping) {
  // Build map: seriesId -> { YYYY-MM: value }
  const seriesByMonth = {};
  
  for (const series of seriesData) {
    const seriesId = series.seriesID;
    seriesByMonth[seriesId] = {};
    
    for (const dataPoint of series.data) {
      // Skip annual data (M13)
      if (!MONTHLY_PERIODS.includes(dataPoint.period)) continue;
      
      const yyyymm = periodToYYYYMM(dataPoint.year, dataPoint.period);
      seriesByMonth[seriesId][yyyymm] = parseFloat(dataPoint.value);
    }
  }
  
  // Find months where ALL series have data
  const seriesIds = Object.keys(seriesByMonth);
  const allMonths = new Set();
  
  for (const seriesId of seriesIds) {
    for (const yyyymm of Object.keys(seriesByMonth[seriesId])) {
      allMonths.add(yyyymm);
    }
  }
  
  // Filter to aligned months only
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
  
  // Sort oldest to newest
  alignedMonths.sort((a, b) => a.yyyymm.localeCompare(b.yyyymm));
  
  return alignedMonths;
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
  
  // Skip if already exists
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
  console.log(`[bootstrap] ✓ raw ${yyyymm}`);
  return true;
}

/**
 * Transform raw values into structured metrics with raw_value, display_value, unit
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
 * Write normalized snapshot for a single month
 * trendHistory is array of prior STRUCTURED metrics (oldest first) for building trends
 */
async function writeNormalizedSnapshot(dataset, yyyymm, rawValues, trendHistory, priorStructuredMetrics) {
  const normalizedDir = path.join(DATA_DIR, 'normalized', dataset);
  const normalizedPath = path.join(normalizedDir, `${yyyymm}.normalized.json`);
  
  // Skip if already exists
  if (await fileExists(normalizedPath)) {
    console.log(`[bootstrap] Skipping normalized (exists): ${yyyymm}`);
    return false;
  }
  
  await fs.mkdir(normalizedDir, { recursive: true });
  
  // Transform raw values to structured metrics
  const metrics = transformToStructuredMetrics(dataset, rawValues);
  const definitions = METRIC_DEFINITIONS[dataset] || {};
  
  // Compute deltas from prior month (using display_values)
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
  
  // Build 24-month trends with null padding (using display_values)
  const trends = {};
  for (const key of Object.keys(metrics)) {
    const history = trendHistory.map(h => h?.[key]?.display_value ?? null);
    history.push(metrics[key].display_value);
    
    // Pad to exactly 24 values
    if (history.length < HISTORY_LENGTH) {
      const padding = new Array(HISTORY_LENGTH - history.length).fill(null);
      trends[key] = [...padding, ...history];
    } else {
      trends[key] = history.slice(-HISTORY_LENGTH);
    }
  }
  
  // Compute 12-month averages (ignoring nulls)
  const twelveMonthAvg = {};
  for (const [key, trendValues] of Object.entries(trends)) {
    const last12 = trendValues.slice(-12).filter(v => v !== null);
    if (last12.length > 0) {
      const avg = last12.reduce((a, b) => a + b, 0) / last12.length;
      const def = definitions[key] || { precision: 2 };
      twelveMonthAvg[key] = Math.round(avg * Math.pow(10, def.precision)) / Math.pow(10, def.precision);
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
  console.log(`[bootstrap] ✓ normalized ${yyyymm}`);
  return { metrics }; // Return metrics for next iteration's trendHistory
}

/**
 * Main execution
 */
async function main() {
  console.log(`[bootstrap] Dataset: ${DATASET}`);
  console.log(`[bootstrap] Required history: ${HISTORY_LENGTH} months`);
  console.log('');
  
  // Load dataset config
  const config = await loadDatasetConfig(DATASET);
  const seriesMapping = config.source?.series_ids;
  
  if (!seriesMapping || Object.keys(seriesMapping).length === 0) {
    console.error(`[bootstrap] No series_ids found in latest.${DATASET}.json`);
    process.exit(1);
  }
  
  const seriesIds = Object.values(seriesMapping);
  console.log(`[bootstrap] Series IDs: ${seriesIds.join(', ')}`);
  console.log(`[bootstrap] Metrics: ${Object.keys(seriesMapping).join(', ')}`);
  console.log('');
  
  // Determine year range (need ~3 years to ensure 24 months available)
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 2;
  const endYear = currentYear;
  
  // Fetch from BLS
  let seriesData;
  try {
    seriesData = await fetchBLS(seriesIds, startYear, endYear);
  } catch (err) {
    console.error(`[bootstrap] BLS API error: ${err.message}`);
    process.exit(1);
  }
  
  // Extract and align months
  const alignedMonths = extractAlignedMonths(seriesData, seriesMapping);
  console.log(`[bootstrap] Found ${alignedMonths.length} aligned months`);
  
  if (alignedMonths.length < HISTORY_LENGTH) {
    console.error(`[bootstrap] ABORT: Insufficient data. Need ${HISTORY_LENGTH} months, found ${alignedMonths.length}`);
    process.exit(1);
  }
  
  // Take the most recent 24 months
  const monthsToProcess = alignedMonths.slice(-HISTORY_LENGTH);
  console.log(`[bootstrap] Processing ${monthsToProcess.length} months: ${monthsToProcess[0].yyyymm} → ${monthsToProcess[monthsToProcess.length - 1].yyyymm}`);
  console.log('');
  
  // Process each month in chronological order
  let rawWritten = 0;
  let normalizedWritten = 0;
  const trendHistory = []; // Will contain structured metrics objects
  let priorStructuredMetrics = null;
  
  for (let i = 0; i < monthsToProcess.length; i++) {
    const { yyyymm, values } = monthsToProcess[i];
    
    // Write raw snapshot
    if (await writeRawSnapshot(DATASET, yyyymm, values, seriesMapping)) {
      rawWritten++;
    }
    
    // Write normalized snapshot with trend history
    const result = await writeNormalizedSnapshot(DATASET, yyyymm, values, trendHistory, priorStructuredMetrics);
    if (result) {
      normalizedWritten++;
      // Update trend history with structured metrics for next iteration
      trendHistory.push(result.metrics);
      priorStructuredMetrics = result.metrics;
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
  console.log('  1. Run: node scripts/write_update.mjs');
  console.log('  2. Run: node scripts/review_update.mjs');
  console.log('  3. Delete this script (optional)');
  console.log('');
}

main().catch(err => {
  console.error(`[bootstrap] Fatal error: ${err.message}`);
  process.exit(1);
});
