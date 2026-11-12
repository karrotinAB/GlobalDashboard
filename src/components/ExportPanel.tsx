// 홈 맨 아래 '수출매출' 모드: 업체별로 우리가 판 금액
//  ① 이번달 출고 (ERP 출고승인 줄의 출고일이 그 달인 금액)
//  ② 패킹 중 (주문은 들어갔고 아직 출고승인 안 난 금액 — 지금 기준)
//  ③ 로열티 (로열티 매장만: 그 달 판매 합계 × 5%)
//  ④ 총 수출 = ① + ② + ③
import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useStore } from '../data/store';
import { physName, DEFAULT_TEAM } from '../lib/team';
import { fullAmt, rateOn, shortAmt, useFxRates, useSales, useStoreBranches } from '../lib/sales';
import type { Company, Order } from '../types';

export const ROYALTY_RATE = 0.05;
const pad = (n: number) => String(n).padStart(2, '0');
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const shiftMonth = (m: string, n: number) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const normDate = (s?: string | null) => (s ?? '').replace(/\./g, '-').slice(0, 10);
const won = (n: number) => `₩${fullAmt(n)}`;
// ERP 통화 코드(CURR_CODE)는 '02' 같은 숫자라 영문 3글자 통화일 때만 붙이고, 나머지는 주문 관리처럼 $
const fx = (n: number, code?: string) => `${code && /^[A-Z]{3}$/.test(code) && code !== 'USD' ? `${code} ` : '$'}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

/** 이 달에 출고승인 난 금액 (줄별 출고일 기준) */
export function shippedIn(o: Order, month: string) {
  const rows = (o.outRows ?? []).filter((r) => r.status === '출고승인' && normDate(r.date).startsWith(month));
  if (rows.length) return { k: rows.reduce((a, r) => a + (r.k ?? 0), 0), f: rows.reduce((a, r) => a + (r.f ?? 0), 0), date: rows.map((r) => normDate(r.date)).sort().pop() };
  if (!o.outRows?.length && o.outStatus === 'approved' && normDate(o.outDate).startsWith(month)) return { k: o.amountKRW ?? 0, f: o.amountForeign ?? 0, date: normDate(o.outDate) };
  return null;
}
/** 아직 출고승인 안 난 금액 (주문 들어간 것) */
export function packingOf(o: Order) {
  if (o.outStatus === 'approved' || o.closed) return null;
  if (o.outStatus === 'partial') {
    const ok = (o.outRows ?? []).filter((r) => r.status === '출고승인');
    const k = Math.max(0, (o.planKRW ?? 0) - ok.reduce((a, r) => a + (r.k ?? 0), 0));
    const f = Math.max(0, (o.planForeign ?? 0) - ok.reduce((a, r) => a + (r.f ?? 0), 0));
    return k || f ? { k, f, partial: true } : null;
  }
  if (o.shipped) return null; // 사람이 출고 체크 (ERP 승인 전이라도 끝난 걸로)
  return { k: o.amountKRW ?? 0, f: o.amountForeign ?? 0, partial: false };
}

/** 팀장님·이사님 화면: 조 업체 주문은 그 조 저장소에서 (읽기만) */
function useTeamOrders(teams: string[]) {
  const sig = [...new Set(teams)].sort().join(',');
  const [map, setMap] = useState<Record<string, Order[]>>({});
  useEffect(() => {
    const list = sig ? sig.split(',') : [];
    if (!list.length) return setMap({});
    if (DATA_MODE === 'local') {
      const out: Record<string, Order[]> = {};
      for (const t of list) {
        try {
          const key = t === DEFAULT_TEAM ? 'global-dashboard:v3' : `global-dashboard:v3:t${t}`;
          out[t] = JSON.parse(localStorage.getItem(key) ?? '{}').orders ?? [];
        } catch {
          out[t] = [];
        }
      }
      return setMap(out);
    }
    const unsubs = list.map((t) =>
      onSnapshot(
        collection(db, physName('orders', t)),
        (snap) => setMap((prev) => ({ ...prev, [t]: snap.docs.map((d) => ({ ...(d.data() as Order), id: d.id })) })),
        () => setMap((prev) => ({ ...prev, [t]: [] })),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig]);
  return map;
}

type Pick = 'ship' | 'pack' | 'royalty' | null;

export default function ExportPanel({ companies }: { companies: Company[] }) {
  const { data } = useStore();
  const [month, setMonth] = useState(thisMonth);
  const [coId, setCoId] = useState('');
  const [open, setOpen] = useState<Pick>(null);
  const teamOrders = useTeamOrders(companies.filter((c) => c.team).map((c) => c.team!));
  const ordersOf = (c: Company) => (c.team ? (teamOrders[c.team] ?? []) : data.orders).filter((o) => o.companyId === c.id);

  // 로열티: 그 달 판매 합계 × 5%
  const royaltyCos = companies.filter((c) => c.royalty && c.storeCodes?.length);
  const { months: sales } = useSales(royaltyCos.flatMap((c) => c.storeCodes ?? []));
  const branchNames = useStoreBranches(royaltyCos.flatMap((c) => c.storeCodes ?? []));
  // 판매일 ECOS 환율 (주말·공휴일은 그 전 영업일). 앞 달도 같이 (월초 주말용)
  const fxTable = useFxRates([...royaltyCos.map((c) => c.salesCurrency ?? ''), 'USD'], [shiftMonth(month, -1), month]);
  const salesOf = (c: Company) => {
    const docs = sales.filter((m) => m.month === month && (c.storeCodes ?? []).includes(m.code));
    const branches = docs.flatMap((d) => Object.entries(d.branches).map(([sid, b]) => ({ sid, name: branchNames[sid] || b.name || '', total: Object.values(b.days).reduce((a, n) => a + n, 0), days: Object.keys(b.days).length })));
    // 날짜별 합계 → 로열티(현지) × 그날 환율
    const byDay = new Map<string, number>();
    for (const d of docs) for (const b of Object.values(d.branches)) for (const [dd, v] of Object.entries(b.days)) byDay.set(`${month}-${dd}`, (byDay.get(`${month}-${dd}`) ?? 0) + v);
    const cur = c.salesCurrency;
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amt]) => {
        const roy = amt * ROYALTY_RATE;
        const kr = cur ? rateOn(fxTable, cur, date) : null;
        const ur = rateOn(fxTable, 'USD', date);
        const krw = kr ? roy * kr.rate : null;
        const usd = cur === 'USD' ? roy : krw !== null && ur ? krw / ur.rate : null;
        return { date, amt, roy, kr, ur, krw, usd };
      });
    return {
      cur,
      days,
      branches: branches.sort((a, b) => b.total - a.total),
      total: branches.reduce((a, b) => a + b.total, 0),
      royLocal: days.reduce((a, d) => a + d.roy, 0),
      royK: days.reduce((a, d) => a + (d.krw ?? 0), 0),
      royF: days.reduce((a, d) => a + (d.usd ?? 0), 0),
      missing: days.filter((d) => d.krw === null).length,
    };
  };

  const rows = useMemo(
    () =>
      companies
        .map((c) => {
          const orders = ordersOf(c);
          const ship = orders.map((o) => ({ o, v: shippedIn(o, month) })).filter((x): x is { o: Order; v: NonNullable<ReturnType<typeof shippedIn>> } => !!x.v);
          const pack = orders.map((o) => ({ o, v: packingOf(o) })).filter((x): x is { o: Order; v: NonNullable<ReturnType<typeof packingOf>> } => !!x.v);
          const sale = c.royalty ? salesOf(c) : null;
          const r = {
            c,
            ship,
            pack,
            sale,
            shipK: ship.reduce((a, x) => a + x.v.k, 0),
            shipF: ship.reduce((a, x) => a + x.v.f, 0),
            packK: pack.reduce((a, x) => a + x.v.k, 0),
            packF: pack.reduce((a, x) => a + x.v.f, 0),
            royalty: sale ? sale.royK : 0, // 원화 (판매일 환율)
            royaltyF: sale ? sale.royF : 0, // 달러
          };
          return { ...r, total: r.shipK + r.packK + r.royalty, totalF: r.shipF + r.packF + r.royaltyF };
        })
        .filter((r) => r.ship.length || r.pack.length || r.c.royalty),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, data.orders, teamOrders, sales, branchNames, month, fxTable],
  );
  const scope = coId ? rows.filter((r) => r.c.id === coId) : rows;
  const sum = (k: 'shipK' | 'shipF' | 'packK' | 'packF' | 'royalty' | 'royaltyF' | 'total' | 'totalF') => scope.reduce((a, r) => a + r[k], 0);
  const fxCode = scope.flatMap((r) => [...r.ship, ...r.pack]).find((x) => x.o.fxCode)?.o.fxCode;
  const now = thisMonth();
  const [y, m] = month.split('-').map(Number);
  // 순서: ④ 총 수출 → ① 출고 → ② 패킹 중 → ③ 로열티
  const cards: { key: Exclude<Pick, null> | 'total'; n: string; label: string; k: number; f?: number; sub: string }[] = [
    { key: 'total', n: '', label: '총 수출 금액', k: sum('total'), f: sum('totalF'), sub: '① + ② + ③ (로열티는 환율 적용)' },
    { key: 'ship', n: '①', label: `${m}월 출고 금액`, k: sum('shipK'), f: sum('shipF'), sub: '출고승인 난 금액 (출고일 기준)' },
    { key: 'pack', n: '②', label: '패킹 중 금액', k: sum('packK'), f: sum('packF'), sub: '주문 들어갔고 아직 출고승인 전 · 지금 기준' },
    { key: 'royalty', n: '③', label: '로열티', k: sum('royalty'), f: sum('royaltyF'), sub: `${m}월 판매 × ${ROYALTY_RATE * 100}% · 판매일 ECOS 환율` },
  ];

  return (
    <div className="export">
      <div className="export-bar">
        <div className="month-nav">
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="이전 달">
            ◀
          </button>
          <b>
            {y}년 {m}월
          </b>
          <button onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= now} aria-label="다음 달">
            ▶
          </button>
          {month !== now && (
            <button className="link" onClick={() => setMonth(now)}>
              이번 달
            </button>
          )}
        </div>
        <div className="company-chips">
          <button className={`cchip ${!coId ? 'on' : ''}`} onClick={() => setCoId('')}>
            전체
          </button>
          {rows.map((r) => (
            <button key={r.c.id} className={`cchip ${coId === r.c.id ? 'on' : ''}`} onClick={() => setCoId(coId === r.c.id ? '' : r.c.id)}>
              <span className="dot" style={{ background: r.c.color }} />
              {r.c.name}
              {r.c.royalty && <span className="tag small royalty-tag">로열티</span>}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">이 달 출고·패킹 중 주문이나 로열티 매장이 없어요.</p>
      ) : (
        <>
          <div className="export-cards">
            {cards.map((c) => (
              <button
                key={c.key}
                className={`export-card ${c.key} ${open === c.key ? 'on' : ''}`}
                disabled={c.key === 'total'}
                onClick={() => c.key !== 'total' && setOpen(open === c.key ? null : c.key)}
              >
                <span className="ec-label">{c.n ? `${c.n} ${c.label}` : c.label}</span>
                <span className="ec-amts">
                  <span className="ec-cell">
                    <small>원화</small>
                    <b className="ec-amt">{won(c.k)}</b>
                  </span>
                  <span className="ec-cell">
                    <small>외화</small>
                    <b className="ec-amt fx">{c.f ? fx(c.f, fxCode) : '—'}</b>
                  </span>
                </span>
                {/* 설명은 '자세히'를 누르면 (총 금액만 맨 아래 작게) */}
                {c.key === 'total' ? <span className="ec-sub ec-foot">{c.sub}</span> : <span className="ec-more">{open === c.key ? '접기 ▴' : '자세히 ▾'}</span>}
              </button>
            ))}
          </div>

          {open === 'ship' && (
            <OrderList
              note="출고승인 난 금액 (출고일 기준)"
              title={`① ${m}월 출고 금액 — 출고승인 난 주문`}
              empty="이 달 출고승인 난 주문이 없어요."
              items={scope.flatMap((r) => r.ship.map((x) => ({ c: r.c, o: x.o, k: x.v.k, f: x.v.f, extra: x.v.date?.slice(5).replace('-', '/') ?? '' })))}
              extraHead="출고일"
              showCo={!coId}
            />
          )}
          {open === 'pack' && (
            <OrderList
              note="주문 들어갔고 아직 출고승인 전인 주문 전부 · 달과 상관없이 지금 기준"
              title="② 패킹 중 금액 — 아직 출고승인 전인 주문"
              empty="패킹 중인 주문이 없어요."
              items={scope.flatMap((r) => r.pack.map((x) => ({ c: r.c, o: x.o, k: x.v.k, f: x.v.f, extra: x.v.partial ? '일부 출고 (남은 금액)' : x.v.k || x.v.f ? 'ERP 예정 금액' : '금액 없음' })))}
              extraHead="상태"
              showCo={!coId}
            />
          )}
          {open === 'royalty' && (
            <div className="export-detail">
              <h3>③ 로열티 — {m}월 판매 합계 × {ROYALTY_RATE * 100}%</h3>
              <p className="muted small detail-note">{m}월 판매 × {ROYALTY_RATE * 100}% · 판매일마다 ECOS 매매기준율로 원화·달러 환산 (주말·공휴일은 그 전 영업일 환율)</p>
              {scope.filter((r) => r.sale).length === 0 && <p className="muted small">로열티 매장이 없어요. 설정 &gt; 매장 평수에서 업체 이름 옆 <b>로열티</b>를 켜 주세요.</p>}
              {scope
                .filter((r) => r.sale)
                .map((r) => (
                  <div key={r.c.id} className="royalty-box">
                    <div className="royalty-head">
                      <span className="dot" style={{ background: r.c.color }} />
                      <b>{r.c.name}</b>
                      <span className="muted small">매장코드 {(r.c.storeCodes ?? []).join(', ')}</span>
                    </div>
                    {r.sale!.branches.length === 0 ? (
                      <p className="muted small">이 달 판매 데이터가 아직 없어요.</p>
                    ) : (
                      <table className="mini-table">
                        <thead>
                          <tr>
                            <th>지점</th>
                            <th className="r">판매 일수</th>
                            <th className="r">판매 합계</th>
                          </tr>
                        </thead>
                        <tbody>
                          {r.sale!.branches.map((b) => (
                            <tr key={b.sid}>
                              <td>
                                {b.name || '지점'} <span className="muted small">{b.sid}</span>
                              </td>
                              <td className="r">{b.days}일</td>
                              <td className="r">{fullAmt(b.total)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <RoyaltyCalc sale={r.sale!} live={month === now} />
                  </div>
                ))}
            </div>
          )}

          <div className="sales-table-wrap">
            <table className="sales-table export-table">
              <thead>
                <tr>
                  <th className="l">업체</th>
                  <th>총 수출</th>
                  <th>① 출고</th>
                  <th>② 패킹 중</th>
                  <th>③ 로열티</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.c.id} className={coId === r.c.id ? 'row-on' : ''} onClick={() => setCoId(coId === r.c.id ? '' : r.c.id)}>
                    <th className="l">
                      <span className="dot" style={{ background: r.c.color }} /> {r.c.name}
                    </th>
                    <td className="r" title={`${won(r.total)}${r.totalF ? ` · ${fx(r.totalF)}` : ''}`}>
                      <b>{shortAmt(r.total)}</b>
                    </td>
                    <td className="r" title={won(r.shipK)}>{r.shipK ? shortAmt(r.shipK) : '—'}</td>
                    <td className="r" title={won(r.packK)}>{r.packK ? shortAmt(r.packK) : '—'}</td>
                    <td className="r" title={won(r.royalty)}>{r.c.royalty ? shortAmt(r.royalty) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot>
                  <tr>
                    <th className="l">합계</th>
                    <td className="r">{shortAmt(rows.reduce((a, r) => a + r.total, 0))}</td>
                    <td className="r">{shortAmt(rows.reduce((a, r) => a + r.shipK, 0))}</td>
                    <td className="r">{shortAmt(rows.reduce((a, r) => a + r.packK, 0))}</td>
                    <td className="r">{shortAmt(rows.reduce((a, r) => a + r.royalty, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="muted small">
            표는 원화 기준 (주문은 ERP 원화·외화 금액, 로열티는 판매일마다 ECOS 매매기준율로 환산 · 주말·공휴일은 그 전 영업일 환율). ② 패킹 중은 달과 상관없이 아직 출고승인 전인 주문 전부예요.
          </p>
        </>
      )}
    </div>
  );
}

function OrderList({
  title,
  empty,
  note,
  items,
  extraHead,
  showCo,
}: {
  title: string;
  note?: string;
  empty: string;
  items: { c: Company; o: Order; k: number; f: number; extra: string }[];
  extraHead: string;
  showCo: boolean;
}) {
  const sorted = [...items].sort((a, b) => b.k - a.k);
  return (
    <div className="export-detail">
      <h3>
        {title} <span className="muted small">{items.length}건</span>
      </h3>
      {note && <p className="muted small detail-note">{note}</p>}
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="mini-table export-orders">
            <thead>
              <tr>
                {showCo && <th>업체</th>}
                <th>주문</th>
                <th>주문일</th>
                <th>매장코드</th>
                <th>{extraHead}</th>
                <th className="r">원화</th>
                <th className="r">외화</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(({ c, o, k, f, extra }) => (
                <tr key={o.id}>
                  {showCo && <td>{c.name}</td>}
                  <td>
                    {c.team ? (
                      o.name
                    ) : (
                      <a href={`#/orders?c=${c.id}&o=${o.id}`} title="주문 관리에서 보기">
                        {o.name}
                      </a>
                    )}
                    {o.bundle && <span className="muted small"> · {o.bundle.name || '묶음'}</span>}
                  </td>
                  <td>{o.orderDate?.slice(5).replace('-', '/') ?? ''}</td>
                  <td>{o.storeCode ?? ''}</td>
                  <td>{extra}</td>
                  <td className="r">{k ? fullAmt(k) : '—'}</td>
                  <td className="r">{f ? fx(f, o.fxCode) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type Sale = {
  cur?: string;
  total: number;
  royLocal: number;
  royK: number;
  royF: number;
  missing: number;
  days: { date: string; amt: number; roy: number; kr: { rate: number; date: string } | null; ur: { rate: number; date: string } | null; krw: number | null; usd: number | null }[];
};
const rateTxt = (r: number) => (r >= 100 ? r.toLocaleString(undefined, { maximumFractionDigits: 2 }) : r.toLocaleString(undefined, { maximumFractionDigits: 4 }));

/** 로열티 계산법: 판매 합계 × 5% → 판매일 환율로 원화·달러 */
function RoyaltyCalc({ sale, live }: { sale: Sale; live: boolean }) {
  const cur = sale.cur;
  return (
    <div className="royalty-calc">
      <div>
        판매 합계 <b>{fullAmt(sale.total)}</b> {cur ?? ''} × {ROYALTY_RATE * 100}% = 로열티 <b>{fullAmt(sale.royLocal)}</b> {cur ?? ''}
      </div>
      {!cur ? (
        <div className="warn small">판매 통화를 아직 안 골랐어요 — 설정 &gt; 매장 평수에서 이 업체의 <b>판매 통화</b>를 골라 주세요. (그 전까지 원화·달러 환산은 0)</div>
      ) : (
        <div>
          → 판매일마다 환율 적용: 원화 <b>{won(sale.royK)}</b> · 달러 <b>{fx(sale.royF)}</b>
          {sale.missing > 0 && <span className="warn small"> · 환율이 없는 날 {sale.missing}일은 빠졌어요 (ECOS 인증키·환율 가져오기 확인)</span>}
        </div>
      )}
      {live && <div className="muted small">이번 달은 어제까지 판매 기준 — 월말에 확정</div>}
      {sale.days.length > 0 && (
        <details>
          <summary className="small">일별 계산 보기 ({sale.days.length}일)</summary>
          <div className="sales-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>판매일</th>
                  <th className="r">판매 ({cur ?? '?'})</th>
                  <th className="r">로열티 {ROYALTY_RATE * 100}%</th>
                  <th className="r">환율 (원/{cur ?? '?'})</th>
                  <th className="r">원화</th>
                  <th className="r">환율 (원/USD)</th>
                  <th className="r">달러</th>
                </tr>
              </thead>
              <tbody>
                {sale.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date.slice(5).replace('-', '/')}</td>
                    <td className="r">{fullAmt(d.amt)}</td>
                    <td className="r">{d.roy.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                    <td className="r" title={d.kr && d.kr.date !== d.date ? `${d.kr.date} 환율 (그 전 영업일)` : undefined}>
                      {d.kr ? rateTxt(d.kr.rate) : <span className="warn">없음</span>}
                      {d.kr && d.kr.date !== d.date && <span className="muted small"> ({d.kr.date.slice(5).replace('-', '/')})</span>}
                    </td>
                    <td className="r">{d.krw !== null ? fullAmt(d.krw) : '—'}</td>
                    <td className="r">{d.ur ? rateTxt(d.ur.rate) : '—'}</td>
                    <td className="r">{d.usd !== null ? d.usd.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>합계</th>
                  <td className="r">{fullAmt(sale.total)}</td>
                  <td className="r">{sale.royLocal.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                  <td />
                  <td className="r">{fullAmt(sale.royK)}</td>
                  <td />
                  <td className="r">{sale.royF.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
