// 팀장님·이사님: 새 보고가 올라오면 내 '주간 할일'에 "N조의 보고 확인하기: [제목]" 을 자동으로 넣고,
// 보고방에서 확인 체크하면 그 할일이 완료로 (체크를 풀면 다시 안 함으로)
import { useEffect, useRef } from 'react';
import { useAccess } from './AuthGate';
import { useStore } from '../data/store';
import { isPersonal } from '../lib/team';
import { isLeaderRole, useReports } from '../lib/reports';
import { today, uid } from '../lib/date';
import type { Task } from '../types';

export default function ReportTaskSync() {
  const { role, viewTeam } = useAccess();
  const on = isLeaderRole(role) && isPersonal(viewTeam);
  const reports = useReports(on ? null : undefined);
  const { data, save, loading } = useStore();
  const busy = useRef(new Set<string>());
  useEffect(() => {
    if (!on || loading || !reports || !isLeaderRole(role)) return;
    const cfg = data.config.find((c) => c.id === 'reportTasks');
    const handled = new Set(cfg?.reportIds ?? []);
    const byReport = new Map(data.tasks.filter((t) => t.reportId).map((t) => [t.reportId!, t]));
    let order = Math.max(0, ...data.tasks.map((t) => t.order));
    const newly: string[] = [];
    for (const r of reports) {
      const check = r.checks?.[role];
      const title = `${r.team}조의 보고 확인하기: ${r.title}`;
      const t = byReport.get(r.id);
      if (!t) {
        // 처음 보는 보고만 (지운 할일은 다시 안 만듦)
        if (handled.has(r.id) || busy.current.has(r.id)) continue;
        busy.current.add(r.id);
        newly.push(r.id);
        const task: Task = {
          id: uid(),
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
    if (newly.length) save('config', { ...(cfg ?? { id: 'reportTasks' }), reportIds: [...handled, ...newly] });
  }, [on, loading, reports, data.tasks, data.config, role, save]);
  return null;
}
