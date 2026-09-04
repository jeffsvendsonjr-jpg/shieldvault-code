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
  soundOnBlock: false,
  catchSoundChoice: 'standard',
  screenshotReviewGuard: false,
  emailReviewGuard: false,
  phoneReviewGuard: false,
};
const SHIELDVAULT_PROOFS_KEY = 'shieldvault_proofs';
const SHIELDVAULT_PAUSED_DOMAINS_KEY = 'shieldvault_paused_domains';
const SHIELDVAULT_MAX_PROOFS = 100;
// Soft 'review' events (everyday email/phone, large benign pastes) are
// high-volume, so they get a small dedicated slice and can never evict the
// hard-block proofs that make up the real audit trail.
const SHIELDVAULT_MAX_REVIEW_PROOFS = 25;

// ── Pro entitlement authority ────────────────────────────────────────────────
// Local storage keeps the license key and display metadata only. Every Plus
// decision is made here after the backend validates the stored key or from a
// session-scoped cache that only a successful backend check can create.
const SHIELDVAULT_API_BASE = 'https://shieldvault.site';
const SHIELDVAULT_VERIFY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const SHIELDVAULT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000; // 72 hours
const SHIELDVAULT_SESSION_CACHE_KEY = 'shieldvault_verified_session';
const SHIELDVAULT_LOCAL_ENTITLEMENT_METADATA_KEYS = [
  'shieldvault_pro',
  'shieldvault_pro_expiry',
  'shieldvault_pro_plan',
  'shieldvault_tier',
  'shieldvault_email',
  'shieldvault_last_verified_at',
];

// Coalesce backend checks for the same key, including forced refreshes. Cache
// reads remain outside this coordinator so a forced refresh never joins a
// non-forced request that can return cached state without contacting the server.
let shieldVaultProCheckPromise = null;
let shieldVaultProCheckKey = '';
let shieldVaultProCheckGeneration = 0;
let shieldVaultEntitlementGeneration = 0;

async function readVerifiedSessionCache(key) {
  try {
    const stored = await chrome.storage.session.get([SHIELDVAULT_SESSION_CACHE_KEY]);
    const cache = stored[SHIELDVAULT_SESSION_CACHE_KEY];
    if (
      !cache ||
      cache.isPro !== true ||
      cache.licenseKey !== key ||
      typeof cache.verifiedAt !== 'number' ||
      cache.verifiedAt <= 0
    ) {
      return { isPro: false, reason: 'unverified' };
    }
    const expiry = typeof cache.expiresAt === 'number' && cache.expiresAt > 0
      ? cache.expiresAt
      : null;
    if (expiry !== null && Date.now() >= expiry) {
      return { isPro: false, reason: 'expired' };
    }
    return {
      isPro: true,
      plan: cache.plan || null,
      expiresAt: expiry,
      verifiedAt: cache.verifiedAt,
    };
  } catch (_) {
    return { isPro: false, reason: 'unverified' };
  }
}

async function writeVerifiedSessionCache(cache) {
  try {
    await chrome.storage.session.set({ [SHIELDVAULT_SESSION_CACHE_KEY]: cache });
  } catch (_) {
    // If session storage is unavailable, entitlement must be verified again
    // after this worker is suspended. Never fall back to local display flags.
  }
}

async function clearVerifiedSessionCache() {
  try {
    await chrome.storage.session.remove(SHIELDVAULT_SESSION_CACHE_KEY);
  } catch (_) {}
}

async function clearLocalEntitlementMetadata({ keepLicenseKey = true } = {}) {
  const keys = [...SHIELDVAULT_LOCAL_ENTITLEMENT_METADATA_KEYS];
  if (!keepLicenseKey) keys.push('shieldvault_license_key');
  await chrome.storage.local.remove(keys);
}

