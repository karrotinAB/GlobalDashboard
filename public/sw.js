// 홈 화면 앱(PWA)용 서비스 워커: 아무것도 저장(캐시)하지 않음 → 사이트를 올리면 휴대폰도 바로 새 버전
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
