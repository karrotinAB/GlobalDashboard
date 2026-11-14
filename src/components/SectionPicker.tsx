import { useEffect, useState, type RefObject } from 'react';
import { useIsMobile } from '../lib/useMobile';

/** 카드 제목: h2 의 글자만 (안에 붙은 '관리자만' 같은 꼬리표는 빼고) */
const titleOf = (s: HTMLElement) => {
  const h = s.querySelector('h2');
  if (!h) return '';
  const own = [...h.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join('').trim();
  return own || (h.textContent ?? '').trim();
};

/** 휴대폰: 페이지 안 카드(section.card)를 위 선택 상자로 하나씩만 보여줌. 고른 건 기억함 */
export default function SectionPicker({ root, storeKey }: { root: RefObject<HTMLElement | null>; storeKey: string }) {
  const mobile = useIsMobile();
  const [titles, setTitles] = useState<string[]>([]);
  const [pick, setPick] = useState(() => {
    try {
      return localStorage.getItem(storeKey) ?? '';
    } catch {
      return '';
    }
  });
  // 카드 목록 (권한·데이터에 따라 생기고 없어지니 계속 지켜봄)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const read = () => {
      const t = [...el.querySelectorAll<HTMLElement>(':scope > section.card')].map(titleOf).filter(Boolean);
      setTitles((prev) => (prev.join('|') === t.join('|') ? prev : t));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  }, [root]);
  const cur = titles.includes(pick) ? pick : titles[0] ?? '';
  // 고른 카드만 보이게 (React 가 안 건드리는 data 속성으로)
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    for (const s of el.querySelectorAll<HTMLElement>(':scope > section.card')) {
      const t = titleOf(s);
      if (mobile && t && t !== cur) s.setAttribute('data-mhide', '');
      else s.removeAttribute('data-mhide');
    }
  });
  if (!mobile || titles.length < 2) return null;
  return (
    <select
      className="m-coselect section-pick"
      value={cur}
      onChange={(e) => {
        setPick(e.target.value);
        try {
          localStorage.setItem(storeKey, e.target.value);
        } catch {
          /* 무시 */
        }
        window.scrollTo({ top: 0 });
      }}
      aria-label="설정 항목 고르기"
    >
      {titles.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
