// 출장신청서: 각자 자기 출장마다 한 장 (전도금과 같은 방식으로 내역 · 교통비 · 영수증)
//   trips/{id}: 신청서 (출장 지역 · 기간 · 목적 · 항공기 이용 · 비고 · 출장비 표 · 영수증 배치)
//   tripEntries/{id}: 내역 한 줄 (PettyEntry + tripId)
//   tripCfg/main: { categories (출장비 항목), currencies (금액 통화) }
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import type { PettyEntry, RcptPos, SheetRow } from './petty';

export const DEFAULT_TRIP_CATS = ['교통(항공/열차)', '숙박', '식대', '통신비'];
export const DEFAULT_TRIP_CURS = ['KRW', 'USD', 'JPY'];

/** 출장신청서 '출장비' 표 한 줄 */
export interface TripRow extends SheetRow {
  count?: string; // 인원수
  est?: number; // 예상경비
}
export interface Trip {
  id: string;
  email: string;
  name?: string;
  region: string; // 출장 지역
  from: string; // 출장 시작 YYYY-MM-DD
  to: string; // 출장 끝
  purpose?: string; // 출장 목적
  air?: boolean; // 항공기 이용
  note?: string; // 비고 (아래 큰 칸)
  rows?: TripRow[]; // 출장비 표 (없으면 기본 항목)
  rcpt?: Record<string, RcptPos>; // 영수증 배치
  printCur?: string; // 프린트(출장신청서 · 교통비 사용내역서) 금액 통화 (없으면 원화)
  createdAt: string;
}
export interface TripCfg {
  categories: string[];
  currencies: string[];
}
export type TripEntry = PettyEntry & { tripId?: string };

/** 페이지 제목: '2026년 10월 미국' */
export const tripTitle = (t: Pick<Trip, 'from' | 'region'>) => (t.from ? `${t.from.slice(0, 4)}년 ${Number(t.from.slice(5, 7))}월 ${t.region}` : t.region);
/** 교통비 칸 내역이 들어갈 출장비 항목 ('교통' 이 들어간 첫 항목) */
export const tripTransportItem = (cats: string[]) => cats.find((c) => c.includes('교통')) ?? '교통(항공/열차)';

// ---------- 로컬 모드 ----------
const LS = 'gd:trip';
type Local = { cfg?: TripCfg; trips?: Trip[]; entries?: TripEntry[] };
const readLocal = (): Local => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
};
const writeLocal = (v: Local) => {
  localStorage.setItem(LS, JSON.stringify(v));
  window.dispatchEvent(new Event('gd-trip'));
};
function useLocal<T>(pick: (l: Local) => T) {
  const [v, setV] = useState<T>(() => pick(readLocal()));
  useEffect(() => {
    const load = () => setV(pick(readLocal()));
    window.addEventListener('gd-trip', load);
    return () => window.removeEventListener('gd-trip', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}
const clean = <T,>(v: T) => JSON.parse(JSON.stringify(v)) as T;

// ---------- 설정 ----------
export function useTripCfg(): TripCfg {
  const local = useLocal((l) => l.cfg);
  const [cfg, setCfg] = useState<TripCfg>({ categories: DEFAULT_TRIP_CATS, currencies: DEFAULT_TRIP_CURS });
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'tripCfg', 'main'),
      (d) =>
        setCfg({
          categories: (d.data()?.categories as string[] | undefined)?.length ? (d.data()!.categories as string[]) : DEFAULT_TRIP_CATS,
          currencies: (d.data()?.currencies as string[] | undefined)?.length ? (d.data()!.currencies as string[]) : DEFAULT_TRIP_CURS,
        }),
      () => {},
    );
  }, []);
  if (DATA_MODE === 'local') return { categories: local?.categories ?? DEFAULT_TRIP_CATS, currencies: local?.currencies ?? DEFAULT_TRIP_CURS };
  return cfg;
}
export async function saveTripCfg(cfg: TripCfg) {
  if (DATA_MODE === 'local') return writeLocal({ ...readLocal(), cfg });
  await setDoc(doc(db, 'tripCfg', 'main'), clean(cfg));
}

// ---------- 신청서 ----------
export function useTrips(email: string): Trip[] | null {
  const local = useLocal((l) => l.trips ?? []);
  const [list, setList] = useState<Trip[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local' || !email) return;
    return onSnapshot(
      query(collection(db, 'trips'), where('email', '==', email)),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<Trip, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [email]);
  const all = DATA_MODE === 'local' ? local.filter((t) => t.email === email) : list;
  return all ? [...all].sort((a, b) => b.from.localeCompare(a.from) || b.createdAt.localeCompare(a.createdAt)) : null;
}
export async function saveTrip(t: Trip) {
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, trips: [...(l.trips ?? []).filter((x) => x.id !== t.id), clean(t)] });
  }
  await setDoc(doc(db, 'trips', t.id), clean(t));
}
export async function deleteTrip(id: string) {
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, trips: (l.trips ?? []).filter((x) => x.id !== id), entries: (l.entries ?? []).filter((e) => e.tripId !== id) });
  }
  await deleteDoc(doc(db, 'trips', id));
}

// ---------- 내역 ----------
export function useTripEntries(email: string, tripId: string | null): TripEntry[] | null {
  const local = useLocal((l) => l.entries ?? []);
  const [list, setList] = useState<TripEntry[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local' || !email || !tripId) return;
    setList(null);
    return onSnapshot(
      query(collection(db, 'tripEntries'), where('email', '==', email), where('tripId', '==', tripId)),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<TripEntry, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [email, tripId]);
  if (!tripId) return [];
  const all = DATA_MODE === 'local' ? local.filter((e) => e.tripId === tripId) : list;
  return all ? [...all].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) : null;
}
export async function saveTripEntry(e: TripEntry) {
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, entries: [...(l.entries ?? []).filter((x) => x.id !== e.id), clean(e)] });
  }
  await setDoc(doc(db, 'tripEntries', e.id), clean(e));
}
export async function deleteTripEntry(id: string) {
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, entries: (l.entries ?? []).filter((x) => x.id !== id) });
  }
  await deleteDoc(doc(db, 'tripEntries', id));
}

/** 숫자 → 한글 금액 (145300 → 일십사만오천삼백원) */
export function wonKorean(n: number) {
  const v = Math.round(Math.abs(n));
  if (!v) return '영원';
  const d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
  const small = ['', '십', '백', '천'];
  const big = ['', '만', '억', '조'];
  let out = '';
  const s = String(v);
  const groups: string[] = [];
  for (let i = s.length; i > 0; i -= 4) groups.unshift(s.slice(Math.max(0, i - 4), i));
  groups.forEach((g, gi) => {
    let part = '';
    const digits = g.padStart(4, '0');
    for (let i = 0; i < 4; i++) {
      const x = Number(digits[i]);
      if (x) part += d[x] + small[3 - i];
    }
    if (part) out += part + big[groups.length - 1 - gi];
  });
  return `${n < 0 ? '마이너스 ' : ''}${out}원`;
}
