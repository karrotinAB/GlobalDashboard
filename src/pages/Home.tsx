import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { addDays, fromISO, shortDate, today, weekStart } from '../lib/date';
import { dueState, summarize, tasksForWeek, type MemberSummary } from '../lib/tasks';
import { holidayName } from '../lib/holidays';
import { useAccess } from '../components/AuthGate';
import { isOrderDone, ORDER_STEPS, type Attendance, type Member } from '../types';
import { Avatar, CHARACTERS, characterSrc, CompanyDot, MemberChip, Modal, Ring } from '../components/ui';

const HOME_TZ = 'Asia/Seoul';
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

function isValidTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function tzParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const n = (t: string) => Number(get(t));
  return {
    mo: n('month'),
    d: n('day'),
    h: n('hour'),
    mi: n('minute'),
    weekday: get('weekday'),
    wall: Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute')) / 60000,
  };
}

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const fmtDur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
};
const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return { t: `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')}`, p: h < 12 ? 'AM' : 'PM' };
};

function DigitalClock({ label, tz, now, home }: { label: string; tz: string; now: Date; home?: boolean }) {
  const p = tzParts(now, tz);
  const seoul = tzParts(now, HOME_TZ);
  const diffH = (p.wall - seoul.wall) / 60;
  const night = p.h < 7 || p.h >= 19;
  const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  const working = !weekend && p.h >= 9 && p.h < 18;
  const { t, p: ap } = ampm(`${p.h}:${p.mi}`);
  const diffLabel = home ? '우리 시간' : diffH === 0 ? '서울과 같음' : `서울 ${diffH > 0 ? '+' : ''}${Number.isInteger(diffH) ? diffH : diffH.toFixed(1)}h`;
  return (
    <div className={`dclock ${night ? 'night' : 'day'}`}>
      <div className="dc-label">
        {label}
      </div>
      <div className="dc-time">
        {t}
        <small>{ap}</small>
      </div>
      <div className="dc-meta">
        <span>
          {p.mo}/{p.d} · {diffLabel}
        </span>
        <span className={`dc-status ${working ? 'on' : ''}`}>{working ? '업무중' : weekend ? '주말' : night ? '밤' : '업무 외'}</span>
      </div>
    </div>
  );
}

// 우리 점심시간: 12:40 ~ 13:40
const LUNCH_START = 12 * 60 + 40;
const LUNCH_END = 13 * 60 + 40;

function greeting(h: number, m: number) {
  const t = h * 60 + m;
  if (t < 11 * 60) return '좋은 아침이에요 ☕';
  if (t < LUNCH_START - 30) return '오전도 힘내요 ☕';
  if (t < LUNCH_START) return '곧 점심시간이에요 🍱';
  if (t < LUNCH_END) return '맛있는 점심 드세요 🍚';
  if (t < LUNCH_END + 60) return '점심은 맛있게 드셨나요 ☕';
  if (t < 18 * 60) return '오후도 힘내요 ☕';
  return '오늘도 수고했어요 🌙';
}

