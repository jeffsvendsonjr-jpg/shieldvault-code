// Service worker for ShieldVault extension
// Review-hardened: no analytics or install/update event tracking.

const SUPABASE_URL = 'https://nihquqccvnfuaqsxyymj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5paHF1cWNjdm5mdWFxc3h5eW1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkwNjQ1ODIsImV4cCI6MjA5NDY0MDU4Mn0.Q0ea1N8iWDoy0KzbFvL4rFYg0liZevnC3AFUDiJY1yE';
const VERIFY_URL = `${SUPABASE_URL}/functions/v1/verify-date`;
const SHIELDVAULT_DEFAULT_SETTINGS = {
  secretGuard: true,
  tokenGuard: true,
  passwordGuard: true,
  recoveryPhraseGuard: true,
  privateInfoGuard: true,
  clientDataGuard: true,
  largePasteGuard: true,
  creditCardGuard: true,
  phoneGuard: true,
  bankAccountGuard: true,
  reputationGuard: false,
  lateNightPostAlert: false,
  emotionalPostWarning: false,
};

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


// ── Proof store ──────────────────────────────────────────────────────────────
// Keeps the last SV_MAX_PROOFS blocked events in memory and persists them to
// chrome.storage.local so history survives a service-worker restart.

const SV_PROOFS_KEY = 'shieldvault_proofs';
const SV_MAX_PROOFS = 100;
const SV_BADGE_DATE_KEY = 'shieldvault_badge_date';
const SV_BADGE_COUNT_KEY = 'shieldvault_badge_count';

async function incrementBadge() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const data = await chrome.storage.local.get([SV_BADGE_DATE_KEY, SV_BADGE_COUNT_KEY]);
    const count = (data[SV_BADGE_DATE_KEY] === today ? (data[SV_BADGE_COUNT_KEY] || 0) : 0) + 1;
    await chrome.storage.local.set({ [SV_BADGE_DATE_KEY]: today, [SV_BADGE_COUNT_KEY]: count });
    chrome.action.setBadgeText({ text: String(count) });
    chrome.action.setBadgeBackgroundColor({ color: '#4c6fff' });
  } catch (_) {}
}
let _svProofs = [];

(async function loadSvProofs() {
  try {
    const data = await chrome.storage.local.get([SV_PROOFS_KEY]);
    if (data && Array.isArray(data[SV_PROOFS_KEY])) {
      _svProofs = data[SV_PROOFS_KEY].slice(0, SV_MAX_PROOFS);
    }
  } catch (_) {}
})();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  // ── Record a blocked event from the content script ───────────────────────
  if (message.type === 'SHIELDVAULT_PREVENTED') {
    const proof = {
      ts: Date.now(),
      domain: message.domain ||
        (sender.tab && sender.tab.url
          ? (() => { try { return new URL(sender.tab.url).hostname; } catch (_) { return ''; } })()
          : ''),
      detectors: message.detectors || [],
      vector: message.vector || '',
    };
    _svProofs.unshift(proof);
    if (_svProofs.length > SV_MAX_PROOFS) _svProofs.length = SV_MAX_PROOFS;
    chrome.storage.local.set({ [SV_PROOFS_KEY]: _svProofs }).catch(() => {});
    incrementBadge();
    return false;
  }

  // ── Return stored proofs when the popup opens ────────────────────────────
  if (message.type === 'SHIELDVAULT_GET_PROOFS') {
    sendResponse({ proofs: _svProofs });
    return false;
  }

  if (message.type !== 'USERPLY_VERIFY_DATE') return false;


  (async () => {
    try {
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          'apikey': SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          url: message.url,
          claimed_date: message.claimedDate || undefined,
          anonymous_id: message.anonymousId,
        }),
      });

      if (!res.ok) {
        sendResponse({ ok: false, status: res.status });
        return;
      }

      const data = await res.json();
      sendResponse({ ok: true, data });
    } catch (error) {
      sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
    }
  })();

  return true;
});
