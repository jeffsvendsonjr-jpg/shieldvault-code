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

  const matches = [];
  for (const bp of BEHAVIORAL_PATTERNS) {
    if (bp.pattern.test(text)) {
      matches.push(bp.name);
    }
  }
  return matches;
}

// ================================
// BEHAVIORAL MODAL
// ================================
function showBehavioralModal(text, el) {
  const titles = [
    "🛑 The Preview of Shame",
    "🧘 The future you strongly suggested reconsidering this.",
    "😬 Vibe Check...",
    "☕ The Morning-After Simulator",
    "🌶️ Spicy Draft Detected",
  ];
  const title = titles[Math.floor(Math.random() * titles.length)];

  // Backdrop
  const backdrop = document.createElement("div");
  backdrop.id = "shieldvault-behavioral-modal";
  backdrop.style.position = "fixed";
  backdrop.style.inset = "0";
  backdrop.style.background = "rgba(0,0,0,0.55)";
  backdrop.style.zIndex = "2147483646";
  backdrop.style.display = "flex";
  backdrop.style.alignItems = "center";
  backdrop.style.justifyContent = "center";

  // Modal box
  const box = document.createElement("div");
  box.style.background = "#fff";
  box.style.borderRadius = "12px";
  box.style.boxShadow = "0 8px 32px rgba(0,0,0,0.28)";
  box.style.padding = "28px 32px";
  box.style.maxWidth = "420px";
  box.style.width = "90%";
  box.style.fontFamily = "system-ui, sans-serif";
  box.style.boxSizing = "border-box";

  // Title
  const titleEl = document.createElement("div");
  titleEl.textContent = title;
  titleEl.style.fontSize = "17px";
  titleEl.style.fontWeight = "700";
  titleEl.style.marginBottom = "14px";
  titleEl.style.color = "#1a1a2e";
  titleEl.style.lineHeight = "1.4";

  // Content
  const content = document.createElement("div");
  content.textContent = text;
  content.style.fontSize = "14px";
  content.style.color = "#444";
  content.style.background = "#f7f7f9";
  content.style.borderRadius = "8px";
  content.style.padding = "12px 14px";
  content.style.marginBottom = "20px";
  content.style.maxHeight = "120px";
  content.style.overflowY = "auto";
  content.style.wordBreak = "break-word";
  content.style.lineHeight = "1.5";

  // Buttons row
  const btnRow = document.createElement("div");
  btnRow.style.display = "flex";
  btnRow.style.gap = "10px";
  btnRow.style.justifyContent = "flex-end";

  const editBtn = document.createElement("button");
  editBtn.textContent = "Edit Message";
  editBtn.style.padding = "8px 18px";
  editBtn.style.borderRadius = "7px";
  editBtn.style.border = "1.5px solid #1a1a2e";
  editBtn.style.background = "#fff";
  editBtn.style.color = "#1a1a2e";
  editBtn.style.fontWeight = "600";
  editBtn.style.fontSize = "14px";
  editBtn.style.cursor = "pointer";
  editBtn.addEventListener("click", () => {
    backdrop.remove();
    if (el) el.focus();
  });

  const sendBtn = document.createElement("button");
  sendBtn.textContent = "Send Anyway";
  sendBtn.style.padding = "8px 18px";
  sendBtn.style.borderRadius = "7px";
  sendBtn.style.border = "none";
  sendBtn.style.background = "#1a1a2e";
  sendBtn.style.color = "#fff";
  sendBtn.style.fontWeight = "600";
  sendBtn.style.fontSize = "14px";
  sendBtn.style.cursor = "pointer";
  sendBtn.addEventListener("click", () => {
    if (el) {
      el.dataset.shieldvaultBypass = "true";
      setTimeout(() => {
        delete el.dataset.shieldvaultBypass;
      }, 5000);
    }
    backdrop.remove();
  });

  btnRow.appendChild(editBtn);
  btnRow.appendChild(sendBtn);
  box.appendChild(titleEl);
  box.appendChild(content);
  box.appendChild(btnRow);
  backdrop.appendChild(box);
  document.body.appendChild(backdrop);
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

// ================================
// BLOCKING LOGIC
// ================================
function handleDetection(text, el, vector, event) {
  const matches = detectSecrets(text);
  if (matches.length === 0) return false;

  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  if (el) {
    hardNullify(el);
    liftAndFadeGhost(el, text);
  }

  notifyBackground(matches, vector);

  devWarn(`Blocked: ${matches.join(", ")} via ${vector}`);
  return true;
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
        showBehavioralModal(value, el);
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

    const matches = detectSecrets(value);
    if (matches.length === 0) return;

    hardNullify(el);
    liftAndFadeGhost(el, value);
    notifyBackground(matches, "input-fallback");

    devWarn(`Fallback blocked: ${matches.join(", ")}`);
  },
  true
);

// ================================
// INIT
// ================================
devLog("Content script loaded —", DETECTORS.length, "detectors active");
