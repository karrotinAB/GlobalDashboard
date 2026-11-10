import { collection, deleteDoc, doc, onSnapshot, setDoc, writeBatch, type Firestore } from 'firebase/firestore';
import type { CollectionName, Collections } from '../types';

export const COLLECTIONS: CollectionName[] = ['members', 'companies', 'tasks', 'orders', 'attendance', 'config'];

export function emptyCollections(): Collections {
  return { members: [], companies: [], tasks: [], orders: [], attendance: [], config: [] };
}

export interface Backend {
  mode: 'local' | 'firestore';
  load(): Promise<Collections>;
  upsert(col: CollectionName, item: { id: string }): Promise<void>;
  upsertMany(col: CollectionName, items: { id: string }[]): Promise<void>;
  remove(col: CollectionName, id: string): Promise<void>;
  /** 다른 사람/탭에서 데이터가 바뀌면 콜백 호출 (patch 가 있으면 그 컬렉션만 교체, 없으면 전체 다시 읽기). 해제 함수 반환 */
  subscribe(onChange: (patch?: Partial<Collections>) => void): () => void;
}

/* ------------------------------------------------------------------ */
/* 로컬 모드: 브라우저 localStorage (혼자 테스트용, 팀 공유 안 됨)       */
/* ------------------------------------------------------------------ */
const LS_KEY = 'global-dashboard:v3';

function readLS(): Collections | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? { ...emptyCollections(), ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

function writeLS(data: Collections) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch {
    /* 저장 실패 무시 (사생활 보호 모드 등) */
  }
}

export function createLocalBackend(seed: () => Collections): Backend {
  const get = () => readLS() ?? emptyCollections();
  return {
    mode: 'local',
    async load() {
      const existing = readLS();
      if (existing) return existing;
      const s = seed();
      writeLS(s);
      return s;
    },
    async upsert(col, item) {
      const data = get();
      const list = data[col] as { id: string }[];
      const idx = list.findIndex((x) => x.id === item.id);
      if (idx >= 0) list[idx] = item;
      else list.push(item);
      writeLS(data);
    },
    async upsertMany(col, items) {
      const data = get();
      const list = data[col] as { id: string }[];
      for (const item of items) {
        const idx = list.findIndex((x) => x.id === item.id);
        if (idx >= 0) list[idx] = item;
        else list.push(item);
      }
      writeLS(data);
    },
    async remove(col, id) {
      const data = get();
      (data[col] as { id: string }[]) = (data[col] as { id: string }[]).filter((x) => x.id !== id);
      writeLS(data);
    },
    subscribe(onChange) {
      const handler = (e: StorageEvent) => {
        if (e.key === LS_KEY) onChange();
      };
      window.addEventListener('storage', handler);
      return () => window.removeEventListener('storage', handler);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Firestore 모드: 팀원 모두가 같은 데이터를 실시간으로 공유             */
/* 컬렉션 = members / companies / tasks / orders / attendance, 문서 ID = 항목 id */
/* ------------------------------------------------------------------ */
export function createFirestoreBackend(db: Firestore): Backend {
  const latest = emptyCollections();
  const seen = new Set<CollectionName>();
  const listeners = new Set<(patch?: Partial<Collections>) => void>();
  let unsubs: (() => void)[] = [];
  let ready: Promise<Collections> | null = null;

  // 컬렉션마다 실시간 구독 1개. 처음 받은 결과로 load() 를 끝내고, 이후 변경은 patch 로 전달
  const start = () =>
    new Promise<Collections>((resolve, reject) => {
      unsubs = COLLECTIONS.map((col) =>
        onSnapshot(
          collection(db, col),
          (snap) => {
            (latest[col] as unknown[]) = snap.docs.map((d) => ({ ...d.data(), id: d.id }));
            seen.add(col);
            if (seen.size === COLLECTIONS.length) resolve(latest);
            listeners.forEach((fn) => fn({ [col]: latest[col] }));
          },
          (err) => {
            // 공용 설정(config)은 보안 규칙이 아직 안 바뀌었어도 대시보드는 열리게: 빈 설정으로 계속
            if (col === 'config') {
              seen.add(col);
              if (seen.size === COLLECTIONS.length) resolve(latest);
              return;
            }
            reject(new Error(`${col}: ${err.message}`));
          },
        ),
      );
    });

  return {
    mode: 'firestore',
    load() {
      if (!ready) ready = start();
      return ready.then((d) => ({ ...d }));
    },
    async upsert(col, item) {
      await setDoc(doc(db, col, item.id), item);
    },
    async upsertMany(col, items) {
      for (let i = 0; i < items.length; i += 400) {
        const batch = writeBatch(db);
        for (const item of items.slice(i, i + 400)) batch.set(doc(db, col, item.id), item);
        await batch.commit();
      }
    },
    async remove(col, id) {
      await deleteDoc(doc(db, col, id));
    },
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
        if (!listeners.size) {
          unsubs.forEach((u) => u());
          unsubs = [];
          ready = null;
          seen.clear();
        }
      };
    },
  };
}
