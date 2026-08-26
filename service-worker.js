// 아주 기본적인 서비스 워커예요.
// 앱의 핵심 파일들을 캐시해둬서, 인터넷이 잠깐 끊겨도 앱이 열리게 해줘요.
// (설치 가능한 PWA가 되려면 서비스 워커가 하나는 있어야 해요)

const CACHE_NAME = 'couple-calendar-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(FILES_TO_CACHE))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
