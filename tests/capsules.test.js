'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const KEY = 'shieldvault_capsule_master_key_v1';
const globals = { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa };
function installation(state = {}) {
  const faults = { read: false, write: false };
  let writes = 0;
  const local = {
    async get() { if (faults.read) throw Error('read'); return { ...state }; },
    async set(value) { if (faults.write) throw Error('write'); writes++; Object.assign(state, value); },
  };
  function worker() {
    const ctx = vm.createContext({ ...globals, chrome: { storage: { local } } });
    vm.runInContext(source('background.js').split('const SHIELDVAULT_DEFAULT_SETTINGS')[0], ctx);
    return ctx.requestCapsuleKey;
  }
  let authority = worker();
  return { state, faults, get writes() { return writes; }, restart() { authority = worker(); },
    tab(detector = () => []) {
      const ctx = vm.createContext({ ...globals, detectSecretMatches: detector, chrome: { runtime: {
        async sendMessage(message) {
          assert.deepEqual(Object.keys(message).sort(), ['create', 'type']);
          try { return { ok: true, key: await authority(message.create) }; } catch { return { ok: false }; }
        },
      } } });
      ctx.ShieldVaultCapsuleMatches = { plan(text) {
        const values = detector(text).filter(m => m.value && !m.soft).map(m => m.value).sort((a,b) => b.length-a.length);
        const spans = [];
        for (const value of values) {
          let index = text.indexOf(value);
          while (index >= 0) {
            const end = index + value.length;
            if (!spans.some(s => index < s.end && end > s.index)) spans.push({ index, end, value });
            index = text.indexOf(value, end);
          }
        }
        return spans.sort((a,b) => a.index-b.index);
      } };
      vm.runInContext(source('capsule-core.js'), ctx);
      return ctx.ShieldVaultCapsules;
    },
  };
}
test('simultaneous first use in independent tabs survives worker restart', async () => {
  const install = installation();
  const tokens = await Promise.all(Array.from({ length: 12 }, (_, i) => install.tab().sealSecret(`secret ${i}`)));
  assert.equal(install.writes, 1);
  install.restart();
  for (let i = 0; i < tokens.length; i++) assert.equal(await install.tab().openCapsule(tokens[i]), `secret ${i}`);
});
test('same installation Unicode round trip; alternate installation and reset fail without creating keys', async () => {
  const install = installation(); const tab = install.tab();
  const secret = '秘密 🔐\nline two'; const token = await tab.sealSecret(secret);
  assert.equal(await tab.openCapsule(token), secret);
  const other = installation(); await assert.rejects(other.tab().openCapsule(token)); assert.equal(other.writes, 0);
  delete install.state[KEY]; await assert.rejects(tab.openCapsule(token)); assert.equal(install.writes, 1);
});
test('read failure, corrupt key and failed write fail closed; retry works', async () => {
  const install = installation(); const tab = install.tab();
  const token = await tab.sealSecret('original'); const original = install.state[KEY];
  install.faults.read = true; await assert.rejects(tab.sealSecret('next'));
  install.faults.read = false; assert.equal(install.state[KEY], original);
  install.state[KEY] = 'broken'; await assert.rejects(tab.sealSecret('next')); assert.equal(install.state[KEY], 'broken');
  install.state[KEY] = original; assert.equal(await tab.openCapsule(token), 'original');
  const fresh = installation(); fresh.faults.write = true; await assert.rejects(fresh.tab().sealSecret('x'));
  fresh.faults.write = false; assert.ok(await fresh.tab().sealSecret('x'));
});
test('modified IV, ciphertext, tag and noncanonical encoding fail', async () => {
  const tab = installation().tab(); const token = await tab.sealSecret('x');
  for (const [part, offset] of [[1, 0], [2, 0], [2, -1]]) {
    const parts = token.split('.'); const bytes = Buffer.from(parts[part], 'base64url');
    bytes[offset === -1 ? bytes.length - 1 : offset] ^= 1; parts[part] = bytes.toString('base64url');
    await assert.rejects(tab.openCapsule(parts.join('.')));
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(token.at(-1));
  await assert.rejects(tab.openCapsule(token.slice(0, -1) + alphabet[last | 1]));
});
test('exact matched substrings replaced; Unicode, whitespace, repeated and overlapping values preserved', async () => {
  const tab = installation().tab(() => [{ value: 'SECRET-LONG', soft: false }, { value: 'SECRET', soft: false }]);
  const input = 'α\tSECRET-LONG\nSECRET\nSECRET-LONG ω';
  const result = await tab.protectDetectedText(input); assert.equal(result.protectedCount, 3);
  let restored = result.text;
  for (const { token } of tab.findCapsules(result.text)) restored = restored.replace(token, await tab.openCapsule(token));
  assert.equal(restored, input);
  assert.equal(new Set(tab.findCapsules(result.text).map(x => x.token)).size, 3);
});
test('signal-only and soft detections produce no capsule or key', async () => {
  const install = installation();
  const tab = install.tab(() => [{ value: null, soft: false }, { value: 'email', soft: true }]);
  const result = await tab.protectDetectedText('email internal only');
  assert.equal(result.text, 'email internal only'); assert.equal(result.protectedCount, 0); assert.equal(install.writes, 0);
});

function uiHarness(matches, field) {
  let click;
  let added = false;
  const overlay = { removed: false, querySelector: () => null, remove() { this.removed = true; },
    querySelectorAll: () => [{ textContent: 'Allow once', parentElement: { insertBefore() { added = true; } } }],
  };
  const ctx = vm.createContext({
    ShieldVaultCapsules: { canProtect: () => matches.some(m => m.value && !m.soft), async protectDetectedText() { return { text: 'before CAPSULE after', protectedCount: 1 }; } },
    detectSecretMatches: () => matches,
    showBlockedOverlay() {}, getValue: el => el.value, setValue: (el, value) => { el.value = value; },
    document: { getElementById: () => overlay, createElement: () => ({ style: {}, addEventListener: (_, fn) => { click = fn; } }) },
  });
  vm.runInContext(source('capsule-ui.js'), ctx);
  ctx.showBlockedOverlay(field, 'before secret after', [], { restoreOnAllow: false });
  return { get added() { return added; }, click: () => click(), overlay };
}
test('signal-only warnings do not add a Protect UI action', () => {
  const field = { tagName: 'TEXTAREA', value: 'draft', selectionStart: 2, selectionEnd: 2 };
  assert.equal(uiHarness([{ value: null, soft: false }], field).added, false);
  assert.equal(uiHarness([{ value: 'contact', soft: true }], field).added, false);
});
test('Protect inserts at textarea selection and preserves surrounding draft', async () => {
  const field = { tagName: 'TEXTAREA', value: 'LEFT selected RIGHT', selectionStart: 5, selectionEnd: 13,
    focus() {}, setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
  };
  const ui = uiHarness([{ value: 'secret', soft: false }], field);
  assert.equal(ui.added, true); await ui.click();
  assert.equal(field.value, 'LEFT before CAPSULE after RIGHT');
  assert.equal(field.selectionStart, 'LEFT before CAPSULE after'.length);
  assert.equal(ui.overlay.removed, true);
});
