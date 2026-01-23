/**
 * render.js
 * Data renderer and chrome injector for ReadTheDelta
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
    { id: 'jobs', label: 'Jobs', href: '/src/pages/jobs.html' },
    { id: 'inflation', label: 'Inflation', href: '/src/pages/inflation.html' },
    { id: 'methodology', label: 'Methodology', href: '/src/pages/methodology.html' }
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
      <a href="/src/pages/about.html" class="footer-link">About</a>
      <a href="/src/pages/methodology.html" class="footer-link">Methodology</a>
      <a href="/src/pages/legal.html" class="footer-link">Legal</a>
    </nav>
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
  if (!dateStr || dateStr.includes('PLACEHOLDER')) return null;
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
 * Format a number based on unit type
 */
function formatValue(value, unit) {
  if (value == null) return '—';
  
  switch (unit) {
    case 'percent':
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(value) + '%';
    
    case 'dollars':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    
    case 'thousands':
      return new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
      }).format(value) + 'K';
    
    default:
      return new Intl.NumberFormat('en-US').format(value);
  }
}

/**
 * Format a delta value with +/− prefix
 */
function formatDelta(delta, unit) {
  if (delta == null) return '—';
  
  const isNegative = delta < 0;
  const absValue = Math.abs(delta);
  const prefix = delta > 0 ? '+' : (isNegative ? '−' : '');
  
  switch (unit) {
    case 'percent':
      return prefix + new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
      }).format(absValue) + '%';
    
    case 'dollars':
      const formatted = new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(absValue);
      return prefix + '$' + formatted;
    
    case 'thousands':
      return prefix + new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0
      }).format(absValue) + 'K';
    
    default:
      return prefix + new Intl.NumberFormat('en-US').format(absValue);
  }
}

/**
 * Get delta direction class
 */
function getDeltaClass(delta) {
  if (delta > 0) return 'delta-up';
  if (delta < 0) return 'delta-down';
  return 'delta-flat';
}

/**
 * Check if a string contains editor placeholder text
 */
function isPlaceholder(str) {
  return typeof str === 'string' && str.includes('WAITING_FOR_EDITOR');
}

/**
 * Render metadata section
 */
function renderMeta(meta) {
  const releaseEl = getEl('release-date');
  if (releaseEl) {
    const formatted = formatDate(meta.releaseDate);
    if (formatted) {
      releaseEl.textContent = formatted;
      releaseEl.setAttribute('datetime', meta.releaseDate);
    } else {
      releaseEl.textContent = '—';
    }
  }
  
  const generatedEl = getEl('generated-at');
  if (generatedEl) {
    const formatted = formatGeneratedAt(meta.generated_at);
    generatedEl.textContent = formatted || '—';
  }
  
  const sourceNoteEl = getEl('source-note');
  if (sourceNoteEl) {
    sourceNoteEl.hidden = meta.dataSource !== 'fallback';
  }
}

/**
 * Render narrative section
 */
function renderNarrative(narrative) {
  const headlineEl = getEl('headline');
  if (headlineEl) {
    if (isPlaceholder(narrative.headline)) {
      headlineEl.hidden = true;
    } else {
      headlineEl.textContent = narrative.headline;
    }
  }
  
  const ledeEl = getEl('lede');
  if (ledeEl) {
    if (isPlaceholder(narrative.lede)) {
      ledeEl.hidden = true;
    } else {
      ledeEl.textContent = narrative.lede;
    }
  }
  
  const whyTextEl = getEl('why-it-matters-text');
  const whySectionEl = getEl('why-it-matters');
  if (whyTextEl && whySectionEl) {
    if (isPlaceholder(narrative.whyItMatters)) {
      whySectionEl.hidden = true;
    } else {
      whyTextEl.textContent = narrative.whyItMatters;
    }
  }
}

/**
 * Render a single metric card
 */
function renderMetric(key, data) {
  const { value, unit, delta, context } = data;
  
  const valueEl = getEl(`${key}-value`);
  if (valueEl) {
    valueEl.textContent = formatValue(value, unit);
  }
  
  const deltaEl = getEl(`${key}-delta`);
  if (deltaEl) {
    deltaEl.textContent = formatDelta(delta, unit);
    deltaEl.classList.remove('delta-up', 'delta-down', 'delta-flat');
    deltaEl.classList.add(getDeltaClass(delta));
  }
  
  const contextEl = getEl(`${key}-context`);
  if (contextEl) {
    if (!context || context.twelveMonthAvg == null) {
      contextEl.textContent = '';
      return;
    }
    const avgFormatted = formatValue(context.twelveMonthAvg, unit);
    contextEl.textContent = `12-mo Avg: ${avgFormatted}`;
  }
}

/**
 * Render all metric cards from series data
 */
function renderSeries(series) {
  Object.keys(series).forEach(key => {
    renderMetric(key, series[key]);
  });
}

/**
 * Render next release date in page footer
 */
function renderPageFooter(meta) {
  const nextReleaseEl = getEl('next-release');
  if (nextReleaseEl) {
    const formatted = formatDate(meta.nextRelease);
    nextReleaseEl.textContent = formatted || '—';
  }
}

/**
 * Render "What Changed" bullet list
 */
function renderChangeList(bullets) {
  const listEl = document.querySelector('.change-list');
  const sectionEl = document.querySelector('.what-changed');
  
  if (!listEl) return;
  
  if (!bullets || !Array.isArray(bullets) || bullets.length === 0) {
    if (sectionEl) sectionEl.hidden = true;
    return;
  }
  
  listEl.innerHTML = '';
  
  for (const bullet of bullets) {
    if (typeof bullet === 'string' && bullet.trim()) {
      const li = document.createElement('li');
      li.textContent = bullet;
      listEl.appendChild(li);
    }
  }
  
  if (sectionEl) sectionEl.hidden = false;
}

/**
 * Render "Previous Releases" list
 */
function renderPreviousReleases(releases) {
  const listEl = document.querySelector('.release-list');
  const sectionEl = document.querySelector('.previous-releases');
  
  if (!listEl) return;
  
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
 * Render sparkline charts for all metrics
 */
function renderCharts(series) {
  if (!Chart) {
    console.warn('[render.js] Chart.js not loaded, skipping sparklines');
    return;
  }
  
  Object.keys(series).forEach(key => {
    try {
      const container = document.querySelector(`.sparkline-wrap[data-series="${key}"]`);
      if (!container) return;
      
      const metricData = series[key];
      if (!metricData?.trend?.values?.length) return;
      
      if (chartInstances[key]) {
        chartInstances[key].destroy();
        delete chartInstances[key];
      }
      
      container.innerHTML = '';
      
      const containerHeight = container.offsetHeight || 36;
      const containerWidth = container.offsetWidth || 240;
      
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${metricData.labelPrimary} trend over 24 months`);
      canvas.width = containerWidth * 2;
      canvas.height = containerHeight * 2;
      canvas.style.display = 'block';
      canvas.style.width = containerWidth + 'px';
      canvas.style.height = containerHeight + 'px';
      container.appendChild(canvas);
      
      const config = getSparklineConfig(metricData.trend.values);
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
    
    renderMeta(data.meta);
    renderNarrative(data.narrative);
    renderSeries(data.series);
    renderPageFooter(data.meta);
    renderChangeList(data.narrative?.bullets);
    renderPreviousReleases(data.meta?.previousReleases);
    
    await loadChartJS();
    renderCharts(data.series);
    
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
