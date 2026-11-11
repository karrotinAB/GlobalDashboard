import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useAccess } from '../components/AuthGate';
import CompanyPicker from '../components/CompanyPicker';
import { LinkedTeamView } from './Overview';
import { Modal } from '../components/ui';
import { isOrderDone, ORDER_STEPS, type ConfigDoc, type Order, type OrderBundle, type OrderStepKey } from '../types';
import { pickColor, uid } from '../lib/date';
import { EditableText, MoreMenu } from '../components/SheetCells';
import { AddOrderRow, AmountCell, CompanyCell, DateCell, fmtFX, fmtKRW } from '../components/OrderCells';

type Tab = 'open' | 'done' | 'all';

// 진행 순서: 실주문 → ERP 등록 → 입고처리 → 인보이스 → 출고 (출고 체크 = 완료)
const MID_STEPS = ORDER_STEPS;
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
  const { myCompanies: companies, companyById } = useLookups();
  const [tab, setTab] = useState<Tab>('open');
  // 관리자 확인 도구 (ERP 원본 보기): 사이트 연결(firestore) 모드 + 관리자만
  const canInspect = DATA_MODE === 'firestore' && useAccess().role === 'admin';
  const [inspecting, setInspecting] = useState<Order | null>(null);
  // 업체 = 시트: 고른 업체를 이 브라우저에 기억해서 다음에 열어도 그 시트로
  const [companyFilter, setCompanyFilterState] = useState<string>(() => {
    // 홈에서 업체 카드의 '주문'을 누르고 오면 #/orders?c=업체id
    const fromLink = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c');
    try {
      if (fromLink) localStorage.setItem('gd:orders:sheet', fromLink);
      return fromLink ?? localStorage.getItem('gd:orders:sheet') ?? '';
    } catch {
      return fromLink ?? '';
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
  // 검색 줄 높이를 재서, 표 제목 줄이 그 밑에 붙게 (--toolbar-h)
  // 검색 줄은 업체를 고를 때마다 새로 그려지므로, 새로 생길 때마다 다시 잼 (예전 높이가 남지 않게)
  const toolbarRO = useRef<ResizeObserver | null>(null);
  const toolbarRef = useCallback((el: HTMLDivElement | null) => {
    toolbarRO.current?.disconnect();
    toolbarRO.current = null;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--toolbar-h', `${Math.round(el.getBoundingClientRect().height)}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    toolbarRO.current = ro;
  }, []);
  useEffect(() => () => toolbarRO.current?.disconnect(), []);
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
    const target: OrderBundle = existing ?? { id: uid(), color: (() => { const free = BUNDLE_COLORS.filter((c) => !used.has(c)); return free.length ? free[Math.floor(Math.random() * free.length)] : pickColor([...used]); })() };
    saveMany('orders', selectedOrders.map((o) => ({ ...o, bundle: target })));
    setSelected(new Set());
  };
  const unbundleSelected = () => {
    saveMany('orders', selectedOrders.filter((o) => o.bundle).map((o) => ({ ...o, bundle: undefined })));
    setSelected(new Set());
  };
  const renameBundle = (b: OrderBundle, name: string) =>
    saveMany('orders', data.orders.filter((o) => o.bundle?.id === b.id).map((o) => ({ ...o, bundle: { ...b, name: name || undefined } })));
  const recolorBundle = (b: OrderBundle, color: string) =>
    saveMany('orders', data.orders.filter((o) => o.bundle?.id === b.id).map((o) => ({ ...o, bundle: { ...b, color } })));
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
    if (fromId.startsWith('b:')) return moveBundle(fromId.slice(2), targetId, after);
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

  /** 묶음 통째로 옮기기: 놓은 줄이 속한 덩어리(묶음/주문) 앞이나 뒤로. 묶음 구성은 그대로 */
  const moveBundle = (bundleId: string, targetId: string, after: boolean) => {
    const from = units.find((u) => u.bundle?.id === bundleId);
    const target = units.find((u) => u.orders.some((o) => o.id === targetId));
    if (!from || !target || from === target) return;
    const list = units.filter((u) => u !== from);
    list.splice(list.indexOf(target) + (after ? 1 : 0), 0, from);
    const keys = flat.map(keyOf).sort((a, b) => a - b);
    const changed = list
      .flatMap((u) => u.orders)
      .map((o, i) => ({ ...o, sort: keys[i] + i * 0.001 }))
      .filter((o) => data.orders.find((x) => x.id === o.id)?.sort !== o.sort);
    saveMany('orders', changed);
  };

  const toggle = (o: Order, key: OrderStepKey) => save('orders', { ...o, [key]: !o[key] });

  const sheet = companyById.get(companyFilter); // 지금 보고 있는 업체 시트 (없으면 전체)
  const colSpan = sheet ? 15 : 16;
  // 첫 화면: 업체를 고르기 전에는 '업체를 골라주세요'만
  const landing = !sheet && !query && !missingStep;
  const sum = (list: Order[], k: 'amountKRW' | 'amountForeign') => list.reduce((a, o) => a + (o[k] ?? 0), 0);
  const hasAmt = (list: Order[], k: 'amountKRW' | 'amountForeign') => list.some((o) => o[k] !== undefined);

  // 팀장님·이사님: 조 업체를 고르면 그 조의 주문을 그대로 (보기만)
  if (sheet?.team) return <LinkedTeamView company={sheet} kind="orders" onBack={() => setCompanyFilter('')} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주문 관리</h1>
          <p className="muted">마지막 단계인 출고에 체크하면 자동으로 '완료'로 이동해요. 칸을 누르면 바로 고칠 수 있어요 · 완료건도 검색하면 다 나와요.</p>
        </div>
      </div>

      {!landing && (
      <>
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

      <div className="toolbar" ref={toolbarRef}>
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
        {sheet && DATA_MODE === 'firestore' && <SyncButton companyId={sheet.id} last={data.config.find((c) => c.id === 'apiSync')} />}
        {missingStep && (
          <button className="link" onClick={() => setMissingStep(null)}>
            '{ORDER_STEPS.find((s) => s.key === missingStep)?.label} 안 된 건' 필터 해제 ✕
          </button>
        )}
        {showCompanies && !sheet && (
          <CompanyPicker
            companies={companies}
            hasData={(c) => data.orders.some((o) => o.companyId === c.id)}
            onPick={(id) => {
              setCompanyFilter(id);
              setShowCompanies(false);
            }}
          />
        )}
      </div>

      </>
      )}
      {query && <div className="banner">검색 중에는 진행중/완료 구분 없이 전체에서 찾아요. ({rows.length}건)</div>}

      {landing ? (
        <div className="pick-company">
          <p>
            <b>업체를 골라주세요</b> · 고른 업체의 주문을 볼 수 있어요
          </p>
          <CompanyPicker
            companies={companies}
            hasData={(c) => data.orders.some((o) => o.companyId === c.id)}
            badge={(c) => <span className="cchip-n">{data.orders.filter((o) => o.companyId === c.id && !isOrderDone(o)).length}</span>}
            onPick={(id) => {
              setCompanyFilter(id);
              setShowCompanies(false);
            }}
            emptyText="아직 주문이 있는 업체가 없어요. ＋ 업체 추가를 눌러 시작해요."
          />
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
              <th className="c-amt c-krw">원화 금액</th>
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
                <td colSpan={colSpan} className="muted small pad empty-cell">
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
      {inspecting && <ErpInspector o={data.orders.find((x) => x.id === inspecting.id) ?? inspecting} onClose={() => setInspecting(null)} />}
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
                <span
                  className="row-handle bundle-handle"
                  draggable
                  title="끌어서 묶음 통째로 옮기기"
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', u.bundle!.name ?? '묶음');
                    const tr = e.currentTarget.closest('tr');
                    if (tr) e.dataTransfer.setDragImage(tr, 20, 14);
                    dragRef.current = `b:${u.bundle!.id}`;
                  }}
                  onDragEnd={endDrag}
                >
                  ⠿
                </span>
                <BundleColor color={u.bundle.color} onPick={(c) => recolorBundle(u.bundle!, c)} />
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
          <div className="name-wrap">
            {o.autoImported && o.name === '새 주문' && (
              <span className="auto-tag" title={`ERP 에서 자동으로 등록된 주문이에요${o.expNo ? ` (EXP_NO ${o.expNo})` : ''}. 이름을 바꾸면 표시가 사라져요.`}>
                NEW
              </span>
            )}
            <EditableText value={o.name} oneLine onSave={(v) => v && patch({ name: v })} />
          </div>
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
        <td className="c-amt c-krw">
          <div className="amt-wrap">
            {o.amountSource?.startsWith('api') && <ApiTag o={o} onInspect={canInspect ? () => setInspecting(o) : undefined} />}
            <AmountCell
              value={o.amountKRW}
              kind="krw"
              onSave={(v) => patch({ amountKRW: v, amountSource: v === undefined && o.amountForeign === undefined ? undefined : 'manual' })}
            />
          </div>
        </td>
        <td className="c-amt">
          <AmountCell
            value={o.amountForeign}
            kind="fx"
            onSave={(v) => patch({ amountForeign: v, amountSource: v === undefined && o.amountKRW === undefined ? undefined : 'manual' })}
          />
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
                  : { label: '✓ 수동 완료 처리 (출고 없이 끝난 건)', onClick: () => patch({ closed: true }) },
                ...(canInspect ? [{ label: '🔍 ERP 원본 확인 (관리자)', onClick: () => setInspecting(o) }] : []),
                { label: '🗑 삭제', danger: true, onClick: () => confirm(`"${o.name}" 주문을 삭제할까요?`) && remove('orders', o.id) },
              ]}
            />
          </div>
        </td>
      </tr>
    );
  }
}

