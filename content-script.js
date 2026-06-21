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
  creditCardGuard: true,
  phoneGuard: true,
  bankAccountGuard: true,
  reputationGuard: false,
  lateNightPostAlert: false,
  emotionalPostWarning: false,
};
let SHIELDVAULT_SETTINGS = { ...SHIELDVAULT_DEFAULT_SETTINGS };

// ================================
// TIER (assumed plus for behavioral modal)
// ================================
const USER_TIER = "plus";

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
  // reputationGuard is now independently controlled — don't touch it here
  SHIELDVAULT_SETTINGS = updated;
  try {
    await chrome.storage.local.set({ [SHIELDVAULT_SETTINGS_KEY]: updated });
  } catch (_) {
    // Ignore storage failures in content script.
  }
}

// ================================
// PATTERN LIBRARY (46 detectors)
// ================================
const DETECTORS = [
  // OpenAI
  { name: "OpenAI API Key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  
  // AWS
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS Secret Access Key", pattern: /(?<![A-Za-z0-9\/+=])[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/ },
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
  { name: "Stripe Live Publishable", pattern: /pk_live_[A-Za-z0-9]{24,}/ },
  { name: "Stripe Test Publishable", pattern: /pk_test_[A-Za-z0-9]{24,}/ },
  { name: "Stripe Restricted Key", pattern: /rk_live_[A-Za-z0-9]{24,}/ },
  { name: "Stripe Webhook Secret", pattern: /whsec_[A-Za-z0-9]{32,}/ },
  
  // Google
  { name: "Google API Key", pattern: /AIza[A-Za-z0-9_-]{35}/ },
  { name: "Google OAuth ID", pattern: /[0-9]+-[A-Za-z0-9_]{32}\.apps\.googleusercontent\.com/ },
  
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
  { name: "Twilio API Key", pattern: /SK[A-Za-z0-9]{32}/ },
  { name: "Twilio Account SID", pattern: /AC[A-Za-z0-9]{32}/ },
  
  // SendGrid
  { name: "SendGrid API Key", pattern: /SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/ },
  
  // Mailchimp
  { name: "Mailchimp API Key", pattern: /[A-Za-z0-9]{32}-us[0-9]{1,2}/ },
  
  // Heroku
  { name: "Heroku API Key", pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ },
  
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

  // Anthropic / Claude
  { name: "Anthropic API Key", pattern: /sk-ant-api03-[A-Za-z0-9_-]{93}/ },

  // HuggingFace
  { name: "HuggingFace Token", pattern: /hf_[A-Za-z0-9]{34,}/ },

  // Azure
  { name: "Azure Storage Connection", pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+\/=]{44,}/ },

  // Shopify
  { name: "Shopify Admin Token", pattern: /shpat_[A-Za-z0-9]{32}/ },
  { name: "Shopify Custom App Token", pattern: /shpca_[A-Za-z0-9]{32}/ },
  { name: "Shopify Shared Secret", pattern: /shpss_[A-Za-z0-9]{32}/ },

  // HashiCorp Vault
  { name: "HashiCorp Vault Token", pattern: /hvs\.[A-Za-z0-9]{24,}/ },
];

// ================================
// HIGH-RISK PASTE DOMAINS (reputationGuard)
// ================================
const HIGH_RISK_PASTE_DOMAINS = [
  'pastebin.com', 'hastebin.com', 'paste.ee', 'ghostbin.com',
  'rentry.co', 'dpaste.com', 'pasteio.com', 'paste.ubuntu.com',
];

function isHighRiskDomain() {
  if (!SHIELDVAULT_SETTINGS.reputationGuard) return false;
  const hostname = window.location.hostname.replace(/^www\./, '');
  return HIGH_RISK_PASTE_DOMAINS.includes(hostname);
}

