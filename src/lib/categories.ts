// 수출 분류표 (대분류 · 중분류) + 고른 기록 → 비슷한 제품 추천
//   transCfg/categories: { rows: Cat[], at, by }   (분류 탭에서 엑셀로 올림)
//   catPicks/{제품명}: { ko, cat: '대분류코드-중분류코드', at, by }   (번역 탭에서 고를 때마다)
import { useEffect, useState } from 'react';
import { collection, doc, getDocs, onSnapshot, setDoc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { dictId } from './dict';

export interface Cat {
  mainCode: string;
  mainName: string;
  mainEn: string;
  subCode: string;
  subName: string;
  subEn: string;
}
export const catKey = (c: Pick<Cat, 'mainCode' | 'subCode'>) => `${c.mainCode}-${c.subCode}`;
export const catLabel = (c: Cat) => `${c.mainName} › ${c.subName}`;

export interface CatPick {
  id: string;
  ko: string;
  cat: string;
  at?: string;
  by?: string;
  season?: 'S' | 'N'; // 시즌품 / 비시즌품 (엑셀 '시즌품구분')
  pre?: string; // 제품코드 앞 2자리
}

const lsGet = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d;
  } catch {
    return d;
  }
};
const lsSet = (k: string, v: unknown, ev: string) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(ev));
};

export function useCategories() {
  const [rows, setRows] = useState<Cat[] | null>(null);
  const [meta, setMeta] = useState<{ at?: string; by?: string }>({});
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setRows(lsGet<Cat[]>('gd:cats', []));
      load();
      window.addEventListener('gd-cats', load);
      return () => window.removeEventListener('gd-cats', load);
    }
    return onSnapshot(
      doc(db, 'transCfg', 'categories'),
      (d) => {
        setRows((d.data()?.rows as Cat[]) ?? []);
        setMeta({ at: d.data()?.at, by: d.data()?.by });
      },
      () => setRows([]),
    );
  }, []);
  return { rows, meta };
}

export async function saveCategories(rows: Cat[], by?: string) {
  if (DATA_MODE === 'local') return lsSet('gd:cats', rows, 'gd-cats');
  await setDoc(doc(db, 'transCfg', 'categories'), { rows, at: new Date().toISOString(), ...(by ? { by } : {}) });
}

export function useCatPicks() {
  const [list, setList] = useState<CatPick[]>([]);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setList(lsGet<CatPick[]>('gd:catPicks', []));
      load();
      window.addEventListener('gd-catpicks', load);
      return () => window.removeEventListener('gd-catpicks', load);
    }
    return onSnapshot(
      collection(db, 'catPicks'),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<CatPick, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, []);
  return list;
}

/** 고른 분류 기록 (같은 제품명은 마지막에 고른 걸로) */
export async function savePicks(picks: { ko: string; cat: string; season?: 'S' | 'N'; pre?: string }[], by?: string) {
  const at = new Date().toISOString();
  const clean = picks.filter((p) => p.ko.trim() && p.cat);
  if (DATA_MODE === 'local') {
    const m = new Map(lsGet<CatPick[]>('gd:catPicks', []).map((p) => [p.id, p]));
    for (const p of clean) m.set(dictId(p.ko), { id: dictId(p.ko), ko: p.ko.trim(), cat: p.cat, at, by, ...(p.season ? { season: p.season } : {}), ...(p.pre ? { pre: p.pre } : {}) });
    return lsSet('gd:catPicks', [...m.values()], 'gd-catpicks');
  }
  await Promise.all(clean.map((p) => setDoc(doc(db, 'catPicks', dictId(p.ko)), { ko: p.ko.trim(), cat: p.cat, at, ...(by ? { by } : {}), ...(p.season ? { season: p.season } : {}), ...(p.pre ? { pre: p.pre } : {}) })));
}

// ---------- 비슷한 제품 찾기 ----------
// 제품명을 글자 2개씩 묶음(한글) + 단어(영문·숫자 빼고)로 나눠서 겹치는 정도로 비교
const gramsOf = (name: string) => {
  const s = new Set<string>();
  const words = name
    .toLowerCase()
    .replace(/[0-9]+(\.[0-9]+)?\s*(mm|cm|ml|g|kg|매|개|종|p|ea|입)?/g, ' ') // 숫자·규격은 빼고
    .split(/[\s()[\]{}/,+·_\-|.]+/)
    .filter(Boolean);
  for (const w of words) {
    if (/[가-힣]/.test(w)) {
      s.add(`w:${w}`);
      for (let i = 0; i < w.length - 1; i++) s.add(w.slice(i, i + 2));
      if (w.length === 1) s.add(w);
    } else if (w.length > 1) s.add(`w:${w}`);
  }
  return s;
};
const sim = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.min(a.size, b.size) * (2 * n / (a.size + b.size)) ** 0.5; // 겹침 비율 (짧은 쪽 기준) × 전체 닮음
};

