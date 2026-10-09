const electron = require("electron");
const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  session,
  screen,
  Tray,
} = electron;
const Store = require("electron-store");
const { autoUpdater } = require("electron-updater");
const remoteMain = require("@electron/remote/main");
const { spawn } = require("child_process");
const { join, basename, dirname, resolve } = require("path");
const {
  existsSync,
  mkdirSync,
  appendFileSync,
  createWriteStream,
  writeFileSync,
  readFileSync,
  unlink,
  rename,
  stat,
} = require("fs");
const { pathToFileURL } = require("url");

// simple per-day log file next to the executable
function writeLog(type, message) {
  try {
    const pad = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const dir = join(app.getPath("exe"), "..", "log");
    const file = join(dir, `log-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(file, `[${d.toISOString()}] [${type}] ${message}\n`, "utf8");
  } catch (err) {
    console.log("writeLog error:", err);
  }
}

ipcMain.on("logLocalMusic", (event, arg) => {
  if (arg && typeof arg.message === "string") {
    writeLog(arg.type || "INFO", arg.message);
  }
});

ipcMain.handle("showLyricContextMenu", (event) =>
  new Promise((resolve) => {
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    if (!senderWindow) {
      resolve(false);
      return;
    }

    let selected = false;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: t("_SEEK_TO_HERE"),
        click() {
          selected = true;
          resolve(true);
        },
      },
    ]);
    contextMenu.popup({
      window: senderWindow,
      callback() {
        if (!selected) {
          resolve(false);
        }
      },
    });
  })
);

const store = new Store();
const iconPath = join(__dirname, "/listen1_chrome_extension/images/logo.png");

// ---------------------------------------------------------------------------
// 主进程多语言：托盘菜单、原生对话框、下载提示等系统级文案。
// 文案表与前端共用 `listen1_chrome_extension/i18n/*.json`；
// 渲染进程在切换语言时通过 `setLanguage` IPC 通知这里。
// ---------------------------------------------------------------------------
const I18N_DIR = join(__dirname, "listen1_chrome_extension", "i18n");
const SUPPORTED_LANGUAGES = ["zh-CN", "zh-TC", "en-US", "fr-FR", "ko-KR", "pt-BR"];
const localeCache = new Map();
let currentLanguage = null;
// 托盘菜单里的「正在播放」信息，重建菜单（切换语言）时需要复用
let trayTrack = null;

function getLanguage() {
  if (currentLanguage === null) {
    let stored = null;
    try {
      stored = store.get("language");
    } catch (error) {
      stored = null;
    }
    currentLanguage =
      SUPPORTED_LANGUAGES.indexOf(stored) !== -1 ? stored : "zh-CN";
  }
  return currentLanguage;
}

function loadLocale(lang) {
  if (localeCache.has(lang)) {
    return localeCache.get(lang);
  }
  let dict = {};
  try {
    // 语言包可能是带 BOM 的 UTF-8（zh-TC.json），JSON.parse 前必须先去掉 BOM
    const raw = readFileSync(join(I18N_DIR, `${lang}.json`), "utf8").replace(
      /^\uFEFF/,
      ""
    );
    dict = JSON.parse(raw);
  } catch (error) {
    dict = {};
  }
  localeCache.set(lang, dict);
  return dict;
}

/** 取当前语言下的文案；缺失时依次回退到 zh-CN、en-US，最后返回 key 本身。 */
function t(key) {
  const candidates = [getLanguage(), "zh-CN", "en-US"];
  for (const lang of candidates) {
    const value = loadLocale(lang)[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return key;
}

ipcMain.on("setLanguage", (event, lang) => {
  if (SUPPORTED_LANGUAGES.indexOf(lang) === -1) {
    return;
  }
  if (lang === getLanguage()) {
    return;
  }
  currentLanguage = lang;
  try {
    store.set("language", lang);
  } catch (error) {
    /* 语言持久化失败不影响本次运行 */
  }
  // 托盘菜单文案需要重建
  if (mainWindow && !mainWindow.isDestroyed()) {
    initialTray(mainWindow, trayTrack);
  }
});

const mediaRequestHeaders = new Map();

function normalizeRequestHeaders(headers) {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    return headers.reduce((result, header) => {
      if (header && header.name && header.value) {
        result[header.name] = header.value;
      }
      return result;
    }, {});
  }
  return { ...headers };
}

function rememberMediaRequest(url, headers) {
  const normalized = normalizeRequestHeaders(headers);
  delete normalized.Range;
  delete normalized.range;
  delete normalized["If-Range"];
  delete normalized["if-range"];
  mediaRequestHeaders.set(url, normalized);
  if (mediaRequestHeaders.size > 300) {
    mediaRequestHeaders.delete(mediaRequestHeaders.keys().next().value);
  }
}

function getRememberedMediaHeaders(url) {
  const exact = mediaRequestHeaders.get(url);
  if (exact) return exact;
  try {
    const targetHost = new URL(url).host;
    const entries = Array.from(mediaRequestHeaders.entries()).reverse();
    const match = entries.find(([requestUrl]) => {
      try {
        return new URL(requestUrl).host === targetHost;
      } catch (error) {
        return false;
      }
    });
    return match ? match[1] : {};
  } catch (error) {
    return {};
  }
}

function getPlatformDownloadHeaders(track) {
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36",
  };
  switch (track.platform || track.source) {
    case "netease":
      headers.Referer = "http://music.163.com/";
      break;
    case "qq":
      headers.Referer = "https://y.qq.com/";
      headers.Origin = "https://y.qq.com";
      break;
    case "kugou":
      headers.Referer = "https://www.kugou.com/";
      headers["User-Agent"] = MOBILE_UA;
      break;
    case "kuwo":
      headers.Referer = "http://www.kuwo.cn/";
      break;
    case "bilibili":
      headers.Referer = "https://www.bilibili.com/";
      break;
    case "migu":
      headers.Referer = "http://music.migu.cn/v3/music/player/audio?from=migu";
      break;
    default:
      break;
  }
  return headers;
}

/**
 * 按名字合并请求头（大小写不敏感）。
 * 平台硬编码头与「播放时记下来的头」可能一个写成 Referer、另一个写成 referer，
 * 直接 spread 会同时留下两个键，必须去重。
 */
function mergeRequestHeaders(...sources) {
  const merged = {};
  const nameByLower = new Map();
  sources.forEach((source) => {
    if (!source) return;
    Object.keys(source).forEach((name) => {
      const lower = name.toLowerCase();
      const existing = nameByLower.get(lower);
      if (existing !== undefined) {
        merged[existing] = source[name];
      } else {
        nameByLower.set(lower, name);
        merged[name] = source[name];
      }
    });
  });
  return merged;
}

/**
 * 把 Referer / Origin 的 scheme 对齐到媒体地址的 scheme。
 *
 * 这是 net::ERR_BLOCKED_BY_CLIENT 的根因：Chromium 会**直接拦掉**
 * 「https:// 的 Referer -> http:// 的目标地址」这种referrer 降级请求，
 * 请求根本发不出去（不是被服务器拒绝）。
 * 实测酷狗 tracker 接口返回的播放地址就是 `http://fsandroid.tx.kugou.com/...`，
 * 而旧代码里写死了 `Referer: https://www.kugou.com/`（qq / bilibili 同理，
 * 也都是 https 的 Referer），于是这些平台的下载必然被拦。
 *
 * 对齐之后：http 媒体地址配 http Referer（host 不变），
 * 既不会被拦，也保留了防盗链需要的 Referer 语义。
 */
function alignHeaderSchemeToUrl(headers, mediaUrl) {
  let protocol;
  try {
    protocol = new URL(mediaUrl).protocol;
  } catch (error) {
    return headers;
  }
  if (protocol !== "http:") return headers;
  const aligned = {};
  Object.keys(headers).forEach((name) => {
    const value = headers[name];
    const lower = name.toLowerCase();
    if (
      (lower === "referer" || lower === "origin") &&
      typeof value === "string" &&
      value.indexOf("https://") === 0
    ) {
      aligned[name] = `http://${value.slice("https://".length)}`;
    } else {
      aligned[name] = value;
    }
  });
  return aligned;
}

/**
 * 「缓存兜底」用的媒体字节缓存。
 *
 * 播放时渲染进程已经通过 <audio> 把音频字节拉进过 Chromium，
 * 这里用 CDP 把同一份字节留一份在内存里，下载失败时直接拿它去转码。
 * 这是一个「本会话已播放过的 URL」兜底，不是主路径。
 */
const MEDIA_CACHE_MAX_TOTAL_BYTES = 160 * 1024 * 1024;
const MEDIA_CACHE_MAX_ENTRY_BYTES = 40 * 1024 * 1024;
const mediaBodyCache = new Map();
let mediaBodyCacheBytes = 0;

function isAudioLikeUrl(url) {
  return (
    typeof url === "string" &&
    (/\.(mp3|m4a|aac|flac|ogg|oga|wav|webm|m4s)(\?|$)/i.test(url) ||
      url.includes("bilivideo"))
  );
}

function cacheMediaBody(url, buffer, mimeType) {
  if (!url || !buffer || buffer.length === 0) return;
  if (buffer.length > MEDIA_CACHE_MAX_ENTRY_BYTES) return;
  const existing = mediaBodyCache.get(url);
  if (existing) {
    mediaBodyCacheBytes -= existing.buffer.length;
    mediaBodyCache.delete(url);
  }
  mediaBodyCache.set(url, { buffer, mimeType: mimeType || "", time: Date.now() });
  mediaBodyCacheBytes += buffer.length;
  while (
    mediaBodyCacheBytes > MEDIA_CACHE_MAX_TOTAL_BYTES &&
    mediaBodyCache.size > 1
  ) {
    const oldestKey = mediaBodyCache.keys().next().value;
    const oldest = mediaBodyCache.get(oldestKey);
    mediaBodyCache.delete(oldestKey);
    mediaBodyCacheBytes -= oldest.buffer.length;
  }
}

/**
 * 取缓存字节。先精确匹配 URL；不中再退化为「同 host + 同 path」匹配
 * （点击下载时会重新解析一遍地址，鉴权 token 可能已经变了）。
 */
function getCachedMediaBody(url) {
  if (!url) return null;
  const exact = mediaBodyCache.get(url);
  if (exact) {
    mediaBodyCache.delete(url);
    mediaBodyCache.set(url, exact);
    return exact;
  }
  let target;
  try {
    target = new URL(url);
  } catch (error) {
    return null;
  }
  let matchedKey = null;
  mediaBodyCache.forEach((entry, key) => {
    if (matchedKey) return;
    try {
      const candidate = new URL(key);
      if (
        candidate.host === target.host &&
        candidate.pathname === target.pathname
      ) {
        matchedKey = key;
      }
    } catch (error) {
      /* 忽略无法解析的历史键 */
    }
  });
  if (!matchedKey) return null;
  const entry = mediaBodyCache.get(matchedKey);
  mediaBodyCache.delete(matchedKey);
  mediaBodyCache.set(matchedKey, entry);
  return entry;
}

/**
 * 常驻 CDP 监听：渲染进程每播放一首歌，就把那次媒体响应的字节回收进缓存。
 * 必须在页面加载完成（渲染进程已存在）之后再 attach，否则 Network.enable
 * 会一直挂住；页面加载期的请求我们不需要，媒体请求都在用户点播之后。
 */
function attachMediaRecorder(webContents) {
  if (!webContents || webContents.isDestroyed()) return;
  const dbg = webContents.debugger;
  if (dbg.isAttached()) return;
  try {
    dbg.attach("1.3");
  } catch (error) {
    return;
  }
  const requestMeta = new Map();
  dbg
    .sendCommand("Network.enable")
    .then(() => {
      dbg.on("message", (event, method, params) => {
        try {
          if (method === "Network.requestWillBeSent") {
            if (params.type === "Media" || isAudioLikeUrl(params.request.url)) {
              requestMeta.set(params.requestId, {
                url: params.request.url,
                type: params.type,
                status: 0,
                mimeType: "",
                contentRange: "",
              });
            }
            if (requestMeta.size > 400) {
              requestMeta.delete(requestMeta.keys().next().value);
            }
            return;
          }
          if (method === "Network.responseReceived") {
            const meta = requestMeta.get(params.requestId);
            if (meta) {
              const responseHeaders = params.response.headers || {};
              meta.status = params.response.status;
              meta.mimeType = params.response.mimeType;
              meta.contentRange =
                responseHeaders["Content-Range"] ||
                responseHeaders["content-range"] ||
                "";
            }
            return;
          }
          if (method === "Network.loadingFinished") {
            const meta = requestMeta.get(params.requestId);
            if (!meta) return;
            // 206 且不是从 0 开始的区间 = 中间片段，存下来也是坏文件，跳过
            if (meta.status === 206) {
              const match = /bytes\s+(\d+)-/i.exec(meta.contentRange || "");
              if (!match || Number(match[1]) !== 0) return;
            }
            dbg
              .sendCommand("Network.getResponseBody", {
                requestId: params.requestId,
              })
              .then((res) => {
                const buffer = res.base64Encoded
                  ? Buffer.from(res.body, "base64")
                  : Buffer.from(res.body, "utf8");
                cacheMediaBody(meta.url, buffer, meta.mimeType);
              })
              .catch(() => {
                /* Chromium 可能已回收 body，当作未命中 */
              });
          }
        } catch (error) {
          /* 忽略单条事件异常，不影响播放 */
        }
      });
    })
    .catch(() => {
      /* Network.enable 失败时静默降级，只是没有缓存兜底 */
    });
}

function getDefaultDownloadPath() {
  const basePath = app.isPackaged ? dirname(process.execPath) : join(__dirname, "..");
  return join(basePath, "download");
}

function getDownloadPath() {
  return store.get("downloadPath") || getDefaultDownloadPath();
}

function ensureDirectory(directory) {
  mkdirSync(directory, { recursive: true });
  return directory;
}

function sanitizeFileName(value) {
  return String(value || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 160);
}

function getFfmpegPath() {
  const fileName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    process.env.LISTEN1_FFMPEG_PATH,
    app.isPackaged ? join(dirname(process.execPath), fileName) : null,
    app.isPackaged ? join(dirname(process.execPath), "resources", fileName) : null,
    join(__dirname, "..", "ffmpeg", fileName),
    join(__dirname, "..", "build", fileName),
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || fileName;
}

function unlinkFile(filePath) {
  return new Promise((resolvePromise) => {
    unlink(filePath, () => resolvePromise());
  });
}

function renameFile(source, target) {
  return new Promise((resolvePromise, rejectPromise) => {
    rename(source, target, (error) => {
      if (error) rejectPromise(error);
      else resolvePromise();
    });
  });
}

function getFileSize(filePath) {
  return new Promise((resolvePromise, rejectPromise) => {
    stat(filePath, (error, fileStat) => {
      if (error) rejectPromise(error);
      else resolvePromise(fileStat.size);
    });
  });
}

/**
 * 选择落盘文件名。
 * 首选「歌名.mp3」；这个名字已被占用时改用「歌名 (歌手名).mp3」，
 * 这样不同歌手的同名歌曲各存一份，而同一首歌重复下载仍会命中已下载。
 * @returns {Promise<{ path: string; exists: boolean }>}
 */
async function resolveDownloadTarget(directory, title, artist) {
  const isUsableFile = async (filePath) =>
    !!filePath && existsSync(filePath) && (await getFileSize(filePath)) > 0;
  const primaryPath = join(directory, `${title}.mp3`);
  const artistPath = artist ? join(directory, `${title} (${artist}).mp3`) : null;
  if (await isUsableFile(primaryPath)) {
    if (!artistPath) {
      return { path: primaryPath, exists: true };
    }
    if (await isUsableFile(artistPath)) {
      return { path: artistPath, exists: true };
    }
    return { path: artistPath, exists: false };
  }
  return { path: primaryPath, exists: false };
}

function sendDownloadProgress(event, trackId, progress) {
  if (!event.sender.isDestroyed()) {
    event.sender.send("downloadProgress", { trackId, progress });
  }
}

function downloadMedia(event, track, temporaryPath) {
  return new Promise((resolvePromise, rejectPromise) => {
    const playbackHeaders = getRememberedMediaHeaders(track.url);
    const requestHeaders = alignHeaderSchemeToUrl(
      mergeRequestHeaders(getPlatformDownloadHeaders(track), playbackHeaders),
      track.url
    );
    requestHeaders.Range = "bytes=0-";
    const request = net.request({
      url: track.url,
      method: "GET",
      session: event.sender.session,
      credentials: "include",
      cache: "force-cache",
      redirect: "follow",
      headers: requestHeaders,
    });
    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        rejectPromise(
          new Error(`${t("_MEDIA_REQUEST_FAILED")}: HTTP ${response.statusCode}`)
        );
        return;
      }
      const lengthHeader = response.headers["content-length"];
      const contentLength = Number(
        Array.isArray(lengthHeader) ? lengthHeader[0] : lengthHeader || 0
      );
      let received = 0;
      const writer = createWriteStream(temporaryPath);
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        writer.destroy();
        rejectPromise(error);
      };
      writer.on("error", fail);
      response.on("data", (chunk) => {
        received += chunk.length;
        if (contentLength > 0) {
          sendDownloadProgress(event, track.id, received / contentLength);
        }
      });
      response.on("error", fail);
      response.pipe(writer);
      writer.on("finish", () => {
        if (settled) return;
        settled = true;
        sendDownloadProgress(event, track.id, 1);
        resolvePromise();
      });
    });
    request.on("error", rejectPromise);
    request.end();
  });
}

