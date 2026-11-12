// 구글 캘린더 일정 읽기 (iCal 비공개 주소). 주소는 Firestore secrets/calendars 에만 (사이트에서 못 읽음)
// 반복 일정(RRULE)·예외(EXDATE)·바뀐 회차(RECURRENCE-ID)·종일 일정 처리
// node-ical 은 무거워서 필요할 때만 불러옴 (배포할 때 코드 읽는 시간 줄이기)
let ical;
export const loadIcal = async () => (ical ??= (await import('node-ical')).default);

const cache = new Map(); // url → { at, text } (서버 함수가 살아있는 동안 10분)
const KEEP = 10 * 60 * 1000;

async function fetchIcs(url, fetchImpl = fetch) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < KEEP) return hit.text;
  const res = await fetchImpl(url, { headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`달력을 못 읽었어요 (HTTP ${res.status}) — 주소를 확인해 주세요`);
  const text = await res.text();
  if (!text.includes('BEGIN:VCALENDAR')) throw new Error('iCal 주소가 아닌 것 같아요 (…/basic.ics 로 끝나는 주소)');
  cache.set(url, { at: Date.now(), text });
  return text;
}

const dayKey = (d) => d.toISOString().slice(0, 10);

/** ICS 글자 → [from, to) 사이 일정 목록 */
export function eventsFromIcs(text, calId, from, to) {
  const data = ical.sync.parseICS(text);
  const out = [];
  const push = (ev, start, end) => {
    const allDay = ev.datetype === 'date';
    out.push({
      id: `${calId}:${ev.uid}:${start.toISOString()}`,
      cal: calId,
      title: String(ev.summary?.val ?? ev.summary ?? '(제목 없음)'),
      start: allDay ? dayKey(new Date(start.getTime() - start.getTimezoneOffset() * 60000)) : start.toISOString(),
      end: allDay ? dayKey(new Date(end.getTime() - end.getTimezoneOffset() * 60000)) : end.toISOString(),
      allDay,
      location: ev.location ? String(ev.location?.val ?? ev.location) : undefined,
      desc: ev.description ? String(ev.description?.val ?? ev.description).slice(0, 2000) : undefined,
    });
  };
  for (const ev of Object.values(data)) {
    if (!ev || ev.type !== 'VEVENT' || !ev.start) continue;
    const start = new Date(ev.start);
    const end = ev.end ? new Date(ev.end) : new Date(start.getTime() + (ev.datetype === 'date' ? 86400000 : 3600000));
    const dur = end.getTime() - start.getTime();
    if (ev.rrule) {
      // 반복: 범위 안 회차만 (기간이 긴 일정도 잡히게 앞쪽을 dur 만큼 넓혀서)
      const dates = ev.rrule.between(new Date(from.getTime() - dur), to, true);
      for (const d of dates) {
        const key = dayKey(d);
        if (ev.exdate && Object.keys(ev.exdate).some((k) => k.slice(0, 10) === key)) continue;
        const over = ev.recurrences && Object.entries(ev.recurrences).find(([k]) => k.slice(0, 10) === key)?.[1];
        if (over) {
          const os = new Date(over.start);
          const oe = over.end ? new Date(over.end) : new Date(os.getTime() + dur);
          if (os < to && oe > from) push(over, os, oe);
        } else {
          const s = new Date(d);
          const e = new Date(s.getTime() + dur);
          if (s < to && e > from) push(ev, s, e);
        }
      }
    } else if (!ev.recurrenceid && start < to && end > from) {
      push(ev, start, end);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** 여러 달력 → 일정 (달력 하나가 실패해도 나머지는 보여줌) */
export async function loadCalendars(list, from, to, fetchImpl = fetch) {
  await loadIcal();
  const events = [];
  const errors = [];
  for (const c of list) {
    try {
      events.push(...eventsFromIcs(await fetchIcs(c.url, fetchImpl), c.id, from, to));
    } catch (e) {
      errors.push(`${c.name}: ${e.message}`);
    }
  }
  return { events, errors };
}
