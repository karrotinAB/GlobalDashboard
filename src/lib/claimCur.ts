// 클레임 통화: 'KRW' (원화) · 통화 코드 (USD · JPY · EUR …) · (예전 기록) 'FOREIGN' = 그 업체 수출 통화
//  패킹금액은 주문의 원화/외화 금액에서 자동. 고른 통화가 업체 수출 통화와 다르면 출고날짜 환율로 바꿈
import { exportCur, fmtCur, rateOn, useFxRates, type FxTable } from './sales';
import { fmtKRW } from '../components/OrderCells';
import type { Claim, Order } from '../types';

type Co = { id: string; exportCurrency?: string } | null | undefined;

export const claimCur = (k: Pick<Claim, 'currency'>, co: Co) => (k.currency === 'KRW' ? 'KRW' : !k.currency || k.currency === 'FOREIGN' ? exportCur(co) : k.currency);

/** 고를 수 있는 통화: 원화 · USD · 업체마다 설정된 수출 통화 전부 */
export const claimCurOptions = (companies: { exportCurrency?: string }[], extra?: string) => ['KRW', 'USD', ...new Set(companies.map((c) => exportCur(c)).filter((c) => c !== 'USD').sort()), ...(extra && extra !== 'KRW' && extra !== 'USD' ? [extra] : [])].filter((c, i, a) => a.indexOf(c) === i);
export const curOptionLabel = (cur: string) => (cur === 'KRW' ? '₩ 원화' : `${fmtCur(cur, 0).replace(/0$/, '').trim()} ${cur}`);

export const fmtMoney = (cur: string, n?: number | null) => (n === undefined || n === null ? '' : cur === 'KRW' ? fmtKRW(n) : fmtCur(cur, n));

/** 환율 표에서 그날(없으면 그 달 가장 최근) 환율로 from → to */
function rateAt(table: FxTable, cur: string, iso: string) {
  const r = rateOn(table, cur, iso);
  if (r) return r.rate;
  for (const m of Object.keys(table[cur] ?? {}).sort().reverse()) {
    const days = Object.keys(table[cur][m] ?? {}).sort().reverse();
    if (days.length) return table[cur][m][days[0]];
  }
  return null;
}
export function convCur(table: FxTable, from: string, to: string, amount: number, iso?: string): number | null {
  if (from === to) return amount;
  const day = iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const a = rateAt(table, from, day);
  const b = rateAt(table, to, day);
  return a && b ? (amount * a) / b : null;
}

const ordersOf = (k: Claim, orders: Order[]) => (k.source === 'bundle' ? orders.filter((o) => o.bundle?.id === k.sourceId) : k.source === 'order' ? orders.filter((o) => o.id === k.sourceId) : []);

/** 패킹금액: 직접 쓴 값 → 없으면 주문에서 (원화 / 외화, 통화가 다르면 환율로 바꿈) */
export function claimPacking(k: Claim, orders: Order[], co: Co, table: FxTable): number | undefined {
  if (k.packingOverride !== undefined) return k.packingOverride;
  const os = ordersOf(k, orders);
  const cur = claimCur(k, co);
  const f = cur === 'KRW' ? 'amountKRW' : 'amountForeign';
  if (!os.some((o) => o[f] !== undefined)) return undefined;
  const total = os.reduce((a, o) => a + (o[f] ?? 0), 0);
  if (cur === 'KRW') return total;
  return convCur(table, exportCur(co), cur, total, k.shipDate) ?? undefined;
}
/** 주문 금액이 업체 수출 통화와 다른 통화로 바뀌었나 (표에 '환산' 표시) */
export const claimConverted = (k: Claim, co: Co) => k.packingOverride === undefined && claimCur(k, co) !== 'KRW' && claimCur(k, co) !== exportCur(co);

const nowMonth = () => new Date().toISOString().slice(0, 7);
/** 다른 통화로 바꿔야 하는 클레임들의 환율 불러오기 */
export function useClaimFx(claims: Claim[], coOf: (k: Claim) => Co): FxTable {
  const need = claims.filter((k) => claimConverted(k, coOf(k)));
  const curs = [...new Set(need.flatMap((k) => [claimCur(k, coOf(k)), exportCur(coOf(k))]))];
  const d = new Date();
  const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const months = need.length ? [nowMonth(), `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`, ...need.map((k) => k.shipDate?.slice(0, 7)).filter((m): m is string => !!m)] : [];
  return useFxRates(curs, months);
}
