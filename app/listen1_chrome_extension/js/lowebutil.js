/* eslint-disable consistent-return */
/* eslint-disable no-param-reassign */
/* eslint-disable no-unused-vars */

function getParameterByName(name, url) {
  if (!url) url = window.location.href;
  name = name.replace(/[[\]]/g, '\\$&');
  const regex = new RegExp(`[?&]${name}(=([^&#]*)|&|#|$)`);

  const results = regex.exec(url);
  if (!results) return null;
  if (!results[2]) return '';
  return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

function isElectron() {
  return window && window.process && window.process.type;
}

function cookieGet(cookieRequest, callback) {
  if (!isElectron()) {
    return chrome.cookies.get(cookieRequest, (cookie) => {
      callback(cookie);
    });
  }
  try {
    const remote = require('@electron/remote'); // eslint-disable-line
    remote.session.defaultSession.cookies
      .get(cookieRequest)
      .then((cookieArray) => {
        let cookie = null;
        if (cookieArray.length > 0) {
          [cookie] = cookieArray;
        }
        callback(cookie);
      })
      // 读取失败也必须回调，否则依赖 cookie 的流程（如网易云登录态）会永久挂起
      .catch(() => callback(null));
  } catch (error) {
    callback(null);
  }
}

function cookieSet(cookie, callback) {
  if (!isElectron()) {
    return chrome.cookies.set(cookie, (arg1, arg2) => {
      callback(arg1, arg2);
    });
  }
  try {
    const remote = require('@electron/remote'); // eslint-disable-line
    remote.session.defaultSession.cookies
      .set(cookie)
      .then((arg1, arg2) => {
        callback(null, arg1, arg2);
      })
      // 写失败也要回调，避免调用方一直等
      .catch(() => callback(null));
  } catch (error) {
    callback(null);
  }
}
function cookieRemove(cookie, callback) {
  if (!isElectron()) {
    return chrome.cookies.remove(cookie, (arg1, arg2) => {
      callback(arg1, arg2);
    });
  }
  try {
    const remote = require('@electron/remote'); // eslint-disable-line
    remote.session.defaultSession.cookies
      .remove(cookie.url, cookie.name)
      .then((arg1, arg2) => {
        callback(null, arg1, arg2);
      })
      // 删除失败也要回调，避免调用方一直等
      .catch(() => callback(null));
  } catch (error) {
    callback(null);
  }
}

// ---------- localStorage 写入通知 ----------
// 云同步用：设置项（主题/语言/播放设置…）的写入散落在各个 setter 里，
// 与其逐个改造，不如在唯一的写入通道 localStorage.setObject 上挂一个观察点。
// 合并云端数据时自己会大量写入，用 muteLocalStorageChange 包住避免自触发回推。
const localStorageChangeCallbacks = [];
let localStorageChangeMuted = 0;

function onLocalStorageChange(callback) {
  localStorageChangeCallbacks.push(callback);
  return () => {
    const index = localStorageChangeCallbacks.indexOf(callback);
    if (index !== -1) {
      localStorageChangeCallbacks.splice(index, 1);
    }
  };
}

function muteLocalStorageChange(fn) {
  localStorageChangeMuted += 1;
  try {
    return fn();
  } finally {
    localStorageChangeMuted -= 1;
  }
}

function notifyLocalStorageChange(key) {
  if (localStorageChangeMuted > 0) {
    return;
  }
  // 复制一份再遍历：观察者里可能会取消订阅
  localStorageChangeCallbacks.slice().forEach((callback) => {
    try {
      callback(key);
    } catch (error) {
      // 观察者抛错不能影响写入本身
    }
  });
}

function setPrototypeOfLocalStorage() {
  const proto = Object.getPrototypeOf(localStorage);
  proto.getObject = function getObject(key) {
    const value = this.getItem(key);
    try {
      return value && JSON.parse(value);
    } catch (error) {
      return {};
    }
  };
  proto.setObject = function setObject(key, value) {
    this.setItem(key, JSON.stringify(value));
    notifyLocalStorageChange(key);
  };
  Object.setPrototypeOf(localStorage, proto);
}

function getLocalStorageValue(key, defaultValue) {
  const keyString = localStorage.getItem(key);
  let result = keyString && JSON.parse(keyString);
  if (result === null) {
    result = defaultValue;
  }
  return result;
}

function easeInOutQuad(t, b, c, d) {
  // t = current time
  // b = start value
  // c = change in value
  // d = duration
  t /= d / 2;
  if (t < 1) return (c / 2) * t * t + b;
  t -= 1;
  return (-c / 2) * (t * (t - 2) - 1) + b;
}

function smoothScrollTo(element, to, duration) {
  const start = element.scrollTop;
  const change = to - start;
  const startTime = performance.now();

  const animateScroll = (currentTime) => {
    const timeElapsed = currentTime - startTime;
    const val = easeInOutQuad(timeElapsed, start, change, duration);
    element.scrollTop = val;
    if (timeElapsed < duration) {
      requestAnimationFrame(animateScroll);
    } else {
      element.scrollTop = to; // Ensure it ends exactly at 'to'
    }
  };
  requestAnimationFrame(animateScroll);
}
