// 팀장님·이사님 홈 오른쪽: 부서원 출퇴근 (1조·2조·3조·무역사무 골라 보기). 상태메시지 없이 근태만 작게
import { useState, type CSSProperties } from 'react';
import { useSpaceData, useStore } from '../data/store';
import { TEAMS, teamLabel } from '../lib/team';
import { attendanceOf } from '../lib/mem';
import { characterSrc, charOf } from './ui';
import { usePeople } from './AddressBook';
import { useProfiles, withProfile } from '../lib/profiles';
import type { Attendance, Member } from '../types';

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const dur = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h}시간 ${m}분` : h ? `${h}시간` : `${m}분`;
};

type Tab = '1' | '2' | '3' | 'trade';

export default function DeptRoster({ todayIso, nowMin }: { todayIso: string; nowMin: number }) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      return (localStorage.getItem('gd:rosterTab') as Tab) || '2';
    } catch {
      return '2';
    }
  });
  const pick = (t: Tab) => {
    setTab(t);
    try {
      localStorage.setItem('gd:rosterTab', t);
    } catch {
      /* 무시 */
    }
  };
  const { data } = useStore();
  // 조 담당자는 그 조 저장소에서 (팀장님·이사님은 읽기 가능), 무역사무는 공용
  const team = useSpaceData(tab === 'trade' ? '2' : tab, ['members']);
  const people: Member[] =
    tab === 'trade'
      ? [...data.tradeMembers].sort((a, b) => a.order - b.order)
      : [...((team.data.members as Member[]) ?? [])].sort((a, b) => a.order - b.order);

  return (
    <div className="roster">
      <div className="roster-tabs">
        {TEAMS.map((t) => (
          <button key={t} className={`cchip ${tab === t ? 'on' : ''}`} onClick={() => pick(t)}>
            {teamLabel(t)}
          </button>
        ))}
        <button className={`cchip ${tab === 'trade' ? 'on' : ''}`} onClick={() => pick('trade')}>
          무역사무
        </button>
      </div>
      {tab !== 'trade' && !team.ready ? (
        <p className="muted small">불러오는 중…</p>
      ) : people.length === 0 ? (
        <p className="muted small">아직 담당자가 없어요.</p>
      ) : (
        <div className="roster-grid">
          {people.map((m) => (
            <MiniCard key={m.id} m={m} r={attendanceOf(m, todayIso, [], data.memAttendance)} nowMin={nowMin} />
          ))}
        </div>
      )}
    </div>
  );
}

function MiniCard({ m, r, nowMin }: { m: Member; r?: Attendance; nowMin: number }) {
  const out = !!r && r.status.includes('퇴근');
  const working = !!r && (r.status === '근무' || out);
  // 대체시차 · 반차 · 외출: 하루 종일 쉬는 게 아니라 일부 시간만 (예: '대체시차 10:00~11:00')
  const shift = !!r && /시차|반차|외출|조퇴|지각/.test(`${r.status} ${r.period ?? ''}`);
  const tm = r?.period?.match(/(\d{1,2}):(\d{2})\s*[~\-–]\s*(\d{1,2}):(\d{2})/);
  const shiftAt = tm ? ([Number(tm[1]) * 60 + Number(tm[2]), Number(tm[3]) * 60 + Number(tm[4])] as const) : null;
  // 위쪽 색 띠: 작은 글씨(무엇) + 큰 글씨(시각/상태) + 옆 설명
  let label = '오늘';
  let big = '—';
  let side = '';
  let tone = '';
  if (!r) {
    side = '근태 정보 없음';
    tone = 'none';
  } else if (out) {
    label = '퇴근';
    big = r.end ? ampm(r.end) : '퇴근';
    side = '퇴근했어요 👋';
    tone = 'off';
  } else if (r.end && (working || shift)) {
    // 근무 중 (대체시차 · 반차 · 외출을 썼으면 그만큼 당겨진 퇴근 시각)
    const min = toMin(r.end) - nowMin;
    label = '퇴근 예정';
    big = ampm(r.end);
    side = min > 0 ? `퇴근까지 ${dur(min)}` : '퇴근 시간 지남';
    tone = 'on';
  } else if (shift && shiftAt) {
    // 아직 출근 전인데 시차를 씀: 아침 쪽이면 '출근 예정', 오후 쪽이면 '퇴근 예정'
    const [a, b] = shiftAt;
    label = a < 12 * 60 ? '출근 예정' : '퇴근 예정';
    big = ampm(hm(a < 12 * 60 ? b : a));
    side = r.period ?? r.status;
    tone = 'on';
  } else {
    big = r.status; // 근무전 · 연차 · 출장 …
    side = r.period ?? (r.status === '근무전' ? '아직 출근 전이에요' : '');
    tone = r.status === '근무전' ? 'none' : 'away';
  }
  const [t, p] = big.split(' ');
  return (
    <div className={`mini-card ${tone}`} style={{ '--c': m.color } as CSSProperties}>
      <div className="mini-band">
        <div className="mini-band-main">
          <span className="mini-band-label">{label}</span>
          <span className="mini-band-big">
            {t}
            {p && <small>{p}</small>}
          </span>
        </div>
        {/* 설명 줄이 없어도 자리는 둬서 옆 카드와 색 띠 높이가 같게 */}
        <span className="mini-band-side">{side || '\u00a0'}</span>
      </div>
      <div className="mini-body">
        <img className="mini-char" src={characterSrc(charOf(m))} alt="" />
        <div className="mini-main">
          <b>{m.name}</b>
          <span className="mini-sub">
            {r?.start && (working || shift) && !out && <span>출근 {ampm(r.start)}</span>}
            {r?.period && (working || shift) && r.end && <span className="mini-period">⏱ {r.period}</span>}
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------- 우리 부서 오늘: 우리 조(쪽) 빼고 부서원 전부 (이사님 · 팀장님 · 1~3조 · 무역사무) ----------
export type DeptSide = '1' | '2' | '3' | 'trade' | 'leader';
const short = (n: string) => (/^[가-힣]{3}$/.test(n) ? n.slice(1) : n);
/** 근태: 카드 이름(mem 이름) → 안 맞으면 사용자 목록 · 주소록 이름으로도 찾아봄 */
function attOf(m: Member, todayIso: string, shared: Parameters<typeof attendanceOf>[3], alt: string[]) {
  const r = attendanceOf(m, todayIso, [], shared);
  if (r) return r;
  for (const n of alt.filter(Boolean)) {
    const x = attendanceOf({ ...m, memName: n }, todayIso, [], shared);
    if (x) return x;
  }
  return undefined;
}
export function DeptToday({ side, todayIso, nowMin, myEmail }: { side: DeptSide; todayIso: string; nowMin: number; myEmail?: string }) {
  const { data } = useStore();
  const { roles, contacts } = usePeople();
  const t1 = useSpaceData(side === '1' ? '' : '1', side === '1' ? [] : ['members']);
  const t2 = useSpaceData(side === '2' ? '' : '2', side === '2' ? [] : ['members']);
  const t3 = useSpaceData(side === '3' ? '' : '3', side === '3' ? [] : ['members']);
  const byTeam: Record<string, Member[]> = { '1': (t1.data.members as Member[]) ?? [], '2': (t2.data.members as Member[]) ?? [], '3': (t3.data.members as Member[]) ?? [] };
  const me = (myEmail ?? '').toLowerCase();
  // 이메일 → 사용자 목록 · 주소록 이름 (근태 이름 찾기용)
  const altNames = (email?: string) => {
    const e = (email ?? '').toLowerCase();
    if (!e) return [];
    return [contacts[e]?.name ?? '', roles?.find((r) => r.email === e)?.name ?? ''];
  };
  const leaders = (roles ?? [])
    .filter((r) => r.role === 'director' || r.role === 'lead')
    .sort((a, b) => (a.role === b.role ? 0 : a.role === 'director' ? -1 : 1))
    .map((r) => {
      const full = contacts[r.email]?.name || r.name || r.email.split('@')[0];
      return { m: { id: r.email, name: full, color: '#b38a7d', order: 0, email: r.email } as Member, label: r.role === 'director' ? '이사님' : '팀장님', space: r.space };
    });
  const groups: { key: string; label: string; people: Member[] }[] = [
    ...(side === 'leader' ? [] : [{ key: 'leader', label: '이사님 · 팀장님', people: leaders.map((x) => x.m) }]),
    ...TEAMS.filter((t) => t !== side).map((t) => ({ key: t, label: teamLabel(t), people: [...byTeam[t]].sort((a, b) => a.order - b.order) })),
    ...(side === 'trade' ? [] : [{ key: 'trade', label: '무역사무', people: [...data.tradeMembers].sort((a, b) => a.order - b.order) }]),
  ]
    .map((g) => ({ ...g, people: g.people.filter((p) => !me || (p.email ?? '').toLowerCase() !== me) }))
    .filter((g) => g.people.length);
  const loading = !roles || [t1, t2, t3].some((t, i) => String(i + 1) !== side && !t.ready);
  return (
    <div className="dept-today">
      {/* 조 구분 없이 한 판에 쭉 (이사님 · 팀장님 → 1조 → 2조 → 3조 → 무역사무 순서) */}
      <div className="roster-grid dept-grid">
        {groups.flatMap((g) =>
          g.people.map((m) => {
            if (g.key === 'leader') {
              const L = leaders.find((x) => x.m.id === m.id);
              return <LeaderMini key={m.id} m={m} label={L?.label ?? ''} space={L?.space} todayIso={todayIso} nowMin={nowMin} alt={altNames(m.email)} />;
            }
            return <MiniCard key={m.id} m={m} r={attOf(m, todayIso, data.memAttendance, altNames(m.email))} nowMin={nowMin} />;
          }),
        )}
      </div>
      {loading && <p className="muted small">불러오는 중…</p>}
      {!loading && !groups.length && <p className="muted small">보여줄 부서원이 없어요.</p>}
    </div>
  );
}

/** '우리 팀 오늘' ↔ '우리 부서 오늘' 바꾸기 (이 브라우저에 기억) */
export function useDeptView(): [boolean, () => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem('gd:deptView') === '1';
    } catch {
      return false;
    }
  });
  const flip = () =>
    setOn((v) => {
      try {
        localStorage.setItem('gd:deptView', v ? '0' : '1');
      } catch {
        /* 무시 */
      }
      return !v;
    });
  return [on, flip];
}
export function DeptToggle({ on, onFlip }: { on: boolean; onFlip: () => void }) {
  return (
    <button type="button" className="dept-toggle" onClick={onFlip} title={on ? '우리 팀 카드로 돌아가기' : '다른 조 · 무역사무 · 팀장님 · 이사님 출근 상태 보기'}>
      {on ? '‹ 우리 팀 오늘' : '우리 부서 오늘 ›'}
    </button>
  );
}

/** 이사님 · 팀장님 카드: 그분 개인 대시보드의 '오늘의 나' 카드에서 캐릭터 · 색 · mem 이름을 가져옴 */
function LeaderMini({ m, label, space, todayIso, nowMin, alt }: { m: Member; label: string; space?: string; todayIso: string; nowMin: number; alt: string[] }) {
  const { data } = useStore();
  const sp = useSpaceData(space ?? '', space ? ['members'] : []);
  const mine = ((sp.data.members as Member[]) ?? []).find((x) => (x.email ?? '').toLowerCase() === (m.email ?? '').toLowerCase()) ?? ((sp.data.members as Member[]) ?? [])[0];
  const { profiles } = useProfiles();
  // 사람 정보(합친 것)가 있으면 그게 먼저 · 없으면 그분 개인 대시보드 카드
  const card: Member = withProfile(mine ? { ...m, character: mine.character, color: mine.color || m.color, memName: mine.memName || mine.name, id: mine.id } : m, profiles);
  return <MiniCard m={{ ...card, name: `${short(m.name)} ${label}` }} r={attOf(card, todayIso, data.memAttendance, [...alt, m.name])} nowMin={nowMin} />;
}
