// 전도금: [전도금 기록하기] (모든 사용자) · [관리] (전도금 담당자 · 관리자)
//   한 달을 1~15일 / 16일~말일 두 번으로 나눠서, 그 기간에 쓴 전도금 내역과 교통비를 기록
import { useEffect, useMemo, useState } from 'react';
import { useAccess } from '../components/AuthGate';
import { usePeople } from '../components/AddressBook';
import { today, uid } from '../lib/date';
import {
  DEFAULT_PURPOSES,
  TRANSPORTS,
  deletePettyEntry,
  periodKey,
  periodLabel,
  periodOf,
  periodRange,
  savePettyAccount,
  savePettyCfg,
  savePettyEntry,
  shiftPeriod,
  uploadReceipt,
  usePettyAccount,
  usePettyCfg,
  usePettyEntries,
  won,
  type PettyEntry,
  type PettyFile,
} from '../lib/petty';

const toNum = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
};
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export default function Petty() {
  const access = useAccess();
  const email = access.email || 'local';
  const isAdmin = (access.realRole ?? access.role) === 'admin' || access.role === null;
  const cfg = usePettyCfg();
  const isManager = !!cfg?.managers.includes(email);
  const [tab, setTab] = useState<'mine' | 'manage'>('mine');
  const canManage = isManager || isAdmin;
  return (
    <div className="page">
      <div className="page-head">
        <h1>전도금</h1>
        <p className="muted">한 달을 1~15일 / 16일~말일 두 번으로 나눠 기록해요. 매달 15일이 지나면 다음 기간으로 넘어가요.</p>
      </div>
      {canManage && (
        <div className="seg pc-tabs">
          <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>
            ✍️ 전도금 기록하기
          </button>
          <button className={tab === 'manage' ? 'on' : ''} onClick={() => setTab('manage')}>
            🗂 관리
          </button>
        </div>
      )}
      {tab === 'manage' && canManage ? <Manage isAdmin={isAdmin} isManager={isManager} /> : <Record email={email} />}
    </div>
  );
}

/** 이름 석 자 (계정 이름 → 주소록 이름) */
function useFullName(email: string) {
  const { accountName } = useAccess();
  const { roles, contacts } = usePeople();
  return accountName || contacts[email]?.name || roles?.find((r) => r.email === email)?.name || (email.includes('@') ? email.split('@')[0] : '');
}

// ===================== 전도금 기록하기 =====================
function Record({ email }: { email: string }) {
  const name = useFullName(email);
  const cfg = usePettyCfg();
  const purposes = cfg?.purposes?.length ? cfg.purposes : DEFAULT_PURPOSES;
  const all = usePettyEntries(email);
  const [period, setPeriod] = useState(() => periodOf(today()));
  const pk = periodKey(period);
  const rows = useMemo(() => (all ?? []).filter((e) => periodKey(periodOf(e.date)) === pk), [all, pk]);
  const expenses = rows.filter((e) => e.kind === 'expense');
  const transports = rows.filter((e) => e.kind === 'transport');
  const sum = (l: PettyEntry[]) => l.reduce((a, e) => a + (e.amount ?? 0), 0);
  const isNow = pk === periodKey(periodOf(today()));
  // 새 줄 기본 날짜: 지금 기간이면 오늘, 아니면 그 기간 첫날
  const defDate = isNow ? today() : `${period.ym}-${period.half === 1 ? '01' : '16'}`;
  return (
    <>
      <div className="pc-period">
        <button onClick={() => setPeriod((p) => shiftPeriod(p, -1))} aria-label="이전 기간">
          ◀
        </button>
        <div className="pc-period-label">
          <b>{periodLabel(period)}</b>
          <span className="muted small">{periodRange(period)}</span>
          {isNow ? <span className="tag">지금</span> : (
            <button className="link small" onClick={() => setPeriod(periodOf(today()))}>
              지금 기간으로
            </button>
          )}
        </div>
        <button onClick={() => setPeriod((p) => shiftPeriod(p, 1))} aria-label="다음 기간">
          ▶
        </button>
      </div>

      <AccountCard email={email} name={name} total={sum(rows)} />

      <section className="card pc-section">
        <div className="pc-sec-head">
          <h2>전도금 내역</h2>
          <span className="muted small">합계 {won(sum(expenses)) || '₩0'}</span>
        </div>
        <EntryTable kind="expense" rows={expenses} purposes={purposes} />
        <AddEntry kind="expense" email={email} name={name} purposes={purposes} defDate={defDate} />

        <hr className="pc-line" />

        <div className="pc-sec-head">
          <h2>교통비</h2>
          <span className="muted small">합계 {won(sum(transports)) || '₩0'}</span>
        </div>
        <EntryTable kind="transport" rows={transports} purposes={purposes} />
        <AddEntry kind="transport" email={email} name={name} purposes={purposes} defDate={defDate} />
      </section>
      {all === null && <p className="muted small">불러오는 중…</p>}
    </>
  );
}

