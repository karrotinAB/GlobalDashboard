// 전도금: 한 달을 두 번(1~15일 / 16일~말일)으로 나눠 기록
//   pcCfg/main: { managers: string[] (전도금 담당자 이메일, 관리자가 정함), purposes: string[] (용도, 담당자가 관리) }
//   pcAccounts/{이메일}: { name, bank, account }  (내 계좌, 저장해 두고 계속 씀)
//   pcEntries/{id}: 전도금 내역 · 교통비 한 줄씩 (쓴 사람 이메일로 구분)
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { auth, db, storage } from '../firebase';
import { DATA_MODE } from '../data/store';

export const DEFAULT_PURPOSES = ['식대', '교통비', '구독료', '출장비', '비품'];
export const TRANSPORTS = ['버스', '기차', '택시', '기타'] as const;

export interface PettyFile {
  name: string;
  url: string;
  path?: string;
}
export interface PettyEntry {
  id: string;
  email: string;
  name?: string;
  kind: 'expense' | 'transport';
  date: string; // YYYY-MM-DD
  amount?: number; // 원화 (외화면 영수증 날짜 ECOS 환율로 바꾼 값 — 환율이 아직 없으면 비어 있다가 채워짐)
  cur?: string; // 금액 통화 (없으면 KRW)
  curAmount?: number; // 외화 원래 금액
  rate?: number; // 쓴 환율 (원 / 1단위)
  rateDate?: string;
  // 전도금 내역
  purpose?: string;
  content?: string;
  // 교통비
  mode?: string; // 버스 · 기차 · 택시 · 기타
  modeOther?: string; // 기타일 때 직접 쓴 것
  from?: string;
  to?: string;
  memo?: string; // 교통비 신청서 '내역' (담당자가 고침, 없으면 '이름 + 수단')
  // 영수증: 사진(파일) 또는 종이영수증
  receipt?: PettyFile;
  paper?: boolean;
  createdAt: string;
}
export interface PettyAccount {
  name?: string;
  bank?: string;
  account?: string;
}
export interface PettyCfg {
  managers: string[];
  purposes: string[];
  currencies?: string[]; // 금액 통화 (기본 원 · 달러 · 엔, 담당자가 더 넣음)
}
export const DEFAULT_PC_CURRENCIES = ['KRW', 'USD', 'JPY'];
const CUR_KO: Record<string, string> = { KRW: '원', USD: '달러', JPY: '엔', EUR: '유로', CNY: '위안', GBP: '파운드' };
export const curLabel = (c: string) => CUR_KO[c] ?? c;

