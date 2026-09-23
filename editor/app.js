import { displayOrder, moveEntries } from './ordering.js?v=1.1.1';
import { createToolPanels } from './panels.js?v=1.1.1';

const $ = (selector) => document.querySelector(selector);
const clone = (value) => JSON.parse(JSON.stringify(value));

const state = {
  book: { entries: {} }, bookName: "世界书", activeId: null, selected: new Set(),
  history: [], future: [], query: "", filter: "all", sort: "display", loading: false, duplicatePreview: [], duplicatePreviewVersion: ""
};

const fieldMap = {
  commentInput: ["comment", "text"], disableInput: ["disable", "checkbox"], constantInput: ["constant", "checkbox"],
  logicInput: ["selectiveLogic", "number"], contentInput: ["content", "text"], orderInput: ["order", "number"],
  positionInput: ["position", "number"], depthInput: ["depth", "number"], probabilityInput: ["probability", "number"],
  groupInput: ["group", "text"], groupWeightInput: ["groupWeight", "number"], selectiveInput: ["selective", "checkbox"],
  useProbabilityInput: ["useProbability", "checkbox"], excludeRecursionInput: ["excludeRecursion", "checkbox"],
  preventRecursionInput: ["preventRecursion", "checkbox"], ignoreBudgetInput: ["ignoreBudget", "checkbox"],
  vectorizedInput: ["vectorized", "checkbox"], roleInput: ["role", "nullableNumber"], outletNameInput: ["outletName", "text"]
};

let commitTimer, pendingBefore = null, rawDraft = false;
let moveDialogIds = [], moveDialogVersion = '';
let toolPanels;
const commitTags = [];
function flushEditor() { commitTags.forEach(commit => commit()); flushPending(); }
function changed() { window.dispatchEvent(new CustomEvent("worldbook:changed")); }
function syncRaw() { if (!rawDraft && activeEntry()) $("#rawJsonInput").value = JSON.stringify(activeEntry(), null, 2); }
function guardRaw() { if (!rawDraft) return true; toast("请先应用或撤销高级 JSON 中的修改", true); return false; }
function entries() { return Object.entries(state.book.entries || {}); }
function activeEntry() { return state.activeId == null ? null : state.book.entries[state.activeId]; }
function nextUid() {
  const ids = new Set(entries().flatMap(([id, entry]) => [String(id), String(entry.uid)]));
  let next = 0; while (ids.has(String(next))) next++; return next;
}
function normalizeBook(data) {
  if (!data || typeof data !== "object" || Array.isArray(data) || !data.entries || typeof data.entries !== "object" || Array.isArray(data.entries)) throw new Error("文件中没有有效的 entries 对象");
  for (const [id, entry] of Object.entries(data.entries)) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error(`条目 ${id} 不是对象`);
    for (const field of ["key", "keysecondary"]) {
      if (entry[field] != null && (!Array.isArray(entry[field]) || entry[field].some(word => typeof word !== "string"))) throw new Error(`条目 ${id} 的关键词格式错误`);
    }
    for (const field of ["comment", "content"]) if (entry[field] != null && typeof entry[field] !== "string") throw new Error(`条目 ${id} 的 ${field} 必须是文本`);
  }
  return data;
}
function snapshot() { return JSON.stringify(state.book); }
function checkpoint(before) {
  clearTimeout(commitTimer);
  if (pendingBefore) { before = pendingBefore; pendingBefore = null; }
  const now = snapshot();
  if (before && before !== now) { state.history.push(before); if (state.history.length > 80) state.history.shift(); state.future = []; updateUndoButtons(); }
  syncRaw(); changed();
}
function scheduleCheckpoint(before) {
  if (!pendingBefore) pendingBefore = before;
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => checkpoint(pendingBefore), 450);
  syncRaw(); changed();
}
function flushPending() { if (pendingBefore) checkpoint(pendingBefore); }
function restore(serialized) {
  state.book = normalizeBook(JSON.parse(serialized));
  if (!state.book.entries[state.activeId]) state.activeId = entries()[0]?.[0] ?? null;
  state.selected.clear(); renderAll(); changed();
}
function undo() { if (rawDraft) { rawDraft = false; syncRaw(); $("#rawStatus").textContent = ""; updateUndoButtons(); changed(); toast("已撤销未应用的 JSON 草稿"); return; } flushPending(); if (!state.history.length) return; const current = snapshot(); const prior = state.history.pop(); state.future.push(current); restore(prior); updateUndoButtons(); toast("已撤销"); }
function redo() { if (!guardRaw()) return; flushPending(); if (!state.future.length) return; const current = snapshot(); const next = state.future.pop(); state.history.push(current); restore(next); updateUndoButtons(); toast("已重做"); }
function updateUndoButtons() { $("#undoBtn").disabled = !state.history.length && !rawDraft; $("#redoBtn").disabled = !state.future.length || rawDraft; }

