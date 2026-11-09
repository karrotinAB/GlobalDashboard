import { useRef, useState, type CSSProperties } from 'react';
import type { Company, Member } from '../types';
import { shortDate } from '../lib/date';
import { MemberChip } from './ui';

/** 구글 시트처럼: 누르면 그 자리에서 입력, Enter = 저장, Esc = 취소, 다른 데 누르면 저장 */
export function EditableText({
  value,
  onSave,
  placeholder,
  multiline,
  oneLine,
  disabled,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  oneLine?: boolean; // 한 줄로 자르고(…) 마우스를 올리면 전체 보기
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (!editing) {
    return (
      <div
        className={`cell-view ${disabled ? '' : 'editable'} ${oneLine ? 'one-line' : ''}`}
        title={oneLine && value ? value : undefined}
        onClick={() => {
          if (disabled) return;
          setV(value);
          setEditing(true);
        }}
      >
        {value || (!disabled && <span className="cell-ph">{placeholder}</span>)}
      </div>
    );
  }
  const commit = () => {
    setEditing(false);
    if (v.trim() !== value) onSave(v.trim());
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      commit();
    }
    if (e.key === 'Escape') setEditing(false);
  };
  return multiline ? (
    <textarea className="cell-input" autoFocus rows={2} value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={keys} />
  ) : (
    <input className="cell-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={keys} />
  );
}

