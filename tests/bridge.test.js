import test from 'node:test';
import assert from 'node:assert/strict';
import { createTavernBridge, fingerprint, validateName } from '../bridge.js';

const fixture = () => ({
  entries: {
    '7': { uid: 7, comment: '城市设定', content: '第一行\n第二行 <tag>中文</tag>', key: ['城'], keysecondary: [], custom: { enabled: null } },
    '11': { uid: 11, comment: '副本', content: '第一行\n第二行 <tag>中文</tag>', key: ['另一词'], keysecondary: [], disable: true },
  },
  extensions: { custom: ['do not drop', null, 0] },
});

function mock(books = new Map([['测试世界', fixture()]])) {
  const calls = [];
  const refreshed = [];
  let editStatus = 200;
  let verifyMismatch = false;
  let responseOK = true;
  let mutateOnWrite = null;
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.headers['X-CSRF-Token'], 'test-csrf');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.method, 'POST');
    const body = JSON.parse(options.body);
    if (url.endsWith('/list')) return Response.json([...books.keys()].map(name => ({ file_id: name, name })));
    if (url.endsWith('/get')) return Response.json(books.get(body.name) || { entries: {} });
    if (url.endsWith('/edit')) {
      if (editStatus !== 200) return new Response('Failure', { status: editStatus });
      if (responseOK) books.set(body.name, structuredClone(body.data));
      if (verifyMismatch) books.get(body.name).extra = 'concurrent edit';
      if (mutateOnWrite) mutateOnWrite(body.data);
      return Response.json({ ok: responseOK });
    }
    throw new Error(`Unexpected endpoint ${url}`);
  };
  const bridge = createTavernBridge({ fetchImpl, getHeaders: () => ({ 'Content-Type': 'application/json', 'X-CSRF-Token': 'test-csrf' }), onSaved: async (...args) => refreshed.push(args) });
  return { bridge, books, calls, refreshed, failEdit: status => editStatus = status, mismatch: () => verifyMismatch = true, noAck: () => responseOK = false, onWrite: fn => mutateOnWrite = fn };
}

test('read-only list and load preserve every field and do not write', async () => {
  const m = mock();
  assert.deepEqual(await m.bridge.listBooks(), [{ name: '测试世界', displayName: '测试世界' }]);
  const loaded = await m.bridge.loadBook('测试世界');
  assert.deepEqual(loaded.book, fixture());
  assert.ok(m.calls.every(call => !call.url.endsWith('/edit')));
  loaded.book.entries['7'].content = 'local';
  assert.equal(m.books.get('测试世界').entries['7'].content, fixture().entries['7'].content);
});

test('save and readback retain UIDs, unknown fields, disabled state and exact text', async () => {
  const m = mock();
  const loaded = await m.bridge.loadBook('测试世界');
  loaded.book.entries['7'].content = '已编辑\n\n含空行 & <xml>\n';
  const result = await m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: loaded.revision });
  assert.deepEqual(m.books.get('测试世界'), loaded.book);
  assert.equal(result.revision, fingerprint(loaded.book));
  assert.equal(m.refreshed.length, 1);
  assert.equal(m.refreshed[0][2].created, false);
});

test('duplicate removal is one explicit save and can be restored by a later save', async () => {
  const m = mock();
  const loaded = await m.bridge.loadBook('测试世界');
  const cleaned = structuredClone(loaded.book);
  delete cleaned.entries['11'];
  const saved = await m.bridge.saveBook({ name: loaded.name, book: cleaned, originalName: loaded.name, revision: loaded.revision });
  assert.equal(Object.keys(m.books.get('测试世界').entries).length, 1);
  await m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: saved.revision });
  assert.deepEqual(m.books.get('测试世界'), fixture());
});

test('conflict never writes or refreshes host state', async () => {
  const m = mock();
  const loaded = await m.bridge.loadBook('测试世界');
  m.books.get('测试世界').entries['7'].content = 'newer server data';
  await assert.rejects(m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: loaded.revision }), { code: 'CONFLICT' });
  assert.equal(m.calls.filter(call => call.url.endsWith('/edit')).length, 0);
  assert.equal(m.refreshed.length, 0);
});

