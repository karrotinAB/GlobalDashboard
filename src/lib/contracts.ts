// 계약서 보관함 (도구함): 업체별 계약서 원본 파일 + OCR 텍스트 → 조항으로 나눠 검색
//   contracts/{id}: { company, title, signedAt?, files[], text (OCR 원문), createdAt, by }
//   조항 나누기는 화면에서 그때그때 (원문만 저장 → 나누는 규칙을 고쳐도 바로 반영)
import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { db, storage } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface ContractFile {
  name: string;
  url: string;
  path?: string;
}
export interface Contract {
  id: string;
  company: string; // 업체 이름
  title: string; // 계약서 이름 (예: Master Franchise Agreement)
  signedAt?: string; // 계약일 YYYY-MM-DD
  files?: ContractFile[]; // 원본 (스캔본) — 참고용
  text?: string; // OCR 텍스트 원문
  text2?: string; // 번역본 (원문이 한글이면 영어, 영어면 한글)
  note?: string;
  latest?: boolean; // (최신) — 이 업체의 최신 버전 계약서
  team?: string; // 올린 조 ('1'·'2'·'3'·'trade') — 검색 '우리 조만'
  main?: boolean; // (주요) — 이 업체의 주요 계약서
  createdAt: string;
  by?: string;
}
export interface Article {
  no: number; // 순서
  head: string; // 조항 제목 줄 (예: Article 5. Security Deposit)
  body: string[]; // 문단들
  section?: boolean; // Section · Chapter · Part · 제N장 (여러 조항을 묶는 큰 구간 제목)
}
/** 큰 구간 제목 (Section 1: General Provisions · Chapter 2 · 제1장) */
export const isSection = (line: string) => /^\s*(section|chapter|part)\s+[\dIVXLC]+\b/i.test(line) || /^\s*제\s*\d+\s*(장|편|절)/.test(line);

// ---------- 로컬 ----------
const LS = 'gd:contracts';
const readLocal = (): Contract[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '[]');
  } catch {
    return [];
  }
};
const writeLocal = (v: Contract[]) => {
  localStorage.setItem(LS, JSON.stringify(v));
  window.dispatchEvent(new Event('gd-contracts'));
};

export function useContracts(enabled: boolean): Contract[] | null {
  const [list, setList] = useState<Contract[] | null>(null);
  useEffect(() => {
    if (!enabled) return setList([]);
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal());
      load();
      window.addEventListener('gd-contracts', load);
      return () => window.removeEventListener('gd-contracts', load);
    }
    return onSnapshot(
      collection(db, 'contracts'),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<Contract, 'id'>), id: d.id }))),
      () => setList([]),
    );
  }, [enabled]);
  return list ? [...list].sort((a, b) => a.company.localeCompare(b.company, 'ko') || (b.signedAt ?? '').localeCompare(a.signedAt ?? '')) : null;
}
export async function saveContract(c: Contract) {
  const clean = JSON.parse(JSON.stringify(c)) as Contract;
  if (DATA_MODE === 'local') return writeLocal([...readLocal().filter((x) => x.id !== c.id), clean]);
  await setDoc(doc(db, 'contracts', c.id), clean);
}
export async function deleteContract(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((x) => x.id !== id));
  await deleteDoc(doc(db, 'contracts', id));
}
export async function uploadContractFile(id: string, file: File): Promise<ContractFile> {
  if (DATA_MODE === 'local') {
    if (file.size > 1.5 * 1024 * 1024) throw new Error('로컬 모드에서는 1.5MB 이하만 넣을 수 있어요');
    const url = await new Promise<string>((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(file);
    });
    return { name: file.name, url };
  }
  const name = file.name || `계약서-${Date.now()}`;
  const path = `contracts/${id}/${Date.now()}-${name.replace(/[^\w.\-가-힣]/g, '_')}`;
  const r = storageRef(storage, path);
  await uploadBytes(r, file);
  return { name, url: await getDownloadURL(r), path };
}

