// 구석 📅: 누르면 이번 달 · 다음 달 작은 달력 (숫자만 · 월요일부터)
import { useEffect, useState } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function Month({ y, m, todayKey }: { y: number; m: number; todayKey: string }) {
  const first = new Date(y, m, 1);
  const lead = (first.getDay() + 6) % 7; // 월요일 = 0
  const days = new Date(y, m + 1, 0).getDate();
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return (
    <div className="mcal-month">
      <div className="mcal-title">
        {y}. {m + 1}월
      </div>
      <div className="mcal-grid">
        {DOW.map((d, i) => (
          <span key={`h${i}`} className={`mcal-h ${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}`}>
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span key={i} className={`mcal-d ${i % 7 === 5 ? 'sat' : i % 7 === 6 ? 'sun' : ''} ${d && `${y}-${pad(m + 1)}-${pad(d)}` === todayKey ? 'today' : ''}`}>
            {d ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function MiniCal() {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0); // ‹ › 로 앞뒤 달
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const a = new Date(now.getFullYear(), now.getMonth() + shift, 1);
  const b = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  return (
    <>
      <button className={`mcal-btn ${open ? 'on' : ''}`} onClick={() => (setOpen(!open), setShift(0))} title="이번 달 · 다음 달 달력" aria-label="작은 달력">
        📅
      </button>
      {open && (
        <>
          <div className="mcal-bg" onClick={() => setOpen(false)} />
          <div className="mcal-pop" role="dialog" aria-label="작은 달력">
            <div className="mcal-nav">
              <button className="link" onClick={() => setShift(shift - 1)} aria-label="앞 달">
                ‹
              </button>
              {shift !== 0 && (
                <button className="link small" onClick={() => setShift(0)}>
                  이번 달
                </button>
              )}
              <button className="link" onClick={() => setShift(shift + 1)} aria-label="다음 달">
                ›
              </button>
            </div>
            <div className="mcal-months">
              <Month y={a.getFullYear()} m={a.getMonth()} todayKey={todayKey} />
              <Month y={b.getFullYear()} m={b.getMonth()} todayKey={todayKey} />
            </div>
          </div>
        </>
      )}
    </>
  );
}
