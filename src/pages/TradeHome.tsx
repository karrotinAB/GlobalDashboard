// 무역사무 홈: 제목·오늘·이번주 + 우리 팀 카드 + 담당자별 업무 (시계 없음)
import { useState, type CSSProperties } from 'react';
import { CharacterPicker, Hero, LeaveBand } from './Home';
import { Avatar, CHARACTERS, characterSrc } from '../components/ui';
import { PriorityTag, RequestDetail, StatusTag } from '../components/RequestParts';
import { isOpen, sortRequests, useTrade, workload } from '../lib/trade';
import { today } from '../lib/date';
import type { Attendance, Member, TradeRequest } from '../types';

const dot = (iso?: string) => (iso ? iso.slice(5).replace('-', '.') : '');

export default function TradeHome() {
  const { data, save, access, team, trade, update } = useTrade();
  const todayIso = today();
  const [picking, setPicking] = useState<Member | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = workload(data.requests, trade, todayIso);
  const open = sortRequests(data.requests.filter(isOpen));
  const columns: { id: string; member?: Member; list: TradeRequest[] }[] = [
    ...trade.map((m) => ({ id: m.id, member: m, list: open.filter((r) => r.assigneeId === m.id) })),
    { id: '-', list: open.filter((r) => !r.assigneeId) },
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
          <h2>👋 우리 팀 오늘</h2>
          <span className="muted small">내 카드의 말풍선·캐릭터를 누르면 바꿀 수 있어요</span>
        </div>
        <div className="team">
          {load.rows.map((w) => {
            const m = w.member!;
            return (
              <TradeCard
                key={m.id}
                m={m}
                w={w}
                record={todayAtt.get(m.id)}
                nowMin={nowMin}
                fallbackChar={CHARACTERS[(trade.indexOf(m) * 5 + 3) % CHARACTERS.length]}
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
      </section>

      <section className="section">
        <div className="section-head">
          <h2>📋 담당자별 업무</h2>
          <span className="muted small">급한 순 · 누르면 자세히 · 전체는 업무 탭에서</span>
        </div>
        <div className="tw-board">
          {columns.map((c) => (
            <div key={c.id} className={`tw-col ${c.member ? '' : 'none'}`} style={{ '--c': c.member?.color } as CSSProperties}>
              <div className="tw-col-head">
                {c.member ? <Avatar member={c.member} size={26} /> : <span className="tw-q">?</span>}
                <b>{c.member?.name ?? '처리자 미정'}</b>
                <span className="tw-count">{c.list.length}</span>
              </div>
              {c.list.length === 0 ? (
                <p className="muted small tw-empty">남은 업무 없음 🍵</p>
              ) : (
                <ul>
                  {c.list.map((r) => (
                    <li key={r.id}>
                      <button className="tw-item" onClick={() => setOpenId(r.id)}>
                        <span className="tw-item-top">
                          <PriorityTag p={r.priority} />
                          {r.status === 'progress' && <StatusTag s={r.status} />}
                          {r.dueDate && <span className={`tw-due ${r.dueDate < todayIso ? 'overdue' : r.dueDate === todayIso ? 'today' : ''}`}>~{dot(r.dueDate)}</span>}
                        </span>
                        <span className="tw-title">{r.title}</span>
                        <span className="muted small">
                          {team.find((m) => m.id === r.requesterId)?.name ?? ''} {r.workType ? `· ${r.workType}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
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
        <span className="tw-card-num">{w.open}</span>
        <span className="mc-task-text">
          <span>
            남은 업무 <span className="muted">· 요청됨 {w.requested} · 진행중 {w.progress}</span>
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
