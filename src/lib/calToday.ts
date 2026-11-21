// 홈 'TODAY'S SCHEDULE' 카드: 부서 구글 캘린더에서 오늘(서울) 일정만 (서버 함수 calendarEvents)
//   달력 페이지에서 숨긴 달력 · 내가 바꾼 색은 그대로 따름 · 15분마다 새로
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface TodayEv {
  id: string;
  title: string;
  time: string; // '종일' 또는 '09:30'
  allDay: boolean;
  color: string;
  calName: string;
  location?: string;
}
type Raw = { calendars: { id: string; name: string; color: string }[]; events: { id: string; cal: string; title: string; start: string; end: string; allDay: boolean; location?: string }[] };

const readLS = <T,>(k: string, d: T): T => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? '') as T;
  } catch {
    return d;
  }
};
const seoulDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(iso));
const seoulTime = (iso: string) => new Date(iso).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const nextDay = (k: string) => {
  const d = new Date(`${k}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

const cache = new Map<string, { at: number; p: Promise<Raw> }>();
const TTL = 15 * 60000;
function load(day: string): Promise<Raw> {
  const c = cache.get(day);
  if (c && Date.now() - c.at < TTL) return c.p;
  const from = new Date(`${day}T00:00:00+09:00`).toISOString();
  const to = new Date(`${nextDay(day)}T00:00:00+09:00`).toISOString();
  const p = httpsCallable(functions, 'calendarEvents')({ from, to }).then((r) => r.data as Raw);
  p.catch(() => cache.delete(day));
  cache.set(day, { at: Date.now(), p });
  return p;
}

function demo(): Raw {
  const t = (h: number, m = 0) => new Date(new Date().setHours(h, m, 0, 0)).toISOString();
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
  return {
    calendars: [
      { id: 'a', name: '부서', color: '#c2185b' },
      { id: 'b', name: '휴가', color: '#2e7d32' },
    ],
    events: [
      { id: '1', cal: 'b', title: '민지 연차', start: d, end: nextDay(d), allDay: true },
      { id: '2', cal: 'a', title: '주간 회의', start: t(10), end: t(11), allDay: false, location: '3층 회의실' },
      { id: '3', cal: 'a', title: '몽골 바이어 화상 미팅', start: t(14, 30), end: t(15, 30), allDay: false },
      { id: '4', cal: 'a', title: '샘플 발송 마감', start: t(17), end: t(17, 30), allDay: false },
    ],
  };
}

/** 오늘 일정 (null = 불러오는 중) */
export function useTodayEvents(day: string): { list: TodayEv[] | null; error: string } {
  const [raw, setRaw] = useState<Raw | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const run = () => {
      if (DATA_MODE === 'local') return setRaw(demo());
      load(day)
        .then((r) => alive && (setRaw(r), setError('')))
        .catch((e) => alive && setError((e as Error).message));
    };
    run();
    const t = window.setInterval(run, TTL);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [day]);
  if (!raw) return { list: null, error };
  const hidden = readLS<string[]>('gd:calHidden', []);
  const colors = readLS<Record<string, string>>('gd:calColors', {});
  const cals = new Map(raw.calendars.map((c) => [c.id, c]));
  const list = raw.events
    .filter((e) => !hidden.includes(e.cal))
    .filter((e) => {
      // 오늘에 걸친 일정만 (종일 끝 날짜는 '다음날' 이라 포함 안 함)
      if (e.allDay) return e.start <= day && day < e.end;
      return seoulDay(e.start) <= day && seoulDay(new Date(new Date(e.end).getTime() - 1).toISOString()) >= day;
    })
    .sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.localeCompare(b.start))
    .map((e) => ({
      id: e.id,
      title: e.title,
      allDay: e.allDay,
      // 어제부터 이어진 시간 일정은 '계속'
      time: e.allDay ? '종일' : seoulDay(e.start) < day ? '계속' : seoulTime(e.start),
      color: colors[e.cal] ?? cals.get(e.cal)?.color ?? '#999',
      calName: cals.get(e.cal)?.name ?? '',
      location: e.location,
    }));
  return { list, error };
}
