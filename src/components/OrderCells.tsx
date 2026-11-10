import { useRef, useState } from 'react';
import type { Company, Order } from '../types';
import { today, uid } from '../lib/date';

/** 날짜 칸: 누르면 달력 */
export function DateCell({ value, onSave }: { value?: string; onSave: (v?: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <input
        className="cell-input"
        type="date"
        autoFocus
        value={value ?? ''}
        onChange={(e) => onSave(e.target.value || undefined)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === 'Escape') && setEditing(false)}
      />
    );
  }
  return (
    <div className="cell-view editable nowrap" onClick={() => setEditing(true)}>
      {value || <span className="cell-ph">날짜</span>}
    </div>
  );
}

/** 업체 칸: 누르면 고르기 */
export function CompanyCell({ company, companies, onSave }: { company?: Company; companies: Company[]; onSave: (id: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <select
        className="cell-input"
        autoFocus
        value={company?.id ?? ''}
        onChange={(e) => {
          onSave(e.target.value || null);
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="">(없음)</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    );
  }
  return (
    <div className="cell-view editable one-line" onClick={() => setEditing(true)} title={company?.name}>
      {company ? (
        <>
          <span className="dot" style={{ background: company.color }} /> {company.country || company.name}
        </>
      ) : (
        <span className="cell-ph">업체</span>
      )}
    </div>
  );
}

type Draft = Pick<Order, 'name' | 'companyId' | 'storeCode' | 'orderDate' | 'packing' | 'shipFrom' | 'note' | 'currency'>;

/** 표 맨 위 "+ 주문 추가" 줄: 그 자리에서 쓰고 Enter → 저장, 업체·매장코드·출고장소는 다음 줄에 그대로 */
export function AddOrderRow({
  colSpan,
  companies,
  lockCompany,
  defaultCompanyId,
  stepCount,
  onAdd,
}: {
  colSpan: number;
  companies: Company[];
  lockCompany?: boolean; // 업체 시트를 보고 있으면 그 업체로 고정 (업체 칸 없음)
  defaultCompanyId: string | null;
  stepCount: number;
  onAdd: (o: Order) => void;
}) {
  const blank = (): Draft => ({ name: '', companyId: defaultCompanyId, orderDate: today() });
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Draft>(blank);
  const nameRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  if (!open) {
    return (
      <tr className="add-row">
        <td colSpan={colSpan}>
          <button
            className="add-row-btn"
            onClick={() => {
              setD(blank());
              setOpen(true);
            }}
          >
            + 주문 추가
          </button>
        </td>
      </tr>
    );
  }

  const submit = () => {
    if (!d.name.trim()) return;
    const clean = (v?: string) => v?.trim() || undefined;
    onAdd({
      id: uid(),
      name: d.name.trim(),
      companyId: d.companyId,
      storeCode: clean(d.storeCode),
      orderDate: d.orderDate,
      packing: clean(d.packing),
      shipFrom: clean(d.shipFrom),
      note: clean(d.note),
      currency: d.currency,
      realOrder: false,
      erp: false,
      inbound: false,
      shipped: false,
      invoice: false,
      createdAt: today(),
    });
    setD({ ...blank(), companyId: d.companyId, storeCode: d.storeCode, shipFrom: d.shipFrom, orderDate: d.orderDate, currency: d.currency });
    nameRef.current?.focus();
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') setOpen(false);
  };
  const text = (k: 'storeCode' | 'packing' | 'shipFrom' | 'note', ph: string) => (
    <input className="cell-input" placeholder={ph} value={d[k] ?? ''} onChange={(e) => set(k, e.target.value)} onKeyDown={keys} />
  );

  return (
    <tr className="add-row editing">
      <td className="c-gutter" />
      <td className="c-name">
        <input ref={nameRef} className="cell-input" autoFocus placeholder="주문명 입력 후 Enter" value={d.name} onChange={(e) => set('name', e.target.value)} onKeyDown={keys} />
      </td>
      {!lockCompany && (
        <td>
          <select className="cell-input" value={d.companyId ?? ''} onChange={(e) => set('companyId', e.target.value || null)}>
            <option value="">(없음)</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </td>
      )}
      <td colSpan={stepCount} className="muted small add-hint">
        단계 체크는 추가한 뒤에
      </td>
      <td>{text('storeCode', '매장코드')}</td>
      <td>
        <input className="cell-input" type="date" value={d.orderDate ?? ''} onChange={(e) => set('orderDate', e.target.value || undefined)} />
      </td>
      <td>{text('packing', '패킹')}</td>
      <td>{text('shipFrom', '출고 장소')}</td>
      <td className="c-step" />
      <td>{text('note', '비고')}</td>
      <td className="c-more">
        <div className="status-cell">
          <CurrencyToggle value={d.currency} onChange={(v) => set('currency', v)} />
          <button className="icon-btn" title="닫기 (Esc)" onClick={() => setOpen(false)}>
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

/** 원화 / 외화: 누를 때마다 원화 → 외화 → 비움 */
export function CurrencyToggle({ value, onChange }: { value?: 'KRW' | 'FOREIGN'; onChange: (v?: 'KRW' | 'FOREIGN') => void }) {
  const next = value === 'KRW' ? 'FOREIGN' : value === 'FOREIGN' ? undefined : 'KRW';
  return (
    <button
      type="button"
      className={`currency ${value ? value.toLowerCase() : 'none'}`}
      title="누르면 원화 → 외화 → 비움"
      onClick={() => onChange(next)}
    >
      {value === 'KRW' ? '₩ 원화' : value === 'FOREIGN' ? '$ 외화' : '₩/$'}
    </button>
  );
}