/** ERP 에서 금액 다시 불러오기 (서버 함수 syncOrderAmountsNow). 평일 업무시간 30분마다 자동으로도 돌아감 */
function SyncButton({ companyId, last }: { companyId: string; last?: ConfigDoc }) {
  const { viewTeam } = useAccess();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg('');
    setResult(null);
    const at = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    try {
      const r = (await httpsCallable(functions, 'syncOrderAmountsNow')({ companyId, team: viewTeam })).data as { checked: number; updated: number; errors: string[]; imported?: number };
      const lines = [
        `${at} 완료 · 주문 ${r.checked}건 확인 · 금액 ${r.updated}건 바뀜`,
        // imported 가 아예 없으면 예전 서버 함수 (새 주문 자동 등록 전 버전)
        r.imported === undefined ? '⚠ 새 주문 자동 등록은 아직 꺼져 있어요 (deploy.bat 으로 서버 함수를 새로 올려 주세요)' : `새 주문 ${r.imported}건 등록${r.imported ? ' — 표 맨 아래 NEW 표시' : ' (최근 3일 새 주문 없음 또는 업체 매장코드 미입력)'}`,
        ...(r.errors?.length ? [`오류 ${r.errors.length}건: ${r.errors[0]}`] : []),
      ];
      setResult({ ok: !r.errors?.length, lines });
      setMsg(`${at} 완료`);
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      const text = code.includes('not-found') || code.includes('internal') ? `금액 불러오기 실패 (${(e as Error).message})` : `금액 불러오기 실패 (${code})`;
      setResult({ ok: false, lines: [`${at} ${text}`] });
      setMsg(text);
    } finally {
      setBusy(false);
    }
  };
  const lastAt = last?.at ? new Date(last.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
  return (
    <span className="sync-box" title={msg || (lastAt ? `마지막 자동 갱신 ${lastAt}` : 'ERP 에서 원화·외화 금액 불러오기')}>
      <button className="sync-btn" onClick={run} disabled={busy}>
        {busy ? '불러오는 중…' : '↻ 금액 새로고침'}
      </button>
      {(msg || lastAt) && <span className="sync-msg">{msg || `자동 ${lastAt}`}</span>}
      {result && (
        <span className={`sync-result ${result.ok ? 'ok' : 'bad'}`} role="status">
          {result.lines.map((l, i) => (
            <span key={i}>{l}</span>
          ))}
          <button className="sync-result-x" onClick={() => setResult(null)} title="닫기">
            ✕
          </button>
        </span>
      )}
    </span>
  );
}

