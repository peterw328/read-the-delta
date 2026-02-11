/**
 * render.js
 * Data renderer and chrome injector for ReadTheDelta
 * Compatible with canonical editorial-first JSON schema
 * Dataset-agnostic: works for jobs, inflation, and future datasets
 * 
 * FIXED: Properly handles structured metric format with display_value
 */

/**
 * Get data file URL based on current page
 */
function getDataUrl() {
  const page = document.body.dataset.page;
  return page === 'inflation'
    ? '/data/latest.inflation.json'
    : '/data/latest.jobs.json';
}

/**
 * Chart instance registry (prevents memory leaks on re-render)
 */
const chartInstances = {};

/**
 * Chart.js reference (loaded dynamically)
 */
let Chart = null;

/**
 * Get current page identifier from body data attribute
 */
function getCurrentPage() {
  return document.body.dataset.page || '';
}

/**
 * Generate header HTML
 */
function generateHeader(activePage) {
  const navItems = [
    { id: 'jobs', label: 'Jobs', href: '/jobs.html' },
    { id: 'inflation', label: 'Inflation', href: '/inflation.html' },
    { id: 'methodology', label: 'Methodology', href: '/methodology.html' }
  ];
  
  const navLinks = navItems.map(item => {
    const activeClass = item.id === activePage ? ' nav-link-active' : '';
    return `<a href="${item.href}" class="nav-link${activeClass}">${item.label}</a>`;
  }).join('\n        ');
  
  return `
  <header class="site-header">
    <div class="site-header-inner">
      <a href="/" class="wordmark">Read the Delta</a>
      <nav class="site-nav" aria-label="Main navigation">
        ${navLinks}
      </nav>
    </div>
  </header>`;
}

/**
 * Generate footer HTML
 */
function generateFooter() {
  return `
  <footer class="site-footer">
    <nav class="footer-nav" aria-label="Footer navigation">
      <a href="/about.html" class="footer-link">About</a>
      <a href="/methodology.html" class="footer-link">Methodology</a>
      <a href="/legal.html" class="footer-link">Legal</a>
    </nav>
    <div class="footer-related">
      <span class="footer-related-label">Related</span>
      <a href="https://item1adelta.com" class="footer-related-link" target="_blank" rel="noopener">Item 1A Delta</a>
      <span class="footer-related-desc">&mdash; SEC Risk Disclosure Changes</span>
    </div>
    <small class="footer-copyright">Read the Delta</small>
  </footer>`;
}

/**
 * Inject chrome (header + footer) into page
 */
function injectChrome() {
  const activePage = getCurrentPage();
  
  const headerContainer = document.getElementById('site-header-container');
  if (headerContainer) {
    headerContainer.innerHTML = generateHeader(activePage);
  }
  
  const footerContainer = document.getElementById('site-footer-container');
  if (footerContainer) {
    footerContainer.innerHTML = generateFooter();
  }
}

/**
 * Safely get a DOM element by ID
 */
function getEl(id) {
  return document.getElementById(id);
}

/**
 * Format a date string as "Month Day, Year"
 */
function formatDate(dateStr) {
  if (!dateStr) return null;
  const date = new Date(dateStr);
  if (isNaN(date)) return null;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(date);
}

/**
 * Format an ISO timestamp as "Updated Month Day · HH:MM UTC"
 */
function formatGeneratedAt(isoStr) {
  if (!isoStr) return null;
  const date = new Date(isoStr);
  if (isNaN(date)) return null;
  
  const monthDay = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric'
  }).format(date);
  
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  
  return `Updated ${monthDay} · ${hours}:${minutes} UTC`;
}

/**
 * Capitalize first letter of a string
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Extract display value from structured or legacy format
 * Handles: { display_value: X }, { value: X }, or just X
 */
