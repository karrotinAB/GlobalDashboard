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
import { exportCur, fmtCur, fullAmt, perUsdKey, rateOn, shortAmt, toUsd, useFxRates, useSales, useStoreBranches, type FxTable } from '../lib/sales';
import { isOrderDone, type Company, type Order } from '../types';
import { CoSelect, LIST, MobileCoList } from './MobilePick';

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

/**
 * ① 이 달 출고 금액: 주문 관리에서 '출고'(또는 완료) 처리된 주문의 ERP 출고승인 금액 (출고일 기준 달)
 * 출고 체크 전이면 ERP 승인이 났어도 아직 ② 패킹 중으로 봄 (패킹은 됐는데 아직 안 나간 것)
 */
export function shippedIn(o: Order, month: string) {
  if (!o.id.startsWith('erp-') && !isOrderDone(o)) return null;
  const rows = (o.outRows ?? []).filter((r) => r.status === '출고승인' && normDate(r.date).startsWith(month));
  if (rows.length) return { k: rows.reduce((a, r) => a + (r.k ?? 0), 0), f: rows.reduce((a, r) => a + (r.f ?? 0), 0), date: rows.map((r) => normDate(r.date)).sort().pop() };
  if (!o.outRows?.length && o.outStatus === 'approved' && normDate(o.outDate).startsWith(month)) return { k: o.amountKRW ?? 0, f: o.amountForeign ?? 0, date: normDate(o.outDate) };
  return null;
}
/**
 * ② 패킹 중 금액: 주문은 들어갔고 아직 '출고' 체크 전인 주문 전부 (ERP 출고승인이 났어도)
 * 금액: 승인 났으면 승인 금액, 일부만 승인이면 예정 금액(전체), 아직이면 예정 금액
 */
