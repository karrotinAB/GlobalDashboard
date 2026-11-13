// 홈 맨 아래: 업체별 판매 데이터
//  업체 고르기 → 지점 × 월 합계 표 → 월(또는 지점의 그 월)을 누르면
//  왼쪽: 주차별 금액 꺾은선 (아래 작게 회색으로 평당 금액) · 오른쪽: 주차 × 요일 금액 (토·일 붉게)
import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { countryCode, useWorldHolidays } from '../lib/worldHolidays';
import { fullAmt, rateOn, shortAmt, useFxRates, useSales, useStoreBranches, weeksOf, type FxTable, type SalesBranch } from '../lib/sales';

type Conv = (iso: string, amt: number) => number | null;
/** 현지 통화 → 원화 / 달러 (판매일 ECOS 환율, 주말·공휴일은 그 전 영업일) */
function makeConv(fx: FxTable, money: string | undefined, target: 'KRW' | 'USD'): Conv {
  return (iso, amt) => {
    if (!money) return null;
    if (money === target) return amt;
    const krw = money === 'KRW' ? amt : (() => {
      const r = rateOn(fx, money, iso);
      return r ? amt * r.rate : null;
    })();
    if (krw === null) return null;
    if (target === 'KRW') return krw;
    const u = rateOn(fx, 'USD', iso);
    return u ? krw / u.rate : null;
  };
}
const fmtConv = (n: number, t: 'KRW' | 'USD') => (t === 'USD' ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : fullAmt(n));
const shortConv = (n: number, t: 'KRW' | 'USD') => (t === 'USD' ? (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0)) : shortAmt(n));
import type { Company } from '../types';
import ExportPanel from './ExportPanel';

const pad = (n: number) => String(n).padStart(2, '0');
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

/** 판매데이터 ↔ 수출매출 슬라이드 버튼 */
export default function SalesPanel({ companies }: { companies: Company[] }) {
  const [mode, setMode] = useState<'sales' | 'export'>(() => (store.get('gd:salesMode') === 'export' ? 'export' : 'sales'));
  const pick = (m: 'sales' | 'export') => {
    setMode(m);
    store.set('gd:salesMode', m);
  };
  return (
    <section className="card sales">
      <div className="section-head">
        <h2>{mode === 'sales' ? '📈 업체별 판매 데이터' : '🚢 업체별 수출 매출'}</h2>
        <div className={`mode-slide ${mode}`} role="tablist">
          <span className="mode-knob" />
          <button role="tab" aria-selected={mode === 'sales'} onClick={() => pick('sales')}>
            판매데이터
          </button>
          <button role="tab" aria-selected={mode === 'export'} onClick={() => pick('export')}>
            수출매출
          </button>
        </div>
        <span className="muted small sales-sub">
          {mode === 'sales' ? '매주 월요일 아침 7시에 판매가 업데이트돼요 · 평수는 설정에서' : '주문 관리의 ERP 출고 데이터 + 로열티(판매의 5%)'}
        </span>
      </div>
      {mode === 'sales' ? <SalesView companies={companies} /> : <ExportPanel companies={companies} />}
    </section>
  );
}

