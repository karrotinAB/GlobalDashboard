import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { Member } from '../types';

export function MemberChip({ member, small }: { member?: Member; small?: boolean }) {
  if (!member) return null;
  return (
    <span className={`chip member ${small ? 'chip-sm' : ''}`} style={{ '--c': member.color } as CSSProperties}>
      <i />
      {member.name}
    </span>
  );
}

export function CompanyDot({ color }: { color?: string }) {
  return <span className="dot" style={{ background: color ?? '#999' }} />;
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={`field ${full ? 'full' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function MemberPicker({
  members,
  value,
  onChange,
}: {
  members: Member[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <div className="picker">
      {members.map((m) => {
        const on = value.includes(m.id);
        return (
          <button
            type="button"
            key={m.id}
            className={`chip toggle ${on ? 'on' : ''}`}
            style={{ '--c': m.color } as CSSProperties}
            onClick={() => onChange(on ? value.filter((x) => x !== m.id) : [...value, m.id])}
          >
            {m.name}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Avatar({ member, size = 40 }: { member?: Member; size?: number }) {
  if (!member) return null;
  return (
    <span className="avatar" style={{ '--c': member.color, width: size, height: size, fontSize: size * 0.3 } as CSSProperties}>
      {member.name.slice(-2)}
    </span>
  );
}

/** 진행 링: 한 가지 값(완료 비율)만 보여줌. 가운데 숫자는 글자색(잉크) */
export function Ring({
  value,
  total,
  size = 76,
  stroke = 7,
  color = 'var(--primary)',
  label,
  sub,
}: {
  value: number;
  total: number;
  size?: number;
  stroke?: number;
  color?: string;
  label?: ReactNode;
  sub?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
        <title>{`${value} / ${total} 완료 (${Math.round(pct * 100)}%)`}</title>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={stroke} />
        {pct > 0 && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * pct} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </svg>
      <div className="ring-center">
        <b>{label ?? `${Math.round(pct * 100)}%`}</b>
        {sub && <span>{sub}</span>}
      </div>
    </div>
  );
}

/** 노션 커버 자리. 이미지가 정해지면 public/cover.jpg 를 넣고 styles.css 의 .cover 배경만 바꾸면 됨 */
export function Cover({ tall }: { tall?: boolean }) {
  return <div className={`cover ${tall ? 'tall' : ''}`} aria-hidden="true" />;
}

export const CHARACTERS = ['c01', 'c02', 'c04', 'c05', 'c06', 'c07', 'c08', 'c09', 'c10', 'c11', 'c12', 'c13', 'c14', 'c15', 'c16'];
export const characterSrc = (c: string) => `./characters/${c}.png`;
