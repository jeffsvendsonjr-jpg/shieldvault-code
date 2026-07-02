(function () {
  'use strict';

  const SETTINGS_KEY = 'shieldvaultSettings';
  const DEFAULTS = {
    secretGuard: true,
    tokenGuard: true,
    passwordGuard: true,
    recoveryPhraseGuard: true,
    privateInfoGuard: true,
    clientDataGuard: true,
    largePasteGuard: true,
    reputationGuard: false,
    lateNightPostAlert: false,
    emotionalPostWarning: false,
    soundOnBlock: false,
    emailReviewGuard: true,
    phoneReviewGuard: true,
  };

  const ids = Object.keys(DEFAULTS);
  const savedMsg = document.getElementById('saved-msg');
  let isPro = false;

  // Mirrors effectiveTier in the content script: null/absent expiry = lifetime;
  // only a positive expiry in the past counts as lapsed.
  function loadProStatus() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['shieldvault_pro', 'shieldvault_pro_expiry'], function (result) {
          if (chrome.runtime.lastError) return resolve(false);
          const expiry = result.shieldvault_pro_expiry;
          const expired = typeof expiry === 'number' && expiry > 0 && Date.now() > expiry;
          resolve(result.shieldvault_pro === true && !expired);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  // Non-Pro users can still flip Pro toggles (they persist and activate on
  // upgrade), but we tell them plainly instead of letting the switch look dead.
  function refreshProUI(state) {
    const upsell = document.getElementById('pro-upsell');
    if (upsell) upsell.style.display = isPro ? 'none' : '';
    const repNote = document.getElementById('reputation-pro-note');
    if (repNote) {
      const wantsReputation = state.reputationGuard || state.lateNightPostAlert || state.emotionalPostWarning;
      repNote.classList.toggle('show', !isPro && wantsReputation);
    }
    const soundNote = document.getElementById('sound-pro-note');
    if (soundNote) soundNote.classList.toggle('show', !isPro && state.soundOnBlock);
  }

  function merged(raw) {
    return { ...DEFAULTS, ...(raw || {}) };
  }

  function showSaved() {
    savedMsg.classList.add('show');
    setTimeout(function () {
      savedMsg.classList.remove('show');
    }, 1100);
  }

  async function save(state) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: state });
    showSaved();
  }

  async function load() {
    const data = await chrome.storage.local.get([SETTINGS_KEY]);
    const state = merged(data && data[SETTINGS_KEY]);

    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(state[id]);
    });

    return state;
  }

  function collectState() {
    const state = {};
    ids.forEach(function (id) {
      state[id] = Boolean(document.getElementById(id).checked);
    });

    if (!state.reputationGuard) {
      state.lateNightPostAlert = false;
      state.emotionalPostWarning = false;
      document.getElementById('lateNightPostAlert').checked = false;
      document.getElementById('emotionalPostWarning').checked = false;
    }

    if (state.lateNightPostAlert || state.emotionalPostWarning) {
      state.reputationGuard = true;
      document.getElementById('reputationGuard').checked = true;
    }

    return state;
  }

  Promise.all([load(), loadProStatus()]).then(function (results) {
    const state = results[0];
    isPro = results[1];
    refreshProUI(state);

    ids.forEach(function (id) {
      document.getElementById(id).addEventListener('change', async function () {
        if (id === 'reputationGuard' && !document.getElementById('reputationGuard').checked) {
          document.getElementById('lateNightPostAlert').checked = false;
          document.getElementById('emotionalPostWarning').checked = false;
        }
        const updated = collectState();
        refreshProUI(updated);
        await save(updated);
      });
    });
  }).catch(function () {
    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(DEFAULTS[id]);
    });
  });
})();
