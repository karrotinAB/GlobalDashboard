// 홈 맨 아래: 업체별 판매 데이터
//  업체 고르기 → 지점 × 월 합계 표 → 월(또는 지점의 그 월)을 누르면
//  왼쪽: 주차별 금액 꺾은선 (아래 작게 회색으로 평당 금액) · 오른쪽: 주차 × 요일 금액 (토·일 붉게)
import { useMemo, useState, type CSSProperties } from 'react';
import { fullAmt, shortAmt, useSales, useStoreBranches, weeksOf, type SalesBranch } from '../lib/sales';
import type { Company } from '../types';

const DOW = ['월', '화', '수', '목', '금', '토', '일'];
const pad = (n: number) => String(n).padStart(2, '0');
const monthLabel = (m: string) => `${m.slice(2, 4)}.${m.slice(5)}`;
const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k) ?? '';
    } catch {
      return '';
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 무시 */
    }
  },
};

export default function SalesPanel({ companies }: { companies: Company[] }) {
  const withCodes = companies.filter((c) => c.storeCodes?.length && c.salesOn);
  const [coId, setCoId] = useState(() => store.get('gd:salesCo'));
  const co = withCodes.find((c) => c.id === coId);
  const pickCo = (id: string) => {
    const next = id === coId ? '' : id;
    setCoId(next);
    setSel(null);
    store.set('gd:salesCo', next);
  };
  const { months, ready } = useSales(co?.storeCodes ?? []);
  const branchNames = useStoreBranches(co?.storeCodes ?? []); // ERP 거래처 정보의 지점 이름
  // 검색: 매장코드 4자리 / 업체·매장 이름 → 맞는 업체 추천 (코드가 딱 맞으면 바로 선택)
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, '');
  const nq = norm(q);
  const hits = nq
    ? withCodes.filter((c) => norm(`${c.name} ${c.country ?? ''}`).includes(nq) || (c.storeCodes ?? []).some((code) => code.startsWith(nq) || nq.startsWith(code)) || Object.keys(c.storeAreas ?? {}).some((sid) => sid.startsWith(nq)))
    : [];
  const choose = (id: string) => {
    setCoId(id);
    setSel(null);
    store.set('gd:salesCo', id);
    setQ('');
    setOpen(false);
  };
  const onType = (v: string) => {
    setQ(v);
    setOpen(true);
    const t = v.trim();
    if (/^\d{4}$/.test(t)) {
      const exact = withCodes.filter((c) => c.storeCodes?.includes(t));
      if (exact.length === 1) choose(exact[0].id);
    }
  };
  const [sel, setSel] = useState<{ month: string; branch: string | null } | null>(null);

  // 월 → 지점 → 데이터 (매장코드가 여러 개여도 한데 모음)
  const byMonth = useMemo(() => {
    const m = new Map<string, Record<string, SalesBranch>>();
    for (const doc of months) m.set(doc.month, { ...(m.get(doc.month) ?? {}), ...doc.branches });
    return m;
  }, [months]);
  const monthList = [...byMonth.keys()].sort().slice(-12);
  const branchIds = [...new Set(monthList.flatMap((m) => Object.keys(byMonth.get(m) ?? {})))].sort();
  const nameOf = (sid: string) => {
    if (branchNames[sid]) return branchNames[sid];
    for (const m of [...monthList].reverse()) {
      const n = byMonth.get(m)?.[sid]?.name;
      if (n) return n;
    }
    return '';
  };
  const total = (m: string, sid?: string) => {
    const b = byMonth.get(m) ?? {};
    return (sid ? [sid] : Object.keys(b)).reduce((a, id) => a + Object.values(b[id]?.days ?? {}).reduce((x, n) => x + n, 0), 0);
  };
  const areaOf = (sid: string) => co?.storeAreas?.[sid];
  const cur = sel ?? (monthList.length ? { month: monthList[monthList.length - 1], branch: null } : null);

  return (
    <section className="card sales">
      <div className="section-head">
        <h2>📈 업체별 판매 데이터</h2>
        <span className="muted small">매일 아침 전날까지 판매가 들어와요 · 평수는 설정에서</span>
      </div>
      {withCodes.length === 0 ? (
        <p className="muted small">판매 데이터를 수집 중인 업체가 없어요. 설정 &gt; 매장 평수에서 업체 옆 <b>판매데이터 수집 중</b>을 켜 주세요.</p>
      ) : (
        <>
        <div className="sales-search">
          <input
            value={q}
            onChange={(e) => onType(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && hits[0]) choose(hits[0].id);
              if (e.key === 'Escape') setQ('');
            }}
            placeholder="🔍 매장코드 4자리 또는 매장 이름"
          />
          {open && nq && (
            <div className="sales-suggest">
              {hits.length === 0 ? (
                <div className="muted small pad">맞는 매장이 없어요</div>
              ) : (
                hits.map((c) => (
                  <button key={c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(c.id)}>
                    <span className="dot" style={{ background: c.color }} />
                    <b>{c.name}</b>
                    <span className="muted small">{c.storeCodes!.join(', ')}</span>
                    {c.team && <span className="tag gray small">{c.team}조</span>}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
        <div className="company-chips">
          {withCodes.map((c) => (
            <button key={c.id} className={`cchip ${coId === c.id ? 'on' : ''}`} onClick={() => pickCo(c.id)}>
              <span className="dot" style={{ background: c.color }} />
              {c.name}
              {c.team && <span className="tag gray small">{c.team}조</span>}
            </button>
          ))}
        </div>
        </>
      )}

      {co && !ready && <p className="muted small">불러오는 중…</p>}
      {co && ready && monthList.length === 0 && <p className="muted small">아직 들어온 판매 데이터가 없어요 (매장코드 {co.storeCodes!.join(', ')}).</p>}

      {co && ready && monthList.length > 0 && (
        <>
          <div className="sales-table-wrap">
            <table className="sales-table">
              <thead>
                <tr>
                  <th className="l">지점</th>
                  {monthList.map((m) => (
                    <th key={m}>
                      <button className={`sales-mbtn ${cur?.month === m && !cur.branch ? 'on' : ''}`} onClick={() => setSel({ month: m, branch: null })} title="이 달 전체 지점 자세히">
                        {monthLabel(m)}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {branchIds.map((sid) => (
                  <tr key={sid}>
                    <th className="l">
                      <b>{nameOf(sid) || sid}</b>
                      <span className="muted small"> {sid}{areaOf(sid) ? ` · ${areaOf(sid)}평` : ''}</span>
                    </th>
                    {monthList.map((m) => {
                      const v = total(m, sid);
                      const on = cur?.month === m && cur.branch === sid;
                      return (
                        <td key={m} className={`r ${on ? 'on' : ''} ${cur?.month === m && !cur.branch ? 'col-on' : ''}`}>
                          {v ? (
                            <button className="sales-cell" onClick={() => setSel({ month: m, branch: sid })} title={`${fullAmt(v)} — 누르면 이 지점 이 달 자세히`}>
                              {shortAmt(v)}
                            </button>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {branchIds.length > 1 && (
                <tfoot>
                  <tr>
                    <th className="l">합계</th>
                    {monthList.map((m) => (
                      <td key={m} className={`r ${cur?.month === m && !cur.branch ? 'col-on' : ''}`} title={fullAmt(total(m))}>
                        <button className="sales-cell" onClick={() => setSel({ month: m, branch: null })}>
                          {shortAmt(total(m))}
                        </button>
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {cur && (
            <MonthDetail
              key={`${cur.month}|${cur.branch}`}
              month={cur.month}
              title={cur.branch ? nameOf(cur.branch) || cur.branch : branchIds.length > 1 ? '전체 지점' : nameOf(branchIds[0]) || branchIds[0]}
              color={co.color ?? '#8c2f3c'}
              branches={(cur.branch ? [cur.branch] : branchIds).map((sid) => byMonth.get(cur.month)?.[sid]).filter((b): b is SalesBranch => !!b)}
              area={(() => {
                const ids = cur.branch ? [cur.branch] : branchIds.filter((sid) => byMonth.get(cur.month)?.[sid]);
                const areas = ids.map(areaOf);
                return areas.every((a) => a && a > 0) ? areas.reduce((a, b) => a! + b!, 0)! : undefined;
              })()}
            />
          )}
        </>
      )}
    </section>
  );
}

function MonthDetail({ month, title, color, branches, area }: { month: string; title: string; color: string; branches: SalesBranch[]; area?: number }) {
  const day = (d: number) => branches.reduce((a, b) => a + (b.days[pad(d)] ?? 0), 0);
  const has = (d: number) => branches.some((b) => b.days[pad(d)] !== undefined);
  const cnt = (d: number) => branches.reduce((a, b) => a + (b.cnt?.[pad(d)] ?? 0), 0);
  const weeks = weeksOf(month);
  const rows = weeks.map((w, i) => {
    const days = w.filter((d): d is number => d !== null);
    const wk = w.slice(0, 5).filter((d): d is number => d !== null);
    const we = w.slice(5).filter((d): d is number => d !== null);
    return {
      i,
      w,
      from: days[0],
      to: days[days.length - 1],
      total: days.reduce((a, d) => a + day(d), 0),
      weekday: wk.reduce((a, d) => a + day(d), 0),
      weekend: we.reduce((a, d) => a + day(d), 0),
      hasData: days.some(has),
    };
  });
  const m = Number(month.slice(5));
  const sum = rows.reduce((a, r) => a + r.total, 0);
  const dataDays = Array.from({ length: 31 }, (_, i) => i + 1).filter(has);
  const avg = (pred: (dow: number) => boolean) => {
    const ds = dataDays.filter((d) => pred((new Date(Number(month.slice(0, 4)), m - 1, d).getDay() + 6) % 7));
    return ds.length ? ds.reduce((a, d) => a + day(d), 0) / ds.length : 0;
  };
  const wdAvg = avg((dw) => dw < 5);
  const weAvg = avg((dw) => dw >= 5);
  const receipts = dataDays.reduce((a, d) => a + cnt(d), 0);

  return (
    <div className="sales-detail">
      <div className="sales-detail-head">
        <b>
          {month.slice(0, 4)}년 {m}월 · {title}
        </b>
        <span className="muted small">
          합계 <b className="ink">{fullAmt(sum)}</b>
          {area ? ` · ${area}평 · 평당 ${fullAmt(sum / area)}` : ''}
          {receipts ? ` · 계산 ${receipts.toLocaleString()}건 · 객단가 ${fullAmt(sum / receipts)}` : ''}
        </span>
      </div>
      <div className="sales-detail-grid">
        <WeekChart rows={rows.filter((r) => r.hasData || r.total)} m={m} color={color} area={area} />
        <div className="sales-week-wrap">
          <table className="sales-week">
            <thead>
              <tr>
                <th />
                {DOW.map((d, i) => (
                  <th key={d} className={i >= 5 ? 'we' : ''}>
                    {d}
                  </th>
                ))}
                <th>월~금</th>
                <th className="we">토~일</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.i}>
                  <th>{r.i + 1}주</th>
                  {r.w.map((d, i) => (
                    <td key={i} className={`${i >= 5 ? 'we' : ''} ${d === null ? 'out' : ''}`} title={d !== null && has(d) ? `${m}/${d} ${fullAmt(day(d))}${cnt(d) ? ` · ${cnt(d)}건` : ''}` : undefined}>
                      {d !== null && (
                        <>
                          <span className="sw-d">{d}</span>
                          <span className="sw-v">{has(d) ? shortAmt(day(d)) : ''}</span>
                        </>
                      )}
                    </td>
                  ))}
                  <td className="sum" title={fullAmt(r.weekday)}>
                    {r.weekday ? shortAmt(r.weekday) : ''}
                  </td>
                  <td className="sum we" title={fullAmt(r.weekend)}>
                    {r.weekend ? shortAmt(r.weekend) : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sales-avg">
            <span>
              평일 하루 평균 <b>{fullAmt(wdAvg)}</b>
            </span>
            <span className="we">
              주말 하루 평균 <b>{fullAmt(weAvg)}</b>
            </span>
            {wdAvg > 0 && weAvg > 0 && <span className="muted small">주말이 평일의 {(weAvg / wdAvg).toFixed(1)}배</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

type WeekRow = { i: number; from: number; to: number; total: number };
function WeekChart({ rows, m, color, area }: { rows: WeekRow[]; m: number; color: string; area?: number }) {
  const W = 560;
  const L = 44;
  const R = 24;
  const top = 34;
  const bottom = 150; // 총 금액 영역
  const pTop = 222;
  const pBottom = 252; // 평당 금액 (작게, 회색)
  const H = area ? 266 : 196;
  if (!rows.length) return <div className="sales-chart muted small">이 달 판매 데이터가 없어요.</div>;
  const max = Math.max(...rows.map((r) => r.total), 1);
  const x = (i: number) => (rows.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (rows.length - 1));
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const per = area ? rows.map((r) => r.total / area) : [];
  const pMax = Math.max(...per, 1);
  const py = (v: number) => pBottom - (v / pMax) * (pBottom - pTop);
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join(' ');
  const grid = [0, 0.5, 1];
  return (
    <div className="sales-chart" style={{ '--c': color } as CSSProperties}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="주차별 판매 금액">
        {grid.map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(max * g)} y2={y(max * g)} className="sc-grid" />
            <text x={L - 6} y={y(max * g) + 4} className="sc-axis" textAnchor="end">
              {shortAmt(max * g)}
            </text>
          </g>
        ))}
        <path d={`${line(rows.map((r, i) => [x(i), y(r.total)]))} L${x(rows.length - 1)},${bottom} L${x(0)},${bottom} Z`} className="sc-area" />
        <path d={line(rows.map((r, i) => [x(i), y(r.total)]))} className="sc-line" />
        {rows.map((r, i) => (
          <g key={r.i}>
            <circle cx={x(i)} cy={y(r.total)} r={4} className="sc-dot" />
            <text x={x(i)} y={y(r.total) - 9} textAnchor="middle" className="sc-val">
              {shortAmt(r.total)}
            </text>
            <text x={x(i)} y={bottom + 18} textAnchor="middle" className="sc-wk">
              {r.i + 1}주
            </text>
            <text x={x(i)} y={bottom + 31} textAnchor="middle" className="sc-range">
              {m}/{r.from}~{m}/{r.to}
            </text>
          </g>
        ))}
        {area && (
          <g className="sc-per">
            <text x={L - 6} y={pBottom - 2} textAnchor="end" className="sc-axis">
              평당
            </text>
            <line x1={L} x2={W - R} y1={pBottom} y2={pBottom} className="sc-grid" />
            <path d={line(per.map((v, i) => [x(i), py(v)]))} className="sc-pline" />
            {per.map((v, i) => (
              <g key={i}>
                <circle cx={x(i)} cy={py(v)} r={2.5} className="sc-pdot" />
                <text x={x(i)} y={py(v) - 6} textAnchor="middle" className="sc-pval">
                  {shortAmt(v)}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
      <p className="muted small sc-note">
        주차는 월요일 시작 · 첫 주·마지막 주는 이 달 날짜만{area ? ` · 회색 = 평당 금액 (${area}평)` : ' · 설정에서 평수를 넣으면 평당 금액도 보여요'}
      </p>
    </div>
  );
}
