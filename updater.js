export const EXTENSION_VERSION = '1.1.0';
export const REPOSITORY_URL = 'https://github.com/qianc777/Worldbook-Factory';

function problem(message, code) {
  return Object.assign(new Error(message), { code });
}

export function extensionIdentity(moduleUrl, types) {
  const match = new URL(moduleUrl).pathname.match(/\/scripts\/extensions\/third-party\/([^/]+)\/index\.js$/);
  const name = match ? decodeURIComponent(match[1]) : '';
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw problem('无法识别插件安装目录，请从酒馆中打开世界书工坊。', 'INVALID_PATH');
  }
  const type = types?.[`third-party/${name}`];
  if (type !== 'local' && type !== 'global') {
    throw problem('无法识别插件安装范围，请使用酒馆的扩展管理进行更新。', 'UNKNOWN_SCOPE');
  }
  return { extensionName: name, global: type === 'global' };
}

export function isWorkshopRepository(remote) {
  if (typeof remote !== 'string') return false;
  const scp = remote.match(/^git@github\.com:(.+)$/i);
  try {
    const url = new URL(scp ? `https://github.com/${scp[1]}` : remote);
    return ['https:', 'ssh:'].includes(url.protocol) && url.hostname.toLowerCase() === 'github.com' &&
      url.pathname.replace(/\/$/, '').replace(/\.git$/i, '').toLowerCase() === '/qianc777/worldbook-factory' &&
      !url.search && !url.hash;
  } catch { return false; }
}

export function createExtensionUpdater({
  moduleUrl, getTypes, getHeaders, fetchImpl = globalThis.fetch,
  runningVersion = EXTENSION_VERSION, timeoutMs = 90000,
}) {
  let busy = false;

  async function request(url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
        headers: body ? getHeaders() : undefined,
        body: body ? JSON.stringify(body) : undefined, signal: controller.signal,
      });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403
          ? '没有更新权限或酒馆登录已失效；全局安装的插件需要管理员更新。'
          : response.status === 404 ? '酒馆找不到插件安装目录，请使用扩展管理检查安装。'
          : `更新请求失败（HTTP ${response.status}）。请确认酒馆能够连接 GitHub，或查看酒馆终端日志。`;
        throw problem(message, `HTTP_${response.status}`);
      }
      try { return await response.json(); }
      catch { throw problem('酒馆返回了无法识别的更新结果，请稍后重试。', 'INVALID_RESPONSE'); }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw problem('未能及时确认更新结果，请稍后再检查。当前页面和草稿不会自动刷新。', 'TIMEOUT');
      }
      throw error;
    } finally { clearTimeout(timer); }
  }

  async function checkAndUpdate(onProgress = () => {}) {
    if (busy) throw problem('正在检查或更新，请稍候。', 'BUSY');
    busy = true;
    try {
      const identity = extensionIdentity(moduleUrl, getTypes());
      onProgress('checking');
      const current = await request('/api/extensions/version', identity);
      if (!current?.currentCommitHash || !current.remoteUrl) {
        throw problem('当前安装不是可更新的 Git 仓库。请用酒馆“安装扩展”重新安装 GitHub 地址。', 'NOT_GIT');
      }
      if (!isWorkshopRepository(current.remoteUrl)) {
        throw problem('当前安装的来源不是 Worldbook-Factory 仓库，未执行更新。请在扩展管理中核对来源。', 'WRONG_REPOSITORY');
      }
      if (typeof current.isUpToDate !== 'boolean') throw problem('无法确认仓库更新状态，请稍后重试。', 'INVALID_RESPONSE');
      let commit = current.currentCommitHash.slice(0, 7);
      const needsDownload = !current.isUpToDate;
      if (needsDownload) {
        onProgress('updating');
        const result = await request('/api/extensions/update', identity);
        if (typeof result?.isUpToDate !== 'boolean' || !result.shortCommitHash || !isWorkshopRepository(result.remoteUrl)) {
          throw problem('酒馆未返回完整的更新确认。请稍后再检查；当前页面不会自动刷新。', 'UNCONFIRMED');
        }
        commit = result.shortCommitHash;
      }
      let installedVersion = '';
      let warning = '';
      try {
        const manifestUrl = new URL('./manifest.json', moduleUrl);
        manifestUrl.searchParams.set('check', String(Date.now()));
        const manifest = await request(manifestUrl.href);
        if (typeof manifest?.version !== 'string' || !manifest.version.trim()) throw new Error('Missing version');
        installedVersion = manifest.version;
      } catch {
        warning = '仓库检查已完成，但无法读取安装后的版本号；请保存工作后刷新页面核对。';
      }
      return {
        updated: needsDownload, version: installedVersion || runningVersion, commit, warning,
        reloadRequired: needsDownload || !installedVersion || installedVersion !== runningVersion,
      };
    } finally { busy = false; }
  }

  return Object.freeze({ checkAndUpdate });
}
