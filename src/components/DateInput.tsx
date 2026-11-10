import { useEffect, useRef, useState } from 'react';
import { addDays, today } from '../lib/date';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * 붙여넣기/직접 쓰기 되는 날짜를 YYYY-MM-DD 로 바꿈
 * 20261110 · 261110 · 2026.11.10 · 2026-11-10 · 2026/11/10 · 26.11.10 · 11/10 · 11.10 · 1110 · 오늘 · 내일
 */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/\s+/g, '').replace(/\.$/, '');
  if (!s) return null;
  if (s === '오늘') return today();
  if (s === '내일') return addDays(today(), 1);
  const thisYear = new Date().getFullYear();
  let y: number, m: number, d: number;
  let mm: RegExpMatchArray | null;
  if ((mm = s.match(/^(\d{4})(\d{2})(\d{2})$/))) [y, m, d] = [+mm[1], +mm[2], +mm[3]];
  else if ((mm = s.match(/^(\d{2})(\d{2})(\d{2})$/))) [y, m, d] = [2000 + +mm[1], +mm[2], +mm[3]];
  else if ((mm = s.match(/^(\d{4}|\d{2})[.\-/년](\d{1,2})[.\-/월](\d{1,2})일?$/))) [y, m, d] = [mm[1].length === 2 ? 2000 + +mm[1] : +mm[1], +mm[2], +mm[3]];
  else if ((mm = s.match(/^(\d{1,2})[.\-/월](\d{1,2})일?$/))) [y, m, d] = [thisYear, +mm[1], +mm[2]];
  else if ((mm = s.match(/^(\d{2})(\d{2})$/))) [y, m, d] = [thisYear, +mm[1], +mm[2]];
  else return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null; // 13월, 2/30 같은 건 거절
  return `${y}-${pad(m)}-${pad(d)}`;
}

const show = (iso?: string) => (iso ? iso.replace(/-/g, '.') : '');

/** 날짜 칸: 직접 쓰기 · 붙여넣기 · 📅 달력 모두 됨. Enter/칸 밖 클릭 = 확정 */
export default function DateInput({
  value,
  onChange,
  onDone,
  autoFocus,
  placeholder = '20261110',
}: {
  value?: string;
  onChange: (iso?: string) => void;
  onDone?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(show(value));
  const [bad, setBad] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => setText(show(value)), [value]);

  const commit = (t: string) => {
    if (!t.trim()) {
      setBad(false);
      if (value) onChange(undefined);
      return true;
    }
    const iso = parseDate(t);
    if (!iso) {
      setBad(true);
      return false;
    }
    setBad(false);
    setText(show(iso));
    if (iso !== value) onChange(iso);
    return true;
  };

  return (
    <div className={`date-input ${bad ? 'bad' : ''}`}>
      <input
        className="cell-input"
        autoFocus={autoFocus}
        value={text}
        placeholder={placeholder}
        title="20261110 · 2026.11.10 · 11/10 처럼 쓰거나 붙여넣기"
        onChange={(e) => {
          setText(e.target.value);
          setBad(false);
        }}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          const iso = parseDate(pasted);
          if (iso) {
            e.preventDefault();
            commit(pasted);
          }
        }}
        onBlur={(e) => {
          // 📅 버튼으로 가는 건 닫지 않음
          if (e.relatedTarget && e.currentTarget.parentElement?.contains(e.relatedTarget as Node)) return;
          commit(text);
          onDone?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            if (commit(text)) onDone?.();
          }
          if (e.key === 'Escape') {
            setText(show(value));
            setBad(false);
            onDone?.();
          }
        }}
      />
      <button
        type="button"
        className="cal-btn"
        tabIndex={-1}
        title="달력에서 고르기"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          try {
            picker.current?.showPicker();
          } catch {
            picker.current?.focus();
          }
        }}
      >
        📅
      </button>
      <input
        ref={picker}
        type="date"
        className="cal-native"
        tabIndex={-1}
        value={value ?? ''}
        onChange={(e) => {
          const v = e.target.value || undefined;
          setText(show(v));
          onChange(v);
          onDone?.();
        }}
      />
    </div>
  );
}