function offlineGraceDecision(cached) {
  const age = cached.isPro === true && typeof cached.verifiedAt === 'number'
    ? Date.now() - cached.verifiedAt
    : Infinity;
  const withinGrace =
    cached.isPro === true &&
    age >= 0 &&
    age < SHIELDVAULT_OFFLINE_GRACE_MS;

  return withinGrace
    ? { ...cached, reason: 'grace' }
    : { isPro: false, reason: 'verification_unavailable' };
}

async function licenseStillCurrent(key, generation) {
  if (generation !== shieldVaultEntitlementGeneration) return false;
  const stored = await chrome.storage.local.get(['shieldvault_license_key']);
  const current = typeof stored.shieldvault_license_key === 'string'
    ? stored.shieldvault_license_key.trim()
    : '';
  return generation === shieldVaultEntitlementGeneration && current === key;
}

async function offlineGraceForCurrentLicense(key, cached, generation) {
  if (!(await licenseStillCurrent(key, generation))) {
    return { isPro: false, reason: 'license_changed' };
  }
  return offlineGraceDecision(cached);
}

async function validateLicenseWithBackend(key, cached, generation) {
  if (
    shieldVaultProCheckPromise &&
    shieldVaultProCheckKey === key &&
    shieldVaultProCheckGeneration === generation
  ) {
    return shieldVaultProCheckPromise;
  }

  const check = (async () => {
    let response;
    try {
      response = await fetch(SHIELDVAULT_API_BASE + '/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
    } catch (_) {
      return offlineGraceForCurrentLicense(key, cached, generation);
    }

    let data;
    try {
      data = await response.json();
    } catch (_) {
      return offlineGraceForCurrentLicense(key, cached, generation);
    }

    if (!(await licenseStillCurrent(key, generation))) {
      return { isPro: false, reason: 'license_changed' };
    }

    const expiry = data && typeof data.expiresAt === 'number' && data.expiresAt > 0
      ? data.expiresAt
      : null;
    const expired =
      (data && data.expired === true) ||
      (data && data.reason === 'expired') ||
      (expiry !== null && Date.now() >= expiry);

    // A definitive invalid response revokes even when the backend uses a 4xx
    // status. Grace is reserved for failures with no authoritative decision.
    if (data && data.valid === false) {
      await clearVerifiedSessionCache();
      if (!(await licenseStillCurrent(key, generation))) {
        return { isPro: false, reason: 'license_changed' };
      }
      await clearLocalEntitlementMetadata({ keepLicenseKey: true });
      return {
        isPro: false,
        reason: expired ? 'expired' : 'invalid',
        error: typeof data.error === 'string' ? data.error.slice(0, 200) : undefined,
      };
    }
    if (!response.ok) return offlineGraceForCurrentLicense(key, cached, generation);

    if (!data || data.valid !== true || expired) {
      await clearVerifiedSessionCache();
      if (!(await licenseStillCurrent(key, generation))) {
        return { isPro: false, reason: 'license_changed' };
      }
      await clearLocalEntitlementMetadata({ keepLicenseKey: true });
      return { isPro: false, reason: expired ? 'expired' : 'invalid' };
    }

    const plan = data.plan || (expiry ? 'monthly' : 'lifetime');
    const verifiedAt = Date.now();
    const verifiedState = {
      isPro: true,
      plan,
      expiresAt: expiry,
      verifiedAt,
      reason: 'verified',
    };
    await writeVerifiedSessionCache({ ...verifiedState, licenseKey: key });

    if (!(await licenseStillCurrent(key, generation))) {
      return { isPro: false, reason: 'license_changed' };
    }

    // These values support display and checkout only. No consumer may use them
    // as proof of entitlement.
    try {
      await chrome.storage.local.set({
        shieldvault_pro: true,
        shieldvault_tier: data.tier || 'plus',
        shieldvault_pro_expiry: expiry,
        shieldvault_pro_plan: plan,
        shieldvault_email: data.email || '',
      });
    } catch (error) {
      // Display metadata is best-effort. A successful server verification and
      // session cache remain the authority even if this convenience write fails.
      console.warn('[ShieldVault] Could not store entitlement display metadata:', error);
    }

    if (!(await licenseStillCurrent(key, generation))) {
      return { isPro: false, reason: 'license_changed' };
    }

    return verifiedState;
  })().catch((error) => {
    console.warn('[ShieldVault] Pro verification failed:', error);
    return { isPro: false, reason: 'verification_unavailable' };
  });

  shieldVaultProCheckKey = key;
  shieldVaultProCheckGeneration = generation;
  shieldVaultProCheckPromise = check;
  try {
    return await check;
  } finally {
    // A different-key check may have replaced the active slot while this one
    // was in flight. Only its own completion may clear the slot.
    if (shieldVaultProCheckPromise === check) {
      shieldVaultProCheckPromise = null;
      shieldVaultProCheckKey = '';
      shieldVaultProCheckGeneration = 0;
    }
  }
}

async function verifyStoredLicense({ force = false } = {}) {
  const generation = shieldVaultEntitlementGeneration;
  try {
    const stored = await chrome.storage.local.get(['shieldvault_license_key']);
    const key = typeof stored.shieldvault_license_key === 'string'
      ? stored.shieldvault_license_key.trim()
      : '';

    if (!key) {
      await clearVerifiedSessionCache();
      if (generation !== shieldVaultEntitlementGeneration) {
        return { isPro: false, reason: 'license_changed' };
      }

      const storedMetadata = await chrome.storage.local.get(
        SHIELDVAULT_LOCAL_ENTITLEMENT_METADATA_KEYS
      );
      if (generation !== shieldVaultEntitlementGeneration) {
        return { isPro: false, reason: 'license_changed' };
      }

      const hasStaleMetadata = SHIELDVAULT_LOCAL_ENTITLEMENT_METADATA_KEYS.some(
        (metadataKey) => Object.prototype.hasOwnProperty.call(storedMetadata, metadataKey)
      );
      if (hasStaleMetadata) {
        await clearLocalEntitlementMetadata({ keepLicenseKey: true });
        if (generation !== shieldVaultEntitlementGeneration) {
          return { isPro: false, reason: 'license_changed' };
        }
      }
      return { isPro: false, reason: 'no_license' };
    }

    const cached = await readVerifiedSessionCache(key);
    if (
      shieldVaultProCheckPromise &&
      shieldVaultProCheckKey === key &&
      shieldVaultProCheckGeneration === generation
    ) {
      return shieldVaultProCheckPromise;
    }
    const sinceLastGoodCheck = cached.isPro
      ? Date.now() - cached.verifiedAt
      : Infinity;
    if (
      !force &&
      cached.isPro &&
      sinceLastGoodCheck >= 0 &&
      sinceLastGoodCheck < SHIELDVAULT_VERIFY_TTL_MS
    ) {
      return { ...cached, reason: 'cached' };
    }

    return validateLicenseWithBackend(key, cached, generation);
  } catch (error) {
    console.warn('[ShieldVault] Pro verification failed:', error);
    if (generation !== shieldVaultEntitlementGeneration) {
      return { isPro: false, reason: 'license_changed' };
    }
    return { isPro: false, reason: 'verification_unavailable' };
  }
}

function publicEntitlementState(state) {
  const result = {
    isPro: Boolean(state && state.isPro === true),
    reason: state && typeof state.reason === 'string' ? state.reason : 'unverified',
  };
  if (result.isPro) {
    result.plan = state.plan || null;
    result.expiresAt = typeof state.expiresAt === 'number' ? state.expiresAt : null;
    result.verifiedAt = typeof state.verifiedAt === 'number' ? state.verifiedAt : null;
  }
  return result;
}

let shieldVaultLastBroadcastSignature = null;

function entitlementSignature(state) {
  const publicState = publicEntitlementState(state);
  return JSON.stringify({
    isPro: publicState.isPro,
    plan: publicState.plan ?? null,
    expiresAt: publicState.expiresAt ?? null,
  });
}

async function popupEntitlementState(state) {
  const response = publicEntitlementState(state);
  if (!response.isPro) return response;
  try {
    const stored = await chrome.storage.local.get(['shieldvault_email']);
    if (typeof stored.shieldvault_email === 'string') response.email = stored.shieldvault_email;
  } catch (_) {}
  return response;
}

async function broadcastEntitlement(state, { force = false } = {}) {
  // A stale request must never overwrite a newer activation/removal broadcast.
  if (state && state.reason === 'license_changed') return;

  const signature = entitlementSignature(state);
  if (!force && signature === shieldVaultLastBroadcastSignature) return;
  shieldVaultLastBroadcastSignature = signature;

  const message = {
    type: 'SHIELDVAULT_ENTITLEMENT_CHANGED',
    ...publicEntitlementState(state),
  };
  const deliveries = [];
  const safely = (delivery) => Promise.resolve(delivery).catch(() => {});

  // Notify extension pages (popup/options) that happen to be open.
  try {
    deliveries.push(safely(chrome.runtime.sendMessage(message)));
  } catch (_) {}

  // runtime.sendMessage does not reliably deliver worker-originated messages to
  // content scripts, so notify every injected tab explicitly. Tabs without a
  // ShieldVault receiver reject harmlessly.
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs || []) {
      if (typeof tab.id !== 'number') continue;
      try {
        deliveries.push(safely(chrome.tabs.sendMessage(tab.id, message)));
      } catch (_) {}
    }
  } catch (_) {}

  await Promise.all(deliveries);
}

