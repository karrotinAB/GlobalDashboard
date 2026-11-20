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
  hours?: { at: string; kind: WxKind; rn?: string }[]; // 시간별 (rn: 1시간 강수량 '강수없음' · '1mm 미만' · '2.0mm' · '30.0~50.0mm' …)
  at?: string;
}

/** 1시간 강수량 글자 → mm (강수없음 0 · '1mm 미만' 0.5 · 범위면 앞 숫자) */
export const rnMm = (rn?: string) => {
  if (!rn || /없음/.test(rn)) return 0;
  if (/미만/.test(rn)) return 0.5;
  const n = parseFloat(rn.replace(/[^\d.~]/g, '').split('~')[0]);
  return Number.isFinite(n) ? n : 0;
};
/** 헤더 날씨 효과: 지금 비 · 눈이 오면 그 종류와 세기 (강수량: 3mm 미만 약하게 · 15mm 미만 보통 · 그 이상 강하게) */
export function weatherFxOf(w: Weather | null): { mode: 'rain' | 'snow'; level: 1 | 2 | 3 } | null {
  if (!w?.now) return null;
  const mm = rnMm(w.hours?.[0]?.rn);
  return { mode: w.now === 'snow' ? 'snow' : 'rain', level: mm >= 15 ? 3 : mm >= 3 ? 2 : 1 };
}

export function useWeather(): Weather | null {
  const [w, setW] = useState<Weather | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      // 로컬 테스트: 2시간 뒤 비
      const t = new Date(Date.now() + 2 * 3600000);
      const at = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}T${String(t.getHours()).padStart(2, '0')}:00`;
      setW({ temp: 12, sky: 3, now: null, rain: { at, kind: 'rain' }, at: new Date().toISOString() });
      return;
    }
    return onSnapshot(
      doc(db, 'weatherNow', 'main'),
      (d) => setW(d.exists() ? (d.data() as Weather) : null),
      () => setW(null),
    );
  }, []);
  // 3시간 넘게 지난 예보는 안 보여줌
  if (!w?.at || Date.now() - new Date(w.at).getTime() > 3 * 3600000) return null;
  return w;
}

const KIND = { rain: { icon: '☔', word: '비가' }, sleet: { icon: '🌨️', word: '비나 눈이' }, snow: { icon: '❄️', word: '눈이' } } as const;

/** 인사말 옆에 붙는 한 줄: 비 · 눈이 오거나 6시간 안에 올 때만 (시간은 안 씀) */
export function weatherLine(w: Weather): string | null {
  if (w.now) return `${KIND[w.now].icon} 지금 ${KIND[w.now].word} 와요`;
  if (w.rain) return `${KIND[w.rain.kind].icon} 곧 ${KIND[w.rain.kind].word} 와요`;
  return null;
}

export const syncWeatherNow = () => httpsCallable(functions, 'syncWeatherNow')({});
