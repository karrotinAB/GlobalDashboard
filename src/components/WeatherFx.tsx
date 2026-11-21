// 헤더(커버) 날씨 효과: 눈 · 유리창에 맺혀 또르륵 흘러내리는 빗방울
//   지금은 실험용 (관리자가 설정 > 헤더 날씨 효과에서 켜면 그 브라우저에서만 보임)
import { useEffect, useRef, useState } from 'react';

export type FxMode = 'off' | 'rain' | 'snow' | 'frost';
export type FxLevel = 1 | 2 | 3; // 약 · 보통 · 강

// ---------- 실험 설정 (이 브라우저에만 저장) ----------
const KEY = 'gd:wxFx';
const EVT = 'gd-wxfx';
export function readFx(): { mode: FxMode; level: FxLevel } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { mode?: FxMode; level?: FxLevel };
    return { mode: v.mode === 'rain' || v.mode === 'snow' || v.mode === 'frost' ? v.mode : 'off', level: v.level ?? 2 };
  } catch {
    return { mode: 'off', level: 2 };
  }
}
export function writeFx(v: { mode: FxMode; level: FxLevel }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(EVT));
}
export function useFxSetting() {
  const [v, setV] = useState(readFx);
  useEffect(() => {
    const f = () => setV(readFx());
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, []);
  return v;
}

// ---------- 그리기 ----------
type Drop = { x: number; y: number; r: number; a: number }; // 맺힌 작은 물방울 (a: 나타나는 정도 0~1)
type Big = { x: number; y: number; r: number; seed: number; hold: number; move: number; vy: number; lastTrail: number };
type Flake = { x: number; y: number; r: number; vy: number; ph: number; amp: number; al: number };

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export default function WeatherFx({ mode, level }: { mode: FxMode; level: FxLevel }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || mode === 'off' || mode === 'frost') return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const small = window.innerWidth <= 600;
    let W = 0;
    let H = 0;
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      W = cv.clientWidth;
      H = cv.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);

    const k = level * (small ? 0.5 : 1); // 세기 (휴대폰은 반)
    const rain = mode === 'rain';
    const snow = mode === 'snow';

    // 빗방울
    const drops: Drop[] = [];
    const bigs: Big[] = [];
    // 세기별 차이: 약하게 = 물방울 + 아주 살짝 빗줄기 · 보통 = 물방울 + 뒤로 빗줄기 · 강하게 = 타닥타닥 물방울 + 쏴쏴 빗줄기
    const P = (
      {
        1: { spawn: 14, dens: 3400, big: 0.5, bigMax: 6, splash: 0.35, pop: 3, streak: 1 / 30 },
        2: { spawn: 20, dens: 3000, big: 0.7, bigMax: 7, splash: 0.5, pop: 4, streak: 1 / 9 },
        3: { spawn: 55, dens: 2000, big: 1.3, bigMax: 12, splash: 1, pop: 9, streak: 1 / 2.6 },
      } as const
    )[level];
    const m = small ? 0.5 : 1;
    const maxDrops = () => Math.round(((W * H) / P.dens) * m);
    const splashes: { x: number; y: number; r: number; t: number }[] = [];
    const addDrop = (x = rnd(0, W), y = rnd(0, H), r = rnd(1.2, 3.8), a = 0) => drops.push({ x, y, r, a });
    const addBig = () => bigs.push({ x: rnd(10, W - 10), y: rnd(-10, H * 0.55), r: rnd(5, 8), seed: rnd(0, 1000), hold: rnd(0.3, 1.5), move: 0, vy: 0, lastTrail: 0 });
    if (rain) for (let i = 0; i < maxDrops() * 0.6; i++) addDrop(undefined, undefined, undefined, 1);
    // 뒤로 떨어지는 빗줄기 (보통 · 강하게): 비스듬한 가는 선
    type Streak = { x: number; y: number; len: number; v: number; al: number; w: number };
    const streaks: Streak[] = [];
    const slant = level === 3 ? 0.2 : 0.12; // 옆으로 기울기 (강하면 바람)
    const nStreaks = () => Math.round(W * P.streak * m);
    const addStreak = (y = rnd(-H, H)) => {
      const far = Math.random(); // 0 = 멀리 (가늘고 흐림) · 1 = 가까이
      streaks.push({ x: rnd(-H * slant, W), y, len: (level === 3 ? 18 : 12) + far * (level === 3 ? 26 : 16), v: (level === 3 ? 900 : 650) + far * 500, al: level === 1 ? 0.08 + far * 0.14 : 0.12 + far * (level === 3 ? 0.35 : 0.25), w: 0.6 + far * 0.9 });
    };
    if (rain) for (let i = 0; i < nStreaks(); i++) addStreak();

    // 눈
    const flakes: Flake[] = [];
    const nFlakes = () => Math.round((W / 14) * k);
    const addFlake = (y = rnd(-H, H)) => {
      const r = rnd(0.8, 3.6);
      flakes.push({ x: rnd(0, W), y, r, vy: 8 + r * 6 * rnd(0.8, 1.2), ph: rnd(0, Math.PI * 2), amp: rnd(4, 14), al: rnd(0.5, 0.9) });
    };
    if (snow) for (let i = 0; i < nFlakes(); i++) addFlake();
    // 눈 쌓임 (보통 조금 · 강하게 더): 헤더 아래 끝에 칸마다 높이를 쌓음
    const COL = 4;
    const pileMax = level === 3 ? (small ? 10 : 16) : level === 2 ? (small ? 3 : 5) : 0;
    let pile: number[] = [];
    const pileAt = (x: number) => pile[Math.max(0, Math.min(pile.length - 1, Math.floor(x / COL)))] ?? 0;

    /** 물방울 하나: 그림자 · 볼록한 몸통 (아래가 밝음) · 테두리 · 반짝임 */
    const drawDrop = (x: number, y: number, r: number, a: number, stretch = 1) => {
      const ry = r * stretch;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.ellipse(x, y + r * 0.28, r * 0.95, ry * 0.95, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(70, 35, 25, 0.13)';
      ctx.fill();
      const g = ctx.createRadialGradient(x, y + ry * 0.35, r * 0.1, x, y, r * 1.05);
      g.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
      g.addColorStop(0.65, 'rgba(255, 245, 238, 0.12)');
      g.addColorStop(1, 'rgba(120, 80, 70, 0.22)');
      ctx.beginPath();
      ctx.ellipse(x, y, r, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      if (r > 1.8) {
        ctx.beginPath();
        ctx.arc(x - r * 0.35, y - ry * 0.4, Math.max(0.5, r * 0.22), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    let last = performance.now();
    let spawnAcc = 0;
    let bigAcc = 0;
    let raf = 0;
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, W, H);

      if (rain) {
        // 0) 뒤로 빗줄기 (물방울보다 먼저 그려서 뒤에 있는 것처럼)
        if (streaks.length) {
          ctx.lineCap = 'round';
          for (const st of streaks) {
            st.y += st.v * dt;
            st.x += st.v * slant * dt;
            if (st.y - st.len > H) {
              st.y = rnd(-40, -5);
              st.x = rnd(-H * slant, W);
            }
            ctx.beginPath();
            ctx.moveTo(st.x, st.y);
            ctx.lineTo(st.x - st.len * slant, st.y - st.len);
            ctx.strokeStyle = `rgba(255, 255, 255, ${st.al})`;
            ctx.lineWidth = st.w;
            ctx.stroke();
          }
          // 강하게: 바닥(헤더 아래 끝)에 튀는 작은 물보라
          if (level === 3 && Math.random() < dt * 30 * m) splashes.push({ x: rnd(0, W), y: H - rnd(1, 4), r: rnd(0.8, 1.6), t: 0 });
        }
        // 1) 작은 물방울이 하나씩 맺힘
        spawnAcc += dt * P.spawn * m;
        while (spawnAcc > 1) {
          spawnAcc--;
          // 꽉 찼으면 오래된 물방울 하나를 지우고 새로 (계속 타닥타닥)
          if (drops.length >= maxDrops()) {
            if (level < 3) continue;
            drops.splice(Math.floor(Math.random() * drops.length), 1);
          }
          addDrop();
          const d = drops[drops.length - 1];
          if (Math.random() < P.splash) splashes.push({ x: d.x, y: d.y, r: d.r, t: 0 });
        }
        // 맺힐 때 튀김 링 (0.25초 동안 퍼지며 사라짐)
        for (let i = splashes.length - 1; i >= 0; i--) {
          const sp = splashes[i];
          sp.t += dt;
          const q = sp.t / 0.25;
          if (q >= 1) {
            splashes.splice(i, 1);
            continue;
          }
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, sp.r * (1.2 + q * 2.2), 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255, 255, 255, ${0.45 * (1 - q)})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        // 2) 가끔 큰 물방울 (옆 물방울을 먹으면서 커지는 느낌)
        bigAcc += dt * P.big * m;
        if (bigAcc > 1 && bigs.length < P.bigMax * m) {
          bigAcc = 0;
          addBig();
        }
        for (const d of drops) {
          if (d.a < 1) d.a = Math.min(1, d.a + dt * P.pop);
          drawDrop(d.x, d.y, d.r, d.a);
        }
        // 3) 큰 물방울: 멈췄다 툭 미끄러졌다 (또르륵) · 지나가며 작은 물방울을 먹고 자국을 남김
        for (let i = bigs.length - 1; i >= 0; i--) {
          const b = bigs[i];
          if (b.hold > 0) {
            b.hold -= dt;
            b.vy *= 0.85;
            if (b.hold <= 0) {
              b.move = rnd(0.08, 0.35) * (1 + b.r / 8);
              b.vy = rnd(40, 110) * (0.6 + b.r / 8);
            }
          } else {
            b.move -= dt;
            if (b.move <= 0) b.hold = rnd(0.15, 0.9) / (0.6 + b.r / 10);
          }
          const dy = b.vy * dt;
          b.y += dy;
          b.x += Math.sin(b.y * 0.045 + b.seed) * 0.25 * (dy > 0 ? 1 : 0);
          if (dy > 0.2) {
            // 길에 있던 작은 물방울 흡수
            for (let j = drops.length - 1; j >= 0; j--) {
              const d = drops[j];
              const dx = d.x - b.x;
              const dyy = d.y - b.y;
              if (dx * dx + dyy * dyy < (b.r + d.r) * (b.r + d.r)) {
                b.r = Math.min(11, Math.sqrt(b.r * b.r + d.r * d.r * 0.5));
                drops.splice(j, 1);
              }
            }
            // 지나간 자국
            if (b.y - b.lastTrail > rnd(9, 16)) {
              b.lastTrail = b.y;
              if (Math.random() < 0.55) {
                addDrop(b.x + rnd(-1.5, 1.5), b.y - b.r * 1.6, rnd(0.9, 2), 1);
                b.r = Math.max(4, b.r - 0.05);
              }
            }
          }
          drawDrop(b.x, b.y, b.r, 1, b.hold > 0 ? 1.08 : 1.25);
          if (b.y - b.r > H) bigs.splice(i, 1);
        }
      }

      if (snow) {
        const t = now / 1000;
        for (const f of flakes) {
          f.y += f.vy * dt;
          f.x += Math.cos(t * 0.6 + f.ph) * f.amp * dt;
          if (pileMax && pile.length !== Math.ceil(W / COL) + 1) pile = Array.from({ length: Math.ceil(W / COL) + 1 }, (_, i) => pile[i] ?? 0);
          // 쌓인 눈에 닿으면 거기 쌓이고 (옆 칸으로 조금 퍼짐) 새 눈송이로
          const landed = pileMax > 0 && f.y + f.r >= H - pileAt(f.x);
          if (landed) {
            const c = Math.floor(f.x / COL);
            const add = f.r * 0.9;
            for (let j = -2; j <= 2; j++) {
              const q = c + j;
              if (q < 0 || q >= pile.length) continue;
              pile[q] = Math.min(pileMax * (0.75 + 0.25 * Math.sin(q * 0.37) * Math.sin(q * 0.11)), pile[q] + add * (1 - Math.abs(j) * 0.3));
            }
          }
          if (landed || f.y - f.r > H) {
            f.y = -f.r - rnd(0, 20);
            f.x = rnd(0, W);
          }
          if (f.x < -5) f.x = W + 5;
          if (f.x > W + 5) f.x = -5;
          ctx.beginPath();
          ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${f.al})`;
          ctx.fill();
        }
        while (flakes.length < nFlakes()) addFlake(-5);
        // 쌓인 눈 그리기: 둥글게 이어진 하얀 언덕 + 아래쪽 살짝 그림자
        if (pileMax && pile.some((h) => h > 0.3)) {
          // 이웃 칸과 살짝 평평하게
          for (let i = 1; i < pile.length - 1; i++) pile[i] = pile[i] * 0.96 + (pile[i - 1] + pile[i + 1]) * 0.02;
          ctx.beginPath();
          ctx.moveTo(0, H);
          ctx.lineTo(0, H - pile[0]);
          for (let i = 1; i < pile.length; i++) {
            const x0 = (i - 1) * COL;
            const x1 = i * COL;
            ctx.quadraticCurveTo(x0, H - pile[i - 1], (x0 + x1) / 2, H - (pile[i - 1] + pile[i]) / 2);
          }
          ctx.lineTo(W, H);
          ctx.closePath();
          const g = ctx.createLinearGradient(0, H - pileMax, 0, H);
          g.addColorStop(0, 'rgba(255, 255, 255, 0.97)');
          g.addColorStop(1, 'rgba(235, 238, 248, 0.95)');
          ctx.fillStyle = g;
          ctx.shadowColor = 'rgba(90, 60, 60, 0.18)';
          ctx.shadowBlur = 4;
          ctx.shadowOffsetY = -1;
          ctx.fill();
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetY = 0;
        }
      }

      if (!reduce) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [mode, level]);
  if (mode === 'off' || mode === 'frost') return null;
  return <canvas ref={ref} className="wx-fx" aria-hidden="true" />;
}
