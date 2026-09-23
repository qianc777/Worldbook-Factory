import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolPanels, TOOLS_PREFERENCE_KEY } from '../editor/panels.js';

function fixture(stored, customStorage) {
  const classes = new Set(), attrs = new Map(), listeners = new Map(), writes = [];
  const label = { textContent: '' };
  const shell = { classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) } };
  const toggle = {
    title: '', setAttribute: (name, value) => attrs.set(name, value),
    querySelector: () => label, addEventListener: (type, listener) => listeners.set(type, listener),
  };
  const panels = [{ hidden: false, value: '未保存的书名' }, { hidden: false, value: '搜索词' }, { hidden: false, selected: ['2', '7'] }];
  const brand = { hidden: false }, compactBook = { hidden: true };
  const storage = customStorage ?? {
    getItem(key) { assert.equal(key, TOOLS_PREFERENCE_KEY); return stored; },
    setItem(key, value) { assert.equal(key, TOOLS_PREFERENCE_KEY); stored = value; writes.push(value); },
  };
  const controller = createToolPanels({ shell, toggle, panels, brand, compactBook, storage });
  return { controller, panels, brand, compactBook, classes, attrs, label, writes, click: () => listeners.get('click')(), stored: () => stored };
}

test('tools start expanded without a preference and initialization does not write storage', () => {
  const m = fixture(null);
  assert.equal(m.controller.isCollapsed(), false);
  assert.equal(m.attrs.get('aria-expanded'), 'true');
  assert.ok(m.panels.every(panel => !panel.hidden));
  assert.equal(m.brand.hidden, false); assert.equal(m.compactBook.hidden, true);
  assert.deepEqual(m.writes, []);
});

test('collapsing and expanding preserve input, search and selection values', () => {
  const m = fixture(null), originals = [...m.panels];
  m.click();
  assert.equal(m.controller.isCollapsed(), true);
  assert.equal(m.attrs.get('aria-expanded'), 'false');
  assert.equal(m.label.textContent, '展开工具');
  assert.ok(m.classes.has('tools-collapsed'));
  assert.ok(m.panels.every(panel => panel.hidden));
  assert.equal(m.brand.hidden, true); assert.equal(m.compactBook.hidden, false);
  m.click();
  assert.ok(m.panels.every(panel => !panel.hidden));
  assert.equal(m.classes.has('tools-collapsed'), false);
  assert.equal(m.label.textContent, '收起上方');
  originals.forEach((original, index) => assert.equal(m.panels[index], original));
  assert.deepEqual(m.panels.map(({ hidden, ...rest }) => rest), [{ value: '未保存的书名' }, { value: '搜索词' }, { selected: ['2', '7'] }]);
  assert.deepEqual(m.writes, ['true', 'false']);
});

test('a remembered collapsed preference is restored on a new editor instance', () => {
  const first = fixture(null); first.click();
  const reopened = fixture(first.stored());
  assert.equal(reopened.controller.isCollapsed(), true);
  assert.equal(reopened.attrs.get('aria-expanded'), 'false');
  assert.ok(reopened.panels.every(panel => panel.hidden));
  assert.deepEqual(reopened.writes, []);
});

test('revealing tools restores controls for search and worldbook picking', () => {
  const m = fixture('true'); m.controller.reveal();
  assert.equal(m.controller.isCollapsed(), false);
  assert.equal(m.attrs.get('aria-expanded'), 'true');
  assert.ok(m.panels.every(panel => !panel.hidden));
  assert.equal(m.stored(), 'false');
});

test('invalid stored preferences do not hide the tools', () => {
  for (const stored of ['', 'false', '1', 'undefined', '{broken']) {
    assert.equal(fixture(stored).controller.isCollapsed(), false);
  }
});

test('blocked storage does not prevent folding or revealing the tools', () => {
  const m = fixture(null, { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
  m.click(); assert.equal(m.controller.isCollapsed(), true);
  m.controller.reveal(); assert.equal(m.controller.isCollapsed(), false);
});
