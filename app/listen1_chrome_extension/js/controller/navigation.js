/* eslint-disable import/no-unresolved */
/* eslint-disable global-require */
/* eslint-disable no-shadow */
/* eslint-disable no-unused-vars */
/* eslint-disable no-param-reassign */
/* global angular notyf i18next MediaService l1Player hotkeys isElectron require WebdavClient onLocalStorageChange */
// control main view of page, it can be called any place
angular.module('listenone').controller('NavigationController', [
  '$scope',
  '$timeout',
  '$rootScope',
  ($scope, $timeout, $rootScope) => {
    $rootScope.page_title = { title: 'Listen 1', artist: '', status: '' }; // eslint-disable-line no-param-reassign
    $scope.window_url_stack = [];
    $scope.window_poped_url_stack = [];
    $scope.current_tag = 2;
    $scope.is_window_hidden = 1;
    $scope.is_dialog_hidden = 1;
    $scope.tag_params = {};

    $scope.songs = [];
    $scope.current_list_id = -1;

    $scope.dialog_song = '';
    $scope.dialog_type = 0;
    $scope.dialog_title = '';

    $scope.isDoubanLogin = false;

    $scope.isOpenSidebar = true;

    $scope.$on('isdoubanlogin:update', (event, data) => {
      $scope.isDoubanLogin = data;
    });

    // isOpenSidebar

    if (localStorage.getObject('openSidebar') !== null) {
      $scope.isOpenSidebar = localStorage.getObject('openSidebar');
    }
    $scope.openSidebar = () => {
      $scope.isOpenSidebar = !$scope.isOpenSidebar;
      localStorage.setObject('openSidebar', $scope.isOpenSidebar);
    };
    // tag
    $scope.showTag = (tag_id, tag_params) => {
      $scope.current_tag = tag_id;
      $scope.is_window_hidden = 1;
      $scope.window_url_stack = [];
      $scope.window_poped_url_stack = [];
      $scope.tag_params = tag_params;
      if (tag_id === 6) {
        $rootScope.$broadcast('myplatform:update', tag_params.user);
      }
      $scope.closeWindow();
    };

    $scope.$on('search:keyword_change', (event, data) => {
      $scope.showTag(3);
    });

    // refresh the local-music banner cover when a cover arrives late during playback
    $scope.$on('lmcover:updated', (event, img_url) => {
      if (!$scope.is_local || !img_url) {
        return;
      }
      if ($scope.cover_img_url !== img_url) {
        $scope.$evalAsync(() => {
          $scope.cover_img_url = img_url;
        });
      }
    });

    // 可播放性预检开关变化时，重新检测当前歌单
    $scope.$on('playable_precheck:changed', (event, enabled) => {
      if (!window.TrackAvailability || !$scope.songs) {
        return;
      }
      if (enabled) {
        applyPlayablePrecheck($scope.songs);
      } else {
        $scope.songs.forEach((song) => {
          song.disabled = false;
          song.availability = undefined;
        });
      }
    });

    // playlist window
    $scope.resetWindow = (offset) => {
      if (offset === undefined) {
        offset = 0;
      }
      $scope.cover_img_url = 'images/loading.svg';
      $scope.playlist_title = '';
      $scope.playlist_source_url = '';
      $scope.songs = [];
      $scope.window_type = 'list';
      $timeout(() => {
        document.getElementsByClassName('browser')[0].scrollTop = offset;
      }, 0);
    };

    $scope.closeWindow = (offset) => {
      if (offset === undefined) {
        offset = 0;
      }
      $scope.is_window_hidden = 1;
      $scope.resetWindow(offset);
      $scope.window_url_stack = [];
      $scope.window_poped_url_stack = [];
    };

    function applyPlayablePrecheck(tracks) {
      if (!window.TrackAvailability) {
        return;
      }
      window.TrackAvailability.scan(tracks, () => {
        $scope.$evalAsync();
      });
    }

    function refreshWindow(url, offset = 0) {
      if (url === '/now_playing') {
        $scope.window_type = 'track';
        return;
      }
      $scope.clearSort();
      const listId = new URL(url, window.location).searchParams.get('list_id');
      MediaService.getPlaylist(listId).success((data) => {
        if (!data || data.status === '0' || !data.info) {
          notyf.info((data && data.reason) || '歌单加载失败，请稍后重试');
          return;
        }
        $scope.songs = data.tracks;
        applyPlayablePrecheck($scope.songs);
        $scope.list_id = data.info.id;
        $scope.cover_img_url = data.info.cover_img_url;
        $scope.playlist_title = data.info.title;
        $scope.playlist_source_url = data.info.source_url;
        $scope.is_mine = data.info.id.slice(0, 2) === 'my';
        $scope.is_local = data.info.id.slice(0, 2) === 'lm';
        $timeout(() => {
          document.getElementsByClassName('browser')[0].scrollTop = offset;
        }, 0);
      });
    }
    $scope.popWindow = () => {
      if ($scope.window_url_stack.length === 0) {
        return;
      }
      let poped = $scope.window_url_stack.pop();
      if ($scope.getCurrentUrl() === '/now_playing') {
        poped = $scope.window_url_stack.pop();
      }
      $scope.window_poped_url_stack.push(poped.url);
      if ($scope.window_url_stack.length === 0) {
        $scope.closeWindow(poped.offset);
      } else {
        $scope.resetWindow(poped.offset);
        const lastWindow = $scope.window_url_stack.slice(-1)[0];
        refreshWindow(lastWindow.url, poped.offset);
      }
    };

    $scope.toggleNowPlaying = () => {
      if ($scope.getCurrentUrl() === '/now_playing') {
        $scope.popWindow();
        return;
      }
      if (!$scope.menuHidden) {
        $scope.togglePlaylist();
      }
      // save current scrolltop
      $scope.is_window_hidden = 0;
      $scope.resetWindow();

      $scope.window_url_stack.push({
        url: '/now_playing',
        offset: document.getElementsByClassName('browser')[0].scrollTop,
      });
      $scope.window_poped_url_stack = [];

      $scope.window_type = 'track';
    };

    $scope.forwardWindow = () => {
      if ($scope.window_poped_url_stack.length === 0) {
        return;
      }

      $scope.resetWindow();
      const url = $scope.window_poped_url_stack.pop();
      $scope.window_url_stack.push({
        url,
        offset: 0,
      });
      refreshWindow(url);
    };

    $scope.getCurrentUrl = () =>
      ($scope.window_url_stack.slice(-1)[0] || {}).url;

    $scope.showPlaylist = (list_id, useCache) => {
      $scope.clearFilter();
      $scope.clearSort();
      const url = `/playlist?list_id=${list_id}`;
      // save current scrolltop
      const offset = document.getElementsByClassName('browser')[0].scrollTop;
      if ($scope.getCurrentUrl() === url) {
        return;
      }
      $scope.is_window_hidden = 0;
      $scope.resetWindow();

      if ($scope.getCurrentUrl() === '/now_playing') {
        // if now playing is top, pop it
        $scope.window_url_stack.pop();
      }
      $scope.window_url_stack.push({ url, offset });
      $scope.window_poped_url_stack = [];

      const listId = new URL(url, window.location).searchParams.get('list_id');
      MediaService.getPlaylist(listId, useCache).success((data) => {
        if (!data || data.status === '0' || !data.info) {
          notyf.info((data && data.reason) || '歌单加载失败，请稍后重试');
          $scope.popWindow();
          return;
        }
        $scope.songs = data.tracks;
        applyPlayablePrecheck($scope.songs);
        $scope.cover_img_url = data.info.cover_img_url;
        $scope.playlist_title = data.info.title;
        $scope.playlist_source_url = data.info.source_url;
        $scope.list_id = data.info.id;
        $scope.is_mine = data.info.id.slice(0, 2) === 'my';
        $scope.is_local = data.info.id.slice(0, 2) === 'lm';

        MediaService.queryPlaylist(data.info.id, 'favorite').success((res) => {
          // success 函数可能在异步回调中执行，需要手动触发脏检查
          $timeout(() => {
            $scope.is_favorite = res.result;
          }, 0);
        });

        $scope.window_type = 'list';
      });
    };

    $scope.directplaylist = (list_id) => {
      MediaService.getPlaylist(list_id).success((data) => {
        if (!data || data.status === '0' || !Array.isArray(data.tracks)) {
          notyf.info((data && data.reason) || '歌单加载失败，请稍后重试');
          return;
        }
        $scope.songs = data.tracks;
        $scope.current_list_id = list_id;
        l1Player.setNewPlaylist($scope.songs);
        l1Player.play();
      });
    };

    $scope.showDialog = (dialog_type, data) => {
      $scope.is_dialog_hidden = 0;
      $scope.dialog_data = data;
      const dialogWidth = 400;
      const dialogHeight = 430;
      const left = window.innerWidth / 2 - dialogWidth / 2;
      const top = window.innerHeight / 2 - dialogHeight / 2;

      $scope.myStyle = {
        left: `${left}px`,
        top: `${top}px`,
      };
      $scope.dialog_type = dialog_type;
      if (dialog_type === 0) {
        $scope.dialog_title = i18next.t('_ADD_TO_PLAYLIST');
        $scope.dialog_song = data;
        MediaService.showMyPlaylist().success((res) => {
          $scope.myplaylist = res.result;
        });
      }

      // if (dialog_type === 2) {
      //   $scope.dialog_title = '登录豆瓣';
      //   $scope.dialog_type = 2;
      // }

      if (dialog_type === 3) {
        $scope.dialog_title = i18next.t('_EDIT_PLAYLIST');
        $scope.dialog_cover_img_url = data.cover_img_url;
        $scope.dialog_playlist_title = data.playlist_title;
      }
      if (dialog_type === 5) {
        $scope.dialog_title = i18next.t('_OPEN_PLAYLIST');
      }
      if (dialog_type === 6) {
        $scope.dialog_title = i18next.t('_IMPORT_PLAYLIST');
        MediaService.showMyPlaylist().success((res) => {
          $scope.myplaylist = res.result;
        });
      }
      if (dialog_type === 11) {
        $scope.dialog_title = i18next.t('_LOGIN');
      }
      if (dialog_type === 12) {
        $scope.dialog_title = i18next.t('_PROXY_CONFIG');
      }
    };

    $scope.onSidebarPlaylistDrop = (
      playlistType,
      list_id,
      data,
      dataType,
      direction
    ) => {
      if (playlistType === 'my' && dataType === 'application/listen1-song') {
        $scope.addMyPlaylist(list_id, data);
      } else if (
        (playlistType === 'my' &&
          dataType === 'application/listen1-myplaylist') ||
        (playlistType === 'favorite' &&
          dataType === 'application/listen1-favoriteplaylist')
      ) {
        MediaService.insertMyplaylistToMyplaylists(
          playlistType,
          data.info.id,
          list_id,
          direction
        ).success(() => {
          if (playlistType === 'my') {
            $rootScope.$broadcast('myplaylist:update');
          }
          if (playlistType === 'favorite') {
            $rootScope.$broadcast('favoriteplaylist:update');
          }
        });
      }
    };
    $scope.playlistFilter = { key: '' };
    $scope.playlistSort = { key: '', reverse: false };

    $scope.clearFilter = () => {
      $scope.playlistFilter.key = '';
    };

    $scope.clearSort = () => {
      $scope.playlistSort.key = '';
      $scope.playlistSort.reverse = false;
    };

    // 循环切换：升序 -> 倒序 -> 恢复原序
    $scope.sortBy = (key) => {
      if ($scope.playlistSort.key !== key) {
        $scope.playlistSort.key = key;
        $scope.playlistSort.reverse = false;
      } else if (!$scope.playlistSort.reverse) {
        $scope.playlistSort.reverse = true;
      } else {
        $scope.clearSort();
      }
    };

    // 排序按钮文案，整段返回，避免在按钮内嵌套不同样式的标签
    $scope.sortLabel = (key, name) => {
      if ($scope.playlistSort.key !== key) {
        return name;
      }
      return $scope.playlistSort.reverse ? `${name}降序` : `${name}升序`;
    };

    const comparePlaylistSong = (a, b, key) =>
      String(a[key] || '').localeCompare(String(b[key] || ''), 'zh-Hans-CN', {
        numeric: true,
        sensitivity: 'base',
      });

    let playlistSongsCache = null;
    $scope.playlistSongs = () => {
      const songs = $scope.songs || [];
      const searchKey = $scope.playlistFilter.key;
      const sortKey = $scope.playlistSort.key;
      const reverse = $scope.playlistSort.reverse;

      if (sortKey === '') {
        playlistSongsCache = null;
        return songs.filter((song) => $scope.fieldFilter(song));
      }

      if (
        playlistSongsCache !== null &&
        playlistSongsCache.songs === songs &&
        playlistSongsCache.size === songs.length &&
        playlistSongsCache.searchKey === searchKey &&
        playlistSongsCache.sortKey === sortKey &&
        playlistSongsCache.reverse === reverse
      ) {
        return playlistSongsCache.list;
      }

      const list = songs
        .filter((song) => $scope.fieldFilter(song))
        .sort(
          (a, b) => (reverse ? -1 : 1) * comparePlaylistSong(a, b, sortKey)
        );
      playlistSongsCache = {
        songs,
        size: songs.length,
        searchKey,
        sortKey,
        reverse,
        list,
      };
      return list;
    };
    $scope.fieldFilter = (song) => {
      const key = $scope.playlistFilter.key;
      if (key === '') {
        return true;
      }
      return Boolean(
        (song.title && song.title.includes(key)) ||
          (song.artist && song.artist.includes(key)) ||
          (song.album && song.album.includes(key))
      );
    };
    $scope.onPlaylistSongDrop = (list_id, song, data, dataType, direction) => {
      if (dataType === 'application/listen1-song') {
        // insert song
        MediaService.insertTrackToMyPlaylist(
          list_id,
          data,
          song,
          direction
        ).success((playlist) => {
          $scope.closeDialog();
          if (list_id === $scope.list_id) {
            $scope.$evalAsync(() => {
              $scope.songs = playlist.tracks;
            });
          }
        });
      }
    };

    $scope.onCurrentPlayingSongDrop = (song, data, dataType, direction) => {
      if (dataType === 'application/listen1-song') {
        l1Player.insertTrack(data, song, direction);
      }
    };

    $scope.playById = (id) => {
      l1Player.playById(id);
    };

    $scope.addAndPlay = (song) => {
      // 预检判定为不可播放的曲目不允许点击播放
      if (song && song.disabled) {
        $scope.copyrightNotice();
        return;
      }
      l1Player.addTrack(song);
      l1Player.playById(song.id);
    };

    $scope.addMyPlaylist = (option_id, song) => {
      MediaService.addMyPlaylist(option_id, song).success((playlist) => {
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
        // add to current playing list
        if (option_id === $scope.current_list_id) {
          l1Player.addTrack($scope.dialog_song);
        }
        if (option_id === $scope.list_id) {
          $scope.songs = playlist.tracks;
        }
      });
    };

    $scope.chooseDialogOption = (option_id) => {
      $scope.addMyPlaylist(option_id, $scope.dialog_song);
    };

    $scope.newDialogOption = (option) => {
      $scope.dialog_type = option;
    };

    $scope.cancelNewDialog = (option) => {
      $scope.dialog_type = option;
    };

    $scope.createAndAddPlaylist = () => {
      MediaService.createMyPlaylist(
        $scope.newlist_title,
        $scope.dialog_song
      ).success(() => {
        $rootScope.$broadcast('myplaylist:update');
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
      });
    };

    $scope.editMyPlaylist = () => {
      MediaService.editMyPlaylist(
        $scope.list_id,
        $scope.dialog_playlist_title,
        $scope.dialog_cover_img_url
      ).success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.playlist_title = $scope.dialog_playlist_title;
        $scope.cover_img_url = $scope.dialog_cover_img_url;
        notyf.success(i18next.t('_EDIT_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
      });
    };

    $scope.mergePlaylist = (target_list_id) => {
      notyf.info(i18next.t('_IMPORTING_PLAYLIST'));
      MediaService.mergePlaylist($scope.list_id, target_list_id).success(() => {
        notyf.success(i18next.t('_IMPORTING_PLAYLIST_SUCCESS'));
        $scope.closeDialog();
        $scope.popWindow();
        $scope.showPlaylist($scope.list_id);
      });
    };

    $scope.removeSongFromPlaylist = (song, list_id) => {
      let removeFunc = null;
      if (list_id.slice(0, 2) === 'my') {
        removeFunc = MediaService.removeTrackFromMyPlaylist;
      } else if (list_id.slice(0, 2) === 'lm') {
        removeFunc = MediaService.removeTrackFromPlaylist;
      }

      removeFunc(list_id, song.id).success(() => {
        // remove song from songs
        const index = $scope.songs.indexOf(song);
        if (index > -1) {
          $scope.songs.splice(index, 1);
        }
        notyf.success(i18next.t('_REMOVE_SONG_FROM_PLAYLIST_SUCCESS'));
      });
    };

    $scope.closeDialog = () => {
      $scope.is_dialog_hidden = 1;
      $scope.dialog_type = 0;
    };

    $scope.setCurrentList = (list_id) => {
      $scope.current_list_id = list_id;
    };

    $scope.playMylist = (list_id) => {
      l1Player.setNewPlaylist($scope.songs);
      l1Player.play();
      $scope.setCurrentList(list_id);
    };

    $scope.addMylist = (list_id) => {
      $timeout(() => {
        // add songs to playlist
        l1Player.addTracks($scope.songs);
        notyf.success(i18next.t('_ADD_TO_QUEUE_SUCCESS'));
      }, 0);
    };

    $scope.clonePlaylist = (list_id) => {
      MediaService.clonePlaylist(list_id, 'my').success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.closeWindow();
        notyf.success(i18next.t('_ADD_TO_PLAYLIST_SUCCESS'));
      });
    };

    $scope.removeMyPlaylist = (list_id) => {
      MediaService.removeMyPlaylist(list_id, 'my').success(() => {
        $rootScope.$broadcast('myplaylist:update');
        $scope.closeDialog();
        $scope.closeWindow();
        notyf.success(i18next.t('_REMOVE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.downloadFile = (fileName, fileType, content) => {
      window.URL = window.URL || window.webkitURL;
      const blob = new Blob([content], {
        type: fileType,
      });
      const link = document.createElement('a');
      link.download = fileName;
      link.href = window.URL.createObjectURL(blob);
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    // 本地文件备份与恢复：与 WebDAV 用同一份载荷。
    // 内容 = 歌单 + 主题/语言/播放设置等设置项；
    // 网盘凭据、下载记录、本地音乐扫描结果、当前播放队列不写入文件。
    $scope.backupMySettings = () => {
      const content = JSON.stringify(MediaService.exportSyncPayload());
      $scope.downloadFile('listen1_backup.json', 'application/json', content);
    };

    $scope.importMySettings = (event) => {
      const fileObject = event.target.files[0];
      if (fileObject === null) {
        notyf.warning('请选择备份文件');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = (readerEvent) => {
        if (readerEvent.target.readyState !== FileReader.DONE) {
          return;
        }
        const data_json = readerEvent.target.result;
        // parse json
        let data = null;
        try {
          data = JSON.parse(data_json);
        } catch (e) {
          notyf.warning('备份文件格式错误，请重新选择');
          return;
        }

        // 兼容两种格式：新版 {version, items} 与早期的扁平 {key: value}。
        // 恢复是用户主动动作，设置项以文件为准；歌单仍走合并（不覆盖本机已有歌单）。
        const payload =
          data && typeof data === 'object' && data.items
            ? data
            : { version: 1, items: data };
        applyWebdavMergeResult(
          MediaService.mergeSyncPayload(payload, { preferRemote: true })
        );
        notyf.success(i18next.t('_IMPORTING_PLAYLIST_SUCCESS'));
      };
      reader.readAsText(fileObject);
    };

    // ---------- 云同步（WebDAV） ----------
    // 采用「双向合并」语义：无论点哪个方向，都先把云端与本机按 key 合并，
    // 再把结果写回目标一侧，因此两台设备都不会因为覆盖而丢歌单。
    const WEBDAV_PUSH_DELAY = 5000;
    let webdavPushTimer = null;
    let webdavSyncing = false;
    let webdavLastHash = null;

    $scope.webdav = WebdavClient.getConfig();
    $scope.webdavDefaultUrl = WebdavClient.getDefaultUrl();
    $scope.webdavConnected = false;
    $scope.webdavBusy = false;
    $scope.webdavLastSyncAt = WebdavClient.getLastSyncAt();

    const refreshWebdavStatus = () => {
      if (!WebdavClient.hasConfig()) {
        $scope.webdavStatusText = i18next.t('_WEBDAV_NOT_CONFIGURED');
        return;
      }
      if ($scope.webdavConnected) {
        const at = $scope.webdavLastSyncAt
          ? new Date($scope.webdavLastSyncAt).toLocaleString()
          : '';
        $scope.webdavStatusText = at
          ? `${i18next.t('_WEBDAV_CONNECTED')}（${i18next.t(
              '_WEBDAV_LAST_SYNC'
            )} ${at}）`
          : i18next.t('_WEBDAV_CONNECTED');
      } else {
        $scope.webdavStatusText = i18next.t('_WEBDAV_DISCONNECTED');
      }
    };

    const webdavPayloadHash = (payload) => {
      const json = JSON.stringify(payload);
      let hash = 0;
      for (let i = 0; i < json.length; i += 1) {
        hash = (hash * 31 + json.charCodeAt(i)) | 0;
      }
      return hash;
    };

    // 合并结果的落地：只有真正变了的类别才广播，避免无谓的重绘与回推。
    const applyWebdavMergeResult = (result) => {
      if (!result) {
        return;
      }
      if (result.playlist_changed) {
        $rootScope.$broadcast('myplaylist:update');
        $rootScope.$broadcast('favoriteplaylist:update');
      }
      if (
        Array.isArray(result.changed_settings) &&
        result.changed_settings.length > 0
      ) {
        $rootScope.$broadcast('settings:synced', result.changed_settings);
      }
    };

    // 同步过来的设置立即生效：主题/语言由 ProfileController 应用，
    // 播放类设置由 PlayController 重新 loadLocalSettings，
    // 侧边栏由本控制器自己恢复。
    $rootScope.$on('settings:synced', (event, keys) => {
      if (!Array.isArray(keys) || keys.indexOf('openSidebar') === -1) {
        return;
      }
      const isOpen = localStorage.getObject('openSidebar');
      if (isOpen !== null) {
        $scope.isOpenSidebar = isOpen;
      }
    });

    const scheduleWebdavPush = () => {
      if (!$scope.webdav.autoSync) {
        return;
      }
      if (webdavPushTimer) {
        $timeout.cancel(webdavPushTimer);
      }
      webdavPushTimer = $timeout(() => {
        webdavPushTimer = null;
        if (!$scope.webdavConnected || webdavSyncing) {
          return;
        }
        $scope.webdavUpload(true);
      }, WEBDAV_PUSH_DELAY);
    };

    $rootScope.$on('myplaylist:update', () => scheduleWebdavPush());
    $rootScope.$on('favoriteplaylist:update', () => scheduleWebdavPush());

    // 设置项改动也要回推：主题/语言/播放设置的写入散落在各个 setter 里，
    // 这里统一挂在 localStorage 写入通道上，只有参与同步的 key 才触发。
    // 歌单改动另有上面的广播，重复触发时 scheduleWebdavPush 会重置防抖计时。
    onLocalStorageChange((key) => {
      if (!MediaService.isSyncableKey(key)) {
        return;
      }
      scheduleWebdavPush();
    });

    const startWebdavAutoSync = () => {
      if (!WebdavClient.hasConfig() || !$scope.webdav.autoSync) {
        return;
      }
      if (webdavSyncing) {
        return;
      }
      // 启动/首次连接时静默拉取一次云端
      $scope.webdavDownload(true);
    };

    $scope.initWebdavSync = () => {
      $scope.webdav = WebdavClient.getConfig();
      $scope.webdavLastSyncAt = WebdavClient.getLastSyncAt();
      refreshWebdavStatus();
      if (!WebdavClient.hasConfig()) {
        return;
      }
      WebdavClient.testConnection((ok) => {
        $scope.$evalAsync(() => {
          $scope.webdavConnected = ok;
          refreshWebdavStatus();
          if (ok && $scope.webdav.autoSync) {
            startWebdavAutoSync();
          }
        });
      });
    };

    $scope.saveWebdavConfig = () => {
      WebdavClient.saveConfig($scope.webdav);
    };

    $scope.onWebdavConfigChange = () => {
      WebdavClient.saveConfig($scope.webdav);
      $scope.webdavConnected = false;
      refreshWebdavStatus();
    };

    $scope.toggleWebdavAutoSync = () => {
      $scope.webdav.autoSync = !$scope.webdav.autoSync;
      WebdavClient.saveConfig($scope.webdav);
      if (!$scope.webdav.autoSync && webdavPushTimer) {
        $timeout.cancel(webdavPushTimer);
        webdavPushTimer = null;
      }
      refreshWebdavStatus();
    };

    $scope.webdavConnect = () => {
      if (!WebdavClient.hasConfig()) {
        notyf.warning(i18next.t('_WEBDAV_NEED_CONFIG'));
        return;
      }
      WebdavClient.saveConfig($scope.webdav);
      $scope.webdavBusy = true;
      refreshWebdavStatus();
      notyf.dismissAll();
      notyf.info(i18next.t('_WEBDAV_TESTING'));
      WebdavClient.testConnection((ok) => {
        $scope.$evalAsync(() => {
          $scope.webdavBusy = false;
          $scope.webdavConnected = ok;
          refreshWebdavStatus();
          notyf.dismissAll();
          if (ok) {
            notyf.success(i18next.t('_WEBDAV_CONNECT_SUCCESS'));
            if ($scope.webdav.autoSync) {
              startWebdavAutoSync();
            }
          } else {
            notyf.warning(i18next.t('_WEBDAV_CONNECT_FAILED'));
          }
        });
      });
    };

    $scope.webdavUpload = (silent) => {
      if (webdavSyncing) {
        return;
      }
      webdavSyncing = true;
      if (!silent) {
        $scope.webdavBusy = true;
        refreshWebdavStatus();
        notyf.dismissAll();
        notyf.info(i18next.t('_WEBDAV_UPLOADING'));
      }
      // 先拉云端并合并，避免覆盖另一台设备刚写入的数据。
      // 上传方向：设置项以本机为准（刚改的主题/设置不能被云端旧值改回去）。
      WebdavClient.pull((pullRes) => {
        if (pullRes.ok && pullRes.found && pullRes.data) {
          applyWebdavMergeResult(MediaService.mergeSyncPayload(pullRes.data));
        }
        const payload = MediaService.exportSyncPayload();
        const hash = webdavPayloadHash(payload);
        if (silent && hash === webdavLastHash) {
          webdavSyncing = false;
          return;
        }
        WebdavClient.push(payload, (pushRes) => {
          webdavSyncing = false;
          $scope.$evalAsync(() => {
            $scope.webdavBusy = false;
            $scope.webdavConnected = pushRes.ok;
            if (pushRes.ok) {
              webdavLastHash = hash;
              $scope.webdavLastSyncAt = Date.now();
              WebdavClient.setLastSyncAt($scope.webdavLastSyncAt);
            }
            refreshWebdavStatus();
            if (silent) {
              return;
            }
            notyf.dismissAll();
            if (pushRes.ok) {
              notyf.success(i18next.t('_WEBDAV_UPLOAD_SUCCESS'));
            } else {
              notyf.warning(i18next.t('_WEBDAV_UPLOAD_FAILED'));
            }
          });
        });
      });
    };

    $scope.webdavDownload = (silent) => {
      if (webdavSyncing) {
        return;
      }
      webdavSyncing = true;
      if (!silent) {
        $scope.webdavBusy = true;
        refreshWebdavStatus();
        notyf.dismissAll();
        notyf.info(i18next.t('_WEBDAV_DOWNLOADING'));
      }
      WebdavClient.pull((pullRes) => {
        webdavSyncing = false;
        let mergeResult = null;
        if (pullRes.ok && pullRes.found && pullRes.data) {
          // 下载方向：设置项以云端为准（换台设备要的就是云端那份设置）
          mergeResult = MediaService.mergeSyncPayload(pullRes.data, {
            preferRemote: true,
          });
          applyWebdavMergeResult(mergeResult);
          webdavLastHash = webdavPayloadHash(MediaService.exportSyncPayload());
        }
        $scope.$evalAsync(() => {
          $scope.webdavBusy = false;
          $scope.webdavConnected = pullRes.ok;
          if (pullRes.ok && pullRes.found) {
            $scope.webdavLastSyncAt = Date.now();
            WebdavClient.setLastSyncAt($scope.webdavLastSyncAt);
          }
          refreshWebdavStatus();
          if (silent) {
            return;
          }
          notyf.dismissAll();
          if (!pullRes.ok) {
            notyf.warning(i18next.t('_WEBDAV_DOWNLOAD_FAILED'));
          } else if (!pullRes.found) {
            notyf.warning(i18next.t('_WEBDAV_NO_BACKUP'));
          } else {
            notyf.success(i18next.t('_WEBDAV_DOWNLOAD_SUCCESS'));
          }
        });
      });
    };

    $scope.webdavDisconnect = () => {
      if (webdavPushTimer) {
        $timeout.cancel(webdavPushTimer);
        webdavPushTimer = null;
      }
      WebdavClient.clearConfig();
      $scope.webdav = WebdavClient.getConfig();
      $scope.webdavConnected = false;
      $scope.webdavBusy = false;
      $scope.webdavLastSyncAt = 0;
      webdavLastHash = null;
      refreshWebdavStatus();
      notyf.dismissAll();
      notyf.success(i18next.t('_WEBDAV_DISCONNECTED'));
    };

    refreshWebdavStatus();

    $scope.showShortcuts = () => {};

    // description: '快速搜索',
    hotkeys('f', () => {
      $scope.showTag(3);
      $timeout(() => {
        document.getElementById('search-input').focus();
      }, 0);
    });

    $scope.openUrl = (url) => {
      MediaService.parseURL(url).success((data) => {
        const { result } = data;
        if (result !== undefined) {
          $scope.showPlaylist(result.id);
        } else {
          notyf.info(i18next.t('_FAIL_OPEN_PLAYLIST_URL'));
        }
      });
    };

    $scope.favoritePlaylist = (list_id) => {
      if ($scope.is_favorite) {
        $scope.removeFavoritePlaylist(list_id);
        $scope.is_favorite = 0;
      } else {
        $scope.addFavoritePlaylist(list_id);
        $scope.is_favorite = 1;
      }
    };
    $scope.addFavoritePlaylist = (list_id) => {
      MediaService.clonePlaylist(list_id, 'favorite').success((addResult) => {
        $rootScope.$broadcast('favoriteplaylist:update');
        notyf.success(i18next.t('_FAVORITE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.removeFavoritePlaylist = (list_id) => {
      MediaService.removeMyPlaylist(list_id, 'favorite').success(() => {
        $rootScope.$broadcast('favoriteplaylist:update');
        // $scope.closeWindow();
        notyf.success(i18next.t('_UNFAVORITE_PLAYLIST_SUCCESS'));
      });
    };

    $scope.addLocalMusic = (list_id) => {
      if (isElectron()) {
        const remote = require('@electron/remote');
        const remoteFunctions = remote.require('./functions.js');
        remote.dialog
          .showOpenDialog({
            title: '添加歌曲',
            properties: ['openFile', 'multiSelections'],
            filters: [
              {
                name: 'Music Files',
                extensions: ['flac', 'mp3', 'mp4', 'ogg', 'wav', 'webm'],
              },
            ],
          })
          .then((result) => {
            if (result.canceled) {
              return;
            }

            result.filePaths.forEach((fp) => {
              remoteFunctions.readAudioTags(fp).then((md) => {
                const artist = md.common.artist || '';
                const album = md.common.album || '';
                const track = {
                  id: `lmtrack_${fp}`,
                  title: md.common.title || '',
                  artist,
                  artist_id: `lmartist_${artist}`,
                  album,
                  album_id: `lmalbum_${album}`,
                  source: 'localmusic',
                  source_url: '',
                  img_url: 'images/mycover.jpg',
                  // url: "lmtrack_"+fp,
                  sound_url: `file://${fp}`,
                };

                const list_id = 'lmplaylist_reserve';
                MediaService.addPlaylist(list_id, [track]).success((res) => {
                  const { playlist } = res;
                  $scope.songs = playlist.tracks;
                  $scope.list_id = playlist.info.id;
                  $scope.cover_img_url = playlist.info.cover_img_url;
                  $scope.playlist_title = playlist.info.title;
                  $scope.playlist_source_url = playlist.info.source_url;
                  $scope.is_mine = playlist.info.id.slice(0, 2) === 'my';
                  $scope.is_local = playlist.info.id.slice(0, 2) === 'lm';
                  $scope.$evalAsync();
                });

                // fetch only the cover during import; lyrics are fetched from the
                // selected source when this track is played for the first time
                localmusic.lm_fetch_cover_for_track(track).then((img_url) => {
                  if (!img_url) {
                    return;
                  }
                  track.img_url = img_url;
                  const playlist = localmusic.lm_update_track_cover(
                    list_id,
                    track.id,
                    img_url
                  );
                  if (playlist) {
                    const storedTrack = playlist.tracks.find(
                      (item) => item.id === track.id
                    );
                    l1Player.updateTrackCover(
                      track.id,
                      storedTrack ? storedTrack.img_url : img_url
                    );
                    $scope.songs = playlist.tracks;
                    $scope.cover_img_url = playlist.info.cover_img_url;
                    $scope.$evalAsync();
                  }
                });
              });
            });
          })
          .catch((err) => {
            // console.log(err);
          });
      }
    };
  },
]);
