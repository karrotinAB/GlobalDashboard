// 전도금: [전도금 기록하기] (모든 사용자) · [관리] (전도금 담당자 · 관리자)
//   한 달을 1~15일 / 16일~말일 두 번으로 나눠서, 그 기간에 쓴 전도금 내역과 교통비를 기록
import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useAccess } from '../components/AuthGate';
import PettyReceipts from '../components/PettyReceipts';
import { fmtCur, rateOn, useFxRates, SALES_CURRENCIES, type FxTable } from '../lib/sales';
import { EditableText } from '../components/SheetCells';
import { ImageZoom } from '../components/RequestParts';
import { usePeople } from '../components/AddressBook';
import { today, uid } from '../lib/date';
import {
  DEFAULT_PURPOSES,
  DEFAULT_PC_CURRENCIES,
  curLabel,
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
  usePettyAccounts,
  usePettyPeriod,
  savePettyPeriod,
  sheetAmounts,
  DEFAULT_SHEET_ROWS,
  type SheetRow,
  won,
  type PettyEntry,
  type PettyFile,
} from '../lib/petty';

const toNum = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return s.trim() === '' || Number.isNaN(n) ? undefined : n;
};
const prevYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const md = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;

export default function Petty() {
  const access = useAccess();
  const email = access.email || 'local';
  const isAdmin = (access.realRole ?? access.role) === 'admin' || access.role === null;
  const cfg = usePettyCfg();
  const isManager = !!cfg?.managers.includes(email);
  const [tab, setTab] = useState<'mine' | 'settle' | 'print' | 'manage'>('mine');
  const canManage = isManager || isAdmin;
  const [period, setPeriod] = useState(() => periodOf(today()));
  const [who, setWho] = useState(''); // 담당자가 대신 기록하는 사람 ('' = 나)
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
          <button className={tab === 'settle' ? 'on' : ''} onClick={() => setTab('settle')}>
            💸 전도금 정리
          </button>
          <button className={tab === 'print' ? 'on' : ''} onClick={() => setTab('print')}>
            🖨 전도금 프린트
          </button>
          <button className={tab === 'manage' ? 'on' : ''} onClick={() => setTab('manage')}>
            🗂 관리
          </button>
        </div>
      )}
      {tab !== 'manage' && <PeriodNav period={period} setPeriod={setPeriod} />}
      {canManage && tab === 'manage' ? (
        <Manage isAdmin={isAdmin} isManager={isManager} />
      ) : canManage && tab === 'settle' ? (
        <Settle period={period} />
      ) : canManage && tab === 'print' ? (
        <PrintSheets period={period} />
      ) : (
        <Record email={who || email} period={period} who={canManage ? { value: who, set: setWho, me: email } : undefined} />
      )}
    </div>
  );
}

/** 이름 석 자 (계정 이름 → 주소록 이름) */
function useFullName(email: string) {
  const { accountName, email: me } = useAccess();
  const { roles, contacts } = usePeople();
  if (email === LEAD_KEY) return '팀장님';
  if (email === DIRECTOR_KEY) return '이사님';
  return (email === me ? accountName : undefined) || contacts[email]?.name || roles?.find((r) => r.email === email)?.name || (email.includes('@') ? email.split('@')[0] : '');
}
// 대시보드 계정이 없는 팀장님·이사님 대신 쓰는 자리 (담당자가 대신 기록)
const LEAD_KEY = 'lead@petty';
const DIRECTOR_KEY = 'director@petty';

/** 담당자: 이름 옆에서 '나 / 팀장님 / 이사님' 고르기 → 그분 전도금을 대신 기록 */
function useProxyPeople() {
  const { roles, contacts } = usePeople();
  const pick = (role: 'lead' | 'director', fallback: string, key: string) => {
    const r = roles?.find((x) => x.role === role);
    return r ? { key: r.email, label: `${fallback} (${contacts[r.email]?.name || r.name || r.email.split('@')[0]})` } : { key, label: fallback };
  };
  return [pick('lead', '팀장님', LEAD_KEY), pick('director', '이사님', DIRECTOR_KEY)];
}

// ===================== 전도금 기록하기 =====================
type Period = { ym: string; half: number };
function PeriodNav({ period, setPeriod }: { period: Period; setPeriod: (f: (p: Period) => Period) => void }) {
  const isNow = periodKey(period) === periodKey(periodOf(today()));
  return (
    <div className="pc-period">
      <button onClick={() => setPeriod((p) => shiftPeriod(p, -1))} aria-label="이전 기간">
        ◀
      </button>
      <div className="pc-period-label">
        <b>{periodLabel(period)}</b>
        <span className="muted small">{periodRange(period)}</span>
        {isNow ? (
          <span className="tag">지금</span>
        ) : (
          <button className="link small" onClick={() => setPeriod(() => periodOf(today()))}>
            지금 기간으로
          </button>
        )}
      </div>
      <button onClick={() => setPeriod((p) => shiftPeriod(p, 1))} aria-label="다음 기간">
        ▶
      </button>
    </div>
  );
}