// ================================
// BEHAVIORAL PATTERN LIBRARY
// ================================
const BEHAVIORAL_DETECTORS = [
  { name: "Shouting (all-caps)", pattern: /^[A-Z\s]{15,}$/ },
  { name: "Aggressive Punctuation", pattern: /[!]{4,}|\?[!]{2,}/ },
  { name: "Passive Aggressive", pattern: /per my last email|for future reference|with all due respect/i },
  { name: "Hostile Opener", pattern: /^(you people|what the hell|are you serious|this is ridiculous|i can't believe you)/i },
  { name: "Dismissive / Condescending", pattern: /clearly you don't understand|obviously you haven't|do i really need to explain/i },
  { name: "Rage-quit threat", pattern: /i('m| am) done with (this|you)[^a-z]|i quit[^a-z]|screw this/i },
];

// ================================
// HELPERS
// ================================
function getActiveEditable() {
  const el = document.activeElement;
  if (!el) return null;

  if (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.isContentEditable
  ) {
    return el;
  }

  return null;
}

function getValue(el) {
  if (!el) return "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return el.value || "";
  }
  if (el.isContentEditable) {
    return el.innerText || "";
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
    
  } else if (el.isContentEditable) {
    el.innerHTML = "";
    el.textContent = value;
    
    el.dispatchEvent(new InputEvent("input", { 
      bubbles: true, 
      cancelable: true,
      inputType: "deleteContentBackward"
    }));
  }
}

// ================================
// DETECTION
// ================================
function detectSecrets(text) {
  if (!text || typeof text !== "string") return [];
  if (!SHIELDVAULT_SETTINGS.secretGuard) return [];

  const matches = [];
  for (const detector of DETECTORS) {
    if (!isDetectorEnabled(detector.name)) continue;
    if (detector.pattern.test(text)) {
      matches.push(detector.name);
    }
  }

  if (SHIELDVAULT_SETTINGS.passwordGuard && /(?:password|passwd|pwd)\s*[:=]\s*[^\s'"]{6,}/i.test(text)) {
    matches.push("Password-like string");
  }

  if (SHIELDVAULT_SETTINGS.recoveryPhraseGuard && /\b(?:recovery phrase|seed phrase|mnemonic phrase)\b/i.test(text)) {
    matches.push("Recovery phrase mention");
  }

  if (SHIELDVAULT_SETTINGS.privateInfoGuard && (/\b\d{3}-\d{2}-\d{4}\b/.test(text) || /\b(?:dob|date of birth)\b/i.test(text))) {
    matches.push("Private personal info");
  }

  if (SHIELDVAULT_SETTINGS.clientDataGuard && /\b(?:client data|customer data|confidential client|internal only)\b/i.test(text)) {
    matches.push("Client/customer data");
  }

  if (SHIELDVAULT_SETTINGS.largePasteGuard && text.length > 1800) {
    matches.push("Large sensitive paste");
  }

  if (SHIELDVAULT_SETTINGS.creditCardGuard && /\b(?:4[0-9]{3}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|5[1-5][0-9]{2}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}|3[47][0-9]{2}[\s\-]?[0-9]{6}[\s\-]?[0-9]{5}|6(?:011|5[0-9]{2})[\s\-]?[0-9]{4}[\s\-]?[0-9]{4}[\s\-]?[0-9]{4})\b/.test(text)) {
    matches.push("Credit card number");
  }

  if (SHIELDVAULT_SETTINGS.phoneGuard && /(?:\+?1[\s.\-]?)?(?:\([0-9]{3}\)|[0-9]{3})[\s.\-]?[0-9]{3}[\s.\-]?[0-9]{4}/.test(text)) {
    matches.push("Phone number");
  }

  if (SHIELDVAULT_SETTINGS.bankAccountGuard && (
    /(?:routing|aba|transit)\s*(?:number|#|no\.?)?\s*:?\s*\b[0-9]{9}\b/i.test(text) ||
    /account\s*(?:number|#|no\.?)?\s*:?\s*\b[0-9]{10,17}\b/i.test(text)
  )) {
    matches.push("Bank account info");
  }

  return matches;
}

function isDetectorEnabled(detectorName) {
  const name = String(detectorName || "").toLowerCase();
  if (name.includes("token") || name.includes("pat")) {
    return SHIELDVAULT_SETTINGS.tokenGuard;
  }
  // New AI/cloud/infra tokens also fall under secretGuard
  return SHIELDVAULT_SETTINGS.secretGuard;
}
}

// ================================
// BEHAVIORAL DETECTION
// ================================
const BEHAVIORAL_PATTERNS = [
  { name: "All Caps", pattern: /\b[A-Z]{4,}\b/ },
  { name: "Per My Last Email", pattern: /per my last email/i },
  { name: "Multiple Exclamation Marks", pattern: /!{2,}/ },
];

function detectBehaviors(text) {
  if (!text || typeof text !== "string") return [];
  if (!SHIELDVAULT_SETTINGS.reputationGuard && !SHIELDVAULT_SETTINGS.emotionalPostWarning) return [];

  const matches = [];
  for (const bp of BEHAVIORAL_PATTERNS) {
    if (bp.pattern.test(text)) {
      matches.push(bp.name);
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
function hardNullify(el) {
  setValue(el, "");
  
  requestAnimationFrame(() => {
    setValue(el, "");
  });
  
  setTimeout(() => {
    const current = getValue(el);
    if (current && detectSecrets(current).length > 0) {
      setValue(el, "");
    }
  }, 50);
}

function showBlockOverlay(el, blockedText, detectorNames) {
  // Remove any existing overlay
  const existing = document.getElementById("sv-block-overlay");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "sv-block-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "top:16px",
    "right:16px",
    "max-width:320px",
    "background:rgba(15,18,28,0.97)",
    "border:1px solid rgba(76,111,255,0.45)",
    "border-radius:10px",
    "box-shadow:0 8px 24px rgba(0,0,0,0.5)",
    "padding:12px 14px",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "font-size:13px",
    "color:#e6e8ee",
    "line-height:1.4",
    "transition:opacity 0.4s ease",
    "opacity:1",
  ].join(";");

  const label = detectorNames && detectorNames.length
    ? detectorNames.slice(0, 3).join(", ") + (detectorNames.length > 3 ? " …" : "")
    : "Secret detected";

  overlay.innerHTML =
    '<div style="display:flex;align-items:flex-start;gap:10px">' +
      '<span style="font-size:18px;line-height:1">🛡</span>' +
      '<div style="flex:1">' +
        '<div style="font-weight:700;margin-bottom:3px">Blocked</div>' +
        '<div style="font-size:11px;color:#8a8f9c;margin-bottom:10px">' +
          escHtml(label) +
        '</div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
          '<button id="sv-undo-btn" style="padding:5px 10px;font-size:11px;border-radius:6px;' +
            'border:1px solid rgba(255,255,255,0.15);background:transparent;' +
            'color:#8a8f9c;cursor:pointer;font-family:system-ui,sans-serif">Undo (allow once)</button>' +
          '<button id="sv-dismiss-btn" style="padding:5px 10px;font-size:11px;border-radius:6px;' +
            'border:none;background:#4c6fff;color:#fff;cursor:pointer;font-family:system-ui,sans-serif">OK</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  function dismiss() {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  }

  const timer = setTimeout(dismiss, 7000);

  overlay.querySelector("#sv-dismiss-btn").addEventListener("click", function () {
    clearTimeout(timer);
    dismiss();
  });

  overlay.querySelector("#sv-undo-btn").addEventListener("click", function () {
    clearTimeout(timer);
    dismiss();
    if (el && blockedText) {
      // Mark as user-approved bypass before restoring
      el.dataset.shieldvaultBypass = "true";
      setValue(el, blockedText);
      setTimeout(function () { delete el.dataset.shieldvaultBypass; }, 15000);
      el.focus();
    }
  });
}

// Keep liftAndFadeGhost as a no-op alias (called from hardNullify path)
function liftAndFadeGhost(el, text, detectorNames) {
  showBlockOverlay(el, text, detectorNames);
}

function notifyBackground(detectorNames, vector) {
  try {
    chrome.runtime.sendMessage({
      type: "SHIELDVAULT_PREVENTED",
      detectors: detectorNames,
      vector: vector,
      domain: window.location.hostname,
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

  const modal = document.createElement("div");
  modal.id = "shieldvault-behavioral-modal";
  modal.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "background:rgba(255,255,255,0.6)",
    "backdrop-filter:blur(16px) saturate(180%)",
    "color:#1a1a2e",
    "border:1px solid rgba(255,255,255,0.5)",
    "border-radius:12px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.1)",
    "padding:24px 28px",
    "max-width:420px",
    "width:90vw",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "font-size:14px",
    "line-height:1.5",
  ].join(";");

  modal.innerHTML = `
    <div style="font-size:18px;font-weight:700;margin-bottom:10px">🛡️ ShieldVault — Regret Check</div>
    <p style="margin:0 0 10px">Your message may come across as regrettable:</p>
    <ul id="sv-warning-list" style="margin:0 0 16px;padding-left:18px;color:#b45309"></ul>
    <p style="margin:0 0 18px;color:#4a5568;font-size:13px">Take a breath — are you sure you want to send this?</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="sv-disable-btn" style="padding:8px 12px;border-radius:7px;border:1.5px solid #1a1a2e;background:transparent;color:#1a1a2e;cursor:pointer;font-size:13px">Turn off this warning</button>
      <button id="sv-edit-btn" style="padding:8px 16px;border-radius:7px;border:1.5px solid #1a1a2e;background:transparent;color:#1a1a2e;cursor:pointer;font-size:14px">✏️ Edit Message</button>
      <button id="sv-send-btn" style="padding:8px 16px;border-radius:7px;border:none;background:#e53e3e;color:#fff;cursor:pointer;font-size:14px">Send Anyway</button>
    </div>
  `;

  document.body.appendChild(modal);

  const ul = modal.querySelector("#sv-warning-list");
  for (const w of warnings) {
    const li = document.createElement("li");
    li.style.margin = "4px 0";
    li.textContent = `⚠️ ${w}`;
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
  // --- Hard block: secrets ---
  const secretMatches = detectSecrets(text);
  if (secretMatches.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    if (el) {
      // Clear any active bypass before hard-blocking
      delete el.dataset.shieldvaultBypass;
      hardNullify(el);
      liftAndFadeGhost(el, text, secretMatches);
    }

    notifyBackground(secretMatches, vector);
    devWarn(`Blocked: ${secretMatches.join(", ")} via ${vector}`);
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
  if (isHighRiskDomain() && text.trim().length >= 10) {
    warnings.push("Posting to a public paste site — content may be visible to anyone");
    warningTypes.push("reputation");
  }

  if (warnings.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    notifyBackground(warnings, 'behavioral');
    showBehavioralModal(text, el, warnings, warningTypes);
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
    const el = e.target;
    if (!el) return;

    if (
      el.tagName !== "INPUT" &&
      el.tagName !== "TEXTAREA" &&
      !el.isContentEditable
    ) {
      return;
    }

    const value = getValue(el);
    if (!value) return;

    // Hard block: secrets
    const secretMatches = detectSecrets(value);
    if (secretMatches.length > 0) {
      // Clear any active bypass before hard-blocking
      delete el.dataset.shieldvaultBypass;
      hardNullify(el);
      liftAndFadeGhost(el, value, secretMatches);
      notifyBackground(secretMatches, "input-fallback");
      devWarn(`Fallback blocked: ${secretMatches.join(", ")}`);
      return;
    }

    // Soft block: behavioral (skip if bypass is active)
    if (el.dataset.shieldvaultBypass === "true") return;

    const behaviorMatches = detectBehaviors(value);
    if (behaviorMatches.length > 0) {
      showBehavioralModal(value, el, behaviorMatches, ["emotional"]);
      devWarn(`Fallback behavioral warning: ${behaviorMatches.join(", ")}`);
    }
  },
  true
);

// DROP — catch dragged .env / key / cert files before they land in an input
document.addEventListener(
  "drop",
  (e) => {
    if (!SHIELDVAULT_SETTINGS.secretGuard) return;

    const el = e.target;
    if (!el || (el.tagName !== "INPUT" && el.tagName !== "TEXTAREA" && !el.isContentEditable)) return;

    // Check for sensitive file names
    const files = e.dataTransfer && e.dataTransfer.files;
    if (files && files.length > 0) {
      const sensitiveFile = Array.from(files).find(function (f) {
        return /\.(env|pem|key|p12|pfx|jks|crt|cer|ppk)$/i.test(f.name) ||
          /^(id_rsa|id_ed25519|id_ecdsa|id_dsa|\.env)$/.test(f.name);
      });
      if (sensitiveFile) {
        e.preventDefault();
        e.stopImmediatePropagation();
        liftAndFadeGhost(el, sensitiveFile.name, ["Sensitive file: " + sensitiveFile.name]);
        notifyBackground(["Sensitive file: " + sensitiveFile.name], "drop");
        devWarn(`Blocked file drop: ${sensitiveFile.name}`);
        return;
      }
    }

    // Also check plain-text content in the drag payload
    const text = e.dataTransfer && e.dataTransfer.getData("text");
    if (text) {
      handleDetection(text, el, "drop", e);
    }
  },
  true
);

// ================================
// INIT
// ================================
devLog("Content script loaded —", DETECTORS.length, "detectors active,", BEHAVIORAL_DETECTORS.length, "behavioral detectors active");
loadShieldVaultSettings();
