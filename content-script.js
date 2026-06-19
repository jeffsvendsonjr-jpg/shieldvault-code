// ======================================================
// ShieldVault — Content Script v1.5.0
// Local-only, silent, MV3-safe
// Detection without possession
//
// v1.5 changes:
//   - Secrets, confidential docs, code blocks: UNLIMITED FREE
//   - Behavioral detection: 10 free warnings/week, unlimited Pro
//   - Input handler debounced (250ms) to remove keystroke lag
//   - Length gates added so we don't run regex storms on short input
//   - Late Night Guard now requires content signal, not just any text
//   - Shouting detector requires multiple distinct words
//   - SSN detector requires either dashed format or context word
//   - Aggressive Punctuation now also catches "???"
// ======================================================

// ================================
// ENV
// ================================
const DEV = false;

// ================================
// TIER + WEEKLY BEHAVIORAL QUOTA
// ================================
let IS_PRO = false;
let BEHAVIORAL_USES = 0;
let BEHAVIORAL_WEEK_KEY = "";
const BEHAVIORAL_FREE_LIMIT = 10;

function currentWeekKey() {
  // ISO-ish week key: year + week number
  const now = new Date();
  const yearStart = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - yearStart) / 86400000);
  const week = Math.floor(dayOfYear / 7);
  return `${now.getFullYear()}-W${week}`;
}

function loadBehavioralQuota() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(
    ["shieldvault_pro", "shieldvault_behavioral_uses", "shieldvault_behavioral_week"],
    (result) => {
      IS_PRO = result.shieldvault_pro === true;
      const storedWeek = result.shieldvault_behavioral_week;
      const thisWeek = currentWeekKey();
      if (storedWeek !== thisWeek) {
        // Week rolled over — reset
        const oldUses = typeof result.shieldvault_behavioral_uses === "number"
          ? result.shieldvault_behavioral_uses
          : 0;
        BEHAVIORAL_USES = 0;
        BEHAVIORAL_WEEK_KEY = thisWeek;
        chrome.storage.local.set({
          shieldvault_behavioral_uses: 0,
          shieldvault_behavioral_week: thisWeek
        });
        // Re-engage users who hit the cap last week
        if (!IS_PRO && oldUses >= BEHAVIORAL_FREE_LIMIT) {
          setTimeout(showWeeklyResetToast, 1500);
        }
      } else {
        BEHAVIORAL_USES = typeof result.shieldvault_behavioral_uses === "number"
          ? result.shieldvault_behavioral_uses
          : 0;
        BEHAVIORAL_WEEK_KEY = storedWeek;
      }
    }
  );
}

