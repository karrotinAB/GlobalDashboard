// 주문 관리 › 🗓 관리부 패킹: 1~3조 'ERP 등록' 주문을 달력에 — 주문접수일(없으면 주문일자) ~ 패킹완료일(없으면 주문일자 + 14일) 한 줄
//   줄 색 = 업체 색 · 마우스 올리면 무슨 주문인지 · 누르면 주문일자 / 주문접수일 / 패킹완료일 (접수일 · 패킹완료일 고침 → 주문 리스트에도)
//   ★ = 관리부 출고일 (주문 리스트의 관리부 출고일 · 묶음이면 묶음 출고일)
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { doc, updateDoc, deleteField } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useSpaceData } from '../data/store';
import { useAccess } from '../components/AuthGate';
import { physName, TEAMS } from '../lib/team';
import { parseDate } from '../components/DateInput';
import { DateCell } from '../components/OrderCells';
import { Modal } from '../components/ui';
import type { Company, Order } from '../types';

type T = Order & { team: string };
const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const dot = (s?: string) => (s ? s.replace(/-/g, '.') : '');
/** 패킹완료일 (자유 글자) → YYYY-MM-DD */
const packIso = (o: Order) => (o.packing ? parseDate(o.packing) : null);
const shipOf = (o: Order) => o.bundle?.shipDate || o.shipDate || '';