/** 금액 앞 '예정/승인' 표시. 누르면 ERP 에서 받은 내역 (확인용) */
function ApiTag({ o, onInspect }: { o: Order; onInspect?: () => void }) {
  const [open, setOpen] = useState(false);
  const approved = !!o.outStatus && o.outStatus !== 'pending';
  const label = o.outStatus === 'partial' ? '일부' : approved ? '승인' : '예정';
  const rows = o.outRows ?? [];
  const okRows = rows.filter((r) => r.status === '출고승인');
  const sumK = okRows.reduce((a, r) => a + (r.k ?? 0), 0);
  const sumF = okRows.reduce((a, r) => a + (r.f ?? 0), 0);
  return (
    <span className="api-tag-box" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <button className={`api-tag ${o.outStatus === 'partial' ? 'partial' : approved ? 'approved' : 'pending'}`} onClick={() => setOpen((v) => !v)} title="눌러서 ERP 내역 보기">
        {label}
      </button>
      {open && (
        <div className="api-pop" tabIndex={-1}>
          <div className="api-pop-head">
            <b>EXP_NO {o.expNo ?? '-'}</b>
            {o.apiSyncedAt && <span className="muted small"> · {new Date(o.apiSyncedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 확인</span>}
          </div>
          {(o.planKRW !== undefined || o.planForeign !== undefined) && (
            <div className="api-pop-line">
              <span>예정 금액 (API 1)</span>
              <span>{fmtKRW(o.planKRW)}</span>
              <span>{fmtFX(o.planForeign)}</span>
            </div>
          )}
          {rows.length > 0 ? (
            <table className="api-pop-table">
              <thead>
                <tr>
                  <th>출고일</th>
                  <th>상태</th>
                  <th className="r">원화</th>
                  <th className="r">외화</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={r.status === '출고승인' ? '' : 'dim'}>
                    <td>{r.date ?? '-'}</td>
                    <td>{r.status}</td>
                    <td className="r">{r.k === null ? '-' : fmtKRW(r.k)}</td>
                    <td className="r">{r.f === null ? '-' : fmtFX(r.f)}</td>
                  </tr>
                ))}
              </tbody>
              {okRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={2}>승인 합계 (지금 금액)</td>
                    <td className="r">{fmtKRW(sumK)}</td>
                    <td className="r">{fmtFX(sumF)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <p className="muted small" style={{ margin: '6px 0 0' }}>
              {approved ? '줄별 내역은 서버 함수를 새로 올린 뒤 다음 갱신부터 보여요.' : '아직 출고 내역이 없어요.'}
            </p>
          )}
          {onInspect && (
            <button className="link small api-inspect-btn" onClick={onInspect}>
              🔍 ERP 원본 확인 (관리자)
            </button>
          )}
        </div>
      )}
    </span>
  );
}

type RawCall = { query: string; status: number; body: { success?: boolean; Infos?: Record<string, unknown>[] } | null; text?: string; expNo?: string };
type InspectResult = { api1: RawCall | null; api2: RawCall[] };
const numOf = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

/** 관리자 확인용: 이 주문으로 ERP API 를 다시 불러서 받은 그대로 보여줌 (아무것도 저장/수정 안 함) */
function ErpInspector({ o, onClose }: { o: Order; onClose: () => void }) {
  const [orderDate, setOrderDate] = useState(o.orderDate ?? '');
  const [storeCode, setStoreCode] = useState(o.storeCode ?? '');
  const [res, setRes] = useState<InspectResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await httpsCallable(functions, 'inspectOrderApi')({ orderDate, storeCode: storeCode.trim(), expNo: o.expNo });
      setRes(r.data as InspectResult);
    } catch (e) {
      const m = (e as { message?: string }).message ?? String(e);
      setErr(/not.?found|internal/i.test(m) && !/apiKey/.test(m) ? `${m} — 서버 함수를 새로 올렸는지 확인해 주세요.` : m);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const infos1 = res?.api1?.body?.Infos ?? [];
  const plannedK = infos1.reduce((a, r) => a + (numOf(r.TOTAL_OUT_AMT_K) ?? 0), 0);
  const plannedF = infos1.reduce((a, r) => a + (numOf(r.TOTAL_OUT_AMT_F) ?? 0), 0);
  const rows2 = (res?.api2 ?? []).flatMap((c) => c.body?.Infos ?? []);
  const approved = rows2.filter((r) => r.OUT_STATUS === '출고승인');
  const apK = approved.reduce((a, r) => a + (numOf(r.TOTAL_OUTBOUND_AMT_K) ?? 0), 0);
  const apF = approved.reduce((a, r) => a + (numOf(r.TOTAL_OUTBOUND_AMT_F) ?? 0), 0);
  const allK = rows2.reduce((a, r) => a + (numOf(r.TOTAL_OUTBOUND_AMT_K) ?? 0), 0);
  const allF = rows2.reduce((a, r) => a + (numOf(r.TOTAL_OUTBOUND_AMT_F) ?? 0), 0);
  const diffK = (a?: number, b?: number) => (a === undefined || b === undefined ? '' : a - b === 0 ? '같음' : `${a - b > 0 ? '+' : ''}${fmtKRW(a - b)}`);
  const diffF = (a?: number, b?: number) => (a === undefined || b === undefined ? '' : Math.abs(a - b) < 0.005 ? '같음' : `${a - b > 0 ? '+' : ''}${fmtFX(Math.round((a - b) * 100) / 100)}`);

  return (
    <Modal title={`ERP 원본 확인 · ${o.name}`} onClose={onClose} wide>
      <p className="muted small" style={{ marginTop: 0 }}>
        관리자만 보이는 확인 도구예요. ERP API 를 지금 다시 불러서 받은 값을 그대로 보여줘요. 대시보드 금액은 바꾸지 않아요.
      </p>
      <div className="insp-form">
        <label>
          주문일자 <input className="cell-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} placeholder="2026-09-29" />
        </label>
        <label>
          매장코드 <input className="cell-input" value={storeCode} onChange={(e) => setStoreCode(e.target.value)} />
        </label>
        <button className="primary" onClick={run} disabled={busy}>
          {busy ? '불러오는 중…' : '다시 조회'}
        </button>
        <span className="muted small">날짜나 매장코드를 바꿔서 시험해 볼 수 있어요.</span>
      </div>
      {err && <p className="insp-err">{err}</p>}
      {res && (
        <>
          <table className="insp-sum">
            <thead>
              <tr>
                <th />
                <th className="r">원화</th>
                <th className="r">외화</th>
                <th className="r">대시보드와 차이 (원화)</th>
                <th className="r">(외화)</th>
              </tr>
            </thead>
            <tbody>
              <tr className="me">
                <td>지금 대시보드에 저장된 금액</td>
                <td className="r">{fmtKRW(o.amountKRW)}</td>
                <td className="r">{fmtFX(o.amountForeign)}</td>
                <td />
                <td />
              </tr>
              <tr>
                <td>API 1 예정 금액 합계 (TOTAL_OUT_AMT) · {infos1.length}줄</td>
                <td className="r">{fmtKRW(plannedK)}</td>
                <td className="r">{fmtFX(plannedF)}</td>
                <td className="r">{diffK(plannedK, o.amountKRW)}</td>
                <td className="r">{diffF(plannedF, o.amountForeign)}</td>
              </tr>
              <tr>
                <td>API 2 출고승인 줄 합계 · {approved.length}줄</td>
                <td className="r">{fmtKRW(apK)}</td>
                <td className="r">{fmtFX(apF)}</td>
                <td className="r">{diffK(apK, o.amountKRW)}</td>
                <td className="r">{diffF(apF, o.amountForeign)}</td>
              </tr>
              <tr>
                <td>API 2 모든 줄 합계 (승인 여부 상관없이) · {rows2.length}줄</td>
                <td className="r">{fmtKRW(allK)}</td>
                <td className="r">{fmtFX(allF)}</td>
                <td className="r">{diffK(allK, o.amountKRW)}</td>
                <td className="r">{diffF(allF, o.amountForeign)}</td>
              </tr>
            </tbody>
          </table>
          <RawBlock title="API 1 · 주문 조회 (getexorderdata)" call={res.api1} />
          {res.api2.length === 0 && <p className="muted small">API 1 에서 EXP_NO 를 못 받아서 API 2 는 부르지 않았어요.</p>}
          {res.api2.map((c) => (
            <RawBlock key={c.expNo} title={`API 2 · 출고 조회 (getoutbounddata) · EXP_NO ${c.expNo}`} call={c} />
          ))}
        </>
      )}
    </Modal>
  );
}

/** API 응답 하나: Infos 를 모든 칸 그대로 표로 + 원본 JSON */
function RawBlock({ title, call }: { title: string; call: RawCall | null }) {
  if (!call) return null;
  const infos = call.body?.Infos ?? [];
  const keys = [...new Set(infos.flatMap((r) => Object.keys(r)))];
  const isAmt = (k: string) => /AMT|QTY|CNT/i.test(k);
  return (
    <section className="insp-block">
      <h4>{title}</h4>
      <div className="muted small insp-query">
        {call.query} · HTTP {call.status} · success: {String(call.body?.success ?? '-')} · {infos.length}줄
      </div>
      {infos.length > 0 && (
        <div className="insp-scroll">
          <table className="insp-table">
            <thead>
              <tr>
                <th>#</th>
                {keys.map((k) => (
                  <th key={k} className={isAmt(k) ? 'r' : ''}>
                    {k}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {infos.map((r, i) => (
                <tr key={i} className={r.OUT_STATUS && r.OUT_STATUS !== '출고승인' ? 'dim' : ''}>
                  <td>{i + 1}</td>
                  {keys.map((k) => (
                    <td key={k} className={isAmt(k) ? 'r' : ''}>
                      {r[k] === null ? <span className="muted">null</span> : String(r[k] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <details>
        <summary className="muted small">받은 그대로 (JSON)</summary>
        <pre className="insp-json">{call.body ? JSON.stringify(call.body, null, 2) : call.text}</pre>
      </details>
    </section>
  );
}

/** 묶음 색 바꾸기: 동그라미를 누르면 색 고르기 */
function BundleColor({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="bundle-color" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <button className="bundle-color-dot" style={{ background: color }} title="묶음 색 바꾸기" onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="bundle-color-pop" tabIndex={-1}>
          {BUNDLE_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch ${c === color ? 'on' : ''}`}
              style={{ background: c }}
              title={c}
              onClick={() => {
                onPick(c);
                setOpen(false);
              }}
            />
          ))}
          <label className="swatch custom" title="다른 색 직접 고르기">
            +
            <input type="color" value={color} onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>
      )}
    </span>
  );
}
