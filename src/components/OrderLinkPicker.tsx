// 주문 연결하기 창 (주간 할일 · 무역사무 요청): 개별 주문 또는 묶음
import { useState, type CSSProperties } from 'react';
import { Modal } from './ui';
import { isOrderDone, type Order } from '../types';

/** 할일에 주문 연결: 같은 업체 주문 먼저 (진행중 → 최근 순), 검색, 다른 업체 주문도 */
export default function OrderLinkPicker({
  title,
  hint,
  companyId,
  currentOrderId,
  currentBundleId,
  orders,
  companyName,
  onPick,
  onClose,
}: {
  title: string;
  hint?: React.ReactNode;
  companyId?: string | null;
  currentOrderId?: string;
  currentBundleId?: string;
  orders: Order[];
  companyName: (id?: string | null) => string | undefined;
  onPick: (p: { orderId?: string; bundleId?: string }) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(!companyId);
  const [byBundle, setByBundle] = useState(!!currentBundleId); // 묶음으로 보기
  const [coPick, setCoPick] = useState(''); // 업체 하나만 (업체 버튼)
  const query = q.trim().toLowerCase();
  const pool = orders.filter((o) => (coPick ? o.companyId === coPick : all || o.companyId === companyId));
  // 주문이 있는 업체들 (주문 많은 순)
  const coIds = [...new Set(orders.map((o) => o.companyId).filter((x): x is string => !!x))].sort(
    (a, b) => orders.filter((o) => o.companyId === b).length - orders.filter((o) => o.companyId === a).length,
  );
  const list = pool
    .filter((o) => !query || `${o.name} ${o.storeCode ?? ''} ${o.bundle?.name ?? ''} ${companyName(o.companyId) ?? ''}`.toLowerCase().includes(query))
    .sort((a, b) => Number(isOrderDone(a)) - Number(isOrderDone(b)) || (b.orderDate ?? b.createdAt).localeCompare(a.orderDate ?? a.createdAt))
    .slice(0, 100);
  // 묶음: 묶음 이름 또는 그 안 주문 중 하나라도 검색에 맞으면
  const bundles = [...new Map(pool.filter((o) => o.bundle).map((o) => [o.bundle!.id, o.bundle!])).values()]
    .map((b) => {
      const items = pool.filter((o) => o.bundle?.id === b.id);
      const dates = items.map((o) => o.orderDate).filter(Boolean).sort() as string[];
      return { b, items, done: items.every(isOrderDone), from: dates[0], to: dates[dates.length - 1], companyId: items[0]?.companyId };
    })
    .filter((x) => !query || `${x.b.name ?? ''} ${companyName(x.companyId) ?? ''} ${x.items.map((o) => `${o.name} ${o.storeCode ?? ''}`).join(' ')}`.toLowerCase().includes(query))
    .sort((a, b) => Number(a.done) - Number(b.done) || (b.to ?? '').localeCompare(a.to ?? ''));
  const d = (x?: string) => x?.slice(5).replace('-', '.');
  return (
    <Modal title="주문 연결하기" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {hint ?? <>「{title}」에 연결할 주문을 골라 주세요. 연결하면 비고 끝 ↗ 를 눌러 그 주문으로 바로 갈 수 있어요.</>}
      </p>
      <div className="link-tools">
        <input className="search" autoFocus placeholder="🔍 주문 이름 · 매장코드 · 묶음" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check-line small">
          <input type="checkbox" checked={byBundle} onChange={(e) => setByBundle(e.target.checked)} /> 묶음
        </label>
        {companyId && !coPick && (
          <label className="check-line small">
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> 다른 업체 주문도
          </label>
        )}
      </div>
      {coIds.length > 1 && (
        <div className="company-chips link-cos">
          <button className={`cchip ${!coPick ? 'on' : ''}`} onClick={() => setCoPick('')}>
            전체 업체
          </button>
          {coIds.map((id) => (
            <button key={id} className={`cchip ${coPick === id ? 'on' : ''}`} onClick={() => setCoPick(coPick === id ? '' : id)}>
              {companyName(id) ?? '업체'} <span className="muted small">{orders.filter((o) => o.companyId === id && !isOrderDone(o)).length}</span>
            </button>
          ))}
        </div>
      )}
      {byBundle ? (
        <ul className="link-list">
          {bundles.length === 0 && <li className="muted small">맞는 묶음이 없어요. (주문 관리에서 주문을 체크해서 묶을 수 있어요)</li>}
          {bundles.map((x) => (
            <li key={x.b.id}>
              <button className={x.b.id === currentBundleId ? 'on' : ''} onClick={() => onPick({ bundleId: x.b.id })}>
                <span className="link-bundle" style={{ '--c': x.b.color } as CSSProperties}>
                  {x.b.name || '묶음'}
                </span>
                <span className="small">주문 {x.items.length}개</span>
                <span className="muted small">
                  {[all ? companyName(x.companyId) : '', x.from ? (x.from === x.to ? d(x.from) : `${d(x.from)}~${d(x.to)}`) : '', x.items.slice(0, 3).map((o) => o.name).join(', ') + (x.items.length > 3 ? ' …' : '')]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className={`tag small ${x.done ? 'green' : 'gray'}`}>{x.done ? '완료' : '진행중'}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
      <ul className="link-list">
        {list.length === 0 && <li className="muted small">맞는 주문이 없어요.</li>}
        {list.map((o) => (
          <li key={o.id}>
            <button className={o.id === currentOrderId && !currentBundleId ? 'on' : ''} onClick={() => onPick({ orderId: o.id })}>
              <b>{o.name}</b>
              {o.bundle && (
                <span className="link-bundle" style={{ '--c': o.bundle.color } as CSSProperties}>
                  {o.bundle.name || '묶음'}
                </span>
              )}
              <span className="muted small">
                {[all ? companyName(o.companyId) : '', o.orderDate?.replace(/-/g, '.'), o.storeCode].filter(Boolean).join(' · ')}
              </span>
              <span className={`tag small ${isOrderDone(o) ? 'green' : 'gray'}`}>{isOrderDone(o) ? '완료' : '진행중'}</span>
            </button>
          </li>
        ))}
      </ul>
      )}
    </Modal>
  );
}