test('missing file returned as empty by ST is not silently recreated', async () => {
  const m = mock();
  const loaded = await m.bridge.loadBook('测试世界');
  m.books.delete('测试世界');
  await assert.rejects(m.bridge.loadBook('测试世界'), { code: 'MISSING' });
  await assert.rejects(m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: loaded.revision }), { code: 'MISSING' });
  assert.ok(m.calls.every(call => !call.url.endsWith('/edit')));
});

test('changed name creates a new book and leaves the original intact', async () => {
  const m = mock();
  const loaded = await m.bridge.loadBook('测试世界');
  loaded.book.entries['7'].content = 'copy';
  const saved = await m.bridge.saveBook({ name: '新世界', book: loaded.book, originalName: loaded.name, revision: loaded.revision });
  assert.equal(saved.name, '新世界');
  assert.deepEqual(m.books.get('测试世界'), fixture());
  assert.equal(m.refreshed[0][2].created, true);
  assert.ok(m.calls.every(call => !call.url.endsWith('/delete')));
});

test('new/imported books cannot overwrite same-name or case-equivalent files', async () => {
  const m = mock(new Map([['Atlas', fixture()]]));
  for (const name of ['Atlas', 'atlas']) {
    await assert.rejects(m.bridge.saveBook({ name, book: fixture() }), { code: 'EXISTS' });
  }
  assert.ok(m.calls.every(call => !call.url.endsWith('/edit')));
});

test('HTTP failure never reports success or updates host cache', async () => {
  for (const status of [401, 403, 500]) {
    const m = mock();
    const loaded = await m.bridge.loadBook('测试世界');
    m.failEdit(status);
    loaded.book.entries['7'].comment = 'attempt';
    await assert.rejects(m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: loaded.revision }), { code: `HTTP_${status}` });
    assert.deepEqual(m.books.get('测试世界'), fixture());
    assert.equal(m.refreshed.length, 0);
  }
});

test('successful HTTP without explicit ack or matching readback is rejected', async () => {
  for (const mode of ['noAck', 'mismatch']) {
    const m = mock();
    const loaded = await m.bridge.loadBook('测试世界');
    m[mode]();
    await assert.rejects(m.bridge.saveBook({ name: loaded.name, book: loaded.book, originalName: loaded.name, revision: loaded.revision }), { code: mode === 'noAck' ? 'UNCONFIRMED' : 'VERIFY_FAILED' });
    assert.equal(m.refreshed.length, 0);
  }
});

test('canonical revision tolerates key ordering but detects real changes', () => {
  assert.equal(fingerprint({ a: 1, b: { c: 2, d: 3 } }), fingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  assert.notEqual(fingerprint({ a: [1, 2] }), fingerprint({ a: [2, 1] }));
});

test('invalid names and malformed data never reach write endpoint', async () => {
  const m = mock();
  for (const name of ['', '../outside', 'a/b', 'a\\b', 'CON', 'nul.txt', 'ends.']) assert.throws(() => validateName(name));
  for (const book of [null, [], { entries: [] }, { entries: { 0: null } }, { entries: { 0: { key: 'wrong' } } }]) {
    await assert.rejects(m.bridge.saveBook({ name: '合法名称', book }));
  }
  assert.ok(m.calls.every(call => !call.url.endsWith('/edit')));
});

test('host refresh failure is a saved result with a warning', async () => {
  const m = mock();
  const bridge = createTavernBridge({ fetchImpl: async (url, options) => {
    if (url.endsWith('/list')) return Response.json([]);
    if (url.endsWith('/edit')) { m.books.set('new', JSON.parse(options.body).data); return Response.json({ ok: true }); }
    return Response.json(m.books.get('new'));
  }, getHeaders: () => ({}), onSaved: async () => { throw new Error('Host UI failed'); } });
  const result = await bridge.saveBook({ name: 'new', book: fixture() });
  assert.match(result.warning, /已保存/);
  assert.deepEqual(result.book, fixture());
});
