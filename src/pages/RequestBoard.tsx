// 무역사무 요청 목록
//  side='team'  : 2조 '무역사무요청' 탭 — 새 요청, 무역사무 담당자별 남은 업무, 기본은 내 요청만
//  side='trade' : 무역사무 '업무' 탭 — 들어온 요청 처리 (상태·작업유형·요청자·처리 예상일·처리자 바로 수정)
import { useMemo, useState, type CSSProperties } from 'react';
import { REQUEST_STATUS, type Member, type RequestStatus, type TradeRequest } from '../types';
import { useTrade, isOpen, memberLabel, sortRequests, teamOfRequest } from '../lib/trade';
import { useStore } from '../data/store';
import { NewRequest, PriorityTag, RequestDetail, StatusTag, TradeSummaryCards, WorkTypePicker } from '../components/RequestParts';
import { DateCell } from '../components/OrderCells';
import { today } from '../lib/date';

type Tab = 'open' | 'done';
const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');

/** 주소 ?who= (담당자) 읽기 */
function readParam(k: string) {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get(k) ?? undefined;
}

export default function RequestBoard({ side }: { side: 'team' | 'trade' }) {
  const { data, save, access, team, trade, me, update } = useTrade();
  const { remove } = useStore();
  const todayIso = today();
  const [tab, setTab] = useState<Tab>('open');
  const [assignee, setAssignee] = useState<string | undefined>(() => readParam('who')); // 처리자 (무역사무). '-' = 미정
  const [requester, setRequester] = useState<string | undefined>(() =>
    side === 'team' && !readParam('who') ? (me && team.some((m) => m.id === me.id) ? me.id : undefined) : undefined,
  );
  const [workType, setWorkType] = useState('');
  const [showReq, setShowReq] = useState(false);
  const [status, setStatus] = useState<'' | RequestStatus>('');
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(todayIso.slice(0, 4));
  const [month, setMonth] = useState(todayIso.slice(5, 7));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // 조 화면: 우리 조 요청만 / 무역사무: 모든 조 (무역사무 담당자 업무량 카드는 모든 조 합계)
  const everything = data.requests;
  const all = useMemo(
    // 조 화면: 기본은 우리 조 요청만. 무역사무 담당자를 누르면 그 사람이 맡은 다른 조 요청까지
    () => (side === 'team' && (!assignee || assignee === '-') ? everything.filter((r) => teamOfRequest(r) === access.viewTeam) : everything),
    [everything, side, access.viewTeam, assignee],
  );
  const years = useMemo(
    () => [...new Set([todayIso.slice(0, 4), ...all.map((r) => (r.doneAt ?? r.requestedAt).slice(0, 4))])].sort().reverse(),
    [all, todayIso],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sortRequests(
      all.filter((r) => {
        if (tab === 'open' ? !isOpen(r) : isOpen(r)) return false;
        if (tab === 'done') {
          const d = r.doneAt ?? r.requestedAt;
          if (!d.startsWith(year)) return false;
          if (month && d.slice(5, 7) !== month) return false;
        }
        if (assignee && (assignee === '-' ? !!r.assigneeId : r.assigneeId !== assignee)) return false;
        if (requester && r.requesterId !== requester) return false;
        if (workType && r.workType !== workType) return false;
        if (status && r.status !== status) return false;
        if (q && ![r.title, r.body, r.storeCode, r.workType].some((v) => v?.toLowerCase().includes(q))) return false;
        return true;
      }),
    );
  }, [all, tab, year, month, assignee, requester, workType, status, query]);

  const openCount = (f: (r: TradeRequest) => boolean) => all.filter((r) => isOpen(r) && f(r)).length;
  const detail = all.find((r) => r.id === openId);
  const isTeamSide = side === 'team';

  const pickAssignee = (id?: string) => {
    setAssignee((cur) => (cur === id ? undefined : id));
    if (isTeamSide) setRequester(undefined); // 담당자를 누르면 그 사람이 가진 업무 전부
    setTab('open');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>{isTeamSide ? '무역사무 요청' : '업무'}</h1>
        <p className="muted">
          {isTeamSide
            ? '무역사무에 업무를 요청하고, 진행 상황을 확인해요. 무역사무 담당자를 누르면 그 사람이 가진 업무가 보여요.'
            : '2조에서 들어온 요청이에요. 상태·작업유형·요청자·처리 예상일·처리자를 바로 바꿀 수 있어요.'}
        </p>
        <button className="primary rq-new" onClick={() => setCreating(true)}>
          {isTeamSide ? '＋ 새 요청' : '＋ 업무 추가'}
        </button>
      </div>

      {/* 무역사무 담당자별 남은 업무 (누르면 그 사람 업무만) */}
      <TradeSummaryCards requests={everything} trade={trade} selected={assignee} onSelect={pickAssignee} />
      {trade.length === 0 && <p className="muted small">무역사무 담당자가 아직 없어요. 설정 → 무역사무 담당자에서 추가해 주세요.</p>}

      <div className="toolbar rq-toolbar">
        <div className="seg">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
            진행중 <b>{openCount(() => true)}</b>
          </button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
            완료된 업무
          </button>
        </div>
        {tab === 'done' && (
          <>
            <select value={year} onChange={(e) => setYear(e.target.value)}>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}년
                </option>
              ))}
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">전체 월</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {Number(m)}월
                </option>
              ))}
            </select>
          </>
        )}
        <span className="rq-sep" />
        {/* 요청자 (2조): 2조 쪽은 기본 '내 요청' */}
        {/* 요청자: 버튼을 누르면 이름들이 펼쳐짐 (토글) */}
        <div className="rq-chips" title="요청자">
          <button className={`rq-toggle ${requester ? 'on' : ''}`} onClick={() => setShowReq((v) => !v)}>
            요청자: <b>{requester ? team.find((m) => m.id === requester)?.name ?? '?' : '전체'}</b> {showReq ? '▴' : '▾'}
          </button>
          {showReq && (
            <>
              <button
                className={`cchip ${!requester ? 'on' : ''}`}
                onClick={() => {
                  setRequester(undefined);
                  setShowReq(false);
                }}
              >
                전체
              </button>
              {team.map((m) => (
                <button
                  key={m.id}
                  className={`cchip ${requester === m.id ? 'on' : ''}`}
                  style={{ '--c': m.color } as CSSProperties}
                  onClick={() => {
                    setRequester((cur) => (cur === m.id ? undefined : m.id));
                    setShowReq(false);
                  }}
                >
                  {memberLabel(m)}
                  {me?.id === m.id && isTeamSide ? ' (나)' : ''}
                </button>
              ))}
            </>
          )}
        </div>
        {!isTeamSide && (
          <div className="rq-chips" title="처리자">
            <span className="muted small">담당자</span>
            <button className={`cchip ${!assignee ? 'on' : ''}`} onClick={() => setAssignee(undefined)}>
              전체
            </button>
            {trade.map((m) => (
              <button
                key={m.id}
                className={`cchip ${assignee === m.id ? 'on' : ''}`}
                style={{ '--c': m.color } as CSSProperties}
                onClick={() => setAssignee((cur) => (cur === m.id ? undefined : m.id))}
              >
                {m.name}
              </button>
            ))}
            <button className={`cchip ${assignee === '-' ? 'on' : ''}`} onClick={() => setAssignee((cur) => (cur === '-' ? undefined : '-'))}>
              미정
            </button>
          </div>
        )}
        <div className={`wt-filter ${workType ? 'on' : ''}`}>
          <WorkTypePicker value={workType || undefined} onChange={(v) => setWorkType(v ?? '')} allLabel="작업유형 전체" />
        </div>
        {tab === 'open' && (
          <select value={status} onChange={(e) => setStatus(e.target.value as RequestStatus | '')}>
            <option value="">상태 전체</option>
            <option value="requested">요청됨</option>
            <option value="progress">진행중</option>
          </select>
        )}
        <input className="search" placeholder="🔍 제목·내용·매장번호" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {isTeamSide && assignee && (
        <p className="small rq-filter-note">
          <b>{assignee === '-' ? '처리자 미정' : trade.find((m) => m.id === assignee)?.name}</b>의 업무를 보고 있어요{' '}
          <button className="link" onClick={() => setAssignee(undefined)}>
            × 풀기
          </button>
        </p>
      )}

      <div className="card table-card">
        <table className="rq-table">
          <thead>
            <tr>
              <th className="c-st">상태</th>
              <th className="c-pr">우선순위</th>
              <th className="c-d">마감일</th>
              <th className="c-d">처리 예상일</th>
              <th>업무 내용</th>
              <th className="c-wt">작업유형</th>
              <th className="c-who">요청자</th>
              <th className="c-d">의뢰일</th>
              <th className="c-who">처리자</th>
              {tab === 'done' && <th className="c-d">완료일</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="empty-box">
                  {tab === 'open' ? (requester && isTeamSide ? '진행중인 내 요청이 없어요. 요청자 "전체"를 누르면 다른 사람 요청도 보여요.' : '진행중인 요청이 없어요.') : '이 기간에 끝난 업무가 없어요.'}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Row key={r.id} r={r} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={tab === 'done'} onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
            ))}
          </tbody>
        </table>
      </div>

      {creating && <NewRequest team={team} trade={trade} me={me} myEmail={access.email} side={side} teamId={access.viewTeam} teamName={access.viewLabel} onCreate={(r) => save('requests', r)} onClose={() => setCreating(false)} />}
      {detail && (
        <RequestDetail
          key={detail.id + (detail.log?.length ?? 0)}
          r={detail}
          team={team}
          trade={trade}
          side={side}
          canEditContent // 2조·무역사무 모두 고치기·취소 가능 (기록이 남음)
          onDelete={
            access.role === 'admin' || access.role === null || (!!access.email && detail.requesterEmail?.toLowerCase() === access.email)
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

function Row({
  r,
  side,
  myTeam,
  team,
  trade,
  todayIso,
  done,
  onOpen,
  onPatch,
}: {
  r: TradeRequest;
  side: 'team' | 'trade';
  myTeam: string; // 지금 보는 조 (다른 조 요청이면 조 표시)
  team: Member[];
  trade: Member[];
  todayIso: string;
  done: boolean;
  onOpen: () => void;
  onPatch: (p: Partial<TradeRequest>) => void;
}) {
  const edit = side === 'trade';
  const overdue = isOpen(r) && r.dueDate && r.dueDate < todayIso;
  const requester = team.find((m) => m.id === r.requesterId);
  const assignee = trade.find((m) => m.id === r.assigneeId);
  return (
    <tr className={`rq-row ${r.status === 'cancelled' ? 'is-cancelled' : ''} ${r.priority === '초긴급' && isOpen(r) ? 'is-hot' : ''}`}>
      <td className="c-st">
        {edit && r.status !== 'cancelled' ? (
          <select className={`cell-select rs-${r.status}`} value={r.status} onChange={(e) => onPatch({ status: e.target.value as RequestStatus })}>
            {(['requested', 'progress', 'done'] as const).map((s) => (
              <option key={s} value={s}>
                {REQUEST_STATUS[s]}
              </option>
            ))}
          </select>
        ) : (
          <StatusTag s={r.status} />
        )}
      </td>
      <td className="c-pr">
        <PriorityTag p={r.priority} />
      </td>
      <td className={`c-d ${overdue ? 'overdue' : r.dueDate === todayIso && isOpen(r) ? 'due-today' : ''}`}>{dot(r.dueDate) || '-'}</td>
      <td className="c-d">{edit ? <DateCell value={r.eta} onSave={(v) => onPatch({ eta: v })} /> : dot(r.eta) || '-'}</td>
      <td className="c-title">
        <button className="rq-title" onClick={onOpen} title="눌러서 자세히 보기">
          {r.title}
          {(side === 'trade' || teamOfRequest(r) !== myTeam) && <span className="rq-team">{r.teamName ?? `${teamOfRequest(r)}조`}</span>}
          {(r.files ?? []).length > 0 && <span className="rq-clip">📎{r.files!.length}</span>}
          {r.storeCode && <span className="rq-store">{r.storeCode}</span>}
        </button>
      </td>
      <td className="c-wt">
        {edit ? (
          <WorkTypePicker compact value={r.workType} onChange={(v) => onPatch({ workType: v })} allLabel="(없음)" placeholder="-" />
        ) : (
          <span className="small">{r.workType ?? '-'}</span>
        )}
      </td>
      <td className="c-who">
        {edit ? (
          <select className="cell-select" value={r.requesterId ?? ''} onChange={(e) => onPatch({ requesterId: e.target.value || undefined })}>
            <option value="">무역사무</option>
            {team
              .filter((m) => !m.team || m.team === teamOfRequest(r))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
        ) : (
          <span className="rq-person" style={{ '--c': requester?.color } as CSSProperties}>
            {requester?.name ?? r.requesterName ?? r.requesterEmail?.split('@')[0] ?? '무역사무'}
          </span>
        )}
      </td>
      <td className="c-d">{dot(r.requestedAt)}</td>
      <td className="c-who">
        <select className={`cell-select ${assignee ? '' : 'unset'}`} value={r.assigneeId ?? ''} onChange={(e) => onPatch({ assigneeId: e.target.value || undefined })}>
          <option value="">미정</option>
          {trade.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </td>
      {done && <td className="c-d">{dot(r.doneAt)}</td>}
    </tr>
  );
}
