// mem 화면에서 실행: "부서 근태 현황"(li.user_gubn 목록)이 보이면 우리 조 줄만 읽어서 보냄
(() => {
  if (window.__gdMemWatcher) return;
  window.__gdMemWatcher = true;

  const t = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const pad = (x) => ('0' + x).slice(-2);
  let lastKey = '';
  let timer = null;

  async function scan() {
    const list = [...document.querySelectorAll('li.user_gubn')];
    if (!list.length) return;
    const { names } = await chrome.storage.local.get('names');
    const N = Array.isArray(names) && names.length ? names : ['유정', '민지', '가영'];
    const rows = [];
    for (const li of list) {
      const c = li.children;
      if (c.length < 2) continue;
      const times = c[0].querySelectorAll('span');
      const nameEl = c[1].querySelector('.bold');
      if (!nameEl || !nameEl.firstChild) continue;
      const name = t(nameEl.firstChild.textContent);
      if (!N.some((n) => name === n || name.endsWith(n))) continue; // 우리 조만
      const extra = c[2] ? c[2].querySelectorAll('span') : [];
      rows.push({
        name,
        start: t(times[0] && times[0].textContent),
        end: t(times[1] && times[1].textContent),
        status: t(c[1].children[1] && c[1].children[1].textContent),
        // 세 번째 칸 글자 모두 ('대체시차 15:30~18:00' 처럼 시차·반차 시간도)
        period: t([...extra].filter((s) => !s.querySelector('span')).map((s) => t(s.textContent)).filter(Boolean).join(' ')),
      });
    }
    if (!rows.length) return;
    const d = new Date();
    const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const key = date + JSON.stringify(rows);
    if (key === lastKey) return; // 바뀐 게 없으면 안 보냄
    lastKey = key;
    try {
      const res = await chrome.runtime.sendMessage({ type: 'mem-rows', date, rows });
      toast(res && res.dashboardOpen ? `🪼 2조 근태 ${rows.length}명 반영 ✓` : `🪼 2조 근태 ${rows.length}명 저장 · 대시보드를 열면 반영돼요`);
    } catch (e) {
      // 확장 프로그램이 업데이트된 직후 등: 조용히 넘어감
    }
  }

  function toast(text) {
    const el = document.createElement('div');
    el.textContent = text;
    Object.assign(el.style, {
      position: 'fixed', right: '18px', bottom: '18px', zIndex: 2147483647,
      background: '#8c2f3c', color: '#fff', padding: '10px 16px', borderRadius: '999px',
      font: '600 13px/1.2 "Malgun Gothic", sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.2)',
      transition: 'opacity .4s', opacity: '1',
    });
    document.body.appendChild(el);
    setTimeout(() => (el.style.opacity = '0'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(scan, 700);
  }).observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(scan, 500);
})();
