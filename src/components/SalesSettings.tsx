// 설정: 판매 데이터 — 매장(지점) 평수 입력 + 관리자용 API 연결
import { useEffect, useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { useSales, useSalesStatus, useStoreBranches } from '../lib/sales';
import type { Company } from '../types';

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
  const [adding, setAdding] = useState('');
  const ids = [...new Set([...seen.keys(), ...Object.keys(c.storeAreas ?? {})])].sort();
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
        <label className={`sales-on ${c.salesOn ? 'on' : ''}`} title="켠 업체만 판매 데이터를 가져오고 홈에 보여요">
          <input type="checkbox" checked={!!c.salesOn} onChange={(e) => save('companies', { ...c, salesOn: e.target.checked || undefined })} />
          판매데이터
        </label>
        <span className="muted small area-codes">매장코드 {c.storeCodes!.join(', ')}</span>
      </div>
      {ids.length === 0 && <p className="muted small">아직 판매 데이터에 나온 지점이 없어요.</p>}
      <div className="area-rows">
      {ids.map((sid) => (
        <label key={sid} className="area-row">
          <span>
            {seen.get(sid) || '지점'} <span className="muted small">{sid}</span>
          </span>
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
      <div className="area-add">
        <input value={adding} onChange={(e) => setAdding(e.target.value.replace(/\D/g, ''))} placeholder="지점 코드 직접 추가 (예: 821201)" inputMode="numeric" />
        <button
          className="link"
          disabled={adding.length < 4}
          onClick={() => {
            if (!ids.includes(adding)) save('companies', { ...c, storeAreas: { ...(c.storeAreas ?? {}), [adding]: 0 } });
            setAdding('');
          }}
        >
          + 추가
        </button>
      </div>
    </div>
  );
}

type Cfg = { hasUrl: boolean; masked: string; dateParam: string; endParam: string; dateFormat: string; fields: Record<string, string> };
type Inspect = { date: string; total: number; keys: string[]; sample: Record<string, unknown>[]; fields: Record<string, string | undefined>; sums: { storeId: string; name: string; amount: number; count: number }[]; top?: string };
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
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [url, setUrl] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [insp, setInsp] = useState<Inspect | null>(null);
  const [month, setMonth] = useState('');
  const call = async <T,>(name: string, data?: unknown) => (await httpsCallable(functions, name)(data)).data as T;
  const run = async (label: string, fn: () => Promise<string>) => {
    setBusy(true);
    setMsg(`${label} 중…`);
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(`${label} 실패: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요 — deploy.bat)`);
    } finally {
      setBusy(false);
    }
  };
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
        매일 아침 8시에 최근 3일 판매(계산 건)를 가져와서 지점·일자별로 합쳐요. 키는 ERP 와 같은 키를 써요. 주소는 서버에만 저장되고 이 사이트에서는 다시 볼 수 없어요.
      </p>
      {status && (
        <p className="muted small">
          마지막 가져오기: {status.at ? new Date(status.at).toLocaleString() : '-'} {status.skipped ? `· ${status.skipped}` : `· 계산 ${status.rows ?? 0}건`}
          {status.errors?.length ? ` · 문제 ${status.errors.length}개` : ''}
        </p>
      )}
      {DATA_MODE === 'local' ? (
        <p className="muted small">로컬 테스트 모드에서는 예시 판매 데이터만 보여요.</p>
      ) : !cfg ? (
        <button onClick={load} disabled={busy}>
          설정 열기
        </button>
      ) : (
        <div className="sales-api">
          <label className="row-field">
            <span>API 주소</span>
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={cfg.hasUrl ? `저장됨: ${cfg.masked} (바꿀 때만 입력)` : 'https://…/getsalesdata.asp'} />
          </label>
          <div className="row-fields">
            <label className="row-field">
              <span>날짜 파라미터</span>
              <input value={cfg.dateParam} onChange={(e) => set({ dateParam: e.target.value })} placeholder="SALE_DATE" />
            </label>
            <label className="row-field">
              <span>끝 날짜 파라미터 (기간 API만)</span>
              <input value={cfg.endParam} onChange={(e) => set({ endParam: e.target.value })} placeholder="비우면 하루씩" />
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
          <details>
            <summary className="small">응답 칸 이름 (비우면 자동으로 찾아요)</summary>
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
                  await call('saveSalesConfig', { url: url || undefined, dateParam: cfg.dateParam, endParam: cfg.endParam, dateFormat: cfg.dateFormat, fields: cfg.fields });
                  setUrl('');
                  setCfg(await call<Cfg>('salesConfig'));
                  return '저장했어요 ✓ 아래 [응답 확인]으로 칸 이름이 맞는지 봐 주세요';
                })
              }
            >
              저장
            </button>
            <button disabled={busy || !cfg.hasUrl} onClick={() => run('응답 확인', async () => (setInsp(await call<Inspect>('inspectSalesApi', {})), ''))}>
              응답 확인 (어제)
            </button>
            <button disabled={busy || !cfg.hasUrl} onClick={() => run('가져오기', async () => syncMsg(await call('syncSalesNow', { days: 7 })))}>
              최근 7일 가져오기
            </button>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            <button disabled={busy || !cfg.hasUrl || !month} onClick={() => run('가져오기', async () => syncMsg(await call('syncSalesNow', { month })))}>
              이 달 통째로 가져오기
            </button>
          </div>
        </div>
      )}
      {msg && <pre className="sync-result">{msg}</pre>}
      {insp && (
        <div className="insp">
          <p className="small">
            {insp.date} · 계산 {insp.total}건 · 찾은 칸: {FIELD_LABEL.map(([k, l]) => `${l.split(' ')[0]}=${insp.fields[k] ?? '없음'}`).join(' · ')}
          </p>
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
