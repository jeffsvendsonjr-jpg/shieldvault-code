(function () {
  'use strict';

  const API_BASE = 'https://shieldvault.site';

  // ── Proof list ──────────────────────────────────────────────────────────────

  let proofs = [];
  let pausedDomains = [];

  function isBehaviorProof(proof) {
    return proof && proof.category === 'behavioral';
  }

  function proofTimestamp(proof) {
    return proof && (proof.timestamp || proof.ts || Date.now());
  }

  function countPausedDomains(value) {
    if (Array.isArray(value)) return value.length;
    if (value && typeof value === 'object') {
      return Object.keys(value).filter(function (domain) {
        return value[domain] !== false;
      }).length;
    }
    return 0;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value);
  }

  function renderSummary() {
    const secretProofs = proofs.filter(function (proof) {
      return !isBehaviorProof(proof);
    }).length;
    const behaviorProofs = proofs.filter(isBehaviorProof).length;

    setText('summary-events', proofs.length);
    setText('summary-secrets', secretProofs);
    setText('summary-messages', behaviorProofs);
    setText('summary-paused', countPausedDomains(pausedDomains));
  }

  function outcomeForProof(proof) {
    const detectors = Array.isArray(proof.detectors) ? proof.detectors.join(' ').toLowerCase() : '';
    if (isBehaviorProof(proof)) return 'Message cooled down';
    if (detectors.includes('openai')) return 'OpenAI API key protected';
    if (detectors.includes('anthropic')) return 'Anthropic API key protected';
    if (
      detectors.includes('hugging face') ||
      detectors.includes('azure openai') ||
      detectors.includes('cohere') ||
      detectors.includes('mistral') ||
      detectors.includes('groq') ||
      detectors.includes('perplexity') ||
      detectors.includes('openrouter')
    ) {
      return 'AI API key protected';
    }
    if (detectors.includes('github') && (detectors.includes('pat') || detectors.includes('token'))) {
      return 'GitHub PAT protected';
    }
    if (detectors.includes('aws')) return 'AWS credential protected';
    if (
      detectors.includes('vercel') ||
      detectors.includes('netlify') ||
      detectors.includes('cloudflare') ||
      detectors.includes('supabase') ||
      detectors.includes('firebase')
    ) {
      return 'Cloud credential protected';
    }
    if (detectors.includes('slack') || detectors.includes('discord')) return 'Chat token protected';
    if (
      detectors.includes('notion') ||
      detectors.includes('linear') ||
      detectors.includes('airtable') ||
      detectors.includes('shopify') ||
      detectors.includes('sentry') ||
      detectors.includes('posthog')
    ) {
      return 'SaaS token protected';
    }
    if (detectors.includes('credit card') || detectors.includes('card number')) {
      return 'Credit card number protected';
    }
    if (detectors.includes('password')) return 'Password protected';
    if (detectors.includes('private personal info')) return 'Private info protected';
    if (detectors.includes('large sensitive paste')) return 'Code block protected';
    return 'Secret protected';
  }

  function appendMeta(parent, text) {
    if (!text) return;
    const span = document.createElement('span');
    span.textContent = text;
    parent.appendChild(span);
  }

  function appendTag(parent, text, className) {
    if (!text) return;
    const span = document.createElement('span');
    span.className = 'tag ' + className;
    span.textContent = text;
    parent.appendChild(span);
  }

  function renderProofs() {
    const container = document.getElementById('proof-list');
    const empty = document.getElementById('empty-state');
    const count = document.getElementById('count');

    if (!proofs.length) {
      empty.style.display = '';
      container.style.display = 'none';
      count.textContent = '0 protection events';
      renderSummary();
      return;
    }

    empty.style.display = 'none';
    container.style.display = 'flex';
    count.textContent = proofs.length + (proofs.length === 1 ? ' protection event' : ' protection events');

    container.innerHTML = '';
    for (const p of proofs) {
      const item = document.createElement('div');
      item.className = 'proof-item';
      const time = new Date(proofTimestamp(p)).toLocaleString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      const outcome = document.createElement('span');
      outcome.className = 'proof-outcome';
      outcome.textContent = outcomeForProof(p);
      item.appendChild(outcome);

      const meta = document.createElement('div');
      meta.className = 'proof-meta';
      appendMeta(meta, p.domain || 'unknown');
      appendMeta(meta, p.vector || '');
      appendMeta(meta, time);
      item.appendChild(meta);

      const details = document.createElement('div');
      details.className = 'proof-details';
      const detectors = Array.isArray(p.detectors) ? p.detectors : [];
      detectors.forEach(function (detector) {
        appendTag(details, detector, 'tag-detector');
      });
      if (!detectors.length && p.category) appendTag(details, p.category, 'tag-vector');
      item.appendChild(details);

      container.appendChild(item);
    }

    renderSummary();
  }

  document.getElementById('clear-btn').addEventListener('click', function () {
    try {
      chrome.runtime.sendMessage({ type: 'SHIELDVAULT_CLEAR_PROOFS' }, function (response) {
        // Only clear the popup view if the background actually wiped storage and
        // reset the badge — otherwise the UI would desync from persisted state.
        if (chrome.runtime.lastError || !response || response.ok !== true) {
          return;
        }
        proofs = [];
        renderProofs();
      });
    } catch (_) {
      // Leave history intact on messaging failure.
    }
  });

  // Ask background for stored proofs (best-effort; extension may not have any)
  try {
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_GET_PROOFS' }, function (response) {
      if (chrome.runtime.lastError) return;
      if (response && Array.isArray(response.proofs)) {
        proofs = response.proofs;
      }
      if (response && response.pausedDomains) pausedDomains = response.pausedDomains;
      renderProofs();
    });
  } catch (_) {}

  // Live updates while popup is open
  try {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'SHIELDVAULT_PROOF_STORED' || !message.proof) return;
      proofs.unshift(message.proof);
      proofs = proofs.slice(0, 100);
      renderProofs();
    });
  } catch (_) {}

  try {
    const version = chrome.runtime.getManifest().version;
    const versionEl = document.getElementById('manifest-version');
    if (versionEl) versionEl.textContent = 'v' + version;
  } catch (_) {}

  const settingsLink = document.getElementById('open-settings-link');
  if (settingsLink) {
    settingsLink.addEventListener('click', function (e) {
      e.preventDefault();
      if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
      }
    });
  }

  // ── Pause on this site ───────────────────────────────────────────────────────
  (function initPauseControl() {
    const bar = document.getElementById('pause-bar');
    const label = document.getElementById('pause-label');
    const btn = document.getElementById('pause-btn');
    if (!bar || !label || !btn) return;

    let currentDomain = '';

    function render(paused) {
      if (paused) {
        bar.classList.add('paused');
        label.textContent = 'Paused on ' + (currentDomain || 'this site');
        btn.textContent = 'Resume protection';
      } else {
        bar.classList.remove('paused');
        label.textContent = currentDomain
          ? 'Protection active on ' + currentDomain
          : 'Protection active on this site';
        btn.textContent = 'Pause on this site';
      }
    }

    function disableUnsupported(text) {
      label.textContent = text;
      btn.style.display = 'none';
    }

    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs[0] || !tabs[0].url) {
          disableUnsupported('Pause is unavailable here');
          return;
        }
        let host = '';
        try {
          const url = new URL(tabs[0].url);
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            disableUnsupported('Pause is unavailable on this page');
            return;
          }
          host = url.hostname.replace(/^www\./, '');
        } catch (_) {
          disableUnsupported('Pause is unavailable here');
          return;
        }
        currentDomain = host;

        chrome.runtime.sendMessage(
          { type: 'SHIELDVAULT_GET_PAUSE_STATE', domain: host },
          function (response) {
            if (chrome.runtime.lastError) return;
            render(Boolean(response && response.paused));
          }
        );

        btn.addEventListener('click', function () {
          btn.disabled = true;
          chrome.runtime.sendMessage(
            { type: 'SHIELDVAULT_TOGGLE_PAUSE', domain: host },
            function (response) {
              btn.disabled = false;
              if (chrome.runtime.lastError || !response || response.ok !== true) return;
              render(Boolean(response.paused));
              if (response.pausedDomains) {
                pausedDomains = response.pausedDomains;
                renderSummary();
              }
            }
          );
        });
      });
    } catch (_) {
      disableUnsupported('Pause is unavailable here');
    }
  })();

  renderProofs();

  // ── Pro status ───────────────────────────────────────────────────────────────

  // A null/absent expiry means "never expires" (lifetime). Only a positive
  // expiry in the past counts as lapsed.
  function getProStatus() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["shieldvault_pro", "shieldvault_pro_expiry"], (result) => {
        const isPro = result.shieldvault_pro === true;
        const expiry = result.shieldvault_pro_expiry;
        const expired = typeof expiry === 'number' && expiry > 0 && Date.now() > expiry;
        resolve(isPro && !expired);
      });
    });
  }

  // Persist Pro from a server activation/validation response. The server is the
  // source of truth for the plan and when (if ever) it expires:
  //   - lifetime  → data.expiresAt is null/omitted  → stored as null (no expiry)
  //   - monthly   → data.expiresAt is the period end → stored and re-checked
  // We deliberately do NOT invent a local 30-day window here; that previously
  // expired lifetime purchases and never tracked real renewal.
  function saveProStatus(data) {
    const expiry =
      typeof data.expiresAt === 'number' && data.expiresAt > 0 ? data.expiresAt : null;
    chrome.storage.local.set({
      shieldvault_pro: true,
      shieldvault_pro_expiry: expiry,
      shieldvault_pro_plan: data.plan || '',
      shieldvault_license_key: data.key || '',
      shieldvault_tier: data.tier || 'plus',
    });
  }

  function clearProStatus() {
    chrome.storage.local.remove([
      "shieldvault_pro",
      "shieldvault_pro_expiry",
      "shieldvault_pro_plan",
      "shieldvault_license_key",
      "shieldvault_tier",
    ]);
  }

  async function applyProState() {
    const isPro = await getProStatus();
    const sectionUpgrade = document.getElementById('pro-section');
    const sectionActive = document.getElementById('pro-active');
    const sectionLicense = document.getElementById('license-input-section');

    if (isPro) {
      sectionUpgrade.style.display = 'none';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = '';
    } else {
      sectionUpgrade.style.display = '';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = 'none';
    }
  }

  // Re-check a stored license with the server so monthly renewals extend and
  // cancelled subs are revoked. Network failures are non-destructive — we keep
  // the existing local state (which still honours its own expiry) and try again
  // next time the popup opens.
  function revalidateLicense() {
    chrome.storage.local.get(['shieldvault_license_key'], async (result) => {
      const key = result.shieldvault_license_key;
      if (!key) return;
      try {
        const res = await fetch(API_BASE + '/api/license/activate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key }),
        });
        if (!res.ok) return; // transient — leave state untouched
        const data = await res.json();
        if (data && data.valid) {
          saveProStatus({ key, tier: data.tier || 'plus', plan: data.plan, expiresAt: data.expiresAt });
        } else {
          clearProStatus(); // server says this key is no longer entitled
        }
        applyProState();
      } catch (_) {
        // Offline or server down: keep current state, retry next open.
      }
    });
  }

  applyProState();
  revalidateLicense();

  // ── Upgrade buttons ──────────────────────────────────────────────────────────

  function openCheckout(plan, btn, label) {
    btn.disabled = true;
    btn.textContent = 'Opening…';
    try {
      window.open(API_BASE + '/api/checkout/quick?plan=' + plan, '_blank');
    } catch (err) {
      btn.textContent = 'Error — try again';
    } finally {
      setTimeout(function () {
        btn.textContent = label;
        btn.disabled = false;
      }, 2000);
    }
  }

  document.getElementById('btn-monthly').addEventListener('click', function () {
    openCheckout('monthly', this, '$4.99/mo');
  });

  document.getElementById('btn-lifetime').addEventListener('click', function () {
    openCheckout('lifetime', this, '$39 once');
  });

  // ── License key flow ─────────────────────────────────────────────────────────

  document.getElementById('btn-already-purchased').addEventListener('click', function () {
    document.getElementById('pro-section').style.display = 'none';
    document.getElementById('license-input-section').style.display = '';
    document.getElementById('license-key-input').focus();
  });

  document.getElementById('btn-cancel-activate').addEventListener('click', function () {
    document.getElementById('license-input-section').style.display = 'none';
    document.getElementById('pro-section').style.display = '';
    document.getElementById('license-error').style.display = 'none';
    document.getElementById('license-key-input').value = '';
  });

  document.getElementById('btn-activate').addEventListener('click', async function () {
    const input = document.getElementById('license-key-input');
    const errorEl = document.getElementById('license-error');
    const btn = this;
    const key = input.value.trim();

    if (!key) {
      errorEl.textContent = 'Please enter a license key.';
      errorEl.style.display = '';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Activating…';
    errorEl.style.display = 'none';

    try {
      const res = await fetch(API_BASE + '/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        const body = await res.json().catch(function () { return {}; });
        throw new Error(body.error || 'Invalid license key');
      }
      const data = await res.json();
      if (!data.valid) throw new Error('Invalid license key');
      saveProStatus({
        key,
        tier: data.tier || 'plus',
        plan: data.plan,
        expiresAt: data.expiresAt,
      });
      applyProState();
    } catch (err) {
      errorEl.textContent = err.message || 'Activation failed. Please try again.';
      errorEl.style.display = '';
      btn.textContent = 'Activate';
      btn.disabled = false;
    }
  });

  document.getElementById('btn-reset-pro').addEventListener('click', function () {
    clearProStatus();
    applyProState();
  });
})();