/** 날짜 → 기간 (월 + 앞/뒤 반) */
export const periodOf = (iso: string) => ({ ym: iso.slice(0, 7), half: Number(iso.slice(8, 10)) <= 15 ? 1 : 2 });
export const periodKey = (p: { ym: string; half: number }) => `${p.ym}-${p.half}`;
// 1~15일 = 하반기, 16일~말일 = 상반기 (요청하신 이름 그대로)
export const HALF_LABEL: Record<number, string> = { 1: '하반기', 2: '상반기' };
export const periodLabel = (p: { ym: string; half: number }) => `${Number(p.ym.slice(5, 7))}월 ${HALF_LABEL[p.half]}`;
export const periodRange = (p: { ym: string; half: number }) => {
  const [y, m] = p.ym.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return p.half === 1 ? `${m}/1 ~ ${m}/15` : `${m}/16 ~ ${m}/${last}`;
};
export const shiftPeriod = (p: { ym: string; half: number }, d: 1 | -1) => {
  if (d === 1) {
    if (p.half === 1) return { ym: p.ym, half: 2 };
    const [y, m] = p.ym.split('-').map(Number);
    const n = new Date(y, m, 1);
    return { ym: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`, half: 1 };
  }
  if (p.half === 2) return { ym: p.ym, half: 1 };
  const [y, m] = p.ym.split('-').map(Number);
  const n = new Date(y, m - 2, 1);
  return { ym: `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`, half: 2 };
};

// ---------- 로컬 모드 ----------
const LS = 'gd:petty';
type Local = { cfg?: PettyCfg; accounts?: Record<string, PettyAccount>; entries?: PettyEntry[]; periods?: Record<string, PettyPeriod> };
const readLocal = (): Local => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
};
const writeLocal = (v: Local) => {
  localStorage.setItem(LS, JSON.stringify(v));
  window.dispatchEvent(new Event('gd-petty'));
};
function useLocal<T>(pick: (l: Local) => T) {
  const [v, setV] = useState<T>(() => pick(readLocal()));
  useEffect(() => {
    const load = () => setV(pick(readLocal()));
    window.addEventListener('gd-petty', load);
    return () => window.removeEventListener('gd-petty', load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return v;
}

// ---------- 설정 (담당자 · 용도) ----------
export function usePettyCfg(): PettyCfg | null {
  const local = useLocal((l) => l.cfg ?? null);
  const [cfg, setCfg] = useState<PettyCfg | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'pcCfg', 'main'),
      (d) => setCfg({ managers: (d.data()?.managers as string[]) ?? [], purposes: (d.data()?.purposes as string[]) ?? DEFAULT_PURPOSES, currencies: (d.data()?.currencies as string[]) ?? DEFAULT_PC_CURRENCIES }),
      () => setCfg({ managers: [], purposes: DEFAULT_PURPOSES }),
    );
  }, []);
  if (DATA_MODE === 'local') return { managers: local?.managers ?? [], purposes: local?.purposes ?? DEFAULT_PURPOSES, currencies: local?.currencies ?? DEFAULT_PC_CURRENCIES };
  return cfg;
}
export async function savePettyCfg(cfg: PettyCfg) {
  if (DATA_MODE === 'local') return writeLocal({ ...readLocal(), cfg });
  await setDoc(doc(db, 'pcCfg', 'main'), cfg);
}

// ---------- 내 계좌 ----------
const EMPTY_ACC: PettyAccount = {};
export function usePettyAccount(email: string): PettyAccount | null {
  const local = useLocal((l) => l.accounts ?? {});
  const [acc, setAcc] = useState<PettyAccount | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local' || !email) return;
    return onSnapshot(
      doc(db, 'pcAccounts', email),
      (d) => setAcc((d.data() as PettyAccount) ?? {}),
      () => setAcc({}),
    );
  }, [email]);
  if (DATA_MODE === 'local') return local[email || 'local'] ?? EMPTY_ACC;
  return acc;
}
export async function savePettyAccount(email: string, a: PettyAccount) {
  const clean = JSON.parse(JSON.stringify(a)) as PettyAccount;
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, accounts: { ...(l.accounts ?? {}), [email || 'local']: clean } });
  }
  await setDoc(doc(db, 'pcAccounts', email), clean);
}

// ---------- 내역 ----------
/** email 을 주면 그 사람 것만, null 이면 모두 (담당자·관리자) */
export function usePettyEntries(email: string | null): PettyEntry[] | null {
  const local = useLocal((l) => l.entries ?? []);
  const [list, setList] = useState<PettyEntry[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    setList(null);
    const q = email ? query(collection(db, 'pcEntries'), where('email', '==', email)) : collection(db, 'pcEntries');
    return onSnapshot(
      q,
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<PettyEntry, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [email]);
  const all = DATA_MODE === 'local' ? local.filter((e) => !email || e.email === email) : list;
  return all ? [...all].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt)) : null;
}
export async function savePettyEntry(e: PettyEntry) {
  const clean = JSON.parse(JSON.stringify(e)) as PettyEntry;
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, entries: [...(l.entries ?? []).filter((x) => x.id !== e.id), clean] });
  }
  await setDoc(doc(db, 'pcEntries', e.id), clean);
}
export async function deletePettyEntry(id: string) {
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, entries: (l.entries ?? []).filter((x) => x.id !== id) });
  }
  await deleteDoc(doc(db, 'pcEntries', id));
}

/** 영수증 사진 올리기 (petty/{이메일}/…) */
export async function uploadReceipt(email: string, file: File): Promise<PettyFile> {
  if (DATA_MODE === 'local') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('로컬 모드에서는 1.5MB 이하만 넣을 수 있어요');
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    return { name: file.name, url };
  }
  const name = file.name || `영수증-${Date.now()}.png`;
  // 올리는 사람 폴더에 (담당자가 팀장님·이사님 대신 올려도)
  const owner = auth.currentUser?.email?.toLowerCase() || email;
  const path = `petty/${owner}/${Date.now()}-${name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  return { name, url: await getDownloadURL(r), path };
}

export const won = (n?: number) => (n === undefined || Number.isNaN(n) ? '' : `₩${Math.round(n).toLocaleString('ko-KR')}`);

// ---------- 담당자용: 모든 사람 계좌 ----------
export function usePettyAccounts(enabled: boolean): Record<string, PettyAccount> {
  const local = useLocal((l) => l.accounts ?? {});
  const [m, setM] = useState<Record<string, PettyAccount>>({});
  useEffect(() => {
    if (DATA_MODE === 'local' || !enabled) return;
    return onSnapshot(
      collection(db, 'pcAccounts'),
      (snap) => setM(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as PettyAccount]))),
      () => setM({}),
    );
  }, [enabled]);
  return DATA_MODE === 'local' ? local : m;
}

