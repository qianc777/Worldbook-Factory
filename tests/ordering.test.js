import test from 'node:test';
import assert from 'node:assert/strict';
import { displayOrder, moveEntries } from '../editor/ordering.js';
import { createTavernBridge } from '../bridge.js';

const fixture = () => ({
  entries: Object.fromEntries(Array.from({ length: 6 }, (_, uid) => [String(uid), {
    uid, displayIndex: uid * 10, comment: `条目 ${uid}`, content: `正文 ${uid}`, key: ['关键词'],
    keysecondary: [], order: 100 - uid, disable: uid === 3, custom: { keep: true },
  }])),
  extensions: { keep: ['metadata'] },
});

test('display order is stable with missing, duplicate and invalid indexes', () => {
  const book = { entries: { a: {}, b: { displayIndex: 2 }, c: { displayIndex: 'bad' }, d: { displayIndex: 2 } } };
  assert.deepEqual(displayOrder(book), ['a', 'c', 'b', 'd']);
});

test('single entry moves up and down; boundary no-op does not rewrite fields', () => {
  const book = fixture(), before = structuredClone(book);
  assert.equal(moveEntries(book, ['0'], 'up').changed, false);
  assert.deepEqual(book, before);
  moveEntries(book, ['2'], 'up');
  assert.deepEqual(displayOrder(book), ['0', '2', '1', '3', '4', '5']);
  moveEntries(book, ['2'], 'down');
  assert.deepEqual(displayOrder(book), ['0', '1', '2', '3', '4', '5']);
  assert.equal(moveEntries(book, ['5'], 'down').changed, false);
});

test('multiple selected blocks move one step without reversing their order', () => {
  const up = fixture(), down = fixture();
  moveEntries(up, ['1', '2', '4'], 'up');
  moveEntries(down, ['1', '2', '4'], 'down');
  assert.deepEqual(displayOrder(up), ['1', '2', '0', '4', '3', '5']);
  assert.deepEqual(displayOrder(down), ['0', '3', '1', '2', '5', '4']);
});

test('top and bottom moves deduplicate selection and retain relative order', () => {
  const book = fixture();
  assert.equal(moveEntries(book, ['4', '1', '4'], 'top').count, 2);
  assert.deepEqual(displayOrder(book), ['1', '4', '0', '2', '3', '5']);
  moveEntries(book, ['1', '4'], 'bottom');
  assert.deepEqual(displayOrder(book), ['0', '2', '3', '5', '1', '4']);
});

test('dragging a group before or after an anchor preserves group order', () => {
  for (const placement of ['before', 'after']) {
    const book = fixture();
    moveEntries(book, ['2', '0'], { targetId: '4', placement });
    assert.deepEqual(displayOrder(book), placement === 'before' ? ['1', '3', '0', '2', '4', '5'] : ['1', '3', '4', '0', '2', '5']);
  }
  const book = fixture(), before = structuredClone(book);
  assert.equal(moveEntries(book, ['1', '2'], { targetId: '2', placement: 'after' }).changed, false);
  assert.deepEqual(book, before);
});

test('position is a one-based final position and invalid moves are non-mutating', () => {
  const book = fixture();
  moveEntries(book, ['1', '4'], { position: 3 });
  assert.deepEqual(displayOrder(book), ['0', '2', '1', '4', '3', '5']);
  const before = structuredClone(book);
  for (const position of [0, -1, 6, 1.5, NaN]) assert.throws(() => moveEntries(book, ['1', '4'], { position }));
  assert.throws(() => moveEntries(book, ['missing'], 'up'));
  assert.throws(() => moveEntries(book, ['1'], { targetId: 'missing', placement: 'before' }));
  assert.deepEqual(book, before);
});

test('only displayIndex changes; every UID, priority, content and unknown field survives', () => {
  const book = fixture(), before = structuredClone(book);
  moveEntries(book, ['3', '4'], { position: 1 });
  for (const [id, entry] of Object.entries(book.entries)) {
    const { displayIndex: ignored, ...remaining } = entry;
    const { displayIndex: oldIndex, ...original } = before.entries[id];
    assert.deepEqual(remaining, original);
  }
  assert.deepEqual(book.extensions, before.extensions);
  assert.equal(moveEntries(book, [], 'up').changed, false);
  assert.equal(moveEntries(book, displayOrder(book), 'top').changed, false);
});

test('moved order survives save and reopen, and a restored snapshot can be saved again', async () => {
  let saved = fixture();
  const bridge = createTavernBridge({ getHeaders: () => ({}), fetchImpl: async (url, options) => {
    if (url.endsWith('/list')) return Response.json([{ file_id: '测试', name: '测试' }]);
    if (url.endsWith('/edit')) { saved = JSON.parse(options.body).data; return Response.json({ ok: true }); }
    return Response.json(saved);
  } });
  const initial = await bridge.loadBook('测试'), before = structuredClone(initial.book);
  moveEntries(initial.book, ['4', '5'], { position: 1 });
  await bridge.saveBook({ name: '测试', originalName: '测试', book: initial.book, revision: initial.revision });
  const reopened = await bridge.loadBook('测试');
  assert.deepEqual(displayOrder(reopened.book), ['4', '5', '0', '1', '2', '3']);
  await bridge.saveBook({ name: '测试', originalName: '测试', book: before, revision: reopened.revision });
  assert.deepEqual(saved, fixture());
});
