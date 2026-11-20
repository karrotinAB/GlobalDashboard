// 홈 화면 앱(PWA)용 서비스 워커: 아무것도 저장(캐시)하지 않음 → 사이트를 올리면 휴대폰도 바로 새 버전
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
// (요청 가로채기 fetch 는 안 둠 — 아무것도 안 하는 fetch 도 모든 요청을 한 번 더 거치게 해서 느려짐)

// 휴대폰 알림 (서버가 보내는 웹 푸시: data = { title, body, link, tag })
self.addEventListener('push', (e) => {
  let p = {};
  try {
    p = e.data ? e.data.json() : {};
  } catch {
    p = { data: { title: 'Dashboard', body: e.data ? e.data.text() : '' } };
  }
  const d = p.data || p.notification || p;
  e.waitUntil(
    self.registration.showNotification(d.title || 'Dashboard', {
      body: d.body || '',
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: d.tag || undefined,
      data: { link: d.link || './#/home' },
    }),
  );
});

// 알림을 누르면 그 페이지로 (열린 창이 있으면 그 창에서)
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.link || './#/home', self.registration.scope).href;
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of wins) {
        if (w.url.startsWith(self.registration.scope)) {
          await w.focus();
          return w.navigate ? w.navigate(url) : undefined;
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
