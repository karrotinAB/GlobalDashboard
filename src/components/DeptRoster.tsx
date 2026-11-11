// 팀장님·이사님 홈 오른쪽: 부서원 출퇴근 (1조·2조·3조·무역사무 골라 보기). 상태메시지 없이 근태만 작게
import { useState, type CSSProperties } from 'react';
import { useSpaceData, useStore } from '../data/store';
import { TEAMS, teamLabel } from '../lib/team';
import { attendanceOf } from '../lib/mem';
import { characterSrc, charOf } from './ui';
import type { Attendance, Member } from '../types';

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + (m || 0);
};
const ampm = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
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
  let line: string;
  let left = '';
  let tone = '';
  if (!r) {
    line = '근태 정보 없음';
    tone = 'none';
  } else if (out) {
    line = '퇴근했어요 👋';
    tone = 'off';
  } else if (r.end && working) {
    const min = toMin(r.end) - nowMin;
    line = `${ampm(r.end)} 퇴근 예정`;
    left = min > 0 ? `${dur(min)} 남음` : '퇴근 시간 지남';
    tone = 'on';
  } else {
    line = r.status; // 근무전 · 연차 · 출장 …
    tone = r.status === '근무전' ? 'none' : 'away';
  }
  return (
    <div className={`mini-card ${tone}`} style={{ '--c': m.color } as CSSProperties}>
      <img className="mini-char" src={characterSrc(charOf(m))} alt="" />
      <div className="mini-main">
        <b>{m.name}</b>
        <span className="mini-line">{line}</span>
        <span className="mini-sub">
          {left && <span>{left}</span>}
          {r?.start && working && !out && <span>출근 {ampm(r.start)}</span>}
          {r?.period && <span className="mini-period">⏱ {r.period}</span>}
        </span>
      </div>
    </div>
  );
}
