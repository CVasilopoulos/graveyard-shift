// Compute base path for GitHub Pages subpath compatibility
const base = new URL('.', document.baseURI).href;

// State
let allFindings = [];
let currentFilter = 'all';

// DOM elements
const filterInputs = document.querySelectorAll('input[name="status-filter"]');
const findingsList = document.getElementById('findings-list');
const countTotal = document.getElementById('count-total');
const countConfirmed = document.getElementById('count-confirmed');
const countGhost = document.getElementById('count-ghost');
const countResolved = document.getElementById('count-resolved');
const lastRunInfo = document.getElementById('last-run-info');

/**
 * Load JSON from a relative URL.
 * @param {string} name - The file name (e.g., 'findings.json')
 * @returns {Promise<any>}
 */
async function loadJson(name) {
  const url = new URL(name, base).href;
  const response = await fetch(url);
  if (!response.ok) {
    const error = new Error(response.statusText);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

/**
 * Fetch theme.json with fallback to defaults.
 * @returns {Promise<Object>}
 */
async function loadTheme() {
  try {
    return await loadJson('theme.json');
  } catch {
    // theme.json is optional; return empty object for fallback
    return {};
  }
}

/**
 * Apply theme to CSS custom properties.
 * @param {Object} theme - Theme object with optional name, tagline, accentColor, labels
 */
function applyTheme(theme) {
  const root = document.documentElement;

  if (theme.accentColor) {
    root.style.setProperty('--accent-color', theme.accentColor);
  }

  if (theme.labels?.confirmed) {
    root.style.setProperty('--label-confirmed', theme.labels.confirmed);
  }
  if (theme.labels?.ghost) {
    root.style.setProperty('--label-ghost', theme.labels.ghost);
  }
  if (theme.labels?.resolved) {
    root.style.setProperty('--label-resolved', theme.labels.resolved);
  }

  // Optional: update page title if theme name is provided
  if (theme.name) {
    document.title = theme.name;
    const header = document.querySelector('header h1');
    if (header) {
      header.textContent = theme.name;
    }
  }

  // Optional: display tagline if provided
  if (theme.tagline) {
    const header = document.querySelector('header');
    if (header) {
      const tagline = document.createElement('p');
      tagline.className = 'tagline';
      tagline.textContent = theme.tagline;
      header.appendChild(tagline);
    }
  }
}

/**
 * Compute aggregate counts from all findings.
 * @returns {Object}
 */
function computeCounts() {
  const counts = {
    total: 0,
    confirmed: 0,
    ghost: 0,
    resolved: 0,
  };

  for (const finding of allFindings) {
    counts.total += 1;
    if (finding.resolvedAt) {
      counts.resolved += 1;
    } else if (finding.status === 'confirmed') {
      counts.confirmed += 1;
    } else if (finding.status === 'ghost') {
      counts.ghost += 1;
    }
  }

  return counts;
}

/**
 * Update the counts display.
 */
function updateCounts() {
  const counts = computeCounts();
  countTotal.textContent = counts.total;
  countConfirmed.textContent = counts.confirmed;
  countGhost.textContent = counts.ghost;
  countResolved.textContent = counts.resolved;
}

/**
 * Filter findings based on current filter.
 * @returns {Array}
 */
function getFilteredFindings() {
  if (currentFilter === 'all') {
    return allFindings;
  }

  return allFindings.filter(finding => {
    if (currentFilter === 'resolved') {
      return finding.resolvedAt !== undefined;
    } else if (currentFilter === 'confirmed') {
      return finding.status === 'confirmed' && !finding.resolvedAt;
    } else if (currentFilter === 'ghost') {
      return finding.status === 'ghost' && !finding.resolvedAt;
    }
    return true;
  });
}

/**
 * Render a single finding card.
 * @param {Object} finding - Finding object
 * @returns {HTMLElement}
 */
function createFindingElement(finding) {
  const article = document.createElement('article');
  
  // Determine effective status for styling: confirmed/ghost or resolved
  const effectiveStatus = finding.resolvedAt ? 'resolved' : finding.status;
  article.className = `finding ${effectiveStatus}`;

  // Build HTML content
  const header = document.createElement('div');
  header.className = 'finding-header';

  const title = document.createElement('h3');
  title.className = 'finding-title';
  title.textContent = finding.title;

  const badges = document.createElement('div');
  badges.className = 'finding-badges';

  // Status badge with custom label
  const statusBadge = document.createElement('span');
  statusBadge.className = `badge status ${effectiveStatus}`;
  if (finding.resolvedAt) {
    statusBadge.textContent = 'Laid to Rest';
  } else if (finding.status === 'confirmed') {
    statusBadge.textContent = 'Haunted';
  } else {
    statusBadge.textContent = 'Ghost';
  }
  badges.appendChild(statusBadge);

  // Severity badge
  const severityBadge = document.createElement('span');
  severityBadge.className = `badge severity ${finding.severity}`;
  severityBadge.textContent = finding.severity.toUpperCase();
  badges.appendChild(severityBadge);

  header.appendChild(title);
  header.appendChild(badges);

  const summary = document.createElement('p');
  summary.className = 'finding-summary';
  summary.textContent = finding.summary;

  const sourceSection = document.createElement('div');
  sourceSection.className = 'finding-sources';
  const sourcesLabel = document.createElement('span');
  sourcesLabel.className = 'sources-label';
  sourcesLabel.textContent = 'Sources';
  
  const ul = document.createElement('ul');
  ul.className = 'source-list';
  
  for (const source of finding.sources) {
    const li = document.createElement('li');
    li.textContent = source;
    ul.appendChild(li);
  }
  
  sourceSection.appendChild(sourcesLabel);
  sourceSection.appendChild(ul);

  article.appendChild(header);
  article.appendChild(summary);
  article.appendChild(sourceSection);

  // Optional: add URL link
  if (finding.url) {
    const link = document.createElement('a');
    link.href = finding.url;
    link.textContent = 'More information';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    article.appendChild(link);
  }

  // Optional: add fix information
  if (finding.fix) {
    const fixDiv = document.createElement('div');
    fixDiv.className = 'finding-fix';
    
    const fixLabel = document.createElement('strong');
    fixLabel.textContent = 'Fix: ';
    fixDiv.appendChild(fixLabel);
    
    const fixText = document.createElement('span');
    fixText.textContent = finding.fix.text;
    if (finding.fix.value) {
      fixText.textContent += ` (${finding.fix.value})`;
    }
    fixDiv.appendChild(fixText);
    
    article.appendChild(fixDiv);
  }

  // Show stale indicator if applicable
  if (finding.stale) {
    const staleIndicator = document.createElement('div');
    staleIndicator.className = 'stale-indicator';
    staleIndicator.textContent = '⚠ Data may be stale';
    article.appendChild(staleIndicator);
  }

  return article;
}

/**
 * Render the findings list based on current filter.
 */
function renderFindings() {
  const filtered = getFilteredFindings();
  findingsList.innerHTML = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<p>No findings in this category.</p>';
    findingsList.appendChild(empty);
    return;
  }

  for (const finding of filtered) {
    findingsList.appendChild(createFindingElement(finding));
  }
}

/**
 * Update last run information.
 * @param {Array} runs - Array of RunRecord objects
 */
function updateLastRunInfo(runs) {
  lastRunInfo.innerHTML = '';

  if (!runs || runs.length === 0) {
    const noRuns = document.createElement('p');
    noRuns.textContent = 'No runs recorded';
    lastRunInfo.appendChild(noRuns);
    return;
  }

  const lastRun = runs[runs.length - 1];

  const timestamp = document.createElement('p');
  timestamp.className = 'last-run-timestamp';
  const date = new Date(lastRun.runAt);
  timestamp.innerHTML = `<strong>Last run:</strong> ${date.toLocaleString()}`;
  lastRunInfo.appendChild(timestamp);

  if (lastRun.errorSources && lastRun.errorSources.length > 0) {
    const errors = document.createElement('p');
    errors.className = 'error-sources';
    errors.innerHTML = `<strong>Errors from:</strong> ${lastRun.errorSources.join(', ')}`;
    lastRunInfo.appendChild(errors);
  }
}

/**
 * Show error banner.
 * @param {Error} error - Error object
 */
function showError(error) {
  findingsList.innerHTML = '';
  const errorBanner = document.createElement('div');
  errorBanner.className = 'error-banner';

  let message = 'Failed to load findings';
  if (error.status) {
    message = `Failed to load findings (HTTP ${error.status})`;
  } else if (error.message) {
    message = `Failed to load findings: ${error.message}`;
  }

  errorBanner.innerHTML = `<strong>Error:</strong> ${message}`;
  findingsList.appendChild(errorBanner);
}

/**
 * Initialize the dashboard.
 */
async function init() {
  try {
    // Load findings and runs
    allFindings = await loadJson('findings.json');

    // Load optional theme
    const theme = await loadTheme();
    applyTheme(theme);

    // Update counts
    updateCounts();

    // Render initial findings
    renderFindings();

    // Load and display last run info
    try {
      const runs = await loadJson('runs.json');
      updateLastRunInfo(runs);
    } catch {
      // runs.json may not exist; this is not a fatal error
      updateLastRunInfo([]);
    }

    // Attach filter change listeners
    filterInputs.forEach(input => {
      input.addEventListener('change', event => {
        currentFilter = event.target.value;
        renderFindings();
      });
    });
  } catch (error) {
    console.error('Dashboard initialization error:', error);
    showError(error);
  }
}

// Start initialization when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
