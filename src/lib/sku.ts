// 제품 정보 (이미지 · 팀 · 대/중/소분류): 서버가 getSkuList 로 받아 skuInfo/{제품코드 앞 4자리} 에 저장해 둔 것
//   마우스를 올린 제품의 묶음 문서만 읽음 (한 번 읽은 건 기억)
import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
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
        : getDoc(doc(db, 'skuInfo', prefix))
            .then((d) => (d.get('items') as Chunk | undefined) ?? {})
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
    void chunkOf(c.slice(0, 4)).then((ch) => alive && setV({ code: c, info: ch[c] ?? null }));
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
        const codes = d.get('codes') as Record<string, boolean> | undefined;
        seasonCache = d.exists() ? new Set(Object.keys(codes ?? {})) : null;
        setSet(seasonCache);
      },
      () => setSet(null),
    );
  }, []);
  return set;
}
/** 제품코드 → 시즌(S) / 비시즌(N) / 모름 */
export const seasonOfCode = (set: Set<string> | null, code?: string): 'S' | 'N' | undefined => (set && code ? (set.has(code.trim()) ? 'S' : 'N') : undefined);

/** 마지막으로 받은 때 · 개수 */
export function useSkuMeta() {
  const [m, setM] = useState<{ at?: string; count?: number; keys?: string[] } | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'skuMeta', 'main'),
      (d) => setM((d.data() as { at?: string; count?: number; keys?: string[] }) ?? {}),
      () => setM({}),
    );
  }, []);
  return m;
}

/** 관리자: 지금 제품 정보 새로 받기 */
export async function syncSkuNow() {
  const r = await httpsCallable(functions, 'syncSkuNow', { timeout: 560000 })({});
  cache.clear();
  return r.data as { count: number; pages: number; done: boolean; nextPage: number | null; stopped: string; keys: string[] };
}

// 로컬 테스트용 예시
function demoChunk(prefix: string): Chunk {
  const out: Chunk = {};
  for (let i = 0; i < 10000; i++) {
    const code = `${prefix}${String(i).padStart(4, '0')}`;
    out[code] = { i: `https://picsum.photos/seed/${code}/300/300`, t: '디자인지제', l: '지제', m: '카드', s: code.endsWith('7') ? '시즌카드' : '일반카드' };
  }
  return out;
}
