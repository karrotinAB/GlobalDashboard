// 팀장님·이사님: 새 보고가 올라오면 내 '주간 할일'에 "N조의 보고 확인하기: [제목]" 을 자동으로 넣고,
// 보고방에서 확인 체크하면 그 할일이 완료로 (체크를 풀면 다시 안 함으로)
import { useEffect, useRef } from 'react';
import { useAccess } from './AuthGate';
import { useStore } from '../data/store';
import { isPersonal } from '../lib/team';
import { isLeaderRole, needsCheck, useReports, useSpaceCheckRole } from '../lib/reports';
import { usePeople } from './AddressBook';
import { today } from '../lib/date';
import type { Task } from '../types';

export default function ReportTaskSync() {
  const { role: myRole, viewTeam } = useAccess();
  // 팀장님·이사님 본인, 또는 관리자가 그 대시보드를 볼 때 (주인의 칸으로)
  const personal = isPersonal(viewTeam);
  const { roles } = usePeople(personal && myRole === 'admin');
  const role = useSpaceCheckRole(myRole, viewTeam, roles);
  const on = personal && !!role;
  const reports = useReports(on ? null : undefined);
  const { data, save, remove, loading } = useStore();
  const busy = useRef(new Set<string>());
  useEffect(() => {
    if (!on || loading || !reports || !isLeaderRole(role)) return;
    const cfg = data.config.find((c) => c.id === 'reportTasks');
    const handled = new Set(cfg?.reportIds ?? []);
    // 같은 보고 할일이 둘 이상이면 (두 기기에서 동시에 만든 경우) 하나만 남김 — 완료된 것 우선
    const byReport = new Map<string, Task>();
    for (const t of data.tasks.filter((x) => x.reportId).sort((a, b) => Number(!!b.done) - Number(!!a.done) || a.order - b.order)) {
      if (!byReport.has(t.reportId!)) byReport.set(t.reportId!, t);
      else if (!busy.current.has(`rm:${t.id}`)) {
        busy.current.add(`rm:${t.id}`);
        remove('tasks', t.id);
      }
    }
    let order = Math.max(0, ...data.tasks.map((t) => t.order));
    const newly: string[] = [];
    for (const r of reports) {
      // 이 분이 확인자인 보고만 (확인자에서 빠지면 아직 안 한 할일은 지움)
      if (!needsCheck(r, role)) {
        const t0 = byReport.get(r.id);
        if (t0 && !t0.done) remove('tasks', t0.id);
        continue;
      }
      const check = r.checks?.[role];
      const title = `${r.team === 'trade' ? '무역사무' : `${r.team}조`}의 보고 확인하기: ${r.title}`;
      const t = byReport.get(r.id);
      if (!t) {
        // 처음 보는 보고만 (지운 할일은 다시 안 만듦)
        //  + 첫 번째 고치기에서 확인자로 다시 넣었으면 한 번 더 (그것도 한 번만)
        const reKey = `${r.id}#re`;
        const again = !!r.retask?.includes(role) && !handled.has(reKey);
        if ((handled.has(r.id) && !again) || busy.current.has(again ? reKey : r.id)) continue;
        busy.current.add(r.id);
        if (again) busy.current.add(reKey);
        newly.push(r.id);
        if (again) newly.push(reKey);
        const task: Task = {
          id: `rp_${r.id}${again ? '_re' : ''}`, // 정해진 id: 여러 기기에서 동시에 만들어도 하나로 겹침
          companyId: null,
          title,
          assigneeIds: [],
          done: !!check,
          doneAt: check ? check.at.slice(0, 10) : undefined,
          order: ++order,
          createdAt: r.createdAt.slice(0, 10) || today(),
          reportId: r.id,
          reportTeam: r.team,
        };
        save('tasks', task);
        continue;
      }
      // 확인 체크 ↔ 할일 완료, 제목 바뀌면 따라가기
      const done = !!check;
      if (t.done !== done || t.title !== title) save('tasks', { ...t, title, done, doneAt: done ? check!.at.slice(0, 10) : undefined });
    }
    if (newly.length) save('config', { ...(cfg ?? { id: 'reportTasks' }), reportIds: [...new Set([...handled, ...newly])] });
  }, [on, loading, reports, data.tasks, data.config, role, save, remove]);
  return null;
}