function filteredEntries() {
  const q = state.query.trim().toLocaleLowerCase();
  const list = entries().filter(([, e]) => {
    if (state.filter === "enabled" && e.disable) return false;
    if (state.filter === "disabled" && !e.disable) return false;
    if (state.filter === "constant" && !e.constant) return false;
    if (!q) return true;
    return [e.comment, e.content, ...(e.key || []), ...(e.keysecondary || [])].some(v => String(v || "").toLocaleLowerCase().includes(q));
  });
  const positions = new Map(displayOrder(state.book).map((id, index) => [id, index]));
  list.sort((a, b) => {
    const ea = a[1], eb = b[1];
    if (state.sort === "title") return String(ea.comment).localeCompare(String(eb.comment), "zh-CN");
    if (state.sort === "order") return (Number(ea.order) || 0) - (Number(eb.order) || 0);
    if (state.sort === "uid") return (Number(ea.uid) || 0) - (Number(eb.uid) || 0);
    return positions.get(a[0]) - positions.get(b[0]);
  });
  return list;
}

function renderList() {
  const list = filteredEntries();
  const canDrag = isManualView() && entries().length > 1;
  $("#resultCount").textContent = `${list.length} / ${entries().length} 项`;
  const viewSummary = $('#activeViewBtn');
  viewSummary.hidden = isManualView();
  viewSummary.textContent = state.query.trim() || state.filter !== 'all' ? '已筛选' : `${$('#sortSelect').selectedOptions[0].textContent}排序`;
  viewSummary.title = `当前${state.query.trim() ? `搜索“${state.query.trim()}”，` : ''}${$('#statusFilter').selectedOptions[0].textContent}，${$('#sortSelect').selectedOptions[0].textContent}；点击展开工具。`;
  $("#selectVisible").checked = list.length > 0 && list.every(([id]) => state.selected.has(id));
  $("#entryList").innerHTML = list.map(([id, e]) => {
    const snippet = (e.content || "").replace(/\s+/g, " ").trim();
    const title = esc(e.comment || "未命名条目");
    return `<div class="entry-item ${id === state.activeId ? "active" : ""} ${state.selected.has(id) ? "selected" : ""}" data-id="${esc(id)}">
      <input class="entry-check" type="checkbox" ${state.selected.has(id) ? "checked" : ""} aria-label="选择 ${title}">
      <button class="entry-drag" type="button" draggable="false" ${canDrag ? "" : "disabled"} aria-label="拖动 ${title}" title="拖动调整显示顺序；勾选后可成组移动">⠿</button>
      <button type="button" class="entry-main" aria-label="编辑 ${title}"><span class="entry-title" title="${title}">${title}</span><span class="entry-bottom"><span class="entry-snippet">${esc((e.key || []).join(" · ") || snippet || "无内容")}</span><span class="entry-badges"><span class="entry-uid">#${esc(e.uid ?? id)}</span>${e.constant ? '<span class="badge constant">常驻</span>' : ""}${e.disable ? '<span class="badge disabled">禁用</span>' : ""}</span></span></button>
    </div>`;
  }).join("") || '<div class="empty-state" style="height:220px"><p>没有符合条件的条目</p></div>';
  renderBulkBar();
  renderMoveTools();
}

function isManualView() { return state.sort === 'display' && state.filter === 'all' && !state.query.trim(); }
function moveTargets() { return state.selected.size ? displayOrder(state.book).filter(id => state.selected.has(id)) : state.activeId == null ? [] : [state.activeId]; }
function renderMoveTools() {
  const order = displayOrder(state.book), targets = new Set(moveTargets());
  const disabled = !isManualView() || !targets.size || order.length < 2;
  $('#moveUpBtn').disabled = disabled || !order.some((id, index) => index > 0 && targets.has(id) && !targets.has(order[index - 1]));
  $('#moveDownBtn').disabled = disabled || !order.some((id, index) => index < order.length - 1 && targets.has(id) && !targets.has(order[index + 1]));
  $('#moveToBtn').disabled = disabled || targets.size === order.length;
  $('#moveHint').textContent = !isManualView() ? '当前有筛选或使用了其他排序；恢复完整显示顺序后可移动。' : state.selected.size
    ? `已勾选 ${targets.size} 项，可成组拖动或移动。` : '拖动 ⠿ 调整顺序；勾选后可批量移动。';
  $('#restoreOrderViewBtn').hidden = isManualView();
  for (const [action, source] of [['move-up', '#moveUpBtn'], ['move-down', '#moveDownBtn'], ['move-position', '#moveToBtn']]) {
    $(`[data-bulk="${action}"]`).disabled = $(source).disabled;
  }
}

