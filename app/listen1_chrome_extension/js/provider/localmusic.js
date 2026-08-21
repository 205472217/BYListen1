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

  // lyric: LRCLIB first, LrcApi as fallback
  static lm_fetch_lyric(title, artist) {
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
          return item.syncedLyric;
        }
        this.lm_log('LYRIC', `empty ${lrclibUrl}, try LrcApi`);
        return this.lm_fetch_lyric_lrcapi(title, artist);
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${lrclibUrl} ${err && err.message ? err.message : err}, try LrcApi`
        );
        return this.lm_fetch_lyric_lrcapi(title, artist);
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
          return resp.data;
        }
        this.lm_log('LYRIC', `empty ${url}`);
        return '';
      })
      .catch((err) => {
        this.lm_log(
          'LYRIC',
          `fail ${url} ${err && err.message ? err.message : err}`
        );
        return '';
      });
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
      this.lm_fetch_lyric(title, artist),
    ]).then(([img_url, lyric]) => ({ img_url, lyric, tlyric: '' }));
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
    const playlist = localStorage.getObject('lmplaylist_reserve');
    const track = playlist.tracks.find((item) => item.id === track_id);
    return {
      success: (fn) => {
        // prefer lyric embedded in the file / local .lrc
        let lyric = '';
        if (track.lyrics !== undefined) {
          [lyric] = track.lyrics;
        }
        // both lyric and cover already present: nothing to fetch
        if (lyric && track.img_url) {
          return fn({
            lyric,
            tlyric: track.tlyric || '',
            img_url: track.img_url || '',
          });
        }
        // otherwise fetch the missing piece(s) online and cache them back,
        // so a song that has a local lyric but no cover still gets its cover
        localmusic.lm_fetch_online(track).then((online) => {
          if (online.lyric && !lyric) {
            track.lyrics = [online.lyric];
            if (online.tlyric) track.tlyric = online.tlyric;
          }
          if (online.img_url && !track.img_url) {
            track.img_url = online.img_url;
          }
          localmusic.lm_update_playlist_cover(playlist, track.img_url);
          localStorage.setObject('lmplaylist_reserve', playlist);
          // img_url is returned too, so the live now-playing cover can be refreshed
          fn({
            lyric: lyric || online.lyric || '',
            tlyric: track.tlyric || online.tlyric || '',
            img_url: track.img_url || online.img_url || '',
          });
        });
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
