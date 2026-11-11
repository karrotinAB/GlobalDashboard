// 관리자: 위쪽에서 1~3조 / 팀장님·이사님 대시보드를 골라 보기
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { isPersonal, setViewTeam, teamLabel, TEAMS } from '../lib/team';
import { ROLE_NAME, useAccess, type Role } from './AuthGate';

export default function TeamSwitch() {
  const { role, viewTeam } = useAccess();
  const [spaces, setSpaces] = useState<{ id: string; label: string }[]>([]);

  // 팀장님·이사님 개인 대시보드 목록 (관리자만 roles 를 읽을 수 있음)
  useEffect(() => {
    if (DATA_MODE === 'local' || role !== 'admin') return;
    return onSnapshot(
      collection(db, 'roles'),
      (snap) =>
        setSpaces(
          snap.docs
            .filter((d) => (d.get('level') === 'lead' || d.get('level') === 'director') && isPersonal(d.get('space')))
            .map((d) => {
              const name = (d.get('name') as string | undefined) || d.id.split('@')[0];
              return { id: d.get('space') as string, label: `${name} (${ROLE_NAME[d.get('level') as Role]})` };
            })
            .sort((a, b) => a.label.localeCompare(b.label)),
        ),
      () => setSpaces([]),
    );
  }, [role]);

  const all = [...TEAMS.map((t) => ({ id: t as string, label: teamLabel(t) })), ...spaces];
  return (
    <select
      className="top-btn team-switch"
      value={viewTeam}
      onChange={(e) => setViewTeam(e.target.value, all.find((x) => x.id === e.target.value)?.label)}
      title="관리자: 다른 조 · 팀장님·이사님 대시보드 보기"
    >
      {TEAMS.map((t) => (
        <option key={t} value={t}>
          {teamLabel(t)}
        </option>
      ))}
      {spaces.length > 0 && (
        <optgroup label="개인 대시보드">
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </optgroup>
      )}
      {isPersonal(viewTeam) && !spaces.some((s) => s.id === viewTeam) && <option value={viewTeam}>개인 대시보드</option>}
    </select>
  );
}
