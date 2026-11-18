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
  createdAt: string;
  by?: string;
}
export interface Article {
  no: number; // 순서
  head: string; // 조항 제목 줄 (예: Article 5. Security Deposit)
  body: string[]; // 문단들
}

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
  /^\s*\d{1,2}\s*[.)]\s+[A-Z가-힣][^.]{0,80}$/, // '5. Security Deposit' 처럼 짧은 제목 줄
];
export const isHead = (line: string) => HEAD_RE.some((r) => r.test(line));

/**
 * OCR 원문 → 조항: 제목 줄에서 나누고, 문단 안에서 OCR 로 끊긴 줄은 이어 붙임
 *   (빈 줄 · 목록 기호 (a) 1) • - 로 시작하는 줄은 새 문단)
 */
export function parseArticles(text: string): { intro: string[]; articles: Article[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  const intro: string[] = [];
  const articles: Article[] = [];
  let cur: Article | null = null;
  let para = '';
  const flush = () => {
    const p = para.replace(/\s+/g, ' ').trim();
    if (p) (cur ? cur.body : intro).push(p);
    para = '';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    if (isHead(line)) {
      flush();
      cur = { no: articles.length + 1, head: line.replace(/\s+/g, ' '), body: [] };
      articles.push(cur);
      continue;
    }
    // 목록 항목은 새 문단
    if (/^(\(?[a-z0-9ivx]{1,3}[.)]|[•·\-–*])\s+/i.test(line)) flush();
    // 하이픈으로 끊긴 단어는 붙이고, 아니면 띄어서 이어 붙임
    para = para ? (para.endsWith('-') ? para.slice(0, -1) + line : `${para} ${line}`) : line;
  }
  flush();
  return { intro, articles };
}

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