export default function Home({ go }: { go: (page: string) => void }) {
  const { data, save } = useStore();
  const access = useAccess();
  const { members, companies, memberById, companyById } = useLookups();
  const now = useNow();
  const todayIso = today();
  const monday = weekStart(todayIso);
  const seoul = tzParts(now, HOME_TZ);
  const todayAtt = new Map(data.attendance.filter((a) => a.date === todayIso).map((a) => [a.memberId, a]));
  const [editing, setEditing] = useState<Member | null>(null);

  const clocks = useMemo(() => {
    const map = new Map<string, { names: string[]; color?: string }>();
    for (const c of companies) {
      if (!c.timezone || !isValidTz(c.timezone) || c.timezone === HOME_TZ) continue;
      const e = map.get(c.timezone) ?? { names: [], color: c.color };
      e.names.push(c.country || c.name);
      map.set(c.timezone, e);
    }
    return [...map.entries()].map(([tz, v]) => ({ tz, label: [...new Set(v.names)].join(' · '), color: v.color }));
  }, [companies]);

  const weekRows = useMemo(() => tasksForWeek(data.tasks, monday), [data.tasks, monday]);
  const summary = useMemo(() => summarize(weekRows, members, todayIso), [weekRows, members, todayIso]);
  const urgent = weekRows
    .filter((r) => !r.doneInWeek && ['overdue', 'today', 'tomorrow'].includes(dueState(r.task, todayIso)))
    .sort((a, b) => (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? ''));
  const openOrders = data.orders.filter((o) => !isOrderDone(o));

  const companyStats = companies.map((c) => {
    const rows = weekRows.filter((r) => r.task.companyId === c.id);
    const done = rows.filter((r) => r.doneInWeek).length;
    return { c, total: rows.length, done, open: rows.length - done, orders: openOrders.filter((o) => o.companyId === c.id).length };
  });

  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  const weekHolidays = weekDays.filter((d) => holidayName(d)).map((d) => [d, holidayName(d)!] as const);
  const friday = weekDays[4];
  const todayDate = fromISO(todayIso);
  const daysToFri = Math.round((fromISO(friday).getTime() - todayDate.getTime()) / 86400000);
  const nowAp = ampm(`${seoul.h}:${seoul.mi}`);

  return (
    <div className="page">
      {/* 제목 + 오늘 / 이번주 구역 */}
      <header className="hero">
        <h1>2조 Dashboard</h1>
        <p className="hero-greet">{greeting(seoul.h, seoul.mi)}</p>
        <div className="zones">
          <div className="zone zone-today">
            <span className="zone-tag">TODAY</span>
            <div className="zone-date">
              {todayDate.getMonth() + 1}월 {todayDate.getDate()}일
              <span>{DOW[todayDate.getDay()]}요일</span>
            </div>
            <div className="zone-foot">
              <span className="zone-now">
                {nowAp.t}
                <small>{nowAp.p}</small>
              </span>
              <span className="muted">{todayDate.getFullYear()}년 · 서울</span>
            </div>
          </div>
          <div className="zone zone-week">
            <span className="zone-tag">THIS WEEK</span>
            <div className="zone-date">
              {shortDate(monday)} <span className="arrow">→</span> {shortDate(friday)}
              <span>월 – 금</span>
            </div>
            <div className="week-days">
              {weekDays.map((d) => {
                const dt = fromISO(d);
                const state = d < todayIso ? 'past' : d === todayIso ? 'today' : 'future';
                const hol = holidayName(d);
                return (
                  <div key={d} className={`wd ${state} ${hol ? 'holiday' : ''}`} title={hol}>
                    <span>{DOW[dt.getDay()]}</span>
                    <b>{dt.getDate()}</b>
                  </div>
                );
              })}
              <span className="wd-left muted">
                {daysToFri > 0 ? `금요일까지 ${daysToFri}일` : daysToFri === 0 ? '오늘은 금요일 🎉' : '주말이에요 🌿'}
                {weekHolidays.length > 0 && (
                  <span className="wd-hol">
                    {weekHolidays.map(([d, n]) => `${DOW[fromISO(d).getDay()]} ${n}`).join(' · ')}
                  </span>
                )}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* 우리 팀 오늘 */}
      <section className="section">
        <div className="section-head">
          <h2>👋 우리 팀 오늘</h2>
          <span className="muted small">내 카드의 말풍선·캐릭터를 누르면 바꿀 수 있어요</span>
        </div>
        <div className="team">
          {summary.map((s) => (
            <TeamCard
              key={s.member.id}
              s={s}
              record={todayAtt.get(s.member.id)}
              nowMin={seoul.h * 60 + seoul.mi}
              mine={access.role === null || (!!s.member.email && s.member.email.toLowerCase() === access.email)}
              canClaim={!!access.email && !s.member.email && !members.some((x) => x.email?.toLowerCase() === access.email)}
              onClaim={() => {
                if (confirm(`'${s.member.name}' 카드를 내 카드(${access.email})로 연결할까요?\n연결하면 이 카드의 말풍선·캐릭터는 나만 바꿀 수 있어요.`))
                  save('members', { ...s.member, email: access.email });
              }}
              onPickCharacter={() => setEditing(s.member)}
              onStatus={(status) => save('members', { ...s.member, status: status || undefined })}
            />
          ))}
        </div>
      </section>

      {/* 세계 시간 */}
      <section className="section">
        <div className="section-head">
          <h2>🌍 지금 몇 시?</h2>
          <span className="muted small">흰색 = 낮 · 검정 = 밤 (7PM–7AM)</span>
        </div>
        <div className="dclocks">
          <DigitalClock label="서울" tz={HOME_TZ} now={now} home />
          {clocks.map((c) => (
            <DigitalClock key={c.tz} label={c.label} tz={c.tz} now={now} />
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="card">
          <div className="section-head">
            <h2>🔥 급한 일</h2>
            <button className="link" onClick={() => go('todos')}>
              주간 할일 →
            </button>
          </div>
          {urgent.length === 0 ? (
            <div className="calm">
              <span>🍵</span>
              <p>기한 지난 일도, 오늘·내일 마감도 없어요.</p>
            </div>
          ) : (
            <ul className="urgent-list">
              {urgent.map(({ task }) => {
                const c = companyById.get(task.companyId ?? '');
                const ds = dueState(task, todayIso);
                return (
                  <li key={task.id}>
                    <span className={`due-pill due-${ds}`}>{ds === 'overdue' ? `${shortDate(task.dueDate)} 지남` : ds === 'today' ? '오늘' : '내일'}</span>
                    {c && <CompanyDot color={c.color} />}
                    <span className="grow">{task.title}</span>
                    {task.assigneeIds.map((id) => (
                      <MemberChip key={id} member={memberById.get(id)} small />
                    ))}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small hint">미완료 할일 중 마감일이 지났거나 오늘·내일인 것 (마감일을 넣은 할일만)</p>
        </section>

        <section className="card">
          <div className="section-head">
            <h2>📦 진행중 주문 단계</h2>
            <button className="link" onClick={() => go('orders')}>
              주문 관리 →
            </button>
          </div>
          {openOrders.length === 0 ? (
            <p className="muted small">진행중 주문이 없어요.</p>
          ) : (
            <div className="pipeline">
              {ORDER_STEPS.map((s) => {
                const done = openOrders.filter((o) => o[s.key]).length;
                return (
                  <div key={s.key} className="pl-row" title={`${s.label}: ${done}/${openOrders.length} 완료`}>
                    <span className="pl-label">{s.label}</span>
                    <span className="pl-bar">
                      <span style={{ width: `${(done / openOrders.length) * 100}%` }} />
                    </span>
                    <span className="pl-num">
                      <b>{openOrders.length - done}</b> 남음
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          <p className="muted small hint">막대 = 진행중 주문 {openOrders.length}건 중 그 단계까지 끝난 비율</p>
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2>🗂️ 업체 tracking</h2>
        </div>
        <div className="companies">
          {companyStats.map(({ c, total, done, open, orders }) => (
            <a key={c.id} className="company-card" href={`#/todos?c=${c.id}`} style={{ '--c': c.color ?? '#999' } as CSSProperties}>
              <div className="cc-name">
                <span className="dot" style={{ background: c.color }} />
                {c.name}
              </div>
              <div className="cc-nums">
                <span>
                  <b>{open}</b> 할일 남음
                </span>
                <span>
                  <b>{orders}</b> 주문 진행중
                </span>
              </div>
              <span className="cc-bar" title={`이번주 할일 ${done}/${total} 완료`}>
                <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
              </span>
            </a>
          ))}
        </div>
      </section>

      <section className="card soon">
        <div className="section-head">
          <h2>📈 업체별 판매 / 수출 데이터</h2>
          <span className="pill">준비중</span>
        </div>
        <p className="muted small">다음 단계에서 판매·수출 데이터를 연결해서 업체별 그래프로 보여줄 예정이에요.</p>
      </section>

      {editing && (
        <CharacterPicker
          member={editing}
          onClose={() => setEditing(null)}
          onPick={(c) => {
            save('members', { ...editing, character: c });
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function TeamCard({
  s,
  record,
  nowMin,
  mine,
  canClaim,
  onClaim,
  onPickCharacter,
  onStatus,
}: {
  s: MemberSummary;
  record?: Attendance;
  nowMin: number;
  mine: boolean; // 내 카드일 때만 말풍선·캐릭터 수정
  canClaim: boolean; // 아직 주인 없는 카드 + 나도 아직 카드 없음
  onClaim: () => void;
  onPickCharacter: () => void;
  onStatus: (v: string) => void;
}) {
  const m = s.member;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.status ?? '');
  const commit = () => {
    setEditing(false);
    if (draft.trim() !== (m.status ?? '')) onStatus(draft.trim());
  };
  return (
    <div className="member-card" style={{ '--c': m.color } as CSSProperties}>
      {record && <LeaveBand r={record} nowMin={nowMin} />}
      <div className="mc-body">
        {mine ? (
          <button className="mc-char" onClick={onPickCharacter} title="캐릭터 바꾸기">
            {m.character ? <img src={characterSrc(m.character)} alt="" /> : <Avatar member={m} size={56} />}
          </button>
        ) : (
          <div className="mc-char static">{m.character ? <img src={characterSrc(m.character)} alt="" /> : <Avatar member={m} size={56} />}</div>
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
            m.status ? <div className="bubble readonly">{m.status}</div> : <div className="bubble is-empty readonly">…</div>
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
                if (e.key === 'Escape') {
                  setDraft(m.status ?? '');
                  setEditing(false);
                }
              }}
            />
          ) : (
            <button
              className={`bubble ${m.status ? '' : 'is-empty'}`}
              onClick={() => {
                setDraft(m.status ?? '');
                setEditing(true);
              }}
              title="눌러서 수정"
            >
              {m.status || '한마디 남기기 ✎'}
            </button>
          )}
        </div>
      </div>

      <div className="mc-tasks">
        <Ring value={s.done} total={s.total} size={46} stroke={5} color={m.color} label={s.remaining} />
        <div className="mc-task-text">
          <span>
            이번주 할일 <b>{s.remaining}</b> 남음 <span className="muted">/ {s.total}</span>
          </span>
          <span className="mc-flags">
            {s.overdue > 0 && <span className="flag warn">기한 지남 {s.overdue}</span>}
            {s.dueToday > 0 && <span className="flag hot">오늘 {s.dueToday}</span>}
            {s.dueTomorrow > 0 && <span className="flag">내일 {s.dueTomorrow}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

function CharacterPicker({ member, onClose, onPick }: { member: Member; onClose: () => void; onPick: (c: string) => void }) {
  return (
    <Modal title={`${member.name} 캐릭터 고르기`} onClose={onClose}>
      <div className="char-grid">
        {CHARACTERS.map((c) => (
          <button type="button" key={c} className={`char-opt ${member.character === c ? 'on' : ''}`} onClick={() => onPick(c)}>
            <img src={characterSrc(c)} alt="" />
          </button>
        ))}
      </div>
    </Modal>
  );
}

/** mem 근태가 있을 때만 보이는 띠 (없으면 아무것도 안 그림) */
function LeaveBand({ r, nowMin }: { r: Attendance; nowMin: number }) {
  // mem 이 '퇴근'으로 바뀐 경우에만 퇴근한 걸로 봄 (시간이 지났다고 단정하지 않음)
  const clockedOut = r.status.includes('퇴근');
  const working = r.status === '근무' || clockedOut;
  if (r.end) {
    const end = ampm(r.end);
    const left = toMin(r.end) - nowMin;
    return (
      <div className={`leave ${clockedOut ? 'off' : ''}`}>
        <div className="leave-main">
          <span className="leave-label">{clockedOut ? '퇴근' : '퇴근 예정'}</span>
          <span className="leave-time">
            {end.t}
            <small>{end.p}</small>
          </span>
        </div>
        <div className="leave-side">
          {!working && <span className="leave-tag">{r.status}</span>}
          <span className="leave-detail">
            {clockedOut ? '퇴근했어요 👋' : left > 0 ? `퇴근까지 ${fmtDur(left)}` : '퇴근 시간이 지났어요'}
          </span>
          {r.start && <span className="leave-detail muted">출근 {ampm(r.start).t} {ampm(r.start).p}</span>}
        </div>
      </div>
    );
  }
  return (
    <div className="leave away">
      <div className="leave-main">
        <span className="leave-label">오늘</span>
        <span className="leave-time">{r.status}</span>
      </div>
      {r.period && (
        <div className="leave-side">
          <span className="leave-detail">{r.period}</span>
        </div>
      )}
    </div>
  );
}
