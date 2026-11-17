// 전도금 프린트 › 3. 영수증: A4 한 장에 영수증 4개(2×2)씩, 정산서 항목(용도)별로 장을 나눠 날짜순으로 붙임
//   가운데 = 지금 고친 장 (영수증을 끌어서 옮기고, 오른쪽 아래 모서리로 크기 바꾸고, 위 글자도 끌어서 옮김)
//   오른쪽 = 모든 장 미리보기 (항목별로 묶음, 누르면 그 장을 고침)
//   종이영수증은 그 자리(1/4)를 비워 두고 글자만 찍음 → 인쇄 후 종이를 붙이면 돼요
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { fmtCur } from '../lib/sales';
import { itemOf, savePettyPeriod, type PettyEntry, type PettyPeriod, type RcptPos, type SheetRow } from '../lib/petty';

const PAGE_W = 210;
const PAGE_H = 297;
const M = 10; // 바깥 여백 mm
const GAP = 6;
const CELL_W = (PAGE_W - M * 2 - GAP) / 2;
const CELL_H = (PAGE_H - M * 2 - GAP) / 2;
const LABEL_H = 9; // 글자 줄 높이 (기본)
const DEF_FS = 9;

type Box = { e: PettyEntry; item: string; label: string; page: string; x: number; y: number; w: number; h: number; fs: number; lx: number; ly: number; bold?: boolean; hl?: boolean; hlc?: string; text?: string; moved: boolean };

const isImg = (e: PettyEntry) => !!e.receipt && (/\.(png|jpe?g|gif|webp|heic|bmp)$/i.test(e.receipt.name) || e.receipt.url.startsWith('data:image'));

export function labelOf(e: PettyEntry) {
  const what = e.kind === 'transport' ? e.content || `${e.from ?? ''}→${e.to ?? ''} ${e.mode === '기타' ? e.modeOther || '기타' : e.mode ?? ''} 교통비` : e.content || e.purpose || '';
  const head = `글로벌사업부/${e.name ?? ''}/${what.trim()}`;
  // 외화 영수증: 둘째 줄에 '기록한 금액 × 환율 = 원화'
  if (e.cur && e.cur !== 'KRW' && e.curAmount !== undefined && e.rate && e.amount !== undefined)
    return `${head}\n${fmtCur(e.cur, e.curAmount)} × ${Math.round(e.rate * 100) / 100} = ₩${e.amount.toLocaleString('ko-KR')}`;
  return head;
}
export const HL_COLORS = ['#fff36b', '#b6f2a9', '#ffc6dd', '#bfe3ff', '#ffd59a'];

/** 자동 배치 + 담당자가 옮긴 것 합치기 */
function useLayout(entries: PettyEntry[], rows: SheetRow[], over: Record<string, RcptPos>) {
  return useMemo(() => {
    const order = rows.map((r) => r.item.trim());
    const withRc = entries.filter((e) => e.receipt) // 종이영수증은 자리를 따로 비우지 않음.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    const byItem = new Map<string, PettyEntry[]>();
    for (const e of withRc) {
      const it = itemOf(rows, e);
      byItem.set(it, [...(byItem.get(it) ?? []), e]);
    }
    const boxes: Box[] = [];
    for (const [item, list] of byItem) {
      list.forEach((e, i) => {
        const slot = i % 4;
        const def = { page: `${item}#${Math.floor(i / 4) + 1}`, x: M + (slot % 2) * (CELL_W + GAP), y: M + Math.floor(slot / 2) * (CELL_H + GAP), w: CELL_W, h: CELL_H, fs: DEF_FS, lx: 0, ly: 0 };
        const o = over[e.id] ?? {};
        const b = { e, item, label: labelOf(e), ...def, ...o, moved: !!over[e.id] } as Box;
        if (o.text) b.label = o.text;
        boxes.push(b);
      });
    }
    // 장 목록: 항목 순서(정산서) → 번호 순
    const keys = [...new Set(boxes.map((b) => b.page))];
    const rank = (k: string) => {
      const [it, n] = k.split('#');
      const i = order.indexOf(it);
      return [(i < 0 ? 99 : i), Number(n.replace(/\D/g, '')) || 0, n] as const;
    };
    keys.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] - rb[0] || ra[1] - rb[1] || String(ra[2]).localeCompare(String(rb[2]));
    });
    const noReceipt = entries.filter((e) => !e.receipt && !e.paper);
    const paperN = entries.filter((e) => !e.receipt && e.paper).length;
    return { boxes, pages: keys, noReceipt, paperN };
  }, [entries, rows, over]);
}

