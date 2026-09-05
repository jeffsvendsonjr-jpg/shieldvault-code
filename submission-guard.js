// ShieldVault submission guard — closes mouse/tap and native form-submit gaps.
// Runs after content-script.js and reuses its local-only detection pipeline.
(() => {
  if (
    typeof resolveEditable !== "function" ||
    typeof getActiveEditable !== "function" ||
    typeof getValue !== "function" ||
    typeof handleDetection !== "function"
  ) {
    return;
  }

  let lastEditable = null;

  function rememberEditable(target) {
    const el = resolveEditable(target);
    if (el) lastEditable = el;
    return el;
  }

  function isUsableEditable(el) {
    return Boolean(el && el.isConnected && typeof getValue(el) === "string");
  }

  function editableInForm(form) {
    if (!form || typeof form.querySelectorAll !== "function") return null;

    const candidates = form.querySelectorAll(
      'textarea, input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"]'
    );

    // Prefer the most recently edited field when it belongs to this form.
    if (isUsableEditable(lastEditable) && form.contains(lastEditable)) {
      return lastEditable;
    }

    for (const candidate of candidates) {
      const el = resolveEditable(candidate);
      if (!isUsableEditable(el)) continue;
      const value = getValue(el);
      if (value && value.trim()) return el;
    }

    return null;
  }

  function submissionEditable(trigger) {
    const active = getActiveEditable();
    if (isUsableEditable(active)) return active;

    const form = trigger && typeof trigger.closest === "function"
      ? trigger.closest("form")
      : null;
    const formEditable = editableInForm(form);
    if (formEditable) return formEditable;

    return isUsableEditable(lastEditable) ? lastEditable : null;
  }

  function controlLabel(control) {
    return [
      control.getAttribute && control.getAttribute("aria-label"),
      control.getAttribute && control.getAttribute("title"),
      control.getAttribute && control.getAttribute("name"),
      control.value,
      control.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function isSubmitControl(target) {
    if (!target || typeof target.closest !== "function") return false;

    const control = target.closest('button, input[type="submit"], input[type="button"], [role="button"]');
    if (!control) return false;
    if (control.disabled || control.getAttribute("aria-disabled") === "true") return false;

    const tag = String(control.tagName || "").toUpperCase();
    const type = String(control.getAttribute("type") || "").toLowerCase();

    // Native submit controls are unambiguous. A <button> inside a form defaults
    // to submit when no type is declared, matching browser behavior.
    if (type === "submit") return true;
    if (tag === "BUTTON" && !type && control.closest("form")) return true;

    // SPA chat composers often use type="button" with only an accessible label.
    // Keep this intentionally conservative to avoid intercepting unrelated UI.
    return /\b(send|submit|post|reply|publish|comment|ask)\b/i.test(controlLabel(control));
  }

  function inspectSubmission(event, trigger) {
    const el = submissionEditable(trigger);
    if (!el) return false;

    const value = getValue(el);
    if (!value || !value.trim()) return false;

    return handleDetection(value, el, "submit", event) === true;
  }

  // Keep a field reference across the focus change that normally happens when
  // the user clicks a send button. No content is copied or stored here.
  document.addEventListener(
    "focusin",
    (event) => {
      rememberEditable(event.target);
    },
    true
  );

  document.addEventListener(
    "input",
    (event) => {
      rememberEditable(event.target);
    },
    true
  );

  document.addEventListener(
    "paste",
    (event) => {
      rememberEditable(event.target);
    },
    true
  );

  // Native forms can submit through buttons, Enter behavior implemented by the
  // page, or script-triggered requestSubmit(). Catch the final cancelable event.
  document.addEventListener(
    "submit",
    (event) => {
      const form = event.target && String(event.target.tagName || "").toUpperCase() === "FORM"
        ? event.target
        : null;
      const trigger = (event.submitter || form);
      inspectSubmission(event, trigger);
    },
    true
  );

  // Many AI/chat apps never emit a form submit. Their Send button is an SPA
  // click handler, so inspect it during capture before the page receives it.
  document.addEventListener(
    "click",
    (event) => {
      if (!isSubmitControl(event.target)) return;
      inspectSubmission(event, event.target);
    },
    true
  );
})();
