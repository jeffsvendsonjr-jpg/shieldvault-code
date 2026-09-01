// ShieldVault catch sound — core safety option for every tier.
// Runs after the hard-block UI layers. Soft reviews and reputation warnings do not use showBlockedOverlay.
(() => {
  if (typeof showBlockedOverlay !== "function" || typeof playBlockSound !== "function") return;

  const originalShowBlockedOverlay = showBlockedOverlay;
  let lastPlayedAt = 0;

  function playSelectedCatchSound() {
    const now = Date.now();
    if (now - lastPlayedAt < 250) return;
    lastPlayedAt = now;

    const choice = SHIELDVAULT_SETTINGS && SHIELDVAULT_SETTINGS.catchSoundChoice
      ? SHIELDVAULT_SETTINGS.catchSoundChoice
      : "standard";

    if (window.ShieldVaultCatchAudio && typeof window.ShieldVaultCatchAudio.play === "function") {
      window.ShieldVaultCatchAudio.play(choice);
      return;
    }

    // Defensive fallback: preserve the existing local chime if the shared audio
    // helper ever fails to load.
    try { playBlockSound(); } catch (_) {}
  }

  // Legacy Plus code still calls playBlockSound() after showBlockedOverlay().
  // Route that call into the selected core sound and de-dupe it against the
  // universal hard-catch path below so each catch produces at most one cue.
  playBlockSound = playSelectedCatchSound;

  showBlockedOverlay = function catchSoundShowBlockedOverlay(el, text, detectorNames, options) {
    originalShowBlockedOverlay(el, text, detectorNames, options);
    if (SHIELDVAULT_SETTINGS && SHIELDVAULT_SETTINGS.soundOnBlock) {
      playSelectedCatchSound();
    }
  };
})();
