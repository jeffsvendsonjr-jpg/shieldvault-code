// ShieldVault catch sound — core safety option for every tier.
// Runs after the hard-block UI layers. Soft reviews and reputation warnings do not use showBlockedOverlay.
// The existing Web Audio chime stays local; this wrapper only removes the Pro-only behavior without
// rewriting the detector or the audio generator in content-script.js.
(() => {
  if (typeof showBlockedOverlay !== "function" || typeof playBlockSound !== "function") return;

  const originalShowBlockedOverlay = showBlockedOverlay;
  const originalPlayBlockSound = playBlockSound;
  let lastPlayedAt = 0;

  // Plus currently calls playBlockSound() after showBlockedOverlay(). The universal
  // wrapper below calls it from showBlockedOverlay() for every tier, so de-dupe the
  // legacy Plus call to guarantee one chime per hard catch.
  playBlockSound = function dedupedCatchSound() {
    const now = Date.now();
    if (now - lastPlayedAt < 250) return;
    lastPlayedAt = now;
    originalPlayBlockSound();
  };

  showBlockedOverlay = function catchSoundShowBlockedOverlay(el, text, detectorNames, options) {
    originalShowBlockedOverlay(el, text, detectorNames, options);
    if (SHIELDVAULT_SETTINGS && SHIELDVAULT_SETTINGS.soundOnBlock) {
      playBlockSound();
    }
  };
})();
