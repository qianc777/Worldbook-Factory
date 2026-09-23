// All requests use the current SillyTavern session and the same origin.
const copy = value => JSON.parse(JSON.stringify(value));

export function fingerprint(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${fingerprint(value[key])}`).join(',')}}`;
}

export function validateBook(book) {
  if (!book || typeof book !== 'object' || Array.isArray(book) ||
      !book.entries || typeof book.entries !== 'object' || Array.isArray(book.entries)) {
    throw new Error('世界书需要包含 entries 对象。');
  }
  for (const [id, entry] of Object.entries(book.entries)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`条目 ${id} 不是有效对象。`);
    for (const field of ['comment', 'content']) {
      if (entry[field] != null && typeof entry[field] !== 'string') throw new Error(`条目 ${id} 的 ${field} 必须是文本。`);
    }
    for (const field of ['key', 'keysecondary']) {
      if (entry[field] != null && (!Array.isArray(entry[field]) || entry[field].some(key => typeof key !== 'string'))) {
        throw new Error(`条目 ${id} 的 ${field} 必须是关键词数组。`);
      }
    }
  }
  return book;
}

export function validateName(value) {
  const name = String(value ?? '').trim();
  if (!name) throw new Error('请填写世界书名称。');
  if (/[\\/:*?"<>|\u0000-\u001f\u007f]/u.test(name) || /[. ]$/.test(name) || /^\.+$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error('世界书名称含有文件名不支持的字符，请修改名称。');
  }
  if (new TextEncoder().encode(`${name}.json`).length > 240) throw new Error('世界书名称过长，请缩短后保存。');
  return name;
}

function failure(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createTavernBridge({ getHeaders, onSaved = async () => {}, fetchImpl = globalThis.fetch, timeoutMs = 30000 }) {
  let writing = false;

  async function request(endpoint, body = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(`/api/worldinfo/${endpoint}`, {
        method: 'POST', headers: getHeaders(), credentials: 'same-origin',
        cache: 'no-store', signal: controller.signal, body: JSON.stringify(body),
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? '酒馆会话已失效或没有权限，请重新登录酒馆后重试。'
          : `酒馆请求失败（HTTP ${response.status}），修改仍保留在编辑器中。`;
        throw failure(message, `HTTP_${response.status}`);
      }
      try { return await response.json(); }
      catch { throw failure('酒馆返回了非 JSON 响应，请确认版本和登录状态。', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (error.name === 'AbortError') throw failure('连接酒馆超时，修改仍保留在编辑器中。', 'TIMEOUT');
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function listBooks() {
    const data = await request('list');
    if (!Array.isArray(data) || data.some(item => typeof item?.file_id !== 'string')) {
      throw failure('无法识别世界书列表，请使用 SillyTavern 1.17.0 或更新版本。', 'INCOMPATIBLE');
    }
    return data.map(item => ({ name: item.file_id, displayName: item.name || item.file_id }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }

  async function loadBook(name) {
    // The native get endpoint returns an empty book for missing files.
    const books = await listBooks();
    if (!books.some(book => book.name === name)) throw failure('这本世界书已不存在，请刷新列表。', 'MISSING');
    const book = validateBook(await request('get', { name }));
    return { name, book: copy(book), revision: fingerprint(book) };
  }

  async function saveBook({ name, book, originalName = null, revision = null }) {
    if (writing) throw failure('已有保存正在进行，请稍候。', 'BUSY');
    writing = true;
    try {
      name = validateName(name);
      const payload = copy(validateBook(book));
      const books = await listBooks();
      const sameName = value => value.normalize('NFC').toLocaleLowerCase() === name.normalize('NFC').toLocaleLowerCase();
      const exists = books.some(item => item.name === name);
      const updating = name === originalName;
      if (updating) {
        if (!exists) throw failure('原世界书已被删除或改名，请重新打开后再保存。', 'MISSING');
        const latest = validateBook(await request('get', { name }));
        if (typeof revision !== 'string' || fingerprint(latest) !== revision) {
          throw failure('酒馆中的这本书已被其他页面修改。本次未写入；请先导出当前修改作备份，再重新打开比较，或改名另存为新书。', 'CONFLICT');
        }
      } else if (books.some(item => sameName(item.name))) {
        throw failure('酒馆里已有同名世界书，请换一个名称；如需修改原书，请先从列表打开它。', 'EXISTS');
      }

      const result = await request('edit', { name, data: payload });
      if (result?.ok !== true) throw failure('酒馆未确认保存成功，修改仍保留在编辑器中。', 'UNCONFIRMED');
      const saved = validateBook(await request('get', { name }));
      if (fingerprint(saved) !== fingerprint(payload)) {
        throw failure('保存后的内容与提交内容不同，可能有另一页面同时修改。请导出当前修改并重新打开核对。', 'VERIFY_FAILED');
      }
      let warning = '';
      try { await onSaved(name, copy(saved), { created: !updating }); }
      catch { warning = '内容已保存，但酒馆界面刷新失败；请保存其他工作后刷新酒馆页面。'; }
      return { name, book: copy(saved), revision: fingerprint(saved), warning };
    } finally { writing = false; }
  }

  return Object.freeze({ listBooks, loadBook, saveBook });
}
