(function () {
  'use strict';

  const SUPABASE_URL = 'https://nihquqccvnfuaqsxyymj.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paHF1cWNjdm5mdWFxc3h5eW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNjQ1ODIsImV4cCI6MjA5NDY0MDU4Mn0.Q0ea1N8iWDoy0KzbFvL4rFYg0liZevnC3AFUDiJY1yE';
  const VERIFY_URL = `${SUPABASE_URL}/functions/v1/verify-date`;

  const PROCESSING = new Set();
  const PROCESSED_URLS = new Set();
  const PROCESSED_CONTAINERS = new WeakSet();
  const RESULT_CACHE_KEY = 'userply_cache_v6_complete_ddg';
  const ANON_ID_KEY = 'userply_anon_id';
  const CACHE_TTL = 86400000;

  const SETTINGS_KEY = 'userply_settings';

  function getSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { enabled: true, pillPosition: 'below', showNoArchive: true, disabledSites: [] };
      return { enabled: true, pillPosition: 'below', showNoArchive: true, disabledSites: [], ...JSON.parse(raw) };
    } catch { return { enabled: true, pillPosition: 'below', showNoArchive: true, disabledSites: [] }; }
  }

  function isDisabledSite() {
    const settings = getSettings();
    if (!settings.enabled) return true;
    const hostname = window.location.hostname.replace(/^www\./, '');
    return settings.disabledSites.some(s => hostname === s || hostname.endsWith('.' + s));
  }

  let REMOTE_CONFIG = null;
  let CONFIG_VERSION = 0;

  const FALLBACK_CONFIG = {
    google: {
      strategies: [
        // Google only: use true result headings. Do not use cite/breadcrumb nodes;
        // those can live inside transformed internal wrappers and create mirrored badges.
        { name: 'google-heading-only', titleSelector: '#rso a[href] h3, #search a[href] h3', linkResolver: 'closest_anchor', containerSelector: '.MjjYud, .g, div[data-sokoban-container], div' },
      ],
      snippetSelectors: ['.VwiC3b', '.s3v9rd', '.IsZvec', '.yDYNvb', '.MUxGbd', '.r025kc'],
      searchContainer: '#rso, #search > div > div',
    },
    bing: {
      strategies: [
        { name: 'algo-h2', titleSelector: '.b_algo h2', linkSelector: 'a[href^="http"]', containerSelector: '.b_algo' },
      ],
      snippetSelectors: ['.b_caption p'],
      searchContainer: '#b_results',
    },
    duckduckgo: {
      strategies: [
        // DuckDuckGo has multiple live layouts. Prefer explicit result title
        // anchors first, then fall back to classic result headings.
        { name: 'ddg-testid-title', titleSelector: 'a[data-testid="result-title-a"], [data-testid="result-title-a"] a[href]', linkResolver: 'self_or_closest_anchor', containerSelector: 'article[data-testid="result"], div[data-testid="result"], li[data-layout], article, li, .result, .web-result' },
        { name: 'ddg-result-title', titleSelector: '.result__title a[href], a.result__a[href], h2 a[href], h3 a[href]', linkResolver: 'self_or_closest_anchor', containerSelector: 'article[data-testid="result"], div[data-testid="result"], li[data-layout], article, li, .result, .web-result' },
        { name: 'ddg-heading-fallback', titleSelector: 'article h2, article h3, li h2, li h3, .result h2, .result h3', linkSelector: 'a[href]', containerSelector: 'article[data-testid="result"], div[data-testid="result"], li[data-layout], article, li, .result, .web-result' },
      ],
      snippetSelectors: ['[data-testid="result-snippet"]', '[data-testid*="snippet"]', '.result__snippet', '.result__snippet.js-result-snippet', '[data-result="snippet"]', 'article span', 'article p'],
      searchContainer: '#links, .results, [data-testid="mainline"], main',
    },
  };

  function trackEvent(eventType, metadata = {}) { }

  function getAnonId() {
    let id = localStorage.getItem(ANON_ID_KEY);
    if (!id) { id = 'anon_' + crypto.randomUUID(); localStorage.setItem(ANON_ID_KEY, id); }
    return id;
  }

  function today() { return new Date().toISOString().split('T')[0]; }

  function cacheGet(url) {
    try {
      const store = JSON.parse(localStorage.getItem(RESULT_CACHE_KEY) || '{}');
      const entry = store[url];
      if (!entry || Date.now() - entry.ts > CACHE_TTL) return undefined;
      return entry.data;
    } catch { return undefined; }
  }

  function cacheSet(url, data) {
    try {
      const store = JSON.parse(localStorage.getItem(RESULT_CACHE_KEY) || '{}');
      store[url] = { data, ts: Date.now() };
      const keys = Object.keys(store);
      if (keys.length > 500) { keys.sort((a, b) => store[a].ts - store[b].ts).slice(0, 100).forEach(k => delete store[k]); }
      localStorage.setItem(RESULT_CACHE_KEY, JSON.stringify(store));
    } catch { }
  }

  function getCachedConfig() {
    try {
      const raw = localStorage.getItem(CONFIG_CACHE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (Date.now() - data.ts > CONFIG_CACHE_TTL) return null;
      return data.configs;
    } catch { return null; }
  }

  function setCachedConfig(configs) {
    try { localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({ configs, ts: Date.now() })); } catch { }
  }

  async function fetchRemoteConfig() { }

  function applyRemoteConfig(configs) { }

  function getEngineConfig(engine) {
    if (REMOTE_CONFIG && REMOTE_CONFIG[engine]) return REMOTE_CONFIG[engine];
    return FALLBACK_CONFIG[engine] || null;
  }

  function reportBreakage(engine, resultsFound) { }

  function getPillColors(status) {
    switch (status) {
      case 'verified':   return { bg: 'rgba(34,197,94,0.12)', color: '#16a34a', border: 'rgba(34,197,94,0.25)' };
      case 'first_seen': return { bg: 'rgba(14,165,233,0.12)', color: '#0284c7', border: 'rgba(14,165,233,0.25)' };
      case 'corrected':  return { bg: 'rgba(245,158,11,0.12)', color: '#d97706', border: 'rgba(245,158,11,0.25)' };
      case 'no_archive': return { bg: 'rgba(249,115,22,0.12)', color: '#ea580c', border: 'rgba(249,115,22,0.25)' };
      case 'no_date':    return { bg: 'rgba(148,163,184,0.08)', color: '#64748b', border: 'rgba(148,163,184,0.2)' };
      case 'locked':     return { bg: 'rgba(148,163,184,0.06)', color: '#94a3b8', border: 'rgba(148,163,184,0.15)' };
      default:           return { bg: 'rgba(148,163,184,0.08)', color: '#64748b', border: 'rgba(148,163,184,0.2)' };
    }
  }

  function getStatusLabel(status) {
    switch (status) {
      case 'verified':   return 'Date verified by archive';
      case 'first_seen': return 'First seen date from archive';
      case 'corrected':  return 'Date mismatch detected';
      case 'no_archive': return 'No archive record found';
      case 'locked':     return 'Upgrade required for verification';
      default:           return 'Date information';
    }
  }

  function createIsolatedPill(text, status, clickUrl, debugText) {
    const host = document.createElement('span');
    host.setAttribute('data-userply', '1');
    host.dataset.userplyStatus = status;
    host.setAttribute('role', clickUrl ? 'button' : 'status');
    host.setAttribute('aria-label', `${getStatusLabel(status)}: ${text}`);
    if (debugText) host.title = debugText;
    if (clickUrl) host.setAttribute('tabindex', '0');
    host.style.cssText = 'display:inline-block;vertical-align:middle;line-height:0;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const { bg, color, border } = getPillColors(status);
    const style = document.createElement('style');
    style.textContent = `:host{all:initial;display:inline-block!important;vertical-align:middle!important;transform:none!important;direction:ltr!important;writing-mode:horizontal-tb!important;unicode-bidi:isolate!important;text-orientation:mixed!important;rotate:none!important;scale:none!important;}.pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;background:${bg};color:${color};border:1px solid ${border};font-size:10.5px;font-weight:600;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap;line-height:1.7;letter-spacing:0.01em;direction:ltr;writing-mode:horizontal-tb;${clickUrl?'cursor:pointer;':''}transition:outline 0.1s ease;}.pill:focus-visible{outline:2px solid ${color};outline-offset:2px;}.dot{width:5px;height:5px;border-radius:50%;background:${color};display:inline-block;flex-shrink:0;}`;
    shadow.appendChild(style);
    const pill = document.createElement('span');
    pill.className = 'pill';
    if (clickUrl) pill.setAttribute('tabindex', '0');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.setAttribute('aria-hidden', 'true');
    pill.appendChild(dot);
    pill.appendChild(document.createTextNode(text));
    if (clickUrl) {
      const activate = (e) => { e.preventDefault(); e.stopPropagation(); trackEvent('upgrade_click', { source: 'pill' }); window.open(clickUrl, '_blank'); };
      pill.addEventListener('click', activate);
      pill.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') activate(e); });
    }
    shadow.appendChild(pill);
    requestAnimationFrame(() => { host.style.setProperty('transform', 'none', 'important'); host.style.setProperty('rotate', 'none', 'important'); host.style.setProperty('scale', 'none', 'important'); });
    return host;
  }

  function createPill(text, status, debugText) { return createIsolatedPill(text, status, null, debugText); }
  function createUnverifiedPill(dateStr, source) { return createIsolatedPill(`${source || 'Visible date'}: ${dateStr}`, 'first_seen', null, source ? `userp.ly date source: ${source}` : null); }

  function formatDate(iso) {
    if (!iso) return null;
    try { const d = new Date(iso); if (isNaN(d.getTime())) return null; return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); } catch { return null; }
  }

  const URL_DATE_PATTERNS = [
    /[\/\-_](20\d{2})[\/\-_](\d{1,2})[\/\-_](\d{1,2})(?:[\/\-_\?#]|$)/,
    /[\/\-_](20\d{2})(\d{2})(\d{2})(?:[\/\-_\?#]|$)/,
  ];

  function toIsoDate(y, mo, d) {
    y = Number(y); mo = Number(mo); d = Number(d);
    if (y < 1995 || y > new Date().getFullYear() + 1) return null;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(`${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}T12:00:00Z`);
    return isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  function extractUrlDate(url) {
    try {
      for (const re of URL_DATE_PATTERNS) {
        const m = re.exec(url);
        if (!m) continue;
        const iso = toIsoDate(m[1], m[2], m[3]);
        if (iso) return iso;
      }
    } catch { }
    return null;
  }

  const MONTHS_PAT = 'Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December';
  const ABS_DATE_RE = new RegExp(`(${MONTHS_PAT})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, 'i');
  const ABS_DATE_RE_2 = new RegExp(`(\\d{1,2})\\s+(${MONTHS_PAT})\\s+(\\d{4})`, 'i');
  const NUMERIC_DATE_RE = /\b(20\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})\b|\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](20\d{2})\b/;
  const REL_DATE_RE = /(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/i;
  const TODAY_RE = /\b(today|yesterday)\b/i;

  function extractTextDate(text) {
    if (!text) return null;
    const abs = ABS_DATE_RE.exec(text);
    if (abs) { const d = new Date(`${abs[1]} ${abs[2]}, ${abs[3]}`); if (!isNaN(d.getTime())) return d.toISOString(); }
    const abs2 = ABS_DATE_RE_2.exec(text);
    if (abs2) { const d = new Date(`${abs2[2]} ${abs2[1]}, ${abs2[3]}`); if (!isNaN(d.getTime())) return d.toISOString(); }
    const num = NUMERIC_DATE_RE.exec(text);
    if (num) {
      const y = num[1] || num[6];
      const mo = num[2] || num[4];
      const day = num[3] || num[5];
      const d = new Date(`${y}-${String(mo).padStart(2,'0')}-${String(day).padStart(2,'0')}T12:00:00Z`);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    const todayish = TODAY_RE.exec(text);
    if (todayish) { const d = new Date(); if (todayish[1].toLowerCase() === 'yesterday') d.setDate(d.getDate() - 1); return d.toISOString(); }
    const rel = REL_DATE_RE.exec(text);
    if (rel) { const msMap = { second: 1000, minute: 60000, hour: 36e5, day: 864e5, week: 6048e5, month: 2592e6, year: 31536e6 }; const ms = msMap[rel[2].toLowerCase()]; if (ms) return new Date(Date.now() - parseInt(rel[1], 10) * ms).toISOString(); }
    return null;
  }

  function extractSnippetDate(container, engine) {
    const config = getEngineConfig(engine);
    const selectors = config ? config.snippetSelectors : ['.VwiC3b', '.s3v9rd', '.IsZvec', '.yDYNvb', '.MUxGbd', '.r025kc'];
    for (const sel of selectors) { try { const el = container.querySelector(sel); if (el) { const iso = extractTextDate(el.textContent); if (iso) return iso; } } catch { } }
    return extractTextDate(container.textContent);
  }

  function getClaimedDate(container, url, engine) {
    const urlDate = extractUrlDate(url);
    if (urlDate) return { iso: urlDate, source: 'URL date' };
    const visibleDate = extractSnippetDate(container, engine);
    if (visibleDate) {
      const label = engine === 'bing' ? 'Bing visible date' : engine === 'duckduckgo' ? 'DuckDuckGo visible date' : 'Google visible date';
      return { iso: visibleDate, source: label };
    }
    return { iso: null, source: null };
  }

  function normalizeApiResult(result) {
    if (!result || typeof result !== 'object') return null;
    const out = { ...result };
    out.actual_date = out.actual_date || out.actualDate || out.verified_date || out.verifiedDate || out.published_date || out.publishedDate || null;
    out.first_seen = out.first_seen || out.firstSeen || out.archive_date || out.archiveDate || null;
    out.claimed_date = out.claimed_date || out.claimedDate || out.claimed || null;
    if (!out.status) {
      if (out.actual_date) out.status = 'verified';
      else if (out.first_seen) out.status = 'first_seen';
      else out.status = 'no_date';
    }
    if ((out.status === 'no_date' || out.status === 'no_archive') && (out.actual_date || out.first_seen)) {
      out.status = out.actual_date ? 'verified' : 'first_seen';
    }
    return out;
  }

  function getDebugText(url, result, source) {
    const status = result && result.status ? result.status : 'no_result';
    return `userp.ly debug: status=${status}; source=${source || 'api'}; url=${url}`;
  }

  const QUEUE = [];
  let ACTIVE = 0;
  function enqueue(fn) { return new Promise((resolve, reject) => { QUEUE.push(() => fn().then(resolve).catch(reject)); drain(); }); }
  function drain() { while (ACTIVE < 3 && QUEUE.length > 0) { const task = QUEUE.shift(); ACTIVE++; task().finally(() => { ACTIVE--; drain(); }); } }

  function verifyDateViaBackground(url, claimedDate) {
    return new Promise((resolve) => {
      try {
        if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) return resolve(null);
        chrome.runtime.sendMessage(
          { type: 'USERPLY_VERIFY_DATE', url, claimedDate: claimedDate || null, anonymousId: getAnonId() },
          (response) => {
            if (chrome.runtime.lastError) return resolve(null);
            if (!response || !response.ok) return resolve(null);
            resolve(response.data || null);
          }
        );
      } catch { resolve(null); }
    });
  }

  async function verifyDateDirect(url, claimedDate) {
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}`, 'apikey': SUPABASE_ANON_KEY },
        body: JSON.stringify({ url, claimed_date: claimedDate || undefined, anonymous_id: getAnonId() }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function verifyDate(url, claimedDate) {
    const cached = cacheGet(url);
    if (cached !== undefined) return cached;
    return enqueue(async () => {
      const c2 = cacheGet(url);
      if (c2 !== undefined) return c2;
      const data = await verifyDateDirect(url, claimedDate) || await verifyDateViaBackground(url, claimedDate);
      if (data) cacheSet(url, data);
      return data;
    });
  }

  function neutralizeAncestorTransforms(el) {
    // Intentionally no-op. The extension must never alter Google/Bing/DDG
    // result ancestors, because search pages sometimes use transforms for
    // layout. Touch only userp.ly's own injected nodes.
  }

  function placeBadgeWrapper(container, titleEl, wrapper) {
    const engine = detectEngine();

    // Google's title/URL crumbs can sit inside internal transformed wrappers.
    // Putting our badge next to the anchor can inherit those transforms and mirror the badge.
    // For Google, anchor the badge only at the safe top-level result block.
    if (engine === 'google' && container) {
      const rso = document.querySelector('#rso') || document.querySelector('#search');
      const safeContainer = container.closest('.MjjYud, .g, div[data-sokoban-container]') || container;
      if (!rso || rso.contains(safeContainer)) {
        safeContainer.querySelectorAll(':scope > [data-userply-wrapper]').forEach(el => el.remove());
        wrapper.style.display = 'block';
        wrapper.style.width = 'max-content';
        wrapper.style.margin = '0 0 4px 0';
        safeContainer.insertBefore(wrapper, safeContainer.firstChild || null);
        return;
      }
    }

    if ((engine === 'duckduckgo' || engine === 'bing') && container) {
      const existing = container.querySelector(':scope > [data-userply-wrapper]');
      if (existing) existing.remove();
      wrapper.style.display = 'block';
      wrapper.style.width = 'max-content';
      wrapper.style.margin = '0 0 4px 0';
      const heading = container.querySelector('h2, h3, [data-testid="result-title-a"], .result__title') || titleEl;
      const headingRow = heading && heading.parentElement ? heading.parentElement : null;
      if (headingRow && container.contains(headingRow)) {
        headingRow.insertBefore(wrapper, heading.nextSibling || null);
      } else {
        container.insertBefore(wrapper, container.firstChild || null);
      }
      return;
    }

    const h3 = container ? (container.querySelector('h3, [role="heading"]') || titleEl) : titleEl;
    const link = h3 ? h3.closest('a[href]') : null;
    const anchor = link || h3 || titleEl;
    if (anchor && anchor.parentElement) {
      anchor.parentElement.insertBefore(wrapper, anchor.nextSibling);
      return;
    }
    if (container) container.insertBefore(wrapper, container.firstChild || null);
  }

  function injectVerificationPill(titleEl, result, container) {
    if (container) { const existing = container.querySelector('[data-userply-wrapper]'); if (existing) existing.remove(); }
    const existingInTitle = titleEl.querySelector('[data-userply]');
    if (existingInTitle) existingInTitle.remove();
    const settings = getSettings();
    if (result && (result.status === 'no_archive' || result.status === 'no_date') && !settings.showNoArchive) return;
    const sortableDate = getResultSortDate(result);
    if (sortableDate) setSortDate(container || titleEl, sortableDate);
    let pill;
    if (!result) { pill = createPill('No date', 'no_date'); }
    else {
      let text = ''; let status = result.status;
      switch (result.status) {
        case 'verified': text = `Verified: ${formatDate(result.actual_date || result.first_seen)}`; break;
        case 'first_seen': text = `First seen: ${formatDate(result.first_seen)}`; break;
        case 'corrected': text = `First seen ${formatDate(result.first_seen)} (claims ${formatDate(result.claimed_date)})`; break;
        case 'no_archive': text = 'No archive record'; break;
        default: text = 'No date'; status = 'no_date';
      }
      pill = createPill(text, status, result && result._debugUrl ? getDebugText(result._debugUrl, result, result._debugSource) : null);
      if (result.confidence && result.confidence < 0.5) pill.style.opacity = '0.7';
    }
    const isInline = settings.pillPosition === 'inline';
    const wrapper = document.createElement(isInline ? 'span' : 'div');
    wrapper.setAttribute('data-userply-wrapper', '1');
    wrapper.style.cssText = [isInline ? 'display:inline;margin-left:6px' : 'display:block;margin:4px 0 0 0', 'padding:0', 'transform:none !important', 'direction:ltr !important', 'unicode-bidi:isolate !important', 'writing-mode:horizontal-tb !important', 'position:relative', 'z-index:1', 'rotate:none !important', 'scale:none !important', 'contain:layout style', 'isolation:isolate', 'text-align:left'].join(';');
    wrapper.appendChild(pill);
    placeBadgeWrapper(container, titleEl, wrapper);
  }

  function injectLocalDatePill(titleEl, isoDate, container, source) {
    if (container) { const existing = container.querySelector('[data-userply-wrapper]'); if (existing) existing.remove(); }
    const existingInTitle = titleEl.querySelector('[data-userply]');
    if (existingInTitle) existingInTitle.remove();
    const settings = getSettings();
    setSortDate(container || titleEl, isoDate);
    const pill = createUnverifiedPill(formatDate(isoDate) || isoDate, source || 'Visible date');
    const isInline = settings.pillPosition === 'inline';
    const wrapper = document.createElement(isInline ? 'span' : 'div');
    wrapper.setAttribute('data-userply-wrapper', '1');
    wrapper.style.cssText = [isInline ? 'display:inline;margin-left:6px' : 'display:block;margin:4px 0 0 0', 'padding:0', 'transform:none !important', 'direction:ltr !important', 'unicode-bidi:isolate !important', 'writing-mode:horizontal-tb !important', 'position:relative', 'z-index:1', 'rotate:none !important', 'scale:none !important', 'contain:layout style', 'isolation:isolate', 'text-align:left'].join(';');
    wrapper.appendChild(pill);
    placeBadgeWrapper(container, titleEl, wrapper);
  }

  async function processResult(container, titleEl, url, engine) {
    if (!container || !titleEl || !url) return;
    if (PROCESSING.has(url) || PROCESSED_URLS.has(url) || PROCESSED_CONTAINERS.has(container)) return;
    PROCESSING.add(url);
    PROCESSED_URLS.add(url);
    PROCESSED_CONTAINERS.add(container);
    container.setAttribute('data-userply-processed', '1');
    try {
      const claimed = getClaimedDate(container, url, engine);
      const claimedDate = claimed.iso;
      const placeholderWrapper = document.createElement('div');
      placeholderWrapper.setAttribute('data-userply-wrapper', '1');
      placeholderWrapper.style.cssText = 'display:block;width:max-content;margin:4px 0 0 0;transform:none!important;rotate:0deg!important;scale:1!important;direction:ltr!important;unicode-bidi:isolate!important;writing-mode:horizontal-tb!important;text-align:left!important;isolation:isolate!important;';
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-userply', '1');
      placeholder.style.cssText = 'display:inline-block;width:80px;height:14px;border-radius:10px;background:rgba(148,163,184,0.15);animation:userply-pulse 1.4s ease-in-out infinite;';
      placeholderWrapper.appendChild(placeholder);
      if (!container.querySelector('[data-userply-wrapper]')) {
        placeBadgeWrapper(container, titleEl, placeholderWrapper);
      }
      const result = normalizeApiResult(await verifyDate(url, claimedDate));
      if (placeholderWrapper.parentElement) placeholderWrapper.remove();
      if (!result) {
        if (claimedDate) { injectLocalDatePill(titleEl, claimedDate, container, claimed.source); }
        else { injectVerificationPill(titleEl, { status: 'no_date' }, container); }
      } else if (claimedDate && (result.status === 'no_archive' || result.status === 'no_date') && !result.first_seen && !result.actual_date) {
        injectLocalDatePill(titleEl, claimedDate, container, claimed.source);
      } else {
        result._debugUrl = url;
        result._debugSource = result.actual_date || result.first_seen ? 'verification API' : (claimed.source || 'verification API');
        injectVerificationPill(titleEl, result, container);
      }
      repairFlippedSearchText();
    } catch { const ph = container.querySelector('[data-userply-wrapper]'); if (ph) ph.remove(); }
    finally { PROCESSING.delete(url); }
  }

  const BLOCKED_RE = /^(www\.)?(google\.|youtube\.|gstatic\.|googleusercontent\.|googleapis\.|googlesyndication\.|doubleclick\.|bing\.|microsoft\.|duckduckgo\.)/i;
  function isBlockedHostname(hostname) { if (!hostname) return true; if (BLOCKED_RE.test(hostname)) return true; if (hostname.endsWith('.google.com') || hostname === 'google.com') return true; return false; }
  function decodeBingRedirectValue(value) {
    if (!value) return null;
    try {
      let v = value;
      // Bing commonly stores the destination in a URL-safe base64-ish `u` param,
      // often prefixed with `a1`. Decode it before hostname filtering so real
      // Bing results are not mistaken for internal bing.com links.
      if (v.startsWith('a1')) v = v.slice(2);
      v = v.replace(/-/g, '+').replace(/_/g, '/');
      while (v.length % 4) v += '=';
      const decoded = atob(v);
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) return decoded;
    } catch { }
    try {
      const decoded = decodeURIComponent(value);
      if (decoded && (decoded.startsWith('http://') || decoded.startsWith('https://'))) return decoded;
    } catch { }
    return null;
  }

  function resolveUrl(href) {
    try {
      const u = new URL(href, location.href);
      const direct = u.searchParams.get('uddg') || u.searchParams.get('q') || u.searchParams.get('url');
      if (direct) {
        try {
          const decodedDirect = decodeURIComponent(direct);
          if (decodedDirect.startsWith('http://') || decodedDirect.startsWith('https://')) return decodedDirect;
        } catch { }
        if (direct.startsWith('http://') || direct.startsWith('https://')) return direct;
      }
      if (/bing\.com$/i.test(u.hostname) || /\.bing\.com$/i.test(u.hostname)) {
        const decoded = decodeBingRedirectValue(u.searchParams.get('u')) || decodeBingRedirectValue(u.searchParams.get('r'));
        if (decoded) return decoded;
      }
    } catch { }
    return href;
  }

  function canonicalizeResultUrl(href) {
    try {
      const u = new URL(resolveUrl(href));
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','fbclid','gclid','igshid'].forEach(k => u.searchParams.delete(k));
      u.hash = '';
      return u.toString();
    } catch { return resolveUrl(href); }
  }

  function detectEngine() { const host = window.location.hostname; if (/google\./i.test(host)) return 'google'; if (/bing\./i.test(host)) return 'bing'; if (/duckduckgo\./i.test(host)) return 'duckduckgo'; return null; }


  function repairFlippedSearchText() { }

  function findSafeResultContainer(el, link, strategy) {
    const engine = detectEngine();
    if (engine === 'google') {
      const rso = document.querySelector('#rso') || document.querySelector('#search');
      const preferred = el.closest('.MjjYud, .g, div[data-sokoban-container]') || link.closest('.MjjYud, .g, div[data-sokoban-container]');
      if (preferred && (!rso || rso.contains(preferred))) return preferred;
      let node = el.parentElement;
      while (node && node.parentElement && node.parentElement !== rso && node !== document.body) node = node.parentElement;
      if (node && rso && node.parentElement === rso) return node;
    }
    if (engine === 'duckduckgo') {
      const preferred = el.closest('article[data-testid="result"], div[data-testid="result"], li[data-layout], article, li, .result, .web-result') || link.closest('article[data-testid="result"], div[data-testid="result"], li[data-layout], article, li, .result, .web-result');
      if (preferred) return preferred;
    }
    if (engine === 'bing') {
      const preferred = el.closest('.b_algo') || link.closest('.b_algo');
      if (preferred) return preferred;
    }
    return el.closest(strategy.containerSelector) || link.closest(strategy.containerSelector) || el.parentElement || el;
  }

  function getResultLinks() {
    const engine = detectEngine();
    if (!engine) return [];
    const config = getEngineConfig(engine);
    if (!config) return [];
    const results = [];
    const seen = new Set();
    for (const strategy of config.strategies) {
      const elements = document.body.querySelectorAll(strategy.titleSelector);
      elements.forEach(el => {
        if (el.dataset.userplyDone) return;
        let link = null;
        let url = null;
        if (strategy.linkResolver === 'closest_anchor') { link = el.closest('a[href]'); }
        else if (strategy.linkResolver === 'self_or_closest_anchor') { link = (el.matches && el.matches('a[href]')) ? el : el.closest('a[href]'); if (!link) link = el.querySelector && el.querySelector('a[href]'); }
        else if (strategy.linkResolver === 'walk_parent_or_child_anchor') {
          let node = el.parentElement;
          for (let i = 0; i < 10 && node && node !== document.body; i++) { if (node.tagName === 'A' && node.href) { link = node; break; } const a = node.querySelector('a[href]'); if (a && a.href) { link = a; break; } node = node.parentElement; }
        } else if (strategy.linkResolver === 'walk_parent_15') {
          let node = el.parentElement;
          for (let i = 0; i < 15 && node && node !== document.body; i++) { if (node.tagName === 'A' && node.href) { link = node; break; } const a = node.querySelector('a[href]'); if (a) { try { if (!isBlockedHostname(new URL(resolveUrl(a.href)).hostname)) { link = a; break; } } catch { } } node = node.parentElement; }
        } else if (strategy.linkSelector) {
          const container = el.closest(strategy.containerSelector) || el;
          link = container.querySelector(strategy.linkSelector) || el.querySelector('a[href^="http"]');
          if (!link) { const parentContainer = el.closest('article,li,[data-testid]'); if (parentContainer) link = parentContainer.querySelector(strategy.linkSelector); }
        }
        if (!link || !link.href) return;
        url = canonicalizeResultUrl(link.href);
        try { if (isBlockedHostname(new URL(url).hostname)) return; } catch { return; }
        if (seen.has(url) || PROCESSED_URLS.has(url) || PROCESSING.has(url)) return;
        seen.add(url);
        const container = findSafeResultContainer(el, link, strategy);
        if (!container || PROCESSED_CONTAINERS.has(container) || container.querySelector('[data-userply-wrapper]')) return;
        el.dataset.userplyDone = '1';
        const titleEl = engine === 'duckduckgo'
          ? (container.querySelector('[data-testid="result-title-a"], .result__title a, a.result__a, h2, h3, [role="heading"]') || el)
          : (container.querySelector('h3, [role="heading"]') || el);
        results.push({ container, url, titleEl, engine });
      });
    }
    return results;
  }

  let SORT_STATE = 'default';
  let ORIGINAL_ORDER = null;

  function getSearchContainer() {
    const engine = detectEngine();
    const config = getEngineConfig(engine);
    if (config && config.searchContainer) { const selectors = config.searchContainer.split(',').map(s => s.trim()); for (const sel of selectors) { const el = document.querySelector(sel); if (el) return el; } }
    return document.querySelector('#rso') || document.querySelector('#search > div > div') || document.querySelector('#b_results') || document.querySelector('.results') || document.querySelector('#links');
  }

  function getSortableResultBlock(el) {
    const searchContainer = getSearchContainer();
    if (!searchContainer || !el) return el;
    let node = el;
    while (node && node.parentElement && node.parentElement !== searchContainer && node !== searchContainer && node !== document.body) node = node.parentElement;
    return (node && node.parentElement === searchContainer) ? node : el;
  }

  function normalizeSortDate(isoDate) {
    if (!isoDate) return null;
    const d = new Date(isoDate);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  function setSortDate(container, isoDate) {
    const stampedDate = normalizeSortDate(isoDate);
    if (!container || !stampedDate) return;
    const sortable = getSortableResultBlock(container);
    sortable.setAttribute('data-userply-sortable', '1');
    sortable.setAttribute('data-userply-sort-date', stampedDate);
    container.setAttribute('data-userply-sortable', '1');
    container.setAttribute('data-userply-sort-date', stampedDate);
    // Sorting disabled in this hard-normal build; stamp date only.
  }

  function getResultSortDate(result) {
    if (!result) return null;
    return result.actual_date || result.first_seen || result.claimed_date || null;
  }

  function parsePillDate(el) {
    const stampedDate = el.getAttribute('data-userply-sort-date') || el.querySelector('[data-userply-sort-date]')?.getAttribute('data-userply-sort-date');
    if (stampedDate) { const d = new Date(stampedDate); if (!isNaN(d.getTime())) return d; }
    const text = (el.textContent || '').trim();
    const dateMatch = text.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}/i);
    if (dateMatch) { const d = new Date(dateMatch[0]); return isNaN(d.getTime()) ? null : d; }
    const yearMatch = text.match(/\b(20\d{2})\b/);
    if (yearMatch) return new Date(`${yearMatch[1]}-06-15`);
    return null;
  }

  function getSortableChildren(container) {
    return [...container.children].filter(el => el.id !== 'userply-sort');
  }

  function syncOriginalOrder(children) {
    if (!ORIGINAL_ORDER) ORIGINAL_ORDER = [...children];
    else {
      ORIGINAL_ORDER = ORIGINAL_ORDER.filter(el => children.includes(el));
      children.forEach(el => { if (!ORIGINAL_ORDER.includes(el)) ORIGINAL_ORDER.push(el); });
    }
    return ORIGINAL_ORDER;
  }

  function applySortOrder() { }

  function injectSortButton() { }

  function injectStyles() {
    if (document.getElementById('userply-styles')) return;
    const style = document.createElement('style');
    style.id = 'userply-styles';
    style.textContent = '@keyframes userply-pulse{0%,100%{opacity:.3}50%{opacity:.85}}[data-userply]{transform:none!important;rotate:none!important;scale:none!important;direction:ltr!important;unicode-bidi:isolate!important;writing-mode:horizontal-tb!important;text-orientation:mixed!important;}[data-userply-wrapper]{transform:none!important;rotate:none!important;scale:none!important;direction:ltr!important;unicode-bidi:isolate!important;writing-mode:horizontal-tb!important;contain:layout style!important;}';
    document.head.appendChild(style);
  }

  let scanCount = 0;
  function scan() {
    injectStyles();
    repairFlippedSearchText();
    injectSortButton();
    const items = getResultLinks();
    items.forEach(({ container, url, titleEl, engine }) => processResult(container, titleEl, url, engine));
    setTimeout(repairFlippedSearchText, 50);
    setTimeout(repairFlippedSearchText, 300);
    scanCount++;
    if (scanCount === 3 && items.length === 0) {
      const engine = detectEngine();
      if (engine) { const hasSearchQuery = window.location.search.includes('q=') || window.location.pathname.includes('/search'); if (hasSearchQuery) reportBreakage(engine, 0); }
    }
  }

  async function boot() {
    if (isDisabledSite()) return;
    await fetchRemoteConfig();
    if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(scan, 300);
    else document.addEventListener('DOMContentLoaded', () => setTimeout(scan, 300));
    window.addEventListener('load', () => setTimeout(scan, 600));
    let scanTimer = null;
    const observer = new MutationObserver(() => { clearTimeout(scanTimer); scanTimer = setTimeout(scan, 400); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    let lastHref = location.href;
    function onUrlChange() {
      if (location.href === lastHref) return;
      lastHref = location.href;
      PROCESSING.clear();
      scanCount = 0;
      SORT_STATE = 'default';
      ORIGINAL_ORDER = null;
      document.getElementById('userply-sort')?.remove();
      setTimeout(scan, 200);
      setTimeout(scan, 800);
    }
    window.addEventListener('popstate', onUrlChange);
    ['pushState', 'replaceState'].forEach(fn => { const orig = history[fn]; history[fn] = function () { const ret = orig.apply(this, arguments); setTimeout(onUrlChange, 0); return ret; }; });
    setInterval(onUrlChange, 1000);
  }

  boot();
})();