async function activateLicense(rawKey) {
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  if (!key) return { isPro: false, reason: 'no_license' };

  shieldVaultEntitlementGeneration += 1;
  const generation = shieldVaultEntitlementGeneration;
  await chrome.storage.local.set({ shieldvault_license_key: key });
  await clearVerifiedSessionCache();
  await clearLocalEntitlementMetadata({ keepLicenseKey: true });

  const state = await validateLicenseWithBackend(
    key,
    { isPro: false, reason: 'unverified' },
    generation
  );
  await broadcastEntitlement(state, { force: true });

  const response = await popupEntitlementState(state);
  if (!response.isPro && state && typeof state.error === 'string') {
    response.error = state.error;
  }
  return response;
}

async function removeLicense() {
  shieldVaultEntitlementGeneration += 1;
  await clearLocalEntitlementMetadata({ keepLicenseKey: false });
  await clearVerifiedSessionCache();
  const state = { isPro: false, reason: 'no_license' };
  await broadcastEntitlement(state, { force: true });
  return state;
}

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

/**
 * Build a stored Proof from a SHIELDVAULT_PREVENTED message. A Proof is the
 * only thing ShieldVault persists about a block — deliberately metadata-only,
 * never the matched secret content.
 *
 * @typedef {Object} Proof
 * @property {number} timestamp  When the block happened (ms epoch).
 * @property {string} domain     Originating site, derived from the sender tab.
 * @property {string} category   'secret' or 'behavioral'.
 * @property {string} vector     How it was caught (typed/paste/drop/submit/...).
 * @property {string[]} detectors Detector names that fired (capped, truncated).
 *
 * @param {{domain?: string, category?: string, vector?: string, detectors?: string[]}} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Proof}
 */
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

