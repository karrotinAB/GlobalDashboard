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

/** 지금 불이 켜져 있나 + 꺼져 있으면 왜 */
function lightOf(r: Attendance | undefined, nowMin: number): { on: boolean; sign: string; icon: string } {
  if (!r) return { on: false, sign: '', icon: '' };
  const txt = `${r.status} ${r.period ?? ''}`;
  if (r.status.includes('퇴근')) return { on: false, sign: '퇴근', icon: '🌙' };
  if (/출장/.test(txt)) return { on: false, sign: '출장', icon: '✈️' };
  // 대체시차 · 반차 · 외출: 그 시간 안이면 꺼짐
  const tm = r.period?.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  if (tm && /시차|반차|외출/.test(txt)) {
    const a = Number(tm[1]) * 60 + Number(tm[2]);
    const b = Number(tm[3]) * 60 + Number(tm[4]);
    if (nowMin >= a && nowMin < b) return { on: false, sign: /시차/.test(txt) ? '대체시차' : /반차/.test(txt) ? '반차' : '외출', icon: '⏱' };
  }
  if (r.status === '근무') return { on: true, sign: '', icon: '' };
  if (r.status === '근무전') return { on: false, sign: '출근 전', icon: '💤' };
  if (/연차|휴가|반차|병가|경조/.test(txt)) return { on: false, sign: '휴가', icon: '🌴' };
  return { on: false, sign: r.status, icon: '' };
}

type Note = { id: string; to: string; from: string; fromName: string; img: string; at: string; read?: boolean };

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
  const streets = [
    ...TEAMS.map((t) => ({ key: t, label: `${teamLabel(t)} 마을`, people: [...((spaces[t].data.members as Member[] | undefined) ?? [])].sort((a, b) => a.order - b.order) })),
    { key: 'trade', label: '무역사무 마을', people: [...data.tradeMembers].sort((a, b) => a.order - b.order) },
  ];

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
        return { id: `${o.team}|${o.id}`, name: o.name, co: coShort(c), color: c?.color ?? '#b5652b', krw: o.amountKRW ?? 0, team: o.team };
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

  return (
    <div className={`pz pz-${sky}`}>
      <div className="pz-sky" aria-hidden="true">
        <span className="pz-sun" />
        {sky === 'night' && Array.from({ length: 24 }, (_, i) => <i key={i} className="pz-star" style={{ left: `${(i * 37) % 100}%`, top: `${(i * 53) % 70}%`, animationDelay: `${(i % 7) * 0.4}s` }} />)}
        <span className="pz-cloud a" />
        <span className="pz-cloud b" />
      </div>
      <header className="pz-head">
        <h1>🪼 광장</h1>
        <p>
          불 켜진 집 = 지금 근무 중 · 우편함을 누르면 그림 쪽지를 보낼 수 있어요
          {unread > 0 && (
            <button className="pz-mailbtn" onClick={() => setInboxOpen(true)}>
              📬 받은 쪽지 {unread}
            </button>
          )}
        </p>
      </header>

      {/* 언덕 위: 이사님 · 팀장님 + 게시판 */}
      <section className="pz-hill">
        {leaders.length > 0 ? (
        <div className="pz-street pz-leaders">
          <div className="pz-street-sign">이사님 · 팀장님</div>
          <div className="pz-houses">
            {leaders.map((r, i) => (
              <LeaderHouse
                flip={i % 2 === 1}
                key={r.email}
                email={r.email}
                name={contacts[r.email]?.name || r.name || r.email.split('@')[0]}
                label={r.role === 'director' ? '이사님' : '팀장님'}
                space={r.space}
                todayIso={todayIso}
                nowMin={nowMin}
                me={me}
                unread={unread}
                onMail={(email, name) => (email === me ? setInboxOpen(true) : setDrawTo({ email, name }))}
                alt={[nameOf(r.email)]}
              />
            ))}
          </div>
        </div>
        ) : (
          <span />
        )}
        <div className="pz-board" title="게시판 · 투표 · 공지 (준비 중)">
          <div className="pz-board-face">
            <b>📌 게시판</b>
            <span>투표 · 공지</span>
            <small>곧 열려요</small>
          </div>
          <div className="pz-board-legs" />
        </div>
      </section>

      {/* 가운데: 관리부 물류센터 — 건물 · 앞마당에 패킹 중 박스 · 트럭 */}
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
                  className="pz-box"
                  src="./plaza/box.png"
                  alt=""
                  draggable={false}
                  style={{ width: boxSize(b.krw) }}
                  title={`${b.co ? `${b.co} · ` : ''}${b.name}\n${won(b.krw)} · ${teamLabel(b.team)}`}
                />
              ))
            )}
            {boxes.length > 40 && <span className="pz-box-more">+{boxes.length - 40}</span>}
          </div>
          <div className="pz-wh-count">📦 패킹 중 {boxes.length}건</div>
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

      {/* 아래: 마을 */}
      <section className="pz-town">
        {streets
          .filter((s) => s.people.length)
          .map((s) => (
            <div key={s.key} className="pz-street">
              <div className="pz-street-sign">{s.label}</div>
              <div className="pz-houses">
                {s.people.map((m, i) => (
                  <House key={m.id} {...houseProps(m)} flip={i % 2 === 1} light={lightOf(attOf(m, todayIso, data.memAttendance, alt(m)), nowMin)} />
                ))}
              </div>
            </div>
          ))}
      </section>

      {drawTo && <DrawNote to={drawTo} fromEmail={me} fromName={myName} onClose={() => setDrawTo(null)} />}
      {inboxOpen && <Inbox notes={inbox} onClose={() => setInboxOpen(false)} />}
    </div>
  );
}

