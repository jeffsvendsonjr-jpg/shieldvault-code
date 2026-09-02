(function () {
  'use strict';

  const DEFAULT_SETTINGS = {
    secretGuard: true,
    tokenGuard: true,
    passwordGuard: true,
    recoveryPhraseGuard: true,
    privateInfoGuard: true,
    clientDataGuard: true,
    largePasteGuard: true,
    screenshotReviewGuard: true,
    reputationGuard: false,
    lateNightPostAlert: false,
    emotionalPostWarning: false,
    soundOnBlock: false,
    catchSoundChoice: 'standard',
    emailReviewGuard: false,
    phoneReviewGuard: false,
  };

  const sections = Array.from(document.querySelectorAll('section[data-step]'));
  const stepLabel = document.getElementById('step-label');
  const backBtn = document.getElementById('back');
  const nextBtn = document.getElementById('next');
  const runDemoBtn = document.getElementById('run-demo');
  const demoResult = document.getElementById('demo-result');
  const openSettingsBtn = document.getElementById('open-settings');
  const doneBtn = document.getElementById('done');
  const customizeBtn = document.getElementById('customizeProtection');
  const customizePanel = document.getElementById('customizePanel');
  let step = 1;
  let onboardingSaved = false;

  function checkedOrDefault(id, fallback) {
    const element = document.getElementById(id);
    return element ? element.checked : fallback;
  }

  function currentSettingsFromUI() {
    return {
      ...DEFAULT_SETTINGS,
      secretGuard: checkedOrDefault('secretGuard', true),
      tokenGuard: true,
      passwordGuard: checkedOrDefault('passwordGuard', true),
      recoveryPhraseGuard: checkedOrDefault('passwordGuard', true),
      privateInfoGuard: checkedOrDefault('privateInfoGuard', true),
      clientDataGuard: checkedOrDefault('clientDataGuard', true),
      largePasteGuard: checkedOrDefault('largePasteGuard', true),
      screenshotReviewGuard: checkedOrDefault('screenshotReviewGuard', true),
    };
  }

  async function saveOnboardingComplete() {
    const payload = {
      onboardingComplete: true,
      shieldvaultSettings: currentSettingsFromUI(),
    };
    await chrome.storage.local.set(payload);
  }

  function render() {
    sections.forEach((s) => s.classList.toggle('hidden', Number(s.dataset.step) !== step));
    stepLabel.textContent = 'Step ' + step + ' of 4';
    const hideNav = step === 4;
    backBtn.classList.toggle('hidden', step === 1 || hideNav);
    nextBtn.classList.toggle('hidden', hideNav);

    if (step === 1) nextBtn.textContent = 'Set up protection';
    else if (step === 2) nextBtn.textContent = 'Continue with recommended protection';
    else if (step === 3) nextBtn.textContent = 'Continue';
    else nextBtn.textContent = 'Done';
  }

  runDemoBtn.addEventListener('click', function () {
    demoResult.style.display = 'block';
  });

  customizeBtn.addEventListener('click', function () {
    const willShow = customizePanel.classList.contains('hidden');
    customizePanel.classList.toggle('hidden', !willShow);
    customizeBtn.setAttribute('aria-expanded', String(willShow));
    customizeBtn.textContent = willShow ? 'Hide customization' : 'Customize protection';
  });

  backBtn.addEventListener('click', function () {
    if (step > 1) {
      step -= 1;
      render();
    }
  });

  nextBtn.addEventListener('click', async function () {
    if (step < 4) {
      step += 1;
      if (step === 4 && !onboardingSaved) {
        await saveOnboardingComplete();
        onboardingSaved = true;
      }
      render();
    }
  });

  openSettingsBtn.addEventListener('click', function () {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
  });

  doneBtn.addEventListener('click', function () {
    window.close();
  });

  render();
})();