function extractDisplayValue(data) {
  if (data == null) return null;
  
  // If it's an object with display_value, use that
  if (typeof data === 'object' && data.display_value != null) {
    return data.display_value;
  }
  
  // If it's an object with value (legacy), use that
  if (typeof data === 'object' && data.value != null) {
    return data.value;
  }
  
  // Otherwise treat as raw number
  return typeof data === 'number' ? data : null;
}

/**
 * Format a number based on unit type
 */
function formatValue(value, unit, precision) {
  if (value == null) return '—';
  
  const prec = precision ?? 1;
  
  switch (unit) {
    case 'percent':
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: prec,
        maximumFractionDigits: prec
      }).format(value) + '%';
    
    case 'thousands':
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
      }).format(value) + 'K';
    
    case 'dollars':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    
    default:
      return new Intl.NumberFormat('en-US').format(value);
  }
}

/**
 * Format a delta value with +/− prefix
 * Values that round to zero at the given precision display as flat (no prefix)
 */
function formatDelta(delta, unit, precision) {
  if (delta == null) return '\u2014';
  
  const prec = precision ?? 1;
  const absValue = Math.abs(delta);
  
  // If value rounds to zero at display precision, treat as flat
  const rounded = Number(absValue.toFixed(prec));
  if (rounded === 0) {
    delta = 0;
  }
  
  const isNegative = delta < 0;
  const prefix = delta > 0 ? '+' : (isNegative ? '\u2212' : '');
  
  switch (unit) {
    case 'percent':
      return prefix + new Intl.NumberFormat('en-US', {
        minimumFractionDigits: prec,
        maximumFractionDigits: prec
      }).format(absValue) + '%';
    
    case 'thousands':
      return prefix + new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
      }).format(absValue) + 'K';
    
    case 'dollars':
      const formatted = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(absValue);
      return prefix + '$' + formatted;
    
    default:
      return prefix + new Intl.NumberFormat('en-US').format(absValue);
  }
}

/**
 * Get delta direction class
 * Values that round to zero at display precision are flat
 */
function getDeltaClass(delta, precision) {
  if (delta == null) return 'delta-flat';
  const prec = precision ?? 1;
  const rounded = Number(Math.abs(delta).toFixed(prec));
  if (rounded === 0) return 'delta-flat';
  if (delta > 0) return 'delta-up';
  if (delta < 0) return 'delta-down';
  return 'delta-flat';
}

/**
 * Render release metadata section
 */
function renderRelease(release) {
  const releaseEl = getEl('release-date');
  if (releaseEl) {
    const formatted = formatDate(release.date);
    if (formatted) {
      releaseEl.textContent = formatted;
      releaseEl.setAttribute('datetime', release.date);
    } else {
      releaseEl.textContent = '—';
    }
  }
  
  const generatedEl = getEl('generated-at');
  if (generatedEl) {
    const formatted = formatGeneratedAt(release.generated_at);
    generatedEl.textContent = formatted || '—';
  }
}

/**
 * Render headline section
 * Maps headline.title → #headline
 * Maps headline.summary → #lede
 * Note: headline.context (why it matters) removed from UI - redundant with signal badge
 */
function renderHeadline(headline) {
  const titleEl = getEl('headline');
  if (titleEl && headline.title) {
    titleEl.textContent = headline.title;
  }
  
  const summaryEl = getEl('lede');
  if (summaryEl && headline.summary) {
    summaryEl.textContent = headline.summary;
  }
  
  // Why It Matters section removed - signal badge provides same information
}

/**
 * Render signal badge (if present and non-empty)
 * Places badge on its own line below hero-meta for flush-left alignment
 */
function renderSignal(signal) {
  if (!signal) return;
  
  const state = signal.state;
  const pressure = signal.pressure;
  
  // Only render if both exist and are non-empty strings
  if (!state || !pressure || typeof state !== 'string' || typeof pressure !== 'string') {
    return;
  }
  
  if (state.trim() === '' || pressure.trim() === '') {
    return;
  }
  
  const heroMeta = document.querySelector('.hero-meta');
  if (!heroMeta) return;
  
  // Create signal badge
  const badge = document.createElement('span');
  badge.className = 'signal-badge';
  badge.textContent = `State: ${capitalize(state)} · Pressure: ${capitalize(pressure)}`;
  
  // Insert badge after hero-meta (on its own line)
  heroMeta.parentNode.insertBefore(badge, heroMeta.nextSibling);
}

