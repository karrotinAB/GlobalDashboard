// 나라별 공휴일 (홈 화면 세계 시계용)
// 브라우저가 공개 공휴일 API(date.nager.at, 무료·키 없음)에서 받아서 브라우저에 30일 보관.
// API 가 지원하지 않는 나라는 그냥 표시 안 됨. 한국은 lib/holidays.ts 를 씀.
import { useEffect, useState } from 'react';
import type { ExtraHoliday } from '../types';

/** 업체의 '나라' 칸(한글/영어) → 나라 코드 */
const BY_NAME: Record<string, string> = {
  말레이시아: 'MY', malaysia: 'MY',
  에콰도르: 'EC', ecuador: 'EC',
  독일: 'DE', germany: 'DE',
  몽골: 'MN', mongolia: 'MN',
  영국: 'GB', uk: 'GB', 'united kingdom': 'GB',
  러시아: 'RU', russia: 'RU',
  스페인: 'ES', spain: 'ES',
  카자흐스탄: 'KZ', kazakhstan: 'KZ',
  미국: 'US', usa: 'US', 'united states': 'US',
  캐나다: 'CA', canada: 'CA',
  일본: 'JP', japan: 'JP',
  중국: 'CN', china: 'CN',
  대만: 'TW', taiwan: 'TW',
  홍콩: 'HK', 'hong kong': 'HK',
  싱가포르: 'SG', singapore: 'SG',
  베트남: 'VN', vietnam: 'VN',
  태국: 'TH', thailand: 'TH',
  필리핀: 'PH', philippines: 'PH',
  인도네시아: 'ID', indonesia: 'ID',
  호주: 'AU', australia: 'AU',
  뉴질랜드: 'NZ', 'new zealand': 'NZ',
  프랑스: 'FR', france: 'FR',
  이탈리아: 'IT', italy: 'IT',
  네덜란드: 'NL', netherlands: 'NL',
  폴란드: 'PL', poland: 'PL',
  튀르키예: 'TR', 터키: 'TR', turkey: 'TR',
  멕시코: 'MX', mexico: 'MX',
  브라질: 'BR', brazil: 'BR',
  칠레: 'CL', chile: 'CL',
  페루: 'PE', peru: 'PE',
  콜롬비아: 'CO', colombia: 'CO',
  우즈베키스탄: 'UZ', uzbekistan: 'UZ',
  키르기스스탄: 'KG', kyrgyzstan: 'KG',
  아랍에미리트: 'AE', uae: 'AE',
  사우디아라비아: 'SA', 'saudi arabia': 'SA',
};

/** 나라 이름으로 못 찾으면 시간대로 */
const BY_TZ: Record<string, string> = {
  'Asia/Kuala_Lumpur': 'MY',
  'America/Guayaquil': 'EC',
  'Europe/Berlin': 'DE',
  'Asia/Ulaanbaatar': 'MN',
  'Europe/London': 'GB',
  'Europe/Moscow': 'RU',
  'Europe/Madrid': 'ES',
  'Asia/Almaty': 'KZ',
  'Asia/Qostanay': 'KZ',
  'Asia/Tokyo': 'JP',
  'Asia/Shanghai': 'CN',
  'Asia/Taipei': 'TW',
  'Asia/Hong_Kong': 'HK',
  'Asia/Singapore': 'SG',
  'Asia/Ho_Chi_Minh': 'VN',
  'Asia/Bangkok': 'TH',
  'Asia/Manila': 'PH',
  'Asia/Jakarta': 'ID',
  'Europe/Paris': 'FR',
  'Europe/Rome': 'IT',
  'Europe/Amsterdam': 'NL',
  'Europe/Warsaw': 'PL',
  'Europe/Istanbul': 'TR',
  'Asia/Tashkent': 'UZ',
  'Asia/Bishkek': 'KG',
  'Asia/Dubai': 'AE',
};

