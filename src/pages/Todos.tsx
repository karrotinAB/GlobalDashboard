import { useNameOf } from '../components/AddressBook';
import { coKey, useTradeMemos, type MemoItem } from '../lib/tradeMemos';
import { isPersonal } from '../lib/team';
import { useMirrorClaims } from '../lib/teamClaims';
import { setReportCheck, useReports, useSpaceCheckRole } from '../lib/reports';
import { usePeople } from '../components/AddressBook';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { addDays, today, uid, weekLabel, weekStart } from '../lib/date';
import { dueState, summarize, tasksForWeek, type MemberSummary } from '../lib/tasks';
import type { Company, Member, Task } from '../types';
import { characterSrc, charOf, CompanyDot, Empty, Modal, Ring } from '../components/ui';
import { useAccess } from '../components/AuthGate';
import OrderLinkPicker from '../components/OrderLinkPicker';
import { AddCompany, AddTaskRow, AssigneeCell, CompanyMemo, DueCell, EditableText, NumCell, RowMenu } from '../components/SheetCells';

type GroupBy = 'company' | 'member' | 'due';
type StatusFilter = 'all' | 'open' | 'done';
type Row = { task: Task; doneInWeek: boolean };
type Group = { key: string; title: string; color?: string; company?: Company; member?: Member; rows: Row[] };

