// 홈 맨 아래 '수출매출' 모드: 업체별로 우리가 판 금액
//  ① 이번달 출고 (ERP 출고승인 줄의 출고일이 그 달인 금액)
//  ② 패킹 중 (주문은 들어갔고 아직 출고승인 안 난 금액 — 지금 기준)
//  ③ 로열티 (로열티 매장만: 그 달 판매 합계 × 5%)
//  ④ 총 수출 = ① + ② + ③
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useStore } from '../data/store';
import { physName, DEFAULT_TEAM } from '../lib/team';
import { fullAmt, rateOn, shortAmt, useFxRates, useSales, useStoreBranches, type FxTable } from '../lib/sales';
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

export default function ExportPanel({ companies, view = 'table' }: { companies: Company[]; view?: 'table' | 'pie' }) {
  const { data } = useStore();
  const [month, setMonth] = useState(thisMonth);
  const [coId, setCoId] = useState('');
  const [teamF, setTeamF] = useState(''); // '' 전체 · 'own' 내 업체 · '1'·'2'·'3'
  const [open, setOpen] = useState<Pick>(null);
  const teamOrders = useTeamOrders(companies.filter((c) => c.team).map((c) => c.team!));
  // 지난 데이터 (ERP 에서 한 번 채운 것): exportMonthly/{매장코드}_{달}
  const erpMonth = useExportMonthly(companies.flatMap((c) => c.storeCodes ?? []), month);
  const ordersOf = (c: Company) => (c.team ? (teamOrders[c.team] ?? []) : data.orders).filter((o) => o.companyId === c.id);

  // 로열티: 그 달 판매 합계 × 5%
  const royaltyCos = companies.filter((c) => c.royalty && c.storeCodes?.length);
  const { months: sales } = useSales(royaltyCos.flatMap((c) => c.storeCodes ?? []));
  const branchNames = useStoreBranches(royaltyCos.flatMap((c) => c.storeCodes ?? []));
  // 판매일 ECOS 환율 (주말·공휴일은 그 전 영업일). 앞 달도 같이 (월초 주말용)
  const fxTable = useFxRates([...royaltyCos.map((c) => c.salesCurrency ?? ''), 'USD'], [shiftMonth(month, -1), month]);
  const salesOf = (c: Company, mo: string = month, fx: FxTable = fxTable) => {
    const docs = sales.filter((m) => m.month === mo && (c.storeCodes ?? []).includes(m.code));
    const cur0 = c.salesCurrency;
    const conv = (date: string, roy: number) => {
      const kr = cur0 ? rateOn(fx, cur0, date) : null;
      const ur = rateOn(fx, 'USD', date);
      const krw = kr ? roy * kr.rate : null;
      return { krw, usd: cur0 === 'USD' ? roy : krw !== null && ur ? krw / ur.rate : null };
    };
    const branches = docs.flatMap((d) =>
      Object.entries(d.branches).map(([sid, b]) => {
        const total = Object.values(b.days).reduce((a, n) => a + n, 0);
        let krw = 0;
        let usd = 0;
        let miss = 0;
        for (const [dd, v] of Object.entries(b.days)) {
          const x = conv(`${mo}-${dd}`, v * ROYALTY_RATE);
          if (x.krw === null) miss++;
          krw += x.krw ?? 0;
          usd += x.usd ?? 0;
        }
        return { sid, name: branchNames[sid] || b.name || '', total, days: Object.keys(b.days).length, roy: total * ROYALTY_RATE, krw, usd, miss };
      }),
    );
    // 날짜별 합계 → 로열티(현지) × 그날 환율
    const byDay = new Map<string, number>();
    for (const d of docs) for (const b of Object.values(d.branches)) for (const [dd, v] of Object.entries(b.days)) byDay.set(`${mo}-${dd}`, (byDay.get(`${mo}-${dd}`) ?? 0) + v);
    const cur = c.salesCurrency;
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amt]) => {
        const roy = amt * ROYALTY_RATE;
        const kr = cur ? rateOn(fx, cur, date) : null;
        const ur = rateOn(fx, 'USD', date);
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

  const rowsFor = (month: string, erpMonth: Record<string, ErpMonth>, fx: FxTable) =>
      companies
        .map((c) => {
          const orders = ordersOf(c);
          const ship = orders.map((o) => ({ o, v: shippedIn(o, month) })).filter((x): x is { o: Order; v: NonNullable<ReturnType<typeof shippedIn>> } => !!x.v);
          // 주문 관리에 없는 지난 출고 (ERP 직접) — 같은 EXP_NO 는 주문 관리 쪽만
          const known = new Set(orders.map((o) => String(o.expNo ?? '')).filter(Boolean));
          for (const code of c.storeCodes ?? []) {
            for (const it of erpMonth[code]?.items ?? []) {
              if (known.has(it.expNo)) continue;
              const o: Order = {
                id: `erp-${it.expNo}`,
                companyId: c.id,
                name: `ERP ${it.expNo}`,
                realOrder: true,
                erp: true,
                inbound: true,
                invoice: true,
                shipped: true,
                storeCode: it.storeId,
                orderDate: it.orderDate,
                expNo: it.expNo,
                createdAt: it.orderDate ?? '',
              };
              ship.push({ o, v: { k: it.k, f: it.f, date: it.outDate } });
            }
          }
          // 지난 달은 이미 마감 → 패킹 중은 이번 달에만
          const pack = (month < thisMonth() ? [] : orders).map((o) => ({ o, v: packingOf(o) })).filter((x): x is { o: Order; v: NonNullable<ReturnType<typeof packingOf>> } => !!x.v);
          const sale = c.royalty ? salesOf(c, month, fx) : null;
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
        .filter((r) => r.ship.length || r.pack.length || r.c.royalty);
  const allRows = useMemo(
    () => rowsFor(month, erpMonth, fxTable),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [companies, data.orders, teamOrders, sales, branchNames, month, fxTable, erpMonth],
  );

  // 비중 '올해': 1월 ~ 이번 달(또는 그 해 12월) 업체별 총 수출 합계 (패킹 중은 이번 달만)
  const [pieYear, setPieYear] = useState(false);
  const year = month.slice(0, 4);
  const yearMonths: string[] = [];
  for (let mo = `${year}-01`; mo <= `${year}-12` && mo <= thisMonth(); mo = shiftMonth(mo, 1)) yearMonths.push(mo);
  const wantYear = view === 'pie' && pieYear;
  const erpYear = useExportYear(companies.flatMap((c) => c.storeCodes ?? []), wantYear ? yearMonths : []);
  const fxYear = useFxRates(wantYear ? [...royaltyCos.map((c) => c.salesCurrency ?? ''), 'USD'] : [], wantYear ? [shiftMonth(yearMonths[0], -1), ...yearMonths] : []);
  const yearRows = useMemo(() => {
    if (!wantYear) return [];
    const by = new Map<string, { c: Company; total: number; totalF: number }>();
    for (const mo of yearMonths)
      for (const r of rowsFor(mo, erpYear[mo] ?? {}, fxYear)) {
        const x = by.get(r.c.id) ?? { c: r.c, total: 0, totalF: 0 };
        x.total += r.total;
        x.totalF += r.totalF;
        by.set(r.c.id, x);
      }
    return [...by.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantYear, companies, data.orders, teamOrders, sales, branchNames, fxYear, erpYear, year]);
  // 팀장님·이사님 화면: 조 업체가 섞여 있으면 조로 거르기 ('own' = 내 업체)
  const hasTeams = allRows.some((r) => r.c.team);
  const teamOf = (c: Company) => c.team ?? 'own';
  const teamsHere = [...new Set(allRows.map((r) => teamOf(r.c)))].sort((a, b) => (a === 'own' ? -1 : b === 'own' ? 1 : a.localeCompare(b)));
  const rows = teamF ? allRows.filter((r) => teamOf(r.c) === teamF) : allRows;
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
        {hasTeams && (
          <div className="seg team-seg">
            <button className={!teamF ? 'on' : ''} onClick={() => (setTeamF(''), setCoId(''))}>
              전체 조
            </button>
            {teamsHere.map((t) => (
              <button key={t} className={teamF === t ? 'on' : ''} onClick={() => (setTeamF(teamF === t ? '' : t), setCoId(''))}>
                {t === 'own' ? '내 업체' : `${t}조`}
              </button>
            ))}
          </div>
        )}
        <div className="company-chips">
          <button className={`cchip ${!coId ? 'on' : ''}`} onClick={() => setCoId('')}>
            전체
          </button>
          {rows.map((r) => (
            <button key={r.c.id} className={`cchip ${coId === r.c.id ? 'on' : ''}`} onClick={() => setCoId(coId === r.c.id ? '' : r.c.id)}>
              <span className="dot" style={{ background: r.c.color }} />
              {hasTeams && <span className="team-tag">{r.c.team ? `${r.c.team}조` : '내'}</span>}
              {r.c.name}
              {r.c.royalty && <span className="tag small royalty-tag">로열티</span>}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted small">이 달 출고·패킹 중 주문이나 로열티 매장이 없어요.</p>
      ) : view === 'pie' ? (
        <SharePie
          rows={pieYear ? (teamF ? yearRows.filter((r) => teamOf(r.c) === teamF) : yearRows) : rows}
          hasTeams={hasTeams}
          period={pieYear ? 'year' : 'month'}
          periodLabel={pieYear ? `${year}년 1월 ~ ${Number(yearMonths[yearMonths.length - 1]?.slice(5) ?? 12)}월` : `${y}년 ${m}월`}
          onPeriod={(p) => setPieYear(p === 'year')}
        />
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
                <Amts krw={won(c.k)} fx={c.f ? fx(c.f, fxCode) : '—'} />
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
              note={month < now ? '지난 달은 마감이라 패킹 중 금액은 넣지 않아요 (이번 달에만 보여요)' : '주문 들어갔고 아직 출고승인 전인 주문 전부 · 지금 기준'}
              title="② 패킹 중 금액 — 아직 출고승인 전인 주문"
              empty={month < now ? '지난 달은 마감 — 패킹 중 없음' : '패킹 중인 주문이 없어요.'}
              items={scope.flatMap((r) => r.pack.map((x) => ({ c: r.c, o: x.o, k: x.v.k, f: x.v.f, extra: `${x.o.packing?.trim() || '—'}${x.v.partial ? ' (일부 출고 · 남은 금액)' : ''}` })))}
              extraHead="패킹 예정일"
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
                  <RoyaltyBox key={r.c.id} c={r.c} sale={r.sale!} live={month === now} />
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
                      <span className="dot" style={{ background: r.c.color }} /> {hasTeams && <span className="team-tag">{r.c.team ? `${r.c.team}조` : '내'}</span>}
                      {r.c.name}
                    </th>
                    <KF k={r.total} f={r.totalF} bold />
                    <KF k={r.shipK} f={r.shipF} />
                    <KF k={r.packK} f={r.packF} />
                    {r.c.royalty ? <KF k={r.royalty} f={r.royaltyF} /> : <td className="r">—</td>}
                  </tr>
                ))}
              </tbody>
              {rows.length > 1 && (
                <tfoot>
                  <tr>
                    <th className="l">합계</th>
                    <KF k={rows.reduce((a, r) => a + r.total, 0)} f={rows.reduce((a, r) => a + r.totalF, 0)} bold />
                    <KF k={rows.reduce((a, r) => a + r.shipK, 0)} f={rows.reduce((a, r) => a + r.shipF, 0)} />
                    <KF k={rows.reduce((a, r) => a + r.packK, 0)} f={rows.reduce((a, r) => a + r.packF, 0)} />
                    <KF k={rows.reduce((a, r) => a + r.royalty, 0)} f={rows.reduce((a, r) => a + r.royaltyF, 0)} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          <p className="muted small">
            표는 원화 · 아래 작게 외화($) (주문은 ERP 원화·외화 금액, 로열티는 판매일마다 ECOS 매매기준율로 환산 · 주말·공휴일은 그 전 영업일 환율). ② 패킹 중은 이번 달에만 (아직 출고승인 전인 주문 전부) — 지난 달은 마감이라 빠져요.
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
                    {o.id.startsWith('erp-') ? (
                      <span title="주문 관리에 없는 지난 출고 (ERP 에서 직접 가져온 것)">
                        <span className="tag small gray">ERP</span> {o.expNo}
                      </span>
                    ) : c.team ? (
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
  branches: { sid: string; name: string; total: number; days: number; roy: number; krw: number; usd: number; miss: number }[];
  total: number;
  royLocal: number;
  royK: number;
  royF: number;
  missing: number;
  days: { date: string; amt: number; roy: number; kr: { rate: number; date: string } | null; ur: { rate: number; date: string } | null; krw: number | null; usd: number | null }[];
};
const rateTxt = (r: number) => (r >= 100 ? r.toLocaleString(undefined, { maximumFractionDigits: 2 }) : r.toLocaleString(undefined, { maximumFractionDigits: 4 }));

/** 로열티: 업체 하나 — 표 (합계 맨 위) + '일별 계산 보기' */
function RoyaltyBox({ c, sale, live }: { c: Company; sale: Sale; live: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = sale.cur;
  const sym = cur ? `${cur} ` : '';
  const pct = `${ROYALTY_RATE * 100}%`;
  return (
    <div className="royalty-box">
      <div className="royalty-head">
        <span className="dot" style={{ background: c.color }} />
        <b>{c.name}</b>
        <span className="muted small">매장코드 {(c.storeCodes ?? []).join(', ')}</span>
        {sale.days.length > 0 && (
          <button className={`roy-daily-btn ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}>
            📅 일별 계산 보기 ({sale.days.length}일) {open ? '▴' : '▾'}
          </button>
        )}
      </div>
      {sale.branches.length === 0 ? (
        <p className="muted small">이 달 판매 데이터가 아직 없어요.</p>
      ) : (
        <div className="sales-table-wrap">
          <table className="mini-table roy-table">
            <thead>
              <tr>
                <th>지점</th>
                <th className="r">판매 일수</th>
                <th className="r">판매 합계 {cur && <span className="muted">({cur})</span>}</th>
                <th className="c">× {pct}</th>
                <th className="r">로열티 {cur && <span className="muted">({cur})</span>}</th>
                <th className="r">원화</th>
                <th className="r">달러</th>
              </tr>
            </thead>
            <tbody>
              <tr className="roy-total">
                <td>합계</td>
                <td className="r">{sale.days.length}일</td>
                <td className="r">
                  {sym}
                  {fullAmt(sale.total)}
                </td>
                <td className="c muted">×{pct}</td>
                <td className="r">
                  {sym}
                  {fullAmt(sale.royLocal)}
                </td>
                <td className="r">{cur ? won(sale.royK) : '—'}</td>
                <td className="r">{cur ? fx(sale.royF) : '—'}</td>
              </tr>
              {sale.branches.map((b) => (
                <tr key={b.sid}>
                  <td>
                    {b.name || '지점'} <span className="muted small">{b.sid}</span>
                  </td>
                  <td className="r">{b.days}일</td>
                  <td className="r">{fullAmt(b.total)}</td>
                  <td className="c muted">×{pct}</td>
                  <td className="r">{fullAmt(b.roy)}</td>
                  <td className="r">{cur ? won(b.krw) : '—'}</td>
                  <td className="r">{cur ? fx(b.usd) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!cur && <div className="warn small">판매 통화를 아직 안 골랐어요 — 설정 &gt; 매장 평수에서 이 업체의 <b>판매 통화</b>를 골라 주세요. (그 전까지 원화·달러 환산은 0)</div>}
      {cur && sale.missing > 0 && <div className="warn small">환율이 없는 날 {sale.missing}일은 원화·달러에서 빠졌어요 (ECOS 인증키·환율 가져오기 확인)</div>}
      {live && <div className="muted small">이번 달은 어제까지 판매 기준 — 월말에 확정 · 원화·달러는 판매일마다 그날 환율</div>}
      {open && sale.days.length > 0 && (
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
      )}
    </div>
  );
}

type ErpMonth = { code: string; month: string; shipK: number; shipF: number; items: { expNo: string; storeId: string; orderDate?: string; outDate: string; k: number; f: number }[] };
/** 매장코드들의 그 달 ERP 지난 출고 (exportMonthly) */
function useExportMonthly(codes: string[], month: string) {
  const sig = [...new Set(codes)].sort().join(',');
  const [map, setMap] = useState<Record<string, ErpMonth>>({});
  useEffect(() => {
    setMap({});
    const list = sig ? sig.split(',') : [];
    if (!list.length || DATA_MODE === 'local') return;
    const unsubs = list.map((code) =>
      onSnapshot(
        doc(db, 'exportMonthly', `${code}_${month}`),
        (d) =>
          setMap((prev) => {
            const next = { ...prev };
            if (d.exists()) next[code] = d.data() as ErpMonth;
            else delete next[code];
            return next;
          }),
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig, month]);
  return map;
}

/** 원화 | 외화 — 한 줄에 안 들어가면 세로줄 없이 줄바꿈 */
function Amts({ krw, fx: f }: { krw: string; fx: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [wrapped, setWrapped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const [a, b] = Array.from(el.children) as HTMLElement[];
      // 세로줄·여백(약 26px) 포함해서 한 줄에 들어가는지 (줄바꿈 여부로 판단하면 왔다갔다 할 수 있어서 너비로)
      if (!a || !b) return;
      const need = a.offsetWidth + b.offsetWidth + 28;
      // 한 번 줄바꿈하면 넉넉히 들어갈 때만 다시 한 줄로 (스크롤바 생김/없어짐으로 왔다갔다 떨리는 것 방지)
      setWrapped((w) => (w ? need > el.clientWidth - 24 : need > el.clientWidth));
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [krw, f]);
  return (
    <span ref={ref} className={`ec-amts ${wrapped ? 'wrapped' : ''}`}>
      <span className="ec-cell">
        <small>원화</small>
        <b className="ec-amt">{krw}</b>
      </span>
      <span className="ec-cell">
        <small>외화</small>
        <b className="ec-amt fx">{f}</b>
      </span>
    </span>
  );
}

/** 표 칸: 원화 (짧게) + 아래 외화 */
const shortUsd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);
function KF({ k, f, bold }: { k: number; f: number; bold?: boolean }) {
  if (!k && !f) return <td className="r">—</td>;
  return (
    <td className="r kf" title={`${won(k)}${f ? ` · ${fx(f)}` : ''}`}>
      {bold ? <b>{shortAmt(k)}</b> : shortAmt(k)}
      {f ? <small className="kf-fx">{shortUsd(f)}</small> : null}
    </td>
  );
}

/** 총 수출 비중: 도넛 (업체별 / 조별) + 옆에 금액·비중 표. 업체 색은 업체 고유색 (순위로 칠하지 않음) */
const TEAM_COLORS: Record<string, string> = { own: '#8a7470', '1': '#3b7dd8', '2': '#c2185b', '3': '#3a9a5b' };
export function SharePie({
  rows,
  hasTeams,
  period,
  periodLabel,
  onPeriod,
}: {
  rows: { c: Company; total: number; totalF: number }[];
  hasTeams: boolean;
  period: 'month' | 'year';
  periodLabel: string;
  onPeriod: (p: 'month' | 'year') => void;
}) {
  const [by, setBy] = useState<'co' | 'team'>('co');
  const [hover, setHover] = useState<string | null>(null);
  const items0 =
    by === 'co'
      ? rows.map((r) => ({ key: r.c.id, label: r.c.name, tag: r.c.team ? `${r.c.team}조` : hasTeams ? '내' : '', color: r.c.color ?? '#999', k: r.total, f: r.totalF }))
      : Object.values(
          rows.reduce<Record<string, { key: string; label: string; tag: string; color: string; k: number; f: number }>>((acc, r) => {
            const t = r.c.team ?? 'own';
            const a = (acc[t] ??= { key: t, label: t === 'own' ? '내 업체' : `${t}조`, tag: '', color: TEAM_COLORS[t] ?? '#999', k: 0, f: 0 });
            a.k += r.total;
            a.f += r.totalF;
            return acc;
          }, {}),
        );
  const sorted = items0.filter((x) => x.k > 0).sort((a, b) => b.k - a.k);
  // 조각이 너무 많으면 9번째부터 '기타'로 묶음
  const items = sorted.length > 9 ? [...sorted.slice(0, 8), { key: 'etc', label: `기타 ${sorted.length - 8}곳`, tag: '', color: '#c9bcb8', k: sorted.slice(8).reduce((a, x) => a + x.k, 0), f: sorted.slice(8).reduce((a, x) => a + x.f, 0) }] : sorted;
  const total = items.reduce((a, x) => a + x.k, 0);
  const totalF = items.reduce((a, x) => a + x.f, 0);
  const periodSeg = (
    <div className="seg share-by">
      <button className={period === 'month' ? 'on' : ''} onClick={() => onPeriod('month')}>
        이 달
      </button>
      <button className={period === 'year' ? 'on' : ''} onClick={() => onPeriod('year')}>
        올해 누적
      </button>
    </div>
  );
  if (!total)
    return (
      <div className="share">
        <div className="share-tools">{periodSeg}</div>
        <p className="muted small">{periodLabel} 총 수출 금액이 없어요{period === 'year' ? ' (불러오는 중일 수 있어요)' : ''}.</p>
      </div>
    );
  // 도넛 조각 (사이 2px 틈)
  const R = 90;
  const r0 = 56;
  const C = 110;
  let acc = 0;
  const arcs = items.map((x) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += x.k;
    const a1 = (acc / total) * Math.PI * 2;
    const pt = (rad: number, a: number) => [C + rad * Math.sin(a), C - rad * Math.cos(a)];
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const full = items.length === 1;
    const d = full
      ? `M ${C} ${C - R} A ${R} ${R} 0 1 1 ${C - 0.01} ${C - R} L ${C - 0.01} ${C - r0} A ${r0} ${r0} 0 1 0 ${C} ${C - r0} Z`
      : (() => {
          const [x0, y0] = pt(R, a0);
          const [x1, y1] = pt(R, a1);
          const [x2, y2] = pt(r0, a1);
          const [x3, y3] = pt(r0, a0);
          return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${r0} ${r0} 0 ${large} 0 ${x3} ${y3} Z`;
        })();
    return { ...x, d, pct: (x.k / total) * 100 };
  });
  const hov = arcs.find((a) => a.key === hover);
  return (
    <div className="share">
      <div className="share-tools">
      {periodSeg}
      <span className="muted small">{periodLabel}</span>
      {hasTeams && (
        <div className="seg share-by">
          <button className={by === 'co' ? 'on' : ''} onClick={() => setBy('co')}>
            업체별
          </button>
          <button className={by === 'team' ? 'on' : ''} onClick={() => setBy('team')}>
            조별
          </button>
        </div>
      )}
      </div>
      <div className="share-body">
        <svg viewBox="0 0 220 220" className="share-pie" role="img" aria-label="총 수출 비중">
          {arcs.map((a) => (
            <path
              key={a.key}
              d={a.d}
              fill={a.color}
              stroke="var(--card-bg, #fffaf8)"
              strokeWidth={2}
              opacity={hover && hover !== a.key ? 0.45 : 1}
              onMouseEnter={() => setHover(a.key)}
              onMouseLeave={() => setHover(null)}
            >
              <title>
                {a.label} {a.pct.toFixed(1)}% · {won(a.k)}
              </title>
            </path>
          ))}
          <text x={C} y={C - 6} textAnchor="middle" className="share-c1">
            {hov ? `${hov.pct.toFixed(1)}%` : '총 수출'}
          </text>
          <text x={C} y={C + 14} textAnchor="middle" className="share-c2">
            {hov ? hov.label : shortAmt(total)}
          </text>
        </svg>
        <table className="mini-table share-table">
          <thead>
            <tr>
              <th>{by === 'co' ? '업체' : '조'}</th>
              <th className="r">비중</th>
              <th className="r">원화</th>
              <th className="r">외화</th>
            </tr>
          </thead>
          <tbody>
            {arcs.map((a) => (
              <tr key={a.key} className={hover === a.key ? 'on' : ''} onMouseEnter={() => setHover(a.key)} onMouseLeave={() => setHover(null)}>
                <td>
                  <span className="dot" style={{ background: a.color }} /> {a.tag && <span className="team-tag">{a.tag}</span>}
                  {a.label}
                </td>
                <td className="r">
                  <b>{a.pct.toFixed(1)}%</b>
                </td>
                <td className="r">{won(a.k)}</td>
                <td className="r">{a.f ? fx(a.f) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>합계</th>
              <td className="r">100%</td>
              <td className="r">
                <b>{won(total)}</b>
              </td>
              <td className="r">{totalF ? fx(totalF) : '—'}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="muted small">비중은 원화 기준 · 총 수출 = ① 출고 + ② 패킹 중(이번 달만) + ③ 로열티 · 위에서 조를 고르면 그 조 안에서의 비중</p>
    </div>
  );
}

/** 여러 달의 ERP 지난 출고: { 'YYYY-MM': { 매장코드: ErpMonth } } */
function useExportYear(codes: string[], months: string[]) {
  const sig = `${[...new Set(codes)].sort().join(',')}|${months.join(',')}`;
  const [map, setMap] = useState<Record<string, Record<string, ErpMonth>>>({});
  useEffect(() => {
    setMap({});
    const [cs, ms] = sig.split('|');
    const list = cs ? cs.split(',') : [];
    const mlist = ms ? ms.split(',') : [];
    if (!list.length || !mlist.length || DATA_MODE === 'local') return;
    const unsubs = mlist.flatMap((mo) =>
      list.map((code) =>
        onSnapshot(
          doc(db, 'exportMonthly', `${code}_${mo}`),
          (d) =>
            setMap((prev) => {
              const cur = { ...(prev[mo] ?? {}) };
              if (d.exists()) cur[code] = d.data() as ErpMonth;
              else delete cur[code];
              return { ...prev, [mo]: cur };
            }),
          () => {},
        ),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig]);
  return map;
}
