// 업체 고르기 칩: 내용(주문/클레임)이 있는 업체만 보이고, 나머지는 '＋ 업체 추가'를 눌러서 고름
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { Company } from '../types';

export default function CompanyPicker({
  companies,
  hasData,
  badge,
  onPick,
  emptyText = '아직 내용이 있는 업체가 없어요. ＋ 업체 추가를 눌러 시작해요.',
}: {
  companies: Company[];
  hasData: (c: Company) => boolean;
  badge?: (c: Company) => ReactNode; // 칩 오른쪽 숫자
  onPick: (id: string) => void;
  emptyText?: string;
}) {
  const [adding, setAdding] = useState(false);
  const used = companies.filter(hasData);
  const rest = companies.filter((c) => !hasData(c));
  const chip = (c: Company, extra?: ReactNode) => (
    <button
      key={c.id}
      className="cchip"
      style={{ '--c': c.color ?? '#999' } as CSSProperties}
      onClick={() => {
        onPick(c.id);
        setAdding(false);
      }}
    >
      <span className="dot" style={{ background: c.color }} />
      {c.name}
      {extra}
    </button>
  );
  return (
    <div className="company-picker">
      <div className="company-chips">
        {used.map((c) => chip(c, badge?.(c)))}
        {used.length === 0 && <span className="muted small">{emptyText}</span>}
        {rest.length > 0 && (
          <button className={`cchip add-co ${adding ? 'on' : ''}`} onClick={() => setAdding((v) => !v)} title="다른 업체를 골라서 시작하기">
            {adding ? '닫기 ▴' : '＋ 업체 추가'}
          </button>
        )}
      </div>
      {adding && (
        <div className="company-chips add-list">
          <span className="muted small">만들어 둔 업체 중에서 골라요 (업체는 주간 할일·설정에서 만들어요)</span>
          {rest.map((c) => chip(c))}
        </div>
      )}
    </div>
  );
}