export default function PettyReceipts({ pk, per, entries, rows }: { pk: string; per: PettyPeriod; entries: PettyEntry[]; rows: SheetRow[] }) {
  const saved = per.rcpt ?? {};
  // 끄는 중에는 화면에서만 바꾸고, 손을 떼면 저장
  const [draft, setDraft] = useState<Record<string, RcptPos>>(saved);
  useEffect(() => setDraft(per.rcpt ?? {}), [per.rcpt]);
  const { boxes, pages, noReceipt, paperN } = useLayout(entries, rows, draft);
  const [cur, setCur] = useState('');
  const page = pages.includes(cur) ? cur : pages[0] ?? '';
  const [sel, setSel] = useState<string | null>(null);
  const selBox = boxes.find((b) => b.e.id === sel && b.page === page);
  const commit = (next: Record<string, RcptPos>) => {
    setDraft(next);
    void savePettyPeriod(pk, { ...per, rcpt: next });
  };
  const setPos = (id: string, p: RcptPos, save = true) => {
    const next = { ...draft, [id]: { ...(draft[id] ?? {}), ...p } };
    if (save) commit(next);
    else setDraft(next);
  };

  // ---- 끌기 (상자 옮기기 · 크기 · 글자) ----
  const stage = useRef<HTMLDivElement>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(2.4);
  useEffect(() => {
    const fit = () => {
      const w = stage.current?.clientWidth ?? 600;
      const s = Math.max(1.2, Math.min(3.2, (w - 8) / PAGE_W));
      scaleRef.current = s;
      setScale(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  const drag = (ev: RPointerEvent, b: Box, mode: 'move' | 'size' | 'label') => {
    ev.preventDefault();
    ev.stopPropagation();
    setSel(b.e.id);
    const sx = ev.clientX;
    const sy = ev.clientY;
    const start = { x: b.x, y: b.y, w: b.w, h: b.h, lx: b.lx, ly: b.ly };
    let last: RcptPos = {};
    const mv = (e: PointerEvent) => {
      const dx = (e.clientX - sx) / scaleRef.current;
      const dy = (e.clientY - sy) / scaleRef.current;
      const r1 = (n: number) => Math.round(n * 10) / 10;
      if (mode === 'move') last = { page: b.page, x: r1(Math.max(0, Math.min(PAGE_W - start.w, start.x + dx))), y: r1(Math.max(0, Math.min(PAGE_H - start.h, start.y + dy))) };
      else if (mode === 'size') last = { page: b.page, w: r1(Math.max(20, Math.min(PAGE_W - start.x, start.w + dx))), h: r1(Math.max(20, Math.min(PAGE_H - start.y, start.h + dy))) };
      else last = { page: b.page, lx: r1(start.lx + dx), ly: r1(start.ly + dy) };
      setPos(b.e.id, last, false);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      window.removeEventListener('pointerup', up);
      if (Object.keys(last).length) setPos(b.e.id, last, true);
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  // ---- 고른 영수증: 다른 장으로 · 글자 크기 · 원래대로 ----
  const pageIdx = pages.indexOf(page);
  const moveTo = (b: Box, target: string) => {
    // 옮겨 간 장의 비어 있는 칸(왼쪽 위부터)에 놓기
    const taken = boxes.filter((x) => x.page === target && x.e.id !== b.e.id);
    let slot = 0;
    for (; slot < 4; slot++) {
      const sx = M + (slot % 2) * (CELL_W + GAP);
      const sy = M + Math.floor(slot / 2) * (CELL_H + GAP);
      if (!taken.some((t) => Math.abs(t.x - sx) < 5 && Math.abs(t.y - sy) < 5)) break;
    }
    slot = slot % 4;
    setPos(b.e.id, { page: target, x: M + (slot % 2) * (CELL_W + GAP), y: M + Math.floor(slot / 2) * (CELL_H + GAP), w: CELL_W, h: CELL_H });
    setCur(target);
  };
  const newPage = (b: Box) => {
    const n = Math.max(0, ...pages.filter((k) => k.startsWith(`${b.item}#`)).map((k) => Number(k.split('#')[1].replace(/\D/g, '')) || 0)) + 1;
    moveTo(b, `${b.item}#${n}`);
  };
  const [editing, setEditing] = useState<string | null>(null); // 글자를 고치는 중인 영수증
  useEffect(() => setEditing(null), [sel]);
  const saveText = (b: Box, t: string) => {
    setEditing(null);
    const v = t.trim();
    setPos(b.e.id, { page: b.page, text: v && v !== labelOf(b.e) ? v : undefined });
  };
  const reset = (b: Box) => {
    const next = { ...draft };
    delete next[b.e.id];
    commit(next);
  };
  const resetAll = () => confirm('이 기간 영수증 배치를 모두 처음(자동)으로 되돌릴까요?') && commit({});

  // 방향키로 조금씩 옮기기
  useEffect(() => {
    if (!selBox) return;
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const d = e.shiftKey ? 5 : 1;
      const m: Record<string, [number, number]> = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] };
      if (!m[e.key]) return;
      e.preventDefault();
      setPos(selBox.e.id, { page: selBox.page, x: Math.max(0, selBox.x + m[e.key][0]), y: Math.max(0, selBox.y + m[e.key][1]) });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // 항목별 미리보기 묶음
  const groups = useMemo(() => {
    const g: [string, string[]][] = [];
    for (const k of pages) {
      const it = k.split('#')[0];
      if (g.length && g[g.length - 1][0] === it) g[g.length - 1][1].push(k);
      else g.push([it, [k]]);
    }
    return g;
  }, [pages]);

  if (!pages.length)
    return (
      <div className="card muted">
        이 기간에 영수증 사진이 올라온 전도금이 없어요.
        {noReceipt.length > 0 && <div className="small" style={{ marginTop: 6 }}>영수증이 없는 내역 {noReceipt.length}개가 있어요.</div>}
      </div>
    );

  return (
    <div className="rc-wrap">
      <div className="rc-main">
        <div className="rc-toolbar">
          <b>
            {page.split('#')[0]} <span className="muted small">· {page.split('#')[1]}번째 장 ({pageIdx + 1}/{pages.length})</span>
          </b>
          {selBox ? (
            <span className="rc-tools">
              <span className="muted small">글자</span>
              <button onClick={() => setPos(selBox.e.id, { page: selBox.page, fs: Math.max(5, selBox.fs - 1) })}>가−</button>
              <span className="small">{selBox.fs}pt</span>
              <button onClick={() => setPos(selBox.e.id, { page: selBox.page, fs: Math.min(24, selBox.fs + 1) })}>가＋</button>
              <button className={selBox.bold ? 'on' : ''} onClick={() => setPos(selBox.e.id, { page: selBox.page, bold: !selBox.bold || undefined })} title="굵게">
                <b>B</b>
              </button>
              <button className={selBox.hl ? 'on' : ''} onClick={() => setPos(selBox.e.id, { page: selBox.page, hl: !selBox.hl || undefined })} title="형광펜">
                <span className="rc-hl-ico">형광</span>
              </button>
              {selBox.hl &&
                HL_COLORS.map((c) => (
                  <button
                    key={c}
                    className={`rc-hl-dot ${(selBox.hlc ?? HL_COLORS[0]) === c ? 'on' : ''}`}
                    style={{ background: c }}
                    title="형광펜 색"
                    onClick={() => setPos(selBox.e.id, { page: selBox.page, hlc: c === HL_COLORS[0] ? undefined : c })}
                  />
                ))}
              <button onClick={() => setEditing(selBox.e.id)} title="글자 고치기 (글자를 두 번 눌러도 돼요)">
                ✎ 글자
              </button>
              {selBox.text && (
                <button onClick={() => setPos(selBox.e.id, { page: selBox.page, text: undefined })} title="처음 글자로">
                  ↺ 처음 글자
                </button>
              )}
              <span className="rc-sep" />
              <button disabled={pageIdx <= 0} onClick={() => moveTo(selBox, pages[pageIdx - 1])} title="앞 장으로">
                ◀ 앞 장
              </button>
              <button disabled={pageIdx >= pages.length - 1} onClick={() => moveTo(selBox, pages[pageIdx + 1])} title="다음 장으로">
                다음 장 ▶
              </button>
              <button onClick={() => newPage(selBox)} title="같은 항목 새 장을 만들어 옮기기">
                ＋ 새 장으로
              </button>
              {selBox.moved && <button onClick={() => reset(selBox)}>↺ 원래대로</button>}
            </span>
          ) : (
            <span className="muted small">영수증을 눌러 고르면 옮기기 · 크기 · 글자를 바꿀 수 있어요 (방향키로 조금씩, Shift+방향키로 크게)</span>
          )}
        </div>
        <div className="rc-stage" ref={stage} onPointerDown={() => setSel(null)}>
          <div style={{ width: PAGE_W * scale, height: PAGE_H * scale }}>
            <RcPage boxes={boxes.filter((b) => b.page === page)} scale={scale} sel={sel} onDrag={drag} editing={editing} onEdit={(b) => (setSel(b.e.id), setEditing(b.e.id))} onEditDone={saveText} />
          </div>
        </div>
        <div className="rc-foot">
          <button className="link small" onClick={resetAll}>
            ↺ 이 기간 배치 모두 처음으로
          </button>
          {noReceipt.length > 0 && <span className="muted small">영수증이 없는 내역 {noReceipt.length}개는 빠져 있어요</span>}
          {paperN > 0 && <span className="muted small">종이영수증 {paperN}개는 따로 붙여 주세요</span>}
        </div>
      </div>
      <aside className="rc-side">
        {groups.map(([it, ks]) => (
          <div key={it} className="rc-group">
            <div className="rc-group-head">{it}</div>
            <div className="rc-thumbs">
              {ks.map((k) => (
                <button key={k} className={`rc-thumb ${k === page ? 'on' : ''}`} onClick={() => (setCur(k), setSel(null))} title={`${it} ${k.split('#')[1]}번째 장`}>
                  <div style={{ width: PAGE_W * 0.42, height: PAGE_H * 0.42 }}>
                    <RcPage boxes={boxes.filter((b) => b.page === k)} scale={0.42} />
                  </div>
                  <span>{pages.indexOf(k) + 1}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>
      {/* 인쇄용: 모든 장 (화면에는 안 보임) */}
      <div id="ps-receipts" className="rc-print-src">
        {pages.map((k) => (
          <div key={k} className="ps-page rc-print-page">
            <RcPage boxes={boxes.filter((b) => b.page === k)} scale={0} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 한 장 그리기. scale=0 이면 인쇄용 (mm 단위 그대로) */
function RcPage({
  boxes,
  scale,
  sel,
  onDrag,
  editing,
  onEdit,
  onEditDone,
}: {
  boxes: Box[];
  scale: number;
  sel?: string | null;
  onDrag?: (ev: RPointerEvent, b: Box, mode: 'move' | 'size' | 'label') => void;
  editing?: string | null;
  onEdit?: (b: Box) => void;
  onEditDone?: (b: Box, text: string) => void;
}) {
  const u = (mm: number) => (scale ? `${mm * scale}px` : `${mm}mm`);
  const pt = (p: number) => (scale ? `${p * 0.3528 * scale}px` : `${p}pt`);
  return (
    <div className="rc-page" style={{ width: u(PAGE_W), height: u(PAGE_H) }}>
      {boxes.map((b) => {
        const st: CSSProperties = { left: u(b.x), top: u(b.y), width: u(b.w), height: u(b.h) };
        return (
          <div key={b.e.id} className={`rc-box ${sel === b.e.id ? 'sel' : ''} ${b.e.paper && !b.e.receipt ? 'paper' : ''}`} style={st} onPointerDown={onDrag ? (ev) => onDrag(ev, b, 'move') : undefined}>
            {editing === b.e.id && onEditDone ? (
              <textarea
                autoFocus
                className={`rc-label rc-label-edit ${b.bold ? 'bold' : ''}`}
                style={{ fontSize: pt(b.fs), left: u(b.lx), top: u(b.ly), width: u(b.w) }}
                defaultValue={b.label}
                rows={b.label.split('\n').length}
                onPointerDown={(ev) => ev.stopPropagation()}
                onBlur={(ev) => onEditDone(b, ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Escape') onEditDone(b, b.label);
                  if (ev.key === 'Enter' && !ev.shiftKey) {
                    ev.preventDefault();
                    (ev.target as HTMLTextAreaElement).blur();
                  }
                }}
              />
            ) : (
              <div
                className={`rc-label ${b.bold ? 'bold' : ''}`}
                style={{ fontSize: pt(b.fs), left: u(b.lx), top: u(b.ly), minHeight: u(LABEL_H) }}
                onPointerDown={onDrag ? (ev) => onDrag(ev, b, 'label') : undefined}
                onDoubleClick={onEdit ? () => onEdit(b) : undefined}
                title={onEdit ? '두 번 눌러 글자 고치기' : undefined}
              >
                <span className={b.hl ? 'rc-hl' : ''} style={b.hl ? { background: b.hlc ?? HL_COLORS[0] } : undefined}>
                  {b.label}
                </span>
              </div>
            )}
            <div className="rc-img" style={{ top: u(Math.max(LABEL_H, b.label.split('\n').length * b.fs * 0.3528 * 1.3 + 3)) }}>
              {b.e.receipt && isImg(b.e) ? (
                <img src={b.e.receipt.url} alt="" draggable={false} />
              ) : b.e.receipt ? (
                <span className="rc-file">📄 {b.e.receipt.name}</span>
              ) : (
                <span className="rc-paper">{scale >= 1 ? '종이영수증 붙이는 자리' : ''}</span>
              )}
            </div>
            {onDrag && sel === b.e.id && <span className="rc-size" onPointerDown={(ev) => onDrag(ev, b, 'size')} title="끌어서 크기 바꾸기" />}
          </div>
        );
      })}
    </div>
  );
}