function showWeeklyResetToast() {
  if (document.getElementById("shieldvault-reset-toast")) return;
  const toast = document.createElement("div");
  toast.id = "shieldvault-reset-toast";
  toast.style.cssText = [
    "position:fixed",
    "bottom:24px",
    "right:24px",
    "background:#1a1a2e",
    "color:#e6e8ee",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:10px",
    "padding:12px 16px",
    "font-family:system-ui,sans-serif",
    "font-size:13px",
    "line-height:1.5",
    "z-index:2147483647",
    "max-width:300px",
    "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
    "display:flex",
    "flex-direction:column",
    "gap:8px",
  ].join(";");
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px">
      <span style="font-size:16px">🛡️</span>
      <span style="font-weight:700;font-size:13px;color:#fff">Your 10 free warnings just reset</span>
    </div>
    <div style="font-size:12px;color:#9ca3af">Your weekly behavioral protection quota is back to 10. <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="color:#4c6fff;font-weight:600;text-decoration:none">Upgrade for unlimited →</a></div>
    <button id="sv-reset-dismiss" style="background:transparent;border:none;color:#6b7280;font-size:11px;cursor:pointer;padding:0;text-align:left">Dismiss</button>
  `;
  document.body.appendChild(toast);
  toast.querySelector("#sv-reset-dismiss").addEventListener("click", () => toast.remove());
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 10000);
}

function incrementBehavioralUse() {
  BEHAVIORAL_USES++;
  chrome.storage.local.set({
    shieldvault_behavioral_uses: BEHAVIORAL_USES,
    shieldvault_behavioral_week: BEHAVIORAL_WEEK_KEY
  });
}

function behavioralQuotaRemaining() {
  if (IS_PRO) return Infinity;
  return Math.max(0, BEHAVIORAL_FREE_LIMIT - BEHAVIORAL_USES);
}

// ================================
// SETTINGS
// ================================
let SETTINGS = {
  secretDetection: true,
  behavioralDetection: true,
  confidentialDetection: true,
  codeBlockDetection: true,
  // PII split into granular toggles in v1.5 — phone & address default OFF
  // because real-world false-positive rate is too high (e.g., order numbers,
  // tracking IDs, "10 digit ct" street-suffix matches in ordinary text)
  piiDetectionSSN: true,           // genuine high-cost leak risk
  piiDetectionCreditCard: true,    // Luhn-prefixed regex keeps false positives low
  piiDetectionPhone: false,        // intentional sharing dominates; opt-in
  piiDetectionAddress: false,      // intentional sharing dominates; opt-in
  // Legacy global toggle — still respected. If a user has piiDetection: false
  // from a v1.4 install, all PII detection stays off until they re-enable.
  piiDetection: true,
  lateNightGuard: true,
  repeatOffenderWarnings: true,
  clipboardClear: true,
  soundOnBlock: false,
};

function loadSettings() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(["shieldvault_settings"], (result) => {
    if (result.shieldvault_settings) {
      SETTINGS = { ...SETTINGS, ...result.shieldvault_settings };
    }
  });
}

loadSettings();
loadBehavioralQuota();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.shieldvault_settings) {
    SETTINGS = { ...SETTINGS, ...changes.shieldvault_settings.newValue };
  }
  if (changes.shieldvault_pro) {
    IS_PRO = changes.shieldvault_pro.newValue === true;
  }
  if (changes.shieldvault_behavioral_uses) {
    BEHAVIORAL_USES = changes.shieldvault_behavioral_uses.newValue || 0;
  }
  if (changes.shieldvault_behavioral_week) {
    BEHAVIORAL_WEEK_KEY = changes.shieldvault_behavioral_week.newValue || "";
  }
});

// ================================
// UPGRADE MODAL (behavioral-only in v1.5)
// ================================
// ================================
// UPGRADE MODAL RATE LIMITING (v1.5)
// Prevents nag spam when user is at 10/10 cap and continues typing.
// Per-element cooldown isn't enough because React re-renders the input,
// users switch platforms, or they paste in different compose windows.
// ================================
const UPGRADE_MODAL_AUTO_QUIET_MS = 5 * 60 * 1000;     // 5 min after auto-show
const UPGRADE_MODAL_DISMISS_QUIET_MS = 60 * 60 * 1000; // 1 hr after explicit dismiss
let upgradeModalQuietUntil = 0;

function isUpgradeModalQuiet() {
  return Date.now() < upgradeModalQuietUntil;
}

function setUpgradeModalQuietForAutoShow() {
  // After auto-display, suppress further upgrade modals for 5 minutes.
  // User has seen the offer; nagging again immediately is hostile.
  upgradeModalQuietUntil = Date.now() + UPGRADE_MODAL_AUTO_QUIET_MS;
}

function setUpgradeModalQuietForDismissal() {
  // User explicitly clicked Dismiss. Respect that for an hour.
  upgradeModalQuietUntil = Date.now() + UPGRADE_MODAL_DISMISS_QUIET_MS;
}

function showBehavioralUpgradeModal(lastWarning) {
  if (document.getElementById("shieldvault-upgrade-modal")) return;
  if (isUpgradeModalQuiet()) return;

  // Lock further auto-shows for 5 min the moment we display this one
  setUpgradeModalQuietForAutoShow();

  // Personalize the headline based on what was just caught
  const UPGRADE_COPY = {
    "Late Night Message":        { headline: "Sending late-night messages again?", sub: "That was warning 10 of 10 this week. Future You thanks you for pausing." },
    "Shouting (all-caps)":       { headline: "Caps lock doesn't make the point land harder.", sub: "That was your last free warning this week. Upgrade to stay protected." },
    "Aggressive Punctuation":    { headline: "Three exclamation points is still yelling.", sub: "That was warning 10 of 10 this week. Unlock unlimited to keep the safety net." },
    "Passive Aggressive":        { headline: "\"Per my last email\" is rarely received well.", sub: "That was your last free warning this week. Keep the guardrails with unlimited access." },
    "Hostile Opener":            { headline: "Starting with a swing rarely ends well.", sub: "That was warning 10 of 10 this week. Upgrade to keep full coverage." },
    "Rage-quit Threat":          { headline: "\"I quit\" hits differently in writing.", sub: "That was your last free warning this week. Don't lose your safety net." },
    "Profanity / Insult":        { headline: "Name-calling almost never helps.", sub: "That was warning 10 of 10 this week. Upgrade to stay fully protected." },
    "Emotional Overshare":       { headline: "Work venting online can follow you.", sub: "That was your last free warning this week. Upgrade to keep the guardrails on." },
    "Gossip / Badmouthing":      { headline: "If it starts with \"don't tell anyone\"…", sub: "That was warning 10 of 10 this week. Unlock unlimited to stay covered." },
  };
  const copy = (lastWarning && UPGRADE_COPY[lastWarning])
    ? UPGRADE_COPY[lastWarning]
    : { headline: "You've used all 10 free behavioral warnings this week.", sub: "Resets Sunday. Or unlock unlimited now." };

  const modal = document.createElement("div");
  modal.id = "shieldvault-upgrade-modal";
  modal.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "background:rgba(255,255,255,0.92)",
    "backdrop-filter:blur(20px) saturate(180%)",
    "color:#1a1a2e",
    "border:1px solid rgba(255,255,255,0.6)",
    "border-radius:16px",
    "box-shadow:0 12px 48px rgba(0,0,0,0.18)",
    "padding:24px 28px",
    "max-width:380px",
    "width:90vw",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "font-size:14px",
    "line-height:1.5",
    "text-align:center",
  ].join(";");

  modal.innerHTML = `
    <div style="font-size:26px;margin-bottom:10px">🛡️</div>
    <div style="font-size:17px;font-weight:700;margin-bottom:6px;color:#1a1a2e">${escapeForHtml(copy.headline)}</div>
    <div style="font-size:13px;color:#6b7280;margin-bottom:14px">${escapeForHtml(copy.sub)}</div>
    <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="display:block;background:#1a1a2e;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700;font-size:15px;margin-bottom:6px;text-align:center;position:relative">
      Lifetime — $39 &nbsp;<span style="font-size:10px;font-weight:500;opacity:0.75">one-time · never renews</span>
    </a>
    <div style="font-size:11px;color:#9ca3af;margin-bottom:10px">Most popular · never think about it again</div>
    <a href="https://shieldvault.site/api/checkout/quick?plan=monthly" target="_blank" style="display:block;background:transparent;color:#6b7280;text-decoration:none;padding:9px 20px;border-radius:8px;font-weight:500;font-size:12px;border:1px solid #e5e7eb;margin-bottom:12px;text-align:center">
      Monthly instead — $4.99/mo
    </a>
    <button id="sv-upgrade-dismiss" style="background:transparent;border:none;color:#9ca3af;font-size:12px;cursor:pointer;padding:4px;display:block;width:100%;text-align:center">
      Dismiss — message will send
    </button>
    <div style="font-size:11px;color:#9ca3af;margin-top:10px;font-style:italic">Secrets are still being blocked. Always.</div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#sv-upgrade-dismiss").addEventListener("click", () => {
    setUpgradeModalQuietForDismissal();
    modal.remove();
  });
}

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
// COOLDOWN SYSTEM
// ================================
const cooldowns = new WeakMap();
const COOLDOWN_MS = 3000;

function isOnCooldown(el) {
  if (!el) return false;
  const last = cooldowns.get(el);
  if (!last) return false;
  return (Date.now() - last) < COOLDOWN_MS;
}

function setCooldown(el) {
  if (el) cooldowns.set(el, Date.now());
}

// ================================
// REPEAT OFFENDER TRACKING
// ================================
let repeatTracker = {};

