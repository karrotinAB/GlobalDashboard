import { collection, deleteDoc, doc, onSnapshot, query, setDoc, where, writeBatch, type Firestore } from 'firebase/firestore';
import type { CollectionName, Collections } from '../types';
import { DEFAULT_TEAM, isPersonal, physName, TEAMS } from '../lib/team';

export const COLLECTIONS: CollectionName[] = ['members', 'companies', 'tasks', 'orders', 'attendance', 'config', 'claims', 'requests', 'tradeMembers', 'memDirectory', 'memAttendance'];
// 보안 규칙이 아직 안 바뀌어도 대시보드는 열리게: 이 컬렉션들은 못 읽으면 빈 채로 계속
const OPTIONAL: CollectionName[] = ['config', 'claims', 'requests', 'tradeMembers', 'memDirectory', 'memAttendance'];
/** 무역사무 계정이 읽는 컬렉션 (나머지는 보안 규칙상 못 읽음) */
export const TRADE_COLLECTIONS: CollectionName[] = ['members', 'requests', 'tradeMembers', 'attendance', 'memDirectory', 'memAttendance'];

export function emptyCollections(): Collections {
  return { members: [], companies: [], tasks: [], orders: [], attendance: [], config: [], claims: [], requests: [], tradeMembers: [], memDirectory: [], memAttendance: [] };
}

export interface Backend {
  mode: 'local' | 'firestore';
  load(): Promise<Collections>;
  upsert(col: CollectionName, item: { id: string }): Promise<void>;
  upsertMany(col: CollectionName, items: { id: string }[]): Promise<void>;
  remove(col: CollectionName, id: string): Promise<void>;
  /** 다른 사람/탭에서 데이터가 바뀌면 콜백 호출 (patch 가 있으면 그 컬렉션만 교체, 없으면 전체 다시 읽기). 해제 함수 반환 */
  subscribe(onChange: (patch?: Partial<Collections>) => void): () => void;
  /** 어느 조 데이터를 쓸지 + 무역사무 계정인지. load() 전에 부름 */
  configure(opts: { team: string; trade: boolean }): void;
}

/* ------------------------------------------------------------------ */
/* 로컬 모드: 브라우저 localStorage (혼자 테스트용, 팀 공유 안 됨)       */
/* ------------------------------------------------------------------ */
const LS_BASE = 'global-dashboard:v3';
let LS_KEY = LS_BASE; // 2조 = 원래 키, 다른 조 = 'global-dashboard:v3:t1' …

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
      const s = LS_KEY === LS_BASE ? seed() : emptyCollections(); // 기본 담당자는 2조에만
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
    configure({ team }) {
      LS_KEY = team === DEFAULT_TEAM ? LS_BASE : `${LS_BASE}:t${team}`;
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
  let active: CollectionName[] = COLLECTIONS;
  let team = DEFAULT_TEAM;
  let trade = false;
  const phys = (col: CollectionName) => physName(col, team);
  /** 읽을 실제 컬렉션: 무역사무는 모든 조의 담당자(요청자 이름)를 같이 읽음 */
  const sources = (col: CollectionName): { path: string; tag?: string }[] =>
    trade && col === 'members'
      ? TEAMS.map((t) => ({ path: physName('members', t), tag: t }))
      : // 팀장님·이사님 개인 대시보드: 1~3조 업체(매장코드 있는 것)도 같이 보여줌 (읽기만, 저장은 내 공간에)
        isPersonal(team) && col === 'companies'
        ? [{ path: phys(col) }, ...TEAMS.map((t) => ({ path: physName('companies', t), tag: t }))]
        : [{ path: phys(col) }];

  // 컬렉션마다 실시간 구독 1개. 처음 받은 결과로 load() 를 끝내고, 이후 변경은 patch 로 전달
  const start = () =>
    new Promise<Collections>((resolve, reject) => {
      const done = () => {
        if (seen.size === active.length) resolve(latest);
      };
      unsubs = active.flatMap((col) => {
        const srcs = sources(col);
        const parts = new Map<string, unknown[]>(); // 여러 곳에서 읽으면 합침
        const got = new Set<string>();
        return srcs.map((src) =>
          onSnapshot(
            col === 'memAttendance'
              ? query(collection(db, src.path), where('date', '>=', new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10))) // 최근 7일만
              : collection(db, src.path),
            (snap) => {
              parts.set(src.path, snap.docs.map((d) => ({ ...d.data(), id: d.id, ...(src.tag ? { team: src.tag } : {}) })));
              got.add(src.path);
              (latest[col] as unknown[]) =
                col === 'companies' && srcs.length > 1
                  ? mergeMirrored(srcs.map((x) => (parts.get(x.path) ?? []) as { id: string; team?: string; storeCodes?: string[] }[]))
                  : srcs.flatMap((x) => parts.get(x.path) ?? []);
              if (got.size === srcs.length) seen.add(col);
              done();
              listeners.forEach((fn) => fn({ [col]: latest[col] }));
            },
            (err) => {
              // 못 읽어도 되는 것(설정·클레임·다른 조 담당자 …)은 빈 채로 계속
              if (OPTIONAL.includes(col) || srcs.length > 1) {
                got.add(src.path);
                if (got.size === srcs.length) seen.add(col);
                done();
                return;
              }
              reject(new Error(`${src.path}: ${err.message}`));
            },
          ),
        );
      });
    });

  return {
    mode: 'firestore',
    load() {
      if (!ready) ready = start();
      return ready.then((d) => ({ ...d }));
    },
    async upsert(col, item) {
      await setDoc(doc(db, phys(col), item.id), item);
    },
    async upsertMany(col, items) {
      for (let i = 0; i < items.length; i += 400) {
        const batch = writeBatch(db);
        for (const item of items.slice(i, i + 400)) batch.set(doc(db, phys(col), item.id), item);
        await batch.commit();
      }
    },
    async remove(col, id) {
      await deleteDoc(doc(db, phys(col), id));
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
    configure(opts) {
      team = opts.team;
      trade = opts.trade;
      active = trade ? TRADE_COLLECTIONS : COLLECTIONS;
    },
  };
}

/** 내 업체 + 조 업체(매장코드 있는 것만). 같은 id 면 내 것이 이김 (조 업체 순서·메모를 바꾸면 내 공간에 복사됨) */
function mergeMirrored(parts: { id: string; team?: string; storeCodes?: string[] }[][]) {
  const [own, ...teams] = parts;
  const ids = new Set(own.map((c) => c.id));
  return [...own, ...teams.flat().filter((c) => c.storeCodes?.length && !ids.has(c.id))];
}
