import { Fragment, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { isOrderDone, ORDER_STEPS, type Order, type OrderBundle, type OrderStepKey } from '../types';
import { uid } from '../lib/date';
import { EditableText, MoreMenu } from '../components/SheetCells';
import { AddOrderRow, AmountCell, CompanyCell, DateCell, fmtFX, fmtKRW } from '../components/OrderCells';

type Tab = 'open' | 'done' | 'all';

// 표에서 인보이스는 출고 장소 뒤로 (진행 순서 숫자 카드는 그대로)
const MID_STEPS = ORDER_STEPS.filter((s) => s.key !== 'invoice');
const BUNDLE_COLORS = ['#c0587a', '#4f7cae', '#d08a2e', '#5f8a4e', '#8e5a8a', '#3f8f8a', '#b5543c', '#7a6a4f'];

/** 순서 기준값: 직접 옮긴 순서가 있으면 그것, 없으면 주문일자 (작을수록 위 → 새 주문은 맨 아래) */
const keyOf = (o: Order) => o.sort ?? Date.parse(o.orderDate ?? o.createdAt) ?? 0;

type Unit = { bundle?: OrderBundle; orders: Order[] };
/** 묶음은 한 덩어리로: 묶음 안 가장 위(가장 오래된) 주문 기준으로 자리 잡고, 안에서는 순서대로 */
function toUnits(rows: Order[]): Unit[] {
  const units: Unit[] = [];
  const byBundle = new Map<string, Unit>();
  for (const o of rows) {
    if (o.bundle) {
      let u = byBundle.get(o.bundle.id);
      if (!u) {
        u = { bundle: o.bundle, orders: [] };
        byBundle.set(o.bundle.id, u);
        units.push(u);
      }
      u.orders.push(o);
    } else units.push({ orders: [o] });
  }
  const top = (u: Unit) => Math.min(...u.orders.map(keyOf));
  for (const u of units) u.orders.sort((a, b) => keyOf(a) - keyOf(b));
  return units.sort((a, b) => top(a) - top(b));
}

export default function Orders() {
  const { data, save, saveMany, remove } = useStore();
  const { companies, companyById } = useLookups();
  const [tab, setTab] = useState<Tab>('open');
  // 업체 = 시트: 고른 업체를 이 브라우저에 기억해서 다음에 열어도 그 시트로
  const [companyFilter, setCompanyFilterState] = useState<string>(() => {
    try {
      return localStorage.getItem('gd:orders:sheet') ?? '';
    } catch {
      return '';
    }
  });
  const setCompanyFilter = (id: string) => {
    setCompanyFilterState(id);
    try {
      localStorage.setItem('gd:orders:sheet', id);
    } catch {
      /* 저장 안 돼도 괜찮음 */
    }
  };
  const [showCompanies, setShowCompanies] = useState(false);
  const [missingStep, setMissingStep] = useState<OrderStepKey | null>(null);
  const [q, setQ] = useState('');

  // 기간: 주문일자 기준 연도 / 연도+월
  const [year, setYear] = useState('');
  const [month, setMonth] = useState('');
  const years = useMemo(
    () => [...new Set(data.orders.map((o) => (o.orderDate ?? o.createdAt).slice(0, 4)))].sort().reverse(),
    [data.orders],
  );
  const period = year ? (month ? `${year}-${month}` : year) : '';
  const base = useMemo(
    () =>
      data.orders.filter(
        (o) =>
          (!companyFilter || !companyById.has(companyFilter) || (o.companyId ?? '') === companyFilter) &&
          (!period || (o.orderDate ?? o.createdAt).startsWith(period)),
      ),
    [data.orders, companyFilter, companyById, period],
  );
  const openOrders = base.filter((o) => !isOrderDone(o));
  const doneCount = base.length - openOrders.length;

  const stepMissingCounts = useMemo(
    () => Object.fromEntries(ORDER_STEPS.map((s) => [s.key, openOrders.filter((o) => !o[s.key]).length])) as Record<OrderStepKey, number>,
    [openOrders],
  );

  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    // 아직 안 끝난 주문이 하나라도 있는 묶음 → 그 묶음의 완료건도 진행중에 같이 보여줌
    const openBundles = new Set(base.filter((o) => o.bundle && !isOrderDone(o)).map((o) => o.bundle!.id));
    return base
      .filter((o) => {
        // 검색어가 있으면 완료건까지 전부 검색
        if (!query) {
          if (tab === 'open' && isOrderDone(o) && !(o.bundle && openBundles.has(o.bundle.id))) return false;
          if (tab === 'done' && !isOrderDone(o)) return false;
        }
        if (missingStep && (o[missingStep] || isOrderDone(o))) return false;
        if (query) {
          const hay = [o.name, o.storeCode, o.orderDate, o.packing, o.shipFrom, o.note, companyById.get(o.companyId ?? '')?.name]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!hay.includes(query)) return false;
        }
        return true;
      })
      ;
  }, [base, tab, query, missingStep, companyById]);
  const units = useMemo(() => toUnits(rows), [rows]);
  const flat = useMemo(() => units.flatMap((u) => u.orders), [units]);

  // 선택 → 묶기 / 묶음 빼기
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const selectedOrders = data.orders.filter((o) => selected.has(o.id));
  const bundleSelected = () => {
    if (!selectedOrders.length) return;
    const existing = selectedOrders.find((o) => o.bundle)?.bundle;
    const used = new Set(data.orders.map((o) => o.bundle?.color));
    const target: OrderBundle = existing ?? { id: uid(), color: BUNDLE_COLORS.find((c) => !used.has(c)) ?? BUNDLE_COLORS[used.size % BUNDLE_COLORS.length] };
    saveMany('orders', selectedOrders.map((o) => ({ ...o, bundle: target })));
    setSelected(new Set());
  };
  const unbundleSelected = () => {
    saveMany('orders', selectedOrders.filter((o) => o.bundle).map((o) => ({ ...o, bundle: undefined })));
    setSelected(new Set());
  };
  const renameBundle = (b: OrderBundle, name: string) =>
    saveMany('orders', data.orders.filter((o) => o.bundle?.id === b.id).map((o) => ({ ...o, bundle: { ...b, name: name || undefined } })));
  const dissolve = (b: OrderBundle) => saveMany('orders', data.orders.filter((o) => o.bundle?.id === b.id).map((o) => ({ ...o, bundle: undefined })));

  // 끌어서 위치 바꾸기: 놓은 자리의 묶음에 같이 들어감 (묶음 아닌 줄에 놓으면 묶음에서 빠짐)
  const dragRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setOver(null);
  };
  const dropOn = (targetId: string, after: boolean, bundleOverride?: OrderBundle | null) => {
    const fromId = dragRef.current;
    endDrag();
    if (!fromId || fromId === targetId) return;
    const from = flat.find((o) => o.id === fromId);
    const target = flat.find((o) => o.id === targetId);
    if (!from || !target) return;
    const keys = flat.map(keyOf).sort((a, b) => a - b); // 지금 보이는 줄들의 순서값을 그대로 다시 나눠 씀
    const list = flat.filter((o) => o.id !== fromId);
    const at = list.findIndex((o) => o.id === targetId) + (after ? 1 : 0);
    const bundle = bundleOverride === undefined ? target.bundle : bundleOverride ?? undefined;
    list.splice(at, 0, { ...from, bundle });
    const changed = list
      .map((o, i) => ({ ...o, sort: keys[i] + i * 0.001 }))
      .filter((o) => {
        const before = data.orders.find((x) => x.id === o.id);
        return before?.sort !== o.sort || before?.bundle?.id !== o.bundle?.id;
      });
    saveMany('orders', changed);
  };

  const toggle = (o: Order, key: OrderStepKey) => save('orders', { ...o, [key]: !o[key] });

  const sheet = companyById.get(companyFilter); // 지금 보고 있는 업체 시트 (없으면 전체)
  const colSpan = sheet ? 15 : 16;
  const sum = (list: Order[], k: 'amountKRW' | 'amountForeign') => list.reduce((a, o) => a + (o[k] ?? 0), 0);
  const hasAmt = (list: Order[], k: 'amountKRW' | 'amountForeign') => list.some((o) => o[k] !== undefined);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주문 관리</h1>
          <p className="muted">출고 + 인보이스까지 체크되면 자동으로 '완료'로 이동해요. 칸을 누르면 바로 고칠 수 있어요 · 완료건도 검색하면 다 나와요.</p>
        </div>
      </div>

      <p className="stat-scope muted small">
        {sheet ? `${sheet.name} 기준` : '전체 업체 기준'}
        {period ? ` · ${year}년${month ? ` ${Number(month)}월` : ''}` : ''} · 숫자를 누르면 그 단계가 안 된 주문만 보여요
      </p>
      <div className="stat-row">
        {ORDER_STEPS.map((s) => (
          <button
            key={s.key}
            className={`stat ${missingStep === s.key ? 'selected' : ''}`}
            onClick={() => {
              setMissingStep(missingStep === s.key ? null : s.key);
              setTab('open');
            }}
          >
            <span className="stat-num">{stepMissingCounts[s.key]}</span>
            <span className="stat-label">{s.label} 안 된 건</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className={`period ${period ? 'on' : ''}`}>
          <select
            value={year}
            onChange={(e) => {
              setYear(e.target.value);
              if (!e.target.value) setMonth('');
            }}
            title="주문일자 연도"
          >
            <option value="">전체 기간</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y}년
              </option>
            ))}
          </select>
          {year && (
            <select value={month} onChange={(e) => setMonth(e.target.value)} title="주문일자 월">
              <option value="">전체 월</option>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map((m) => (
                <option key={m} value={m}>
                  {Number(m)}월
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="seg">
          <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>
            진행중 <b>{openOrders.length}</b>
          </button>
          <button className={tab === 'done' ? 'on' : ''} onClick={() => setTab('done')}>
            완료 <b>{doneCount}</b>
          </button>
          <button className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>
            전체 <b>{base.length}</b>
          </button>
        </div>
        <button
          className={`company-toggle ${sheet || showCompanies ? 'on' : ''}`}
          onClick={() => (sheet ? setCompanyFilter('') : setShowCompanies((v) => !v))}
          title={sheet ? '모든 업체 보기' : '업체(시트) 고르기'}
        >
          {sheet ? (
            <>
              <span className="dot" style={{ background: sheet.color }} />
              {sheet.name} ✕
            </>
          ) : (
            <>업체 고르기 {showCompanies ? '▴' : '▾'}</>
          )}
        </button>
        <input className="search" placeholder="주문명 / 매장코드 / 비고 검색 (완료건 포함)" value={q} onChange={(e) => setQ(e.target.value)} />
        {missingStep && (
          <button className="link" onClick={() => setMissingStep(null)}>
            '{ORDER_STEPS.find((s) => s.key === missingStep)?.label} 안 된 건' 필터 해제 ✕
          </button>
        )}
        {showCompanies && !sheet && (
          <div className="company-chips">
            {companies.map((c) => (
              <button
                key={c.id}
                className="cchip"
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

      {query && <div className="banner">검색 중에는 진행중/완료 구분 없이 전체에서 찾아요. ({rows.length}건)</div>}

      {!sheet && !query && !missingStep ? (
        <div className="pick-company">
          <p>
            <b>업체를 골라주세요</b> · 고른 업체의 주문만 보여요 (검색은 업체를 안 골라도 전체에서 찾아요)
          </p>
          <div className="company-chips">
            {companies.map((c) => (
              <button
                key={c.id}
                className="cchip"
                style={{ '--c': c.color ?? '#999' } as CSSProperties}
                onClick={() => {
                  setCompanyFilter(c.id);
                  setShowCompanies(false);
                }}
              >
                <span className="dot" style={{ background: c.color }} />
                {c.name}
                <span className="cchip-n">{data.orders.filter((o) => o.companyId === c.id && !isOrderDone(o)).length}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
      <div className="table-scroll">
        <table className="order-table">
          <thead>
            <tr>
              <th className="c-gutter" />
              <th className="c-name">주문</th>
              {!sheet && <th className="c-co">업체</th>}
              {MID_STEPS.map((s) => (
                <th key={s.key} className="c-step">
                  {s.label}
                </th>
              ))}
              <th className="c-code">매장코드</th>
              <th className="c-date">주문일자</th>
              <th className="c-pack">패킹 완료일</th>
              <th className="c-from">출고 장소</th>
              <th className="c-step">인보이스</th>
              <th className="c-amt">원화 금액</th>
              <th className="c-amt">외화 금액</th>
              <th className="c-onote">비고</th>
              <th className="c-more" />
            </tr>
          </thead>
          {/* 묶음마다 tbody 하나 → 묶음에 마우스를 올리면 '풀기'가 보임 */}
          {units.map((u, i) => (
            <tbody key={u.bundle?.id ?? u.orders[0].id} className={u.bundle ? 'bundle-body' : undefined}>
              {/* 묶음 앞뒤로 살짝 띄우기 */}
              {i > 0 && (u.bundle || units[i - 1].bundle) && (
                <tr className="bundle-gap" aria-hidden="true">
                  <td colSpan={colSpan} />
                </tr>
              )}
              {renderUnit(u)}
            </tbody>
          ))}
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="muted small pad">
                  해당하는 주문이 없어요.
                </td>
              </tr>
            )}
            {tab !== 'done' && !query && !sheet && (
              <tr className="add-row">
                <td colSpan={colSpan}>
                  <button className="add-row-btn pick-first" onClick={() => setShowCompanies(true)}>
                    + 주문 추가 · <b>업체를 골라주세요</b> (위 "업체 고르기"에서 업체를 고르면 그 업체로 추가돼요)
                  </button>
                </td>
              </tr>
            )}
            {tab !== 'done' && !query && sheet && (
              <AddOrderRow
                key={companyFilter}
                colSpan={colSpan}
                companies={companies}
                lockCompany={!!sheet}
                defaultCompanyId={sheet?.id ?? companies[0]?.id ?? null}
                stepCount={MID_STEPS.length}
                onAdd={(o) => save('orders', { ...o, sort: Date.now() })}
              />
            )}
          </tbody>
        </table>
      </div>
      )}

      {selected.size > 0 && (
        <div className="select-bar">
          <b>{selected.size}건 선택</b>
          <button className="primary" onClick={bundleSelected}>
            🔗 같이 출고로 묶기
          </button>
          {selectedOrders.some((o) => o.bundle) && <button onClick={unbundleSelected}>묶음에서 빼기</button>}
          <button className="link" onClick={() => setSelected(new Set())}>
            선택 해제
          </button>
        </div>
      )}
    </div>
  );

  // 컴포넌트가 아니라 그리기 함수로 둬서, 다시 그려도 편집 중인 칸이 닫히지 않음
  function renderUnit(u: Unit) {
    return (
      <>
        {u.bundle && (
          <tr
            className={`bundle-head ${over?.id === `b:${u.bundle.id}` ? 'drop-target' : ''}`}
            style={{ '--bc': u.bundle.color } as CSSProperties}
            onDragOver={(e) => {
              if (!dragRef.current) return;
              e.preventDefault();
              if (over?.id !== `b:${u.bundle!.id}`) setOver({ id: `b:${u.bundle!.id}`, after: false });
            }}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(u.orders[0].id, false, u.bundle);
            }}
          >
            <td className="c-gutter">
              <span className="bundle-bar top" />
              <button
                className="bundle-undo"
                title="묶음 풀기 (주문은 그대로 남아요)"
                onClick={() => confirm('이 묶음을 풀까요? (주문은 그대로 남아요)') && dissolve(u.bundle!)}
              >
                풀기
              </button>
            </td>
            <td colSpan={colSpan - 5}>
              <div className="bundle-title">
                <div className={`bundle-name-block ${u.bundle.name ? '' : 'unnamed'}`}>
                  <EditableText value={u.bundle.name ?? ''} oneLine placeholder="묶음 이름 쓰기 ✎" onSave={(v) => renameBundle(u.bundle!, v)} />
                </div>
              </div>
            </td>
            {/* 묶음 합계는 원화/외화 금액 칸 바로 위에 */}
            <td className="c-amt bundle-amt">{hasAmt(u.orders, 'amountKRW') && fmtKRW(sum(u.orders, 'amountKRW'))}</td>
            <td className="c-amt bundle-amt">{hasAmt(u.orders, 'amountForeign') && fmtFX(sum(u.orders, 'amountForeign'))}</td>
            <td colSpan={2} />
          </tr>
        )}
        {u.orders.map((o, i) => (
          <Fragment key={o.id}>{renderRow(o, u.bundle, i === u.orders.length - 1)}</Fragment>
        ))}
      </>
    );
  }

  function renderRow(o: Order, bundle: OrderBundle | undefined, last: boolean) {
    const done = isOrderDone(o);
    const patch = (p: Partial<Order>) => save('orders', { ...o, ...p });
    const txt = (k: 'storeCode' | 'packing' | 'shipFrom' | 'note', ph: string) => (
      <EditableText value={o[k] ?? ''} oneLine placeholder={ph} onSave={(v) => patch({ [k]: v || undefined })} />
    );
    const sel = selected.has(o.id);
    const step = (k: OrderStepKey, label: string) => (
      <td key={k} className="c-step">
        <input type="checkbox" checked={o[k]} onChange={() => toggle(o, k)} aria-label={label} />
      </td>
    );
    return (
      <tr
        className={`${done ? 'is-done' : ''} ${sel ? 'is-selected' : ''} ${bundle ? 'in-bundle' : ''} ${dragId === o.id ? 'row-dragging' : ''} ${
          over?.id === o.id ? (over.after ? 'drop-after' : 'drop-before') : ''
        }`}
        style={bundle ? ({ '--bc': bundle.color } as CSSProperties) : undefined}
        onDragOver={(e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          const after = e.clientY > r.top + r.height / 2;
          if (over?.id !== o.id || over.after !== after) setOver({ id: o.id, after });
        }}
        onDrop={(e) => {
          e.preventDefault();
          dropOn(o.id, over?.id === o.id ? over.after : false);
        }}
      >
        <td className="c-gutter">
          {bundle && <span className={`bundle-bar ${last ? 'bottom' : ''}`} />}
          <span
            className="row-handle"
            draggable
            title="끌어서 위치 바꾸기 (묶음 안에 놓으면 그 묶음으로)"
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', o.name);
              const tr = e.currentTarget.closest('tr');
              if (tr) e.dataTransfer.setDragImage(tr, 20, 14);
              dragRef.current = o.id;
              setTimeout(() => setDragId(o.id), 0);
            }}
            onDragEnd={endDrag}
          >
            ⠿
          </span>
          <input type="checkbox" className="sel" checked={sel} onChange={() => toggleSel(o.id)} title="선택 (묶기)" />
        </td>
        <td className="c-name">
          <EditableText value={o.name} oneLine onSave={(v) => v && patch({ name: v })} />
        </td>
        {!sheet && (
          <td className="c-co">
            <CompanyCell company={companyById.get(o.companyId ?? '')} companies={companies} onSave={(id) => patch({ companyId: id })} />
          </td>
        )}
        {MID_STEPS.map((s) => step(s.key, s.label))}
        <td className="c-code">{txt('storeCode', '매장코드')}</td>
        <td className="c-date">
          <DateCell value={o.orderDate} onSave={(v) => patch({ orderDate: v })} />
        </td>
        <td className="c-pack">{txt('packing', '패킹')}</td>
        <td className="c-from">{txt('shipFrom', '출고 장소')}</td>
        {step('invoice', '인보이스')}
        <td className="c-amt">
          <AmountCell value={o.amountKRW} kind="krw" onSave={(v) => patch({ amountKRW: v })} />
        </td>
        <td className="c-amt">
          <AmountCell value={o.amountForeign} kind="fx" onSave={(v) => patch({ amountForeign: v })} />
        </td>
        <td className="c-onote">
          <EditableText value={o.note ?? ''} oneLine expand placeholder="비고" onSave={(v) => patch({ note: v || undefined })} />
        </td>
        <td className="c-more">
          <div className="status-cell">
            {done && <span className="tag green">완료</span>}
            <MoreMenu
              title="완료 처리 · 삭제"
              items={[
                o.closed
                  ? { label: '↩ 수동 완료 취소', onClick: () => patch({ closed: false }) }
                  : { label: '✓ 수동 완료 처리 (출고/인보이스 필요 없는 건)', onClick: () => patch({ closed: true }) },
                { label: '🗑 삭제', danger: true, onClick: () => confirm(`"${o.name}" 주문을 삭제할까요?`) && remove('orders', o.id) },
              ]}
            />
          </div>
        </td>
      </tr>
    );
  }
}
