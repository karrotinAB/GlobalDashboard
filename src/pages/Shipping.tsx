// 🚚 출고 관리: 주문 관리에서 출고 '승인' 된 주문을 묶음별로 (묶음 아닌 주문은 한 줄씩)
//   묶음 · 주문 (누르면 안의 주문) + DOC CLS · CARGO CLS · ETD · ETA 날짜
//   패킹 승인 금액 (그 업체 수출 통화) · 실제 입금 금액 (+ 짧은 메모)
//   외화정리 · 수출면장 · 배차 · 관리부출고 ○ → ● (관리부출고는 날짜 = 주문 관리 '출고일')
//   ON BOARD ☐ · 출고마감 · 결재서류 ○
//   저장: 묶음이면 묶음 안 주문마다 bundle.ship 에 같이, 묶음 아니면 order.ship (주문 관리 묶음과 같은 방식)
import { Fragment, useMemo, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { DateCell } from '../components/OrderCells';
import { fmtCur, useOrderUsd } from '../lib/sales';
import type { Order, ShipInfo } from '../types';

type Group = {
  key: string;
  name: string;
  color?: string;
  bundleId?: string;
  orders: Order[]; // 묶음 안 주문 전부
  approved: Order[]; // 그중 출고 승인된 것
  ship: ShipInfo;
  shipDate?: string; // 관리부출고 날짜 (= 주문 관리 출고일)
  companyId: string | null;
};
type StepKey = 'fx' | 'license' | 'truck' | 'onBoard' | 'closeOut' | 'papers';

const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');
const num = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

export default function Shipping() {
  const { data, save, saveMany } = useStore();
  const { companies, companyById } = useLookups();
  const fxc = useOrderUsd(companies, data.orders);
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open');
  const [co, setCo] = useState('');
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [view, setView] = useState<'list' | 'cal'>(() => (localStorage.getItem('gd:shipView') === 'cal' ? 'cal' : 'list'));
  const pickView = (v: 'list' | 'cal') => {
    setView(v);
    try {
      localStorage.setItem('gd:shipView', v);
    } catch {
      /* 무시 */
    }
  };

  // 출고 승인된 주문이 있는 묶음 · 주문
  const groups = useMemo(() => {
    const byBundle = new Map<string, Order[]>();
    const singles: Order[] = [];
    for (const o of data.orders) {
      if (o.bundle) byBundle.set(o.bundle.id, [...(byBundle.get(o.bundle.id) ?? []), o]);
      else if (o.outStatus === 'approved') singles.push(o);
    }
    const out: Group[] = [];
    for (const [id, os] of byBundle) {
      const approved = os.filter((o) => o.outStatus === 'approved');
      if (!approved.length) continue;
      const b = os[0].bundle!;
      out.push({ key: `b:${id}`, name: b.name || '묶음', color: b.color, bundleId: id, orders: os, approved, ship: b.ship ?? {}, shipDate: b.shipDate, companyId: os[0].companyId });
    }
    for (const o of singles) out.push({ key: `o:${o.id}`, name: o.name, orders: [o], approved: [o], ship: o.ship ?? {}, shipDate: o.shipDate, companyId: o.companyId });
    // 최근 출고(ETD · 관리부출고 · 승인일) 먼저
    const when = (g: Group) => g.ship.etd || g.shipDate || g.approved.map((o) => o.outDate ?? o.orderDate ?? '').sort().at(-1) || '';
    return out.sort((a, b) => when(b).localeCompare(when(a)));
  }, [data.orders]);

  const shown = groups.filter((g) => (!co || g.companyId === co) && (tab === 'all' ? true : tab === 'done' ? !!g.ship.closeOut : !g.ship.closeOut));
  const coIds = [...new Set(groups.map((g) => g.companyId).filter((x): x is string => !!x))];

  // 저장: 묶음이면 묶음 안 주문 모두에, 아니면 그 주문에
  const saveShip = (g: Group, patch: Partial<ShipInfo>, shipDate?: string | null) => {
    const ship = JSON.parse(JSON.stringify({ ...g.ship, ...patch })) as ShipInfo;
    if (g.bundleId)
      void saveMany(
        'orders',
        g.orders.map((o) => ({ ...o, bundle: { ...o.bundle!, ship, ...(shipDate !== undefined ? { shipDate: shipDate || undefined } : {}) } })),
      );
    else save('orders', { ...g.orders[0], ship, ...(shipDate !== undefined ? { shipDate: shipDate || undefined } : {}) });
  };
  const step = (g: Group, k: StepKey, label: string) => {
    const on = !!g.ship[k];
    return (
      <button className={`sh-step ${on ? 'on' : ''}`} title={`${label} ${on ? '완료 (누르면 취소)' : '— 누르면 완료'}`} onClick={() => saveShip(g, { [k]: !on })}>
        {on ? '●' : '○'}
      </button>
    );
  };
  const curOf = (g: Group) => fxc.curOf(g.orders[0]);
  const packing = (g: Group) => g.approved.reduce((a, o) => a + (o.amountForeign ?? 0), 0);

  return (
    <div className="page">
      <div className="page-head">
        <h1>출고 관리</h1>
        <p className="muted">주문 관리에서 출고 승인된 주문이 묶음별로 들어와요. 묶음 이름을 누르면 안의 주문이 보여요. 관리부출고 날짜는 주문 관리 출고일에 같이 들어가요.</p>
      </div>
      <div className="card toolbar sh-toolbar">
        <span className="seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>
            📋 목록
          </button>
          <button className={view === 'cal' ? 'on' : ''} onClick={() => pickView('cal')}>
            📅 달력
          </button>
        </span>
        {view === 'list' && (
        <span className="seg">
          {(
            [
              ['open', '진행중'],
              ['done', '출고마감'],
              ['all', '전체'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l} {k === 'open' ? groups.filter((g) => !g.ship.closeOut).length : k === 'done' ? groups.filter((g) => g.ship.closeOut).length : groups.length}
            </button>
          ))}
        </span>
        )}
        <select value={co} onChange={(e) => setCo(e.target.value)}>
          <option value="">업체 전체</option>
          {coIds.map((id) => (
            <option key={id} value={id}>
              {companyById.get(id)?.name ?? id}
            </option>
          ))}
        </select>
      </div>

      {view === 'cal' ? (
        <ShipCalendar
          groups={groups.filter((g) => !co || g.companyId === co)}
          coName={(id) => (companyById.get(id ?? '')?.name ?? '').replace(/\s*\(.*\)\s*$/, '')}
          onLabel={(g, label) => saveShip(g, { calLabel: label || undefined })}
          onOpen={(g) => {
            pickView('list');
            setTab('all');
            setOpenKey(g.key);
          }}
        />
      ) : (
      <div className="card sh-card">
        {shown.length === 0 ? (
          <p className="muted small">{groups.length ? '여기 해당하는 출고가 없어요.' : '아직 출고 승인된 주문이 없어요. 주문 관리에서 출고 승인이 되면 여기 들어와요.'}</p>
        ) : (
          <div className="table-scroll">
            <table className="sh-table">
              <thead>
                <tr>
                  <th className="sh-name-h">묶음 · 출고 일정</th>
                  <th className="r">패킹 승인 금액</th>
                  <th>실제 입금</th>
                  <th className="sh-c">외화정리</th>
                  <th className="sh-c">수출면장</th>
                  <th className="sh-c">배차</th>
                  <th className="sh-c">관리부출고</th>
                  <th className="sh-c">ON BOARD</th>
                  <th className="sh-c">출고마감</th>
                  <th className="sh-c">결재서류</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const open = openKey === g.key;
                  const cur = curOf(g);
                  return (
                    <Fragment key={g.key}>
                      <tr className={`sh-row ${g.ship.closeOut ? 'done' : ''}`} style={{ '--c': g.color ?? companyById.get(g.companyId ?? '')?.color ?? '#8c2f3c' } as CSSProperties}>
                        <td className="sh-name">
                          <button className="sh-title" onClick={() => setOpenKey(open ? null : g.key)} title="안의 주문 보기">
                            <span className="sh-dot" />
                            <b>{g.name}</b>
                            <span className="muted small">
                              {companyById.get(g.companyId ?? '')?.name ?? ''} · 주문 {g.orders.length}개{g.approved.length < g.orders.length ? ` (승인 ${g.approved.length})` : ''} {open ? '▴' : '▾'}
                            </span>
                          </button>
                          <div className="sh-dates">
                            {(
                              [
                                ['docCls', 'DOC CLS'],
                                ['cargoCls', 'CARGO CLS'],
                                ['etd', 'ETD'],
                                ['eta', 'ETA'],
                              ] as const
                            ).map(([k, l]) => (
                              <label key={k} className={g.ship[k] ? 'set' : ''}>
                                <span>{l}</span>
                                <DateCell value={g.ship[k]} onSave={(v) => saveShip(g, { [k]: v || undefined })} />
                                {(k === 'etd' || k === 'eta') && (
                                  <TextInput
                                    className="sh-port"
                                    placeholder="항구"
                                    value={k === 'etd' ? g.ship.etdPort : g.ship.etaPort}
                                    onSave={(v) => saveShip(g, k === 'etd' ? { etdPort: v || undefined } : { etaPort: v || undefined })}
                                  />
                                )}
                              </label>
                            ))}
                          </div>
                        </td>
                        <td className="r sh-amt">{fmtCur(cur, packing(g)) || '-'}</td>
                        <td className="sh-recv">
                          <MoneyInput cur={cur} value={g.ship.received} onSave={(v) => saveShip(g, { received: v })} />
                          <MemoInput value={g.ship.receivedMemo} onSave={(v) => saveShip(g, { receivedMemo: v || undefined })} />
                        </td>
                        <td className="sh-c">{step(g, 'fx', '외화정리')}</td>
                        <td className="sh-c">{step(g, 'license', '수출면장')}</td>
                        <td className="sh-c">{step(g, 'truck', '배차')}</td>
                        <td className="sh-c sh-out">
                          {/* 관리부출고: 날짜를 쓰면 완료 · 그 날짜가 주문 관리 출고일 */}
                          <span className={`sh-step ${g.shipDate ? 'on' : ''}`} aria-hidden="true">
                            {g.shipDate ? '●' : '○'}
                          </span>
                          <DateCell value={g.shipDate} onSave={(v) => saveShip(g, {}, v ?? null)} />
                        </td>
                        <td className="sh-c">
                          <input type="checkbox" checked={!!g.ship.onBoard} onChange={(e) => saveShip(g, { onBoard: e.target.checked })} title="ON BOARD" />
                        </td>
                        <td className="sh-c">{step(g, 'closeOut', '출고마감')}</td>
                        <td className="sh-c">{step(g, 'papers', '결재서류')}</td>
                      </tr>
                      {open && (
                        <tr className="sh-detail">
                          <td colSpan={10}>
                            <table className="mini-table">
                              <thead>
                                <tr>
                                  <th>주문</th>
                                  <th>매장코드</th>
                                  <th>주문일</th>
                                  <th>출고 승인</th>
                                  <th className="r">원화</th>
                                  <th className="r">외화</th>
                                </tr>
                              </thead>
                              <tbody>
                                {g.orders.map((o) => (
                                  <tr key={o.id}>
                                    <td>
                                      <a href={`#/orders?c=${o.companyId ?? ''}&o=${o.id}`} title="주문 관리에서 보기">
                                        {o.name}
                                      </a>
                                    </td>
                                    <td>{o.storeCode ?? ''}</td>
                                    <td>{dot(o.orderDate)}</td>
                                    <td>{o.outStatus === 'approved' ? `승인${o.outDate ? ` ${dot(o.outDate)}` : ''}` : o.outStatus === 'partial' ? '일부 승인' : '대기'}</td>
                                    <td className="r">{o.amountKRW !== undefined ? `₩${Math.round(o.amountKRW).toLocaleString()}` : '-'}</td>
                                    <td className="r">{o.amountForeign !== undefined && o.amountForeign !== null ? fmtCur(fxc.curOf(o), o.amountForeign) : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
    </div>
  );
}

// ───────── 달력: DOC CLS (연두) · CARGO CLS (보라) · ETD / ETA (흰) · 출고 (빨강)
type CalEv = { date: string; kind: 'doc' | 'cargo' | 'etd' | 'eta' | 'out'; text: string; g: Group };
const KIND_LABEL: Record<CalEv['kind'], string> = { doc: 'DOC CLS', cargo: 'CARGO CLS', etd: 'ETD', eta: 'ETA', out: '출고' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ShipCalendar({ groups, coName, onLabel, onOpen }: { groups: Group[]; coName: (id: string | null) => string; onLabel: (g: Group, label: string) => void; onOpen: (g: Group) => void }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [edit, setEdit] = useState<{ key: string; v: string } | null>(null);
  const labelOf = (g: Group) => g.ship.calLabel || g.name.slice(0, 5);
  const events = useMemo(() => {
    const out: CalEv[] = [];
    for (const g of groups) {
      const head = `${coName(g.companyId)}) ${labelOf(g)}`;
      const add = (date: string | undefined, kind: CalEv['kind'], extra = '') => date && out.push({ date, kind, text: `${head} ${KIND_LABEL[kind]}${extra ? ` ${extra}` : ''}`, g });
      add(g.ship.docCls, 'doc');
      add(g.ship.cargoCls, 'cargo');
      add(g.ship.etd, 'etd', g.ship.etdPort);
      add(g.ship.eta, 'eta', g.ship.etaPort);
      add(g.shipDate, 'out');
    }
    const order: CalEv['kind'][] = ['out', 'doc', 'cargo', 'etd', 'eta'];
    return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);
  const byDate = new Map<string, CalEv[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  // 이 달 달력: 일요일부터 6주
  const start = new Date(month);
  start.setDate(1 - start.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const weeks = days[35].getMonth() !== month.getMonth() ? 5 : 6;
  const todayIso = ymd(new Date());
  const go = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="card sh-cal">
      <div className="sh-cal-head">
        <b>
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </b>
        <span className="sh-cal-legend small">
          <i className="k-doc" /> DOC CLS <i className="k-cargo" /> CARGO CLS <i className="k-etd" /> ETD · ETA <i className="k-out" /> 출고
        </span>
        <span className="sh-cal-nav">
          <button onClick={() => go(-1)} aria-label="이전 달">
            ‹
          </button>
          <button
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
          >
            오늘
          </button>
          <button onClick={() => go(1)} aria-label="다음 달">
            ›
          </button>
        </span>
      </div>
      <div className="sh-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w} className="sh-cal-w">
            {w}
          </div>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const iso = ymd(d);
          const evs = byDate.get(iso) ?? [];
          return (
            <div key={iso} className={`sh-cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''} ${iso === todayIso ? 'today' : ''}`}>
              <span className="sh-cal-num">{d.getDate() === 1 ? `${d.getMonth() + 1}월 1일` : d.getDate()}</span>
              {evs.map((e, i) => {
                const key = `${iso}-${e.g.key}-${e.kind}-${i}`;
                return edit?.key === key ? (
                  <input
                    key={key}
                    className="sh-ev-edit"
                    autoFocus
                    value={edit.v}
                    maxLength={20}
                    title="달력에 쓰는 묶음 이름 (이 묶음 날짜 모두에 같이 바뀌어요) · 비우면 묶음 이름 앞 5글자"
                    onChange={(x) => setEdit({ key, v: x.target.value })}
                    onKeyDown={(x) => {
                      if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
                      if (x.key === 'Escape') setEdit(null);
                    }}
                    onBlur={() => {
                      if (edit.v.trim() !== labelOf(e.g)) onLabel(e.g, edit.v.trim() === e.g.name.slice(0, 5) ? '' : edit.v.trim());
                      setEdit(null);
                    }}
                  />
                ) : (
                  <button
                    key={key}
                    className={`sh-ev k-${e.kind}`}
                    title={`${e.text}\n누르면 이름 고치기 · 두 번 누르면 목록에서 열기`}
                    onClick={() => setEdit({ key, v: labelOf(e.g) })}
                    onDoubleClick={() => {
                      setEdit(null);
                      onOpen(e.g);
                    }}
                  >
                    {e.text}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        이름을 누르면 달력에 쓰는 묶음 이름을 고칠 수 있어요 (그 묶음의 날짜 모두에 같이 바뀌어요) · 두 번 누르면 목록에서 그 묶음을 열어요 · 날짜는 목록에서 써요
      </p>
    </div>
  );
}

/** 짧은 글 칸 (항구 등): 칸에서 나가면 저장 */
function TextInput({ value, onSave, placeholder, className }: { value?: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value ?? '');
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setV(value ?? '');
  }
  return (
    <input
      className={className}
      placeholder={placeholder}
      maxLength={30}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value ?? '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 실제 입금 금액: 칸에서 나가면 저장 */
function MoneyInput({ cur, value, onSave }: { cur: string; value?: number; onSave: (v?: number) => void }) {
  const show = (v?: number) => (v === undefined ? '' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const [v, setV] = useState(show(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setV(show(value));
  }
  return (
    <span className="sh-money">
      <span className="muted small">{cur}</span>
      <input
        inputMode="decimal"
        placeholder="입금액"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = num(v);
          if (n !== value) onSave(n);
          setV(show(n));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}
/** 짧은 메모 */
function MemoInput({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value ?? '');
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setV(value ?? '');
  }
  return (
    <input
      className="sh-memo"
      placeholder="메모"
      maxLength={80}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value ?? '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
