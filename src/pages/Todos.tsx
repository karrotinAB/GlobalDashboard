import { useMemo, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { addDays, shortDate, today, uid, weekLabel, weekStart } from '../lib/date';
import { dueState, summarize, tasksForWeek, type MemberSummary } from '../lib/tasks';
import type { Company, Member, Task } from '../types';
import { Avatar, characterSrc, CompanyDot, Empty, Field, MemberChip, MemberPicker, Modal, Ring } from '../components/ui';

type GroupBy = 'company' | 'member' | 'due';
type StatusFilter = 'all' | 'open' | 'done';
type Row = { task: Task; doneInWeek: boolean };
type Group = { key: string; title: string; color?: string; company?: Company; member?: Member; rows: Row[] };

export default function Todos() {
  const { data, save, remove } = useStore();
  const { members, companies, memberById, companyById } = useLookups();
  const todayIso = today();
  const thisMonday = weekStart(todayIso);

  const [monday, setMonday] = useState(thisMonday);
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c') ?? '');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('company');
  const [editing, setEditing] = useState<Task | null>(null);

  const isPast = monday < thisMonday;
  const isFuture = monday > thisMonday;
  const readOnly = isPast;

  const weekRows = useMemo(() => tasksForWeek(data.tasks, monday), [data.tasks, monday]);
  const summary = useMemo(() => summarize(weekRows, members, todayIso), [weekRows, members, todayIso]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return weekRows.filter(({ task, doneInWeek }) => {
      if (memberFilter === '__none') {
        if (task.assigneeIds.length) return false;
      } else if (memberFilter && !task.assigneeIds.includes(memberFilter)) return false;
      if (companyFilter && (task.companyId ?? '') !== companyFilter) return false;
      if (status === 'open' && doneInWeek) return false;
      if (status === 'done' && !doneInWeek) return false;
      if (query) {
        const hay = `${task.title} ${task.note ?? ''} ${task.dueText ?? ''} ${companyById.get(task.companyId ?? '')?.name ?? ''}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [weekRows, memberFilter, companyFilter, status, q, companyById]);

  const groups = useMemo((): Group[] => {
    const sortRows = (rows: typeof filtered) => [...rows].sort((a, b) => a.task.order - b.task.order);
    if (groupBy === 'company') {
      const out: Group[] = companies.map((c) => ({
        key: c.id,
        title: c.name,
        color: c.color,
        company: c,
        rows: sortRows(filtered.filter((r) => r.task.companyId === c.id)),
      }));
      const etc = filtered.filter((r) => !r.task.companyId || !companyById.has(r.task.companyId));
      if (etc.length) out.push({ key: '__etc', title: '기타 / 업체 없음', rows: sortRows(etc) });
      // 필터가 걸려 있으면 빈 업체는 숨김
      const anyFilter = memberFilter || companyFilter || status !== 'all' || q;
      return anyFilter ? out.filter((g) => g.rows.length) : out;
    }
    if (groupBy === 'member') {
      const out: Group[] = members.map((m) => ({
        key: m.id,
        title: m.name,
        color: m.color,
        member: m,
        rows: sortRows(filtered.filter((r) => r.task.assigneeIds.includes(m.id))),
      }));
      const none = filtered.filter((r) => !r.task.assigneeIds.length);
      if (none.length) out.push({ key: '__none', title: '담당자 미정', rows: sortRows(none) });
      return out.filter((g) => g.rows.length);
    }
    // 마감일 순
    const order: Record<string, number> = { overdue: 0, today: 1, tomorrow: 2, later: 3, none: 4 };
    const labels: Record<string, string> = {
      overdue: '기한 지남 (아직 해결중)',
      today: '오늘까지',
      tomorrow: '내일까지',
      later: '그 이후',
      none: '마감일 없음',
    };
    const buckets = new Map<string, typeof filtered>();
    for (const r of filtered) {
      const s = r.doneInWeek ? 'done' : dueState(r.task, todayIso);
      if (!buckets.has(s)) buckets.set(s, []);
      buckets.get(s)!.push(r);
    }
    return [...buckets.entries()]
      .sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9))
      .map(([k, rows]) => ({
        key: k,
        title: k === 'done' ? '완료' : labels[k],
        rows: [...rows].sort((a, b) => (a.task.dueDate ?? '9999').localeCompare(b.task.dueDate ?? '9999')),
      }));
  }, [groupBy, filtered, companies, members, companyById, memberFilter, companyFilter, status, q, todayIso]);

  const toggleDone = (t: Task) => {
    if (readOnly) return;
    save('tasks', t.done ? { ...t, done: false, doneAt: undefined } : { ...t, done: true, doneAt: todayIso });
  };

  const newTask = (companyId: string | null, assigneeIds: string[] = []): Task => ({
    id: uid(),
    companyId,
    title: '',
    assigneeIds,
    done: false,
    order: Math.max(0, ...data.tasks.map((t) => t.order)) + 1,
    createdAt: isFuture ? monday : todayIso,
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주간 할일</h1>
          <p className="muted">
            시트를 매주 복사할 필요 없이, 안 끝난 일은 자동으로 다음 주로 넘어가요. 지난주는 그 주 기준 상태로 보관돼요.
          </p>
        </div>
        <div className="week-nav">
          <button onClick={() => setMonday(addDays(monday, -7))} aria-label="이전 주">
            ◀
          </button>
          <div className="week-label">
            <strong>할일 ({weekLabel(monday)})</strong>
            {monday === thisMonday ? <span className="tag">이번주</span> : isPast ? <span className="tag gray">지난주 보관</span> : <span className="tag">예정</span>}
          </div>
          <button onClick={() => setMonday(addDays(monday, 7))} aria-label="다음 주">
            ▶
          </button>
          {monday !== thisMonday && (
            <button className="link" onClick={() => setMonday(thisMonday)}>
              이번주로
            </button>
          )}
        </div>
      </div>

      <SummaryTable summary={summary} selected={memberFilter} onSelect={(id) => setMemberFilter(id === memberFilter ? null : id)} />

      <div className="toolbar">
        <div className="seg">
          <button className={!memberFilter ? 'on' : ''} onClick={() => setMemberFilter(null)}>
            전체
          </button>
          {members.map((m) => (
            <button
              key={m.id}
              className={memberFilter === m.id ? 'on' : ''}
              onClick={() => setMemberFilter(memberFilter === m.id ? null : m.id)}
            >
              {m.name}
            </button>
          ))}
          <button className={memberFilter === '__none' ? 'on' : ''} onClick={() => setMemberFilter(memberFilter === '__none' ? null : '__none')}>
            미정
          </button>
        </div>
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">모든 업체</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
          <option value="all">완료 포함</option>
          <option value="open">미완료만</option>
          <option value="done">완료만</option>
        </select>
        <input className="search" placeholder="할일 / 비고 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          <button className={groupBy === 'company' ? 'on' : ''} onClick={() => setGroupBy('company')}>
            업체별
          </button>
          <button className={groupBy === 'member' ? 'on' : ''} onClick={() => setGroupBy('member')}>
            담당자별
          </button>
          <button className={groupBy === 'due' ? 'on' : ''} onClick={() => setGroupBy('due')}>
            마감순
          </button>
        </div>
        {!readOnly && (
          <button className="primary" onClick={() => setEditing(newTask(companyFilter || null, memberFilter && memberFilter !== '__none' ? [memberFilter] : []))}>
            + 할일 추가
          </button>
        )}
      </div>

      {readOnly && <div className="banner">지난주 기록이에요 (그 주 일요일 기준 상태). 수정은 이번주에서 해주세요.</div>}

      {groups.length === 0 && <Empty>조건에 맞는 할일이 없어요.</Empty>}

      <div className="groups">
        {groups.map((g) => (
          <section key={g.key} className="group">
            <header className="group-head">
              {g.company && <CompanyDot color={g.color} />}
              <h2>{g.title}</h2>
              <span className="muted small">
                {g.rows.filter((r) => !r.doneInWeek).length} 남음 / {g.rows.length}
              </span>
              {!readOnly && groupBy !== 'due' && (
                <button
                  className="link small add-inline"
                  onClick={() =>
                    setEditing(
                      newTask(g.company?.id ?? (companyFilter || null), g.member ? [g.member.id] : memberFilter && memberFilter !== '__none' ? [memberFilter] : []),
                    )
                  }
                >
                  + 추가
                </button>
              )}
            </header>
            {g.rows.length === 0 ? (
              <div className="muted small pad">할일 없음</div>
            ) : (
              <table className="task-table">
                <thead>
                  <tr>
                    <th className="c-check">완료</th>
                    {groupBy !== 'company' && <th className="c-company">업체</th>}
                    <th>업무</th>
                    <th className="c-who">담당</th>
                    <th className="c-due">마감기한</th>
                    <th className="c-note">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(({ task, doneInWeek }) => {
                    const ds = doneInWeek ? 'none' : dueState(task, todayIso);
                    const company = companyById.get(task.companyId ?? '');
                    return (
                      <tr
                        key={task.id}
                        className={`${doneInWeek ? 'is-done' : ''} ${task.important ? 'is-important' : ''} ${readOnly ? '' : 'clickable'}`}
                        onClick={() => !readOnly && setEditing(task)}
                      >
                        <td className="c-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={doneInWeek} disabled={readOnly} onChange={() => toggleDone(task)} />
                        </td>
                        {groupBy !== 'company' && (
                          <td className="c-company">
                            {company ? (
                              <>
                                <CompanyDot color={company.color} /> {company.name}
                              </>
                            ) : (
                              <span className="muted">-</span>
                            )}
                          </td>
                        )}
                        <td className="c-title">{task.title || <span className="muted">(제목 없음)</span>}</td>
                        <td className="c-who">
                          <div className="chips">
                            {task.assigneeIds.map((id) => (
                              <MemberChip key={id} member={memberById.get(id)} small />
                            ))}
                          </div>
                        </td>
                        <td className={`c-due due-${ds}`}>
                          {task.dueDate && <div>{shortDate(task.dueDate)}</div>}
                          {task.dueText && <div className="small">{task.dueText}</div>}
                        </td>
                        <td className="c-note">{task.note}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        ))}
      </div>

      {editing && (
        <TaskEditor
          task={editing}
          isNew={!data.tasks.some((t) => t.id === editing.id)}
          members={members}
          companies={companies}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            save('tasks', t);
            setEditing(null);
          }}
          onDelete={(t) => {
            if (confirm(`"${t.title}" 할일을 삭제할까요?\n(완료 처리하면 기록이 남고, 삭제하면 지난주 기록에서도 사라져요)`)) {
              remove('tasks', t.id);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function SummaryTable({
  summary,
  selected,
  onSelect,
}: {
  summary: MemberSummary[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="team compact">
      {summary.map((s) => (
        <button
          key={s.member.id}
          className={`member-card ${selected === s.member.id ? 'selected' : ''}`}
          style={{ '--c': s.member.color } as CSSProperties}
          onClick={() => onSelect(s.member.id)}
          title="클릭하면 이 담당자만 보기"
        >
          <div className="mc-top">
            {s.member.character ? <img className="mc-mini-char" src={characterSrc(s.member.character)} alt="" /> : <Avatar member={s.member} size={40} />}
            <div className="mc-name">
              <b>{s.member.name}</b>
              <span className="muted small">
                할일 {s.total} · 완료 {s.done}
              </span>
            </div>
            <Ring value={s.done} total={s.total} size={56} stroke={6} color={s.member.color} label={s.remaining} sub="남음" />
          </div>
          <div className="mc-flags">
            <span className={`flag ${s.overdue ? 'warn' : ''}`}>기한 지남 {s.overdue}</span>
            <span className={`flag ${s.dueToday ? 'hot' : ''}`}>오늘 {s.dueToday}</span>
            <span className="flag">내일 {s.dueTomorrow}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function TaskEditor({
  task,
  isNew,
  members,
  companies,
  onClose,
  onSave,
  onDelete,
}: {
  task: Task;
  isNew: boolean;
  members: Member[];
  companies: Company[];
  onClose: () => void;
  onSave: (t: Task) => void;
  onDelete: (t: Task) => void;
}) {
  const [t, setT] = useState<Task>(task);
  const set = <K extends keyof Task>(k: K, v: Task[K]) => setT((prev) => ({ ...prev, [k]: v }));

  return (
    <Modal title={isNew ? '할일 추가' : '할일 수정'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!t.title.trim()) return;
          onSave({ ...t, title: t.title.trim() });
        }}
      >
        <Field label="업체">
          <select value={t.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
            <option value="">(업체 없음)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="담당">
          <MemberPicker members={members} value={t.assigneeIds} onChange={(v) => set('assigneeIds', v)} />
        </Field>
        <Field label="업무" full>
          <input autoFocus value={t.title} onChange={(e) => set('title', e.target.value)} placeholder="예: 1-1) 몽골 검사용 샘플 출고" required />
        </Field>
        <Field label="마감일">
          <input type="date" value={t.dueDate ?? ''} onChange={(e) => set('dueDate', e.target.value || undefined)} />
        </Field>
        <Field label="마감 메모 (선택)">
          <input value={t.dueText ?? ''} onChange={(e) => set('dueText', e.target.value || undefined)} placeholder="예: 오픈 이후" />
        </Field>
        <Field label="비고" full>
          <textarea rows={3} value={t.note ?? ''} onChange={(e) => set('note', e.target.value || undefined)} />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={!!t.important} onChange={(e) => set('important', e.target.checked)} /> 중요 (강조 표시)
        </label>
        <label className="check-line">
          <input
            type="checkbox"
            checked={t.done}
            onChange={(e) => setT((p) => (e.target.checked ? { ...p, done: true, doneAt: p.doneAt ?? today() } : { ...p, done: false, doneAt: undefined }))}
          />{' '}
          완료 {t.done && t.doneAt && <span className="muted small">({t.doneAt})</span>}
        </label>
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={() => onDelete(t)}>
              삭제
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