function Record({ email, period, who }: { email: string; period: Period; who?: { value: string; set: (v: string) => void; me: string } }) {
  const name = useFullName(email);
  const cfg = usePettyCfg();
  const purposes = cfg?.purposes?.length ? cfg.purposes : DEFAULT_PURPOSES;
  const all = usePettyEntries(email);
  const pk = periodKey(period);
  const rows = useMemo(() => (all ?? []).filter((e) => periodKey(periodOf(e.date)) === pk), [all, pk]);
  const expenses = rows.filter((e) => e.kind === 'expense');
  const transports = rows.filter((e) => e.kind === 'transport');
  const sum = (l: PettyEntry[]) => l.reduce((a, e) => a + (e.amount ?? 0), 0);
  const isNow = pk === periodKey(periodOf(today()));
  // 외화 금액: 영수증 날짜 ECOS 환율로 원화 (환율이 늦게 들어오면 그때 채움)
  const curs = cfg?.currencies?.length ? cfg.currencies : DEFAULT_PC_CURRENCIES;
  const fx = useFxRates(curs.filter((c) => c !== 'KRW'), [prevYm(period.ym), period.ym]);
  useEffect(() => {
    for (const e of rows) {
      if (!e.cur || e.cur === 'KRW' || e.amount !== undefined || e.curAmount === undefined) continue;
      const r = rateOn(fx, e.cur, e.date);
      if (r) void savePettyEntry({ ...e, amount: Math.round(e.curAmount * r.rate), rate: r.rate, rateDate: r.date });
    }
  }, [rows, fx]);
  // 새 줄 기본 날짜: 지금 기간이면 오늘, 아니면 그 기간 첫날
  const defDate = isNow ? today() : `${period.ym}-${period.half === 1 ? '01' : '16'}`;
  return (
    <div className="pc-record">
      {/* 왼쪽: 등록 (전도금 내역 · 교통비) / 오른쪽: 이름 · 계좌 · 합계 */}
      <div className="pc-left">
        <section className="card pc-section">
          <div className="pc-sec-head">
            <h2>전도금 내역</h2>
            <span className="muted small">합계 {won(sum(expenses)) || '₩0'}</span>
          </div>
          <EntryTable kind="expense" rows={expenses} purposes={purposes} />
          <AddEntry kind="expense" email={email} name={name} purposes={purposes} defDate={defDate} curs={curs} fx={fx} />
        </section>
        <section className="card pc-section">
          <div className="pc-sec-head">
            <h2>교통비</h2>
            <span className="muted small">합계 {won(sum(transports)) || '₩0'}</span>
          </div>
          <EntryTable kind="transport" rows={transports} purposes={purposes} />
          <AddEntry kind="transport" email={email} name={name} purposes={purposes} defDate={defDate} curs={curs} fx={fx} />
        </section>
        {all === null && <p className="muted small">불러오는 중…</p>}
      </div>
      <AccountCard key={email} email={email} name={name} expense={sum(expenses)} transport={sum(transports)} who={who} />
    </div>
  );
}

