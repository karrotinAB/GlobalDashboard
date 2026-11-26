// 🪼 광장 (지금은 관리자만 · 홈 해파리를 누르면 들어옴) — 순수 재미용
//   집: 이사님 · 팀장님 / 1~3조 / 무역사무 한 사람에 한 채
//       출근(근무 중)이면 창문에 불이 켜지고 캐릭터가 보임 · 퇴근 · 출장 · 휴가 · 대체시차 중 · 출근 전이면 꺼짐
//       우편함을 누르면 그림 쪽지를 그려서 보냄 (plazaNotes) · 내 집 우편함 = 받은 쪽지
//   관리부 물류센터: 지금 '패킹 중'인 주문마다 박스 하나 (금액이 클수록 큰 박스) — 관리부 패킹 화면과 같은 기준
//       앞의 트럭에 마우스를 올리면 출고 예정 목록
//   게시판: 준비 중 (투표 · 공지는 차차)
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useSpaceData, useStore } from '../data/store';
import { useAccess } from '../components/AuthGate';
import { usePeople } from '../components/AddressBook';
import { attOf } from '../components/DeptRoster';
import { characterSrc, charOf, Modal } from '../components/ui';
import { parseDate } from '../components/DateInput';
import { useProfiles, withProfile } from '../lib/profiles';
import { TEAMS, teamLabel } from '../lib/team';
import type { Attendance, Company, Member, Order } from '../types';

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoOf(d);
};
const md = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
const won = (n: number) => (n >= 100_000_000 ? `${(n / 100_000_000).toFixed(1)}억` : n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString()}만` : n ? `${n.toLocaleString()}원` : '금액 없음');
const coShort = (c?: Company) => (c?.name ?? '').replace(/\s*\(.*\)\s*$/, '');

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** 휴가 다음 날 (주말이면 그다음 월요일): '26.11.09~26.11.24' 의 끝날 → 없으면 오늘 */
function backDay(period: string | undefined, todayIso: string) {
  const ds = [...(period ?? '').matchAll(/(\d{2,4})[.\-/](\d{1,2})[.\-/](\d{1,2})/g)];
  const last = ds.at(-1);
  let end = todayIso;
  if (last) {
    const y = last[1].length === 2 ? 2000 + Number(last[1]) : Number(last[1]);
    end = `${y}-${pad(Number(last[2]))}-${pad(Number(last[3]))}`;
    if (end < todayIso) end = todayIso;
  }
  let d = addDays(end, 1);
  while ([0, 6].includes(new Date(`${d}T00:00:00`).getDay())) d = addDays(d, 1);
  const x = new Date(`${d}T00:00:00`);
  return `${x.getMonth() + 1}월 ${x.getDate()}일(${WEEK[x.getDay()]})`;
}
const hourText = (min: number) => `${Math.floor(min / 60)}시${min % 60 ? ` ${min % 60}분` : ''}`;

/** 지금 불이 켜져 있나 + 꺼져 있으면 왜 + 빈집을 누르면 뜨는 말 */
function lightOf(r: Attendance | undefined, nowMin: number, todayIso = ''): { on: boolean; sign: string; icon: string; msg?: string; memo?: boolean } {
  if (!r) return { on: false, sign: '', icon: '' };
  const txt = `${r.status} ${r.period ?? ''}`;
  if (r.status.includes('퇴근')) return { on: false, sign: '퇴근', icon: '🌙', msg: '오늘 영업\n끝났습니다', memo: true };
  if (/출장/.test(txt)) return { on: false, sign: '출장', icon: '✈️', msg: '집에만 없을 뿐.. 여전히 일하는 중 💼' };
  // 대체시차 · 반차 · 외출: 그 시간 안이면 꺼짐
  const tm = r.period?.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  if (tm && /시차|반차|외출/.test(txt)) {
    const a = Number(tm[1]) * 60 + Number(tm[2]);
    const b = Number(tm[3]) * 60 + Number(tm[4]);
    if (nowMin >= a && nowMin < b) return { on: false, sign: /시차/.test(txt) ? '대체시차' : /반차/.test(txt) ? '반차' : '외출', icon: '⏱', msg: `곧 갑니다! ${hourText(b)}에 봐요 🏃` };
  }
  if (r.status === '근무') return { on: true, sign: '', icon: '' };
  if (r.status === '근무전') {
    // 아침 시차로 늦게 오는 날: 시차가 끝나는 시각
    if (tm && /시차|반차|외출/.test(txt) && Number(tm[1]) < 12) return { on: false, sign: '곧 출근', icon: '⏱', msg: `곧 갑니다! ${hourText(Number(tm[3]) * 60 + Number(tm[4]))}에 봐요 🏃` };
    return { on: false, sign: '출근 전', icon: '💤' };
  }
  if (/연차|휴가|반차|병가|경조/.test(txt)) return { on: false, sign: '휴가', icon: '🌴', msg: `나를 찾지 마시오. ${backDay(r.period, todayIso)}에 돌아올 예정 🌴` };
  return { on: false, sign: r.status, icon: '' };
}

// 집이 놓이는 타원 (들판 기준 %): 가운데 · 반지름
const RX0 = 50;
const RY0 = 50;
const RX = 41;
const RY = 37;
/** 세로로 긴 화면(휴대폰): 원은 위쪽에 (물류센터는 원 밖 맨 아래) */
const geo = (tall: boolean) => (tall ? { x0: RX0, y0: 45, rx: 35, ry: 32 } : { x0: RX0, y0: RY0, rx: RX, ry: RY });

/** 고정된 난수 (새로 그려도 덤불 자리가 그대로) */
function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t * 1664525 + 1013904223) % 4294967296;
    return t / 4294967296;
  };
}

/** 바닥: 잔디 · 가운데 흙 광장 · 물류센터 마당 · 덤불 · 꽃 · 돌 조금 (길은 아직 안 그림) */
function Ground({ w, h, tall }: { w: number; h: number; tall: boolean }) {
  const g = geo(tall);
  const cx = (w * g.x0) / 100;
  const cy = (h * g.y0) / 100;
  const rx = (w * g.rx) / 100;
  const ry = (h * g.ry) / 100;
  const plazaR = Math.min(w, h) * 0.16;
  // 꾸미기: 길 · 광장 · 물류센터 · 위 줄을 피해서
  const deco = useMemo(() => {
    const rand = rng(Math.round(w) * 7 + Math.round(h));
    const out: { k: 'bush' | 'flower' | 'rock' | 'tuft'; x: number; y: number; s: number; c: string }[] = [];
    const flowers = ['#ff5d73', '#ffd23f', '#ffffff', '#b57cff', '#ff9f43'];
    for (let n = 0; n < 900 && out.length < 26; n++) {
      const x = rand() * w;
      const y = rand() * h;
      const nx = (x - cx) / rx;
      const ny = (y - cy) / ry;
      const rr = Math.hypot(nx, ny);
      if (Math.abs(rr - 1) < 0.16) continue; // 둥근 길 · 집
      if (rr < 0.52) continue; // 가운데 광장 · 갈래길
      if (tall ? y > h * 0.84 : y > h * 0.7 && Math.abs(x - cx) < w * 0.3) continue; // 물류센터
      if (y < 64) continue; // 위 줄 (돌아가기)
      const roll = rand();
      const k = roll < 0.5 ? 'bush' : roll < 0.85 ? 'flower' : 'rock';
      out.push({ k, x, y, s: 0.7 + rand() * 0.7, c: flowers[Math.floor(rand() * flowers.length)] });
    }
    return out.sort((a, b) => a.y - b.y);
  }, [w, h, cx, cy, rx, ry]);
  return (
    <svg className="pz-ground" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <defs>
        <pattern id="pz-grass" width="54" height="54" patternUnits="userSpaceOnUse">
          <path d="M8 20 l3 -7 l2 7 M30 44 l3 -8 l3 8 M44 14 l2 -6 l3 6 M18 50 l2 -5 l2 5" stroke="#3f9a2a" strokeWidth="1.6" fill="none" strokeLinecap="round" />
          <circle cx="24" cy="10" r="1.6" fill="#7fd45a" />
          <circle cx="48" cy="36" r="1.4" fill="#7fd45a" />
        </pattern>
        <radialGradient id="pz-glow" cx="50%" cy="50%" r="65%">
          <stop offset="0" stopColor="#7ccf4f" />
          <stop offset="1" stopColor="#4ea532" />
        </radialGradient>
      </defs>
      <rect width={w} height={h} fill="url(#pz-glow)" />
      <rect width={w} height={h} fill="url(#pz-grass)" opacity="0.35" />
      {/* 가운데 광장 (흙 바닥) */}
      <ellipse cx={cx} cy={cy} rx={plazaR + 4} ry={plazaR * 0.78 + 4} fill="#9b6a3a" />
      <ellipse cx={cx} cy={cy} rx={plazaR} ry={plazaR * 0.78} fill="#dcaa6c" />
      <ellipse cx={cx} cy={cy - plazaR * 0.1} rx={plazaR * 0.72} ry={plazaR * 0.48} fill="#e6bd85" opacity="0.6" />
      {/* 물류센터 마당 */}
      <ellipse cx={cx} cy={h * (tall ? 0.95 : 0.93)} rx={w * (tall ? 0.56 : 0.27)} ry={h * (tall ? 0.07 : 0.11)} fill="#9b6a3a" />
      <ellipse cx={cx} cy={h * (tall ? 0.95 : 0.93)} rx={w * (tall ? 0.56 : 0.27) - 4} ry={h * (tall ? 0.07 : 0.11) - 4} fill="#d6a668" />
      {/* 덤불 · 꽃 · 돌 · 풀 */}
      {deco.map((d, i) => (
        <g key={i} transform={`translate(${d.x.toFixed(1)},${d.y.toFixed(1)}) scale(${d.s.toFixed(2)})`}>
          {d.k === 'bush' && (
            <>
              <ellipse cx="0" cy="10" rx="20" ry="6" fill="#2f6f1f" opacity="0.35" />
              <circle cx="-9" cy="2" r="10" fill="#3c8f28" stroke="#1f3d14" strokeWidth="1.6" />
              <circle cx="9" cy="2" r="10" fill="#3c8f28" stroke="#1f3d14" strokeWidth="1.6" />
              <circle cx="0" cy="-6" r="11" fill="#4dab33" stroke="#1f3d14" strokeWidth="1.6" />
              <circle cx="-3" cy="-9" r="3" fill="#7fd45a" />
              {i % 3 === 0 && <circle cx="6" cy="-2" r="2.6" fill="#ff4b5c" stroke="#7a1d25" strokeWidth="0.8" />}
              {i % 3 === 0 && <circle cx="-6" cy="3" r="2.6" fill="#ff4b5c" stroke="#7a1d25" strokeWidth="0.8" />}
            </>
          )}
          {d.k === 'flower' && (
            <>
              <path d="M0 8 L0 0" stroke="#2f7a1f" strokeWidth="1.6" />
              {[0, 72, 144, 216, 288].map((a) => (
                <circle key={a} cx={4 * Math.cos((a * Math.PI) / 180)} cy={-2 + 4 * Math.sin((a * Math.PI) / 180)} r="3" fill={d.c} stroke="#3b2626" strokeWidth="0.7" />
              ))}
              <circle cx="0" cy="-2" r="2" fill="#ffcf33" />
            </>
          )}
          {d.k === 'rock' && (
            <>
              <ellipse cx="0" cy="0" rx="11" ry="7" fill="#9aa3a8" stroke="#3b4246" strokeWidth="1.6" />
              <ellipse cx="-3" cy="-2" rx="4" ry="2" fill="#c6cdd1" />
            </>
          )}
          {d.k === 'tuft' && <path d="M-6 4 L-3 -6 L0 3 L3 -8 L5 3 L8 -4 L9 4 Z" fill="#3f9a2a" stroke="#1f3d14" strokeWidth="1.2" strokeLinejoin="round" />}
        </g>
      ))}
    </svg>
  );
}

type Note = { id: string; to: string; toName?: string; from: string; fromName: string; img: string; at: string; read?: boolean };
/** 2026-11-26T08:31… → 11.26 17:31 (내 시간) */
const noteTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}.${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function Plaza() {
  const { email: me0 } = useAccess();
  const me = (me0 ?? '').toLowerCase();
  const { data } = useStore();
  const { roles, contacts } = usePeople();
  const t1 = useSpaceData('1', ['members', 'orders', 'companies']);
  const t2 = useSpaceData('2', ['members', 'orders', 'companies']);
  const t3 = useSpaceData('3', ['members', 'orders', 'companies']);
  const spaces = { '1': t1, '2': t2, '3': t3 } as const;

  // 1분마다 다시 (불 켜고 끄기 · 하늘 색)
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const todayIso = isoOf(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const sky = nowMin < 6 * 60 || nowMin >= 19 * 60 ? 'night' : nowMin >= 17 * 60 ? 'dusk' : 'day';

  const nameOf = (email?: string) => {
    const e = (email ?? '').toLowerCase();
    return contacts[e]?.name || roles?.find((r) => r.email === e)?.name || '';
  };
  const alt = (m: Member) => [nameOf(m.email)];

  // ---------- 쪽지 ----------
  const [inbox, setInbox] = useState<Note[]>([]);
  useEffect(() => {
    if (DATA_MODE === 'local' || !me) return;
    return onSnapshot(
      query(collection(db, 'plazaNotes'), where('to', '==', me)),
      (snap) => setInbox(snap.docs.map((d) => ({ ...(d.data() as Note), id: d.id })).sort((a, b) => b.at.localeCompare(a.at))),
      () => setInbox([]),
    );
  }, [me]);
  const [sent, setSent] = useState<Note[]>([]);
  useEffect(() => {
    if (DATA_MODE === 'local' || !me) return;
    return onSnapshot(
      query(collection(db, 'plazaNotes'), where('from', '==', me)),
      (snap) => setSent(snap.docs.map((d) => ({ ...(d.data() as Note), id: d.id })).sort((a, b) => b.at.localeCompare(a.at))),
      () => setSent([]),
    );
  }, [me]);
  const unread = inbox.filter((n) => !n.read).length;
  const [drawTo, setDrawTo] = useState<{ email: string; name: string } | null>(null);
  const [inboxOpen, setInboxOpen] = useState(false);
  const myName = nameOf(me) || me.split('@')[0];

  // ---------- 집 ----------
  const leaders = (roles ?? [])
    .filter((r) => r.role === 'director' || r.role === 'lead')
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'director' ? -1 : 1));
  const houseProps = (m: Member) => ({
    m,
    mine: !!me && (m.email ?? '').toLowerCase() === me,
    unread,
    onMail: () => {
      if ((m.email ?? '').toLowerCase() === me) setInboxOpen(true);
      else if (m.email) setDrawTo({ email: m.email.toLowerCase(), name: m.name });
    },
  });
  // 원형 배치: 조 상관없이 한 바퀴 — 내 집 = 12시 · 물류센터 = 6시 (그 자리는 비워 둠)
  type Spot = { key: string; email: string; leader?: (typeof leaders)[number]; m?: Member };
  const spots: Spot[] = [
    ...leaders.map((r) => ({ key: `L|${r.email}`, email: r.email, leader: r })),
    ...TEAMS.flatMap((t) => [...((spaces[t].data.members as Member[] | undefined) ?? [])].sort((a, b) => a.order - b.order).map((m) => ({ key: `${t}|${m.id}`, email: (m.email ?? '').toLowerCase(), m }))),
    ...[...data.tradeMembers].sort((a, b) => a.order - b.order).map((m) => ({ key: `trade|${m.id}`, email: (m.email ?? '').toLowerCase(), m })),
  ];
  const mineAt = spots.findIndex((x) => !!me && x.email === me);
  const ring = mineAt > 0 ? [spots[mineAt], ...spots.slice(0, mineAt), ...spots.slice(mineAt + 1)] : spots;
  // 칸: 사람 수 + 물류센터 몫 3칸 → 12시부터 시계 방향으로 같은 간격, 6시 쪽 3칸은 건너뜀
  // 들판 크기 (흙길 · 덤불을 픽셀로 그리려고)
  const fieldRef = useRef<HTMLDivElement>(null);
  const [fieldSize, setFieldSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    const set = () => setFieldSize({ w: el.clientWidth, h: el.clientHeight });
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // 세로로 긴 화면(휴대폰)은 양옆 집이 잘리지 않게 원을 조금 좁게
  const tall = !!fieldSize && fieldSize.w / fieldSize.h < 0.8;
  const g = geo(tall);
  // 집 자리 = 타원 둘레를 같은 길이로 나눔 (각도로 나누면 길쭉한 화면에서 위 · 아래 집이 겹침)
  //   12시부터 시계 방향 · 6시 쪽은 물류센터 몫으로 비움 (넓은 화면은 물류센터가 커서 더 넓게)
  const angles = useMemo(() => {
    const n = ring.length;
    const w = fieldSize?.w ?? 1200;
    const h = fieldSize?.h ?? 800;
    const rx = (w * g.rx) / 100;
    const ry = (h * g.ry) / 100;
    const cum: number[] = [0];
    for (let d = 1; d <= 360; d++) {
      const a0 = ((d - 1 - 90) * Math.PI) / 180;
      const a1 = ((d - 90) * Math.PI) / 180;
      cum.push(cum[d - 1] + Math.hypot(rx * (Math.cos(a1) - Math.cos(a0)), ry * (Math.sin(a1) - Math.sin(a0))));
    }
    const P = cum[360];
    const G = tall ? 0 : P * 0.3; // 휴대폰은 물류센터가 원 밖이라 빈칸 없이
    const step = (P - G) / Math.max(1, n);
    return Array.from({ length: n }, (_, k) => {
      let want = k * step;
      if (want > (P - G) / 2 + 0.01) want += G;
      let d = 0;
      while (d < 359 && cum[d + 1] < want) d++;
      const f = cum[d + 1] > cum[d] ? (want - cum[d]) / (cum[d + 1] - cum[d]) : 0;
      return -90 + d + f;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldSize, ring.length, tall]);
  const posOf = (deg: number): CSSProperties => {
    const r = (deg * Math.PI) / 180;
    return { left: `${g.x0 + g.rx * Math.cos(r)}%`, top: `${g.y0 + g.ry * Math.sin(r)}%` };
  };

  // ---------- 관리부: 패킹 중인 주문 · 출고 예정 ----------
  const { boxes, ships } = useMemo(() => {
    const companies = new Map<string, Company>();
    for (const t of TEAMS) for (const c of (spaces[t].data.companies as Company[] | undefined) ?? []) if (!companies.has(c.id)) companies.set(c.id, c);
    const all = TEAMS.flatMap((t) => ((spaces[t].data.orders as Order[] | undefined) ?? []).map((o) => ({ ...o, team: t })));
    // 관리부 패킹 화면과 같은 기준: ERP 등록 · 접수일(없으면 주문일자) ~ 패킹완료일(없으면 주문일자 + 14일), 패킹리스트 등록 전
    const boxes = all
      .filter((o) => o.erp && !o.erpArchive && !o.shipped && !o.packListDone && (o.acceptDate || o.orderDate))
      .filter((o) => {
        const start = (o.acceptDate || o.orderDate)!.slice(0, 10);
        const end = (o.packing && parseDate(o.packing)) || addDays((o.orderDate || start).slice(0, 10), 14);
        return start <= todayIso && (end >= todayIso || o.packListDone === false);
      })
      .map((o) => {
        const c = companies.get(o.companyId ?? '');
        const p = o.packing ? parseDate(o.packing) : null;
        const until = p || addDays((o.orderDate || o.acceptDate || todayIso).slice(0, 10), 14);
        return { id: `${o.team}|${o.id}`, name: o.name, co: coShort(c), color: c?.color ?? '#b5652b', krw: o.amountKRW ?? 0, team: o.team, until, guess: !p };
      })
      .sort((a, b) => b.krw - a.krw);
    // 출고 예정: 출고일(묶음이면 묶음 출고일)이 오늘 이후 · 아직 출고 안 됨 — 묶음은 하나로
    const byKey = new Map<string, { date: string; co: string; name: string; n: number; krw: number }>();
    for (const o of all) {
      if (o.shipped) continue;
      const s = (o.bundle?.shipDate || o.shipDate || '').slice(0, 10);
      if (!s || s < todayIso) continue;
      const k = o.bundle ? `b|${o.team}|${o.bundle.id}` : `o|${o.team}|${o.id}`;
      const cur = byKey.get(k);
      if (cur) {
        cur.n++;
        cur.krw += o.amountKRW ?? 0;
      } else byKey.set(k, { date: s, co: coShort(companies.get(o.companyId ?? '')), name: o.bundle?.name || o.name, n: 1, krw: o.amountKRW ?? 0 });
    }
    const ships = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
    return { boxes, ships };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t1.data.orders, t2.data.orders, t3.data.orders, t1.data.companies, t2.data.companies, t3.data.companies, todayIso]);
  const maxKrw = Math.max(1, ...boxes.map((b) => b.krw));
  const boxSize = (krw: number) => Math.round(34 + 52 * Math.sqrt(krw / maxKrw));
  const [truckOpen, setTruckOpen] = useState(false);
  const [pickBox, setPickBox] = useState<(typeof boxes)[number] | null>(null);

  // 광장은 화면 전체 (위 메뉴 · 탭 없이) — 스크롤 막기
  useEffect(() => {
    document.documentElement.classList.add('pz-open');
    return () => document.documentElement.classList.remove('pz-open');
  }, []);
  const back = () => {
    if (window.history.length > 1) window.history.back();
    else window.location.hash = '/home';
  };

  return (
    <div className={`pz pz-${sky}`}>
      <div className="pz-top">
        <button className="pz-back" onClick={back}>
          ← 돌아가기
        </button>
        <b className="pz-title">🪼 광장</b>
        {unread > 0 ? (
          <button className="pz-mailbtn" onClick={() => setInboxOpen(true)}>
            📬 받은 쪽지 {unread}
          </button>
        ) : (
          <span className="pz-hint">불 켜진 집 = 근무 중 · 우편함을 누르면 그림 쪽지</span>
        )}
      </div>

      <div className="pz-field" ref={fieldRef} onClick={() => setPickBox(null)}>
        {fieldSize && <Ground w={fieldSize.w} h={fieldSize.h} tall={tall} />}
        {/* 가운데: 게시판 */}
        <div className="pz-board" title="게시판 · 투표 · 공지 (준비 중)">
          <div className="pz-board-face">
            <b>📌 게시판</b>
            <span>투표 · 공지</span>
            <small>곧 열려요</small>
          </div>
          <div className="pz-board-legs" />
        </div>

        {/* 둥글게: 집 (내 집 = 12시) */}
        {ring.map((x, i) => (
          <div key={x.key} className="pz-spot" style={posOf(angles[i] ?? 0)}>
            {x.leader ? (
              <LeaderHouse
                flip={i % 2 === 1}
                sayBelow={Math.sin(((angles[i] ?? 0) * Math.PI) / 180) < -0.55}
                email={x.leader.email}
                name={contacts[x.leader.email]?.name || x.leader.name || x.leader.email.split('@')[0]}
                label={x.leader.role === 'director' ? '이사님' : '팀장님'}
                space={x.leader.space}
                todayIso={todayIso}
                nowMin={nowMin}
                me={me}
                unread={unread}
                onMail={(email, name) => (email === me ? setInboxOpen(true) : setDrawTo({ email, name }))}
                alt={[nameOf(x.leader.email)]}
              />
            ) : (
              <House {...houseProps(x.m!)} flip={i % 2 === 1} sayBelow={Math.sin(((angles[i] ?? 0) * Math.PI) / 180) < -0.55} light={lightOf(attOf(x.m!, todayIso, data.memAttendance, alt(x.m!)), nowMin, todayIso)} />
            )}
          </div>
        ))}

        {/* 6시: 관리부 물류센터 — 건물 · 앞마당 박스 · 트럭 */}
        <section className="pz-wh">
          <div className="pz-wh-building">
            <img src="./plaza/warehouse.png" alt="관리부 물류센터" draggable={false} />
            <span className="pz-wh-sign">관리부</span>
          </div>
          <div className="pz-yard">
            <div className="pz-yard-boxes">
              {boxes.length === 0 ? (
                <p className="pz-wh-empty">지금 패킹 중인 주문이 없어요</p>
              ) : (
                boxes.slice(0, 40).map((b) => (
                  <img
                    key={b.id}
                    className={`pz-box ${pickBox?.id === b.id ? 'on' : ''}`}
                    src="./plaza/box.png"
                    alt={b.name}
                    draggable={false}
                    style={{ width: `calc(${boxSize(b.krw)}px * var(--box-k, 1))` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPickBox((cur) => (cur?.id === b.id ? null : b));
                    }}
                  />
                ))
              )}
              {boxes.length > 40 && <span className="pz-box-more">+{boxes.length - 40}</span>}
            </div>
            <div className="pz-wh-count">📦 패킹 중 {boxes.length}건</div>
            {pickBox && (
              <div className="pz-box-pop" onClick={() => setPickBox(null)}>
                <span className="pz-box-pop-team">{teamLabel(pickBox.team)}</span>
                {pickBox.co && <b>{pickBox.co}</b>}
                <span className="pz-box-pop-name">{pickBox.name}</span>
                <span className="pz-box-pop-amt">{won(pickBox.krw)}</span>
                {pickBox.until && <small>패킹완료 {pickBox.guess ? '예상 ' : ''}{md(pickBox.until)}</small>}
              </div>
            )}
          </div>
          <div className={`pz-truck ${truckOpen ? 'open' : ''}`} onMouseEnter={() => setTruckOpen(true)} onMouseLeave={() => setTruckOpen(false)} onClick={() => setTruckOpen((v) => !v)}>
            <img className="pz-truck-img" src="./plaza/truck.png" alt="출고 트럭" draggable={false} />
            <span className="pz-truck-n">출고 예정 {ships.length}</span>
            {truckOpen && (
              <div className="pz-truck-pop" role="tooltip">
                <b>🚚 출고 예정</b>
                {ships.length === 0 ? (
                  <p className="muted small">예정된 출고가 없어요</p>
                ) : (
                  <ul>
                    {ships.slice(0, 14).map((s, i) => (
                      <li key={i}>
                        <span className="pz-ship-d">{s.date === todayIso ? '오늘' : md(s.date)}</span>
                        <span className="pz-ship-n">
                          {s.co && <em>{s.co}</em>} {s.name}
                          {s.n > 1 && <small> · {s.n}건</small>}
                        </span>
                      </li>
                    ))}
                    {ships.length > 14 && <li className="muted small">외 {ships.length - 14}건</li>}
                  </ul>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      {drawTo && <DrawNote to={drawTo} fromEmail={me} fromName={myName} onClose={() => setDrawTo(null)} />}
      {inboxOpen && <Inbox notes={inbox} sent={sent} nameOf={(e) => nameOf(e) || e.split('@')[0]} onClose={() => setInboxOpen(false)} />}
    </div>
  );
}

function LeaderHouse({ email, name, label, space, todayIso, nowMin, me, unread, onMail, alt, flip, sayBelow }: { sayBelow?: boolean; flip?: boolean; email: string; name: string; label: string; space?: string; todayIso: string; nowMin: number; me: string; unread: number; onMail: (email: string, name: string) => void; alt: string[] }) {
  const { data } = useStore();
  const sp = useSpaceData(space ?? '', space ? ['members'] : []);
  const { profiles } = useProfiles();
  const list = (sp.data.members as Member[] | undefined) ?? [];
  const mine = list.find((x) => (x.email ?? '').toLowerCase() === email) ?? list[0];
  const base: Member = { id: email, name, color: '#b38a7d', order: 0, email };
  const card = withProfile(mine ? { ...base, character: mine.character, color: mine.color || base.color, memName: mine.memName || mine.name, id: mine.id } : base, profiles);
  const short = /^[가-힣]{3}$/.test(name) ? name.slice(1) : name;
  return (
    <House
      m={{ ...card, name: `${short} ${label}` }}
      mine={email === me}
      unread={unread}
      big
      flip={flip}
      sayBelow={sayBelow}
      onMail={() => onMail(email, `${short} ${label}`)}
      light={lightOf(attOf(card, todayIso, data.memAttendance, [...alt, name]), nowMin, todayIso)}
    />
  );
}

/** 모양 그림(흰 = 칠할 곳)으로 칠하기 — 주소는 페이지 기준 (CSS 안 url 은 빌드 때 경로가 바뀌어서) */
const maskOf = (name: string): CSSProperties => {
  const u = `url(./plaza/${name}.png)`;
  return { WebkitMaskImage: u, maskImage: u, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } as CSSProperties;
};

/** 집 그림 (public/plaza/house.png) — 지붕은 담당자 색 (house-roof.png 모양으로 칠함) · flip 이면 좌우 반대 */
function House({ m, light, mine, unread, onMail, big, flip, sayBelow }: { sayBelow?: boolean; m: Member; light: ReturnType<typeof lightOf>; mine: boolean; unread: number; onMail: () => void; big?: boolean; flip?: boolean }) {
  const canMail = mine || !!m.email;
  // 빈집을 누르면 말풍선 (5초 뒤 사라짐)
  const [say, setSay] = useState(false);
  useEffect(() => {
    if (!say) return;
    const t = window.setTimeout(() => setSay(false), 5000);
    return () => window.clearTimeout(t);
  }, [say]);
  return (
    <div className={`pz-house ${light.on ? 'on' : 'off'} ${big ? 'big' : ''} ${mine ? 'mine' : ''} ${flip ? 'flip' : ''}`} style={{ '--c': m.color || '#8c2f3c' } as CSSProperties}>
      {say && light.msg && (
        <div className={`pz-say ${light.memo ? 'memo' : sayBelow ? 'below' : ''}`} onClick={() => setSay(false)}>
          {light.msg}
        </div>
      )}
      <div className={`pz-art ${light.msg ? 'can-say' : ''}`} onClick={(e) => !(e.target as HTMLElement).closest('.pz-mailbox') && light.msg && setSay((v) => !v)}>
        <img className="pz-art-base" src="./plaza/house.png" alt="" draggable={false} />
        <span className="pz-art-roof" style={maskOf('house-roof')} />
        <span className="pz-art-glass" style={maskOf('house-glass')} />
        {light.on && <img className="pz-art-char" src={characterSrc(charOf(m))} alt="" draggable={false} />}
        <button className={`pz-mailbox ${mine && unread ? 'has' : ''}`} disabled={!canMail || DATA_MODE === 'local'} onClick={onMail} title={mine ? '받은 쪽지' : canMail ? `${m.name}에게 그림 쪽지` : '로그인 이메일이 없어서 쪽지를 못 보내요'} aria-label={mine ? '받은 쪽지' : `${m.name}에게 그림 쪽지`}>
          {mine && unread > 0 && <i>{unread}</i>}
        </button>
      </div>
      <span className="pz-name" title={light.sign || undefined}>
        {m.name}
        {mine && <small> (나)</small>}
        {light.icon && (
          <span className="pz-name-ic" aria-label={light.sign}>
            {light.icon}
          </span>
        )}
      </span>
    </div>
  );
}

// ---------- 그림 쪽지 ----------
const COLORS = ['#3b2626', '#8c2f3c', '#e0544b', '#f2a93b', '#f7d84a', '#5f9e4a', '#3f7fd0', '#8a5cc7', '#ffffff'];
const W = 520;
const H = 360;

function DrawNote({ to, fromEmail, fromName, onClose }: { to: { email: string; name: string }; fromEmail: string; fromName: string; onClose: () => void }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[1]);
  const [size, setSize] = useState(6);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [drawn, setDrawn] = useState(false);
  const history = useRef<ImageData[]>([]);
  const drawing = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const c = cv.current!.getContext('2d')!;
    c.fillStyle = '#fffaf2';
    c.fillRect(0, 0, W, H);
  }, []);
  const pos = (e: React.PointerEvent) => {
    const r = cv.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const c = cv.current!.getContext('2d')!;
    c.strokeStyle = color;
    c.lineWidth = size;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
  };
  const down = (e: React.PointerEvent) => {
    const c = cv.current!.getContext('2d')!;
    history.current.push(c.getImageData(0, 0, W, H));
    if (history.current.length > 30) history.current.shift();
    cv.current!.setPointerCapture(e.pointerId);
    const p = pos(e);
    drawing.current = p;
    line(p, { x: p.x + 0.01, y: p.y });
    setDrawn(true);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = pos(e);
    line(drawing.current, p);
    drawing.current = p;
  };
  const up = () => (drawing.current = null);
  const undo = () => {
    const h = history.current.pop();
    if (h) cv.current!.getContext('2d')!.putImageData(h, 0, 0);
  };
  const clear = () => {
    const c = cv.current!.getContext('2d')!;
    history.current.push(c.getImageData(0, 0, W, H));
    c.fillStyle = '#fffaf2';
    c.fillRect(0, 0, W, H);
  };
  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      const img = cv.current!.toDataURL('image/webp', 0.85);
      await addDoc(collection(db, 'plazaNotes'), { to: to.email, toName: to.name, from: fromEmail, fromName, img, at: new Date().toISOString(), read: false });
      onClose();
    } catch (e) {
      setErr(`못 보냈어요: ${(e as Error).message} (보안 규칙을 올렸는지 확인 — deploy.bat)`);
      setBusy(false);
    }
  };
  return (
    <Modal title={`✉️ ${to.name}에게 그림 쪽지`} onClose={onClose}>
      <div className="pz-draw">
        <canvas ref={cv} width={W} height={H} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        <div className="pz-draw-tools">
          <div className="pz-colors">
            {COLORS.map((c) => (
              <button key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={c === '#ffffff' ? '지우개(흰색)' : c} />
            ))}
          </div>
          <div className="pz-sizes">
            {[3, 6, 12, 22].map((s) => (
              <button key={s} className={size === s ? 'on' : ''} onClick={() => setSize(s)} aria-label={`굵기 ${s}`}>
                <i style={{ width: s, height: s }} />
              </button>
            ))}
          </div>
          <button onClick={undo}>↶ 되돌리기</button>
          <button onClick={clear}>새로</button>
          <span className="pz-draw-gap" />
          <button className="primary" disabled={!drawn || busy} onClick={send}>
            {busy ? '보내는 중…' : '보내기'}
          </button>
        </div>
        {err && <p className="pz-err">{err}</p>}
      </div>
    </Modal>
  );
}

function Inbox({ notes, sent, nameOf, onClose }: { notes: Note[]; sent: Note[]; nameOf: (email: string) => string; onClose: () => void }) {
  const [tab, setTab] = useState<'in' | 'out'>('in');
  const [open, setOpen] = useState<Note | null>(null);
  // 받은 편지함을 열면 읽음으로
  useEffect(() => {
    if (tab !== 'in') return;
    for (const n of notes) if (!n.read) void updateDoc(doc(db, 'plazaNotes', n.id), { read: true }).catch(() => {});
  }, [notes, tab]);
  const list = tab === 'in' ? notes : sent;
  const who = (n: Note) => (tab === 'in' ? n.fromName : `To. ${n.toName || nameOf(n.to)}`);
  return (
    <Modal title="📬 내 우편함" onClose={onClose} wide>
      <div className="pz-mail-tabs">
        <button className={tab === 'in' ? 'on' : ''} onClick={() => setTab('in')}>
          받은 편지함 <small>{notes.length}</small>
        </button>
        <button className={tab === 'out' ? 'on' : ''} onClick={() => setTab('out')}>
          보낸 편지함 <small>{sent.length}</small>
        </button>
      </div>
      {list.length === 0 ? (
        <p className="muted">{tab === 'in' ? '아직 받은 쪽지가 없어요.' : '아직 보낸 쪽지가 없어요. 다른 집 우편함을 눌러 보세요.'}</p>
      ) : (
        <div className="pz-inbox">
          {list.map((n) => (
            <figure key={n.id} className={tab === 'in' && !n.read ? 'new' : ''} onClick={() => setOpen(n)}>
              <img src={n.img} alt={`${who(n)} 그림 쪽지`} />
              <figcaption>
                <b>{who(n)}</b> · {noteTime(n.at)}
                {tab === 'out' && <span className={`pz-read ${n.read ? 'on' : ''}`}>{n.read ? '읽음' : '안 읽음'}</span>}
                {(tab === 'in' || !n.read) && (
                  <button
                    className="link small"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(tab === 'in' ? '이 쪽지를 지울까요?' : '아직 안 읽었어요. 보내기를 취소할까요? (받는 사람 우편함에서도 없어져요)')) void deleteDoc(doc(db, 'plazaNotes', n.id));
                    }}
                  >
                    {tab === 'in' ? '지우기' : '보내기 취소'}
                  </button>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {open && (
        <div className="pz-note-big" onClick={() => setOpen(null)}>
          <img src={open.img} alt="" />
          <span>
            {who(open)} · {noteTime(open.at)} · 누르면 닫혀요
          </span>
        </div>
      )}
    </Modal>
  );
}