/**
 * Render a single metric card
 * Uses JSON key directly as ID prefix (no casing conversion)
 * e.g., metrics.payrolls → #payrolls-value
 * e.g., metrics.cpi_yoy → #cpi_yoy-value
 * 
 * FIXED: Properly extracts display_value from structured format
 */
function renderMetric(key, metric, comparisons) {
  const { unit, precision } = metric;
  
  // Extract display value from structured format
  const value = extractDisplayValue(metric.value);
  
  const priorData = comparisons?.prior_release?.[key];
  
  // Extract delta from structured format
  const delta = extractDisplayValue(priorData?.delta);
  
  // Extract prior value from structured format
  const priorValue = extractDisplayValue(priorData?.value);
  
  const twelveMonthAvg = comparisons?.twelve_month_average?.[key];
  
  // Main value: #${key}-value
  const valueEl = getEl(`${key}-value`);
  if (valueEl) {
    valueEl.textContent = formatValue(value, unit, precision);
  }
  
  // Delta: #${key}-delta
  const deltaEl = getEl(`${key}-delta`);
  if (deltaEl) {
    deltaEl.textContent = formatDelta(delta, unit, precision);
    deltaEl.classList.remove('delta-up', 'delta-down', 'delta-flat');
    deltaEl.classList.add(getDeltaClass(delta, precision));
  }
  
  // Context (12-month average): #${key}-context
  const contextEl = getEl(`${key}-context`);
  if (contextEl) {
    if (twelveMonthAvg != null) {
      const avgFormatted = formatValue(twelveMonthAvg, unit, precision);
      contextEl.textContent = `12-mo Avg: ${avgFormatted}`;
    } else if (priorValue != null) {
      // Fallback: show prior value if no 12-month average
      const priorFormatted = formatValue(priorValue, unit, precision);
      contextEl.textContent = `Prior: ${priorFormatted}`;
    } else {
      contextEl.textContent = '';
    }
  }
}

/**
 * Render all metric cards dynamically
 * Iterates through metrics object keys (dataset-agnostic)
 */
function renderMetrics(metrics, comparisons) {
  if (!metrics) return;
  
  Object.keys(metrics).forEach(key => {
    renderMetric(key, metrics[key], comparisons);
  });
}

/**
 * Render next release date in page footer
 */
function renderPageFooter(release) {
  const nextReleaseEl = getEl('next-release');
  if (nextReleaseEl) {
    const formatted = formatDate(release.next_release);
    nextReleaseEl.textContent = formatted || '—';
  }
}

/**
 * Render "What Changed" section from editorial
 * Maps editorial.what_changed → .change-list
 * Optionally appends editorial.revision_note
 */