function arrange(ids, destination) {
  if (!guardRaw()) return;
  if (!$('#entryForm').reportValidity()) return;
  if (!isManualView()) { toast('请先恢复完整的显示顺序，再移动条目。', true); return; }
  flushEditor();
  const before = snapshot();
  try {
    const result = moveEntries(state.book, ids, destination);
    if (!result.changed) { toast('条目已经在这个位置'); return; }
    checkpoint(before); renderAll();
    const first = result.ids.find(id => ids.includes(id));
    $('#entryList').querySelector(`[data-id="${CSS.escape(first)}"]`)?.scrollIntoView({ block: 'nearest' });
    toast(`已移动 ${result.count} 个条目 · 可撤销，保存后写回酒馆`);
  } catch (error) { toast(error.message, true); }
}

function openMoveDialog() {
  if (!guardRaw() || !isManualView()) return;
  if (!$('#entryForm').reportValidity()) return;
  flushEditor(); moveDialogIds = moveTargets();
  if (!moveDialogIds.length || moveDialogIds.length === entries().length) return;
  moveDialogVersion = snapshot();
  const maximum = entries().length - moveDialogIds.length + 1;
  $('#moveDialogTitle').textContent = `移动 ${moveDialogIds.length} 个条目`;
  $('#moveDescription').textContent = moveDialogIds.length === 1 ? state.book.entries[moveDialogIds[0]].comment || '未命名条目' : '选中的条目会保持相对顺序，作为一组放到指定位置。';
  $('#movePositionInput').max = String(maximum);
  $('#movePositionInput').value = String(Math.min(maximum, displayOrder(state.book).indexOf(moveDialogIds[0]) + 1));
  $('#moveRangeHint').textContent = `可选位置：1–${maximum}`;
  $('#moveDialog').showModal(); $('#movePositionInput').select();
}

function setupEntryDrag() {
  const list = $('#entryList');
  let gesture = null;
  const clearDropMark = () => list.querySelectorAll('.drop-before, .drop-after').forEach(row => row.classList.remove('drop-before', 'drop-after'));
  const finish = () => {
    const prior = gesture; gesture = null;
    clearDropMark(); list.querySelectorAll('.dragging').forEach(row => row.classList.remove('dragging'));
    document.body.classList.remove('dragging-entries');
    if (prior?.handle.hasPointerCapture(prior.pointerId)) prior.handle.releasePointerCapture(prior.pointerId);
    return prior;
  };
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('.entry-drag');
    if (!handle || handle.disabled || event.button !== 0) return;
    if (!isManualView() || !guardRaw() || !$('#entryForm').reportValidity()) { event.preventDefault(); return; }
    event.preventDefault();
    const id = handle.closest('.entry-item').dataset.id;
    flushEditor();
    const currentHandle = list.querySelector(`[data-id="${CSS.escape(id)}"] .entry-drag`);
    gesture = { ids: state.selected.has(id) ? moveTargets() : [id], pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, started: false, target: null, handle: currentHandle };
    currentHandle.setPointerCapture(event.pointerId);
  });
  list.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (!gesture.started && Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) < 5) return;
    gesture.started = true; event.preventDefault(); clearDropMark(); gesture.target = null;
    document.body.classList.add('dragging-entries');
    gesture.ids.forEach(id => list.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add('dragging'));
    const bounds = list.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) return;
    if (event.clientY < bounds.top + 32) list.scrollTop -= 12;
    else if (event.clientY > bounds.bottom - 32) list.scrollTop += 12;
    const row = document.elementFromPoint(event.clientX, event.clientY)?.closest('.entry-item');
    if (!row || !list.contains(row) || gesture.ids.includes(row.dataset.id)) return;
    const rect = row.getBoundingClientRect();
    const placement = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    row.classList.add(`drop-${placement}`);
    gesture.target = { targetId: row.dataset.id, placement };
  });
  list.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const completed = finish();
    if (completed.started && completed.target) arrange(completed.ids, completed.target);
  });
  list.addEventListener('pointercancel', finish);
  list.addEventListener('lostpointercapture', () => { if (gesture) finish(); });
  document.addEventListener('keydown', event => { if (gesture && event.key === 'Escape') { event.preventDefault(); finish(); } });
}

