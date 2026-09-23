import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createExtensionUpdater, extensionIdentity, isWorkshopRepository, REPOSITORY_URL, EXTENSION_VERSION } from '../updater.js';

const moduleUrl = `https://tavern.invalid/scripts/extensions/third-party/Worldbook-Factory/index.js?v=${EXTENSION_VERSION}`;
function mock(overrides = {}) {
  const state = { latest: true, scope: 'local', remote: `${REPOSITORY_URL}.git`, installed: EXTENSION_VERSION, checkStatus: 200, updateStatus: 200, badAck: false, manifestFails: false, ...overrides };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, 'same-origin');
    if (String(url).includes('/manifest.json?')) return state.manifestFails ? new Response('', { status: 500 }) : Response.json({ version: state.installed });
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-CSRF-Token'], 'test-token');
    assert.deepEqual(JSON.parse(options.body), { extensionName: 'Worldbook-Factory', global: state.scope === 'global' });
    if (url.endsWith('/version')) return state.checkStatus !== 200 ? new Response('', { status: state.checkStatus }) : Response.json({ currentCommitHash: 'a'.repeat(40), isUpToDate: state.latest, remoteUrl: state.remote });
    if (url.endsWith('/update')) {
      if (state.updateStatus !== 200) return new Response('', { status: state.updateStatus });
      state.latest = true; state.installed = '1.2.0';
      return Response.json(state.badAck ? {} : { isUpToDate: false, shortCommitHash: 'bbbbbbb', remoteUrl: state.remote });
    }
    throw new Error(`Unexpected endpoint: ${url}`);
  };
  const updater = createExtensionUpdater({ moduleUrl, getTypes: () => ({ 'third-party/Worldbook-Factory': state.scope }), getHeaders: () => ({ 'X-CSRF-Token': 'test-token' }), fetchImpl });
  return { updater, calls, state };
}

test('installation identity uses the actual folder and explicitly known scope', () => {
  assert.deepEqual(extensionIdentity(moduleUrl, { 'third-party/Worldbook-Factory': 'global' }), { extensionName: 'Worldbook-Factory', global: true });
  assert.deepEqual(extensionIdentity(moduleUrl.replace('Worldbook-Factory', 'custom-folder'), { 'third-party/custom-folder': 'local' }), { extensionName: 'custom-folder', global: false });
  assert.throws(() => extensionIdentity(moduleUrl, {}), { code: 'UNKNOWN_SCOPE' });
  assert.throws(() => extensionIdentity('https://tavern.invalid/other/index.js', {}), { code: 'INVALID_PATH' });
});

test('only the intended GitHub repository is accepted, including SSH remotes', () => {
  for (const remote of [REPOSITORY_URL, `${REPOSITORY_URL}.git`, 'git@github.com:qianc777/Worldbook-Factory.git', 'ssh://git@github.com/qianc777/Worldbook-Factory.git']) assert.equal(isWorkshopRepository(remote), true);
  for (const remote of ['', null, 'https://evil.invalid/qianc777/Worldbook-Factory', `${REPOSITORY_URL}-other`, `${REPOSITORY_URL}?url=other`, 'https://github.com/other/Worldbook-Factory']) assert.equal(isWorkshopRepository(remote), false);
});

test('already current installation performs no update and needs no reload', async () => {
  const m = mock(), result = await m.updater.checkAndUpdate();
  assert.equal(result.updated, false); assert.equal(result.reloadRequired, false);
  assert.equal(result.version, EXTENSION_VERSION);
  assert.equal(m.calls.filter(call => call.url.endsWith('/update')).length, 0);
});

test('updates use native endpoints and correct local or global scope', async () => {
  for (const scope of ['local', 'global']) {
    const m = mock({ latest: false, scope }), progress = [];
    const result = await m.updater.checkAndUpdate(phase => progress.push(phase));
    assert.deepEqual(progress, ['checking', 'updating']);
    assert.equal(result.updated, true); assert.equal(result.reloadRequired, true); assert.equal(result.version, '1.2.0');
    assert.equal(m.calls.filter(call => call.url.endsWith('/update')).length, 1);
    assert.ok(m.calls.every(call => !call.url.includes('/worldinfo/')));
  }
});

