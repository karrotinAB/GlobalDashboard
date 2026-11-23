// A4 종이(신청서 · 정산서 · 영수증 페이지)를 화면 폭에 맞게 줄여서 한눈에 (휴대폰 등 좁은 화면)
//   종이 넓이 210mm ≈ 794px 보다 칸이 좁으면 그 비율로 zoom · 프린트할 땐 원래 크기 (styles.css #pc-print-root)
import { useEffect } from 'react';

const A4 = 794;
export function useA4Fit() {
  useEffect(() => {
    let raf = 0;
    const apply = () => {
      raf = 0;
      document.querySelectorAll<HTMLElement>('.ps-page').forEach((el) => {
        if (el.closest('#pc-print-root')) return;
        const box = el.parentElement;
        if (!box) return;
        const cs = getComputedStyle(box);
        const w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const fit = w > 0 && w < A4 ? Math.floor((w / A4) * 1000) / 1000 : 1;
        const want = fit < 1 ? String(fit) : '';
        if (el.style.zoom !== want) el.style.zoom = want;
      });
    };
    const later = () => {
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', later);
    later();
    return () => {
      mo.disconnect();
      window.removeEventListener('resize', later);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}
