// ShieldVault Secure Capsules v0 — hard-catch UI integration.
// Adds a third choice to a redactable hard catch: encrypt only the detected
// secret(s) into opaque device-bound capsules and preserve the surrounding text.
(() => {
  if (
    !globalThis.ShieldVaultCapsules ||
    typeof showBlockedOverlay !== "function" ||
    typeof setValue !== "function" ||
    typeof getValue !== "function" ||
    typeof detectSecretMatches !== "function"
  ) {
    return;
  }

  const originalShowBlockedOverlay = showBlockedOverlay;

  function hasProtectableSecret(text) {
    return detectSecretMatches(String(text || "")).some(
      (match) => match && match.soft !== true && typeof match.value === "string" && match.value
    );
  }

  function captureInsertionPoint(el) {
    if (!el) return null;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const value = getValue(el);
      const fallback = value.length;
      const start = Number.isInteger(el.selectionStart) ? el.selectionStart : fallback;
      const end = Number.isInteger(el.selectionEnd) ? el.selectionEnd : start;
      return { kind: "text", start, end };
    }

    if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      try {
        const selection = document.getSelection();
        if (!selection || selection.rangeCount < 1) return { kind: "editable-end" };
        const range = selection.getRangeAt(0);
        const container = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentNode
          : range.commonAncestorContainer;
        if (container && (container === el || el.contains(container))) {
          return { kind: "range", range: range.cloneRange() };
        }
      } catch (_) {}
      return { kind: "editable-end" };
    }

    return null;
  }

  function insertProtectedFragment(el, protectedText, snapshot) {
    if (!el || !protectedText) return false;

    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      const current = getValue(el);
      const start = snapshot && snapshot.kind === "text"
        ? Math.min(Math.max(0, snapshot.start), current.length)
        : current.length;
      const end = snapshot && snapshot.kind === "text"
        ? Math.min(Math.max(start, snapshot.end), current.length)
        : start;
      const next = current.slice(0, start) + protectedText + current.slice(end);
      setValue(el, next);
      const caret = start + protectedText.length;
      try { el.setSelectionRange(caret, caret); } catch (_) {}
      return getValue(el) === next;
    }

    if (el.isContentEditable || el.getAttribute("role") === "textbox") {
      try {
        el.focus();
        const selection = document.getSelection();
        if (!selection) return false;
        selection.removeAllRanges();

        if (snapshot && snapshot.kind === "range" && snapshot.range) {
          const container = snapshot.range.commonAncestorContainer.nodeType === Node.TEXT_NODE
            ? snapshot.range.commonAncestorContainer.parentNode
            : snapshot.range.commonAncestorContainer;
          if (container && (container === el || el.contains(container))) {
            selection.addRange(snapshot.range);
          }
        }

        if (selection.rangeCount < 1) {
          const endRange = document.createRange();
          endRange.selectNodeContents(el);
          endRange.collapse(false);
          selection.addRange(endRange);
        }

        const inserted = document.execCommand("insertText", false, protectedText);
        return Boolean(inserted && getValue(el).includes(protectedText));
      } catch (_) {
        return false;
      }
    }

    return false;
  }

  function addCapsuleAction(overlay, el, blockedText, options, insertionPoint) {
    if (!overlay || !el || !hasProtectableSecret(blockedText)) return;
    if (overlay.querySelector("#sv-protect-capsule-btn")) return;

    const allowButton = Array.from(overlay.querySelectorAll("button")).find((button) =>
      /allow once/i.test(button.textContent || "")
    );
    const actions = allowButton && allowButton.parentElement;
    if (!actions) return;

    const restoreOnAllow = !(options && options.restoreOnAllow === false);
    const protect = document.createElement("button");
    protect.id = "sv-protect-capsule-btn";
    protect.type = "button";
    protect.textContent = restoreOnAllow ? "Protect secret & continue" : "Protect & insert";
    protect.title = "Encrypt the detected secret locally and replace only that secret with an opaque ShieldVault capsule.";
    protect.style.cssText = [
      "padding:7px 10px",
      "border-radius:7px",
      "border:1px solid #0f766e",
      "background:#ecfdf5",
      "color:#115e59",
      "cursor:pointer",
      "font-weight:600",
    ].join(";");

    protect.addEventListener("click", async () => {
      if (protect.disabled) return;
      protect.disabled = true;
      protect.textContent = "Protecting…";

      try {
        const result = await globalThis.ShieldVaultCapsules.protectDetectedText(blockedText);
        if (!result || result.protectedCount < 1 || result.text === blockedText) {
          throw new Error("No exact secret was available to protect");
        }

        let applied = false;
        if (restoreOnAllow) {
          setValue(el, result.text);
          applied = getValue(el) === result.text;
        } else {
          applied = insertProtectedFragment(el, result.text, insertionPoint);
        }

        if (!applied) {
          throw new Error("The protected text could not be placed into this editor");
        }

        el.focus();
        overlay.remove();
      } catch (_) {
        protect.disabled = false;
        protect.textContent = "Could not protect — retry";
        protect.style.borderColor = "#b91c1c";
        protect.style.color = "#991b1b";
        protect.style.background = "#fef2f2";
      }
    });

    actions.insertBefore(protect, allowButton);
  }

  showBlockedOverlay = function capsuleAwareBlockedOverlay(el, text, detectorNames, options) {
    // Capture the original caret/range before the overlay button steals focus.
    // This lets a cancelled paste be replaced by the protected fragment rather
    // than replacing the user's entire existing message.
    const insertionPoint = captureInsertionPoint(el);
    originalShowBlockedOverlay(el, text, detectorNames, options);
    const overlay = document.getElementById("shieldvault-blocked-overlay");
    addCapsuleAction(overlay, el, String(text || ""), options, insertionPoint);
  };
})();