test('previously downloaded version still asks for reload without downloading again', async () => {
  const m = mock({ installed: '1.2.0' }), result = await m.updater.checkAndUpdate();
  assert.equal(result.updated, false); assert.equal(result.reloadRequired, true);
});

test('unknown installation scope, wrong repository and non-Git installs never update', async () => {
  for (const [overrides, code] of [[{ scope: 'unknown' }, 'UNKNOWN_SCOPE'], [{ remote: 'https://github.com/other/repo' }, 'WRONG_REPOSITORY'], [{ remote: '' }, 'NOT_GIT']]) {
    const m = mock({ latest: false, ...overrides });
    await assert.rejects(m.updater.checkAndUpdate(), { code });
    assert.ok(m.calls.every(call => !call.url.endsWith('/update')));
  }
});

test('check and download failures never claim success and allow a later retry', async () => {
  for (const status of [401, 403, 500]) {
    const m = mock({ latest: false, checkStatus: status });
    await assert.rejects(m.updater.checkAndUpdate(), { code: `HTTP_${status}` });
    assert.ok(m.calls.every(call => !call.url.endsWith('/update')));
    m.state.checkStatus = 200; m.state.updateStatus = status;
    await assert.rejects(m.updater.checkAndUpdate(), { code: `HTTP_${status}` });
    m.state.updateStatus = 200;
    assert.equal((await m.updater.checkAndUpdate()).updated, true);
  }
});

test('incomplete update acknowledgement is not treated as confirmed success', async () => {
  const m = mock({ latest: false, badAck: true });
  await assert.rejects(m.updater.checkAndUpdate(), { code: 'UNCONFIRMED' });
});

test('missing local version after update returns an explicit warning and reload advice', async () => {
  const m = mock({ latest: false, manifestFails: true }), result = await m.updater.checkAndUpdate();
  assert.equal(result.updated, true); assert.equal(result.reloadRequired, true);
  assert.match(result.warning, /无法读取/);
});

test('concurrent update requests are rejected without a second network call', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let requests = 0;
  const updater = createExtensionUpdater({ moduleUrl, getTypes: () => ({ 'third-party/Worldbook-Factory': 'local' }), getHeaders: () => ({}), fetchImpl: async url => {
    requests++; await gate;
    return Response.json(url.endsWith('/version') ? { currentCommitHash: 'a'.repeat(40), isUpToDate: true, remoteUrl: REPOSITORY_URL } : { version: EXTENSION_VERSION });
  } });
  const first = updater.checkAndUpdate();
  await assert.rejects(updater.checkAndUpdate(), { code: 'BUSY' });
  assert.equal(requests, 1); release(); await first;
});

test('timeout reports uncertainty without triggering a reload or extra writes', async () => {
  let requests = 0;
  const updater = createExtensionUpdater({ moduleUrl, timeoutMs: 5, getTypes: () => ({ 'third-party/Worldbook-Factory': 'local' }), getHeaders: () => ({}), fetchImpl: async (url, options) => {
    requests++;
    return new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  } });
  await assert.rejects(updater.checkAndUpdate(), { code: 'TIMEOUT' });
  assert.equal(requests, 1);
});

test('published manifest, package and cache-busted assets use the same version', async () => {
  const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.equal(JSON.parse(await read('manifest.json')).version, EXTENSION_VERSION);
  assert.equal(JSON.parse(await read('package.json')).version, EXTENSION_VERSION);
  for (const path of ['index.js', 'editor/index.html', 'editor/app.js', 'editor/tavern-client.js']) {
    const versions = [...(await read(path)).matchAll(/\?v=(\d+\.\d+\.\d+)/g)].map(match => match[1]);
    assert.ok(versions.length, `${path} has versioned assets`);
    assert.ok(versions.every(version => version === EXTENSION_VERSION), `${path} version matches the release`);
  }
});
