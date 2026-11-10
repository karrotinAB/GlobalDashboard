import { useRef, useState } from 'react';
import type { Company, Order } from '../types';
import { today, uid } from '../lib/date';
import DateInput from './DateInput';

/** 날짜 칸: 누르면 달력 */
export function DateCell({ value, onSave }: { value?: string; onSave: (v?: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <DateInput autoFocus value={value} onChange={onSave} onDone={() => setEditing(false)} />
    );
  }
  return (
    <div className="cell-view editable nowrap" onClick={() => setEditing(true)} title={value}>
      {value ? value.replace(/-/g, '.') : <span className="cell-ph">날짜</span>}
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

type Draft = Pick<Order, 'name' | 'companyId' | 'storeCode' | 'orderDate' | 'packing' | 'shipFrom' | 'note'> & { krw?: string; fx?: string };

/** 표 맨 아래 "+ 주문 추가" 줄: 그 자리에서 쓰고 Enter → 저장, 다음 줄은 빈칸으로 시작 */
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
      amountKRW: parseAmount(d.krw ?? ''),
      amountForeign: parseAmount(d.fx ?? ''),
      realOrder: false,
      erp: false,
      inbound: false,
      shipped: false,
      invoice: false,
      createdAt: today(),
    });
    setD(blank()); // 다음 줄은 빈칸으로
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
        <DateInput value={d.orderDate} onChange={(v) => set('orderDate', v)} />
      </td>
      <td>{text('packing', '패킹')}</td>
      <td>{text('shipFrom', '출고 장소')}</td>
      <td className="c-amt">
        <input className="cell-input amt" placeholder="₩ 원화" value={d.krw ?? ''} onChange={(e) => set('krw', e.target.value)} onKeyDown={keys} />
      </td>
      <td className="c-amt">
        <input className="cell-input amt" placeholder="$ 외화" value={d.fx ?? ''} onChange={(e) => set('fx', e.target.value)} onKeyDown={keys} />
      </td>
      <td>{text('note', '비고')}</td>
      <td className="c-more">
        <button className="icon-btn" title="닫기 (Esc)" onClick={() => setOpen(false)}>
          ✕
        </button>
      </td>
    </tr>
  );
}

/** "1,234,500원" · "$12,345.60" · "12345" → 숫자 (비우면 undefined) */
export function parseAmount(raw: string): number | undefined {
  const clean = raw.replace(/[^\d.\-]/g, '');
  if (!clean) return undefined;
  const n = Number(clean);
  return Number.isFinite(n) ? n : undefined;
}

export const fmtKRW = (n?: number) => (n === undefined ? '' : `₩${Math.round(n).toLocaleString('ko-KR')}`);
export const fmtFX = (n?: number) =>
  n === undefined ? '' : `$${n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;

/** 금액 칸: 평소엔 ₩1,234,500 / $12,345.6 으로 보이고, 누르면 숫자 입력 (붙여넣기 가능) */
export function AmountCell({ value, kind, onSave }: { value?: number; kind: 'krw' | 'fx'; onSave: (v?: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const fmt = kind === 'krw' ? fmtKRW : fmtFX;
  if (!editing) {
    return (
      <div
        className="cell-view editable amt"
        onClick={() => {
          setText(value === undefined ? '' : String(value));
          setEditing(true);
        }}
      >
        {value !== undefined ? fmt(value) : <span className="cell-ph">{kind === 'krw' ? '₩' : '$'}</span>}
      </div>
    );
  }
  const commit = () => {
    setEditing(false);
    const v = parseAmount(text);
    if (v !== value) onSave(v);
  };
  return (
    <input
      className="cell-input amt"
      autoFocus
      inputMode="decimal"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setEditing(false);
      }}
    />
  );
}
