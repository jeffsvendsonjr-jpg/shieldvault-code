(function () {
  'use strict';

  const API_BASE = 'https://shieldvault.site';
  const PRO_KEY = 'shieldvault_pro_v1';
  const STRIPE_KEY_CACHE = 'shieldvault_stripe_pk_cache';
  const STRIPE_KEY_TTL = 86400000; // 24 hours

  // ── Proof list ──────────────────────────────────────────────────────────────

  let proofs = [];

  function renderProofs() {
    const container = document.getElementById('proof-list');
    const empty = document.getElementById('empty-state');
    const count = document.getElementById('count');

    if (!proofs.length) {
      empty.style.display = '';
      container.style.display = 'none';
      count.textContent = '0 preventions';
      return;
    }

    empty.style.display = 'none';
    container.style.display = '';
    count.textContent = proofs.length + (proofs.length === 1 ? ' prevention' : ' preventions');

    container.innerHTML = '';
    for (const p of proofs) {
      const item = document.createElement('div');
      item.className = 'proof-item';
      const time = new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isHard = p.vector !== 'behavioral';
      const blockBadge = isHard
        ? '<span class="tag tag-hard">Hard Block</span>'
        : '<span class="tag tag-soft">Soft Flag</span>';
      const detectorTags = (p.detectors || [])
        .map(function (d) { return '<span class="tag tag-detector">' + escHtml(d) + '</span>'; })
        .join('');
      item.innerHTML =
        '<div class="proof-header">' +
          '<span class="proof-domain">' + escHtml(p.domain || 'unknown') + '</span>' +
          blockBadge +
          '<span class="proof-time">' + time + '</span>' +
        '</div>' +
        (detectorTags ? '<div class="proof-details">' + detectorTags + '</div>' : '');
      container.appendChild(item);
    }
  }

  function escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  document.getElementById('clear-btn').addEventListener('click', function () {
    proofs = [];
    renderProofs();
  });

  // Ask background for stored proofs (best-effort; extension may not have any)
  const FREE_HISTORY_LIMIT = 25;
  const PRO_HISTORY_LIMIT = 100;
  try {
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_GET_PROOFS' }, function (response) {
      if (chrome.runtime.lastError) return;
      if (response && Array.isArray(response.proofs)) {
        const pro = getProStatus();
        const limit = (pro && pro.active) ? PRO_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
        proofs = response.proofs.slice(0, limit);
        renderProofs();
      }
    });
  } catch (_) {}

  // Live updates while popup is open
  try {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'SHIELDVAULT_PREVENTED') return;
      const pro = getProStatus();
      const limit = (pro && pro.active) ? PRO_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
      proofs.unshift({
        ts: Date.now(),
        domain: message.domain || '',
        detectors: message.detectors || [],
        vector: message.vector || '',
      });
      if (proofs.length > limit) proofs.length = limit;
      renderProofs();
    });
  } catch (_) {}

  renderProofs();

  // ── Pro status ───────────────────────────────────────────────────────────────

  function getProStatus() {
    try {
      const raw = localStorage.getItem(PRO_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }

  function saveProStatus(data) {
    localStorage.setItem(PRO_KEY, JSON.stringify(data));
  }

  function clearProStatus() {
    localStorage.removeItem(PRO_KEY);
  }

  function applyProState() {
    const pro = getProStatus();
    const sectionUpgrade = document.getElementById('pro-section');
    const sectionActive = document.getElementById('pro-active');
    const sectionLicense = document.getElementById('license-input-section');

    if (pro && pro.active) {
      sectionUpgrade.style.display = 'none';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = '';
    } else {
      sectionUpgrade.style.display = '';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = 'none';
    }
  }

  applyProState();

  // ── Behavioral upgrade nudge ─────────────────────────────────────────────────
  // After 5+ preventions, pulse the Pro section to catch the user at peak value.

  try {
    chrome.storage.local.get(['shieldvault_behavioral_uses'], function (result) {
      if (chrome.runtime.lastError) return;
      const uses = result.shieldvault_behavioral_uses || 0;
      const pro = getProStatus();
      if (uses >= 5 && !(pro && pro.active)) {
        const proSection = document.getElementById('pro-section');
        if (proSection && proSection.style.display !== 'none') {
          proSection.classList.add('pro-section--nudge');
          proSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }
    });
  } catch (_) {}

  // ── Stripe publishable key — lazy + cached ───────────────────────────────────

  let _stripeKeyPromise = null;

  function getStripePublishableKey() {
    if (_stripeKeyPromise) return _stripeKeyPromise;

    _stripeKeyPromise = (async function () {
      // Check cache first
      try {
        const cached = JSON.parse(localStorage.getItem(STRIPE_KEY_CACHE) || 'null');
        if (cached && cached.pk && Date.now() - cached.ts < STRIPE_KEY_TTL) {
          return cached.pk;
        }
      } catch (_) {}

      // Fetch from server only when actually needed
      const res = await fetch(API_BASE + '/api/stripe/publishable-key', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load payment info (' + res.status + ')');
      const data = await res.json();
      const pk = data.publishableKey || data.publishable_key;
      if (!pk) throw new Error('Invalid payment configuration');

      // Cache for 24 h
      try {
        localStorage.setItem(STRIPE_KEY_CACHE, JSON.stringify({ pk, ts: Date.now() }));
      } catch (_) {}

      return pk;
    })();

    // Don't cache a rejected promise — allow retry on next click
    _stripeKeyPromise.catch(function () { _stripeKeyPromise = null; });

    return _stripeKeyPromise;
  }

  // ── Upgrade button ───────────────────────────────────────────────────────────

  async function startCheckout(plan, btn, originalLabel) {
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      await getStripePublishableKey();

      const res = await fetch(API_BASE + '/api/checkout/quick?plan=' + plan, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Checkout error (' + res.status + ')');
      const data = await res.json();
      if (data.url) {
        window.open(data.url, '_blank');
      } else {
        throw new Error('No checkout URL returned');
      }
    } catch (_err) {
      btn.textContent = 'Error — try again';
      btn.disabled = false;
      setTimeout(function () { btn.textContent = originalLabel; btn.disabled = false; }, 3000);
      return;
    }
    btn.textContent = originalLabel;
    btn.disabled = false;
  }

  document.getElementById('btn-annual').addEventListener('click', function () {
    startCheckout('annual', this, '$49.99/year');
  });

  document.getElementById('btn-monthly').addEventListener('click', function () {
    startCheckout('monthly', this, '$4.99/mo');
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
      saveProStatus({ active: true, key, activatedAt: Date.now() });
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

  // ── Detection Settings ────────────────────────────────────────────────────────

  const DETECT_SETTINGS_KEY = 'shieldvaultSettings';
  const DETECT_DEFAULTS = {
    secretGuard: true,
    tokenGuard: true,
    passwordGuard: true,
    recoveryPhraseGuard: true,
    privateInfoGuard: true,
    clientDataGuard: true,
    largePasteGuard: true,
    creditCardGuard: true,
    phoneGuard: true,
    bankAccountGuard: true,
    reputationGuard: false,
    lateNightPostAlert: false,
    emotionalPostWarning: false,
  };

  const DETECT_TOGGLE_KEYS = Object.keys(DETECT_DEFAULTS);

  function loadAndRenderDetectSettings() {
    try {
      chrome.storage.local.get([DETECT_SETTINGS_KEY], function (result) {
        if (chrome.runtime.lastError) return;
        const settings = Object.assign({}, DETECT_DEFAULTS, result[DETECT_SETTINGS_KEY] || {});
        for (const key of DETECT_TOGGLE_KEYS) {
          const el = document.getElementById('set-' + key);
          if (el) el.checked = Boolean(settings[key]);
        }
      });
    } catch (_) {}
  }

  function saveDetectSettings() {
    try {
      const settings = {};
      for (const key of DETECT_TOGGLE_KEYS) {
        const el = document.getElementById('set-' + key);
        settings[key] = el ? el.checked : DETECT_DEFAULTS[key];
      }
      chrome.storage.local.set({ [DETECT_SETTINGS_KEY]: settings });
    } catch (_) {}
  }

  document.getElementById('settings-header-btn').addEventListener('click', function () {
    const body = document.getElementById('settings-body');
    const chevron = document.getElementById('settings-chevron');
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : '';
    chevron.classList.toggle('open', !isOpen);
    this.setAttribute('aria-expanded', String(!isOpen));
  });

  for (const key of DETECT_TOGGLE_KEYS) {
    const el = document.getElementById('set-' + key);
    if (el) el.addEventListener('change', saveDetectSettings);
  }

  loadAndRenderDetectSettings();

  // ── Version display ───────────────────────────────────────────────────────

  try {
    const manifest = chrome.runtime.getManifest();
    const vEl = document.getElementById('sv-version');
    if (vEl && manifest.version) vEl.textContent = 'ShieldVault v' + manifest.version;
  } catch (_) {}

  // ── How it works link ─────────────────────────────────────────────────────

  const howItWorksLink = document.getElementById('how-it-works-link');
  if (howItWorksLink) {
    howItWorksLink.addEventListener('click', function (e) {
      e.preventDefault();
      try {
        chrome.tabs.create({ url: chrome.runtime.getURL('how-it-works.html') });
      } catch (_) {}
    });
  }
})();