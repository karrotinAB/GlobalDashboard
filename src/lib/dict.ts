// 번역 사전 (한글 → 영어): 모두가 같이 쓰고 계속 늘려감. dict/{id}: { ko, en, by, at }
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface DictEntry {
  id: string;
  ko: string;
  en: string;
  tags?: string[]; // 태그 (예: '캐릭터')
  type?: string; // 구분 (sku_type_name: 상품 · 제품 …) — 있으면 그 구분 제품에만 (예: 오토 → 상품이면 auto, 제품이면 Otto)
  by?: string;
  at?: string;
}

const LOCAL = 'gd:dict';
const readLocal = (): DictEntry[] => {
  try {
    return JSON.parse(localStorage.getItem(LOCAL) ?? '[]') as DictEntry[];
  } catch {
    return [];
  }
};
const writeLocal = (l: DictEntry[]) => {
  try {
    localStorage.setItem(LOCAL, JSON.stringify(l));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-dict'));
};
/** 한글 단어 → 문서 id (같은 단어는 한 줄로) */
export const dictId = (ko: string, type?: string) => encodeURIComponent(ko.trim() + (type ? `@${type}` : '')).replace(/\./g, '%2E').slice(0, 700);

export function useDict() {
  const [list, setList] = useState<DictEntry[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal());
      load();
      window.addEventListener('gd-dict', load);
      return () => window.removeEventListener('gd-dict', load);
    }
    return onSnapshot(
      collection(db, 'dict'),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<DictEntry, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, []);
  return list;
}

export async function saveDict(entries: { ko: string; en: string; type?: string; tags?: string[] }[], by?: string) {
  const at = new Date().toISOString();
  // 태그(캐릭터 등)도 같이 저장 (예전엔 빠졌음)
  const clean = entries.map((e) => ({ ko: e.ko.trim(), en: e.en.trim(), ...(e.type?.trim() ? { type: e.type.trim() } : {}), ...(e.tags?.length ? { tags: e.tags } : {}) })).filter((e) => e.ko && e.en);
  if (DATA_MODE === 'local') {
    const map = new Map(readLocal().map((e) => [e.id, e]));
    for (const e of clean) map.set(dictId(e.ko, e.type), { ...map.get(dictId(e.ko, e.type)), id: dictId(e.ko, e.type), ...e, by, at });
    return writeLocal([...map.values()]);
  }
  await Promise.all(clean.map((e) => setDoc(doc(db, 'dict', dictId(e.ko, e.type)), { ...e, ...(by ? { by } : {}), at }, { merge: true })));
}

/** 태그 켜고 끄기 (예: '캐릭터') */
export async function setDictTags(e: DictEntry, tags: string[]) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().map((x) => (x.id === e.id ? { ...x, tags } : x)));
  await setDoc(doc(db, 'dict', e.id), { tags }, { merge: true });
}

/** 이상한 구분 정리: 실제 구분(상품 · 제품 …)이 아닌 단어를 '구분 없음' 으로. 같은 한글이 여러 개면 하나로 합침
 *  (구분 없는 단어가 이미 있으면 그걸 두고 겹치는 건 지움 · 영어가 서로 다르면 그대로 두고 kept 로 알려줌) */
export async function fixJunkTypes(all: DictEntry[], real: Set<string>, by?: string) {
  const byKo = new Map<string, DictEntry[]>();
  for (const e of all) byKo.set(e.ko.trim(), [...(byKo.get(e.ko.trim()) ?? []), e]);
  let fixed = 0;
  let removed = 0;
  const kept: string[] = [];
  const at = new Date().toISOString();
  const put: DictEntry[] = [];
  const del: string[] = [];
  for (const [ko, es] of byKo) {
    const junk = es.filter((e) => e.type && !real.has(e.type));
    if (!junk.length) continue;
    const plain = es.find((e) => !e.type);
    const ens = new Set(junk.map((e) => e.en.trim()));
    const tags = [...new Set([...(plain?.tags ?? []), ...junk.flatMap((e) => e.tags ?? [])])];
    if (plain) {
      // 구분 없는 단어가 이미 있음: 영어가 같은 건 지우고 (태그는 합침), 다른 건 그대로
      const same = junk.filter((e) => e.en.trim() === plain.en.trim());
      same.forEach((e) => del.push(e.id));
      removed += same.length;
      if (tags.length !== (plain.tags ?? []).length) put.push({ ...plain, tags });
      junk.filter((e) => e.en.trim() !== plain.en.trim()).forEach((e) => kept.push(`${ko}(${e.type}: ${e.en})`));
      continue;
    }
    if (ens.size > 1) {
      junk.forEach((e) => kept.push(`${ko}(${e.type}: ${e.en})`));
      continue;
    }
    const base = junk[0];
    put.push({ id: dictId(ko), ko, en: base.en.trim(), ...(tags.length ? { tags } : {}), ...(base.by ?? by ? { by: base.by ?? by } : {}), at } as DictEntry);
    junk.forEach((e) => del.push(e.id));
    fixed++;
    removed += junk.length - 1;
  }
  if (DATA_MODE === 'local') {
    const map = new Map(readLocal().map((e) => [e.id, e]));
    del.forEach((id) => map.delete(id));
    put.forEach((e) => map.set(e.id, e));
    writeLocal([...map.values()]);
    return { fixed, removed, kept };
  }
  for (const e of put) {
    const { id, ...rest } = e;
    await setDoc(doc(db, 'dict', id), JSON.parse(JSON.stringify(rest)));
  }
  for (const id of del) await deleteDoc(doc(db, 'dict', id));
  return { fixed, removed, kept };
}

