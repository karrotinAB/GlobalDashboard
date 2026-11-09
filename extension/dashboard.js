// 대시보드 화면에서 실행: 확장 프로그램이 받은 근태를 대시보드 페이지에 넘겨줌 (저장은 로그인된 대시보드가 함)
let ready = false;
const post = (data) => window.postMessage(data, location.origin);

async function sendPending() {
  try {
    const pending = await chrome.runtime.sendMessage({ type: 'get-pending' });
    if (pending) post({ type: 'gd-ext-import', payload: pending });
  } catch (e) {}
}

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || typeof e.data !== 'object') return;
  if (e.data.type === 'gd-page-ready') {
    ready = true;
    chrome.runtime.sendMessage({ type: 'names', names: e.data.names }).catch(() => {});
    sendPending();
  }
  if (e.data.type === 'gd-ext-ack') chrome.runtime.sendMessage({ type: 'delivered', key: e.data.key }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'deliver' && ready) post({ type: 'gd-ext-import', payload: msg.payload });
});

post({ type: 'gd-ext-hello' }); // 페이지가 준비됐으면 gd-page-ready 로 답함
