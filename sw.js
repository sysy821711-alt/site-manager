const CACHE_NAME = 'site-manager-v15';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/db.js',
  './js/auth.js',
  './js/sync.js',
  './js/gantt.js',
  './js/attendance.js',
  './js/photos.js',
  './js/report.js',
  './js/projects.js',
  './js/dailylog.js',
  './js/todos.js',
  './js/app.js',
  './vendor/msal-browser.min.js',
  './vendor/pdf-lib.min.js',
  './vendor/fontkit.umd.min.js',
  './fonts/NotoSansTC-Regular.ttf',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
// 目前必要資源均隨 App 一起提供；保留選用清單供未來非關鍵資源使用。
const OPTIONAL_SHELL = [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL);
      await Promise.all(OPTIONAL_SHELL.map((url) => cache.add(url).catch(() => {})));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

// Network-first：每次都先試著抓最新版本，只有在離線／連線失敗時才退回快取，
// 避免已安裝在手機主畫面的 App 卡在舊版本。
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Microsoft Graph API 的請求絕不能被快取或攔截退回快取（會拿到過期/錯誤的資料）
  if (event.request.url.includes('graph.microsoft.com') || event.request.url.includes('login.microsoftonline.com')) return;
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(event.request, { cache: 'no-store' })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => {
        return caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('離線且尚未快取此資源', { status: 503, statusText: 'Service Unavailable' });
        });
      })
  );
});
