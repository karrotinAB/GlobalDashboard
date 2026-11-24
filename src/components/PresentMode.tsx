// IT 발표 모드: 실제 화면 위에 메모를 크게 띄우고, 보여줄 부분만 밝게
//   켜기: 프로필 › 🎤 IT 발표 모드 (관리자만)   순서·글: src/lib/presentDeck.ts
//   → / Space / PageDown 다음 · ← / PageUp 이전 · T 목차 · H 메모 숨기기 · D 어둡게 끄기 · Esc 끝내기
//   발표 중에도 화면은 그대로 눌러짐 (진짜 데모)
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from 'react';
import { PRESENT_DECK, PRESENT_TOC, type PresentStep, type PresentTarget } from '../lib/presentDeck';
import { rectOf } from '../lib/zoom';

const KEY = 'gd:present';
const subs = new Set<() => void>();
const read = (): number | null => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(PRESENT_DECK.length - 1, n)) : 0;
  } catch {
    return null;
  }
};
let cur: number | null = read();
function setStep(n: number | null) {
  cur = n === null ? null : Math.max(0, Math.min(PRESENT_DECK.length - 1, n));
  try {
    if (cur === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(cur));
  } catch {
    /* 저장 못 해도 발표는 됨 (새로고침하면 처음부터) */
  }
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};
export const startPresent = () => setStep(0);
export const usePresenting = () => useSyncExternalStore(subscribe, () => cur) !== null;

function findTarget(t: PresentTarget): Element | null {
  const all = Array.from(document.querySelectorAll(t.sel));
  const hit = t.text ? all.find((el) => el.textContent?.includes(t.text!)) : all[0];
  if (!hit) return null;
  return t.closest ? hit.closest(t.closest) ?? hit : hit;
}

type Box = { left: number; top: number; width: number; height: number };

