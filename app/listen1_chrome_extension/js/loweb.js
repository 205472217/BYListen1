/* global async LRUCache setPrototypeOfLocalStorage getLocalStorageValue i18next */
/* global netease xiami qq kugou kuwo bilibili migu taihe localmusic myplaylist */

const PROVIDERS = [
  {
    name: 'netease',
    instance: netease,
    searchable: true,
    support_login: true,
    id: 'ne',
  },
  {
    name: 'xiami',
    instance: xiami,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'xm',
  },
  {
    name: 'qq',
    instance: qq,
    searchable: true,
    support_login: true,
    id: 'qq',
  },
  {
    name: 'kugou',
    instance: kugou,
    searchable: true,
    support_login: false,
    id: 'kg',
  },
  {
    name: 'kuwo',
    instance: kuwo,
    searchable: true,
    support_login: false,
    id: 'kw',
  },
  {
    name: 'bilibili',
    instance: bilibili,
    searchable: true,
    support_login: false,
    id: 'bi',
  },
  {
    name: 'migu',
    instance: migu,
    searchable: true,
    support_login: true,
    id: 'mg',
  },
  {
    name: 'taihe',
    instance: taihe,
    searchable: true,
    support_login: false,
    id: 'th',
  },
  {
    name: 'localmusic',
    instance: localmusic,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'lm',
  },
  {
    name: 'myplaylist',
    instance: myplaylist,
    searchable: false,
    hidden: true,
    support_login: false,
    id: 'my',
  },
];

function getProviderByName(sourceName) {
  return (PROVIDERS.find((i) => i.name === sourceName) || {}).instance;
}

function getAllProviders() {
  return PROVIDERS.filter((i) => !i.hidden).map((i) => i.instance);
}

function getAllSearchProviders() {
  return PROVIDERS.filter((i) => i.searchable).map((i) => i.instance);
}

function getProviderNameByItemId(itemId) {
  const prefix = itemId.slice(0, 2);
  return (PROVIDERS.find((i) => i.id === prefix) || {}).name;
}

function getProviderByItemId(itemId) {
  const prefix = itemId.slice(0, 2);
  return (PROVIDERS.find((i) => i.id === prefix) || {}).instance;
}

// 搜索默认每页条数（与 InstantSearchController 的默认值保持一致）
const DEFAULT_SEARCH_PER_PAGE = 20;

/* cache for all playlist request except myplaylist and localmusic */
const playlistCache = new LRUCache({
  max: 100,
  maxAge: 60 * 60 * 1000, // 1 hour cache expire
});

/**
 * 歌单类请求的统一兜底。
 *
 * provider 同步抛错、返回非法结构、或者干脆永不回调时，也要把结果交回去，
 * 否则调用方的 success 回调永远不触发，界面就会永久停在加载态（"一直转圈"）。
 * 用 replied 标记保证只回调一次；超时后按"空结果 / 失败"返回。
 */
const PLAYLIST_REQUEST_TIMEOUT = 20000;

function guardPlaylistRequest(exec, timeoutResultFactory) {
  return {
    success: (fn) => {
      let replied = false;
      let timer = null;
      const reply = (result) => {
        if (replied) {
          return;
        }
        replied = true;
        if (timer !== null) {
          clearTimeout(timer);
        }
        fn(result);
      };
      timer = setTimeout(
        () => reply(timeoutResultFactory()),
        PLAYLIST_REQUEST_TIMEOUT
      );
      try {
        exec(reply);
      } catch (error) {
        reply(timeoutResultFactory());
      }
    },
  };
}

function queryStringify(options) {
  const query = JSON.parse(JSON.stringify(options));
  return new URLSearchParams(query).toString();
}

setPrototypeOfLocalStorage();

