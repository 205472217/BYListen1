/* eslint-disable no-unused-vars */
/* eslint-disable global-require */
/* global isElectron */

/**
 * WebDAV 云同步的传输层。
 *
 * 只负责「怎么把一份 JSON 备份写到 WebDAV / 从 WebDAV 读回来」，
 * 不关心备份里有什么（合并语义在 js/myplaylist.js 里）。
 *
 * Electron 下所有请求都通过主进程的 `webdavRequest` IPC 转发：
 * 渲染进程跑在 file:// 上，直连 WebDAV 会被 CORS 预检和 Authorization
 * 头限制卡死，只有主进程的 net.request 才能真正控制请求方法与头部。
 * 非 Electron（浏览器扩展）环境退回 axios 直连，作为降级路径。
 */
const webdavFactory = () => {
  const CONFIG_KEY = 'webdav_config';
  const BACKUP_FILENAME = 'listen1_backup.json';

  const DEFAULT_CONFIG = {
    url: '',
    username: '',
    password: '',
    dir: 'Listen1',
    autoSync: false,
    lastSyncAt: 0,
  };

  // WebDAV 地址留空时使用的默认服务器（坚果云）。
  // 通过 getDefaultUrl() 暴露给模板作为输入框的 placeholder，保证提示与生效值一致。
  const DEFAULT_URL = 'https://dav.jianguoyun.com/dav/';

  const trimSlashes = (value) => String(value || '').replace(/^\/+|\/+$/g, '');

  // 地址留空 -> 直接使用默认地址。这样用户只填账号 + 应用密码就能连上，
  // 不会因为"地址没填"被当成未配置而报错。
  const resolveUrl = (value) => {
    const raw = String(value || '').trim();
    return raw.length > 0 ? raw : DEFAULT_URL;
  };

  const normalizeBase = (url) => {
    const trimmed = resolveUrl(url);
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  };

  const encodeSegments = (segments) =>
    segments
      .map((segment) => trimSlashes(segment))
      .filter((segment) => segment.length > 0)
      .map((segment) => encodeURIComponent(segment))
      .join('/');

  const getConfig = () => {
    const saved = localStorage.getObject(CONFIG_KEY);
    const base = saved && typeof saved === 'object' ? saved : {};
    return Object.assign({}, DEFAULT_CONFIG, base);
  };

  const saveConfig = (config) => {
    const next = Object.assign({}, DEFAULT_CONFIG, getConfig(), config || {});
    localStorage.setObject(CONFIG_KEY, next);
    return next;
  };

  const clearConfig = () => {
    localStorage.removeItem(CONFIG_KEY);
  };

  const hasConfig = () => {
    const config = getConfig();
    // 地址允许留空（留空即使用默认的坚果云地址），所以只需要账号和应用密码
    return (
      String(config.username || '').trim().length > 0 &&
      String(config.password || '').length > 0
    );
  };

  const getDefaultUrl = () => DEFAULT_URL;

  const getLastSyncAt = () => Number(getConfig().lastSyncAt) || 0;

  const setLastSyncAt = (timestamp) => {
    const config = getConfig();
    config.lastSyncAt = Number(timestamp) || 0;
    localStorage.setObject(CONFIG_KEY, config);
  };

  const folderUrl = () => {
    const config = getConfig();
    const dir = trimSlashes(config.dir || DEFAULT_CONFIG.dir);
    return `${normalizeBase(config.url)}${encodeSegments([dir])}/`;
  };

  const fileUrl = (filename) => `${folderUrl()}${encodeURIComponent(filename)}`;

  const request = (options, callback) => {
    if (isElectron()) {
      const { ipcRenderer } = require('electron');
      ipcRenderer.invoke('webdavRequest', options).then(
        (result) => callback(result || { ok: false, error: 'empty response' }),
        (error) =>
          callback({
            ok: false,
            error: String((error && error.message) || error),
          })
      );
      return;
    }
    axios
      .request({
        url: options.url,
        method: options.method,
        headers: options.headers || {},
        auth: {
          username: options.username,
          password: options.password,
        },
        data: options.body,
        validateStatus: () => true,
      })
      .then((response) =>
        callback({
          ok: true,
          statusCode: response.status,
          headers: response.headers,
          body:
            typeof response.data === 'string'
              ? response.data
              : JSON.stringify(response.data),
        })
      )
      .catch((error) =>
        callback({ ok: false, error: String((error && error.message) || error) })
      );
  };

  const send = (method, url, extra, callback) => {
    const config = getConfig();
    const options = Object.assign(
      {
        method,
        url,
        username: config.username,
        password: config.password,
        headers: {},
      },
      extra || {}
    );
    request(options, callback);
  };

  const isFolderReady = (result) =>
    result &&
    result.ok &&
    ((result.statusCode >= 200 && result.statusCode < 300) ||
      result.statusCode === 405);

  const ensureFolder = (callback) => {
    send('PROPFIND', folderUrl(), { headers: { Depth: '0' } }, (result) => {
      if (isFolderReady(result)) {
        callback(true, null);
        return;
      }
      if (result && (result.statusCode === 404 || result.statusCode === 409)) {
        send('MKCOL', folderUrl(), {}, (mkcol) => {
          if (isFolderReady(mkcol)) {
            callback(true, null);
            return;
          }
          callback(
            false,
            mkcol && mkcol.error
              ? mkcol.error
              : `MKCOL HTTP ${mkcol && mkcol.statusCode}`
          );
        });
        return;
      }
      callback(
        false,
        result && result.error
          ? result.error
          : `PROPFIND HTTP ${result && result.statusCode}`
      );
    });
  };

  const testConnection = (callback) => {
    if (!hasConfig()) {
      callback(false, 'not configured');
      return;
    }
    ensureFolder((ok, error) => callback(ok, error));
  };

  const push = (payload, callback) => {
    if (!hasConfig()) {
      callback({ ok: false, error: 'not configured' });
      return;
    }
    ensureFolder((folderOk, folderError) => {
      if (!folderOk) {
        callback({ ok: false, error: folderError });
        return;
      }
      const body = JSON.stringify(payload);
      send(
        'PUT',
        fileUrl(BACKUP_FILENAME),
        {
          // 注意：不要自己设 Content-Length。Chromium 的 URLLoader 把它列为
          // 受限请求头，手动设置会让整个请求以 net::ERR_INVALID_ARGUMENT 失败
          // （实测：服务端连 PUT 都收不到）。主进程会把请求体一次性缓冲，
          // 长度由 Chromium 自动补上。
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body,
        },
        (result) => {
          if (!result || !result.ok) {
            callback({
              ok: false,
              error: (result && result.error) || 'network error',
            });
            return;
          }
          if (result.statusCode >= 200 && result.statusCode < 300) {
            callback({ ok: true });
            return;
          }
          callback({ ok: false, error: `HTTP ${result.statusCode}` });
        }
      );
    });
  };

  const pull = (callback) => {
    if (!hasConfig()) {
      callback({ ok: false, error: 'not configured' });
      return;
    }
    send('GET', fileUrl(BACKUP_FILENAME), {}, (result) => {
      if (!result || !result.ok) {
        callback({
          ok: false,
          error: (result && result.error) || 'network error',
        });
        return;
      }
      if (result.statusCode === 404) {
        callback({ ok: true, found: false });
        return;
      }
      if (result.statusCode < 200 || result.statusCode >= 300) {
        callback({ ok: false, error: `HTTP ${result.statusCode}` });
        return;
      }
      let data = null;
      try {
        data = JSON.parse(result.body);
      } catch (error) {
        callback({ ok: false, error: 'invalid backup content' });
        return;
      }
      if (!data || typeof data !== 'object') {
        callback({ ok: false, error: 'invalid backup content' });
        return;
      }
      callback({ ok: true, found: true, data });
    });
  };

  return {
    getConfig,
    saveConfig,
    clearConfig,
    hasConfig,
    getDefaultUrl,
    getLastSyncAt,
    setLastSyncAt,
    testConnection,
    push,
    pull,
  };
};

const WebdavClient = webdavFactory();
