export const STATUSES = ['confirmed', 'ghost', 'resolved'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const DEFAULT_LABELS = { confirmed: 'confirmed', ghost: 'ghost', resolved: 'resolved' };

const STATUS_ICONS = { confirmed: '◆', ghost: '◇', resolved: '✓' };

export function statusOf(finding) {
  if (finding.resolvedAt) return 'resolved';
  return finding.status === 'confirmed' ? 'confirmed' : 'ghost';
}

export function severityOf(finding) {
  return SEVERITIES.includes(finding.severity) ? finding.severity : 'info';
}

export function labelsFor(theme) {
  const labels = { ...DEFAULT_LABELS };
  for (const status of STATUSES) {
    const label = theme?.labels?.[status];
    if (typeof label === 'string' && label.trim() !== '') labels[status] = label.trim();
  }
  return labels;
}

export function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function countFindings(findings) {
  const counts = { total: findings.length, confirmed: 0, ghost: 0, resolved: 0 };
  for (const finding of findings) counts[statusOf(finding)] += 1;
  return counts;
}

export function filterFindings(findings, filter) {
  if (!STATUSES.includes(filter)) return [...findings];
  return findings.filter((finding) => statusOf(finding) === filter);
}

function compareText(a, b) {
  const left = String(a);
  const right = String(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function sortFindings(findings) {
  return [...findings].sort(
    (a, b) =>
      STATUSES.indexOf(statusOf(a)) - STATUSES.indexOf(statusOf(b)) ||
      SEVERITIES.indexOf(severityOf(a)) - SEVERITIES.indexOf(severityOf(b)) ||
      compareText(a.title, b.title) ||
      compareText(a.id, b.id),
  );
}

export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export function dateOf(timestamp) {
  return typeof timestamp === 'string' && /^\d{4}-\d{2}-\d{2}/.test(timestamp) ? timestamp.slice(0, 10) : '';
}

export function lastRunOf(runs) {
  return Array.isArray(runs) && runs.length > 0 ? runs[runs.length - 1] : null;
}

export function loadErrorMessage(name, failure) {
  if (typeof failure.status === 'number') {
    const statusText = failure.statusText ? ` ${failure.statusText}` : '';
    return `Could not load ${name}: HTTP ${failure.status}${statusText}`;
  }
  return `Could not load ${name}: network failure (${failure.message || 'no response'})`;
}

export function runTally(run, labels) {
  return [
    `${labels.confirmed}: ${Number(run.confirmedCount) || 0}`,
    `${labels.ghost}: ${Number(run.ghostCount) || 0}`,
    `${labels.resolved}: ${Number(run.resolvedCount) || 0}`,
  ].join(' · ');
}

export function sourcesSentence(count) {
  return count === 1 ? 'Reported by 1 source' : `Reported by ${count} sources`;
}

async function loadJson(name, base) {
  let response;
  try {
    response = await fetch(new URL(name, base));
  } catch (error) {
    throw new Error(loadErrorMessage(name, { message: error instanceof Error ? error.message : String(error) }));
  }
  if (!response.ok) {
    throw new Error(loadErrorMessage(name, { status: response.status, statusText: response.statusText }));
  }
  return response.json();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function timeElement(timestamp, text) {
  const time = element('time', '', text);
  time.dateTime = timestamp;
  return time;
}

function applyTheme(theme, labels) {
  if (typeof theme.accentColor === 'string' && CSS.supports('color', theme.accentColor)) {
    document.documentElement.style.setProperty('--accent-color', theme.accentColor);
  }
  if (typeof theme.name === 'string' && theme.name) {
    document.title = theme.name;
    document.getElementById('app-name').textContent = theme.name;
  }
  const tagline = document.getElementById('app-tagline');
  if (typeof theme.tagline === 'string' && theme.tagline) {
    tagline.textContent = theme.tagline;
    tagline.hidden = false;
  }
  for (const node of document.querySelectorAll('[data-label]')) {
    node.textContent = capitalise(labels[node.dataset.label]);
  }
}

function renderCounts(findings) {
  const counts = countFindings(findings);
  for (const key of Object.keys(counts)) {
    document.getElementById(`count-${key}`).textContent = String(counts[key]);
  }
}

function renderLastRun(result, labels) {
  const container = document.getElementById('last-run-info');
  container.replaceChildren();
  if (result.status === 'rejected') {
    container.append(element('p', 'run-error', result.reason.message));
    return;
  }
  const run = lastRunOf(result.value);
  if (!run) {
    container.append(element('p', '', 'No runs recorded yet.'));
    return;
  }
  const when = element('p', 'last-run-timestamp');
  when.append(element('strong', '', 'Last run '), timeElement(run.runAt, run.runAt));
  container.append(when);
  container.append(element('p', 'last-run-tally', runTally(run, labels)));
  if (Array.isArray(run.errorSources) && run.errorSources.length > 0) {
    container.append(
      element('p', 'run-error', `Sources that failed in this run: ${run.errorSources.join(', ')}. Their previous evidence was kept.`),
    );
  }
}

function renderEvidence(finding) {
  const section = element('div', 'finding-sources');
  const sources = Array.isArray(finding.sources) ? finding.sources : [];
  section.append(element('p', 'sources-label', sourcesSentence(sources.length)));
  const list = element('ul', 'source-list');
  for (const source of sources) {
    const evidence = (finding.evidence ?? []).find((entry) => entry.sourceName === source);
    const item = element('li');
    item.append(element('span', 'source-name', source));
    if (evidence?.text) item.append(element('span', 'evidence-text', evidence.text));
    const link = safeUrl(evidence?.link);
    if (link) {
      const anchor = element('a', 'evidence-link', 'evidence');
      anchor.href = link;
      anchor.rel = 'noopener noreferrer';
      item.append(anchor);
    }
    if (evidence?.staleError) {
      item.append(element('span', 'stale-note', `Carried over from the previous run: ${evidence.staleError}`));
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderFinding(finding, labels) {
  const status = statusOf(finding);
  const severity = severityOf(finding);
  const article = element('article', 'finding');
  article.dataset.status = status;

  const header = element('div', 'finding-header');
  header.append(element('h3', 'finding-title', finding.title));
  const badges = element('div', 'finding-badges');
  const statusBadge = element('span', 'badge status-badge');
  statusBadge.dataset.status = status;
  const icon = element('span', 'status-icon', STATUS_ICONS[status]);
  icon.setAttribute('aria-hidden', 'true');
  statusBadge.append(icon, document.createTextNode(labels[status]));
  const severityBadge = element('span', 'badge severity-badge', finding.severity ?? 'info');
  severityBadge.dataset.severity = severity;
  badges.append(statusBadge, severityBadge);
  header.append(badges);
  article.append(header);

  if (finding.summary) article.append(element('p', 'finding-summary', finding.summary));

  if (finding.fix?.text || finding.fix?.value) {
    const fix = element('p', 'finding-fix');
    fix.append(element('strong', '', 'Fix '));
    if (finding.fix.text) fix.append(document.createTextNode(finding.fix.text));
    if (finding.fix.value && !String(finding.fix.text ?? '').includes(finding.fix.value)) {
      fix.append(document.createTextNode(' '), element('code', '', finding.fix.value));
    }
    article.append(fix);
  }

  article.append(renderEvidence(finding));

  if (finding.stale) {
    article.append(element('p', 'stale-indicator', 'Some evidence is from an earlier run because a source failed this time.'));
  }

  const meta = element('p', 'finding-meta');
  const parts = [];
  if (dateOf(finding.firstSeen)) parts.push(['First seen ', finding.firstSeen]);
  if (dateOf(finding.lastSeen)) parts.push(['last seen ', finding.lastSeen]);
  if (dateOf(finding.resolvedAt)) parts.push([`${capitalise(labels.resolved)} `, finding.resolvedAt]);
  parts.forEach(([text, timestamp], index) => {
    if (index > 0) meta.append(document.createTextNode(' · '));
    meta.append(document.createTextNode(text), timeElement(timestamp, dateOf(timestamp)));
  });
  const link = safeUrl(finding.url);
  if (link) {
    if (parts.length > 0) meta.append(document.createTextNode(' · '));
    const anchor = element('a', 'finding-url', `Details on ${new URL(link).hostname}`);
    anchor.href = link;
    anchor.rel = 'noopener noreferrer';
    meta.append(anchor);
  }
  if (meta.childNodes.length > 0) article.append(meta);

  return article;
}

function renderFindings(findings, filter, labels) {
  const list = document.getElementById('findings-list');
  list.replaceChildren();
  if (findings.length === 0) {
    list.append(element('p', 'empty-state', 'No findings are currently recorded.'));
    return;
  }
  const shown = sortFindings(filterFindings(findings, filter));
  if (shown.length === 0) {
    list.append(element('p', 'empty-state', `No findings with status ${labels[filter]}.`));
    return;
  }
  for (const finding of shown) list.append(renderFinding(finding, labels));
}

function showError(message) {
  const list = document.getElementById('findings-list');
  list.replaceChildren(element('p', 'error-banner', message));
  list.firstChild.setAttribute('role', 'alert');
}

async function init() {
  const base = new URL('.', document.baseURI);
  const [themeResult, findingsResult, runsResult] = await Promise.allSettled([
    loadJson('theme.json', base),
    loadJson('findings.json', base),
    loadJson('runs.json', base),
  ]);
  const theme = themeResult.status === 'fulfilled' && themeResult.value && typeof themeResult.value === 'object' ? themeResult.value : {};
  const labels = labelsFor(theme);
  applyTheme(theme, labels);
  renderLastRun(runsResult, labels);

  if (findingsResult.status === 'rejected') {
    showError(findingsResult.reason.message);
    return;
  }
  if (!Array.isArray(findingsResult.value)) {
    showError('Could not load findings.json: the file is not a JSON array.');
    return;
  }
  const findings = findingsResult.value;
  renderCounts(findings);
  let filter = 'all';
  renderFindings(findings, filter, labels);
  for (const input of document.querySelectorAll('input[name="status-filter"]')) {
    input.addEventListener('change', (event) => {
      filter = event.target.value;
      renderFindings(findings, filter, labels);
    });
  }
}

if (typeof document !== 'undefined') {
  init().catch((error) => showError(`The dashboard failed to start: ${error instanceof Error ? error.message : String(error)}`));
}
