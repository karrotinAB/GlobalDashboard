import { useEffect, useMemo, useRef, useState } from 'react';
import { TZ_COORDS, WORLD_LAND } from '../lib/worldMap';

/** 휴대폰 홈 '지금 몇 시?': 세계 지도 위에 고른 시계를 그 도시 자리에 띄움 (밤 지역은 어둡게) */
export type MapClock = { label: string; tz: string; home?: boolean; holiday?: string; info?: string };

const MAP_H = 148; // 지도 데이터 세로 (북위 90 ~ 남위 58)
const BOX_W = 62;
const BOX_H = 32;

function wallParts(now: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const h = Number(g('hour'));
  const mi = Number(g('minute'));
  const wall = Date.UTC(Number(g('year')), Number(g('month')) - 1, Number(g('day')), h, mi) / 60000;
  return { h, mi, weekday: g('weekday'), offsetH: (wall - Math.floor(now.getTime() / 60000)) / 60 };
}

/** 시간대 → 지도 좌표 (x = 경도+180, y = 90-위도). 모르는 시간대는 UTC 차이로 대충 */
function pointOf(tz: string, offsetH: number): [number, number] {
  const c = TZ_COORDS[tz];
  if (c) return [c[1] + 180, 90 - c[0]];
  return [Math.max(5, Math.min(355, offsetH * 15 + 180)), 70];
}

/** 밤인 지역 (해가 진 쪽) 다각형 — 지도 좌표 */
function nightPath(now: Date): string {
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const doy = (now.getTime() - start) / 86400000;
  let dec = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  if (Math.abs(dec) < 0.2) dec = dec < 0 ? -0.2 : 0.2;
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60;
  const sunLon = -(utcH - 12) * 15;
  const r = Math.PI / 180;
  const pts: string[] = [];
  for (let lon = -180; lon <= 180; lon += 3) {
    const lat = Math.atan(-Math.cos((lon - sunLon) * r) / Math.tan(dec * r)) / r;
    pts.push(`${(lon + 180).toFixed(1)},${Math.min(MAP_H, 90 - lat).toFixed(1)}`);
  }
  // 북반구가 여름이면 남극 쪽이 항상 밤 → 아래 가장자리로 닫음 (겨울이면 위로)
  const edge = dec > 0 ? MAP_H : 0;
  return `M0,${edge} L${pts.join(' L')} L360,${edge} Z`;
}

type Placed = { x: number; y: number; bx: number; by: number };

