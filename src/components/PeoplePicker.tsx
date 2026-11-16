// 여러 사람 고르기: 대시보드에 등록된 사람 누구나 (이름 칩 + ＋ 로 추가, ✕ 로 빼기)
import { useEffect, useRef, useState } from 'react';

export interface PersonOpt {
  key: string; // 이메일 (없으면 카드 id)
  name: string;
  group?: string; // 무역사무 · 1조 · 팀장님 …
}

export default function PeoplePicker({
  value,
  people,
  onChange,
  readOnly,
  emptyLabel = '미정',
}: {
  value: string[];
  people: PersonOpt[];
  onChange: (v: string[]) => void;
  readOnly?: boolean;
  emptyLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const nameOf = (k: string) => people.find((p) => p.key === k)?.name ?? k.split('@')[0];
  const nq = q.trim().toLowerCase();
  const rest = people.filter((p) => !value.includes(p.key) && (!nq || `${p.name} ${p.key} ${p.group ?? ''}`.toLowerCase().includes(nq)));
  // 무리별로 묶어서
  const groups = [...new Set(rest.map((p) => p.group ?? ''))];
  return (
    <div className="pp" ref={box}>
      {value.length === 0 && <span className="pp-empty">{emptyLabel}</span>}
      {value.map((k) => (
        <span key={k} className="pp-chip">
          {nameOf(k)}
          {!readOnly && (
            <button type="button" onClick={() => onChange(value.filter((x) => x !== k))} aria-label={`${nameOf(k)} 빼기`}>
              ✕
            </button>
          )}
        </span>
      ))}
      {!readOnly && (
        <button type="button" className="pp-add" onClick={() => setOpen((v) => !v)} title="사람 더하기">
          ＋
        </button>
      )}
      {open && (
        <div className="pp-menu">
          <input autoFocus placeholder="이름 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="pp-list">
            {groups.map((g) => (
              <div key={g}>
                {g && <div className="pp-group">{g}</div>}
                {rest
                  .filter((p) => (p.group ?? '') === g)
                  .map((p) => (
                    <button
                      type="button"
                      key={p.key}
                      onClick={() => {
                        onChange([...value, p.key]);
                        setQ('');
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
              </div>
            ))}
            {!rest.length && <div className="pp-group">더 고를 사람이 없어요</div>}
          </div>
        </div>
      )}
    </div>
  );
}
