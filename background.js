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

async function getPausedDomains() {
  const result = await chrome.storage.local.get([SHIELDVAULT_PAUSED_DOMAINS_KEY]);
  return result[SHIELDVAULT_PAUSED_DOMAINS_KEY] || [];
}

async function storeProof(message, sender) {
  const proof = proofFromMessage(message, sender);
  const existing = await getStoredProofs();
  const proofs = [proof, ...existing].slice(0, SHIELDVAULT_MAX_PROOFS);
  await chrome.storage.local.set({ [SHIELDVAULT_PROOFS_KEY]: proofs });
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
      .set({ [SHIELDVAULT_PROOFS_KEY]: [] })
      .then(() => sendResponse({ ok: true, proofs: [] }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
