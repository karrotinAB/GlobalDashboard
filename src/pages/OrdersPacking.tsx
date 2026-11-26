// 주문 관리 › 🗓 관리부 패킹: 1~3조 'ERP 등록' 주문 (업체 + 실주문 일자별 한 덩어리 = 주문접수일(없으면 주문일자) ~ 패킹완료일(없으면 주문일자 + 14일, 연하게))
//   위: 2주 보드 — 날짜마다 '패킹 중 N건 · 금액'(바쁠수록 진하게) · 그날 패킹 완료 · ★ 관리부 출고 · 토요일 ○ 팔렛트
//   아래: 업체별 일정 (4주) — 업체 이름 고정 · 한 줄에 하나
//   누르면 주문일자 / 주문접수일 / 패킹완료일 (접수일 · 패킹완료일 고침 → 주문 리스트에도)
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
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const dowOf = (d: string) => new Date(`${d}T00:00:00`).getDay();
const md = (d: string) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
/** 금액 짧게: 1.2억 · 3,400만 */
const won = (n: number) => (n >= 100_000_000 ? `${(n / 100_000_000).toFixed(n >= 1_000_000_000 ? 0 : 1)}억` : n >= 10_000 ? `${Math.round(n / 10_000).toLocaleString()}만` : n ? n.toLocaleString() : '');