function LeaderHouse({ email, name, label, space, todayIso, nowMin, me, unread, onMail, alt, flip }: { flip?: boolean; email: string; name: string; label: string; space?: string; todayIso: string; nowMin: number; me: string; unread: number; onMail: (email: string, name: string) => void; alt: string[] }) {
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
      onMail={() => onMail(email, `${short} ${label}`)}
      light={lightOf(attOf(card, todayIso, data.memAttendance, [...alt, name]), nowMin)}
    />
  );
}

/** 모양 그림(흰 = 칠할 곳)으로 칠하기 — 주소는 페이지 기준 (CSS 안 url 은 빌드 때 경로가 바뀌어서) */
const maskOf = (name: string): CSSProperties => {
  const u = `url(./plaza/${name}.png)`;
  return { WebkitMaskImage: u, maskImage: u, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } as CSSProperties;
};

/** 집 그림 (public/plaza/house.png) — 지붕은 담당자 색 (house-roof.png 모양으로 칠함) · flip 이면 좌우 반대 */
function House({ m, light, mine, unread, onMail, big, flip }: { m: Member; light: ReturnType<typeof lightOf>; mine: boolean; unread: number; onMail: () => void; big?: boolean; flip?: boolean }) {
  const canMail = mine || !!m.email;
  return (
    <div className={`pz-house ${light.on ? 'on' : 'off'} ${big ? 'big' : ''} ${mine ? 'mine' : ''} ${flip ? 'flip' : ''}`} style={{ '--c': m.color || '#8c2f3c' } as CSSProperties}>
      {light.sign && (
        <span className="pz-sign" title={light.sign}>
          {light.icon} {light.sign}
        </span>
      )}
      <div className="pz-art">
        <img className="pz-art-base" src="./plaza/house.png" alt="" draggable={false} />
        <span className="pz-art-roof" style={maskOf('house-roof')} />
        <span className="pz-art-glass" style={maskOf('house-glass')} />
        {light.on && <img className="pz-art-char" src={characterSrc(charOf(m))} alt="" draggable={false} />}
        <button className={`pz-mailbox ${mine && unread ? 'has' : ''}`} disabled={!canMail || DATA_MODE === 'local'} onClick={onMail} title={mine ? '받은 쪽지' : canMail ? `${m.name}에게 그림 쪽지` : '로그인 이메일이 없어서 쪽지를 못 보내요'} aria-label={mine ? '받은 쪽지' : `${m.name}에게 그림 쪽지`}>
          {mine && unread > 0 && <i>{unread}</i>}
        </button>
      </div>
      <span className="pz-name">
        {m.name}
        {mine && <small> (나)</small>}
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
      await addDoc(collection(db, 'plazaNotes'), { to: to.email, from: fromEmail, fromName, img, at: new Date().toISOString(), read: false });
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

function Inbox({ notes, onClose }: { notes: Note[]; onClose: () => void }) {
  const [open, setOpen] = useState<Note | null>(null);
  // 열면 읽음으로
  useEffect(() => {
    for (const n of notes) if (!n.read) void updateDoc(doc(db, 'plazaNotes', n.id), { read: true }).catch(() => {});
  }, [notes]);
  return (
    <Modal title="📬 받은 쪽지" onClose={onClose} wide>
      {notes.length === 0 ? (
        <p className="muted">아직 받은 쪽지가 없어요.</p>
      ) : (
        <div className="pz-inbox">
          {notes.map((n) => (
            <figure key={n.id} className={n.read ? '' : 'new'} onClick={() => setOpen(n)}>
              <img src={n.img} alt={`${n.fromName}의 그림 쪽지`} />
              <figcaption>
                <b>{n.fromName}</b> · {n.at.slice(5, 10).replace('-', '.')} {n.at.slice(11, 16)}
                <button
                  className="link small"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm('이 쪽지를 지울까요?')) void deleteDoc(doc(db, 'plazaNotes', n.id));
                  }}
                >
                  지우기
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {open && (
        <div className="pz-note-big" onClick={() => setOpen(null)}>
          <img src={open.img} alt="" />
          <span>
            {open.fromName} · 누르면 닫혀요
          </span>
        </div>
      )}
    </Modal>
  );
}
