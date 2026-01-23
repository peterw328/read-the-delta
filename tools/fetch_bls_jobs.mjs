#!/usr/bin/env node

/**
 * fetch_bls_jobs.mjs
 * 
 * Fetches BLS employment data and outputs a structured JSON artifact.
 * 
 * Usage:
 *   node tools/fetch_bls_jobs.mjs
 * 
 * Environment:
 *   BLS_API_KEY (optional) - Increases rate limit from 10 to 500 requests/day
 * 
 * Output:
 *   ./data/latest.jobs.json
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, '..', 'data', 'latest.jobs.json');

// BLS Series IDs
const SERIES = {
  payrolls: 'CES0000000001',      // Total Nonfarm Payroll (thousands)
  unemployment: 'LNS14000000',     // Unemployment Rate (percent)
  wages: 'CES0500000003'           // Avg Hourly Earnings, All Private (dollars)
};

// Series metadata for output
const SERIES_META = {
  payrolls: {
    labelPrimary: 'Monthly Job Change',
    labelQualifier: 'Nonfarm Payrolls',
    unit: 'thousands'
  },
  unemployment: {
    labelPrimary: 'Unemployment Rate',
    labelQualifier: 'Household Survey',
    unit: 'percent'
  },
  wages: {
    labelPrimary: 'Average Hourly Earnings',
    labelQualifier: 'Private Nonfarm',
    unit: 'dollars'
  }
};

/**
 * Round value based on unit type
 * - percent: 1 decimal place
 * - dollars: 2 decimal places
 * - thousands: nearest integer
 */
function roundByUnit(value, unit) {
  switch (unit) {
    case 'percent':
      return Math.round(value * 10) / 10;
    case 'dollars':
      return Math.round(value * 100) / 100;
    case 'thousands':
      return Math.round(value);
    default:
      return value;
  }
}

/**
 * Convert employment levels to monthly changes
 * Input: array of {year, month, value} where value is employment level
 * Output: array of {year, month, value} where value is month-over-month change
 */
function computeMonthlyChanges(levelData) {
  if (levelData.length < 2) return [];
  
  const changes = [];
  for (let i = 1; i < levelData.length; i++) {
    changes.push({
      year: levelData[i].year,
      month: levelData[i].month,
      value: levelData[i].value - levelData[i - 1].value
    });
  }
  return changes;
}

/**
 * Fetch data from BLS API v2
 * Returns null if request fails
 */
