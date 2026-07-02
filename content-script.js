// ======================================================
// ShieldVault — Content Script
// Local-only, silent, MV3-safe
// Detection without possession
// ======================================================

// ================================
// ENV
// ================================
const DEV = false;
const SHIELDVAULT_SETTINGS_KEY = "shieldvaultSettings";
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
  // Soft-review categories — each independently toggleable from the review card
  // or Settings, without affecting hard-block personal-info detection (SSN/cards).
  emailReviewGuard: true,
  phoneReviewGuard: true,
};
let SHIELDVAULT_SETTINGS = { ...SHIELDVAULT_DEFAULT_SETTINGS };

// ================================
// TIER — read from storage; default to basic
// ================================
let USER_TIER = "basic";

// Effective tier honours expiry: a 'plus' tier whose Pro window has lapsed
// (positive expiry in the past) is treated as basic, even if the popup hasn't
// re-validated yet. A null/absent expiry means lifetime (never expires).
function effectiveTier(tier, expiry) {
  const expired = typeof expiry === "number" && expiry > 0 && Date.now() > expiry;
  return tier === "plus" && !expired ? "plus" : "basic";
}

chrome.storage.local.get(["shieldvault_tier", "shieldvault_pro_expiry"], (result) => {
  USER_TIER = effectiveTier(result.shieldvault_tier, result.shieldvault_pro_expiry);
});

const SHIELDVAULT_BYPASS_WINDOW_MS = 45000;
const SHIELDVAULT_ACTIVE_BYPASSES = [];
const SHIELDVAULT_FIELD_IDS = new WeakMap();
let SHIELDVAULT_FIELD_ID_SEQ = 0;

// Show a soft-review card at most once per category per page load, so ordinary
// email/phone content doesn't nag on every message.
const SHIELDVAULT_REVIEW_SHOWN = new Set();

// ================================
// PAUSED DOMAINS — skip all detection on sites the user paused
// ================================
const SHIELDVAULT_PAUSED_DOMAINS_KEY = "shieldvault_paused_domains";
let SHIELDVAULT_PAUSED = false;

function normalizePausedList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (value && typeof value === "object") {
    return Object.keys(value).filter((domain) => value[domain] !== false);
  }
  return [];
}

function isHostPaused(list) {
  const host = location.hostname.replace(/^www\./, "");
  return normalizePausedList(list).some(
    (domain) => host === domain || host.endsWith("." + domain)
  );
}

function refreshPausedState() {
  try {
    chrome.storage.local.get([SHIELDVAULT_PAUSED_DOMAINS_KEY], (result) => {
      if (chrome.runtime.lastError) return;
      SHIELDVAULT_PAUSED = isHostPaused(result[SHIELDVAULT_PAUSED_DOMAINS_KEY]);
    });
  } catch (_) {
    // Storage unavailable; leave detection on.
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.shieldvault_tier || changes.shieldvault_pro_expiry) {
    chrome.storage.local.get(["shieldvault_tier", "shieldvault_pro_expiry"], (result) => {
      if (chrome.runtime.lastError) return;
      USER_TIER = effectiveTier(result.shieldvault_tier, result.shieldvault_pro_expiry);
    });
  }
  if (changes[SHIELDVAULT_PAUSED_DOMAINS_KEY]) {
    SHIELDVAULT_PAUSED = isHostPaused(changes[SHIELDVAULT_PAUSED_DOMAINS_KEY].newValue);
  }
  // A guard toggled from a catch card (or Settings) applies to every open tab.
  if (changes[SHIELDVAULT_SETTINGS_KEY]) {
    SHIELDVAULT_SETTINGS = mergeSettings(changes[SHIELDVAULT_SETTINGS_KEY].newValue);
  }
});

// ================================
// DEV LOGGING
// ================================
function devLog(...args) {
  if (DEV) console.log("[ShieldVault]", ...args);
}

function devWarn(...args) {
  if (DEV) console.warn("[ShieldVault]", ...args);
}

function mergeSettings(raw) {
  return { ...SHIELDVAULT_DEFAULT_SETTINGS, ...(raw || {}) };
}

async function loadShieldVaultSettings() {
  try {
    const data = await chrome.storage.local.get([SHIELDVAULT_SETTINGS_KEY]);
    SHIELDVAULT_SETTINGS = mergeSettings(data && data[SHIELDVAULT_SETTINGS_KEY]);
  } catch (_) {
    SHIELDVAULT_SETTINGS = { ...SHIELDVAULT_DEFAULT_SETTINGS };
  }
}

async function disableSubjectiveWarning(type) {
  const updated = { ...SHIELDVAULT_SETTINGS };
  if (type === "lateNight") {
    updated.lateNightPostAlert = false;
  }
  if (type === "emotional") {
    updated.emotionalPostWarning = false;
  }
  updated.reputationGuard = Boolean(updated.lateNightPostAlert || updated.emotionalPostWarning);
  SHIELDVAULT_SETTINGS = updated;
  try {
    await chrome.storage.local.set({ [SHIELDVAULT_SETTINGS_KEY]: updated });
  } catch (_) {
    // Ignore storage failures in content script.
  }
}

// ================================
// PATTERN LIBRARY
// ================================
/**
 * Secret detectors. Each entry is `{ name, pattern }` where `pattern` is a
 * RegExp matched against field text.
 *
 * Contract & house rules (see STANDARDS.md):
 * - Patterns must be specific enough to avoid redacting ordinary content.
 *   Low-entropy or label-less shapes (bare UUIDs, 40-char base64) are
 *   context-bound — require a nearby label — rather than matched raw.
 * - Public-by-design identifiers (publishable keys, OAuth client IDs, account
 *   SIDs) are intentionally NOT detected; flagging them is a false positive.
 * - Format-checkable values (cards, IBANs) are validated separately before
 *   redaction — see {@link luhnValid} / {@link ibanValid}.
 *
 * @type {Array<{name: string, pattern: RegExp}>}
 */