function loadRepeatTracker() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
  chrome.storage.local.get(["shieldvault_repeat_tracker"], (result) => {
    if (result.shieldvault_repeat_tracker) {
      const stored = result.shieldvault_repeat_tracker;
      const today = new Date().toDateString();
      if (stored.date === today) {
        repeatTracker = stored.counts || {};
      } else {
        repeatTracker = {};
        saveRepeatTracker();
      }
    }
  });
}

function saveRepeatTracker() {
  const today = new Date().toDateString();
  chrome.storage.local.set({
    shieldvault_repeat_tracker: { date: today, counts: repeatTracker }
  });
}

function trackRepeatOffender(detectorName) {
  if (!SETTINGS.repeatOffenderWarnings) return null;
  repeatTracker[detectorName] = (repeatTracker[detectorName] || 0) + 1;
  saveRepeatTracker();
  if (repeatTracker[detectorName] >= 3) {
    return repeatTracker[detectorName];
  }
  return null;
}

loadRepeatTracker();

// ================================
// PATTERN LIBRARY — SECRET DETECTORS
// ================================
const DETECTORS = [
  // OpenAI
  { name: "OpenAI API Key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { name: "OpenAI Project Key", pattern: /sk-proj-[A-Za-z0-9_-]{20,}/ },

  // Anthropic
  { name: "Anthropic API Key", pattern: /sk-ant-[A-Za-z0-9_-]{20,}/ },

  // AWS
  { name: "AWS Access Key ID", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "AWS Secret Access Key", pattern: /(?<![A-Za-z0-9\/+=])[A-Za-z0-9\/+=]{40}(?![A-Za-z0-9\/+=])/ },
  { name: "AWS Session Token", pattern: /FwoGZXIvYXdzE[A-Za-z0-9\/+=]+/ },

  // Azure
  { name: "Azure Storage Key", pattern: /DefaultEndpointsProtocol=https;AccountName=[^;]+;AccountKey=[A-Za-z0-9+\/=]{86,}/ },
  { name: "Azure SAS Token", pattern: /sv=\d{4}-\d{2}-\d{2}&s[a-z]=[a-z]&[a-z]+=[^&\s]+/ },

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

  // Google / Firebase
  { name: "Google API Key", pattern: /AIza[A-Za-z0-9_-]{35}/ },
  { name: "Google OAuth ID", pattern: /[0-9]+-[A-Za-z0-9_]{32}\.apps\.googleusercontent\.com/ },
  { name: "Firebase Config", pattern: /apiKey\s*[:=]\s*["']AIza[A-Za-z0-9_-]{35}["']/ },

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
  { name: "Heroku API Key", pattern: /(?:HEROKU_API_KEY|heroku.*api.*key)\s*[:=]\s*[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },

  // Hugging Face
  { name: "Hugging Face Token", pattern: /hf_[A-Za-z0-9]{34,}/ },

  // Vercel
  { name: "Vercel Token", pattern: /vercel_[A-Za-z0-9]{24,}/ },

  // Netlify
  { name: "Netlify Token", pattern: /nfp_[A-Za-z0-9]{40,}/ },

  // Cloudflare
  { name: "Cloudflare Global Key", pattern: /v1\.0-[A-Fa-f0-9]{24}-[A-Fa-f0-9]{146}/ },

  // Supabase
  { name: "Supabase Key", pattern: /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}/ },
  { name: "Supabase Service Key", pattern: /sbp_[A-Za-z0-9]{40,}/ },

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

  // .env file blocks
  { name: ".env Block", pattern: /^[A-Z_]{3,}=["']?[A-Za-z0-9_\-\/+=]{8,}["']?\s*$/m },

  // JWT
  { name: "JSON Web Token", pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },

  // Bearer tokens
  { name: "Bearer Token", pattern: /Bearer\s+[A-Za-z0-9_-]{20,}/ },

  // Basic Auth
  { name: "Basic Auth Header", pattern: /Basic\s+[A-Za-z0-9+\/=]{20,}/ },
];

// ================================
// CONFIDENTIAL DOCUMENT DETECTORS
// ================================
const CONFIDENTIAL_DETECTORS = [
  { name: "Confidential Marker", pattern: /\b(CONFIDENTIAL|STRICTLY CONFIDENTIAL)\b/ },
  { name: "Internal Only", pattern: /\b(INTERNAL\s+ONLY|INTERNAL\s+USE\s+ONLY|NOT\s+FOR\s+DISTRIBUTION)\b/i },
  { name: "Do Not Distribute", pattern: /\b(DO\s+NOT\s+(DISTRIBUTE|SHARE|FORWARD|COPY))\b/i },
  { name: "NDA Protected", pattern: /\b(UNDER\s+NDA|NON[\s-]?DISCLOSURE|COVERED\s+BY\s+NDA)\b/i },
  { name: "Proprietary Notice", pattern: /\b(PROPRIETARY|TRADE\s+SECRET|COMPANY\s+CONFIDENTIAL)\b/i },
  { name: "Attorney-Client Privilege", pattern: /\b(ATTORNEY[\s-]CLIENT\s+PRIVILEGE|LEGALLY\s+PRIVILEGED|WORK\s+PRODUCT)\b/i },
];

// ================================
// CODE BLOCK DETECTORS
// ================================
const CODE_BLOCK_DETECTORS = [
  { name: "Function Definition", pattern: /(?:function\s+\w+\s*\(|const\s+\w+\s*=\s*(?:async\s*)?\(|def\s+\w+\s*\(|fn\s+\w+\s*\(|func\s+\w+\s*\()/ },
  { name: "Class Definition", pattern: /(?:class\s+\w+\s*[{(:]|interface\s+\w+\s*\{|struct\s+\w+\s*\{)/ },
  { name: "Import Block", pattern: /(?:import\s+[\w{*]|from\s+['"][\w@/.-]+['"]\s+import|require\s*\(['"])/ },
  { name: "Multi-line Code Block", pattern: /(?:\n.*[{;]\s*\n.*[{;]\s*\n.*[{;])/ },
];

// ================================
// BEHAVIORAL PATTERN LIBRARY
// FIXES IN v1.5:
//   - Shouting now requires multiple distinct words, not just letters+spaces
//   - Aggressive Punctuation now also catches "???"
//   - SSN requires dashed format OR context word
//   - Late Night Guard now requires content signal in tandem
// ================================
const BEHAVIORAL_DETECTORS = [
  // Rage / Anger
  { name: "Shouting (all-caps)", pattern: /\b[A-Z]{4,}\b|(?:\b[A-Z]{2,}\b\s+){1,}\b[A-Z]{2,}\b/, severity: "high", group: "behavioral", suggestion: "Try lowering the caps. You can be direct and firm without shouting -- it actually lands better." },
  { name: "Aggressive Punctuation", pattern: /[!]{2,}|[?]{2,}|[!?]{3,}/, severity: "medium", group: "behavioral", suggestion: "One exclamation point gets the point across. More than that can come off as yelling." },
  { name: "Hostile Opener", pattern: /^(you people|what the hell|are you serious|this is ridiculous|i can't believe you|who the hell|what is wrong with you)/i, severity: "high", group: "behavioral", suggestion: "Try opening with what you need instead of how you feel. For example: \"I'd like to address...\" or \"Can we talk about...\"" },
  { name: "Rage-quit Threat", pattern: /i('m| am) done with (this|you)|i quit|screw (this|you|it)|to hell with/i, severity: "high", group: "behavioral", suggestion: "If you're truly frustrated, try: \"I need to step back from this for now\" or \"Let's revisit this when we've both had time to think.\"" },
  { name: "Profanity / Insult", pattern: /\b(idiot|stupid|moron|incompetent|useless|pathetic|garbage|trash|joke|asshole|dumbass|jackass|dipshit)\b/i, severity: "high", group: "behavioral", suggestion: "Focus on the problem, not the person. Instead of name-calling, try describing the specific issue: \"This approach isn't working because...\"" },
  { name: "Direct Insult", pattern: /\b(?:you\s+(?:are|'re|r)|youre)\s+(?:such\s+|so\s+|a\s+|an\s+|the\s+)*(?:a\s+|an\s+|the\s+)?(?:loser|fool|dumb|sucks?|worthless|hopeless|toxic|disgusting|insufferable|repulsive|insane|crazy|pathetic|gross|nasty|cruel|mean|awful|terrible|horrible)\b/i, severity: "high", group: "behavioral", suggestion: "Direct insults rarely change minds and often lock the conversation into a worse place. Try saying what they did or what you want, instead of who they are." },
  { name: "Threatening Language", pattern: /i('ll| will) make sure you (never|regret)|you('ll| will) regret this|watch your (back|step)|you have no idea who/i, severity: "high", group: "behavioral", suggestion: "Threats close doors. Try stating your boundaries clearly: \"I'm not comfortable with this\" or \"I need this to change.\"" },

  // Passive Aggression
  { name: "Passive Aggressive", pattern: /per my last (email|message)|as (i|we) (previously|already) (mentioned|stated|discussed)|for future reference|with all due respect|just to clarify|not sure if you (saw|read|noticed)|friendly reminder/i, severity: "medium", group: "behavioral", suggestion: "Try being straightforward: \"I wanted to follow up on...\" or \"Just checking in -- did you get a chance to look at this?\"" },
  { name: "Dismissive / Condescending", pattern: /clearly you don't understand|obviously you haven't|do i really need to explain|i shouldn't have to tell you|as i've already explained|this should be obvious/i, severity: "medium", group: "behavioral", suggestion: "Try: \"Let me explain it a different way\" or \"Here's what I mean...\" People respond better when they don't feel talked down to." },
  { name: "Sarcasm / Snark", pattern: /thanks for nothing|oh great|wow, really|good job breaking|brilliant move|well done.*not|sure, whatever|yeah right|how hard can it be/i, severity: "medium", group: "behavioral", suggestion: "Sarcasm rarely reads the way you intend it. Try saying what you actually mean: \"I'm frustrated because...\" or \"I was hoping for a different outcome.\"" },

  // Late Night Guard — now needs content signal, not just any text
  { name: "Late Night Message", pattern: /\b(i|me|my|you|your|we|us|they|them|hate|love|sorry|miss|need|want|wish|regret|feel|think)\b/i, severity: "low", condition: "latenight", group: "latenight", suggestion: "It's late. Consider saving this as a draft and reviewing it in the morning. Things often look different after some rest." },

  // Oversharing / PII
  { name: "Phone Number", pattern: /\b(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/, severity: "medium", group: "pii", suggestion: "Consider sharing your phone number through a private channel instead of posting it here." },
  { name: "Social Security Number", pattern: /(?:\bssn\b|social\s+security|tax\s+id)[\s:=#]*\d{3}[-\s]?\d{2}[-\s]?\d{4}|\b\d{3}-\d{2}-\d{4}\b/i, severity: "high", group: "pii", suggestion: "Never share your SSN online. If someone is asking for it here, that's a red flag." },
  { name: "Home Address", pattern: /\b\d{1,5}\s+[A-Za-z]+\s+(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|ct|court|way|pl|place)\b/i, severity: "medium", group: "pii", suggestion: "Sharing your address publicly can be a safety risk. Consider sending it privately if needed." },
  { name: "Credit Card Number", pattern: /\b(?:4\d{3}|5[1-5]\d{2}|6(?:011|5\d{2}))[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b|\b3[47]\d{2}[- ]?\d{6}[- ]?\d{5}\b/, severity: "high", group: "pii", suggestion: "Never post credit card numbers online. Use the platform's secure payment system instead." },

  // Emotional / Impulsive
  { name: "Emotional Overshare", pattern: /i (hate|love|can't stand) (my|this) (job|boss|company|team|coworker|manager|life)|i('m| am) (so|really) (tired|exhausted|fed up|sick) of/i, severity: "medium", group: "behavioral", suggestion: "It's okay to feel this way, but posting it publicly can follow you. Try talking to someone you trust privately, or write it down for yourself first." },
  { name: "Ultimatum", pattern: /either you .+ or (i|we) (will|are going to)|if you don't .+ (i|we) will|this is your (last|final) (chance|warning)/i, severity: "high", group: "behavioral", suggestion: "Ultimatums tend to escalate things. Try stating what you need and why: \"It's important to me that... because...\"" },
  { name: "Gossip / Badmouthing", pattern: /don't tell (anyone|him|her|them)|between (you and me|us)|off the record|i heard that (he|she|they)|apparently (he|she|they)/i, severity: "medium", group: "behavioral", suggestion: "If it starts with \"don't tell anyone\" it probably shouldn't be posted. Consider whether this could hurt someone if they saw it." },
];

// ================================
// HELPERS
// ================================
function getActiveEditable() {
  const el = document.activeElement;
  if (!el) return null;
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable) {
    return el;
  }
  return null;
}

function getValue(el) {
  if (!el) return "";
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return el.value || "";
  if (el.isContentEditable) return el.innerText || "";
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

function isLateNight() {
  const hour = new Date().getHours();
  return hour >= 0 && hour < 5;
}

function getPlatformContext() {
  const host = window.location.hostname;
  if (host.includes("mail.google") || host.includes("outlook")) return "email";
  if (host.includes("linkedin")) return "professional";
  if (host.includes("slack") || host.includes("teams")) return "work-chat";
  if (host.includes("reddit") || host.includes("twitter") || host === "x.com" || host.endsWith(".x.com")) return "social";
  if (host.includes("chatgpt") || host.includes("claude") || host.includes("gemini") || host.includes("perplexity")) return "ai-chat";
  return "general";
}

// ================================
// LENGTH GATES — short input never triggers expensive checks
// ================================
const MIN_LENGTH_FOR_SECRETS = 8;        // No API key is shorter than 8 chars
const MIN_LENGTH_FOR_BEHAVIORAL = 12;    // Behavioral signals don't fire on tiny input ("ok", "yes", "lol")
const MIN_LENGTH_FOR_CODE = 200;         // Code block detection already requires 200+

// ================================
// DETECTION — SECRETS
// ================================
function detectSecrets(text) {
  if (!text || typeof text !== "string") return [];
  if (text.length < MIN_LENGTH_FOR_SECRETS) return [];
  if (!SETTINGS.secretDetection) return [];

  const matches = [];
  for (const detector of DETECTORS) {
    if (detector.pattern.test(text)) {
      matches.push(detector.name);
    }
  }
  return matches;
}

// ================================
// DETECTION — CONFIDENTIAL DOCUMENTS
// ================================
function detectConfidential(text) {
  if (!text || typeof text !== "string") return [];
  if (text.length < 9) return [];  // shortest match phrase is "UNDER NDA" = 9 chars
  if (!SETTINGS.confidentialDetection) return [];

  const platform = getPlatformContext();
  if (platform !== "ai-chat") return [];

  const matches = [];
  for (const detector of CONFIDENTIAL_DETECTORS) {
    if (detector.pattern.test(text)) {
      matches.push({ name: detector.name, severity: "high" });
    }
  }
  return matches;
}

// ================================
// DETECTION — CODE BLOCKS
// ================================
function detectCodeBlocks(text) {
  if (!text || typeof text !== "string") return [];
  if (!SETTINGS.codeBlockDetection) return [];

  const platform = getPlatformContext();
  if (platform !== "ai-chat") return [];
  if (text.length < MIN_LENGTH_FOR_CODE) return [];

  const matches = [];
  let codeSignals = 0;
  for (const detector of CODE_BLOCK_DETECTORS) {
    if (detector.pattern.test(text)) {
      codeSignals++;
    }
  }

  if (codeSignals >= 2) {
    matches.push({ name: "Large Code Block", severity: "medium" });
  }

  return matches;
}

// ================================
// DETECTION — BEHAVIORAL
// v1.5: now available to free users (10/week quota)
// Late Night Guard now requires another behavioral signal OR personal pronoun
// ================================
function detectBehaviors(text) {
  if (!text || typeof text !== "string") return [];
  if (text.length < MIN_LENGTH_FOR_BEHAVIORAL) return [];
  if (!SETTINGS.behavioralDetection) return [];

  const platform = getPlatformContext();
  const matches = [];

  // Run non-latenight detectors first
  let hasNonLatenightSignal = false;
  for (const bp of BEHAVIORAL_DETECTORS) {
    if (bp.condition === "latenight") continue;

    // PII granular gating: legacy piiDetection acts as master switch
    if (bp.group === "pii") {
      if (!SETTINGS.piiDetection) continue;
      if (bp.name === "Social Security Number" && !SETTINGS.piiDetectionSSN) continue;
      if (bp.name === "Credit Card Number" && !SETTINGS.piiDetectionCreditCard) continue;
      if (bp.name === "Phone Number" && !SETTINGS.piiDetectionPhone) continue;
      if (bp.name === "Home Address" && !SETTINGS.piiDetectionAddress) continue;
    }

    if (bp.pattern.test(text)) {
      let severity = bp.severity;
      if (platform === "email" || platform === "professional") {
        if (severity === "medium") severity = "high";
      }
      matches.push({ name: bp.name, severity });
      hasNonLatenightSignal = true;
    }
  }

  // Late Night Guard fires only if it's late AND text is substantive AND
  // either another behavioral signal already fired OR the text contains
  // emotional/personal language (the new pattern in v1.5)
  if (SETTINGS.lateNightGuard && isLateNight() && text.length > 50) {
    const latenight = BEHAVIORAL_DETECTORS.find(b => b.condition === "latenight");
    if (latenight && (hasNonLatenightSignal || latenight.pattern.test(text))) {
      matches.push({ name: latenight.name, severity: latenight.severity });
    }
  }

  return matches;
}

// ================================
// CORE ACTIONS
// ================================
function hardNullify(el) {
  setValue(el, "");
  requestAnimationFrame(() => setValue(el, ""));
  setTimeout(() => {
    const current = getValue(el);
    if (current && detectSecrets(current).length > 0) {
      setValue(el, "");
    }
  }, 50);
}

function liftAndFadeGhost(el, text, label) {
  if (!el) return;

  const rect = el.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.textContent = label || "SECRET BLOCKED";
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

function notifyBackground(detectorNames, vector, category, sourceText, severity) {
  try {
    const now = new Date();
    chrome.runtime.sendMessage({
      type: "SHIELDVAULT_PREVENTED",
      detectors: detectorNames,
      vector: vector,
      category: category || "secret",
      // v1.5 richer metadata for v2 prep — NO content stored, only signal shape
      hourOfDay: now.getHours(),         // 0-23
      dayOfWeek: now.getDay(),            // 0=Sunday, 6=Saturday
      inputLength: typeof sourceText === "string" ? sourceText.length : 0,
      severity: severity || null         // "low" | "medium" | "high" | null
    });
  } catch (e) {}
}

function playBlockSound() {
  if (!SETTINGS.soundOnBlock) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 440;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function showClipboardClearOffer(el) {
  if (!SETTINGS.clipboardClear) return;
  if (document.getElementById("shieldvault-clipboard-offer")) return;

  const rect = el ? el.getBoundingClientRect() : { left: 20, top: 20 };
  const offer = document.createElement("div");
  offer.id = "shieldvault-clipboard-offer";
  offer.style.cssText = [
    "position:fixed",
    `left:${rect.left}px`,
    `top:${Math.max(rect.top - 44, 8)}px`,
    "background:#1a1a2e",
    "color:#e6e8ee",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:8px",
    "padding:6px 10px",
    "font-family:system-ui,sans-serif",
    "font-size:11px",
    "z-index:2147483647",
    "display:flex",
    "align-items:center",
    "gap:8px",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
  ].join(";");

  offer.innerHTML = `
    <span>Secret detected in clipboard.</span>
    <button id="sv-clear-clip" style="background:#4c6fff;color:#fff;border:none;border-radius:4px;padding:3px 8px;font-size:10px;cursor:pointer;font-weight:600">Clear Clipboard</button>
    <button id="sv-dismiss-clip" style="background:transparent;color:#8a8f9c;border:none;padding:3px;cursor:pointer;font-size:10px">Dismiss</button>
  `;

  document.body.appendChild(offer);

  document.getElementById("sv-clear-clip").addEventListener("click", () => {
    navigator.clipboard.writeText("").then(() => {
      offer.textContent = "Clipboard cleared.";
      setTimeout(() => offer.remove(), 1200);
    }).catch(() => {
      offer.textContent = "Could not clear clipboard.";
      setTimeout(() => offer.remove(), 1200);
    });
  });

  document.getElementById("sv-dismiss-clip").addEventListener("click", () => {
    offer.remove();
  });

  setTimeout(() => {
    if (offer.parentNode) offer.remove();
  }, 8000);
}

// Rate-limit so the secrets nudge shows at most once per 10 minutes
let secretsNudgeQuietUntil = 0;

function showSecretsUpgradeNudge(el) {
  if (IS_PRO) return;
  if (Date.now() < secretsNudgeQuietUntil) return;
  if (document.getElementById("shieldvault-secrets-nudge")) return;
  secretsNudgeQuietUntil = Date.now() + 10 * 60 * 1000;

  const rect = el ? el.getBoundingClientRect() : null;
  const nudge = document.createElement("div");
  nudge.id = "shieldvault-secrets-nudge";
  nudge.style.cssText = [
    "position:fixed",
    rect ? `left:${Math.min(rect.left, window.innerWidth - 320)}px` : "right:24px",
    rect ? `top:${Math.max(rect.bottom + 8, 8)}px` : "bottom:24px",
    "background:#1a1a2e",
    "color:#e6e8ee",
    "border:1px solid rgba(255,255,255,0.12)",
    "border-radius:10px",
    "padding:10px 14px",
    "font-family:system-ui,sans-serif",
    "font-size:12px",
    "line-height:1.5",
    "z-index:2147483647",
    "max-width:300px",
    "box-shadow:0 6px 20px rgba(0,0,0,0.35)",
    "display:flex",
    "flex-direction:column",
    "gap:6px",
  ].join(";");
  nudge.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
      <span style="font-weight:700;font-size:12px;color:#fff">🛡️ Secret blocked — always free</span>
      <button id="sv-nudge-dismiss" style="background:transparent;border:none;color:#6b7280;font-size:14px;cursor:pointer;padding:0;line-height:1">×</button>
    </div>
    <div style="font-size:11px;color:#9ca3af">Behavioral AI (tone, language) is also available — <strong style="color:#e6e8ee">10 free/week</strong> or <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="color:#4c6fff;font-weight:600;text-decoration:none">unlimited with Pro</a>.</div>
  `;
  document.body.appendChild(nudge);
  nudge.querySelector("#sv-nudge-dismiss").addEventListener("click", () => nudge.remove());
  setTimeout(() => { if (nudge.parentNode) nudge.remove(); }, 7000);
}

function showRepeatOffenderWarning(el, detectorName, count) {
  if (document.getElementById("shieldvault-repeat-warning")) return;

  const rect = el ? el.getBoundingClientRect() : { left: 20, bottom: 60 };
  const warn = document.createElement("div");
  warn.id = "shieldvault-repeat-warning";
  warn.style.cssText = [
    "position:fixed",
    `left:${rect.left}px`,
    `top:${Math.max((rect.bottom || rect.top) + 8, 8)}px`,
    "background:linear-gradient(135deg,#7c2d12,#991b1b)",
    "color:#fef2f2",
    "border:1px solid rgba(255,255,255,0.15)",
    "border-radius:8px",
    "padding:8px 12px",
    "font-family:system-ui,sans-serif",
    "font-size:11px",
    "z-index:2147483647",
    "max-width:300px",
    "box-shadow:0 4px 12px rgba(0,0,0,0.3)",
    "line-height:1.4",
  ].join(";");

  warn.textContent = `You've tried to paste "${detectorName}" ${count} times today. Consider rotating this key or using a secrets manager.`;
  document.body.appendChild(warn);
  setTimeout(() => { if (warn.parentNode) warn.remove(); }, 6000);
}

function showBehavioralModal(text, el, warnings) {
  if (document.getElementById("shieldvault-behavioral-modal")) return;
  if (el) el.setAttribute("readonly", "true");

  const previewText = text.length > 120 ? text.slice(0, 120).trim() + "..." : text;
  const modal = document.createElement("div");
  modal.id = "shieldvault-behavioral-modal";
  modal.style.cssText = [
    "position:fixed",
    "top:50%",
    "left:50%",
    "transform:translate(-50%,-50%)",
    "background:rgba(255,255,255,0.92)",
    "backdrop-filter:blur(16px) saturate(180%)",
    "color:#1a1a2e",
    "border:1px solid rgba(255,255,255,0.5)",
    "border-radius:12px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.1)",
    "padding:22px 26px",
    "max-width:420px",
    "width:90vw",
    "z-index:2147483647",
    "font-family:system-ui,sans-serif",
    "font-size:14px",
    "line-height:1.5",
  ].join(";");

  const remaining = behavioralQuotaRemaining();
  let quotaLine = "";
  if (!IS_PRO) {
    if (remaining <= 0) {
      quotaLine = `<div style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.3);border-radius:8px;padding:10px 14px;margin-top:12px;text-align:center"><div style="font-size:12px;color:#dc2626;font-weight:700;margin-bottom:4px">Weekly quota used up</div><div style="font-size:11px;color:#6b7280;margin-bottom:8px">Resets Sunday — or never run out again.</div><a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="display:inline-block;background:#1a1a2e;color:#fff;text-decoration:none;padding:7px 16px;border-radius:6px;font-weight:700;font-size:12px">Unlock unlimited →</a></div>`;
    } else if (remaining <= 3) {
      quotaLine = `<div style="font-size:11px;color:#b45309;text-align:center;margin-top:12px"><strong>${remaining}</strong> free behavioral warning${remaining === 1 ? "" : "s"} left this week — <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="color:#1a1a2e;font-weight:700">upgrade before you run out</a></div>`;
    } else if (remaining === 5) {
      quotaLine = `<div style="font-size:11px;color:#6b7280;text-align:center;margin-top:12px">Halfway through your free warnings this week. <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" style="color:#1a1a2e;font-weight:600">Upgrade for unlimited →</a></div>`;
    } else {
      quotaLine = `<div style="font-size:11px;color:#9ca3af;text-align:center;margin-top:12px">${remaining} of 10 free behavioral warnings remaining this week</div>`;
    }
  }

  modal.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <span style="font-size:20px">🛡️</span>
      <span style="font-size:15px;font-weight:700;color:#1a1a2e">Hold on a sec.</span>
    </div>
    <div style="background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.18);border-radius:8px;padding:10px 12px;margin-bottom:8px">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:5px">You now</div>
      <div style="font-size:13px;color:#374151;font-style:italic;line-height:1.5">${escapeForHtml(previewText)}</div>
    </div>
    <div style="text-align:center;color:#d1d5db;font-size:16px;margin:4px 0">↓</div>
    <div id="sv-suggestions" style="margin-bottom:12px"></div>
    <div id="sv-flag-line" style="font-size:11px;color:#9ca3af;margin-bottom:14px">Flagged: <span id="sv-flag-names" style="color:#b45309"></span></div>
    <div style="display:flex;gap:8px;justify-content:flex-end">
      <button id="sv-send-btn" style="padding:8px 16px;border-radius:7px;border:1.5px solid #e5e7eb;background:transparent;color:#6b7280;cursor:pointer;font-size:13px">Send Anyway</button>
      <button id="sv-edit-btn" style="padding:8px 18px;border-radius:7px;border:none;background:#1a1a2e;color:#fff;cursor:pointer;font-size:13px;font-weight:600">Edit Message</button>
    </div>
    ${quotaLine}
  `;

  document.body.appendChild(modal);

  const flagNames = modal.querySelector("#sv-flag-names");
  const sendBtn = modal.querySelector("#sv-send-btn");
  const editBtn = modal.querySelector("#sv-edit-btn");
  const suggestionBox = modal.querySelector("#sv-suggestions");

  const flagLabels = warnings.map(w => w.name);
  if (flagNames) flagNames.textContent = flagLabels.join(" · ");

  const seenSuggestions = new Set();
  for (const w of warnings) {
    const detector = BEHAVIORAL_DETECTORS.find(d => d.name === w.name);
    if (detector?.suggestion && !seenSuggestions.has(detector.suggestion)) {
      seenSuggestions.add(detector.suggestion);
      const tipBox = document.createElement("div");
      tipBox.style.cssText = "background:rgba(34,197,94,0.06);border:1px solid rgba(34,197,94,0.2);border-radius:8px;padding:10px 12px;margin-bottom:8px;";
      const tipLabel = document.createElement("div");
      tipLabel.style.cssText = "font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#9ca3af;margin-bottom:5px;";
      tipLabel.textContent = "Possibly better you now";
      tipBox.appendChild(tipLabel);
      const tipLine = document.createElement("p");
      tipLine.style.cssText = "margin:0;font-size:13px;color:#374151;font-style:italic;line-height:1.5;";
      tipLine.textContent = detector.suggestion;
      tipBox.appendChild(tipLine);
      suggestionBox.appendChild(tipBox);
    }
  }

  sendBtn.addEventListener("click", () => {
    if (el) {
      el.removeAttribute("readonly");
      el.dataset.shieldvaultBypass = "true";
    }
    modal.remove();
    // Re-trigger send naturally
    setTimeout(() => {
      if (el) {
        el.focus();
        // Let user click their own send button
      }
    }, 50);
  });

  editBtn.addEventListener("click", () => {
    if (el) {
      el.removeAttribute("readonly");
      el.focus();
      setCooldown(el);
    }
    modal.remove();
  });
}

function escapeForHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ================================
// CORE DETECTION HANDLER
// v1.5 changes:
//   - Secrets, confidential, code blocks: NO paywall, never gated
//   - Behavioral: paywall fires only when free quota exhausted
// ================================
function handleDetection(text, el, vector, event) {
  // --- Secrets: ALWAYS FREE, ALWAYS BLOCK ---
  const secretMatches = detectSecrets(text);
  if (secretMatches.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }

    if (el) {
      delete el.dataset.shieldvaultBypass;
      hardNullify(el);
      liftAndFadeGhost(el, text, "SECRET BLOCKED");
    }

    playBlockSound();
    notifyBackground(secretMatches, vector, "secret", text, "high");

    for (const name of secretMatches) {
      const count = trackRepeatOffender(name);
      if (count && el) {
        showRepeatOffenderWarning(el, name, count);
      }
    }

    if (vector === "paste" && el) {
      showClipboardClearOffer(el);
    }

    // Nudge free users toward behavioral protection after a secret block
    showSecretsUpgradeNudge(el);

    devWarn(`Blocked: ${secretMatches.join(", ")} via ${vector}`);
    return true;
  }

  // --- Soft checks: bypass and cooldown apply below ---
  if (el && el.dataset.shieldvaultBypass === "true") return false;
  if (el && isOnCooldown(el)) return false;

  // --- Confidential docs: ALWAYS FREE ---
  const confidentialMatches = detectConfidential(text);
  if (confidentialMatches.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    showBehavioralModal(text, el, confidentialMatches);
    playBlockSound();
    notifyBackground(confidentialMatches.map(c => c.name), vector, "confidential", text, "high");
    devWarn(`Confidential warning: ${confidentialMatches.map(c => c.name).join(", ")} via ${vector}`);
    return true;
  }

  // --- Code blocks: ALWAYS FREE ---
  const codeMatches = detectCodeBlocks(text);
  if (codeMatches.length > 0) {
    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    showBehavioralModal(text, el, codeMatches);
    playBlockSound();
    notifyBackground(codeMatches.map(c => c.name), vector, "codeblock", text, "medium");
    devWarn(`Code block warning: ${codeMatches.map(c => c.name).join(", ")} via ${vector}`);
    return true;
  }

  // --- Behavioral: free up to BEHAVIORAL_FREE_LIMIT/week, unlimited Pro ---
  const behaviorMatches = detectBehaviors(text);
  if (behaviorMatches.length > 0) {
    if (!IS_PRO && BEHAVIORAL_USES >= BEHAVIORAL_FREE_LIMIT) {
      // User is over the weekly limit.
      // If upgrade modal is in quiet period (just shown / explicitly dismissed),
      // fall through to a normal behavioral catch instead of nagging again.
      // This preserves the safety friction without spamming the upgrade prompt.
      if (!isUpgradeModalQuiet()) {
        if (event && typeof event.preventDefault === "function") {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
        if (el) setCooldown(el);
        const topMatch = behaviorMatches.find(m => m.severity === "high") || behaviorMatches[0];
        showBehavioralUpgradeModal(topMatch ? topMatch.name : null);
        return true;
      }
      // else: quiet period active — fall through to behavioral modal below
    }

    if (event && typeof event.preventDefault === "function") {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
    if (!IS_PRO) incrementBehavioralUse();
    showBehavioralModal(text, el, behaviorMatches);
    playBlockSound();
    const topSeverity = behaviorMatches.some(m => m.severity === "high") ? "high"
                       : behaviorMatches.some(m => m.severity === "medium") ? "medium"
                       : "low";
    notifyBackground(behaviorMatches.map(b => b.name), vector, "behavioral", text, topSeverity);
    devWarn(`Behavioral: ${behaviorMatches.map(b => b.name).join(", ")} via ${vector}, uses now ${BEHAVIORAL_USES}`);
    return true;
  }

  return false;
}

// ================================
// EVENT HOOKS
// v1.5: input handler debounced to remove keystroke lag
// ================================

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

document.addEventListener(
  "paste",
  (e) => {
    const pasted = (e.clipboardData || window.clipboardData)?.getData("text") || "";
    if (!pasted) return;
    const el = getActiveEditable();
    handleDetection(pasted, el, "paste", e);
  },
  true
);

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

// Debounced input fallback — runs 250ms after last keystroke
let inputDebounceTimer = null;
let lastDebouncedEl = null;

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

    lastDebouncedEl = el;
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      const targetEl = lastDebouncedEl;
      if (!targetEl) return;
      const value = getValue(targetEl);
      if (!value) return;

      // Secrets first — fast, always free
      const secretMatches = detectSecrets(value);
      if (secretMatches.length > 0) {
        delete targetEl.dataset.shieldvaultBypass;
        hardNullify(targetEl);
        liftAndFadeGhost(targetEl, value, "SECRET BLOCKED");
        playBlockSound();
        notifyBackground(secretMatches, "input-fallback", "secret", value, "high");
        setCooldown(targetEl);
        devWarn(`Fallback blocked: ${secretMatches.join(", ")}`);
        return;
      }

      if (targetEl.dataset.shieldvaultBypass === "true") return;
      if (isOnCooldown(targetEl)) return;

      const confidentialMatches = detectConfidential(value);
      if (confidentialMatches.length > 0) {
        showBehavioralModal(value, targetEl, confidentialMatches);
        notifyBackground(confidentialMatches.map(c => c.name), "input-fallback", "confidential", value, "high");
        return;
      }

      const codeMatches = detectCodeBlocks(value);
      if (codeMatches.length > 0) {
        showBehavioralModal(value, targetEl, codeMatches);
        notifyBackground(codeMatches.map(c => c.name), "input-fallback", "codeblock", value, "medium");
        return;
      }

      const behaviorMatches = detectBehaviors(value);
      if (behaviorMatches.length > 0) {
        if (!IS_PRO && BEHAVIORAL_USES >= BEHAVIORAL_FREE_LIMIT) {
          // Same logic as main handler: respect upgrade modal quiet period.
          // If user just dismissed the upgrade modal, fall through to the
          // regular behavioral modal instead of nagging again.
          if (!isUpgradeModalQuiet()) {
            if (targetEl) setCooldown(targetEl);
            showBehavioralUpgradeModal();
            return;
          }
          // else: quiet period active — fall through to behavioral modal below
        }
        if (!IS_PRO) incrementBehavioralUse();
        showBehavioralModal(value, targetEl, behaviorMatches);
        const topSev = behaviorMatches.some(m => m.severity === "high") ? "high"
                     : behaviorMatches.some(m => m.severity === "medium") ? "medium"
                     : "low";
        notifyBackground(behaviorMatches.map(b => b.name), "input-fallback", "behavioral", value, topSev);
      }
    }, 250);
  },
  true
);

// ================================
// INIT
// ================================
devLog("Content script v1.5.0 loaded —", DETECTORS.length, "secret detectors,", BEHAVIORAL_DETECTORS.length, "behavioral detectors,", CONFIDENTIAL_DETECTORS.length, "confidential detectors");
