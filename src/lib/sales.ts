// 판매 데이터: 서버 함수가 매주 월요일 아침 7시 salesMonthly/{매장코드}_{YYYY-MM} 에 지점·일자별 합계를 써 둠
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface SalesBranch {
  name?: string;
  days: Record<string, number>; // '01'..'31' → 금액
  cnt?: Record<string, number>; // 계산 건수
}
export interface SalesMonth {
  id: string; // `${code}_${month}`
  code: string; // 매장코드 4자리
  month: string; // YYYY-MM
  branches: Record<string, SalesBranch>; // STORE_ID → …
  updatedAt?: string;
}
export interface SalesStatus {
  at?: string;
  rows?: number;
  docs?: number;
  errors?: string[];
  skipped?: string;
  month?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 매장코드들의 판매 데이터 (실시간). 로컬 테스트 모드는 예시 데이터 */
export function useSales(codes: string[]) {
  const sig = [...new Set(codes)].sort().join(',');
  const [months, setMonths] = useState<SalesMonth[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const list = sig ? sig.split(',') : [];
    if (!list.length) {
      setMonths([]);
      setReady(true);
      return;
    }
    if (DATA_MODE === 'local') {
      setMonths(demoSales(list));
      setReady(true);
      return;
    }
    setReady(false);
    // Firestore 'in' 은 30개까지 → 나눠서
    const chunks: string[][] = [];
    for (let i = 0; i < list.length; i += 30) chunks.push(list.slice(i, i + 30));
    const parts = new Map<number, SalesMonth[]>();
    const unsubs = chunks.map((chunk, i) =>
      onSnapshot(
        query(collection(db, 'salesMonthly'), where('code', 'in', chunk)),
        (snap) => {
          parts.set(i, snap.docs.map((d) => ({ ...(d.data() as Omit<SalesMonth, 'id'>), id: d.id })));
          setMonths([...parts.values()].flat());
          if (parts.size === chunks.length) setReady(true);
        },
        () => setReady(true),
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig]);
  return { months, ready };
}

export function useSalesStatus() {
  const [s, setS] = useState<SalesStatus | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'salesStatus', 'last'),
      (d) => setS((d.data() as SalesStatus) ?? null),
      () => {},
    );
  }, []);
  return s;
}

export const sumDays = (b?: SalesBranch) => Object.values(b?.days ?? {}).reduce((a, n) => a + n, 0);

/** 한 달 → 월요일 시작 주 목록. 각 주: 7칸(월..일, 그 달이 아닌 날은 null) */
export function weeksOf(month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7; // 월=0
  const weeks: (number | null)[][] = [];
  let cur: (number | null)[] = Array(firstDow).fill(null);
  for (let d = 1; d <= last; d++) {
    cur.push(d);
    if (cur.length === 7) {
      weeks.push(cur);
      cur = [];
    }
  }
  if (cur.length) weeks.push([...cur, ...Array(7 - cur.length).fill(null)]);
  return weeks;
}

/** 금액 짧게: 1,234만 · 1.2억 · 9,800 */
export function shortAmt(n: number) {
  const a = Math.abs(n);
  if (a >= 1e8) return `${(n / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억`;
  if (a >= 1e4) return `${Math.round(n / 1e4).toLocaleString()}만`;
  return Math.round(n).toLocaleString();
}
export const fullAmt = (n: number) => Math.round(n).toLocaleString();

// ---- 로컬 테스트용 예시 데이터 (지점 2곳 · 최근 6개월, 주말이 더 많이 팔림) ----
function demoSales(codes: string[]): SalesMonth[] {
  const out: SalesMonth[] = [];
  const now = new Date();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const code of codes) {
    const branches = [`${code}01`, `${code}02`];
    for (let back = 5; back >= 0; back--) {
      const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
      const month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const lastDay = back === 0 ? now.getDate() - 1 : last;
      const m: SalesMonth = { id: `${code}_${month}`, code, month, branches: {} };
      branches.forEach((sid, bi) => {
        const days: Record<string, number> = {};
        const cnt: Record<string, number> = {};
        for (let day = 1; day <= lastDay; day++) {
          const dow = new Date(d.getFullYear(), d.getMonth(), day).getDay();
          const weekend = dow === 0 || dow === 6;
          const base = (bi ? 1_400_000 : 2_100_000) * (weekend ? 1.6 : 1) * (0.75 + rnd() * 0.5);
          days[pad(day)] = Math.round(base / 100) * 100;
          cnt[pad(day)] = Math.round(base / 23_000);
        }
        m.branches[sid] = { name: `예시 ${bi + 1}호점`, days, cnt };
      });
      out.push(m);
    }
  }
  return out;
}

