// 무역사무 요청 목록
//  side='team'  : 2조 '무역사무요청' 탭 — 새 요청, 무역사무 담당자별 남은 업무, 기본은 내 요청만
//  side='trade' : 무역사무 '업무' 탭 — 들어온 요청 처리 (상태·작업유형·요청자·처리 예상일·처리자 바로 수정)
import PeoplePicker, { type PersonOpt } from '../components/PeoplePicker';
import { usePeople } from '../components/AddressBook';
import { assigneesOf, peopleOptions } from '../lib/trade';
import { useMemo, useState, type CSSProperties } from 'react';
import { REQUEST_STATUS, type Member, type RequestStatus, type TradeRequest, TRADE_TAGS, tradeTagLabel, type TradeTag } from '../types';
import { useTrade, isOpen, memberLabel, sortRequests, teamOfRequest, isSelfTask, requestSideLabel, teamTagClass } from '../lib/trade';
import { useStore } from '../data/store';
import { NewRequest, PriorityTag, SameDayNotice, RequestDetail, StatusTag, TradeSummaryCards, WorkTypePicker } from '../components/RequestParts';
import { DateCell } from '../components/OrderCells';
import { today } from '../lib/date';

type Tab = 'open' | 'done';
const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');

/** 주소 ?who= (담당자) 읽기 */
function readParam(k: string) {
  const q = window.location.hash.split('?')[1] ?? '';
  return new URLSearchParams(q).get(k) ?? undefined;
}

