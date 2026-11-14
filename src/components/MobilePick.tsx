/** 휴대폰: 업체를 아래로 쭉 고르는 목록 + 고른 뒤 달 옆에서 바꾸는 선택 상자 */
export type PickItem = { id: string; label: string; color?: string; tag?: string; sub?: string; badge?: string };

export function MobileCoList({ items, onPick, empty }: { items: PickItem[]; onPick: (id: string) => void; empty?: string }) {
  if (!items.length) return <p className="muted small">{empty ?? '업체가 없어요.'}</p>;
  return (
    <div className="m-colist">
      {items.map((x) => (
        <button key={x.id || '_all'} className="m-coitem" onClick={() => onPick(x.id)}>
          {x.color ? <span className="dot" style={{ background: x.color }} /> : <span className="m-all">∑</span>}
          <span className="m-coname">
            {x.tag && <span className="team-tag">{x.tag}</span>}
            {x.label}
            {x.sub && <span className="muted small m-cosub">{x.sub}</span>}
          </span>
          {x.badge && <span className="tag small royalty-tag">{x.badge}</span>}
          <span className="m-chev" aria-hidden="true">›</span>
        </button>
      ))}
    </div>
  );
}

export const LIST = '__list';

export function CoSelect({ value, items, onChange }: { value: string; items: PickItem[]; onChange: (id: string) => void }) {
  return (
    <select className="m-coselect" value={value} onChange={(e) => onChange(e.target.value)} aria-label="업체 바꾸기">
      {items.map((x) => (
        <option key={x.id || '_all'} value={x.id}>
          {x.tag ? `[${x.tag}] ` : ''}
          {x.label}
        </option>
      ))}
      <option value={LIST}>← 업체 목록으로</option>
    </select>
  );
}
