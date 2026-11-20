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
  at?: string;
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
