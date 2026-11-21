// 제품 정보 (이미지 · 팀 · 대/중/소분류): 서버가 getSkuList 로 받아 skuInfo/{제품코드 앞 4자리} 에 저장해 둔 것
//   마우스를 올린 제품의 묶음 문서만 읽음 (한 번 읽은 건 기억)
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface SkuInfo {
  i?: string; // imageUrl
  t?: string; // teamName
  l?: string; // largeName
  m?: string; // middleName
  s?: string; // smallName
}
type Chunk = Record<string, SkuInfo>;
const cache = new Map<string, Promise<Chunk>>();

const normCode = (code: string) => code.trim();
function chunkOf(prefix: string): Promise<Chunk> {
  if (!cache.has(prefix)) {
    cache.set(
      prefix,
      DATA_MODE === 'local'
        ? Promise.resolve(demoChunk(prefix))
        : // 새 묶음 (앞 5자리) + 예전 묶음 (앞 4자리) 둘 다 읽어서 합침
          Promise.all([getDoc(doc(db, 'skuInfo', prefix)), getDoc(doc(db, 'skuInfo', prefix.slice(0, 4)))])
            .then((ds) => Object.assign({}, ...ds.reverse().map((d) => (typeof d.get('data') === 'string' ? (JSON.parse(d.get('data') as string) as Chunk) : ((d.get('items') as Chunk | undefined) ?? {})))) as Chunk)
            .catch(() => {
              cache.delete(prefix);
              return {};
            }),
    );
  }
  return cache.get(prefix)!;
}

/** 제품코드 하나의 정보 (undefined = 읽는 중, null = 없음) */
export function useSku(code: string | null): SkuInfo | null | undefined {
  const [v, setV] = useState<{ code: string; info: SkuInfo | null } | null>(null);
  useEffect(() => {
    if (!code) return;
    const c = normCode(code);
    let alive = true;
    void chunkOf(c.slice(0, 5)).then((ch) => alive && setV({ code: c, info: ch[c] ?? null }));
    return () => {
      alive = false;
    };
  }, [code]);
  if (!code) return null;
  return v && v.code === normCode(code) ? v.info : undefined;
}

/** 시즌품 제품코드 (제품 정보의 팀 · 대/중/소분류에 '시즌' — '비시즌' 은 빼고). null = 아직 못 받음 */
let seasonCache: Set<string> | null = null;
export function useSkuSeason(): Set<string> | null {
  const [set, setSet] = useState<Set<string> | null>(seasonCache);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      // 로컬 테스트: 코드 끝자리가 7 이면 시즌품
      setSet({ has: (c: string) => c.endsWith('7') } as unknown as Set<string>);
      return;
    }
    return onSnapshot(
      doc(db, 'skuSeason', 'main'),
      (d) => {
        const raw = d.get('data');
        const list: string[] = typeof raw === 'string' ? (JSON.parse(raw) as string[]) : Object.keys((d.get('codes') as Record<string, boolean> | undefined) ?? {});
        seasonCache = d.exists() ? new Set(list) : null;
        setSet(seasonCache);
      },
      () => setSet(null),
    );
  }, []);
  return set;
}
/** 제품코드 → 'SKU 대분류›중분류›소분류' (skuPath 문서들 · 수출 분류 추천에 참고). null = 아직 못 받음 */
let pathCache: Map<string, string> | null = null;
export function useSkuPaths(): Map<string, string> | null {
  const [m, setM] = useState<Map<string, string> | null>(pathCache);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      // 로컬 테스트: 코드 앞 2자리로 예시 분류
      const fake = new Map<string, string>();
      setM({ get: (c: string) => (fake.get(c) ?? `분류${c.slice(0, 2)}›중${c.slice(2, 3)}›소${c.slice(3, 4)}`), size: 1 } as unknown as Map<string, string>);
      return;
    }
    return onSnapshot(
      collection(db, 'skuPath'),
      (snap) => {
        const out = new Map<string, string>();
        snap.docs.forEach((d) => {
          const raw = d.get('data');
          const v = typeof raw === 'string' ? JSON.parse(raw) : d.get('codes') ?? {};
          // 새 모양 { p: [분류들], c: { 코드: 번호 } } · 예전 모양 { 코드: 분류 }
          const codes: Record<string, string> = v && Array.isArray(v.p) && v.c ? Object.fromEntries(Object.entries(v.c as Record<string, number>).map(([k, i]) => [k, (v.p as string[])[i]])) : v;
          Object.entries(codes).forEach(([c, p]) => out.set(c, p));
        });
        pathCache = out.size ? out : null;
        setM(pathCache);
      },
      () => setM(null),
    );
  }, []);
  return m;
}

/** 제품코드 → 시즌(S) / 비시즌(N) / 모름 */
export const seasonOfCode = (set: Set<string> | null, code?: string): 'S' | 'N' | undefined => (set && code ? (set.has(code.trim()) ? 'S' : 'N') : undefined);

/** 마지막으로 받은 때 · 개수 */
export type SkuMeta = { at?: string; count?: number; keys?: string[]; noCat?: number; noCatSamples?: { code: string; category: string }[]; resumePage?: number; partialCount?: number; triedAt?: string; stopped?: string; nightAt?: string; nightError?: string; apiTotal?: { count?: number; pages?: number } | null };
export function useSkuMeta() {
  const [m, setM] = useState<SkuMeta | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'skuMeta', 'main'),
      (d) => setM((d.data() as SkuMeta) ?? {}),
      () => setM({}),
    );
  }, []);
  return m;
}

/** 관리자: 지금 제품 정보 새로 받기 */
export async function syncSkuNow(restart = false, all = false) {
  const r = await httpsCallable(functions, 'syncSkuNow', { timeout: 560000 })({ restart, all });
  cache.clear();
  return r.data as { count: number; pages: number; done: boolean; nextPage: number | null; stopped: string; keys: string[]; noCat?: number; noCatSamples?: { code: string; category: string }[] };
}

/** 엑셀에서 정보가 없는 제품코드만 서버가 하나씩 찾아옴 (한 번 찾아본 건 다시 안 물음) */
export type LookupResult = { asked: number; found: number; none: number; left: number; stopped?: string; unsupported?: boolean };
export async function lookupSkus(codes: string[]): Promise<LookupResult> {
  if (DATA_MODE === 'local') return { asked: codes.length, found: 0, none: codes.length, left: 0 };
  const r = await httpsCallable(functions, 'lookupSku', { timeout: 310000 })({ codes });
  cache.clear();
  return r.data as LookupResult;
}

// 로컬 테스트용 예시
function demoChunk(prefix: string): Chunk {
  const out: Chunk = {};
  const n = Math.max(0, 8 - prefix.length);
  for (let i = 0; i < 10 ** n; i++) {
    const code = `${prefix}${String(i).padStart(n, '0')}`;
    out[code] = { i: `https://picsum.photos/seed/${code}/300/300`, t: '디자인지제', l: '지제', m: '카드', s: code.endsWith('7') ? '시즌카드' : '일반카드' };
  }
  return out;
}