/** 지점 목록·이름 (서버가 ERP 거래처 정보 BRANCH_NAME 에서 가져와 storeBranches/{코드} 에 둠) → { STORE_ID: 이름 } */
export function useStoreBranches(codes: string[]) {
  const sig = [...new Set(codes)].sort().join(',');
  const [map, setMap] = useState<Record<string, string>>({});
  useEffect(() => {
    const list = sig ? sig.split(',') : [];
    if (!list.length || DATA_MODE === 'local') {
      setMap({});
      return;
    }
    const parts = new Map<string, Record<string, string>>();
    const unsubs = list.map((code) =>
      onSnapshot(
        doc(db, 'storeBranches', code),
        (d) => {
          parts.set(code, (d.get('branches') as Record<string, string>) ?? {});
          setMap(Object.assign({}, ...parts.values()));
        },
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig]);
  return map;
}

/** 대미달러환율 키 (ECOS 731Y002, 현지 통화 / 1달러, 예: MNTPERUSD = 3599): fxRates/{통화}PERUSD_{YYYY-MM} */
export const perUsdKey = (cur: string) => `${cur}PERUSD`;
/** ECOS 일별 환율 (원 / 현지통화 1단위): fxRates/{통화}_{YYYY-MM} */
export type FxTable = Record<string, Record<string, Record<string, number>>>; // cur → month → dd → rate
export function useFxRates(curs: string[], months: string[]) {
  const ids = [...new Set(curs.filter((c) => c && c !== 'KRW'))].flatMap((c) => [...new Set(months)].map((m) => `${c}_${m}`));
  const sig = ids.sort().join(',');
  const [table, setTable] = useState<FxTable>({});
  useEffect(() => {
    const list = sig ? sig.split(',') : [];
    if (!list.length || DATA_MODE === 'local') {
      // 로컬 테스트: 예시 환율
      const demo: FxTable = {};
      for (const id of list) {
        const [cur, month] = id.split('_');
        const base = cur === 'MNTPERUSD' ? 3599 : cur === 'KZTPERUSD' ? 480 : cur.endsWith('PERUSD') ? 1 : cur === 'USD' ? 1385 : cur === 'MNT' ? 0.41 : cur === 'KZT' ? 2.8 : cur === 'GBP' ? 1820 : cur === 'EUR' ? 1500 : 1;
        const days: Record<string, number> = {};
        for (let d = 1; d <= 31; d++) {
          const dow = new Date(`${month}-${pad(d)}T00:00:00`).getDay();
          if (dow !== 0 && dow !== 6) days[pad(d)] = Math.round(base * (1 + Math.sin(d) * 0.01) * 1e4) / 1e4;
        }
        ((demo[cur] ??= {})[month] = days);
      }
      setTable(demo);
      return;
    }
    const unsubs = list.map((id) =>
      onSnapshot(
        doc(db, 'fxRates', id),
        (d) => {
          const [cur, month] = id.split('_');
          setTable((prev) => ({ ...prev, [cur]: { ...(prev[cur] ?? {}), [month]: (d.get('days') as Record<string, number>) ?? {} } }));
        },
        () => {},
      ),
    );
    return () => unsubs.forEach((u) => u());
  }, [sig]);
  return table;
}

/** 그날 환율 (주말·공휴일이면 그 전 영업일). KRW 는 1 */
export function rateOn(table: FxTable, cur: string, iso: string): { rate: number; date: string } | null {
  if (cur === 'KRW') return { rate: 1, date: iso };
  const d = new Date(`${iso}T00:00:00`);
  for (let i = 0; i < 12; i++) {
    const x = new Date(d.getTime() - i * 86400000);
    const month = `${x.getFullYear()}-${pad(x.getMonth() + 1)}`;
    const r = table[cur]?.[month]?.[pad(x.getDate())];
    if (r) return { rate: r, date: `${month}-${pad(x.getDate())}` };
  }
  return null;
}

/** 판매 통화 (나라 이름으로 처음 추천) */
export const SALES_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CNY', 'MNT', 'KZT', 'RUB', 'VND', 'THB', 'MYR', 'IDR', 'PHP', 'SGD', 'TWD', 'HKD', 'AUD', 'CAD', 'NZD', 'MXN', 'BRL', 'INR', 'AED', 'SAR', 'TRY', 'UZS', 'KRW'];
export function guessCurrency(country?: string): string | undefined {
  const c = country ?? '';
  const map: [RegExp, string][] = [
    [/몽골/, 'MNT'], [/카자흐/, 'KZT'], [/러시아/, 'RUB'], [/영국/, 'GBP'], [/미국|에콰도르|파나마|엘살바도르/, 'USD'], [/스페인|프랑스|독일|이탈리아|네덜란드|포르투갈|오스트리아|벨기에|아일랜드|핀란드|그리스/, 'EUR'],
    [/일본/, 'JPY'], [/중국/, 'CNY'], [/베트남/, 'VND'], [/태국/, 'THB'], [/말레이시아/, 'MYR'], [/인도네시아/, 'IDR'], [/필리핀/, 'PHP'], [/싱가포르/, 'SGD'], [/대만/, 'TWD'],
    [/홍콩/, 'HKD'], [/호주/, 'AUD'], [/캐나다/, 'CAD'], [/뉴질랜드/, 'NZD'], [/멕시코/, 'MXN'], [/브라질/, 'BRL'], [/인도(?!네)/, 'INR'], [/두바이|아랍에미리트|UAE/, 'AED'], [/사우디/, 'SAR'], [/튀르키예|터키/, 'TRY'], [/우즈베/, 'UZS'], [/한국/, 'KRW'],
  ];
  return map.find(([re]) => re.test(c))?.[1];
}

// ---------- 수출 통화 (업체마다, 기본 USD) → 화면에는 USD 로 바꿔서 ----------
/** 이 업체 수출 외화 통화 (없으면 USD) */
export const exportCur = (c?: { exportCurrency?: string } | null) => (c?.exportCurrency && c.exportCurrency !== 'USD' && c.exportCurrency !== 'KRW' ? c.exportCurrency : 'USD');
/** 표 안에서 그 통화의 가장 최근 환율 (그날 환율이 아직 없을 때) */
function latestRate(table: FxTable, cur: string) {
  const months = Object.keys(table[cur] ?? {}).sort().reverse();
  for (const m of months) {
    const days = Object.keys(table[cur][m] ?? {}).sort().reverse();
    if (days.length) return { rate: table[cur][m][days[0]], date: `${m}-${days[0]}` };
  }
  return null;
}
/** 외화 → USD: 그날(주말이면 그 전 영업일) 환율, 없으면 받아 둔 가장 최근 환율. 환율이 아예 없으면 null */
export function toUsd(table: FxTable, cur: string, amount: number, iso?: string | null): number | null {
  if (cur === 'USD') return amount;
  const day = iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : new Date().toISOString().slice(0, 10);
  const a = rateOn(table, cur, day) ?? latestRate(table, cur);
  const u = rateOn(table, 'USD', day) ?? latestRate(table, 'USD');
  return a && u ? (amount * a.rate) / u.rate : null;
}
const CUR_SIGN: Record<string, string> = { JPY: '¥', EUR: '€', GBP: '£', CNY: 'CN¥', USD: '$' };
/** 원래 외화 표시 (예: ¥1,234,567) */
export const fmtCur = (cur: string, n?: number | null) => (n === undefined || n === null ? '' : `${CUR_SIGN[cur] ?? `${cur} `}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`);
const monthOf = (iso?: string | null) => (iso && /^\d{4}-\d{2}/.test(iso) ? iso.slice(0, 7) : '');
const nowMonth = () => new Date().toISOString().slice(0, 7);
const prevMon = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/**
 * 주문 외화 → USD 바꾸개: 수출 통화가 USD 가 아닌 업체 주문만 바꿈 (주문일 환율)
 *   usd(o, n) → USD 금액 (바꿀 수 없으면 원래 숫자) · orig(o, n) → 원래 외화 글자 (USD 업체면 '')
 */
export function useOrderUsd(companies: { id: string; exportCurrency?: string }[], orders: { companyId?: string | null; orderDate?: string; createdAt?: string }[]) {
  const curById = new Map(companies.map((c) => [c.id, exportCur(c)]));
  const foreign = orders.filter((o) => (curById.get(o.companyId ?? '') ?? 'USD') !== 'USD');
  const curs = [...new Set(foreign.map((o) => curById.get(o.companyId ?? '')!))];
  const months = curs.length ? [...new Set([nowMonth(), prevMon(nowMonth()), ...foreign.map((o) => monthOf(o.orderDate || o.createdAt)).filter(Boolean)])] : [];
  const table = useFxRates(curs.length ? [...curs, 'USD'] : [], months);
  const curOf = (o: { companyId?: string | null }) => curById.get(o.companyId ?? '') ?? 'USD';
  return {
    curOf,
    usd: (o: { companyId?: string | null; orderDate?: string; createdAt?: string }, n?: number | null, date?: string | null): number | undefined => {
      if (n === undefined || n === null) return undefined;
      const cur = curOf(o);
      if (cur === 'USD') return n;
      return toUsd(table, cur, n, date ?? o.orderDate ?? o.createdAt) ?? n;
    },
    orig: (o: { companyId?: string | null }, n?: number | null) => {
      const cur = curOf(o);
      return cur === 'USD' || n === undefined || n === null ? '' : fmtCur(cur, n);
    },
    table,
  };
}
