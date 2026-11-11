// 2조 근태 보내기 – 가운데 연결 역할
// mem 화면(mem.js)에서 읽은 우리 조 근태를 받아서, 열려 있는 대시보드 탭(dashboard.js)에 넘겨줌.
// 대시보드가 안 열려 있으면 보관해 두었다가 대시보드를 열 때 넘김.
const DASHBOARD = 'https://karrotinab.github.io/GlobalDashboard/*';

async function deliverToDashboards(pending) {
  const tabs = await chrome.tabs.query({ url: DASHBOARD });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: 'deliver', payload: pending }).catch(() => {});
  }
  return tabs.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'mem-rows') {
      const pending = { key: `${msg.date}|${Date.now()}`, date: msg.date, rows: msg.rows };
      await chrome.storage.local.set({ pending, lastSent: { at: new Date().toISOString(), names: msg.rows.map((r) => r.name) } });
      chrome.action.setBadgeBackgroundColor({ color: '#8c2f3c' });
      chrome.action.setBadgeText({ text: '…' });
      const open = await deliverToDashboards(pending);
      sendResponse({ dashboardOpen: open > 0 });
    } else if (msg.type === 'get-pending') {
      const { pending } = await chrome.storage.local.get('pending');
      sendResponse(pending ?? null);
    } else if (msg.type === 'delivered') {
      const { pending } = await chrome.storage.local.get('pending');
      if (pending && pending.key === msg.key) {
        await chrome.storage.local.remove('pending');
        chrome.action.setBadgeText({ text: '' });
      }
      await chrome.storage.local.set({ lastDelivered: new Date().toISOString() });
      sendResponse(true);
    } else if (msg.type === 'names') {
      if (Array.isArray(msg.names) && msg.names.length) await chrome.storage.local.set({ names: msg.names.slice(0, 200) });
      sendResponse(true);
    }
  })();
  return true; // 비동기 응답
});
