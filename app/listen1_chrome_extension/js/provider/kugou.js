/* eslint-disable no-unused-vars */
/* global async getParameterByName forge */
class kugou {
  static kg_convert_song(song) {
    const track = {
      id: `kgtrack_${song.FileHash}`,
      title: song.SongName,
      artist: '',
      artist_id: '',
      album: song.AlbumName,
      album_id: `kgalbum_${song.AlbumID}`,
      source: 'kugou',
      source_url: `https://www.kugou.com/song/#hash=${song.FileHash}&album_id=${song.AlbumID}`,
      // 搜索接口的条目自带封面（Image），先用它兜底，避免二次请求失败后图片空白
      img_url: kugou.kg_fix_img_url(
        song.Image || (song.trans_param && song.trans_param.union_cover),
        400
      ),
      // url: `kgtrack_${song.FileHash}`,
      lyric_url: song.FileHash,
    };
    let singer_id = song.SingerId;
    let singer_name = song.SingerName;
    if (song.SingerId instanceof Array) {
      [singer_id] = singer_id;
      [singer_name] = singer_name.split('、');
    }
    track.artist = singer_name;
    track.artist_id = `kgartist_${singer_id}`;
    return track;
  }

  static async_process_list(
    data_list,
    handler,
    handler_extra_param_list,
    callback
  ) {
    const fnDict = {};
    data_list.forEach((item, index) => {
      fnDict[index] = (cb) =>
        handler(index, item, handler_extra_param_list, cb);
    });
    async.parallel(fnDict, (err, results) =>
      callback(
        null,
        data_list.map((item, index) => results[index])
      )
    );
  }

  /*
   * 搜索接口的条目自带歌名 / 歌手 / 封面（Image），直接用即可。
   *
   * 原先每个结果都再请求一次 www.kugou.com/yy/index.php?r=play/getdata 想取更好的封面，
   * 但该接口对这些 hash 一律返回 err_code 20010（实测 20/20 全部失败），
   * 封面最终还是条目自带的 Image —— 这一轮请求纯属浪费，去掉后搜索页响应快一倍。
   */
  static kg_render_search_result_item(index, item, params, callback) {
    callback(null, kugou.kg_convert_song(item));
  }

  static search(url) {
    const keyword = getParameterByName('keywords', url);
    const curpage = getParameterByName('curpage', url);
    const searchType = getParameterByName('type', url);
    if (searchType === '1') {
      return {
        success: (fn) => {
          const target_url = `${'http://mobilecdnbj.kugou.com/api/v3/search/special?keyword='}${keyword}&pagesize=20&filter=0&page=${curpage}`;
          axios
            .get(target_url)
            .then((response) => {
              const result = response.data.data.info.map((item) => ({
                id: `kgplaylist_${item.specialid}`,
                title: item.specialname,
                source: 'kugou',
                source_url:
                  'https://www.kugou.com/yy/special/single/{size}.html'.replace(
                    '{size}',
                    item.specialid
                  ),
                img_url: item.imgurl
                  ? item.imgurl.replace('{size}', '400')
                  : '',
                url: `kgplaylist_${item.specialid}`,
                author: item.nickname,
                count: item.songcount,
              }));
              const { total } = response.data.data;
              return fn({
                result,
                total,
                type: searchType,
              });
            })
            .catch(() => {
              fn({
                result: [],
                total: 0,
                type: searchType,
              });
            });
        },
      };
    }
    return {
      success: (fn) => {
        const target_url = `${'https://songsearch.kugou.com/song_search_v2?keyword='}${keyword}&page=${curpage}`;
        axios
          .get(target_url)
          .then((response) => {
            const { data } = response;
            this.async_process_list(
              data.data.lists,
              this.kg_render_search_result_item,
              [],
              (err, tracks) =>
                fn({
                  result: tracks,
                  total: data.data.total,
                  type: searchType,
                })
            );
          })
          .catch(() =>
            fn({
              result: [],
              total: 0,
              type: searchType,
            })
          );
      },
    };
  }