function SalesView({ companies }: { companies: Company[] }) {
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
  // 판매 통화 → 원화 (판매일 ECOS 환율)
  const money = co?.salesCurrency;
  const fxTable = useFxRates([money ?? '', 'USD'], monthList.length ? [prevMonth(monthList[0]), ...monthList] : []);
  // 현지 통화 금액 아래에 보여줄 환산 통화 (슬라이드 버튼: 원화 / 달러)
  const [target, setTarget] = useState<'KRW' | 'USD'>(() => (store.get('gd:salesConv') === 'USD' ? 'USD' : 'KRW'));
  const pickTarget = (t: 'KRW' | 'USD') => {
    setTarget(t);
    store.set('gd:salesConv', t);
  };
  const convDay = makeConv(fxTable, money, target);
  const tSym = target === 'USD' ? '$' : '₩';
  const krwOf = (m: string, sid?: string) => {
    const b = byMonth.get(m) ?? {};
    let sum = 0;
    for (const id of sid ? [sid] : Object.keys(b)) for (const [dd, v] of Object.entries(b[id]?.days ?? {})) {
      const r = convDay(`${m}-${dd}`, v);
      if (r === null) return null;
      sum += r;
    }
    return sum;
  };

  return (
    <>
      {withCodes.length === 0 ? (
        <p className="muted small">판매 데이터를 수집 중인 업체가 없어요. 설정 &gt; 매장 평수에서 업체 이름 옆 <b>판매데이터</b>를 켜 주세요.</p>
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
          {cur && (() => {
            // 달 고르기 (수출매출처럼) + 그 달 지점 표: 가로로 지점, 세로로 매장명 · 금액 (오른쪽으로 스크롤)
            const idx = monthList.indexOf(cur.month);
            const [cy, cm] = cur.month.split('-').map(Number);
            const ids = branchIds.filter((sid) => total(cur.month, sid));
            const k = krwOf(cur.month);
            return (
              <>
                <div className="sales-bar">
                <div className="month-nav">
                  <button disabled={idx <= 0} onClick={() => setSel({ month: monthList[idx - 1], branch: null })} aria-label="이전 달">
                    ◀
                  </button>
                  <b>
                    {cy}년 {cm}월
                  </b>
                  <button disabled={idx >= monthList.length - 1} onClick={() => setSel({ month: monthList[idx + 1], branch: null })} aria-label="다음 달">
                    ▶
                  </button>
                  {idx !== monthList.length - 1 && (
                    <button className="link" onClick={() => setSel({ month: monthList[monthList.length - 1], branch: null })}>
                      최근 달
                    </button>
                  )}
                </div>
                {money && (
                  <div className="conv-pick">
                    <span className="muted small">{money} 아래 환산</span>
                    <div className={`mode-slide small ${target === 'KRW' ? 'sales' : 'export'}`} role="tablist">
                      <span className="mode-knob" />
                      <button role="tab" aria-selected={target === 'KRW'} onClick={() => pickTarget('KRW')}>
                        원화 KRW
                      </button>
                      <button role="tab" aria-selected={target === 'USD'} onClick={() => pickTarget('USD')}>
                        외화 USD
                      </button>
                    </div>
                  </div>
                )}
                </div>
                <div className="sales-table-wrap hz-wrap">
                  <table className="sales-table hz-table">
                    <tbody>
                      <tr>
                        <th className="l">매장명</th>
                        <td className="hz-total">
                          <b>합계</b>
                          <span className="muted small"> {ids.length}개 지점</span>
                        </td>
                        {ids.map((sid) => (
                          <td key={sid} className={cur.branch === sid ? 'on' : ''}>
                            <button className="hz-name" onClick={() => setSel({ month: cur.month, branch: cur.branch === sid ? null : sid })} title="누르면 이 지점만">
                              <span className="br-dot" style={{ background: BR_COLORS[branchIds.indexOf(sid) % BR_COLORS.length] }} />
                              <b>{nameOf(sid) || sid}</b>
                              <span className="muted small">
                                {' '}
                                {sid}
                                {areaOf(sid) ? ` · ${fmtArea(areaOf(sid)!)}평` : ''}
                              </span>
                            </button>
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <th className="l">
                          금액 {money && <span className="cur-tag">{money}</span>}
                        </th>
                        <td className="hz-total r" title={fullAmt(total(cur.month))}>
                          <b>
                            {money ? curSym(money) : ''}
                            {fullAmt(total(cur.month))}
                          </b>
                          {k !== null && <small className="krw">{tSym}{fmtConv(k, target)}</small>}
                        </td>
                        {ids.map((sid) => {
                          const kk = krwOf(cur.month, sid);
                          return (
                            <td key={sid} className={`r ${cur.branch === sid ? 'on' : ''}`}>
                              {money ? curSym(money) : ''}
                              {fullAmt(total(cur.month, sid))}
                              {kk !== null && <small className="krw">{tSym}{fmtConv(kk, target)}</small>}
                              {areaOf(sid) ? <small className="per">평당 {fullAmt(total(cur.month, sid) / areaOf(sid)!)}</small> : null}
                            </td>
                          );
                        })}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            );
          })()}

          {cur && (
            <MonthDetail
              key={cur.month}
              month={cur.month}
              color={co.color ?? '#8c2f3c'}
              focus={cur.branch}
              money={money}
              convDay={convDay}
              target={target}
              holidayCode={countryCode(co.country || co.name, co.timezone)}
              branches={branchIds.flatMap((sid, bi) => {
                const data = byMonth.get(cur.month)?.[sid];
                return data ? [{ sid, name: nameOf(sid) || sid, color: BR_COLORS[bi % BR_COLORS.length], area: areaOf(sid), data } as Br] : [];
              })}
            />
          )}
        </>
      )}
    </>
  );
}

const BR_COLORS = ['#3b7dd8', '#e08a2e', '#3a9a5b', '#9b59b6', '#d64545', '#16a2a2', '#b5651d', '#7f8c8d', '#c2185b', '#5d6d7e'];
const fmtArea = (a: number) => String(Math.round(a * 10) / 10);
const prevMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(y, mo - 2, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const SYM: Record<string, string> = { MNT: '₮', KZT: '₸', USD: '$', EUR: '€', GBP: '£', RUB: '₽', JPY: '¥', CNY: '¥', KRW: '₩', VND: '₫', THB: '฿', PHP: '₱', INR: '₹', TRY: '₺' };
const curSym = (c: string) => SYM[c] ?? `${c} `;
type Br = { sid: string; name: string; color: string; area?: number; data: SalesBranch };

/** 한 달 자세히: 왼쪽 주차별 그래프 (합계 + 지점별) · 오른쪽 날짜 × 지점 표 (주마다 합계·평당) */
function MonthDetail({
  month,
  color,
  branches,
  focus,
  money,
  convDay,
  target,
  holidayCode,
}: {
  month: string;
  color: string;
  branches: Br[];
  focus: string | null;
  money?: string;
  convDay: Conv;
  target: 'KRW' | 'USD';
  holidayCode?: string;
}) {
  const tSym = target === 'USD' ? '$' : '₩';
  const { data: storeData } = useStore();
  const holiday = useWorldHolidays(holidayCode ? [holidayCode] : [], Number(month.slice(0, 4)), storeData.config.find((c) => c.id === 'holidays')?.holidays ?? []);
  const holidayOn = (d: number) => (holidayCode ? holiday(holidayCode, `${month}-${pad(d)}`) : undefined);
  const sym = money ? curSym(money) : '';
  const needKrw = !!money && money !== target;
  const [only, setOnly] = useState<string | null>(focus); // 표: 전체 / 지점 하나
  const [week, setWeek] = useState<number | null>(null); // 그래프 점(주)을 누르면 그 주 날짜 × 지점 표
  const [y, mo] = month.split('-').map(Number);
  const last = new Date(y, mo, 0).getDate();
  const v = (b: Br, d: number) => b.data.days[pad(d)];
  const c = (b: Br, d: number) => b.data.cnt?.[pad(d)] ?? 0;
  const dayTotal = (d: number) => branches.reduce((a, b) => a + (v(b, d) ?? 0), 0);
  const has = (d: number) => branches.some((b) => v(b, d) !== undefined);
  const weeks = weeksOf(month).map((w, i) => {
    const days = w.filter((d): d is number => d !== null);
    return { i, days, from: days[0], to: days[days.length - 1], hasData: days.some(has) };
  });
  const sumOf = (b: Br | null, days: number[]) => days.reduce((a, d) => a + (b ? v(b, d) ?? 0 : dayTotal(d)), 0);
  const allDays = Array.from({ length: last }, (_, i) => i + 1);
  const monthSum = sumOf(null, allDays);
  const receipts = allDays.reduce((a, d) => a + branches.reduce((x, b) => x + c(b, d), 0), 0);
  // 원화 환산 (판매일 환율). 환율이 없는 날이 있으면 null
  const krwOf = (b: Br | null, days: number[]) => {
    if (!needKrw) return null;
    let sum = 0;
    for (const d of days) {
      const amt = b ? v(b, d) ?? 0 : dayTotal(d);
      if (!amt) continue;
      const r = convDay(`${month}-${pad(d)}`, amt);
      if (r === null) return null;
      sum += r;
    }
    return sum;
  };
  const Krw = ({ b, days }: { b: Br | null; days: number[] }) => {
    const k = krwOf(b, days);
    return k !== null ? <small className="krw">{tSym}{fmtConv(k, target)}</small> : null;
  };
  const shown = only ? branches.filter((b) => b.sid === only) : branches;
  const one = only ? shown[0] : null;
  const dow = (d: number) => (new Date(y, mo - 1, d).getDay() + 6) % 7; // 월=0
  const DOWK = ['월', '화', '수', '목', '금', '토', '일'];

  return (
    <div className="sales-detail">
      <div className="sales-detail-head">
        <b>
          {y}년 {mo}월
        </b>
        <span className="muted small">
          합계 <b className="ink">{sym}{fullAmt(monthSum)}</b>
          {money && ` ${money}`}
          {krwOf(null, allDays) !== null && (
            <>
              {' '}≈ <b className="ink">{tSym}{fmtConv(krwOf(null, allDays)!, target)}</b> <span className="muted">(판매일 환율)</span>
            </>
          )}
          {receipts ? ` · 계산 ${receipts.toLocaleString()}건 · 객단가 ${fullAmt(monthSum / receipts)}` : ''}
        </span>
      </div>
      <div className="sales-detail-grid">
        <WeekChart
          weeks={weeks.filter((w) => w.hasData)}
          m={mo}
          color={color}
          branches={branches}
          sumOf={sumOf}
          sym={sym}
          convOf={needKrw ? krwOf : undefined}
          tSym={tSym}
          target={target}
          picked={week}
          onPick={(i) => setWeek(week === i ? null : i)}
        />
        <MonthCalendar
          month={month}
          weeks={weeks}
          branches={only ? branches.filter((b) => b.sid === only) : branches}
          holidayOn={holidayOn}
          sym={sym}
          conv={needKrw ? (d: number, amt: number) => convDay(`${month}-${pad(d)}`, amt) : undefined}
          tSym={tSym}
          target={target}
          picked={week}
          onPick={(i) => setWeek(week === i ? null : i)}
        />
      </div>
      {week !== null && (
        <div className="sales-sheet-wrap week-sheet">
          <div className="week-sheet-head">
            <b>
              {week + 1}주 자세히
            </b>
            <button className="link" onClick={() => setWeek(null)}>
              닫기 ✕
            </button>
          </div>
          <div className="company-chips sheet-chips">
            <button className={`cchip ${!only ? 'on' : ''}`} onClick={() => setOnly(null)}>
              전체
            </button>
            {branches.map((b) => (
              <button key={b.sid} className={`cchip ${only === b.sid ? 'on' : ''}`} onClick={() => setOnly(only === b.sid ? null : b.sid)}>
                <span className="br-dot" style={{ background: b.color }} />
                {b.name}
                {b.area ? <span className="muted small"> {fmtArea(b.area)}평</span> : null}
              </button>
            ))}
          </div>
          <div className="sales-sheet-scroll">
            <table className="sales-sheet">
              <thead>
                <tr>
                  <th className="l">날짜{money ? ` (${money})` : ''}</th>
                  {one ? (
                    <>
                      <th>판매</th>
                      <th>건수</th>
                      <th>객단가</th>
                    </>
                  ) : (
                    <>
                      {shown.map((b) => (
                        <th key={b.sid} style={{ color: b.color }}>
                          {b.name}
                        </th>
                      ))}
                      {shown.length > 1 && <th className="sep">합계</th>}
                    </>
                  )}
                </tr>
              </thead>
              <tbody>
                {weeks.filter((w) => w.i === week).map((w) => (
                  <WeekBlock key={w.i}>
                    {w.days.map((d) => {
                      const we = dow(d) >= 5;
                      const hol = holidayOn(d);
                      if (!has(d) && new Date(y, mo - 1, d) > new Date()) return null; // 아직 안 온 날
                      return (
                        <tr key={d} className={`${we ? 'we' : ''} ${hol ? 'hol' : ''}`} title={hol ? `${hol} (공휴일)` : undefined}>
                          <th className="l">
                            {mo}/{d} <span className="dw">{DOWK[dow(d)]}</span>
                            {hol && <span className="hol-name">{hol}</span>}
                          </th>
                          {one ? (
                            <>
                              <td className="r">
                                {v(one, d) !== undefined ? `${sym}${fullAmt(v(one, d)!)}` : '—'}
                                {v(one, d) !== undefined && <Krw b={one} days={[d]} />}
                              </td>
                              <td className="r muted">{c(one, d) || ''}</td>
                              <td className="r muted">{c(one, d) && v(one, d) ? fullAmt(v(one, d)! / c(one, d)) : ''}</td>
                            </>
                          ) : (
                            <>
                              {shown.map((b) => (
                                <td key={b.sid} className="r">
                                  {v(b, d) !== undefined ? `${sym}${fullAmt(v(b, d)!)}` : '—'}
                                  {v(b, d) !== undefined && <Krw b={b} days={[d]} />}
                                </td>
                              ))}
                              {shown.length > 1 && (
                                <td className="r b sep">
                                  {has(d) ? `${sym}${fullAmt(dayTotal(d))}` : '—'}
                                  {has(d) && <Krw b={null} days={[d]} />}
                                </td>
                              )}
                            </>
                          )}
                        </tr>
                      );
                    })}
                    {w.hasData && (
                      <tr className="wk-sum">
                        <th className="l">
                          {w.i + 1}주 합계
                          <span className="muted small"> {mo}/{w.from}~{mo}/{w.to}</span>
                          {(() => {
                            // 평일 | 주말·공휴일 (지금 보는 지점 기준)
                            const pick = one ?? null;
                            const off = (d: number) => dow(d) >= 5 || !!holidayOn(d);
                            const wd = sumOf(pick, w.days.filter((d) => !off(d)));
                            const wkend = sumOf(pick, w.days.filter(off));
                            return (
                              <span className="wk-split">
                                평일 {shortAmt(wd)} <i>|</i> <em>주말·공휴일 {shortAmt(wkend)}</em>
                              </span>
                            );
                          })()}
                        </th>
                        {one ? (
                          <>
                            <td className="r">
                              {sym}
                              {fullAmt(sumOf(one, w.days))}
                              {one.area ? <small className="per">평당 {fullAmt(sumOf(one, w.days) / one.area)}</small> : null}
                              <Krw b={one} days={w.days} />
                            </td>
                            <td className="r muted">{w.days.reduce((a, d) => a + c(one, d), 0) || ''}</td>
                            <td />
                          </>
                        ) : (
                          <>
                            {shown.map((b) => (
                              <td key={b.sid} className="r">
                                {sym}
                                {fullAmt(sumOf(b, w.days))}
                                {b.area ? <small className="per">평당 {fullAmt(sumOf(b, w.days) / b.area)}</small> : null}
                                <Krw b={b} days={w.days} />
                              </td>
                            ))}
                            {shown.length > 1 && (
                              <td className="r sep">
                                {sym}
                                {fullAmt(sumOf(null, w.days))}
                                <Krw b={null} days={w.days} />
                              </td>
                            )}
                          </>
                        )}
                      </tr>
                    )}
                  </WeekBlock>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">
            <span className="legend-chip we" /> 주말 <span className="legend-chip hol" /> 공휴일{holidayCode ? ` (${holidayCode})` : ''} · 금액 단위 {money ?? '(설정 › 매장 평수에서 판매 통화를 골라 주세요)'}
            {needKrw ? ` · ${tSym} = 판매일 ECOS 환율로 환산` : ''} · 평당은 지점별 (설정에서 평수를 넣은 지점만)
          </p>
        </div>
      )}
    </div>
  );
}
const WeekBlock = ({ children }: { children: React.ReactNode }) => <>{children}</>;

type Wk = { i: number; days: number[]; from: number; to: number };
/** 주차별 꺾은선: 합계(굵게) + 지점별(가늘게) */
function WeekChart({
  weeks,
  m,
  color,
  branches,
  sumOf,
  sym,
  convOf,
  tSym,
  target,
  picked,
  onPick,
}: {
  weeks: Wk[];
  m: number;
  color: string;
  branches: Br[];
  sumOf: (b: Br | null, days: number[]) => number;
  sym: string;
  convOf?: (b: Br | null, days: number[]) => number | null;
  tSym: string;
  target: 'KRW' | 'USD';
  picked: number | null;
  onPick: (i: number) => void;
}) {
  // 지점이 많으면 처음엔 합계 선만 (범례에서 지점을 눌러 켜기)
  const [hide, setHide] = useState<Set<string>>(() => new Set(branches.length > 6 ? branches.map((b) => b.sid) : []));
  const W = 560;
  const L = 50;
  const R = 26;
  const top = 44;
  const bottom = 210;
  const H = 252;
  if (!weeks.length) return <div className="sales-chart muted small">이 달 판매 데이터가 없어요.</div>;
  const series = [
    { key: 'all', name: '합계', color, vals: weeks.map((w) => sumOf(null, w.days)), main: true },
    ...(branches.length > 1 ? branches.map((b) => ({ key: b.sid, name: b.name, color: b.color, vals: weeks.map((w) => sumOf(b, w.days)), main: false })) : []),
  ].filter((s) => !hide.has(s.key));
  const max = Math.max(1, ...series.flatMap((s) => s.vals));
  const x = (i: number) => (weeks.length === 1 ? (L + W - R) / 2 : L + (i * (W - L - R)) / (weeks.length - 1));
  const y = (v: number) => bottom - (v / max) * (bottom - top);
  const line = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const toggle = (k: string) =>
    setHide((h) => {
      const n = new Set(h);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });
  return (
    <div className="sales-chart">
      <div className="chart-legend">
        {[{ key: 'all', name: '합계', color }, ...(branches.length > 1 ? branches.map((b) => ({ key: b.sid, name: b.name, color: b.color })) : [])].map((s) => (
          <button key={s.key} className={`lg ${hide.has(s.key) ? 'off' : ''}`} onClick={() => toggle(s.key)} title="눌러서 숨기기/보이기">
            <span className="lg-line" style={{ background: s.color, height: s.key === 'all' ? 3 : 2 }} />
            {s.name}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="주차별 판매 금액">
        {[0, 0.5, 1].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(max * g)} y2={y(max * g)} className="sc-grid" />
            <text x={L - 6} y={y(max * g) + 4} className="sc-axis" textAnchor="end">
              {sym}
              {shortAmt(max * g)}
            </text>
          </g>
        ))}
        {/* 합계(굵고 옅게)를 먼저 그리고 지점 선을 위에 — 지점 하나가 합계와 거의 같아도 보이게 */}
        {series.map((s) => (
            <g key={s.key}>
              <path d={line(s.vals)} fill="none" stroke={s.color} strokeWidth={s.main ? 5 : 2} strokeLinejoin="round" strokeLinecap="round" opacity={s.main ? 0.45 : 0.95} />
              {s.vals.map((v, i) => (
                <circle key={i} cx={x(i)} cy={y(v)} r={s.main ? 4 : 2.6} fill="#fff" stroke={s.color} strokeWidth={s.main ? 2 : 1.5}>
                  <title>
                    {s.name} {weeks[i].i + 1}주: {fullAmt(v)}
                  </title>
                </circle>
              ))}
              {s.main &&
                s.vals.map((v, i) => (
                  <text key={i} x={x(i)} y={y(v) - (convOf ? 20 : 9)} textAnchor="middle" className="sc-val">
                    {sym}
                    {shortAmt(v)}
                    {convOf && convOf(null, weeks[i].days) !== null && (
                      <tspan x={x(i)} dy={11} className="sc-conv">
                        {tSym}
                        {shortConv(convOf(null, weeks[i].days)!, target)}
                      </tspan>
                    )}
                  </text>
                ))}
            </g>
          ))}
        {weeks.map((w, i) => (
          <g key={w.i} className={`wk-hit ${picked === w.i ? 'on' : ''}`} onClick={() => onPick(w.i)}>
            {/* 주 전체 세로 띠를 눌러도 됨 */}
            <rect x={x(i) - 22} y={top - 18} width={44} height={bottom - top + 52} rx={8} className="wk-band">
              <title>{w.i + 1}주 날짜별·지점별 보기</title>
            </rect>
            <text x={x(i)} y={bottom + 18} textAnchor="middle" className="sc-wk">
              {w.i + 1}주
            </text>
            <text x={x(i)} y={bottom + 31} textAnchor="middle" className="sc-range">
              {m}/{w.from}~{m}/{w.to}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** 달력: 주 × 요일 금액 · 평일 / 주말 합 (주말 붉게 · 공휴일 보라) */
function MonthCalendar({
  month,
  weeks,
  branches,
  holidayOn,
  sym,
  conv,
  tSym,
  target,
  picked,
  onPick,
}: {
  month: string;
  weeks: { i: number; days: number[] }[];
  branches: Br[];
  holidayOn: (d: number) => string | undefined;
  sym: string;
  conv?: (d: number, amt: number) => number | null;
  tSym: string;
  target: 'KRW' | 'USD';
  picked: number | null;
  onPick: (i: number) => void;
}) {
  const [y, mo] = month.split('-').map(Number);
  const val = (d: number) => branches.reduce((a, b) => a + (b.data.days[pad(d)] ?? 0), 0);
  const has = (d: number) => branches.some((b) => b.data.days[pad(d)] !== undefined);
  const dow = (d: number) => (new Date(y, mo - 1, d).getDay() + 6) % 7;
  const off = (d: number) => dow(d) >= 5 || !!holidayOn(d);
  const grid = weeksOf(month);
  const all = weeks.flatMap((w) => w.days).filter(has);
  const avg = (pred: (d: number) => boolean) => {
    const ds = all.filter(pred);
    return ds.length ? ds.reduce((a, d) => a + val(d), 0) / ds.length : 0;
  };
  const sumConv = (ds: number[]) => ds.reduce((a, d) => a + (has(d) ? conv?.(d, val(d)) ?? 0 : 0), 0);
  const wdAvg = avg((d) => !off(d));
  const offAvg = avg(off);
  return (
    <div className="sales-week-wrap">
      <table className="sales-week">
        <thead>
          <tr>
            <th />
            {['월', '화', '수', '목', '금', '토', '일'].map((d, i) => (
              <th key={d} className={i >= 5 ? 'we' : ''}>
                {d}
              </th>
            ))}
            <th className="sep">평일</th>
            <th className="we">주말</th>
          </tr>
        </thead>
        <tbody>
          {grid.map((w, wi) => {
            const days = w.filter((d): d is number => d !== null);
            const wd = days.filter((d) => !off(d)).reduce((a, d) => a + val(d), 0);
            const we = days.filter(off).reduce((a, d) => a + val(d), 0);
            return (
              <tr key={wi} className={picked === wi ? 'picked' : ''}>
                <th>
                  <button className="wk-btn" onClick={() => onPick(wi)} title="이 주 날짜 × 지점 표">
                    {wi + 1}주
                  </button>
                </th>
                {w.map((d, i) => {
                  const hol = d !== null ? holidayOn(d) : undefined;
                  return (
                    <td
                      key={i}
                      className={`${i >= 5 ? 'we' : ''} ${hol ? 'hol' : ''} ${d === null ? 'out' : ''}`}
                      title={d !== null && has(d) ? `${mo}/${d}${hol ? ` ${hol}` : ''} ${sym}${fullAmt(val(d))}` : hol}
                    >
                      {d !== null && (
                        <>
                          <span className="sw-d">
                            {d}
                            {hol && <span className="sw-hol">{hol}</span>}
                          </span>
                          <span className="sw-v">{has(d) ? shortAmt(val(d)) : ''}</span>
                          {conv && has(d) && conv(d, val(d)) !== null && <span className="sw-c">{tSym}{shortConv(conv(d, val(d))!, target)}</span>}
                        </>
                      )}
                    </td>
                  );
                })}
                <td className="sum sep" title={`${sym}${fullAmt(wd)}`}>
                  {wd ? shortAmt(wd) : ''}
                  {conv && wd ? <span className="sw-c">{tSym}{shortConv(sumConv(days.filter((d) => !off(d))), target)}</span> : null}
                </td>
                <td className="sum we" title={`${sym}${fullAmt(we)}`}>
                  {we ? shortAmt(we) : ''}
                  {conv && we ? <span className="sw-c">{tSym}{shortConv(sumConv(days.filter(off)), target)}</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sales-avg">
        <span>
          평일 하루 평균 <b>{sym}{fullAmt(wdAvg)}</b>
        </span>
        <span className="we">
          주말·공휴일 하루 평균 <b>{sym}{fullAmt(offAvg)}</b>
        </span>
        {wdAvg > 0 && offAvg > 0 && <span className="muted small">주말이 평일의 {(offAvg / wdAvg).toFixed(1)}배</span>}
      </div>
      <p className="muted small">
        <span className="legend-chip we" /> 주말 <span className="legend-chip hol" /> 공휴일 (주말에 포함) · 주 이름이나 그래프의 점을 누르면 그 주 자세히
      </p>
    </div>
  );
}
