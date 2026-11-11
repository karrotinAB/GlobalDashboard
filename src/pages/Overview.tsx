// 조 현황 (팀장님·이사님·관리자): 1~3조의 이번 주 할일 · 주문 · 클레임을 한눈에 (읽기 전용)
// 조 대시보드에 '들어가는' 게 아니라, 모든 조 정보를 한 화면에서 확인하는 용도
import { useMemo, useState, type CSSProperties } from 'react';
import { useSpaceData, useStore } from '../data/store';
import { isOpen, sortRequests, teamOfRequest, workload } from '../lib/trade';
import { PriorityTag, StatusTag } from '../components/RequestParts';
import type { TradeRequest } from '../types';
import { TEAMS, teamLabel } from '../lib/team';
import { tasksForWeek, dueState } from '../lib/tasks';
import { today, weekStart, shortDate } from '../lib/date';
import { isOrderDone, ORDER_STEPS, type Claim, type CollectionName, type Company, type Member, type Order, type Task } from '../types';
import { fmtFX, fmtKRW } from '../components/OrderCells';
import { Modal, Ring } from '../components/ui';

const COLS: CollectionName[] = ['members', 'companies', 'tasks', 'orders', 'claims'];
type View = 'todos' | 'orders' | 'claims' | 'trade';

interface TeamData {
  team: string;
  label: string;
  members: Member[];
  companies: Company[];
  tasks: Task[];
  orders: Order[];
  claims: Claim[];
  ready: boolean;
  error: string | null;
}

const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');
const sumOf = (list: Order[], k: 'amountKRW' | 'amountForeign') => list.reduce((a, o) => a + (o[k] ?? 0), 0);
/** 금액이 하나라도 있으면 합계, 없으면 빈칸 */
const amtK = (list: Order[]) => (list.some((o) => o.amountKRW !== undefined) ? fmtKRW(sumOf(list, 'amountKRW')) : '');
const amtF = (list: Order[]) => (list.some((o) => o.amountForeign !== undefined) ? fmtFX(sumOf(list, 'amountForeign')) : '');

