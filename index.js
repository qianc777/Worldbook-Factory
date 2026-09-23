import { worldInfoCache } from '../../../world-info.js';
import { extensionTypes } from '../../../extensions.js';
import { createTavernBridge } from './bridge.js';
import { createExtensionUpdater, EXTENSION_VERSION } from './updater.js?v=1.1.0';

const DIALOG_ID = 'worldbook-workshop-dialog';
let dialog;
let frame;
let opener;
const updateState = { busy: false, phase: '', message: '', error: false, reloadRequired: false };
const icons = {
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Z"/><path d="M12 6v14M6 8h3M6 11h3M15 8h3M15 11h3"/>',
  update: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
};

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, value);
  svg.classList.add('ww-icon'); svg.innerHTML = icons[name];
  return svg;
}

function button(id, label, iconName, onClick, className, iconOnly = false) {
  const element = document.createElement('button');
  element.type = 'button'; element.id = id; element.className = className;
  element.title = label; element.setAttribute('aria-label', label);
  if (iconName) element.append(icon(iconName));
  if (!iconOnly) {
    const text = document.createElement('span'); text.className = 'ww-button-label'; text.textContent = label;
    element.append(text);
  }
  element.addEventListener('click', onClick);
  return element;
}

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

const updater = createExtensionUpdater({
  moduleUrl: import.meta.url, getTypes: () => extensionTypes, getHeaders: () => getContext().getRequestHeaders(),
});

function syncUpdateUi() {
  document.querySelectorAll('.ww-check-update').forEach(element => {
    element.disabled = updateState.busy;
    element.classList.toggle('ww-updating', updateState.busy);
    element.querySelector('.ww-button-label').textContent = updateState.busy
      ? updateState.phase === 'updating' ? '正在下载…' : '正在检查…' : '检查更新';
  });
  document.querySelectorAll('.ww-reload-update').forEach(element => {
    element.hidden = !updateState.reloadRequired; element.disabled = updateState.busy;
  });
  document.querySelectorAll('.ww-update-status').forEach(element => {
    element.hidden = !updateState.message; element.textContent = updateState.message;
    element.classList.toggle('ww-error', updateState.error);
  });
}

async function updateWorkshop() {
  if (updateState.busy) return;
  updateState.busy = true; updateState.error = false;
  try {
    const result = await updater.checkAndUpdate(phase => {
      updateState.phase = phase;
      updateState.message = phase === 'updating' ? '发现更新，正在从 GitHub 下载。当前草稿不受影响。' : '正在检查 Worldbook-Factory 仓库…';
      syncUpdateUi();
    });
    updateState.reloadRequired ||= result.reloadRequired;
    updateState.message = result.warning || (updateState.reloadRequired
      ? `${result.updated ? '已下载最新版本' : '本地已有更新'} v${result.version} · ${result.commit}。保存工作后点击“刷新生效”。`
      : `已是最新版本 v${result.version} · ${result.commit}。`);
  } catch (error) {
    updateState.error = true; updateState.message = error.message || '更新失败，请稍后重试。';
  } finally { updateState.busy = false; syncUpdateUi(); }
}

function reloadWorkshop() {
  const connection = frame?.contentWindow?.WorldbookConnection;
  if (connection?.isBusy?.() || connection?.hasUnsavedChanges?.()) {
    updateState.error = true;
    updateState.message = '请先保存世界书草稿并等待保存完成，再刷新。插件更新已保留，不会自动丢弃修改。';
    syncUpdateUi(); return;
  }
  if (window.confirm('即将刷新整个酒馆页面，使插件更新生效。请确认其他编辑也已保存。现在刷新吗？')) window.location.reload();
}

function updateControls(parent, prefix, className) {
  parent.append(
    button(`${prefix}-update`, '检查更新', 'update', updateWorkshop, `${className} ww-check-update`),
    button(`${prefix}-reload`, '刷新生效', 'update', reloadWorkshop, `${className} ww-reload-update`),
  );
}

function updateStatus() {
  const status = document.createElement('p'); status.className = 'ww-update-status';
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.hidden = true;
  return status;
}

window.WorldbookWorkshopHost = Object.freeze({ ...bridge, close: closeWorkshop, version: EXTENSION_VERSION });

function openWorkshop(event) {
  opener = event?.currentTarget;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = DIALOG_ID;
    dialog.setAttribute('aria-label', '世界书工坊');
    const bar = document.createElement('div');
    bar.className = 'ww-host-bar';
    const label = document.createElement('div'); label.className = 'ww-host-brand';
    const name = document.createElement('strong'); name.textContent = 'Worldbook Factory';
    const version = document.createElement('span'); version.className = 'ww-version'; version.textContent = `v${EXTENSION_VERSION}`;
    label.append(icon('book'), name, version);
    const actions = document.createElement('div'); actions.className = 'ww-host-actions';
    updateControls(actions, 'ww-host', 'ww-host-button');
    const close = button('ww-host-close', '返回酒馆', 'close', closeWorkshop, 'ww-host-button ww-host-close');
    close.title = '收起编辑器，草稿保留到本次酒馆页面关闭为止';
    actions.append(close); bar.append(label, actions);
    frame = document.createElement('iframe');
    frame.title = '世界书工坊编辑器';
    frame.src = new URL(`./editor/index.html?v=${EXTENSION_VERSION}`, import.meta.url).href;
    dialog.append(bar, updateStatus(), frame);
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeWorkshop(); });
    document.body.append(dialog);
  }
  syncUpdateUi();
  if (!dialog.open) dialog.showModal();
}

function mount() {
  const parent = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
  if (parent && !document.getElementById('ww-settings')) {
    const section = document.createElement('div');
    section.id = 'ww-settings';
    section.className = 'extension_container ww-settings-card';
    const title = document.createElement('h4');
    const name = document.createElement('span'); name.textContent = '世界书工坊';
    const version = document.createElement('span'); version.className = 'ww-version'; version.textContent = `v${EXTENSION_VERSION}`;
    title.append(icon('book'), name, version);
    const description = document.createElement('p');
    description.textContent = '编辑、排序、批量整理。你的世界设定，一处打理。';
    const actions = document.createElement('div'); actions.className = 'ww-settings-actions';
    actions.append(button('ww-settings-open', '打开工坊', 'book', openWorkshop, 'menu_button ww-settings-button'));
    updateControls(actions, 'ww-settings', 'menu_button ww-settings-button');
    section.append(title, description, actions, updateStatus());
    parent.append(section);
  }
  const menu = document.getElementById('extensionsMenu');
  if (menu && !document.getElementById('ww-menu-open')) menu.append(button('ww-menu-open', '世界书工坊', 'book', openWorkshop, 'list-group-item flex-container flexGap5'));
  const toolbar = document.getElementById('world_editor_select')?.parentElement;
  if (toolbar && !document.getElementById('ww-world-open')) {
    const entry = button('ww-world-open', '打开世界书工坊', 'book', openWorkshop, 'menu_button ww-toolbar-button', true);
    const before = document.getElementById('world_import_button');
    toolbar.insertBefore(entry, before?.parentElement === toolbar ? before : null);
  }
  syncUpdateUi();
}

window.addEventListener('beforeunload', event => {
  if (frame?.contentWindow?.WorldbookConnection?.hasUnsavedChanges?.()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
else mount();
