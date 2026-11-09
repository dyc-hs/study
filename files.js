/**
 * files.js —— 图片附件的本地存储（IndexedDB）
 *
 * 为什么不放进 localStorage：
 *  - localStorage 总共只有 ~5MB，几张错题截图就撑满；IndexedDB 存二进制，容量大得多。
 *  - 记录本身仍存 localStorage（小、同步、好调试），图片只存 id 引用，两边各司其职。
 *
 * 与 store.js 一样同时支持浏览器（window.StudyFiles）和 Node（module.exports，便于跑测试前的存在性检查）。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.StudyFiles = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DB_NAME = 'study-log-files';
  var DB_VERSION = 1;
  var STORE = 'attachments';

  var supported = (function () {
    try {
      return typeof indexedDB !== 'undefined' && indexedDB !== null;
    } catch (e) {
      return false;
    }
  })();

  var dbPromise = null;

  function openDB() {
    if (!supported) {
      return Promise.reject(new Error('当前浏览器不支持 IndexedDB，无法保存图片'));
    }
    if (dbPromise) return dbPromise;

    dbPromise = new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('打开图片库失败')); };
      request.onblocked = function () { reject(new Error('图片库被其它标签页占用，请关闭其它窗口后重试')); };
    });

    return dbPromise;
  }

  function withStore(mode, task) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var result;
        try {
          result = task(store);
        } catch (e) {
          reject(e);
          return;
        }
        tx.oncomplete = function () { resolve(result && result.__value !== undefined ? result.__value : result); };
        tx.onerror = function () { reject(tx.error || new Error('图片库操作失败')); };
        tx.onabort = function () { reject(tx.error || new Error('图片库操作被中断')); };
      });
    });
  }

  function put(id, blob) {
    return withStore('readwrite', function (store) {
      store.put(blob, id);
    });
  }

  function get(id) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, 'readonly');
        var request = tx.objectStore(STORE).get(id);
        request.onsuccess = function () { resolve(request.result || null); };
        request.onerror = function () { reject(request.error); };
      });
    });
  }

  function remove(id) {
    return withStore('readwrite', function (store) {
      store.delete(id);
    });
  }

  function removeMany(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return withStore('readwrite', function (store) {
      ids.forEach(function (id) { store.delete(id); });
    });
  }

  function clear() {
    return withStore('readwrite', function (store) {
      store.clear();
    });
  }

  return {
    supported: supported,
    put: put,
    get: get,
    remove: remove,
    removeMany: removeMany,
    clear: clear
  };
});
