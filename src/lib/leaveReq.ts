// 휴일 및 주말 대체휴가 신청서: leaveReqs/{id} = { email, dept, empNo, rank, name, workDate, start, end, hours, reason, applyDate, … }
//   본인 것만 보고 고침 (관리자는 모두) — 규칙은 출장신청서와 같음
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface LeaveDay {
  date?: string;
  start?: string;
  end?: string;
}
export interface LeaveReq {
  id: string;
  email: string;
  dept?: string; // 부서명
  empNo?: string; // 사번
  rank?: string; // 직급
  name?: string; // 성명
  workDate?: string; // 근무일자 YYYY-MM-DD
  start?: string; // 근무 시작 HH:MM
  end?: string; // 근무 끝 HH:MM
  moreDays?: LeaveDay[]; // 근무한 날이 며칠이면 둘째 날부터 (여러 주말 등)
  hours?: string; // 대체휴가 인정시간 (직접 고칠 수 있음)
  reason?: string; // 근무사유
  applyDate?: string; // 신청일
  createdAt: string;
  updatedAt?: string;
}

const LS = 'gd:leaveReqs';
const readLocal = (): LeaveReq[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '[]') as LeaveReq[];
  } catch {
    return [];
  }
};
const writeLocal = (l: LeaveReq[]) => {
  localStorage.setItem(LS, JSON.stringify(l));
  window.dispatchEvent(new Event('gd-leave'));
};

export function useLeaveReqs(email: string): LeaveReq[] | null {
  const [list, setList] = useState<LeaveReq[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal().filter((x) => x.email === email));
      load();
      window.addEventListener('gd-leave', load);
      return () => window.removeEventListener('gd-leave', load);
    }
    if (!email) return;
    return onSnapshot(
      query(collection(db, 'leaveReqs'), where('email', '==', email)),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<LeaveReq, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [email]);
  return list ? [...list].sort((a, b) => (b.workDate ?? b.createdAt).localeCompare(a.workDate ?? a.createdAt)) : null;
}
export async function saveLeaveReq(r: LeaveReq) {
  const clean = JSON.parse(JSON.stringify({ ...r, updatedAt: new Date().toISOString() })) as LeaveReq;
  if (DATA_MODE === 'local') return writeLocal([...readLocal().filter((x) => x.id !== r.id), clean]);
  const { id, ...rest } = clean;
  await setDoc(doc(db, 'leaveReqs', id), rest);
}
export async function deleteLeaveReq(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((x) => x.id !== id));
  await deleteDoc(doc(db, 'leaveReqs', id));
}

/** 근무시간 → 인정시간 (시간 단위, 0.5 단위까지) */
export function hoursBetween(start?: string, end?: string): string {
  if (!start || !end) return '';
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  let m = toMin(end) - toMin(start);
  if (m <= 0) m += 24 * 60;
  const h = Math.round((m / 60) * 2) / 2;
  return String(h);
}

/** 근무한 날 전부 (첫날 = workDate · start · end) */
export const leaveDays = (r: Pick<LeaveReq, 'workDate' | 'start' | 'end' | 'moreDays'>): LeaveDay[] => [{ date: r.workDate, start: r.start, end: r.end }, ...(r.moreDays ?? [])];
/** 인정시간 자동: 날마다 근무시간 합 */
export function totalHours(r: Pick<LeaveReq, 'workDate' | 'start' | 'end' | 'moreDays'>): string {
  const hs = leaveDays(r).map((d) => hoursBetween(d.start, d.end)).filter(Boolean);
  return hs.length ? String(hs.reduce((a, h) => a + Number(h), 0)) : '';
}