export default function Todos() {
  const { data, save, saveMany, remove } = useStore();
  const { members, myCompanies: companies, memberById, companyById } = useLookups();
  const mirrorClaims = useMirrorClaims(companies);
  const todayIso = today();
  const thisMonday = weekStart(todayIso);

  const [monday, setMonday] = useState(thisMonday);
  // 홈 카드의 '이번주 할일'에서 오면 ?m=담당자 → 그 사람의 남은 할일만
  const fromMember = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('m');
  const [memberFilter, setMemberFilter] = useState<string | null>(fromMember);
  const [companyFilter, setCompanyFilter] = useState<string>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c') ?? '');
  const [status, setStatus] = useState<StatusFilter>(fromMember ? 'open' : 'all');
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
  const { memos: tradeMemos } = useTradeMemos(); // 무역사무 업체 메모 (체크 안 한 것만 보여줌)
  // 보고 확인 할일: 이 대시보드 주인의 확인 칸 (팀장님/이사님 · 관리자가 볼 때도)
  const { roles: people } = usePeople(isPersonal(access.viewTeam) && access.role === 'admin');
  const checkRole = useSpaceCheckRole(access.role, access.viewTeam, people);
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
      // 직접 번호가 '3' 이면 다음 자동은 4, '1-1' 처럼 하위 번호면 자동 번호는 그대로 (1 · 1-1 · 2)
      let n = 0;
      for (const t of list.sort((a, b) => a.order - b.order)) {
        const sub = t.num?.match(/^\d+-(.+)$/);
        if (sub) map.set(t.id, `${n || parseInt(t.num!, 10)}-${sub[1]}`); // 하위 번호는 바로 위 번호를 따라감 (위 줄이 2) 가 되면 2-1)
        else if (t.num && /^\d+$/.test(t.num)) {
          n = Number(t.num);
          map.set(t.id, t.num);
        } else if (t.num) map.set(t.id, t.num);
        else map.set(t.id, String(++n));
      }
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

  // 예전에 직접 넣은 그냥 숫자 번호('1', '3')는 자동 번호와 꼬이므로 지움 (이제 숫자를 넣으면 그 자리로 옮겨짐)
  useEffect(() => {
    const fix = data.tasks.filter((t) => t.num && /^\d+$/.test(t.num));
    if (fix.length) saveMany('tasks', fix.map((t) => ({ ...t, num: undefined })));
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
  const moveTask = (fromId: string, companyId: string | null, toId: string | null, after: boolean, extra?: Partial<Task>) => {
    const from = data.tasks.find((t) => t.id === fromId);
    if (!from || fromId === toId) return;
    const list = data.tasks.filter((t) => (t.companyId ?? null) === companyId && t.id !== fromId).sort((a, b) => a.order - b.order);
    const at = toId ? list.findIndex((t) => t.id === toId) + (after ? 1 : 0) : list.length;
    list.splice(at < 0 ? list.length : at, 0, { ...from, companyId, ...extra });
    const before = new Map(data.tasks.map((t) => [t.id, t]));
    saveMany(
      'tasks',
      list.map((t, i) => ({ ...t, order: i })).filter((t) => t.id === fromId || before.get(t.id)?.order !== t.order || (before.get(t.id)?.companyId ?? null) !== t.companyId),
    );
  };
  /**
   * 번호 고치기: 그 번호 자리로 줄도 옮김
   *   '1-1' → 1) 바로 밑 (이미 1-1, 1-2 … 가 있으면 그 순서대로) · '3' → 3번째 자리로 (번호는 다시 자동)
   *   비우면 자동 번호
   */
  const setNum = (task: Task, raw: string) => {
    const v = raw.trim();
    const co = task.companyId ?? null;
    if (!v) return save('tasks', { ...task, num: undefined });
    const others = weekRows
      .map((r) => r.task)
      .filter((t) => (t.companyId ?? null) === co && t.id !== task.id)
      .sort((a, b) => a.order - b.order);
    const label = (t: Task) => numberMap.get(t.id) ?? '';
    if (/^\d+$/.test(v)) {
      // 이 줄 + 바로 밑 하위 줄들(1-1 …)을 같이 k 번째 자리로
      const k = Number(v);
      const week = weekRows.map((r) => r.task).filter((t) => (t.companyId ?? null) === co).sort((a, b) => a.order - b.order);
      const i0 = week.findIndex((t) => t.id === task.id);
      const block = [task];
      for (let i = i0 + 1; i < week.length && /^\d+-/.test(week[i].num ?? ''); i++) block.push(week[i]);
      const ids = new Set(block.map((t) => t.id));
      // 옮길 줄들을 뺀 나머지 중 큰 번호 줄(하위 번호 아닌 것)의 k 번째 앞으로
      const mains = others.filter((t) => !ids.has(t.id) && !/^\d+-/.test(t.num ?? ''));
      const target = mains[k - 1];
      const all = data.tasks.filter((t) => (t.companyId ?? null) === co && !ids.has(t.id)).sort((a, b) => a.order - b.order);
      const at = target ? all.findIndex((t) => t.id === target.id) : all.length;
      all.splice(at < 0 ? all.length : at, 0, { ...task, num: undefined }, ...block.slice(1));
      const before = new Map(data.tasks.map((t) => [t.id, t]));
      return saveMany(
        'tasks',
        all.map((t, i) => ({ ...t, order: i })).filter((t) => t.id === task.id || before.get(t.id)?.order !== t.order),
      );
    }
    const m = v.match(/^(\d+)-(\d+)/);
    if (!m) return save('tasks', { ...task, num: v });
    const [main, sub] = [m[1], Number(m[2])];
    const parent = others.find((t) => label(t) === main);
    if (!parent) return save('tasks', { ...task, num: v });
    // 부모 밑에서 번호가 더 작은 하위 줄들 다음
    const subs = others.filter((t) => label(t).startsWith(`${main}-`) && Number(label(t).split('-')[1]) < sub);
    const anchor = subs.length ? subs[subs.length - 1] : parent;
    moveTask(task.id, co, anchor.id, true, { num: v });
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
  const [linkingReport, setLinkingReport] = useState<Task | null>(null); // 보고 연결하기 창
  const [reportF, setReportF] = useState(''); // 보고방 칸: 어느 조 보고만 볼지
  const reportTeams = [...new Set(data.tasks.filter((t) => t.reportId && t.reportTeam).map((t) => t.reportTeam!))].sort((a, b) => (a === 'trade' ? 1 : b === 'trade' ? -1 : a.localeCompare(b)));
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
      // 정해 둔 업체 순서는 그대로, 남은 할일이 없는 업체만 아래로
      const hasLeft = (g: Group) => g.rows.some((r) => !r.doneInWeek);
      out.sort((a, b) => Number(hasLeft(b)) - Number(hasLeft(a)));
      // 팀장님·이사님: 보고 확인 할일은 '보고방' 칸 하나로 (맨 위, 제목에 조 이름)
      // 보고방 칸 하나 안에서: 1조 → 2조 → 3조 → 무역사무 순, 위 칩으로 한 곳만 볼 수도
      const teamRank = (t?: string) => (t === 'trade' ? 9 : Number(t ?? 8));
      const reportRows = sortRows(filtered.filter((r) => r.task.reportId && (!reportF || (r.task.reportTeam ?? '') === reportF))).sort(
        (a, b) => teamRank(a.task.reportTeam) - teamRank(b.task.reportTeam),
      );
      const reportGroups: Group[] = reportRows.length || reportF ? [{ key: '__report', title: '📑 보고방', color: '#8c2f3c', rows: reportRows }] : [];
      const etc = filtered.filter((r) => !r.task.reportId && (!r.task.companyId || !companyById.has(r.task.companyId)));
      out.unshift(...reportGroups);
      if (etc.length) out.push({ key: '__etc', title: '기타 / 업체 없음', rows: sortRows(etc) });
      // 필터가 걸려 있으면 빈 업체는 숨김
      const anyFilter = memberFilter || companyFilter || status !== 'all' || q;
      // 업체를 골랐으면 그 업체는 할일이 없어도 보여줌 (바로 할일 추가)
      return anyFilter ? out.filter((g) => g.rows.length || g.key === companyFilter) : out;
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
  }, [groupBy, filtered, companies, members, companyById, memberFilter, companyFilter, status, q, todayIso, reportF]);

  // 나눠 그리기: 처음 40줄 → 한 번에 60줄씩 더 (주가 바뀌거나 보기 방식이 바뀌면 다시 처음부터)
  const totalRows = groups.reduce((a, g) => a + g.rows.length, 0);
  const [renderCap, setRenderCap] = useState(40);
  useEffect(() => setRenderCap(40), [groupBy, monday]);
  useEffect(() => {
    if (renderCap >= totalRows) return;
    const id = window.setTimeout(() => setRenderCap((c) => c + 120), 30);
    return () => window.clearTimeout(id);
  }, [renderCap, totalRows]);

  const toggleDone = (t: Task) => {
    if (readOnly) return;
    // 보고 확인 할일: 보고방 확인 체크를 바꾸면 할일도 따라 바뀜
    if (t.reportId && checkRole) {
      void setReportCheck(t.reportId, checkRole, !t.done, access.accountName ?? access.email.split('@')[0], access.email || undefined);
      return;
    }
    // 반복 할일은 '오늘 완료했는지'로 판단 (어제 완료 → 오늘은 다시 체크할 수 있음)
    const doneNow = t.repeat ? t.done && t.doneAt === todayIso : t.done;
    save('tasks', doneNow ? { ...t, done: false, doneAt: undefined } : { ...t, done: true, doneAt: todayIso });
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
          {/* 휴대폰: 주 옆에 업체 고르기 */}
          <select className="todo-co-m" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} aria-label="업체 고르기">
            <option value="">업체 전체</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <SummaryTable summary={summary} selected={memberFilter} onSelect={(id) => setMemberFilter(id === memberFilter ? null : id)} />

      <div className="toolbar todo-toolbar">
        <div className="seg hide-m">
          <button className={memberFilter !== '__none' ? 'on' : ''} onClick={() => setMemberFilter(null)}>
            {memberFilter && memberFilter !== '__none' ? `${memberById.get(memberFilter)?.name ?? ''} ✕` : '전체'}
          </button>
          <button className={memberFilter === '__none' ? 'on' : ''} onClick={() => setMemberFilter(memberFilter === '__none' ? null : '__none')}>
            담당 미정
          </button>
        </div>
        <button
          className={`company-toggle hide-m ${companyFilter || showCompanies ? 'on' : ''}`}
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
        <select className="hide-m" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
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
        <div className="company-chips hide-m">
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
        {(() => {
          // 휴대폰에서 한꺼번에 다 그리면 화면이 멈춰서: 처음엔 위쪽 몇십 줄, 나머지는 조금씩 이어 그림
          let budget = renderCap;
          return groups.map((g0) => {
          const g = { ...g0, rows: g0.rows.slice(0, Math.max(0, budget)) };
          budget -= g.rows.length;
          const showCompany = groupBy !== 'company';
          const colSpan = showCompany ? 8 : 7;
          const taskMovable = !readOnly && groupBy === 'company';
          const canAdd = !readOnly && groupBy !== 'due' && !g.key.startsWith('__report'); // 보고방 칸은 보고에서 자동으로만
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
                {g.key === '__report' && reportTeams.length > 1 && (
                  <span className="rp-src-filter">
                    <button className={!reportF ? 'on' : ''} onClick={() => setReportF('')}>
                      전체
                    </button>
                    {reportTeams.map((t) => (
                      <button key={t} className={`rp-src t-${t} ${reportF === t ? 'on' : ''}`} onClick={() => setReportF(reportF === t ? '' : t)}>
                        {t === 'trade' ? '무역사무' : `${t}조`}
                      </button>
                    ))}
                  </span>
                )}
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
                {g.company && (
                  <TradeNoteBtn
                    name={g.company.name}
                    all={tradeMemos[coKey(g.company.team ?? access.viewTeam, g.company.id)]?.items ?? []}
                  />
                )}
                {g.company &&
                  (() => {
                    // 이 업체 클레임: 환급 안 된 게 있으면 빨간 버튼
                    const open = [...data.claims, ...mirrorClaims].filter((c) => c.companyId === g.company!.id && !c.refunded).length;
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
                    // 연결: 묶음이면 그 묶음 첫 주문으로 이동 (묶음 전체가 반짝), 아니면 그 주문
                    const bundleOrders = task.bundleId ? data.orders.filter((o) => o.bundle?.id === task.bundleId) : [];
                    const linked = task.bundleId ? bundleOrders[0] : task.orderId ? data.orders.find((o) => o.id === task.orderId) : undefined;
                    const linkTitle = !linked
                      ? ''
                      : task.bundleId
                        ? `연결된 묶음: ${linked.bundle?.name || '묶음'} (주문 ${bundleOrders.length}개) — 눌러서 주문 관리로`
                        : `연결된 주문: ${linked.name}${linked.orderDate ? ` (${linked.orderDate.replace(/-/g, '.')})` : ''} — 눌러서 주문 관리로`;
                    // 연결한 보고 · 주문 바로가기 (비고 끝, 휴대폰은 ⋯ 자리)
                    const links = (
                      <>
                            {task.reportId && (
                              <a className="order-link report-link" href={`#/reports?r=${task.reportId}`} title="보고방에서 이 보고 보기">
                                📑↗
                              </a>
                            )}
                            {task.linkedReportId && (
                              <a className="order-link report-link" href={`#/reports?r=${task.linkedReportId}`} title="연결한 보고 — 눌러서 보고방으로">
                                📑↗
                              </a>
                            )}
                            {linked && (
                              <a
                                className="order-link"
                                href={`#/orders?c=${linked.companyId ?? ''}&o=${linked.id}${task.bundleId ? `&b=${task.bundleId}` : ''}`}
                                title={linkTitle}
                                style={task.bundleId && linked.bundle ? ({ '--c': linked.bundle.color } as CSSProperties) : undefined}
                              >
                                {task.bundleId ? '⧉↗' : '↗'}
                              </a>
                            )}
                      </>
                    );
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
                          <NumCell value={numberMap.get(task.id) ?? ''} custom={!!task.num} disabled={readOnly} onSave={(v) => setNum(task, v)} />
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
                          <div className="title-wrap">
                            {task.reportId && task.reportTeam && (
                              <span className={`rp-src t-${task.reportTeam}`} title={task.reportTeam === 'trade' ? '무역사무 보고' : `${task.reportTeam}조 보고`}>
                                {task.reportTeam === 'trade' ? '무역사무' : `${task.reportTeam}조`}
                              </span>
                            )}
                            <EditableText value={task.title} oneLine expand disabled={readOnly} onSave={(v) => v && patch({ title: v })} />
                            <button
                              type="button"
                              className={`repeat-btn ${task.repeat ? 'on' : ''}`}
                              disabled={readOnly}
                              title={task.repeat ? '매일 반복 중 — 완료해도 내일 다시 떠요 (눌러서 끄기)' : '매일 반복 (완료해도 내일 다시 뜨게)'}
                              onClick={() => patch({ repeat: task.repeat ? undefined : true })}
                            >
                              🔁
                            </button>
                          </div>
                        </td>
                        <td className="c-who">
                          <AssigneeCell ids={task.assigneeIds} members={members} memberById={memberById} disabled={readOnly} onSave={(ids) => patch({ assigneeIds: ids })} />
                        </td>
                        <td className="c-due">
                          <DueCell date={task.dueDate} text={task.dueText} state={ds} disabled={readOnly} onSave={(d, txt) => patch({ dueDate: d, dueText: txt })} />
                        </td>
                        <td className="c-check">
                          <input type="checkbox" checked={doneInWeek} disabled={readOnly} onChange={() => toggleDone(task)} />
                        </td>
                        <td className="c-note">
                          <div className="note-wrap">
                            <EditableText value={task.note ?? ''} oneLine expand placeholder="비고" disabled={readOnly} onSave={(v) => patch({ note: v || undefined })} />
                            <span className="links-d">{links}</span>
                          </div>
                        </td>
                        <td className="c-more">
                          {/* 휴대폰: 연결한 주문·보고는 ⋯ 자리에 */}
                          <span className="links-m">{links}</span>
                          {!readOnly && (
                            <RowMenu
                              important={!!task.important}
                              onImportant={() => patch({ important: !task.important })}
                              extra={[
                                { label: linked ? '📦 연결한 주문 바꾸기' : '📦 주문 연결하기', onClick: () => setLinking(task) },
                                ...(linked ? [{ label: '주문 연결 끊기', onClick: () => patch({ orderId: undefined, bundleId: undefined }) }] : []),
                                { label: task.linkedReportId ? '📑 연결한 보고 바꾸기' : '📑 보고 연결하기', onClick: () => setLinkingReport(task) },
                                ...(task.linkedReportId ? [{ label: '보고 연결 끊기', onClick: () => patch({ linkedReportId: undefined }) }] : []),
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
          });
        })()}
        {groupBy === 'company' && !readOnly && !companyFilter && <AddCompany companies={companies} onAdd={(c) => save('companies', c)} />}
      </div>

      {linking && (
        <OrderLinkPicker
          title={linking.title}
          companyId={linking.companyId}
          currentOrderId={linking.orderId}
          currentBundleId={linking.bundleId}
          orders={data.orders}
          companyName={(id) => companyById.get(id ?? '')?.name}
          onPick={(pick) => {
            save('tasks', { ...linking, orderId: pick.orderId, bundleId: pick.bundleId });
            setLinking(null);
          }}
          onClose={() => setLinking(null)}
        />
      )}
      {linkingReport && (
        <ReportLinkPicker
          title={linkingReport.title}
          team={isPersonal(access.viewTeam) ? null : access.viewTeam}
          current={linkingReport.linkedReportId}
          onPick={(id) => {
            save('tasks', { ...linkingReport, linkedReportId: id });
            setLinkingReport(null);
          }}
          onClose={() => setLinkingReport(null)}
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

/** 업체 메모 옆 📒: 무역사무가 이 업체에 남긴 메모 중 아직 체크 안 한 것 (보기만) */
function TradeNoteBtn({ name, all }: { name: string; all: MemoItem[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const nameOf = useNameOf();
  const items = all.filter((x) => !x.done);
  const done = all.filter((x) => x.done).sort((a, b) => (b.doneAt ?? b.at).localeCompare(a.doneAt ?? a.at));
  const md = (iso?: string) => (iso ? `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}` : '');
  const shown = tab === 'open' ? items : done;
  return (
    <>
      <button
        type="button"
        className={`trade-note-btn ${items.length ? '' : 'empty'}`}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => setOpen(true)}
        title={`무역사무 메모 · 지금 ${items.length}개 · 완료 ${done.length}개`}
      >
        📒{items.length > 0 && <span className="tn-n">{items.length}</span>}
      </button>
      {open && (
        <Modal title={`무역사무 메모 · ${name}`} onClose={() => setOpen(false)}>
          <div className="seg small" style={{ marginBottom: 8 }}>
            <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
              지금 올라온 것 {items.length}
            </button>
            <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
              완료 {done.length}
            </button>
          </div>
          <p className="muted small" style={{ marginTop: 0 }}>
            {tab === 'open' ? '무역사무가 이 업체에 대해 남긴 메모 중 아직 완료 안 된 것이에요.' : '무역사무가 완료 체크한 메모예요 (최근 완료 순).'} 고치는 건 무역사무 페이지 › 업체 메모에서 해요.
          </p>
          {shown.length === 0 ? (
            <p className="muted small">{tab === 'open' ? '남은 무역사무 메모가 없어요 🍵' : '완료된 메모가 아직 없어요'}</p>
          ) : (
            <ul className="tn-list">
              {shown.map((x) => (
                <li key={x.id} className={x.done ? 'tn-done' : ''}>
                  <span className="tn-text">{x.done ? '✅ ' : ''}{x.text}</span>
                  <span className="muted small">
                    {nameOf(x.email, x.by)} {md(x.at)}
                    {x.done && x.doneAt ? ` · 완료 ${md(x.doneAt)}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      )}
    </>
  );
}

/** 📑 보고 연결하기: 이 조 보고방 글 중 하나 고르기 (제목 · 내용 · 쓴 사람으로 찾기) */
function ReportLinkPicker({ title, team, current, onPick, onClose }: { title: string; team: string | null; current?: string; onPick: (id: string) => void; onClose: () => void }) {
  const list = useReports(team);
  const nameOf = useNameOf();
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const plain = (h: string) => h.replace(/<[^>]+>/g, ' ');
  const shown = (list ?? []).filter((r) => {
    if (!words.length) return true;
    const h = `${r.title} ${plain(r.body ?? '')} ${nameOf(r.authorEmail, r.authorName)}`.toLowerCase();
    return words.every((w) => h.includes(w));
  });
  const when = (iso: string) => `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}`;
  return (
    <Modal title={`보고 연결하기 · ${title}`} onClose={onClose}>
      <input autoFocus className="search" style={{ width: '100%', marginBottom: 8 }} placeholder="🔍 보고 제목 · 내용 · 쓴 사람" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="rl-list">
        {list === null && <p className="muted small">불러오는 중…</p>}
        {list !== null && shown.length === 0 && <p className="muted small">맞는 보고가 없어요</p>}
        {shown.map((r) => (
          <button key={r.id} className={`rl-item ${r.id === current ? 'on' : ''}`} onClick={() => onPick(r.id)}>
            {team === null && <span className={`rp-src t-${r.team}`}>{r.team === 'trade' ? '무역사무' : `${r.team}조`}</span>}
            <span className="rl-title">{r.title}</span>
            <span className="muted small">
              {nameOf(r.authorEmail, r.authorName)} · {when(r.createdAt)}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
