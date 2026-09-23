(() => {
  'use strict';
  const editor = window.WorldbookEditor;
  const find = selector => document.querySelector(selector);
  let host;
  try { if (window.parent !== window) host = window.parent.WorldbookWorkshopHost; } catch { /* Not a same-origin SillyTavern frame. */ }
  let originalName = null;
  let revision = null;
  let baseline = editor.serialize();
  let baselineName = editor.getName().trim();
  let busy = false;
  let connected = false;
  let detachedDraft = false;
  let errorMessage = '';
  let savedMessage = '';
  let bookCount = 0;

  function hasUnsavedChanges() {
    return detachedDraft || editor.hasRawDraft() || editor.hasPendingTags() || editor.serialize() !== baseline || editor.getName().trim() !== baselineName;
  }

  function confirmReplace() {
    if (busy) return false;
    return !hasUnsavedChanges() || window.confirm('当前修改还没保存。确定放弃这些修改并切换世界书吗？');
  }

  function update() {
    const name = editor.getName().trim();
    const changedName = originalName !== null && name !== originalName;
    const dirty = hasUnsavedChanges();
    find('#saveTavernBtn').textContent = busy ? '正在处理…' : changedName ? '另存为新世界书' : '保存到酒馆';
    find('#saveTavernBtn').disabled = busy || !connected || !dirty;
    find('#openTavernBtn').disabled = busy || !connected || !find('#tavernBookSelect').value;
    find('#tavernBookSelect').disabled = busy || !connected;
    find('#refreshBooksBtn').disabled = busy || !host;
    find('#newBookBtn').disabled = busy;
    find('.workspace').inert = busy;
    find('.top-actions').inert = busy;
    find('#bookNameHint').textContent = originalName
      ? changedName ? `将另存为新书；《${originalName}》及其角色绑定仍然保留。` : `正在编辑酒馆中的《${originalName}》。改名后会另存为新书。`
      : '填写名称后保存，即可在酒馆中新建世界书。';
    const status = find('#connectionStatus');
    status.className = errorMessage ? 'error' : dirty ? 'dirty' : '';
    status.textContent = errorMessage || (busy ? '正在与酒馆同步，请稍候…' :
      dirty ? originalName ? `《${originalName}》有未保存的修改。${changedName ? '本次将另存为新书。' : '点击“保存到酒馆”写回。'}` : '新世界书草稿尚未保存到酒馆。' :
      savedMessage || (originalName ? `已打开《${originalName}》；修改后点击“保存到酒馆”。` :
      connected ? `已连接酒馆 · ${bookCount} 本世界书。选择一本并点击“打开”，或新建世界书。` : '正在连接酒馆…'));
  }

  async function refreshList() {
    const books = await host.listBooks();
    const select = find('#tavernBookSelect');
    const prior = select.value || originalName || '';
    select.replaceChildren(new Option(books.length ? '请选择世界书…' : '暂无世界书，可新建', ''));
    for (const book of books) select.append(new Option(book.name, book.name));
    select.value = books.some(book => book.name === prior) ? prior : '';
    bookCount = books.length;
    connected = true;
  }

  async function run(action) {
    if (busy) return;
    busy = true; errorMessage = ''; update();
    try { await action(); }
    catch (error) {
      errorMessage = error.message || '操作失败，请重试。';
      editor.notify(errorMessage, true);
    } finally { busy = false; update(); }
  }

  async function openSelected() {
    const name = find('#tavernBookSelect').value;
    if (!name || !confirmReplace()) return;
    await run(async () => {
      const result = await host.loadBook(name);
      originalName = result.name;
      revision = result.revision;
      editor.load(result.book, result.name);
      baseline = editor.serialize(); baselineName = result.name;
      detachedDraft = false; savedMessage = '';
    });
  }

  async function save() {
    if (!connected || busy) return;
    if (!editor.canSave()) { editor.notify('请先处理未应用的 JSON、无效字段或打开的清理预览。', true); return; }
    editor.flush();
    if (!hasUnsavedChanges()) return;
    const submitted = editor.getDocument();
    await run(async () => {
      const result = await host.saveBook({ name: submitted.name, book: submitted.book, originalName, revision });
      originalName = result.name; revision = result.revision;
      baseline = JSON.stringify(submitted.book); baselineName = result.name;
      detachedDraft = false;
      const count = Object.keys(result.book.entries).length;
      savedMessage = `已保存到酒馆：${result.name} · ${count} 个条目 · ${new Date().toLocaleTimeString('zh-CN')}`;
      errorMessage = result.warning || '';
      try { await refreshList(); }
      catch { errorMessage = result.warning || '内容已保存。世界书列表暂时刷新失败，可稍后点击“刷新列表”。'; }
      find('#tavernBookSelect').value = result.name;
      editor.notify(`已保存到酒馆：${result.name}（${count} 个条目）`);
    });
  }

  find('#tavernBookSelect').addEventListener('change', update);
  find('#openTavernBtn').addEventListener('click', openSelected);
  find('#refreshBooksBtn').addEventListener('click', () => run(refreshList));
  find('#saveTavernBtn').addEventListener('click', save);
  find('#newBookBtn').addEventListener('click', () => {
    if (!confirmReplace()) return;
    originalName = null; revision = null;
    editor.load({ entries: {} }, '新世界书');
    baseline = editor.serialize(); baselineName = '新世界书';
    detachedDraft = true; savedMessage = ''; errorMessage = '';
    find('#tavernBookSelect').value = ''; update(); find('#bookNameInput').select();
  });
  window.addEventListener('worldbook:changed', () => { if (!busy) errorMessage = ''; update(); });
  window.addEventListener('worldbook:imported', () => {
    originalName = null; revision = null; detachedDraft = true; savedMessage = ''; errorMessage = '';
    find('#tavernBookSelect').value = ''; update();
  });
  document.addEventListener('keydown', event => {
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault(); save();
    }
  });
  window.WorldbookConnection = Object.freeze({ hasUnsavedChanges, confirmReplace });
  if (!host?.listBooks || !host?.saveBook) {
    errorMessage = '这是酒馆扩展页面。请先通过酒馆的“安装扩展”安装 GitHub 仓库，再从酒馆里的“世界书工坊”按钮打开。';
    update();
  } else { run(refreshList); }
})();