const DETECTORS = [
  // OpenAI
  // Left boundary so it can't match inside ordinary words like "task-<token>".
  { name: "OpenAI API Key", pattern: /(?<![A-Za-z0-9])sk-[A-Za-z0-9]{20,}/ },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },

  // AI providers and model platforms
  { name: "Anthropic API Key", pattern: /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}/ },
  { name: "Hugging Face Token", pattern: /hf_[A-Za-z0-9]{30,}/ },
  // Azure-specific label only — the generic "api key" branch was removed so it
  // no longer mislabels unrelated keys; the generic API-key detector handles those.
  { name: "Azure OpenAI Key", pattern: /(?:azure[_\s-]*openai[_\s-]*api[_\s-]*key|AZURE_OPENAI_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9]{32}['"]?/i },
  { name: "Cohere API Key", pattern: /(?:cohere[_\s-]*api[_\s-]*key|CO_API_KEY)[^\n\r]{0,40}['"]?[A-Za-z0-9_-]{30,}['"]?/i },
  { name: "Mistral API Key", pattern: /(?:mistral[_\s-]*api[_\s-]*key|MISTRAL_API_KEY)[^\n\r]{0,40}['"]?[A-Za-z0-9_-]{30,}['"]?/i },
  { name: "Groq API Key", pattern: /gsk_[A-Za-z0-9]{40,}/ },
  { name: "Perplexity API Key", pattern: /pplx-[A-Za-z0-9]{24,}/ },
  { name: "OpenRouter API Key", pattern: /sk-or-v1-[A-Za-z0-9_-]{32,}/ },
  
  // AWS
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  // Context-bound: a bare 40-char base64 string matches git SHAs, hashes, etc.
  // Require an explicit aws-secret label nearby to avoid wiping unrelated content.
  { name: "AWS Secret Access Key", pattern: /aws[_\s-]*secret[_\s-]*access[_\s-]*key[^\n\r]{0,40}['"]?[A-Za-z0-9\/+=]{40}['"]?/i },
  { name: "AWS Session Token", pattern: /FwoGZXIvYXdzE[A-Za-z0-9\/+=]+/ },
  
  // GitHub
  { name: "GitHub PAT (classic)", pattern: /ghp_[A-Za-z0-9]{36}/ },
  { name: "GitHub OAuth Token", pattern: /gho_[A-Za-z0-9]{36}/ },
  { name: "GitHub User Token", pattern: /ghu_[A-Za-z0-9]{36}/ },
  { name: "GitHub Server Token", pattern: /ghs_[A-Za-z0-9]{36}/ },
  { name: "GitHub Refresh Token", pattern: /ghr_[A-Za-z0-9]{36}/ },
  { name: "GitHub Fine-grained PAT", pattern: /github_pat_[A-Za-z0-9]{22}_[A-Za-z0-9]{59}/ },
  
  // GitLab
  { name: "GitLab PAT", pattern: /glpat-[A-Za-z0-9\-]{20}/ },
  { name: "GitLab Pipeline Token", pattern: /glptt-[A-Za-z0-9]{40}/ },
  { name: "GitLab Runner Token", pattern: /glrt-[A-Za-z0-9]{20}/ },
  
  // Stripe
  { name: "Stripe Live Secret", pattern: /sk_live_[A-Za-z0-9]{24,}/ },
  { name: "Stripe Test Secret", pattern: /sk_test_[A-Za-z0-9]{24,}/ },
  // Note: pk_live_/pk_test_ (publishable keys) are intentionally NOT detected —
  // they are designed to be public and flagging them is a false positive.
  { name: "Stripe Restricted Key", pattern: /rk_live_[A-Za-z0-9]{24,}/ },
  { name: "Stripe Webhook Secret", pattern: /whsec_[A-Za-z0-9]{32,}/ },
  
  // Google
  { name: "Google API Key", pattern: /AIza[A-Za-z0-9_-]{35}/ },
  // Note: OAuth client IDs (...apps.googleusercontent.com) are public identifiers,
  // not secrets, so they are intentionally not detected.

  // Cloud platforms and app hosting
  { name: "Vercel Token", pattern: /vercel_[A-Za-z0-9]{24,}/ },
  { name: "Netlify Personal Access Token", pattern: /nfp_[A-Za-z0-9]{30,}/ },
  { name: "Cloudflare API Token", pattern: /(?:cloudflare|cf)[^\n\r]{0,40}(?:api[_\s-]*token|api[_\s-]*key|token)\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}['"]?/i },
  { name: "Supabase Service Role Key", pattern: /(?:supabase[_\s-]*service[_\s-]*role|service_role)[^\n\r]{0,40}eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i },
  { name: "Firebase Service Account", pattern: /"type"\s*:\s*"service_account"[\s\S]{0,1500}"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----/ },
  
  // Slack
  { name: "Slack Bot Token", pattern: /xoxb-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24}/ },
  { name: "Slack User Token", pattern: /xoxp-[0-9]{10,}-[0-9]{10,}-[A-Za-z0-9]{24,}/ },
  { name: "Slack App Token", pattern: /xapp-[0-9]-[A-Z]{1,}-[0-9]+-[A-Za-z0-9]{64}/ },
  { name: "Slack Webhook", pattern: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/ },
  
  // Discord
  { name: "Discord Bot Token", pattern: /[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27}/ },
  { name: "Discord Webhook", pattern: /discord(?:app)?\.com\/api\/webhooks\/[0-9]+\/[A-Za-z0-9_-]+/ },
  
  // npm
  { name: "npm Token", pattern: /npm_[A-Za-z0-9]{36}/ },
  
  // PyPI
  { name: "PyPI Token", pattern: /pypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{50,}/ },
  
  // Twilio
  { name: "Twilio API Key", pattern: /SK[0-9a-fA-F]{32}/ },
  // Note: Account SID (AC...) is a public account identifier, not a secret.
  
  // SendGrid
  { name: "SendGrid API Key", pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  
  // Mailchimp
  { name: "Mailchimp API Key", pattern: /[A-Za-z0-9]{32}-us[0-9]{1,2}/ },
  
  // Heroku — context-bound: a bare UUID matches request IDs, React keys, etc.
  // Require a heroku label nearby to avoid wiping unrelated content.
  { name: "Heroku API Key", pattern: /heroku[^\n\r]{0,40}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },

  // Infrastructure and platform tokens
  { name: "Telegram Bot Token", pattern: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/ },
  { name: "DigitalOcean Token", pattern: /dop_v1_[a-f0-9]{64}/ },
  { name: "Replicate API Token", pattern: /r8_[A-Za-z0-9]{30,}/ },
  { name: "xAI API Key", pattern: /xai-[A-Za-z0-9]{60,}/ },
  { name: "Databricks Token", pattern: /dapi[a-f0-9]{32}/ },
  { name: "HashiCorp Vault Token", pattern: /hvs\.[A-Za-z0-9_-]{24,}/ },
  { name: "Tailscale Auth Key", pattern: /tskey-(?:auth|api|client)-[A-Za-z0-9]+-[A-Za-z0-9]+/ },

  // Crypto wallets — context-bound: a bare 64-hex string matches SHA-256 hashes,
  // so require an explicit private-key label nearby before treating it as a wallet key.
  { name: "Crypto wallet private key", pattern: /private[_\s-]*key[^\n\r]{0,20}(?:0x)?[0-9a-fA-F]{64}/i },

  // SaaS and product APIs
  { name: "Notion Integration Token", pattern: /ntn_[A-Za-z0-9]{40,}/ },
  { name: "Linear API Key", pattern: /lin_api_[A-Za-z0-9]{40,}/ },
  // Note: legacy Airtable "key..." API keys are deprecated and the pattern is
  // indistinguishable from ordinary words (e.g. "keyboard..."). Detect the
  // current Personal Access Token format instead.
  { name: "Airtable Personal Access Token", pattern: /pat[A-Za-z0-9]{14}\.[A-Za-z0-9]{64}/ },
  { name: "Shopify Access Token", pattern: /shpat_[A-Za-z0-9]{32}/ },
  { name: "Sentry Auth Token", pattern: /sntrys_[A-Za-z0-9_-]{20,}/ },
  { name: "PostHog Personal API Key", pattern: /phx_[A-Za-z0-9_-]{30,}/ },
  
  // Database URLs
  { name: "PostgreSQL URL", pattern: /postgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { name: "MySQL URL", pattern: /mysql:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { name: "MongoDB URL", pattern: /mongodb(?:\+srv)?:\/\/[^\s'"]+:[^\s'"]+@[^\s'"]+/ },
  { name: "Redis URL", pattern: /redis:\/\/[^\s'"]*:[^\s'"]+@[^\s'"]+/ },
  
  // Private Keys
  { name: "RSA Private Key", pattern: /-----BEGIN RSA PRIVATE KEY-----/ },
  { name: "OpenSSH Private Key", pattern: /-----BEGIN OPENSSH PRIVATE KEY-----/ },
  { name: "PGP Private Key", pattern: /-----BEGIN PGP PRIVATE KEY BLOCK-----/ },
  { name: "EC Private Key", pattern: /-----BEGIN EC PRIVATE KEY-----/ },
  { name: "Generic Private Key", pattern: /-----BEGIN PRIVATE KEY-----/ },
  
  // JWT (only if it looks complete)
  { name: "JSON Web Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  
  // Bearer tokens (generic high-entropy)
  { name: "Bearer Token", pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/ },
  
  // Basic Auth
  { name: "Basic Auth Header", pattern: /Basic\s+[A-Za-z0-9+\/=]{20,}/ },

  // Azure storage connection string — AccountKey holds a long base64 secret.
  { name: "Azure Storage Connection String", pattern: /AccountKey=[A-Za-z0-9+\/=]{40,}/i },

  // Generic labeled secret — context-bound so it needs an explicit
  // secret/api-key/token label next to a high-entropy value. Catches the long
  // tail of unbranded keys without flagging ordinary words.
  { name: "Generic API key / secret", pattern: /(?:secret|api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?token)["'\s]{0,4}[:=]["'\s]{0,4}[A-Za-z0-9_\-]{16,}/i },
];

// ================================
// BEHAVIORAL PATTERN LIBRARY
// ================================
// Each detector carries a severity (drives the context-aware cooldown) and a
// local, deterministic rephrasing suggestion. Suggestions are canned strings —
// no message content is analyzed remotely or sent anywhere.
const BEHAVIORAL_DETECTORS = [
  { name: "Shouting (all-caps)", test: isMostlyCaps, severity: "low",
    suggestion: "Switch to normal capitalization — all-caps reads as shouting." },
  { name: "Aggressive Punctuation", pattern: /[!]{4,}|\?[!]{2,}/, severity: "low",
    suggestion: "Trim the extra !!! or ?! — a single mark carries the same point more calmly." },
  { name: "Passive Aggressive", pattern: /per my last email|for future reference|with all due respect/i, severity: "medium",
    suggestion: "Say it directly: state what you need and by when, without the dig." },
  { name: "Hostile Opener", pattern: /^(you people|what the hell|are you serious|this is ridiculous|i can't believe you)/i, severity: "medium",
    suggestion: "Open with the specific problem, not blame — e.g. \"I hit an issue with X.\"" },
  { name: "Dismissive / Condescending", pattern: /clearly you don't understand|obviously you haven't|do i really need to explain/i, severity: "medium",
    suggestion: "Drop \"clearly/obviously\" and just explain the point plainly." },
  { name: "Rage-quit threat", pattern: /i('m| am) done with (this|you)[^a-z]|i quit[^a-z]|screw this/i, severity: "high",
    suggestion: "Take a beat before threatening to walk — you can't unsend it. Sleep on it if you can." },
  { name: "Insult / name-calling", pattern: /\b(idiot|moron|incompetent|pathetic|useless)\b/i, severity: "high",
    suggestion: "Remove the personal attack and describe the behavior or result instead." },
  { name: "Threatening escalation", pattern: /\b(i'?ll report you|i will report you|you'?ll regret|this will be escalated)\b/i, severity: "high",
    suggestion: "State your concern and next step factually, without the threat — it lands better and is safer." },
];

// Severity + suggestion lookup, including the synthetic late-night warning.
const SHIELDVAULT_SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

function behavioralMeta(name) {
  if (name === "Late-night posting check") {
    return {
      severity: "medium",
      suggestion: "It's late — consider saving this as a draft and re-reading it in the morning.",
    };
  }
  const detector = BEHAVIORAL_DETECTORS.find((d) => d.name === name);
  return {
    severity: (detector && detector.severity) || "low",
    suggestion: (detector && detector.suggestion) || "",
  };
}

// ================================
// HELPERS
// ================================
function deepActiveElement() {
  let active = document.activeElement;
  while (active && active.shadowRoot && active.shadowRoot.activeElement) {
    active = active.shadowRoot.activeElement;
  }
  return active;
}

function resolveEditable(el) {
  if (!el) return null;

  if (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable ||
    el.getAttribute("role") === "textbox"
  ) {
    return el;
  }

  if (typeof el.closest === "function") {
    return el.closest("input, textarea, [contenteditable='true'], [role='textbox']");
  }

  return null;
}

function getActiveEditable() {
  return resolveEditable(deepActiveElement());
}

function getValue(el) {
  if (!el) return "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return el.value || "";
  }
  if (el.isContentEditable || el.getAttribute("role") === "textbox") {
    return el.innerText || el.textContent || "";
  }
  return "";
}

function setValue(el, value) {
  if (!el) return;

  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set || Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype, "value"
    )?.set;
    
    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }
    
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    
  } else if (el.isContentEditable || el.getAttribute("role") === "textbox") {
    el.innerHTML = "";
    el.textContent = value;
    
    el.dispatchEvent(new InputEvent("input", { 
      bubbles: true, 
      cancelable: true,
      inputType: "deleteContentBackward"
    }));
  }
}

function isMostlyCaps(text) {
  const letters = String(text || "").match(/[A-Za-z]/g) || [];
  if (letters.length < 12) return false;
  const upper = letters.filter((letter) => letter >= "A" && letter <= "Z").length;
  return upper / letters.length >= 0.85;
}

/**
 * Luhn (mod-10) check used to confirm a digit run is a plausible payment card
 * before redacting, so arbitrary 13–19 digit numbers aren't flagged.
 *
 * @param {string} value  Candidate string (non-digits ignored).
 * @returns {boolean} true if 13–19 digits and the checksum passes.
 */
function luhnValid(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  let sum = 0;
  let doubleDigit = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function creditCardMatches(text) {
  const candidates = String(text || "").match(/\b(?:\d[ -]?){13,19}\b/g) || [];
  return candidates.filter(luhnValid);
}

/**
 * Validate an IBAN with the ISO 13616 / ISO 7064 mod-97-10 checksum. Rejects
 * bare alphanumerics like "US2024010100000" that merely look IBAN-shaped, so
 * they aren't redacted as bank accounts.
 *
 * @param {string} value  Candidate IBAN (spaces and case ignored).
 * @returns {boolean} true if the structure and checksum are valid.
 */
function ibanValid(value) {
  const iban = String(value || "").toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  // Move the first four chars to the end, then convert letters to digits
  // (A=10 … Z=35) and take the whole number mod 97 — valid IBANs yield 1.
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of code) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

function ibanMatches(text) {
  const candidates = String(text || "").match(/\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gi) || [];
  return candidates.filter(ibanValid);
}

// ================================
// DETECTION
// ================================
// Collect every occurrence of a pattern as concrete substrings so they can be
// redacted individually instead of wiping the whole field.
function collectMatches(text, pattern, name, out) {
  let re;
  try {
    const flags = pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g";
    re = new RegExp(pattern.source, flags);
  } catch (_) {
    re = pattern;
  }
  const found = text.match(re);
  if (!found) return;
  const seen = new Set();
  for (const value of found) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ name, value });
  }
}

/**
 * Run every enabled secret/PII guard over `text` and classify the matches.
 *
 * @param {string} text  Field contents to scan.
 * @returns {Array<{name: string, value: string|null, soft: boolean}>} One entry
 *   per match. `value` is the exact substring to redact (null for signal-only
 *   matches). `soft: false` = clearly sensitive → hard block; `soft: true` =
 *   ordinary signal (plain email/phone, large harmless paste) → review only,
 *   never blocked on its own. Each guard is gated by its own setting.
 */
function detectSecretMatches(text) {
  if (!text || typeof text !== "string") return [];

  // --- HARD signals: secrets and clearly sensitive personal data ---
  const hard = [];
  for (const detector of DETECTORS) {
    if (!isDetectorEnabled(detector.name)) continue;
    collectMatches(text, detector.pattern, detector.name, hard);
  }

  if (SHIELDVAULT_SETTINGS.passwordGuard) {
    collectMatches(text, /(?:password|passwd|pwd)\s*[:=]\s*[^\s'"]{6,}/i, "Password-like string", hard);
  }

  if (SHIELDVAULT_SETTINGS.recoveryPhraseGuard) {
    collectMatches(text, /\b(?:recovery phrase|seed phrase|mnemonic phrase)\b/i, "Recovery phrase mention", hard);
  }

  if (SHIELDVAULT_SETTINGS.privateInfoGuard) {
    collectMatches(text, /\b\d{3}-\d{2}-\d{4}\b/, "Private personal info", hard);
    if (/\b(?:dob|date of birth)\b/i.test(text) && !hard.some((m) => m.name === "Private personal info")) {
      hard.push({ name: "Private personal info", value: null });
    }
    for (const card of creditCardMatches(text)) {
      hard.push({ name: "Credit card number", value: card });
    }
    // IBAN — checksum-validated so look-alike identifiers aren't redacted.
    for (const iban of ibanMatches(text)) {
      hard.push({ name: "IBAN / bank account", value: iban });
    }
  }

  if (SHIELDVAULT_SETTINGS.clientDataGuard && /\b(?:client data|customer data|confidential client|internal only)\b/i.test(text)) {
    hard.push({ name: "Client/customer data", value: null });
  }

  // --- SOFT signals: ordinary contact info that should not block by itself ---
  // Each has its OWN toggle so turning off email review does not weaken the
  // hard-block personal-info detectors (SSN, credit card) under privateInfoGuard.
  const soft = [];
  if (SHIELDVAULT_SETTINGS.emailReviewGuard &&
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text)) {
    soft.push({ name: "Email address", value: null });
  }
  if (SHIELDVAULT_SETTINGS.phoneReviewGuard &&
      /(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.test(text)) {
    soft.push({ name: "Phone number", value: null });
  }

  // When a provider-specific detector already caught the same item, drop the
  // redundant "Generic API key / secret" label. Overlap = the generic match's
  // value and a specific match's value contain each other (e.g. Azure's
  // "AZURE_OPENAI_API_KEY=..." contains the generic "API_KEY=..."). Truly generic
  // inputs (API_KEY=... with no branded match) keep the generic label.
  const specificValues = hard
    .filter((m) => m.value && m.name !== "Generic API key / secret")
    .map((m) => m.value);
  for (let i = hard.length - 1; i >= 0; i -= 1) {
    const m = hard[i];
    if (m.name === "Generic API key / secret" && m.value) {
      const overlaps = specificValues.some(
        (v) => v.includes(m.value) || m.value.includes(v)
      );
      if (overlaps) hard.splice(i, 1);
    }
  }

  // Large paste alone is just a big paste (code, logs, prose). It only becomes a
  // hard "sensitive" block when it travels with a real secret signal.
  if (SHIELDVAULT_SETTINGS.largePasteGuard && text.length > 1800) {
    if (hard.length > 0) {
      hard.push({ name: "Large sensitive paste", value: null });
    } else {
      soft.push({ name: "Large paste review", value: null });
    }
  }

  return [
    ...hard.map((m) => ({ name: m.name, value: m.value, soft: false })),
    ...soft.map((m) => ({ name: m.name, value: null, soft: true })),
  ];
}

function isDetectorEnabled(detectorName) {
  const name = String(detectorName || "").toLowerCase();
  if (name.includes("token") || name.includes("pat")) {
    return SHIELDVAULT_SETTINGS.tokenGuard;
  }
  return SHIELDVAULT_SETTINGS.secretGuard;
}

function detectBehaviors(text) {
  if (!text || typeof text !== "string") return [];
  if (!SHIELDVAULT_SETTINGS.reputationGuard && !SHIELDVAULT_SETTINGS.emotionalPostWarning) return [];

  const matches = [];
  for (const detector of BEHAVIORAL_DETECTORS) {
    const hit = typeof detector.test === "function"
      ? detector.test(text)
      : detector.pattern.test(text);
    if (hit && !matches.includes(detector.name)) {
      matches.push(detector.name);
    }
  }
  return matches;
}

function detectLateNightWarning(text, vector) {
  if (!text || typeof text !== "string") return false;
  if (!SHIELDVAULT_SETTINGS.lateNightPostAlert) return false;
  if (vector !== "submit") return false;
  if (text.trim().length < 20) return false;
  const hour = new Date().getHours();
  return hour >= 23 || hour < 5;
}

// ================================
// CORE ACTIONS
// ================================
const SHIELDVAULT_REDACTION = "[secret removed]";

// Replace only the matched secret substrings in the field, preserving the rest
// of the user's text. Recomputed from the live value each pass so framework
// re-renders (React/Lexical) that restore the original get re-redacted.
function redactField(el) {
  if (!el) return;
  const current = getValue(el);
  if (!current) return;
  const redactable = detectSecretMatches(current).filter((m) => m.value);
  if (!redactable.length) return;

  let redacted = current;
  for (const match of redactable) {
    redacted = redacted.split(match.value).join(SHIELDVAULT_REDACTION);
  }
  if (redacted !== current) setValue(el, redacted);
}

function hardRedact(el) {
  redactField(el);
  requestAnimationFrame(() => redactField(el));
  setTimeout(() => redactField(el), 50);
}

function fieldIdFor(el) {
  if (!el) return "none";
  if (!SHIELDVAULT_FIELD_IDS.has(el)) {
    SHIELDVAULT_FIELD_ID_SEQ += 1;
    SHIELDVAULT_FIELD_IDS.set(el, `${el.tagName || "FIELD"}:${SHIELDVAULT_FIELD_ID_SEQ}`);
  }
  return SHIELDVAULT_FIELD_IDS.get(el);
}

function contentHash(text) {
  const value = String(text || "");
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function cleanupExpiredBypasses() {
  const now = Date.now();
  for (let i = SHIELDVAULT_ACTIVE_BYPASSES.length - 1; i >= 0; i -= 1) {
    if (SHIELDVAULT_ACTIVE_BYPASSES[i].expiresAt <= now) {
      SHIELDVAULT_ACTIVE_BYPASSES.splice(i, 1);
    }
  }
}

function addScopedBypass(el, text) {
  cleanupExpiredBypasses();
  SHIELDVAULT_ACTIVE_BYPASSES.push({
    domain: location.hostname,
    fieldId: fieldIdFor(el),
    hash: contentHash(text),
    expiresAt: Date.now() + SHIELDVAULT_BYPASS_WINDOW_MS,
  });
}

function hasScopedBypass(el, text) {
  cleanupExpiredBypasses();
  const domain = location.hostname;
  const fieldId = fieldIdFor(el);
  const hash = contentHash(text);
  return SHIELDVAULT_ACTIVE_BYPASSES.some((bypass) => {
    return bypass.domain === domain && bypass.fieldId === fieldId && bypass.hash === hash;
  });
}

function currentSurfaceName() {
  const host = location.hostname.replace(/^www\./, "");
  if (host.includes("chatgpt") || host.includes("chat.openai")) return "ChatGPT";
  if (host.includes("claude")) return "Claude";
  if (host.includes("gemini") || host.includes("aistudio.google")) return "Google AI";
  if (host.includes("github")) return "GitHub";
  if (host.includes("gitlab")) return "GitLab";
  if (host.includes("slack")) return "Slack";
  if (host.includes("discord")) return "Discord";
  if (host.includes("gmail") || host.includes("mail.google")) return "Gmail";
  if (host.includes("outlook")) return "Outlook";
  if (host.includes("linkedin")) return "LinkedIn";
  if (host.includes("reddit")) return "Reddit";
  if (host === "x.com" || host.includes("twitter")) return "X";
  if (host.includes("notion")) return "Notion";
  if (host.includes("linear")) return "Linear";
  if (host.includes("atlassian")) return "Atlassian";
  if (host.includes("replit")) return "Replit";
  if (host.includes("codesandbox")) return "CodeSandbox";
  if (host.includes("stackblitz")) return "StackBlitz";
  return "this site";
}

function surfaceAccentColor() {
  const host = location.hostname;
  if (host.includes("github")) return "#0969da";
  if (host.includes("gitlab")) return "#fc6d26";
  if (host.includes("slack")) return "#611f69";
  if (host.includes("discord")) return "#5865f2";
  if (host.includes("chatgpt") || host.includes("chat.openai")) return "#10a37f";
  if (host.includes("gmail") || host.includes("mail.google")) return "#1a73e8";
  if (host.includes("linkedin")) return "#0a66c2";
  if (host.includes("notion")) return "#111827";
  if (host.includes("linear")) return "#5e6ad2";
  return "#4c6fff";
}

function blockedOutcome(detectorNames) {
  const detectors = Array.isArray(detectorNames) ? detectorNames.join(" ").toLowerCase() : "";
  if (detectors.includes("openai")) return "OpenAI API key protected";
  if (detectors.includes("anthropic")) return "Anthropic API key protected";
  if (
    detectors.includes("hugging face") ||
    detectors.includes("azure openai") ||
    detectors.includes("cohere") ||
    detectors.includes("mistral") ||
    detectors.includes("groq") ||
    detectors.includes("perplexity") ||
    detectors.includes("openrouter")
  ) {
    return "AI API key protected";
  }
  if (detectors.includes("github") && (detectors.includes("pat") || detectors.includes("token"))) {
    return "GitHub PAT protected";
  }
  if (detectors.includes("aws")) return "AWS credential protected";
  if (
    detectors.includes("vercel") ||
    detectors.includes("netlify") ||
    detectors.includes("cloudflare") ||
    detectors.includes("supabase") ||
    detectors.includes("firebase")
  ) {
    return "Cloud credential protected";
  }
  if (detectors.includes("slack") || detectors.includes("discord")) return "Chat token protected";
  if (
    detectors.includes("notion") ||
    detectors.includes("linear") ||
    detectors.includes("airtable") ||
    detectors.includes("shopify") ||
    detectors.includes("sentry") ||
    detectors.includes("posthog")
  ) {
    return "SaaS token protected";
  }
  if (detectors.includes("credit card") || detectors.includes("card number")) {
    return "Credit card number protected";
  }
  if (detectors.includes("password")) return "Password protected";
  if (detectors.includes("private personal info")) return "Private info protected";
  if (detectors.includes("large sensitive paste")) return "Code block protected";
  return "Secret protected";
}

// Map a SOFT-review detector to its own guard + a quick-toggle label. Quick
// one-click disable is offered ONLY for these low-risk review categories — never
// for hard-block secret categories (those point to Settings instead).
function softGuardForDetector(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("email")) return { key: "emailReviewGuard", label: "Don't warn me for email addresses" };
  if (n.includes("phone")) return { key: "phoneReviewGuard", label: "Don't warn me for phone numbers" };
  if (n.includes("large paste")) return { key: "largePasteGuard", label: "Don't warn me for large paste reviews" };
  return null;
}

// Distinct soft-review guard toggles for a set of detector names.
function softGuardsForDetectors(names) {
  const seen = new Map();
  for (const name of names || []) {
    const guard = softGuardForDetector(name);
    if (guard && !seen.has(guard.key)) seen.set(guard.key, guard);
  }
  return [...seen.values()];
}

// Turn a guard off (by category key, never by matched text). Persists to storage
// and updates live in-memory settings so it applies immediately. Reversible from
// Settings, which toggles the same key.
async function disableGuard(key) {
  const updated = { ...SHIELDVAULT_SETTINGS, [key]: false };
  SHIELDVAULT_SETTINGS = updated;
  try {
    await chrome.storage.local.set({ [SHIELDVAULT_SETTINGS_KEY]: updated });
  } catch (_) {
    // Storage failure — the in-memory update still applies for this session.
  }
}

// Ask the background worker to open the options page (content scripts can't call
// chrome.runtime.openOptionsPage directly).
function openShieldVaultSettings() {
  try {
    chrome.runtime.sendMessage({ type: "SHIELDVAULT_OPEN_SETTINGS" });
  } catch (_) {
    // Extension context may be invalidated; ignore.
  }
}

// Frosted "liquid glass" surface for the catch cards — opaque-leaning (~92%) so
// text stays legible on any page background. Falls back to a solid card for users
// who prefer reduced transparency / higher contrast (accessibility + low-end perf).
function svGlassStyles(solidBorder) {
  const reduce =
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(prefers-reduced-transparency: reduce)").matches ||
      window.matchMedia("(prefers-contrast: more)").matches);
  if (reduce) {
    return [
      "background:#fff",
      "border:1px solid " + solidBorder,
      "box-shadow:0 16px 40px rgba(15,23,42,0.24)",
    ];
  }
  return [
    "background:linear-gradient(135deg, rgba(255,255,255,0.93), rgba(244,247,255,0.86))",
    "backdrop-filter:blur(20px) saturate(180%)",
    "-webkit-backdrop-filter:blur(20px) saturate(180%)",
    "border:1px solid rgba(255,255,255,0.7)",
    "box-shadow:0 22px 55px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.95)",
  ];
}

function showBlockedOverlay(el, text, detectorNames, options) {
  const previous = document.getElementById("shieldvault-blocked-overlay");
  if (previous) previous.remove();

  // For paste/drop the secret was never inserted into the field (the event was
  // cancelled), so restoring `text` would clobber whatever the user already
  // had. In that case we only register the bypass and ask them to retry.
  const restoreOnAllow = !(options && options.restoreOnAllow === false);
  let blockedText = String(text || "");
  const expiresAt = Date.now() + SHIELDVAULT_BYPASS_WINDOW_MS;
  const accent = surfaceAccentColor();
  const surface = currentSurfaceName();
  const overlay = document.createElement("div");
  overlay.id = "shieldvault-blocked-overlay";
  overlay.setAttribute("role", "status");
  overlay.style.cssText = [
    "position:fixed",
    "right:18px",
    "bottom:18px",
    "width:min(340px,calc(100vw - 36px))",
    "z-index:2147483647",
    "padding:14px",
    "border-radius:10px",
    ...svGlassStyles(accent),
    "color:#111827",
    "font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    "font-size:13px",
    "line-height:1.35",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = blockedOutcome(detectorNames);
  title.style.cssText = `font-weight:700;margin-bottom:5px;font-size:14px;color:${accent}`;
  overlay.appendChild(title);

  const detail = document.createElement("div");
  detail.textContent = `ShieldVault redacted risky text from ${surface}. No secret content was stored.`;
  detail.style.cssText = "color:#374151;margin-bottom:8px";
  overlay.appendChild(detail);

  const detectorList = document.createElement("div");
  detectorList.textContent = Array.isArray(detectorNames) && detectorNames.length
    ? detectorNames.slice(0, 3).join(", ")
    : "Secret detector";
  detectorList.style.cssText = "color:#6b7280;font-size:12px;margin-bottom:7px";
  overlay.appendChild(detectorList);

  const scope = document.createElement("div");
  scope.textContent = restoreOnAllow
    ? "Undo is limited to this site, this field, and this exact content."
    : "Allow once, then retry the paste or drop within the window. Scoped to this site, field, and exact content.";
  scope.style.cssText = "color:#6b7280;font-size:12px;margin-bottom:12px";
  overlay.appendChild(scope);

  // Hard-block cards NEVER offer a one-click disable for a secret category —
  // turning off secret protection should be a deliberate act in Settings.
  const manageLink = document.createElement("button");
  manageLink.type = "button";
  manageLink.textContent = "Manage in Settings";
  manageLink.style.cssText = "background:none;border:none;color:#6b7280;font-size:12px;cursor:pointer;padding:0;margin-bottom:10px;text-decoration:underline";
  manageLink.addEventListener("click", () => openShieldVaultSettings());
  overlay.appendChild(manageLink);

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;justify-content:flex-end";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.style.cssText = [
    "padding:7px 10px",
    "border-radius:7px",
    "border:1px solid #d1d5db",
    "background:transparent",
    "color:#374151",
    "cursor:pointer",
  ].join(";");

  const allowOnce = document.createElement("button");
  allowOnce.type = "button";
  allowOnce.textContent = restoreOnAllow ? "Undo / allow once (45s)" : "Allow once (45s)";
  allowOnce.style.cssText = [
    "padding:7px 10px",
    "border-radius:7px",
    `border:1px solid ${accent}`,
    `background:${accent}`,
    "color:#fff",
    "cursor:pointer",
    "font-weight:600",
  ].join(";");

  dismiss.addEventListener("click", () => {
    blockedText = "";
    overlay.remove();
  });

  allowOnce.addEventListener("click", () => {
    if (!el || Date.now() > expiresAt || !blockedText) {
      allowOnce.disabled = true;
      allowOnce.textContent = "Expired";
      return;
    }
    addScopedBypass(el, blockedText);
    // Only re-insert when the field was redacted in place (typed/submit). For
    // paste/drop, registering the bypass is enough — the user retries the action.
    if (restoreOnAllow) setValue(el, blockedText);
    el.focus();
    blockedText = "";
    overlay.remove();
  });

  const countdown = setInterval(() => {
    if (!document.body.contains(overlay)) {
      clearInterval(countdown);
      return;
    }
    const remaining = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    if (remaining > 0) {
      allowOnce.textContent = restoreOnAllow
        ? `Undo / allow once (${remaining}s)`
        : `Allow once (${remaining}s)`;
    }
  }, 1000);

  setTimeout(() => {
    blockedText = "";
    clearInterval(countdown);
    if (!document.body.contains(overlay)) return;
    allowOnce.disabled = true;
    allowOnce.textContent = "Expired";
    allowOnce.style.opacity = "0.65";
    allowOnce.style.cursor = "not-allowed";
  }, SHIELDVAULT_BYPASS_WINDOW_MS);

  actions.appendChild(dismiss);
  actions.appendChild(allowOnce);
  overlay.appendChild(actions);
  document.body.appendChild(overlay);
}

// Calm, non-blocking review card for SOFT categories (email / phone / large
// harmless paste). The message is NOT blocked — this only offers a one-click
// "don't warn me for this" toggle per category. Shown at most once per category
// per page load. No matched text is ever shown or stored — categories only.
function showReviewCard(detectorNames) {
  const toggles = softGuardsForDetectors(detectorNames).filter(
    (g) => !SHIELDVAULT_REVIEW_SHOWN.has(g.key)
  );
  if (!toggles.length) return;
  toggles.forEach((g) => SHIELDVAULT_REVIEW_SHOWN.add(g.key));

  const existing = document.getElementById("shieldvault-review-card");
  if (existing) existing.remove();

  const accent = surfaceAccentColor();
  const noticed = detectorNames
    .filter((n) => softGuardForDetector(n))
    .join(", ") || "content";

  const card = document.createElement("div");
  card.id = "shieldvault-review-card";
  card.setAttribute("role", "status");
  card.style.cssText = [
    "position:fixed", "right:18px", "bottom:18px",
    "width:min(320px,calc(100vw - 36px))", "z-index:2147483647",
    "padding:12px 14px", "border-radius:10px",
    ...svGlassStyles("#d1d5db"),
    "color:#111827", "font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif",
    "font-size:13px", "line-height:1.35",
  ].join(";");

  const title = document.createElement("div");
  title.textContent = noticed + " noticed — not blocked";
  title.style.cssText = `font-weight:600;margin-bottom:4px;color:${accent}`;
  card.appendChild(title);

  const detail = document.createElement("div");
  detail.textContent = "Your message was allowed. Nothing was stored.";
  detail.style.cssText = "color:#6b7280;font-size:12px;margin-bottom:10px";
  card.appendChild(detail);

  for (const guard of toggles) {
    const off = document.createElement("button");
    off.type = "button";
    off.textContent = guard.label;
    off.style.cssText = [
      "display:block", "width:100%", "text-align:left", "margin-bottom:6px",
      "padding:6px 8px", "border-radius:6px", "border:1px dashed #d1d5db",
      "background:transparent", "color:#374151", "cursor:pointer", "font-size:12px",
    ].join(";");
    off.addEventListener("click", async () => {
      await disableGuard(guard.key);
      off.textContent = "Turned off — reversible in Settings";
      off.disabled = true;
      off.style.color = "#6b7280";
      off.style.cursor = "default";
    });
    card.appendChild(off);
  }

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.textContent = "Dismiss";
  dismiss.style.cssText = "background:none;border:none;color:#6b7280;font-size:12px;cursor:pointer;padding:0;text-decoration:underline";
  dismiss.addEventListener("click", () => card.remove());
  card.appendChild(dismiss);

  document.body.appendChild(card);
  setTimeout(() => {
    if (document.body.contains(card)) card.remove();
  }, 9000);
}

// Short, local block chime (Plus, opt-in). Synthesized with Web Audio so there's
// no audio asset and nothing is fetched. Best-effort — silently no-ops if the
// audio context can't start (e.g. no prior user gesture).
function playBlockSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.setValueAtTime(440, ctx.currentTime + 0.09);
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.24);
    osc.onended = () => {
      try { ctx.close(); } catch (_) {}
    };
  } catch (_) {
    // Autoplay blocked or Web Audio unavailable — stay silent.
  }
}

function notifyBackground(detectorNames, vector, category) {
  try {
    chrome.runtime.sendMessage({
      type: "SHIELDVAULT_PREVENTED",
      detectors: detectorNames,
      vector: vector,
      category: category || "secret"
    });
  } catch (e) {
    // Extension context may be invalidated, ignore silently
  }
}

function showBehavioralModal(text, el, warnings, warningTypes) {
  // Avoid stacking duplicate modals
  if (document.getElementById("shieldvault-behavioral-modal")) return;

  // Freeze the input so the text stays visible but the user can't type more.
  // `readonly` only works on INPUT/TEXTAREA — contenteditable composers
  // (ChatGPT, X, Discord) ignore it, so those are frozen via contentEditable.
  const wasContentEditable = Boolean(el && el.isContentEditable);
  if (el) {
    if (wasContentEditable) {
      el.contentEditable = "false";
    } else {
      el.setAttribute("readonly", "true");
    }
  }
  function unfreezeField() {
    if (!el) return;
    if (wasContentEditable) {
      el.contentEditable = "true";
    } else {
      el.removeAttribute("readonly");
    }
  }

  const accent = surfaceAccentColor();
  const surface = currentSurfaceName();
  const modal = document.createElement("div");
  modal.id = "shieldvault-behavioral-modal";
  modal.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "border-radius:10px",
    ...svGlassStyles(accent),
    "color:#111827",
    "padding:20px 22px",
    "max-width:420px",
    "width:90vw",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "font-size:14px",
    "line-height:1.5",
  ].join(";");

  modal.innerHTML = `
    <div id="sv-behavior-title" style="font-size:17px;font-weight:700;margin-bottom:8px">ShieldVault - Regret Check</div>
    <p style="margin:0 0 10px;color:#374151">A local tone check noticed this before it leaves ${surface}:</p>
    <ul id="sv-warning-list" style="margin:0 0 14px;padding-left:18px;color:#92400e"></ul>
    <p style="margin:0 0 16px;color:#6b7280;font-size:13px">Your message content is not stored. Edit now, or allow this exact message once and submit again within 5 seconds.</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="sv-disable-btn" style="padding:8px 12px;border-radius:7px;border:1px solid #d1d5db;background:transparent;color:#374151;cursor:pointer;font-size:13px">Turn off</button>
      <button id="sv-edit-btn" style="padding:8px 14px;border-radius:7px;border:1px solid #d1d5db;background:transparent;color:#111827;cursor:pointer;font-size:14px">Edit message</button>
      <button id="sv-send-btn" style="padding:8px 14px;border-radius:7px;border:none;color:#fff;cursor:pointer;font-size:14px;font-weight:600">Allow once</button>
    </div>
  `;

  document.body.appendChild(modal);

  const title = modal.querySelector("#sv-behavior-title");
  if (title) title.style.color = accent;
  const sendBtn = modal.querySelector("#sv-send-btn");
  if (sendBtn) sendBtn.style.background = accent;

  const ul = modal.querySelector("#sv-warning-list");
  let maxSeverity = "low";
  for (const w of warnings) {
    const meta = behavioralMeta(w);
    if (SHIELDVAULT_SEVERITY_RANK[meta.severity] > SHIELDVAULT_SEVERITY_RANK[maxSeverity]) {
      maxSeverity = meta.severity;
    }
    const li = document.createElement("li");
    li.style.margin = "6px 0";
    const label = document.createElement("div");
    label.textContent = w;
    label.style.cssText = "font-weight:600;color:#92400e";
    li.appendChild(label);
    if (meta.suggestion) {
      // Local rephrasing suggestion — deterministic, on-device.
      const tip = document.createElement("div");
      tip.textContent = "Try: " + meta.suggestion;
      tip.style.cssText = "color:#4b5563;font-size:12px;margin-top:2px";
      li.appendChild(tip);
    }
    ul.appendChild(li);
  }

  // Context-aware cooldown: the calmer you're being asked to be, the longer the
  // "allow once" button stays disabled so there's a real beat before sending.
  const cooldownMs = { low: 2000, medium: 4000, high: 8000 }[maxSeverity] || 2000;

  if (sendBtn) {
    const allowLabel = sendBtn.textContent;
    sendBtn.disabled = true;
    sendBtn.style.opacity = "0.55";
    sendBtn.style.cursor = "not-allowed";
    const cooldownEnd = Date.now() + cooldownMs;
    const tick = setInterval(() => {
      const remaining = Math.ceil((cooldownEnd - Date.now()) / 1000);
      if (remaining > 0 && document.body.contains(modal)) {
        sendBtn.textContent = "Wait " + remaining + "s";
      } else {
        clearInterval(tick);
        if (document.body.contains(modal)) {
          sendBtn.textContent = allowLabel;
          sendBtn.disabled = false;
          sendBtn.style.opacity = "1";
          sendBtn.style.cursor = "pointer";
        }
      }
    }, 250);
  }

  function closeToEdit() {
    modal.remove();
    document.removeEventListener("keydown", onEscape, true);
    unfreezeField();
    if (el) el.focus();
  }

  // Escape = "let me edit" — the calmest exit should also be the fastest.
  function onEscape(e) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeToEdit();
  }
  document.addEventListener("keydown", onEscape, true);

  document.getElementById("sv-edit-btn").addEventListener("click", closeToEdit);

  document.getElementById("sv-send-btn").addEventListener("click", () => {
    modal.remove();
    document.removeEventListener("keydown", onEscape, true);
    unfreezeField();
    if (el) {
      el.dataset.shieldvaultBypass = "true";
      setTimeout(() => {
        delete el.dataset.shieldvaultBypass;
      }, 5000);
      el.focus();
    }
  });

  const disableType = Array.isArray(warningTypes) && warningTypes.includes("lateNight")
    ? "lateNight"
    : "emotional";
  document.getElementById("sv-disable-btn").addEventListener("click", async () => {
    await disableSubjectiveWarning(disableType);
    closeToEdit();
  });
}

// ================================
// BLOCKING LOGIC
// ================================
function handleDetection(text, el, vector, event) {
  // Respect per-site pause — ShieldVault stays fully silent on paused domains.
  if (SHIELDVAULT_PAUSED) return false;

  const allMatches = detectSecretMatches(text);
  const hardMatches = allMatches.filter((m) => !m.soft);
  const softMatches = allMatches.filter((m) => m.soft);

  // --- Hard block: secrets and clearly sensitive data ---
  if (hardMatches.length > 0) {
    if (el && hasScopedBypass(el, text)) return false;

    const redactable = hardMatches.filter((m) => m.value);
    const hasEvent = event && typeof event.preventDefault === "function";

    // On the passive input fallback (no event to cancel) there is nothing to do
    // for signal-only matches — don't nag without an actionable block.
    if (!hasEvent && redactable.length === 0) return false;

    if (hasEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const names = [...new Set(hardMatches.map((m) => m.name))];

    if (el) {
      // Clear any active bypass before hard-blocking
      delete el.dataset.shieldvaultBypass;
      if (redactable.length) hardRedact(el);
      // paste/drop were cancelled before insertion, so allow-once must not
      // restore the fragment over the user's existing field content.
      showBlockedOverlay(el, text, names, {
        restoreOnAllow: vector !== "drop" && vector !== "paste",
      });
    }

    // Sound on block — Plus, opt-in, off by default.
    if (USER_TIER === "plus" && SHIELDVAULT_SETTINGS.soundOnBlock) {
      playBlockSound();
    }

    notifyBackground(names, vector, "secret");
    devWarn(`Blocked: ${names.join(", ")} via ${vector}`);
    return true;
  }

  // --- Soft review: ordinary email/phone or a large harmless paste ---
  // Never blocked — the user proceeds normally. We only log a metadata-only
  // review event (detector names only, never the email/phone text), and only on
  // an actionable surface so the input-fallback can't spam it per keystroke.
  if (softMatches.length > 0) {
    const hasEvent = event && typeof event.preventDefault === "function";
    if (hasEvent) {
      const names = [...new Set(softMatches.map((m) => m.name))];
      notifyBackground(names, vector, "review");
      showReviewCard(names);
      devWarn(`Soft review (allowed): ${names.join(", ")} via ${vector}`);
    }
    // fall through — do not block; still allow the behavioral check below
  }

  // --- Soft block: behavioral ---
  if (el && el.dataset.shieldvaultBypass === "true") return false;

  const warnings = [];
  const warningTypes = [];
  const behaviorMatches = detectBehaviors(text);
  if (behaviorMatches.length > 0) {
    warnings.push(...behaviorMatches);
    warningTypes.push("emotional");
  }
  if (detectLateNightWarning(text, vector)) {
    warnings.push("Late-night posting check");
    warningTypes.push("lateNight");
  }

  if (warnings.length > 0) {
    // The behavioral modal — the only way to review or allow the message — is a
    // Plus feature. For non-Plus users we must NOT cancel the submit, or their
    // Enter key would be swallowed with no modal and no way through (soft-lock).
    // Log it for their activity history and let the message go.
    if (USER_TIER !== "plus") {
      // Message is allowed to send, so don't record it as a prevented event —
      // on the input-fallback path that would also spam history/badge on every
      // keystroke. Just log locally for development.
      devWarn(`Behavioral warning (log only, non-Plus): ${warnings.join(", ")} via ${vector}`);
      return false;
    }

    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    showBehavioralModal(text, el, warnings, warningTypes);
    notifyBackground(warnings, vector, "behavioral");
    devWarn(`Behavioral warning: ${warnings.join(", ")} via ${vector}`);
    return true;
  }

  return false;
}

// ================================
// EVENT HOOKS
// ================================

// BEFOREINPUT — earliest possible interception
document.addEventListener(
  "beforeinput",
  (e) => {
    const incoming = typeof e.data === "string" ? e.data : "";
    if (!incoming) return;

    const el = getActiveEditable();
    handleDetection(incoming, el, "typed", e);
  },
  true
);

// PASTE — clipboard interception
document.addEventListener(
  "paste",
  (e) => {
    const pasted =
      (e.clipboardData || window.clipboardData)?.getData("text") || "";
    if (!pasted) return;

    const el = getActiveEditable();
    handleDetection(pasted, el, "paste", e);
  },
  true
);

// DROP — dragged-in text bypasses paste, so intercept it here too
document.addEventListener(
  "drop",
  (e) => {
    const dropped = e.dataTransfer ? e.dataTransfer.getData("text") : "";
    if (!dropped) return;

    const el = resolveEditable(e.target) || getActiveEditable();
    handleDetection(dropped, el, "drop", e);
  },
  true
);

// KEYDOWN (Enter) — last-chance guardrail before submit
document.addEventListener(
  "keydown",
  (e) => {
    // Shift+Enter is "newline" in every chat UI, not "send" — swallowing it
    // would trap the user. Real submits still hit the plain-Enter path, and
    // any secret in the field is already redacted by the input fallback.
    if (e.key !== "Enter" || e.shiftKey) return;

    const el = getActiveEditable();
    if (!el) return;

    const value = getValue(el);
    if (!value) return;

    handleDetection(value, el, "submit", e);
  },
  true
);

// INPUT — fallback for anything that slipped through
document.addEventListener(
  "input",
  (e) => {
    const el = resolveEditable(e.target);
    if (!el) return;

    if (
      el.tagName !== "INPUT" &&
      el.tagName !== "TEXTAREA" &&
      !el.isContentEditable &&
      el.getAttribute("role") !== "textbox"
    ) {
      return;
    }

    const value = getValue(el);
    if (!value) return;

    // No event to cancel here — handleDetection redacts secrets and (on Plus)
    // surfaces the behavioral modal, sharing one code path with the other hooks.
    handleDetection(value, el, "input-fallback", null);
  },
  true
);

// ================================
// INIT
// ================================
devLog("Content script loaded —", DETECTORS.length, "detectors active,", BEHAVIORAL_DETECTORS.length, "behavioral detectors active");
loadShieldVaultSettings();
refreshPausedState();
