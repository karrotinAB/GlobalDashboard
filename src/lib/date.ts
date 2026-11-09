// 모든 날짜는 사용자 브라우저(한국) 기준 YYYY-MM-DD 문자열로 다룸

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function today(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

/** 해당 날짜가 속한 주의 월요일 */
export function weekStart(iso: string): string {
  const d = fromISO(iso);
  const dow = (d.getDay() + 6) % 7; // 월=0
  d.setDate(d.getDate() - dow);
  return toISO(d);
}

/** 주 끝 (일요일) – 금요일 이후 완료된 건도 그 주로 취급 */
export function weekEnd(mondayIso: string): string {
  return addDays(mondayIso, 6);
}

/** "11/9-13" 형태 라벨 (월~금) */
export function weekLabel(mondayIso: string): string {
  const mon = fromISO(mondayIso);
  const fri = fromISO(addDays(mondayIso, 4));
  const left = `${mon.getMonth() + 1}/${mon.getDate()}`;
  const right = mon.getMonth() === fri.getMonth() ? `${fri.getDate()}` : `${fri.getMonth() + 1}/${fri.getDate()}`;
  return `${left}-${right}`;
}

export function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = fromISO(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];
export function longDate(iso: string): string {
  const d = fromISO(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`;
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
