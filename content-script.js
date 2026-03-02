// ======================================================
// ShieldVault — Content Script
// Local-only, silent, MV3-safe
// Detection without possession
// ======================================================

// ================================
// ENV
// ================================
const DEV = false;

// ================================
// TIER — read from chrome.storage.local (set by proofs.js on activation)
// USER_TIER is only read inside event handlers (keydown), which cannot fire
// before the storage callback completes — so no race condition in practice.
// ================================
let USER_TIER = "free";
chrome.storage.local.get(["shieldvault_pro"], (result) => {
  if (result.shieldvault_pro === true) USER_TIER = "plus";
});
chrome.storage.onChanged.addListener((changes) => {
  if ("shieldvault_pro" in changes) {
    USER_TIER = changes.shieldvault_pro.newValue === true ? "plus" : "free";
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
];

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

  const matches = [];
  for (const detector of DETECTORS) {
    if (detector.pattern.test(text)) {
      matches.push(detector.name);
    }
  }
  return matches;
}

function detectBehaviors(text) {
  if (!text || typeof text !== "string") return [];

  const matches = [];
  for (const detector of BEHAVIORAL_DETECTORS) {
    if (detector.pattern.test(text)) {
      matches.push(detector.name);
    }
  }
  return matches;
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

function liftAndFadeGhost(el, text) {
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const ghost = document.createElement("div");

  const maskedText = "••• SECRET BLOCKED •••";

  ghost.textContent = maskedText;
  ghost.style.position = "fixed";
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.style.maxWidth = `${rect.width}px`;
  ghost.style.padding = "6px 10px";
  ghost.style.fontSize = "12px";
  ghost.style.fontFamily = "system-ui, sans-serif";
  ghost.style.fontWeight = "600";
  ghost.style.color = "#fff";
  ghost.style.background = "linear-gradient(135deg, #1a1a2e 0%, #16213e 100%)";
  ghost.style.border = "1px solid rgba(255,255,255,0.1)";
  ghost.style.borderRadius = "6px";
  ghost.style.boxShadow = "0 4px 12px rgba(0,0,0,0.3)";
  ghost.style.pointerEvents = "none";
  ghost.style.zIndex = "2147483647";
  ghost.style.transition = "transform 1s ease-out, opacity 1s ease-out";
  ghost.style.opacity = "1";

  document.body.appendChild(ghost);

  requestAnimationFrame(() => {
    ghost.style.transform = "translateY(-30px)";
    ghost.style.opacity = "0";
  });

  setTimeout(() => ghost.remove(), 1100);
}

function notifyBackground(detectorNames, vector) {
  try {
    chrome.runtime.sendMessage({
      type: "SHIELDVAULT_PREVENTED",
      detectors: detectorNames,
      vector: vector
    });
  } catch (e) {
    // Extension context may be invalidated, ignore silently
  }
}

function showBehavioralModal(text, el, warnings) {
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
    "background:#1a1a2e",
    "color:#fff",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:12px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.5)",
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
    <ul id="sv-warning-list" style="margin:0 0 16px;padding-left:18px;color:#fbbf24"></ul>
    <p style="margin:0 0 18px;color:#a0aec0;font-size:13px">Take a breath — are you sure you want to send this?</p>
    <div style="display:flex;gap:10px;justify-content:flex-end">
      <button id="sv-edit-btn" style="padding:8px 16px;border-radius:7px;border:none;background:#2d3748;color:#fff;cursor:pointer;font-size:14px">✏️ Edit Message</button>
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
      liftAndFadeGhost(el, text);
    }

    notifyBackground(secretMatches, vector);
    devWarn(`Blocked: ${secretMatches.join(", ")} via ${vector}`);
    return true;
  }

  // --- Soft block: behavioral ---
  if (el && el.dataset.shieldvaultBypass === "true") return false;

  const behaviorMatches = detectBehaviors(text);
  if (behaviorMatches.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    showBehavioralModal(text, el, behaviorMatches);
    devWarn(`Behavioral warning: ${behaviorMatches.join(", ")} via ${vector}`);
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

    if (handleDetection(value, el, "submit", e)) return;

    if (USER_TIER === "plus" && !el.dataset.shieldvaultBypass) {
      const behaviors = detectBehaviors(value);
      if (behaviors.length > 0) {
        e.preventDefault();
        e.stopImmediatePropagation();
        showBehavioralModal(value, el, behaviors);
        devWarn(`Behavioral modal triggered: ${behaviors.join(", ")}`);
      }
    }
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
      liftAndFadeGhost(el, value);
      notifyBackground(secretMatches, "input-fallback");
      devWarn(`Fallback blocked: ${secretMatches.join(", ")}`);
      return;
    }

    // Soft block: behavioral (skip if bypass is active)
    if (el.dataset.shieldvaultBypass === "true") return;

    const behaviorMatches = detectBehaviors(value);
    if (behaviorMatches.length > 0) {
      showBehavioralModal(value, el, behaviorMatches);
      devWarn(`Fallback behavioral warning: ${behaviorMatches.join(", ")}`);
    }
  },
  true
);

// ================================
// INIT
// ================================
devLog("Content script loaded —", DETECTORS.length, "detectors active,", BEHAVIORAL_DETECTORS.length, "behavioral detectors active");
