// 새 버전 알림: 사이트가 새로 올라가면 (index.html 의 스크립트 이름이 바뀜) 화면 아래에 '새로고침' 안내
//   오래 열어 둔 휴대폰 탭이 예전 화면에 머무르지 않게. 화면으로 돌아올 때 + 10분마다 확인
const scriptOf = (html: string) => html.match(/assets\/index-[\w-]+\.js/)?.[0] ?? '';

export function startUpdateCheck() {
  if (import.meta.env.DEV) return;
  const mine = [...document.scripts].map((s) => s.src.match(/assets\/index-[\w-]+\.js/)?.[0]).find(Boolean);
  if (!mine) return;
  let shown = false;
  const check = async () => {
    if (shown || document.visibilityState !== 'visible') return;
    try {
      const html = await (await fetch(`./index.html?v=${Date.now()}`, { cache: 'no-store' })).text();
      const now = scriptOf(html);
      if (now && now !== mine) show();
    } catch {
      /* 무시 (오프라인 등) */
    }
  };
  const show = () => {
    shown = true;
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.innerHTML = '<span>새 버전이 올라왔어요</span><button type="button">새로고침</button>';
    bar.querySelector('button')!.addEventListener('click', () => location.reload());
    document.body.appendChild(bar);
  };
  document.addEventListener('visibilitychange', () => void check());
  window.addEventListener('focus', () => void check());
  setInterval(() => void check(), 10 * 60 * 1000);
}