function transcodeToMp3(inputPath, outputPath, track) {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "-y", "-i", inputPath, "-vn", "-codec:a", "libmp3lame", "-b:a", "320k",
      "-id3v2_version", "3",
    ];
    [["title", track.title], ["artist", track.artist], ["album", track.album]].forEach(
      ([key, value]) => {
        if (value) args.push("-metadata", `${key}=${value}`);
      }
    );
    args.push(outputPath);
    const ffmpeg = spawn(getFfmpegPath(), args, { windowsHide: true });
    let errorOutput = "";
    ffmpeg.stderr.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });
    ffmpeg.on("error", rejectPromise);
    ffmpeg.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        rejectPromise(
          new Error(errorOutput.trim() || `${t("_FFMPEG_EXIT_CODE")}: ${code}`)
        );
    });
  });
}

/**
 * 酷我的歌单 / 专辑详情接口要求 `Secret` 请求头，值由 www.kuwo.cn 下发的
 * `Hm_Iuvt_...` cookie 计算得到；而且该 cookie 必须能随渲染进程的跨源请求一起发出。
 *
 * listen1.html 是 file:// 页面，渲染进程自己去请求 www.kuwo.cn 时：
 *   1) 响应里的 Set-Cookie 不会落到会话 → 永远拿不到 token；
 *   2) 就算会话里有这个 cookie，默认 SameSite=Lax 也不会随跨源 XHR 发送，
 *      服务器直接回 {"success":false,"message":"The request is illegal!"}。
 * 所以在主进程用会话补种，并重设为 SameSite=None; Secure，让渲染进程的请求能带上它。
 */
