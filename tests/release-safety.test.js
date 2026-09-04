'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const contentScript = fs.readFileSync(path.join(ROOT, 'content-script.js'), 'utf8');

function detectorPattern(name) {
  const line = contentScript
    .split(/\r?\n/)
    .find((candidate) => candidate.includes(`{ name: "${name}", pattern:`));
  assert.ok(line, `${name} detector exists`);

  const literal = line.match(/pattern:\s*(\/.*\/[dgimsuvy]*)\s*},\s*$/)?.[1];
  assert.ok(literal, `${name} detector has a regular expression pattern`);
  return vm.runInNewContext(literal);
}

test('manifest description is the exact approved text', () => {
  assert.equal(
    manifest.description,
    'Detects API keys in AI chats and prevents regrettable sends (angry posts, passive-aggression). Detection runs 100% on-device.'
  );
});

test('Google Docs is absent from content-script matches', () => {
  const matches = manifest.content_scripts.flatMap((script) => script.matches || []);
  assert.equal(matches.includes('https://docs.google.com/*'), false);
});

test('Twilio API key detector requires standalone word boundaries', () => {
  const pattern = detectorPattern('Twilio API Key');
  const valid = 'SK' + '0123456789abcdef'.repeat(2);

  assert.equal(pattern.test(valid), true);
  assert.equal(pattern.test(`x${valid}`), false);
  assert.equal(pattern.test(`${valid}x`), false);
});

test('Discord bot token detector requires standalone word boundaries', () => {
  const pattern = detectorPattern('Discord Bot Token');
  const valid = `M${'a'.repeat(23)}.ABC123.${'z'.repeat(27)}`;

  assert.equal(pattern.test(valid), true);
  assert.equal(pattern.test(`x${valid}`), false);
  assert.equal(pattern.test(`${valid}x`), false);
});
