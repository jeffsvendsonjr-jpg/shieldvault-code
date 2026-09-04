(function () {
  'use strict';

  const API_BASE = 'https://shieldvault.site';

  // ── Proof list ──────────────────────────────────────────────────────────────

  let proofs = [];
  let pausedDomains = [];

  function isBehaviorProof(proof) {
    return proof && proof.category === 'behavioral';
  }

  function isReviewProof(proof) {
    return proof && proof.category === 'review';
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
      return !isBehaviorProof(proof) && !isReviewProof(proof);
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
    if (isReviewProof(proof)) {
      if (detectors.includes('email')) return 'Email noticed — allowed';
      if (detectors.includes('phone')) return 'Phone number noticed — allowed';
      if (detectors.includes('large paste')) return 'Large paste reviewed — allowed';
      return 'Reviewed — allowed';
    }
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

    // The event total lives in the activity summary — no separate counter here.
    if (!proofs.length) {
      empty.style.display = '';
      container.style.display = 'none';
      renderSummary();
      return;
    }

    empty.style.display = 'none';
    container.style.display = 'flex';

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

  // The buyer's email, learned from a prior license activation. Kept in memory
  // so checkout can attach it synchronously (preserving the click gesture) and
  // link a monthly→lifetime upgrade to the same Stripe customer.
  let proEmail = '';

  // The service worker is the sole entitlement authority. Stored plan, expiry,
  // tier, and Pro flags are display metadata and never grant access here.
  function getProStatus(force = false) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: force ? 'SHIELDVAULT_REFRESH_ENTITLEMENT' : 'SHIELDVAULT_GET_ENTITLEMENT',
            force,
          },
          (response) => {
            if (chrome.runtime.lastError) return resolve(false);
            if (response && response.isPro === true && response.email) {
              proEmail = response.email;
            } else if (response && response.isPro === false) {
              proEmail = '';
            }
            resolve(Boolean(response && response.isPro === true));
          }
        );
      } catch (_) {
        resolve(false);
      }
    });
  }

  // Removes the LOCAL license record only. There is no billing-management /
  // Stripe customer-portal route in this codebase today, so subscription
  // cancellation requires backend support (a customer-portal endpoint) before
  // a "Manage billing" button can exist here — do not add one until the route
  // is real and verified.
  function clearProStatus() {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type: 'SHIELDVAULT_REMOVE_LICENSE' }, (response) => {
          if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
          proEmail = '';
          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
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
      renderProPlanDetails();
    } else {
      sectionUpgrade.style.display = '';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = 'none';
    }
  }

  // Monthly subscribers see their renewal date and a one-click path to the
  // lifetime plan (the server links the upgrade to the same Stripe customer).
  // Lifetime owners just see their plan — no upsell.
  function renderProPlanDetails() {
    const planLine = document.getElementById('pro-plan-line');
    const upgradeBtn = document.getElementById('btn-upgrade-lifetime');
    const upgradeNote = document.getElementById('pro-upgrade-note');
    if (!planLine || !upgradeBtn) return;
    chrome.storage.local.get(
      ['shieldvault_pro_plan', 'shieldvault_pro_expiry'],
      function (result) {
        if (chrome.runtime.lastError) return;
        const expiry = result.shieldvault_pro_expiry;
        const hasExpiry = typeof expiry === 'number' && expiry > 0;
        // Unknown/absent plan (older stored state) is inferred from the expiry
        // so the lifetime upsell is only hidden for confirmed lifetime owners.
        const plan = result.shieldvault_pro_plan || (hasExpiry ? 'monthly' : 'lifetime');
        if (plan === 'lifetime') {
          planLine.textContent = 'Lifetime plan';
          planLine.style.display = '';
          upgradeBtn.style.display = 'none';
          if (upgradeNote) upgradeNote.style.display = 'none';
        } else {
          const renews = hasExpiry
            ? ' — renews ' + new Date(expiry).toLocaleDateString([], { month: 'short', day: 'numeric' })
            : '';
          planLine.textContent = 'Monthly plan' + renews;
          planLine.style.display = '';
          upgradeBtn.style.display = '';
          if (upgradeNote) upgradeNote.style.display = '';
        }
      }
    );
  }

  // Re-check a stored license with the worker so renewals, revocations, cache,
  // and offline grace all follow the same authoritative policy.
  async function revalidateLicense() {
    // Popup-open validation delegates cache, grace, and revocation policy to
    // the worker, then repaints from that authoritative decision.
    await getProStatus(true);
    await applyProState();
  }

  // Seed the buyer's email into memory on popup load (a fast local read that
  // completes long before any button click), so checkout can attach it in a
  // single synchronous window.open. Revalidation refreshes it afterward.
  chrome.storage.local.get(['shieldvault_email'], function (result) {
    if (!chrome.runtime.lastError && result.shieldvault_email) {
      proEmail = result.shieldvault_email;
    }
  });

  applyProState();
  revalidateLicense();

  // ── Upgrade buttons ──────────────────────────────────────────────────────────

  function openCheckout(plan, btn, label) {
    btn.disabled = true;
    btn.textContent = 'Opening…';

    // Single SYNCHRONOUS open. Opening the tab closes the popup (focus shifts),
    // which would cancel any pending async callback — so we must not do async
    // work (e.g. a storage read) after opening, or the buyer lands on a blank
    // tab. proEmail is seeded on popup load and refreshed by revalidation, so
    // it's ready here; if it's empty the server falls back to the email Stripe
    // collects at checkout, so the link still works.
    let win = null;
    try {
      const emailParam = proEmail ? '&email=' + encodeURIComponent(proEmail) : '';
      win = window.open(API_BASE + '/api/checkout/quick?plan=' + plan + emailParam, '_blank');
    } catch (_) {
      win = null;
    }

    // window.open returns null (without throwing) when the pop-up is blocked —
    // give clear feedback and re-enable so the user can allow pop-ups and retry.
    if (!win) {
      btn.textContent = 'Allow pop-ups & retry';
      btn.disabled = false;
      setTimeout(function () {
        btn.textContent = label;
      }, 4000);
      return;
    }

    setTimeout(function () {
      btn.textContent = label;
      btn.disabled = false;
    }, 2000);
  }

  document.getElementById('btn-monthly').addEventListener('click', function () {
    openCheckout('monthly', this, '$4.99/mo');
  });

  document.getElementById('btn-lifetime').addEventListener('click', function () {
    openCheckout('lifetime', this, '$39 once');
  });

  const upgradeLifetimeBtn = document.getElementById('btn-upgrade-lifetime');
  if (upgradeLifetimeBtn) {
    upgradeLifetimeBtn.addEventListener('click', function () {
      openCheckout('lifetime', this, 'Upgrade to Lifetime — $39 one-time payment');
    });
  }

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
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { type: 'SHIELDVAULT_ACTIVATE_LICENSE', key },
          (result) => {
            if (chrome.runtime.lastError) return reject(chrome.runtime.lastError);
            resolve(result);
          }
        );
      });
      if (!response || response.isPro !== true) {
        throw new Error((response && response.error) || 'Invalid license key');
      }
      if (response.email) proEmail = response.email;
      await applyProState();
    } catch (err) {
      errorEl.textContent = err.message || 'Activation failed. Please try again.';
      errorEl.style.display = '';
      btn.textContent = 'Activate';
      btn.disabled = false;
    }
  });

  // Two-step confirm: deactivating forgets the stored license key, so a stray
  // click shouldn't force the user to go dig it out of their email.
  let resetConfirmTimer = null;
  document.getElementById('btn-reset-pro').addEventListener('click', function () {
    const btn = this;
    if (!resetConfirmTimer) {
      btn.textContent = 'Removes the license from this browser only — it does NOT cancel your subscription. Click again to confirm.';
      resetConfirmTimer = setTimeout(function () {
        resetConfirmTimer = null;
        btn.textContent = 'Remove license from this browser';
      }, 5000);
      return;
    }
    clearTimeout(resetConfirmTimer);
    resetConfirmTimer = null;
    btn.textContent = 'Remove license from this browser';
    clearProStatus()
      .then(function () { return applyProState(); })
      .catch(function (err) {
        console.warn('[ShieldVault] license removal failed:', err);
      });
  });
})();