export default function PresentMode({ allowed }: { allowed: boolean }) {
  const step = useSyncExternalStore(subscribe, () => cur);
  const [hideNote, setHideNote] = useState(false);
  const [noDim, setNoDim] = useState(false);
  const [toc, setToc] = useState(false);
  const [box, setBox] = useState<Box | null>(null);
  const s: PresentStep | null = step === null ? null : PRESENT_DECK[step];

  // 단계가 바뀌면 그 페이지로
  useEffect(() => {
    if (!s?.page || s.stay) return;
    const want = `#/${s.page}`;
    if (window.location.hash.split('?')[0] !== want) window.location.hash = `/${s.page}`;
  }, [s]);

  // 밝게 할 부분 찾기 (페이지가 늦게 그려져도 따라가게 계속 잼) · 처음 찾으면 그쪽으로 스크롤
  useLayoutEffect(() => {
    setBox(null);
    if (!s?.target) return;
    let scrolled = false;
    let raf = 0;
    const tick = () => {
      // 발표 중에 창(주소록 등)을 열면 그 창을 밝게 · 닫으면 다시 원래 자리
      const pops = Array.from(document.querySelectorAll('[role="dialog"], .img-zoom')).filter((d) => !d.closest('.pm'));
      const el = pops[pops.length - 1] ?? findTarget(s.target!);
      if (el) {
        if (!scrolled && !pops.length) {
          scrolled = true;
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
        // 버튼 + 열린 드롭다운(내 계정 · 도구함)을 같이 밝게
        const r = rectOf(el);
        for (const m of Array.from(el.querySelectorAll('[role="menu"]'))) {
          const q = rectOf(m);
          const right = Math.max(r.right, q.right), bottom = Math.max(r.bottom, q.bottom);
          r.left = Math.min(r.left, q.left);
          r.top = Math.min(r.top, q.top);
          r.width = right - r.left;
          r.height = bottom - r.top;
          r.right = right;
          r.bottom = bottom;
        }
        setBox((b) => (b && Math.abs(b.left - r.left) < 0.5 && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.width - r.width) < 0.5 && Math.abs(b.height - r.height) < 0.5 ? b : { left: r.left, top: r.top, width: r.width, height: r.height }));
      } else setBox(null);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [s]);

  // 키보드 (발표용 리모컨은 PageUp/PageDown 을 보냄) · 입력 칸에서 쓰는 중이면 무시
  useEffect(() => {
    if (step === null) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (toc && k === 'Escape') {
        setToc(false);
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (k === 'ArrowRight' || k === 'PageDown' || k === ' ') setStep(step + 1);
      else if (k === 'ArrowLeft' || k === 'PageUp') setStep(step - 1);
      else if (k === 'Home') setStep(0);
      else if (k === 'End') setStep(PRESENT_DECK.length - 1);
      else if (k === 'Escape') {
        if (document.querySelector('[role="menu"], [role="dialog"]')) return; // 열린 메뉴 · 창부터 닫기
        setStep(null);
      }
      else if (k === 'h' || k === 'H') setHideNote((v) => !v);
      else if (k === 'd' || k === 'D') setNoDim((v) => !v);
      else if (k === 't' || k === 'T') setToc((v) => !v);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [step, toc]);

  useEffect(() => {
    document.documentElement.classList.toggle('presenting', step !== null);
    return () => document.documentElement.classList.remove('presenting');
  }, [step]);

  // 목차에서 고르면 닫힘 · 단계가 바뀌면 메모 다시 보이게
  useEffect(() => {
    setToc(false);
    setHideNote(false);
  }, [step]);

  if (step === null || !s || !allowed) return null;
  const slide = !s.page;
  const over = !!s.page && !!s.over; // 실제 화면 위에 어둡게 깔고 슬라이드
  const last = step === PRESENT_DECK.length - 1;
  const pad = 10;

  return (
    <div className="pm" aria-live="polite">
      {slide || over ? (
        <div className={over ? 'pm-over' : 'pm-slide'}>
          <div className="pm-slide-in">
            {s.kicker && <div className="pm-kicker">{s.kicker}</div>}
            <h1 className={`pm-slide-title ${step === 0 ? 'pm-cover' : ''}`}>{s.title}</h1>
            <Extras s={s} />
            {s.body && <Body lines={s.body} />}
            {s.foot && <p className="pm-foot">{s.foot}</p>}
          </div>
        </div>
      ) : (
        <>
          {box && !noDim && (
            <div
              className="pm-spot"
              style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }}
            />
          )}
          {!hideNote && !s.bare && (
            <div className={`pm-note pm-note-${s.note ?? 'right'}`}>
              {s.kicker && <div className="pm-kicker">{s.kicker}</div>}
              <h2 className="pm-note-title">{s.title}</h2>
              <Extras s={s} />
              {s.body && <Body lines={s.body} />}
              {s.foot && <p className="pm-foot">{s.foot}</p>}
            </div>
          )}
        </>
      )}
      {toc && (
        <div className="pm-toc-bg" onClick={() => setToc(false)}>
          <nav className="pm-toc" onClick={(e) => e.stopPropagation()} aria-label="발표 목차">
            <div className="pm-toc-head">
              <b>목차</b>
              <span className="muted small">눌러서 그 장으로 · T 로 열고 닫기</span>
            </div>
            {PRESENT_TOC.map((g) => {
              const here = g.steps.some((x) => x.i === step);
              return (
                <div key={g.section} className={`pm-toc-sec ${here ? 'here' : ''}`}>
                  <button className="pm-toc-title" onClick={() => setStep(g.start)}>
                    <span>{g.section}</span>
                    <span className="pm-toc-n">{g.start + 1}</span>
                  </button>
                  {g.steps.length > 1 && (
                    <div className="pm-toc-steps">
                      {g.steps.map((x) => (
                        <button key={x.i} className={x.i === step ? 'on' : ''} onClick={() => setStep(x.i)}>
                          <span className="pm-toc-n">{x.i + 1}</span> {x.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </div>
      )}
      <div className="pm-bar">
        <button className={`pm-toc-btn ${toc ? 'on' : ''}`} onClick={() => setToc((v) => !v)} title="목차 (T)">
          ☰ 목차
        </button>
        <button onClick={() => setStep(step - 1)} disabled={step === 0} aria-label="이전">
          ←
        </button>
        <span className="pm-count" title={s.section}>
          {step + 1} / {PRESENT_DECK.length}
        </span>
        <button onClick={() => (last ? setStep(null) : setStep(step + 1))} aria-label={last ? '발표 끝내기' : '다음'}>
          {last ? '끝' : '→'}
        </button>
        {!slide && !over && !s.bare && (
          <button className={hideNote ? 'on' : ''} onClick={() => setHideNote((v) => !v)} title="메모 숨기기/보이기 (H)">
            메모
          </button>
        )}
        {!slide && !over && s.target && (
          <button className={noDim ? 'on' : ''} onClick={() => setNoDim((v) => !v)} title="어둡게 하기 끄기/켜기 (D)">
            밝게
          </button>
        )}
        <span className="pm-dots" aria-hidden="true">
          {PRESENT_DECK.map((_, i) => (
            <i key={i} className={i === step ? 'on' : i < step ? 'done' : ''} onClick={() => setStep(i)} />
          ))}
        </span>
        <button className="pm-exit" onClick={() => setStep(null)} title="발표 끝내기 (Esc)">
          ✕
        </button>
      </div>
    </div>
  );
}

function Body({ lines }: { lines: string[] }) {
  const items = lines.filter((l) => l.startsWith('· '));
  const paras = lines.filter((l) => !l.startsWith('· '));
  return (
    <div className="pm-body">
      {paras.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {items.length > 0 && (
        <ul>
          {items.map((l, i) => (
            <li key={i}>{l.slice(2)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 상자 그림 · 두 칸 비교 · 표 */
function Extras({ s }: { s: PresentStep }) {
  return (
    <>
      {s.flow && (
        <div className="pm-flow">
          {s.flow.map((row, r) => (
            <div key={r} className="pm-flow-row">
              {row.label && <span className="pm-flow-label">{row.label}</span>}
              {row.items.map((it, i) => (
                <span key={i} className="pm-flow-cell">
                  {i > 0 && row.arrows !== false && <span className="pm-flow-arrow" aria-hidden="true">→</span>}
                  <span className={`pm-box ${it.hot ? 'hot' : ''}`}>
                    <b>{it.t}</b>
                    {it.s && <small>{it.s}</small>}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
      {s.cols && (
        <div className="pm-cols">
          {s.cols.map((c, i) => (
            <div key={i} className={`pm-col ${c.tone ?? ''}`}>
              <b className="pm-col-title">{c.title}</b>
              <ul>
                {c.items.map((x, j) => (
                  <li key={j}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {s.table && (
        <table className="pm-table">
          <thead>
            <tr>
              {s.table[0].map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.table.slice(1).map((row, r) => (
              <tr key={r}>
                {row.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
