import { useMemo, useState, type CSSProperties } from 'react';
import { useLookups, useStore } from '../data/store';
import { isOrderDone, ORDER_STEPS, type Order, type OrderStepKey } from '../types';
import { EditableText, MoreMenu } from '../components/SheetCells';
import { AddOrderRow, CompanyCell, DateCell } from '../components/OrderCells';

type Tab = 'open' | 'done' | 'all';

export default function Orders() {
  const { data, save, remove } = useStore();
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

  const base = useMemo(
    () => data.orders.filter((o) => !companyFilter || !companyById.has(companyFilter) || (o.companyId ?? '') === companyFilter),
    [data.orders, companyFilter, companyById],
  );
  const openOrders = base.filter((o) => !isOrderDone(o));
  const doneCount = base.length - openOrders.length;

  const stepMissingCounts = useMemo(
    () => Object.fromEntries(ORDER_STEPS.map((s) => [s.key, openOrders.filter((o) => !o[s.key]).length])) as Record<OrderStepKey, number>,
    [openOrders],
  );

  const query = q.trim().toLowerCase();
  const rows = useMemo(() => {
    return base
      .filter((o) => {
        // 검색어가 있으면 완료건까지 전부 검색
        if (!query) {
          if (tab === 'open' && isOrderDone(o)) return false;
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
      .sort((a, b) => (b.orderDate ?? b.createdAt).localeCompare(a.orderDate ?? a.createdAt));
  }, [base, tab, query, missingStep, companyById]);

  const toggle = (o: Order, key: OrderStepKey) => save('orders', { ...o, [key]: !o[key] });

  const sheet = companyById.get(companyFilter); // 지금 보고 있는 업체 시트 (없으면 전체)
  const colSpan = ORDER_STEPS.length + (sheet ? 7 : 8);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주문 관리</h1>
          <p className="muted">출고 + 인보이스까지 체크되면 자동으로 '완료'로 이동해요. 칸을 누르면 바로 고칠 수 있어요 · 완료건도 검색하면 다 나와요.</p>
        </div>
      </div>

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

      <div className="table-scroll">
        <table className="order-table">
          <thead>
            <tr>
              <th className="c-name">주문</th>
              {!sheet && <th className="c-co">업체</th>}
              {ORDER_STEPS.map((s) => (
                <th key={s.key} className="c-step">
                  {s.label}
                </th>
              ))}
              <th className="c-code">매장코드</th>
              <th className="c-date">주문일자</th>
              <th className="c-pack">패킹 완료일</th>
              <th className="c-from">출고 장소</th>
              <th className="c-onote">비고</th>
              <th className="c-more">상태</th>
            </tr>
          </thead>
          <tbody>
            {tab !== 'done' && !query && (
              <AddOrderRow
                key={companyFilter}
                colSpan={colSpan}
                companies={companies}
                lockCompany={!!sheet}
                defaultCompanyId={sheet?.id ?? companies[0]?.id ?? null}
                stepCount={ORDER_STEPS.length}
                onAdd={(o) => save('orders', o)}
              />
            )}
            {rows.map((o) => {
              const done = isOrderDone(o);
              const progress = ORDER_STEPS.filter((s) => o[s.key]).length;
              const patch = (p: Partial<Order>) => save('orders', { ...o, ...p });
              const txt = (k: 'storeCode' | 'packing' | 'shipFrom' | 'note', ph: string) => (
                <EditableText value={o[k] ?? ''} oneLine placeholder={ph} onSave={(v) => patch({ [k]: v || undefined })} />
              );
              return (
                <tr key={o.id} className={done ? 'is-done' : ''}>
                  <td className="c-name">
                    <EditableText value={o.name} oneLine onSave={(v) => v && patch({ name: v })} />
                  </td>
                  {!sheet && (
                    <td className="c-co">
                      <CompanyCell company={companyById.get(o.companyId ?? '')} companies={companies} onSave={(id) => patch({ companyId: id })} />
                    </td>
                  )}
                  {ORDER_STEPS.map((s) => (
                    <td key={s.key} className="c-step">
                      <input type="checkbox" checked={o[s.key]} onChange={() => toggle(o, s.key)} aria-label={s.label} />
                    </td>
                  ))}
                  <td className="c-code">{txt('storeCode', '매장코드')}</td>
                  <td className="c-date">
                    <DateCell value={o.orderDate} onSave={(v) => patch({ orderDate: v })} />
                  </td>
                  <td className="c-pack">{txt('packing', '패킹')}</td>
                  <td className="c-from">{txt('shipFrom', '출고 장소')}</td>
                  <td className="c-onote">{txt('note', '비고')}</td>
                  <td className="c-more">
                    <div className="status-cell">
                      {done ? (
                        <span className="tag green">완료</span>
                      ) : (
                        <span className="progress" title={`${progress}/5 단계`}>
                          <span style={{ width: `${(progress / 5) * 100}%` }} />
                        </span>
                      )}
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
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="muted small pad">
                  해당하는 주문이 없어요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