// eslint-disable-next-line no-unused-vars
const MediaService = {
  getLoginProviders() {
    return PROVIDERS.filter((i) => !i.hidden && i.support_login);
  },
  search(source, options) {
    const url = `/search?${queryStringify(options)}`;
    if (source === 'allmusic') {
      // search all platform and merge result
      const callbackArray = getAllSearchProviders().map((p) => (fn) => {
        // 任一平台返回非法结构 / 迟迟不回调，都不能拖垮整个聚合搜索
        // （否则 async.parallel 永不返回，页面会一直空白）
        let replied = false;
        const reply = (r) => {
          if (replied) {
            return;
          }
          replied = true;
          fn(
            null,
            r && Array.isArray(r.result)
              ? r
              : { result: [], total: 0, perPage: DEFAULT_SEARCH_PER_PAGE }
          );
        };
        try {
          p.search(url).success(reply);
        } catch (e) {
          reply(null);
          return;
        }
        setTimeout(() => reply(null), 15000);
      });
      return {
        success: (fn) =>
          async.parallel(callbackArray, (err, platformResultArray) => {
            // TODO: nicer pager, playlist support
            const platformResults = (platformResultArray || []).filter(Boolean);
            const perPageOf = (elem) =>
              Number(elem.perPage) > 0
                ? Number(elem.perPage)
                : DEFAULT_SEARCH_PER_PAGE;
            // 聚合页的每页条数 = 各平台每页条数之和（各平台结果交错拼接）
            const perPage = platformResults.reduce(
              (acc, elem) => acc + perPageOf(elem),
              0
            ) || DEFAULT_SEARCH_PER_PAGE;
            const result = {
              result: [],
              total: 0,
              perPage,
              totalpage: 1,
              type: platformResults[0] ? platformResults[0].type : 0,
            };
            const maxLength = Math.max(
              0,
              ...platformResults.map((elem) => elem.result.length)
            );
            for (let i = 0; i < maxLength; i += 1) {
              platformResults.forEach((elem) => {
                if (i < elem.result.length) {
                  result.result.push(elem.result[i]);
                }
              });
            }
            // 各平台都是按"第 n 页"取数，聚合结果最多能翻到
            // max(ceil(total / perPage)) 页；直接给出总页数，避免出现空白页
            const pageCounts = platformResults
              .filter((elem) => Number(elem.total) > 0)
              .map((elem) => Math.ceil(Number(elem.total) / perPageOf(elem)));
            const totalpage = pageCounts.length ? Math.max(...pageCounts) : 1;
            result.totalpage = totalpage;
            result.total = totalpage * perPage;
            return fn(result);
          }),
      };
    }
    const provider = getProviderByName(source);
    return provider.search(url);
  },

  showMyPlaylist() {
    return myplaylist.show_myplaylist('my');
  },

  // 备份/同步（本地文件与 WebDAV 共用）：歌单 + 设置类数据，
  // 不含网盘凭据、下载记录、本地音乐扫描结果、当前播放队列
  exportSyncPayload() {
    return myplaylist.export_sync_payload();
  },

  mergeSyncPayload(remote, options) {
    return myplaylist.merge_sync_payload(remote, options);
  },

  // 某个 localStorage key 是否参与同步（界面层判断写入是否值得回推）
  isSyncableKey(key) {
    return myplaylist.is_syncable_key(key);
  },

  showPlaylistArray(source, offset, filter_id) {
    const provider = getProviderByName(source);
    const url = `/show_playlist?${queryStringify({ offset, filter_id })}`;
    return guardPlaylistRequest(
      (reply) => provider.show_playlist(url).success(reply),
      () => ({ result: [] })
    );
  },

  getPlaylistFilters(source) {
    const provider = getProviderByName(source);
    return provider.get_playlist_filters();
  },

  getLyric(track_id, album_id, lyric_url, tlyric_url, options = {}) {
    const provider = getProviderByItemId(track_id);
    const query = {
      track_id,
      album_id,
      lyric_url,
      tlyric_url,
    };
    if (options.source_index !== undefined) {
      query.source_index = options.source_index;
    }
    if (options.refresh) {
      query.refresh = 1;
    }
    const url = `/lyric?${queryStringify(query)}`;
    return provider.lyric(url);
  },

  adjustLyricTime(track_id, source_index, offset_ms) {
    const provider = getProviderByItemId(track_id);
    return provider.adjust_lyric_time(track_id, source_index, offset_ms);
  },

  showFavPlaylist() {
    return myplaylist.show_myplaylist('favorite');
  },

  queryPlaylist(listId, type) {
    const result = myplaylist.myplaylist_containers(type, listId);
    return {
      success: (fn) => fn({ result }),
    };
  },

  getPlaylist(listId, useCache = true) {
    const provider = getProviderByItemId(listId);
    const url = `/playlist?list_id=${listId}`;
    let hit = null;
    if (useCache) {
      hit = playlistCache.get(listId);
    }

    if (hit) {
      return {
        success: (fn) => fn(hit),
      };
    }
    return guardPlaylistRequest(
      (reply) =>
        provider.get_playlist(url).success((playlist) => {
          // 只缓存成功的歌单；失败结果（status: '0'）不能进缓存，
          // 否则接下来 1 小时都会直接复现失败
          if (
            provider !== myplaylist &&
            provider !== localmusic &&
            playlist &&
            playlist.status !== '0' &&
            playlist.info
          ) {
            playlistCache.set(listId, playlist);
          }
          reply(playlist);
        }),
      () => ({ status: '0', reason: i18next.t('_PLAYLIST_LOAD_TIMEOUT') })
    );
  },

  clonePlaylist(id, type) {
    const provider = getProviderByItemId(id);
    const url = `/playlist?list_id=${id}`;
    return guardPlaylistRequest(
      (reply) =>
        provider.get_playlist(url).success((data) => {
          if (data && data.status !== '0' && data.info) {
            myplaylist.save_myplaylist(type, data);
          }
          reply();
        }),
      () => {}
    );
  },

  removeMyPlaylist(id, type) {
    myplaylist.remove_myplaylist(type, id);
    return {
      success: (fn) => fn(),
    };
  },

  addMyPlaylist(id, track) {
    const newPlaylist = myplaylist.add_track_to_myplaylist(id, track);
    return {
      success: (fn) => fn(newPlaylist),
    };
  },
  insertTrackToMyPlaylist(id, track, to_track, direction) {
    const newPlaylist = myplaylist.insert_track_to_myplaylist(
      id,
      track,
      to_track,
      direction
    );
    return {
      success: (fn) => fn(newPlaylist),
    };
  },
  addPlaylist(id, tracks) {
    const provider = getProviderByItemId(id);
    return provider.add_playlist(id, tracks);
  },

  removeTrackFromMyPlaylist(id, track) {
    myplaylist.remove_track_from_myplaylist(id, track);
    return {
      success: (fn) => fn(),
    };
  },

  removeTrackFromPlaylist(id, track) {
    const provider = getProviderByItemId(id);
    return provider.remove_from_playlist(id, track);
  },

  createMyPlaylist(title, track) {
    myplaylist.create_myplaylist(title, track);
    return {
      success: (fn) => {
        fn();
      },
    };
  },
  insertMyplaylistToMyplaylists(
    playlistType,
    playlistId,
    toPlaylistId,
    direction
  ) {
    const newPlaylists = myplaylist.insert_myplaylist_to_myplaylists(
      playlistType,
      playlistId,
      toPlaylistId,
      direction
    );
    return {
      success: (fn) => fn(newPlaylists),
    };
  },
  editMyPlaylist(id, title, coverImgUrl) {
    myplaylist.edit_myplaylist(id, title, coverImgUrl);
    return {
      success: (fn) => fn(),
    };
  },

  parseURL(url) {
    return {
      success: (fn) => {
        const providers = getAllProviders();
        Promise.all(
          providers.map(
            (provider) =>
              new Promise((res, rej) =>
                provider.parse_url(url).success((r) => {
                  if (r !== undefined) {
                    return rej(r);
                  }
                  return res(r);
                })
              )
          )
        )
          .then(() => fn({}))
          .catch((result) => fn({ result }));
      },
    };
  },

  mergePlaylist(source, target) {
    const tarData = localStorage.getObject(target).tracks;
    const srcData = localStorage.getObject(source).tracks;
    tarData.forEach((tarTrack) => {
      if (!srcData.find((srcTrack) => srcTrack.id === tarTrack.id)) {
        myplaylist.add_track_to_myplaylist(source, tarTrack);
      }
    });
    return {
      success: (fn) => fn(),
    };
  },

  bootstrapTrack(track, playerSuccessCallback, playerFailCallback) {
    const successCallback = playerSuccessCallback;
    const sound = {};
    function failureCallback(reason) {
      if (localStorage.getObject('enable_auto_choose_source') === false) {
        playerFailCallback(reason);
        return;
      }
      const trackPlatform = getProviderNameByItemId(track.id);
      const failover_source_list = getLocalStorageValue(
        'auto_choose_source_list',
        ['kuwo', 'qq', 'migu']
      ).filter((i) => i !== trackPlatform);

      const getUrlPromises = failover_source_list.map(
        (source) =>
          new Promise((resolve, reject) => {
            if (track.source === source) {
              // come from same source, no need to check
              resolve();
              return;
            }
            // TODO: better query method
            const keyword = `${track.title} ${track.artist}`;
            const curpage = 1;
            const url = `/search?keywords=${keyword}&curpage=${curpage}&type=0`;
            const provider = getProviderByName(source);
            provider.search(url).success((data) => {
              for (let i = 0; i < data.result.length; i += 1) {
                const searchTrack = data.result[i];
                // compare search track and track to check if they are same
                // TODO: better similar compare method (duration, md5)
                if (
                  !searchTrack.disable &&
                  searchTrack.title === track.title &&
                  searchTrack.artist === track.artist
                ) {
                  provider.bootstrap_track(
                    searchTrack,
                    (response) => {
                      sound.url = response.url;
                      sound.bitrate = response.bitrate;
                      sound.platform = response.platform;
                      reject(sound); // Use Reject to return immediately
                    },
                    resolve
                  );
                  return;
                }
              }
              resolve(sound);
            });
          })
      );
      // TODO: Use Promise.any() in ES2021 replace the tricky workaround
      Promise.all(getUrlPromises)
        // 无法切换到其他源时，把失败原因（例如"接口限流、结果未确定"）透传给调用方
        .then(() => playerFailCallback(reason))
        .catch((response) => {
          playerSuccessCallback(response);
        });
    }

    const provider = getProviderByName(track.source);

    provider.bootstrap_track(track, successCallback, failureCallback);
  },

  login(source, options) {
    const url = `/login?${queryStringify(options)}`;
    const provider = getProviderByName(source);

    return provider.login(url);
  },
  getUser(source) {
    const provider = getProviderByName(source);
    return provider.get_user();
  },
  getLoginUrl(source) {
    const provider = getProviderByName(source);
    return provider.get_login_url();
  },
  getUserCreatedPlaylist(source, options) {
    const provider = getProviderByName(source);
    const url = `/get_user_create_playlist?${queryStringify(options)}`;

    return provider.get_user_created_playlist(url);
  },
  getUserFavoritePlaylist(source, options) {
    const provider = getProviderByName(source);
    const url = `/get_user_favorite_playlist?${queryStringify(options)}`;

    return provider.get_user_favorite_playlist(url);
  },
  getRecommendPlaylist(source) {
    const provider = getProviderByName(source);

    return provider.get_recommend_playlist();
  },
  logout(source) {
    const provider = getProviderByName(source);

    return provider.logout();
  },
};

// eslint-disable-next-line no-unused-vars
const loWeb = MediaService;
