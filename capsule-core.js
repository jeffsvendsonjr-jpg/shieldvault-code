// ShieldVault Secure Capsules v0
// Device-bound encrypted placeholders for secrets that need to move through
// untrusted text channels without exposing their plaintext.
//
// Wire format: svcap1d.<iv-b64url>.<ciphertext+built-in-GCM-tag-b64url>
// - v1 = first capsule format
// - d  = device-bound (only this ShieldVault installation can decrypt)
//
// This is deliberately NOT a home-grown public-key protocol. v0 proves the UX
// and local security boundary with AES-256-GCM. Recipient-bound capsules will
// use a reviewed JWE/HPKE-style envelope in a later version.
(() => {
  const root = typeof globalThis !== "undefined" ? globalThis : window;
  const STORAGE_KEY = "shieldvault_capsule_master_key_v1";
  const PREFIX = "svcap1d";
  const AAD = new TextEncoder().encode("shieldvault:capsule:v1:device");
  const TOKEN_RE = /svcap1d\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)(?![A-Za-z0-9_-])/g;
  let masterKeyPromise = null;

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
    return out;
  }

  async function loadOrCreateMasterKey() {
    if (!root.crypto || !root.crypto.subtle) {
      throw new Error("Web Crypto is unavailable");
    }
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
      throw new Error("Extension storage is unavailable");
    }

    let stored = null;
    try {
      const result = await chrome.storage.local.get([STORAGE_KEY]);
      stored = result && result[STORAGE_KEY];
    } catch (_) {
      stored = null;
    }

    let raw;
    if (typeof stored === "string") {
      try {
        raw = base64UrlToBytes(stored);
      } catch (_) {
        raw = null;
      }
    }

    if (!(raw instanceof Uint8Array) || raw.length !== 32) {
      raw = new Uint8Array(32);
      root.crypto.getRandomValues(raw);
      await chrome.storage.local.set({ [STORAGE_KEY]: bytesToBase64Url(raw) });
    }

    return root.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"]
    );
  }

  function getOrCreateMasterKey() {
    if (!masterKeyPromise) {
      masterKeyPromise = loadOrCreateMasterKey().catch((error) => {
        masterKeyPromise = null;
        throw error;
      });
    }
    return masterKeyPromise;
  }

  async function sealSecret(plaintext) {
    const value = String(plaintext || "");
    if (!value) throw new Error("Cannot seal an empty secret");

    const key = await getOrCreateMasterKey();
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

    let output = input;
    let protectedCount = 0;
    for (const value of values) {
      if (!output.includes(value)) continue;
      const capsule = await sealSecret(value);
      const pieces = output.split(value);
      protectedCount += Math.max(0, pieces.length - 1);
      output = pieces.join(capsule);
    }

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