const KUWO_TOKEN_COOKIE = "Hm_Iuvt_cdb524f42f23cer9b268564v7y735ewrq2324";
const KUWO_DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function fetchPageInSession(url, userAgent) {
  return new Promise((resolvePromise) => {
    const request = net.request({
      url,
      method: "GET",
      session: session.defaultSession,
      useSessionCookies: true,
      credentials: "include",
      redirect: "follow",
    });
    request.setHeader("User-Agent", userAgent);
    request.on("response", (response) => {
      response.on("data", () => {});
      response.on("end", () => resolvePromise(true));
    });
    request.on("error", () => resolvePromise(false));
    request.end();
  });
}

async function ensureKuwoToken(force) {
  const domain = "https://www.kuwo.cn/";
  const readToken = () =>
    session.defaultSession.cookies
      .get({ url: domain, name: KUWO_TOKEN_COOKIE })
      .then((list) => (list && list.length ? list[0].value : ""))
      .catch(() => "");
  try {
    if (force) {
      await session.defaultSession.cookies
        .remove(domain, KUWO_TOKEN_COOKIE)
        .catch(() => {});
    }
    let token = await readToken();
    if (!token) {
      await fetchPageInSession(domain, KUWO_DESKTOP_UA);
      token = await readToken();
    }
    if (!token) return "";
    await session.defaultSession.cookies.set({
      url: domain,
      name: KUWO_TOKEN_COOKIE,
      value: token,
      domain: "www.kuwo.cn",
      path: "/",
      secure: true,
      sameSite: "no_restriction",
      expirationDate: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });
    return token;
  } catch (error) {
    return "";
  }
}

