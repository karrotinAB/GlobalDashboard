import { Suspense, useEffect, useState, useTransition } from 'react';
import { lazyPage, PageErrorBoundary } from './lib/lazyPage';
// 가끔 쓰는 무거운 페이지는 처음 열 때만 따로 받음 (앱 처음 켜는 속도)
const TradeExport = lazyPage(() => import('./pages/TradeExport'));
const Translate = lazyPage(() => import('./pages/Translate'));
const Trip = lazyPage(() => import('./pages/Trip'));
const Contracts = lazyPage(() => import('./pages/Contracts'));
const Calendar = lazyPage(() => import('./pages/Calendar'));
const Import = lazyPage(() => import('./pages/Import'));
const Reports = lazyPage(() => import('./pages/Reports'));
const Settings = lazyPage(() => import('./pages/Settings'));
const Petty = lazyPage(() => import('./pages/Petty'));
import { BirthdayBubbles, BirthdayWishPopup } from './components/BirthdayWish';
import { rectOf } from './lib/zoom';
import AddressBook from './components/AddressBook';
import TradeMemo from './pages/TradeMemo';
import ToolsMenu, { TOOLS } from './components/ToolsMenu';
import ProfileMenu from './components/ProfileMenu';
import ReportTaskSync from './components/ReportTaskSync';
import { useReportAlert } from './lib/reports';
import { useStore } from './data/store';
import { Cover } from './components/ui';
import { isLeader, logout, useAccess } from './components/AuthGate';
import { seedData } from './data/seed';
import { COLLECTIONS } from './data/backend';
import Home from './pages/Home';
import Todos from './pages/Todos';
import Orders from './pages/Orders';
import Claims from './pages/Claims';
import RequestBoard from './pages/RequestBoard';
import TradeHome from './pages/TradeHome';
import Overview from './pages/Overview';
import ExtensionBridge from './components/ExtensionBridge';
import Presence from './components/Presence';
import TeamSwitch from './components/TeamSwitch';
import { useA4Fit } from './lib/a4fit';
import { DEFAULT_TEAM, isPersonal } from './lib/team';

const PAGES = [
  { key: 'home', label: '홈', icon: 'jelly' },
  { key: 'todos', label: '주간 할일', icon: '📝' },
  { key: 'orders', label: '주문 관리', icon: '📦' },
  { key: 'claims', label: '클레임', icon: '🧾' },
  { key: 'settings', label: '설정', icon: '⚙️' },
  { key: 'requests', label: '무역사무요청', icon: '📨' },
  { key: 'reports', label: '보고방', icon: '📑' },
  // 무역사무 페이지 (무역사무 계정 + 관리자)
  { key: 'thome', label: '홈', icon: 'jelly' },
  { key: 'twork', label: '업무', icon: '📋' },
  { key: 'tmemo', label: '업체 메모', icon: '📝' },
  { key: 'texport', label: '수출매출', icon: '🚢' },
  { key: 'treports', label: '보고방', icon: '📑' },
  { key: 'translate', label: '제품번역', icon: '🌐' },
  { key: 'trip', label: '출장신청서', icon: '✈️' },
  { key: 'contract', label: '계약서', icon: '📄' },
  { key: 'petty', label: '전도금', icon: '💰' },
  { key: 'overview', label: '조 현황', icon: '🔭' },
  { key: 'calendar', label: '달력', icon: '📅' },
] as const;
type PageKey = (typeof PAGES)[number]['key'] | 'import';
const GOP_URL = 'https://karrotinab.github.io/Global-Opening-Prep/';
// 달력은 탭이 아니라 홈 제목 줄 오른쪽 버튼으로 (#/calendar)
const TEAM_TABS: PageKey[] = ['home', 'todos', 'orders', 'claims'];
const TRADE_TABS: PageKey[] = ['thome', 'twork', 'tmemo'];
const isTradePage = (p: PageKey) => TRADE_TABS.includes(p) || p === 'texport' || p === 'treports';

function readHash(): PageKey {
  const h = window.location.hash.replace('#/', '').replace('#', '').split('?')[0];
  if (h === 'import') return 'import';
  return (PAGES.find((p) => p.key === h)?.key ?? 'home') as PageKey;
}

