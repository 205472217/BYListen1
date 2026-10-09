/* eslint-disable import/no-unresolved */
/* eslint-disable global-require */
/* eslint-disable no-undef */
/* eslint-disable no-param-reassign */
/* global angular i18next sourceList platformSourceList */
angular.module('listenone').controller('ProfileController', [
  '$scope',
  '$rootScope',
  ($scope, $rootScope) => {
    let defaultLang = 'zh-CN';
    const supportLangs = ['zh-CN', 'en-US'];
    if (supportLangs.indexOf(navigator.language) !== -1) {
      defaultLang = navigator.language;
    }
    if (supportLangs.indexOf(localStorage.getObject('language')) !== -1) {
      defaultLang = localStorage.getObject('language');
    }
    $scope.lastestVersion = '';
    $scope.theme = '';
    $scope.proxyModes = [
      { name: 'system', displayId: '_PROXY_SYSTEM' },
      { name: 'direct', displayId: '_PROXY_DIRECT' },
      { name: 'custom', displayId: '_PROXY_CUSTOM' },
    ];

    [$scope.proxyModeInput] = $scope.proxyModes;
    [$scope.proxyMode] = $scope.proxyModes;
    $scope.proxyProtocols = ['http', 'https', 'quic', 'socks4', 'socks5'];

    $scope.proxyProtocol = 'http';
    $scope.proxyRules = '';

    $scope.changeProxyProtocol = (newProtocol) => {
      $scope.proxyProtocol = newProtocol;
    };

    $scope.changeProxyMode = (newMode) => {
      $scope.proxyModeInput = newMode;
    };

    $scope.setProxyConfig = () => {
      const mode = $scope.proxyModeInput.name;
      $scope.proxyMode = $scope.proxyModeInput;
      const host = document.getElementById('proxy-rules-host').value;
      const port = document.getElementById('proxy-rules-port').value;
      $scope.proxyRules = `${$scope.proxyProtocol}://${host}:${port}`;
      if (isElectron()) {
        const message = 'update_proxy_config';
        const { ipcRenderer } = require('electron');
        if (mode === 'system' || mode === 'direct') {
          ipcRenderer.send('control', message, { mode });
        } else {
          ipcRenderer.send('control', message, {
            proxyRules: $scope.proxyRules,
          });
        }
      }
    };

    $scope.getProxyConfig = () => {
      if (isElectron()) {
        // get proxy config from main process
        const message = 'get_proxy_config';
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('control', message);
      }
    };

    $scope.initProfile = () => {
      $scope.getProxyConfig();
    };

    if (isElectron()) {
      const { ipcRenderer } = require('electron');

      ipcRenderer.on('proxyConfig', (event, config) => {
        // parse config
        if (config.mode === 'system' || config.mode === 'direct') {
          [$scope.proxyMode] = $scope.proxyModes.filter(
            (i) => i.name === config.mode
          );
          $scope.proxyModeInput = $scope.proxyMode;
          $scope.proxyRules = '';
        } else {
          [$scope.proxyMode] = $scope.proxyModes.filter(
            (i) => i.name === 'custom'
          );
          $scope.proxyModeInput = $scope.proxyMode;
          $scope.proxyRules = config.proxyRules;
          // rules = 'socks5://127.0.0.1:1080'
          const match = /(\w+):\/\/([\d.]+):(\d+)/.exec(config.proxyRules);
          const [, protocol, host, port] = match;

          $scope.proxyProtocol = protocol;
          document.getElementById('proxy-rules-host').value = host;
          document.getElementById('proxy-rules-port').value = port;
        }
      });
    }
    $scope.setLang = (langKey) => {
      // You can change the language during runtime
      i18next.changeLanguage(langKey).then((t) => {
        axios.get('i18n/zh-CN.json').then((res) => {
          Object.keys(res.data).forEach((key) => {
            $scope[key] = t(key);
          });
          sourceList.forEach((item) => {
            item.displayText = t(item.displayId);
          });
          platformSourceList.forEach((item) => {
            item.displayText = t(item.displayId);
          });
          $scope.proxyModes.forEach((item) => {
            item.displayText = t(item.displayId);
          });
        });
        localStorage.setObject('language', langKey);
      });
    };
    $scope.setLang(defaultLang);

    let defaultTheme = 'white';
    if (localStorage.getObject('theme') !== null) {
      defaultTheme = localStorage.getObject('theme');
    }
    $scope.setTheme = (theme) => {
      $scope.theme = theme;

      const themeFiles = {
        white: ['css/iparanoid.css', 'css/common.css'],
        black: ['css/origin.css', 'css/common.css'],
        white2: ['css/iparanoid2.css', 'css/common2.css'],
        black2: ['css/origin2.css', 'css/common2.css'],
      };
      // You can change the language during runtime
      if (themeFiles[theme] !== undefined) {
        const keys = ['theme-css', 'common-css'];
        for (let i = 0; i < themeFiles[theme].length; i += 1) {
          document.getElementById(keys[i]).href = themeFiles[theme][i];
        }
        localStorage.setObject('theme', theme);
      }
      axios.get('images/feather-sprite.svg').then((res) => {
        document.getElementById('feather-container').innerHTML = res.data;
      });
    };
    $scope.setTheme(defaultTheme);

    // 云同步/本地恢复带进来的主题与语言要立刻生效，不必重启应用
    $rootScope.$on('settings:synced', (event, keys) => {
      if (!Array.isArray(keys)) {
        return;
      }
      if (keys.indexOf('theme') !== -1) {
        const theme = localStorage.getObject('theme');
        if (theme !== null) {
          $scope.setTheme(theme);
        }
      }
      if (keys.indexOf('language') !== -1) {
        const lang = localStorage.getObject('language');
        if (lang !== null) {
          $scope.setLang(lang);
        }
      }
    });
  },
]);
