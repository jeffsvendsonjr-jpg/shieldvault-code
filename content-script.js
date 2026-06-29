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
};
let SHIELDVAULT_SETTINGS = { ...SHIELDVAULT_DEFAULT_SETTINGS };

// ================================
// TIER — read from storage; default to basic
// ================================
let USER_TIER = "basic";
chrome.storage.local.get(["shieldvault_tier"], (result) => {
  USER_TIER = result.shieldvault_tier || "basic";
});

const SHIELDVAULT_BYPASS_WINDOW_MS = 45000;
const SHIELDVAULT_ACTIVE_BYPASSES = [];
const SHIELDVAULT_FIELD_IDS = new WeakMap();
let SHIELDVAULT_FIELD_ID_SEQ = 0;

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
  if (changes.shieldvault_tier) {
    USER_TIER = changes.shieldvault_tier.newValue || "basic";
  }
  if (changes[SHIELDVAULT_PAUSED_DOMAINS_KEY]) {
    SHIELDVAULT_PAUSED = isHostPaused(changes[SHIELDVAULT_PAUSED_DOMAINS_KEY].newValue);
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
const DETECTORS = [
  // OpenAI
  { name: "OpenAI API Key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },

  // AI providers and model platforms
  { name: "Anthropic API Key", pattern: /sk-ant-api[0-9]{2}-[A-Za-z0-9_-]{40,}/ },
  { name: "Hugging Face Token", pattern: /hf_[A-Za-z0-9]{30,}/ },
  { name: "Azure OpenAI Key", pattern: /(?:azure[_\s-]*openai|api[-_\s]?key)[^\n\r]{0,80}['"]?[A-Za-z0-9]{32}['"]?/i },
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
const BEHAVIORAL_DETECTORS = [
  { name: "Shouting (all-caps)", test: isMostlyCaps },
  { name: "Aggressive Punctuation", pattern: /[!]{4,}|\?[!]{2,}/ },
  { name: "Passive Aggressive", pattern: /per my last email|for future reference|with all due respect/i },
  { name: "Hostile Opener", pattern: /^(you people|what the hell|are you serious|this is ridiculous|i can't believe you)/i },
  { name: "Dismissive / Condescending", pattern: /clearly you don't understand|obviously you haven't|do i really need to explain/i },
  { name: "Rage-quit threat", pattern: /i('m| am) done with (this|you)[^a-z]|i quit[^a-z]|screw this/i },
  { name: "Insult / name-calling", pattern: /\b(idiot|moron|incompetent|pathetic|useless)\b/i },
  { name: "Threatening escalation", pattern: /\b(i'?ll report you|i will report you|you'?ll regret|this will be escalated)\b/i },
];

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

// Returns [{ name, value }]. value is the matched substring to redact, or null
// for signal-only matches (large paste, client-data keyword) that have no single
// token to remove. Each guard is independent — there is no master switch.
function detectSecretMatches(text) {
  if (!text || typeof text !== "string") return [];

  const matches = [];
  for (const detector of DETECTORS) {
    if (!isDetectorEnabled(detector.name)) continue;
    collectMatches(text, detector.pattern, detector.name, matches);
  }

  if (SHIELDVAULT_SETTINGS.passwordGuard) {
    collectMatches(text, /(?:password|passwd|pwd)\s*[:=]\s*[^\s'"]{6,}/i, "Password-like string", matches);
  }

  if (SHIELDVAULT_SETTINGS.recoveryPhraseGuard) {
    collectMatches(text, /\b(?:recovery phrase|seed phrase|mnemonic phrase)\b/i, "Recovery phrase mention", matches);
  }

  if (SHIELDVAULT_SETTINGS.privateInfoGuard) {
    collectMatches(text, /\b\d{3}-\d{2}-\d{4}\b/, "Private personal info", matches);
    if (/\b(?:dob|date of birth)\b/i.test(text) && !matches.some((m) => m.name === "Private personal info")) {
      matches.push({ name: "Private personal info", value: null });
    }
    for (const card of creditCardMatches(text)) {
      matches.push({ name: "Credit card number", value: card });
    }
    // Email addresses.
    collectMatches(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, "Email address", matches);
    // Phone numbers — require separators or a country prefix so bare digit runs
    // (IDs, order numbers) don't trip it.
    collectMatches(text, /(?:\+?\d{1,3}[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/, "Phone number", matches);
    // IBAN — two-letter country code, two check digits, then the account body.
    collectMatches(text, /\b[A-Z]{2}\d{2}[A-Za-z0-9]{11,30}\b/, "IBAN / bank account", matches);
  }

  if (SHIELDVAULT_SETTINGS.clientDataGuard && /\b(?:client data|customer data|confidential client|internal only)\b/i.test(text)) {
    matches.push({ name: "Client/customer data", value: null });
  }

  if (SHIELDVAULT_SETTINGS.largePasteGuard && text.length > 1800) {
    matches.push({ name: "Large sensitive paste", value: null });
  }
  return matches;
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

function showBlockedOverlay(el, text, detectorNames) {
  const previous = document.getElementById("shieldvault-blocked-overlay");
  if (previous) previous.remove();

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
    "background:#fff",
    `border:1px solid ${accent}`,
    "box-shadow:0 14px 34px rgba(15,23,42,0.22)",
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
  scope.textContent = "Undo is limited to this site, this field, and this exact content.";
  scope.style.cssText = "color:#6b7280;font-size:12px;margin-bottom:12px";
  overlay.appendChild(scope);

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
  allowOnce.textContent = "Undo / allow once (45s)";
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
    setValue(el, blockedText);
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
      allowOnce.textContent = `Undo / allow once (${remaining}s)`;
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

  // Freeze the input so the text stays visible but the user can't type more
  if (el) el.setAttribute("readonly", "true");

  const accent = surfaceAccentColor();
  const surface = currentSurfaceName();
  const modal = document.createElement("div");
  modal.id = "shieldvault-behavioral-modal";
  modal.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "background:#fff",
    `border:1px solid ${accent}`,
    "border-radius:10px",
    "box-shadow:0 18px 42px rgba(15,23,42,0.24)",
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
  for (const w of warnings) {
    const li = document.createElement("li");
    li.style.margin = "4px 0";
    li.textContent = w;
    ul.appendChild(li);
  }

  document.getElementById("sv-edit-btn").addEventListener("click", () => {
    modal.remove();
    if (el) {
      el.removeAttribute("readonly");
      el.focus();
    }
  });

  document.getElementById("sv-send-btn").addEventListener("click", () => {
    modal.remove();
    if (el) {
      el.removeAttribute("readonly");
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
    modal.remove();
    if (el) {
      el.removeAttribute("readonly");
      el.focus();
    }
  });
}

// ================================
// BLOCKING LOGIC
// ================================
function handleDetection(text, el, vector, event) {
  // Respect per-site pause — ShieldVault stays fully silent on paused domains.
  if (SHIELDVAULT_PAUSED) return false;

  // --- Hard block: secrets ---
  const secretMatches = detectSecretMatches(text);
  if (secretMatches.length > 0) {
    if (el && hasScopedBypass(el, text)) return false;

    const redactable = secretMatches.filter((m) => m.value);
    const hasEvent = event && typeof event.preventDefault === "function";

    // On the passive input fallback (no event to cancel) there is nothing to do
    // for signal-only matches — don't nag without an actionable block.
    if (!hasEvent && redactable.length === 0) return false;

    if (hasEvent) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    const names = [...new Set(secretMatches.map((m) => m.name))];

    if (el) {
      // Clear any active bypass before hard-blocking
      delete el.dataset.shieldvaultBypass;
      if (redactable.length) hardRedact(el);
      showBlockedOverlay(el, text, names);
    }

    notifyBackground(names, vector, "secret");
    devWarn(`Blocked: ${names.join(", ")} via ${vector}`);
    return true;
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
      notifyBackground(warnings, vector, "behavioral");
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
    if (e.key !== "Enter") return;

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
