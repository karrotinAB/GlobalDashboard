// 생일: 관리자만 설정 (설정 > 생일) — homeCfg/birthdays = { list: [{ id, name, email?, md: 'MM-DD' }] }
//   생일 당일: 본인 홈 인사말이 생일 인사로 · 모두의 TODAY 카드에 '오늘 ○○ 생일이에요'
import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface Birthday {
  id: string;
  name: string;
  email?: string; // 로그인 이메일 (본인 인사말용)
  md: string; // 'MM-DD'
}

const LS = 'gd:birthdays';
export function useBirthdays(): Birthday[] | null {
  const [list, setList] = useState<Birthday[] | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => {
        try {
          setList(JSON.parse(localStorage.getItem(LS) ?? '[]'));
        } catch {
          setList([]);
        }
      };
      load();
      window.addEventListener('gd-birthdays', load);
      return () => window.removeEventListener('gd-birthdays', load);
    }
    return onSnapshot(
      doc(db, 'homeCfg', 'birthdays'),
      (d) => setList((d.get('list') as Birthday[] | undefined) ?? []),
      () => setList([]),
    );
  }, []);
  return list;
}

export async function saveBirthdays(list: Birthday[]) {
  const clean = JSON.parse(JSON.stringify(list)) as Birthday[];
  if (DATA_MODE === 'local') {
    localStorage.setItem(LS, JSON.stringify(clean));
    window.dispatchEvent(new Event('gd-birthdays'));
    return;
  }
  await setDoc(doc(db, 'homeCfg', 'birthdays'), { list: clean });
}

/** 오늘(YYYY-MM-DD) 생일인 사람들. 2/29 생일은 윤년이 아니면 2/28 에 */
export function birthdaysOn(list: Birthday[] | null, iso: string): Birthday[] {
  if (!list) return [];
  const y = Number(iso.slice(0, 4));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const md = iso.slice(5, 10);
  return list.filter((b) => b.md === md || (!leap && b.md === '02-29' && md === '02-28'));
}

// 우리 점심시간 12:40 ~ 13:40 (홈 인사말과 같은 기준)
const LUNCH_START = 12 * 60 + 40;
const LUNCH_END = 13 * 60 + 40;
/** 생일자 본인 인사말 */
export function birthdayGreeting(h: number, m: number) {
  const t = h * 60 + m;
  if (t < 11 * 60) return '생일 축하해요 🎂';
  if (t < LUNCH_START - 30) return 'Happy Birthday 🎉';
  if (t < LUNCH_START) return '오늘은 꼭 맛있는 거 먹어요 🍰';
  if (t < LUNCH_END) return '생일밥 야무지게 드세요 🍚';
  if (t < LUNCH_END + 60) return '행복한 점심이었나요? 😊';
  if (t < 18 * 60) return '조금만 더 힘내요 💪';
  return '생일날 퇴근이라니! 너무 고생했어요 🌙';
}