function setupSidebarResize() {
  const workspace = $('.workspace'), separator = $('#sidebarResizer');
  const storageKey = 'worldbook-factory.sidebar-width';
  let preferred = null, resizing = false;
  try { const saved = Number(localStorage.getItem(storageKey)); if (saved >= 300 && saved <= 720) preferred = saved; } catch { /* Layout still works when storage is unavailable. */ }
  const limits = () => ({ minimum: 300, maximum: Math.max(300, Math.min(720, workspace.clientWidth - 368, Math.floor(workspace.clientWidth * .65))) });
  const setWidth = (value, persist = false) => {
    if (window.matchMedia('(max-width: 800px)').matches || !workspace.clientWidth) return;
    const { minimum, maximum } = limits();
    const width = Math.round(Math.max(minimum, Math.min(maximum, value)));
    workspace.style.setProperty('--sidebar-width', `${width}px`);
    separator.setAttribute('aria-valuemin', String(minimum)); separator.setAttribute('aria-valuemax', String(maximum)); separator.setAttribute('aria-valuenow', String(width));
    separator.setAttribute('aria-valuetext', `条目列表宽 ${width} 像素`);
    if (persist) { preferred = width; try { localStorage.setItem(storageKey, String(width)); } catch { /* Optional preference. */ } }
  };
  const refresh = () => setWidth(preferred ?? Math.min(520, Math.max(340, workspace.clientWidth * .36)));
  separator.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); resizing = true; separator.setPointerCapture(event.pointerId); document.body.classList.add('resizing-sidebar');
  });
  separator.addEventListener('pointermove', event => { if (resizing) setWidth(event.clientX - workspace.getBoundingClientRect().left, true); });
  const stop = () => { resizing = false; document.body.classList.remove('resizing-sidebar'); };
  separator.addEventListener('pointerup', stop); separator.addEventListener('pointercancel', stop); separator.addEventListener('lostpointercapture', stop);
  separator.addEventListener('dblclick', () => { preferred = null; try { localStorage.removeItem(storageKey); } catch { /* Optional preference. */ } refresh(); });
  separator.addEventListener('keydown', event => {
    const current = $('.sidebar').getBoundingClientRect().width;
    const { minimum, maximum } = limits();
    const values = { ArrowLeft: current - 20, ArrowRight: current + 20, Home: minimum, End: maximum };
    if (!(event.key in values)) return;
    event.preventDefault(); setWidth(values[event.key], true);
  });
  new ResizeObserver(refresh).observe(workspace); refresh();
}

function setupToolPanels() {
  let storage;
  try { storage = window.localStorage; } catch { /* Optional preference. */ }
  toolPanels = createToolPanels({
    shell: $('.app-shell'), toggle: $('#toggleToolsBtn'),
    panels: [$('#fileTools'), $('#tavernPicker'), $('#sidebarTools')],
    brand: $('#fullBrand'), compactBook: $('#compactBookBtn'), storage,
  });
  $('#compactBookBtn').onclick = () => { toolPanels.reveal(); $('#tavernBookSelect').focus(); };
  $('#activeViewBtn').onclick = () => { toolPanels.reveal(); $('#searchInput').focus(); };
}

function renderTags(containerId, values) {
  const el = $(containerId), input = el.querySelector("input");
  el.querySelectorAll(".tag").forEach(tag => tag.remove());
  values.forEach((value, index) => {
    const tag = document.createElement("span"); tag.className = "tag";
    tag.innerHTML = `<span>${esc(value)}</span><button type="button" data-index="${index}" aria-label="删除关键词">×</button>`;
    el.insertBefore(tag, input);
  });
}

function renderEditor() {
  const e = activeEntry();
  $("#entryForm").hidden = !e; $("#emptyState").hidden = !!e;
  if (!e) return;
  state.loading = true;
  $("#uidLabel").textContent = `条目 #${e.uid ?? state.activeId}`;
  for (const [id, [field, type]] of Object.entries(fieldMap)) {
    const el = $("#" + id), value = e[field];
    if (el.tagName === "SELECT") {
      el.querySelectorAll("option[data-unknown]").forEach(option => option.remove());
      if (value != null && !Array.from(el.options).some(option => option.value === String(value))) {
        const option = new Option(`原始值 ${value}`, String(value)); option.dataset.unknown = "true"; el.append(option);
      }
    }
    if (type === "checkbox") el.checked = Boolean(value);
    else el.value = value ?? "";
  }
  renderTags("#primaryTags", e.key || []); renderTags("#secondaryTags", e.keysecondary || []);
  $("#secondaryBlock").style.opacity = e.selective ? "1" : ".52";
  $("#contentStats").textContent = stats(e.content || "");
  $("#rawJsonInput").value = JSON.stringify(e, null, 2); $("#rawStatus").textContent = "";
  rawDraft = false;
  state.loading = false;
}
function renderMeta() {
  const all = entries().map(([, e]) => e), enabled = all.filter(e => !e.disable).length, chars = all.reduce((n, e) => n + String(e.content || "").length, 0);
  if ($("#bookNameInput").value !== state.bookName) $("#bookNameInput").value = state.bookName;
  $("#bookMeta").textContent = `${state.bookName} · ${all.length} 个条目 · ${enabled} 个启用 · ${chars.toLocaleString()} 字符`;
  $('#compactBookName').textContent = !all.length && state.bookName === '世界书' ? '选择世界书…' : state.bookName.trim() || '未命名世界书';
  $('#compactBookBtn').title = `${state.bookName || '世界书'} · 展开选书和工具`;
}
function renderBulkBar() { const n = state.selected.size; $("#bulkBar").hidden = !n; $("#selectedCount").textContent = `已选择 ${n} 项`; }
function renderAll() { renderMeta(); renderList(); renderEditor(); updateUndoButtons(); }