// ---------- OCR 텍스트 → 조항 ----------
/** 조항 제목 줄인지: Article 5 / ARTICLE V / Section 3 / 제5조 / 5. Term (번호 + 대문자·한글 제목) */
const HEAD_RE = [
  /^\s*(article|art\.)\s*[\dIVXLC]+\b/i,
  /^\s*(section|clause)\s+\d+/i,
  /^\s*제\s*\d+\s*조/,
];
/** '5. Security Deposit' · '5. 보증금' 처럼 번호 + 짧은 제목 (문장으로 이어지는 번호 목록은 제목 아님) */
const isNumberedTitle = (line: string) => {
  // '1. 제목' 만 (1) 2) 처럼 괄호 번호는 목록 항목이라 제목 아님)
  const m = line.match(/^\s*\d{1,2}\s*\.\s+(.+)$/);
  if (!m) return false;
  const t = m[1].trim();
  if (/[.,;:]$/.test(t) || t.length > 45) return false;
  // 'Deposit: USD 3,000' 처럼 '이름: 값' 은 항목 줄
  if (/:\s*\S/.test(t)) return false;
  if (/[가-힣]/.test(t)) return t.length <= 20 && !/(다|요|함|음)$/.test(t);
  const words = t.split(/\s+/);
  // 영어: 6단어 이하, 짧은 연결어 빼고 모두 대문자로 시작
  return words.length <= 6 && words.every((w) => /^[A-Z0-9("'&]/.test(w) || /^(of|and|or|the|to|for|in|on|a|an|by|with)$/i.test(w));
};
export const isHead = (line: string) => HEAD_RE.some((r) => r.test(line)) || isNumberedTitle(line) || isSection(line);

/**
 * OCR 원문 → 조항: 제목 줄에서 나누고, 문단 안에서 OCR 로 끊긴 줄은 이어 붙임
 *   (빈 줄 · 목록 기호 (a) 1) • - 로 시작하는 줄은 새 문단)
 */
export function parseArticles(text: string): { intro: string[]; articles: Article[] } {
  // 페이지 표시 줄: 'Page 3' · 'PDF Page 5' · 'Page 3 of 20' · '- 3 -' 아닌 '9쪽' · '페이지 2' · '=====' 만 있는 줄
  const isPage = (l: string) => /^[=\-_~*#\s]*(pdf\s*)?(page|pg\.?|페이지)\s*\d+(\s*(of|\/)\s*\d+)?[=\-_~*#\s]*$/i.test(l) || /^[=\-_~*#\s]*\d+\s*쪽[=\-_~*#\s]*$/.test(l) || /^[=\-_~*#]{4,}$/.test(l);
  const lines = text
    .replace(/\r/g, '')
    // 페이지 표시 지우기: '===== 9쪽 =====' · '===== Page 3 =====' (줄 중간에 붙어 있어도)
    //   '===== PDF Page 5 =====' 처럼 앞에 다른 말이 붙어도
    .replace(/[=\-_~]{2,}[^=\-_~\n]{0,20}?(\d+\s*쪽|page\s*\d+(\s*(of|\/)\s*\d+)?|p\.?\s*\d+|페이지\s*\d+)\s*[=\-_~]{2,}/gi, '\n')
    // ① ② ③ … 항목은 줄마다
    .replace(/\s+([①-⑳])/g, '\n$1')
    .split('\n')
    .map((l) => l.trim())
    .map((l) => (isPage(l) ? '' : l));
  const intro: string[] = [];
  const articles: Article[] = [];
  let cur: Article | null = null;
  let para = '';
  const push = (p: string) => (cur ? cur.body : intro).push(p);
  const flush = () => {
    const p = para.replace(/\s+/g, ' ').trim();
    if (p) push(p);
    para = '';
  };
  lines.forEach((line, i) => {
    if (!line) return flush();
    if (isHead(line)) {
      flush();
      cur = { no: articles.length + 1, head: line.replace(/\s+/g, ' '), body: [], ...(isSection(line) ? { section: true } : {}) };
      articles.push(cur);
      return;
    }
    const prevBlank = !lines[i - 1];
    const nextBlank = !lines[i + 1];
    // 소제목: 'Company:' 처럼 짧고 : 로 끝나는 줄, 또는 앞뒤가 빈 짧은 줄 (마침표 없이)
    // (소문자로 시작하는 줄은 앞 문장이 이어지는 것 — 'received by the Franchisee, excluding:' 같은)
    const startsUpper = /^[A-Z가-힣"“(]/.test(line);
    if ((line.length <= 50 && /:$/.test(line) && startsUpper && (prevBlank || !para)) || (line.length <= 70 && prevBlank && nextBlank && startsUpper && !/[.;,]$/.test(line) && !isField(line))) {
      flush();
      push(SUB + line.replace(/\s+/g, ' '));
      return;
    }
    // 'Store Name: ARTBOX' 같은 항목 줄 · 목록 항목은 새 문단
    if (isField(line) || /^(\(?[a-z0-9ivx]{1,3}[.)]|[•·\-–*])\s+/i.test(line) || /^[①-⑳]/.test(line)) flush();
    // 하이픈으로 끊긴 단어는 붙이고, 아니면 띄어서 이어 붙임
    para = para ? (para.endsWith('-') ? para.slice(0, -1) + line : `${para} ${line}`) : line;
  });
  flush();
  // 앞부분에서 처음 나오는 'OO Agreement / 계약서' 소제목 하나만 문서 제목으로
  const ti = intro.findIndex((p) => p.startsWith(SUB) && /agreement|contract|계약서/i.test(p) && !/[:：]/.test(p) && p.length <= 61);
  if (ti >= 0) intro[ti] = TITLE + intro[ti].slice(1);
  return { intro, articles };
}
/** 소제목 표시 (문단 앞에 붙음) · 문서 제목 표시 */
export const SUB = '\u0001';
export const TITLE = '\u0002';
/** 'Label: value' 항목 줄 (라벨은 6단어 이하) */
export const FIELD_RE = /^([A-Za-z가-힣][^:：]{0,45})[:：]\s+(\S.*)$/;
export const isField = (line: string) => {
  const m = line.match(FIELD_RE);
  return !!m && m[1].trim().split(/\s+/).length <= 6 && !/[.;]$/.test(m[1]);
};

// ---------- 검색 ----------
/** 같이 찾을 말 (한글 ↔ 영어 계약 용어) */
export const SYNONYMS: string[][] = [
  ['보증금', 'deposit', 'security deposit', 'guarantee', '담보'],
  ['로열티', 'royalty', 'royalties'],
  ['기간', 'term', 'duration', 'period'],
  ['해지', '해제', 'termination', 'terminate'],
  ['갱신', 'renewal', 'renew'],
  ['지역', '영역', 'territory', 'area'],
  ['독점', 'exclusive', 'exclusivity'],
  ['대금', '지급', 'payment', 'pay'],
  ['가맹비', 'initial fee', 'franchise fee', 'entry fee'],
  ['최소', 'minimum', 'mininum purchase', 'minimum order'],
  ['손해배상', 'indemnity', 'indemnification', 'damages', 'liability'],
  ['비밀', 'confidential', 'confidentiality', 'non-disclosure'],
  ['준거법', 'governing law', 'jurisdiction', '관할'],
  ['분쟁', 'dispute', 'arbitration', '중재'],
  ['상표', 'trademark', 'intellectual property', '지식재산'],
  ['보험', 'insurance'],
  ['세금', 'tax', 'taxes', 'withholding'],
  ['통화', 'currency', 'exchange rate', '환율'],
  ['반품', 'return', 'returns', 'defective', '불량', '클레임', 'claim'],
  ['배송', 'delivery', 'shipping', 'shipment', 'incoterms'],
];
/** 검색어 → 찾을 말 묶음 (한 단어마다 같은 뜻 말들) */
export function expandQuery(q: string): string[][] {
  return q
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      const g = SYNONYMS.find((s) => s.some((x) => x.toLowerCase() === w || (w.length >= 2 && x.toLowerCase().includes(w) && /[가-힣]/.test(w))));
      return g ? [...new Set([w, ...g.map((x) => x.toLowerCase())])] : [w];
    });
}

/** 한글이 많으면 '한글', 아니면 '영어' */
export const langOf = (t?: string) => {
  const s = t ?? '';
  const ko = (s.match(/[가-힣]/g) ?? []).length;
  const en = (s.match(/[A-Za-z]/g) ?? []).length;
  return ko > en / 3 ? '한글' : '영어';
};

// ---------- 스크랩 + 폴더 (모두 같이 씀) ----------
//   ctFolders/{id}: { name, createdAt, by }
//   ctClips/{id}: { folderId, text, contractId, company, title, head, at, by, note? }
export interface ClipFolder {
  id: string;
  name: string;
  createdAt: string;
  by?: string;
}
export interface Clip {
  id: string;
  folderId: string;
  text: string; // 긁은 글
  contractId: string;
  company: string;
  title: string; // 계약서 이름
  head?: string; // 어느 조항
  note?: string;
  at: string;
  by?: string;
}
function useCol<T extends { id: string }>(name: string, enabled: boolean): T[] | null {
  const [list, setList] = useState<T[] | null>(null);
  useEffect(() => {
    if (!enabled) return setList([]);
    if (DATA_MODE === 'local') {
      const load = () => {
        try {
          setList(JSON.parse(localStorage.getItem(`gd:${name}`) ?? '[]'));
        } catch {
          setList([]);
        }
      };
      load();
      window.addEventListener(`gd-${name}`, load);
      return () => window.removeEventListener(`gd-${name}`, load);
    }
    return onSnapshot(
      collection(db, name),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<T, 'id'>), id: d.id }) as T)),
      () => setList([]),
    );
  }, [name, enabled]);
  return list;
}
async function putDoc<T extends { id: string }>(name: string, v: T) {
  const clean = JSON.parse(JSON.stringify(v)) as T;
  if (DATA_MODE === 'local') {
    const l = (JSON.parse(localStorage.getItem(`gd:${name}`) ?? '[]') as T[]).filter((x) => x.id !== v.id);
    localStorage.setItem(`gd:${name}`, JSON.stringify([...l, clean]));
    window.dispatchEvent(new Event(`gd-${name}`));
    return;
  }
  await setDoc(doc(db, name, v.id), clean);
}
async function dropDoc(name: string, id: string) {
  if (DATA_MODE === 'local') {
    const l = (JSON.parse(localStorage.getItem(`gd:${name}`) ?? '[]') as { id: string }[]).filter((x) => x.id !== id);
    localStorage.setItem(`gd:${name}`, JSON.stringify(l));
    window.dispatchEvent(new Event(`gd-${name}`));
    return;
  }
  await deleteDoc(doc(db, name, id));
}
export const useClipFolders = (on: boolean) => {
  const l = useCol<ClipFolder>('ctFolders', on);
  return l ? [...l].sort((a, b) => a.name.localeCompare(b.name, 'ko')) : null;
};
export const useClips = (on: boolean) => {
  const l = useCol<Clip>('ctClips', on);
  return l ? [...l].sort((a, b) => b.at.localeCompare(a.at)) : null;
};
export const saveClipFolder = (f: ClipFolder) => putDoc('ctFolders', f);
export const deleteClipFolder = (id: string) => dropDoc('ctFolders', id);
export const saveClip = (c: Clip) => putDoc('ctClips', c);
export const deleteClip = (id: string) => dropDoc('ctClips', id);
