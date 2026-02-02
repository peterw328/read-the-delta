#!/usr/bin/env node
/**
 * fetch_bls.mjs - The Ingestor
 * Fetches raw data from BLS API and computes normalized snapshots
 * 
 * Exit codes:
 *   0 - Success (new data ingested) or no new data available
 *   1 - Error (API failure, validation failure, etc.)
 * 
 * Environment:
 *   BLS_API_KEY - Optional, increases rate limits
 *   DATASET - Dataset to fetch (jobs, inflation)
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

// Period codes (M01-M12 for monthly, M13 for annual)
const MONTHLY_PERIODS = ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'M09', 'M10', 'M11', 'M12'];

// Required trend length - MUST be exactly 24
const TREND_LENGTH = 24;

/**
 * METRIC DEFINITIONS
 * Defines unit, scale, and precision for each metric.
 * - raw_value: number as returned by BLS
 * - scale: multiplier to convert raw to display (e.g., 0.1 for wage index → percent)
 * - unit: display unit label
 * - precision: decimal places for display_value
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

/**
 * Load existing dataset file to get series IDs
 */
async function loadDatasetConfig(dataset) {
  const latestPath = path.join(DATA_DIR, `latest.${dataset}.json`);
  try {
    const content = await fs.readFile(latestPath, 'utf-8');
    return JSON.parse(content);
  } catch (err) {
    console.error(`[fetch_bls] Failed to load ${latestPath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Fetch data from BLS API using axios
 */
async function fetchBLS(seriesIds, startYear, endYear) {
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
 * Find the latest monthly period across all series
 * Returns null if series are misaligned
 */
function findLatestPeriod(seriesData) {
  const latestBySeriesId = {};

  for (const series of seriesData) {
    const seriesId = series.seriesID;
    
    // Filter to monthly data only (exclude M13 annual)
    const monthlyData = series.data.filter(d => MONTHLY_PERIODS.includes(d.period));
    
    if (monthlyData.length === 0) {
      console.error(`[fetch_bls] No monthly data found for series ${seriesId}`);
      return null;
    }

    // Sort by year and period descending
    monthlyData.sort((a, b) => {
      if (a.year !== b.year) return Number(b.year) - Number(a.year);
      return MONTHLY_PERIODS.indexOf(b.period) - MONTHLY_PERIODS.indexOf(a.period);
    });

    const latest = monthlyData[0];
    latestBySeriesId[seriesId] = {
      year: latest.year,
      period: latest.period,
      value: latest.value,
      periodName: latest.periodName
    };
  }

  // Validate all series are aligned to same period
  const periods = Object.values(latestBySeriesId);
  const refYear = periods[0].year;
  const refPeriod = periods[0].period;

  for (const p of periods) {
    if (p.year !== refYear || p.period !== refPeriod) {
      console.error(`[fetch_bls] Series misalignment detected:`);
      console.error(JSON.stringify(latestBySeriesId, null, 2));
      return null;
    }
  }

  return {
    year: refYear,
    period: refPeriod,
    periodName: periods[0].periodName,
    values: latestBySeriesId
  };
}

/**
 * Convert BLS period to YYYY-MM format
 */
function periodToYYYYMM(year, period) {
  const monthNum = MONTHLY_PERIODS.indexOf(period) + 1;
  return `${year}-${String(monthNum).padStart(2, '0')}`;
}

/**
 * Check if raw file already exists
 */
async function rawFileExists(dataset, yyyymm) {
  const rawPath = path.join(DATA_DIR, 'raw', dataset, `${yyyymm}.json`);
  try {
    await fs.access(rawPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load historical normalized data for trend computation
 */
async function loadNormalizedHistory(dataset, currentYYYYMM, monthsNeeded = 23) {
  const normalizedDir = path.join(DATA_DIR, 'normalized', dataset);
  const history = [];

  // Parse current period
  const [currentYear, currentMonth] = currentYYYYMM.split('-').map(Number);

  // Go back monthsNeeded months
  for (let i = monthsNeeded; i >= 1; i--) {
    let targetMonth = currentMonth - i;
    let targetYear = currentYear;

    while (targetMonth <= 0) {
      targetMonth += 12;
      targetYear -= 1;
    }

    const yyyymm = `${targetYear}-${String(targetMonth).padStart(2, '0')}`;
    const filePath = path.join(normalizedDir, `${yyyymm}.normalized.json`);

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      history.push(JSON.parse(content));
    } catch {
      // File doesn't exist, push null placeholder
      history.push(null);
    }
  }

  return history;
}

/**
 * Extract metric values from latest data based on series mapping
 * Returns structured metrics with raw_value, display_value, unit, scale
 */
function extractMetrics(dataset, latestPeriod, seriesMapping) {
  const metrics = {};
  const definitions = METRIC_DEFINITIONS[dataset] || {};

  for (const [metricKey, seriesId] of Object.entries(seriesMapping)) {
    const seriesData = latestPeriod.values[seriesId];
    if (seriesData) {
      const raw_value = parseFloat(seriesData.value);
      const def = definitions[metricKey] || { unit: 'number', scale: 1, precision: 2 };
      
      const display_value = Math.round(raw_value * def.scale * Math.pow(10, def.precision)) / Math.pow(10, def.precision);
      
      metrics[metricKey] = {
        raw_value,
        display_value,
        unit: def.unit,
        scale: def.scale,
        precision: def.precision
      };
    }
  }

  return metrics;
}

/**
 * Pad trend array to EXACTLY 24 values
 * Pads with null at the BEGINNING if fewer than 24 values
 * Order: oldest first, newest last
 */
function padTrend(values) {
  if (values.length >= TREND_LENGTH) {
    // Take last 24 values (oldest first, newest last)
    return values.slice(-TREND_LENGTH);
  }
  
  // Pad BEGINNING with nulls to reach exactly 24
  const padding = new Array(TREND_LENGTH - values.length).fill(null);
  return [...padding, ...values];
}

/**
 * Compute normalized data with deltas and trends
 * All values stored as structured objects with raw_value, display_value, unit
 */
async function computeNormalized(dataset, latestPeriod, seriesMapping, existingLatest) {
  const yyyymm = periodToYYYYMM(latestPeriod.year, latestPeriod.period);
  const metrics = extractMetrics(dataset, latestPeriod, seriesMapping);

  // Load history for trend computation (23 prior months)
  const history = await loadNormalizedHistory(dataset, yyyymm, 23);

  // Get prior release data from existing latest.json (use display_value)
  const priorMetrics = {};
  if (existingLatest.metrics) {
    for (const key of Object.keys(metrics)) {
      if (existingLatest.metrics[key]) {
        // Handle both old format (just value) and new format (display_value)
        priorMetrics[key] = existingLatest.metrics[key].display_value ?? existingLatest.metrics[key].value;
      }
    }
  }

  // Compute deltas using display_values (already scaled and rounded)
  const deltas = {};
  for (const [key, metric] of Object.entries(metrics)) {
    if (priorMetrics[key] !== undefined) {
      const delta_raw = metric.display_value - priorMetrics[key];
      deltas[key] = {
        raw_value: delta_raw,
        display_value: Math.round(delta_raw * Math.pow(10, metric.precision)) / Math.pow(10, metric.precision),
        unit: metric.unit,
        precision: metric.precision
      };
    }
  }

  // Compute 24-month trends (23 historical + current)
  // Use display_values for trends
  const trends = {};
  for (const key of Object.keys(metrics)) {
    const historicalValues = history.map(h => {
      if (h === null) return null;
      // Handle both old format and new format
      const m = h.metrics?.[key];
      if (m === null || m === undefined) return null;
      return m.display_value ?? m;
    });
    
    const rawTrend = [...historicalValues, metrics[key].display_value];
    trends[key] = padTrend(rawTrend);
    
    if (trends[key].length !== TREND_LENGTH) {
      throw new Error(`Trend for ${key} has ${trends[key].length} values, expected ${TREND_LENGTH}`);
    }
  }

  // GUARDRAIL: Abort if any trend has more than 12 null values
  for (const [key, trendValues] of Object.entries(trends)) {
    const nullCount = trendValues.filter(v => v === null).length;
    if (nullCount > 12) {
      console.error(`[fetch_bls] ABORT: Trend for "${key}" has ${nullCount} null values (max allowed: 12)`);
      console.error(`[fetch_bls] Insufficient historical data to publish safely`);
      process.exit(1);
    }
  }

  // Compute 12-month averages (using display_values from trends)
  const twelveMonthAvg = {};
  for (const [key, trendValues] of Object.entries(trends)) {
    const last12 = trendValues.slice(-12).filter(v => v !== null && v !== undefined);
    if (last12.length > 0) {
      const avg = last12.reduce((a, b) => a + b, 0) / last12.length;
      const def = METRIC_DEFINITIONS[dataset]?.[key] || { precision: 2 };
      twelveMonthAvg[key] = Math.round(avg * Math.pow(10, def.precision)) / Math.pow(10, def.precision);
    }
  }

  return {
    reference_period: yyyymm,
    periodName: latestPeriod.periodName,
    year: latestPeriod.year,
    fetched_at: new Date().toISOString(),
    metrics,
    deltas,
    comparisons: {
      prior_release: deltas,
      twelve_month_average: twelveMonthAvg,
      trend: trends
    }
  };
}

/**
 * Save raw and normalized data
 */
async function saveData(dataset, yyyymm, rawData, normalizedData) {
  const rawPath = path.join(DATA_DIR, 'raw', dataset, `${yyyymm}.json`);
  const normalizedPath = path.join(DATA_DIR, 'normalized', dataset, `${yyyymm}.normalized.json`);

  // Ensure directories exist
  await fs.mkdir(path.dirname(rawPath), { recursive: true });
  await fs.mkdir(path.dirname(normalizedPath), { recursive: true });

  // Save raw (immutable source)
  await fs.writeFile(rawPath, JSON.stringify(rawData, null, 2));
  console.log(`[fetch_bls] Saved raw data: ${rawPath}`);

  // Save normalized
  await fs.writeFile(normalizedPath, JSON.stringify(normalizedData, null, 2));
  console.log(`[fetch_bls] Saved normalized data: ${normalizedPath}`);
}

/**
 * Main execution
 */
async function main() {
  console.log(`[fetch_bls] Starting ingest for dataset: ${DATASET}`);

  // Load existing dataset config
  const existingLatest = await loadDatasetConfig(DATASET);
  const seriesMapping = existingLatest.source?.series_ids;

  if (!seriesMapping || Object.keys(seriesMapping).length === 0) {
    console.error(`[fetch_bls] No series_ids found in latest.${DATASET}.json`);
    process.exit(1);
  }

  const seriesIds = Object.values(seriesMapping);
  console.log(`[fetch_bls] Series IDs: ${seriesIds.join(', ')}`);

  // Determine year range (current year and previous, handles January edge case)
  const currentYear = new Date().getFullYear();
  const startYear = currentYear - 1;
  const endYear = currentYear;

  console.log(`[fetch_bls] Fetching BLS data for ${startYear}-${endYear}`);

  // Fetch from BLS using axios
  let seriesData;
  try {
    seriesData = await fetchBLS(seriesIds, startYear, endYear);
  } catch (err) {
    console.error(`[fetch_bls] BLS API error: ${err.message}`);
    process.exit(1);
  }

  // Find latest aligned period
  const latestPeriod = findLatestPeriod(seriesData);
  if (!latestPeriod) {
    console.error('[fetch_bls] Failed to find aligned latest period');
    process.exit(1);
  }

  const yyyymm = periodToYYYYMM(latestPeriod.year, latestPeriod.period);
  console.log(`[fetch_bls] Latest period: ${yyyymm} (${latestPeriod.periodName} ${latestPeriod.year})`);

  // Check if we already have this data
  if (await rawFileExists(DATASET, yyyymm)) {
    console.log(`[fetch_bls] Raw file already exists for ${yyyymm}. No new data.`);
    process.exit(0);
  }

  // Compute normalized data
  const normalizedData = await computeNormalized(DATASET, latestPeriod, seriesMapping, existingLatest);

  // Prepare raw data snapshot
  const rawData = {
    fetched_at: new Date().toISOString(),
    source: 'BLS API',
    series: seriesData.map(s => ({
      seriesID: s.seriesID,
      data: s.data.filter(d => MONTHLY_PERIODS.includes(d.period))
    }))
  };

  // Save both files
  await saveData(DATASET, yyyymm, rawData, normalizedData);

  // Write reference period to stdout for downstream scripts
  console.log(`[fetch_bls] NEW_PERIOD=${yyyymm}`);
  
  // Set output for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    await fs.appendFile(process.env.GITHUB_OUTPUT, `new_period=${yyyymm}\n`);
    await fs.appendFile(process.env.GITHUB_OUTPUT, `has_new_data=true\n`);
  }

  console.log('[fetch_bls] Ingest complete');
}

main().catch(err => {
  console.error(`[fetch_bls] Fatal error: ${err.message}`);
  process.exit(1);
});