/**
 * Coerce the stored paused-domains value into a plain string[]. Accepts both the
 * current array form and a legacy `{ [domain]: boolean }` map so old installs
 * upgrade cleanly.
 *
 * @param {string[] | Record<string, boolean> | undefined} value
 * @returns {string[]} bare hostnames (www-stripped) that are paused.
 */
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

/**
 * Toggle protection for a single domain and persist the result.
 *
 * @param {string} domain  Hostname to flip (www-stripped, length-capped).
 * @returns {Promise<{domain: string, paused: boolean, pausedDomains: string[]}>}
 *   The domain's new paused state and the full updated list.
 */
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

// Serialize proof + badge writes. Both are read-modify-write cycles against
// chrome.storage.local; without a queue, back-to-back SHIELDVAULT_PREVENTED
// messages can read the same stale state and lose a proof or badge increment.
let proofWriteQueue = Promise.resolve();

function enqueueProofWrite(work) {
  const next = proofWriteQueue.then(work, work);
  proofWriteQueue = next.catch(() => {});
  return next;
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

/**
 * Persist a proof and bump the badge as one serialized read-modify-write.
 * Runs through {@link enqueueProofWrite} so concurrent SHIELDVAULT_PREVENTED
 * messages can't race and drop an entry. Also broadcasts SHIELDVAULT_PROOF_STORED.
 *
 * @param {{domain?: string, category?: string, vector?: string, detectors?: string[]}} message
 * @param {chrome.runtime.MessageSender} sender
 * @returns {Promise<Proof>} the stored proof.
 */
async function storeProof(message, sender) {
  return enqueueProofWrite(async () => {
    const proof = proofFromMessage(message, sender);
    const stored = await chrome.storage.local.get([
      SHIELDVAULT_PROOFS_KEY,
      SHIELDVAULT_BADGE_COUNT_KEY,
    ]);
    const existing = Array.isArray(stored[SHIELDVAULT_PROOFS_KEY])
      ? stored[SHIELDVAULT_PROOFS_KEY]
      : [];
    // Fill the cap with hard-block proofs first so they're never pushed out by
    // high-volume soft 'review' events; reviews use only the leftover slots,
    // bounded by their own smaller cap.
    const combined = [proof, ...existing];
    const blocks = combined
      .filter((p) => p && p.category !== 'review')
      .slice(0, SHIELDVAULT_MAX_PROOFS);
    const reviewSlots = Math.max(
      0,
      Math.min(SHIELDVAULT_MAX_PROOFS - blocks.length, SHIELDVAULT_MAX_REVIEW_PROOFS)
    );
    const reviews = combined
      .filter((p) => p && p.category === 'review')
      .slice(0, reviewSlots);
    const proofs = [...blocks, ...reviews].sort(
      (a, b) => (b.timestamp || 0) - (a.timestamp || 0)
    );
    // 'review' events (ordinary email/phone, large harmless paste) are recorded
    // for transparency but are NOT blocks — they must not inflate the badge.
    const prevCount = Number(stored[SHIELDVAULT_BADGE_COUNT_KEY]) || 0;
    const count = proof.category === 'review' ? prevCount : prevCount + 1;

    // Proof list and badge count commit together in one serialized write.
    await chrome.storage.local.set({
      [SHIELDVAULT_PROOFS_KEY]: proofs,
      [SHIELDVAULT_BADGE_COUNT_KEY]: count,
    });
    try {
      await chrome.action.setBadgeBackgroundColor({ color: '#4c6fff' });
      await chrome.action.setBadgeText({ text: formatBadge(count) });
    } catch (_) {
      // Badge is best-effort.
    }
    try {
      chrome.runtime.sendMessage({ type: 'SHIELDVAULT_PROOF_STORED', proof });
    } catch (_) {
      // Popup may be closed.
    }
    return proof;
  });
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
    // Fresh install starts from a zero badge. (Chrome clears storage.local on
    // uninstall, so this is defensive rather than load-bearing.)
    chrome.storage.local.set({ [SHIELDVAULT_BADGE_COUNT_KEY]: 0 }).catch(() => {});
    chrome.action.setBadgeText({ text: '' }).catch(() => {});
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
  verifyStoredLicense({ force: true })
    .then(broadcastEntitlement)
    .catch(() => {});
});

