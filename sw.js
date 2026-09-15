const CACHE_NAME = 'site-manager-v2';
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
  './js/photos.js',
  './js/report.js',
  './js/projects.js',
  './js/dailylog.js',
  './js/todos.js',
  './js/app.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
// 外部函式庫（MSAL、pdf-lib）與中文字型檔：非必要資源，快取失敗不該讓整個安裝失敗；
// 字型檔有 7MB，特意不放進 APP_SHELL（避免拖慢安裝），第一次匯出報告時才會下載並快取。
const OPTIONAL_SHELL = [
  'https://cdn.jsdelivr.net/npm/@azure/msal-browser@3.24.0/lib/msal-browser.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js',
  'https://cdn.jsdelivr.net/npm/@pdf-lib/fontkit@1.1.1/dist/fontkit.umd.min.js',
  './fonts/NotoSansTC-Regular.ttf'
];

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