ipcMain.handle("kuwoEnsureToken", (event, options) =>
  ensureKuwoToken(Boolean(options && options.force))
);

/**
 * WebDAV 请求统一由主进程代发。
 *
 * 渲染进程跑在 file:// 下，直连 WebDAV 服务器会遇到两个死结：
 * 1) 跨源请求受 CORS 限制，PROPFIND / MKCOL / PUT 都会先发 OPTIONS 预检，
 *    绝大多数 WebDAV 服务不返回 Access-Control-Allow-* 头，预检必然失败；
 * 2) 浏览器不允许脚本直接设置 Authorization 头（会被拦或降级）。
 * 因此统一用主进程的 net.request 发请求，只有它才能真正控制方法与请求头。
 */
const WEBDAV_ALLOWED_METHODS = ["PROPFIND", "MKCOL", "GET", "PUT", "HEAD", "DELETE"];
const WEBDAV_TIMEOUT = 20000;
const WEBDAV_MAX_BODY = 8 * 1024 * 1024;
// Chromium 的 URLLoader 把这些头列为受限头：一旦脚本设置，整个请求会直接以
// net::ERR_INVALID_ARGUMENT 失败（注意不是抛异常，请求根本发不出去）。
// 实测踩过：手工设 Content-Length 后服务端连 PUT 都收不到。
const WEBDAV_FORBIDDEN_HEADERS = [
  "content-length",
  "host",
  "connection",
  "transfer-encoding",
  "upgrade",
  "expect",
];

function webdavBasicAuth(username, password) {
  const raw = `${username}:${password || ""}`;
  return `Basic ${Buffer.from(raw, "utf8").toString("base64")}`;
}