export default function OrdersPacking({ tabs }: { tabs: ReactNode }) {
  const access = useAccess();
  const t1 = useSpaceData('1', ['orders', 'companies']);
  const t2 = useSpaceData('2', ['orders', 'companies']);
  const t3 = useSpaceData('3', ['orders', 'companies']);
  const spaces = { '1': t1, '2': t2, '3': t3 } as const;
  const [patched, setPatched] = useState<Record<string, T>>({});
  const orders = useMemo(
    () =>
      TEAMS.flatMap((t) => ((spaces[t].data.orders as Order[] | undefined) ?? []).map((o) => patched[`${t}|${o.id}`] ?? ({ ...o, team: t } as T))).filter(
        (o) => o.erp && !o.erpArchive && (o.acceptDate || o.orderDate),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t1.data.orders, t2.data.orders, t3.data.orders, patched],
  );
  const companies = useMemo(() => {
    const m = new Map<string, Company>();
    for (const t of TEAMS) for (const c of (spaces[t].data.companies as Company[] | undefined) ?? []) if (!m.has(c.id)) m.set(c.id, c);
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t1.data.companies, t2.data.companies, t3.data.companies]);
  const [teamF, setTeamF] = useState('');
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pick, setPick] = useState<string | null>(null);

  // 줄: 시작(접수일 · 없으면 주문일자) ~ 끝(패킹완료일 · 없으면 주문일자 + 14일)
  //   묶음 주문은 묶음 하나 = 한 줄 (안의 주문 중 가장 이른 시작 ~ 가장 늦은 패킹완료일) · 묶음 아닌 주문은 주문마다
  const bars = useMemo(() => {
    const groups = new Map<string, T[]>();
    for (const o of orders) {
      if (teamF && o.team !== teamF) continue;
      const k = o.bundle ? `${o.team}|b:${o.bundle.id}` : `${o.team}|${o.id}`;
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    return [...groups.entries()].map(([key, os]) => {
      const one = (o: T) => {
        const start = (o.acceptDate || o.orderDate)!.slice(0, 10);
        const p = packIso(o);
        const end = p ?? addDays((o.orderDate || start).slice(0, 10), 14);
        return { start, end: end < start ? start : end, guess: !p };
      };
      const rs = os.map(one);
      const start = rs.map((r) => r.start).sort()[0];
      const end = rs.map((r) => r.end).sort().at(-1)!;
      const o = os[0];
      const c = companies.get(o.companyId ?? '');
      return { o, os, key, name: o.bundle ? o.bundle.name || '묶음' : o.name, start, end, guess: rs.every((r) => r.guess), color: c?.color ?? '#8c2f3c', coName: (c?.name ?? '').replace(/\s*\(.*\)\s*$/, '') };
    });
  }, [orders, teamF, companies]);

  // 이 달 달력 (일요일부터 · 6주까지)
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(first);
  gridStart.setDate(1 - first.getDay());
  const weeks: string[][] = [];
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + w * 7 + i);
      return iso(d);
    });
    if (w > 3 && !row.some((d) => d.slice(0, 7) === iso(first).slice(0, 7))) break;
    weeks.push(row);
  }
  const today = iso(new Date());
  const ym = iso(first).slice(0, 7);
  // ★ 관리부 출고일
  const shipByDay = useMemo(() => {
    const m = new Map<string, T[]>();
    for (const o of orders) {
      if (teamF && o.team !== teamF) continue;
      const s = shipOf(o);
      if (s) m.set(s.slice(0, 10), [...(m.get(s.slice(0, 10)) ?? []), o]);
    }
    return m;
  }, [orders, teamF]);

  // 고치기: 관리자 · 조원 (다른 조 주문도 패킹완료일 · 주문접수일만 — 서버 규칙도 이 두 칸만) / 팀장님 · 이사님 · 무역사무 · IT 검토용은 보기만
  const canEdit = (o: T) => { void o; return !access.auditor && (access.role === 'admin' || access.role === null || access.role === 'member'); };
  const save = async (o: T, patch: { packing?: string | null; acceptDate?: string | null }) => {
    const next = { ...o } as T;
    if ('packing' in patch) next.packing = patch.packing || undefined;
    if ('acceptDate' in patch) next.acceptDate = patch.acceptDate || undefined;
    setPatched((p) => ({ ...p, [`${o.team}|${o.id}`]: next }));
    if (DATA_MODE === 'local') {
      const key = o.team === '2' ? 'global-dashboard:v3' : `global-dashboard:v3:t${o.team}`;
      const all = JSON.parse(localStorage.getItem(key) ?? '{}');
      all.orders = (all.orders ?? []).map((x: Order) => (x.id === o.id ? { ...x, packing: next.packing, acceptDate: next.acceptDate } : x));
      localStorage.setItem(key, JSON.stringify(all));
      return;
    }
    const upd: Record<string, string | ReturnType<typeof deleteField>> = {};
    if ('packing' in patch) upd.packing = patch.packing || deleteField();
    if ('acceptDate' in patch) upd.acceptDate = patch.acceptDate || deleteField();
    try {
      await updateDoc(doc(db, physName('orders', o.team), o.id), upd);
    } catch (e) {
      setPatched((p) => {
        const x = { ...p };
        delete x[`${o.team}|${o.id}`];
        return x;
      });
      alert(`저장하지 못했어요: ${(e as Error).message}\n(서버 규칙을 새로 올렸는지 확인해 주세요 — deploy.bat)`);
    }
  };

  const sel = pick ? bars.find((b) => b.key === pick) : null;
  const loading = [t1, t2, t3].some((s) => !s.ready) && !orders.length;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주문 관리</h1>
          <p className="muted">1~3조에서 ERP 등록한 주문이 주문접수일(없으면 주문일자)부터 패킹완료일까지 한 줄로 보여요. 패킹완료일이 없으면 주문일자 + 14일 (점선). ★ = 관리부 출고일.</p>
        </div>
      </div>
      {tabs}
      <div className="card toolbar pk-toolbar">
        <span className="seg">
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="앞 달">
            ‹
          </button>
          <button className="on" onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} title="이번 달로">
            {month.getFullYear()}. {month.getMonth() + 1}월
          </button>
          <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="다음 달">
            ›
          </button>
        </span>
        <select value={teamF} onChange={(e) => setTeamF(e.target.value)}>
          <option value="">조 전체</option>
          {TEAMS.map((t) => (
            <option key={t} value={t}>
              {t}조
            </option>
          ))}
        </select>
        <span className="muted small">이 달 주문 {bars.filter((b) => b.start <= weeks.at(-1)!.at(-1)! && b.end >= weeks[0][0]).length}개</span>
      </div>
      {loading ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <div className="card pk-cal">
          <div className="pk-dow">
            {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
              <span key={d} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>
                {d}
              </span>
            ))}
          </div>
          {weeks.map((row) => {
            const ws = row[0];
            const we = row[6];
            // 이 주에 걸친 줄 → 겹치지 않게 자리(lane) 나눔
            const inWeek = bars.filter((b) => b.start <= we && b.end >= ws).sort((a, b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end));
            const lanes: string[] = [];
            const placed = inWeek.map((b) => {
              const s = b.start < ws ? ws : b.start;
              const e = b.end > we ? we : b.end;
              let lane = lanes.findIndex((end) => end < s);
              if (lane < 0) lane = lanes.length;
              lanes[lane] = e;
              return { b, col: row.indexOf(s), span: row.indexOf(e) - row.indexOf(s) + 1, lane, cutL: b.start < ws, cutR: b.end > we };
            });
            return (
              <div key={ws} className="pk-week" style={{ '--lanes': Math.max(lanes.length, 1) } as CSSProperties}>
                {row.map((d, i) => {
                  const ships = shipByDay.get(d) ?? [];
                  return (
                    <div key={d} className={`pk-day ${d.slice(0, 7) !== ym ? 'other' : ''} ${d === today ? 'today' : ''} ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
                      <span className="pk-num">
                        {Number(d.slice(8))}
                        {ships.length > 0 && (
                          <span className="pk-star" title={`관리부 출고\n${ships.map((o) => `${o.team}조 ${(companies.get(o.companyId ?? '')?.name ?? '').replace(/\s*\(.*\)\s*$/, '')} · ${o.bundle?.name || o.name}`).join('\n')}`}>
                            {ships.slice(0, 4).map((o, k) => (
                              <i key={k} style={{ color: companies.get(o.companyId ?? '')?.color ?? '#c0392b' }}>
                                ★
                              </i>
                            ))}
                            {ships.length > 4 && <small>+{ships.length - 4}</small>}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
                <div className="pk-bars">
                  {placed.map(({ b, col, span, lane, cutL, cutR }) => (
                    <button
                      key={b.key}
                      className={`pk-bar ${b.guess ? 'guess' : ''} ${cutL ? 'cut-l' : ''} ${cutR ? 'cut-r' : ''} ${pick === b.key ? 'on' : ''}`}
                      style={{ '--c': b.color, gridColumn: `${col + 1} / span ${span}`, gridRow: lane + 1 } as CSSProperties}
                      title={`${b.o.team}조 · ${b.coName} · ${b.o.bundle ? `📦 ${b.name} (주문 ${b.os.length}개)` : `${b.name}${b.o.storeCode ? ` (${b.o.storeCode})` : ''}`}\n${dot(b.start)} → 패킹 ${dot(b.end)}${b.guess ? ' (예상: 주문일자 + 14일)' : ''}`}
                      onClick={() => setPick(b.key)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {sel && (
        <Modal title={`📦 ${sel.o.team}조 · ${sel.name}`} onClose={() => setPick(null)} wide={sel.os.length > 1}>
          <p className="muted small" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: sel.color }} /> {companies.get(sel.o.companyId ?? '')?.name ?? ''}
            {sel.o.bundle ? ` · 묶음 주문 ${sel.os.length}개` : sel.o.storeCode ? ` · 매장 ${sel.o.storeCode}` : ''} · 달력 {dot(sel.start)} → {dot(sel.end)}
            {sel.guess && ' (패킹완료일 없음 → 주문일자 + 14일)'}
          </p>
          <div className="table-scroll">
            <table className="pk-table">
              <thead>
                <tr>
                  <th>주문</th>
                  <th>주문일자</th>
                  <th title="관리부로 실제 들어간 날 · 비우면 = 주문일자">주문접수일</th>
                  <th title="주문 리스트 패킹 완료일과 같이 바뀌어요 · 비우면 달력엔 주문일자 + 14일">패킹완료일</th>
                  <th>관리부 출고일</th>
                </tr>
              </thead>
              <tbody>
                {sel.os.map((o) => (
                  <tr key={o.id}>
                    <td>
                      <b>{o.name}</b>
                      {o.storeCode && <span className="muted small"> {o.storeCode}</span>}
                    </td>
                    <td>{dot(o.orderDate) || '-'}</td>
                    <td className={o.acceptDate ? '' : 'pk-same'}>
                      {canEdit(o) ? <DateCell value={o.acceptDate || o.orderDate} onSave={(v) => void save(o, { acceptDate: v && v !== o.orderDate ? v : null })} /> : dot(o.acceptDate || o.orderDate)}
                    </td>
                    <td className={packIso(o) ? '' : 'pk-same'}>
                      {canEdit(o) ? (
                        <DateCell value={packIso(o) ?? undefined} onSave={(v) => void save(o, { packing: v ? dot(v) : null })} />
                      ) : (
                        dot(packIso(o) ?? '') || '-'
                      )}
                      {!packIso(o) && <span className="muted small"> 예상 {dot(addDays((o.orderDate || '').slice(0, 10), 14))}</span>}
                      {o.packing && !packIso(o) && <span className="warn small"> "{o.packing}"</span>}
                    </td>
                    <td>{shipOf(o) ? `★ ${dot(shipOf(o))}` : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {sel.os.length > 1 && canEdit(sel.o) && (
            <div className="pk-all small">
              <span>묶음 전체 한 번에:</span>
              <label>
                접수일 <DateCell value={undefined} onSave={(v) => v && sel.os.forEach((o) => void save(o, { acceptDate: v !== o.orderDate ? v : null }))} />
              </label>
              <label>
                패킹완료일 <DateCell value={undefined} onSave={(v) => v && sel.os.forEach((o) => void save(o, { packing: dot(v) }))} />
              </label>
            </div>
          )}
          <p className="muted small">주문접수일 = 관리부로 실제 들어간 날 (비우면 주문일자) · 패킹완료일은 주문 리스트와 같이 바뀌어요.{!canEdit(sel.o) && ' 보기만 할 수 있어요.'}</p>
        </Modal>
      )}
    </div>
  );
}
