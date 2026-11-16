// 번역 사전 (한글 → 영어): 모두가 같이 쓰고 계속 늘려감. dict/{id}: { ko, en, by, at }
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface DictEntry {
  id: string;
  ko: string;
  en: string;
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
export const dictId = (ko: string) => encodeURIComponent(ko.trim()).replace(/\./g, '%2E').slice(0, 700);

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

export async function saveDict(entries: { ko: string; en: string }[], by?: string) {
  const at = new Date().toISOString();
  const clean = entries.map((e) => ({ ko: e.ko.trim(), en: e.en.trim() })).filter((e) => e.ko && e.en);
  if (DATA_MODE === 'local') {
    const map = new Map(readLocal().map((e) => [e.id, e]));
    for (const e of clean) map.set(dictId(e.ko), { id: dictId(e.ko), ...e, by, at });
    return writeLocal([...map.values()]);
  }
  await Promise.all(clean.map((e) => setDoc(doc(db, 'dict', dictId(e.ko)), { ...e, ...(by ? { by } : {}), at })));
}

export async function deleteDict(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((e) => e.id !== id));
  await deleteDoc(doc(db, 'dict', id));
}

const HANGUL = /[가-힣]/;
export type Piece = { text: string; en?: string; unknown?: boolean };

/**
 * 제품명 번역: 띄어쓰기·기호로 나누고, 한글 덩어리는 사전에서 가장 긴 단어부터 맞춰 바꿈.
 * 사전에 없는 한글 조각은 unknown 으로 돌려줌 (화면에서 채워 사전에 추가)
 */
export function translate(name: string, dict: Map<string, string>, keys: string[]): { en: string; pieces: Piece[]; unknown: string[] } {
  const pieces: Piece[] = [];
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
      const k = keys.find((key) => rest.startsWith(key));
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
  en = en.replace(/\s{2,}/g, ' ').trim();
  return { en, pieces, unknown: [...new Set(pieces.filter((p) => p.unknown).map((p) => p.text))] };
}
