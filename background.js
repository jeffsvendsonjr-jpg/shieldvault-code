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
  emailReviewGuard: true,
  phoneReviewGuard: true,
};
const SHIELDVAULT_PROOFS_KEY = 'shieldvault_proofs';
const SHIELDVAULT_PAUSED_DOMAINS_KEY = 'shieldvault_paused_domains';
const SHIELDVAULT_MAX_PROOFS = 100;
// Soft 'review' events (everyday email/phone, large benign pastes) are
// high-volume, so they get a small dedicated slice and can never evict the
// hard-block proofs that make up the real audit trail.
const SHIELDVAULT_MAX_REVIEW_PROOFS = 25;


// ── Pro entitlement authority ────────────────────────────────────────────────
// Local storage is only a place to keep the user's license key and display
// metadata. It is never accepted as proof of payment. Every Pro decision is
// made here after the backend validates the stored key.
const SHIELDVAULT_API_BASE = 'https://shieldvault.site';
// A successful server check is reused for this long before re-fetching, so
// per-frame content-script boots (all_frames on 30+ hosts) don't stampede the
// backend with one POST each.
const SHIELDVAULT_VERIFY_TTL_MS = 15 * 60 * 1000; // 15 minutes
// Offline grace is anchored in chrome.storage.session: memory-backed (never
// on disk), alive for the whole browser session, and — unlike storage.local —
// not writable from content scripts or page devtools, so no storage edit can
// create or extend entitlement. It survives MV3 service-worker suspensions,
// which occur after ~30s idle; a plain in-memory variable would lose the
// grace anchor dozens of times an hour. Cost: a full browser restart while
// offline drops Pro until the backend is reachable again. Forging this
// anchor requires the extension's own service-worker console, which is the
// same access level as patching the bundle itself.
const SHIELDVAULT_OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000; // 72 hours
const SHIELDVAULT_SESSION_CACHE_KEY = 'shieldvault_verified_session';
let shieldVaultProCheckPromise = null;

async function readVerifiedSessionCache() {
  try {
    const stored = await chrome.storage.session.get([SHIELDVAULT_SESSION_CACHE_KEY]);
    const cache = stored[SHIELDVAULT_SESSION_CACHE_KEY];
    if (!cache || cache.isPro !== true || typeof cache.verifiedAt !== 'number' || cache.verifiedAt <= 0) {
      return { isPro: false, reason: 'unverified' };
    }
    const expiry = typeof cache.expiresAt === 'number' && cache.expiresAt > 0 ? cache.expiresAt : null;
    if (expiry !== null && Date.now() > expiry) {
      return { isPro: false, reason: 'expired' };
    }
    return { isPro: true, plan: cache.plan || null, expiresAt: expiry, verifiedAt: cache.verifiedAt };
  } catch (_) {
    return { isPro: false, reason: 'unverified' };
  }
}

async function writeVerifiedSessionCache(cache) {
  try {
    await chrome.storage.session.set({ [SHIELDVAULT_SESSION_CACHE_KEY]: cache });
  } catch (_) {
    // Session storage unavailable — grace simply won't extend past this
    // worker's lifetime. Fail toward less entitlement, never more.
  }
}

async function clearVerifiedSessionCache() {
  try {
    await chrome.storage.session.remove(SHIELDVAULT_SESSION_CACHE_KEY);
  } catch (_) {}
}

async function clearLocalEntitlementMetadata({ keepLicenseKey = true } = {}) {
  const keys = [
    'shieldvault_pro',
    'shieldvault_pro_expiry',
    'shieldvault_pro_plan',
    'shieldvault_tier',
    'shieldvault_email',
    'shieldvault_last_verified_at',
  ];
  if (!keepLicenseKey) keys.push('shieldvault_license_key');
  await chrome.storage.local.remove(keys);
}

