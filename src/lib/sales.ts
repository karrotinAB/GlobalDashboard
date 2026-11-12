// 판매 데이터: 서버 함수가 매일 아침 salesMonthly/{매장코드}_{YYYY-MM} 에 지점·일자별 합계를 써 둠
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