function onFieldInput(event) {
  if (state.loading) return; const e = activeEntry(); if (!e) return;
  const config = fieldMap[event.target.id]; if (!config) return;
  const before = snapshot(), [field, type] = config;
  if (rawDraft) {
    if (type === "checkbox") event.target.checked = Boolean(e[field]);
    else event.target.value = e[field] ?? "";
    guardRaw(); return;
  }
  if (type === "number" && (event.target.value === "" || !event.target.validity.valid)) return;
  e[field] = type === "checkbox" ? event.target.checked : type === "number" ? Number(event.target.value) : type === "nullableNumber" ? (event.target.value === "" ? null : Number(event.target.value)) : event.target.value;
  if (field === "content") $("#contentStats").textContent = stats(e.content);
  if (["comment", "disable", "constant", "content"].includes(field)) { renderMeta(); renderList(); }
  if (field === "selective") $("#secondaryBlock").style.opacity = e.selective ? "1" : ".52";
  syncRaw();
  scheduleCheckpoint(before);
}

function setupTagEditor(containerId, field) {
  const root = $(containerId), input = root.querySelector("input");
  const add = () => {
    const parts = input.value.split(/[,，\n]/).map(s => s.trim()).filter(Boolean); if (!parts.length) return;
    if (!activeEntry() || !guardRaw()) return; flushPending();
    const before = snapshot(), e = activeEntry(); e[field] = [...new Set([...(e[field] || []), ...parts])]; input.value = "";
    renderTags(containerId, e[field]); renderList(); checkpoint(before);
  };
  input.addEventListener("keydown", ev => { if (!ev.isComposing && ["Enter", ",", "，"].includes(ev.key)) { ev.preventDefault(); add(); } });
  input.addEventListener("blur", add);
  input.addEventListener("input", changed);
  commitTags.push(add);
  root.addEventListener("click", ev => {
    const button = ev.target.closest("button[data-index]"); if (!button) { if (ev.target === root) input.focus(); return; }
    if (!guardRaw()) return; flushPending();
    const before = snapshot(), e = activeEntry(); e[field].splice(Number(button.dataset.index), 1); renderTags(containerId, e[field]); renderList(); checkpoint(before);
  });
}