export function MiniPicker({ members, value, onToggle }: { members: Member[]; value: string[]; onToggle: (id: string) => void }) {
  return (
    <div className="mini-picker">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            type="button"
            key={m.id}
            className={`chip toggle chip-sm ${on ? 'on' : ''}`}
            style={{ '--c': m.color } as CSSProperties}
            onClick={() => onToggle(m.id)}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

/** 번호 칸: 평소엔 자동 번호, 누르면 직접 입력 (예: 1-1). 비우면 다시 자동 */
export function NumCell({ value, custom, disabled, onSave }: { value: string; custom: boolean; disabled?: boolean; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  if (!editing) {
    return (
      <span
        className={`num ${custom ? 'custom' : ''} ${disabled ? '' : 'editable'}`}
        title={disabled ? undefined : custom ? '직접 정한 번호 (지우면 자동 번호)' : '눌러서 번호 바꾸기 (예: 1-1)'}
        onClick={() => {
          if (disabled) return;
          setV(custom ? value : '');
          setEditing(true);
        }}
      >
        {value})
      </span>
    );
  }
  const commit = () => {
    setEditing(false);
    const clean = v.trim().replace(/\)+$/, '');
    if (clean !== (custom ? value : '')) onSave(clean);
  };
  return (
    <input
      className="cell-input num-input"
      autoFocus
      placeholder={value}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}

/* ---------- 담당자 직접 쓰기 (자동완성) ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = (s: string) =>
  [...s].map((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 0xac00 && c <= 0xd7a3 ? CHO[Math.floor((c - 0xac00) / 588)] : ch;
  }).join('');
const SEP = /[/,·&\s]+/;
const matches = (m: Member, tok: string) => !!tok && (m.name.startsWith(tok) || chosung(m.name).startsWith(tok));

/** "유정/민" → [유정 id, 민지 id] (첫 글자·초성만 써도 하나로 정해지면 인정) */
export function parseAssignees(text: string, members: Member[]): string[] {
  const ids: string[] = [];
  for (const tok of text.split(SEP).map((t) => t.trim()).filter(Boolean)) {
    const exact = members.find((m) => m.name === tok);
    const cands = exact ? [exact] : members.filter((m) => matches(m, tok));
    if (cands.length === 1 && !ids.includes(cands[0].id)) ids.push(cands[0].id);
  }
  return ids;
}

const namesOf = (ids: string[], members: Member[]) =>
  ids
    .map((id) => members.find((m) => m.id === id)?.name)
    .filter(Boolean)
    .join('/');

/** 담당 입력칸: 쓰는 중에 회색으로 이름이 미리 보이고 Tab(또는 Enter)으로 채움. 두 명은 "유정/민지" */
export function AssigneeInput({
  members,
  ids,
  onChange,
  onEnter,
  onEscape,
  onBlur,
  autoFocus,
}: {
  members: Member[];
  ids: string[];
  onChange: (ids: string[]) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  onBlur?: () => void;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(() => namesOf(ids, members));
  const parts = text.split(SEP);
  const last = parts[parts.length - 1] ?? '';
  const cands = last ? members.filter((m) => matches(m, last) && m.name !== last) : [];
  const ghost = cands.length === 1 ? cands[0].name : '';
  const ghostRest = ghost && ghost.startsWith(last) ? ghost.slice(last.length) : ghost ? ` → ${ghost}` : '';

  const update = (t: string) => {
    setText(t);
    onChange(parseAssignees(t, members));
  };
  const complete = () => {
    if (!ghost) return false;
    const head = text.slice(0, text.length - last.length);
    update(`${head}${ghost}/`);
    return true;
  };

  return (
    <div className="assignee-input">
      <input
        className="cell-input"
        autoFocus={autoFocus}
        placeholder="유정/민지"
        value={text}
        onChange={(e) => update(e.target.value)}
        onBlur={() => {
          // 끝에 남은 "/" 정리
          const clean = namesOf(parseAssignees(text, members), members);
          if (clean !== text) setText(clean);
          onBlur?.();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if ((e.key === 'Tab' && !e.shiftKey) || e.key === 'Enter') {
            if (complete()) {
              e.preventDefault();
              return;
            }
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            onEnter?.();
          }
          if (e.key === 'Escape') onEscape?.();
        }}
      />
      {ghostRest && (
        <span className="ghost" aria-hidden="true">
          <span className="ghost-typed">{text}</span>
          {ghostRest}
        </span>
      )}
      {cands.length > 1 && <span className="cands">{cands.map((m) => m.name).join(' · ')}</span>}
    </div>
  );
}

export function AssigneeCell({
  ids,
  members,
  memberById,
  disabled,
  onSave,
}: {
  ids: string[];
  members: Member[];
  memberById: Map<string, Member>;
  disabled?: boolean;
  onSave: (ids: string[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const draft = useRef(ids);
  const closed = useRef(false);
  if (!editing) {
    return (
      <div className={`cell-view chips ${disabled ? '' : 'editable'}`} onClick={() => {
          if (disabled) return;
          draft.current = ids;
          closed.current = false;
          setEditing(true);
        }}
      >
        {ids.length ? ids.map((id) => <MemberChip key={id} member={memberById.get(id)} small />) : !disabled && <span className="cell-ph">담당</span>}
      </div>
    );
  }
  const done = () => {
    if (closed.current) return; // Enter 뒤에 blur 가 한 번 더 와도 한 번만 저장
    closed.current = true;
    setEditing(false);
    if (draft.current.join() !== ids.join()) onSave(draft.current);
  };
  return (
    <AssigneeInput
      members={members}
      ids={ids}
      autoFocus
      onChange={(v) => (draft.current = v)}
      onEnter={done}
      onBlur={done}
      onEscape={() => setEditing(false)}
    />
  );
}

export function DueCell({
  date,
  text,
  state,
  disabled,
  onSave,
}: {
  date?: string;
  text?: string;
  state: string;
  disabled?: boolean;
  onSave: (date?: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="cell-input"
        type="date"
        autoFocus
        value={date ?? ''}
        onChange={(e) => onSave(e.target.value || undefined)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && setEditing(false)}
      />
    );
  }
  return (
    <div className={`cell-view due-${state} ${disabled ? '' : 'editable'}`} onClick={() => !disabled && setEditing(true)}>
      {date && <div>{shortDate(date)}</div>}
      {text && <div className="small">{text}</div>}
      {!date && !text && !disabled && <span className="cell-ph">날짜</span>}
    </div>
  );
}

export interface NewTaskDraft {
  title: string;
  assigneeIds: string[];
  dueDate?: string;
  note?: string;
  companyId: string | null;
}

/** 그룹 맨 아래 "+ 할일 추가" 줄. 누르면 그 자리에서 입력하고 Enter 로 저장 → 바로 다음 줄 입력 */
export function AddTaskRow({
  colSpan,
  members,
  companies,
  showCompany,
  defaultCompanyId,
  defaultAssignees,
  onAdd,
}: {
  colSpan: number;
  members: Member[];
  companies: Company[];
  showCompany: boolean;
  defaultCompanyId: string | null;
  defaultAssignees: string[];
  onAdd: (d: NewTaskDraft) => void;
}) {
  const blank = (): NewTaskDraft => ({ title: '', assigneeIds: defaultAssignees, companyId: defaultCompanyId });
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<NewTaskDraft>(blank);
  const [rowKey, setRowKey] = useState(0);
  const titleRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <tr className="add-row">
        <td colSpan={colSpan}>
          <button
            className="add-row-btn"
            onClick={() => {
              setD(blank());
              setOpen(true);
            }}
          >
            + 할일 추가
          </button>
        </td>
      </tr>
    );
  }

  const submit = () => {
    if (!d.title.trim()) return;
    onAdd({ ...d, title: d.title.trim(), note: d.note?.trim() || undefined });
    setD({ ...blank(), assigneeIds: d.assigneeIds, companyId: d.companyId }); // 담당·업체는 유지하고 다음 줄
    setRowKey((k) => k + 1);
    titleRef.current?.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <tr className="add-row editing">
      <td className="c-check">
        <span className="add-plus">+</span>
      </td>
      <td className="c-num" />
      {showCompany && (
        <td className="c-company">
          <select className="cell-input" value={d.companyId ?? ''} onChange={(e) => setD({ ...d, companyId: e.target.value || null })}>
            <option value="">(업체 없음)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
      )}
      <td>
        <input ref={titleRef} className="cell-input" autoFocus placeholder="업무 입력 후 Enter" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} onKeyDown={keys} />
      </td>
      <td className="c-who">
        <AssigneeInput
          key={rowKey}
          members={members}
          ids={d.assigneeIds}
          onChange={(v) => setD((p) => ({ ...p, assigneeIds: v }))}
          onEnter={submit}
          onEscape={() => setOpen(false)}
        />
      </td>
      <td className="c-due">
        <input className="cell-input" type="date" value={d.dueDate ?? ''} onChange={(e) => setD({ ...d, dueDate: e.target.value || undefined })} />
      </td>
      <td className="c-note">
        <input className="cell-input" placeholder="비고" value={d.note ?? ''} onChange={(e) => setD({ ...d, note: e.target.value })} onKeyDown={keys} />
      </td>
      <td className="c-more">
        <button className="icon-btn" title="닫기 (Esc)" onClick={() => setOpen(false)}>
          ✕
        </button>
      </td>
    </tr>
  );
}

const COMPANY_COLORS = ['#8e5a8a', '#4f7cae', '#c79a2e', '#a8414b', '#5f8a4e', '#cf7a35', '#c2553f', '#3f8f8a', '#7a6a4f'];

/** 업체별 보기 맨 아래 "+ 업체 추가" */
export function AddCompany({ companies, onAdd }: { companies: Company[]; onAdd: (c: Company) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  if (!open) {
    return (
      <button className="add-company" onClick={() => setOpen(true)}>
        + 업체 추가
      </button>
    );
  }
  const submit = () => {
    const n = name.trim();
    if (!n) return setOpen(false);
    onAdd({
      id: `c-${Date.now().toString(36)}`,
      name: n,
      country: '',
      color: COMPANY_COLORS[companies.length % COMPANY_COLORS.length],
      order: Math.max(-1, ...companies.map((c) => c.order)) + 1,
    });
    setName('');
    setOpen(false);
  };
  return (
    <div className="add-company editing">
      <input
        autoFocus
        className="cell-input"
        placeholder="업체 이름 (예: 일본 (ABC Trading)) 입력 후 Enter"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
          if (e.key === 'Escape') setOpen(false);
        }}
        onBlur={submit}
      />
      <span className="muted small">나라·시계(타임존)는 설정에서 넣을 수 있어요</span>
    </div>
  );
}
