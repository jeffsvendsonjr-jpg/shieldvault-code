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
      item.innerHTML =
        '<span class="proof-domain">' + escHtml(p.domain || 'unknown') + '</span>' +
        '<span class="proof-type">' + escHtml(p.detectors ? p.detectors.join(', ') : p.vector || '') + '</span>' +
        '<span class="proof-time">' + time + '</span>';
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
  try {
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_GET_PROOFS' }, function (response) {
      if (chrome.runtime.lastError) return;
      if (response && Array.isArray(response.proofs)) {
        proofs = response.proofs;
        renderProofs();
      }
    });
  } catch (_) {}

  // Live updates while popup is open
  try {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'SHIELDVAULT_PREVENTED') return;
      proofs.unshift({
        ts: Date.now(),
        domain: message.domain || '',
        detectors: message.detectors || [],
        vector: message.vector || '',
      });
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

  document.getElementById('btn-monthly').addEventListener('click', async function () {
    const btn = this;
    btn.disabled = true;
    btn.textContent = 'Loading…';
    try {
      // Ensure Stripe key is cached before hitting checkout
      await getStripePublishableKey();

      const res = await fetch(API_BASE + '/api/checkout/quick?plan=monthly', {
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
    } catch (err) {
      btn.textContent = 'Error — try again';
      btn.disabled = false;
      setTimeout(function () { btn.textContent = '$5.99/month'; btn.disabled = false; }, 3000);
      return;
    }
    btn.textContent = '$5.99/month';
    btn.disabled = false;
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
})();