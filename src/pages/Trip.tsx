// 출장신청서 (도구함): 각자 자기 출장마다 한 장 — 전도금과 같은 방식
//   [기록] 출장비 내역 · 교통비 (외화는 영수증 날짜 ECOS 환율로 원화) · 오른쪽 이름·계좌(전도금 계좌)·합계(한글 금액)
//   [프린트] 1. 출장신청서 (A4) · 2. 교통비 사용내역서 · 3. 영수증 정리
//   [관리] 출장비 항목 · 금액 통화 (관리자 · 전도금 담당자)
import LeaveForm from '../components/LeaveForm';
import { useEffect, useMemo, useState } from 'react';
import { useAccess } from '../components/AuthGate';
import PettyReceipts from '../components/PettyReceipts';
import { AddEntry, EntryStoreCtx, EntryTable, printSheet, useFullName } from './Petty';
import { curLabel, itemOf, usePettyAccount, usePettyCfg, won, type PettyEntry } from '../lib/petty';
import { CUR_SIGN, rateOn, SALES_CURRENCIES, useFxRates } from '../lib/sales';
import { today, uid } from '../lib/date';
import {
  deleteTrip,
  deleteTripEntry,
  saveTrip,
  saveTripCfg,
  saveTripEntry,
  tripTitle,
  tripTransportItem,
  useTripCfg,
  useTripEntries,
  useTrips,
  wonKorean,
  type Trip as TripDoc,
  type TripRow,
} from '../lib/trip';

const dots = (iso?: string) => (iso ? iso.replace(/-/g, '.') : '');
const monthsBetween = (a: string, b: string) => {
  const out: string[] = [];
  if (!a) return out;
  let [y, m] = a.slice(0, 7).split('-').map(Number);
  const end = (b || a).slice(0, 7);
  for (let i = 0; i < 24; i++) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= end) break;
    m++;
    if (m > 12) (m = 1), y++;
  }
  return out;
};

