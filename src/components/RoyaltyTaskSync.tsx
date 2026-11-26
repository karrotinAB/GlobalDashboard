// 로열티 업체: 매달 첫 주(1~7일)에 주간 할일 'N월 로열티 받기' 를 한 번 만듦 (N = 지난달 — 지난달 판매분 로열티)
//   조 대시보드에서만 (팀장님 · 이사님 개인 공간 · IT팀 · 무역사무는 안 만듦) · 한 번 만든 건 지워도 다시 안 만듦 (config 'royaltyTasks')
//   로열티 시작한 달(royaltyFrom) 전 달 것은 안 만듦 · 구분 '그외' 업체는 안 만듦
import { useEffect, useRef } from 'react';
import { useAccess } from './AuthGate';
import { useStore } from '../data/store';
import { TEAMS } from '../lib/team';
import { today } from '../lib/date';
import type { Task } from '../types';

export default function RoyaltyTaskSync() {
  const { role, viewTeam, auditor } = useAccess();
  const { data, save, loading } = useStore();
  const busy = useRef(new Set<string>());
  const on = !auditor && (role === 'admin' || role === 'member' || role === null) && (TEAMS as readonly string[]).includes(viewTeam);
  useEffect(() => {
    if (!on || loading) return;
    const t = today(); // YYYY-MM-DD
    if (Number(t.slice(8, 10)) > 7) return; // 첫 주 (1~7일)에만
    const y = Number(t.slice(0, 4));
    const m = Number(t.slice(5, 7));
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; // 지난달
    const label = `${Number(prev.slice(5))}월 로열티 받기`;
    const cfg = data.config.find((c) => c.id === 'royaltyTasks');
    const handled = new Set(cfg?.royaltyKeys ?? []);
    let order = Math.max(0, ...data.tasks.map((x) => x.order));
    const newly: string[] = [];
    for (const c of data.companies) {
      if (c.team || !c.royalty || c.kind === 'other') continue; // 우리 조 업체만
      if (c.royaltyFrom && prev < c.royaltyFrom) continue; // 로열티 시작 전 달
      const key = `${c.id}_${prev}`;
      const id = `ry_${key}`; // 정해진 id: 여러 기기에서 동시에 만들어도 하나로
      if (handled.has(key) || busy.current.has(key) || data.tasks.some((x) => x.id === id)) continue;
      busy.current.add(key);
      newly.push(key);
      const task: Task = {
        id,
        companyId: c.id,
        title: label,
        assigneeIds: [],
        done: false,
        dueDate: `${t.slice(0, 8)}07`, // 그 달 7일까지
        order: ++order,
        createdAt: t,
      };
      save('tasks', task);
    }
    if (newly.length) save('config', { ...(cfg ?? { id: 'royaltyTasks' }), royaltyKeys: [...new Set([...handled, ...newly])] });
  }, [on, loading, data.companies, data.tasks, data.config, save]);
  return null;
}
