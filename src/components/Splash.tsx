// 로딩 화면: 해파리가 둥실 · 아래 흐르는 줄 · 단계 문구 · 오래 걸리면 안내 + 새로고침
//   0.3초 안에 끝나면 안 보임 (CSS 로 늦게 나타남) · 처음 사이트를 연 때부터 10초가 넘으면 '연결이 늦어요'
import { useEffect, useState } from 'react';

const pageStart = Date.now(); // 사이트를 연 때 (로그인 → 권한 → 데이터 단계를 합쳐서 셈)
const SLOW_MS = 10000;

export default function Splash({ text, fromPageLoad = true }: { text: string; fromPageLoad?: boolean }) {
  const [start] = useState(() => (fromPageLoad ? pageStart : Date.now()));
  const [slow, setSlow] = useState(() => Date.now() - start > SLOW_MS);
  useEffect(() => {
    if (slow) return;
    const t = setTimeout(() => setSlow(true), Math.max(0, SLOW_MS - (Date.now() - start)));
    return () => clearTimeout(t);
  }, [slow, start]);
  return (
    <div className="splash" role="status" aria-live="polite">
      <img className="splash-jelly" src="./jelly.png" alt="" />
      <div className="splash-bar" aria-hidden="true">
        <span />
      </div>
      <p className="splash-text">{text}</p>
      {slow && (
        <div className="splash-slow">
          <p>연결이 늦어요. 인터넷이 느리거나 회사망 문제일 수 있어요.</p>
          <button onClick={() => location.reload()}>새로고침</button>
        </div>
      )}
    </div>
  );
}