export async function deleteDict(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((e) => e.id !== id));
  await deleteDoc(doc(db, 'dict', id));
}

const HANGUL = /[가-힣]/;
// 사전 단어를 첫 글자별로 묶어 둠 (긴 단어부터) — 제품이 많아도 빠르게
const firstCache = new WeakMap<string[], Map<string, string[]>>();
const byFirst = (keys: string[]) => {
  let m = firstCache.get(keys);
  if (!m) {
    m = new Map();
    for (const k of keys) if (!isPattern(k)) m.set(k[0], [...(m.get(k[0]) ?? []), k]);
    firstCache.set(keys, m);
  }
  return m;
};
export type Piece = { text: string; en?: string; unknown?: boolean };

/**
 * 제품명 번역: 띄어쓰기·기호로 나누고, 한글 덩어리는 사전에서 가장 긴 단어부터 맞춰 바꿈.
 * 사전에 없는 한글 조각은 unknown 으로 돌려줌 (화면에서 채워 사전에 추가)
 */
// 숫자가 들어간 사전 단어 = '틀' (예: 0호0합 → No.0 0-Ply). 숫자 자리는 아무 숫자나 맞고, 영어의 숫자 자리에 차례로 들어감
type Pat = { re: RegExp; en: string; len: number };
const patCache = new WeakMap<string[], Pat[]>();
const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const isPattern = (ko: string) => /\d/.test(ko) && /[가-힣]/.test(ko);
const patternsOf = (keys: string[], dict: Map<string, string>) => {
  let l = patCache.get(keys);
  if (!l) {
    l = keys
      .filter(isPattern)
      .map((ko) => {
        // 글자 사이 띄어쓰기는 있어도 되고 없어도 됨
        const body = ko
          .replace(/\s+/g, '')
          .split(/(\d+)/)
          .filter(Boolean)
          .map((part) => (/^\d+$/.test(part) ? '(\\d+(?:\\.\\d+)?)' : [...part].map(esc).join('\\s*')))
          .join('\\s*');
        return { re: new RegExp(body, 'g'), en: dict.get(ko) ?? '', len: ko.length };
      })
      .sort((a, b) => b.len - a.len);
    patCache.set(keys, l);
  }
  return l;
};

export function translate(name: string, dict: Map<string, string>, keys: string[]): { en: string; pieces: Piece[]; unknown: string[] } {
  const pieces: Piece[] = [];
  // 먼저 틀(숫자 들어간 단어)을 통째로 바꿔 둠 — 3호5합 이 [호] [합] 으로 따로 나뉘지 않게
  const filled: string[] = [];
  for (const pt of patternsOf(keys, dict)) {
    name = name.replace(pt.re, (...m) => {
      const nums = (m.slice(1).filter((x) => typeof x === 'string' && /^\d/.test(x)) as string[]);
      let i = 0;
      filled.push(pt.en.replace(/\d+(?:\.\d+)?/g, () => nums[i++] ?? ''));
      return ` \uE000${filled.length - 1}\uE001 `;
    });
  }
  const tokens = name.split(/(\s+|[()[\]{}/,+·_\-|]+)/).filter((t) => t !== '');
  for (const tok of tokens) {
    if (!HANGUL.test(tok)) {
      pieces.push({ text: tok, en: tok });
      continue;
    }
    // 덩어리 전체가 사전에 있으면 그대로
    if (dict.has(tok)) {
      pieces.push({ text: tok, en: dict.get(tok) });
      continue;
    }
    // 앞에서부터 가장 긴 사전 단어로 자르기 (한글이 아닌 글자는 그대로)
    let i = 0;
    let unk = '';
    const flush = () => {
      if (unk) pieces.push({ text: unk, unknown: true });
      unk = '';
    };
    while (i < tok.length) {
      const rest = tok.slice(i);
      const k = (byFirst(keys).get(rest[0]) ?? []).find((key) => rest.startsWith(key));
      if (k) {
        flush();
        pieces.push({ text: k, en: dict.get(k) });
        i += k.length;
      } else if (!HANGUL.test(tok[i])) {
        flush();
        let j = i;
        while (j < tok.length && !HANGUL.test(tok[j])) j++;
        pieces.push({ text: tok.slice(i, j), en: tok.slice(i, j) });
        i = j;
      } else {
        unk += tok[i];
        i++;
      }
    }
    flush();
  }
  // 영어 이어 붙이기: 공백·기호는 그대로, 단어 사이엔 띄어쓰기
  let en = '';
  for (const p of pieces) {
    const t = p.unknown ? `[${p.text}]` : p.en ?? '';
    if (/^\s+$/.test(t)) {
      en += ' ';
      continue;
    }
    if (en && !/[\s(/[-]$/.test(en) && !/^[)\],.]/.test(t) && !/^[()[\]{}/,+·_\-|]+$/.test(p.text)) en += ' ';
    en += t;
  }
  en = en.replace(/\uE000(\d+)\uE001/g, (_, i) => filled[Number(i)] ?? '').replace(/\s{2,}/g, ' ').trim();
  return { en, pieces, unknown: [...new Set(pieces.filter((p) => p.unknown).map((p) => p.text))] };
}
