// Service worker for ShieldVault extension
// Removed userp.ly date verification feature (not core to ShieldVault)

const SHIELDVAULT_DEFAULT_SETTINGS = {
  secretGuard: true,
  tokenGuard: true,
  passwordGuard: true,
  recoveryPhraseGuard: true,
  privateInfoGuard: true,
  clientDataGuard: true,
  largePasteGuard: true,
  reputationGuard: false,
  lateNightPostAlert: false,
  emotionalPostWarning: false,
};
const SHIELDVAULT_PROOFS_KEY = 'shieldvault_proofs';
const SHIELDVAULT_PAUSED_DOMAINS_KEY = 'shieldvault_paused_domains';
const SHIELDVAULT_MAX_PROOFS = 100;

function safeText(value, maxLength) {
  return String(value || '').slice(0, maxLength);
}

function domainFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_) {
    return '';
  }
}

function domainFromSender(sender) {
  return domainFromUrl(
    sender && sender.tab && sender.tab.url
      ? sender.tab.url
      : sender && sender.url
        ? sender.url
        : ''
  );
}

function normalizeDetectors(detectors) {
  if (!Array.isArray(detectors)) return [];
  return detectors
    .map((detector) => safeText(detector, 80))
    .filter(Boolean)
    .slice(0, 12);
}

function proofFromMessage(message, sender) {
  return {
    timestamp: Date.now(),
    domain: domainFromSender(sender) || safeText(message.domain, 120) || 'unknown',
    category: safeText(message.category || 'secret', 40),
    vector: safeText(message.vector, 40),
    detectors: normalizeDetectors(message.detectors),
  };
}

async function getStoredProofs() {
  const result = await chrome.storage.local.get([SHIELDVAULT_PROOFS_KEY]);
  return Array.isArray(result[SHIELDVAULT_PROOFS_KEY])
    ? result[SHIELDVAULT_PROOFS_KEY]
    : [];
}

function normalizePausedDomains(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === 'object') {
    return Object.keys(value).filter((domain) => value[domain] !== false);
  }
  return [];
}

async function getPausedDomains() {
  const result = await chrome.storage.local.get([SHIELDVAULT_PAUSED_DOMAINS_KEY]);
  return normalizePausedDomains(result[SHIELDVAULT_PAUSED_DOMAINS_KEY]);
}

async function setPausedDomains(domains) {
  await chrome.storage.local.set({ [SHIELDVAULT_PAUSED_DOMAINS_KEY]: domains });
}

// Toggle a domain's paused state. Returns the new state for that domain.
async function togglePausedDomain(domain) {
  const clean = safeText(domain, 200).replace(/^www\./, '');
  if (!clean) {
    return { domain: '', paused: false, pausedDomains: await getPausedDomains() };
  }
  const current = await getPausedDomains();
  let next;
  let paused;
  if (current.includes(clean)) {
    next = current.filter((d) => d !== clean);
    paused = false;
  } else {
    next = [...current, clean];
    paused = true;
  }
  await setPausedDomains(next);
  return { domain: clean, paused, pausedDomains: next };
}

// ── Toolbar badge: running count of protection events ────────────────────────
const SHIELDVAULT_BADGE_COUNT_KEY = 'shieldvault_badge_count';

function formatBadge(count) {
  if (!count) return '';
  return count > 999 ? '999+' : String(count);
}

async function bumpBadge() {
  try {
    const stored = await chrome.storage.local.get([SHIELDVAULT_BADGE_COUNT_KEY]);
    const count = (Number(stored[SHIELDVAULT_BADGE_COUNT_KEY]) || 0) + 1;
    await chrome.storage.local.set({ [SHIELDVAULT_BADGE_COUNT_KEY]: count });
    await chrome.action.setBadgeBackgroundColor({ color: '#4c6fff' });
    await chrome.action.setBadgeText({ text: formatBadge(count) });
  } catch (_) {
    // Badge is best-effort.
  }
}

async function restoreBadge() {
  try {
    const stored = await chrome.storage.local.get([SHIELDVAULT_BADGE_COUNT_KEY]);
    await chrome.action.setBadgeBackgroundColor({ color: '#4c6fff' });
    await chrome.action.setBadgeText({
      text: formatBadge(Number(stored[SHIELDVAULT_BADGE_COUNT_KEY]) || 0),
    });
  } catch (_) {
    // Badge is best-effort.
  }
}

async function storeProof(message, sender) {
  const proof = proofFromMessage(message, sender);
  const existing = await getStoredProofs();
  const proofs = [proof, ...existing].slice(0, SHIELDVAULT_MAX_PROOFS);
  await chrome.storage.local.set({ [SHIELDVAULT_PROOFS_KEY]: proofs });
  await bumpBadge();
  try {
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_PROOF_STORED', proof });
  } catch (_) {
    // Popup may be closed.
  }
  return proof;
}

async function ensureShieldVaultDefaults() {
  try {
    const current = await chrome.storage.local.get(['onboardingComplete', 'shieldvaultSettings']);
    const mergedSettings = {
      ...SHIELDVAULT_DEFAULT_SETTINGS,
      ...(current && current.shieldvaultSettings ? current.shieldvaultSettings : {}),
    };
    const payload = { shieldvaultSettings: mergedSettings };
    if (typeof current.onboardingComplete !== 'boolean') payload.onboardingComplete = false;
    await chrome.storage.local.set(payload);
  } catch (_) {
    // Ignore storage failures in service worker.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    ensureShieldVaultDefaults().finally(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    });
    return;
  }
  ensureShieldVaultDefaults();
  restoreBadge();
});

chrome.runtime.onStartup.addListener(() => {
  restoreBadge();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') return false;

  if (message.type === 'SHIELDVAULT_PREVENTED') {
    storeProof(message, sender)
      .then((proof) => sendResponse({ ok: true, proof }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_GET_PROOFS') {
    Promise.all([getStoredProofs(), getPausedDomains()])
      .then(([proofs, pausedDomains]) => sendResponse({ proofs, pausedDomains }))
      .catch(() => sendResponse({ proofs: [], pausedDomains: [] }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_CLEAR_PROOFS') {
    chrome.storage.local
      .set({ [SHIELDVAULT_PROOFS_KEY]: [], [SHIELDVAULT_BADGE_COUNT_KEY]: 0 })
      .then(() => chrome.action.setBadgeText({ text: '' }).catch(() => {}))
      .then(() => sendResponse({ ok: true, proofs: [] }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_GET_PAUSE_STATE') {
    getPausedDomains()
      .then((pausedDomains) => {
        const clean = safeText(message.domain, 200).replace(/^www\./, '');
        sendResponse({ paused: clean ? pausedDomains.includes(clean) : false, pausedDomains });
      })
      .catch(() => sendResponse({ paused: false, pausedDomains: [] }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_TOGGLE_PAUSE') {
    togglePausedDomain(message.domain)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
