'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const SESSION_KEY = 'shieldvault_verified_session';
const TTL_MS = 15 * 60 * 1000;
const GRACE_MS = 72 * 60 * 60 * 1000;
const START_TIME = 1_800_000_000_000;
const LOCAL_ENTITLEMENT_METADATA_KEYS = [
  'shieldvault_pro',
  'shieldvault_pro_expiry',
  'shieldvault_pro_plan',
  'shieldvault_tier',
  'shieldvault_email',
  'shieldvault_last_verified_at',
];

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function storageArea(seed = {}, { beforeGet } = {}) {
  const state = clone(seed);
  const removeCalls = [];
  return {
    state,
    removeCalls,
    async get(keys) {
      if (beforeGet) await beforeGet(clone(keys));
      if (keys == null) return clone(state);
      const result = {};
      if (typeof keys === 'string') keys = [keys];
      if (Array.isArray(keys)) {
        for (const key of keys) {
          if (Object.prototype.hasOwnProperty.call(state, key)) result[key] = clone(state[key]);
        }
      } else {
        for (const [key, fallback] of Object.entries(keys)) {
          result[key] = Object.prototype.hasOwnProperty.call(state, key)
            ? clone(state[key])
            : clone(fallback);
        }
      }
      return result;
    },
    async set(values) {
      for (const [key, value] of Object.entries(clone(values))) state[key] = value;
    },
    async remove(keys) {
      if (!Array.isArray(keys)) keys = [keys];
      removeCalls.push(clone(keys));
      for (const key of keys) delete state[key];
    },
  };
}

function eventChannel() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    },
  };
}

function serverResponse(data, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return clone(data);
    },
  };
}

function createHarness(options = {}) {
  const local = storageArea(options.local, { beforeGet: options.localBeforeGet });
  const session = storageArea(options.session);
  const onInstalled = eventChannel();
  const onStartup = eventChannel();
  const onMessage = eventChannel();
  const runtimeMessages = [];
  const tabMessages = [];
  const fetchCalls = [];
  const warnings = [];
  let now = options.now || START_TIME;
  let fetchHandler = options.fetch || (async () => {
    throw new Error('offline');
  });

  class FakeDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [now]));
    }
    static now() {
      return now;
    }
  }

  const chrome = {
    storage: { local, session },
    runtime: {
      lastError: null,
      onInstalled,
      onStartup,
      onMessage,
      getURL: (file) => `chrome-extension://test/${file}`,
      openOptionsPage: async () => {},
      sendMessage(message) {
        runtimeMessages.push(clone(message));
        return options.runtimeSend
          ? options.runtimeSend(message)
          : Promise.resolve();
      },
    },
    tabs: {
      async query() {
        return clone(options.tabs || []);
      },
      create: async () => {},
      sendMessage(tabId, message) {
        tabMessages.push({ tabId, message: clone(message) });
        return options.tabSend
          ? options.tabSend(tabId, message)
          : Promise.resolve();
      },
    },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async () => {},
    },
  };

  const context = vm.createContext({
    chrome,
    Date: FakeDate,
    URL,
    fetch(url, requestOptions) {
      fetchCalls.push({ url: String(url), options: clone(requestOptions) });
      return fetchHandler(url, requestOptions);
    },
    console: {
      log() {},
      error() {},
      warn(...args) {
        warnings.push(args.map(String).join(' '));
      },
    },
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(BACKGROUND_SOURCE, context, { filename: 'background.js' });

  async function request(message, sender = {}) {
    const listener = onMessage.listeners[0];
    assert.equal(typeof listener, 'function', 'background message listener was registered');
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => reject(new Error(`No response for ${message.type}`)), 2000);
      const sendResponse = (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(clone(response));
      };
      const handled = listener(clone(message), clone(sender), sendResponse);
      if (handled !== true && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve(undefined);
      }
    });
  }

  return {
    local,
    session,
    onStartup,
    runtimeMessages,
    tabMessages,
    fetchCalls,
    warnings,
    request,
    setFetch(handler) {
      fetchHandler = handler;
    },
    advance(milliseconds) {
      now += milliseconds;
    },
    now() {
      return now;
    },
  };
}