function AccountCard({ email, name, expense, transport, who }: { email: string; name: string; expense: number; transport: number; who?: { value: string; set: (v: string) => void; me: string } }) {
  const proxies = useProxyPeople();
  const myName = useFullName(who?.me ?? email);
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
  // 한 번 저장한 계좌는 잠가 두고 '수정'을 눌러야 고침
  const hasSaved = !!acc && !!(acc.bank || acc.account);
  const [editing, setEditing] = useState(false);
  const locked = hasSaved && !editing;
  const save = async () => {
    try {
      await savePettyAccount(email, { name, bank: bank.trim() || undefined, account: account.trim() || undefined });
      setEditing(false);
      setMsg('저장했어요');
      setTimeout(() => setMsg(''), 1500);
    } catch (e) {
      setMsg(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <section className="card pc-account">
      <div className="pc-name-row">
        <b className="pc-name">{name}</b>
        {/* 담당자만: 팀장님·이사님 전도금을 대신 기록 */}
        {who && (
          <select className="pc-who" value={who.value} onChange={(e) => who.set(e.target.value)} title="누구 전도금을 기록할지">
            <option value="">{myName ? `나 (${myName})` : "나"}</option>
            {proxies.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
      </div>
      {who?.value && <p className="muted small" style={{ margin: 0 }}>담당자로서 대신 기록하고 있어요.</p>}
      <div className="pc-acc-fields">
        <input className={`pc-bank ${locked ? 'locked' : ''}`} readOnly={locked} placeholder="은행 (예: 국민)" value={bank} onChange={(e) => setBank(e.target.value)} />
        <input
          className={`pc-acc ${locked ? 'locked' : ''}`}
          readOnly={locked}
          placeholder="계좌번호"
          inputMode="numeric"
          value={account}
          onChange={(e) => setAccount(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !locked && void save()}
        />
        {locked ? (
          <button className="pc-acc-edit" onClick={() => setEditing(true)}>
            ✎ 수정
          </button>
        ) : (
          <div className="pc-acc-btns">
            <button className="primary" disabled={!dirty} onClick={() => void save()}>
              계좌 저장
            </button>
            {hasSaved && (
              <button
                onClick={() => {
                  setBank(acc?.bank ?? '');
                  setAccount(acc?.account ?? '');
                  setEditing(false);
                }}
              >
                취소
              </button>
            )}
          </div>
        )}
        {msg && <span className="muted small">{msg}</span>}
      </div>
      <div className="pc-sums">
        <div>
          <span>전도금 내역</span>
          <b>{won(expense) || '₩0'}</b>
        </div>
        <div>
          <span>교통비 내역</span>
          <b>{won(transport) || '₩0'}</b>
        </div>
        <div className="pc-sum-total">
          <span>총 전도금</span>
          <b>{won(expense + transport) || '₩0'}</b>
        </div>
      </div>
    </section>
  );
}

/** 영수증 끌어다 놓기 · 붙여넣기(Ctrl+V): 그 칸(줄) 위에서 하면 바로 영수증으로 올라감 */
function useReceiptDrop(email: string, onUp: (f: PettyFile) => void) {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const take = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    setErr('');
    try {
      onUp(await uploadReceipt(email, f));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const props = {
    onDragOver: (e: React.DragEvent) => {
      if (![...e.dataTransfer.types].includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      if (!over) setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setOver(false);
      void take(e.dataTransfer.files[0]);
    },
    onPaste: (e: React.ClipboardEvent) => {
      // 글자 칸(내용·금액 등)에 붙여넣을 땐 글자 그대로 — 영수증으로 가로채지 않음
      if ((e.target as HTMLElement).closest('input, textarea, select, [contenteditable]')) return;
      const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/') || x.type === 'application/pdf');
      if (!f) return;
      e.preventDefault();
      void take(f);
    },
  };
  return { props, over, busy, err };
}

/** 영수증 보기: 사진은 누르면 팝업으로 크게 (PDF 는 새 창) */
function ReceiptLink({ file }: { file: PettyFile }) {
  const [zoom, setZoom] = useState(false);
  const img = !/\.pdf$/i.test(file.name) && !file.url.startsWith('data:application/pdf');
  return (
    <>
      <a
        href={file.url}
        target="_blank"
        rel="noreferrer"
        title={file.name}
        onClick={(e) => {
          if (!img) return;
          e.preventDefault();
          setZoom(true);
        }}
      >
        {img ? '🧾 사진' : '📄 PDF'}
      </a>
      {zoom && <ImageZoom f={file} onClose={() => setZoom(false)} />}
    </>
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
        <ReceiptLink file={file} />
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

/** 날짜: 누르면 달력으로 고치기 (다른 기간 날짜로 바꾸면 그 기간으로 옮겨가요) */
function DateEdit({ value, onSave }: { value: string; onSave: (d: string) => void }) {
  const [edit, setEdit] = useState(false);
  if (!edit)
    return (
      <button className="pc-date-btn" onClick={() => setEdit(true)} title="눌러서 날짜 고치기">
        {md(value)}
      </button>
    );
  return (
    <input
      type="date"
      autoFocus
      className="pc-date-in"
      defaultValue={value}
      onBlur={(x) => {
        if (x.target.value && x.target.value !== value) onSave(x.target.value);
        setEdit(false);
      }}
      onKeyDown={(x) => {
        if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
        if (x.key === 'Escape') setEdit(false);
      }}
    />
  );
}

/** 이미 쓴 줄: 그 줄 위로 영수증을 끌어다 놓거나, 줄을 누르고 Ctrl+V */
function DropRow({ e, enabled, children }: { e: PettyEntry; enabled: boolean; children: React.ReactNode }) {
  const d = useReceiptDrop(e.email, (f) => void savePettyEntry({ ...e, receipt: f, paper: undefined }));
  if (!enabled) return <tr>{children}</tr>;
  return (
    <tr {...d.props} tabIndex={-1} className={d.over ? 'pc-drop' : ''} title="영수증 사진을 이 줄로 끌어다 놓거나, 줄의 빈 곳을 누르고 Ctrl+V 로 붙여넣어도 돼요">
      {children}
      {(d.busy || d.err) && <td className="small muted">{d.busy ? '올리는 중…' : d.err}</td>}
    </tr>
  );
}

function EntryTable({ kind, rows, purposes, canDelete = true }: { kind: PettyEntry['kind']; rows: PettyEntry[]; purposes: string[]; canDelete?: boolean }) {
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
                <th>내역</th>
              </>
            )}
            <th className="r">금액</th>
            <th className="pc-rc-col">영수증</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <DropRow key={e.id} e={e} enabled={canDelete}>
              <td className="pc-d">
                <DateEdit value={e.date} onSave={(d) => patch(e, e.cur && e.cur !== 'KRW' ? { date: d, amount: undefined, rate: undefined, rateDate: undefined } : { date: d })} />
              </td>
              {kind === 'expense' ? (
                <>
                  <td>
                    <select value={e.purpose ?? ''} onChange={(x) => patch(e, { purpose: x.target.value })}>
                      {[...new Set([...(e.purpose ? [e.purpose] : []), ...purposes])].map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <EditableText value={e.content ?? ''} oneLine placeholder="내역" onSave={(v) => patch(e, { content: v.trim() || undefined })} />
                  </td>
                </>
              ) : (
                <>
                  <td>{e.mode === '기타' ? e.modeOther || '기타' : e.mode}</td>
                  <td>
                    {e.from} → {e.to}
                  </td>
                  <td>
                    <EditableText value={e.content ?? ''} oneLine placeholder="내역" onSave={(v) => patch(e, { content: v.trim() || undefined })} />
                  </td>
                </>
              )}
              <td className="r nowrap">
                {e.amount !== undefined ? won(e.amount) : <span className="muted small">환율 대기</span>}
                {e.cur && e.cur !== 'KRW' && e.curAmount !== undefined && (
                  <small className="fx-orig" title={e.rate ? `${e.rateDate} 환율 ${e.rate}` : ''}>
                    {fmtCur(e.cur, e.curAmount)}
                  </small>
                )}
              </td>
              <td className="pc-rc-col">
                {canDelete ? (
                  <ReceiptCell email={e.email} file={e.receipt} paper={e.paper} onChange={(v) => patch(e, v)} />
                ) : e.receipt ? (
                  <span className="pc-rc">
                    <ReceiptLink file={e.receipt} />
                  </span>
                ) : e.paper ? (
                  <span className="tag gray small">📄 종이영수증</span>
                ) : (
                  <span className="muted small">없음</span>
                )}
              </td>
              <td>
                {canDelete && (
                  <button className="icon-btn" title="지우기" onClick={() => confirm('이 줄을 지울까요?') && void deletePettyEntry(e.id)}>
                    🗑
                  </button>
                )}
              </td>
            </DropRow>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AddEntry({ kind, email, name, purposes, defDate, curs, fx }: { kind: PettyEntry['kind']; email: string; name: string; purposes: string[]; defDate: string; curs: string[]; fx: FxTable }) {
  const blank = () => ({ date: defDate, purpose: purposes[0] ?? '', content: '', mode: '버스', modeOther: '', from: '', to: '', amount: '', cur: 'KRW' });
  const [f, setF] = useState(blank);
  const [rc, setRc] = useState<{ receipt?: PettyFile; paper?: boolean }>({});
  const [err, setErr] = useState('');
  useEffect(() => setF((x) => ({ ...x, date: defDate })), [defDate]);
  const set = (p: Partial<ReturnType<typeof blank>>) => setF((x) => ({ ...x, ...p }));
  const drop = useReceiptDrop(email, (file) => setRc({ receipt: file }));
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
      ...(f.cur === 'KRW'
        ? { amount }
        : (() => {
            const r = rateOn(fx, f.cur, f.date);
            return { cur: f.cur, curAmount: amount, amount: r ? Math.round(amount! * r.rate) : undefined, rate: r?.rate, rateDate: r?.date };
          })()),
      ...(kind === 'expense' ? { purpose: f.purpose, content: f.content.trim() } : { mode: f.mode, modeOther: f.mode === '기타' ? f.modeOther.trim() : undefined, from: f.from.trim(), to: f.to.trim(), content: f.content.trim() || undefined }),
      ...rc,
      createdAt: new Date().toISOString(),
    };
    try {
      await savePettyEntry(e);
      setF({ ...blank(), cur: f.cur });
      setRc({});
      setErr('');
    } catch (x) {
      setErr(`저장하지 못했어요: ${(x as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <div className={`pc-add pc-add-${kind} ${drop.over ? 'pc-drop' : ''}`} {...drop.props} tabIndex={-1}>
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
          <input className="pc-grow pc-place" placeholder="출발지" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          <input className="pc-grow pc-place" placeholder="도착지" value={f.to} onChange={(e) => set({ to: e.target.value })} />
          <input className="pc-grow pc-memo" placeholder="내역 (예: 야근 택시)" value={f.content} onChange={(e) => set({ content: e.target.value })} />
        </>
      )}
      <span className="pc-amt-wrap">
        <select className="pc-cur" value={f.cur} onChange={(e) => set({ cur: e.target.value })} title="금액 통화">
          {curs.map((c) => (
            <option key={c} value={c}>
              {curLabel(c)}
            </option>
          ))}
        </select>
        <input className="pc-amt" placeholder="금액" inputMode="decimal" value={f.amount} onChange={(e) => set({ amount: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void add()} />
      </span>
      {f.cur !== 'KRW' && amount !== undefined && (
        <span className="pc-conv muted small">
          {(() => {
            const r = rateOn(fx, f.cur, f.date);
            return r ? `≈ ${won(Math.round(amount * r.rate))} (${r.date.slice(5).replace('-', '/')} 환율)` : '환율이 아직 없어요 — 들어오면 원화로 채워져요';
          })()}
        </span>
      )}
      <ReceiptCell email={email} file={rc.receipt} paper={rc.paper} onChange={(v) => setRc((x) => ({ ...x, ...v }))} />
      <button className="primary" disabled={!ok} onClick={() => void add()}>
        추가
      </button>
      {(err || drop.err) && <p className="warn small" style={{ width: '100%', margin: 0 }}>{err || drop.err}</p>}
      <p className="muted small pc-drop-hint">{drop.busy ? '영수증 올리는 중…' : drop.over ? '여기에 놓으면 영수증으로 올라가요' : '영수증 사진은 이 칸으로 끌어다 놓거나, 칸의 빈 곳을 한 번 누르고 Ctrl+V 로 붙여넣어도 돼요 (글자 칸에서 Ctrl+V 는 글자만)'}</p>
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
      {(isManager || isAdmin) && (
        <section className="card">
          <h2>금액 통화</h2>
          <p className="muted small">전도금·교통비 금액 앞에서 고르는 통화예요. 외화는 영수증 날짜의 ECOS 환율로 원화로 바꿔요.</p>
          <div className="pc-purposes">
            {(cfg.currencies?.length ? cfg.currencies : DEFAULT_PC_CURRENCIES).map((c) => (
              <span key={c} className="pc-purpose">
                {curLabel(c)} <span className="muted small">{c}</span>
                {c !== 'KRW' && (
                  <button className="icon-btn" title="빼기" onClick={() => void save({ ...cfg, currencies: (cfg.currencies?.length ? cfg.currencies : DEFAULT_PC_CURRENCIES).filter((x) => x !== c) })}>
                    ✕
                  </button>
                )}
              </span>
            ))}
            <select
              value=""
              onChange={(e) => e.target.value && void save({ ...cfg, currencies: [...(cfg.currencies?.length ? cfg.currencies : DEFAULT_PC_CURRENCIES), e.target.value] })}
            >
              <option value="">＋ 통화 추가</option>
              {SALES_CURRENCIES.filter((c) => !(cfg.currencies?.length ? cfg.currencies : DEFAULT_PC_CURRENCIES).includes(c)).map((c) => (
                <option key={c} value={c}>
                  {curLabel(c)} ({c})
                </option>
              ))}
            </select>
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

// ===================== 전도금 정리 (담당자) =====================
function Settle({ period }: { period: Period }) {
  const { email: me } = useAccess();
  const cfg = usePettyCfg();
  const purposes = cfg?.purposes?.length ? cfg.purposes : DEFAULT_PURPOSES;
  const all = usePettyEntries(null);
  const accounts = usePettyAccounts(true);
  const pk = periodKey(period);
  const per = usePettyPeriod(pk, true);
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(() => (all ?? []).filter((e) => periodKey(periodOf(e.date)) === pk), [all, pk]);
  const people = useMemo(() => {
    const m = new Map<string, { email: string; name: string; list: PettyEntry[] }>();
    for (const e of rows) {
      const p = m.get(e.email) ?? { email: e.email, name: e.name || accounts[e.email]?.name || e.email.split('@')[0], list: [] };
      p.list.push(e);
      m.set(e.email, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, accounts]);
  const sum = (l: PettyEntry[]) => l.reduce((a, e) => a + (e.amount ?? 0), 0);
  const paid = per?.paid ?? {};
  const togglePaid = (email: string) => {
    const next = { ...paid };
    if (next[email]) delete next[email];
    else next[email] = { at: new Date().toISOString(), by: me || undefined };
    void savePettyPeriod(pk, { ...(per ?? {}), paid: next });
  };
  const total = sum(rows);
  const done = people.filter((p) => paid[p.email]).length;
  return (
    <div className="pc-settle-wrap">
    <section className="card pc-settle">
      <div className="pc-sec-head">
        <h2>전도금 정리</h2>
        <span className="muted small">
          {people.length}명 · 전달 완료 {done}/{people.length} · 합계 {won(total) || '₩0'}
        </span>
      </div>
      {all === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : people.length === 0 ? (
        <p className="muted small pc-empty">이 기간에 올라온 전도금이 없어요.</p>
      ) : (
        <div className="pc-people">
          {people.map((p) => {
            const acc = accounts[p.email] ?? {};
            const isOpen = open === p.email;
            return (
              <div key={p.email} className={`pc-person ${paid[p.email] ? 'paid' : ''} ${isOpen ? 'open' : ''}`}>
                <div className="pc-person-row" onClick={() => setOpen(isOpen ? null : p.email)}>
                  <span className="pc-caret">{isOpen ? '▾' : '▸'}</span>
                  <b className="pc-person-name">{p.name}</b>
                  <span className="pc-person-acc">{acc.bank || acc.account ? `${acc.bank ?? ''} ${acc.account ?? ''}`.trim() : <span className="muted small">계좌 없음</span>}</span>
                  <b className="pc-person-amt">{won(sum(p.list))}</b>
                  <label className="pc-paid" onClick={(e) => e.stopPropagation()} title={paid[p.email] ? `전달 완료 ${new Date(paid[p.email].at).toLocaleDateString('ko-KR')}` : '전달 완료로 표시'}>
                    <input type="checkbox" checked={!!paid[p.email]} onChange={() => togglePaid(p.email)} /> 전달 완료
                  </label>
                </div>
                {isOpen && (
                  <div className="pc-person-detail">
                    <div className="pc-sub">전도금 내역 <span className="muted small">· 용도를 바꾸면 정산서 그 항목으로 들어가요</span></div>
                    <EntryTable kind="expense" rows={p.list.filter((e) => e.kind === 'expense')} purposes={purposes} canDelete={false} />
                    <div className="pc-sub">교통비</div>
                    <EntryTable kind="transport" rows={p.list.filter((e) => e.kind === 'transport')} purposes={purposes} canDelete={false} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
    {/* 오른쪽: 이름 - 금액 목록 + 총 전도금 */}
    <aside className="card pc-settle-sum">
      <h2>보낼 금액</h2>
      {people.length === 0 ? (
        <p className="muted small">없어요</p>
      ) : (
        <ul>
          {people.map((p) => (
            <li key={p.email} className={paid[p.email] ? 'paid' : ''}>
              <span>
                {p.name}
                {paid[p.email] && <span className="pc-sum-ok"> ✓</span>}
              </span>
              <b>{won(sum(p.list))}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="pc-sum-total">
        <span>총 전도금</span>
        <b>{won(total) || '₩0'}</b>
      </div>
    </aside>
    </div>
  );
}

// ===================== 전도금 프린트 (담당자) =====================
const ymdKo = (ym: string, d: number) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월 ${d}일`;
const lastDay = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
const dotDate = (iso: string) => `${iso.slice(2, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)}`;
const APPROVALS = ['담당', '주임', '대리', '과장', '차/부장', '임원', '회장'];

/** 이 시트만 인쇄 (브라우저 인쇄 창 → 'PDF로 저장' 가능): 시트를 깨끗하게 복사해서 그것만 찍음 */
function printSheet(id: string, many = false) {
  const src = document.getElementById(id);
  if (!src) return;
  const copy = src.cloneNode(true) as HTMLElement;
  copy.removeAttribute('id');
  if (many) copy.className = 'rc-print-all';
  // 입력칸은 적힌 글자로 바꿔서
  const ins = src.querySelectorAll('input, textarea');
  copy.querySelectorAll('input, textarea').forEach((el, i) => {
    const span = document.createElement('span');
    span.className = `${el.className} ps-text`;
    span.textContent = (ins[i] as HTMLInputElement).value;
    el.replaceWith(span);
  });
  copy.querySelectorAll('.no-print').forEach((el) => el.remove());
  const root = document.createElement('div');
  root.id = 'pc-print-root';
  root.appendChild(copy);
  document.body.appendChild(root);
  document.body.classList.add('pc-printing');
  const done = () => {
    document.body.classList.remove('pc-printing');
    root.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}

function Approval({ label }: { label: string[] }) {
  return (
    <table className="ps-appr">
      <tbody>
        <tr>
          <td rowSpan={2} className="ps-appr-side">
            {label.map((x) => (
              <div key={x}>{x}</div>
            ))}
          </td>
          <td rowSpan={2} className="ps-appr-side">
            <div>결</div>
            <div>재</div>
          </td>
          {APPROVALS.map((a) => (
            <td key={a} className="ps-appr-h">
              {a}
            </td>
          ))}
        </tr>
        <tr>
          {APPROVALS.map((a) => (
            <td key={a} className="ps-appr-sign" />
          ))}
        </tr>
      </tbody>
    </table>
  );
}

function PrintSheets({ period }: { period: Period }) {
  const access = useAccess();
  const cfg = usePettyCfg();
  const { roles, contacts } = usePeople();
  const all = usePettyEntries(null);
  const pk = periodKey(period);
  const per = usePettyPeriod(pk, true);
  const [which, setWhich] = useState<'sheet' | 'transport' | 'receipt'>('sheet');
  const rows = useMemo(() => (all ?? []).filter((e) => periodKey(periodOf(e.date)) === pk), [all, pk]);
  const sheetRows = per?.rows ?? DEFAULT_SHEET_ROWS;
  // 정산서 항목으로 쓸 수 있는 것: 관리 탭의 용도 + 교통비 + 기타 (그 밖의 말은 안 됨)
  const allowedItems = [...new Set([...(cfg?.purposes?.length ? cfg.purposes : DEFAULT_PURPOSES), '교통비', '기타'])];
  const missingItems = allowedItems.filter((x) => !sheetRows.some((r) => r.item.trim() === x));
  const amts = sheetAmounts(sheetRows, rows);
  const total = Object.values(amts).reduce((a, b) => a + b, 0);
  const from = period.half === 1 ? 1 : 16;
  const to = period.half === 1 ? 15 : lastDay(period.ym);
  // 담당: 전도금 담당자 이름 (내가 담당자면 나, 아니면 첫 번째 담당자)
  const fullName = (e: string) => contacts[e]?.name || roles?.find((r) => r.email === e)?.name || '';
  const mgr = cfg?.managers.includes(access.email) ? access.accountName || fullName(access.email) : cfg?.managers[0] ? fullName(cfg.managers[0]) : '';
  const saveRows = (next: SheetRow[]) => void savePettyPeriod(pk, { ...(per ?? {}), rows: next });
  const transports = rows.filter((e) => e.kind === 'transport').sort((a, b) => a.date.localeCompare(b.date));
  const tTotal = transports.reduce((a, e) => a + (e.amount ?? 0), 0);
  const blankRows = Math.max(0, 12 - transports.length);
  return (
    <>
      <div className="seg pc-print-tabs">
        <button className={which === 'sheet' ? 'on' : ''} onClick={() => setWhich('sheet')}>
          1. 전도금 정산서
        </button>
        <button className={which === 'transport' ? 'on' : ''} onClick={() => setWhich('transport')}>
          2. 교통비 신청서
        </button>
        <button className={which === 'receipt' ? 'on' : ''} onClick={() => setWhich('receipt')}>
          3. 영수증
        </button>
      </div>

      {which === 'sheet' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">항목 · 내역 · 비고는 눌러서 고칠 수 있어요 (이 기간에만 저장). 금액은 각자 올린 전도금을 용도별로 더한 값이에요.</span>
            <button className="primary" onClick={() => printSheet('ps-sheet')}>
              🖨 프린트 / PDF
            </button>
          </div>
          <div className="ps-page" id="ps-sheet">
            <h1 className="ps-title">전 도 금 정 산 서</h1>
            <div className="ps-top">
              <div className="ps-to">수신 : 재 무 팀</div>
              <Approval label={['재', '무', '팀']} />
            </div>
            <div className="ps-guide">항목별로 구분하여 기재요망</div>
            <div className="ps-range">
              {ymdKo(period.ym, from)} &nbsp;~&nbsp; {ymdKo(period.ym, to)}
            </div>
            <table className="ps-table">
              <thead>
                <tr>
                  <th style={{ width: '16%' }}>항 목</th>
                  <th style={{ width: '22%' }}>내 역</th>
                  <th style={{ width: '22%' }}>지 급 처</th>
                  <th style={{ width: '20%' }}>금 액</th>
                  <th>비 고</th>
                </tr>
              </thead>
              <tbody>
                {sheetRows.map((r, i) => (
                  <tr key={r.id}>
                    <td className="c">
                      <select className="ps-in ps-item c" value={r.item} onChange={(e) => saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, item: e.target.value } : x)))}>
                        {[r.item, ...missingItems].map((x) => (
                          <option key={x}>{x}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <textarea className="ps-in" rows={2} value={r.desc} onChange={(e) => saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, desc: e.target.value } : x)))} />
                    </td>
                    {i === 0 && (
                      <td rowSpan={sheetRows.length} className="ps-x">
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                          <line x1="0" y1="100" x2="100" y2="0" />
                        </svg>
                      </td>
                    )}
                    <td className="r">{won(amts[r.id])}</td>
                    <td className="ps-note">
                      <input className="ps-in" value={r.note ?? ''} onChange={(e) => saveRows(sheetRows.map((x) => (x.id === r.id ? { ...x, note: e.target.value || undefined } : x)))} />
                      <button className="ps-del no-print" title="이 항목 빼기" onClick={() => confirm(`'${r.item}' 항목을 뺄까요?`) && saveRows(sheetRows.filter((x) => x.id !== r.id))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
                <tr className="ps-sum">
                  <td className="c">계</td>
                  <td colSpan={2} />
                  <td className="r">{won(total) || '₩0'}</td>
                  <td />
                </tr>
              </tbody>
            </table>
            {/* 관리 탭의 용도 중 아직 없는 것만 골라서 추가 */}
            {missingItems.length > 0 && (
              <select
                className="ps-add-item no-print"
                value=""
                onChange={(e) => e.target.value && saveRows([...sheetRows, { id: uid(), item: e.target.value, desc: '' }])}
                title="관리 탭에 있는 용도 중 정산서에 아직 없는 항목"
              >
                <option value="">＋ 항목 추가</option>
                {missingItems.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            )}
            <div className="ps-bottom">
              <Approval label={['정', '산', '부', '서']} />
              <div className="ps-dept">
                <div>정산부서 : 글로벌사업부</div>
                <div>담 &nbsp;당 : {mgr ? mgr.split('').join(' ') : ''}</div>
              </div>
            </div>
            <div className="ps-attach">* 첨 부 : 제 증 명</div>
          </div>
        </>
      )}

      {which === 'transport' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">모든 사람이 올린 교통비를 날짜순으로 모았어요. '내역'은 눌러서 고칠 수 있어요.</span>
            <button className="primary" onClick={() => printSheet('ps-transport')}>
              🖨 프린트 / PDF
            </button>
          </div>
          <div className="ps-page" id="ps-transport">
            <h1 className="ps-title small">교 통 비 신 청 서</h1>
            <div className="ps-period">
              ■ 사 용 기 간 &nbsp;: &nbsp;&nbsp; {Number(period.ym.slice(5, 7))}월 &nbsp; {from}일 &nbsp; ~ &nbsp; {Number(period.ym.slice(5, 7))}월 &nbsp; {to}일
            </div>
            <table className="ps-table ps-tr">
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: '11%' }}>
                    날 짜
                  </th>
                  <th colSpan={2}>교통수단</th>
                  <th rowSpan={2} style={{ width: '16%' }}>
                    출 발 지
                  </th>
                  <th rowSpan={2} style={{ width: '16%' }}>
                    도 착 지
                  </th>
                  <th rowSpan={2} style={{ width: '11%' }}>
                    금 액
                  </th>
                  <th rowSpan={2}>내 역</th>
                  <th rowSpan={2} style={{ width: '7%' }}>
                    비 고
                  </th>
                </tr>
                <tr>
                  <th style={{ width: '8%' }}>대중교통</th>
                  <th style={{ width: '7%' }}>기타</th>
                </tr>
              </thead>
              <tbody>
                {transports.map((e) => {
                  const pub = e.mode === '버스' || e.mode === '기차';
                  const label = e.mode === '기타' ? e.modeOther || '기타' : e.mode ?? '';
                  return (
                    <tr key={e.id}>
                      <td className="c">{dotDate(e.date)}</td>
                      <td className="c">{pub ? label : ''}</td>
                      <td className="c">{pub ? '' : label}</td>
                      <td className="c">{e.from}</td>
                      <td className="c">{e.to}</td>
                      <td className="r">{(e.amount ?? 0).toLocaleString('ko-KR')}</td>
                      <td className="c">
                        <input
                          className="ps-in c"
                          key={`${e.id}:${e.content ?? ''}:${e.memo ?? ''}`}
                          defaultValue={e.memo ?? `${e.name ?? ''} ${e.content || `${label}비`}`.trim()}
                          onBlur={(x) => {
                            const v = x.target.value.trim();
                            if (v !== (e.memo ?? '')) void savePettyEntry({ ...e, memo: v || undefined });
                          }}
                        />
                      </td>
                      <td />
                    </tr>
                  );
                })}
                {Array.from({ length: blankRows }, (_, i) => (
                  <tr key={`b${i}`} className="ps-blank">
                    {Array.from({ length: 8 }, (__, j) => (
                      <td key={j} />
                    ))}
                  </tr>
                ))}
                <tr className="ps-sum">
                  <td colSpan={5} className="c">
                    소 계
                  </td>
                  <td className="r">₩ {tTotal.toLocaleString('ko-KR')}</td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {which === 'receipt' && (
        <>
          <div className="pc-print-bar">
            <span className="muted small">항목(용도)별로 장을 나눠 날짜순으로 붙였어요. 글자는 두 번 누르면 그 자리에서 고칠 수 있어요.</span>
            <button className="primary" onClick={() => printSheet('ps-receipts', true)}>
              🖨 프린트 / PDF (모든 장)
            </button>
          </div>
          {per ? <PettyReceipts pk={pk} per={per} entries={rows} rows={sheetRows} /> : <p className="muted small">불러오는 중…</p>}
        </>
      )}
      {all === null && <p className="muted small">불러오는 중…</p>}
    </>
  );
}
