// 무역사무 홈: 제목·오늘·이번주 + 우리 팀 카드 + 구분별 업무
import { useSpaceData, useStore } from '../data/store';
import { DeptToday, DeptToggle, useDeptView } from '../components/DeptRoster';
import { useMemo, useState, type CSSProperties } from 'react';
import { CharacterPicker, clockDefaultsOf, Hero, LeaveBand, WorldClocks } from './Home';
import { characterSrc, Modal, Ring } from '../components/ui';
import { useAllTeamCompanies } from './TradeMemo';
import { coKey, saveCoMemo, saveMemoOrder, useTradeMemos } from '../lib/tradeMemos';
import { PriorityTag, RequestDetail, StatusTag } from '../components/RequestParts';
import { isOpen, memberLabel, sortRequests, tradeChar, useTrade, workload } from '../lib/trade';
import { today } from '../lib/date';
import { attendanceOf, adjustLeave } from '../lib/mem';
import { TRADE_TAGS, type Attendance, type ClockPick, type Member, type TradeRequest } from '../types';

const dot = (iso?: string) => (iso ? iso.slice(5).replace('-', '.') : '');

export default function TradeHome() {
  const { data, save, access, team, trade, update } = useTrade();
  const [deptOn, flipDept] = useDeptView(); // 우리 팀 오늘 ↔ 우리 부서 오늘
  const { remove } = useStore();
  const todayIso = today();
  const [picking, setPicking] = useState<Member | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // 시계: 내 무역사무 카드에 저장 (카드가 없으면 이 브라우저)
  const myTrade = trade.find((m) => !!access.email && m.email?.toLowerCase() === access.email);
  const [tradeLocalClocks, setTradeLocalClocks] = useState<ClockPick[] | undefined>(() => {
    try {
      return JSON.parse(localStorage.getItem('gd:tradeClocks') ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  });
  // 기본 시계: 1·2·3조 업체 나라 (무역사무는 모든 조 업체를 다룸)
  const co1 = useSpaceData('1', ['companies']).data.companies;
  const co2 = useSpaceData('2', ['companies']).data.companies;
  const co3 = useSpaceData('3', ['companies']).data.companies;
  const tradeDefaults = useMemo(() => clockDefaultsOf([...(co1 ?? []), ...(co2 ?? []), ...(co3 ?? [])]), [co1, co2, co3]);
  const load = workload(data.requests, trade, todayIso);
  const open = sortRequests(data.requests.filter(isOpen));
  // 구분별 업무 (ARTBOX USA · 재무 · 일반 서류 · 구분 없음) — 마감 급한 순 5개씩, 처리자는 카드 안에 표시
  const byDue = (l: TradeRequest[]) => [...l].sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const columns: { id: string; label: string; list: TradeRequest[] }[] = [
    ...TRADE_TAGS.map((t) => ({ id: t.key, label: t.label, list: byDue(open.filter((r) => r.tag === t.key)) })),
    { id: '-', label: '구분 없음', list: byDue(open.filter((r) => !r.tag)) },
  ];
  const detail = data.requests.find((r) => r.id === openId);
  const mine = (m: Member) => access.role === null || (!!m.email && m.email.toLowerCase() === access.email);
  const iHaveCard = trade.some((m) => m.email?.toLowerCase() === access.email);
  const todayAtt = new Map(data.attendance.filter((a) => a.date === todayIso).map((a) => [a.memberId, a]));
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();

  return (
    <div className="page">
      <Hero title="무역사무 Dashboard" />

      <section className="section">
        <div className="section-head">
          <h2>👋 {deptOn ? '우리 부서 오늘' : '우리 팀 오늘'}</h2>
          {!deptOn && <span className="muted small">내 카드의 말풍선·캐릭터를 누르면 바꿀 수 있어요</span>}
          <DeptToggle on={deptOn} onFlip={flipDept} />
        </div>
        {deptOn ? (
          <DeptToday side="trade" todayIso={todayIso} nowMin={nowMin} myEmail={access.email} />
        ) : (
        <div className="team">
          {load.rows.map((w) => {
            const m = w.member!;
            return (
              <TradeCard
                key={m.id}
                m={m}
                w={w}
                record={adjustLeave(todayAtt.get(m.id)) ?? attendanceOf(m, todayIso, [], data.memAttendance)}
                nowMin={nowMin}
                fallbackChar={tradeChar(m, trade)}
                mine={mine(m)}
                canClaim={!!access.email && !m.email && !iHaveCard}
                onClaim={() =>
                  confirm(`'${m.name}' 카드를 내 카드(${access.email})로 연결할까요?`) && save('tradeMembers', { ...m, email: access.email })
                }
                onPick={() => setPicking(m)}
                onStatus={(status) => save('tradeMembers', { ...m, status: status || undefined })}
                onOpenList={() => (window.location.hash = `/twork?who=${m.id}`)}
              />
            );
          })}
          {trade.length === 0 && <p className="muted small">아직 무역사무 담당자가 없어요. 관리자가 설정 → 무역사무 담당자에서 추가해요.</p>}
        </div>
        )}
      </section>

      {/* 세계 시간: 출근 상태(우리 팀 오늘) 밑에 */}
      <WorldClocks
        defaults={tradeDefaults}
        picked={myTrade?.clocks ?? tradeLocalClocks}
        onSave={(list) => {
          if (myTrade) save('tradeMembers', { ...myTrade, clocks: list });
          else {
            setTradeLocalClocks(list);
            try {
              if (list) localStorage.setItem('gd:tradeClocks', JSON.stringify(list));
              else localStorage.removeItem('gd:tradeClocks');
            } catch {
              /* 무시 */
            }
          }
        }}
        where={myTrade ? `${myTrade.name} 계정에 저장돼요` : '이 브라우저에 저장돼요 (내 카드가 연결되면 계정에 저장)'}
      />

      {/* 업체 주요 메모: 체크 안 한 무역사무 메모가 있는 업체 4곳 · 업체마다 5개 */}
      <HomeMemos />

      <section className="section">
        <div className="section-head">
          <h2>📋 구분별 업무</h2>
          <span className="muted small">마감 급한 순 5개씩 · 누르면 자세히 · 전체는 업무 탭에서</span>
        </div>
        <div className="tw-board">
          {columns.map((c) => (
            <div key={c.id} className={`tw-col tg-col tg-${c.id === '-' ? 'none' : c.id} ${c.id === '-' ? 'none' : ''}`}>
              <div className="tw-col-head">
                <span className={`rq-tag tg-${c.id === '-' ? 'none' : c.id}`}>{c.label}</span>
                <span className="tw-count">{c.list.length}</span>
              </div>
              {c.list.length === 0 ? (
                <p className="muted small tw-empty">남은 업무 없음 🍵</p>
              ) : (
                <ul>
                  {c.list.slice(0, 5).map((r) => (
                    <li key={r.id}>
                      <button className="tw-item" onClick={() => setOpenId(r.id)}>
                        <span className="tw-item-top">
                          <PriorityTag p={r.priority} />
                          {r.status === 'progress' && <StatusTag s={r.status} />}
                          {r.dueDate && <span className={`tw-due ${r.dueDate < todayIso ? 'overdue' : r.dueDate === todayIso ? 'today' : ''}`}>~{dot(r.dueDate)}</span>}
                        </span>
                        <span className="tw-title">{r.title}{r.longTerm && <span className="rq-long-tag" title="장기 업무 진행률">📌 {r.progress ?? 0}%</span>}{r.orderLink && <span title={`연결된 주문: ${r.orderLink.label}`}> 📦</span>}</span>
                        <span className="muted small tw-meta">
                          {(() => { const w = team.find((m) => m.id === r.requesterId); return w ? memberLabel(w) : ''; })()} {r.workType ? `· ${r.workType}` : ''}
                          {(() => {
                            const a = trade.find((m) => m.id === r.assigneeId);
                            return <span className={`tw-as ${a ? '' : 'none'}`}>{a ? `→ ${a.name}` : '처리자 미정'}</span>;
                          })()}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {c.list.length > 5 && (
                <a className="tw-more" href="#/twork">
                  + {c.list.length - 5}개 더 · 업무 탭에서 보기
                </a>
              )}
            </div>
          ))}
        </div>
      </section>

      {picking && (
        <CharacterPicker
          member={picking}
          onClose={() => setPicking(null)}
          onPick={(c) => {
            save('tradeMembers', { ...picking, character: c });
            setPicking(null);
          }}
        />
      )}
      {detail && (
        <RequestDetail
          key={detail.id + (detail.log?.length ?? 0)}
          r={detail}
          team={team}
          trade={trade}
          side="trade"
          canEditContent
          onDelete={
            access.role === 'admin' || access.realRole === 'admin' || access.role === null || (!!access.email && (detail.requesterEmail?.toLowerCase() === access.email || detail.createdByEmail?.toLowerCase() === access.email))
              ? () => {
                  remove('requests', detail.id);
                  setOpenId(null);
                }
              : undefined
          }
          onSave={(p) => update(detail, p)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  );
}

function TradeCard({
  m,
  w,
  record,
  nowMin,
  fallbackChar,
  mine,
  canClaim,
  onClaim,
  onPick,
  onStatus,
  onOpenList,
}: {
  m: Member;
  w: ReturnType<typeof workload>['rows'][number];
  record?: Attendance;
  nowMin: number;
  fallbackChar: string; // 아직 캐릭터를 안 골랐을 때 보이는 캐릭터
  mine: boolean;
  canClaim: boolean;
  onClaim: () => void;
  onPick: () => void;
  onStatus: (v: string) => void;
  onOpenList: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.status ?? '');
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (m.status ?? '')) onStatus(draft.trim());
  };
  const img = <img src={characterSrc(m.character ?? fallbackChar)} alt="" />;
  return (
    <div className="member-card" style={{ '--c': m.color } as CSSProperties}>
      {record && <LeaveBand r={record} nowMin={nowMin} />}
      <div className="mc-body">
        {mine ? (
          <button className="mc-char" onClick={onPick} title="캐릭터 바꾸기">
            {img}
          </button>
        ) : (
          <div className="mc-char static">{img}</div>
        )}
        <div className="mc-main">
          <div className="mc-name">
            <b>{m.name}</b>
            <span className="mc-dot" />
            {!mine && canClaim && (
              <button className="claim-btn" onClick={onClaim} title="내 로그인 계정과 이 카드를 연결해요 (처음 한 번만)">
                이 카드가 나예요
              </button>
            )}
          </div>
          {!mine ? (
            <div className={`bubble readonly ${m.status ? '' : 'is-empty'}`}>{m.status || '…'}</div>
          ) : editing ? (
            <input
              className="bubble bubble-input"
              autoFocus
              maxLength={50}
              value={draft}
              placeholder="지금 기분이나 하고 있는 일"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          ) : (
            <button
              className={`bubble ${m.status ? '' : 'is-empty'}`}
              onClick={() => {
                setDraft(m.status ?? '');
                setEditing(true);
              }}
            >
              {m.status || '한마디 남기기 ✎'}
            </button>
          )}
        </div>
      </div>
      <button className="mc-tasks tw-card-tasks" onClick={onOpenList} title="눌러서 업무 목록 보기">
        <Ring value={w.doneThisMonth} total={w.open + w.doneThisMonth} size={46} stroke={5} color={m.color} label={w.open} />
        <span className="mc-task-text">
          <span>
            남은 업무 <b>{w.open}</b> <span className="muted">· 요청됨 {w.requested} · 진행중 {w.progress}</span>
          </span>
          <span className="mc-flags">
            {w.hot > 0 && <span className="flag hot">초긴급 {w.hot}</span>}
            {w.overdue > 0 && <span className="flag warn">마감 지남 {w.overdue}</span>}
            {w.dueToday > 0 && <span className="flag">오늘 마감 {w.dueToday}</span>}
            <span className="flag">이번 달 완료 {w.doneThisMonth}</span>
          </span>
        </span>
      </button>
    </div>
  );
}

/** 무역사무 홈: 업체 주요 메모 (업체 4곳 · 업체마다 체크 안 한 메모 5개). 4곳이 넘으면 ⚙ 로 먼저 보일 순서 */
function HomeMemos() {
  const cos = useAllTeamCompanies();
  const { memos, order } = useTradeMemos();
  const [sorting, setSorting] = useState(false);
  const withMemo = cos
    .map((c) => ({ c, k: coKey(c.team, c.id), m: memos[coKey(c.team, c.id)] }))
    .filter((x) => x.m?.items.some((i) => !i.done));
  // 정해 둔 순서 먼저, 나머지는 최근에 고친 순
  const rank = (k: string) => (order.includes(k) ? order.indexOf(k) : 1000);
  const sorted = [...withMemo].sort((a, b) => rank(a.k) - rank(b.k) || (b.m?.updatedAt ?? '').localeCompare(a.m?.updatedAt ?? ''));
  const shown = sorted.slice(0, 4);
  const toggle = (k: string, id: string) => {
    const items = memos[k]?.items ?? [];
    void saveCoMemo(
      k,
      items.map((y) => (y.id === id ? { ...y, done: !y.done, doneAt: !y.done ? new Date().toISOString() : undefined } : y)),
    );
  };
  return (
    <section className="section">
      <div className="section-head">
        <h2>📝 업체 주요 메모</h2>
        <span className="muted small">
          체크 안 한 메모가 있는 업체 {withMemo.length}곳{withMemo.length > 4 ? ' 중 4곳' : ''} · 체크하면 사라져요 ·{' '}
          <a href="#/tmemo" className="link small">
            업체 메모 →
          </a>
          {withMemo.length > 4 && (
            <>
              {' '}
              ·{' '}
              <button className="link small" onClick={() => setSorting(true)}>
                ⚙ 먼저 보일 업체
              </button>
            </>
          )}
        </span>
      </div>
      {!shown.length ? (
        <p className="muted small">업체 메모가 없어요. 위쪽 [업체 메모] 탭에서 업체마다 메모를 남길 수 있어요 🍵</p>
      ) : (
        <div className="tw-new hm-grid">
          {shown.map(({ c, k, m }) => {
            const open = (m?.items ?? []).filter((i) => !i.done);
            return (
              <div key={k} className="tw-new-card hm-card" style={{ '--c': c.color } as CSSProperties}>
                <a className="hm-head" href={`#/tmemo?c=${k}`} title="업체 메모에서 보기">
                  <span className="dot" style={{ background: c.color }} />
                  <b>{c.name}</b>
                  <span className="team-tag">{c.team}조</span>
                  <span className="tm-n">{open.length}</span>
                </a>
                <ul className="hm-items">
                  {open.slice(0, 5).map((x) => (
                    <li key={x.id}>
                      <label>
                        <input type="checkbox" checked={false} onChange={() => toggle(k, x.id)} />
                        <span>{x.text}</span>
                      </label>
                    </li>
                  ))}
                </ul>
                {open.length > 5 && (
                  <a className="tw-more" href={`#/tmemo?c=${k}`}>
                    + {open.length - 5}개 더
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
      {sorting && <MemoOrder items={sorted.map((x) => ({ k: x.k, name: x.c.name, team: x.c.team }))} onClose={() => setSorting(false)} />}
    </section>
  );
}

/** 먼저 보일 업체 순서 (위 4곳이 홈에 보여요) */
function MemoOrder({ items, onClose }: { items: { k: string; name: string; team: string }[]; onClose: () => void }) {
  const [list, setList] = useState(items);
  const move = (i: number, d: number) =>
    setList((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  return (
    <Modal title="먼저 보일 업체" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        위에서 4곳이 무역사무 홈에 보여요. 메모를 다 체크한 업체는 홈에서 빠져요.
      </p>
      <ol className="hm-order">
        {list.map((x, i) => (
          <li key={x.k} className={i < 4 ? 'top' : ''}>
            <span className="team-tag">{x.team}조</span> {x.name}
            <span className="hm-order-btns">
              <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0}>
                ▲
              </button>
              <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === list.length - 1}>
                ▼
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onClose}>닫기</button>
        <button
          className="primary"
          onClick={() => {
            void saveMemoOrder(list.map((x) => x.k));
            onClose();
          }}
        >
          저장
        </button>
      </div>
    </Modal>
  );
}
