import { useState, type CSSProperties, type FocusEvent } from 'react';
import type { Company, Member } from '../types';
import { shortDate } from '../lib/date';
import { MemberChip } from './ui';

/** 구글 시트처럼: 누르면 그 자리에서 입력, Enter = 저장, Esc = 취소, 다른 데 누르면 저장 */
export function EditableText({
  value,
  onSave,
  placeholder,
  multiline,
  disabled,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  if (!editing) {
    return (
      <div
        className={`cell-view ${disabled ? '' : 'editable'}`}
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

/** 칸 밖을 누르면 닫히는 편집 상자 */
const closeOnOutside = (close: () => void) => (e: FocusEvent<HTMLDivElement>) => {
  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) close();
};

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
  if (!editing) {
    return (
      <div className={`cell-view chips ${disabled ? '' : 'editable'}`} onClick={() => !disabled && setEditing(true)}>
        {ids.length ? ids.map((id) => <MemberChip key={id} member={memberById.get(id)} small />) : !disabled && <span className="cell-ph">담당</span>}
      </div>
    );
  }
  return (
    <div tabIndex={-1} ref={(el) => el?.focus()} onBlur={closeOnOutside(() => setEditing(false))} className="cell-pop">
      <MiniPicker members={members} value={ids} onToggle={(id) => onSave(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id])} />
    </div>
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
        <input className="cell-input" autoFocus placeholder="업무 입력 후 Enter" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} onKeyDown={keys} />
      </td>
      <td className="c-who">
        <MiniPicker
          members={members}
          value={d.assigneeIds}
          onToggle={(id) => setD({ ...d, assigneeIds: d.assigneeIds.includes(id) ? d.assigneeIds.filter((x) => x !== id) : [...d.assigneeIds, id] })}
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