function renderEditorial(editorial) {
  const listEl = document.querySelector('.change-list');
  const sectionEl = document.querySelector('.what-changed');
  
  if (!listEl || !sectionEl) return;
  
  const whatChanged = editorial?.what_changed;
  const whatDidnt = editorial?.what_didnt;
  const whyItMatters = editorial?.why_it_matters;
  const revisionNote = editorial?.revision_note;
  
  if (!whatChanged || whatChanged.trim() === '') {
    sectionEl.hidden = true;
    return;
  }
  
  // Split on sentence boundaries and filter empty strings
  const bullets = whatChanged.split(/\.\s+/).filter(s => s.trim());
  
  listEl.innerHTML = '';
  
  for (const bullet of bullets) {
    const li = document.createElement('li');
    li.textContent = bullet.endsWith('.') ? bullet : bullet + '.';
    listEl.appendChild(li);
  }
  
  // Append "what didn't change" if present
  if (whatDidnt && whatDidnt.trim() !== '') {
    const li = document.createElement('li');
    li.className = 'what-didnt';
    li.textContent = whatDidnt.endsWith('.') ? whatDidnt : whatDidnt + '.';
    listEl.appendChild(li);
  }
  
  // Append "why it matters" if present
  if (whyItMatters && whyItMatters.trim() !== '') {
    const li = document.createElement('li');
    li.className = 'why-matters';
    li.textContent = whyItMatters.endsWith('.') ? whyItMatters : whyItMatters + '.';
    listEl.appendChild(li);
  }
  
  // Append revision note as final bullet if present
  if (revisionNote && revisionNote.trim() !== '') {
    const li = document.createElement('li');
    li.className = 'revision-note';
    li.textContent = revisionNote.endsWith('.') ? revisionNote : revisionNote + '.';
    listEl.appendChild(li);
  }
  
  sectionEl.hidden = false;
}

/**
 * Render "Previous Releases" list
 */
function renderPreviousReleases(history) {
  const listEl = document.querySelector('.release-list');
  const sectionEl = document.querySelector('.previous-releases');
  
  if (!listEl) return;
  
  const releases = history?.previous_releases;
  if (!releases || !Array.isArray(releases) || releases.length === 0) {
    if (sectionEl) sectionEl.hidden = true;
    return;
  }
  
  listEl.innerHTML = '';
  
  for (const release of releases) {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'release-date';
    
    if (release.label) {
      span.textContent = release.label;
    } else if (release.date) {
      span.textContent = formatDate(release.date) || release.date;
    }
    
    li.appendChild(span);
    listEl.appendChild(li);
  }
  
  if (sectionEl) sectionEl.hidden = false;
}

/**
 * Sparkline chart configuration
 */
function getSparklineConfig(values) {
  const dataLength = values.length;
  const minVal = Math.min(...values);
  const maxVal = Math.max(...values);
  
  const pointRadii = values.map((_, i) => i === dataLength - 1 ? 4 : 0);
  
  return {
    type: 'line',
    data: {
      labels: values.map((_, i) => i),
      datasets: [{
        data: values,
        borderColor: '#111111',
        borderWidth: 2.5,
        pointRadius: pointRadii,
        pointBackgroundColor: '#111111',
        pointBorderWidth: 0,
        fill: false,
        tension: 0.1,
        spanGaps: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: 6, right: 6, bottom: 6, left: 0 }
      },
      plugins: {
        legend: { display: false },
        tooltip: { enabled: false }
      },
      scales: {
        x: { display: false },
        y: { display: false, min: minVal, max: maxVal, grace: '10%' }
      },
      animation: { duration: 0 }
    }
  };
}

/**
 * Render sparkline charts for all metrics dynamically
 * Uses JSON keys directly to find matching HTML containers
 */
