import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionName, Collections, Item } from '../types';
import { createFirestoreBackend, createLocalBackend, emptyCollections, TRADE_COLLECTIONS, type Backend } from './backend';
import { useAccess } from '../components/AuthGate';
import { seedData } from './seed';
import { db } from '../firebase';

/** VITE_DATA_MODE=local 이면 브라우저에만 저장 (혼자 테스트용). 기본은 Firestore 팀 공유 */
export const DATA_MODE: Backend['mode'] = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'firestore';
const backend: Backend = DATA_MODE === 'local' ? createLocalBackend(seedData) : createFirestoreBackend(db);

interface StoreValue {
  data: Collections;
  mode: Backend['mode'];
  loading: boolean;
  error: string | null;
  save<C extends CollectionName>(col: C, item: Item<C>): void;
  saveMany<C extends CollectionName>(col: C, items: Item<C>[]): Promise<void>;
  remove(col: CollectionName, id: string): void;
  reload(): Promise<void>;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { role } = useAccess();
  if (role === 'trade') backend.scope(TRADE_COLLECTIONS); // 무역사무: 읽을 수 있는 것만
  const [data, setData] = useState<Collections>(emptyCollections);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(0); // 저장 중에는 실시간 새로고침으로 덮어쓰지 않도록

  const reload = useCallback(async () => {
    try {
      const d = await backend.load();
      if (pending.current === 0) setData(d);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    return backend.subscribe((patch) => {
      // Firestore: 바뀐 컬렉션만 교체 (내 저장도 바로 반영됨) / 로컬: 다시 읽기
      if (patch) setData((prev) => ({ ...prev, ...patch }));
      else reload();
    });
  }, [reload]);

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      pending.current++;
      try {
        await fn();
        setError(null);
      } catch (e) {
        setError(`저장 실패: ${(e as Error).message}`);
        pending.current--;
        await reload();
        return;
      }
      pending.current--;
    },
    [reload],
  );

  const save = useCallback(
    <C extends CollectionName>(col: C, item: Item<C>) => {
      setData((prev) => {
        const list = prev[col] as Item<C>[];
        const idx = list.findIndex((x) => x.id === item.id);
        const next = idx >= 0 ? list.map((x, i) => (i === idx ? item : x)) : [...list, item];
        return { ...prev, [col]: next };
      });
      run(() => backend.upsert(col, item));
    },
    [run],
  );

  const saveMany = useCallback(
    async <C extends CollectionName>(col: C, items: Item<C>[]) => {
      setData((prev) => {
        const map = new Map((prev[col] as Item<C>[]).map((x) => [x.id, x]));
        for (const it of items) map.set(it.id, it);
        return { ...prev, [col]: [...map.values()] };
      });
      await run(() => backend.upsertMany(col, items));
    },
    [run],
  );

  const remove = useCallback(
    (col: CollectionName, id: string) => {
      setData((prev) => ({ ...prev, [col]: (prev[col] as { id: string }[]).filter((x) => x.id !== id) }));
      run(() => backend.remove(col, id));
    },
    [run],
  );

  const value = useMemo<StoreValue>(
    () => ({ data, mode: backend.mode, loading, error, save, saveMany, remove, reload }),
    [data, loading, error, save, saveMany, remove, reload],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(StoreContext);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}

/** 자주 쓰는 조회 헬퍼 */
export function useLookups() {
  const { data } = useStore();
  return useMemo(() => {
    const members = [...data.members].sort((a, b) => a.order - b.order);
    const companies = [...data.companies].sort((a, b) => a.order - b.order);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const companyById = new Map(companies.map((c) => [c.id, c]));
    return { members, companies, memberById, companyById };
  }, [data.members, data.companies]);
}
