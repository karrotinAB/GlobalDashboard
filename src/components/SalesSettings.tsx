// 설정: 판매 데이터 — 매장(지점) 평수 입력 + 관리자용 API 연결
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { doc, onSnapshot } from 'firebase/firestore';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { guessCurrency, SALES_CURRENCIES, useSales, useSalesStatus, useStoreBranches } from '../lib/sales';
import type { Company } from '../types';

/** 판매 API 지점 약자처럼 생겼는지 (서버 규칙과 같게) */
const looksAbbr = (a?: string) => /^[A-Za-z0-9][A-Za-z0-9 ._\-&]{0,15}$/.test((a ?? '').trim());

/** 지점별 평수 (판매 데이터에 나온 지점 + 직접 추가) */
export function StoreAreaSection() {
  const { companies } = useLookups();
  const own = companies.filter((c) => !c.team && c.storeCodes?.length);
  const allCodes = own.flatMap((c) => c.storeCodes ?? []);
  const { months } = useSales(allCodes);
  // 지점 목록·이름: ERP 거래처 정보(BRANCH_NAME). 서버가 7일 보관하니 들어올 때마다 불러도 괜찮음
  const branchNames = useStoreBranches(allCodes);
  const [loading, setLoading] = useState<'' | 'busy' | string>('');
  const codesSig = [...new Set(allCodes)].sort().join(',');
  const loadBranches = (refresh = false) => {
    if (DATA_MODE === 'local' || !codesSig) return;
    setLoading('busy');
    httpsCallable(functions, 'storeBranches', { timeout: 300000 })({ codes: codesSig.split(','), refresh })
      .then(() => setLoading(''))
      .catch((e) => setLoading(`지점 목록을 못 불러왔어요: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요 — deploy.bat)`));
  };
  useEffect(() => {
    loadBranches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [codesSig]);
  if (!own.length) return null;
  return (
    <section className="card">
      <h2>📈 매장 평수</h2>
      <p className="muted small">
        <b>판매데이터</b>를 켠 업체만 판매 데이터를 가져오고 홈에 보여요. 지점별 평수를 넣으면 홈 &gt; 업체별 판매 데이터에서 <b>주차별 평당 금액</b>이 회색 선으로 같이 보여요. 지점은 판매 데이터가 들어오면 자동으로 나타나요
        지점 목록과 이름은 ERP 거래처 정보에서 매장코드 4자리로 시작하는 지점을 자동으로 불러와요 (없으면 지점 코드로 직접 추가).
        {DATA_MODE !== 'local' && (
          <>
            {' '}
            <button className="link" disabled={loading === 'busy'} onClick={() => loadBranches(true)}>
              {loading === 'busy' ? '지점 불러오는 중…' : '↻ 지점 다시 불러오기'}
            </button>
          </>
        )}
      </p>
      {loading && loading !== 'busy' && <p className="muted small">{loading}</p>}
      <div className="area-list">
        {own.map((c) => {
          const seen = new Map<string, string>();
          for (const [sid, name] of Object.entries(branchNames)) if ((c.storeCodes ?? []).some((code) => sid.startsWith(code))) seen.set(sid, name);
          for (const m of months) if ((c.storeCodes ?? []).includes(m.code)) for (const [sid, b] of Object.entries(m.branches)) seen.set(sid, seen.get(sid) || b.name || '');
          return <CompanyAreas key={c.id} c={c} seen={seen} />;
        })}
      </div>
    </section>
  );
}

function CompanyAreas({ c, seen }: { c: Company; seen: Map<string, string> }) {
  const { save } = useStore();
  const [adding, setAdding] = useState<string | null>(null); // 지점 직접 추가 (누르면 입력칸)
  const [addArea, setAddArea] = useState('');
  const ids = [...new Set([...seen.keys(), ...Object.keys(c.storeAreas ?? {})])].sort();
  const [editAbbr, setEditAbbr] = useState<string | null>(null);
  const setAbbr = (sid: string, v: string) => {
    const a = v.trim().toUpperCase();
    const next = { ...(c.storeAbbr ?? {}) };
    if (a) next[sid] = a;
    else delete next[sid];
    if (JSON.stringify(next) !== JSON.stringify(c.storeAbbr ?? {})) save('companies', { ...c, storeAbbr: Object.keys(next).length ? next : undefined });
  };
  const setArea = (sid: string, v: string) => {
    const n = Number(v.replace(/[^\d.]/g, ''));
    const next = { ...(c.storeAreas ?? {}) };
    if (n > 0) next[sid] = Math.round(n * 10) / 10;
    else delete next[sid];
    if (JSON.stringify(next) !== JSON.stringify(c.storeAreas ?? {})) save('companies', { ...c, storeAreas: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="area-co">
      <div className="area-co-head">
        <span className="dot" style={{ background: c.color }} />
        <b>{c.name}</b>
        <span className="co-toggles">
        <label className={`sales-on royalty ${c.royalty ? 'on' : ''}`} title="로열티 매장: 매달 판매 합계의 5% 를 받아요 (홈 > 수출매출 ③). 판매 데이터도 같이 수집돼요">
          <input type="checkbox" checked={!!c.royalty} onChange={(e) => save('companies', { ...c, royalty: e.target.checked || undefined, salesOn: e.target.checked ? true : c.salesOn })} />
          로열티
        </label>
        <label className={`sales-on ${c.salesOn ? 'on' : ''}`} title="켠 업체만 판매 데이터를 가져오고 홈에 보여요">
          <input type="checkbox" checked={!!c.salesOn} onChange={(e) => save('companies', { ...c, salesOn: e.target.checked || undefined })} />
          판매데이터
        </label>
        </span>
        <span className="muted small area-codes">
          매장코드 {c.storeCodes!.join(', ')}
          {(c.salesOn || c.royalty) && (
            <label className={`cur-pick ${c.royalty && !c.salesCurrency ? 'need' : ''}`} title="판매 데이터 금액의 통화 — 로열티를 판매일 ECOS 환율로 원화·달러로 바꿀 때 써요">
              {' · '}판매 통화{' '}
              <select value={c.salesCurrency ?? ''} onChange={(e) => save('companies', { ...c, salesCurrency: e.target.value || undefined })}>
                <option value="">{guessCurrency(c.country) ? `선택 (추천 ${guessCurrency(c.country)})` : '선택'}</option>
                {SALES_CURRENCIES.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </label>
          )}
        </span>
      </div>
      {ids.length === 0 && <p className="muted small">아직 판매 데이터에 나온 지점이 없어요.</p>}
      <div className="area-rows">
      {ids.map((sid) => (
        <label key={sid} className="area-row">
          <span>
            {/* 판매 데이터를 불러올 때 쓰는 약자: 직접 넣은 게 있으면 그것 (자동 이름은 작게) */}
            <b>{seen.get(sid) || c.storeAbbr?.[sid] || '지점'}</b> <span className="muted small">{sid}</span>
            {c.storeAbbr?.[sid] && seen.get(sid) && seen.get(sid) !== c.storeAbbr[sid] && <span className="muted small"> (원래 {c.storeAbbr[sid]})</span>}
          </span>
          {c.storeAbbr?.[sid] || editAbbr === sid ? (
            // 약자 직접: 고른 지점만 (✎ 를 눌렀거나 이미 넣은 것)
            <input
              className={`abbr-in ${!c.storeAbbr?.[sid] && !looksAbbr(seen.get(sid)) ? 'need' : ''}`}
              key={`a${c.storeAbbr?.[sid] ?? ''}`}
              autoFocus={editAbbr === sid}
              defaultValue={c.storeAbbr?.[sid] ?? ''}
              placeholder={looksAbbr(seen.get(sid)) ? seen.get(sid) : '약자 필요'}
              title="판매 데이터를 불러올 때 쓰는 지점 약자 (비우면 자동으로 불러온 이름)"
              onBlur={(e) => {
                setAbbr(sid, e.target.value);
                setEditAbbr(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <button
              type="button"
              className={`abbr-edit ${looksAbbr(seen.get(sid)) ? '' : 'warn'}`}
              title={looksAbbr(seen.get(sid)) ? '약자 고치기 (판매 데이터를 불러올 때 쓰는 이름)' : '이 지점 이름은 약자가 아니라 판매 데이터를 못 불러와요 — 눌러서 약자를 넣어 주세요'}
              onClick={(e) => (e.preventDefault(), setEditAbbr(sid))}
            >
              {looksAbbr(seen.get(sid)) ? '✎ 약자' : '⚠ 약자'}
            </button>
          )}
          <input
            key={c.storeAreas?.[sid] ?? ''}
            defaultValue={c.storeAreas?.[sid] || ''}
            inputMode="decimal"
            placeholder="평수"
            onBlur={(e) => setArea(sid, e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <span className="muted small">평</span>
        </label>
      ))}
      </div>
      {adding === null ? (
        <button className="link area-add-btn" onClick={() => setAdding('')}>
          + 추가
        </button>
      ) : (
        <div className="area-add">
          <input autoFocus value={adding} onChange={(e) => setAdding(e.target.value.replace(/\D/g, ''))} placeholder="지점 코드 (예: 821201)" inputMode="numeric" />
          <input value={addArea} onChange={(e) => setAddArea(e.target.value.replace(/[^\d.]/g, ''))} placeholder="평수" inputMode="decimal" className="area-add-pyeong" />
          <button
            className="primary small"
            disabled={adding.length < 4}
            onClick={() => {
              const n = Number(addArea);
              save('companies', { ...c, storeAreas: { ...(c.storeAreas ?? {}), [adding]: n > 0 ? Math.round(n * 10) / 10 : 0 } });
              setAdding(null);
              setAddArea('');
            }}
          >
            추가
          </button>
          <button className="link" onClick={() => (setAdding(null), setAddArea(''))}>
            취소
          </button>
        </div>
      )}
    </div>
  );
}

type Cfg = { hasEcos?: boolean; hasUrl: boolean; masked: string; dateParam: string; endParam: string; storeParam?: string; dateFormat: string; fields: Record<string, string> };
type Inspect = { api?: string; attempts?: string[]; date: string; called?: string; total: number; keys: string[]; sample: Record<string, unknown>[]; fields: Record<string, string | undefined>; sums: { storeId: string; name: string; amount: number; count: number }[]; top?: string };
const FIELD_LABEL: [string, string][] = [
  ['date', '날짜'],
  ['amount', '금액'],
  ['store', '지점 코드'],
  ['storeCode', '매장코드 4자리 (없으면 지점 코드 앞 4자리)'],
  ['name', '지점 이름'],
];

/** 관리자: 판매 데이터 API 주소·칸 이름, 지금 가져오기, 응답 확인 */
export function SalesApiAdmin() {
  const status = useSalesStatus();
  const backfill = useBackfillState();
  const salesBf = useDocState<{ done?: boolean; end?: string; next?: string; last?: { month: string; rows: number; errors: number; skipped?: string }[] }>('salesBackfill', 'state');
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [url, setUrl] = useState('');
  const [ecos, setEcos] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [insp, setInsp] = useState<Inspect | null>(null);
  const [month, setMonth] = useState('');
  const { companies } = useLookups();
  const salesCos = companies.filter((c) => c.salesOn && c.storeCodes?.length);
  const [pickCo, setPickCo] = useState('');
  const pickCodes = pickCo ? salesCos.find((c) => c.id === pickCo)?.storeCodes : undefined;
  const [pickBranch, setPickBranch] = useState('');
  const [periodMode, setPeriodMode] = useState<'recent' | 'month' | 'range'>('recent');
  const [rFrom, setRFrom] = useState('');
  const [rTo, setRTo] = useState('');
  const pickedNames = useStoreBranches(pickCodes ?? []);
  const pickedCo = salesCos.find((c) => c.id === pickCo);
  const branchList = Object.entries({ ...Object.fromEntries(Object.keys(pickedCo?.storeAreas ?? {}).map((k) => [k, ''])), ...pickedNames }).sort(([a], [b]) => a.localeCompare(b));
  const thisMonthIso = () => new Date().toISOString().slice(0, 7);
  // 오래 걸릴 수 있어서 9분까지 기다림 (서버 함수 제한과 같게)
  const call = async <T,>(name: string, data?: unknown) => (await httpsCallable(functions, name, { timeout: 540000 })(data)).data as T;
  const [running, setRunning] = useState<{ label: string; at: number } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [running]);
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setRunning({ label, at: Date.now() });
    setMsg('');
    try {
      const out = await fn();
      setMsg(out || `${label} 끝 ✓`);
    } catch (e) {
      setMsg(`${label} 실패: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요 — deploy.bat)`);
    } finally {
      setBusy(false);
      setRunning(null);
    }
  };
  void tick;
  const busyBox = running && (
    <div className="busy-box" role="status">
      <span className="spinner" /> <b>{running.label} 중…</b> {Math.floor((Date.now() - running.at) / 1000)}초 지남
      <span className="muted small"> · 처음엔 지점 목록도 같이 찾느라 1~3분 걸릴 수 있어요. 창을 닫지 말고 기다려 주세요.</span>
    </div>
  );
  useEffect(() => {
    if (DATA_MODE !== 'local') call<Cfg>('salesConfig').then(setCfg).catch(() => setMsg('설정을 못 불러왔어요 (서버 함수를 올렸는지 확인해 주세요 — deploy.bat)'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const load = () => run('불러오기', async () => {
    setCfg(await call<Cfg>('salesConfig'));
    return '';
  });
  const set = (p: Partial<Cfg>) => setCfg((c) => (c ? { ...c, ...p } : c));
  const syncMsg = (r: { rows?: number; docs?: number; errors?: string[]; skipped?: string }) =>
    r.skipped ? r.skipped : `가져왔어요 ✓ 계산 ${r.rows ?? 0}건 → ${r.docs ?? 0}개 매장·월 갱신${r.errors?.length ? `\n문제: ${r.errors.join('\n')}` : ''}`;

  return (
    <section className="card">
      <h2>
        판매 데이터 API <span className="tag gray">관리자만 보이는 칸</span>
      </h2>
      <p className="muted small">
        매주 월요일 아침 7시에 지난 달 + 이번 달 판매를 <b>판매데이터 켠 업체의 지점마다</b> 가져와서 일자별로 합쳐요. 키는 ERP 와 같은 키를 써요. 주소는 서버에만 저장되고 이 사이트에서는 다시 볼 수 없어요.
      </p>
      {status && (
        <p className="muted small">
          마지막 가져오기: {status.at ? new Date(status.at).toLocaleString() : '-'} {status.skipped ? `· ${status.skipped}` : `· 계산 ${status.rows ?? 0}건`}
        </p>
      )}
      {!!status?.errors?.length && (
        <details className="status-errors" open>
          <summary className="small">문제 {status.errors.length}개 보기</summary>
          <ul className="small">
            {status.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      {DATA_MODE === 'local' ? (
        <p className="muted small">로컬 테스트 모드에서는 예시 판매 데이터만 보여요.</p>
      ) : !cfg ? (
        <button onClick={load} disabled={busy}>
          설정 열기
        </button>
      ) : (
        <div className="sales-api">
          <div className="sa-step">
            <h3>판매 데이터 가져오기</h3>
            <p className="muted small" style={{ margin: 0 }}>
              매주 월요일 아침 7시에 지난 달 + 이번 달이 자동으로 들어와요. 그 사이에 빠졌거나 다시 받고 싶을 때만 여기서 골라서 가져오세요 (필요한 것만 골라야 API 를 덜 불러요).
            </p>
            <div className="sa-pick">
              <label className="row-field">
                <span>업체</span>
                <select value={pickCo} onChange={(e) => (setPickCo(e.target.value), setPickBranch(''))}>
                  <option value="">판매데이터 켠 업체 전부</option>
                  {salesCos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({(c.storeCodes ?? []).join(', ')})
                    </option>
                  ))}
                </select>
              </label>
              <label className="row-field">
                <span>지점</span>
                <select value={pickBranch} disabled={!pickCo} onChange={(e) => setPickBranch(e.target.value)}>
                  <option value="">{pickCo ? '이 업체 지점 전부' : '(업체를 먼저 골라 주세요)'}</option>
                  {branchList.map(([sid, name]) => (
                    <option key={sid} value={sid}>
                      {name || '지점'} {sid}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row-field">
                <span>기간</span>
                <select
                  value={periodMode}
                  onChange={(e) => {
                    const v = e.target.value as 'recent' | 'month' | 'range';
                    setPeriodMode(v);
                    setMonth(v === 'month' ? thisMonthIso() : '');
                  }}
                >
                  <option value="recent">최근 7일</option>
                  <option value="month">한 달 통째로</option>
                  <option value="range">기간 직접 (최대 93일)</option>
                </select>
              </label>
              {periodMode === 'month' && (
                <label className="row-field">
                  <span>달</span>
                  <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
                </label>
              )}
              {periodMode === 'range' && (
                <label className="row-field">
                  <span>시작 ~ 끝</span>
                  <span className="range-in">
                    <input type="date" value={rFrom} max={rTo || undefined} onChange={(e) => setRFrom(e.target.value)} />
                    ~
                    <input type="date" value={rTo} min={rFrom || undefined} onChange={(e) => setRTo(e.target.value)} />
                  </span>
                </label>
              )}
              <button
                className="primary sa-go"
                disabled={busy || !cfg.hasUrl || (periodMode === 'range' && (!rFrom || !rTo))}
                title={cfg.hasUrl ? '' : '아래 연결 설정에서 API 주소를 먼저 저장해 주세요'}
                onClick={() =>
                  run('가져오기', async () =>
                    syncMsg(
                      await call('syncSalesNow', {
                        ...(periodMode === 'range' ? { from: rFrom, to: rTo } : periodMode === 'month' ? { month } : { days: 7 }),
                        codes: pickCodes,
                        branches: pickBranch ? [pickBranch] : undefined,
                      }),
                    ),
                  )
                }
              >
                가져오기
              </button>
              <button
                disabled={busy || !cfg.hasUrl || (periodMode === 'range' && (!rFrom || !rTo))}
                title="고른 업체·지점·기간으로 API 가 뭘 돌려주는지 보기만 해요 (저장 안 함)"
                onClick={() =>
                  run('확인', async () => {
                    const m = periodMode === 'month' && month ? month : '';
                    const last = m ? new Date(Number(m.slice(0, 4)), Number(m.slice(5)), 0).getDate() : 0;
                    const range = periodMode === 'range' ? { from: rFrom, to: rTo } : m ? { from: `${m}-01`, to: `${m}-${String(Math.min(last, 7)).padStart(2, '0')}` } : {};
                    setInsp(await call<Inspect>('inspectSalesApi', { code: pickCodes?.[0], sid: pickBranch || undefined, ...range }));
                    return '';
                  })
                }
              >
                확인만 (저장 안 함)
              </button>
            </div>
          </div>

          <details className="sa-step" open={!cfg.hasUrl}>
            <summary>
              <b>연결 설정</b> <span className="muted small">처음 한 번만 · {cfg.hasUrl ? 'API 주소 저장됨 ✓' : 'API 주소를 넣어 주세요'}{cfg.hasEcos ? ' · ECOS 인증키 저장됨 ✓' : ''}</span>
            </summary>
            <label className="row-field">
              <span>판매 API 주소</span>
              <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={cfg.hasUrl ? `저장됨: ${cfg.masked} (바꿀 때만 입력)` : 'https://ex.artbox.kr/api/getExportSalesData.asp'} />
            </label>
            <label className="row-field">
              <span>ECOS 인증키 (한국은행 환율 — 로열티·원화 환산)</span>
              <input type="password" autoComplete="off" value={ecos} onChange={(e) => setEcos(e.target.value)} placeholder={cfg.hasEcos ? '저장됨 (바꿀 때만 입력)' : 'ecos.bok.or.kr 에서 받은 인증키'} />
            </label>
            <details>
              <summary className="small">고급 (보통은 안 건드려도 돼요)</summary>
              <div className="row-fields">
                <label className="row-field">
                  <span>매장코드 파라미터</span>
                  <input value={cfg.storeParam ?? ''} onChange={(e) => set({ storeParam: e.target.value })} placeholder="STORE_CODE" />
                </label>
                <label className="row-field">
                  <span>시작 날짜 파라미터</span>
                  <input value={cfg.dateParam} onChange={(e) => set({ dateParam: e.target.value })} placeholder="DATE_FROM" />
                </label>
                <label className="row-field">
                  <span>끝 날짜 파라미터</span>
                  <input value={cfg.endParam} onChange={(e) => set({ endParam: e.target.value })} placeholder="DATE_TO" />
                </label>
                <label className="row-field">
                  <span>날짜 모양</span>
                  <select value={cfg.dateFormat} onChange={(e) => set({ dateFormat: e.target.value })}>
                    <option value="dot">2026.11.12</option>
                    <option value="dash">2026-11-12</option>
                    <option value="compact">20261112</option>
                  </select>
                </label>
              </div>
              <p className="muted small">응답 칸 이름 — 비우면 자동으로 찾아요 (응답 JSON 의 칸 이름, 매장코드 숫자 아님)</p>
              <div className="row-fields">
                {FIELD_LABEL.map(([k, label]) => (
                  <label key={k} className="row-field">
                    <span>{label}</span>
                    <input value={cfg.fields[k] ?? ''} onChange={(e) => set({ fields: { ...cfg.fields, [k]: e.target.value } })} placeholder="자동" />
                  </label>
                ))}
              </div>
            </details>
            <div className="btn-row">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run('저장', async () => {
                    await call('saveSalesConfig', { ecosKey: ecos || undefined, url: url || undefined, dateParam: cfg.dateParam, endParam: cfg.endParam, storeParam: cfg.storeParam, dateFormat: cfg.dateFormat, fields: cfg.fields });
                    setUrl('');
                    setEcos('');
                    setCfg(await call<Cfg>('salesConfig'));
                    return '저장했어요 ✓ [연결 확인]으로 잘 오는지 봐 주세요';
                  })
                }
              >
                저장
              </button>
              <button
                disabled={busy || !cfg.hasUrl}
                title="아무것도 안 넣어도 돼요 — 판매데이터 켠 첫 업체로 최근 7일을 불러서 보여주기만 해요 (저장 안 함)"
                onClick={() => run('연결 확인', async () => (setInsp(await call<Inspect>('inspectSalesApi', {})), ''))}
              >
                연결 확인 (저장 안 함)
              </button>
              <button
                disabled={busy || !cfg.hasEcos}
                title="이번 달과 지난 달 ECOS 환율을 가져와요 — 매주 판매 데이터와 같이 자동으로도 가져와요"
                onClick={() =>
                  run('환율 가져오기', async () => {
                    const r = await call<{ saved: number; errors?: string[] }>('syncFxNow', month ? { month } : {});
                    return `환율 가져왔어요 ✓ ${r.saved}개 (통화·달)${r.errors?.length ? `\n문제: ${r.errors.join('\n')}` : ''}`;
                  })
                }
              >
                환율 가져오기
              </button>
              <button
                disabled={busy || !cfg.hasEcos}
                title="올해 1월부터 이번 달까지 ECOS 환율을 한 번에 가져와요 (판매 통화 + 달러)"
                onClick={() =>
                  run('환율 가져오기 (올해 전체)', async () => {
                    const r = await call<{ saved: number; errors?: string[] }>('syncFxNow', { year: true });
                    return `환율 가져왔어요 ✓ ${r.saved}개 (통화·달)${r.errors?.length ? `\n문제: ${r.errors.join('\n')}` : ''}`;
                  })
                }
              >
                환율 가져오기 (올해 전체)
              </button>
            </div>
          </details>
        </div>
      )}
      {DATA_MODE !== 'local' && (
        <div className="backfill-box">
          <b>판매 데이터 자동 가져오기 (매주 월요일 7시)</b>
          <span className="muted small"> 매주 월요일 아침 7시 자동: 처음 한 번은 2026년 1월부터 이번 달까지, 그 뒤로는 매주 지난 달 + 이번 달만 다시 가져와요 (한 달 치를 한꺼번에 올리는 매장도 잡혀요). 빠진 곳만 급하게 받고 싶으면 위 '판매 데이터 가져오기'에서 업체·지점·기간을 골라 주세요.</span>
          <div className="small">
            {!salesBf
              ? '아직 시작 전'
              : salesBf.done
                ? `✓ 다 채웠어요 (${salesBf.end ?? ''}까지)`
                : `진행 중: ${salesBf.next ?? '2026-01'} 부터 남음`}
            {salesBf?.last?.length ? ` · 최근: ${salesBf.last.map((x) => `${x.month} ${x.rows}건${x.errors ? ` (문제 ${x.errors})` : ''}${x.skipped ? ` (${x.skipped})` : ''}`).join(', ')}` : ''}
          </div>

        </div>
      )}
      {DATA_MODE !== 'local' && (
        <div className="backfill-box">
          <b>지난 수출 데이터 채우기 (2026년 1월 ~ 오늘)</b>
          <span className="muted small">
            {' '}
            ERP 에서 매장코드별 지난 출고를 한 번 가져와요 (주문 관리에 없는 것). 새벽 4시부터 (4:00~5:50) 10분마다 자동으로 이어서 하고, 다 채우면 멈춰요.
          </span>
          <div className="small">
            {!backfill
              ? '아직 시작 전'
              : backfill.backfillDone
                ? `✓ 다 채웠어요 (${backfill.last?.end ?? ''}까지 · 주문 ${backfill.last?.orders ?? 0}건)`
                : `진행 중: ${backfill.cursor ?? '2026-01-01'} 까지 날짜 확인 · 주문 ${backfill.last?.orders ?? 0}건 · 출고 확인 남음 ${backfill.last?.waiting ?? '?'}건`}
            {backfill?.last?.errors?.length ? ` · 문제: ${backfill.last.errors.slice(0, 3).join(' / ')}` : ''}
          </div>
          <button
            disabled={busy || !backfill?.backfillDone}
            title="ERP 에서 채운 지난 주문을 각 조 주문 관리에 넣어요 (이미 있는 주문번호는 건너뜀, 다 출고된 건은 완료로)"
            onClick={() =>
              run('주문 관리에 넣기', async () => {
                const r = await call<{ created: number; skipped: number; perTeam: Record<string, number> }>('importExportOrders');
                const per = Object.entries(r.perTeam ?? {}).map(([t, n]) => `${t}조 ${n}건`).join(', ');
                return `주문 관리에 넣었어요 ✓ ${r.created}건${per ? ` (${per})` : ''} · 이미 있어서 건너뜀 ${r.skipped}건`;
              })
            }
          >
            📦 주문 관리에 넣기
          </button>
          <button disabled={busy || !!backfill?.backfillDone} onClick={() => run('지난 수출 데이터 채우기', async () => {
            const r = await call<{ skipped?: string; scanned?: number; found?: number; checked?: number; backfillDone?: boolean }>('exportBackfillNow');
            return r.skipped ?? `이번에 날짜 ${r.scanned}일 확인 · 주문 ${r.found}건 · 출고 ${r.checked}건 확인${r.backfillDone ? ' · 다 채웠어요 ✓' : ' · 아직 남았어요 (한 번 더 누르거나 새벽 4시 자동)'}`;
          })}>
            지금 채우기
          </button>
        </div>
      )}
      {busyBox}
      {msg && <pre className="sync-result">{msg}</pre>}
      {insp && (
        <div className="insp">
          <p className="small">
            {insp.date}{insp.called ? ` (${insp.called})` : ''} · 계산 {insp.total}건 · 찾은 칸: {FIELD_LABEL.map(([k, l]) => `${l.split(' ')[0]}=${insp.fields[k] ?? '없음'}`).join(' · ')}
          </p>
          {insp.api && <p className="small">불러온 API: <b>{insp.api}</b></p>}
          {!!insp.attempts?.length && (
            <ul className="small insp-tries">
              {insp.attempts.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {insp.keys.length > 0 && <p className="muted small">응답 칸: {insp.keys.join(', ')}</p>}
          {insp.sums.length > 0 && (
            <table className="mini-table">
              <thead>
                <tr>
                  <th>지점</th>
                  <th>이름</th>
                  <th>건수</th>
                  <th>합계</th>
                </tr>
              </thead>
              <tbody>
                {insp.sums.map((s) => (
                  <tr key={s.storeId}>
                    <td>{s.storeId}</td>
                    <td>{s.name}</td>
                    <td className="r">{s.count}</td>
                    <td className="r">{Math.round(s.amount).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {insp.top && <pre className="sync-result">{insp.top}</pre>}
          <details>
            <summary className="small">원본 5줄</summary>
            <pre className="sync-result">{JSON.stringify(insp.sample, null, 2)}</pre>
          </details>
        </div>
      )}
    </section>
  );
}

type BackfillState = { backfillDone?: boolean; cursor?: string; last?: { end?: string; orders?: number; waiting?: number; errors?: string[] } };
function useBackfillState() {
  const [s, setS] = useState<BackfillState | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, 'exportSync', 'state'),
      (d) => setS((d.data() as BackfillState) ?? null),
      () => {},
    );
  }, []);
  return s;
}

function useDocState<T>(col: string, id: string) {
  const [s, setS] = useState<T | null>(null);
  useEffect(() => {
    if (DATA_MODE === 'local') return;
    return onSnapshot(
      doc(db, col, id),
      (d) => setS((d.data() as T) ?? null),
      () => {},
    );
  }, [col, id]);
  return s;
}
