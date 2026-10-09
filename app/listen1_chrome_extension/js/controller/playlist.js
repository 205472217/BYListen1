/* eslint-disable no-unused-vars */
/* global angular MediaService sourceList */

angular.module('listenone').controller('PlayListController', [
  '$scope',
  '$timeout',
  ($scope) => {
    $scope.result = [];
    $scope.tab = sourceList[0].name;
    $scope.sourceList = sourceList;
    $scope.playlistFilters = {};
    $scope.allPlaylistFilters = {};
    $scope.currentFilterId = '';
    $scope.loading = true;
    $scope.showMore = false;
    // 是否已经到底：平台不支持分页 / 这一页没有新内容时置 true，停止继续翻页
    $scope.finished = false;

    // 追加一页歌单，按 id 去重。若这一页没带来任何新内容，说明平台不支持分页
    // 或已经到底，直接停下；否则会出现「往下滚又刷出同一批内容」的死循环
    // （酷我 getRcmPlayList 忽略 pn，表现就是 1-10、11-20 完全一样、滚动条没有尽头）。
    function appendPlaylists(newItems, noMore) {
      const list = Array.isArray(newItems) ? newItems : [];
      const seen = {};
      $scope.result.forEach((item) => {
        seen[item.id] = true;
      });
      const fresh = list.filter((item) => item && !seen[item.id]);
      if (fresh.length === 0) {
        $scope.finished = true;
      } else {
        $scope.result = $scope.result.concat(fresh);
      }
      if (noMore) {
        $scope.finished = true;
      }
      $scope.loading = false;
    }

    $scope.$on('infinite_scroll:hit_bottom', (event, data) => {
      if ($scope.loading === true || $scope.finished === true) {
        return;
      }
      $scope.loading = true;
      const offset = $scope.result.length;
      MediaService.showPlaylistArray(
        $scope.tab,
        offset,
        $scope.currentFilterId
      ).success((res) => {
        const response = res || {};
        appendPlaylists(response.result, response.noMore);
      });
    });

    $scope.loadPlaylist = () => {
      const offset = 0;
      $scope.showMore = false;
      $scope.loading = true;
      $scope.finished = false;
      MediaService.showPlaylistArray(
        $scope.tab,
        offset,
        $scope.currentFilterId
      ).success((res) => {
        const response = res || {};
        $scope.result = Array.isArray(response.result)
          ? response.result
          : [];
        $scope.finished = !!response.noMore;
        $scope.loading = false;
      });

      if (
        $scope.playlistFilters[$scope.tab] === undefined &&
        $scope.allPlaylistFilters[$scope.tab] === undefined
      ) {
        MediaService.getPlaylistFilters($scope.tab).success((res) => {
          $scope.playlistFilters[$scope.tab] = res.recommend;
          $scope.allPlaylistFilters[$scope.tab] = res.all;
        });
      }
    };

    $scope.changeTab = (newTab) => {
      $scope.tab = newTab;
      $scope.result = [];
      $scope.currentFilterId = '';
      $scope.loadPlaylist();
    };

    $scope.changeFilter = (filterId) => {
      $scope.result = [];
      $scope.currentFilterId = filterId;
      $scope.loadPlaylist();
    };

    $scope.toggleMorePlaylists = () => {
      $scope.showMore = !$scope.showMore;
    };
  },
]);
