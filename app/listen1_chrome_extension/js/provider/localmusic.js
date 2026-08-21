/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */
/* global getParameterByName toSimplified */
const defaultLocalMusicPlaylist = {
  tracks: [],
  info: {
    id: 'lmplaylist_reserve',
    cover_img_url: 'images/mycover.jpg',
    title: '本地音乐',
    source_url: '',
  },
};

const localLyricSources = [
  { index: 0, name: 'Rangotec' },
  { index: 1, name: 'LrcApi' },
  { index: 2, name: 'LRCLIB' },
  { index: 3, name: 'XMS' },
];
const localLyricEmptyMessage = '当前源未搜索到歌词，请切换搜索源';
const localLyricRequestVersions = {};
const localLyricSelectionVersions = {};

class localmusic {
  static show_playlist(url, hm) {
    return {
      success: (fn) =>
        fn({
          result: [],
        }),
    };
  }

  static lm_get_playlist(url) {
    const list_id = getParameterByName('list_id', url);
    return {
      success: (fn) => {
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = defaultLocalMusicPlaylist;
        }
        fn(playlist);
      },
    };
  }

  static lm_album(url) {
    const album = getParameterByName('list_id', url).split('_').pop();
    return {
      success: (fn) => {
        const list_id = 'lmplaylist_reserve';
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
          playlist.info.title = album;
        } else {
          playlist.info.title = album;
          playlist.tracks = playlist.tracks.filter((tr) => tr.album === album);
        }
        fn(playlist);
      },
    };
  }

  static lm_artist(url) {
    const artist = getParameterByName('list_id', url).split('_').pop();
    return {
      success: (fn) => {
        const list_id = 'lmplaylist_reserve';
        let playlist = localStorage.getObject(list_id);

        if (playlist === null || playlist === undefined) {
          playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
          playlist.info.title = artist;
        } else {
          playlist.info.title = artist;
          playlist.tracks = playlist.tracks.filter(
            (tr) => tr.artist === artist
          );
        }
        fn(playlist);
      },
    };
  }

  static bootstrap_track(track, success, failure) {
    const sound = {};
    sound.url = track.sound_url;
    sound.platform = 'localmusic';

    success(sound);
  }

  static lm_log(type, message) {
    const full = `[${type}] ${message}`;
    try {
      const r = typeof require === 'function' ? require('electron') : null;
      if (r && r.ipcRenderer) {
        r.ipcRenderer.send('logLocalMusic', { type, message });
        return;
      }
    } catch (e) {
      // fallback to console
    }
    // eslint-disable-next-line no-console
    console.log(full);
  }

  static lm_get_lyric_sources() {
    return localLyricSources.map((source) => ({ ...source }));
  }

  static lm_create_lyric_cache() {
    return {
      selected_index: 0,
      selected_name: localLyricSources[0].name,
      sources: localLyricSources.map((source) => ({
        ...source,
        status: 'unsearched',
        lyric: '',
      })),
    };
  }

  static lm_get_lyric_source(index) {
    return localLyricSources.find((source) => source.index === index);
  }

  static lm_empty_lyric_result(status) {
    return {
      status,
      lyric: localLyricEmptyMessage,
    };
  }

  static lm_fetch_lyric_lrclib(title, artist) {
    const lrclibUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(
      title
    )}&artist_name=${encodeURIComponent(artist || '')}`;
    this.lm_log('LYRIC', `GET ${lrclibUrl}`);
    return axios
      .get(lrclibUrl, { headers: { 'User-Agent': 'Listen1/2.33.0' } })
      .then((resp) => {
        const data = resp.data;
        const item = (Array.isArray(data) ? data : []).find(
          (x) => x.syncedLyric
        );
        if (item) {
          this.lm_log(
            'LYRIC',
            `success ${lrclibUrl} len=${item.syncedLyric.length}`
          );
          return { status: 'success', lyric: item.syncedLyric };
        }
        this.lm_log('LYRIC', `empty ${lrclibUrl}`);
        return this.lm_empty_lyric_result('empty');
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${lrclibUrl} ${err && err.message ? err.message : err}`
        );
        return this.lm_empty_lyric_result('error');
      });
  }

  static lm_fetch_lyric_lrcapi(title, artist) {
    const url = `https://api.lrc.cx/lyrics?title=${encodeURIComponent(
      title
    )}&artist=${encodeURIComponent(artist || '')}`;
    this.lm_log('LYRIC', `GET ${url}`);
    return axios
      .get(url)
      .then((resp) => {
        if (typeof resp.data === 'string' && resp.data) {
          this.lm_log('LYRIC', `success ${url} len=${resp.data.length}`);
          return { status: 'success', lyric: resp.data };
        }
        this.lm_log('LYRIC', `empty ${url}`);
        return this.lm_empty_lyric_result('empty');
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${url} ${err && err.message ? err.message : err}`
        );
        return this.lm_empty_lyric_result('error');
      });
  }

  static lm_fetch_lyric_xms(title, artist) {
    const url = `https://lrc.xms.mx/lyrics?title=${encodeURIComponent(
      title
    )}&artist=${encodeURIComponent(artist || '')}`;
    this.lm_log('LYRIC', `GET ${url}`);
    return axios
      .get(url)
      .then((resp) => {
        if (typeof resp.data === 'string' && resp.data) {
          this.lm_log('LYRIC', `success ${url} len=${resp.data.length}`);
          return { status: 'success', lyric: resp.data };
        }
        this.lm_log('LYRIC', `empty ${url}`);
        return this.lm_empty_lyric_result('empty');
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${url} ${err && err.message ? err.message : err}`
        );
        return this.lm_empty_lyric_result('error');
      });
  }

  static lm_normalize_rangotec_lyric(lyric) {
    return lyric
      .split(/\r?\n/)
      .map((line) =>
        line.replace(
          /^\[(\d+):(\d{2}):(\d{3}),\d+:\d{2}:\d{3}\]/,
          '[$1:$2.$3]'
        )
      )
      .join('\n');
  }

  static lm_fetch_lyric_rangotec(title, artist) {
    const url = `https://tools.rangotec.com/api/anon/lrc?title=${encodeURIComponent(
      title
    )}&artist=${encodeURIComponent(artist || '')}`;
    this.lm_log('LYRIC', `GET ${url}`);
    return axios
      .get(url)
      .then((resp) => {
        const data = resp.data && resp.data.data;
        const item = (Array.isArray(data) ? data : []).find(
          (result) =>
            result && typeof result.lrc === 'string' && result.lrc.length > 0
        );
        if (item) {
          const lyric = this.lm_normalize_rangotec_lyric(item.lrc);
          this.lm_log('LYRIC', `success ${url} len=${lyric.length}`);
          return { status: 'success', lyric };
        }
        this.lm_log('LYRIC', `empty ${url}`);
        return this.lm_empty_lyric_result('empty');
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${url} ${err && err.message ? err.message : err}`
        );
        return this.lm_empty_lyric_result('error');
      });
  }

  static lm_fetch_lyric(source_index, title, artist) {
    switch (source_index) {
      case 0:
        return this.lm_fetch_lyric_rangotec(title, artist);
      case 1:
        return this.lm_fetch_lyric_lrcapi(title, artist);
      case 2:
        return this.lm_fetch_lyric_lrclib(title, artist);
      case 3:
        return this.lm_fetch_lyric_xms(title, artist);
      default:
        return Promise.resolve(this.lm_empty_lyric_result('error'));
    }
  }

  // cover: iTunes first, then LrcApi, then MusicBrainz CAA
  static lm_fetch_cover(title, artist, album) {
    const itunes = () => {
      const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
        `${title} ${artist || ''}`
      )}&entity=song&limit=1`;
      this.lm_log('COVER', `GET ${url}`);
      return axios
        .get(url)
        .then((resp) => {
          const t = resp.data && resp.data.results && resp.data.results[0];
          if (t && t.artworkUrl100) {
            const img = t.artworkUrl100.replace('100x100bb', '600x600bb');
            this.lm_log('COVER', `success ${url} img=${img}`);
            return img;
          }
          this.lm_log('COVER', `empty ${url}`);
          return '';
        })
        .catch((err) => {
          this.lm_log(
            'COVER',
            `fail ${url} ${err && err.message ? err.message : err}`
          );
          return '';
        });
    };
    const lrcapi = () => {
      const url = `https://api.lrc.cx/api/v1/cover/album?album=${encodeURIComponent(
        album || title
      )}&artist=${encodeURIComponent(artist || '')}`;
      this.lm_log('COVER', `GET ${url}`);
      return axios
        .get(url)
        .then((resp) => {
          const d = resp.data;
          if (d && d.img) {
            this.lm_log('COVER', `success ${url} img=${d.img}`);
            return d.img;
          }
          this.lm_log('COVER', `empty ${url}`);
          return '';
        })
        .catch((err) => {
          this.lm_log(
            'COVER',
            `fail ${url} ${err && err.message ? err.message : err}`
          );
          return '';
        });
    };
    const musicbrainz = () => {
      const q = `release:${album || title} AND artist:${artist}`;
      const url = `https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(
        q
      )}&fmt=json&limit=1`;
      this.lm_log('COVER', `GET ${url}`);
      return axios
        .get(url, { headers: { 'User-Agent': 'Listen1/2.33.0' } })
        .then((resp) => {
          const id =
            resp.data &&
            resp.data.releases &&
            resp.data.releases[0] &&
            resp.data.releases[0].id;
          if (id) {
            const img = `https://coverartarchive.org/release/${id}/front-500.jpg`;
            this.lm_log('COVER', `success ${url} img=${img}`);
            return img;
          }
          this.lm_log('COVER', `empty ${url}`);
          return '';
        })
        .catch((err) => {
          this.lm_log(
            'COVER',
            `fail ${url} ${err && err.message ? err.message : err}`
          );
          return '';
        });
    };
    return itunes()
      .then((img) => img || lrcapi())
      .then((img) => img || musicbrainz());
  }

  static lm_fetch_cover_for_track(track) {
    const rawTitle = track.title || '';
    if (!rawTitle) {
      return Promise.resolve('');
    }
    const title = toSimplified(rawTitle);
    const artist = toSimplified(track.artist || '');
    const album = toSimplified(track.album || '');
    if (title !== rawTitle) {
      this.lm_log('CONV', `title "${rawTitle}" -> "${title}"`);
    }
    return this.lm_fetch_cover(title, artist, album);
  }

  // return { img_url, lyric, tlyric }
  static lm_fetch_online(track) {
    const rawTitle = track.title || '';
    if (!rawTitle) {
      return Promise.resolve({ img_url: '', lyric: '', tlyric: '' });
    }
    // unify Traditional Chinese to Simplified for better search hit rate
    const title = toSimplified(rawTitle);
    const artist = toSimplified(track.artist || '');
    const album = toSimplified(track.album || '');
    if (title !== rawTitle) {
      this.lm_log('CONV', `title "${rawTitle}" -> "${title}"`);
    }
    return Promise.all([
      this.lm_fetch_cover(title, artist, album),
      this.lm_fetch_lyric(0, title, artist),
    ]).then(([img_url, lyricResult]) => ({
      img_url,
      lyric: lyricResult.lyric,
      lyric_status: lyricResult.status,
      tlyric: '',
    }));
  }

  // keep the local playlist banner cover in sync once a real cover is known
  static lm_update_playlist_cover(playlist, img_url) {
    if (!img_url || !playlist || !playlist.info) {
      return;
    }
    const cur = playlist.info.cover_img_url;
    if (!cur || cur === 'images/mycover.jpg') {
      playlist.info.cover_img_url = img_url;
    }
  }

  static lyric(url) {
    const track_id = getParameterByName('track_id', url);
    const requestedIndex = Number(getParameterByName('source_index', url));
    const refresh = getParameterByName('refresh', url) === '1';
    const source_index = Number.isInteger(requestedIndex)
      ? requestedIndex
      : 0;
    const source = localmusic.lm_get_lyric_source(source_index);

    return {
      success: (fn) => {
        let playlist = localStorage.getObject('lmplaylist_reserve');
        let track =
          playlist &&
          Array.isArray(playlist.tracks) &&
          playlist.tracks.find((item) => item.id === track_id);
        if (!track || !source) {
          return fn({
            lyric: localLyricEmptyMessage,
            tlyric: '',
            img_url: track ? track.img_url || '' : '',
            lyric_sources: localmusic.lm_get_lyric_sources(),
            lyric_source_index: source ? source.index : 0,
            track_id,
            request_source_index: source ? source.index : 0,
            request_applied: true,
          });
        }

        if (!track.lyric_cache) {
          track.lyric_cache = localmusic.lm_create_lyric_cache();
          localStorage.setObject('lmplaylist_reserve', playlist);
        }

        const selectedIndex = refresh
          ? source_index
          : track.lyric_cache.selected_index;
        const selectedSource = localmusic.lm_get_lyric_source(selectedIndex);
        const cachedSource = track.lyric_cache.sources[selectedIndex];
        if (!refresh && cachedSource && cachedSource.status !== 'unsearched') {
          const cachedSelectionVersion =
            localLyricSelectionVersions[track_id] || 0;
          const respondWithCache = (img_url) =>
            fn({
              lyric: cachedSource.lyric,
              tlyric: '',
              img_url: img_url || '',
              lyric_sources: track.lyric_cache.sources,
              lyric_source_index: selectedIndex,
              track_id,
              request_applied:
                (localLyricSelectionVersions[track_id] || 0) ===
                cachedSelectionVersion,
            });
          if (track.img_url) {
            return respondWithCache(track.img_url);
          }
          return localmusic.lm_fetch_cover_for_track(track).then((img_url) => {
            if (img_url) {
              const latestPlaylist = localStorage.getObject(
                'lmplaylist_reserve'
              );
              const latestTrack =
                latestPlaylist &&
                Array.isArray(latestPlaylist.tracks) &&
                latestPlaylist.tracks.find((item) => item.id === track_id);
              if (latestTrack && !latestTrack.img_url) {
                latestTrack.img_url = img_url;
                localmusic.lm_update_playlist_cover(latestPlaylist, img_url);
                localStorage.setObject('lmplaylist_reserve', latestPlaylist);
              }
            }
            return respondWithCache(img_url);
          });
        }

        const querySource = selectedSource || localLyricSources[0];
        const rawTitle = track.title || '';
        const title = toSimplified(rawTitle);
        const artist = toSimplified(track.artist || '');
        const album = toSimplified(track.album || '');
        const requestKey = `${track_id}:${querySource.index}`;
        const requestVersion = (localLyricRequestVersions[requestKey] || 0) + 1;
        localLyricRequestVersions[requestKey] = requestVersion;
        const selectionVersion =
          (localLyricSelectionVersions[track_id] || 0) + 1;
        localLyricSelectionVersions[track_id] = selectionVersion;

        const lyricRequest = rawTitle
          ? localmusic.lm_fetch_lyric(querySource.index, title, artist)
          : Promise.resolve(localmusic.lm_empty_lyric_result('empty'));
        const coverRequest = track.img_url
          ? Promise.resolve(track.img_url)
          : localmusic.lm_fetch_cover(title, artist, album);

        Promise.all([lyricRequest, coverRequest]).then(
          ([lyricResult, img_url]) => {
            playlist = localStorage.getObject('lmplaylist_reserve');
            track =
              playlist &&
              Array.isArray(playlist.tracks) &&
              playlist.tracks.find((item) => item.id === track_id);
            if (!track) {
              return fn({
                lyric: lyricResult.lyric,
                tlyric: '',
                img_url: img_url || '',
                lyric_sources: localmusic.lm_get_lyric_sources(),
                lyric_source_index: querySource.index,
                track_id,
              });
            }
            if (!track.lyric_cache) {
              track.lyric_cache = localmusic.lm_create_lyric_cache();
            }

            const isLatestRequest =
              localLyricRequestVersions[requestKey] === requestVersion;
            const isLatestSelection =
              localLyricSelectionVersions[track_id] === selectionVersion;
            if (isLatestRequest) {
              track.lyric_cache.sources[querySource.index] = {
                ...querySource,
                status: lyricResult.status,
                lyric: lyricResult.lyric,
              };
            }
            if (isLatestRequest && isLatestSelection) {
              track.lyric_cache.selected_index = querySource.index;
              track.lyric_cache.selected_name = querySource.name;
            }
            if (img_url && !track.img_url) {
              track.img_url = img_url;
            }
            localmusic.lm_update_playlist_cover(playlist, track.img_url);
            localStorage.setObject('lmplaylist_reserve', playlist);

            const activeSource = track.lyric_cache.sources[
              track.lyric_cache.selected_index
            ];
            return fn({
              lyric: activeSource.lyric,
              tlyric: '',
              img_url: track.img_url || '',
              lyric_sources: track.lyric_cache.sources,
              lyric_source_index: track.lyric_cache.selected_index,
              track_id,
              request_source_index: querySource.index,
              request_applied: isLatestRequest && isLatestSelection,
            });
          }
        );
      },
    };
  }

  static add_playlist(list_id, tracks) {
    if (typeof tracks === 'string') {
      tracks = JSON.parse(tracks);
    }
    let playlist = localStorage.getObject(list_id);
    if (playlist === null) {
      playlist = JSON.parse(JSON.stringify(defaultLocalMusicPlaylist));
    }
    const tracksIdSet = {};
    tracks.forEach((tr) => {
      tracksIdSet[tr.id] = true;
    });
    playlist.tracks = tracks.concat(
      playlist.tracks.filter((tr) => tracksIdSet[tr.id] !== true)
    );
    // refresh the banner cover from the first track that has a real one
    playlist.tracks.forEach((tr) => {
      localmusic.lm_update_playlist_cover(playlist, tr.img_url);
    });
    localStorage.setObject(list_id, playlist);

    return {
      success: (fn) => fn({ list_id, playlist }),
    };
  }

  static parse_url(url) {
    let result;
    return {
      success: (fn) => {
        fn(result);
      },
    };
  }

  static get_playlist(url) {
    const list_id = getParameterByName('list_id', url).split('_')[0];
    switch (list_id) {
      case 'lmplaylist':
        return this.lm_get_playlist(url);
      case 'lmartist':
        return this.lm_artist(url);
      case 'lmalbum':
        return this.lm_album(url);
      default:
        return null;
    }
  }

  static remove_from_playlist(list_id, track_id) {
    const playlist = localStorage.getObject(list_id);
    if (playlist == null) {
      return;
    }
    const newtracks = playlist.tracks.filter((item) => item.id !== track_id);
    playlist.tracks = newtracks;
    localStorage.setObject(list_id, playlist);

    // eslint-disable-next-line consistent-return
    return {
      success: (fn) => fn(),
    };
  }

  static get_playlist_filters() {
    return {
      success: (fn) => fn({ recommend: [], all: [] }),
    };
  }

  // return {
  //   show_playlist: lm_show_playlist,
  //   get_playlist_filters,
  //   get_playlist,
  //   parse_url: lm_parse_url,
  //   bootstrap_track: lm_bootstrap_track,
  //   search: lm_search,
  //   lyric: lm_lyric,
  //   add_playlist: lm_add_playlist,
  //   remove_from_playlist: lm_remove_from_playlist,
  // };
}
