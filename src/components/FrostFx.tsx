// 헤더 서리: 영하 10도 이하인 날 헤더 유리창에 뿌연 서리가 끼고,
//   마우스(손가락)로 문지르면 그 자리가 투명해짐 (자동차 창문에 그림 그리듯) → 그린 때부터 1분 동안 서서히 다시 서리가 낌
import { useEffect, useRef } from 'react';

type Stroke = { pts: { x: number; y: number }[]; t: number; w: number };
const HOLD = 0; // 그린 바로 뒤부터
const FADE = 60; // 1분 동안 서서히 다시 서리

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** 서리 무늬 한 장 (뿌연 바탕 + 작은 얼음 알갱이 + 가장자리에서 자라는 고사리 모양 결정) */
function makeFrost(W: number, H: number, dpr: number) {
  const c = document.createElement('canvas');
  c.width = Math.round(W * dpr);
  c.height = Math.round(H * dpr);
  const g = c.getContext('2d')!;
  g.scale(dpr, dpr);
  // 뿌연 바탕: 가장자리일수록 진하게
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, 'rgba(250, 252, 255, 0.62)');
  base.addColorStop(0.5, 'rgba(245, 249, 255, 0.48)');
  base.addColorStop(1, 'rgba(250, 252, 255, 0.66)');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  // 얼음 알갱이
  for (let i = 0; i < (W * H) / 90; i++) {
    g.fillStyle = `rgba(255, 255, 255, ${rnd(0.08, 0.35)})`;
    const r = rnd(0.4, 1.6);
    g.beginPath();
    g.arc(rnd(0, W), rnd(0, H), r, 0, Math.PI * 2);
    g.fill();
  }
  // 고사리 모양 결정 (가장자리에서 안쪽으로 가지치기)
  g.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  g.lineCap = 'round';
  const fern = (x: number, y: number, ang: number, len: number, depth: number) => {
    if (depth <= 0 || len < 3) return;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    g.lineWidth = Math.max(0.4, depth * 0.35);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    const n = 3;
    for (let i = 1; i <= n; i++) {
      const px = x + ((x2 - x) * i) / (n + 1);
      const py = y + ((y2 - y) * i) / (n + 1);
      fern(px, py, ang + 0.9 + rnd(-0.2, 0.2), len * 0.38, depth - 1);
      fern(px, py, ang - 0.9 + rnd(-0.2, 0.2), len * 0.38, depth - 1);
    }
    fern(x2, y2, ang + rnd(-0.3, 0.3), len * 0.7, depth - 1);
  };
  const seeds = Math.round(W / 70);
  for (let i = 0; i < seeds; i++) {
    const edge = Math.random();
    if (edge < 0.4) fern(rnd(0, W), H, -Math.PI / 2 + rnd(-0.5, 0.5), rnd(18, 40), 4); // 아래
    else if (edge < 0.7) fern(rnd(0, W), 0, Math.PI / 2 + rnd(-0.5, 0.5), rnd(14, 30), 4); // 위
    else if (edge < 0.85) fern(0, rnd(0, H), rnd(-0.5, 0.5), rnd(18, 36), 4); // 왼쪽
    else fern(W, rnd(0, H), Math.PI + rnd(-0.5, 0.5), rnd(18, 36), 4); // 오른쪽
  }
  return c;
}

export default function FrostFx() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let frost: HTMLCanvasElement | null = null;
    const fit = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      frost = W && H ? makeFrost(W, H, dpr) : null;
      draw(performance.now());
    };
    const strokes: Stroke[] = [];
    let cur: Stroke | null = null;
    let raf = 0;

    const draw = (now: number) => {
      if (!frost) return;
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(frost, 0, 0, W, H);
      // 문지른 자리 지우기 (오래된 건 서서히 다시 서리)
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const sec = now / 1000;
      for (let i = strokes.length - 1; i >= 0; i--) {
        const s = strokes[i];
        const age = sec - s.t;
        if (age > HOLD + FADE) {
          strokes.splice(i, 1);
          continue;
        }
        const a = age < HOLD ? 1 : 1 - (age - HOLD) / FADE;
        ctx.strokeStyle = `rgba(0, 0, 0, ${0.92 * a})`;
        ctx.lineWidth = s.w;
        ctx.shadowColor = `rgba(0, 0, 0, ${0.6 * a})`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        s.pts.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        if (s.pts.length === 1) ctx.lineTo(s.pts[0].x + 0.1, s.pts[0].y);
        ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.globalCompositeOperation = 'source-over';
    };
    const loop = (now: number) => {
      draw(now);
      raf = strokes.length || cur ? requestAnimationFrame(loop) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(loop);
    };

    // 화면 비율(zoom) 이 있어도 맞게: 캔버스 기준 좌표로
    const pos = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
    };
    const down = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      cur = { pts: [pos(e)], t: performance.now() / 1000, w: e.pointerType === 'touch' ? 26 : 20 };
      strokes.push(cur);
      kick();
    };
    const move = (e: PointerEvent) => {
      if (!cur) return;
      cur.pts.push(pos(e));
      // 획마다 그린 때부터 1분 (먼저 그린 부분이 먼저 흐려지게 점마다 시각을 따로 두진 않음)
    };
    const up = () => {
      cur = null;
    };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      cv.removeEventListener('pointercancel', up);
    };
  }, []);
  return <canvas ref={ref} className="frost-fx" title="서리가 꼈어요 — 문질러서 그림을 그려 보세요" />;
}
