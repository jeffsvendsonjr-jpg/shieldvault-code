// ======================================================
// ShieldVault — Proofs UI Script
// ======================================================

// ================================
// LEMON SQUEEZY CHECKOUT URLS
// ================================
// TODO: Replace these with your actual LemonSqueezy checkout URLs
const CHECKOUT_MONTHLY = "https://shieldvault.lemonsqueezy.com/checkout/buy/ee38807a-cf0d-490d-afd6-26f7b665f005";
const CHECKOUT_LIFETIME = "https://shieldvault.lemonsqueezy.com/checkout/buy/2953ace7-4e2f-4dc5-85a8-675674a8f70f";

// ================================
// DOM ELEMENTS
// ================================
const countEl = document.getElementById("count");
const emptyEl = document.getElementById("empty-state");
const listEl = document.getElementById("proof-list");
const clearBtn = document.getElementById("clear-btn");

// Pro elements
const proSection = document.getElementById("pro-section");
const proActive = document.getElementById("pro-active");
const btnMonthly = document.getElementById("btn-monthly");
const btnLifetime = document.getElementById("btn-lifetime");
const btnAlreadyPurchased = document.getElementById("btn-already-purchased");
const btnResetPro = document.getElementById("btn-reset-pro");

// ================================
// HELPERS
// ================================
function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function vectorLabel(vector) {
  const labels = {
    "typed": "Typed",
    "paste": "Pasted",
    "submit": "Submit blocked",
    "input-fallback": "Auto-detected"
  };
  return labels[vector] || vector;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ================================
// PROOFS RENDERING
// ================================
function renderProofs(proofs) {
  if (!proofs || proofs.length === 0) {
    countEl.textContent = "0 preventions";
    emptyEl.style.display = "block";
    listEl.style.display = "none";
    listEl.innerHTML = "";
    return;
  }

  countEl.textContent = `${proofs.length} prevention${proofs.length === 1 ? "" : "s"}`;
  emptyEl.style.display = "none";
  listEl.style.display = "flex";

  listEl.innerHTML = proofs.map(proof => `
    <div class="proof-item">
      <div class="proof-header">
        <span class="proof-domain">${escapeHtml(proof.domain)}</span>
        <span class="proof-time">${formatTime(proof.time)}</span>
      </div>
      <div class="proof-details">
        ${proof.detectors.map(d => `<span class="tag tag-detector">${escapeHtml(d)}</span>`).join("")}
        <span class="tag tag-vector">${escapeHtml(vectorLabel(proof.vector))}</span>
      </div>
    </div>
  `).join("");
}

function loadProofs() {
  chrome.runtime.sendMessage({ type: "GET_PROOFS" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to get proofs:", chrome.runtime.lastError);
      return;
    }
    renderProofs(response?.proofs || []);
  });
}

// ================================
// PRO STATUS MANAGEMENT
// ================================
function updateProUI(isPro) {
  if (isPro) {
    proSection.style.display = "none";
    proActive.style.display = "block";
  } else {
    proSection.style.display = "block";
    proActive.style.display = "none";
  }
}

function loadProStatus() {
  chrome.storage.local.get(["shieldvault_pro"], (result) => {
    const isPro = result.shieldvault_pro === true;
    updateProUI(isPro);
  });
}

function setProStatus(isPro) {
  chrome.storage.local.set({ shieldvault_pro: isPro }, () => {
    updateProUI(isPro);
  });
}

// ================================
// EVENT HANDLERS
// ================================

// Clear proofs
clearBtn.addEventListener("click", () => {
  if (confirm("Clear all prevention records for this session?")) {
    chrome.runtime.sendMessage({ type: "CLEAR_PROOFS" }, () => {
      loadProofs();
    });
  }
});

// Monthly checkout
btnMonthly.addEventListener("click", () => {
  chrome.tabs.create({ url: CHECKOUT_MONTHLY });
});

// Lifetime checkout
btnLifetime.addEventListener("click", () => {
  chrome.tabs.create({ url: CHECKOUT_LIFETIME });
});

// Already purchased (honor system)
btnAlreadyPurchased.addEventListener("click", () => {
  if (confirm("Thanks for supporting ShieldVault! Click OK to activate Pro.")) {
    setProStatus(true);
  }
});

// Reset Pro status
btnResetPro.addEventListener("click", () => {
  if (confirm("Reset your Pro status?")) {
    setProStatus(false);
  }
});

// ================================
// INIT
// ================================
loadProofs();
loadProStatus();

// Refresh proofs every 5 seconds
setInterval(loadProofs, 5000);
