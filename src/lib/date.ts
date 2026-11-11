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

/** 부드러운 색 모음 (담당자·업체·묶음 기본 색) */
export const PALETTE = [
  '#9c4a6e', '#3f6fb8', '#c8742a', '#5f8a4e', '#8e5a8a', '#3f8f8a', '#b5543c', '#7a6a4f',
  '#c0587a', '#4f7cae', '#d08a2e', '#6b9e5b', '#a46bb8', '#2f8f9e', '#d0644f', '#8a7d5c',
  '#e0839c', '#7aa3d6', '#e3a75c', '#8fbf7a', '#b98fd0', '#6fbfbf', '#e58e7a', '#a8996f',
];

/** 아직 안 쓴 색을 무작위로 (다 썼으면 비슷하지 않은 새 색을 만듦) */
export function pickColor(used: (string | undefined)[]): string {
  const taken = new Set(used.filter(Boolean).map((c) => c!.toLowerCase()));
  const free = PALETTE.filter((c) => !taken.has(c.toLowerCase()));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  const h = Math.floor(Math.random() * 360);
  const s = 45 + Math.floor(Math.random() * 20);
  const l = 45 + Math.floor(Math.random() * 15);
  // HSL → HEX (색 고르기 칸이 #rrggbb 만 받음)
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(v * 255).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}
