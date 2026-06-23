// Service worker for ShieldVault extension
// Removed userp.ly date verification feature (not core to ShieldVault)

const SHIELDVAULT_DEFAULT_SETTINGS = {
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
};

async function ensureShieldVaultDefaults() {
  try {
    const current = await chrome.storage.local.get(['onboardingComplete', 'shieldvaultSettings']);
    const mergedSettings = {
      ...SHIELDVAULT_DEFAULT_SETTINGS,
      ...(current && current.shieldvaultSettings ? current.shieldvaultSettings : {}),
    };
    const payload = { shieldvaultSettings: mergedSettings };
    if (typeof current.onboardingComplete !== 'boolean') payload.onboardingComplete = false;
    await chrome.storage.local.set(payload);
  } catch (_) {
    // Ignore storage failures in service worker.
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    ensureShieldVaultDefaults().finally(() => {
      chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') });
    });
    return;
  }
  ensureShieldVaultDefaults();
});
