// ShieldVault catch audio — shared local Web Audio sounds for runtime catches and previews.
// No audio files, fetches, or external services. Preview buttons and hard catches use this same engine.
(() => {
  'use strict';

  const VALID_SOUNDS = new Set(['standard', 'alert', 'fog-horn']);

  function normalizeCatchSound(value) {
    return VALID_SOUNDS.has(value) ? value : 'standard';
  }

  function tone(ctx, destination, options) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const start = ctx.currentTime + (options.delay || 0);
    const duration = options.duration || 0.2;
    const peak = options.gain || 0.08;

    osc.type = options.type || 'sine';
    osc.frequency.setValueAtTime(options.frequency, start);
    if (options.endFrequency) {
      osc.frequency.exponentialRampToValueAtTime(options.endFrequency, start + duration);
    }

    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + Math.min(0.02, duration / 4));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  function playShieldVaultCatchSound(choice) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const sound = normalizeCatchSound(choice);

      // Current ShieldVault chime: calm descending two-tone cue.
      if (sound === 'standard') {
        tone(ctx, ctx.destination, { frequency: 660, endFrequency: 440, duration: 0.22, gain: 0.12, type: 'sine' });
      }

      // Sharper double-beep for users who want a more attention-grabbing cue.
      if (sound === 'alert') {
        tone(ctx, ctx.destination, { frequency: 820, duration: 0.11, gain: 0.085, type: 'triangle' });
        tone(ctx, ctx.destination, { frequency: 980, duration: 0.13, delay: 0.15, gain: 0.09, type: 'triangle' });
      }

      // Short two-tone fog-horn style cue. A quiet harmonic adds a little brass without an audio asset.
      if (sound === 'fog-horn') {
        tone(ctx, ctx.destination, { frequency: 165, duration: 0.18, gain: 0.07, type: 'triangle' });
        tone(ctx, ctx.destination, { frequency: 247.5, duration: 0.18, gain: 0.025, type: 'sine' });
        tone(ctx, ctx.destination, { frequency: 123, duration: 0.2, delay: 0.23, gain: 0.075, type: 'triangle' });
        tone(ctx, ctx.destination, { frequency: 184.5, duration: 0.2, delay: 0.23, gain: 0.025, type: 'sine' });
      }

      const closeAfter = sound === 'fog-horn' ? 520 : sound === 'alert' ? 380 : 320;
      setTimeout(() => {
        try { ctx.close(); } catch (_) {}
      }, closeAfter);
    } catch (_) {
      // Autoplay blocked or Web Audio unavailable — stay silent.
    }
  }

  window.ShieldVaultCatchAudio = {
    normalize: normalizeCatchSound,
    play: playShieldVaultCatchSound,
  };
})();