export default function Trip() {
  const access = useAccess();
  const email = access.email || 'local';
  const previewMember = access.realRole === 'admin' && access.role === 'member';
  const pcCfg = usePettyCfg();
  const canManage = access.role === 'admin' || access.role === null || (!previewMember && !!pcCfg?.managers.includes(email));
  const trips = useTrips(email);
  // 화면: 목록 (처음) → 신청서 쓰기 / 신청서 열기 / 관리
  const [view, setView] = useState<{ k: 'list' } | { k: 'new' } | { k: 'trip'; id: string } | { k: 'manage' }>({ k: 'list' });
  const [tab, setTab] = useState<'record' | 'print' | 'leave'>('record');
  // 위 탭: 기록 · 프린트 · 관리 (전도금과 같은 모양)
  const topTab = view.k === 'manage' ? 'manage' : tab;
  const goTab = (t: 'record' | 'print' | 'leave' | 'manage') => {
    if (t === 'manage') return setView({ k: 'manage' });
    setTab(t);
    if (view.k === 'manage' || view.k === 'new') setView({ k: 'list' });
  };
  const cur = view.k === 'trip' ? trips?.find((t) => t.id === view.id) : undefined;
  const back = (
    <button className="link trip-back" onClick={() => setView({ k: 'list' })}>
      ← 신청서 목록
    </button>
  );
  return (
    <div className="page">
      <div className="page-head">
        <h1>출장신청서</h1>
        <p className="muted">출장마다 신청서를 한 장씩 만들어요. 출장비 내역 · 교통비 · 영수증을 기록하고 출장신청서 · 교통비 사용내역서 · 영수증을 A4 로 뽑아요.</p>
      </div>
      <div className="seg pc-tabs">
        <button className={topTab === 'record' ? 'on' : ''} onClick={() => goTab('record')}>
          ✍️ 출장신청서 기록
        </button>
        <button className={topTab === 'print' ? 'on' : ''} onClick={() => goTab('print')}>
          🖨 출장비 프린트
        </button>
        <button className={topTab === 'leave' ? 'on' : ''} onClick={() => goTab('leave')}>
          🌴 대체휴가 신청서
        </button>
        {canManage && (
          <button className={topTab === 'manage' ? 'on' : ''} onClick={() => goTab('manage')}>
            🗂 관리
          </button>
        )}
      </div>
      {/* 대체휴가 신청서: 출장과 따로 (내 신청서 목록 + A4 신청서) */}
      {tab === 'leave' && view.k !== 'manage' && <LeaveForm email={email} />}
      {view.k === 'list' && tab !== 'leave' && (
        <section className="card trip-home">
          {tab === 'record' ? (
            <div className="trip-home-head">
              <button className="primary trip-new" onClick={() => setView({ k: 'new' })}>
                ＋ 신청서 쓰기
              </button>
            </div>
          ) : (
            <p className="muted small" style={{ marginTop: 0 }}>
              프린트할 신청서를 골라 주세요.
            </p>
          )}
          <h2 className="trip-home-title">내 출장신청서</h2>
          {trips === null ? (
            <p className="muted small">불러오는 중…</p>
          ) : trips.length === 0 ? (
            <p className="muted small">아직 쓴 신청서가 없어요. 위의 '＋ 신청서 쓰기'로 시작해요.</p>
          ) : (
            <div className="trip-rows">
              {trips.map((t) => (
                <button key={t.id} className="trip-row" onClick={() => setView({ k: 'trip', id: t.id })}>
                  <span className="trip-row-icon">✈️</span>
                  <b>{tripTitle(t)}</b>
                  <span className="muted small">
                    {dots(t.from)} ~ {dots(t.to)}
                  </span>
                  {t.purpose && <span className="trip-row-purpose">{t.purpose}</span>}
                  <span className="trip-row-go">열기 ›</span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}
      {view.k === 'new' && (
        <>
          {back}
          <NewTrip
            email={email}
            onMade={(id) => {
              setView({ k: 'trip', id });
              setTab('record');
            }}
            onCancel={() => setView({ k: 'list' })}
          />
        </>
      )}
      {view.k === 'manage' && canManage && (
        <>
          {back}
          <TripManage />
        </>
      )}
      {view.k === 'trip' && tab !== 'leave' &&
        (cur ? (
          <>
            {back}
            <TripView key={cur.id} trip={cur} email={email} tab={tab} onDeleted={() => setView({ k: 'list' })} />
          </>
        ) : (
          <>
            {back}
            <p className="muted small">불러오는 중…</p>
          </>
        ))}
    </div>
  );
}

function NewTrip({ email, onMade, onCancel }: { email: string; onMade: (id: string) => void; onCancel?: () => void }) {
  const name = useFullName(email);
  const [region, setRegion] = useState('');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [err, setErr] = useState('');
  const ok = region.trim() && from && to && from <= to;
  const make = async () => {
    if (!ok) return;
    const t: TripDoc = { id: uid(), email, name, region: region.trim(), from, to, createdAt: new Date().toISOString() };
    try {
      await saveTrip(t);
      onMade(t.id);
    } catch (e) {
      setErr(`만들지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <div className="card trip-newform">
      <h2>새 출장신청서</h2>
      <div className="trip-newrow">
        <label>
          <span>출장 지역</span>
          <input autoFocus placeholder="예: 미국" value={region} onChange={(e) => setRegion(e.target.value)} />
        </label>
        <label>
          <span>출장 기간</span>
          <span className="trip-dates">
            <input type="date" value={from} onChange={(e) => (setFrom(e.target.value), e.target.value > to && setTo(e.target.value))} />
            ~
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </span>
        </label>
      </div>
      {region.trim() && <p className="muted small">페이지 제목: {tripTitle({ from, region: region.trim() })}</p>}
      {err && <p className="warn small">{err}</p>}
      <div className="btn-row" style={{ gap: 8 }}>
        <button className="primary" disabled={!ok} onClick={() => void make()}>
          만들기
        </button>
        {onCancel && <button onClick={onCancel}>취소</button>}
      </div>
    </div>
  );
}

function TripView({ trip, email, tab, onDeleted }: { trip: TripDoc; email: string; tab: 'record' | 'print'; onDeleted: () => void }) {
  const cfg = useTripCfg();
  const entries = useTripEntries(email, trip.id);
  const rows = entries ?? [];
  const store = useMemo(() => ({ save: saveTripEntry, del: deleteTripEntry, extra: { tripId: trip.id } as Partial<PettyEntry> }), [trip.id]);
  // 외화: 영수증 날짜 ECOS 환율로 원화 (환율이 늦게 들어오면 그때 채움)
  const fx = useFxRates(
    cfg.currencies.filter((c) => c !== 'KRW'),
    monthsBetween(trip.from, trip.to).concat(monthsBetween(rows[0]?.date ?? '', rows[rows.length - 1]?.date ?? '')),
  );
  useEffect(() => {
    for (const e of rows) {
      if (!e.cur || e.cur === 'KRW' || e.amount !== undefined || e.curAmount === undefined) continue;
      const r = rateOn(fx, e.cur, e.date);
      if (r) void saveTripEntry({ ...e, amount: Math.round(e.curAmount * r.rate), rate: r.rate, rateDate: r.date });
    }
  }, [rows, fx]);
  return (
    <EntryStoreCtx.Provider value={store}>
      <div className="trip-head">
        <div>
          <h2 className="trip-title">{tripTitle(trip)}</h2>
          <span className="muted small">
            {dots(trip.from)} ~ {dots(trip.to)}
          </span>
        </div>
        <button
          className="link small danger-text"
          onClick={async () => {
            if (!confirm(`'${tripTitle(trip)}' 신청서를 지울까요? (안의 내역도 같이 지워요)`)) return;
            for (const e of rows) await deleteTripEntry(e.id);
            await deleteTrip(trip.id);
            onDeleted();
          }}
        >
          🗑 신청서 지우기
        </button>
      </div>
      {tab === 'record' ? <TripRecord trip={trip} email={email} rows={rows} cfg={cfg} fx={fx} loading={entries === null} /> : <TripPrint trip={trip} rows={rows} cats={cfg.categories} fx={fx} curs={cfg.currencies} />}
    </EntryStoreCtx.Provider>
  );
}

function TripRecord({
  trip,
  email,
  rows,
  cfg,
  fx,
  loading,
}: {
  trip: TripDoc;
  email: string;
  rows: PettyEntry[];
  cfg: { categories: string[]; currencies: string[] };
  fx: ReturnType<typeof useFxRates>;
  loading: boolean;
}) {
  const name = useFullName(email);
  const acc = usePettyAccount(email);
  const expenses = rows.filter((e) => e.kind === 'expense');
  const transports = rows.filter((e) => e.kind === 'transport');
  const sum = (l: PettyEntry[]) => l.reduce((a, e) => a + (e.amount ?? 0), 0);
  const total = sum(rows);
  const defDate = today() >= trip.from && today() <= trip.to ? today() : trip.from;
  return (
    <div className="pc-record">
      <div className="pc-left">
        <section className="card pc-section">
          <div className="pc-sec-head">
            <h2>출장비 내역</h2>
            <span className="muted small">합계 {won(sum(expenses)) || '₩0'}</span>
          </div>
          <EntryTable kind="expense" rows={expenses} purposes={cfg.categories} purposeLabel="항목" />
          <AddEntry kind="expense" email={email} name={name} purposes={cfg.categories} defDate={defDate} curs={cfg.currencies} fx={fx} />
        </section>
        <section className="card pc-section">
          <div className="pc-sec-head">
            <h2>교통비</h2>
            <span className="muted small">합계 {won(sum(transports)) || '₩0'}</span>
          </div>
          <EntryTable kind="transport" rows={transports} purposes={cfg.categories} />
          <AddEntry kind="transport" email={email} name={name} purposes={cfg.categories} defDate={defDate} curs={cfg.currencies} fx={fx} />
        </section>
        {loading && <p className="muted small">불러오는 중…</p>}
      </div>
      <section className="card pc-account">
        <b className="pc-name">{name}</b>
        <div className="pc-acc-fields">
          <input className="pc-bank locked" readOnly value={acc?.bank ?? ''} placeholder="은행" />
          <input className="pc-acc locked" readOnly value={acc?.account ?? ''} placeholder="계좌번호" />
          <span className="muted small">계좌는 전도금 페이지에 저장한 걸 불러와요 (고치는 건 전도금에서)</span>
        </div>
        <div className="pc-sums">
          <div>
            <span>출장비 내역</span>
            <b>{won(sum(expenses)) || '₩0'}</b>
          </div>
          <div>
            <span>교통비 내역</span>
            <b>{won(sum(transports)) || '₩0'}</b>
          </div>
          <div className="pc-sum-total">
            <span>총 금액</span>
            <b>{won(total) || '₩0'}</b>
          </div>
          <div className="trip-korean">
            {won(total) || '₩0'} = {wonKorean(total)}
          </div>
        </div>
      </section>
    </div>
  );
}

// ===================== 프린트 =====================
function TripPrint({ trip, rows, cats, fx, curs }: { trip: TripDoc; rows: PettyEntry[]; cats: string[]; fx: ReturnType<typeof useFxRates>; curs: string[] }) {
  const [which, setWhich] = useState<'apply' | 'transport' | 'receipt'>('apply');
  // 프린트 금액 통화: 원칙은 원화 · 엔화 등으로 올리는 사람도 있어서 고를 수 있게 (신청서마다 기억)
  const cur = trip.printCur || 'KRW';
  const curList = [...new Set(['KRW', ...curs])];
  /** 내역 한 줄을 고른 통화로: 그 통화로 적은 건 원래 금액 · 아니면 원화를 그날 환율로 나눔 */
  const amt = (e: PettyEntry): number | undefined => {
    if (cur === 'KRW') return e.amount ?? 0;
    if (e.cur === cur && e.curAmount !== undefined) return e.curAmount;
    if (e.amount === undefined) return undefined;
    const r = rateOn(fx, cur, e.date);
    return r ? Math.round((e.amount / r.rate) * 100) / 100 : undefined;
  };
  const noRate = rows.some((e) => amt(e) === undefined);
  const fmtN = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: cur === 'KRW' || cur === 'JPY' ? 0 : 2 });
  const sign = cur === 'KRW' ? '' : (CUR_SIGN[cur] ?? cur).trim();
  /** 금액 칸: 왼쪽에 통화 표시 · 오른쪽에 숫자 */
  const money = (n: number | undefined, blankZero = false) =>
    n === undefined || (blankZero && !n) ? null : (
      <>
        {sign && <span className="ts-cur">{sign}</span>}
        {fmtN(n)}
      </>
    );
  const curPick = (
    <label className="ts-cur-pick">
      <span className="muted small">금액 통화</span>
      <select value={cur} onChange={(e) => save({ printCur: e.target.value === 'KRW' ? undefined : e.target.value })}>
        {curList.map((c) => (
          <option key={c} value={c}>
            {c === 'KRW' ? '₩ 원화 (원칙)' : `${(CUR_SIGN[c] ?? '').trim()} ${c}`}
          </option>
        ))}
      </select>
      {noRate && <span className="warn small">환율이 아직 없는 날이 있어요</span>}
    </label>
  );
  const tItem = tripTransportItem(cats);
  const sheetRows: TripRow[] = trip.rows ?? cats.map((c, i) => ({ id: `d${i}`, item: c, desc: '', count: '1' }));
  const save = (p: Partial<TripDoc>) => void saveTrip({ ...trip, ...p });
  const saveRows = (next: TripRow[]) => save({ rows: next });
  // 실제경비: 그 항목으로 들어간 내역 합 (교통비 칸 내역은 '교통' 항목으로)
  const actual: Record<string, number> = Object.fromEntries(sheetRows.map((r) => [r.id, 0]));
  for (const e of rows) {
    const it = itemOf(sheetRows, e, tItem);
    const r = sheetRows.find((x) => x.item.trim() === it);
    if (r) actual[r.id] += amt(e) ?? 0;
  }
  const totalA = Object.values(actual).reduce((a, b) => a + b, 0);
  const totalE = sheetRows.reduce((a, r) => a + (r.est ?? 0), 0);
  const missing = [...new Set([...cats])].filter((c) => !sheetRows.some((r) => r.item.trim() === c));
  const transports = rows.filter((e) => e.kind === 'transport').sort((a, b) => a.date.localeCompare(b.date));
  const tTotal = transports.reduce((a, e) => a + (amt(e) ?? 0), 0);
  const name = trip.name ?? '';
  return (
    <>
      <div className="seg pc-print-tabs">
        <button className={which === 'apply' ? 'on' : ''} onClick={() => setWhich('apply')}>
          1. 출장신청서
        </button>
        <button className={which === 'transport' ? 'on' : ''} onClick={() => setWhich('transport')}>
          2. 교통비 사용내역서
        </button>
        <button className={which === 'receipt' ? 'on' : ''} onClick={() => setWhich('receipt')}>
          3. 영수증
        </button>
      </div>

      {which === 'apply' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">출장 목적 · 인원수 · 예상경비 · 항공기 이용 · 비고는 눌러서 고쳐요. 실제경비는 기록한 내역을 항목별로 더한 값이에요.</span>
            {curPick}
            <button className="primary" onClick={() => printSheet('ts-apply')}>
              🖨 프린트 / PDF
            </button>
          </div>
          <div className="ps-page ts-page" id="ts-apply">
            <div className="ts-top">
              <h1 className="ps-title ts-title">출 장 신 청 서</h1>
              <table className="ps-appr ts-appr">
                <tbody>
                  <tr>
                    {['담당', '부서장', '임원', '대표이사'].map((h) => (
                      <td key={h} className="ps-appr-h">
                        {h}
                      </td>
                    ))}
                  </tr>
                  <tr>
                    {[0, 1, 2, 3].map((i) => (
                      <td key={i} className="ps-appr-sign" />
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <table className="ps-table ts-table">
              <colgroup>
                <col style={{ width: '17%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '22%' }} />
                <col />
              </colgroup>
              <tbody>
                <tr>
                  <th>부 서</th>
                  <td colSpan={2} className="c">
                    글로벌 사업부
                  </td>
                  <th>출장지역</th>
                  <td className="c">
                    <input className="ps-in c" defaultValue={trip.region} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== trip.region && save({ region: e.target.value.trim() })} />
                  </td>
                </tr>
                <tr>
                  <th>성 명</th>
                  <td colSpan={4} className="c">
                    {name.split('').join(' ')}
                  </td>
                </tr>
                <tr>
                  <th>출장 목적</th>
                  <td colSpan={4} className="c">
                    <input className="ps-in c" placeholder="출장 목적" defaultValue={trip.purpose ?? ''} onBlur={(e) => e.target.value !== (trip.purpose ?? '') && save({ purpose: e.target.value || undefined })} />
                  </td>
                </tr>
                <tr>
                  <th>출장기간</th>
                  <td colSpan={4} className="c">
                    {dots(trip.from)}~{dots(trip.to)}
                  </td>
                </tr>
                <tr className="ts-sub">
                  <th rowSpan={sheetRows.length + 2}>출 장 비</th>
                  <td className="c">구분</td>
                  <td className="c">인원수</td>
                  <td className="c">예상경비</td>
                  <td className="c">실제경비</td>
                </tr>
                {sheetRows.map((r) => (
                  <tr key={r.id}>
                    <td className="c ts-item-cell">
                      <select className="ps-in ps-item c" value={r.item} onChange={(e) => saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, item: e.target.value } : x)))}>
                        {[r.item, ...missing].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                      <button className="ps-del no-print ts-del" title="이 항목 빼기" onClick={() => confirm(`'${r.item}' 항목을 뺄까요?`) && saveRows(sheetRows.filter((x) => x.id !== r.id))}>
                        ✕
                      </button>
                    </td>
                    <td className="c">
                      <input className="ps-in c" defaultValue={r.count ?? ''} onBlur={(e) => e.target.value !== (r.count ?? '') && saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, count: e.target.value || undefined } : x)))} />
                    </td>
                    <td className="r">
                      <input
                        className="ps-in r"
                        inputMode="numeric"
                        defaultValue={r.est !== undefined ? r.est.toLocaleString('ko-KR') : ''}
                        onBlur={(e) => {
                          const n = Number(e.target.value.replace(/[^\d.-]/g, ''));
                          const v = e.target.value.trim() === '' || Number.isNaN(n) ? undefined : n;
                          if (v !== r.est) saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, est: v } : x)));
                        }}
                      />
                    </td>
                    <td className="r">{money(actual[r.id], true)}</td>
                  </tr>
                ))}
                <tr>
                  <td className="c">합계</td>
                  <td className="ts-grey" />
                  <td className="r">{totalE ? totalE.toLocaleString('ko-KR') : '-'}</td>
                  <td className="r">{money(totalA)}</td>
                </tr>
                <tr>
                  <th>항공기 이용</th>
                  <td colSpan={4} className="c">
                    <button className="ts-air" onClick={() => save({ air: true })}>
                      이용({trip.air ? 'V' : ' '})
                    </button>
                    <button className="ts-air" onClick={() => save({ air: false })}>
                      미이용({trip.air === false ? 'V' : ' '})
                    </button>
                  </td>
                </tr>
                <tr>
                  <td colSpan={5} className="ts-note-cell">
                    <textarea className="ps-in ts-note" placeholder="비고" defaultValue={trip.note ?? ''} onBlur={(e) => e.target.value !== (trip.note ?? '') && save({ note: e.target.value || undefined })} />
                  </td>
                </tr>
              </tbody>
            </table>
            {missing.length > 0 && (
              <select className="ps-add-item no-print" value="" onChange={(e) => e.target.value && saveRows([...sheetRows, { id: uid(), item: e.target.value, desc: '', count: '1' }])}>
                <option value="">＋ 항목 추가</option>
                {missing.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {which === 'transport' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">교통비 칸에 기록한 내역을 날짜순으로 모았어요. 이용사유는 기록의 '내역'이에요.</span>
            {curPick}
            <button className="primary" onClick={() => printSheet('ts-transport')}>
              🖨 프린트 / PDF
            </button>
          </div>
          <div className="ps-page" id="ts-transport">
            <div className="ts-tr-title">교통비 사용내역서</div>
            <table className="ps-table ps-tr ts-tr">
              <thead>
                <tr>
                  <th style={{ width: '12%' }}>일 자</th>
                  <th style={{ width: '10%' }}>성명</th>
                  <th style={{ width: '9%' }}>교통수단</th>
                  <th style={{ width: '14%' }}>출발지</th>
                  <th style={{ width: '14%' }}>도착지</th>
                  <th style={{ width: '12%' }}>금 액</th>
                  <th>이용사유</th>
                </tr>
              </thead>
              <tbody>
                {transports.map((e) => (
                  <tr key={e.id}>
                    <td className="c">{dots(e.date)}</td>
                    <td className="c">{e.name}</td>
                    <td className="c">{e.mode === '기타' ? e.modeOther || '기타' : e.mode}</td>
                    <td className="c">{e.from}</td>
                    <td className="c">{e.to}</td>
                    <td className="r">{money(amt(e)) ?? <span className="warn small">환율 없음</span>}</td>
                    <td className="c">{e.content}</td>
                  </tr>
                ))}
                {Array.from({ length: Math.max(0, 20 - transports.length) }, (_, i) => (
                  <tr key={`b${i}`} className="ps-blank">
                    {Array.from({ length: 7 }, (__, j) => (
                      <td key={j} />
                    ))}
                  </tr>
                ))}
                <tr className="ps-sum">
                  <td colSpan={5} className="c">
                    합계
                  </td>
                  <td className="r">{money(tTotal)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {which === 'receipt' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">항목별로 장을 나눠 날짜순으로 붙였어요. 글자는 두 번 누르면 그 자리에서 고칠 수 있어요.</span>
            <button className="primary" onClick={() => printSheet('ps-receipts', true)}>
              🖨 프린트 / PDF (모든 장)
            </button>
          </div>
          <PettyReceipts pk={trip.id} per={{ rcpt: trip.rcpt }} entries={rows} rows={sheetRows} transportItem={tItem} onSaveRcpt={(rcpt) => save({ rcpt })} />
        </>
      )}
    </>
  );
}

// ===================== 관리 (항목 · 통화) =====================
function TripManage() {
  const cfg = useTripCfg();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const save = (next: typeof cfg) => saveTripCfg(next).catch((e) => setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`));
  return (
    <>
      {err && <p className="warn small">{err}</p>}
      <section className="card">
        <h2>출장비 항목</h2>
        <p className="muted small">출장비 내역의 '항목'에서 고르는 것이에요. 출장신청서 '출장비' 표의 구분도 이 안에서 골라요.</p>
        <div className="pc-purposes">
          {cfg.categories.map((c) => (
            <span key={c} className="pc-purpose">
              {c}
              <button className="icon-btn" title="빼기" onClick={() => confirm(`'${c}' 항목을 뺄까요? (이미 쓴 내역은 그대로 남아요)`) && void save({ ...cfg, categories: cfg.categories.filter((x) => x !== c) })}>
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="pc-add" style={{ marginTop: 10 }}>
          <input className="pc-grow" placeholder="새 항목 (예: 추가수화물)" value={text} onChange={(e) => setText(e.target.value)} />
          <button
            className="primary"
            disabled={!text.trim() || cfg.categories.includes(text.trim())}
            onClick={() => {
              void save({ ...cfg, categories: [...cfg.categories, text.trim()] });
              setText('');
            }}
          >
            추가
          </button>
        </div>
      </section>
      <section className="card">
        <h2>금액 통화</h2>
        <p className="muted small">외화는 영수증 날짜의 ECOS 환율로 원화로 바꿔요.</p>
        <div className="pc-purposes">
          {cfg.currencies.map((c) => (
            <span key={c} className="pc-purpose">
              {curLabel(c)} <span className="muted small">{c}</span>
              {c !== 'KRW' && (
                <button className="icon-btn" title="빼기" onClick={() => void save({ ...cfg, currencies: cfg.currencies.filter((x) => x !== c) })}>
                  ✕
                </button>
              )}
            </span>
          ))}
          <select value="" onChange={(e) => e.target.value && void save({ ...cfg, currencies: [...cfg.currencies, e.target.value] })}>
            <option value="">＋ 통화 추가</option>
            {SALES_CURRENCIES.filter((c) => !cfg.currencies.includes(c)).map((c) => (
              <option key={c} value={c}>
                {curLabel(c)} ({c})
              </option>
            ))}
          </select>
        </div>
      </section>
    </>
  );
}
