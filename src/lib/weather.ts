// 날씨 (기상청 초단기예보): 서버가 매시 50분에 weatherNow/main 에 저장해 둔 것
import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { DATA_MODE } from '../data/store';

export type WxKind = 'rain' | 'sleet' | 'snow' | null;
export interface Weather {
  temp?: number;
  sky?: number; // 1 맑음 · 3 구름많음 · 4 흐림
  now?: WxKind; // 지금 내리는 것
  rain?: { at: string; kind: Exclude<WxKind, null> } | null; // 6시간 안에 처음 내리는 때
  hours?: { at: string; kind: WxKind; rn?: string; temp?: number; sky?: number }[]; // 시간별 (rn: 1시간 강수량 '강수없음' · '1mm 미만' · '2.0mm' · '30.0~50.0mm' …)
  at?: string;
  triedAt?: string; // 마지막으로 받으려고 한 때
  error?: string; // 그때 못 받았으면 이유
}

/** 1시간 강수량 글자 → mm (강수없음 0 · '1mm 미만' 0.5 · 범위면 앞 숫자) */
export const rnMm = (rn?: string) => {
  if (!rn || /없음/.test(rn)) return 0;
  if (/미만/.test(rn)) return 0.5;
  const n = parseFloat(rn.replace(/[^\d.~]/g, '').split('~')[0]);
  return Number.isFinite(n) ? n : 0;
};
/** 헤더 날씨 효과: 지금 비 · 눈이 오면 그 종류와 세기 (강수량: 3mm 미만 약하게 · 15mm 미만 보통 · 그 이상 강하게) */
export function weatherFxOf(w: Weather | null): { mode: 'rain' | 'snow' | 'frost'; level: 1 | 2 | 3 } | null {
  if (!w) return null;
  // 비 · 눈이 안 오고 영하 10도 이하 (지금 · 앞으로 몇 시간 중 가장 추운 때) → 서리
  const temps = [w.temp, ...(w.hours ?? []).map((x) => x.temp)].filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  if (!w.now && temps.length && Math.min(...temps) <= -10) return { mode: 'frost', level: 2 };
  if (!w.now) return null;
  const mm = rnMm(w.hours?.[0]?.rn);
  return { mode: w.now === 'snow' ? 'snow' : 'rain', level: mm >= 15 ? 3 : mm >= 3 ? 2 : 1 };
}

/** 받아 둔 날씨 그대로 (오래된 것도) · undefined = 읽는 중 */
export function useWeatherRaw(): Weather | null | undefined {
  const [w, setW] = useState<Weather | null | undefined>(undefined);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      // 로컬 테스트: 2시간 뒤 비
      const t = new Date(Date.now() + 2 * 3600000);
      const at = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:00`;
      // 앞으로 6시간 예시 (맑음 → 구름 → 비 → 흐림)
      const hr = (i: number) => {
        const d = new Date(Date.now() + i * 3600000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:00`;
      };
      const hours = [
        { at: hr(0), kind: null, sky: 1, temp: 12 },
        { at: hr(1), kind: null, sky: 3, temp: 12 },
        { at: hr(2), kind: 'rain' as const, sky: 4, temp: 11, rn: '1mm 미만' },
        { at: hr(3), kind: 'rain' as const, sky: 4, temp: 11, rn: '2.0mm' },
        { at: hr(4), kind: null, sky: 4, temp: 10 },
        { at: hr(5), kind: null, sky: 3, temp: 10 },
      ];
      setW({ temp: 12, sky: 1, now: null, rain: { at, kind: 'rain' }, hours, at: new Date().toISOString() });
      return;
    }
    return onSnapshot(
      doc(db, 'weatherNow', 'main'),
      (d) => setW(d.exists() ? (d.data() as Weather) : null),
      () => setW(null),
    );
  }, []);
  return w;
}
/** 3시간 넘게 지난 예보는 안 씀 */
export const isFresh = (w: Weather | null | undefined): w is Weather => !!w?.at && Date.now() - new Date(w.at).getTime() <= 3 * 3600000;
export function useWeather(): Weather | null {
  const w = useWeatherRaw();
  return isFresh(w) ? w : null;
}

const KIND = { rain: { icon: '☔', word: '비가' }, sleet: { icon: '🌨️', word: '비나 눈이' }, snow: { icon: '❄️', word: '눈이' } } as const;

// 우리 점심 12:40 ~ 13:40 · 퇴근 18:00 (홈 인사말과 같은 기준)
const LUNCH_START = 12 * 60 + 40;
const LUNCH_END = 13 * 60 + 40;
const OFF = 18 * 60;
/**
 * 날씨 인사말: 점심 1시간 전 (11:40~12:40) · 퇴근 1시간 전 (17:00~18:00) 에만 원래 인사말 대신
 *   지금 오고 있으면 '비가 오고 있어요. 우산을 챙겨요'
 *   그 일(점심 · 퇴근길)이 끝날 때까지 예보에 비 · 눈이 있으면 '곧 비가 와요. 우산을 챙겨요'
 *   그 외 시간 · 비 소식 없으면 null (원래 인사말)
 */
export function weatherGreeting(w: Weather | null, h: number, m: number, todayIso: string): string | null {
  if (!w) return null;
  const t = h * 60 + m;
  const lunch = t >= LUNCH_START - 60 && t < LUNCH_START;
  const off = t >= OFF - 60 && t < OFF;
  if (!lunch && !off) return null;
  if (w.now) return `${KIND[w.now].icon} ${KIND[w.now].word} 오고 있어요. 우산을 챙겨요`;
  // 점심 끝(13:40 → 13시 예보까지) · 퇴근길(19시 예보까지) 안에 비 · 눈 예보
  const untilHour = lunch ? Math.floor(LUNCH_END / 60) : OFF / 60 + 1;
  const hit = (w.hours ?? []).find((x) => x.kind && x.at.slice(0, 10) === todayIso && Number(x.at.slice(11, 13)) <= untilHour);
  if (!hit?.kind) return null;
  return `${KIND[hit.kind].icon} 곧 ${KIND[hit.kind].word} 와요. 우산을 챙겨요`;
}

export const syncWeatherNow = () => httpsCallable(functions, 'syncWeatherNow')({});