function webdavRequest(options) {
  return new Promise((resolve) => {
    const method = String((options && options.method) || "GET").toUpperCase();
    const target = options && options.url;
    if (typeof target !== "string" || target.length === 0) {
      resolve({ ok: false, error: "invalid url" });
      return;
    }
    if (!WEBDAV_ALLOWED_METHODS.includes(method)) {
      resolve({ ok: false, error: `method not allowed: ${method}` });
      return;
    }

    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request;
    try {
      request = net.request({ method, url: target, redirect: "follow" });
    } catch (error) {
      done({ ok: false, error: String(error && error.message) });
      return;
    }

    const headers = (options && options.headers) || {};
    Object.keys(headers).forEach((key) => {
      if (WEBDAV_FORBIDDEN_HEADERS.indexOf(String(key).toLowerCase()) !== -1) {
        return;
      }
      try {
        request.setHeader(key, headers[key]);
      } catch (error) {
        // 忽略不支持的头
      }
    });
    if (options && options.username) {
      request.setHeader(
        "Authorization",
        webdavBasicAuth(options.username, options.password)
      );
    }

    const timer = setTimeout(() => {
      try {
        request.abort();
      } catch (error) {
        // 忽略
      }
      done({ ok: false, error: "timeout" });
    }, WEBDAV_TIMEOUT);

    request.on("response", (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= WEBDAV_MAX_BODY) chunks.push(chunk);
      });
      response.on("end", () => {
        clearTimeout(timer);
        done({
          ok: true,
          statusCode: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      response.on("error", (error) => {
        clearTimeout(timer);
        done({ ok: false, error: String(error && error.message) });
      });
    });

    request.on("error", (error) => {
      clearTimeout(timer);
      done({ ok: false, error: String(error && error.message) });
    });

    const body = options && options.body;
    if (body) {
      request.write(body);
    }
    request.end();
  });
}

ipcMain.handle("webdavRequest", (event, options) => webdavRequest(options));

ipcMain.handle("getDownloadPath", () => ensureDirectory(getDownloadPath()));

ipcMain.handle("chooseDownloadPath", async () => {
  const result = await electron.dialog.showOpenDialog({
    title: t("_CHOOSE_DOWNLOAD_DIR"),
    defaultPath: getDownloadPath(),
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return getDownloadPath();
  const selectedPath = resolve(result.filePaths[0]);
  ensureDirectory(selectedPath);
  store.set("downloadPath", selectedPath);
  return selectedPath;
});

ipcMain.handle("downloadMusic", async (event, track) => {
  if (!track || typeof track.url !== "string") {
    return { success: false, error: t("_NO_AUDIO_URL") };
  }
  let mediaUrl;
  try {
    mediaUrl = new URL(track.url);
  } catch (error) {
    return { success: false, error: t("_INVALID_AUDIO_URL") };
  }
  if (!["http:", "https:"].includes(mediaUrl.protocol)) {
    return { success: false, error: t("_ONLINE_ONLY_DOWNLOAD") };
  }
  const directory = ensureDirectory(getDownloadPath());
  const title = sanitizeFileName(track.title) || t("_UNTITLED_SONG");
  const artist = sanitizeFileName(track.artist);
  const target = await resolveDownloadTarget(directory, title, artist);
  if (target.exists) {
    return { success: true, cached: true, path: target.path, fileUrl: pathToFileURL(target.path).href };
  }
  const outputPath = target.path;
  const fileName = basename(outputPath);
  const suffix = Date.now();
  const temporaryInput = join(directory, `.${fileName}.${suffix}.source`);
  const temporaryOutput = join(directory, `.${fileName}.${suffix}.mp3`);
  let usedMediaCache = false;
  try {
    try {
      await downloadMedia(event, track, temporaryInput);
    } catch (downloadError) {
      // 兜底：这首歌唱过的话，渲染进程已经把音频字节拉进过 Chromium，
      // 直接拿那份字节去转码，绕开网络栈的拦截 / 防盗链。
      const cachedMedia = getCachedMediaBody(track.url);
      if (!cachedMedia) {
        throw downloadError;
      }
      writeFileSync(temporaryInput, cachedMedia.buffer);
      usedMediaCache = true;
      writeLog(
        "DOWNLOAD",
        `主请求失败(${downloadError.message})，改用播放缓存 ${cachedMedia.buffer.length} 字节: ${track.url}`
      );
    }
    await transcodeToMp3(temporaryInput, temporaryOutput, track);
    await renameFile(temporaryOutput, outputPath);
    return {
      success: true,
      cached: false,
      fromMediaCache: usedMediaCache,
      path: outputPath,
      fileUrl: pathToFileURL(outputPath).href,
    };
  } catch (error) {
    const rawMessage = (error && error.message) || t("_DOWNLOAD_FAILED");
    const message = /ERR_BLOCKED_BY_CLIENT/.test(rawMessage)
      ? t("_DOWNLOAD_BLOCKED")
      : rawMessage;
    writeLog(
      "DOWNLOAD",
      `失败: ${track.title || ""} - ${track.artist || ""} | ${rawMessage} | ${track.url}`
    );
    return { success: false, error: message };
  } finally {
    await unlinkFile(temporaryInput);
    await unlinkFile(temporaryOutput);
  }
});


autoUpdater.checkForUpdatesAndNotify();

let floatingWindowCssKey = undefined,
  appIcon = null,
  willQuitApp = false,
  transparent = false,
  trayIconPath;
/** @type {electron.BrowserWindow} */
let mainWindow;
/** @type {electron.BrowserWindow} */
let floatingWindow;
/** @type {electron.Tray} */
let appTray;
//platform-specific
switch (process.platform) {
  case "darwin":
    trayIconPath = join(__dirname, "/resources/logo_16.png");
    transparent = true;
    break;
  case "linux":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    // fix transparent window not working in linux bug
    app.disableHardwareAcceleration();
    break;
  case "win32":
    trayIconPath = join(__dirname, "/resources/logo_32.png");
    break;
  default:
    break;
}
// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
/** @type {{ width: number; height: number; maximized: boolean; zoomLevel: number}} */
const windowState = store.get("windowState") || {
  width: 1200,
  height: 800,
  maximized: false,
  zoomLevel: 0,
};
/** @type {electron.Config} */
let proxyConfig = store.get("proxyConfig") || {
  mode: "system",
};

const globalShortcutMapping = {
  "CmdOrCtrl+Alt+Left": "left",
  "CmdOrCtrl+Alt+Right": "right",
  "CmdOrCtrl+Alt+Space": "space",
  MediaNextTrack: "right",
  MediaPreviousTrack: "left",
  MediaPlayPause: "space",
};
/**
 * @param {electron.BrowserWindow} mainWindow
 * @param {{ title: string; artist: string; }} [track]
 */
function initialTray(mainWindow, track) {
  track ||= {
    title: t("_NO_TRACK"),
    artist: "  ",
  };

  let nowPlayingTitle = `${track.title}`;
  let nowPlayingArtist = `${t("_NOW_PLAYING_ARTIST_PREFIX")} ${track.artist}`;

  function toggleVisiable() {
    mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  }
  const menuTemplate = [
    {
      label: nowPlayingTitle,
      click() {
        mainWindow.show();
      },
    },
    {
      label: nowPlayingArtist,
      click() {
        mainWindow.show();
      },
    },
    { type: "separator" },
    {
      label: t("_PLAY_OR_PAUSE"),
      click() {
        mainWindow.webContents.send("globalShortcut", "space");
      },
    },
    {
      label: t("_PREVIOUS_TRACK"),
      click() {
        mainWindow.webContents.send("globalShortcut", "left");
      },
    },
    {
      label: t("_NEXT_TRACK"),
      click() {
        mainWindow.webContents.send("globalShortcut", "right");
      },
    },
    {
      label: t("_SHOW_HIDE_WINDOW"),
      click() {
        toggleVisiable();
      },
    },
    {
      label: t("_QUIT_APPLICATION"),
      click() {
        app.quit();
      },
    },
  ];

  const contextMenu = Menu.buildFromTemplate(menuTemplate);

  if (appTray?.destroy != undefined) {
    // appTray had create, just refresh tray menu here
    appTray?.setContextMenu(contextMenu);
    return;
  }

  appTray = new Tray(trayIconPath);
  appTray.setContextMenu(contextMenu);
  appTray.on("click", () => {
    toggleVisiable();
  });
}

/**
 * @param {string | electron.Accelerator} key
 * @param {string} message
 */
function setKeyMapping(key, message) {
  globalShortcut.register(key, () => {
    mainWindow.webContents.send("globalShortcut", message);
  });
}

function enableGlobalShortcuts() {
  // initial global shortcuts
  for (const [key, value] of Object.entries(globalShortcutMapping)) {
    setKeyMapping(key, value);
  }
}

function disableGlobalShortcuts() {
  globalShortcut.unregisterAll();
}
/**
 * @param {string} cssStyle
 */
async function updateFloatingWindow(cssStyle) {
  if (cssStyle === undefined) {
    return;
  }
  try {
    const newCssKey = await floatingWindow.webContents.insertCSS(cssStyle, {
      cssOrigin: "author",
    });
    if (floatingWindowCssKey !== undefined) {
      await floatingWindow.webContents.removeInsertedCSS(floatingWindowCssKey);
    }
    floatingWindowCssKey = newCssKey;
  } catch (err) {
    console.log(err);
  }
}
/**
 * @param {electron.Config} params
 */
async function updateProxyConfig(params) {
  proxyConfig = params;

  await mainWindow.webContents.session.setProxy(params);
  await mainWindow.webContents.session.forceReloadProxyConfig();
}
/**
 * @param {string} cssStyle
 */
function createFloatingWindow(cssStyle) {
  const display = screen.getPrimaryDisplay();
  if (process.platform === "linux") {
    // fix transparent window not working in linux bug
    floatingWindow?.destroy();
    floatingWindow = null;
  }
  if (!floatingWindow) {
    /** @type {Electron.Rectangle} */
    const winBounds = store.get("floatingWindowBounds");

    floatingWindow = new BrowserWindow({
      width: 1000,
      minWidth: 640,
      maxWidth: 1920,
      height: 70,
      titleBarStyle: "hidden",
      transparent: true,
      frame: false,
      resizable: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: {
        sandbox: true,
        preload: join(__dirname, "preload.js"),
      },
      ...winBounds,
    });

    if (winBounds === undefined) {
      floatingWindow.setPosition(
        floatingWindow.getPosition()[0],
        display.bounds.height - 150
      );
    }
    floatingWindow.setVisibleOnAllWorkspaces(true);
    floatingWindow.setSkipTaskbar(true);
    floatingWindow.loadURL(`file://${__dirname}/floatingWindow.html`);
    floatingWindow.setAlwaysOnTop(true, "floating");
    floatingWindow.setIgnoreMouseEvents(false);
    // NOTICE: setResizable should be set, otherwise mouseleave event won't trigger in windows environment
    floatingWindow.webContents.on("did-finish-load", async () => {
      await updateFloatingWindow(cssStyle);
    });
    floatingWindow.on("closed", () => {
      floatingWindow = null;
    });

    // floatingWindow.webContents.openDevTools();
  }
  floatingWindow.showInactive();
}

const previousButton = {
  tooltip: "Previous",
  icon: join(__dirname, "/resources/prev-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "left");
  },
};
const nextButton = {
  tooltip: "Next",
  icon: join(__dirname, "/resources/next-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "right");
  },
};
const playButton = {
  tooltip: "Play",
  icon: join(__dirname, "/resources/play-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const pauseButton = {
  tooltip: "Pause",
  icon: join(__dirname, "/resources/pause-song.png"),
  click() {
    mainWindow.webContents.send("globalShortcut", "space");
  },
};
const setThumbarPause = () => {
  mainWindow?.setThumbarButtons([previousButton, playButton, nextButton]);
};
const setThumbbarPlay = () => {
  mainWindow?.setThumbarButtons([previousButton, pauseButton, nextButton]);
};

function createWindow() {
  const filter = {
    urls: ["http://*/*", "https://*/*"],
  };

  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      hack_referer_header(details);
      if (
        details.resourceType === "media" ||
        /\.(mp3|m4a|aac|flac|ogg|wav|webm)(?:\?|$)/i.test(details.url) ||
        details.url.includes("bilivideo")
      ) {
        rememberMediaRequest(details.url, details.requestHeaders);
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );
  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: Math.max(windowState.width, 1200),
    height: Math.max(windowState.height, 800),
    minHeight: 800,
    minWidth: 1200,
    webPreferences: {
      nodeIntegration: true,
      enableRemoteModule: true,
      contextIsolation: false,
    },
    icon: iconPath,
    titleBarStyle: "hiddenInset",
    transparent: transparent,
    vibrancy: "light",
    frame: false,
    hasShadow: true,
  });

  mainWindow.on("ready-to-show", () => {
    if (windowState.maximized) {
      mainWindow.maximize();
    }
    mainWindow.webContents.send("setZoomLevel", windowState.zoomLevel);
  });

  mainWindow.on("resized", () => {
    if (!mainWindow.isMaximized() && !mainWindow.isFullScreen()) {
      const [width, height] = mainWindow.getSize();
      windowState.width = width;
      windowState.height = height;
    }
  });
  mainWindow.on("close", (e) => {
    if (willQuitApp) {
      /* the user tried to quit the app */
      mainWindow = null;
    } else {
      /* the user only tried to close the window */
      //if (process.platform != 'linux') {
      e.preventDefault();
      mainWindow.hide();
      //mainWindow.minimize();
      //}
    }
  });

  // and load the index.html of the app.
  const ua =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.119 Safari/537.36";

  mainWindow.webContents.session.setProxy(proxyConfig).then(() => {
    mainWindow.loadURL(
      `file://${__dirname}/listen1_chrome_extension/listen1.html`,
      { userAgent: ua }
    );
  });

  // 让「播放缓存兜底」生效：页面加载完成后挂上 CDP 媒体监听。
  // 与 DevTools 互斥（同一个 target），所以开 F12 时先摘掉、关掉再挂回来。
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow) attachMediaRecorder(mainWindow.webContents);
  });
  mainWindow.webContents.on("devtools-opened", () => {
    try {
      if (mainWindow && mainWindow.webContents.debugger.isAttached()) {
        mainWindow.webContents.debugger.detach();
      }
    } catch (error) {
      console.log("detach media recorder failed:", error);
    }
  });
  mainWindow.webContents.on("devtools-closed", () => {
    if (mainWindow) attachMediaRecorder(mainWindow.webContents);
  });

  setThumbarPause();
  // Emitted when the window is closed.
  mainWindow.on("closed", () => {
    // Dereference the window object, usually you would store windows
    // in an array if your app supports multi windows, this is the time
    // when you should delete the corresponding element.
    mainWindow = null;
  });

  // define global menu content, also add support for cmd+c and cmd+v shortcuts
  const template = [
    {
      label: "Application",
      submenu: [
        {
          label: "Zoom Out",
          accelerator: "CmdOrCtrl+=",
          click() {
            if (windowState.zoomLevel <= 2.5) {
              windowState.zoomLevel += 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Zoom in",
          accelerator: "CmdOrCtrl+-",
          click() {
            if (windowState.zoomLevel >= -1) {
              windowState.zoomLevel -= 0.5;
              mainWindow.webContents.send(
                "setZoomLevel",
                windowState.zoomLevel
              );
            }
          },
        },
        {
          label: "Toggle Developer Tools",
          accelerator: "F12",
          click() {
            mainWindow.webContents.toggleDevTools();
          },
        },
        {
          label: "About Application",
          selector: "orderFrontStandardAboutPanel:",
        },
        { type: "separator" },
        {
          label: "Close Window",
          accelerator: "CmdOrCtrl+W",
          click() {
            mainWindow.close();
          },
        },
        {
          label: "Quit",
          accelerator: "Command+Q",
          click() {
            app.quit();
          },
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
        { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
        { type: "separator" },
        { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
        { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
        { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
        {
          label: "Select All",
          accelerator: "CmdOrCtrl+A",
          selector: "selectAll:",
        },
      ],
    },
  ];

  mainWindow.setMenu(null);

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));

  initialTray(mainWindow);
}

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 14_3 like Mac OS X) AppleWebKit/534.30 (KHTML, like Gecko) Version/4.0 Mobile Safari/534.30";

/**
 * @param {electron.OnBeforeSendHeadersListenerDetails} details
 */
function hack_referer_header(details) {
  let replace_referer = true;
  let replace_origin = true;
  let add_referer = true;
  let add_origin = true;
  let referer_value = "";
  let origin_value = "";
  let ua_value = "";

  if (details.url.includes("://music.163.com/")) {
    referer_value = "http://music.163.com/";
  }
  if (details.url.includes("://interface3.music.163.com/")) {
    referer_value = "http://music.163.com/";
  }

  if (details.url.includes(".xiami.com/")) {
    add_origin = false;
    referer_value = "https://www.xiami.com/";
  }
  if (details.url.includes("www.xiami.com/api/search/searchSongs")) {
    const key = /key%22:%22(.*?)%22/.exec(details.url)[1];
    add_origin = false;
    referer_value = `https://www.xiami.com/search?key=${key}`;
  }
  if (details.url.includes("c.y.qq.com/")) {
    referer_value = "https://y.qq.com/";
    origin_value = "https://y.qq.com";
  }
  if (
    details.url.includes("y.qq.com/") ||
    details.url.includes("qqmusic.qq.com/") ||
    details.url.includes("music.qq.com/") ||
    details.url.includes("imgcache.qq.com/")
  ) {
    referer_value = "http://y.qq.com/";
  }
  if (details.url.includes(".kugou.com/")) {
    referer_value = "https://www.kugou.com/";
    ua_value = MOBILE_UA;
  }
  if (details.url.includes("m.kugou.com/")) {
    ua_value = MOBILE_UA;
  }
  if (details.url.includes(".kuwo.cn/")) {
    referer_value = "http://www.kuwo.cn/";
  }
  if (
    details.url.includes(".bilibili.com/") ||
    details.url.includes(".bilivideo.com/")
  ) {
    referer_value = "https://www.bilibili.com/";
    replace_origin = false;
    add_origin = false;
  }
  if (details.url.includes('.bilivideo.cn')) {
    referer_value = 'https://www.bilibili.com/';
    origin_value = 'https://www.bilibili.com/';
    add_referer = true;
    add_origin = true;
  }
  if (details.url.includes(".migu.cn")) {
    referer_value = "http://music.migu.cn/v3/music/player/audio?from=migu";
  }
  if (details.url.includes("m.music.migu.cn")) {
    referer_value = "https://m.music.migu.cn/";
  }
  if (origin_value == "") {
    origin_value = referer_value;
  }
  let isRefererSet = false;
  let isOriginSet = false;
  let isUASet = false;
  let headers = details.requestHeaders;

  for (let i = 0, l = headers.length; i < l; ++i) {
    if (
      replace_referer &&
      headers[i].name == "Referer" &&
      referer_value != ""
    ) {
      headers[i].value = referer_value;
      isRefererSet = true;
    }
    if (replace_origin && headers[i].name == "Origin" && referer_value != "") {
      headers[i].value = origin_value;
      isOriginSet = true;
    }
    if (headers[i].name === "User-Agent" && ua_value !== "") {
      headers[i].value = ua_value;
      isUASet = true;
    }
  }

  if (add_referer && !isRefererSet && referer_value != "") {
    headers["Referer"] = referer_value;
  }

  if (add_origin && !isOriginSet && referer_value != "") {
    headers["Origin"] = origin_value;
  }

  if (!isUASet && ua_value !== "") {
    headers["User-Agent"] = ua_value;
  }

  details.requestHeaders = headers;
}

ipcMain.on("currentLyric", (event, arg) => {
  if (floatingWindow && floatingWindow !== null) {
    if (typeof arg === "string") {
      floatingWindow.webContents.send("currentLyric", arg);
      floatingWindow.webContents.send("currentLyricTrans", "");
    } else {
      floatingWindow.webContents.send("currentLyric", arg.lyric);
      floatingWindow.webContents.send("currentLyricTrans", arg.tlyric);
    }
  }
});

ipcMain.on("trackPlayingNow", (event, track) => {
  trayTrack = track;
  if (mainWindow != null) {
    initialTray(mainWindow, track);
  }
});

ipcMain.on("isPlaying", (event, isPlaying) => {
  isPlaying ? setThumbbarPlay() : setThumbarPause();
});

ipcMain.on("control", async (event, arg, params) => {
  switch (arg) {
    case "enable_global_shortcut":
      enableGlobalShortcuts();
      break;

    case "disable_global_shortcut":
      disableGlobalShortcuts();
      break;

    case "enable_lyric_floating_window":
      createFloatingWindow(params);
      break;

    case "disable_lyric_floating_window":
      floatingWindow?.hide();
      break;

    case "window_min":
      mainWindow.minimize();
      break;

    case "window_max":
      windowState.maximized ? mainWindow.unmaximize() : mainWindow.maximize();
      windowState.maximized = !windowState.maximized;
      break;

    case "window_close":
      mainWindow.close();
      break;

    case "float_window_accept_mouse_event":
      floatingWindow.setIgnoreMouseEvents(false);
      break;

    case "float_window_ignore_mouse_event":
      floatingWindow.setIgnoreMouseEvents(true, { forward: true });
      break;

    case "float_window_close":
    case "float_window_font_small":
    case "float_window_font_large":
    case "float_window_background_light":
    case "float_window_background_dark":
    case "float_window_font_change_color":
      mainWindow.webContents.send("lyricWindow", arg);
      break;

    case "update_lyric_floating_window_css":
      await updateFloatingWindow(params);
      break;

    case "get_proxy_config":
      mainWindow.webContents.send("proxyConfig", proxyConfig);
      break;

    case "update_proxy_config":
      await updateProxyConfig(params);
      break;

    default:
      break;
  }
  // event.sender.send('asynchronous-reply', 'pong')
});

ipcMain.on("openUrl", (event, arg, params) => {
  const bWindow = new BrowserWindow({
    parent: mainWindow,
    height: 700,
    resizable: true,
    width: 985,
    frame: true,
    fullscreen: false,
    maximizable: true,
    minimizable: true,
    autoHideMenuBar: true,
    webPreferences: {
      // sandbox is necessary for website js to work
      // thanks to https://github.com/sunzongzheng/music
      sandbox: true,
    },
  });
  bWindow.loadURL(arg);
  bWindow.setMenu(null);
});

ipcMain.on("floatWindowMoving", (e, { mouseX, mouseY }) => {
  const { x, y } = screen.getCursorScreenPoint();
  floatingWindow?.setPosition(x - mouseX, y - mouseY);
});

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      // When start a new instance, show the main window and active in taskbar.
      mainWindow.show();
      mainWindow.setSkipTaskbar(false);
    }
  });

  // Create myWindow, load the rest of the app, etc...
  app.on("ready", () => {
    createWindow();
    remoteMain.initialize();
    remoteMain.enable(mainWindow.webContents);
  });
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
  // On OS X it is common for applications and their menu bar
  // to stay active until the user quits explicitly with Cmd + Q
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/* 'activate' is emitted when the user clicks the Dock icon (OS X) */
app.on("activate", () => mainWindow.show());

/* 'before-quit' is emitted when Electron receives
 * the signal to exit and wants to start closing windows */
app.on("before-quit", () => {
  if (mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.closeDevTools();
  }
  if (floatingWindow) {
    store.set("floatingWindowBounds", floatingWindow.getBounds());
  }
  store.set("windowState", windowState);
  store.set("proxyConfig", proxyConfig);

  willQuitApp = true;
});

app.on("will-quit", () => {
  disableGlobalShortcuts();
});