export default function App() {
  const [hashPage, setPage] = useState<PageKey>(readHash);
  useA4Fit(); // A4 종이는 좁은 화면에서 폭에 맞게
  // 탭을 누르면 바로 위에 로딩 막대 (새 페이지를 그리는 동안)
  const [navPending, startNav] = useTransition();
  const { loading, error, mode, data, saveMany } = useStore();
  const { role, viewTeam, viewLabel } = useAccess();
  const leader = isLeader(role); // 팀장님·이사님
  const tradeOnly = role === 'trade'; // 무역사무 계정: 무역사무 페이지 + 설정만
  const canTrade = role === null || role === 'admin' || role === 'trade'; // 무역사무 페이지를 볼 수 있음 (무역사무·관리자·로컬)
  // '조 현황' 탭: 팀장님·이사님 대시보드에만 (관리자는 팀장님·이사님 대시보드를 볼 때만)
  const canOverview = leader || ((role === 'admin' || role === null) && isPersonal(viewTeam));
  const page: PageKey = tradeOnly
    ? isTradePage(hashPage) || hashPage === 'settings' || hashPage === 'calendar' || hashPage === 'translate' || hashPage === 'petty' || hashPage === 'trip' || hashPage === 'contract'
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
    else if (page !== 'settings' && page !== 'import' && page !== 'calendar') setSide('team'); // 달력·설정은 보던 쪽 그대로
  }, [page, tradeOnly]);
  // 조 현황은 홈 바로 옆에
  const tabs = side === 'trade' ? TRADE_TABS : canOverview ? ['home' as PageKey, 'overview' as PageKey, ...TEAM_TABS.filter((t) => t !== 'home')] : TEAM_TABS;
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
    const set = () => document.documentElement.style.setProperty('--tabs-h', `${Math.round(rectOf(tabs).height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(tabs);
    return () => ro.disconnect();
  }, [loading]);

  useEffect(() => {
    // 탭을 누르면 메뉴(서랍 닫기 · 탭 표시)가 먼저 반응하고, 새 페이지는 그 뒤에 그림
    const h = () => {
      startNav(() => setPage(readHash()));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);

  const [drawer, setDrawer] = useState(false);
  // 서랍 메뉴 › 도구함: 기본 접힘 (도구 페이지에 있으면 펼침)
  const [toolsOpen, setToolsOpen] = useState(false);
  useEffect(() => {
    if (TOOLS.some((t) => t.key === page)) setToolsOpen(true);
  }, [page]);
  // 보고방 빨간 점: 우리 조 보고에 팀장님·이사님 새 답변 (조 화면에서만)
  const { email: myEmail } = useAccess();
  const leaderRole = role === 'lead' || role === 'director' ? role : null;
  const reportAlert = useReportAlert(isPersonal(viewTeam) ? null : viewTeam, !tradeOnly && (!isPersonal(viewTeam) || !!leaderRole), myEmail, isPersonal(viewTeam) ? leaderRole : null);
  const tradeReportAlert = useReportAlert('trade', canTrade && !leader, myEmail);
  const go = (p: string) => {
    window.location.hash = `/${p}`;
  };
  const current = PAGES.find((p) => p.key === page) ?? PAGES[0];

  // 휴대폰: 위쪽 메뉴·탭 대신 ☰ 옆 서랍
  const pageTitle = page === 'home' ? `${viewLabel} Dashboard` : page === 'thome' ? '무역사무 Dashboard' : current.label;
  const closeDrawer = () => setDrawer(false);
  return (
    <div className="app">
      <ExtensionBridge />
      <ReportTaskSync />
      <div className="mobile-bar">
        <button className="mb-menu" onClick={() => setDrawer(true)} aria-label="메뉴 열기">
          ☰
        </button>
        {/* 페이지 제목: 위쪽 바 가운데 */}
        <div className="mb-center">
          <span className="mb-icon" aria-hidden="true">
            <PageIcon icon={current.icon} />
          </span>
          <b className="mb-title">{pageTitle}</b>
        </div>
        <span className="mb-right">
          {mode === 'firestore' && <Presence page={side === 'trade' ? `trade:${page}` : `${viewTeam}:${page}`} />}
        </span>
      </div>
      {drawer && (
        <div className="drawer-bg" onClick={closeDrawer}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <b>{side === 'trade' ? '무역사무' : viewLabel}</b>
              <button className="icon-btn" onClick={closeDrawer} aria-label="닫기">
                ✕
              </button>
            </div>
            {role !== 'trade' && !leader && canTrade && side === 'team' && (
              <div className="drawer-switch">
                <TeamSwitch />
              </div>
            )}
            <nav className="drawer-nav" onClick={closeDrawer}>
              {tabs.map((k) => PAGES.find((p) => p.key === k)!).map((p) => (
                <a key={p.key} href={`#/${p.key}`} className={page === p.key ? 'active' : ''}>
                  <span className="tab-icon" aria-hidden="true">
                    <PageIcon icon={p.icon} />
                  </span>
                  {p.label}
                </a>
              ))}
              {side === 'team' && (
                <a href="#/reports" className={page === 'reports' ? 'active' : ''}>
                  <span className="tab-icon" aria-hidden="true">
                    📑
                  </span>
                  보고방
                  {reportAlert && <span className="tab-dot" />}
                </a>
              )}
              {side === 'team' && (
                <a href="#/requests" className={page === 'requests' ? 'active' : ''}>
                  <span className="tab-icon" aria-hidden="true">
                    📨
                  </span>
                  무역사무요청
                </a>
              )}
              {side === 'trade' && (
                <a href="#/treports" className={page === 'treports' ? 'active' : ''}>
                  <span className="tab-icon" aria-hidden="true">
                    📑
                  </span>
                  보고방
                  {tradeReportAlert && <span className="tab-dot" />}
                </a>
              )}
              {side === 'trade' && (
                <a href="#/texport" className={page === 'texport' ? 'active' : ''}>
                  <span className="tab-icon" aria-hidden="true">
                    🚢
                  </span>
                  수출매출
                </a>
              )}
            </nav>
            {/* 줄 위: 주소록 · 번역 / 줄 아래: 다른 페이지로 가는 링크 · 설정 · 로그아웃 */}
            <div className="drawer-foot drawer-ab">
              {mode === 'firestore' && <AddressBook />}
              {/* 도구함: 기본은 접힘 · 누르면 펼침 (지금 도구 페이지에 있으면 펼쳐 둠) */}
              <button className={`drawer-tools-head ${toolsOpen ? 'open' : ''}`} onClick={() => setToolsOpen(!toolsOpen)} aria-expanded={toolsOpen}>
                🧰 도구함 <span className="drawer-tools-caret">{toolsOpen ? '▴' : '▾'}</span>
              </button>
              {toolsOpen && TOOLS.map((t) =>
                t.ready ? (
                  <a key={t.key} href={t.href} className={`drawer-tool ${page === t.key ? 'active' : ''}`} onClick={closeDrawer}>
                    {t.icon} {t.label}
                  </a>
                ) : (
                  <span key={t.key} className="drawer-tool soon">
                    {t.icon} {t.label} <span className="tag gray small">준비 중</span>
                  </span>
                ),
              )}
              <a href="#/petty" className={page === 'petty' ? 'active' : ''} onClick={closeDrawer}>
                💰 전도금
              </a>
            </div>
            <div className="drawer-foot" onClick={closeDrawer}>
              {!tradeOnly && canTrade && <a href={side === 'trade' ? '#/home' : '#/thome'}>{side === 'trade' ? `← ${viewLabel} 페이지` : '무역사무 페이지 →'}</a>}
              {role !== 'admin' && role !== null && (
                <a href={GOP_URL} target="_blank" rel="noreferrer">
                  Global Opening Prep ↗
                </a>
              )}
              <a href="#/settings" className={page === 'settings' ? 'active' : ''}>
                ⚙️ 설정
              </a>
              {mode === 'firestore' && <button onClick={() => confirm('로그아웃할까요?') && logout()}>로그아웃</button>}
            </div>
          </aside>
        </div>
      )}
      <Cover tall={page === 'home' || page === 'thome'}>
        <BirthdayBubbles tall={page === 'home' || page === 'thome'} />
      </Cover>
      <BirthdayWishPopup />
      <div className="top-actions">
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
          <a href={GOP_URL} target="_blank" rel="noreferrer" className="top-btn gop-btn" title="Global Opening Prep 열기 (새 탭)">
            Global Opening Prep ↗
          </a>
        )}
        {mode === 'firestore' && <AddressBook className="top-btn" />}
        {/* 도구함 (번역 · 출장신청서 · 계약서 …) · 설정·로그아웃은 프로필 동그라미 안으로 */}
        <ToolsMenu page={page} />
        <ProfileMenu />
      </div>
      <div className="shell">
        <div className="page-icon" aria-hidden="true">
          <PageIcon icon={current.icon} />
        </div>
        <nav className="tabs">
          {tabs.map((k) => PAGES.find((p) => p.key === k)!).map((p) => (
            <a key={p.key} href={`#/${p.key}`} className={page === p.key ? 'active' : ''}>
              <span aria-hidden="true" className="tab-icon">
                <PageIcon icon={p.icon} />
              </span>{' '}
              {p.label}
            </a>
          ))}
          {side === 'team' && (
            <a href="#/reports" className={`tab-request tab-report ${page === 'reports' ? 'active' : ''}`} title="보고방 (우리 조 · 팀장님 · 이사님)">
              <span aria-hidden="true">📑</span> 보고방
              {reportAlert && <span className="tab-dot" title="팀장님·이사님 새 답변" />}
            </a>
          )}
          {side === 'team' && (
            <a href="#/requests" className={`tab-request ${page === 'requests' ? 'active' : ''}`} title="무역사무에 업무 요청하기">
              <span aria-hidden="true">📨</span> 무역사무요청
            </a>
          )}
          {side === 'trade' && (
            <a href="#/treports" className={`tab-request tab-report ${page === 'treports' ? 'active' : ''}`} title="무역사무 보고방 (무역사무 · 팀장님 · 이사님)">
              <span aria-hidden="true">📑</span> 보고방
              {tradeReportAlert && <span className="tab-dot" title="팀장님·이사님 새 답변" />}
            </a>
          )}
          {side === 'trade' && (
            <a href="#/texport" className={`tab-request ${page === 'texport' ? 'active' : ''}`} title="1·2·3조 판매 데이터 · 수출 매출 · 비중">
              <span aria-hidden="true">🚢</span> 수출매출
            </a>
          )}
          {mode === 'firestore' ? (
            <Presence page={side === 'trade' ? `trade:${page}` : `${viewTeam}:${page}`} />
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
        {navPending && <div className="nav-progress" aria-hidden="true" />}
        <main>
          <PageErrorBoundary resetKey={page}>
          <Suspense fallback={<div className="page muted">불러오는 중…</div>}>
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
          ) : page === 'calendar' ? (
            <Calendar />
          ) : page === 'overview' && canOverview ? (
            <Overview />
          ) : page === 'thome' ? (
            <TradeHome />
          ) : page === 'twork' ? (
            <RequestBoard key="trade" side="trade" />
          ) : page === 'tmemo' ? (
            <TradeMemo />
          ) : page === 'texport' ? (
            <TradeExport />
          ) : page === 'reports' && !tradeOnly ? (
            <Reports />
          ) : page === 'translate' ? (
            <Translate />
          ) : page === 'petty' ? (
            <Petty />
          ) : page === 'trip' ? (
            <Trip />
          ) : page === 'contract' ? (
            <Contracts />
          ) : page === 'treports' ? (
            <Reports key="trade" space="trade" />
          ) : (
            <Settings side={side} />
          )}
          </Suspense>
          </PageErrorBoundary>
        </main>
        <footer className="site-footer">© 2026 Karrot in AB</footer>
      </div>
    </div>
  );
}

/** 'jelly' 는 해파리 그림, 나머지는 이모지 */
function PageIcon({ icon }: { icon: string }) {
  return icon === 'jelly' ? <img className="jelly" src="./jelly.png" alt="" /> : <>{icon}</>;
}