function AccountCard({ email, name, total }: { email: string; name: string; total: number }) {
  const acc = usePettyAccount(email);
  const [bank, setBank] = useState('');
  const [account, setAccount] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!acc) return;
    setBank(acc.bank ?? '');
    setAccount(acc.account ?? '');
  }, [acc]);
  const dirty = !!acc && (bank !== (acc.bank ?? '') || account !== (acc.account ?? ''));
  const save = async () => {
    try {
      await savePettyAccount(email, { name, bank: bank.trim() || undefined, account: account.trim() || undefined });
      setMsg('저장했어요');
      setTimeout(() => setMsg(''), 1500);
    } catch (e) {
      setMsg(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <section className="card pc-account">
      <div className="pc-acc-row">
        <b className="pc-name">{name}</b>
        <input className="pc-bank" placeholder="은행 (예: 국민)" value={bank} onChange={(e) => setBank(e.target.value)} />
        <input className="pc-acc" placeholder="계좌번호" inputMode="numeric" value={account} onChange={(e) => setAccount(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        <button className="primary" disabled={!dirty} onClick={() => void save()}>
          저장
        </button>
        {msg && <span className="muted small">{msg}</span>}
      </div>
      <div className="pc-total">
        <span>전도금 총합계</span>
        <b>{won(total) || '₩0'}</b>
      </div>
    </section>
  );
}

/** 영수증 칸: 사진 올리기 · 종이영수증 표시 */
function ReceiptCell({ email, file, paper, onChange }: { email: string; file?: PettyFile; paper?: boolean; onChange: (v: { receipt?: PettyFile; paper?: boolean }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const up = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    try {
      onChange({ receipt: await uploadReceipt(email, f), paper: undefined });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (file)
    return (
      <span className="pc-rc">
        <a href={file.url} target="_blank" rel="noreferrer" title={file.name}>
          🧾 사진
        </a>
        <button className="icon-btn" title="빼기" onClick={() => onChange({ receipt: undefined })}>
          ✕
        </button>
      </span>
    );
  if (paper)
    return (
      <span className="pc-rc">
        <span className="tag gray small">📄 종이영수증</span>
        <button className="icon-btn" title="빼기" onClick={() => onChange({ paper: undefined })}>
          ✕
        </button>
      </span>
    );
  return (
    <span className="pc-rc">
      <label className="pc-rc-btn" title="영수증 사진 올리기">
        {busy ? '올리는 중…' : '📷 사진'}
        <input type="file" accept="image/*,.pdf" hidden onChange={(e) => void up(e.target.files?.[0])} />
      </label>
      <button className="pc-rc-btn" onClick={() => onChange({ paper: true })} title="종이영수증으로 따로 냄">
        📄 종이
      </button>
      {err && <span className="warn small">{err}</span>}
    </span>
  );
}

function EntryTable({ kind, rows, purposes }: { kind: PettyEntry['kind']; rows: PettyEntry[]; purposes: string[] }) {
  if (!rows.length) return <p className="muted small pc-empty">{kind === 'expense' ? '아직 전도금 내역이 없어요' : '아직 교통비가 없어요'}</p>;
  const patch = (e: PettyEntry, p: Partial<PettyEntry>) => void savePettyEntry({ ...e, ...p });
  return (
    <div className="table-scroll">
      <table className="pc-table">
        <thead>
          <tr>
            <th className="pc-d">날짜</th>
            {kind === 'expense' ? (
              <>
                <th>용도</th>
                <th>내용</th>
              </>
            ) : (
              <>
                <th>교통 수단</th>
                <th>출발지 → 도착지</th>
              </>
            )}
            <th className="r">금액</th>
            <th>영수증</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="pc-d">{md(e.date)}</td>
              {kind === 'expense' ? (
                <>
                  <td>
                    <select value={e.purpose ?? ''} onChange={(x) => patch(e, { purpose: x.target.value })}>
                      {[...new Set([...(e.purpose ? [e.purpose] : []), ...purposes])].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>{e.content}</td>
                </>
              ) : (
                <>
                  <td>{e.mode === '기타' ? e.modeOther || '기타' : e.mode}</td>
                  <td>
                    {e.from} → {e.to}
                  </td>
                </>
              )}
              <td className="r nowrap">{won(e.amount)}</td>
              <td>
                <ReceiptCell email={e.email} file={e.receipt} paper={e.paper} onChange={(v) => patch(e, v)} />
              </td>
              <td>
                <button className="icon-btn" title="지우기" onClick={() => confirm('이 줄을 지울까요?') && void deletePettyEntry(e.id)}>
                  🗑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddEntry({ kind, email, name, purposes, defDate }: { kind: PettyEntry['kind']; email: string; name: string; purposes: string[]; defDate: string }) {
  const blank = () => ({ date: defDate, purpose: purposes[0] ?? '', content: '', mode: '버스', modeOther: '', from: '', to: '', amount: '' });
  const [f, setF] = useState(blank);
  const [rc, setRc] = useState<{ receipt?: PettyFile; paper?: boolean }>({});
  const [err, setErr] = useState('');
  useEffect(() => setF((x) => ({ ...x, date: defDate })), [defDate]);
  const set = (p: Partial<ReturnType<typeof blank>>) => setF((x) => ({ ...x, ...p }));
  const amount = toNum(f.amount);
  const ok = !!f.date && amount !== undefined && (kind === 'expense' ? !!f.purpose && !!f.content.trim() : !!f.from.trim() && !!f.to.trim() && (f.mode !== '기타' || !!f.modeOther.trim()));
  const add = async () => {
    if (!ok) return;
    const e: PettyEntry = {
      id: uid(),
      email,
      name,
      kind,
      date: f.date,
      amount,
      ...(kind === 'expense' ? { purpose: f.purpose, content: f.content.trim() } : { mode: f.mode, modeOther: f.mode === '기타' ? f.modeOther.trim() : undefined, from: f.from.trim(), to: f.to.trim() }),
      ...rc,
      createdAt: new Date().toISOString(),
    };
    try {
      await savePettyEntry(e);
      setF(blank());
      setRc({});
      setErr('');
    } catch (x) {
      setErr(`저장하지 못했어요: ${(x as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <div className="pc-add">
      <input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} />
      {kind === 'expense' ? (
        <>
          <select value={f.purpose} onChange={(e) => set({ purpose: e.target.value })} title="용도">
            {purposes.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
          <input className="pc-grow" placeholder="내용" value={f.content} onChange={(e) => set({ content: e.target.value })} />
        </>
      ) : (
        <>
          <select value={f.mode} onChange={(e) => set({ mode: e.target.value })} title="교통 수단">
            {TRANSPORTS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          {f.mode === '기타' && <input className="pc-other" placeholder="직접 쓰기" value={f.modeOther} onChange={(e) => set({ modeOther: e.target.value })} />}
          <input className="pc-grow" placeholder="출발지" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          <input className="pc-grow" placeholder="도착지" value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </>
      )}
      <input className="pc-amt" placeholder="금액" inputMode="numeric" value={f.amount} onChange={(e) => set({ amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      <ReceiptCell email={email} file={rc.receipt} paper={rc.paper} onChange={(v) => setRc((x) => ({ ...x, ...v }))} />
      <button className="primary" disabled={!ok} onClick={() => void add()}>
        추가
      </button>
      {err && <p className="warn small" style={{ width: '100%', margin: 0 }}>{err}</p>}
    </div>
  );
}

// ===================== 관리 =====================
function Manage({ isAdmin, isManager }: { isAdmin: boolean; isManager: boolean }) {
  const cfg = usePettyCfg();
  const { roles } = usePeople();
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  if (!cfg) return <p className="muted small">불러오는 중…</p>;
  const save = (next: typeof cfg) => savePettyCfg(next).catch((e) => setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`));
  const people = (roles ?? []).filter((r) => r.role !== null).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));
  return (
    <>
      {err && <p className="warn small">{err}</p>}
      {(isManager || isAdmin) && (
        <section className="card">
          <h2>용도</h2>
          <p className="muted small">전도금 내역의 '용도'에서 고를 수 있는 항목이에요.</p>
          <div className="pc-purposes">
            {cfg.purposes.map((p) => (
              <span key={p} className="pc-purpose">
                {p}
                <button className="icon-btn" title="빼기" onClick={() => confirm(`'${p}' 용도를 뺄까요? (이미 쓴 내역은 그대로 남아요)`) && void save({ ...cfg, purposes: cfg.purposes.filter((x) => x !== p) })}>
                  ✕
                </button>
              </span>
            ))}
          </div>
          <div className="pc-add" style={{ marginTop: 10 }}>
            <input
              className="pc-grow"
              placeholder="새 용도 (예: 택배비)"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && text.trim() && !cfg.purposes.includes(text.trim())) {
                  void save({ ...cfg, purposes: [...cfg.purposes, text.trim()] });
                  setText('');
                }
              }}
            />
            <button
              className="primary"
              disabled={!text.trim() || cfg.purposes.includes(text.trim())}
              onClick={() => {
                void save({ ...cfg, purposes: [...cfg.purposes, text.trim()] });
                setText('');
              }}
            >
              추가
            </button>
          </div>
        </section>
      )}
      {isAdmin && (
        <section className="card">
          <h2>전도금 담당자</h2>
          <p className="muted small">담당자로 고른 사람에게는 전도금 페이지에 '관리' 탭이 보여요. (관리자만 바꿀 수 있어요)</p>
          {people.length === 0 ? (
            <p className="muted small">사용자 목록을 불러오는 중이거나, 로컬 모드예요.</p>
          ) : (
            <div className="pc-managers">
              {people.map((r) => (
                <label key={r.email} className="check-line">
                  <input
                    type="checkbox"
                    checked={cfg.managers.includes(r.email)}
                    onChange={(e) => void save({ ...cfg, managers: e.target.checked ? [...cfg.managers, r.email] : cfg.managers.filter((x) => x !== r.email) })}
                  />
                  {r.name || r.email.split('@')[0]} <span className="muted small">{r.email}</span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
