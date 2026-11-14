import { useEffect, useState } from 'react';

/** 휴대폰 화면 (폭 600px 이하) 인지 — 화면을 돌리거나 창 크기가 바뀌면 다시 계산 */
export function useIsMobile() {
  const q = '(max-width: 600px)';
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
