import { worldInfoCache } from '../../../world-info.js';
import { createTavernBridge } from './bridge.js';

const DIALOG_ID = 'worldbook-workshop-dialog';
let dialog;
let frame;
let opener;

function getContext() {
  const context = window.SillyTavern?.getContext?.();
  if (!context?.getRequestHeaders) throw new Error('世界书工坊需要在已登录的 SillyTavern 中打开。');
  return context;
}

const bridge = createTavernBridge({
  getHeaders: () => getContext().getRequestHeaders(),
  onSaved: async (name, book, { created }) => {
    const context = getContext();
    worldInfoCache.set(name, structuredClone(book));
    if (created) await context.updateWorldInfoList();
    const event = (context.eventTypes || context.event_types)?.WORLDINFO_UPDATED;
    if (event) await context.eventSource.emit(event, name, structuredClone(book));
    context.reloadWorldInfoEditor(name);
  },
});

function closeWorkshop() {
  dialog?.close();
  opener?.focus();
}

window.WorldbookWorkshopHost = Object.freeze({ ...bridge, close: closeWorkshop, version: '1.0.0' });

function openWorkshop(event) {
  opener = event?.currentTarget;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-label', '世界书工坊');
    const bar = document.createElement('div');
    bar.className = 'ww-host-bar';
    const label = document.createElement('span');
    label.textContent = '世界书工坊 · 酒馆扩展';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'ww-host-close';
    close.textContent = '返回酒馆 ×';
    close.title = '收起编辑器，草稿保留到本次酒馆页面关闭为止';
    close.addEventListener('click', closeWorkshop);
    bar.append(label, close);
    frame = document.createElement('iframe');
    frame.title = '世界书工坊编辑器';
    frame.src = new URL('./editor/index.html?v=1.0.0', import.meta.url).href;
    dialog.append(bar, frame);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeWorkshop(); });
    document.body.append(dialog);
  }
  if (!dialog.open) dialog.showModal();
}

function addButton(parent, id, text, className) {
  if (!parent || document.getElementById(id)) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', openWorkshop);
  parent.append(button);
}

function mount() {
  const parent = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (parent && !document.getElementById('ww-settings')) {
    const section = document.createElement('div');
    section.id = 'ww-settings';
    section.className = 'extension_container';
    const title = document.createElement('h4');
    title.textContent = '世界书工坊';
    const description = document.createElement('p');
    description.textContent = '直接编辑酒馆世界书，支持批量操作与重复条目清理。';
    section.append(title, description);
    addButton(section, 'ww-settings-open', '打开世界书工坊', 'menu_button');
    parent.append(section);
  }
  addButton(document.getElementById('extensionsMenu'), 'ww-menu-open', '世界书工坊', 'list-group-item flex-container flexGap5');
  addButton(document.getElementById('world_editor_select')?.parentElement, 'ww-world-open', '世界书工坊', 'menu_button');
}

window.addEventListener('beforeunload', event => {
  if (frame?.contentWindow?.WorldbookConnection?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
