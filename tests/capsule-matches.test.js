const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const content = read('content-script.js');
function detectorContext() {
  const ctx = vm.createContext({ atob, btoa });
  vm.runInContext(content.slice(content.indexOf('const SHIELDVAULT_DEFAULT_SETTINGS'), content.indexOf('// ================================\n// TIER')), ctx);
  vm.runInContext(content.slice(content.indexOf('const DETECTORS ='), content.indexOf('// ================================\n// BEHAVIORAL')), ctx);
  vm.runInContext(content.slice(content.indexOf('function luhnValid'), content.indexOf('function detectBehaviors')), ctx);
  vm.runInContext(read('capsule-matches.js'), ctx);
  return ctx;
}
const ctx = detectorContext();
const plan = text => ctx.ShieldVaultCapsuleMatches.plan(text);
function replace(text) {
  const spans = plan(text); let out = ''; let cursor = 0;
  for (const s of spans) { out += text.slice(cursor, s.index) + '<CAP>'; cursor = s.end; }
  return out + text.slice(cursor);
}
for (const [label, value, quoting] of [
  ['password', 'MySecret123!', '"'], ['password', 'my long secret', "'"],
  ['password', 'MySecret123!', ''], ['api_key', 'Abcdef0123456789', '"'],
  ['AWS_SECRET_ACCESS_KEY', 'AbC123+/'.repeat(5), '"'],
  ['AZURE_OPENAI_API_KEY', 'a'.repeat(32), '"'],
  ['AccountKey', 'AbC123+/'.repeat(6), ''],
]) {
  test(`preserves assignment syntax for ${label} ${quoting || 'unquoted'}`, () => {
    const input = `prefix\n${label}=${quoting}${value}${quoting};\nα suffix`;
    assert.equal(plan(input).length, 1);
    assert.equal(plan(input)[0].value, value);
    assert.equal(replace(input), `prefix\n${label}=${quoting}<CAP>${quoting};\nα suffix`);
  });
}
test('JSON password and generic key quotes are retained', () => {
  assert.equal(replace('{"password": "MySecret123!"}'), '{"password": "<CAP>"}');
  assert.equal(replace('{"api_key": "Abcdef0123456789"}'), '{"api_key": "<CAP>"}');
});
const github = 'ghp_' + 'a'.repeat(36);
const openai = 'sk-' + 'b'.repeat(24);
test('multiple credentials and repetitions use exact original spans', () => {
  assert.equal(replace(`α ${github}\n${openai}\t${github} ω`), 'α <CAP>\n<CAP>\t<CAP> ω');
});
for (const input of ['seed phrase: apple banana cherry', '-----BEGIN PRIVATE KEY-----\nabc',
  'internal only', `${github} confidential client`, `${github}\n-----BEGIN RSA PRIVATE KEY-----\nabc`,
  `${github}TRAILING`, `x${github}`, 'password="MySecret123!', 'password="hello\\"world123"']) {
  test(`withholds Protect for ambiguous or incomplete input: ${input.slice(0, 40)}`, () => {
    assert.equal(plan(input).length, 0);
  });
}
test('unknown warning categories fail closed', () => {
  const other = detectorContext();
  other.detectSecretMatches = () => [{ name: 'Future secret type', value: 'unknown123456789' }];
  assert.equal(other.ShieldVaultCapsuleMatches.plan('unknown123456789').length, 0);
});
test('large-paste metadata does not suppress fully resolved credential', () => {
  assert.equal(plan('z '.repeat(1000) + github).length, 1);
});
test('real detectors, planner and crypto preserve syntax through capsule round trip', async () => {
  const live = detectorContext();
  const { webcrypto } = require('node:crypto');
  Object.assign(live, { crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, atob, btoa,
    chrome: { runtime: { async sendMessage() { return { ok: true, key: Buffer.alloc(32, 7).toString('base64url') }; } } } });
  vm.runInContext(read('capsule-core.js'), live);
  const input = `α\npassword="MySecret123!";\n${github}\nω`;
  const api = live.ShieldVaultCapsules;
  assert.equal(api.canProtect(input), true);
  const result = await api.protectDetectedText(input);
  assert.equal(result.protectedCount, 2);
  const tokens = api.findCapsules(result.text);
  assert.equal(await api.openCapsule(tokens[0].token), 'MySecret123!');
  assert.equal(result.text.replace(tokens[0].token, '<CAP>').replace(tokens[1].token, '<CAP>'), 'α\npassword="<CAP>";\n<CAP>\nω');
  assert.equal(live.detectSecretMatches(result.text).filter(m => !m.soft).length, 0);
  const unsafe = `${input}\nseed phrase: apple banana cherry`;
  assert.equal(api.canProtect(unsafe), false);
  assert.equal((await api.protectDetectedText(unsafe)).text, unsafe);
});
test('capsule syntax exemption does not hide adjacent credentials or malformed capsules', () => {
  const iv = Buffer.alloc(12).toString('base64url');
  const ciphertext = Buffer.alloc(17, 3).toString('base64url');
  const token = `svcap1d.${iv}.${ciphertext}`;
  assert.ok(ctx.detectSecretMatches(`${token}\n${github}`).some(m => m.value === github));
  assert.ok(ctx.detectSecretMatches('password="svcap1d.invalid.invalid"').some(m => m.name === 'Password-like string'));
});