const isTeamSideOf = (side: 'team' | 'trade') => side === 'team';

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
  const [tagF, setTagF] = useState('');
  // 처리자: 대시보드 사용자 누구나 여러 명 (무역사무 카드도)
  const { roles, contacts } = usePeople();
  const people = useMemo(() => peopleOptions(roles, contacts, trade, team), [roles, contacts, trade, team]);
  // 이 조 사람들 이메일 (담당자 카드 + 대시보드 사용자 중 이 조)
  const teamEmails = useMemo(
    () =>
      new Set([
        ...team.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e),
        ...(roles ?? []).filter((r) => (r.role === 'member' || r.role === 'admin') && (r.team ?? '2') === access.viewTeam).map((r) => r.email),
      ]),
    [team, roles, access.viewTeam],
  );
  const assigneeMatch = (r: TradeRequest, id: string) => {
    const list = assigneesOf(r, trade);
    if (id === '-') return list.length === 0;
    const m = trade.find((x) => x.id === id);
    return r.assigneeId === id || list.includes(`tm:${id}`) || (!!m?.email && list.includes(m.email.toLowerCase()));
  }; // 구분 거르기: '' 전체 · usa · finance · docs · '-' 미지정
  const [query, setQuery] = useState('');
  const [year, setYear] = useState(todayIso.slice(0, 4));
  const [month, setMonth] = useState(todayIso.slice(5, 7));
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // 조 화면: 우리 조 요청만 / 무역사무: 모든 조 (무역사무 담당자 업무량 카드는 모든 조 합계)
  const everything = data.requests;
  const all = useMemo(
    // 조 화면: 기본은 우리 조 요청만. 무역사무 담당자를 누르면 그 사람이 맡은 다른 조 요청까지
    // + 우리 조 사람이 처리자로 들어간 다른 곳 요청도 (같이 처리하는 업무)
    () =>
      side === 'team' && !assignee
        ? everything.filter((r) => teamOfRequest(r) === access.viewTeam || (r.assignees ?? []).some((k) => teamEmails.has(k)))
        : everything,
    [everything, side, access.viewTeam, assignee, teamEmails],
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
        if (assignee && !assigneeMatch(r, assignee)) return false;
        if (requester && r.requesterId !== requester) return false;
        if (workType && r.workType !== workType) return false;
        if (status && r.status !== status) return false;
        if (tagF && (tagF === '-' ? !!r.tag : r.tag !== tagF)) return false;
        if (q && ![r.title, r.body, r.storeCode, r.workType].some((v) => v?.toLowerCase().includes(q))) return false;
        return true;
      }),
    );
  }, [all, tab, year, month, assignee, requester, workType, status, tagF, query]);

  const openCount = (f: (r: TradeRequest) => boolean) => all.filter((r) => isOpen(r) && f(r)).length;
  // 무역사무 진행중: 일자별로 — 처리할 날 = 처리 예상일(없으면 마감일). 지난 건 오늘로 넘어옴, 끝낸 건 오늘만 보이고 내일 사라짐
  const byDay = !isTeamSideOf(side) && tab === 'open';
  const planOf = (r: TradeRequest) => r.eta || r.dueDate || '';
  const doneToday = byDay
    ? sortRequests(
        all.filter(
          (r) =>
            r.status === 'done' &&
            r.doneAt === todayIso &&
            (!assignee || assigneeMatch(r, assignee)) &&
            (!requester || r.requesterId === requester) &&
            (!workType || r.workType === workType),
        ),
      )
    : [];
  // 장기 업무는 따로 '장기' 칸으로
  const longRows = byDay ? rows.filter((r) => r.longTerm) : [];
  const shortRows = byDay ? rows.filter((r) => !r.longTerm) : [];
  const todayRows = byDay ? shortRows.filter((r) => planOf(r) && planOf(r) <= todayIso) : [];
  const laterRows = byDay ? [...shortRows.filter((r) => !planOf(r) || planOf(r) > todayIso)].sort((a, b) => (planOf(a) || '9999').localeCompare(planOf(b) || '9999')) : [];
  // 엑셀: 지금 보이는 (필터 건) 업무 그대로
  const exportRows = byDay ? [...todayRows, ...doneToday, ...laterRows] : rows;
  const downloadExcel = async () => {
    const XLSX = await import('xlsx');
    const nameOf = (list: Member[], id?: string) => list.find((m) => m.id === id)?.name ?? '';
    const sheet = XLSX.utils.json_to_sheet(
      exportRows.map((r) => ({
        상태: REQUEST_STATUS[r.status],
        구분: tradeTagLabel(r.tag) ?? '',
        우선순위: r.priority,
        마감일: r.dueDate ?? '',
        '처리 예상일': r.eta ?? '',
        '업무 내용': r.title,
        '자세한 내용': r.body ?? '',
        작업유형: r.workType ?? '',
        '요청 조': r.teamName ?? (r.team ? `${r.team}조` : ''),
        요청자: nameOf(team, r.requesterId) || r.requesterName || '',
        의뢰일: r.requestedAt,
        처리자: assigneesOf(r, trade).map((k) => people.find((p) => p.key === k)?.name ?? k.split('@')[0]).join(', '),
        완료일: r.doneAt ?? '',
        매장번호: r.storeCode ?? '',
        주문일자: r.orderDate ? `${r.orderDate}${r.orderDateTo && r.orderDateTo !== r.orderDate ? ` ~ ${r.orderDateTo}` : ''}` : '',
        '연결 주문': r.orderLink?.label ?? '',
        진행률: r.longTerm ? `${r.progress ?? 0}%` : '',
      })),
    );
    sheet['!cols'] = [8, 8, 11, 11, 40, 40, 12, 10, 10, 11, 10, 11, 10, 11, 24, 8].map((w) => ({ wch: w }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, tab === 'open' ? '진행중' : '완료');
    const name = `무역사무_업무_${tab === 'open' ? '진행중' : `완료_${year}${month ? `-${month}` : ''}`}_${todayIso}.xlsx`;
    const buf = XLSX.write(book, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
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
      {/* 당일 업무 의뢰 안내 (요청하는 조 화면에 고정) */}
      {isTeamSide && <SameDayNotice />}

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
        <select className={`rq-tag-filter ${tagF ? 'on' : ''}`} value={tagF} onChange={(e) => setTagF(e.target.value)} title="무역사무 구분으로 거르기">
          <option value="">구분 전체</option>
          {TRADE_TAGS.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
          <option value="-">구분 없음</option>
        </select>
        <input className="search" placeholder="🔍 제목·내용·매장번호" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button className="xlsx-btn" onClick={() => void downloadExcel()} title="지금 보이는 업무(필터 건 그대로)를 엑셀로 내려받아요">
          ⬇ 엑셀 ({exportRows.length})
        </button>
      </div>

      {isTeamSide && assignee && (
        <p className="small rq-filter-note">
          <b>{assignee === '-' ? '처리자 미정' : trade.find((m) => m.id === assignee)?.name}</b>의 업무를 보고 있어요{' '}
          <button className="link" onClick={() => setAssignee(undefined)}>
            × 풀기
          </button>
        </p>
      )}

      {/* 일자별 보기 (무역사무): 오늘 할 일 · 남은 업무 · 장기 업무를 카드로 나눔 */}
      {byDay ? (
        <div className="rq-day-cards">
          {(
            [
              {
                key: 'today',
                head: (
                  <>
                    📅 오늘 할 일 <b>{todayRows.length}</b>
                    <span className="muted small"> · 처리 예상일(없으면 마감일)이 오늘이거나 지난 것 — 못 끝낸 건 다음 날로 넘어가요</span>
                  </>
                ),
                empty: todayRows.length === 0 && doneToday.length === 0 ? '오늘 할 일이 없어요 🍵' : '',
                body: (
                  <>
                    {todayRows.map((r) => (
                      <Row key={r.id} r={r} people={people} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={false} onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
                    ))}
                    {doneToday.map((r) => (
                      <Row key={r.id} r={r} people={people} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={false} doneToday onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
                    ))}
                  </>
                ),
              },
              {
                key: 'later',
                head: (
                  <>
                    🗓 남은 업무 <b>{laterRows.length}</b>
                    <span className="muted small"> · 날짜가 아직 넉넉한 것 (가까운 날짜 순)</span>
                  </>
                ),
                empty: laterRows.length === 0 ? '남은 업무가 없어요' : '',
                body: laterRows.map((r) => (
                  <Row key={r.id} r={r} people={people} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={false} onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
                )),
              },
              {
                key: 'long',
                head: (
                  <>
                    📌 장기 업무 <b>{longRows.length}</b>
                    <span className="muted small"> · 세부 업무로 나눠서 오래 하는 일 (진행률 100% 가 되면 완료)</span>
                  </>
                ),
                empty: longRows.length === 0 ? '장기 업무가 없어요' : '',
                body: longRows.map((r) => (
                  <Row key={r.id} r={r} people={people} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={false} onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
                )),
              },
            ] as const
          ).map((g) => (
            <section key={g.key} className={`card table-card rq-day-card ${g.key}`}>
              <div className="rq-day-head">{g.head}</div>
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
                  </tr>
                </thead>
                <tbody>
                  {g.empty && (
                    <tr>
                      <td colSpan={10} className="muted small pad">
                        {g.empty}
                      </td>
                    </tr>
                  )}
                  {g.body}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      ) : (
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
                <Row key={r.id} r={r} people={people} side={side} myTeam={access.viewTeam} team={team} trade={trade} todayIso={todayIso} done={tab === 'done'} onOpen={() => setOpenId(r.id)} onPatch={(p) => update(r, p)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function Row({
  r,
  people,
  side,
  myTeam,
  team,
  trade,
  todayIso,
  done,
  doneToday,
  onOpen,
  onPatch,
}: {
  r: TradeRequest;
  people: PersonOpt[];
  side: 'team' | 'trade';
  myTeam: string; // 지금 보는 조 (다른 조 요청이면 조 표시)
  team: Member[];
  trade: Member[];
  todayIso: string;
  done: boolean;
  doneToday?: boolean; // 오늘 끝낸 것 (오늘만 보이고 내일 사라짐)
  onOpen: () => void;
  onPatch: (p: Partial<TradeRequest>) => void;
}) {
  const edit = side === 'trade';
  const overdue = isOpen(r) && r.dueDate && r.dueDate < todayIso;
  const requester = team.find((m) => m.id === r.requesterId);
  const subs = r.longTerm ? r.subtasks ?? [] : [];
  return (
    <>
    <tr className={`rq-row ${r.status === 'cancelled' ? 'is-cancelled' : ''} ${r.priority === '초긴급' && isOpen(r) ? 'is-hot' : ''} ${doneToday ? 'is-done-today' : ''} ${subs.length ? 'has-subs' : ''}`}>
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
        {/* 구분: 무역사무가 고름 (조 화면은 보기만) */}
        {edit ? (
          <select className={`cell-select rq-tag-sel ${r.tag ? `tg-${r.tag}` : 'none'}`} value={r.tag ?? ''} onChange={(e) => onPatch({ tag: (e.target.value || undefined) as TradeTag | undefined })} title="구분">
            <option value="">구분 ·</option>
            {TRADE_TAGS.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        ) : (
          r.tag && <span className={`rq-tag tg-${r.tag}`}>{tradeTagLabel(r.tag)}</span>
        )}
      </td>
      <td className="c-pr">
        <PriorityTag p={r.priority} />
      </td>
      <td className={`c-d ${overdue ? 'overdue' : r.dueDate === todayIso && isOpen(r) ? 'due-today' : ''}`}>{dot(r.dueDate) || '-'}</td>
      <td className="c-d">{edit ? <DateCell value={r.eta} onSave={(v) => onPatch({ eta: v })} /> : dot(r.eta) || '-'}</td>
      <td className="c-title">
        <button className="rq-title" onClick={onOpen} title="눌러서 자세히 보기">
          {r.title}{r.orderLink && <span className="rq-has-order" title={`연결된 주문: ${r.orderLink.label}`}> 📦</span>}
          {!r.longTerm && (side === 'trade' || teamOfRequest(r) !== myTeam) && <span className={`rq-team ${teamTagClass(r)}`}>{requestSideLabel(r)}</span>}
          {r.longTerm && (
            <span className="rq-long-line">
              {(side === 'trade' || teamOfRequest(r) !== myTeam) && <span className={`rq-team ${teamTagClass(r)}`}>{requestSideLabel(r)}</span>}
              <span className="rq-long-bar" title="장기 업무 진행률">
                <span style={{ width: `${Math.min(100, r.progress ?? 0)}%` }} />
              </span>
              <b className="rq-long-pct">{r.progress ?? 0}%</b>
            </span>
          )}
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
              .filter((m) => isSelfTask(r) || !m.team || m.team === teamOfRequest(r))
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
      <td className="c-who c-people">
        <PeoplePicker
          value={assigneesOf(r, trade)}
          people={people}
          readOnly={!edit}
          onChange={(v) => {
            // 무역사무 카드가 있는 사람 중 첫 사람을 '주 처리자'로 (담당자별 업무량 카드용)
            const first = v.map((k) => trade.find((m) => `tm:${m.id}` === k || (!!m.email && m.email.toLowerCase() === k))).find(Boolean);
            onPatch({ assignees: v, assigneeId: first?.id });
          }}
        />
      </td>
      {done && <td className="c-d">{dot(r.doneAt)}</td>}
    </tr>
    {/* 장기 업무의 세부 업무: 업무 아래로 └ 줄마다 완료 체크 (진행률 막대와는 따로) */}
    {subs.map((x, i) => (
      <tr key={x.id} className={`rq-sub-row ${x.done ? 'done' : ''} ${i === subs.length - 1 ? 'last' : ''}`}>
        <td colSpan={4} />
        <td colSpan={done ? 6 : 5}>
          <label className="rq-sub-line">
            <span className="rq-sub-branch">└</span>
            <input
              type="checkbox"
              checked={x.done}
              disabled={!edit}
              onChange={() => onPatch({ subtasks: subs.map((y) => (y.id === x.id ? { ...y, done: !y.done } : y)) })}
            />
            <span className="rq-sub-title">{x.title}</span>
          </label>
        </td>
      </tr>
    ))}
    </>
  );
}