/**
 * Central runtime message router for the service worker.
 *
 * This is the IPC contract between the content script / popup and the
 * background. Every message is `{ type: string, ...payload }`; handlers that
 * answer asynchronously return `true` to keep the `sendResponse` channel open.
 *
 * Message types:
 * - `SHIELDVAULT_PREVENTED`  (content → bg): a block occurred. Payload
 *     `{ domain?, category?, vector?, detectors? }`; persists a proof, bumps the
 *     badge, and responds `{ ok, proof }`.
 * - `SHIELDVAULT_GET_PROOFS` (popup → bg): responds
 *     `{ proofs: Proof[], pausedDomains: string[] }`.
 * - `SHIELDVAULT_CLEAR_PROOFS` (popup → bg): wipes history + badge, responds
 *     `{ ok, proofs: [] }`.
 * - `SHIELDVAULT_GET_PAUSE_STATE` (popup → bg): payload `{ domain }`, responds
 *     `{ paused: boolean, pausedDomains: string[] }`.
 * - `SHIELDVAULT_TOGGLE_PAUSE` (popup → bg): payload `{ domain }`, flips pause
 *     for that domain, responds `{ ok, domain, paused, pausedDomains }`.
 * - `SHIELDVAULT_PAUSED_BADGE` (content → bg): payload `{ paused: boolean }`;
 *     sets/clears the per-tab "OFF" toolbar badge for the sender's tab.
 *
 * The worker also *broadcasts* `SHIELDVAULT_PROOF_STORED` `{ proof }` when a
 * proof is saved, so an open popup can update live.
 *
 * @param {{type: string, [key: string]: unknown}} message
 * @param {chrome.runtime.MessageSender} sender
 * @param {(response?: unknown) => void} sendResponse
 * @returns {boolean} true when responding asynchronously.
 */
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

  if (message.type === 'SHIELDVAULT_PAUSED_BADGE') {
    // Per-tab paused indicator: a gold "OFF" badge on the toolbar icon for
    // tabs whose site the user paused, so a forgotten pause is visible without
    // opening the popup. The tab comes from the message sender (no tabs
    // permission); per-tab badges auto-clear on navigation and the fresh
    // content script re-reports. Setting null text restores the global
    // block-count badge for that tab.
    const tabId = sender && sender.tab && sender.tab.id;
    if (typeof tabId === 'number') {
      const paused = message.paused === true;
      Promise.resolve()
        .then(() => chrome.action.setBadgeText({ tabId, text: paused ? 'OFF' : null }))
        .then(() => chrome.action.setBadgeBackgroundColor({
          tabId,
          color: paused ? '#f4b740' : '#4c6fff',
        }))
        .catch(() => {});
    }
    return false;
  }

  if (message.type === 'SHIELDVAULT_GET_ENTITLEMENT') {
    verifyStoredLicense({ force: message.force === true })
      .then(async (state) => {
        // Cached reads do not represent a state transition. Every other result
        // is broadcast so all already-open tabs converge on the same tier.
        if (state.reason !== 'cached') await broadcastEntitlement(state);
        sendResponse(publicEntitlementState(state));
      })
      .catch(() => sendResponse({ isPro: false, reason: 'verification_failed' }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_REFRESH_ENTITLEMENT') {
    verifyStoredLicense({ force: true })
      .then(async (state) => {
        await broadcastEntitlement(state);
        sendResponse(await popupEntitlementState(state));
      })
      .catch(() => sendResponse({ isPro: false, reason: 'verification_failed' }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_ACTIVATE_LICENSE') {
    activateLicense(message.key)
      .then((state) => sendResponse(state))
      .catch(() => sendResponse({
        isPro: false,
        reason: 'activation_failed',
        error: 'Activation failed. Please try again.',
      }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_REMOVE_LICENSE') {
    removeLicense()
      .then((state) => sendResponse(publicEntitlementState(state)))
      .catch(() => sendResponse({ isPro: false, reason: 'removal_failed' }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_OPEN_SETTINGS') {
    // Content scripts can't open the options page directly.
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    }
    return false;
  }

  return false;
});
