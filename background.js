// ======================================================
// ShieldVault — Background Service Worker
// Session-only Proofs of Prevention
// No storage, no telemetry, no persistence
// ======================================================

// ================================
// SESSION MEMORY (dies with browser)
// ================================
const proofs = [];

// ================================
// MESSAGE HANDLERS
// ================================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  if (msg?.type === "SHIELDVAULT_PREVENTED") {
    const proof = {
      id: crypto.randomUUID(),
      time: Date.now(),
      domain: "unknown",
      detectors: msg.detectors || ["Unknown"],
      vector: msg.vector || "input"
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
    if (proofs.length > 100) proofs.pop();
    return;
  }

  if (msg?.type === "GET_PROOFS") {
    sendResponse({ proofs });
    return true;
  }

  if (msg?.type === "CLEAR_PROOFS") {
    proofs.length = 0;
    sendResponse({ success: true });
    return true;
  }
});
