// ShieldVault catch guidance — explanation layer only.
// Runs after content-script.js and enhances the existing hard-block card.
// Detector names/categories are used; matched secret values are never shown or stored.
(() => {
  if (typeof showBlockedOverlay !== "function") return;

  const originalShowBlockedOverlay = showBlockedOverlay;

  function normalize(names) {
    return (Array.isArray(names) ? names : []).map((name) => String(name || "").toLowerCase());
  }

  function includesAny(names, needles) {
    return needles.some((needle) => names.some((name) => name.includes(needle)));
  }

  function guidanceFor(detectorNames) {
    const names = normalize(detectorNames);

    if (includesAny(names, ["mongodb url", "postgresql url", "mysql url", "redis url"])) {
      return {
        title: "Database credential detected",
        detailParts: [
          { text: "This connection link contains a " },
          { text: "username", danger: true },
          { text: " and " },
          { text: "password", danger: true },
          { text: " that may grant access to a database." },
        ],
        next: "Don’t share this connection link as-is. Use a version with the credentials removed or redacted. If it may already have been shared, rotate the database credential.",
      };
    }

    if (includesAny(names, ["private key", "recovery phrase", "seed phrase", "mnemonic"])) {
      return {
        title: includesAny(names, ["recovery phrase", "seed phrase", "mnemonic"])
          ? "Recovery credential detected"
          : "Private key detected",
        detailParts: [{ text: "This text may provide direct access to an account, wallet, or protected system." }],
        next: "Don’t share it. If it may already have been exposed, replace or revoke the credential before using it again.",
      };
    }

    if (includesAny(names, ["api key", "token", "pat", "webhook", "bearer", "basic auth", "service account", "connection string"])) {
      return {
        title: includesAny(names, ["token", "pat", "bearer"]) ? "Authentication token detected" : "API credential detected",
        detailParts: [{ text: "This text contains a credential that may authorize access to a service or account." }],
        next: "Remove or redact the credential before sharing. If it may already have been exposed, revoke or rotate it at the provider.",
      };
    }

    if (includesAny(names, ["password-like", "password"])) {
      return {
        title: "Password detected",
        detailParts: [{ text: "This text appears to contain a password that could grant account or system access." }],
        next: "Remove the password before sharing. If it may already have been exposed, change it anywhere it is still in use.",
      };
    }

    if (includesAny(names, ["credit card", "card number", "iban", "bank account"])) {
      return {
        title: "Financial information detected",
        detailParts: [{ text: "This text contains financial information that should not be shared unnecessarily." }],
        next: "Remove or redact the financial details before continuing.",
      };
    }

    if (includesAny(names, ["private personal info", "client/customer data"])) {
      return {
        title: includesAny(names, ["client/customer data"]) ? "Confidential client data detected" : "Private information detected",
        detailParts: [{ text: "This text may contain sensitive personal or confidential information." }],
        next: "Review the content and redact the sensitive fields before sharing.",
      };
    }

    return {
      title: "Sensitive credential detected",
      detailParts: [{ text: "ShieldVault found text that may grant access to an account, service, or protected resource." }],
      next: "Review the detected type before sharing. Remove or redact the credential if it is not meant to leave your device.",
    };
  }

  function appendParts(container, parts) {
    container.textContent = "";
    for (const part of parts) {
      const span = document.createElement("span");
      span.textContent = part.text;
      if (part.danger) {
        span.style.cssText = "color:#dc2626;font-weight:700";
      }
      container.appendChild(span);
    }
  }

  showBlockedOverlay = function enhancedShowBlockedOverlay(el, text, detectorNames, options) {
    originalShowBlockedOverlay(el, text, detectorNames, options);

    const overlay = document.getElementById("shieldvault-blocked-overlay");
    if (!overlay) return;

    const guidance = guidanceFor(detectorNames);
    const children = Array.from(overlay.children);
    const title = children[0];
    const detail = children[1];
    const detectorList = children[2];

    if (title) title.textContent = guidance.title;
    if (detail) appendParts(detail, guidance.detailParts);

    // Keep the detector category visible for transparency, but de-emphasize it.
    if (detectorList) {
      detectorList.style.marginBottom = "9px";
    }

    const scope = children[3];
    if (!scope) return;

    const disclosure = document.createElement("div");
    disclosure.style.cssText = "margin:0 0 10px 0;padding:9px 10px;border-radius:8px;background:rgba(17,24,39,0.04);border:1px solid rgba(107,114,128,0.18)";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.textContent = "Safer next step";
    toggle.style.cssText = "display:flex;align-items:center;justify-content:space-between;width:100%;padding:0;border:0;background:transparent;color:#374151;font-size:12px;font-weight:700;cursor:pointer;text-align:left";

    const next = document.createElement("div");
    next.hidden = true;
    next.textContent = guidance.next;
    next.style.cssText = "color:#4b5563;font-size:12px;line-height:1.45;margin-top:7px";

    toggle.addEventListener("click", () => {
      const open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", open ? "false" : "true");
      next.hidden = open;
    });

    disclosure.appendChild(toggle);
    disclosure.appendChild(next);
    overlay.insertBefore(disclosure, scope.nextSibling);
  };
})();