  /*
   * 酷狗的列表接口大多只返回 hash，歌名/歌手要靠 getSongInfo 二次请求回填。
   * 对无版权 / 已下架的曲目，该接口不会返回 songName，
   * 若直接用 data.songName 覆盖占位值，列表里就会出现"名称为空白"的行。
   * 歌单接口返回的 filename 形如 "歌手 - 歌名"，用来兜底即可还原歌名。
   */
  static kg_split_filename(filename) {
    const raw = (filename || '').trim();
    const match = /^(.*?)\s*-\s*(.+)$/.exec(raw);
    if (match === null) {
      return { artist: '', title: raw };
    }
    return { artist: match[1].trim(), title: match[2].trim() };
  }

  /*
   * 封面地址带 {size} 占位符，需要替换成实际尺寸。
   * 统一升级成 https，避免在 https 环境下被当作混合内容拦截。
   */
  static kg_fix_img_url(url, size) {
    if (!url || typeof url !== 'string') {
      return '';
    }
    return url.replace('{size}', size || '400').replace(/^http:/, 'https:');
  }

  /*
   * 歌单 / 歌手列表接口的每个条目里已经带了封面（trans_param.union_cover），
   * 直接用它就不必再依赖 getSongInfo 回填。
   * getSongInfo 有频率限制（errcode 1002），一旦被限流就返回不了 album_img，
   * 之前只靠它取图，列表里的封面就会整片空白。
   */
  static kg_item_img_url(item) {
    return kugou.kg_fix_img_url(
      item && item.trans_param && item.trans_param.union_cover,
      400
    );
  }

  /*
   * 只有 filename 缺失（极少见）时才退回 getSongInfo 回填歌名/歌手。
   *
   * getSongInfo 有很严的频率限制，逐首请求会直接把整份歌单拖进限流状态
   * （表现为歌名空白、封面空白、能播的歌解析不到地址）。
   * 正常歌单每个条目都带 filename（"歌手 - 歌名"），不会走到这条分支，
   * 所以这里只是极端情况下的兜底，不会产生成片的请求。
   */
  static kg_fill_songinfo_if_needed(track, hash, done) {
    if (track.title) {
      done();
      return;
    }
    const song_info_url = `${'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash='}${hash}`;
    axios
      .get(song_info_url)
      .then((response) => {
        const { data } = response;
        if (data.songName) {
          track.title = data.songName;
        }
        if (data.singerId !== undefined) {
          track.artist_id = `kgartist_${data.singerId}`;
          track.artist =
            data.singerId === 0 ? '未知' : data.singerName || track.artist;
        }
        done();
      })
      .catch(() => done());
  }

  static kg_render_playlist_result_item(index, item, params, callback) {
    const { hash } = item;
    const fallback = kugou.kg_split_filename(item.filename);

    const track = {
      id: `kgtrack_${hash}`,
      // 歌单条目的 filename 就是"歌手 - 歌名"，直接用它，
      // 不再逐首请求 getSongInfo（避免触发限流，也不再出现空白歌名）
      title: fallback.title,
      artist: fallback.artist,
      artist_id: '',
      album: '',
      album_id: `kgalbum_${item.album_id}`,
      source: 'kugou',
      source_url: `https://www.kugou.com/song/#hash=${hash}&album_id=${item.album_id}`,
      // 歌单条目自带封面（trans_param.union_cover）
      img_url: kugou.kg_item_img_url(item),
      lyric_url: hash,
    };

    kugou.kg_fill_songinfo_if_needed(track, hash, () => {
      // 专辑名只是补充信息，无论成功失败都要结束这一条，
      // 否则 async.parallel 会卡死，整份歌单不显示
      const album_url = `http://mobilecdnbj.kugou.com/api/v3/album/info?albumid=${item.album_id}`;
      axios
        .get(album_url)
        .then((res) => {
          const { data: res_data } = res;
          if (
            res_data &&
            res_data.status &&
            res_data.data !== undefined &&
            res_data.data !== null
          ) {
            track.album = res_data.data.albumname || '';
          }
        })
        .catch(() => {})
        .then(() => callback(null, track));
    });
  }

