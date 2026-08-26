// 아주 기본적인 서비스 워커예요.
// 앱의 핵심 파일들을 캐시해둬서, 인터넷이 잠깐 끊겨도 앱이 열리게 해줘요.

const CACHE_NAME = 'couple-calendar-v3'; // 버전 올릴 때마다 이 이름을 바꿔야 캐시가 갱신돼요
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
  // Firebase 서버 요청(실시간 데이터)은 서비스워커가 건드리지 않고 항상 통과시켜요
  if(event.request.url.includes('googleapis.com') || event.request.url.includes('gstatic.com')){
    return;
  }
  // 네트워크 우선: 인터넷이 되면 항상 최신 파일을 받아오고, 캐시도 그걸로 갱신해요.
  // 오프라인일 때만 예전에 저장해둔 캐시를 대신 보여줘요.
  // (예전엔 "캐시 우선"이라 새 파일을 올려도 계속 옛날 버전이 보이는 문제가 있었어요)
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const resClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
