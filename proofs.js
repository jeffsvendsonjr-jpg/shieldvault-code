(function () {
  'use strict';

  const API_BASE = 'https://shieldvault.site';
  const LEGACY_PRO_KEY = 'shieldvault_pro_v1';
  const PRO_STORAGE_KEY = 'shieldvault_pro';
  const LICENSE_KEY_STORAGE = 'shieldvault_license_key';
  const PRO_PREVIEW_UNTIL_KEY = 'shieldvault_pro_preview_until';
  const PRO_PREVIEW_USED_KEY = 'shieldvault_pro_preview_used';
  const PRO_REVALIDATE_TTL = 86400000; // 24 hours
  const STRIPE_KEY_CACHE = 'shieldvault_stripe_pk_cache';
  const STRIPE_KEY_TTL = 86400000; // 24 hours
  const MASTER_TOGGLE_KEY = 'shieldvault_enabled';
  const UI_UPDATED_DATE = '2026-06-23';

  function storageGet(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.get(keys, function (result) {
        if (chrome.runtime.lastError) return resolve({});
        resolve(result || {});
      });
    });
  }

  function storageSet(payload) {
    return new Promise(function (resolve, reject) {
      chrome.storage.local.set(payload, function () {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        resolve();
      });
    });
  }

  function storageRemove(keys) {
    return new Promise(function (resolve) {
      chrome.storage.local.remove(keys, function () {
        resolve();
      });
    });
  }

  // ── Tab navigation ───────────────────────────────────────────────────────────

  function switchTab(tab) {
    ['activity', 'settings', 'pro'].forEach(function (key) {
      const panel = document.getElementById('tab-' + key);
      if (panel) panel.style.display = key === tab ? '' : 'none';
    });
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      const isActive = btn.dataset.tab === tab;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    });
    if (tab === 'settings') loadAndRenderDetectSettings();
    if (tab === 'pro') updateProStats();
  }

  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { switchTab(btn.dataset.tab); });
  });

  // ── Status chip ───────────────────────────────────────────────────────────────

  const MONITORED_PATTERNS = [
    /^https:\/\/chat\.openai\.com\//,
    /^https:\/\/chatgpt\.com\//,
    /^https:\/\/claude\.ai\//,
    /^https:\/\/gemini\.google\.com\//,
    /^https:\/\/perplexity\.ai\//,
    /^https:\/\/copilot\.microsoft\.com\//,
    /^https:\/\/grok\.com\//,
    /^https:\/\/chat\.mistral\.ai\//,
    /^https:\/\/www\.meta\.ai\//,
    /^https:\/\/poe\.com\//,
    /^https:\/\/chat\.deepseek\.com\//,
    /^https:\/\/[^/]*\.linkedin\.com\//,
    /^https:\/\/[^/]*\.reddit\.com\//,
    /^https:\/\/twitter\.com\//,
    /^https:\/\/x\.com\//,
    /^https:\/\/mail\.google\.com\//,
    /^https:\/\/docs\.google\.com\//,
    /^https:\/\/colab\.research\.google\.com\//,
    /^https:\/\/notebooklm\.google\.com\//,
    /^https:\/\/outlook\.live\.com\//,
    /^https:\/\/outlook\.office\.com\//,
    /^https:\/\/outlook\.office365\.com\//,
    /^https:\/\/pastebin\.com\//,
    /^https:\/\/hastebin\.com\//,
    /^https:\/\/paste\.ee\//,
    /^https:\/\/rentry\.co\//,
    /^https:\/\/dpaste\.com\//,
  ];

  function updateStatusChip() {
    const dotEl = document.getElementById('status-dot');
    const labelEl = document.getElementById('status-label');
    const masterToggleEl = document.getElementById('master-toggle');
    if (!dotEl || !labelEl) return;
    try {
      storageGet([MASTER_TOGGLE_KEY]).then(function (data) {
        const enabled = data[MASTER_TOGGLE_KEY] !== false; // default true
        if (masterToggleEl) masterToggleEl.checked = enabled;
        if (!enabled) {
          dotEl.className = 'status-dot status-dot--disabled';
          labelEl.textContent = 'Protection paused';
          return;
        }
        chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          if (chrome.runtime.lastError) {
            dotEl.className = 'status-dot status-dot--inactive';
            labelEl.textContent = 'Not monitoring';
            return;
          }
          const tab = tabs && tabs[0];
          const url = (tab && tab.url) || '';
          const monitored = Boolean(url && MONITORED_PATTERNS.some(function (re) { return re.test(url); }));
          dotEl.className = 'status-dot ' + (monitored ? 'status-dot--active' : 'status-dot--inactive');
          labelEl.textContent = monitored ? 'Active on this page' : 'Not monitoring this page';
        });
      });
    } catch (_) {
      dotEl.className = 'status-dot status-dot--inactive';
      labelEl.textContent = 'Protected';
    }
  }

  updateStatusChip();

  // ── Master toggle ─────────────────────────────────────────────────────────────

  const masterToggleEl = document.getElementById('master-toggle');
  if (masterToggleEl) {
    masterToggleEl.addEventListener('change', function () {
      storageSet({ [MASTER_TOGGLE_KEY]: masterToggleEl.checked }).then(function () {
        updateStatusChip();
      }).catch(function () {});
    });
  }

  // ── Keyboard shortcut hint ────────────────────────────────────────────────────

  try {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const shortcutEl = document.getElementById('kbd-shortcut-text');
    if (shortcutEl) {
      shortcutEl.innerHTML = isMac
        ? '&#8963; Open anywhere: <kbd>&#8984;</kbd>+<kbd>&#8679;</kbd>+<kbd>S</kbd>'
        : '&#9000; Open anywhere: <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>';
    }
  } catch (_) {}

  // ── Proof list ───────────────────────────────────────────────────────────────

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
    container.style.display = 'flex';
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
      const reason = getPreventionReason(p);
      item.innerHTML =
        '<div class="proof-header">' +
          '<span class="proof-domain">' + escHtml(p.domain || 'unknown') + '</span>' +
          blockBadge +
          '<span class="proof-time">' + time + '</span>' +
        '</div>' +
        (detectorTags ? '<div class="proof-details">' + detectorTags + '</div>' : '') +
        '<button class="why-btn" aria-expanded="false">Why?</button>' +
        '<div class="proof-reason proof-reason--hidden">' + escHtml(reason) + '</div>';
      container.appendChild(item);
    }
  }

  // Event delegation — "Why?" toggle on each proof item
  document.getElementById('proof-list').addEventListener('click', function (e) {
    const btn = e.target.closest('.why-btn');
    if (!btn) return;
    const item = btn.closest('.proof-item');
    const reasonEl = item && item.querySelector('.proof-reason');
    if (!reasonEl) return;
    const expanded = btn.getAttribute('aria-expanded') === 'true';
    reasonEl.classList.toggle('proof-reason--hidden', expanded);
    btn.setAttribute('aria-expanded', String(!expanded));
    btn.textContent = expanded ? 'Why?' : 'Hide';
  });

  function getPreventionReason(p) {
    const names = Array.isArray(p.detectors) ? p.detectors : [];
    if (p.vector === 'behavioral') {
      const top = names.slice(0, 2).join(', ') || 'tone/risk checks';
      return 'Soft flag: paused before send due to ' + top + '. You can still choose to send.';
    }
    if (!names.length) {
      return 'Hard block: detected sensitive content and removed it before it reached the page.';
    }
    return 'Hard block: matched ' + names.slice(0, 2).join(', ') + '. Content was wiped before submit.';
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

  const FREE_HISTORY_LIMIT = 25;
  const PRO_HISTORY_LIMIT = 100;

  try {
    chrome.runtime.sendMessage({ type: 'SHIELDVAULT_GET_PROOFS' }, function (response) {
      if (chrome.runtime.lastError) return;
      if (response && Array.isArray(response.proofs)) {
        getProStatus().then(function (pro) {
          const limit = (pro && pro.active) ? PRO_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
          proofs = response.proofs.slice(0, limit);
          renderProofs();
          updateProStats();
        });
      }
    });
  } catch (_) {}

  // Live updates while popup is open
  try {
    chrome.runtime.onMessage.addListener(function (message) {
      if (!message || message.type !== 'SHIELDVAULT_PREVENTED') return;
      getProStatus().then(function (pro) {
        const limit = (pro && pro.active) ? PRO_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
        proofs.unshift({
          ts: Date.now(),
          domain: message.domain || '',
          detectors: message.detectors || [],
          vector: message.vector || '',
        });
        if (proofs.length > limit) proofs.length = limit;
        renderProofs();
        updateProStats();
      });
    });
  } catch (_) {}

  renderProofs();

  // ── Pro stats line ────────────────────────────────────────────────────────────

  function updateProStats() {
    const line = document.getElementById('pro-stats-line');
    if (!line) return;
    const total = proofs.length;
    if (total > 0) {
      line.textContent = 'You\'ve blocked ' + total + (total === 1 ? ' item' : ' items') + ' on the free plan. Pro unlocks 4× the history.';
      line.style.display = '';
    } else {
      line.style.display = 'none';
    }
  }

  // ── Pro status ────────────────────────────────────────────────────────────────

  function normalizeLicenseKey(raw) {
    return String(raw || '')
      .trim()
      .replace(/\s+/g, '')
      .toUpperCase();
  }

  async function getProStatus() {
    const data = await storageGet([PRO_STORAGE_KEY, PRO_PREVIEW_UNTIL_KEY, PRO_PREVIEW_USED_KEY]);
    const paid = data[PRO_STORAGE_KEY] || null;
    if (paid && paid.active) return Object.assign({}, paid, { source: 'paid' });
    const previewUntil = Number(data[PRO_PREVIEW_UNTIL_KEY] || 0);
    if (previewUntil > Date.now()) {
      return {
        active: true,
        source: 'preview',
        previewUntil: previewUntil,
        previewUsed: Boolean(data[PRO_PREVIEW_USED_KEY]),
      };
    }
    return {
      active: false,
      source: null,
      previewUntil: previewUntil,
      previewUsed: Boolean(data[PRO_PREVIEW_USED_KEY]),
    };
  }

  async function clearProStatus() {
    await storageRemove([PRO_STORAGE_KEY, LICENSE_KEY_STORAGE]);
  }

  async function migrateLegacyProStatus() {
    try {
      const raw = localStorage.getItem(LEGACY_PRO_KEY);
      if (!raw) return;
      const legacy = JSON.parse(raw);
      if (legacy && legacy.active) {
        const key = normalizeLicenseKey(legacy.key || '');
        if (key) {
          await storageSet({
            [PRO_STORAGE_KEY]: Object.assign({}, legacy, { key }),
            [LICENSE_KEY_STORAGE]: key,
          });
        } else {
          await storageSet({ [PRO_STORAGE_KEY]: legacy });
        }
      }
      localStorage.removeItem(LEGACY_PRO_KEY);
    } catch (_) {}
  }

  async function revalidateProStatusIfNeeded() {
    const pro = await getProStatus();
    if (!pro || !pro.active || !pro.key) return;
    const ageMs = Date.now() - Number(pro.lastValidatedAt || pro.activatedAt || 0);
    if (ageMs >= 0 && ageMs < PRO_REVALIDATE_TTL) return;
    try {
      const res = await fetch(API_BASE + '/api/license/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: normalizeLicenseKey(pro.key) }),
      });
      if (!res.ok) {
        await clearProStatus();
        return;
      }
      const key = normalizeLicenseKey(pro.key);
      await storageSet({
        [PRO_STORAGE_KEY]: {
          active: true,
          key,
          activatedAt: Number(pro.activatedAt || Date.now()),
          lastValidatedAt: Date.now(),
        },
        [LICENSE_KEY_STORAGE]: key,
      });
    } catch (_) {}
  }

  async function applyProState() {
    const pro = await getProStatus();
    const sectionUpgrade = document.getElementById('pro-section');
    const sectionActive = document.getElementById('pro-active');
    const sectionLicense = document.getElementById('license-input-section');
    const proActiveText = document.getElementById('pro-active-text');
    const resetBtn = document.getElementById('btn-reset-pro');
    const previewBtn = document.getElementById('btn-preview');
    const previewHelpText = document.getElementById('preview-help-text');
    const proTabDot = document.getElementById('tab-pro-dot');

    if (pro && pro.active) {
      sectionUpgrade.style.display = 'none';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = '';
      if (proTabDot) proTabDot.style.display = 'none';
      if (pro.source === 'preview') {
        const until = new Date(Number(pro.previewUntil || Date.now())).toLocaleDateString();
        proActiveText.textContent = 'Pro preview active until ' + until + '.';
        resetBtn.style.display = 'none';
      } else {
        proActiveText.textContent = 'Thanks for supporting ShieldVault!';
        resetBtn.style.display = '';
      }
    } else {
      sectionUpgrade.style.display = '';
      sectionLicense.style.display = 'none';
      sectionActive.style.display = 'none';
      if (proTabDot) proTabDot.style.display = '';
      if (previewBtn) {
        const canStart = !pro.previewUsed;
        previewBtn.disabled = !canStart;
        if (previewHelpText) {
          previewHelpText.textContent = canStart
            ? 'One-time preview. No payment required.'
            : 'Preview already used on this browser profile.';
        }
      }
    }
  }

  (async function bootstrapProState() {
    await migrateLegacyProStatus();
    await revalidateProStatusIfNeeded();
    await applyProState();
  })();

  // ── Behavioral upgrade nudge ──────────────────────────────────────────────────
  // After 5+ preventions, switch to the Pro tab to surface the upgrade at peak value.

  try {
    chrome.storage.local.get(['shieldvault_behavioral_uses'], function (result) {
      if (chrome.runtime.lastError) return;
      const uses = result.shieldvault_behavioral_uses || 0;
      getProStatus().then(function (pro) {
        if (uses >= 5 && !(pro && pro.active)) {
          const proSection = document.getElementById('pro-section');
          if (proSection && proSection.style.display !== 'none') {
            proSection.classList.add('pro-section--nudge');
            switchTab('pro');
          }
        }
      });
    });
  } catch (_) {}

  // ── Stripe publishable key — lazy + cached ────────────────────────────────────

  let _stripeKeyPromise = null;

  function getStripePublishableKey() {
    if (_stripeKeyPromise) return _stripeKeyPromise;

    _stripeKeyPromise = (async function () {
      try {
        const cached = JSON.parse(localStorage.getItem(STRIPE_KEY_CACHE) || 'null');
        if (cached && cached.pk && Date.now() - cached.ts < STRIPE_KEY_TTL) {
          return cached.pk;
        }
      } catch (_) {}

      const res = await fetch(API_BASE + '/api/stripe/publishable-key', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load payment info (' + res.status + ')');
      const data = await res.json();
      const pk = data.publishableKey || data.publishable_key;
      if (!pk) throw new Error('Invalid payment configuration');

      try {
        localStorage.setItem(STRIPE_KEY_CACHE, JSON.stringify({ pk, ts: Date.now() }));
      } catch (_) {}

      return pk;
    })();

    _stripeKeyPromise.catch(function () { _stripeKeyPromise = null; });

    return _stripeKeyPromise;
  }

  // ── Upgrade buttons ───────────────────────────────────────────────────────────

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
        await openLicenseSection();
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

  document.getElementById('btn-preview').addEventListener('click', async function () {
    const btn = this;
    btn.disabled = true;
    try {
      const pro = await getProStatus();
      if (pro.previewUsed) {
        await applyProState();
        return;
      }
      const previewUntil = Date.now() + (7 * 24 * 60 * 60 * 1000);
      await storageSet({
        [PRO_PREVIEW_UNTIL_KEY]: previewUntil,
        [PRO_PREVIEW_USED_KEY]: true,
      });
      await applyProState();
    } catch (_) {
      btn.disabled = false;
    }
  });

  // ── License key flow ──────────────────────────────────────────────────────────

  const licenseInput = document.getElementById('license-key-input');
  const licenseError = document.getElementById('license-error');

  async function openLicenseSection() {
    document.getElementById('pro-section').style.display = 'none';
    document.getElementById('license-input-section').style.display = '';
    licenseError.style.display = 'none';
    const stored = await storageGet([LICENSE_KEY_STORAGE]);
    if (stored[LICENSE_KEY_STORAGE]) {
      licenseInput.value = stored[LICENSE_KEY_STORAGE];
    }
    licenseInput.focus();
  }

  document.getElementById('btn-already-purchased').addEventListener('click', function () {
    openLicenseSection();
  });

  document.getElementById('btn-cancel-activate').addEventListener('click', function () {
    document.getElementById('license-input-section').style.display = 'none';
    document.getElementById('pro-section').style.display = '';
    licenseError.style.display = 'none';
  });

  licenseInput.addEventListener('input', function () {
    const key = normalizeLicenseKey(licenseInput.value);
    storageSet({ [LICENSE_KEY_STORAGE]: key }).catch(function () {});
  });

  licenseInput.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      document.getElementById('btn-activate').click();
    }
  });

  document.getElementById('btn-activate').addEventListener('click', async function () {
    const btn = this;
    const key = normalizeLicenseKey(licenseInput.value);

    if (!key) {
      licenseError.textContent = 'Please enter a license key.';
      licenseError.style.display = '';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Activating…';
    licenseError.style.display = 'none';

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
      await storageSet({
        [PRO_STORAGE_KEY]: { active: true, key, activatedAt: Date.now(), lastValidatedAt: Date.now() },
        [LICENSE_KEY_STORAGE]: key,
      });
      licenseInput.value = key;
      await applyProState();
      btn.textContent = 'Activated';
      setTimeout(function () {
        btn.textContent = 'Activate';
        btn.disabled = false;
      }, 1200);
      return;
    } catch (err) {
      licenseError.textContent = err.message || 'Activation failed. Please try again.';
      licenseError.style.display = '';
      btn.textContent = 'Activate';
      btn.disabled = false;
      return;
    }
  });

  document.getElementById('btn-reset-pro').addEventListener('click', async function () {
    await clearProStatus();
    await applyProState();
  });

  // ── Detection Settings ─────────────────────────────────────────────────────────

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

  for (const key of DETECT_TOGGLE_KEYS) {
    const el = document.getElementById('set-' + key);
    if (el) el.addEventListener('change', saveDetectSettings);
  }

  loadAndRenderDetectSettings();

  // ── Settings search/filter ─────────────────────────────────────────────────────

  const settingsFilter = document.getElementById('settings-filter');
  if (settingsFilter) {
    settingsFilter.addEventListener('input', function () {
      const q = this.value.toLowerCase().trim();
      const groups = document.querySelectorAll('#settings-body-inner .settings-group');
      groups.forEach(function (group) {
        const rows = group.querySelectorAll('.toggle-row');
        let anyVisible = false;
        rows.forEach(function (row) {
          const labelSpan = row.querySelector('span:first-child');
          const text = (labelSpan ? labelSpan.textContent : row.textContent).toLowerCase();
          const visible = !q || text.includes(q);
          row.style.display = visible ? '' : 'none';
          if (visible) anyVisible = true;
        });
        group.style.display = (!q || anyVisible) ? '' : 'none';
      });
    });
  }

  // ── Version display ────────────────────────────────────────────────────────────

  try {
    const manifest = chrome.runtime.getManifest();
    const vEl = document.getElementById('sv-version');
    if (vEl && manifest.version) vEl.textContent = 'ShieldVault v' + manifest.version;
    const dEl = document.getElementById('sv-updated');
    if (dEl) dEl.textContent = 'Updated ' + UI_UPDATED_DATE;
  } catch (_) {}

  // ── How it works link ──────────────────────────────────────────────────────────

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