  static kg_get_playlist(url) {
    return {
      success: (fn) => {
        const list_id = getParameterByName('list_id', url).split('_').pop();
        const target_url = `https://m.kugou.com/plist/list/${list_id}?json=true`;

        axios.get(target_url).then((response) => {
          const { data } = response;

          const info = {
            cover_img_url: data.info.list.imgurl
              ? data.info.list.imgurl.replace('{size}', '400')
              : '',
            title: data.info.list.specialname,
            id: `kgplaylist_${data.info.list.specialid}`,
            source_url:
              'https://www.kugou.com/yy/special/single/{size}.html'.replace(
                '{size}',
                data.info.list.specialid
              ),
          };

          this.async_process_list(
            data.list.list.info,
            this.kg_render_playlist_result_item,
            [],
            (err, tracks) =>
              fn({
                tracks,
                info,
              })
          );
        });
      },
    };
  }

  static kg_render_artist_result_item(index, item, params, callback) {
    const info = params[0];
    const fallback = kugou.kg_split_filename(item.filename);
    const track = {
      id: `kgtrack_${item.hash}`,
      title: fallback.title,
      artist: fallback.artist,
      artist_id: info.id,
      // 列表条目自带专辑名，接口回填失败时也有兜底
      album: item.album_name || '',
      album_id: `kgalbum_${item.album_id}`,
      source: 'kugou',
      source_url: `https://www.kugou.com/song/#hash=${item.hash}&album_id=${item.album_id}`,
      // 先用列表条目自带的封面，避免 play/getdata 请求失败后图片空白
      img_url: kugou.kg_item_img_url(item),
      // url: `kgtrack_${item.hash}`,
      lyric_url: item.hash,
    };
    // 封面已由条目自带的 union_cover 提供（实测覆盖率 30/30）。
    // 原先每首再打一次 www.kugou.com/yy/index.php?r=play/getdata 取封面，
    // 该接口对这些 hash 一律返回 err_code 20010，30 次请求全是白跑，去掉。
    // 专辑名用来做补充信息，取不到也要结束这一条，否则整页卡住不显示。
    const album_url = `${'http://mobilecdnbj.kugou.com/api/v3/album/info?albumid='}${
      item.album_id
    }`;
    axios
      .get(album_url)
      .then((response) => {
        const { data } = response;
        if (data.status && data.data && data.data.albumname) {
          track.album = data.data.albumname;
        }
      })
      .catch(() => {})
      .then(() => callback(null, track));
  }

  static kg_artist(url) {
    return {
      success: (fn) => {
        const artist_id = getParameterByName('list_id', url).split('_').pop();
        let target_url = `http://mobilecdnbj.kugou.com/api/v3/singer/info?singerid=${artist_id}`;
        axios.get(target_url).then((response) => {
          const { data } = response;
          const info = {
            cover_img_url: data.data.imgurl.replace('{size}', '400'),
            title: data.data.singername,
            id: `kgartist_${artist_id}`,
            source_url: 'https://www.kugou.com/singer/{id}.html'.replace(
              '{id}',
              artist_id
            ),
          };
          target_url = `http://mobilecdnbj.kugou.com/api/v3/singer/song?singerid=${artist_id}&page=1&pagesize=30`;
          axios.get(target_url).then((res) => {
            this.async_process_list(
              res.data.data.info,
              this.kg_render_artist_result_item,
              [info],
              (err, tracks) =>
                fn({
                  tracks,
                  info,
                })
            );
          });
        });
      },
    };
  }

  static getTimestampString() {
    return new Date().getTime().toString();
  }

  static getRandomIntString() {
    return (Math.random() * 100).toString().replace(/\D/g, '');
  }

