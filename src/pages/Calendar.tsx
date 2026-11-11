// 달력: 부서 구글 캘린더(iCal 비공개 주소)를 대시보드 모양으로. 일정은 서버 함수 calendarEvents 가 읽어 줌
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { DATA_MODE } from '../data/store';
import { holidayName } from '../lib/holidays';
import { Modal } from '../components/ui';

interface Cal {
  id: string;
  name: string;
  color: string;
  mine?: boolean; // 내 달력 (나에게만 보임)
}
interface Ev {
  id: string;
  cal: string;
  title: string;
  start: string; // 종일: YYYY-MM-DD, 아니면 ISO
  end: string; // 종일: 끝 다음날(포함 안 함)
  allDay: boolean;
  location?: string;
  desc?: string;
  byName?: string; // 작성자 이름 (구글이 주는 경우만)
  byEmail?: string; // 작성자 메일
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** 서울 날짜 YYYY-MM-DD */
const seoulDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
const seoulTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const addDay = (k: string, n: number) => {
  const d = new Date(`${k}T00:00:00`);
  d.setDate(d.getDate() + n);
  return keyOf(d);
};
/** 이 일정이 걸친 날들 (서울 기준) */
function daysOf(e: Ev): string[] {
  const s = e.allDay ? e.start : seoulDay(e.start);
  // 종일은 끝 날짜가 '다음날'(포함 안 함), 시간 일정은 끝 시각이 자정이면 그 전날까지
  const last = e.allDay ? addDay(e.end, -1) : seoulDay(new Date(new Date(e.end).getTime() - 1).toISOString());
  const out: string[] = [];
  for (let k = s; k <= last && out.length < 62; k = addDay(k, 1)) out.push(k);
  return out.length ? out : [s];
}
const stripHtml = (s?: string) => (s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

export default function Calendar() {
  const now = new Date();
  const [month, setMonth] = useState(() => new Date(now.getFullYear(), now.getMonth(), 1));
  const [cals, setCals] = useState<Cal[]>([]);
  const [events, setEvents] = useState<Ev[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('gd:calHidden') ?? '[]');
    } catch {
      return [];
    }
  });
  const [open, setOpen] = useState<Ev | null>(null);
  // 내 화면에서만 바꾼 달력 색 (이 브라우저에 기억)
  const [myColors, setMyColors] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem('gd:calColors') ?? '{}');
    } catch {
      return {};
    }
  });
  const setMyColor = (id: string, color?: string) => {
    const next = { ...myColors };
    if (color) next[id] = color;
    else delete next[id];
    setMyColors(next);
    try {
      localStorage.setItem('gd:calColors', JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  };
  const [day, setDay] = useState<string | null>(null);

  // 6주 칸: 그 달 1일이 있는 주 일요일부터
  const gridStart = useMemo(() => {
    const d = new Date(month);
    d.setDate(1 - d.getDay());
    return d;
  }, [month]);
  const cells = useMemo(() => Array.from({ length: 42 }, (_, i) => keyOf(new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i))), [gridStart]);

  useEffect(() => {
    if (DATA_MODE === 'local') return;
    let alive = true;
    setBusy(true);
    const from = new Date(`${cells[0]}T00:00:00+09:00`).toISOString();
    const to = new Date(`${addDay(cells[41], 1)}T00:00:00+09:00`).toISOString();
    httpsCallable(functions, 'calendarEvents')({ from, to })
      .then((r) => {
        if (!alive) return;
        const d = r.data as { calendars: Cal[]; events: Ev[]; errors: string[] };
        setCals(d.calendars);
        setEvents(d.events);
        setErrors(d.errors ?? []);
      })
      .catch((e) => alive && setErrors([`일정을 못 불러왔어요: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요)`]))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [cells]);

  const calById = new Map(cals.map((c) => [c.id, { ...c, color: myColors[c.id] ?? c.color }]));
  const shown = events.filter((e) => !hidden.includes(e.cal));
  const byDay = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of shown) for (const k of daysOf(e)) m.set(k, [...(m.get(k) ?? []), e]);
    for (const list of m.values()) list.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start));
    return m;
  }, [shown]);
  // 주마다: 여러 날·종일 일정은 이어진 띠(줄 배정), 하루짜리 시간 일정은 칸 안 목록
  const MAX_LANES = 3;
  const weeks = useMemo(() => {
    const out: {
      days: string[];
      lanes: number;
      bars: { e: Ev; c0: number; c1: number; lane: number; l: boolean; r: boolean }[];
      singles: Map<string, Ev[]>;
      hiddenBars: Map<string, number>;
    }[] = [];
    const isBar = (e: Ev) => e.allDay || daysOf(e).length > 1;
    for (let wi = 0; wi < 6; wi++) {
      const days = cells.slice(wi * 7, wi * 7 + 7);
      const spans = shown
        .filter(isBar)
        .map((e) => ({ e, ds: daysOf(e) }))
        .filter((x) => x.ds.some((d) => days.includes(d)))
        .map((x) => {
          const inWeek = x.ds.filter((d) => days.includes(d));
          return { e: x.e, c0: days.indexOf(inWeek[0]), c1: days.indexOf(inWeek[inWeek.length - 1]), l: inWeek[0] === x.ds[0], r: inWeek[inWeek.length - 1] === x.ds[x.ds.length - 1] };
        })
        // 긴 것 먼저, 일찍 시작하는 것 먼저 (구글처럼)
        .sort((a, b) => a.c0 - b.c0 || b.c1 - b.c0 - (a.c1 - a.c0) || a.e.title.localeCompare(b.e.title));
      const laneEnd: number[] = [];
      const bars: (typeof spans[number] & { lane: number })[] = [];
      const hiddenBars = new Map<string, number>();
      for (const sp of spans) {
        let lane = laneEnd.findIndex((end) => end < sp.c0);
        if (lane < 0) lane = laneEnd.length;
        if (lane >= MAX_LANES) {
          for (let c = sp.c0; c <= sp.c1; c++) hiddenBars.set(days[c], (hiddenBars.get(days[c]) ?? 0) + 1);
          continue;
        }
        laneEnd[lane] = sp.c1;
        bars.push({ ...sp, lane });
      }
      const singles = new Map<string, Ev[]>();
      for (const k of days) singles.set(k, (byDay.get(k) ?? []).filter((e) => !isBar(e)));
      out.push({ days, lanes: Math.min(laneEnd.length, MAX_LANES), bars, singles, hiddenBars });
    }
    return out;
  }, [cells, shown, byDay]);

  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id];
    setHidden(next);
    try {
      localStorage.setItem('gd:calHidden', JSON.stringify(next));
    } catch {
      /* 무시 */
    }
  };
  const todayKey = keyOf(now);
  const monthKey = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;
  const move = (n: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + n, 1));
  // 휴대폰: 이번 달 일정 목록
  const agenda = cells.filter((k) => k.startsWith(monthKey) && (byDay.get(k)?.length || holidayName(k)));

  const chip = (e: Ev, k: string) => {
    const c = calById.get(e.cal);
    const first = daysOf(e)[0] === k;
    return (
      <button
        key={e.id + k}
        className={`cal-ev ${e.allDay ? 'all' : 'timed'} ${first ? '' : 'cont'}`}
        style={{ '--c': c?.color ?? '#8c2f3c' } as CSSProperties}
        onClick={(ev) => {
          ev.stopPropagation();
          setOpen(e);
        }}
        title={e.title}
      >
        {!e.allDay && first && <span className="cal-time">{seoulTime(e.start)}</span>}
        <span className="cal-title">{e.title}</span>
      </button>
    );
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>달력</h1>
          <p>부서 구글 캘린더 일정을 보여줘요 (보기만, 일정 추가·수정은 구글 캘린더에서)</p>
        </div>
      </div>

      <div className="toolbar cal-toolbar">
        <div className="cal-nav">
          <button onClick={() => move(-1)} title="지난 달">
            ‹
          </button>
          <b>
            {month.getFullYear()}년 {month.getMonth() + 1}월
          </b>
          <button onClick={() => move(1)} title="다음 달">
            ›
          </button>
          <button className="cal-today" onClick={() => setMonth(new Date(now.getFullYear(), now.getMonth(), 1))}>
            오늘
          </button>
          {busy && <span className="muted small">불러오는 중…</span>}
        </div>
        <div className="cal-legend">
          {cals.map((c) => {
            const color = myColors[c.id] ?? c.color;
            return (
              <span key={c.id} className={`cal-leg ${hidden.includes(c.id) ? 'off' : ''}`} style={{ '--c': color } as CSSProperties}>
                {/* 색 동그라미: 내 화면에서만 색 바꾸기 */}
                <label className="cal-leg-color" title="눌러서 내 화면 색 바꾸기 (다른 사람에게는 안 바뀜)">
                  <span className="cal-leg-dot" />
                  <input type="color" value={color} onChange={(e) => setMyColor(c.id, e.target.value)} />
                </label>
                <button className="cal-leg-name" onClick={() => toggle(c.id)} title="눌러서 보이기/숨기기">
                  {c.name}
                  {c.mine && <span className="cal-mine">나만</span>}
                </button>
                {myColors[c.id] && (
                  <button className="cal-leg-reset" onClick={() => setMyColor(c.id)} title="원래 색으로">
                    ↺
                  </button>
                )}
              </span>
            );
          })}
        </div>
      </div>

      {DATA_MODE === 'local' && <p className="muted small">로컬 테스트 모드에서는 구글 캘린더를 불러오지 않아요.</p>}
      {DATA_MODE !== 'local' && !busy && cals.length === 0 && !errors.length && (
        <p className="muted small">아직 연결된 달력이 없어요. 관리자가 설정 → 구글 캘린더에서 달력을 추가해 주세요.</p>
      )}
      {errors.map((e, i) => (
        <p key={i} className="cal-err">
          {e}
        </p>
      ))}

      <div className="cal-grid card">
        <div className="cal-head-row">
          {DOW.map((d, i) => (
            <div key={d} className={`cal-dow ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
              {d}
            </div>
          ))}
        </div>
        {weeks.map((w) => (
          <div key={w.days[0]} className="cal-week" style={{ gridTemplateRows: `30px repeat(${w.lanes}, 22px) minmax(26px, 1fr)` }}>
            {/* 날짜 칸 (배경) */}
            {w.days.map((k, i) => {
              const hol = holidayName(k);
              const out = !k.startsWith(monthKey);
              const count = (byDay.get(k) ?? []).length;
              return (
                <div
                  key={k}
                  className={`cal-day ${out ? 'out' : ''} ${k === todayKey ? 'today' : ''} ${i === 0 || hol ? 'sun' : i === 6 ? 'sat' : ''}`}
                  style={{ gridColumn: i + 1, gridRow: '1 / -1' }}
                  onClick={() => count && setDay(k)}
                >
                  <div className="cal-day-head">
                    <span className="cal-num">{Number(k.slice(8))}</span>
                    {hol && <span className="cal-hol">{hol}</span>}
                  </div>
                </div>
              );
            })}
            {/* 여러 날·종일 일정: 이어진 띠 */}
            {w.bars.map((bar) => {
              const c = calById.get(bar.e.cal);
              return (
                <button
                  key={bar.e.id + w.days[0]}
                  className={`cal-bar ${bar.l ? 'l' : ''} ${bar.r ? 'r' : ''}`}
                  style={{ gridColumn: `${bar.c0 + 1} / ${bar.c1 + 2}`, gridRow: bar.lane + 2, '--c': c?.color ?? '#8c2f3c' } as CSSProperties}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    setOpen(bar.e);
                  }}
                  title={bar.e.title}
                >
                  {!bar.e.allDay && bar.l && <span className="cal-time">{seoulTime(bar.e.start)}</span>}
                  <span className="cal-title">{bar.e.title}</span>
                </button>
              );
            })}
            {/* 하루짜리 시간 일정 + 넘친 개수 */}
            {w.days.map((k, i) => {
              const singles = w.singles.get(k) ?? [];
              const hiddenBars = w.hiddenBars.get(k) ?? 0;
              const room = Math.max(0, 4 - w.lanes);
              const more = singles.length - room + hiddenBars;
              return (
                <div key={`s${k}`} className="cal-singles" style={{ gridColumn: i + 1, gridRow: w.lanes + 2 }}>
                  {singles.slice(0, room).map((e) => chip(e, k))}
                  {more > 0 && (
                    <span className="cal-more" onClick={() => setDay(k)}>
                      +{more}개
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* 휴대폰: 목록으로 */}
      <div className="cal-agenda">
        {agenda.length === 0 && <p className="muted small">이번 달 일정이 없어요.</p>}
        {agenda.map((k) => (
          <div key={k} className={`cal-ag-day ${k === todayKey ? 'today' : ''}`}>
            <div className="cal-ag-date">
              <b>{Number(k.slice(8))}</b>
              <span>{DOW[new Date(`${k}T00:00:00`).getDay()]}</span>
              {holidayName(k) && <span className="cal-hol">{holidayName(k)}</span>}
            </div>
            <div className="cal-ag-list">{(byDay.get(k) ?? []).map((e) => chip(e, k))}</div>
          </div>
        ))}
      </div>

      {day && (
        <Modal title={`${Number(day.slice(5, 7))}월 ${Number(day.slice(8))}일 일정`} onClose={() => setDay(null)}>
          <div className="cal-day-list">{(byDay.get(day) ?? []).map((e) => chip(e, day))}</div>
        </Modal>
      )}
      {open && (
        <Modal title="일정" onClose={() => setOpen(null)}>
          <div className="cal-detail">
            {/* 1. 내용 (크게) */}
            <h2 className="cal-d-title">{open.title}</h2>
            {/* 2. 시간 */}
            <p className="cal-d-time">
              🕘{' '}
              {open.allDay
                ? (() => {
                    const ds = daysOf(open);
                    return ds.length > 1 ? `${ds[0].replace(/-/g, '.')} ~ ${ds[ds.length - 1].replace(/-/g, '.')} (종일)` : `${ds[0].replace(/-/g, '.')} (종일)`;
                  })()
                : `${seoulDay(open.start).replace(/-/g, '.')} ${seoulTime(open.start)} ~ ${seoulDay(open.end) === seoulDay(open.start) ? '' : `${seoulDay(open.end).replace(/-/g, '.')} `}${seoulTime(open.end)}`}
            </p>
            {open.location && <p className="cal-d-row">📍 {open.location}</p>}
            {/* 3. 누가 쓴 일정인지 */}
            <p className="cal-d-row">
              ✍️{' '}
              {open.byName || open.byEmail ? (
                <>
                  {open.byName && <b>{open.byName}</b>} {open.byEmail && <span className="muted">{open.byEmail}</span>}
                </>
              ) : (
                <span className="muted">작성자 정보 없음 (구글이 이 일정의 작성자를 알려주지 않았어요)</span>
              )}
            </p>
            {/* 4. 어느 달력인지 */}
            <p className="cal-d-row">
              <span className="cal-leg-dot" style={{ '--c': calById.get(open.cal)?.color } as CSSProperties} /> {calById.get(open.cal)?.name}
              {calById.get(open.cal)?.mine && <span className="cal-mine">나만</span>}
            </p>
            {open.desc && <pre className="cal-desc">{stripHtml(open.desc)}</pre>}
          </div>
        </Modal>
      )}
    </div>
  );
}
