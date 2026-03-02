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
// BEHAVIORAL MODAL
// ================================
let bypassDetection = false;

function showBehavioralModal(text, el, matches) {
  const existing = document.getElementById("shieldvault-modal-overlay");
  if (existing) existing.remove();
  const existingStyle = document.getElementById("shieldvault-modal-style");
  if (existingStyle) existingStyle.remove();

  const style = document.createElement("style");
  style.id = "shieldvault-modal-style";
  style.textContent = `
    #shieldvault-modal-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
    }
    #shieldvault-modal-box {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.25), 0 4px 16px rgba(0,0,0,0.1);
      padding: 32px;
      max-width: 480px;
      width: 90%;
      box-sizing: border-box;
      font-family: system-ui, -apple-system, sans-serif;
    }
    #shieldvault-modal-icon {
      font-size: 32px;
      margin-bottom: 12px;
    }
    #shieldvault-modal-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a2e;
      margin: 0 0 8px;
    }
    #shieldvault-modal-subtitle {
      font-size: 14px;
      color: #555;
      margin: 0 0 16px;
      line-height: 1.5;
    }
    #shieldvault-modal-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-bottom: 16px;
    }
    .shieldvault-tag {
      background: #fff0f0;
      color: #c0392b;
      border: 1px solid #f5c6cb;
      border-radius: 20px;
      padding: 3px 10px;
      font-size: 12px;
      font-weight: 600;
    }
    #shieldvault-modal-preview {
      background: #f7f8fa;
      border: 1px solid #e1e4e8;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      color: #333;
      max-height: 120px;
      overflow-y: auto;
      overflow-wrap: break-word;
      margin-bottom: 24px;
      line-height: 1.5;
      white-space: pre-wrap;
    }
    #shieldvault-modal-actions {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    #shieldvault-btn-edit {
      width: 100%;
      padding: 14px 20px;
      background: #4A90E2;
      color: #ffffff;
      border: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 600;
      font-family: system-ui, -apple-system, sans-serif;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(74,144,226,0.4);
      transition: background 0.15s, transform 0.1s;
    }
    #shieldvault-btn-edit:hover {
      background: #357abd;
      transform: translateY(-1px);
    }
    #shieldvault-btn-send {
      width: 100%;
      padding: 10px 20px;
      background: transparent;
      color: #888;
      border: none;
      border-radius: 10px;
      font-size: 13px;
      font-family: system-ui, -apple-system, sans-serif;
      cursor: pointer;
      transition: color 0.15s;
    }
    #shieldvault-btn-send:hover {
      color: #555;
    }
  `;

  const overlay = document.createElement("div");
  overlay.id = "shieldvault-modal-overlay";

  const box = document.createElement("div");
  box.id = "shieldvault-modal-box";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");

  const icon = document.createElement("div");
  icon.id = "shieldvault-modal-icon";
  icon.textContent = "🛡️";

  const title = document.createElement("p");
  title.id = "shieldvault-modal-title";
  title.textContent = "Sensitive data detected";

  const subtitle = document.createElement("p");
  subtitle.id = "shieldvault-modal-subtitle";
  subtitle.textContent = "Your message appears to contain credentials or secrets. Take a moment to review before sending.";

  const tags = document.createElement("div");
  tags.id = "shieldvault-modal-tags";
  matches.forEach((m) => {
    const tag = document.createElement("span");
    tag.className = "shieldvault-tag";
    tag.textContent = m;
    tags.appendChild(tag);
  });

  const preview = document.createElement("div");
  preview.id = "shieldvault-modal-preview";
  preview.textContent = text.length > 300 ? text.slice(0, 300) + "…" : text;

  const actions = document.createElement("div");
  actions.id = "shieldvault-modal-actions";

  const editBtn = document.createElement("button");
  editBtn.id = "shieldvault-btn-edit";
  editBtn.textContent = "✏️ Edit Message";

  const sendBtn = document.createElement("button");
  sendBtn.id = "shieldvault-btn-send";
  sendBtn.textContent = "Send Anyway";

  actions.appendChild(editBtn);
  actions.appendChild(sendBtn);
  box.appendChild(icon);
  box.appendChild(title);
  box.appendChild(subtitle);
  box.appendChild(tags);
  box.appendChild(preview);
  box.appendChild(actions);
  overlay.appendChild(box);

  document.head.appendChild(style);
  document.body.appendChild(overlay);

  function closeModal() {
    overlay.remove();
    const s = document.getElementById("shieldvault-modal-style");
    if (s) s.remove();
    document.removeEventListener("keydown", onKeyDown, true);
  }

  function onKeyDown(e) {
    if (e.key === "Escape") {
      closeModal();
      if (el) { setValue(el, text); el.focus(); }
    }
  }

  editBtn.addEventListener("click", () => {
    closeModal();
    if (el) { setValue(el, text); el.focus(); }
  });

  sendBtn.addEventListener("click", () => {
    closeModal();
    bypassDetection = true;
    if (el) setValue(el, text);
  });

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      closeModal();
      if (el) { setValue(el, text); el.focus(); }
    }
  });

  document.addEventListener("keydown", onKeyDown, true);
}

// ================================
// BLOCKING LOGIC
// ================================
function handleDetection(text, el, vector, event) {
  const matches = detectSecrets(text);
  if (matches.length === 0) return false;

  if (bypassDetection) {
    bypassDetection = false;
    return false;
  }

  if (event && typeof event.preventDefault === "function") {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  if (el) {
    hardNullify(el);
  }

  notifyBackground(matches, vector);
  showBehavioralModal(text, el, matches);

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
