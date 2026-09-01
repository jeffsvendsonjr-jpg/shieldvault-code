// ShieldVault Screenshot Guard
// Local-only pre-send review for likely screenshots/images. This intentionally
// does NOT claim to OCR or inspect image pixels yet; it simply closes the blind
// spot where sensitive text can be embedded inside an image.
(() => {
  'use strict';

  const SETTINGS_KEY = 'shieldvaultSettings';
  const SCREENSHOT_NAME = /(?:screen\s*shot|screenshot|screen\s*capture|snip(?:ping)?|capture)/i;
  let enabled = true;
  let lastNoticeAt = 0;

  function isPaused() {
    try {
      return typeof SHIELDVAULT_PAUSED !== 'undefined' && SHIELDVAULT_PAUSED === true;
    } catch (_) {
      return false;
    }
  }

  function isImage(file) {
    return Boolean(file && typeof file.type === 'string' && file.type.startsWith('image/'));
  }

  function looksLikeScreenshotFile(file) {
    if (!isImage(file)) return false;
    return SCREENSHOT_NAME.test(file.name || '');
  }

  function showScreenshotReview(sourceLabel) {
    if (!enabled || isPaused() || !document.body) return;
    const now = Date.now();
    if (now - lastNoticeAt < 1200) return;
    lastNoticeAt = now;

    const existing = document.getElementById('shieldvault-screenshot-review');
    if (existing) existing.remove();

    const card = document.createElement('div');
    card.id = 'shieldvault-screenshot-review';
    card.setAttribute('role', 'status');
    card.style.cssText = [
      'position:fixed','right:18px','bottom:18px','z-index:2147483647',
      'width:min(360px,calc(100vw - 36px))','padding:14px',
      'border:1px solid rgba(251,191,36,.55)','border-radius:12px',
      'background:rgba(17,24,39,.96)','box-shadow:0 16px 40px rgba(0,0,0,.35)',
      'color:#f9fafb','font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
      'font-size:13px','line-height:1.4'
    ].join(';');

    const title = document.createElement('div');
    title.textContent = 'Screenshot detected — review before sending';
    title.style.cssText = 'font-weight:700;margin-bottom:6px;color:#fbbf24';
    card.appendChild(title);

    const detail = document.createElement('div');
    detail.textContent = 'Image text can bypass text-only secret detection. Check for API keys, passwords, account numbers, and private or client information.';
    detail.style.cssText = 'margin-bottom:8px;color:#e5e7eb';
    card.appendChild(detail);

    const privacy = document.createElement('div');
    privacy.textContent = 'ShieldVault did not read, upload, or store this image. Source: ' + sourceLabel + '.';
    privacy.style.cssText = 'margin-bottom:10px;color:#9ca3af;font-size:12px';
    card.appendChild(privacy);

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap';

    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = 'Got it';
    dismiss.style.cssText = 'border:1px solid #4b5563;background:#1f2937;color:#f9fafb;border-radius:7px;padding:6px 9px;cursor:pointer';
    dismiss.addEventListener('click', () => card.remove());
    actions.appendChild(dismiss);

    const turnOff = document.createElement('button');
    turnOff.type = 'button';
    turnOff.textContent = 'Turn off screenshot review';
    turnOff.style.cssText = 'border:0;background:none;color:#9ca3af;text-decoration:underline;padding:4px 0;cursor:pointer;font-size:12px';
    turnOff.addEventListener('click', async () => {
      try {
        const result = await chrome.storage.local.get([SETTINGS_KEY]);
        const current = result && result[SETTINGS_KEY] ? result[SETTINGS_KEY] : {};
        await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, screenshotReviewGuard: false } });
        enabled = false;
      } catch (_) {}
      card.remove();
    });
    actions.appendChild(turnOff);
    card.appendChild(actions);

    // Security review notices persist until the user explicitly acknowledges
    // them or disables screenshot review. Do not silently auto-dismiss.
    document.body.appendChild(card);
  }

  // Normalize newly introduced defaults without overwriting an explicit user choice.
  // This also closes the runtime fallback gap for email/phone review defaults.
  async function loadAndNormalizeSettings() {
    try {
      const result = await chrome.storage.local.get([SETTINGS_KEY]);
      const current = result && result[SETTINGS_KEY] ? result[SETTINGS_KEY] : {};
      const next = { ...current };
      let changed = false;

      if (!Object.prototype.hasOwnProperty.call(next, 'emailReviewGuard')) {
        next.emailReviewGuard = false;
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(next, 'phoneReviewGuard')) {
        next.phoneReviewGuard = false;
        changed = true;
      }
      if (!Object.prototype.hasOwnProperty.call(next, 'screenshotReviewGuard')) {
        next.screenshotReviewGuard = true;
        changed = true;
      }

      enabled = next.screenshotReviewGuard !== false;
      if (changed) await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    } catch (_) {
      enabled = true;
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SETTINGS_KEY]) return;
    const next = changes[SETTINGS_KEY].newValue || {};
    enabled = next.screenshotReviewGuard !== false;
  });

  // Clipboard images are the strongest low-noise screenshot signal in the browser.
  document.addEventListener('paste', (event) => {
    if (!enabled || isPaused()) return;
    const items = Array.from((event.clipboardData && event.clipboardData.items) || []);
    if (items.some((item) => item && typeof item.type === 'string' && item.type.startsWith('image/'))) {
      showScreenshotReview('clipboard image');
    }
  }, true);

  // For drag/drop and file pickers, warn only for image files whose names look
  // screenshot-like so ordinary photos do not create needless review noise.
  document.addEventListener('drop', (event) => {
    if (!enabled || isPaused()) return;
    const files = Array.from((event.dataTransfer && event.dataTransfer.files) || []);
    if (files.some(looksLikeScreenshotFile)) showScreenshotReview('screenshot file');
  }, true);

  document.addEventListener('change', (event) => {
    if (!enabled || isPaused()) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== 'file') return;
    const files = Array.from(target.files || []);
    if (files.some(looksLikeScreenshotFile)) showScreenshotReview('screenshot file');
  }, true);

  loadAndNormalizeSettings();
})();
