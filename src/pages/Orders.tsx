import { useMemo, useState } from 'react';
import { useLookups, useStore } from '../data/store';
import { today, uid } from '../lib/date';
import { isOrderDone, ORDER_STEPS, type Company, type Order, type OrderStepKey } from '../types';
import { CompanyDot, Empty, Field, Modal } from '../components/ui';

type Tab = 'open' | 'done' | 'all';

export default function Orders() {
  const { data, save, remove } = useStore();
  const { companies, companyById } = useLookups();
  const [tab, setTab] = useState<Tab>('open');
  const [companyFilter, setCompanyFilter] = useState('');
  const [missingStep, setMissingStep] = useState<OrderStepKey | null>(null);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Order | null>(null);

  const base = useMemo(
    () => data.orders.filter((o) => !companyFilter || (o.companyId ?? '') === companyFilter),
    [data.orders, companyFilter],
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

  const newOrder = (): Order => ({
    id: uid(),
    companyId: companyFilter || companies[0]?.id || null,
    name: '',
    realOrder: false,
    erp: false,
    inbound: false,
    shipped: false,
    invoice: false,
    orderDate: today(),
    createdAt: today(),
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>주문 관리</h1>
          <p className="muted">출고 + 인보이스까지 체크되면 자동으로 '완료'로 이동해요. 완료건도 검색하면 다 나와요.</p>
        </div>
        <button className="primary" onClick={() => setEditing(newOrder())}>
          + 주문 추가
        </button>
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
        <select value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)}>
          <option value="">모든 업체</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <input className="search" placeholder="주문명 / 매장코드 / 비고 검색 (완료건 포함)" value={q} onChange={(e) => setQ(e.target.value)} />
        {missingStep && (
          <button className="link" onClick={() => setMissingStep(null)}>
            '{ORDER_STEPS.find((s) => s.key === missingStep)?.label} 안 된 건' 필터 해제 ✕
          </button>
        )}
      </div>

      {query && <div className="banner">검색 중에는 진행중/완료 구분 없이 전체에서 찾아요. ({rows.length}건)</div>}

      {rows.length === 0 ? (
        <Empty>해당하는 주문이 없어요.</Empty>
      ) : (
        <div className="table-scroll">
          <table className="order-table">
            <thead>
              <tr>
                <th className="c-name">주문</th>
                <th>업체</th>
                {ORDER_STEPS.map((s) => (
                  <th key={s.key} className="c-step">
                    {s.label}
                  </th>
                ))}
                <th>매장코드</th>
                <th>주문일자</th>
                <th>패킹 완료일</th>
                <th>출고 장소</th>
                <th>비고</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const done = isOrderDone(o);
                const company = companyById.get(o.companyId ?? '');
                const progress = ORDER_STEPS.filter((s) => o[s.key]).length;
                return (
                  <tr key={o.id} className={`clickable ${done ? 'is-done' : ''}`} onClick={() => setEditing(o)}>
                    <td className="c-name">{o.name || <span className="muted">(이름 없음)</span>}</td>
                    <td className="nowrap">
                      {company && (
                        <>
                          <CompanyDot color={company.color} /> {company.country || company.name}
                        </>
                      )}
                    </td>
                    {ORDER_STEPS.map((s) => (
                      <td key={s.key} className="c-step" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={o[s.key]} onChange={() => toggle(o, s.key)} aria-label={s.label} />
                      </td>
                    ))}
                    <td className="nowrap">{o.storeCode}</td>
                    <td className="nowrap">{o.orderDate}</td>
                    <td className="nowrap">{o.packing}</td>
                    <td className="nowrap">{o.shipFrom}</td>
                    <td className="c-note">{o.note}</td>
                    <td className="nowrap">
                      {done ? (
                        <span className="tag green">완료</span>
                      ) : (
                        <span className="progress" title={`${progress}/5 단계`}>
                          <span style={{ width: `${(progress / 5) * 100}%` }} />
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <OrderEditor
          order={editing}
          isNew={!data.orders.some((o) => o.id === editing.id)}
          companies={companies}
          shipFromOptions={[...new Set(data.orders.map((o) => o.shipFrom).filter(Boolean) as string[])]}
          onClose={() => setEditing(null)}
          onSave={(o) => {
            save('orders', o);
            setEditing(null);
          }}
          onDelete={(o) => {
            if (confirm(`"${o.name}" 주문을 삭제할까요?`)) {
              remove('orders', o.id);
              setEditing(null);
            }
          }}
        />
      )}
    </div>
  );
}

function OrderEditor({
  order,
  isNew,
  companies,
  shipFromOptions,
  onClose,
  onSave,
  onDelete,
}: {
  order: Order;
  isNew: boolean;
  companies: Company[];
  shipFromOptions: string[];
  onClose: () => void;
  onSave: (o: Order) => void;
  onDelete: (o: Order) => void;
}) {
  const [o, setO] = useState<Order>(order);
  const set = <K extends keyof Order>(k: K, v: Order[K]) => setO((p) => ({ ...p, [k]: v }));
  return (
    <Modal title={isNew ? '주문 추가' : '주문 수정'} onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!o.name.trim()) return;
          onSave({ ...o, name: o.name.trim() });
        }}
      >
        <Field label="주문명" full>
          <input autoFocus required value={o.name} onChange={(e) => set('name', e.target.value)} placeholder="예: 10-12주문 4번" />
        </Field>
        <Field label="업체">
          <select value={o.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
            <option value="">(없음)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="매장코드">
          <input value={o.storeCode ?? ''} onChange={(e) => set('storeCode', e.target.value || undefined)} placeholder="826701" />
        </Field>
        <Field label="주문넣은 일자">
          <input type="date" value={o.orderDate ?? ''} onChange={(e) => set('orderDate', e.target.value || undefined)} />
        </Field>
        <Field label="패킹 완료일">
          <input value={o.packing ?? ''} onChange={(e) => set('packing', e.target.value || undefined)} placeholder="2026.11.02 / 완료" />
        </Field>
        <Field label="출고 장소">
          <input list="shipfrom-list" value={o.shipFrom ?? ''} onChange={(e) => set('shipFrom', e.target.value || undefined)} placeholder="관리부 / 삼일출고" />
          <datalist id="shipfrom-list">
            {shipFromOptions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </Field>
        <Field label="진행 단계" full>
          <div className="steps">
            {ORDER_STEPS.map((s) => (
              <label key={s.key} className={`step ${o[s.key] ? 'on' : ''}`}>
                <input type="checkbox" checked={o[s.key]} onChange={(e) => set(s.key, e.target.checked)} />
                {s.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="비고" full>
          <textarea rows={3} value={o.note ?? ''} onChange={(e) => set('note', e.target.value || undefined)} />
        </Field>
        <label className="check-line">
          <input type="checkbox" checked={!!o.closed} onChange={(e) => set('closed', e.target.checked)} /> 수동 완료 처리 (출고/인보이스가 필요 없는 건)
        </label>
        <div className="form-actions">
          {!isNew && (
            <button type="button" className="danger" onClick={() => onDelete(o)}>
              삭제
            </button>
          )}
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit" className="primary">
            저장
          </button>
        </div>
      </form>
    </Modal>
  );
}
