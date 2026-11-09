const $ = (s) => document.querySelector(s);
const DASHBOARD_URL = 'https://karrotinab.github.io/GlobalDashboard/';
const fmt = (iso) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function render() {
  const { memOrigin, lastSent, pending, lastDelivered } = await chrome.storage.local.get(['memOrigin', 'lastSent', 'pending', 'lastDelivered']);
  $('#site').innerHTML = memOrigin
    ? `<span class="ok">✓ mem 등록됨</span><br><span class="muted">${memOrigin}</span>`
    : `<b>처음 한 번만:</b> mem에 로그인한 탭에서 아래 버튼을 눌러 주세요.`;
  $('#register').textContent = memOrigin ? '다른 주소로 다시 등록' : '지금 보고 있는 사이트를 mem으로 등록';
  $('#register').className = memOrigin ? 'ghost' : '';
  let st = '<span class="muted">아직 보낸 기록이 없어요. mem에서 부서 근태 현황을 열면 자동으로 보내요.</span>';
  if (lastSent) st = `마지막으로 읽음: <b>${fmt(lastSent.at)}</b><br><span class="muted">${lastSent.names.join(', ')}</span>`;
  if (pending) st += `<br><span class="muted">⏳ 대시보드를 열면 반영돼요</span>`;
  else if (lastDelivered) st += `<br><span class="ok">✓ 대시보드 반영 ${fmt(lastDelivered)}</span>`;
  $('#status').innerHTML = st;
}

$('#register').onclick = async () => {
  $('#msg').textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let url;
  try {
    url = new URL(tab.url);
  } catch {
    url = null;
  }
  if (!url || !/^https?:$/.test(url.protocol) || url.href.startsWith(DASHBOARD_URL)) {
    $('#msg').textContent = 'mem 사이트를 열어 둔 탭에서 눌러 주세요.';
    return;
  }
  const origin = `${url.origin}/*`;
  const ok = await chrome.permissions.request({ origins: [origin] });
  if (!ok) {
    $('#msg').textContent = '허용해야 mem 화면을 읽을 수 있어요.';
    return;
  }
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ['gd-mem'] });
  } catch {}
  await chrome.scripting.registerContentScripts([
    { id: 'gd-mem', matches: [origin], js: ['mem.js'], allFrames: true, runAt: 'document_idle', persistAcrossSessions: true },
  ]);
  await chrome.storage.local.set({ memOrigin: url.origin });
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['mem.js'] });
  } catch {}
  render();
};

$('#open').onclick = async () => {
  const tabs = await chrome.tabs.query({ url: DASHBOARD_URL + '*' });
  if (tabs[0]) chrome.tabs.update(tabs[0].id, { active: true });
  else chrome.tabs.create({ url: DASHBOARD_URL });
};

render();