export interface Suggestion {
  cat: string;
  score: number; // 0 ~ 1
  like: string; // 가장 비슷한 제품명
  exact: boolean; // 같은 제품명으로 고른 적 있음
}

/** 예시들(고른 기록 + 이 파일에서 이미 분류가 채워진 줄)로 이 제품의 분류를 추천 */
export function makeRecommender(examples: { ko: string; cat: string; season?: 'S' | 'N'; pre?: string }[]) {
  // 같은 제품명은 하나로 (마지막 것)
  const uniq = new Map(examples.filter((e) => e.ko && e.cat).map((e) => [e.ko.trim(), e]));
  const ex = [...uniq.entries()].map(([k, e]) => ({ k, cat: e.cat, season: e.season, pre: e.pre, g: gramsOf(k) }));
  // 제품코드 앞 2자리별 분류 수 (글자로 못 찾을 때 그 앞자리에서 가장 많은 분류)
  const byPre = new Map<string, Map<string, number>>();
  for (const e of ex) if (e.pre) byPre.set(e.pre, (byPre.get(e.pre) ?? new Map()).set(e.cat, ((byPre.get(e.pre) ?? new Map()).get(e.cat) ?? 0) + 1));
  const exact = new Map(ex.map((e) => [e.k, e.cat]));
  // 글자 묶음 → 예시 번호 (흔한 묶음은 건너뜀)
  const index = new Map<string, number[]>();
  ex.forEach((e, i) => e.g.forEach((x) => index.set(x, [...(index.get(x) ?? []), i])));
  // season: 이 제품이 시즌품(S)/비시즌품(N)이면 같은 구분 예시를 더 믿고, 다른 구분 예시는 덜 믿음
  //   pre: 제품코드 앞 2자리가 같은 예시를 더 믿고, 다른 앞자리는 덜 믿음
  return (name: string, season?: 'S' | 'N', pre?: string): Suggestion | null => {
    const k = name.trim();
    if (!k) return null;
    if (exact.has(k)) return { cat: exact.get(k)!, score: 1, like: k, exact: true };
    const g = gramsOf(k);
    // 겹치는 글자 묶음이 있는 예시만 후보로
    const cand = new Set<number>();
    for (const x of g) {
      const l = index.get(x);
      if (l && l.length < 800) for (const i of l) cand.add(i);
    }
    // 분류마다 비슷한 예시 점수를 더하고 (가장 비슷한 것 위주), 제일 높은 분류
    const by = new Map<string, { score: number; best: number; like: string }>();
    for (const i of cand) {
      const e = ex[i];
      const s0 = sim(g, e.g);
      let s = season && e.season ? (season === e.season ? Math.min(1, s0 * 1.15) : s0 * 0.7) : s0;
      if (pre && e.pre) s = pre === e.pre ? Math.min(1, s * 1.15) : s * 0.9;
      if (s < 0.2) continue;
      const cur = by.get(e.cat) ?? { score: 0, best: 0, like: '' };
      cur.score += s * s;
      if (s > cur.best) {
        cur.best = s;
        cur.like = e.k;
      }
      by.set(e.cat, cur);
    }
    const top = [...by.entries()].sort((a, b) => b[1].best + b[1].score * 0.2 - (a[1].best + a[1].score * 0.2))[0];
    if (!top || top[1].best < 0.3) {
      // 글자로 못 찾으면: 같은 코드 앞자리 제품들이 가장 많이 고른 분류 (그 앞자리 예시의 60% 이상일 때만)
      const m = pre ? byPre.get(pre) : undefined;
      if (!m) return null;
      const all = [...m.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      if (all < 3 || n / all < 0.6) return null;
      return { cat, score: 0.3, like: `코드 ${pre}… 제품 ${all}개 중 ${n}개`, exact: false };
    }
    return { cat: top[0], score: Math.min(1, top[1].best), like: top[1].like, exact: false };
  };
}

/** 고른 기록 모두 지우기 (자동 적용 · 추천을 처음부터 다시 쌓기) */
export async function clearPicks() {
  if (DATA_MODE === 'local') return lsSet('gd:catPicks', [], 'gd-catpicks');
  const snap = await getDocs(collection(db, 'catPicks'));
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = writeBatch(db);
    snap.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
}

/** 이 제품명들의 고른 기록만 지우기 (페이지 단위 초기화) */
export async function deletePicks(kos: string[]) {
  const ids = [...new Set(kos.map((k) => dictId(k)))];
  if (!ids.length) return;
  if (DATA_MODE === 'local') return lsSet('gd:catPicks', lsGet<CatPick[]>('gd:catPicks', []).filter((p) => !ids.includes(p.id)), 'gd-catpicks');
  for (let i = 0; i < ids.length; i += 400) {
    const b = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => b.delete(doc(db, 'catPicks', id)));
    await b.commit();
  }
}