function newEntry() {
  if (!guardRaw()) return; flushPending();
  const before = snapshot(), uid = nextUid(), id = String(uid), indexes = entries().map(([, e]) => Number(e.displayIndex) || 0);
  state.book.entries[id] = { uid, key: [], keysecondary: [], comment: "新条目", content: "", constant: false, vectorized: false, selective: true, selectiveLogic: 0, addMemo: true, order: 100, position: 0, disable: false, ignoreBudget: false, excludeRecursion: false, preventRecursion: false, probability: 100, useProbability: true, depth: 4, group: "", groupOverride: false, groupWeight: 100, sticky: 0, cooldown: 0, delay: 0, triggers: [], displayIndex: Math.max(0, ...indexes) + 1 };
  state.activeId = id; checkpoint(before); renderAll(); setTimeout(() => $("#commentInput").select(), 0);
}
function duplicateEntry() {
  if (!guardRaw()) return; flushPending();
  const source = activeEntry(); if (!source) return; const before = snapshot(), uid = nextUid(), id = String(uid), copy = clone(source);
  copy.uid = uid; copy.comment = `${copy.comment}（副本）`; copy.displayIndex = Math.max(0, ...entries().map(([, e]) => Number(e.displayIndex) || 0)) + 1;
  state.book.entries[id] = copy; state.activeId = id; checkpoint(before); renderAll(); toast("已复制条目");
}
function deleteIds(ids) {
  if (!guardRaw()) return; flushPending();
  if (!ids.length || !confirm(`确定删除 ${ids.length} 个条目吗？此操作可以撤销。`)) return;
  const before = snapshot(); ids.forEach(id => delete state.book.entries[id]); state.selected.clear();
  if (!state.book.entries[state.activeId]) state.activeId = entries()[0]?.[0] ?? null;
  checkpoint(before); renderAll(); toast(`已删除 ${ids.length} 个条目`);
}
function duplicateGroups() {
  const groups = new Map();
  const allEntries = entries().sort((a, b) =>
    (Number(a[1].displayIndex) || 0) - (Number(b[1].displayIndex) || 0) ||
    (Number(a[1].uid) || 0) - (Number(b[1].uid) || 0)
  );
  for (const [id, e] of allEntries) {
    const content = String(e.content || "").trim().replace(/\r\n/g, "\n");
    const fallback = JSON.stringify([
      String(e.comment || "").trim(),
      [...(e.key || [])].map(v => String(v).trim()).sort(),
      [...(e.keysecondary || [])].map(v => String(v).trim()).sort()
    ]);
    const signature = content ? `content:${content}` : `empty:${fallback}`;
    if (!groups.has(signature)) groups.set(signature, []);
    groups.get(signature).push({ id, entry: e });
  }
  return [...groups.values()].filter(group => group.length > 1);
}
function removeDuplicates() {
  if (!guardRaw()) return; flushPending();
  const groups = duplicateGroups();
  const duplicates = groups.flatMap(group => group.slice(1));
  if (!duplicates.length) { toast("没有发现重复条目"); return; }
  state.duplicatePreview = groups;
  state.duplicatePreviewVersion = snapshot();
  const total = entries().length;
  $("#dedupeStats").innerHTML = `
    <div class="stat-card"><strong>${total}</strong><span>扫描条目总数</span></div>
    <div class="stat-card"><strong>${groups.length}</strong><span>重复内容组数</span></div>
    <div class="stat-card"><strong>${groups.length}</strong><span>重复组内保留</span></div>
    <div class="stat-card delete"><strong>${duplicates.length}</strong><span>将删除条目</span></div>`;
  $("#dedupeGroups").innerHTML = groups.map((group, groupIndex) => `
    <section class="duplicate-group">
      <div class="duplicate-group-title"><strong>重复组 ${groupIndex + 1} · ${esc(group[0].entry.comment || "未命名条目")}</strong><span>共 ${group.length} 条，删除 ${group.length - 1} 条</span></div>
      ${group.map(({ entry }, index) => {
        const keys = [...(entry.key || []), ...(entry.keysecondary || [])].join("、") || "无关键词";
        const content = String(entry.content || "").trim();
        const detail = content ? `${keys} · ${content.replace(/\s+/g, " ").slice(0, 70)}` : `${keys} · 空正文`;
        return `<div class="duplicate-row ${index === 0 ? "keep" : "remove"}">
          <span class="duplicate-status">${index === 0 ? "✓ 保留" : "× 删除"}</span>
          <span class="duplicate-name" title="${esc(entry.comment || "未命名条目")}">${esc(entry.comment || "未命名条目")} <small>#${esc(entry.uid)}</small></span>
          <span class="duplicate-detail" title="${esc(detail)}">${esc(detail)}</span>
          <span class="duplicate-size">${content.length.toLocaleString()} 字符</span>
        </div>`;
      }).join("")}
    </section>`).join("");
  $("#dedupeSummary").textContent = `重复组内保留 ${groups.length} 条，删除 ${duplicates.length} 条；清理后全书共 ${total - duplicates.length} 条，可撤销`;
  $("#confirmDedupeBtn").textContent = `删除 ${duplicates.length} 个重复条目`;
  $("#dedupeModal").hidden = false;
  [".topbar", ".tavern-bar", ".workspace", "#bulkBar"].forEach(selector => $(selector).inert = true);
  $("#cancelDedupeBtn").focus();
  document.body.style.overflow = "hidden";
}
function closeDuplicatePreview() {
  $("#dedupeModal").hidden = true;
  document.body.style.overflow = "";
  state.duplicatePreview = [];
  state.duplicatePreviewVersion = "";
  [".topbar", ".tavern-bar", ".workspace", "#bulkBar"].forEach(selector => $(selector).inert = false);
}
function confirmRemoveDuplicates() {
  if (state.duplicatePreviewVersion !== snapshot()) { closeDuplicatePreview(); removeDuplicates(); toast("条目已变化，请核对更新后的清理预览"); return; }
  const duplicates = state.duplicatePreview.flatMap(group => group.slice(1));
  if (!duplicates.length) { closeDuplicatePreview(); return; }
  const before = snapshot();
  duplicates.forEach(({ id }) => delete state.book.entries[id]);
  state.selected.clear();
  if (!state.book.entries[state.activeId]) state.activeId = entries()[0]?.[0] ?? null;
  const count = duplicates.length;
  closeDuplicatePreview(); checkpoint(before); renderAll(); toast(`已删除 ${count} 个重复条目`);
}
function bulkAction(action) {
  if (action === 'move-position') return openMoveDialog();
  if (action === 'move-up' || action === 'move-down') return arrange(moveTargets(), action.slice(5));
  if (!guardRaw()) return; flushPending();
  const ids = [...state.selected]; if (!ids.length) return; if (action === "delete") return deleteIds(ids);
  const before = snapshot();
  if (action === "order") { const value = prompt("将所选条目的插入顺序设为：", "100"); if (value === null || !Number.isFinite(Number(value))) return; ids.forEach(id => state.book.entries[id].order = Number(value)); }
  if (action === "prefix") { const value = prompt("为所选条目添加主关键词（多个关键词用逗号分隔）：", ""); if (value === null) return; const words = value.split(/[,，]/).map(s => s.trim()).filter(Boolean); ids.forEach(id => state.book.entries[id].key = [...new Set([...(state.book.entries[id].key || []), ...words])]); }
  if (["enable", "disable"].includes(action)) ids.forEach(id => state.book.entries[id].disable = action === "disable");
  if (["constant", "nonconstant"].includes(action)) ids.forEach(id => state.book.entries[id].constant = action === "constant");
  checkpoint(before); renderAll(); toast(`已批量更新 ${ids.length} 个条目`);
}

