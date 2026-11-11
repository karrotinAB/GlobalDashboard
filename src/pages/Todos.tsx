import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { addDays, today, uid, weekLabel, weekStart } from '../lib/date';
import { dueState, summarize, tasksForWeek, type MemberSummary } from '../lib/tasks';
import { isOrderDone, type Company, type Member, type Order, type Task } from '../types';
import { characterSrc, charOf, CompanyDot, Empty, Modal, Ring } from '../components/ui';
import { useAccess } from '../components/AuthGate';
import { AddCompany, AddTaskRow, AssigneeCell, CompanyMemo, DueCell, EditableText, NumCell, RowMenu } from '../components/SheetCells';

type GroupBy = 'company' | 'member' | 'due';
type StatusFilter = 'all' | 'open' | 'done';
type Row = { task: Task; doneInWeek: boolean };
type Group = { key: string; title: string; color?: string; company?: Company; member?: Member; rows: Row[] };

export default function Todos() {
  const { data, save, saveMany, remove } = useStore();
  const { members, myCompanies: companies, memberById, companyById } = useLookups();
  const todayIso = today();
  const thisMonday = weekStart(todayIso);

  const [monday, setMonday] = useState(thisMonday);
  const [memberFilter, setMemberFilter] = useState<string | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c') ?? '');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('company');
  const [showCompanies, setShowCompanies] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null); // 끌고 있는 업체 (화면 갱신 없이 바로 기억)

  /** 업체 순서 바꾸기: from 을 to 자리로 (아래로 끌면 to 뒤, 위로 끌면 to 앞) */
  const moveCompany = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    const ids = companies.map((c) => c.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    ids.splice(from, 1);
    ids.splice(to, 0, fromId);
    saveMany(
      'companies',
      ids.map((id, i) => ({ ...companyById.get(id)!, order: i })).filter((c) => companyById.get(c.id)!.order !== c.order),
    );
  };
  const access = useAccess();
  const canManage = access.canManage; // 관리자·팀장님·이사님 (로컬 모드는 모두)
  const deleteCompany = (id: string) => {
    const c = companyById.get(id);
    if (!c) return;
    const nTasks = data.tasks.filter((t) => t.companyId === id && !t.done).length;
    const nOrders = data.orders.filter((o) => o.companyId === id).length;
    const detail = nTasks || nOrders ? `\n\n남은 할일 ${nTasks}개 · 주문 ${nOrders}건은 지워지지 않고 '기타 / 업체 없음'으로 옮겨져요.` : '';
    if (confirm(`'${c.name}' 업체를 삭제할까요?${detail}`)) remove('companies', id);
  };
  const nudge = (id: string, dir: -1 | 1) => {
    const i = companies.findIndex((c) => c.id === id);
    const target = companies[i + dir];
    if (target) moveCompany(id, target.id);
  };

  const isPast = monday < thisMonday;
  const isFuture = monday > thisMonday;
  const readOnly = isPast;

  const weekRows = useMemo(() => tasksForWeek(data.tasks, monday), [data.tasks, monday]);
  const summary = useMemo(() => summarize(weekRows, members, todayIso), [weekRows, members, todayIso]);

  /** 업체마다 위에서부터 1), 2)… 자동 번호. 직접 정한 번호(1-1 등)가 있는 줄은 건너뜀 */
  const numberMap = useMemo(() => {
    const byCompany = new Map<string, Task[]>();
    for (const { task } of weekRows) {
      const k = task.companyId ?? '';
      if (!byCompany.has(k)) byCompany.set(k, []);
      byCompany.get(k)!.push(task);
    }
    const map = new Map<string, string>();
    for (const list of byCompany.values()) {
      let n = 0;
      for (const t of list.sort((a, b) => a.order - b.order)) map.set(t.id, t.num || String(++n));
    }
    return map;
  }, [weekRows]);

  // 시트에서 옮겨온 "1) …", "1-1) …" 제목은 번호를 떼어냄 (1-1 같은 번호는 직접 번호로 보관)
  useEffect(() => {
    const NUM = /^\s*(\d+(?:-\d+)*)\)\s*/;
    const fix = data.tasks.filter((t) => NUM.test(t.title) && t.title.replace(NUM, '').trim());
    if (!fix.length) return;
    saveMany(
      'tasks',
      fix.map((t) => {
        const m = t.title.match(NUM)!;
        return { ...t, title: t.title.slice(m[0].length).trim(), num: m[1].includes('-') ? (t.num ?? m[1]) : t.num };
      }),
    );
  }, [data.tasks, saveMany]);

  // 업무 끌어서 순서 바꾸기 (업체별 보기에서, 다른 업체로 옮기면 업체도 바뀜)
  const taskDragRef = useRef<string | null>(null);
  const [taskDrag, setTaskDrag] = useState<string | null>(null);
  const [taskOver, setTaskOver] = useState<{ id: string; after: boolean } | null>(null);
  const endTaskDrag = () => {
    taskDragRef.current = null;
    setTaskDrag(null);
    setTaskOver(null);
  };
  const moveTask = (fromId: string, companyId: string | null, toId: string | null, after: boolean) => {
    const from = data.tasks.find((t) => t.id === fromId);
    if (!from || fromId === toId) return;
    const list = data.tasks.filter((t) => (t.companyId ?? null) === companyId && t.id !== fromId).sort((a, b) => a.order - b.order);
    const at = toId ? list.findIndex((t) => t.id === toId) + (after ? 1 : 0) : list.length;
    list.splice(at < 0 ? list.length : at, 0, { ...from, companyId });
    const before = new Map(data.tasks.map((t) => [t.id, t]));
    saveMany(
      'tasks',
      list.map((t, i) => ({ ...t, order: i })).filter((t) => before.get(t.id)?.order !== t.order || (before.get(t.id)?.companyId ?? null) !== t.companyId),
    );
  };

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

  const [linking, setLinking] = useState<Task | null>(null); // 주문 연결하기 창
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
      // 남은 할일이 많은 업체부터 (같으면 정해 둔 순서), 남은 게 없는 업체는 뒤로
      const left = (g: Group) => g.rows.filter((r) => !r.doneInWeek).length;
      out.sort((a, b) => left(b) - left(a));
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
          <button className={memberFilter !== '__none' ? 'on' : ''} onClick={() => setMemberFilter(null)}>
            {memberFilter && memberFilter !== '__none' ? `${memberById.get(memberFilter)?.name ?? ''} ✕` : '전체'}
          </button>
          <button className={memberFilter === '__none' ? 'on' : ''} onClick={() => setMemberFilter(memberFilter === '__none' ? null : '__none')}>
            담당 미정
          </button>
        </div>
        <button
          className={`company-toggle ${companyFilter || showCompanies ? 'on' : ''}`}
          onClick={() => (companyFilter ? setCompanyFilter('') : setShowCompanies((v) => !v))}
          title={companyFilter ? '업체 필터 해제' : '업체별로 골라 보기'}
        >
          {companyFilter ? (
            <>
              <span className="dot" style={{ background: companyById.get(companyFilter)?.color }} />
              {companyById.get(companyFilter)?.name} ✕
            </>
          ) : (
            <>업체 고르기 {showCompanies ? '▴' : '▾'}</>
          )}
        </button>
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
        {showCompanies && !companyFilter && (
        <div className="company-chips">
          {companies.map((c) => (
            <button
              key={c.id}
              className={`cchip ${companyFilter === c.id ? 'on' : ''}`}
              style={{ '--c': c.color ?? '#999' } as CSSProperties}
              onClick={() => {
                setCompanyFilter(c.id);
                setShowCompanies(false);
              }}
            >
              <span className="dot" style={{ background: c.color }} />
              {c.name}
            </button>
          ))}
        </div>
        )}
      </div>

      {readOnly && <div className="banner">지난주 기록이에요 (그 주 일요일 기준 상태). 수정은 이번주에서 해주세요.</div>}
      {!readOnly && <p className="muted small sheet-hint">칸을 누르면 바로 고칠 수 있어요 · Enter 저장 · Esc 취소 · ⋯ 에서 중요 표시·삭제</p>}

      {groups.length === 0 && groupBy !== 'company' && <Empty>조건에 맞는 할일이 없어요.</Empty>}

      <div className="groups">
        {groups.map((g) => {
          const showCompany = groupBy !== 'company';
          const colSpan = showCompany ? 8 : 7;
          const taskMovable = !readOnly && groupBy === 'company';
          const canAdd = !readOnly && groupBy !== 'due';
          const movable = !readOnly && groupBy === 'company' && !!g.company && !companyFilter;
          const cid = g.company?.id ?? '';
          return (
            <section
              key={g.key}
              className={`group ${dragId === cid && movable ? 'dragging' : ''} ${overId === cid && dragId && dragId !== cid ? 'drop-target' : ''}`}
              onDragOver={(e) => {
                if (taskMovable && taskDragRef.current) {
                  e.preventDefault();
                  return;
                }
                if (!movable || !dragRef.current) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overId !== cid) setOverId(cid);
              }}
              onDrop={(e) => {
                if (taskMovable && taskDragRef.current) {
                  e.preventDefault();
                  moveTask(taskDragRef.current, g.company?.id ?? null, null, true); // 줄 밖(빈 곳)에 놓으면 그 업체 맨 아래로
                  endTaskDrag();
                  return;
                }
                const from = dragRef.current;
                if (!movable || !from) return;
                e.preventDefault();
                moveCompany(from, cid);
                dragRef.current = null;
                setDragId(null);
                setOverId(null);
              }}
            >
              <header
                className={`group-head ${movable ? 'movable' : ''}`}
                draggable={movable}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', g.title);
                  dragRef.current = cid;
                  // 드래그 시작 순간에 화면을 바꾸면 크롬이 드래그를 취소해서 한 박자 늦게
                  setTimeout(() => setDragId(cid), 0);
                }}
                onDragEnd={() => {
                  dragRef.current = null;
                  setDragId(null);
                  setOverId(null);
                }}
              >
                {movable && (
                  <span className="drag-handle" title="끌어서 순서 바꾸기">
                    ⠿
                  </span>
                )}
                {g.company && <CompanyDot color={g.color} />}
                <h2>{g.title}</h2>
                {g.company?.team && <span className="tag gray small">{g.company.team}조 업체</span>}
                <span className="muted small">
                  {g.rows.filter((r) => !r.doneInWeek).length} 남음 / {g.rows.length}
                </span>
                {g.company && (
                  <CompanyMemo
                    name={g.company.name}
                    memo={g.company.memo}
                    updatedAt={g.company.memoUpdatedAt}
                    updatedBy={g.company.memoUpdatedBy}
                    onSave={(memo) =>
                      save('companies', {
                        ...g.company!,
                        memo: memo.trim() ? memo : undefined,
                        memoUpdatedAt: new Date().toISOString(),
                        memoUpdatedBy: access.email || undefined,
                      })
                    }
                  />
                )}
                {g.company &&
                  (() => {
                    // 이 업체 클레임: 환급 안 된 게 있으면 빨간 버튼
                    const open = data.claims.filter((c) => c.companyId === g.company!.id && !c.refunded).length;
                    return (
                      <a
                        className={`claim-link small-link ${open ? 'open' : ''}`}
                        href={`#/claims?c=${g.company!.id}`}
                        title={open ? `환급 안 된 클레임 ${open}건` : '클레임 보기'}
                        draggable={false}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        클레임{open ? ` ${open}` : ''}
                      </a>
                    );
                  })()}
                {movable && (
                  <span className="move-btns">
                    <button className="icon-btn" title="위로" onClick={() => nudge(cid, -1)}>
                      ▲
                    </button>
                    <button className="icon-btn" title="아래로" onClick={() => nudge(cid, 1)}>
                      ▼
                    </button>
                    {canManage && !companyById.get(cid)?.team && (
                      <button className="icon-btn danger-icon" title="업체 삭제" onClick={() => deleteCompany(cid)}>
                        🗑
                      </button>
                    )}
                  </span>
                )}
              </header>
              <table className="task-table">
                {g.rows.length > 0 && (
                  <thead>
                    <tr>
                      <th className="c-num">No.</th>
                      {showCompany && <th className="c-company">업체</th>}
                      <th>업무</th>
                      <th className="c-who">담당</th>
                      <th className="c-due">마감기한</th>
                      <th className="c-check">완료</th>
                      <th className="c-note">비고</th>
                      <th className="c-more" />
                    </tr>
                  </thead>
                )}
                <tbody>
                  {g.rows.map(({ task, doneInWeek }) => {
                    const ds = doneInWeek ? 'none' : dueState(task, todayIso);
                    const company = companyById.get(task.companyId ?? '');
                    const patch = (p: Partial<Task>) => save('tasks', { ...task, ...p });
                    const linked = task.orderId ? data.orders.find((o) => o.id === task.orderId) : undefined;
                    return (
                      <tr
                        key={task.id}
                        className={`${doneInWeek ? 'is-done' : ''} ${task.important ? 'is-important' : ''} ${taskDrag === task.id ? 'row-dragging' : ''} ${
                          taskOver?.id === task.id ? (taskOver.after ? 'drop-after' : 'drop-before') : ''
                        }`}
                        onDragOver={(e) => {
                          if (!taskMovable || !taskDragRef.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY > r.top + r.height / 2;
                          if (taskOver?.id !== task.id || taskOver.after !== after) setTaskOver({ id: task.id, after });
                        }}
                        onDrop={(e) => {
                          if (!taskMovable || !taskDragRef.current) return;
                          e.preventDefault();
                          e.stopPropagation();
                          moveTask(taskDragRef.current, task.companyId ?? null, task.id, taskOver?.id === task.id ? taskOver.after : false);
                          endTaskDrag();
                        }}
                      >
                        <td className="c-num">
                          {taskMovable && (
                            <span
                              className="row-handle"
                              draggable
                              title="끌어서 순서 바꾸기"
                              onDragStart={(e) => {
                                e.dataTransfer.effectAllowed = 'move';
                                e.dataTransfer.setData('text/plain', task.title);
                                const tr = e.currentTarget.closest('tr');
                                if (tr) e.dataTransfer.setDragImage(tr, 20, 14);
                                taskDragRef.current = task.id;
                                setTimeout(() => setTaskDrag(task.id), 0);
                              }}
                              onDragEnd={endTaskDrag}
                            >
                              ⠿
                            </span>
                          )}
                          <NumCell value={numberMap.get(task.id) ?? ''} custom={!!task.num} disabled={readOnly} onSave={(v) => patch({ num: v || undefined })} />
                        </td>
                        {showCompany && (
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
                        <td className="c-title">
                          <EditableText value={task.title} oneLine expand disabled={readOnly} onSave={(v) => v && patch({ title: v })} />
                        </td>
                        <td className="c-who">
                          <AssigneeCell ids={task.assigneeIds} members={members} memberById={memberById} disabled={readOnly} onSave={(ids) => patch({ assigneeIds: ids })} />
                        </td>
                        <td className="c-due">
                          <DueCell date={task.dueDate} text={task.dueText} state={ds} disabled={readOnly} onSave={(d) => patch({ dueDate: d })} />
                        </td>
                        <td className="c-check">
                          <input type="checkbox" checked={doneInWeek} disabled={readOnly} onChange={() => toggleDone(task)} />
                        </td>
                        <td className="c-note">
                          <div className="note-wrap">
                            <EditableText value={task.note ?? ''} oneLine expand placeholder="비고" disabled={readOnly} onSave={(v) => patch({ note: v || undefined })} />
                            {linked && (
                              <a
                                className="order-link"
                                href={`#/orders?c=${linked.companyId ?? ''}&o=${linked.id}`}
                                title={`연결된 주문: ${linked.name}${linked.orderDate ? ` (${linked.orderDate.replace(/-/g, '.')})` : ''} — 눌러서 주문 관리로`}
                              >
                                ↗
                              </a>
                            )}
                          </div>
                        </td>
                        <td className="c-more">
                          {!readOnly && (
                            <RowMenu
                              important={!!task.important}
                              onImportant={() => patch({ important: !task.important })}
                              extra={[
                                { label: linked ? '📦 연결한 주문 바꾸기' : '📦 주문 연결하기', onClick: () => setLinking(task) },
                                ...(linked ? [{ label: '연결 끊기', onClick: () => patch({ orderId: undefined }) }] : []),
                              ]}
                              onDelete={() => {
                                if (confirm(`"${task.title}" 할일을 삭제할까요?\n(완료 체크하면 그 주 기록에 남고, 삭제하면 기록에서도 사라져요)`)) remove('tasks', task.id);
                              }}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {canAdd && (
                    <AddTaskRow
                      colSpan={colSpan}
                      members={members}
                      companies={companies}
                      showCompany={showCompany}
                      defaultCompanyId={g.company?.id ?? (companyFilter || null)}
                      defaultAssignees={g.member ? [g.member.id] : memberFilter && memberFilter !== '__none' ? [memberFilter] : []}
                      onAdd={(d) => save('tasks', { ...newTask(d.companyId, d.assigneeIds), title: d.title, dueDate: d.dueDate, note: d.note })}
                    />
                  )}
                  {!canAdd && g.rows.length === 0 && (
                    <tr>
                      <td colSpan={colSpan} className="muted small pad">
                        할일 없음
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>
          );
        })}
        {groupBy === 'company' && !readOnly && !companyFilter && <AddCompany companies={companies} onAdd={(c) => save('companies', c)} />}
      </div>

      {linking && (
        <OrderLinkPicker
          task={linking}
          orders={data.orders}
          companyName={(id) => companyById.get(id ?? '')?.name}
          onPick={(orderId) => {
            save('tasks', { ...linking, orderId });
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      )}
    </div>
  );
}

/** 할일에 주문 연결: 같은 업체 주문 먼저 (진행중 → 최근 순), 검색, 다른 업체 주문도 */
function OrderLinkPicker({
  task,
  orders,
  companyName,
  onPick,
  onClose,
}: {
  task: Task;
  orders: Order[];
  companyName: (id?: string | null) => string | undefined;
  onPick: (orderId: string) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(!task.companyId);
  const query = q.trim().toLowerCase();
  const list = orders
    .filter((o) => all || o.companyId === task.companyId)
    .filter((o) => !query || `${o.name} ${o.storeCode ?? ''} ${o.bundle?.name ?? ''} ${companyName(o.companyId) ?? ''}`.toLowerCase().includes(query))
    .sort((a, b) => Number(isOrderDone(a)) - Number(isOrderDone(b)) || (b.orderDate ?? b.createdAt).localeCompare(a.orderDate ?? a.createdAt))
    .slice(0, 100);
  return (
    <Modal title="주문 연결하기" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        「{task.title}」에 연결할 주문을 골라 주세요. 연결하면 비고 끝 ↗ 를 눌러 그 주문으로 바로 갈 수 있어요.
      </p>
      <div className="link-tools">
        <input className="search" autoFocus placeholder="🔍 주문 이름 · 매장코드 · 묶음" value={q} onChange={(e) => setQ(e.target.value)} />
        {task.companyId && (
          <label className="check-line small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 다른 업체 주문도
          </label>
        )}
      </div>
      <ul className="link-list">
        {list.length === 0 && <li className="muted small">맞는 주문이 없어요.</li>}
        {list.map((o) => (
          <li key={o.id}>
            <button className={o.id === task.orderId ? 'on' : ''} onClick={() => onPick(o.id)}>
              <b>{o.name}</b>
              {o.bundle && (
                <span className="link-bundle" style={{ '--c': o.bundle.color } as CSSProperties}>
                  {o.bundle.name || '묶음'}
                </span>
              )}
              <span className="muted small">
                {[all ? companyName(o.companyId) : '', o.orderDate?.replace(/-/g, '.'), o.storeCode].filter(Boolean).join(' · ')}
              </span>
              <span className={`tag small ${isOrderDone(o) ? 'green' : 'gray'}`}>{isOrderDone(o) ? '완료' : '진행중'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
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
            <img className="mc-mini-char" src={characterSrc(charOf(s.member))} alt="" />
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