export default function ClockMap({ clocks, now }: { clocks: MapClock[]; now: Date }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 340));
    ro.observe(el);
    setWidth(el.clientWidth || 340);
    return () => ro.disconnect();
  }, []);

  const items = useMemo(
    () =>
      clocks.map((c) => {
        const p = wallParts(now, c.tz);
        return { ...c, ...p, pt: pointOf(c.tz, p.offsetH) };
      }),
    [clocks, now],
  );

  // 보여줄 범위: 시계들이 다 들어가게 + 여백, 가로:세로 1.45 로 맞춤
  const view = useMemo(() => {
    const xs = items.map((i) => i.pt[0]);
    const ys = items.map((i) => i.pt[1]);
    let x0 = Math.min(...xs) - 28;
    let x1 = Math.max(...xs) + 28;
    let y0 = Math.min(...ys) - 22;
    let y1 = Math.max(...ys) + 22;
    const ratio = 1.45;
    if ((x1 - x0) / (y1 - y0) > ratio) {
      const h = (x1 - x0) / ratio;
      const cy = (y0 + y1) / 2;
      y0 = cy - h / 2;
      y1 = cy + h / 2;
    } else {
      const w = (y1 - y0) * ratio;
      const cx = (x0 + x1) / 2;
      x0 = cx - w / 2;
      x1 = cx + w / 2;
    }
    const fit = (a: number, b: number, max: number): [number, number] => {
      const len = Math.min(b - a, max);
      let s = a;
      if (s < 0) s = 0;
      if (s + len > max) s = max - len;
      return [s, s + len];
    };
    [x0, x1] = fit(x0, x1, 360);
    [y0, y1] = fit(y0, y1, MAP_H);
    return { x0, y0, w: x1 - x0, h: y1 - y0 };
  }, [items]);

  const k = width / view.w;
  const height = Math.round(view.h * k);
  const px = (pt: [number, number]) => [(pt[0] - view.x0) * k, (pt[1] - view.y0) * k] as const;

  // 이름표 자리: 점 옆 여러 후보 중 다른 이름표·점과 안 겹치는 첫 자리 (못 찾으면 가장 덜 겹치는 곳)
  const placed = useMemo(() => {
    const out: Placed[] = [];
    const pts = items.map((i) => px(i.pt));
    const overlap = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.max(0, Math.min(a.x + BOX_W, b.x + BOX_W) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + BOX_H, b.y + BOX_H) - Math.max(a.y, b.y));
    const cands: [number, number][] = [];
    for (const d of [1, 2, 3, 4.2]) {
      const g = 7 * d;
      cands.push(
        [g, -BOX_H / 2],
        [-g - BOX_W, -BOX_H / 2],
        [-BOX_W / 2, -g - BOX_H],
        [-BOX_W / 2, g],
        [g, -g - BOX_H * 0.8],
        [g, g - BOX_H * 0.2],
        [-g - BOX_W, -g - BOX_H * 0.8],
        [-g - BOX_W, g - BOX_H * 0.2],
      );
    }
    pts.forEach(([x, y]) => {
      let best: { bx: number; by: number; cost: number } | null = null;
      for (const [dx, dy] of cands) {
        const bx = Math.max(2, Math.min(width - BOX_W - 2, x + dx));
        const by = Math.max(2, Math.min(height - BOX_H - 2, y + dy));
        let cost = 0;
        for (const o of out) cost += overlap({ x: bx, y: by }, { x: o.bx, y: o.by });
        // 다른 점을 가리지 않게
        for (const [ox, oy] of pts) if (ox > bx - 4 && ox < bx + BOX_W + 4 && oy > by - 4 && oy < by + BOX_H + 4 && !(ox === x && oy === y)) cost += 300;
        cost += Math.hypot(bx + BOX_W / 2 - x, by + BOX_H / 2 - y) * 0.5; // 가까울수록 좋음
        if (!best || cost < best.cost) best = { bx, by, cost };
        if (cost < 40) break;
      }
      out.push({ x, y, bx: best!.bx, by: best!.by });
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, width, height, view]);

  const night = useMemo(() => nightPath(now), [now]);

  return (
    <div className="cmap" ref={ref} style={{ height }}>
      <svg className="cmap-svg" width={width} height={height} viewBox={`${view.x0} ${view.y0} ${view.w} ${view.h}`} preserveAspectRatio="none" aria-hidden="true">
        <rect x={0} y={0} width={360} height={MAP_H} className="cmap-sea" />
        <path d={WORLD_LAND} className="cmap-land" />
        <path d={night} className="cmap-night" />
      </svg>
      <svg className="cmap-lines" width={width} height={height} aria-hidden="true">
        {placed.map((p, i) => {
          const cx = Math.max(p.bx, Math.min(p.bx + BOX_W, p.x));
          const cy = Math.max(p.by, Math.min(p.by + BOX_H, p.y));
          return <line key={i} x1={p.x} y1={p.y} x2={cx} y2={cy} />;
        })}
        {placed.map((p, i) => (
          <circle key={`d${i}`} cx={p.x} cy={p.y} r={items[i].home ? 4 : 3.2} className={items[i].home ? 'home' : ''} />
        ))}
      </svg>
      {items.map((c, i) => {
        const p = placed[i];
        const isNight = c.h < 7 || c.h >= 19;
        const h12 = c.h % 12 === 0 ? 12 : c.h % 12;
        return (
          <div
            key={c.tz + c.label}
            className={`cmap-tag ${isNight ? 'night' : 'day'} ${c.home ? 'home' : ''} ${c.holiday ? 'holiday' : ''}`}
            style={{ left: p.bx, top: p.by, width: BOX_W, height: BOX_H }}
            title={[c.holiday ? `공휴일: ${c.holiday}` : '', c.info ?? ''].filter(Boolean).join('\n') || undefined}
          >
            <span className="ct-name">
              {c.label}
              {c.holiday && <i className="ct-hol">휴</i>}
            </span>
            <b className="ct-time">
              {h12}:{String(c.mi).padStart(2, '0')}
              <small>{c.h < 12 ? 'AM' : 'PM'}</small>
            </b>
          </div>
        );
      })}
    </div>
  );
}
