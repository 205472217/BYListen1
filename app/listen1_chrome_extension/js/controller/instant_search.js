/* eslint-disable no-param-reassign */
/* global angular i18next MediaService sourceList TrackAvailability notyf LRUCache */
angular.module('listenone').controller('InstantSearchController', [
  '$scope',
  '$timeout',
  '$rootScope',
  ($scope, $timeout, $rootScope) => {
    // 平台默认每页条数；provider 可以通过返回 data.perPage 覆盖
    const DEFAULT_PER_PAGE = 20;
    // 单次搜索最长等待时间：超时后结束 loading，避免"永久空白 + 转圈"
    const REQUEST_TIMEOUT = 20000;
    // 搜索结果缓存有效时长
    const CACHE_MAX_AGE = 5 * 60 * 1000;

    // 搜索结果缓存，key = `source|searchType|keywords|page`。
    // 切回同一个 Tab、翻回上一页时直接命中缓存，不再重复请求平台接口。
    // （QQ 等在请求过频时会返回 code 2001 的软错误，减少请求量同时也规避了它）
    const searchCache = new LRUCache({ max: 60, maxAge: CACHE_MAX_AGE });
    // 同一页正在请求中，避免重复打接口
    const inflight = new Set();
    // 翻页前的位置快照，翻页失败时用来回退（避免页码前进但列表为空）
    let pageSnapshot = null;

    $scope.originpagelog = { allmusic: 1 };
    sourceList.forEach((i) => {
      $scope.originpagelog[i.name] = 1;
    });
    $scope.sourceList = sourceList.filter((i) => i.searchable !== false);
    $scope.tab = sourceList[0].name;
    $scope.keywords = '';
    $scope.loading = false;
    $scope.curpagelog = { ...$scope.originpagelog };
    $scope.totalpagelog = { ...$scope.originpagelog };
    $scope.curpage = 1;
    $scope.totalpage = 1;
    $scope.searchType = 0;

    // 当前视图真正想要的缓存 key
    function currentKey() {
      return [
        $scope.tab,
        $scope.searchType,
        $scope.keywords,
        $scope.curpage,
      ].join('|');
    }

    // 同一个 Tab + 搜索类型 + 关键词算一组，翻页不会切换组
    function currentGroup() {
      return [$scope.tab, $scope.searchType, $scope.keywords].join('|');
    }

    function updateCurrentPage(cp) {
      if (cp === -1) {
        // when search words changes,pagenums should be reset.
        $scope.curpagelog = { ...$scope.originpagelog };
        $scope.curpage = 1;
      } else if (cp >= 0) {
        $scope.curpagelog[$scope.tab] = cp;
        $scope.curpage = $scope.curpagelog[$scope.tab];
      } else {
        // only tab changed
        $scope.curpage = $scope.curpagelog[$scope.tab];
      }
    }

    function updateTotalPage(totalItem, perPage, totalPageHint) {
      if (totalItem === -1) {
        $scope.totalpagelog = { ...$scope.originpagelog };
        $scope.totalpage = 1;
        return;
      }
      if (totalItem === undefined) {
        // just switch tab
        $scope.totalpage = $scope.totalpagelog[$scope.tab] || 1;
        return;
      }
      const hint = Number(totalPageHint);
      if (Number.isFinite(hint) && hint > 0) {
        // provider 直接给出了总页数（例如 allmusic 的聚合结果）
        $scope.totalpage = Math.ceil(hint);
      } else {
        // 各平台每页条数并不都是 20（QQ 50 / bilibili 42 / kuwo 歌单 30），
        // 必须按真实每页条数算总页数，否则会多出永远为空的页码。
        const size = Number(perPage) > 0 ? Number(perPage) : DEFAULT_PER_PAGE;
        const total = Number(totalItem);
        $scope.totalpage =
          Number.isFinite(total) && total > 0
            ? Math.max(1, Math.ceil(total / size))
            : 1;
      }
      $scope.totalpagelog[$scope.tab] = $scope.totalpage;
    }

    function notifyFailure() {
      notyf.dismissAll();
      notyf.warning(i18next.t('_SEARCH_FAIL'));
    }

    // 通知导航栏切到"搜索结果"页（navigation.js 监听 search:keyword_change → showTag(3)）。
    // 必须在"要展示结果"时就发出，不能只在发起请求时发：
    // 命中缓存时不会发请求，但界面依然需要切到搜索页。
    function showSearchPage() {
      $rootScope.$broadcast('search:keyword_change', $scope.keywords);
    }

    function applyResult(data) {
      const result = Array.isArray(data.result) ? data.result : [];
      result.forEach((r) => {
        r.sourceName = i18next.t(r.source);
      });
      $scope.result = result;
      // 后台预检可播放性：不能播放的曲目会被标记为 disabled（灰色、不可点击）
      if (window.TrackAvailability) {
        window.TrackAvailability.scan($scope.result, () => {
          $scope.$evalAsync();
        });
      }
      updateTotalPage(data.total, data.perPage, data.totalpage);
      $scope.loading = false;
      // scroll back to top when finish searching
      const wrapper = document.querySelector('.site-wrapper-innerd');
      if (wrapper && wrapper.scrollTo) {
        wrapper.scrollTo({ top: 0 });
      }
      if (result.length === 0) {
        notyf.dismissAll();
        notyf.info(i18next.t('_SEARCH_EMPTY'));
      }
    }

    // 请求彻底失败 / 超时后的收尾：结束 loading，必要时回退到上一页
    function handleFailure() {
      $scope.loading = false;
      notifyFailure();
      if (pageSnapshot && pageSnapshot.group === currentGroup()) {
        const fallback = pageSnapshot;
        pageSnapshot = null;
        $scope.curpagelog[$scope.tab] = fallback.page;
        $scope.curpage = fallback.page;
        const cached = searchCache.get(currentKey());
        if (cached) {
          applyResult(cached);
          return;
        }
      }
      $scope.result = [];
    }

    function performSearch() {
      const key = currentKey();
      const group = currentGroup();
      if (inflight.has(key)) {
        // 同一页的请求已经在路上，等它回来即可
        $scope.loading = true;
        return;
      }
      inflight.add(key);
      $scope.loading = true;

      let settled = false;
      const settle = () => {
        if (settled) {
          return;
        }
        settled = true;
        inflight.delete(key);
        $timeout.cancel(timer);
      };

      const timer = $timeout(() => {
        // 平台接口一直没有响应，不能让它把页面卡在"空白 + 转圈"
        settle();
        if (key === currentKey()) {
          handleFailure();
        }
      }, REQUEST_TIMEOUT);

      const onSuccess = (data) => {
        if (settled) {
          return;
        }
        settle();
        if (!data || !Array.isArray(data.result)) {
          // provider 返回了非法结构，按失败处理，避免页面空白
          if (key === currentKey()) {
            handleFailure();
          }
          return;
        }
        // 成功的结果（含空结果）都进缓存，避免反复打同一个空页
        searchCache.set(key, data);
        if (key === currentKey() && group === currentGroup()) {
          pageSnapshot = null;
          applyResult(data);
        }
      };

      try {
        MediaService.search($scope.tab, {
          keywords: $scope.keywords,
          curpage: $scope.curpage,
          type: $scope.searchType,
        }).success(onSuccess);
      } catch (e) {
        settle();
        if (key === currentKey()) {
          handleFailure();
        }
      }
    }

    // 取当前页：命中缓存直接复用，否则发起请求
    function loadCurrentPage() {
      if ($scope.keywords === '') {
        $scope.result = [];
        $scope.loading = false;
        return;
      }
      // 进入搜索页（切 Tab / 换关键词 / 翻页 / 点搜索按钮 都走这里）
      showSearchPage();
      const cached = searchCache.get(currentKey());
      if (cached) {
        pageSnapshot = null;
        applyResult(cached);
        return;
      }
      // 只有切换 Tab / 搜索类型 / 关键词时才清空列表（翻页保留旧列表避免闪空）
      if (pageSnapshot === null || pageSnapshot.group !== currentGroup()) {
        $scope.result = [];
      }
      performSearch();
    }

    $scope.changeSourceTab = (newTab) => {
      pageSnapshot = null;
      $scope.tab = newTab;
      updateCurrentPage();
      updateTotalPage();
      loadCurrentPage();
    };

    $scope.changeSearchType = (newSearchType) => {
      pageSnapshot = null;
      $scope.searchType = newSearchType;
      updateCurrentPage(-1);
      updateTotalPage(-1);
      loadCurrentPage();
    };
    $scope.isActiveTab = (tab) => $scope.tab === tab;

    $scope.isSearchType = (searchType) => $scope.searchType === searchType;

    // 可播放性预检开关变化时，重新检测当前搜索结果
    $scope.$on('playable_precheck:changed', (event, enabled) => {
      if (!window.TrackAvailability || !$scope.result) {
        return;
      }
      if (enabled) {
        window.TrackAvailability.scan($scope.result, () => {
          $scope.$evalAsync();
        });
      } else {
        $scope.result.forEach((song) => {
          song.disabled = false;
          song.availability = undefined;
        });
      }
    });

    // eslint-disable-next-line consistent-return
    function renderSearchPage() {
      pageSnapshot = null;
      updateCurrentPage(-1);
      updateTotalPage(-1);
      if (!$scope.keywords || $scope.keywords.length === 0) {
        $scope.result = [];
        $scope.loading = false;
        return 0;
      }

      loadCurrentPage();
    }

    $scope.$watch('keywords', (tmpStr) => {
      if (tmpStr === $scope.keywords) {
        // if searchStr is still the same..
        // go ahead and retrieve the data
        renderSearchPage();
      }
    });

    $scope.enterEvent = (e) => {
      const keycode = window.event ? e.keyCode : e.which;
      if (keycode === 13) {
        // enter key
        renderSearchPage();
      }
    };

    $scope.nextPage = () => {
      const prev = $scope.curpagelog[$scope.tab];
      $scope.curpagelog[$scope.tab] = prev + 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      // 记录上一页，翻页失败时能退回（上一页通常已在缓存里）
      pageSnapshot = { group: currentGroup(), page: prev };
      loadCurrentPage();
    };

    $scope.previousPage = () => {
      const prev = $scope.curpagelog[$scope.tab];
      $scope.curpagelog[$scope.tab] = prev - 1;
      $scope.curpage = $scope.curpagelog[$scope.tab];
      pageSnapshot = { group: currentGroup(), page: prev };
      loadCurrentPage();
    };
  },
]);
