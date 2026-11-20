// 헤더 꼬마전구: 헤더 위쪽에 전선 여러 가닥이 늘어지고, 전구가 깜빡임
//   지금은 관리자 미리보기 (설정 > 관리자 설정 > 헤더 꼬마전구) — 나중에 크리스마스 주간에 자동으로
import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type LightPalette = 'rainbow' | 'warm' | 'xmas' | 'ice';
export type LightBlink = 'soft' | 'twinkle' | 'chase';
export const PALETTES: Record<LightPalette, { label: string; colors: string[] }> = {
  rainbow: { label: '🌈 알록달록', colors: ['#ff5c5c', '#ffd43b', '#51cf66', '#4dabf7', '#f783ac', '#ff922b', '#b197fc'] },
  warm: { label: '✨ 따뜻한 노랑', colors: ['#fff1b8', '#ffe08a', '#ffd166'] },
  xmas: { label: '🎄 빨강 · 초록', colors: ['#ff4d4d', '#40c057', '#ffd43b'] },
  ice: { label: '❄️ 파랑 · 흰색', colors: ['#74c0fc', '#e7f5ff', '#a5d8ff'] },
};
export const BLINKS: Record<LightBlink, string> = { soft: '은은하게', twinkle: '반짝반짝', chase: '번갈아' };

/** 크리스마스 기간 (12/18 ~ 12/26): 모두에게 꼬마전구가 켜지고, 일반 설정에서 각자 고를 수 있어요 */
export const XMAS_FROM = '12-18';
export const XMAS_TO = '12-26';
export const isXmas = (d = new Date()) => {
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return md >= XMAS_FROM && md <= XMAS_TO;
};

// ---------- 설정 (이 브라우저에만 · 크리스마스 기간엔 처음부터 켜짐) ----------
const KEY = 'gd:lightsFx';
const EVT = 'gd-lightsfx';
export type LightsCfg = { on: boolean; palette: LightPalette; blink: LightBlink; strands: 1 | 2 | 3 };
export function readLights(): LightsCfg {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<LightsCfg>;
    return { on: v.on ?? isXmas(), palette: v.palette && PALETTES[v.palette] ? v.palette : 'warm', blink: v.blink && BLINKS[v.blink] ? v.blink : 'twinkle', strands: v.strands ?? 2 };
  } catch {
    return { on: isXmas(), palette: 'warm', blink: 'twinkle', strands: 2 };
  }
}
export function writeLights(v: LightsCfg) {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event(EVT));
}
export function useLightsSetting() {
  const [v, setV] = useState(readLights);
  useEffect(() => {
    const f = () => setV(readLights());
    window.addEventListener(EVT, f);
    return () => window.removeEventListener(EVT, f);
  }, []);
  return v;
}

// 흔들림 없이 늘 같은 배치 (새로고침해도 같은 모양)
const seeded = (n: number) => {
  const x = Math.sin(n * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

/** 전선 한 가닥: (x0,y0) → (x1,y1) 사이가 sag 만큼 늘어진 곡선 위 점 · 기울기 */
function along(x0: number, y0: number, x1: number, y1: number, sag: number, t: number) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2 + sag * 2;
  const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * cx + t * t * x1;
  const y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * cy + t * t * y1;
  const dx = 2 * (1 - t) * (cx - x0) + 2 * t * (x1 - cx);
  const dy = 2 * (1 - t) * (cy - y0) + 2 * t * (y1 - cy);
  return { x, y, ang: (Math.atan2(dy, dx) * 180) / Math.PI };
}

export default function LightsFx({ palette, blink, strands }: { palette: LightPalette; blink: LightBlink; strands: 1 | 2 | 3 }) {
  const ref = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const colors = PALETTES[palette].colors;
  // 가닥마다 높이 · 처짐 · 구간 길이를 조금씩 다르게
  const rows = Array.from({ length: strands }, (_, s) => ({ top: 6 + s * 22, sag: 18 + s * 6, span: 260 + s * 70 }));
  const wires: string[] = [];
  const bulbs: { x: number; y: number; ang: number; c: string; i: number }[] = [];
  let idx = 0;
  rows.forEach((r, s) => {
    const n = Math.max(1, Math.round(W / r.span));
    const seg = W / n;
    const off = s % 2 ? seg / 2 : 0; // 가닥마다 고리 위치를 엇갈리게
    for (let k = -1; k < n + 1; k++) {
      const x0 = k * seg + off;
      const x1 = x0 + seg;
      if (x1 < 0 || x0 > W) continue;
      const y0 = r.top;
      const sag = r.sag * (0.85 + seeded(s * 31 + k) * 0.3);
      wires.push(`M${x0},${y0} Q${(x0 + x1) / 2},${y0 + sag * 2} ${x1},${y0}`);
      const per = Math.max(4, Math.round(seg / 34));
      for (let j = 1; j < per; j++) {
        const p = along(x0, y0, x1, y0, sag, j / per);
        if (p.x < -10 || p.x > W + 10) continue;
        bulbs.push({ x: p.x, y: p.y, ang: p.ang, c: colors[idx % colors.length], i: idx });
        idx++;
      }
    }
  });
  const H = 6 + strands * 22 + 70;
  const dur = blink === 'soft' ? 3.2 : blink === 'twinkle' ? 1.1 : 1.4;
  return (
    <div ref={ref} className={`lights-fx blink-${blink}`} aria-hidden="true">
      {W > 0 && (
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
          <defs>
            <filter id="lf-glow" x="-100%" y="-100%" width="300%" height="300%">
              <feGaussianBlur stdDeviation="4" />
            </filter>
          </defs>
          {wires.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#3b3a2c" strokeOpacity={0.55} strokeWidth={1.4} />
          ))}
          {bulbs.map((b) => {
            const delay = blink === 'chase' ? (b.i % 2) * (dur / 2) : seeded(b.i + 7) * dur * 2;
            const st = { '--d': `${dur * (blink === 'twinkle' ? 0.7 + seeded(b.i) * 0.8 : 1)}s`, '--dl': `-${delay}s` } as CSSProperties;
            // 전구는 전선에 수직으로 아래를 보게
            return (
              <g key={b.i} transform={`translate(${b.x} ${b.y}) rotate(${b.ang})`}>
                <circle className="lf-glow" cx={0} cy={9} r={7} fill={b.c} filter="url(#lf-glow)" style={st} />
                <rect x={-2.2} y={0} width={4.4} height={4} rx={1} fill="#4a4a3a" />
                <ellipse className="lf-bulb" cx={0} cy={9} rx={3.6} ry={5.4} fill={b.c} style={st} />
                <ellipse cx={-1.2} cy={7.4} rx={0.9} ry={1.8} fill="#fff" opacity={0.7} />
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
