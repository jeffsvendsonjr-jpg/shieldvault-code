// ======================================================
// ShieldVault — Proofs UI Script v1.5.1
// License verification via ShieldVault API
// ======================================================

// ================================
// API CONFIG
// ================================
const API_BASE = "https://shieldvault.site";

async function apiFetch(path, options) {
  const response = await fetch(API_BASE + path, options);

  if (!response.ok) {
    throw new Error(`ShieldVault API request failed with status ${response.status}`);
  }

  return response;
}

// ================================
// DEFAULT SETTINGS
// ================================
const DEFAULT_SETTINGS = {
  secretDetection: true,
  behavioralDetection: true,
  confidentialDetection: true,
  codeBlockDetection: true,
  piiDetection: true,
  piiDetectionSSN: true,
  piiDetectionCreditCard: true,
  piiDetectionPhone: false,
  piiDetectionAddress: false,
  lateNightGuard: false,
  repeatOffenderWarnings: true,
  clipboardClear: true,
  soundOnBlock: false,
};

// ================================
// DOM ELEMENTS
// ================================
const emptyEl = document.getElementById("empty-state");
const listEl = document.getElementById("proof-list");
const clearBtn = document.getElementById("clear-btn");
const exportBtn = document.getElementById("export-btn");

const statSecrets = document.getElementById("stat-secrets");
const statBehavioral = document.getElementById("stat-behavioral");
const statDays = document.getElementById("stat-days");

const proSection = document.getElementById("pro-section");
const proActive = document.getElementById("pro-active");
const licenseInputSection = document.getElementById("license-input-section");
const licenseKeyInput = document.getElementById("license-key-input");
const licenseError = document.getElementById("license-error");

const btnMonthly = document.getElementById("btn-monthly");
const btnLifetime = document.getElementById("btn-lifetime");
const btnAlreadyPurchased = document.getElementById("btn-already-purchased");
const btnActivate = document.getElementById("btn-activate");
const btnCancelActivate = document.getElementById("btn-cancel-activate");
const btnResetPro = document.getElementById("btn-reset-pro");

const quotaStatus = document.getElementById("sv-quota-status");
const firstRunDemo = document.getElementById("first-run-demo");

// ================================
// TAB SWITCHING
// ================================
const tabButtons = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-content");

function activateTab(target) {
  tabButtons.forEach(b => b.classList.remove("active"));
  tabPanels.forEach(p => p.classList.remove("active"));
  const targetBtn = document.querySelector(`.tab-btn[data-tab="${target}"]`);
  const targetPanel = document.getElementById(`panel-${target}`);
  if (targetBtn) targetBtn.classList.add("active");
  if (targetPanel) targetPanel.classList.add("active");
}

tabButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.tab;
    activateTab(target);
  });
});

// ================================
// SETTINGS CALLOUT (v1.5)
// Shown until user dismisses it. Dismissed state stored in chrome.storage.local
// so it doesn't reappear on every popup open.
// ================================
const settingsCallout = document.getElementById("settings-callout");
const settingsCalloutDismissBtn = document.getElementById("settings-callout-dismiss");
const demoSettingsLink = document.getElementById("demo-settings-link");

function loadCalloutState() {
  if (!settingsCallout) return;
  chrome.storage.local.get(["shieldvault_settings_callout_dismissed"], (result) => {
    if (result.shieldvault_settings_callout_dismissed === true) {
      settingsCallout.classList.add("dismissed");
    }
  });
}

if (settingsCalloutDismissBtn) {
  settingsCalloutDismissBtn.addEventListener("click", () => {
    if (settingsCallout) settingsCallout.classList.add("dismissed");
    chrome.storage.local.set({ shieldvault_settings_callout_dismissed: true });
  });
}

if (demoSettingsLink) {
  demoSettingsLink.addEventListener("click", (e) => {
    e.preventDefault();
    activateTab("settings");
  });
}

// ================================
// SETTINGS MANAGEMENT
// ================================
let currentSettings = { ...DEFAULT_SETTINGS };

function loadSettingsUI() {
  chrome.storage.local.get(["shieldvault_settings"], (result) => {
    if (result.shieldvault_settings) {
      currentSettings = { ...DEFAULT_SETTINGS, ...result.shieldvault_settings };
    }
    syncSettingsToUI();
  });
}

function syncSettingsToUI() {
  document.querySelectorAll(".toggle-input").forEach(input => {
    const key = input.dataset.setting;
    if (key && currentSettings[key] !== undefined) {
      input.checked = currentSettings[key];
    }
  });
}

function saveSettings() {
  chrome.storage.local.set({ shieldvault_settings: currentSettings });
}

