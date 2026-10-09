/* eslint-disable no-unused-vars */
/* global getParameterByName muteLocalStorageChange */
const myplaylistFactory = () => {
  function array_move(arr, old_index, new_index) {
    // https://stackoverflow.com/questions/5306680/move-an-array-element-from-one-array-position-to-another
    if (new_index >= arr.length) {
      let k = new_index - arr.length + 1;
      while (k > 0) {
        k -= 1;
        arr.push(undefined);
      }
    }
    arr.splice(new_index, 0, arr.splice(old_index, 1)[0]);
    return arr; // for testing
  }
  function getPlaylistObjectKey(playlist_type) {
    let key = '';
    if (playlist_type === 'my') {
      key = 'playerlists';
    } else if (playlist_type === 'favorite') {
      key = 'favoriteplayerlists';
    }
    return key;
  }
  function show_myplaylist(playlist_type) {
    return {
      success(fn) {
        const key = getPlaylistObjectKey(playlist_type);
        if (key === '') {
          return fn({ result: [] });
        }
        let playlists = localStorage.getObject(key);
        if (playlists == null) {
          playlists = [];
        }
        const result = playlists.reduce((res, id) => {
          const playlist = localStorage.getObject(id);
          if (playlist !== null && playlist.tracks !== undefined) {
            // clear url field when load old playlist
            playlist.tracks.forEach((e) => {
              delete e.url;
            });
          }
          res.push(playlist);
          return res;
        }, []);
        return fn({ result });
      },
    };
  }

  function get_myplaylist(url) {
    const list_id = getParameterByName('list_id', url);
    return {
      success(fn) {
        const playlist = localStorage.getObject(list_id);
        // clear url field when load old playlist
        if (playlist !== null && playlist.tracks !== undefined) {
          playlist.tracks.forEach((e) => {
            delete e.url;
            e.disabled = false;
          });
        }
        fn(playlist);
      },
    };
  }

  function guid() {
    function s4() {
      return Math.floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
    }
    return `${s4() + s4()}-${s4()}-${s4()}-${s4()}-${s4()}${s4()}${s4()}`;
  }

  function insert_myplaylist_to_myplaylists(
    playlist_type,
    playlist_id,
    to_playlist_id,
    direction
  ) {
    const key = getPlaylistObjectKey(playlist_type);
    if (key === '') {
      return [];
    }
    const playlists = localStorage.getObject(key);

    const index = playlists.findIndex((i) => i === playlist_id);
    let insertIndex = playlists.findIndex((i) => i === to_playlist_id);
    if (index === insertIndex) {
      return playlists;
    }
    if (insertIndex > index) {
      insertIndex -= 1;
    }
    const offset = direction === 'top' ? 0 : 1;

    array_move(playlists, index, insertIndex + offset);

    localStorage.setObject(key, playlists);
    return playlists;
  }

  const save_myplaylist = (playlist_type, playlistObj) => {
    const playlist = playlistObj;
    const key = getPlaylistObjectKey(playlist_type);
    if (key === '') {
      return;
    }
    let playlists = localStorage.getObject(key);
    if (playlists == null) {
      playlists = [];
    }
    // update listid
    let playlist_id = '';
    if (playlist_type === 'my') {
      playlist_id = `myplaylist_${guid()}`;
      playlist.info.id = playlist_id;
      playlist.is_mine = 1; // eslint-disable-line no-param-reassign
    } else if (playlist_type === 'favorite') {
      playlist_id = playlist.info.id;
      playlist.is_fav = 1;
      // remove all tracks info, cause favorite playlist always load latest
      delete playlist.tracks;
    }

    playlists.push(playlist_id);
    localStorage.setObject(key, playlists);
    // 云同步用：记录最后修改时间，冲突时取较新的一份
    playlist.updated_at = Date.now(); // eslint-disable-line no-param-reassign
    localStorage.setObject(playlist_id, playlist);
  };

  const remove_myplaylist = (playlist_type, playlist_id) => {
    const key = getPlaylistObjectKey(playlist_type);
    if (key === '') {
      return;
    }
    const playlists = localStorage.getObject(key);
    if (playlists == null) {
      return;
    }
    const newplaylists = playlists.filter((item) => item !== playlist_id);
    localStorage.removeItem(playlist_id);
    localStorage.setObject(key, newplaylists);
  };

  function add_track_to_myplaylist(playlist_id, track) {
    const playlist = localStorage.getObject(playlist_id);
    if (playlist == null) {
      return null;
    }
    // new track will always insert in beginning of playlist
    if (Array.isArray(track)) {
      playlist.tracks = track.concat(playlist.tracks);
    } else {
      playlist.tracks.unshift(track);
    }

    // dedupe
    const newTracks = [];
    const trackIds = [];

    playlist.tracks.forEach((tracki) => {
      if (trackIds.indexOf(tracki.id) === -1) {
        newTracks.push(tracki);
        trackIds.push(tracki.id);
      }
    });
    playlist.tracks = newTracks;

    playlist.updated_at = Date.now(); // eslint-disable-line no-param-reassign
    localStorage.setObject(playlist_id, playlist);
    return playlist;
  }

  function insert_track_to_myplaylist(playlist_id, track, to_track, direction) {
    const playlist = localStorage.getObject(playlist_id);
    if (playlist == null) {
      return null;
    }
    const index = playlist.tracks.findIndex((i) => i.id === track.id);
    let insertIndex = playlist.tracks.findIndex((i) => i.id === to_track.id);
    if (index === insertIndex) {
      return playlist;
    }
    if (insertIndex > index) {
      insertIndex -= 1;
    }
    const offset = direction === 'top' ? 0 : 1;
    array_move(playlist.tracks, index, insertIndex + offset);
    playlist.updated_at = Date.now(); // eslint-disable-line no-param-reassign
    localStorage.setObject(playlist_id, playlist);
    return playlist;
  }

  function remove_track_from_myplaylist(playlist_id, track_id) {
    const playlist = localStorage.getObject(playlist_id);
    if (playlist == null) {
      return;
    }
    const newtracks = playlist.tracks.filter((item) => item.id !== track_id);
    playlist.tracks = newtracks;
    playlist.updated_at = Date.now(); // eslint-disable-line no-param-reassign
    localStorage.setObject(playlist_id, playlist);
  }

  function create_myplaylist(playlist_title, track) {
    const playlist = {};

    const info = {
      cover_img_url: 'images/mycover.jpg',
      title: playlist_title,
      id: '',
      source_url: '',
    };

    playlist.is_mine = 1;
    playlist.info = info;

    if (Array.isArray(track)) {
      playlist.tracks = track;
    } else {
      playlist.tracks = [track];
    }

    // notice: create only used by my playlist, favorite created by clone interface
    save_myplaylist('my', playlist);
  }

  function edit_myplaylist(playlist_id, title, cover_img_url) {
    const playlist = localStorage.getObject(playlist_id);
    if (playlist == null) {
      return;
    }
    playlist.info.title = title;
    playlist.info.cover_img_url = cover_img_url;
    playlist.updated_at = Date.now(); // eslint-disable-line no-param-reassign
    localStorage.setObject(playlist_id, playlist);
  }

  function myplaylist_containers(playlist_type, list_id) {
    const key = getPlaylistObjectKey(playlist_type);
    if (key === '') {
      return false;
    }
    const playlist = localStorage.getObject(list_id);
    return playlist !== null && playlist.is_fav;
  }

  // ---------- 云同步：导出与合并 ----------
  // 同步范围 = 歌单 + 设置类数据；「换台机器就没意义」的设备本地数据不参与同步。
  //
  // 进同步：
  //   - 「我的歌单」「收藏歌单」两个索引数组 + 被索引引用的歌单对象（各带曲目）
  //   - 主题 / 语言 / 播放设置 / 快捷键 / 悬浮歌词 / 选源偏好 / 侧边栏等设置项
  // 不进同步（SYNC_LOCAL_ONLY_KEYS）：
  //   - webdav_config 与 githubOauthAccessKey / lastfmsession / lastfmtoken / gistid：
  //     网盘与历史遗留凭据
  //   - lmplaylist_downloaded：下载记录，曲目指向本机下载目录里的文件
  //   - lmplaylist_reserve：本地音乐扫描结果，曲目指向本机绝对路径
  //   - current-playing：当前播放队列，属于本机会话状态
  const SYNC_INDEX_KEYS = ['playerlists', 'favoriteplayerlists'];
  const SYNC_LOCAL_ONLY_KEYS = [
    'webdav_config',
    'githubOauthAccessKey',
    'lastfmsession',
    'lastfmtoken',
    'gistid',
    'lmplaylist_downloaded',
    'lmplaylist_reserve',
    'current-playing',
  ];
  const SYNC_PAYLOAD_VERSION = 2;

  const isPlaylistId = (id) => typeof id === 'string' && id.length > 0;

  // 歌单对象的形状判据：带 info 字段的普通对象（自建歌单与收藏歌单都是这个形状）。
  // 用来识别「孤儿歌单对象」——没被任何索引引用，同步过去也点不开。
  const isPlaylistObject = (value) =>
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.info !== undefined;

  const readLocalPlaylist = (id) => {
    if (!isPlaylistId(id)) {
      return undefined;
    }
    const playlist = localStorage.getObject(id);
    return playlist === null || playlist === undefined ? undefined : playlist;
  };

  // 索引里指向不存在对象的 id 会被丢掉，
  // 免得把「点开是空白」的幽灵记录同步给别的设备。
  const collectSyncItems = () => {
    const items = {};
    SYNC_INDEX_KEYS.forEach((key) => {
      const ids = localStorage.getObject(key);
      const keep = [];
      if (Array.isArray(ids)) {
        ids.forEach((id) => {
          // 索引里也可能引用到设备本地数据（例如本地音乐），一并拦住
          if (SYNC_LOCAL_ONLY_KEYS.indexOf(id) !== -1) {
            return;
          }
          const playlist = readLocalPlaylist(id);
          if (playlist === undefined) {
            return;
          }
          items[id] = playlist;
          keep.push(id);
        });
      }
      items[key] = keep;
    });
    // 其余 key 里，除设备本地数据外全部带走（主题/语言/播放设置…）
    Object.keys(localStorage).forEach((key) => {
      if (SYNC_LOCAL_ONLY_KEYS.indexOf(key) !== -1) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(items, key)) {
        return;
      }
      const value = localStorage.getObject(key);
      if (isPlaylistObject(value)) {
        return;
      }
      items[key] = value;
    });
    return items;
  };

  const export_sync_payload = () => ({
    version: SYNC_PAYLOAD_VERSION,
    exported_at: Date.now(),
    items: collectSyncItems(),
  });

  // 这个 key 是否参与同步。界面层用它判断「某次写入是否值得回推云端」。
  const is_syncable_key = (key) =>
    typeof key === 'string' &&
    key.length > 0 &&
    SYNC_LOCAL_ONLY_KEYS.indexOf(key) === -1;

  // 索引取并集：保留本机顺序，远端独有的按远端顺序追加。
  // 这样两台设备的歌单会真正「合到一起」，而不是互相覆盖。
  const unionIndex = (localIds, remoteIds) => {
    const result = [];
    const seen = {};
    const pushAll = (ids) => {
      if (!Array.isArray(ids)) {
        return;
      }
      ids.forEach((id) => {
        if (typeof id === 'string' && id.length > 0 && !seen[id]) {
          seen[id] = true;
          result.push(id);
        }
      });
    };
    pushAll(localIds);
    pushAll(remoteIds);
    return result;
  };

  const playlistTimestamp = (playlist) => {
    if (!playlist || typeof playlist !== 'object') {
      return 0;
    }
    const value = Number(playlist.updated_at);
    return Number.isFinite(value) ? value : 0;
  };

  // 同为 0（老数据没打时间戳）时保留本机，避免首次同步就大范围互写
  const pickNewerPlaylist = (localPlaylist, remotePlaylist) =>
    playlistTimestamp(remotePlaylist) > playlistTimestamp(localPlaylist)
      ? remotePlaylist
      : localPlaylist;

  // 远端载荷可能来自旧版本，也可能被人手改过，因此只接受：
  // 索引数组 + 被索引真正引用的歌单对象 + 非设备本地数据、非歌单形状的其它项。
  // 旧备份里的 theme / language 等设置现在属于同步范围，照常接受；
  // 但凭据、下载记录这类 key 无论远端怎么写都不落地。
  const filterIncoming = (remoteItems) => {
    const incoming = {};
    SYNC_INDEX_KEYS.forEach((key) => {
      const raw = remoteItems[key];
      const keep = [];
      if (Array.isArray(raw)) {
        raw.forEach((id) => {
          if (!isPlaylistId(id) || SYNC_LOCAL_ONLY_KEYS.indexOf(id) !== -1) {
            return;
          }
          const playlist = remoteItems[id];
          if (!isPlaylistObject(playlist)) {
            return;
          }
          incoming[id] = playlist;
          keep.push(id);
        });
      }
      incoming[key] = keep;
    });
    Object.keys(remoteItems).forEach((key) => {
      if (SYNC_LOCAL_ONLY_KEYS.indexOf(key) !== -1) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        return;
      }
      const value = remoteItems[key];
      // 没被任何索引引用的孤儿歌单对象不要
      if (isPlaylistObject(value)) {
        return;
      }
      incoming[key] = value;
    });
    return incoming;
  };

  // options.preferRemote = true（从云端同步）：设置项以云端为准，
  //   换台设备就是想要云端那份主题/语言/播放设置。
  // options.preferRemote = false（上传前的预合并）：设置项以本机为准，
  //   否则「同步到云端」会先把本机刚改的设置改回去，等于白改。
  // 歌单不受该开关影响：索引取并集、歌单对象按 updated_at 后写胜。
  const merge_sync_payload = (remote, options) => {
    const preferRemote = Boolean(options && options.preferRemote);
    const stats = {
      added: 0,
      updated: 0,
      kept: 0,
      playlist_changed: false,
      changed_settings: [],
    };
    if (!remote || typeof remote !== 'object' || !remote.items) {
      return stats;
    }
    const incoming = filterIncoming(remote.items);
    const localItems = collectSyncItems();

    // 合并本身会写大量 localStorage，mute 掉写入通知，避免刚同步完又触发回推
    muteLocalStorageChange(() => {
      Object.keys(incoming).forEach((key) => {
        const remoteValue = incoming[key];
        const localExists = Object.prototype.hasOwnProperty.call(localItems, key);
        const localValue = localExists ? localItems[key] : undefined;

        // 本机没有的 key：直接带过来
        if (!localExists) {
          localStorage.setObject(key, remoteValue);
          stats.added += 1;
          if (SYNC_INDEX_KEYS.indexOf(key) !== -1) {
            if (remoteValue.length > 0) {
              stats.playlist_changed = true;
            }
          } else if (isPlaylistObject(remoteValue)) {
            stats.playlist_changed = true;
          } else {
            stats.changed_settings.push(key);
          }
          return;
        }

        // 索引数组：取并集（保留本机顺序，远端独有项追加在后面）
        if (SYNC_INDEX_KEYS.indexOf(key) !== -1) {
          const merged = unionIndex(localValue, remoteValue);
          const localLength = Array.isArray(localValue) ? localValue.length : 0;
          if (merged.length !== localLength) {
            localStorage.setObject(key, merged);
            stats.updated += 1;
            stats.playlist_changed = true;
          } else {
            stats.kept += 1;
          }
          return;
        }

        // 歌单对象：按 updated_at 取较新的一方
        if (isPlaylistObject(remoteValue)) {
          if (pickNewerPlaylist(localValue, remoteValue) === remoteValue) {
            localStorage.setObject(key, remoteValue);
            stats.updated += 1;
            stats.playlist_changed = true;
          } else {
            stats.kept += 1;
          }
          return;
        }

        // 设置项
        if (!preferRemote) {
          stats.kept += 1;
          return;
        }
        if (JSON.stringify(localValue) !== JSON.stringify(remoteValue)) {
          localStorage.setObject(key, remoteValue);
          stats.updated += 1;
          stats.changed_settings.push(key);
        } else {
          stats.kept += 1;
        }
      });
    });

    return stats;
  };

  return {
    show_myplaylist,
    save_myplaylist,
    get_playlist: get_myplaylist,
    remove_myplaylist,
    add_track_to_myplaylist,
    remove_track_from_myplaylist,
    create_myplaylist,
    edit_myplaylist,
    myplaylist_containers,
    insert_track_to_myplaylist,
    insert_myplaylist_to_myplaylists,
    export_sync_payload,
    merge_sync_payload,
    is_syncable_key,
  };
};

const myplaylist = myplaylistFactory(); // eslint-disable-line no-unused-vars
