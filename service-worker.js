// 아주 기본적인 서비스 워커예요.
// 앱의 핵심 파일들을 캐시해둬서, 인터넷이 잠깐 끊겨도 앱이 열리게 해줘요.

const CACHE_NAME = 'couple-calendar-v2';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './app.js',
  './firebase-config.js',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
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
  // Firebase 서버 요청(실시간 데이터)은 캐시하지 않고 항상 최신으로 통과시켜요
  if(event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('googleapis.com')){
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
