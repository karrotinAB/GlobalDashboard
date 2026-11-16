// 무역사무 '업체 메모': 업체마다 체크박스 메모 (무역사무가 씀) + 각 조 업체 메모(주간 할일)는 읽기만
//   tradeMemos/{조_업체id}: { items: MemoItem[], updatedAt }
//   tradeMemos/_order: { keys: string[] }  (홈에 먼저 보일 업체 순서)
import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface MemoItem {
  id: string;
  text: string;
  done?: boolean;
  by?: string;
  at: string;
  doneAt?: string;
}
export interface CoMemo {
  key: string; // 조_업체id
  items: MemoItem[];
  updatedAt?: string;
}
export const coKey = (team: string, companyId: string) => `${team}_${companyId}`;

const LS = 'gd:tradeMemos';
const readLocal = (): Record<string, CoMemo | { keys: string[] }> => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '{}');
  } catch {
    return {};
  }
};
const writeLocal = (v: Record<string, unknown>) => {
  try {
    localStorage.setItem(LS, JSON.stringify(v));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-trade-memos'));
};

export function useTradeMemos() {
  const [memos, setMemos] = useState<Record<string, CoMemo>>({});
  const [order, setOrder] = useState<string[]>([]);
  useEffect(() => {
    const apply = (all: Record<string, unknown>) => {
      const m: Record<string, CoMemo> = {};
      for (const [k, v] of Object.entries(all)) if (k !== '_order') m[k] = { ...(v as CoMemo), key: k };
      setMemos(m);
      setOrder(((all._order as { keys?: string[] } | undefined)?.keys ?? []) as string[]);
    };
    if (DATA_MODE === 'local') {
      const load = () => apply(readLocal());
      load();
      window.addEventListener('gd-trade-memos', load);
      return () => window.removeEventListener('gd-trade-memos', load);
    }
    return onSnapshot(
      collection(db, 'tradeMemos'),
      (snap) => apply(Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))),
      () => apply({}),
    );
  }, []);
  return { memos, order };
}

export async function saveCoMemo(key: string, items: MemoItem[]) {
  const v = JSON.parse(JSON.stringify({ items, updatedAt: new Date().toISOString() }));
  if (DATA_MODE === 'local') return writeLocal({ ...readLocal(), [key]: v });
  await setDoc(doc(db, 'tradeMemos', key), v);
}

export async function saveMemoOrder(keys: string[]) {
  if (DATA_MODE === 'local') return writeLocal({ ...readLocal(), _order: { keys } });
  await setDoc(doc(db, 'tradeMemos', '_order'), { keys });
}