// ---------- 기간별 정산 (전달 완료 · 정산서 항목) ----------
//   pcPeriods/{2026-11-1}: { paid: { 이메일: { at, by } }, rows: SheetRow[] }
export interface SheetRow {
  id: string;
  item: string; // 항목 (용도)
  desc: string; // 내역
  note?: string; // 비고
}
/** 영수증 장 위의 위치 (mm, A4 210×297) — 담당자가 옮기거나 크기를 바꾼 것만 저장 */
export interface RcptPos {
  page?: string; // '항목#번호'
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  fs?: number; // 글자 크기 (pt)
  lx?: number; // 글자 위치 (상자 왼쪽 위 기준, mm)
  ly?: number;
  bold?: boolean; // 글자 굵게
  hl?: boolean; // 글자 형광펜
  hlc?: string; // 형광펜 색
  text?: string; // 글자를 직접 고친 것 (없으면 '글로벌사업부/이름/내용')
}
export interface PettyPeriod {
  paid?: Record<string, { at: string; by?: string }>;
  rows?: SheetRow[];
  rcpt?: Record<string, RcptPos>;
}
export const DEFAULT_SHEET_ROWS: SheetRow[] = [
  { id: 'r1', item: '식대', desc: '야근 식대' },
  { id: 'r2', item: '교통비', desc: '야근 교통비, 외근 교통비' },
  { id: 'r3', item: '구독료', desc: '클로드 구독료, 노션 구독료' },
  { id: 'r4', item: '출장비', desc: '조승재 이사 출장' },
  { id: 'r5', item: '기타', desc: '비품' },
];
const EMPTY_PERIOD: PettyPeriod = {};
export function usePettyPeriod(pk: string, enabled: boolean): PettyPeriod | null {
  const local = useLocal((l) => l.periods ?? {});
  const [v, setV] = useState<PettyPeriod | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local' || !enabled) return;
    setV(null);
    return onSnapshot(
      doc(db, 'pcPeriods', pk),
      (d) => setV((d.data() as PettyPeriod) ?? {}),
      () => setV({}),
    );
  }, [pk, enabled]);
  if (DATA_MODE === 'local') return local[pk] ?? EMPTY_PERIOD;
  return v;
}
export async function savePettyPeriod(pk: string, v: PettyPeriod) {
  const clean = JSON.parse(JSON.stringify(v)) as PettyPeriod;
  if (DATA_MODE === 'local') {
    const l = readLocal();
    return writeLocal({ ...l, periods: { ...(l.periods ?? {}), [pk]: clean } });
  }
  await setDoc(doc(db, 'pcPeriods', pk), clean);
}

/** 이 내역이 들어가는 정산서 항목 이름 (교통비 칸은 '교통비', 정산서에 없는 용도는 '기타' 또는 마지막 항목) */
export function itemOf(rows: SheetRow[], e: PettyEntry) {
  const items = rows.map((r) => r.item.trim());
  const key = e.kind === 'transport' ? '교통비' : (e.purpose ?? '').trim();
  if (items.includes(key)) return key;
  return items.includes('기타') ? '기타' : (items[items.length - 1] ?? key);
}

/** 정산서 항목 금액: 교통비 칸 내역은 '교통비', 전도금 내역은 그 용도 — 정산서에 없는 용도는 '기타'(없으면 마지막 줄)로 */
export function sheetAmounts(rows: SheetRow[], entries: PettyEntry[]) {
  const amt: Record<string, number> = Object.fromEntries(rows.map((r) => [r.id, 0]));
  const byItem = new Map(rows.map((r) => [r.item.trim(), r.id]));
  const etc = byItem.get('기타') ?? rows[rows.length - 1]?.id;
  for (const e of entries) {
    const key = e.kind === 'transport' ? '교통비' : (e.purpose ?? '').trim();
    const id = byItem.get(key) ?? etc;
    if (id) amt[id] += e.amount ?? 0;
  }
  return amt;
}