document.querySelectorAll(".toggle-input").forEach(input => {
  input.addEventListener("change", () => {
    const key = input.dataset.setting;
    if (key) {
      currentSettings[key] = input.checked;
      saveSettings();
    }
  });
});

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

function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit"
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

function daysSince(timestamp) {
  if (!timestamp) return 0;
  const diff = Date.now() - timestamp;
  return Math.max(1, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

// ================================
// STATS RENDERING
// ================================
function renderStats(stats) {
  if (!stats) return;
  statSecrets.textContent = stats.totalSecretsBlocked || 0;
  statBehavioral.textContent = stats.totalBehavioralWarnings || 0;
  statDays.textContent = daysSince(stats.firstInstalled);
}

// ================================
// PROOFS RENDERING
// ================================
function renderProofs(proofs) {
  if (!proofs || proofs.length === 0) {
    emptyEl.style.display = "block";
    listEl.style.display = "none";
    listEl.innerHTML = "";
    updateFirstRunVisibility(0);
    return;
  }

  emptyEl.style.display = "none";
  listEl.style.display = "flex";

  listEl.innerHTML = proofs.slice(0, 50).map(proof => {
    const category = proof.category || "secret";
    const categoryClass = `proof-${category}`;
    const tagClass = `tag-${category === "secret" ? "detector" : category}`;

    return `
      <div class="proof-item ${categoryClass}">
        <div class="proof-header">
          <span class="proof-domain">${escapeHtml(proof.domain)}</span>
          <span class="proof-time">${formatTime(proof.time)}</span>
        </div>
        <div class="proof-details">
          ${proof.detectors.map(d => `<span class="tag ${tagClass}">${escapeHtml(d)}</span>`).join("")}
          <span class="tag tag-vector">${escapeHtml(vectorLabel(proof.vector))}</span>
        </div>
      </div>
    `;
  }).join("");

  updateFirstRunVisibility(proofs.length);
}

function updateFirstRunVisibility(proofCount) {
  if (!firstRunDemo) return;
  // Hide demo once user has any real activity OR is Pro
  const isPro = proActive && getComputedStyle(proActive).display !== "none";
  if (proofCount > 0 || isPro) {
    firstRunDemo.style.display = "none";
  } else {
    firstRunDemo.style.display = "";
  }
}

function loadProofs() {
  chrome.runtime.sendMessage({ type: "GET_PROOFS" }, (response) => {
    if (chrome.runtime.lastError) {
      console.error("Failed to get proofs:", chrome.runtime.lastError);
      return;
    }
    renderProofs(response?.proofs || []);
    renderStats(response?.stats || {});
  });
}

// ================================
// EXPORT
// ================================
function exportStats() {
  chrome.runtime.sendMessage({ type: "GET_PROOFS" }, (response) => {
    if (chrome.runtime.lastError) return;

    const stats = response?.stats || {};
    const proofs = response?.proofs || [];

    let report = "ShieldVault Prevention Report\n";
    report += "=============================\n\n";
    report += `Generated: ${formatDate(Date.now())}\n`;
    report += `Protected since: ${stats.firstInstalled ? formatDate(stats.firstInstalled) : "Unknown"}\n`;
    report += `Days protected: ${daysSince(stats.firstInstalled)}\n\n`;
    report += `Total secrets blocked: ${stats.totalSecretsBlocked || 0}\n`;
    report += `Total messages paused: ${stats.totalBehavioralWarnings || 0}\n\n`;
    report += "Recent Activity\n";
    report += "---------------\n";

    if (proofs.length === 0) {
      report += "No activity recorded.\n";
    } else {
      for (const p of proofs.slice(0, 50)) {
        report += `${formatDate(p.time)} | ${p.domain} | ${p.detectors.join(", ")} | ${vectorLabel(p.vector)} | ${p.category || "secret"}\n`;
      }
    }

    const blob = new Blob([report], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shieldvault-report-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

function exportStatsJSON() {
  chrome.runtime.sendMessage({ type: "GET_PROOFS" }, (response) => {
    if (chrome.runtime.lastError) return;

    const stats = response?.stats || {};
    const proofs = response?.proofs || [];

    const data = {
      generated: new Date().toISOString(),
      stats: {
        totalSecretsBlocked: stats.totalSecretsBlocked || 0,
        totalBehavioralWarnings: stats.totalBehavioralWarnings || 0,
        daysProtected: daysSince(stats.firstInstalled),
        firstInstalled: stats.firstInstalled ? new Date(stats.firstInstalled).toISOString() : null,
      },
      activity: proofs.slice(0, 200).map(p => ({
        time: new Date(p.time).toISOString(),
        domain: p.domain,
        detectors: p.detectors,
        vector: p.vector,
        category: p.category || "secret",
      })),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shieldvault-report-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
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
  chrome.storage.local.get(
    ["shieldvault_pro", "shieldvault_license_key", "shieldvault_behavioral_uses"],
    (result) => {
      const quotaBadge = document.getElementById("sv-behavioral-quota-badge");
      if (result.shieldvault_pro === true && result.shieldvault_license_key) {
        verifyStoredLicense(result.shieldvault_license_key);
        if (quotaBadge) {
          quotaBadge.textContent = "unlimited ✓";
          quotaBadge.style.color = "#34d399";
        }
      } else {
        const uses = typeof result.shieldvault_behavioral_uses === "number"
          ? result.shieldvault_behavioral_uses
          : 0;
        const remaining = Math.max(0, 10 - uses);
        if (quotaStatus) {
          if (remaining > 0) {
            quotaStatus.textContent = `${remaining} of 10 free behavioral warnings remaining this week`;
            quotaStatus.style.color = remaining <= 2 ? "#b45309" : "#9ca3af";
          } else {
            quotaStatus.textContent = "Behavioral warning quota used — resets Sunday";
            quotaStatus.style.color = "#dc2626";
            quotaStatus.style.fontWeight = "600";
          }
        }
        if (quotaBadge) {
          if (remaining <= 0) {
            quotaBadge.textContent = "0 of 10 free/week — upgrade";
            quotaBadge.style.color = "#dc2626";
            quotaBadge.style.fontWeight = "700";
          } else if (remaining <= 3) {
            quotaBadge.textContent = `${remaining} of 10 free warnings left this week`;
            quotaBadge.style.color = "#b45309";
            quotaBadge.style.fontWeight = "600";
          } else {
            quotaBadge.textContent = `${remaining} of 10 free warnings/week`;
            quotaBadge.style.color = "";
          }
        }
        showView("upgrade");
      }
    }
  );
}

function verifyStoredLicense(key) {
  apiFetch("/api/license/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key })
  })
    .then(res => res.json())
    .then(data => {
      if (data.valid) {
        chrome.storage.local.set({ shieldvault_tier: "plus" });
        showView("active");
      } else {
        // Server says invalid. Downgrade Pro flag but KEEP the key cached
        // so the user can retry without having to re-enter from email.
        chrome.storage.local.set({ shieldvault_pro: false });
        showView("upgrade");
      }
    })
    .catch(() => {
      // Network failure — keep last known Pro state (offline-tolerant).
      // TODO v1.5.1: implement grace-period expiry to prevent indefinite
      // free Pro by hosts-blocking the verify endpoint.
      showView("active");
    });
}

function activateLicense(key) {
  licenseError.style.display = "none";
  btnActivate.disabled = true;
  btnActivate.textContent = "Verifying...";

  apiFetch("/api/license/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ licenseKey: key })
  })
    .then(res => res.json())
    .then(data => {
      if (data.valid) {
        chrome.storage.local.set({
          shieldvault_pro: true,
          shieldvault_license_key: key,
          shieldvault_tier: "plus"
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
// FIRST RUN DEMO
// ================================
function setupFirstRunDemo() {
  const demoInput = document.getElementById("demo-input");
  const demoResult = document.getElementById("demo-result");
  const demoTitle = document.getElementById("demo-result-title");
  const demoCopy = document.getElementById("demo-result-copy");

  if (!demoInput || !demoResult) return;

  function showDemoUpsell(container, type) {
    const existingUpsell = container.querySelector(".demo-upsell");
    if (existingUpsell) existingUpsell.remove();
    const upsell = document.createElement("p");
    upsell.className = "demo-upsell";
    upsell.innerHTML = type === "behavioral"
      ? `Behavioral checks: 10 free/week. <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" class="demo-upsell-link">Unlock unlimited →</a>`
      : `Secrets are always blocked free. Want unlimited behavioral protection too? <a href="https://shieldvault.site/api/checkout/quick?plan=lifetime" target="_blank" class="demo-upsell-link">See plans →</a>`;
    container.appendChild(upsell);
  }

  function isSecret(text) {
    return [
      /sk_(test|live)_[A-Za-z0-9]+/i,
      /sk-[A-Za-z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /ghp_[A-Za-z0-9]{36}/,
      /password\d*!?/i,
      /(?:api|secret|token|key)[_\-:=\s]+[A-Za-z0-9_\-]{6,}/i
    ].some((rx) => rx.test(text));
  }

  function isBehavioral(text) {
    const upper = text.replace(/[^A-Z]/g, "").length;
    const letters = text.replace(/[^A-Za-z]/g, "").length;
    const capsRatio = letters ? upper / letters : 0;
    return (
      capsRatio > 0.65 ||
      /!{3,}|\?{3,}/.test(text) ||
      /(ridiculous|kidding|done with this|idiot|stupid|per my last|with all due respect)/i.test(text)
    );
  }

  function runDemo() {
    const value = demoInput.value.trim();
    demoResult.classList.remove("show", "secret", "behavioral");
    demoTitle.textContent = "";
    demoCopy.textContent = "";
    const existingUpsell = demoResult.querySelector(".demo-upsell");
    if (existingUpsell) existingUpsell.remove();

    if (!value) return;

    if (isSecret(value)) {
      demoResult.classList.add("show", "secret");
      demoTitle.textContent = "Blocked before it left your device";
      demoCopy.textContent = "ShieldVault catches sensitive data before it slips out.";
      showDemoUpsell(demoResult, "secret");
      return;
    }

    if (isBehavioral(value)) {
      demoResult.classList.add("show", "behavioral");
      demoTitle.textContent = "Pause before sending?";
      demoCopy.textContent = "Written hot. Read cold.";
      showDemoUpsell(demoResult, "behavioral");
    }
  }

  demoInput.addEventListener("input", runDemo);

  document.querySelectorAll("[data-demo-value]").forEach((button) => {
    button.addEventListener("click", () => {
      demoInput.value = button.getAttribute("data-demo-value") || "";
      runDemo();
    });
  });
}

// ================================
// PAUSED SITES MANAGEMENT
// ================================
function loadPausedSites() {
  chrome.storage.local.get(["shieldvault_paused_domains"], (result) => {
    renderPausedSites(result.shieldvault_paused_domains || []);
  });
}

function renderPausedSites(domains) {
  const listEl = document.getElementById("paused-sites-list");
  if (!listEl) return;
  if (!domains || domains.length === 0) {
    listEl.innerHTML = '<p style="font-size:12px;color:#6b7280;margin:8px 0 0">No sites paused. Use "Pause on this site" in a warning to silence ShieldVault on a domain.</p>';
    return;
  }
  listEl.innerHTML = domains.map(d => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <span style="font-size:12px;color:#e6e8ee">${escapeHtml(d)}</span>
      <button class="paused-site-remove" data-domain="${escapeHtml(d)}" style="background:transparent;border:1px solid rgba(255,255,255,0.15);color:#9ca3af;font-size:11px;cursor:pointer;padding:3px 8px;border-radius:4px">Re-enable</button>
    </div>
  `).join("");
  listEl.querySelectorAll(".paused-site-remove").forEach(btn => {
    btn.addEventListener("click", () => {
      const domain = btn.dataset.domain;
      chrome.storage.local.get(["shieldvault_paused_domains"], (result) => {
        const updated = (result.shieldvault_paused_domains || []).filter(d => d !== domain);
        chrome.storage.local.set({ shieldvault_paused_domains: updated }, () => {
          renderPausedSites(updated);
        });
      });
    });
  });
}

// ================================
// EVENT HANDLERS
// ================================

clearBtn.addEventListener("click", () => {
  if (confirm("Clear activity log? Lifetime stats will be kept.")) {
    chrome.runtime.sendMessage({ type: "CLEAR_PROOFS" }, () => {
      loadProofs();
    });
  }
});

exportBtn.addEventListener("click", () => {
  exportStats();
});

const exportJsonBtn = document.getElementById("export-json-btn");
if (exportJsonBtn) {
  exportJsonBtn.addEventListener("click", () => {
    exportStatsJSON();
  });
}

if (btnMonthly) {
  btnMonthly.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://shieldvault.site/api/checkout/quick?plan=monthly" });
  });
}

if (btnLifetime) {
  btnLifetime.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://shieldvault.site/api/checkout/quick?plan=lifetime" });
  });
}

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
    chrome.storage.local.remove(["shieldvault_pro", "shieldvault_license_key", "shieldvault_tier"], () => {
      showView("upgrade");
    });
  }
});

// ================================
// INIT
// ================================
loadProofs();
loadProStatus();
loadSettingsUI();
setupFirstRunDemo();
loadCalloutState();
loadPausedSites();

// Live-update popup when proofs or stats change (replaces polling)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.shieldvault_proofs || changes.shieldvault_stats) {
    loadProofs();
  }
  if (changes.shieldvault_paused_domains) {
    renderPausedSites(changes.shieldvault_paused_domains.newValue || []);
  }
});
