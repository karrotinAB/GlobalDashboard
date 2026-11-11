import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { addDays, fromISO, shortDate, today, weekStart } from '../lib/date';
import { dueState, summarize, tasksForWeek, type MemberSummary } from '../lib/tasks';
import { holidayName } from '../lib/holidays';
import { COUNTRY_OPTIONS, countryCode, useWorldHolidays } from '../lib/worldHolidays';
import { useAccess } from '../components/AuthGate';
import { attendanceOf } from '../lib/mem';
import { isPersonal, TEAMS } from '../lib/team';
import { isOrderDone, ORDER_STEPS, type Attendance, type ClockPick, type Member } from '../types';
import { CHARACTERS, characterSrc, CompanyDot, MemberChip, Modal, Ring, charOf } from '../components/ui';

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
    y: n('year'),
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

/** 그 나라 날짜 'YYYY-MM-DD' */
const isoOf = (p: { y: number; mo: number; d: number }) => `${p.y}-${String(p.mo).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;

function DigitalClock({
  label,
  tz,
  now,
  home,
  holidayOf,
  info,
}: {
  label: string;
  tz: string;
  now: Date;
  home?: boolean;
  holidayOf?: (iso: string) => string | undefined;
  info?: string; // 마우스를 올리면 보이는 설명 (공휴일을 몇 개 불러왔는지)
}) {
  const p = tzParts(now, tz);
  const holiday = holidayOf?.(isoOf(p));
  const seoul = tzParts(now, HOME_TZ);
  const diffH = (p.wall - seoul.wall) / 60;
  const night = p.h < 7 || p.h >= 19;
  const weekend = p.weekday === 'Sat' || p.weekday === 'Sun';
  const working = !weekend && !holiday && p.h >= 9 && p.h < 18;
  const { t, p: ap } = ampm(`${p.h}:${p.mi}`);
  const diffLabel = home ? '우리 시간' : diffH === 0 ? '서울과 같음' : `서울 ${diffH > 0 ? '+' : ''}${Number.isInteger(diffH) ? diffH : diffH.toFixed(1)}h`;
  return (
    <div className={`dclock ${night ? 'night' : 'day'} ${holiday ? 'holiday' : ''}`} title={info}>
      <div className="dc-label">
        {label}
        {holiday && (
          <span className="dc-holiday" title={holiday}>
            {holiday}
          </span>
        )}
      </div>
      <div className="dc-time">
        {t}
        <small>{ap}</small>
      </div>
      <div className="dc-meta">
        <span>
          {p.mo}/{p.d} · {diffLabel}
        </span>
        <span className={`dc-status ${working ? 'on' : ''} ${holiday ? 'hol' : ''}`} title={holiday}>
          {holiday ? '공휴일' : working ? '업무중' : weekend ? '주말' : night ? '밤' : '업무 외'}
        </span>
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
  // 홈 화면 구성 (설정 > 홈 화면 구성, 관리자만 바꿈). 기본은 숨김
  const homeCfg = data.config.find((c) => c.id === 'home') ?? { id: 'home' };
  const { members, companies, memberById, companyById } = useLookups();
  const now = useNow();
  const todayIso = today();
  const monday = weekStart(todayIso);
  const seoul = tzParts(now, HOME_TZ);
  const todayAtt = new Map(data.attendance.filter((a) => a.date === todayIso).map((a) => [a.memberId, a]));
  const [editing, setEditing] = useState<Member | null>(null);

  const defaultClocks = useMemo(() => {
    const map = new Map<string, { names: string[]; codes: string[]; color?: string }>();
    for (const c of companies) {
      if (!c.timezone || !isValidTz(c.timezone) || c.timezone === HOME_TZ) continue;
      const e = map.get(c.timezone) ?? { names: [], codes: [], color: c.color };
      e.names.push(c.country || c.name);
      const code = countryCode(c.country || c.name, c.timezone);
      if (code) e.codes.push(code);
      map.set(c.timezone, e);
    }
    return [...map.entries()].map(([tz, v]) => ({ tz, label: [...new Set(v.names)].join(' · '), codes: [...new Set(v.codes)], color: v.color }));
  }, [companies]);

  // 시계는 계정마다 따로 고름: 내 카드(members.clocks)에 저장, 카드가 없으면 이 브라우저에
  const myCard = members.find((m) => !!access.email && m.email?.toLowerCase() === access.email);
  const [localPick, setLocalPick] = useState<ClockPick[] | undefined>(() => {
    try {
      return JSON.parse(localStorage.getItem('gd:clocks') ?? 'null') ?? undefined;
    } catch {
      return undefined;
    }
  });
  const picked = myCard ? myCard.clocks : localPick;
  const saveClocks = (list: ClockPick[] | undefined) => {
    if (myCard) save('members', { ...myCard, clocks: list });
    else {
      setLocalPick(list);
      try {
        if (list) localStorage.setItem('gd:clocks', JSON.stringify(list));
        else localStorage.removeItem('gd:clocks');
      } catch {
        /* 무시 */
      }
    }
  };
  const [pickingClocks, setPickingClocks] = useState(false);
  const clocks = useMemo(
    () =>
      picked
        ? picked
            .filter((c) => isValidTz(c.tz))
            .map((c) => {
              const code = c.code ?? countryCode(c.label, c.tz);
              return { tz: c.tz, label: c.label, codes: code ? [code] : [], color: undefined as string | undefined };
            })
        : defaultClocks,
    [picked, defaultClocks],
  );

  const extraHolidays = data.config.find((c) => c.id === 'holidays')?.holidays ?? [];
  const worldHoliday = useWorldHolidays(clocks.flatMap((c) => c.codes), seoul.y, extraHolidays);

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
  // 조 업체(팀장님·이사님 화면)는 조별로, 내 업체는 맨 위
  // 진행중 주문이나 남은 할일이 있는 업체만
  const activeStats = companyStats.filter((x) => x.orders > 0 || x.open > 0);
  const companyGroups = [
    { key: 'own', label: '내 업체', items: activeStats.filter((x) => !x.c.team) },
    ...TEAMS.map((t) => ({ key: t, label: `${t}조`, items: activeStats.filter((x) => x.c.team === t) })),
  ].filter((g) => g.items.length);


  return (
    <div className="page">
      <Hero title={`${access.viewLabel} Dashboard`} />

      {/* 우리 팀 오늘 */}
      <section className="section">
        <div className="section-head">
          <h2>👋 {isPersonal(access.viewTeam) ? '오늘의 나' : '우리 팀 오늘'}</h2>
          <span className="muted small">내 카드의 말풍선·캐릭터를 누르면 바꿀 수 있어요</span>
        </div>
        <div className="team">
          {summary.map((s) => (
            <TeamCard
              key={s.member.id}
              s={s}
              record={todayAtt.get(s.member.id) ?? attendanceOf(s.member, todayIso, [], data.memAttendance)}
              nowMin={seoul.h * 60 + seoul.mi}
              mine={access.role === null || (!!s.member.email && s.member.email.toLowerCase() === access.email)}
              canPickChar={access.canManage}
              canClaim={
                !!access.email &&
                !s.member.email &&
                !members.some((x) => x.email?.toLowerCase() === access.email) &&
                // 관리자가 다른 조·다른 사람 대시보드를 보고 있을 때는 '이 카드가 나예요' 안 보임
                (access.role !== 'admin' || access.viewTeam === access.team)
              }
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
          <span className="muted small">
            흰색 = 낮 · 검정 = 밤 (7PM–7AM) ·{' '}
            <button className="link small" onClick={() => setPickingClocks(true)} title="내 화면에 보일 시계 고르기 (계정마다 따로)">
              ⚙ 시계 고르기
            </button>
          </span>
        </div>
        <div className="dclocks">
          <DigitalClock label="서울" tz={HOME_TZ} now={now} home holidayOf={holidayName} />
          {clocks.map((c) => (
            <DigitalClock
              key={c.tz}
              label={c.label}
              tz={c.tz}
              now={now}
              info={c.codes.length ? c.codes.map((code) => worldHoliday.status(code)).join('\n') : '이 시계는 나라를 몰라서 공휴일을 표시하지 않아요 (시계 이름을 나라 이름으로)'}
              holidayOf={(iso) => {
                // 같은 시간대에 나라가 여럿이면, 쉬는 나라 이름을 붙여서
                const hits = c.codes.map((code) => [code, worldHoliday(code, iso)] as const).filter(([, n]) => n);
                if (!hits.length) return undefined;
                return c.codes.length > 1 ? hits.map(([code, n]) => `${code} ${n}`).join(' · ') : hits[0][1];
              }}
            />
          ))}
        </div>
      </section>

      {(homeCfg.showUrgent || homeCfg.showPipeline) && (
      <div className="two-col">
        {homeCfg.showUrgent && (
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
        )}

        {homeCfg.showPipeline && (
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
        )}
      </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2>🗂️ 업체 tracking</h2>
          <span className="muted small">진행중 주문이나 남은 할일이 있는 업체만</span>
        </div>
        {companyGroups.length === 0 && <p className="muted small">지금 진행중인 주문이나 남은 할일이 있는 업체가 없어요 🍵</p>}
        {/* 팀장님·이사님 화면: 내 업체 / 1조 / 2조 / 3조 로 나눠서 */}
        {companyGroups.map((g) => (
          <div key={g.key} className="company-group">
            {companyGroups.length > 1 && (
              <h3 className="company-group-title">
                {g.label} <span className="muted small">{g.items.length}곳</span>
              </h3>
            )}
            <div className="companies">
              {g.items.map(({ c, total, done, open, orders }) => (
              <div key={c.id} className="company-card" style={{ '--c': c.color ?? '#999' } as CSSProperties}>
                <div className="cc-name">
                  <span className="dot" style={{ background: c.color }} />
                  <span className="cc-title">{c.name}</span>
                  <a className={`cc-orders ${orders ? '' : 'zero'}`} href={`#/orders?c=${c.id}`} title="이 업체 주문 관리로">
                    📦 주문 {orders}
                  </a>
                </div>
                <a className="cc-todo" href={`#/todos?c=${c.id}`} title="이 업체 주간 할일로">
                  <b className={open > 0 ? 'cc-open' : ''}>{open}</b>
                  <span>할일 남음</span>
                  <span className="cc-arrow">→</span>
                </a>
                <span className="cc-bar" title={`이번주 할일 ${done}/${total} 완료`}>
                  <span style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
                </span>
              </div>
              ))}
            </div>
          </div>
        ))}
      </section>

      <section className="card soon">
        <div className="section-head">
          <h2>📈 업체별 판매 / 수출 데이터</h2>
          <span className="pill">준비중</span>
        </div>
        <p className="muted small">다음 단계에서 판매·수출 데이터를 연결해서 업체별 그래프로 보여줄 예정이에요.</p>
      </section>

      {pickingClocks && (
        <ClockPicker
          current={clocks.map((c) => ({ tz: c.tz, label: c.label }))}
          defaults={defaultClocks.map((c) => ({ tz: c.tz, label: c.label }))}
          custom={!!picked}
          where={myCard ? `${myCard.name} 계정에 저장돼요` : '이 브라우저에 저장돼요 (내 카드가 연결되면 계정에 저장)'}
          onSave={(l) => {
            saveClocks(l);
            setPickingClocks(false);
          }}
          onClose={() => setPickingClocks(false)}
        />
      )}
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
  canPickChar,
}: {
  s: MemberSummary;
  record?: Attendance;
  nowMin: number;
  mine: boolean; // 내 카드일 때만 말풍선·캐릭터 수정
  canClaim: boolean; // 아직 주인 없는 카드 + 나도 아직 카드 없음
  onClaim: () => void;
  onPickCharacter: () => void;
  canPickChar?: boolean; // 관리자·팀장님(자기 공간)은 남의 카드 캐릭터도 바꿀 수 있음
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
        {mine || canPickChar ? (
          <button className="mc-char" onClick={onPickCharacter} title="캐릭터 바꾸기">
            <img src={characterSrc(charOf(m))} alt="" />
          </button>
        ) : (
          <div className="mc-char static">
            <img src={characterSrc(charOf(m))} alt="" />
          </div>
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

/** 제목 + 인사 + TODAY / THIS WEEK 구역 (2조 홈, 무역사무 홈 같이 씀) */
export function Hero({ title }: { title: string }) {
  const now = useNow();
  const seoul = tzParts(now, HOME_TZ);
  const todayIso = today();
  const monday = weekStart(todayIso);
  const weekDays = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
  const weekHolidays = weekDays.filter((d) => holidayName(d)).map((d) => [d, holidayName(d)!] as const);
  const friday = weekDays[4];
  const todayDate = fromISO(todayIso);
  const daysToFri = Math.round((fromISO(friday).getTime() - todayDate.getTime()) / 86400000);
  const nowAp = ampm(`${seoul.h}:${seoul.mi}`);
  return (
    <>
    {/* 제목 + 오늘 / 이번주 구역 */}
    <header className="hero">
      <h1>{title}</h1>
      <div className="hero-greet-row">
        <p className="hero-greet">{greeting(seoul.h, seoul.mi)}</p>
        <a href="#/calendar" className="hero-cal" title="부서 구글 캘린더 일정 보기">
          📅 달력
        </a>
      </div>
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
    </>
  );
}

export { CharacterPicker, LeaveBand };

/** 시계 고르기: 업체 나라 시계 켜고 끄기 + 다른 도시 추가 + 순서 */
function ClockPicker({
  current,
  defaults,
  custom,
  where,
  onSave,
  onClose,
}: {
  current: ClockPick[];
  defaults: ClockPick[];
  custom: boolean;
  where: string;
  onSave: (l: ClockPick[] | undefined) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<ClockPick[]>(current);
  const [tz, setTz] = useState('');
  const [label, setLabel] = useState('');
  const allTz = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
    } catch {
      return [];
    }
  }, []);
  const offOptions = defaults.filter((d) => !list.some((x) => x.tz === d.tz));
  const move = (i: number, d: number) =>
    setList((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const [country, setCountry] = useState('');
  // 나라로 추가: 시간대 자동, 그 나라 공휴일도 연결 (업체를 안 만들어도 됨)
  const addCountry = () => {
    const o = COUNTRY_OPTIONS.find((x) => x.key === country);
    if (!o || list.some((x) => x.tz === o.tz)) return; // 같은 시간대 시계는 하나만
    setList((l) => [...l, { tz: o.tz, label: o.name, code: o.code }]);
    setCountry('');
  };
  const add = () => {
    if (!isValidTz(tz) || list.some((x) => x.tz === tz)) return;
    setList((l) => [...l, { tz, label: label.trim() || tz.split('/').pop()!.replace(/_/g, ' ') }]);
    setTz('');
    setLabel('');
  };
  return (
    <Modal title="내 화면에 보일 시계" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        서울은 항상 보여요. 다른 사람 화면에는 영향 없어요 · {where}
      </p>
      <ul className="clock-pick">
        {list.map((c, i) => (
          <li key={c.tz + (c.code ?? '')}>
            <input
              className="cp-label"
              value={c.label}
              onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <span className="muted small cp-tz">
              {c.tz}
              {(c.code ?? countryCode(c.label, c.tz)) ? ` · 공휴일 ${c.code ?? countryCode(c.label, c.tz)}` : ' · 공휴일 없음'}
            </span>
            <button className="icon-btn" onClick={() => move(i, -1)} title="위로">
              ▲
            </button>
            <button className="icon-btn" onClick={() => move(i, 1)} title="아래로">
              ▼
            </button>
            <button className="icon-btn" onClick={() => setList((l) => l.filter((_, j) => j !== i))} title="빼기">
              ✕
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="muted small">서울 시계만 보여요.</li>}
      </ul>
      {offOptions.length > 0 && (
        <div className="cp-off">
          <span className="muted small">업체 나라 시계 다시 넣기</span>
          {offOptions.map((d) => (
            <button key={d.tz} className="cchip" onClick={() => setList((l) => [...l, d])}>
              ＋ {d.label}
            </button>
          ))}
        </div>
      )}
      <div className="cp-add">
        <select value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">나라 고르기 (업체 없이 시계만 추가)</option>
          {COUNTRY_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.name}
            </option>
          ))}
        </select>
        <button className="primary" onClick={addCountry} disabled={!country}>
          ＋ 나라 시계 추가
        </button>
      </div>
      <p className="muted small cp-or">목록에 없는 도시는 시간대로 (이 경우 공휴일은 안 보여요)</p>
      <div className="cp-add">
        <input list="tz-list" placeholder="시간대 (예: America/New_York)" value={tz} onChange={(e) => setTz(e.target.value)} />
        <datalist id="tz-list">
          {allTz.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <input placeholder="이름 (예: 뉴욕)" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button onClick={add} disabled={!isValidTz(tz)}>
          추가
        </button>
      </div>
      <div className="rq-actions">
        {custom && (
          <button className="link" onClick={() => onSave(undefined)} style={{ marginRight: 'auto' }}>
            기본(업체 나라들)으로 되돌리기
          </button>
        )}
        <button onClick={onClose}>닫기</button>
        <button className="primary" onClick={() => onSave(list.filter((c) => c.label.trim()))}>
          저장
        </button>
      </div>
    </Modal>
  );
}
