/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* global MediaService getLocalStorageValue */

/*
 * TrackAvailability
 * -----------------
 * 在后台对列表里的歌曲做"可播放性"预检。
 *
 * 原理：真实播放时会走 MediaService.bootstrapTrack 去解析出音频地址
 * （包含"自动切换源"的兜底逻辑），解析失败就会跳过该曲目。
 * 这里复用完全相同的解析流程，相当于把"进入播放"的第一步提前跑一遍：
 * - 解析出 url        => 可播放（保持白色）
 * - 明确解析不到      => disabled（灰色、不可点击）
 * - 结果不可判定      => 保持白色，稍后重试一次
 *
 * 注意：只有"明确失败"才置灰。接口限流、网络异常、超时这些情况属于
 * 不可判定，如果据此置灰，会把本来能播放的歌误判成灰色。
 *
 * 为避免一次性发起大量请求，内部带并发控制、同曲去重与结果缓存。
 */
{
  const STATUS = {
    CHECKING: 'checking',
    PLAYABLE: 'playable',
    UNPLAYABLE: 'unplayable',
    // 无法判定（接口限流、网络异常、超时）：不做任何标记，保持可播放外观
    UNKNOWN: 'unknown',
  };

  const CONCURRENCY = 4; // 同时进行的探测请求数
  // 单个探测超时（毫秒）。超时只会保持白色、不会误置灰，
  // 而失败曲目还要走一遍"自动切换源"（最多三个平台搜索）才可能判定成功，
  // 因此给足时间，宁可晚一点变灰，也不要漏判成可播放。
  const TIMEOUT = 20000;
  const CACHE_LIMIT = 5000; // 结果缓存上限
  const MAX_RETRY = 1; // "无法判定"的曲目最多重试次数
  const RETRY_DELAY = 4000; // 重试间隔，给接口限流留出冷却时间

  // key -> STATUS，仅缓存已确认的结果（playable / unplayable）
  const resolvedCache = new Map();
  // key -> [{ track, callback }]，正在等待结果的曲目
  const waiters = new Map();
  // 待执行的探测任务
  const queue = [];
  // key -> 已重试次数
  const retryCount = new Map();
  // 待重试的曲目（本轮判定为"无法判定"）
  const retryBucket = [];
  let retryTimer = null;
  let active = 0;

  function isLocalTrack(track) {
    return (
      !!track &&
      (track.platform === 'localmusic' || track.source === 'localmusic')
    );
  }

  function trackKey(track) {
    return `${track.source || track.platform || ''}::${track.id}`;
  }

  function isEnabled() {
    return getLocalStorageValue('enable_playable_precheck', true) !== false;
  }

  function cacheSet(key, status) {
    resolvedCache.set(key, status);
    if (resolvedCache.size > CACHE_LIMIT) {
      const oldest = resolvedCache.keys().next().value;
      resolvedCache.delete(oldest);
    }
  }

  function applyStatus(track, status, callback) {
    if (status === STATUS.CHECKING) {
      // checking 阶段不要改动 disabled，避免闪烁
      track.availability = status;
    } else {
      track.availability = status;
      // 只有明确判定为不可播放才置灰；unknown 会清除之前的灰色标记
      track.disabled = status === STATUS.UNPLAYABLE;
    }
    if (typeof callback === 'function') {
      callback(track, status);
    }
  }

  function pump() {
    while (active < CONCURRENCY && queue.length > 0) {
      const job = queue.shift();
      active += 1;
      resolveTrack(job);
    }
  }

  function finishJob(key, status, cache) {
    active -= 1;
    if (cache) {
      cacheSet(key, status);
    } else if (status !== STATUS.UNKNOWN) {
      // 已确认的结果覆盖历史重试计数
      retryCount.delete(key);
    }
    const list = waiters.get(key) || [];
    waiters.delete(key);
    list.forEach(({ track, callback }) => applyStatus(track, status, callback));

    // 结果不可判定（多半是接口被限流）时，稍后单独重试一次：
    // 能拿到确定结果就别让曲目一直悬着，确实无法播放的曲目也能最终置灰
    if (status === STATUS.UNKNOWN && list.length > 0) {
      const retried = retryCount.get(key) || 0;
      if (retried < MAX_RETRY) {
        retryCount.set(key, retried + 1);
        list.forEach(({ track }) => retryBucket.push(track));
        scheduleRetry();
      }
    }
    pump();
  }

  function scheduleRetry() {
    if (retryTimer !== null) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const tracks = retryBucket.splice(0, retryBucket.length);
      if (tracks.length > 0) {
        scan(tracks, null);
      }
    }, RETRY_DELAY);
  }

  function resolveTrack(job) {
    let settled = false;
    const finish = (status, cache) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      finishJob(job.key, status, cache);
    };
    // 超时视为"无法确认"，保持原样，避免误判为不可播放
    const timer = setTimeout(() => finish(STATUS.UNKNOWN, false), TIMEOUT);

    try {
      MediaService.bootstrapTrack(
        { ...job.track },
        (info) => {
          // 只有真正解析出播放地址才算可播放；
          // 拿不到地址（接口限流等）时结果不可判定，不能置灰
          const playable = !!(info && info.url);
          finish(playable ? STATUS.PLAYABLE : STATUS.UNKNOWN, playable);
        },
        (reason) => {
          // 提供方标记为"未确定"（限流 / 网络异常）时不置灰
          const unresolved = !!(reason && reason.unresolved);
          finish(unresolved ? STATUS.UNKNOWN : STATUS.UNPLAYABLE, !unresolved);
        }
      );
    } catch (err) {
      // 调用过程本身出错属于异常情况，不据此判定为不可播放
      finish(STATUS.UNKNOWN, false);
    }
  }

  /**
   * 对一批歌曲做预检
   * @param {Array} tracks 歌曲列表
   * @param {Function} [callback] 每条结果回调 (track, status)
   */
  function scan(tracks, callback) {
    if (!Array.isArray(tracks) || tracks.length === 0) return;
    if (!isEnabled()) return;

    tracks.forEach((track) => {
      if (!track || !track.id) return;

      if (isLocalTrack(track)) {
        applyStatus(track, STATUS.PLAYABLE, callback);
        return;
      }

      const key = trackKey(track);

      const cached = resolvedCache.get(key);
      if (cached) {
        applyStatus(track, cached, callback);
        return;
      }

      // 已经在探测中（同一列表内的重复曲目 / 另一次扫描）：挂到等待队列
      if (waiters.has(key)) {
        waiters.get(key).push({ track, callback });
        applyStatus(track, STATUS.CHECKING, callback);
        return;
      }

      waiters.set(key, [{ track, callback }]);
      applyStatus(track, STATUS.CHECKING, callback);
      queue.push({ key, track });
    });

    pump();
  }

  function setEnabled(enabled) {
    localStorage.setObject('enable_playable_precheck', !!enabled);
    if (!enabled) {
      queue.splice(0, queue.length);
      waiters.clear();
      retryBucket.splice(0, retryBucket.length);
      retryCount.clear();
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }
  }

  function clearCache() {
    resolvedCache.clear();
    retryCount.clear();
  }

  window.TrackAvailability = {
    STATUS,
    scan,
    setEnabled,
    isEnabled,
    clearCache,
  };
}