async function eventually(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

test('editable local entitlement flags cannot grant Plus', async () => {
  const forgedWithoutKey = createHarness({
    local: {
      shieldvault_pro: true,
      shieldvault_tier: 'plus',
      shieldvault_pro_expiry: START_TIME + GRACE_MS,
    },
    fetch: async () => assert.fail('no-key state must not contact the server'),
  });
  const noKey = await forgedWithoutKey.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(noKey.isPro, false);
  assert.equal(noKey.reason, 'no_license');
  assert.equal(forgedWithoutKey.fetchCalls.length, 0);

  const forgedWithKey = createHarness({
    local: {
      shieldvault_license_key: 'forged-key',
      shieldvault_pro: true,
      shieldvault_tier: 'plus',
      shieldvault_pro_expiry: START_TIME + GRACE_MS,
    },
  });
  const offline = await forgedWithKey.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(offline.isPro, false);
  assert.equal(offline.reason, 'verification_unavailable');

  for (const file of ['content-script.js', 'settings.js', 'proofs.js']) {
    const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    assert.match(source, /SHIELDVAULT_(?:GET|REFRESH)_ENTITLEMENT/, `${file} uses worker IPC`);
    assert.doesNotMatch(source, /result\.shieldvault_pro\s*===\s*true/);
    assert.doesNotMatch(source, /result\.shieldvault_tier\s*===\s*['"]plus['"]/);
  }
  const popupSource = fs.readFileSync(path.join(ROOT, 'proofs.js'), 'utf8');
  assert.match(popupSource, /SHIELDVAULT_ACTIVATE_LICENSE/);
  assert.match(popupSource, /SHIELDVAULT_REMOVE_LICENSE/);
  assert.doesNotMatch(popupSource, /shieldvault_pro\s*:\s*true/);
  assert.doesNotMatch(popupSource, /fetch\(API_BASE\s*\+\s*['"]\/api\/license\/activate/);
});

test('a valid server verification grants Plus and preserves plan metadata', async () => {
  const expiry = START_TIME + 30 * 24 * 60 * 60 * 1000;
  const harness = createHarness({
    local: { shieldvault_license_key: 'monthly-key' },
    fetch: async () => serverResponse({
      valid: true,
      tier: 'plus',
      plan: 'monthly',
      expiresAt: expiry,
      email: 'buyer@example.com',
    }),
  });
  const result = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });

  assert.equal(result.isPro, true);
  assert.equal(result.plan, 'monthly');
  assert.equal(result.expiresAt, expiry);
  assert.equal(harness.fetchCalls.length, 1);
  assert.equal(harness.fetchCalls[0].url, 'https://shieldvault.site/api/license/activate');
  assert.equal(harness.fetchCalls[0].options.method, 'POST');
  assert.deepEqual(JSON.parse(harness.fetchCalls[0].options.body), { key: 'monthly-key' });
  assert.deepEqual(Object.keys(JSON.parse(harness.fetchCalls[0].options.body)), ['key']);
  assert.equal(harness.session.state[SESSION_KEY].licenseKey, 'monthly-key');
  assert.equal(harness.local.state.shieldvault_pro, true);
  assert.equal(harness.local.state.shieldvault_tier, 'plus');
  assert.equal(harness.local.state.shieldvault_pro_plan, 'monthly');
  assert.equal(harness.local.state.shieldvault_pro_expiry, expiry);
  assert.equal(harness.local.state.shieldvault_email, 'buyer@example.com');

  const lifetime = createHarness({
    fetch: async () => serverResponse({ valid: true, tier: 'plus', email: 'life@example.com' }),
  });
  const activated = await lifetime.request({
    type: 'SHIELDVAULT_ACTIVATE_LICENSE',
    key: 'lifetime-key',
  });
  assert.equal(activated.isPro, true);
  assert.equal(activated.plan, 'lifetime');
  assert.equal(activated.expiresAt, null);
  assert.equal(activated.email, 'life@example.com');
  assert.equal(lifetime.local.state.shieldvault_pro_plan, 'lifetime');
});

test('invalid and expired verification revoke Plus', async (t) => {
  await t.test('an explicit invalid response revokes even on 4xx', async () => {
    const replies = [
      serverResponse({ valid: true, plan: 'lifetime' }),
      serverResponse({ valid: false, error: 'License revoked' }, { ok: false, status: 403 }),
    ];
    const harness = createHarness({
      local: { shieldvault_license_key: 'revoked-key' },
      fetch: async () => replies.shift(),
    });
    assert.equal((await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' })).isPro, true);
    const revoked = await harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' });
    assert.equal(revoked.isPro, false);
    assert.equal(revoked.reason, 'invalid');
    assert.equal(harness.session.state[SESSION_KEY], undefined);
    assert.equal(harness.local.state.shieldvault_pro, undefined);
    assert.equal(harness.local.state.shieldvault_tier, undefined);
    assert.equal(harness.local.state.shieldvault_license_key, 'revoked-key');
  });

  await t.test('a server-valid response at its expiry boundary is revoked', async () => {
    const harness = createHarness({
      local: {
        shieldvault_license_key: 'expired-key',
        shieldvault_pro: true,
        shieldvault_tier: 'plus',
      },
      fetch: async () => serverResponse({
        valid: true,
        plan: 'monthly',
        expiresAt: START_TIME,
      }),
    });
    const expired = await harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' });
    assert.equal(expired.isPro, false);
    assert.equal(expired.reason, 'expired');
    assert.equal(harness.session.state[SESSION_KEY], undefined);
    assert.equal(harness.local.state.shieldvault_pro, undefined);
    assert.equal(harness.local.state.shieldvault_tier, undefined);
  });
});

test('the 15-minute session cache prevents unnecessary validation', async () => {
  const harness = createHarness({
    local: { shieldvault_license_key: 'cache-key' },
    fetch: async () => serverResponse({ valid: true, plan: 'lifetime' }),
  });
  await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  harness.advance(TTL_MS - 1);
  const cached = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(cached.isPro, true);
  assert.equal(cached.reason, 'cached');
  assert.equal(harness.fetchCalls.length, 1);

  harness.advance(1);
  const reverified = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(reverified.isPro, true);
  assert.equal(reverified.reason, 'verified');
  assert.equal(harness.fetchCalls.length, 2);
});

test('offline grace works only after a verified entitlement', async () => {
  const unverified = createHarness({
    local: {
      shieldvault_license_key: 'never-verified',
      shieldvault_pro: true,
      shieldvault_tier: 'plus',
    },
  });
  const denied = await unverified.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(denied.isPro, false);

  let online = true;
  const verified = createHarness({
    local: { shieldvault_license_key: 'verified-key' },
    fetch: async () => {
      if (!online) throw new Error('offline');
      return serverResponse({ valid: true, plan: 'lifetime' });
    },
  });
  await verified.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  online = false;
  verified.advance(TTL_MS);
  const grace = await verified.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(grace.isPro, true);
  assert.equal(grace.reason, 'grace');
});

test('access fails closed when the 72-hour offline grace expires', async () => {
  let online = true;
  const harness = createHarness({
    local: { shieldvault_license_key: 'grace-key' },
    fetch: async () => {
      if (!online) throw new Error('offline');
      return serverResponse({ valid: true, plan: 'lifetime' });
    },
  });
  await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  online = false;
  harness.advance(GRACE_MS);
  const result = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.equal(result.isPro, false);
  assert.equal(result.reason, 'verification_unavailable');
});

test('concurrent requests share one backend validation', async () => {
  let release;
  const pendingResponse = new Promise((resolve) => {
    release = resolve;
  });
  const harness = createHarness({
    local: { shieldvault_license_key: 'shared-key' },
    fetch: async () => pendingResponse,
  });

  const requests = [
    harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' }),
    harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' }),
    harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' }),
    harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' }),
  ];
  await eventually(() => harness.fetchCalls.length === 1, 'requests did not coalesce');
  release(serverResponse({ valid: true, plan: 'lifetime' }));
  const results = await Promise.all(requests);
  assert.equal(harness.fetchCalls.length, 1);
  assert.ok(results.every((result) => result.isPro === true));
});

test('repeated no-license requests return Basic directly and fan out once per worker', async () => {
  const harness = createHarness({
    tabs: [{ id: 11 }, { id: 22 }],
    fetch: async () => assert.fail('no-key state must not contact the server'),
  });

  const results = await Promise.all([
    harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' }),
    harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' }),
    harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' }),
  ]);
  assert.deepEqual(results, [
    { isPro: false, reason: 'no_license' },
    { isPro: false, reason: 'no_license' },
    { isPro: false, reason: 'no_license' },
  ]);

  const runtimeChanges = harness.runtimeMessages.filter(
    (message) => message.type === 'SHIELDVAULT_ENTITLEMENT_CHANGED'
  );
  const tabChanges = harness.tabMessages.filter(
    ({ message }) => message.type === 'SHIELDVAULT_ENTITLEMENT_CHANGED'
  );
  assert.equal(runtimeChanges.length, 1);
  assert.equal(runtimeChanges[0].isPro, false);
  assert.deepEqual(tabChanges.map(({ tabId }) => tabId), [11, 22]);
  assert.ok(tabChanges.every(({ message }) => message.isPro === false));
});

test('a clean never-purchased install does not remove local entitlement metadata', async () => {
  const harness = createHarness({
    fetch: async () => assert.fail('no-key state must not contact the server'),
  });

  const result = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.deepEqual(result, { isPro: false, reason: 'no_license' });
  assert.deepEqual(harness.local.removeCalls, []);
});

test('stale local entitlement metadata is removed without removing the license key', async () => {
  const harness = createHarness({
    local: {
      shieldvault_license_key: '   ',
      shieldvault_email: '',
      unrelated: 'keep-me',
    },
    fetch: async () => assert.fail('blank-key state must not contact the server'),
  });

  const result = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  assert.deepEqual(result, { isPro: false, reason: 'no_license' });
  assert.deepEqual(harness.local.removeCalls, [LOCAL_ENTITLEMENT_METADATA_KEYS]);
  for (const key of LOCAL_ENTITLEMENT_METADATA_KEYS) {
    assert.equal(Object.prototype.hasOwnProperty.call(harness.local.state, key), false);
  }
  assert.equal(harness.local.state.shieldvault_license_key, '   ');
  assert.equal(harness.local.state.unrelated, 'keep-me');
});

test('deliberate entitlement actions force broadcasts when signatures match', async (t) => {
  await t.test('activation forces a matching Plus broadcast', async () => {
    const harness = createHarness({
      tabs: [{ id: 7 }],
      fetch: async () => serverResponse({ valid: true, plan: 'lifetime' }),
    });

    const first = await harness.request({
      type: 'SHIELDVAULT_ACTIVATE_LICENSE',
      key: 'same-key',
    });
    const second = await harness.request({
      type: 'SHIELDVAULT_ACTIVATE_LICENSE',
      key: 'same-key',
    });

    assert.equal(first.isPro, true);
    assert.deepEqual(second, first);
    assert.equal(harness.runtimeMessages.length, 2);
    assert.deepEqual(harness.tabMessages.map(({ tabId }) => tabId), [7, 7]);
  });

  await t.test('removal forces a matching Basic broadcast', async () => {
    const harness = createHarness({ tabs: [{ id: 9 }] });

    const first = await harness.request({ type: 'SHIELDVAULT_REMOVE_LICENSE' });
    const second = await harness.request({ type: 'SHIELDVAULT_REMOVE_LICENSE' });

    assert.deepEqual(first, { isPro: false, reason: 'no_license' });
    assert.deepEqual(second, first);
    assert.equal(harness.runtimeMessages.length, 2);
    assert.deepEqual(harness.tabMessages.map(({ tabId }) => tabId), [9, 9]);
  });
});

test('all open tabs receive entitlement grants and revocations', async () => {
  const responses = [
    serverResponse({ valid: true, plan: 'lifetime' }),
    serverResponse({ valid: false }),
  ];
  const harness = createHarness({
    local: { shieldvault_license_key: 'broadcast-key' },
    tabs: [{ id: 11 }, { id: 22 }, { id: 'not-a-tab-id' }],
    fetch: async () => responses.shift(),
  });

  await harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' });
  await harness.request({ type: 'SHIELDVAULT_REFRESH_ENTITLEMENT' });
  const changes = harness.tabMessages.filter(
    ({ message }) => message.type === 'SHIELDVAULT_ENTITLEMENT_CHANGED'
  );
  assert.deepEqual(changes.map(({ tabId }) => tabId), [11, 22, 11, 22]);
  assert.deepEqual(changes.map(({ message }) => message.isPro), [true, true, false, false]);
  for (const { message } of changes) {
    assert.equal(Object.prototype.hasOwnProperty.call(message, 'licenseKey'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(message, 'email'), false);
  }
});

test('cache identity and stale responses cannot survive key changes or removal', async (t) => {
  await t.test('a cache verified for a different key grants nothing', async () => {
    const harness = createHarness({
      local: {
        shieldvault_license_key: 'key-b',
        shieldvault_pro: true,
        shieldvault_tier: 'plus',
      },
      session: {
        [SESSION_KEY]: {
          isPro: true,
          licenseKey: 'key-a',
          plan: 'lifetime',
          expiresAt: null,
          verifiedAt: START_TIME,
        },
      },
    });
    const result = await harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
    assert.equal(result.isPro, false);
    assert.equal(harness.fetchCalls.length, 1);
  });

  await t.test('removal wins over an older in-flight valid response', async () => {
    let release;
    const pendingResponse = new Promise((resolve) => {
      release = resolve;
    });
    const harness = createHarness({
      local: { shieldvault_license_key: 'removed-key' },
      fetch: async () => pendingResponse,
    });
    const validation = harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
    await eventually(() => harness.fetchCalls.length === 1);
    const removed = await harness.request({ type: 'SHIELDVAULT_REMOVE_LICENSE' });
    assert.equal(removed.isPro, false);
    release(serverResponse({ valid: true, plan: 'lifetime' }));
    const stale = await validation;
    assert.equal(stale.isPro, false);
    assert.equal(stale.reason, 'license_changed');
    assert.equal(harness.session.state[SESSION_KEY], undefined);
    assert.equal(harness.local.state.shieldvault_license_key, undefined);
    assert.equal(harness.local.state.shieldvault_pro, undefined);
  });
});

test('an older no-license request cannot override a newer activation', async () => {
  let metadataReadStarted = false;
  let releaseMetadataRead;
  const metadataReadGate = new Promise((resolve) => {
    releaseMetadataRead = resolve;
  });
  const harness = createHarness({
    localBeforeGet: async (keys) => {
      if (
        !metadataReadStarted &&
        Array.isArray(keys) &&
        keys.length === LOCAL_ENTITLEMENT_METADATA_KEYS.length &&
        LOCAL_ENTITLEMENT_METADATA_KEYS.every((key) => keys.includes(key))
      ) {
        metadataReadStarted = true;
        await metadataReadGate;
      }
    },
    tabs: [{ id: 17 }],
    fetch: async () => serverResponse({
      valid: true,
      plan: 'lifetime',
      email: 'new@example.com',
    }),
  });

  const olderRequest = harness.request({ type: 'SHIELDVAULT_GET_ENTITLEMENT' });
  await eventually(() => metadataReadStarted, 'no-license metadata read did not start');

  let activated;
  try {
    activated = await harness.request({
      type: 'SHIELDVAULT_ACTIVATE_LICENSE',
      key: 'new-key',
    });
  } finally {
    releaseMetadataRead();
  }
  const olderResult = await olderRequest;

  assert.equal(activated.isPro, true);
  assert.equal(olderResult.isPro, false);
  assert.equal(olderResult.reason, 'license_changed');
  assert.equal(harness.local.state.shieldvault_license_key, 'new-key');
  assert.equal(harness.local.state.shieldvault_pro, true);
  assert.equal(harness.local.state.shieldvault_tier, 'plus');
  assert.equal(harness.session.state[SESSION_KEY].licenseKey, 'new-key');
  assert.equal(harness.local.removeCalls.length, 1);

  const runtimeChanges = harness.runtimeMessages.filter(
    (message) => message.type === 'SHIELDVAULT_ENTITLEMENT_CHANGED'
  );
  const tabChanges = harness.tabMessages.filter(
    ({ message }) => message.type === 'SHIELDVAULT_ENTITLEMENT_CHANGED'
  );
  assert.equal(runtimeChanges.length, 1);
  assert.equal(runtimeChanges[0].isPro, true);
  assert.deepEqual(tabChanges.map(({ tabId, message }) => [tabId, message.isPro]), [[17, true]]);
});

test('startup and popup-open paths force validation', async () => {
  const harness = createHarness({
    local: {
      shieldvault_license_key: 'startup-key',
      shieldvault_pro: true,
      shieldvault_tier: 'plus',
    },
    session: {
      [SESSION_KEY]: {
        isPro: true,
        licenseKey: 'startup-key',
        plan: 'lifetime',
        expiresAt: null,
        verifiedAt: START_TIME,
      },
    },
    tabs: [{ id: 7 }],
    fetch: async () => serverResponse({ valid: false }),
  });
  assert.equal(harness.onStartup.listeners.length, 1);
  harness.onStartup.listeners[0]();
  await eventually(
    () => harness.tabMessages.some(({ message }) => message.isPro === false),
    'startup did not validate and broadcast'
  );
  assert.equal(harness.fetchCalls.length, 1, 'startup bypasses a fresh cache');
  assert.equal(harness.session.state[SESSION_KEY], undefined);

  const popupSource = fs.readFileSync(path.join(ROOT, 'proofs.js'), 'utf8');
  assert.match(popupSource, /async function revalidateLicense\(\)[\s\S]*?getProStatus\(true\)/);
  assert.match(popupSource, /applyProState\(\);\s*\r?\n\s*revalidateLicense\(\);/);
});

