// ShieldVault Secure Capsules v0
// Device-bound encrypted placeholders for secrets that need to move through
// untrusted text channels without exposing their plaintext.
//
// Wire format: svcap1d.<iv-b64url>.<ciphertext+built-in-GCM-tag-b64url>
// - v1 = first capsule format
// - d  = device-bound (requires the originating browser-profile key)
//
// This is deliberately NOT a home-grown public-key protocol. v0 proves the UX
// and explores a local security boundary with AES-256-GCM. Recipient-bound capsules will
// use a reviewed JWE/HPKE-style envelope in a later version.
(() => {
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const PREFIX = "svcap1d";
  const AAD = new TextEncoder().encode("shieldvault:capsule:v1:device");
  const TOKEN_RE = /svcap1d\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g;


  function bytesToBase64Url(bytes) {
    let binary = "";
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padding = "=".repeat((4 - (normalized.length % 4 || 4)) % 4);
    const binary = atob(normalized + padding);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    if (bytesToBase64Url(out) !== value) throw new Error("Noncanonical capsule encoding");
    return out;
  }

  async function getOrCreateMasterKey(create = false) {
    if (!root.crypto || !root.crypto.subtle) throw new Error("Web Crypto is unavailable");
    const response = await chrome.runtime.sendMessage({ type: "SHIELDVAULT_CAPSULE_KEY", create });
    if (!response || response.ok !== true) throw new Error("Capsule key unavailable");
    const raw = base64UrlToBytes(response.key);
    if (raw.length !== 32) throw new Error("Invalid capsule key");
    return root.crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  }

  async function sealSecret(plaintext) {
    const value = String(plaintext || "");
    if (!value) throw new Error("Cannot seal an empty secret");

    const key = await getOrCreateMasterKey(true);
    const iv = new Uint8Array(12);
    root.crypto.getRandomValues(iv);
    const ciphertext = await root.crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 },
      key,
      new TextEncoder().encode(value)
    );

    return `${PREFIX}.${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
  }

  async function openCapsule(token) {
    const match = /^svcap1d\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(String(token || ""));
    if (!match) throw new Error("Unsupported ShieldVault capsule");

    const iv = base64UrlToBytes(match[1]);
    if (iv.length !== 12) throw new Error("Invalid capsule IV");

    const ciphertext = base64UrlToBytes(match[2]);
    const key = await getOrCreateMasterKey();
    const plaintext = await root.crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD, tagLength: 128 },
      key,
      ciphertext
    );
    return new TextDecoder().decode(plaintext);
  }

  function findCapsules(text) {
    const input = String(text || "");
    const found = [];
    TOKEN_RE.lastIndex = 0;
    let match;
    while ((match = TOKEN_RE.exec(input)) !== null) {
      found.push({ token: match[0], index: match.index });
    }
    TOKEN_RE.lastIndex = 0;
    return found;
  }

  async function protectDetectedText(text) {
    const input = String(text || "");
    if (!input) return { text: input, protectedCount: 0 };
    if (typeof detectSecretMatches !== "function") {
      throw new Error("ShieldVault detector is unavailable");
    }

    const values = [...new Set(
      detectSecretMatches(input)
        .filter((match) => match && match.soft !== true && typeof match.value === "string" && match.value)
        .map((match) => match.value)
    )].sort((a, b) => b.length - a.length);

    if (!values.length) return { text: input, protectedCount: 0 };

    // Resolve replacements against the original input, never generated ciphertext.
    const spans = [];
    for (const value of values) {
      let index = input.indexOf(value);
      while (index !== -1) {
        const end = index + value.length;
        if (!spans.some((span) => index < span.end && end > span.index)) spans.push({ index, end, value });
        index = input.indexOf(value, end);
      }
    }
    spans.sort((a, b) => a.index - b.index);
    let output = "";
    let cursor = 0;
    for (const span of spans) {
      output += input.slice(cursor, span.index) + await sealSecret(span.value);
      cursor = span.end;
    }
    output += input.slice(cursor);
    const protectedCount = spans.length;

    return { text: output, protectedCount };
  }

  root.ShieldVaultCapsules = Object.freeze({
    version: 1,
    mode: "device",
    prefix: PREFIX,
    sealSecret,
    openCapsule,
    findCapsules,
    protectDetectedText,
  });
})();