async function fetchBLS(seriesIds, startYear, endYear) {
  const apiKey = process.env.BLS_API_KEY;
  const endpoint = 'https://api.bls.gov/publicAPI/v2/timeseries/data/';
  
  const payload = {
    seriesid: seriesIds,
    startyear: String(startYear),
    endyear: String(endYear),
    calculations: false,
    annualaverage: false
  };
  
  // Add API key if available
  if (apiKey) {
    payload.registrationkey = apiKey;
    console.log('Using registered API key');
  } else {
    console.log('No API key found. Using public rate limit (10 requests/day).');
  }
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      console.error(`BLS API returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    
    if (data.status !== 'REQUEST_SUCCEEDED') {
      console.error('BLS API error:', data.message || 'Unknown error');
      return null;
    }
    
    return data.Results.series;
  } catch (err) {
    console.error('Failed to reach BLS API:', err.message);
    return null;
  }
}

/**
 * Parse BLS series data into sorted array of { year, month, value }
 * Sorted oldest-first
 */
function parseSeries(seriesData) {
  if (!seriesData || !seriesData.data) return [];
  
  return seriesData.data
    .filter(d => d.period.startsWith('M'))  // Monthly only, skip annual
    .map(d => ({
      year: parseInt(d.year, 10),
      month: parseInt(d.period.slice(1), 10),
      value: parseFloat(d.value)
    }))
    .sort((a, b) => {
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    });
}

/**
 * Build a series object from parsed data
 */
function buildSeriesObject(parsed, meta) {
  const unit = meta.unit;
  
  // Take last 24 months
  const last24 = parsed.slice(-24);
  const last12 = last24.slice(-12);
  
  const current = last24[last24.length - 1]?.value ?? 0;
  const previous = last24[last24.length - 2]?.value ?? 0;
  const delta = roundByUnit(current - previous, unit);
  
  const values12 = last12.map(d => d.value);
  const avg12 = values12.reduce((sum, v) => sum + v, 0) / values12.length;
  const min12 = Math.min(...values12);
  const max12 = Math.max(...values12);
  
  return {
    labelPrimary: meta.labelPrimary,
    labelQualifier: meta.labelQualifier,
    value: roundByUnit(current, unit),
    unit: unit,
    delta: delta,
    trend: {
      values: last24.map(d => roundByUnit(d.value, unit)),
      period: 'monthly',
      months: 24
    },
    context: {
      twelveMonthAvg: roundByUnit(avg12, unit),
      range12m: [roundByUnit(min12, unit), roundByUnit(max12, unit)]
    }
  };
}

/**
 * Generate fallback data when API is unavailable
 * Values are realistic placeholders based on typical 2024 data
 */
function generateFallbackData() {
  console.log('Generating fallback data...');
  
  // Payrolls: Monthly job changes (not levels). Typical range: 80-300K.
  // Mix of strong and weak months to show realistic variation.
  const fallbackPayrolls = [
    256, 310, 175, 108, 165, 272,
    215, 89, 142, 223, 186, 117,
    200, 275, 165, 130, 195, 245,
    155, 112, 178, 210, 143, 180
  ];
  
  // Unemployment: Rate as percent. Typical range: 3.5-4.5%.
  // Shows realistic month-to-month fluctuation of ±0.1-0.2.
  const fallbackUnemployment = [
    3.7, 3.7, 3.8, 3.9, 3.9, 4.0,
    4.0, 4.1, 4.1, 4.2, 4.1, 4.0,
    4.0, 3.9, 3.9, 4.0, 4.0, 4.1,
    4.1, 4.0, 4.0, 3.9, 4.0, 4.1
  ];
  
  // Wages: Hourly rate in dollars. Slow steady climb typical.
  const fallbackWages = [
    33.00, 33.10, 33.20, 33.30, 33.40, 33.50,
    33.60, 33.70, 33.80, 33.90, 34.00, 34.10,
    34.20, 34.30, 34.40, 34.50, 34.60, 34.70,
    34.80, 34.90, 35.00, 35.10, 35.20, 35.30
  ];
  
  function buildFallbackSeries(values, meta) {
    const unit = meta.unit;
    const last12 = values.slice(-12);
    const current = values[values.length - 1];
    const previous = values[values.length - 2];
    const delta = roundByUnit(current - previous, unit);
    const avg12 = last12.reduce((s, v) => s + v, 0) / 12;
    const min12 = Math.min(...last12);
    const max12 = Math.max(...last12);
    
    return {
      labelPrimary: meta.labelPrimary,
      labelQualifier: meta.labelQualifier,
      value: roundByUnit(current, unit),
      unit: unit,
      delta: delta,
      trend: {
        values: values.map(v => roundByUnit(v, unit)),
        period: 'monthly',
        months: 24
      },
      context: {
        twelveMonthAvg: roundByUnit(avg12, unit),
        range12m: [roundByUnit(min12, unit), roundByUnit(max12, unit)]
      }
    };
  }
  
  return {
    payrolls: buildFallbackSeries(fallbackPayrolls, SERIES_META.payrolls),
    unemployment: buildFallbackSeries(fallbackUnemployment, SERIES_META.unemployment),
    wages: buildFallbackSeries(fallbackWages, SERIES_META.wages)
  };
}

/**
 * Main execution
 */
async function main() {
  console.log('ReadTheDelta.com - BLS Jobs Data Fetch');
  console.log('======================================\n');
  
  const now = new Date();
  const currentYear = now.getFullYear();
  const startYear = currentYear - 2;  // 3 years of data to ensure 24 months
  
  let series = null;
  let dataSource = 'fallback';
  
  // Attempt live fetch
  console.log(`Fetching BLS data for ${startYear}-${currentYear}...`);
  const blsData = await fetchBLS(Object.values(SERIES), startYear, currentYear);
  
  if (blsData) {
    // Map series by ID
    const byId = {};
    for (const s of blsData) {
      byId[s.seriesID] = s;
    }
    
    // Parse raw data
    const payrollLevels = parseSeries(byId[SERIES.payrolls]);
    const unemploymentData = parseSeries(byId[SERIES.unemployment]);
    const wagesData = parseSeries(byId[SERIES.wages]);
    
    // Convert payroll levels to monthly changes
    const payrollChanges = computeMonthlyChanges(payrollLevels);
    
    // Build series objects
    series = {
      payrolls: buildSeriesObject(payrollChanges, SERIES_META.payrolls),
      unemployment: buildSeriesObject(unemploymentData, SERIES_META.unemployment),
      wages: buildSeriesObject(wagesData, SERIES_META.wages)
    };
    dataSource = 'live';
    console.log('Live data retrieved successfully.\n');
  } else {
    series = generateFallbackData();
    console.log('Using fallback data.\n');
  }
  
  // Build output artifact
  const artifact = {
    meta: {
      releaseDate: 'RELEASE_DATE_PLACEHOLDER',   // Editor fills this
      nextRelease: 'NEXT_RELEASE_PLACEHOLDER',   // Editor fills this
      generated_at: now.toISOString(),
      dataSource: dataSource
    },
    narrative: {
      headline: 'HEADLINE_WAITING_FOR_EDITOR',
      lede: 'LEDE_WAITING_FOR_EDITOR',
      whyItMatters: 'WHY_IT_MATTERS_WAITING_FOR_EDITOR'
    },
    series: series
  };
  
  // Write output
  const output = JSON.stringify(artifact, null, 2);
  writeFileSync(OUTPUT_PATH, output, 'utf-8');
  
  console.log(`Output written to: ${OUTPUT_PATH}`);
  console.log(`Data source: ${dataSource}`);
  console.log(`Generated at: ${artifact.meta.generated_at}`);
  console.log('\nSummary:');
  console.log(`  Payrolls: ${series.payrolls.value > 0 ? '+' : ''}${series.payrolls.value}K jobs (Δ ${series.payrolls.delta > 0 ? '+' : ''}${series.payrolls.delta}K)`);
  console.log(`  Unemployment: ${series.unemployment.value}% (Δ ${series.unemployment.delta > 0 ? '+' : ''}${series.unemployment.delta})`);
  console.log(`  Wages: $${series.wages.value.toFixed(2)}/hr (Δ ${series.wages.delta > 0 ? '+' : ''}$${series.wages.delta.toFixed(2)})`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