async function loadFile(file) {
  try {
    const data = normalizeBook(JSON.parse(await file.text()));
    if (window.WorldbookConnection && !window.WorldbookConnection.confirmReplace()) return;
    loadDocument(data, file.name.replace(/\.json$/i, "") || "世界书");
    window.dispatchEvent(new CustomEvent("worldbook:imported"));
    toast(`已导入 ${entries().length} 个条目`);
  }
  catch (error) { toast(`导入失败：${error.message}`, true); }
}
function exportBook() {
  if (!guardRaw()) return; flushEditor();
  const blob = new Blob([JSON.stringify(state.book, null, 2)], { type: "application/json;charset=utf-8" });
  const safeName = (state.bookName.trim() || "世界书").replace(/[\\/:*?"<>|]/g, "_");
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${safeName}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); toast(`已导出 ${safeName}.json`);
}
function applyRaw() {
  try {
    const parsed = JSON.parse($("#rawJsonInput").value);
    normalizeBook({ entries: { [state.activeId]: parsed } });
    if (parsed.uid !== activeEntry().uid) throw new Error("请保留原 UID，它是条目的唯一标识");
    flushPending(); const before = snapshot(); state.book.entries[state.activeId] = parsed;
    rawDraft = false; checkpoint(before); renderAll(); toast("高级字段已应用");
  }
  catch (error) { $("#rawStatus").textContent = `JSON 错误：${error.message}`; }
}
function stats(text) { return `${text.length.toLocaleString()} 字符 · ${text.split(/\n/).length} 行`; }
function esc(value) { return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
let toastTimer; function toast(message, error = false) { const el = $("#toast"); el.textContent = message; el.className = `toast${error ? " error" : ""}`; el.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.hidden = true, 2400); }

function bind() {
  $("#entryForm").addEventListener("submit", event => event.preventDefault());
  $("#rawJsonInput").addEventListener("input", () => { rawDraft = $("#rawJsonInput").value !== JSON.stringify(activeEntry(), null, 2); $("#rawStatus").textContent = rawDraft ? "尚未应用；保存前请点击应用 JSON" : ""; updateUndoButtons(); changed(); });
  $("#entryForm").addEventListener("beforeinput", event => { if (event.target.id !== "rawJsonInput" && rawDraft) { event.preventDefault(); guardRaw(); } });
  Object.keys(fieldMap).forEach(id => {
    const el = $("#" + id);
    el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", onFieldInput);
  });
  setupTagEditor("#primaryTags", "key"); setupTagEditor("#secondaryTags", "keysecondary");
  $("#entryList").addEventListener("click", ev => {
    const item = ev.target.closest(".entry-item"); if (!item) return; const id = item.dataset.id;
    if (ev.target.closest('.entry-drag')) return;
    if (ev.target.matches("input[type=checkbox]")) { ev.target.checked ? state.selected.add(id) : state.selected.delete(id); renderList(); return; }
    if (!guardRaw()) return; flushEditor();
    state.activeId = id; renderList(); renderEditor();
  });
  $('#moveUpBtn').onclick = () => arrange(moveTargets(), 'up');
  $('#moveDownBtn').onclick = () => arrange(moveTargets(), 'down');
  $('#moveToBtn').onclick = openMoveDialog;
  $('#cancelMoveBtn').onclick = () => $('#moveDialog').close();
  $('#moveToTopBtn').onclick = () => { $('#movePositionInput').value = '1'; };
  $('#moveToBottomBtn').onclick = () => { $('#movePositionInput').value = $('#movePositionInput').max; };
  $('#moveDialog').addEventListener('close', () => { moveDialogIds = []; moveDialogVersion = ''; });
  $('#moveForm').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('#moveForm').reportValidity()) return;
    const ids = [...moveDialogIds], position = Number($('#movePositionInput').value);
    if (moveDialogVersion !== snapshot()) { $('#moveDialog').close(); toast('条目已变化，请重新选择移动位置。', true); return; }
    $('#moveDialog').close(); arrange(ids, { position });
  });
  $('#restoreOrderViewBtn').onclick = () => {
    state.query = ''; state.filter = 'all'; state.sort = 'display';
    $('#searchInput').value = ''; $('#statusFilter').value = 'all'; $('#sortSelect').value = 'display'; renderList();
  };
  setupEntryDrag();
  $("#searchInput").addEventListener("input", ev => { state.query = ev.target.value; renderList(); });
  $("#bookNameInput").addEventListener("input", ev => { state.bookName = ev.target.value; renderMeta(); changed(); });
  $("#statusFilter").addEventListener("change", ev => { state.filter = ev.target.value; renderList(); });
  $("#sortSelect").addEventListener("change", ev => { state.sort = ev.target.value; renderList(); });
  $("#selectVisible").addEventListener("change", ev => { filteredEntries().forEach(([id]) => ev.target.checked ? state.selected.add(id) : state.selected.delete(id)); renderList(); });
  $("#addBtn").onclick = newEntry; $("#duplicateBtn").onclick = duplicateEntry; $("#deleteBtn").onclick = () => deleteIds([state.activeId]);
  $("#dedupeBtn").onclick = removeDuplicates;
  $("#closeDedupeBtn").onclick = closeDuplicatePreview;
  $("#cancelDedupeBtn").onclick = closeDuplicatePreview;
  $("#confirmDedupeBtn").onclick = confirmRemoveDuplicates;
  $("#dedupeModal").addEventListener("click", ev => { if (ev.target === $("#dedupeModal")) closeDuplicatePreview(); });
  $("#clearSelection").onclick = () => { state.selected.clear(); renderList(); };
  $("#bulkBar").addEventListener("click", ev => { const action = ev.target.dataset.bulk; if (action) bulkAction(action); });
  $("#undoBtn").onclick = undo; $("#redoBtn").onclick = redo; $("#exportBtn").onclick = exportBook;
  $("#importBtn").onclick = () => $("#fileInput").click(); $("#fileInput").onchange = async ev => { const file = ev.target.files[0]; if (file) await loadFile(file); ev.target.value = ""; };
  $("#applyRawBtn").onclick = applyRaw;
  $("#formatBtn").onclick = () => { if (!guardRaw()) return; flushPending(); const e = activeEntry(); const before = snapshot(); e.content = (e.content || "").replace(/^(?:[ \t]*\r?\n)+|(?:\r?\n[ \t]*)+$/g, ""); checkpoint(before); renderEditor(); toast("已整理首尾空行"); };
  document.addEventListener("keydown", ev => {
    if (ev.isComposing) return;
    if ($('#moveDialog').open) return;
    if (!$("#dedupeModal").hidden) {
      if (ev.key === "Escape") { closeDuplicatePreview(); $("#dedupeBtn").focus(); }
      if (ev.ctrlKey || ev.metaKey) ev.preventDefault();
      if (ev.key === "Tab") {
        const buttons = [...$("#dedupeModal").querySelectorAll("button")];
        if (ev.shiftKey && document.activeElement === buttons[0]) { ev.preventDefault(); buttons.at(-1).focus(); }
        else if (!ev.shiftKey && document.activeElement === buttons.at(-1)) { ev.preventDefault(); buttons[0].focus(); }
      }
      return;
    }
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") { ev.preventDefault(); toolPanels.reveal(); $("#searchInput").focus(); }
    if (ev.key === "Escape" && !$("#dedupeModal").hidden) closeDuplicatePreview();
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); }
    else if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "y") { ev.preventDefault(); redo(); }
  });
  let dragDepth = 0;
  document.addEventListener("dragenter", ev => { if (!ev.dataTransfer.types.includes("Files")) return; ev.preventDefault(); dragDepth++; $("#dropOverlay").hidden = false; });
  document.addEventListener("dragleave", ev => { ev.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; $("#dropOverlay").hidden = true; } });
  document.addEventListener("dragover", ev => ev.preventDefault());
  document.addEventListener("drop", ev => { ev.preventDefault(); dragDepth = 0; $("#dropOverlay").hidden = true; const file = ev.dataTransfer.files[0]; if (file && $("#dedupeModal").hidden) loadFile(file); });
}