/** 업체의 '나라' 칸, 없으면 시간대 → 나라 코드 (모르면 undefined) */
export function countryCode(country?: string, tz?: string): string | undefined {
  const key = (country ?? '').trim().toLowerCase();
  if (key) {
    if (BY_NAME[key]) return BY_NAME[key];
    // '몽골 (SJNET)' 처럼 뒤에 뭐가 붙어도
    const hit = Object.keys(BY_NAME).find((k) => key.startsWith(k));
    if (hit) return BY_NAME[hit];
    if (/^[a-z]{2}$/.test(key)) return key.toUpperCase();
  }
  return tz ? BY_TZ[tz] : undefined;
}

type HolidayMap = Record<string, string>; // 'YYYY-MM-DD' → 이름
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;
const memory = new Map<string, Promise<HolidayMap>>();

function load(code: string, year: number): Promise<HolidayMap> {
  const key = `gd:hol:${code}:${year}`;
  const cached = memory.get(key);
  if (cached) return cached;
  const p = (async () => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null') as { at: number; map: HolidayMap } | null;
      if (saved && Date.now() - saved.at < KEEP_MS) return saved.map;
    } catch {
      /* 브라우저 저장소 못 씀 */
    }
    const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${code}`);
    if (!res.ok || res.status === 204) return {}; // 지원 안 하는 나라
    const list = (await res.json()) as { date: string; name: string; localName: string; global: boolean; types?: string[] }[];
    const map: HolidayMap = {};
    for (const h of list) {
      if (h.global === false) continue; // 일부 지역(주)만 쉬는 날은 뺌
      if (h.types && !h.types.includes('Public')) continue; // 은행 휴일 등은 뺌
      map[h.date] = map[h.date] ? `${map[h.date]} · ${h.name}` : h.name;
    }
    try {
      localStorage.setItem(key, JSON.stringify({ at: Date.now(), map }));
    } catch {
      /* 무시 */
    }
    return map;
  })().catch(() => ({}) as HolidayMap);
  memory.set(key, p);
  return p;
}

/** 나라 코드들의 올해·내년 공휴일. 반환: (코드, 'YYYY-MM-DD') → 공휴일 이름 */
/** 공휴일 서비스에 빠진 휴일 (음력 등) — 확인된 것만. 설정 > 나라별 추가 공휴일에서 더 넣을 수 있음 */
const BUILT_IN: Record<string, HolidayMap> = {
  MN: { '2026-11-11': '칭기즈칸 탄생일' },
};

/** 나라 이름 보기 (설정 화면용) */
export const COUNTRY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(BY_NAME)
    .filter(([k]) => /[가-힣]/.test(k))
    .map(([k, v]) => [v, k]),
);

export function useWorldHolidays(codes: string[], year: number, extra: ExtraHoliday[] = []) {
  const [maps, setMaps] = useState<Record<string, HolidayMap>>({});
  const sig = [...new Set(codes)].sort().join(',');
  useEffect(() => {
    let alive = true;
    const list = sig ? sig.split(',') : [];
    void Promise.all(
      list.map(async (c) => {
        const [a, b] = await Promise.all([load(c, year), load(c, year + 1)]);
        return [c, { ...a, ...b }] as const;
      }),
    ).then((entries) => alive && setMaps(Object.fromEntries(entries)));
    return () => {
      alive = false;
    };
  }, [sig, year]);
  const lookup = (code: string, iso: string): string | undefined =>
    extra.find((h) => h.code === code && h.date === iso)?.name ?? BUILT_IN[code]?.[iso] ?? maps[code]?.[iso];
  /** 시계에 마우스를 올리면 보이는 설명: 이 나라 공휴일을 몇 개 불러왔는지 */
  const status = (code: string) => {
    const n = maps[code] ? Object.keys(maps[code]).length : undefined;
    const ex = extra.filter((h) => h.code === code).length + Object.keys(BUILT_IN[code] ?? {}).length;
    if (n === undefined) return `${code} 공휴일 불러오는 중…`;
    return `${code} 공휴일 ${n}일 (공휴일 서비스)${ex ? ` + 직접 넣은 ${ex}일` : ''}${n === 0 ? ' — 서비스에 이 나라 정보가 없어요' : ''}`;
  };
  return Object.assign(lookup, { status });
}