async function verifyStoredLicense({ force = false } = {}) {
  if (shieldVaultProCheckPromise && !force) return shieldVaultProCheckPromise;

  shieldVaultProCheckPromise = (async () => {
    try {
      const stored = await chrome.storage.local.get(['shieldvault_license_key']);
      const key = typeof stored.shieldvault_license_key === 'string'
        ? stored.shieldvault_license_key.trim()
        : '';

      if (!key) {
        await clearVerifiedSessionCache();
        await clearLocalEntitlementMetadata({ keepLicenseKey: false });
        return { isPro: false, reason: 'no_license' };
      }

      const cached = await readVerifiedSessionCache();
      const sinceLastGoodCheck = cached.isPro
        ? Date.now() - cached.verifiedAt
        : Infinity;

      // Reuse only a session-scoped state produced by a successful backend
      // check. No chrome.storage.local value can create or extend this cache,
      // and it survives MV3 worker suspensions within the browser session.
      if (!force && cached.isPro && sinceLastGoodCheck < SHIELDVAULT_VERIFY_TTL_MS) {
        return { ...cached, reason: 'cached' };
      }

      const graceDecision = () => {
        const withinGrace =
          cached.isPro &&
          Date.now() - cached.verifiedAt < SHIELDVAULT_OFFLINE_GRACE_MS;

        return withinGrace
          ? { ...cached, reason: 'grace' }
          : { isPro: false, reason: 'verification_unavailable' };
      };

      let response;
      try {
        response = await fetch(SHIELDVAULT_API_BASE + '/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
      } catch (_) {
        return graceDecision();
      }

      if (!response.ok) return graceDecision();

      let data;
      try {
        data = await response.json();
      } catch (_) {
        return graceDecision();
      }

      const expiry = typeof data.expiresAt === 'number' && data.expiresAt > 0
        ? data.expiresAt
        : null;
      const expired = expiry !== null && Date.now() > expiry;

      if (!data.valid || expired) {
        await clearVerifiedSessionCache();
        await clearLocalEntitlementMetadata({ keepLicenseKey: true });
        return { isPro: false, reason: expired ? 'expired' : 'invalid' };
      }

      const plan = data.plan || (expiry ? 'monthly' : 'lifetime');
      const verifiedAt = Date.now();
      await writeVerifiedSessionCache({
        isPro: true,
        plan,
        expiresAt: expiry,
        verifiedAt,
      });

      // These values are display metadata only. They are never read as proof.
      await chrome.storage.local.set({
        shieldvault_pro: true,
        shieldvault_tier: data.tier || 'plus',
        shieldvault_pro_expiry: expiry,
        shieldvault_pro_plan: plan,
        shieldvault_email: data.email || '',
      });

      return { isPro: true, plan, expiresAt: expiry, verifiedAt };
    } catch (error) {
      console.warn('[ShieldVault] Pro verification failed:', error);
      return { isPro: false, reason: 'verification_unavailable' };
    } finally {
      shieldVaultProCheckPromise = null;
    }
  })();

  return shieldVaultProCheckPromise;
}

function broadcastEntitlement(state) {
  try {
    // sendMessage returns a Promise in MV3; it REJECTS asynchronously when no
    // extension page is open to receive (i.e., every browser startup). A
    // synchronous try/catch cannot catch that — the .catch is the real guard.
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_ENTITLEMENT_CHANGED', ...state })
      .catch(() => {});
  } catch (_) {
    // No extension page may be listening.
  }
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
      chrome.runtime.sendMessage({ type: 'SHIELDVAULT_PROOF_STORED', proof })
        .catch(() => {});
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
  verifyStoredLicense({ force: true }).then(broadcastEntitlement);
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
      .then((state) => sendResponse(state))
      .catch(() => sendResponse({ isPro: false, reason: 'verification_failed' }));
    return true;
  }

  if (message.type === 'SHIELDVAULT_REFRESH_ENTITLEMENT') {
    verifyStoredLicense({ force: true })
      .then((state) => {
        broadcastEntitlement(state);
        sendResponse(state);
      })
      .catch(() => sendResponse({ isPro: false, reason: 'verification_failed' }));
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