  static getRandomHexString() {
    let result = '';
    const letters = '0123456789abcdef';
    for (let i = 0; i < 16; i += 1) {
      result += letters[Math.floor(Math.random() * 16)];
    }
    return result;
  }

  /*
   * tracker 接口的签名：key = md5(hash + 'kgcloudv2')
   */
  static kg_tracker_key(hash) {
    return forge.md5
      .create()
      .update(forge.util.encodeUtf8(`${hash}kgcloudv2`))
      .digest()
      .toHex();
  }

  /*
   * 解析播放地址。
   *
   * 原先用 getSongInfo.php，但那个接口的频率限制非常严（errcode 1002「操作太频繁」）：
   * 一个歌单连着请求十几首就会整片被限流，返回体里既没有 url 也没有歌名/封面。
   * 结果是"本来能播放的歌解析不到地址"，被误判成不可播放（列表整片变灰）。
   *
   * 改用 tracker 接口（实测无频率限制，间隔 0.4 秒连发 8 次全部正常）：
   *   - status=1 且带 url  => 可播放
   *   - 正常响应但没有 url => 无版权 / 需要付费包，确定不可播放
   *   - 返回错误信息 / 请求异常 => 结果不可判定，交由调用方按"未确定"处理，
   *     绝不能据此置灰
   */
  static bootstrap_track(track, success, failure) {
    const track_id = track.id.slice('kgtrack_'.length);

    let key;
    try {
      key = kugou.kg_tracker_key(track_id);
    } catch (err) {
      // 签名算不出来就无法给出结论，按"未确定"处理
      return failure({ unresolved: true });
    }

    const target_url = `${'http://trackercdn.kugou.com/i/v2/?key='}${key}&hash=${track_id}&br=hq&appid=1005&pid=2&cmd=25&behavior=play`;

    return axios
      .get(target_url)
      .then((response) => {
        const info = response.data;

        // 返回体不是正常结构（被拦截、返回了 HTML 等）：结果不可判定
        if (!info || typeof info !== 'object') {
          return failure({ unresolved: true });
        }

        const url = Array.isArray(info.url) ? info.url[0] : info.url;
        if (url) {
          return success({
            url,
            bitrate: info.bitRate
              ? `${Math.round(info.bitRate / 1000)}kbps`
              : '128kbps',
            platform: 'kugou',
          });
        }

        // 带错误信息时说明请求本身没成功，无法判断这首歌的状态
        if (info.errcode || typeof info.error === 'string') {
          return failure({ unresolved: true });
        }

        // 接口正常响应但没有播放地址 = 无版权 / 需要付费包
        return failure({});
      })
      // 请求本身失败（网络异常等）同样属于不可判定
      .catch(() => failure({ unresolved: true }));
  }

  static lyric(url) {
    const track_id = getParameterByName('track_id', url).split('_').pop();
    const album_id = getParameterByName('album_id', url).split('_').pop();
    let lyric_url = `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&callback=jQuery&mid=1&hash=${track_id}&platid=4&album_id=${album_id}`;
    const timstamp = +new Date();
    lyric_url += `&_=${timstamp}`;
    return {
      success: (fn) => {
        axios.get(lyric_url).then((response) => {
          const { data } = response;
          const jsonString = data.slice('jQuery('.length, data.length - 1 - 1);
          const info = JSON.parse(jsonString);
          return fn({
            lyric: info.data.lyrics,
          });
        });
      },
    };
  }

  static kg_render_album_result_item(index, item, params, callback) {
    const info = params[0];
    const album_id = params[1];
    const fallback = kugou.kg_split_filename(item.filename);
    const track = {
      id: `kgtrack_${item.hash}`,
      // 先用 filename 兜底，防止无版权曲目回填失败后标题为空
      title: fallback.title,
      artist: fallback.artist,
      artist_id: '',
      album: info.title,
      album_id: `kgalbum_${album_id}`,
      source: 'kugou',
      source_url: `https://www.kugou.com/song/#hash=${item.hash}&album_id=${album_id}`,
      // 专辑封面在专辑信息里已经有了，先填上
      img_url: kugou.kg_fix_img_url(info && info.cover_img_url, 400),
      // url: `xmtrack_${item.hash}`,
      lyric_url: item.hash,
    };
    // 歌名/歌手已由 filename 兜底，只有缺失时才回退请求 getSongInfo（避免限流）；
    // 封面在专辑信息里已经拿到（info.cover_img_url），无需再逐首请求
    kugou.kg_fill_songinfo_if_needed(track, item.hash, () =>
      callback(null, track)
    );
  }

