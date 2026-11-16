// 보고방: 각 조원이 쓰는 보고 → 그 조 · 팀장님 · 이사님이 봄. 팀장님·이사님은 확인 체크 + 답변
//   reports/{id}: { team, title, body, authorEmail, authorName, createdAt, checks: { lead?, director? }, replies: [] }
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export type CheckRole = 'lead' | 'director';
export interface ReportCheck {
  by: string; // 이름
  email?: string;
  at: string; // ISO
}
export interface ReportReply {
  id: string;
  name: string;
  email?: string;
  role?: string; // 'lead' | 'director' | 'member' | 'admin'
  text: string;
  at: string;
}
export interface Report {
  id: string;
  team: string; // '1' | '2' | '3'
  title: string;
  body: string;
  authorEmail?: string;
  authorName?: string;
  createdAt: string;
  updatedAt?: string;
  checks?: Partial<Record<CheckRole, ReportCheck>>;
  replies?: ReportReply[];
}

export const CHECK_LABEL: Record<CheckRole, string> = { lead: '팀장님', director: '이사님' };
export const isLeaderRole = (r?: string | null): r is CheckRole => r === 'lead' || r === 'director';

const LOCAL_KEY = 'gd:reports';
const readLocal = (): Report[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]') as Report[];
  } catch {
    return [];
  }
};
const writeLocal = (list: Report[]) => {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-reports'));
};

/** 보고 목록. team 을 주면 그 조만 (조원은 자기 조만 읽을 수 있음), null 이면 모든 조 (팀장님·이사님·관리자) */
export function useReports(team: string | null | undefined) {
  const [list, setList] = useState<Report[] | null>(null);
  useEffect(() => {
    if (team === undefined) return setList([]); // 안 불러옴
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal().filter((r) => !team || r.team === team));
      load();
      window.addEventListener('gd-reports', load);
      return () => window.removeEventListener('gd-reports', load);
    }
    setList(null);
    const q = team ? query(collection(db, 'reports'), where('team', '==', team)) : collection(db, 'reports');
    return onSnapshot(
      q,
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<Report, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [team]);
  return list ? [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : null;
}

/** 저장 (통째로) */
export async function saveReport(r: Report) {
  const clean = JSON.parse(JSON.stringify(r)) as Report; // undefined 빼기
  if (DATA_MODE === 'local') {
    const list = readLocal().filter((x) => x.id !== r.id);
    writeLocal([...list, clean]);
    return;
  }
  const { id, ...rest } = clean;
  await setDoc(doc(db, 'reports', id), rest);
}

export async function deleteReport(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((x) => x.id !== id));
  await deleteDoc(doc(db, 'reports', id));
}

/** 이 보고에 내가 아직 안 본 팀장님·이사님 답변이 있나 (조원 쪽 알림) */
const seenKey = (id: string) => `gd:reportSeen:${id}`;
export const lastLeaderReply = (r: Report) =>
  (r.replies ?? [])
    .filter((x) => isLeaderRole(x.role))
    .map((x) => x.at)
    .sort()
    .pop();
export function isUnseen(r: Report) {
  const last = lastLeaderReply(r);
  if (!last) return false;
  try {
    return (localStorage.getItem(seenKey(r.id)) ?? '') < last;
  } catch {
    return false;
  }
}
export function markSeen(r: Report) {
  try {
    localStorage.setItem(seenKey(r.id), new Date().toISOString());
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-reports-seen'));
}

/** 탭 위 빨간 점: 내 조 보고 중 안 본 팀장님·이사님 답변이 있으면 */
export function useReportAlert(team: string | null, enabled: boolean) {
  const list = useReports(enabled ? team : undefined);
  const [, bump] = useState(0);
  useEffect(() => {
    const h = () => bump((x) => x + 1);
    window.addEventListener('gd-reports-seen', h);
    return () => window.removeEventListener('gd-reports-seen', h);
  }, []);
  return enabled && !!list?.some(isUnseen);
}

/** 보고 하나의 확인 체크 켜기/끄기 (주간 할일의 '보고 확인하기' 체크에서) */
export async function setReportCheck(id: string, k: CheckRole, on: boolean, by: string, email?: string) {
  if (DATA_MODE === 'local') {
    const list = readLocal();
    const r = list.find((x) => x.id === id);
    if (!r) return;
    const checks = { ...(r.checks ?? {}) };
    if (on) checks[k] = { by, email, at: new Date().toISOString() };
    else delete checks[k];
    writeLocal(list.map((x) => (x.id === id ? { ...x, checks } : x)));
    return;
  }
  const { updateDoc, deleteField } = await import('firebase/firestore');
  await updateDoc(doc(db, 'reports', id), { [`checks.${k}`]: on ? JSON.parse(JSON.stringify({ by, email, at: new Date().toISOString() })) : deleteField() });
}
