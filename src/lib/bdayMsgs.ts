// 생일 한마디: 생일인 날 접속한 사람들이 생일자에게 25자 한마디 → 생일자 헤더에 말풍선으로
//   bdayMsgs/{id} = { date: 'YYYY-MM-DD', to: 생일자 이메일, toName, from: 보낸 사람 이메일, fromName, text, at }
//   homeCfg/bdayWish = { on } (관리자가 헤더 설정에서 켬 — 끄면 팝업 · 말풍선 둘 다 안 보임)
import { useEffect, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export const WISH_MAX = 25;
export const WISH_QUICK = ['생일축하드려요', 'Happy Birthday', '행복한 하루 보내세요'];

export interface BdayMsg {
  id: string;
  date: string;
  to: string;
  toName?: string;
  from: string;
  fromName?: string;
  text: string;
  at: string;
}

// ---------- 켜기 · 끄기 (모두에게) ----------
export function useWishOn(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const f = () => setOn(localStorage.getItem('gd:wishOn') === '1');
      f();
      window.addEventListener('gd-wish', f);
      return () => window.removeEventListener('gd-wish', f);
    }
    return onSnapshot(
      doc(db, 'homeCfg', 'bdayWish'),
      (d) => setOn(!!d.get('on')),
      () => setOn(false),
    );
  }, []);
  return on;
}
export async function setWishOn(on: boolean) {
  if (DATA_MODE === 'local') {
    localStorage.setItem('gd:wishOn', on ? '1' : '0');
    window.dispatchEvent(new Event('gd-wish'));
    return;
  }
  await setDoc(doc(db, 'homeCfg', 'bdayWish'), { on });
}

// ---------- 한마디 ----------
const LS = 'gd:bdayMsgs';
const readLocal = (): BdayMsg[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '[]');
  } catch {
    return [];
  }
};
/** 그날 그 생일자에게 온 한마디 */
export function useBdayMsgs(date: string, to: string | null): BdayMsg[] {
  const [list, setList] = useState<BdayMsg[]>([]);
  useEffect(() => {
    if (!to) return setList([]);
    if (DATA_MODE === 'local') {
      const f = () => setList(readLocal().filter((m) => m.date === date && m.to === to));
      f();
      window.addEventListener('gd-bdaymsgs', f);
      return () => window.removeEventListener('gd-bdaymsgs', f);
    }
    return onSnapshot(
      query(collection(db, 'bdayMsgs'), where('date', '==', date), where('to', '==', to)),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<BdayMsg, 'id'>), id: d.id })).sort((a, b) => a.at.localeCompare(b.at))),
      () => setList([]),
    );
  }, [date, to]);
  return list;
}
export async function sendBdayMsg(m: Omit<BdayMsg, 'id' | 'at'>) {
  const text = m.text.trim().slice(0, WISH_MAX);
  if (!text) return;
  const row = { ...m, text, at: new Date().toISOString() };
  if (DATA_MODE === 'local') {
    localStorage.setItem(LS, JSON.stringify([...readLocal(), { ...row, id: String(Date.now()) }]));
    window.dispatchEvent(new Event('gd-bdaymsgs'));
    return;
  }
  await addDoc(collection(db, 'bdayMsgs'), row);
}

// ---------- 이 브라우저에서 이미 물어본 생일자 (보냈거나 '나중에') ----------
const askedKey = (date: string, to: string) => `gd:bdayAsked:${date}:${to}`;
export const wasAsked = (date: string, to: string) => {
  try {
    return localStorage.getItem(askedKey(date, to)) === '1';
  } catch {
    return false;
  }
};
export const markAsked = (date: string, to: string) => {
  try {
    localStorage.setItem(askedKey(date, to), '1');
  } catch {
    /* 무시 */
  }
};

// ---------- 관리자 미리보기 (이 브라우저에서만) ----------
export const PREVIEW_EVT = 'gd-wish-preview';
export const SAMPLE_MSGS: BdayMsg[] = [
  ['생일축하드려요', '가영'],
  ['Happy Birthday', '민지'],
  ['행복한 하루 보내세요', '유정'],
  ['오늘 케이크 먹어요🎂', '락연'],
  ['늘 고마워요! 생일 축하해요', '문정'],
  ['최고의 하루 되세요', '서현'],
  ['생일 진심으로 축하해요🎉', '지민'],
  ['맛있는 거 많이 드세요', '상현'],
  ['Happy Birthday', '예진'],
  ['올해도 좋은 일만 가득하길 바라요!', '윤경'],
  ['생일축하드려요', '승재'],
].map(([text, fromName], i) => ({ id: `s${i}`, date: '', to: '', from: '', fromName, text, at: '' }));
export function useBubblePreview() {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('gd:wishBubblePreview') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const f = () => setOn(localStorage.getItem('gd:wishBubblePreview') === '1');
    window.addEventListener(PREVIEW_EVT, f);
    return () => window.removeEventListener(PREVIEW_EVT, f);
  }, []);
  return on;
}
export function setBubblePreview(on: boolean) {
  try {
    localStorage.setItem('gd:wishBubblePreview', on ? '1' : '0');
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(PREVIEW_EVT));
}
