import type { Attendance, MemAttendance, Member } from '../types';

/**
 * mem 연동 (북마크 버튼 방식)
 * mem 의 "부서 근태 현황" 창(li.user_gubn 목록)을 연 상태에서 북마크를 누르면
 * 우리 조 사람 줄만 읽어서 대시보드 #/import 로 넘김. 데이터는 주소의 # 뒤에만 실려서 서버로 가지 않음.
 */
export interface MemRow {
  name: string;
  status: string;
  start?: string;
  end?: string;
  period?: string;
}

/** 북마크 이름 목록: memName 이 있으면 그것, 없으면 대시보드 이름 */
export function memNames(members: Member[]): string[] {
  return members.map((m) => (m.memName || m.name).trim()).filter(Boolean);
}

/** 이름 맞추기: 정확히 같거나, mem 이름이 대시보드 이름으로 끝나면 (홍길동 ← 길동) */
export function matchMember(members: Member[], memName: string): Member | undefined {
  return (
    members.find((m) => m.memName && m.memName.trim() === memName) ??
    members.find((m) => !m.memName && (memName === m.name || memName.endsWith(m.name)))
  );
}

// 북마크 안에서 도는 코드 (mem 페이지에서 실행됨). 오래된 브라우저도 되게 ES5로 씀
const RUNNER = `(function(N,D){
var t=function(s){return (s||'').replace(/\\s+/g,' ').trim();};
var L=[].slice.call(document.querySelectorAll('li.user_gubn'));
if(!L.length){alert('mem에서 부서 근태 현황 창을 연 상태에서 눌러 주세요.');return;}
var R=[];
L.forEach(function(li){
  var c=li.children; if(c.length<2)return;
  var tm=c[0].querySelectorAll('span');
  var nm=c[1].querySelector('.bold'); if(!nm||!nm.firstChild)return;
  var name=t(nm.firstChild.textContent);
  if(!N.some(function(n){return name===n||name.slice(-n.length)===n;}))return;
  var ps=c[2]?c[2].querySelectorAll('span'):[];
  R.push({name:name,start:t(tm[0]&&tm[0].textContent),end:t(tm[1]&&tm[1].textContent),
    status:t(c[1].children[1]&&c[1].children[1].textContent),period:t(ps[1]&&ps[1].textContent)});
});
if(!R.length){alert('우리 조 이름을 못 찾았어요. 대시보드 설정에서 mem 이름을 확인해 주세요.');return;}
var d=new Date(),p=function(x){return ('0'+x).slice(-2);};
var day=d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
window.open(D+'#/import?d='+encodeURIComponent(JSON.stringify({date:day,rows:R})),'gd-dashboard');
})`;

export function bookmarklet(dashboardUrl: string, names: string[]): string {
  const code = `${RUNNER}(${JSON.stringify(names)},${JSON.stringify(dashboardUrl)})`;
  return 'javascript:' + encodeURIComponent(code.replace(/\n\s*/g, ''));
}

const TIME = /^\d{1,2}:\d{2}$/;
const clip = (v: unknown, n = 40) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

/** #/import?d=... 로 받은 데이터를 검증해서 근태 기록으로 바꿈 */
export function parseImport(raw: string | null, members: Member[]): { records: Attendance[]; unmatched: string[] } | null {
  if (!raw) return null;
  let parsed: { date?: unknown; rows?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const date = clip(parsed.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(parsed.rows)) return null;
  const now = new Date().toISOString();
  const records: Attendance[] = [];
  const unmatched: string[] = [];
  for (const r of parsed.rows.slice(0, 200) as Record<string, unknown>[]) {
    const name = clip(r?.name, 20);
    const m = matchMember(members, name);
    if (!m) {
      if (name) unmatched.push(name);
      continue;
    }
    const start = clip(r.start, 5);
    const end = clip(r.end, 5);
    records.push({
      id: `${date}_${m.id}`,
      memberId: m.id,
      date,
      status: clip(r.status, 20) || '근무',
      start: TIME.test(start) ? start : undefined,
      end: TIME.test(end) ? end : undefined,
      period: clip(r.period, 40) || undefined,
      source: 'mem',
      updatedAt: now,
    });
  }
  return { records, unmatched };
}

/** 공용 근태함에서 찾는 이름 */
export const memKey = (m: Member) => (m.memName || m.name).trim();

/** mem 에서 받은 줄 → 공용 근태함 기록 (공용 이름 목록에 있는 사람만) */
export function sharedRecords(raw: string, names: string[]): MemAttendance[] {
  const pseudo = [...new Set(names)].map((n) => ({ id: n, name: n, color: '', order: 0 }) as Member);
  const res = parseImport(raw, pseudo);
  if (!res) return [];
  return res.records.map((r) => ({ ...r, id: `${r.date}_${r.memberId}`, name: r.memberId, memberId: '' }));
}

/** 오늘 이 사람 근태: 내 공간 기록이 있으면 그것, 없으면 공용 근태함 */
export function attendanceOf(m: Member, date: string, own: Attendance[], shared: MemAttendance[]): Attendance | undefined {
  return own.find((a) => a.date === date && a.memberId === m.id) ?? shared.find((a) => a.date === date && a.name === memKey(m));
}
