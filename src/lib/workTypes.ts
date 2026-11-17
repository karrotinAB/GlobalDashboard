// 무역사무 '작업유형' 목록: 무역사무(·관리자)가 설정에서 넣고 고치고 지움
//   tradeCfg/workTypes: { list: string[] }  — 없으면 기본 목록
import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { WORK_TYPES } from '../types';

const LS = 'gd:workTypes';
const DEF = [...WORK_TYPES] as string[];
const readLocal = (): string[] | null => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? 'null');
  } catch {
    return null;
  }
};

export function useWorkTypes(): string[] {
  const [list, setList] = useState<string[]>(() => (DATA_MODE === 'local' ? readLocal() ?? DEF : DEF));
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal() ?? DEF);
      window.addEventListener('gd-worktypes', load);
      return () => window.removeEventListener('gd-worktypes', load);
    }
    return onSnapshot(
      doc(db, 'tradeCfg', 'workTypes'),
      (d) => setList((d.data()?.list as string[] | undefined)?.length ? (d.data()!.list as string[]) : DEF),
      () => setList(DEF),
    );
  }, []);
  return list;
}

export async function saveWorkTypes(list: string[]) {
  const clean = [...new Set(list.map((x) => x.trim()).filter(Boolean))];
  if (DATA_MODE === 'local') {
    localStorage.setItem(LS, JSON.stringify(clean));
    window.dispatchEvent(new Event('gd-worktypes'));
    return;
  }
  await setDoc(doc(db, 'tradeCfg', 'workTypes'), { list: clean });
}
