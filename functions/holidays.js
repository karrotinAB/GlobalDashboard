// 나라별 공휴일·기념일 (음력 포함): 구글 캘린더 공개 '공휴일' 달력(iCal)에서 — 한국어 이름
// 공휴일(쉬는 날)과 기념일(쉬지 않는 행사)을 구분해서 돌려줌
import { eventsFromIcs, loadIcal } from './calendar.js';

// 구글 공휴일 달력 id: 새 형식(나라 코드) → 옛 형식(이름) 순서로 시도
const LEGACY = {
  KR: 'south_korea', JP: 'japanese', CN: 'china', US: 'usa', GB: 'uk', DE: 'german', ES: 'spain', RU: 'russian', MY: 'malaysia',
  VN: 'vietnamese', MX: 'mexican', CA: 'canadian', AU: 'australian', ID: 'indonesian', TH: 'thai', PH: 'philippines', SG: 'singapore',
  TW: 'taiwan', HK: 'hong_kong', FR: 'french', IT: 'italian', PL: 'polish', NL: 'dutch', NZ: 'new_zealand', BR: 'brazilian', IN: 'indian',
  MN: 'mongolian', TR: 'turkish', AE: 'uae', SA: 'saudiarabian',
};
const icsUrl = (id) => `https://calendar.google.com/calendar/ical/${encodeURIComponent(`ko.${id}#holiday@group.v.calendar.google.com`)}/public/basic.ics`;

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, { headers: { Accept: 'text/calendar' } });
  if (!res.ok) return null;
  const text = await res.text();
  return text.includes('BEGIN:VCALENDAR') ? text : null;
}

/** 나라 하나, 한 해: { 'YYYY-MM-DD': { name, off } } */
export async function countryHolidays(cc, year, fetchImpl = fetch) {
  let text = await fetchText(icsUrl(cc.toLowerCase()), fetchImpl);
  if (!text && LEGACY[cc]) text = await fetchText(icsUrl(LEGACY[cc]), fetchImpl);
  if (!text) return null; // 구글에 그 나라 달력이 없음
  await loadIcal();
  const from = new Date(`${year}-01-01T00:00:00Z`);
  const to = new Date(`${year + 1}-01-01T00:00:00Z`);
  const out = {};
  for (const e of eventsFromIcs(text, cc, from, to)) {
    const day = e.start.slice(0, 10);
    // 구글은 설명에 '공휴일' / '기념일'(Observance) 을 적어 줌 → 기념일은 쉬지 않는 날
    const off = !/기념일|observance/i.test(e.desc ?? '');
    const prev = out[day];
    out[day] = prev ? { name: `${prev.name} · ${e.title}`, off: prev.off || off } : { name: e.title, off };
  }
  return out;
}
