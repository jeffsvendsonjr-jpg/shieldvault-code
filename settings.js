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
    catchSoundChoice: 'standard',
    emailReviewGuard: false,
    phoneReviewGuard: false,
  };

  const ids = Object.keys(DEFAULTS).filter((id) => typeof DEFAULTS[id] === 'boolean');
  const savedMsg = document.getElementById('saved-msg');
  const soundChoice = document.getElementById('catchSoundChoice');
  const previewSound = document.getElementById('previewCatchSound');
  let isPro = false;

  function loadProStatus() {
    return new Promise(function (resolve) {
      try {
        chrome.storage.local.get(['shieldvault_pro', 'shieldvault_tier', 'shieldvault_pro_expiry'], function (result) {
          if (chrome.runtime.lastError) return resolve(false);
          const expiry = result.shieldvault_pro_expiry;
          const expired = typeof expiry === 'number' && expiry > 0 && Date.now() > expiry;
          const entitled = result.shieldvault_pro === true || result.shieldvault_tier === 'plus';
          resolve(entitled && !expired);
        });
      } catch (_) {
        resolve(false);
      }
    });
  }

  function refreshProUI(state) {
    const upsell = document.getElementById('pro-upsell');
    if (upsell) upsell.style.display = isPro ? 'none' : '';
    const repNote = document.getElementById('reputation-pro-note');
    if (repNote) {
      const wantsReputation = state.reputationGuard || state.lateNightPostAlert || state.emotionalPostWarning;
      repNote.classList.toggle('show', !isPro && wantsReputation);
    }
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
    soundChoice.value = window.ShieldVaultCatchAudio
      ? window.ShieldVaultCatchAudio.normalize(state.catchSoundChoice)
      : 'standard';

    return state;
  }

  function collectState() {
    const state = {};
    ids.forEach(function (id) {
      state[id] = Boolean(document.getElementById(id).checked);
    });
    state.catchSoundChoice = soundChoice.value;

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

    soundChoice.addEventListener('change', async function () {
      const updated = collectState();
      refreshProUI(updated);
      await save(updated);
    });

    previewSound.addEventListener('click', function () {
      if (window.ShieldVaultCatchAudio) window.ShieldVaultCatchAudio.play(soundChoice.value);
    });
  }).catch(function () {
    ids.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) el.checked = Boolean(DEFAULTS[id]);
    });
    soundChoice.value = 'standard';
  });
})();