function loadDocument(book, name) {
  const parsed = normalizeBook(clone(book));
  clearTimeout(commitTimer); pendingBefore = null; rawDraft = false;
  state.book = parsed; state.bookName = name; state.activeId = displayOrder(parsed)[0] ?? null;
  state.selected.clear(); state.history = []; state.future = []; state.query = ""; state.filter = "all"; state.sort = 'display';
  $("#searchInput").value = ""; $("#statusFilter").value = "all"; $('#sortSelect').value = 'display';
  if ($('#moveDialog').open) $('#moveDialog').close();
  $("#primaryTags input").value = ""; $("#secondaryTags input").value = "";
  closeDuplicatePreview(); renderAll(); $('#entryList').scrollTop = 0; changed();
}

window.WorldbookEditor = Object.freeze({
  load: loadDocument,
  getDocument: () => ({ book: clone(state.book), name: state.bookName }),
  serialize: () => snapshot(),
  getName: () => state.bookName,
  hasRawDraft: () => rawDraft,
  hasPendingTags: () => ["#primaryTags input", "#secondaryTags input"].some(selector => $(selector).value.trim()),
  flush: flushEditor,
  notify: toast,
  canSave: () => guardRaw() && $("#entryForm").checkValidity() && $("#dedupeModal").hidden && !$('#moveDialog').open,
  revealTools: () => toolPanels.reveal(),
});

async function init() {
  bind();
  state.book = { entries: {} };
  state.bookName = "世界书";
  state.activeId = null;
  renderAll();
  setupSidebarResize();
  setupToolPanels();
}
init();
