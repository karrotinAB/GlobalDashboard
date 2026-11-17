// 전도금: 한 달을 두 번(1~15일 / 16일~말일)으로 나눠 기록
//   pcCfg/main: { managers: string[] (전도금 담당자 이메일, 관리자가 정함), purposes: string[] (용도, 담당자가 관리) }
//   pcAccounts/{이메일}: { name, bank, account }  (내 계좌, 저장해 두고 계속 씀)
//   pcEntries/{id}: 전도금 내역 · 교통비 한 줄씩 (쓴 사람 이메일로 구분)
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
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
  amount?: number;
  // 전도금 내역
  purpose?: string;
  content?: string;
  // 교통비
  mode?: string; // 버스 · 기차 · 택시 · 기타
  modeOther?: string; // 기타일 때 직접 쓴 것
  from?: string;
  to?: string;
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
}

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
type Local = { cfg?: PettyCfg; accounts?: Record<string, PettyAccount>; entries?: PettyEntry[] };
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
      (d) => setCfg({ managers: (d.data()?.managers as string[]) ?? [], purposes: (d.data()?.purposes as string[]) ?? DEFAULT_PURPOSES }),
      () => setCfg({ managers: [], purposes: DEFAULT_PURPOSES }),
    );
  }, []);
  if (DATA_MODE === 'local') return { managers: local?.managers ?? [], purposes: local?.purposes ?? DEFAULT_PURPOSES };
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
  const path = `petty/${email}/${Date.now()}-${name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  return { name, url: await getDownloadURL(r), path };
}

export const won = (n?: number) => (n === undefined || Number.isNaN(n) ? '' : `₩${Math.round(n).toLocaleString('ko-KR')}`);