function renderCharts(metrics, comparisons) {
  if (!Chart) {
    console.warn('[render.js] Chart.js not loaded, skipping sparklines');
    return;
  }
  
  const trend = comparisons?.trend;
  if (!trend) return;
  
  Object.keys(metrics).forEach(key => {
    try {
      // Find container using exact key (no casing conversion)
      const container = document.querySelector(`.sparkline-wrap[data-series="${key}"]`);
      if (!container) return;
      
      const values = trend[key];
      if (!values || !Array.isArray(values) || values.length === 0) return;
      
      // Destroy existing chart instance to prevent memory leaks
      if (chartInstances[key]) {
        chartInstances[key].destroy();
        delete chartInstances[key];
      }
      
      container.innerHTML = '';
      
      const containerHeight = container.offsetHeight || 36;
      const containerWidth = container.offsetWidth || 240;
      
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${metrics[key].label} trend over ${trend.months || 24} months`);
      canvas.width = containerWidth * 2;
      canvas.height = containerHeight * 2;
      canvas.style.display = 'block';
      canvas.style.width = containerWidth + 'px';
      canvas.style.height = containerHeight + 'px';
      container.appendChild(canvas);
      
      const config = getSparklineConfig(values);
      chartInstances[key] = new Chart(canvas, config);
      
    } catch (err) {
      console.warn(`[render.js] Failed to render sparkline for ${key}:`, err.message);
    }
  });
}

/**
 * Load Chart.js dynamically
 */
function loadChartJS() {
  return new Promise((resolve) => {
    if (window.Chart) {
      Chart = window.Chart;
      resolve(true);
      return;
    }
    
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
    script.onload = () => {
      Chart = window.Chart;
      resolve(true);
    };
    script.onerror = () => {
      console.warn('[render.js] Failed to load Chart.js');
      resolve(false);
    };
    document.head.appendChild(script);
  });
}

/**
 * Update SEO meta tags dynamically based on data
 */
function updateSEOMetaTags(data) {
  const page = getCurrentPage();
  const dataset = page === 'inflation' ? 'Inflation' : 'Jobs';
  
  // Update title
  if (data.headline?.title) {
    document.title = `${data.headline.title} | ${dataset} Report | Read the Delta`;
  }
  
  // Update meta description
  const metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc && data.headline?.summary) {
    const desc = `${data.headline.summary} Updated ${formatDate(data.release?.date) || 'recently'} with BLS data.`;
    metaDesc.setAttribute('content', desc);
  }
  
  // Update Open Graph tags
  const ogTitle = document.querySelector('meta[property="og:title"]');
  if (ogTitle && data.headline?.title) {
    ogTitle.setAttribute('content', `${data.headline.title} | Read the Delta`);
  }
  
  const ogDesc = document.querySelector('meta[property="og:description"]');
  if (ogDesc && data.headline?.summary) {
    ogDesc.setAttribute('content', data.headline.summary);
  }
  
  // Update Twitter Card tags
  const twitterTitle = document.querySelector('meta[name="twitter:title"]');
  if (twitterTitle && data.headline?.title) {
    twitterTitle.setAttribute('content', `${data.headline.title} | Read the Delta`);
  }
  
  const twitterDesc = document.querySelector('meta[name="twitter:description"]');
  if (twitterDesc && data.headline?.summary) {
    twitterDesc.setAttribute('content', data.headline.summary);
  }
  
  // Update structured data
  const structuredData = document.getElementById('structured-data');
  if (structuredData && data.release) {
    try {
      const schemaData = JSON.parse(structuredData.textContent);
      schemaData.name = `U.S. ${dataset} Report - ${data.release.reference_period}`;
      schemaData.description = data.headline?.summary || schemaData.description;
      schemaData.datePublished = data.release.date;
      schemaData.dateModified = data.release.generated_at;
      schemaData.temporalCoverage = data.release.reference_period;
      structuredData.textContent = JSON.stringify(schemaData, null, 2);
    } catch (err) {
      console.warn('[render.js] Failed to update structured data:', err.message);
    }
  }
}

/**
 * Main render function
 */
async function render() {
  // Always inject chrome first
  injectChrome();
  
  // Check if this is a data page
  const hasMetrics = document.querySelector('.metrics');
  if (!hasMetrics) {
    return; // Not a data page, chrome injection is sufficient
  }
  
  try {
    const dataUrl = getDataUrl();
    const response = await fetch(dataUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    
    // Update SEO meta tags first
    updateSEOMetaTags(data);
    
    // Render using canonical schema structure
    renderRelease(data.release);
    renderHeadline(data.headline);
    renderSignal(data.signal);
    renderMetrics(data.metrics, data.comparisons);
    renderPageFooter(data.release);
    renderEditorial(data.editorial);
    renderPreviousReleases(data.history);
    
    // Load Chart.js and render sparklines
    await loadChartJS();
    renderCharts(data.metrics, data.comparisons);
    
  } catch (err) {
    console.error('[render.js] Failed to load data:', err.message);
  }
}

// Initialize on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