export function packingOf(o: Order) {
  if (isOrderDone(o)) return null;
  const partial = o.outStatus === 'partial';
  const k = partial ? o.planKRW ?? o.amountKRW ?? 0 : o.amountKRW ?? 0;
  const f = partial ? o.planForeign ?? o.amountForeign ?? 0 : o.amountForeign ?? 0;
  return { k, f, partial, approved: o.outStatus === 'approved' };
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

export default function ExportPanel({ companies, view = 'table', mobile, hideTeamSeg }: { companies: Company[]; view?: 'table' | 'pie'; mobile?: boolean; hideTeamSeg?: boolean }) {
  // 휴대폰 (수출매출): 업체 목록에서 먼저 고르기
  const [mPicked, setMPicked] = useState(false);
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
  // + 수출 통화가 USD 가 아닌 업체 (주문 외화 → USD)
  const fxTable = useFxRates([...royaltyCos.map((c) => c.salesCurrency ?? ''), ...royaltyCos.map((c) => (c.salesCurrency ? perUsdKey(c.salesCurrency) : '')), ...companies.map((c) => exportCur(c)), 'USD'], [shiftMonth(month, -1), month]);
  const salesOf = (c: Company, mo: string = month, fx: FxTable = fxTable) => {
    const docs = sales.filter((m) => m.month === mo && (c.storeCodes ?? []).includes(m.code));
    const cur = c.salesCurrency;
    // 판매일 하루 → 달러 = 판매(현지) ÷ 그날 (현지/달러, ECOS 대미달러환율) × 5% · 원화 = 달러 × 그날 원/달러 (참고)
    //  중간에 반올림 안 함 (화면에 보일 때만)
    const conv = (date: string, amt: number) => {
      const ur = rateOn(fx, 'USD', date);
      const pu = !cur ? null : cur === 'USD' ? { rate: 1, date } : cur === 'KRW' ? ur : rateOn(fx, perUsdKey(cur), date);
      const usd = pu ? (amt / pu.rate) * ROYALTY_RATE : null;
      const krw = usd !== null && ur ? usd * ur.rate : null;
      return { pu, ur, usd, krw };
    };
    const branches = docs.flatMap((d) =>
      Object.entries(d.branches).map(([sid, b]) => {
        const total = Object.values(b.days).reduce((a, n) => a + n, 0);
        let krw = 0;
        let usd = 0;
        let miss = 0;
        for (const [dd, v] of Object.entries(b.days)) {
          const x = conv(`${mo}-${dd}`, v);
          if (x.usd === null) miss++;
          krw += x.krw ?? 0;
          usd += x.usd ?? 0;
        }
        return { sid, name: branchNames[sid] || b.name || '', total, days: Object.keys(b.days).length, roy: total * ROYALTY_RATE, krw, usd, miss };
      }),
    );
    // 날짜별 합계 (지점 합) → 그날 환율
    const byDay = new Map<string, number>();
    for (const d of docs) for (const b of Object.values(d.branches)) for (const [dd, v] of Object.entries(b.days)) byDay.set(`${mo}-${dd}`, (byDay.get(`${mo}-${dd}`) ?? 0) + v);
    const days = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amt]) => ({ date, amt, roy: amt * ROYALTY_RATE, ...conv(date, amt) }));
    return {
      cur,
      days,
      branches: branches.sort((a, b) => b.total - a.total),
      total: branches.reduce((a, b) => a + b.total, 0),
      royLocal: days.reduce((a, d) => a + d.roy, 0),
      royK: days.reduce((a, d) => a + (d.krw ?? 0), 0),
      royF: days.reduce((a, d) => a + (d.usd ?? 0), 0),
      missing: days.filter((d) => d.usd === null).length,
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
          const pack0 = (month < thisMonth() ? [] : orders).map((o) => ({ o, v: packingOf(o) })).filter((x): x is { o: Order; v: NonNullable<ReturnType<typeof packingOf>> } => !!x.v);
          // 수출 통화가 USD 가 아니면 외화를 USD 로 (출고일 · 주문일 환율), 원래 외화는 fo 에
          const cur = exportCur(c);
          const cv = (f: number, d?: string | null) => (cur === 'USD' || !f ? f : (toUsd(fx, cur, f, d) ?? f));
          // KRW 업체: 원래 금액(fo)은 원화
          const src = (v: { k: number; f: number }) => (cur === 'KRW' ? v.k : v.f);
          // KRW 업체: ERP 외화 금액이 USD 로 오면 그대로 (없을 때만 원화를 달러로)
          const usdOf = (v: { k: number; f: number }, d?: string | null) => (cur === 'KRW' && v.f ? v.f : cv(src(v), d));
          const shipU = ship.map((x) => (cur === 'USD' ? x : { ...x, v: { ...x.v, fo: src(x.v), f: usdOf(x.v, x.v.date ?? x.o.orderDate) } }));
          const pack = pack0.map((x) => (cur === 'USD' ? x : { ...x, v: { ...x.v, fo: src(x.v), f: usdOf(x.v, x.o.orderDate) } }));
          // 로열티 받기 시작한 달 전에는 없음
          const sale = c.royalty && (!c.royaltyFrom || month >= c.royaltyFrom) ? salesOf(c, month, fx) : null;
          const r = {
            c,
            ship: shipU,
            pack,
            cur,
            shipFo: cur === 'USD' ? 0 : ship.reduce((a, x) => a + src(x.v), 0),
            packFo: cur === 'USD' ? 0 : pack0.reduce((a, x) => a + src(x.v), 0),
            sale,
            shipK: ship.reduce((a, x) => a + x.v.k, 0),
            shipF: shipU.reduce((a, x) => a + x.v.f, 0),
            packK: pack.reduce((a, x) => a + x.v.k, 0),
            packF: pack.reduce((a, x) => a + x.v.f, 0),
            royalty: sale ? sale.royK : 0, // 원화 (판매일 환율)
            royaltyF: sale ? sale.royF : 0, // 달러
          };
          return { ...r, total: r.shipK + r.packK + r.royalty, totalF: r.shipF + r.packF + r.royaltyF };
        })
        .filter((r) => r.ship.length || r.pack.length || r.sale);
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
  const fxYear = useFxRates(wantYear ? [...royaltyCos.map((c) => c.salesCurrency ?? ''), ...royaltyCos.map((c) => (c.salesCurrency ? perUsdKey(c.salesCurrency) : '')), ...companies.map((c) => exportCur(c)), 'USD'] : [], wantYear ? [shiftMonth(yearMonths[0], -1), ...yearMonths] : []);
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
  // 외화를 USD 로 바꾼 업체가 섞여 있으면 합계는 USD ($)
  const fxCode = scope.some((r) => r.cur !== 'USD') ? undefined : scope.flatMap((r) => [...r.ship, ...r.pack]).find((x) => x.o.fxCode)?.o.fxCode;
  const now = thisMonth();
  const [y, m] = month.split('-').map(Number);
  // 순서: ④ 총 수출 → ① 출고 → ② 패킹 중 → ③ 로열티
  // 카드 외화 아래 작게: USD 로 바꾸기 전 원래 외화 (엔화 업체 · 로열티는 판매 통화)
  const origOf = (key: 'total' | 'ship' | 'pack' | 'royalty') => {
    const m: Record<string, number> = {};
    const add = (cur: string, n: number) => {
      if (!n || cur === 'USD' || cur === 'KRW') return;
      m[cur] = (m[cur] ?? 0) + n;
    };
    for (const r of scope) {
      if (key === 'ship' || key === 'total') add(r.cur, r.shipFo);
      if (key === 'pack' || key === 'total') add(r.cur, r.packFo);
      if ((key === 'royalty' || key === 'total') && r.sale) add(r.sale.cur ?? 'USD', r.sale.royLocal);
    }
    return Object.entries(m)
      .map(([c, n]) => fmtCur(c, Math.round(n * 100) / 100))
      .join(' · ');
  };
  const cards: { key: Exclude<Pick, null> | 'total'; n: string; label: string; k: number; f?: number; sub: string }[] = [
    { key: 'total', n: '', label: '총 수출 금액', k: sum('total'), f: sum('totalF'), sub: '① + ② + ③ (로열티는 환율 적용)' },
    { key: 'ship', n: '①', label: `${m}월 출고 금액`, k: sum('shipK'), f: sum('shipF'), sub: '출고 체크한 주문의 ERP 출고승인 금액 (출고일 기준)' },
    { key: 'pack', n: '②', label: '패킹 중 금액', k: sum('packK'), f: sum('packF'), sub: '주문 들어갔고 아직 출고 체크 전 (ERP 승인 났어도) · 지금 기준' },
    { key: 'royalty', n: '③', label: '로열티', k: sum('royalty'), f: sum('royaltyF'), sub: `${m}월 판매 × ${ROYALTY_RATE * 100}% · 판매일 ECOS 환율` },
  ];

  const pickItems = [
    { id: '', label: '전체 업체' },
    ...rows.map((r) => ({ id: r.c.id, label: r.c.name, color: r.c.color, tag: hasTeams ? (r.c.team ? `${r.c.team}조` : '내') : undefined, badge: r.c.royalty ? '로열티' : undefined })),
  ];
  if (mobile && view === 'table' && !mPicked)
    return (
      <div className="export">
        <MobileCoList
          items={pickItems}
          empty={`${m}월 출고·패킹 중 주문이나 로열티 매장이 없어요.`}
          onPick={(id) => {
            setCoId(id);
            setMPicked(true);
          }}
        />
      </div>
    );
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
        {mobile && view === 'table' && (
          <CoSelect
            value={coId}
            items={pickItems}
            onChange={(v) => {
              if (v === LIST) {
                setCoId('');
                setMPicked(false);
              } else setCoId(v);
            }}
          />
        )}
        {!mobile && !hideTeamSeg && hasTeams && (
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
        {/* 업체 고르기는 표 보기에서만 (비중은 늘 모든 업체를 같이 봐서 고를 게 없음) */}
        {!mobile && view !== 'pie' && <div className="company-chips">
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
        </div>}
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
          mobile={mobile}
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
                {mobile && c.key !== 'total' ? (
                  <span className="ec-amts-m">
                    <b>{c.k ? `${shortAmt(c.k)}원` : '0원'}</b>
                    <small>{c.f ? shortUsd(c.f) : '—'}</small>
                    {origOf(c.key) && <small className="fx-orig">{origOf(c.key)}</small>}
                  </span>
                ) : (
                  <Amts krw={won(c.k)} fx={c.f ? fx(c.f, fxCode) : '—'} orig={origOf(c.key)} />
                )}
                {/* 설명은 '자세히'를 누르면 (총 금액만 맨 아래 작게) */}
                {c.key === 'total' ? <span className="ec-sub ec-foot">{c.sub}</span> : <span className="ec-more">{open === c.key ? '접기 ▴' : mobile ? '자세히' : '자세히 ▾'}</span>}
              </button>
            ))}
          </div>

          {open === 'ship' && (
            <OrderList
              note="주문 관리에서 출고(완료) 체크한 주문의 ERP 출고승인 금액 · 출고일이 이 달인 것"
              title={`① ${m}월 출고 금액 — 출고승인 난 주문`}
              empty="이 달 출고승인 난 주문이 없어요."
              items={scope.flatMap((r) => r.ship.map((x) => ({ c: r.c, o: x.o, k: x.v.k, f: x.v.f, fo: (x.v as { fo?: number }).fo, cur: r.cur, extra: x.v.date?.slice(5).replace('-', '/') ?? '' })))}
              extraHead="출고일"
              showCo={!coId}
            />
          )}
          {open === 'pack' && (
            <OrderList
              note={month < now ? '지난 달은 마감이라 패킹 중 금액은 넣지 않아요 (이번 달에만 보여요)' : '주문 들어갔고 아직 출고 체크 전인 주문 전부 (ERP 출고승인이 났어도) · 지금 기준'}
              title="② 패킹 중 금액 — 아직 출고 체크 전인 주문"
              empty={month < now ? '지난 달은 마감 — 패킹 중 없음' : '패킹 중인 주문이 없어요.'}
              items={scope.flatMap((r) => r.pack.map((x) => ({ c: r.c, o: x.o, k: x.v.k, f: x.v.f, fo: (x.v as { fo?: number }).fo, cur: r.cur, extra: `${x.o.packing?.trim() || '—'}${x.v.approved ? ' · ERP 출고승인 (출고 체크 전)' : x.v.partial ? ' · 일부 승인' : ''}` })))}
              extraHead="패킹 예정일"
              showCo={!coId}
            />
          )}
          {open === 'royalty' && (
            <div className="export-detail">
              <h3>③ 로열티 — {m}월 판매 합계 × {ROYALTY_RATE * 100}%</h3>
              <p className="muted small detail-note">{m}월 판매 × {ROYALTY_RATE * 100}% · 달러 = 판매 ÷ 그날 현지통화/USD (ECOS 대미달러환율) × {ROYALTY_RATE * 100}% · 원화 = 달러 × 그날 원/USD (참고) · 주말·공휴일은 그 전 영업일 환율 · 반올림은 화면에서만</p>
              {scope.filter((r) => r.sale).length === 0 && <p className="muted small">로열티 매장이 없어요. 설정 &gt; 매장 설정에서 업체의 ⚙ 를 눌러 <b>로열티</b>를 켜 주세요.</p>}
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
            표는 원화 · 아래 작게 외화($) (주문은 ERP 원화·외화 금액, 로열티는 판매일마다 ECOS 매매기준율로 환산 · 주말·공휴일은 그 전 영업일 환율). ② 패킹 중은 이번 달에만 (아직 출고 체크 전인 주문 전부, ERP 승인 났어도) — 지난 달은 마감이라 빠져요.
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
  items: { c: Company; o: Order; k: number; f: number; fo?: number; cur?: string; extra: string }[];
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
              {sorted.map(({ c, o, k, f, fo, cur, extra }) => (
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
                  <td className="r">
                    {f ? (fo !== undefined ? fx(f) : fx(f, o.fxCode)) : '—'}
                    {fo !== undefined && cur && <small className="fx-orig">{fmtCur(cur, fo)}</small>}
                  </td>
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
  days: { date: string; amt: number; roy: number; pu: { rate: number; date: string } | null; ur: { rate: number; date: string } | null; krw: number | null; usd: number | null }[];
};
/** 소수 둘째 자리까지 (표시할 때만 반올림) */
const n2 = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
                  {n2(sale.total)}
                </td>
                <td className="c muted">×{pct}</td>
                <td className="r">
                  {sym}
                  {n2(sale.royLocal)}
                </td>
                <td className="r">{cur ? won(sale.royK) : '—'}</td>
                <td className="r">{cur ? `$${n2(sale.royF)}` : '—'}</td>
              </tr>
              {sale.branches.map((b) => (
                <tr key={b.sid}>
                  <td>
                    {b.name || '지점'} <span className="muted small">{b.sid}</span>
                  </td>
                  <td className="r">{b.days}일</td>
                  <td className="r">{n2(b.total)}</td>
                  <td className="c muted">×{pct}</td>
                  <td className="r">{n2(b.roy)}</td>
                  <td className="r">{cur ? won(b.krw) : '—'}</td>
                  <td className="r">{cur ? `$${n2(b.usd)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!cur && <div className="warn small">판매 통화를 아직 안 골랐어요 — 설정 &gt; 매장 설정에서 이 업체의 <b>판매 통화</b>를 골라 주세요. (그 전까지 원화·달러 환산은 0)</div>}
      {cur && sale.missing > 0 && <div className="warn small">환율이 없는 날 {sale.missing}일은 원화·달러에서 빠졌어요 (ECOS 인증키·환율 가져오기 확인)</div>}
      {live && <div className="muted small">이번 달은 어제까지 판매 기준 — 월말에 확정 · 원화·달러는 판매일마다 그날 환율</div>}
      {open && sale.days.length > 0 && (
          <div className="sales-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>판매일</th>
                  <th className="r">판매 ({cur ?? '?'})</th>
                  <th className="r">
                    로열티 {ROYALTY_RATE * 100}% ({cur ?? '?'})
                  </th>
                  <th className="r">환율 ({cur ?? '?'}/USD)</th>
                  <th className="r">달러</th>
                  <th className="r">원/USD</th>
                  <th className="r">원화</th>
                </tr>
              </thead>
              <tbody>
                {sale.days.map((d) => (
                  <tr key={d.date}>
                    <td>{d.date.slice(5).replace('-', '/')}</td>
                    <td className="r">{n2(d.amt)}</td>
                    <td className="r">{n2(d.roy)}</td>
                    <td className="r" title={d.pu && d.pu.date !== d.date ? `${d.pu.date} 환율 (그 전 영업일)` : undefined}>
                      {d.pu ? rateTxt(d.pu.rate) : <span className="warn">없음</span>}
                      {d.pu && d.pu.date !== d.date && <span className="muted small"> ({d.pu.date.slice(5).replace('-', '/')})</span>}
                    </td>
                    <td className="r">{d.usd !== null ? n2(d.usd) : '—'}</td>
                    <td className="r" title={d.ur && d.ur.date !== d.date ? `${d.ur.date} 환율 (그 전 영업일)` : undefined}>
                      {d.ur ? rateTxt(d.ur.rate) : '—'}
                      {d.ur && d.ur.date !== d.date && <span className="muted small"> ({d.ur.date.slice(5).replace('-', '/')})</span>}
                    </td>
                    <td className="r">{d.krw !== null ? fullAmt(d.krw) : '—'}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>합계</th>
                  <td className="r">{n2(sale.total)}</td>
                  <td className="r">{n2(sale.royLocal)}</td>
                  <td />
                  <td className="r">{n2(sale.royF)}</td>
                  <td />
                  <td className="r">{fullAmt(sale.royK)}</td>
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
function Amts({ krw, fx: f, orig }: { krw: string; fx: string; orig?: string }) {
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
        {orig && <small className="fx-orig ec-orig">{orig}</small>}
      </span>
    </span>
  );
}

/** 표 칸: 원화 (짧게) + 아래 외화 */
const shortUsd = (n: number) => (Math.abs(n) >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : Math.abs(n) >= 1e3 ? `$${(n / 1e3).toFixed(1)}k` : `$${n.toFixed(0)}`);
function KF({ k, f, bold, orig }: { k: number; f: number; bold?: boolean; orig?: string }) {
  if (!k && !f) return <td className="r">—</td>;
  return (
    <td className="r kf" title={`${won(k)}${f ? ` · ${fx(f)}` : ''}${orig ? ` (원래 ${orig})` : ''}`}>
      {bold ? <b>{shortAmt(k)}</b> : shortAmt(k)}
      {f ? <small className="kf-fx">{shortUsd(f)}</small> : null}
      {orig ? <small className="fx-orig">{orig}</small> : null}
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
  mobile,
}: {
  rows: { c: Company; total: number; totalF: number }[];
  hasTeams: boolean;
  period: 'month' | 'year';
  periodLabel: string;
  onPeriod: (p: 'month' | 'year') => void;
  mobile?: boolean;
}) {
  const [by, setBy] = useState<'co' | 'team'>('co');
  const [curT, setCurT] = useState<'KRW' | 'USD'>('KRW');
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
          <text x={C} y={C - 16} textAnchor="middle" className="share-c1">
            {hov ? `${hov.pct.toFixed(1)}%` : '총 수출'}
          </text>
          <text x={C} y={C + 6} textAnchor="middle" className="share-c2">
            {hov ? hov.label : `${shortAmt(total)}원`}
          </text>
          <text x={C} y={C + 22} textAnchor="middle" className="share-c3">
            {hov ? `${shortAmt(hov.k)}원 · ${shortUsd(hov.f)}` : shortUsd(totalF)}
          </text>
        </svg>
        {mobile && (
          <div className={`mode-slide small share-cur ${curT === 'KRW' ? 'sales' : 'export'}`} role="tablist">
            <span className="mode-knob" />
            <button role="tab" aria-selected={curT === 'KRW'} onClick={() => setCurT('KRW')}>
              원화
            </button>
            <button role="tab" aria-selected={curT === 'USD'} onClick={() => setCurT('USD')}>
              외화
            </button>
          </div>
        )}
        <table className={`mini-table share-table ${mobile ? `one ${curT}` : ''}`}>
          <thead>
            <tr>
              <th>{by === 'co' ? '업체' : '조'}</th>
              <th className="r">비중</th>
              <th className="r c-krw">원화</th>
              <th className="r c-usd">외화</th>
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
                <td className="r c-krw">{won(a.k)}</td>
                <td className="r c-usd">{a.f ? fx(a.f) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>합계</th>
              <td className="r">100%</td>
              <td className="r c-krw">
                <b>{won(total)}</b>
              </td>
              <td className="r c-usd">{totalF ? fx(totalF) : '—'}</td>
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
