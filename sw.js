/**
 * sw.js —— 离线缓存（只在 https / localhost 下能注册成功）
 *
 * 策略：
 *  - 页面导航（HTML）：网络优先，离线时回退缓存 → 保证更新后能立刻看到新版
 *  - 静态资源（js/css/图片）：缓存优先 + 后台更新 → 打开更快，升级也不用等
 * 学习记录数据本身在 localStorage / IndexedDB，SW 只负责"页面外壳"可离线打开。
 */
'use strict';

var CACHE_NAME = 'study-log-shell-v2';
var ASSETS = [
  './',
  './index.html',
  './styles.css',
  './store.js',
  './files.js',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE_NAME ? null : caches.delete(key);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function cachePut(request, response) {
  if (!response || response.status !== 200) return;
  caches.open(CACHE_NAME).then(function (cache) { cache.put(request, response); });
}

self.addEventListener('fetch', function (event) {
  var request = event.request;
  if (request.method !== 'GET') return;

  var url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;

  // 页面导航：网络优先，离线回退到缓存的 index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(function (response) {
        cachePut(request, response.clone());
        return response;
      }).catch(function () {
        return caches.match(request).then(function (hit) {
          return hit || caches.match('./index.html');
        });
      })
    );
    return;
  }

  // 静态资源：缓存优先，后台悄悄更新
  event.respondWith(
    caches.match(request).then(function (cached) {
      var network = fetch(request).then(function (response) {
        cachePut(request, response.clone());
        return response;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
