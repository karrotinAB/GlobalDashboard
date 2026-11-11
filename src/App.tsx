import { useEffect, useState } from 'react';
import { useStore } from './data/store';
import { Cover } from './components/ui';
import { isLeader, logout, setViewAsMember, useAccess } from './components/AuthGate';
import { seedData } from './data/seed';
import { COLLECTIONS } from './data/backend';
import Home from './pages/Home';
import Todos from './pages/Todos';
import Orders from './pages/Orders';
import Claims from './pages/Claims';
import Settings from './pages/Settings';
import RequestBoard from './pages/RequestBoard';
import TradeHome from './pages/TradeHome';
import Overview from './pages/Overview';
import Import from './pages/Import';
import ExtensionBridge from './components/ExtensionBridge';
import Presence from './components/Presence';
import TeamSwitch from './components/TeamSwitch';
import { DEFAULT_TEAM, isPersonal } from './lib/team';

const PAGES = [
  { key: 'home', label: '홈', icon: 'jelly' },
  { key: 'todos', label: '주간 할일', icon: '📝' },
  { key: 'orders', label: '주문 관리', icon: '📦' },
  { key: 'claims', label: '클레임', icon: '🧾' },
  { key: 'settings', label: '설정', icon: '⚙️' },
  { key: 'requests', label: '무역사무요청', icon: '📨' },
  // 무역사무 페이지 (무역사무 계정 + 관리자)
  { key: 'thome', label: '홈', icon: 'jelly' },
  { key: 'twork', label: '업무', icon: '📋' },
  { key: 'overview', label: '조 현황', icon: '🔭' },
] as const;
type PageKey = (typeof PAGES)[number]['key'] | 'import';
const GOP_URL = 'https://karrotinab.github.io/pog-global/';
const TEAM_TABS: PageKey[] = ['home', 'todos', 'orders', 'claims'];
const TRADE_TABS: PageKey[] = ['thome', 'twork'];
const isTradePage = (p: PageKey) => TRADE_TABS.includes(p);

function readHash(): PageKey {
  const h = window.location.hash.replace('#/', '').replace('#', '').split('?')[0];
  if (h === 'import') return 'import';
  return (PAGES.find((p) => p.key === h)?.key ?? 'home') as PageKey;
}

export default function App() {
  const [hashPage, setPage] = useState<PageKey>(readHash);
  const { loading, error, mode, data, saveMany } = useStore();
  const { role, viewTeam, viewLabel, realRole } = useAccess();
  const leader = isLeader(role); // 팀장님·이사님
  const tradeOnly = role === 'trade'; // 무역사무 계정: 무역사무 페이지 + 설정만
  const canTrade = role === null || role === 'admin' || role === 'trade'; // 무역사무 페이지를 볼 수 있음 (무역사무·관리자·로컬)
  // '조 현황' 탭: 팀장님·이사님 대시보드에만 (관리자는 팀장님·이사님 대시보드를 볼 때만)
  const canOverview = leader || ((role === 'admin' || role === null) && isPersonal(viewTeam));
  const page: PageKey = tradeOnly
    ? isTradePage(hashPage) || hashPage === 'settings'
      ? hashPage
      : 'thome'
    : isTradePage(hashPage) && !canTrade
      ? 'home'
      : hashPage;
  // 설정 화면에서는 직전에 보던 쪽(2조/무역사무) 탭을 그대로
  const [side, setSide] = useState<'team' | 'trade'>(tradeOnly || isTradePage(page) ? 'trade' : 'team');
  useEffect(() => {
    if (tradeOnly) setSide('trade');
    else if (isTradePage(page)) setSide('trade');
    else if (page !== 'settings' && page !== 'import') setSide('team');
  }, [page, tradeOnly]);
  const tabs = side === 'trade' ? TRADE_TABS : canOverview ? [...TEAM_TABS, 'overview' as PageKey] : TEAM_TABS;
  const firstRun = !loading && !tradeOnly && mode === 'firestore' && data.members.length === 0 && page !== 'import';
  const isMainTeam = viewTeam === DEFAULT_TEAM; // 기본 담당자(유정·민지·가영)는 2조에만
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
      <Cover tall={page === 'home' || page === 'thome'} />
      <div className="top-actions">
        {realRole === 'admin' && role !== 'admin' && (
          <button className="top-btn as-member-btn" onClick={() => setViewAsMember(false)} title="지금은 일반 조원 화면으로 보는 중이에요">
            👤 일반 유저 화면 · 🛡 관리자로
          </button>
        )}
        {role !== 'trade' && !leader && canTrade && side === 'team' && (
          <TeamSwitch />
        )}
        {!tradeOnly && canTrade && (
          <a href={side === 'trade' ? '#/home' : '#/thome'} className="top-btn" title="관리자: 조 / 무역사무 페이지 오가기">
            {side === 'trade' ? `← ${viewLabel} 페이지` : '무역사무 페이지 →'}
          </a>
        )}
        {/* 관리자가 아닌 사람: 같은 자리에 Global Opening Prep 바로가기 (같은 주소라 한 번 로그인하면 계속 유지) */}
        {role !== 'admin' && role !== null && (
          <a href={GOP_URL} target="_blank" rel="noreferrer" className="top-btn" title="Global Opening Prep 열기 (새 탭)">
            Global Opening Prep ↗
          </a>
        )}
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
          {PAGES.filter((p) => tabs.includes(p.key)).map((p) => (
            <a key={p.key} href={`#/${p.key}`} className={page === p.key ? 'active' : ''}>
              <span aria-hidden="true" className="tab-icon">
                <PageIcon icon={p.icon} />
              </span>{' '}
              {p.label}
            </a>
          ))}
          {side === 'team' && (
            <a href="#/requests" className={`tab-request ${page === 'requests' ? 'active' : ''}`} title="무역사무에 업무 요청하기">
              <span aria-hidden="true">📨</span> 무역사무요청
            </a>
          )}
          {mode === 'firestore' ? (
            <Presence page={side === 'trade' ? page : `${viewTeam}:${page}`} />
          ) : (
            <span className="mode local" title="이 브라우저에만 저장 중">
              로컬 모드
            </span>
          )}
        </nav>
        {error && <div className="error-bar">{error}</div>}
        {firstRun && (
          <div className="card first-run">
            <span>
              🌱 {viewLabel} 데이터가 아직 없어요.{' '}
              {isMainTeam ? '백업 JSON 파일이 있으면 설정 → 백업 가져오기로 넣고, 없으면 담당자만 만들어서 시작할 수 있어요.' : '설정 → 담당자에서 조원을 추가하고, 업체는 주간 할일에서 직접 등록해요.'}
            </span>
            <button onClick={() => go('settings')}>설정으로 가기</button>
            {isMainTeam && (
              <button className="primary" onClick={loadSample}>
                담당자만 만들고 시작
              </button>
            )}
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
          ) : page === 'claims' ? (
            <Claims />
          ) : page === 'requests' ? (
            <RequestBoard key="team" side="team" />
          ) : page === 'overview' && canOverview ? (
            <Overview />
          ) : page === 'thome' ? (
            <TradeHome />
          ) : page === 'twork' ? (
            <RequestBoard key="trade" side="trade" />
          ) : (
            <Settings side={side} />
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
