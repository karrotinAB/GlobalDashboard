// 메모 서식 (굵게·밑줄·취소선·글자색 …): HTML 로 저장하되, 허용한 태그·스타일만 남김
// 옛 메모(그냥 글자)는 그대로 읽힘

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SPAN', 'FONT', 'MARK', 'BR', 'DIV', 'P', 'UL', 'OL', 'LI']);
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i;

/** 서식이 들어간 메모인지 (아니면 옛날 그냥 글자) */
export const isRich = (s?: string) => !!s && /<\/?(b|strong|i|em|u|s|strike|del|span|font|mark|br|div|p|ul|ol|li)\b/i.test(s);

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 옛 메모(그냥 글자) → HTML */
export const plainToHtml = (s: string) => escapeHtml(s).replace(/\n/g, '<br>');

/** 허용한 태그·스타일만 남긴 HTML */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement | null;
  if (!root) return '';
  const clean = (el: Element): string =>
    [...el.childNodes]
      .map((n) => {
        if (n.nodeType === Node.TEXT_NODE) return escapeHtml(n.textContent ?? '');
        if (n.nodeType !== Node.ELEMENT_NODE) return '';
        const e = n as HTMLElement;
        const inner = clean(e);
        if (!ALLOWED.has(e.tagName)) return inner; // 모르는 태그는 벗기고 글자만
        const tag = e.tagName === 'FONT' ? 'span' : e.tagName.toLowerCase();
        if (tag === 'br') return '<br>';
        // 스타일은 글자색·배경색·굵기·밑줄/취소선만
        const st: string[] = [];
        const color = e.style.color || (e.tagName === 'FONT' ? e.getAttribute('color') ?? '' : '');
        if (color && COLOR.test(color.replace(/\s/g, ''))) st.push(`color:${color}`);
        const bg = e.style.backgroundColor;
        if (bg && COLOR.test(bg.replace(/\s/g, ''))) st.push(`background-color:${bg}`);
        if (/bold|[6-9]00/.test(e.style.fontWeight)) st.push('font-weight:700');
        const deco = e.style.textDecorationLine || e.style.textDecoration;
        if (/underline/.test(deco)) st.push('text-decoration:underline');
        if (/line-through/.test(deco)) st.push('text-decoration:line-through');
        if (/italic/.test(e.style.fontStyle)) st.push('font-style:italic');
        const style = st.length ? ` style="${st.join(';')}"` : '';
        if (tag === 'span' && !style) return inner;
        return `<${tag}${style}>${inner}</${tag}>`;
      })
      .join('');
  return clean(root).replace(/(<br>\s*)+$/, '');
}

/** 메모 → 화면에 넣을 HTML (옛 메모도) */
export const memoHtml = (memo?: string) => (memo ? (isRich(memo) ? sanitize(memo) : plainToHtml(memo)) : '');

/** 메모 → 글자 줄들 (업체 이름 옆 첫 줄 미리보기용) */
export function memoLines(memo?: string): string[] {
  if (!memo) return [];
  if (!isRich(memo)) return memo.split('\n').filter((l) => l.trim());
  // 줄바꿈·문단(div/p/li) 앞뒤를 줄로 나눔
  const text = memo.replace(/<br\s*\/?>/gi, '\n').replace(/<\/?(div|p|li|ul|ol)\b[^>]*>/gi, '\n');
  const doc = new DOMParser().parseFromString(`<div>${text}</div>`, 'text/html');
  return (doc.body.textContent ?? '').split('\n').filter((l) => l.trim());
}
