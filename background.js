// ======================================================
// ShieldVault — Background Service Worker
// Persistent Proofs of Prevention
// No secrets stored — only metadata (domain, time, type)
// ======================================================

// ================================
// IN-MEMORY STATE
// ================================
let proofs = [];
let stats = {
  totalSecretsBlocked: 0,
  totalBehavioralWarnings: 0,
  firstInstalled: null
};
let storageLoaded = false;
let pendingMessages = [];

// ================================
// PERSISTENCE (chrome.storage.local)
// ================================
function loadFromStorage() {
  chrome.storage.local.get(["shieldvault_proofs", "shieldvault_stats"], (result) => {
    if (result.shieldvault_proofs && Array.isArray(result.shieldvault_proofs)) {
      proofs = result.shieldvault_proofs;
    }
    if (result.shieldvault_stats) {
      stats = { ...stats, ...result.shieldvault_stats };
    }
    if (!stats.firstInstalled) {
      stats.firstInstalled = Date.now();
      saveStats();
    }

    storageLoaded = true;

    for (const queued of pendingMessages) {
      processPreventedMessage(queued.msg, queued.sender);
    }
    pendingMessages = [];
  });
}

function saveProofs() {
  chrome.storage.local.set({ shieldvault_proofs: proofs });
}

function saveStats() {
  chrome.storage.local.set({ shieldvault_stats: stats });
}

loadFromStorage();

// ================================
// EVENT PROCESSING
// ================================
function processPreventedMessage(msg, sender) {
  const detectors = msg.detectors || ["Unknown"];
  const category = msg.category || "secret";

  const proof = {
    id: crypto.randomUUID(),
    time: Date.now(),
    domain: "unknown",
    detectors: detectors.map(d => typeof d === "object" ? d.name : d),
    vector: msg.vector || "input",
    category: category,
    // v1.5 richer metadata for v2 prep — local only, no content stored
    hourOfDay: typeof msg.hourOfDay === "number" ? msg.hourOfDay : new Date().getHours(),
    dayOfWeek: typeof msg.dayOfWeek === "number" ? msg.dayOfWeek : new Date().getDay(),
    inputLength: typeof msg.inputLength === "number" ? msg.inputLength : 0,
    severity: msg.severity || null
  };

  if (sender?.tab?.url) {
    try {
      proof.domain = new URL(sender.tab.url).hostname;
    } catch {}
  } else if (sender?.url) {
    try {
      proof.domain = new URL(sender.url).hostname;
    } catch {}
  }

  proofs.unshift(proof);
  if (proofs.length > 200) proofs.length = 200;

  if (category === "behavioral") {
    stats.totalBehavioralWarnings++;
  } else {
    stats.totalSecretsBlocked++;
  }

  saveProofs();
  saveStats();
}

// ================================
// MESSAGE HANDLERS
// ================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg?.type === "SHIELDVAULT_PREVENTED") {
    if (!storageLoaded) {
      pendingMessages.push({ msg, sender });
    } else {
      processPreventedMessage(msg, sender);
    }
    return;
  }

  if (msg?.type === "GET_PROOFS") {
    sendResponse({ proofs, stats });
    return true;
  }

  if (msg?.type === "CLEAR_PROOFS") {
    proofs.length = 0;
    saveProofs();
    sendResponse({ success: true });
    return true;
  }

  if (msg?.type === "GET_STATS") {
    sendResponse({ stats });
    return true;
  }
});
