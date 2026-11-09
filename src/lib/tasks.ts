import type { Member, Task } from '../types';
import { addDays, weekEnd } from './date';

/**
 * 주간 뷰 로직 (시트 복사 대신 자동으로 주 단위로 보여줌)
 * - 그 주가 끝나기 전에 만들어졌고
 * - 아직 안 끝났거나, 그 주(월~일) 안에 완료된 할일
 * 지난주는 "그 주 일요일 기준" 상태로 보여줌 → 금요일에 멈춰둔 시트와 같은 효과
 */
export function tasksForWeek(tasks: Task[], monday: string): { task: Task; doneInWeek: boolean }[] {
  const sunday = weekEnd(monday);
  return tasks
    .filter((t) => t.createdAt <= sunday && (!t.done || !t.doneAt || t.doneAt >= monday))
    .map((t) => ({ task: t, doneInWeek: t.done && (!t.doneAt || t.doneAt <= sunday) }));
}

export type DueState = 'overdue' | 'today' | 'tomorrow' | 'later' | 'none';

export function dueState(t: Task, todayIso: string): DueState {
  if (!t.dueDate) return 'none';
  if (t.dueDate < todayIso) return 'overdue';
  if (t.dueDate === todayIso) return 'today';
  if (t.dueDate === addDays(todayIso, 1)) return 'tomorrow';
  return 'later';
}

export interface MemberSummary {
  member: Member;
  total: number;
  done: number;
  remaining: number;
  dueToday: number;
  dueTomorrow: number;
  overdue: number;
}

export function summarize(
  rows: { task: Task; doneInWeek: boolean }[],
  members: Member[],
  todayIso: string,
): MemberSummary[] {
  return members.map((member) => {
    const mine = rows.filter((r) => r.task.assigneeIds.includes(member.id));
    const open = mine.filter((r) => !r.doneInWeek);
    return {
      member,
      total: mine.length,
      done: mine.length - open.length,
      remaining: open.length,
      dueToday: open.filter((r) => dueState(r.task, todayIso) === 'today').length,
      dueTomorrow: open.filter((r) => dueState(r.task, todayIso) === 'tomorrow').length,
      overdue: open.filter((r) => dueState(r.task, todayIso) === 'overdue').length,
    };
  });
}