export default function Overview() {
  // 조마다 읽기 전용 구독 (조 수는 고정이라 훅 순서가 바뀌지 않음)
  const raw = TEAMS.map((t) => ({ team: t, ...useSpaceData(t, COLS) }));
  const teams: TeamData[] = raw.map((r) => ({
    team: r.team,
    label: teamLabel(r.team),
    members: [...((r.data.members as Member[]) ?? [])].sort((a, b) => a.order - b.order),
    companies: [...((r.data.companies as Company[]) ?? [])].sort((a, b) => a.order - b.order),
    tasks: (r.data.tasks as Task[]) ?? [],
    orders: (r.data.orders as Order[]) ?? [],
    claims: (r.data.claims as Claim[]) ?? [],
    ready: r.ready,
    error: r.error,
  }));
  const [view, setView] = useState<View>('todos');
  // 무역사무: 요청·담당자는 모두가 같이 쓰는 데이터라 내 저장소에 이미 있음
  const { data } = useStore();
  const tradePeople = useMemo(() => [...data.tradeMembers].sort((a, b) => a.order - b.order), [data.tradeMembers]);
  const [only, setOnlyState] = useState(''); // '' = 모든 조
  const [co, setCo] = useState(''); // '조:업체id' — 고른 업체만
  const setOnly = (v: string | ((x: string) => string)) => {
    setOnlyState(v);
    setCo('');
  };
  const [q, setQ] = useState('');
  const todayIso = today();
  const monday = weekStart(todayIso);
  const shown = teams.filter((t) => !only || t.team === only);
  // 업체를 고르면 그 조의 그 업체 내용만
  const picked = co
    ? shown
        .filter((t) => co.startsWith(`${t.team}:`))
        .map((t) => {
          const cid = co.slice(t.team.length + 1);
          return {
            ...t,
            companies: t.companies.filter((c) => c.id === cid),
            tasks: t.tasks.filter((x) => x.companyId === cid),
            orders: t.orders.filter((o) => o.companyId === cid),
            claims: t.claims.filter((k) => k.companyId === cid),
          };
        })
    : shown;

  return (
    <div className="page">
      <div className="page-head">
        <h1>조 현황</h1>
        <p className="muted">1~3조의 이번 주 할일 · 주문 · 클레임을 한 화면에서 봐요. 여기서는 보기만 해요 (수정은 각 조에서).</p>
      </div>

      {/* 조별 요약 카드 */}
      <div className="ov-cards">
        {teams.map((t) => (
          <TeamCard key={t.team} t={t} monday={monday} todayIso={todayIso} on={only === t.team} onClick={() => setOnly((v) => (v === t.team ? '' : t.team))} />
        ))}
        <TradeCard requests={data.requests} people={tradePeople} todayIso={todayIso} on={view === 'trade'} onClick={() => setView('trade')} />
      </div>

      <div className="toolbar ov-toolbar">
        <div className="seg">
          {(
            [
              ['todos', '📝 이번 주 할일'],
              ['orders', '📦 주문'],
              ['claims', '🧾 클레임'],
              ['trade', '📨 무역사무'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="rq-chips">
          <button className={`cchip ${!only ? 'on' : ''}`} onClick={() => setOnly('')}>
            모든 조
          </button>
          {TEAMS.map((t) => (
            <button key={t} className={`cchip ${only === t ? 'on' : ''}`} onClick={() => setOnly(t)}>
              {teamLabel(t)}
            </button>
          ))}
        </div>
        <input className="search" placeholder="🔍 업체 · 할일 · 주문 · 클레임 이름" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {teams.some((t) => t.error) && (
        <p className="muted small">일부 조 정보를 못 읽었어요 (보안 규칙을 올렸는지 확인해 주세요): {teams.filter((t) => t.error).map((t) => t.label).join(', ')}</p>
      )}

      {/* 업체 고르기: 지금 보기(할일·주문·클레임)에 내용이 있는 업체만 */}
      {view !== 'trade' && (
        <div className="company-chips ov-co-chips">
          <span className="muted small">업체</span>
          <button className={`cchip ${!co ? 'on' : ''}`} onClick={() => setCo('')}>
            전체
          </button>
          {shown.flatMap((t) => {
            const used = new Set(
              view === 'orders'
                ? t.orders.map((o) => o.companyId)
                : view === 'claims'
                  ? t.claims.map((k) => k.companyId)
                  : tasksForWeek(t.tasks, monday).map((r) => r.task.companyId),
            );
            return t.companies
              .filter((c) => used.has(c.id))
              .map((c) => {
                const key = `${t.team}:${c.id}`;
                return (
                  <button
                    key={key}
                    className={`cchip ${co === key ? 'on' : ''}`}
                    style={{ '--c': c.color ?? '#999' } as CSSProperties}
                    onClick={() => setCo((v) => (v === key ? '' : key))}
                  >
                    <span className="dot" style={{ background: c.color }} />
                    {!only && <span className="muted small">{t.label} </span>}
                    {c.name}
                  </button>
                );
              });
          })}
        </div>
      )}

      {view === 'todos' && <TodosView teams={picked} monday={monday} todayIso={todayIso} q={q} />}
      {view === 'orders' && <OrdersView teams={picked} q={q} />}
      {view === 'claims' && <ClaimsView teams={picked} q={q} />}
      {view === 'trade' && <TradeView requests={data.requests} people={tradePeople} only={only} q={q} todayIso={todayIso} />}
    </div>
  );
}

function TeamCard({ t, monday, todayIso, on, onClick }: { t: TeamData; monday: string; todayIso: string; on: boolean; onClick: () => void }) {
  const rows = tasksForWeek(t.tasks, monday);
  const done = rows.filter((r) => r.doneInWeek).length;
  const open = rows.filter((r) => !r.doneInWeek);
  const overdue = open.filter((r) => dueState(r.task, todayIso) === 'overdue').length;
  const dueToday = open.filter((r) => dueState(r.task, todayIso) === 'today').length;
  const openOrders = t.orders.filter((o) => !isOrderDone(o));
  const claimWait = t.claims.filter((c) => !c.refunded);
  return (
    <button className={`ov-card ${on ? 'on' : ''}`} onClick={onClick} title="눌러서 이 조만 보기">
      <div className="ov-card-head">
        <b>{t.label}</b>
        <span className="ov-people">
          {t.members.map((m) => (
            <span key={m.id} className="ov-person" style={{ '--c': m.color } as CSSProperties}>
              {m.name}
            </span>
          ))}
          {t.ready && t.members.length === 0 && <span className="muted small">아직 담당자 없음</span>}
        </span>
      </div>
      <div className="ov-card-body">
        <Ring value={done} total={rows.length} size={58} stroke={6} color="#8c2f3c" label={open.length} sub="남음" />
        <div className="ov-stats">
          <span>
            이번 주 할일 <b>{open.length}</b> 남음 <span className="muted">/ {rows.length}</span>
          </span>
          <span className="ov-flags">
            <span className={`flag ${overdue ? 'warn' : ''}`}>기한 지남 {overdue}</span>
            <span className={`flag ${dueToday ? 'hot' : ''}`}>오늘 {dueToday}</span>
          </span>
          <span>
            진행중 주문 <b>{openOrders.length}</b>건 <span className="muted">· {fmtKRW(sumOf(openOrders, 'amountKRW')) || '₩0'}</span>
          </span>
          <span>
            환급 대기 클레임 <b>{claimWait.length}</b>건
          </span>
        </div>
      </div>
      {!t.ready && <span className="muted small">불러오는 중…</span>}
    </button>
  );
}

/** 이번 주 할일: 조마다 한 칸, 그 안에 업체별 남은 할일 */
function TodosView({ teams, monday, todayIso, q }: { teams: TeamData[]; monday: string; todayIso: string; q: string }) {
  const [withDone, setWithDone] = useState(false);
  const query = q.trim().toLowerCase();
  return (
    <>
      <label className="check-line ov-done-toggle">
        <input type="checkbox" checked={withDone} onChange={(e) => setWithDone(e.target.checked)} /> 이번 주에 끝낸 일도 보기
      </label>
      <div className="ov-cols">
        {teams.map((t) => {
          const rows = tasksForWeek(t.tasks, monday);
          const byCo = t.companies
            .map((c) => {
              const mine = rows.filter((r) => r.task.companyId === c.id);
              const list = mine.filter((r) => (withDone || !r.doneInWeek) && (!query || `${c.name} ${r.task.title} ${r.task.note ?? ''}`.toLowerCase().includes(query)));
              return { c, list, open: mine.filter((r) => !r.doneInWeek).length, total: mine.length };
            })
            .filter((x) => x.list.length > 0);
          const noCo = rows.filter((r) => !r.task.companyId && (withDone || !r.doneInWeek) && (!query || r.task.title.toLowerCase().includes(query)));
          const nameOf = (id: string) => t.members.find((m) => m.id === id);
          return (
            <section key={t.team} className="ov-col">
              <h3>{t.label}</h3>
              {byCo.length === 0 && noCo.length === 0 && <p className="muted small">{t.ready ? '보여줄 할일이 없어요 🍵' : '불러오는 중…'}</p>}
              {[...byCo, ...(noCo.length ? [{ c: { id: '-', name: '업체 없음', color: '#bbb' } as Company, list: noCo, open: noCo.filter((r) => !r.doneInWeek).length, total: noCo.length }] : [])].map(
                ({ c, list, open, total }) => (
                  <div key={c.id} className="ov-co">
                    <div className="ov-co-head">
                      <span className="dot" style={{ background: c.color }} />
                      <b>{c.name}</b>
                      <span className="muted small">
                        {open} 남음 / {total}
                      </span>
                    </div>
                    <ul>
                      {list.map(({ task, doneInWeek }) => {
                        const ds = dueState(task, todayIso);
                        return (
                          <li key={task.id} className={doneInWeek ? 'done' : ''}>
                            <span className="ov-task">{task.title}</span>
                            <span className="ov-who">
                              {task.assigneeIds.map((id) => {
                                const m = nameOf(id);
                                return m ? (
                                  <span key={id} className="ov-person" style={{ '--c': m.color } as CSSProperties}>
                                    {m.name}
                                  </span>
                                ) : null;
                              })}
                            </span>
                            {task.dueDate && !doneInWeek && (
                              <span className={`due-pill due-${ds}`}>{ds === 'overdue' ? `${shortDate(task.dueDate)} 지남` : ds === 'today' ? '오늘' : shortDate(task.dueDate)}</span>
                            )}
                            {doneInWeek && <span className="tag green small">완료</span>}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ),
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

/** 주문: 묶음 단위로 (묶음 아닌 주문은 한 줄씩). 누르면 안에 든 주문 상세 */
interface Unit {
  key: string;
  t: TeamData;
  c?: Company;
  title: string;
  bundle?: Order['bundle'];
  orders: Order[];
}
const stepsDone = (o: Order) => ORDER_STEPS.filter((s) => o[s.key]).length;

function OrdersView({ teams, q }: { teams: TeamData[]; q: string }) {
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [detail, setDetail] = useState<Unit | null>(null);
  const query = q.trim().toLowerCase();
  const units = useMemo(() => {
    const out: Unit[] = [];
    for (const t of teams) {
      const byBundle = new Map<string, Unit>();
      for (const o of t.orders) {
        const c = t.companies.find((x) => x.id === o.companyId);
        if (o.bundle) {
          let u = byBundle.get(o.bundle.id);
          if (!u) {
            u = { key: `${t.team}:${o.bundle.id}`, t, c, title: o.bundle.name || '이름 없는 묶음', bundle: o.bundle, orders: [] };
            byBundle.set(o.bundle.id, u);
            out.push(u);
          }
          u.orders.push(o);
        } else out.push({ key: `${t.team}:${o.id}`, t, c, title: o.name, orders: [o] });
      }
    }
    const latest = (u: Unit) => u.orders.map((o) => o.orderDate ?? '').sort().pop() ?? '';
    return out
      .filter((u) => (tab === 'open' ? u.orders.some((o) => !isOrderDone(o)) : u.orders.every(isOrderDone)))
      .filter((u) => !query || `${u.title} ${u.c?.name ?? ''} ${u.orders.map((o) => `${o.name} ${o.storeCode ?? ''}`).join(' ')}`.toLowerCase().includes(query))
      .sort((a, b) => a.t.team.localeCompare(b.t.team) || (a.c?.order ?? 99) - (b.c?.order ?? 99) || latest(b).localeCompare(latest(a)));
  }, [teams, tab, query]);
  const shown = tab === 'done' ? units.slice(0, 200) : units;
  const allOrders = shown.flatMap((u) => u.orders);
  return (
    <>
      <div className="seg ov-sub">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          진행중
        </button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
          완료
        </button>
      </div>
      <div className="card table-card">
        <table className="ov-table ov-units">
          <thead>
            <tr>
              <th>조</th>
              <th>업체</th>
              <th>묶음 · 주문</th>
              <th className="r">주문 수</th>
              <th>진행 단계</th>
              <th>주문일자</th>
              <th>출고 장소</th>
              <th className="r">원화</th>
              <th className="r">외화</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-box">
                  {tab === 'open' ? '진행중 주문이 없어요.' : '완료된 주문이 없어요.'}
                </td>
              </tr>
            )}
            {shown.map((u) => {
              // 묶음 안에서 가장 덜 진행된 주문 기준
              const slow = [...u.orders].sort((a, b) => stepsDone(a) - stepsDone(b))[0];
              const done = u.orders.every(isOrderDone);
              const next = ORDER_STEPS.find((s) => !slow[s.key]);
              const dates = u.orders.map((o) => o.orderDate).filter(Boolean).sort() as string[];
              const places = [...new Set(u.orders.map((o) => o.shipFrom).filter(Boolean))];
              return (
                <tr key={u.key} className="ov-unit-row" onClick={() => setDetail(u)} title="눌러서 안에 든 주문 보기">
                  <td className="nowrap">{u.t.label}</td>
                  <td className="nowrap">
                    {u.c && <span className="dot" style={{ background: u.c.color }} />} {u.c?.name ?? '-'}
                  </td>
                  <td>
                    {u.bundle ? (
                      <span className="ov-bundle big" style={{ '--c': u.bundle.color } as CSSProperties}>
                        {u.title}
                      </span>
                    ) : (
                      <b>{u.title}</b>
                    )}
                  </td>
                  <td className="r">{u.orders.length}</td>
                  <td className="nowrap">
                    <span className="ov-steps">
                      {ORDER_STEPS.map((s) => (
                        <i key={s.key} className={slow[s.key] ? 'on' : ''} />
                      ))}
                    </span>
                    <span className="muted small"> {done ? '완료' : next ? `${next.label} 전` : ''}</span>
                  </td>
                  <td className="nowrap">{dates.length ? (dates[0] === dates[dates.length - 1] ? dot(dates[0]) : `${dot(dates[0])} ~ ${dot(dates[dates.length - 1])}`) : ''}</td>
                  <td>{places.join(', ')}</td>
                  <td className="r nowrap">{amtK(u.orders)}</td>
                  <td className="r nowrap">{amtF(u.orders)}</td>
                </tr>
              );
            })}
          </tbody>
          {tab === 'open' && shown.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={3}>합계 {shown.length}묶음</td>
                <td className="r">{allOrders.length}</td>
                <td colSpan={3} />
                <td className="r">{fmtKRW(sumOf(allOrders, 'amountKRW'))}</td>
                <td className="r">{fmtFX(sumOf(allOrders, 'amountForeign'))}</td>
              </tr>
            </tfoot>
          )}
        </table>
        {tab === 'done' && units.length > 200 && <p className="muted small">최근 200개만 보여요. 검색으로 찾아 주세요.</p>}
      </div>
      {detail && <UnitDetail u={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

/** 묶음(또는 주문) 상세: 안에 든 주문들 */
function UnitDetail({ u, onClose }: { u: Unit; onClose: () => void }) {
  const list = [...u.orders].sort((a, b) => (a.orderDate ?? '').localeCompare(b.orderDate ?? ''));
  return (
    <Modal title={u.title} onClose={onClose} wide>
      <p className="muted small detail-sub">
        {u.t.label} · {u.c?.name ?? '업체 없음'} · 주문 {list.length}건{amtK(list) ? ` · ${amtK(list)}` : ''}{amtF(list) ? ` · ${amtF(list)}` : ''}
      </p>
      <div className="detail-table-wrap">
        <table className="detail-table">
          <thead>
            <tr>
              <th>주문</th>
              <th>진행 단계</th>
              <th>주문일자</th>
              <th>매장코드</th>
              <th>출고 장소</th>
              <th>패킹 완료일</th>
              <th className="r">원화 금액</th>
              <th className="r">외화 금액</th>
            </tr>
          </thead>
          <tbody>
            {list.map((o) => {
              const next = ORDER_STEPS.find((s) => !o[s.key]);
              return (
                <tr key={o.id}>
                  <td>
                    <b>{o.name}</b>
                    {o.note && <div className="detail-note">{o.note}</div>}
                  </td>
                  <td className="nowrap">
                    <span className="ov-steps" title={ORDER_STEPS.map((s) => `${o[s.key] ? '✓' : '·'} ${s.label}`).join('\n')}>
                      {ORDER_STEPS.map((s) => (
                        <i key={s.key} className={o[s.key] ? 'on' : ''} />
                      ))}
                    </span>
                    <span className="muted small"> {isOrderDone(o) ? '완료' : next ? `${next.label} 전` : ''}</span>
                  </td>
                  <td className="nowrap">{o.orderDate?.replace(/-/g, '.') ?? ''}</td>
                  <td>{o.storeCode ?? ''}</td>
                  <td>{o.shipFrom ?? ''}</td>
                  <td>{o.packing ?? ''}</td>
                  <td className="r nowrap">{fmtKRW(o.amountKRW)}</td>
                  <td className="r nowrap">{fmtFX(o.amountForeign)}</td>
                </tr>
              );
            })}
          </tbody>
          {list.length > 1 && (
            <tfoot>
              <tr>
                <td colSpan={6}>합계</td>
                <td className="r">{fmtKRW(sumOf(list, 'amountKRW'))}</td>
                <td className="r">{fmtFX(sumOf(list, 'amountForeign'))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </Modal>
  );
}

/** 클레임: 모든 조 클레임 (패킹금액은 주문에서 자동, 비율 계산) */
function ClaimsView({ teams, q }: { teams: TeamData[]; q: string }) {
  const [tab, setTab] = useState<'wait' | 'all'>('wait');
  const query = q.trim().toLowerCase();
  const rows = teams
    .flatMap((t) => t.claims.map((k) => ({ t, k, c: t.companies.find((c) => c.id === k.companyId) })))
    .filter(({ k }) => tab === 'all' || !k.refunded)
    .filter(({ k, c }) => !query || `${k.title} ${c?.name ?? ''} ${k.note ?? ''}`.toLowerCase().includes(query))
    .sort((a, b) => a.t.team.localeCompare(b.t.team) || (b.k.shipDate ?? '').localeCompare(a.k.shipDate ?? ''));
  const packing = (t: TeamData, k: Claim) => {
    if (k.packingOverride !== undefined) return k.packingOverride;
    const key = k.currency === 'KRW' ? 'amountKRW' : 'amountForeign';
    const os = k.source === 'bundle' ? t.orders.filter((o) => o.bundle?.id === k.sourceId) : k.source === 'order' ? t.orders.filter((o) => o.id === k.sourceId) : [];
    return os.some((o) => o[key] !== undefined) ? sumOf(os, key) : undefined;
  };
  const title = (t: TeamData, k: Claim) =>
    (k.source === 'bundle' ? t.orders.find((o) => o.bundle?.id === k.sourceId)?.bundle?.name : k.source === 'order' ? t.orders.find((o) => o.id === k.sourceId)?.name : undefined) ||
    k.title;
  const fmt = (k: Claim, n?: number) => (n === undefined ? '' : k.currency === 'KRW' ? fmtKRW(n) : fmtFX(n));
  return (
    <>
      <div className="seg ov-sub">
        <button className={tab === 'wait' ? 'on' : ''} onClick={() => setTab('wait')}>
          환급 대기
        </button>
        <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
          전체
        </button>
      </div>
      <div className="card table-card">
        <table className="ov-table">
          <thead>
            <tr>
              <th>조</th>
              <th>업체</th>
              <th>이름</th>
              <th>출고날짜</th>
              <th className="r">패킹금액</th>
              <th className="r">클레임 금액</th>
              <th className="r">비율</th>
              <th>진행</th>
              <th>비고</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-box">
                  {tab === 'wait' ? '환급 대기 중인 클레임이 없어요.' : '클레임이 없어요.'}
                </td>
              </tr>
            )}
            {rows.map(({ t, k, c }) => {
              const p = packing(t, k);
              const rate = p && k.claimAmount !== undefined ? (k.claimAmount / p) * 100 : undefined;
              return (
                <tr key={t.team + k.id} className={k.refunded ? 'is-refunded' : ''}>
                  <td className="nowrap">{t.label}</td>
                  <td className="nowrap">
                    {c && <span className="dot" style={{ background: c.color }} />} {c?.name ?? '-'}
                  </td>
                  <td>
                    <b>{title(t, k)}</b>
                  </td>
                  <td className="nowrap">{dot(k.shipDate)}</td>
                  <td className="r nowrap">{fmt(k, p)}</td>
                  <td className="r nowrap">{fmt(k, k.claimAmount)}</td>
                  <td className="r nowrap">{rate === undefined ? '' : `${rate.toFixed(3)}%`}</td>
                  <td className="nowrap">
                    <span className={`tag ${k.docDone ? 'green' : 'gray'} small`}>서류 {k.docDone ? '✓' : '전'}</span>{' '}
                    <span className={`tag ${k.refunded ? 'green' : 'gray'} small`}>환급 {k.refunded ? '✓' : '전'}</span>
                  </td>
                  <td className="ov-note">{k.note ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** 무역사무 요약 카드: 남은 요청 · 요청됨/진행중 · 초긴급 · 마감 지남 · 처리자 미정 · 이번 달 완료 */
function TradeCard({ requests, people, todayIso, on, onClick }: { requests: TradeRequest[]; people: Member[]; todayIso: string; on: boolean; onClick: () => void }) {
  const open = requests.filter(isOpen);
  const load = workload(requests, people, todayIso);
  const doneMonth = load.rows.reduce((a, r) => a + r.doneThisMonth, 0);
  const hot = open.filter((r) => r.priority === '초긴급').length;
  const overdue = open.filter((r) => r.dueDate && r.dueDate < todayIso).length;
  return (
    <button className={`ov-card ov-trade ${on ? 'on' : ''}`} onClick={onClick} title="눌러서 무역사무 요청 보기">
      <div className="ov-card-head">
        <b>무역사무</b>
        <span className="ov-people">
          {people.map((m) => (
            <span key={m.id} className="ov-person" style={{ '--c': m.color } as CSSProperties}>
              {m.name} {load.rows.find((r) => r.id === m.id)?.open ?? 0}
            </span>
          ))}
        </span>
      </div>
      <div className="ov-card-body">
        <Ring value={doneMonth} total={doneMonth + open.length} size={58} stroke={6} color="#6b4d8a" label={open.length} sub="남음" />
        <div className="ov-stats">
          <span>
            남은 요청 <b>{open.length}</b>건 <span className="muted">· 요청됨 {open.filter((r) => r.status === 'requested').length} · 진행중 {open.filter((r) => r.status === 'progress').length}</span>
          </span>
          <span className="ov-flags">
            <span className={`flag ${hot ? 'hot' : ''}`}>초긴급 {hot}</span>
            <span className={`flag ${overdue ? 'warn' : ''}`}>마감 지남 {overdue}</span>
          </span>
          <span>
            처리자 미정 <b>{load.unassigned}</b>건
          </span>
          <span>
            이번 달 완료 <b>{doneMonth}</b>건
          </span>
        </div>
      </div>
    </button>
  );
}

/** 무역사무 요청: 남은 요청 (조 필터·검색), 급한 순 */
function TradeView({ requests, people, only, q, todayIso }: { requests: TradeRequest[]; people: Member[]; only: string; q: string; todayIso: string }) {
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const query = q.trim().toLowerCase();
  const month = todayIso.slice(0, 7);
  const rows = sortRequests(
    requests
      .filter((r) => (tab === 'open' ? isOpen(r) : r.status === 'done' && (r.doneAt ?? '').startsWith(month)))
      .filter((r) => !only || teamOfRequest(r) === only)
      .filter((r) => !query || `${r.title} ${r.workType ?? ''} ${r.requesterName ?? ''}`.toLowerCase().includes(query)),
  );
  return (
    <>
      <div className="seg ov-sub">
        <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
          남은 요청
        </button>
        <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
          이번 달 완료
        </button>
      </div>
      <div className="card table-card">
        <table className="ov-table">
          <thead>
            <tr>
              <th>요청 쪽</th>
              <th>우선순위</th>
              <th>업무 내용</th>
              <th>작업유형</th>
              <th>요청자</th>
              <th>마감일</th>
              <th>처리 예상일</th>
              <th>처리자</th>
              <th>상태</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="empty-box">
                  {tab === 'open' ? '남은 요청이 없어요.' : '이번 달에 끝난 요청이 없어요.'}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const as = people.find((m) => m.id === r.assigneeId);
              const overdue = isOpen(r) && r.dueDate && r.dueDate < todayIso;
              return (
                <tr key={r.id}>
                  <td className="nowrap">{r.teamName ?? `${teamOfRequest(r)}조`}</td>
                  <td>
                    <PriorityTag p={r.priority} />
                  </td>
                  <td>
                    <b>{r.title}</b>
                  </td>
                  <td className="nowrap">{r.workType ?? ''}</td>
                  <td className="nowrap">{r.requesterName ?? r.requesterEmail?.split('@')[0] ?? '무역사무'}</td>
                  <td className={`nowrap ${overdue ? 'ov-overdue' : ''}`}>{dot(r.dueDate)}</td>
                  <td className="nowrap">{dot(r.eta)}</td>
                  <td className="nowrap">{as?.name ?? <span className="muted">미정</span>}</td>
                  <td>
                    <StatusTag s={r.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * 팀장님·이사님 주문 관리·클레임에서 조 업체를 골랐을 때: 그 조의 실제 주문·클레임을 실시간으로 (보기만)
 */
export function LinkedTeamView({ company, kind, onBack }: { company: Company; kind: 'orders' | 'claims'; onBack: () => void }) {
  const team = company.team ?? '';
  const { data, ready, error } = useSpaceData(team, ['orders', 'claims']);
  const [q, setQ] = useState('');
  const td: TeamData = {
    team,
    label: teamLabel(team),
    members: [],
    companies: [company],
    tasks: [],
    orders: ((data.orders as Order[]) ?? []).filter((o) => o.companyId === company.id),
    claims: ((data.claims as Claim[]) ?? []).filter((k) => k.companyId === company.id),
    ready,
    error,
  };
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{kind === 'orders' ? '주문 관리' : '클레임'}</h1>
          <p>
            {teamLabel(team)}에서 관리하는 업체예요. {teamLabel(team)}의 {kind === 'orders' ? '주문' : '클레임'}을 실시간으로 보여줘요 (보기만, 고치는 건 {teamLabel(team)}
            에서).
          </p>
        </div>
      </div>
      <div className="toolbar">
        <button className="company-toggle on" onClick={onBack} title="다른 업체 고르기">
          <span className="dot" style={{ background: company.color }} />
          {company.name} <span className="tag gray small">{teamLabel(team)} 연동</span> ✕
        </button>
        <input className="search" placeholder="🔍 이름 · 매장코드 · 비고" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error && <p className="muted small">{teamLabel(team)} 데이터를 못 읽었어요: {error}</p>}
      {!ready ? <p className="muted small">불러오는 중…</p> : kind === 'orders' ? <OrdersView teams={[td]} q={q} /> : <ClaimsView teams={[td]} q={q} />}
    </div>
  );
}
