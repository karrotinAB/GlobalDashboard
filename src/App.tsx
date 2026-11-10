import { useEffect, useState } from 'react';
import { useStore } from './data/store';
import { Cover } from './components/ui';
import { logout } from './components/AuthGate';
import { seedData } from './data/seed';
import { COLLECTIONS } from './data/backend';
import Home from './pages/Home';
import Todos from './pages/Todos';
import Orders from './pages/Orders';
import Settings from './pages/Settings';
import Import from './pages/Import';
import ExtensionBridge from './components/ExtensionBridge';

const PAGES = [
  { key: 'home', label: '홈', icon: 'jelly' },
  { key: 'todos', label: '주간 할일', icon: '📝' },
  { key: 'orders', label: '주문 관리', icon: '📦' },
  { key: 'settings', label: '설정', icon: '⚙️' },
] as const;
type PageKey = (typeof PAGES)[number]['key'] | 'import';

function readHash(): PageKey {
  const h = window.location.hash.replace('#/', '').replace('#', '').split('?')[0];
  if (h === 'import') return 'import';
  return (PAGES.find((p) => p.key === h)?.key ?? 'home') as PageKey;
}

export default function App() {
  const [page, setPage] = useState<PageKey>(readHash);
  const { loading, error, mode, data, saveMany } = useStore();
  const firstRun = !loading && mode === 'firestore' && data.members.length === 0 && page !== 'import';
  const loadSample = async () => {
    const s = seedData();
    for (const col of COLLECTIONS) if (col !== 'attendance') await saveMany(col, s[col] as never);
  };

  // 탭 줄 높이를 재서 검색 줄이 그 밑에 붙게 (--tabs-h)
  useEffect(() => {
    const tabs = document.querySelector('.tabs');
    if (!tabs) return;
    const set = () => document.documentElement.style.setProperty('--tabs-h', `${Math.round(tabs.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(tabs);
    return () => ro.disconnect();
  }, [loading]);

  useEffect(() => {
    const h = () => {
      setPage(readHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const go = (p: string) => {
    window.location.hash = `/${p}`;
  };
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0];

  return (
    <div className="app">
      <ExtensionBridge />
      <Cover tall={page === 'home'} />
      <div className="top-actions">
        <a href="#/settings" className={`top-btn ${page === 'settings' ? 'active' : ''}`} title="설정">
          ⚙️ 설정
        </a>
        {mode === 'firestore' && (
          <button className="top-btn" onClick={() => confirm('로그아웃할까요?') && logout()}>
            로그아웃
          </button>
        )}
      </div>
      <div className="shell">
        <div className="page-icon" aria-hidden="true">
          <PageIcon icon={current.icon} />
        </div>
        <nav className="tabs">
          {PAGES.filter((p) => p.key !== 'settings').map((p) => (
            <a key={p.key} href={`#/${p.key}`} className={page === p.key ? 'active' : ''}>
              <span aria-hidden="true" className="tab-icon">
                <PageIcon icon={p.icon} />
              </span>{' '}
              {p.label}
            </a>
          ))}
          <span className={`mode ${mode}`} title={mode === 'firestore' ? '팀원과 실시간 공유 중' : '이 브라우저에만 저장 중'}>
            {mode === 'firestore' ? '팀 공유 중' : '로컬 모드'}
          </span>
        </nav>
        {error && <div className="error-bar">{error}</div>}
        {firstRun && (
          <div className="card first-run">
            <span>🌱 아직 데이터가 없어요. 백업 JSON 파일이 있으면 설정 → 백업 가져오기로 넣고, 없으면 담당자만 만들어서 시작할 수 있어요.</span>
            <button onClick={() => go('settings')}>설정으로 가기</button>
            <button className="primary" onClick={loadSample}>
              담당자만 만들고 시작
            </button>
          </div>
        )}
        <main>
          {loading ? (
            <div className="page muted">불러오는 중…</div>
          ) : page === 'home' ? (
            <Home go={go} />
          ) : page === 'todos' ? (
            <Todos />
          ) : page === 'import' ? (
            <Import go={go} />
          ) : page === 'orders' ? (
            <Orders />
          ) : (
            <Settings />
          )}
        </main>
      </div>
    </div>
  );
}

/** 'jelly' 는 해파리 그림, 나머지는 이모지 */
function PageIcon({ icon }: { icon: string }) {
  return icon === 'jelly' ? <img className="jelly" src="./jelly.png" alt="" /> : <>{icon}</>;
}
