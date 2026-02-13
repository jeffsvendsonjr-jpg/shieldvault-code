
// ======================================================
// ShieldVault — Proofs UI Script
// License verification via ShieldVault API
// ======================================================

// ================================
// API CONFIG
// UPDATE THIS URL AFTER PUBLISHING YOUR REPLIT APP
// ================================
const API_BASE = "https://extension-paywall.replit.app";

// ================================
// DOM ELEMENTS
// ================================
const countEl = document.getElementById("count");
const emptyEl = document.getElementById("empty-state");
const listEl = document.getElementById("proof-list");
const clearBtn = document.getElementById("clear-btn");

const proSection = document.getElementById("pro-section");
const proActive = document.getElementById("pro-active");
const licenseInputSection = document.getElementById("license-input-section");
const licenseKeyInput = document.getElementById("license-key-input");
const licenseError = document.getElementById("license-error");
const btnMonthly = document.getElementById("btn-monthly");
const btnAlreadyPurchased = document.getElementById("btn-already-purchased");
const btnActivate = document.getElementById("btn-activate");
const btnCancelActivate = document.getElementById("btn-cancel-activate");
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
function showView(view) {
  proSection.style.display = "none";
  proActive.style.display = "none";
  licenseInputSection.style.display = "none";

  if (view === "upgrade") {
    proSection.style.display = "block";
  } else if (view === "active") {
    proActive.style.display = "block";
  } else if (view === "input") {
    licenseInputSection.style.display = "block";
  }
}

function loadProStatus() {
  chrome.storage.local.get(["shieldvault_pro", "shieldvault_license_key"], (result) => {
    if (result.shieldvault_pro === true && result.shieldvault_license_key) {
      verifyStoredLicense(result.shieldvault_license_key);
    } else {
      showView("upgrade");
    }
  });
}

function verifyStoredLicense(key) {
  fetch(`${API_BASE}/api/license/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key })
  })
  .then(res => res.json())
  .then(data => {
    if (data.valid) {
      showView("active");
    } else {
      chrome.storage.local.remove(["shieldvault_pro", "shieldvault_license_key"]);
      showView("upgrade");
    }
  })
  .catch(() => {
    chrome.storage.local.remove(["shieldvault_pro", "shieldvault_license_key"]);
    showView("upgrade");
  });
}

function activateLicense(key) {
  licenseError.style.display = "none";
  btnActivate.disabled = true;
  btnActivate.textContent = "Verifying...";

  fetch(`${API_BASE}/api/license/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key })
  })
  .then(res => res.json())
  .then(data => {
    if (data.valid) {
      chrome.storage.local.set({
        shieldvault_pro: true,
        shieldvault_license_key: key
      }, () => {
        showView("active");
      });
    } else {
      licenseError.textContent = "Invalid or expired license key.";
      licenseError.style.display = "block";
    }
  })
  .catch(() => {
    licenseError.textContent = "Could not verify. Check your connection.";
    licenseError.style.display = "block";
  })
  .finally(() => {
    btnActivate.disabled = false;
    btnActivate.textContent = "Activate";
  });
}

// ================================
// EVENT HANDLERS
// ================================

clearBtn.addEventListener("click", () => {
  if (confirm("Clear all prevention records for this session?")) {
    chrome.runtime.sendMessage({ type: "CLEAR_PROOFS" }, () => {
      loadProofs();
    });
  }
});

btnMonthly.addEventListener("click", () => {
  chrome.tabs.create({ url: API_BASE });
});

btnAlreadyPurchased.addEventListener("click", () => {
  showView("input");
  licenseKeyInput.value = "";
  licenseError.style.display = "none";
  licenseKeyInput.focus();
});

btnCancelActivate.addEventListener("click", () => {
  showView("upgrade");
});

btnActivate.addEventListener("click", () => {
  const key = licenseKeyInput.value.trim();
  if (!key) {
    licenseError.textContent = "Please enter a license key.";
    licenseError.style.display = "block";
    return;
  }
  activateLicense(key);
});

licenseKeyInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    btnActivate.click();
  }
});

btnResetPro.addEventListener("click", () => {
  if (confirm("Deactivate your Pro status?")) {
    chrome.storage.local.remove(["shieldvault_pro", "shieldvault_license_key"], () => {
      showView("upgrade");
    });
  }
});

// ================================
// INIT
// ================================
loadProofs();
loadProStatus();

setInterval(loadProofs, 5000);