export default function OrdersPacking({ tabs, title = '주문 관리' }: { tabs: ReactNode; title?: string }) {
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
  // 보는 주: 이번 주 일요일부터 (‹ › 로 한 주씩)
  const thisSun = (() => {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    return iso(d);
  })();
  const [from, setFrom] = useState(thisSun);
  const [pick, setPick] = useState<string | null>(null);

  // 줄: 시작(접수일 · 없으면 주문일자) ~ 끝(패킹완료일 · 없으면 주문일자 + 14일)
  //   묶음 주문은 같은 주문일(접수일)끼리 한 줄 (가장 늦은 패킹완료일까지) · 주문일이 다르면 따로 · 묶음 아닌 주문은 주문마다
  const bars = useMemo(() => {
    const groups = new Map<string, T[]>();
    for (const o of orders) {
      if (teamF && o.team !== teamF) continue;
      // 업체 + 실주문 일자(주문접수일 · 없으면 주문일자)별로 한 줄 (묶음은 안 봄)
      const k = `${o.team}|${o.companyId ?? ''}|${(o.acceptDate || o.orderDate || '').slice(0, 10)}`;
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
      const krw = os.reduce((a, x) => a + (x.amountKRW ?? 0), 0);
      return { o, os, key, krw, name: os.length > 1 ? `${dot(start)} 주문 ${os.length}건` : o.name, start, end, guess: rs.every((r) => r.guess), color: c?.color ?? '#8c2f3c', coName: (c?.name ?? '').replace(/\s*\(.*\)\s*$/, '') };
    });
  }, [orders, teamF, companies]);
  // ○ 팔렛트 작업: 매주 토요일 — 패킹이 끝나는 주의 토요일에 (업체마다 원 하나)
  const palletByDay = useMemo(() => {
    const m = new Map<string, Map<string, typeof bars>>();
    for (const b of bars) {
      const dow = new Date(`${b.end}T00:00:00`).getDay();
      const sat = addDays(b.end, 6 - dow);
      const byCo = m.get(sat) ?? new Map<string, typeof bars>();
      const ck = `${b.o.team}|${b.o.companyId ?? ''}`;
      byCo.set(ck, [...(byCo.get(ck) ?? []), b]);
      m.set(sat, byCo);
    }
    return m;
  }, [bars]);
  const [palPick, setPalPick] = useState<string | null>(null);

  const today = iso(new Date());
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(from, i));
  const days28 = Array.from({ length: 28 }, (_, i) => addDays(from, i));
  // 날짜마다 패킹 중인 덩어리 (바쁜 정도)
  const loadOf = (d: string) => bars.filter((b) => b.start <= d && b.end >= d);
  const maxLoad = Math.max(1, ...days14.map((d) => loadOf(d).length));
  // ★ 관리부 출고일
  //   묶음이면 묶음 하나 = 별 하나 (안의 주문은 같이)
  type Ship = { key: string; o: T; os: T[]; name: string };
  const shipByDay = useMemo(() => {
    const byKey = new Map<string, Ship & { day: string }>();
    for (const o of orders) {
      if (teamF && o.team !== teamF) continue;
      const s = shipOf(o).slice(0, 10);
      if (!s) continue;
      const k = `${s}|${o.team}|${o.bundle ? `b:${o.bundle.id}` : o.id}`;
      const cur = byKey.get(k);
      if (cur) cur.os.push(o);
      else byKey.set(k, { key: k, day: s, o, os: [o], name: o.bundle ? o.bundle.name || '묶음' : o.name });
    }
    const m = new Map<string, Ship[]>();
    for (const x of byKey.values()) m.set(x.day, [...(m.get(x.day) ?? []), x]);
    return m;
  }, [orders, teamF]);
  const [shipPick, setShipPick] = useState<string | null>(null); // 누른 날짜의 ★ 목록

  // 고치기: 관리자는 모두 · 조원은 자기 조 주문만 / 팀장님 · 이사님 · 무역사무 · IT 검토용은 보기만
  const canEdit = (o: T) => !access.auditor && (access.role === 'admin' || access.role === null || (access.role === 'member' && o.team === access.team));
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
          <h1>{title}</h1>
          <p className="muted">1~3조 ERP 등록 주문 (업체 + 실주문 일자별). 위 2주 보드는 날마다 패킹 중인 양 · 그날 패킹 완료 · ★ 관리부 출고 · ○ 토요일 팔렛트 작업, 아래는 업체별 일정이에요. 패킹완료일이 없으면 주문일자 + 14일로 연하게.</p>
        </div>
      </div>
      {tabs}
      <div className="card toolbar pk-toolbar">
        <span className="seg">
          <button onClick={() => setFrom(addDays(from, -7))} aria-label="앞 주">
            ‹
          </button>
          <button className={from === thisSun ? 'on' : ''} onClick={() => setFrom(thisSun)} title="이번 주로">
            {md(from)} ~ {md(addDays(from, 13))}
          </button>
          <button onClick={() => setFrom(addDays(from, 7))} aria-label="다음 주">
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
        <span className="pk-legend small">
          <span>
            <i className="pk-lg-real" /> 패킹완료일 적힘
          </span>
          <span>
            <i className="pk-lg-guess" /> 패킹완료일 없음 (주문일자 + 14일 · 연하게)
          </span>
        </span>
      </div>
      {loading ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <>
          {/* 위: 2주 보드 */}
          <div className="pb-board">
            {[0, 1].map((w) => (
              <div key={w} className="pb-week">
                <div className="pb-week-h">{w === 0 && from === thisSun ? '이번 주' : w === 1 && from === thisSun ? '다음 주' : `${md(days14[w * 7])} 주`}</div>
                <div className="pb-days">
                  {days14.slice(w * 7, w * 7 + 7).map((d) => {
                    const load = loadOf(d);
                    const krw = load.reduce((a, b) => a + b.krw, 0);
                    const ends = bars.filter((b) => b.end === d);
                    const ships = shipByDay.get(d) ?? [];
                    const pals = dowOf(d) === 6 ? [...(palletByDay.get(d)?.values() ?? [])] : [];
                    const dow = dowOf(d);
                    return (
                      <div key={d} className={`pb-day ${d === today ? 'today' : ''} ${d < today ? 'past' : ''} ${dow === 0 ? 'sun' : dow === 6 ? 'sat' : ''}`} style={{ '--load': load.length / maxLoad } as CSSProperties}>
                        <div className="pb-head">
                          <b>{md(d)}</b> <span>{WEEK[dow]}</span>
                        </div>
                        <div className="pb-load" title={load.map((b) => `${b.o.team}조 ${b.coName} · ${dot(b.start)} 주문 ${b.os.length}건${b.guess ? ' (예상)' : ''}`).join('\n')}>
                          {load.length ? (
                            <>
                              <b>{load.length}</b>건 패킹 중{krw ? <span> · ₩{won(krw)}</span> : null}
                            </>
                          ) : (
                            <span className="muted">없음</span>
                          )}
                        </div>
                        {ends.length > 0 && (
                          <div className="pb-sec">
                            <span className="pb-sec-h">패킹 완료</span>
                            {ends.map((b) => (
                              <button key={b.key} className={`pb-chip ${b.guess ? 'guess' : ''}`} style={{ '--c': b.color } as CSSProperties} onClick={() => setPick(b.key)} title={`${b.o.team}조 · ${b.coName} · ${dot(b.start)} 주문 ${b.os.length}건${b.krw ? ` · ₩${b.krw.toLocaleString()}` : ''}${b.guess ? '\n패킹완료일 없음 (예상)' : ''}`}>
                                {b.coName} {b.os.length}건
                              </button>
                            ))}
                          </div>
                        )}
                        {ships.length > 0 && (
                          <div className="pb-sec">
                            <span className="pb-sec-h">★ 관리부 출고</span>
                            {ships.map((x) => (
                              <button key={x.key} className="pb-chip ship" style={{ '--c': companies.get(x.o.companyId ?? '')?.color ?? '#8c2f3c' } as CSSProperties} onClick={() => setShipPick(d)} title={x.os.map((o) => o.name).join(' · ')}>
                                ★ {(companies.get(x.o.companyId ?? '')?.name ?? '').replace(/\s*\(.*\)\s*$/, '')} · {x.name}
                              </button>
                            ))}
                          </div>
                        )}
                        {pals.length > 0 && (
                          <div className="pb-sec">
                            <span className="pb-sec-h">○ 팔렛트</span>
                            {pals.map((g) => (
                              <button key={g[0].key} className="pb-chip pal" style={{ '--c': g[0].color } as CSSProperties} onClick={() => setPalPick(d)}>
                                ○ {g[0].coName} {g.reduce((a, b) => a + b.os.length, 0)}건
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* 아래: 업체별 일정 (4주) */}
          {(() => {
            const last = days28[27];
            const rows = bars.filter((b) => b.start <= last && b.end >= from).sort((a, b) => a.coName.localeCompare(b.coName, 'ko') || a.start.localeCompare(b.start));
            return (
              <div className="card pg">
                <div className="pg-title">
                  <b>업체별 일정</b> <span className="muted small">4주 · 업체 + 실주문 일자마다 한 줄 · 누르면 날짜 고치기</span>
                </div>
                <div className="pg-scroll">
                  <div className="pg-grid" style={{ '--n': 28 } as CSSProperties}>
                    <div className="pg-label pg-hcell" />
                    {days28.map((d) => {
                      const dow = dowOf(d);
                      return (
                        <div key={d} className={`pg-hcell ${dow === 0 ? 'sun wk' : dow === 6 ? 'sat' : ''} ${d === today ? 'today' : ''}`}>
                          {Number(d.slice(8)) === 1 || d === from ? <small>{Number(d.slice(5, 7))}월</small> : null}
                          {Number(d.slice(8))}
                        </div>
                      );
                    })}
                    {rows.map((b, ri) => {
                      const gr = ri + 2; // 1줄 = 날짜 머리
                      const s0 = b.start < from ? from : b.start;
                      const e0 = b.end > last ? last : b.end;
                      const c0 = days28.indexOf(s0);
                      const c1 = days28.indexOf(e0);
                      return (
                        <div key={b.key} className="pg-row" onClick={() => setPick(b.key)}>
                          <div className="pg-label" style={{ gridRow: gr }} title={`${b.o.team}조 · ${b.coName}`}>
                            <span className="dot" style={{ background: b.color }} />
                            <b>{b.coName}</b>
                            <span className="muted small">
                              {b.o.team}조 · {md(b.start)} 주문 {b.os.length}건{b.krw ? ` · ₩${won(b.krw)}` : ''}
                            </span>
                          </div>
                          {days28.map((d, ci) => (
                            <div key={d} className={`pg-cell ${dowOf(d) === 0 ? 'wk' : ''} ${d === today ? 'today' : ''}`} style={{ gridRow: gr, gridColumn: ci + 2 }} />
                          ))}
                          <div
                            className={`pg-bar ${b.guess ? 'guess' : ''} ${b.start < from ? 'cut-l' : ''} ${b.end > last ? 'cut-r' : ''}`}
                            style={{ '--c': b.color, gridColumn: `${c0 + 2} / ${c1 + 3}`, gridRow: gr } as CSSProperties}
                            title={`${dot(b.start)} → 패킹 ${dot(b.end)}${b.guess ? ' (패킹완료일 없음 · 예상)' : ''}`}
                          >
                            <span>{md(b.end)}</span>
                          </div>
                        </div>
                      );
                    })}
                    {!rows.length && <p className="muted small pg-empty">이 4주에 걸친 주문이 없어요.</p>}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
      {palPick && (
        <Modal title={`○ 팔렛트 작업 · ${dot(palPick)} (토)`} onClose={() => setPalPick(null)}>
          <p className="muted small" style={{ marginTop: 0 }}>
            이번 주에 패킹이 끝나는 업체예요 (팔렛트 작업은 매주 토요일).
          </p>
          <ul className="pk-ships">
            {[...(palletByDay.get(palPick)?.values() ?? [])].map((g) => (
              <li key={g[0].key}>
                <span className="pk-pal-dot" style={{ borderColor: g[0].color }} />
                <div>
                  <b>
                    {g[0].o.team}조 · {g[0].coName}
                  </b>
                  {g.map((b) => (
                    <div key={b.key} className="small">
                      <button className="link small" onClick={() => (setPalPick(null), setPick(b.key))}>
                        {dot(b.start)} 주문 {b.os.length}건 → 패킹 {dot(b.end)}
                        {b.guess ? ' (예상)' : ''}
                      </button>
                    </div>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Modal>
      )}
      {shipPick && (
        <Modal title={`★ 관리부 출고 · ${dot(shipPick)}`} onClose={() => setShipPick(null)}>
          <ul className="pk-ships">
            {(shipByDay.get(shipPick) ?? []).map((x) => {
              const c = companies.get(x.o.companyId ?? '');
              return (
                <li key={x.key}>
                  <span className="pk-ship-star" style={{ color: c?.color ?? '#c0392b' }}>
                    ★
                  </span>
                  <div>
                    <b>
                      {x.o.team}조 · {(c?.name ?? '').replace(/\s*\(.*\)\s*$/, '')} · {x.o.bundle ? `📦 ${x.name}` : x.name}
                    </b>
                    <div className="muted small">
                      {x.os.map((o) => `${o.name}${o.storeCode ? ` (${o.storeCode})` : ''}`).join(' · ')}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
      {sel && (
        <Modal title={`📦 ${sel.o.team}조 · ${sel.coName} · ${dot(sel.start)}`} onClose={() => setPick(null)} wide={sel.os.length > 1}>
          <p className="muted small" style={{ marginTop: 0 }}>
            <span className="dot" style={{ background: sel.color }} /> {companies.get(sel.o.companyId ?? '')?.name ?? ''}
            {sel.os.length > 1 ? ` · 주문 ${sel.os.length}건` : sel.o.storeCode ? ` · 매장 ${sel.o.storeCode}` : ''} · 달력 {dot(sel.start)} → {dot(sel.end)}
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
              <span>이 주문들 한 번에:</span>
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