  static kg_album(url) {
    return {
      success: (fn) => {
        const album_id = getParameterByName('list_id', url).split('_').pop();
        let target_url = `${'http://mobilecdnbj.kugou.com/api/v3/album/info?albumid='}${album_id}`;

        let info;
        // info
        axios.get(target_url).then((response) => {
          const { data } = response;

          info = {
            cover_img_url: data.data.imgurl.replace('{size}', '400'),
            title: data.data.albumname,
            id: `kgalbum_${data.data.albumid}`,
            source_url: 'https://www.kugou.com/album/{id}.html'.replace(
              '{id}',
              data.data.albumid
            ),
          };

          target_url = `${'http://mobilecdnbj.kugou.com/api/v3/album/song?albumid='}${album_id}&page=1&pagesize=-1`;
          axios.get(target_url).then((res) => {
            this.async_process_list(
              res.data.data.info,
              this.kg_render_album_result_item,
              [info, album_id],
              (err, tracks) =>
                fn({
                  tracks,
                  info,
                })
            );
          });
        });
      },
    };
  }

  static show_playlist(url) {
    let offset = getParameterByName('offset', url);
    if (offset === undefined) {
      offset = 0;
    }
    const page = offset / 30 + 1;
    const target_url = `${'https://m.kugou.com/plist/index&json=true&page='}${page}`;
    return {
      success: (fn) => {
        axios.get(target_url).then((response) => {
          const { data } = response;
          // const total = data.plist.total;
          const result = data.plist.list.info.map((item) => ({
            cover_img_url: item.imgurl
              ? item.imgurl.replace('{size}', '400')
              : '',
            title: item.specialname,
            id: `kgplaylist_${item.specialid}`,
            source_url:
              'https://www.kugou.com/yy/special/single/{size}.html'.replace(
                '{size}',
                item.specialid
              ),
          }));
          return fn({
            result,
          });
        });
      },
    };
  }

  static parse_url(url) {
    let result;
    const match = /\/\/www.kugou.com\/yy\/special\/single\/([0-9]+).html/.exec(
      url
    );
    if (match != null) {
      const playlist_id = match[1];
      result = {
        type: 'playlist',
        id: `kgplaylist_${playlist_id}`,
      };
    }
    return {
      success: (fn) => {
        fn(result);
      },
    };
  }

  static get_playlist(url) {
    // eslint-disable-line no-unused-vars
    const list_id = getParameterByName('list_id', url).split('_')[0];
    switch (list_id) {
      case 'kgplaylist':
        return this.kg_get_playlist(url);
      case 'kgalbum':
        return this.kg_album(url);
      case 'kgartist':
        return this.kg_artist(url);
      default:
        return null;
    }
  }

  static get_playlist_filters() {
    return {
      success: (fn) => fn({ recommend: [], all: [] }),
    };
  }

  static get_user() {
    return {
      success: (fn) => fn({ status: 'fail', data: {} }),
    };
  }

  static get_login_url() {
    return `https://www.kugou.com`;
  }

  static logout() {}

  // return {
  //   show_playlist: kg_show_playlist,
  //   get_playlist_filters,
  //   get_playlist,
  //   parse_url: kg_parse_url,
  //   bootstrap_track: kg_bootstrap_track,
  //   search: kg_search,
  //   lyric: kg_lyric,
  //   get_user: kg_get_user,
  //   get_login_url: kg_get_login_url,
  //   logout: kg_logout,
  // };
}
