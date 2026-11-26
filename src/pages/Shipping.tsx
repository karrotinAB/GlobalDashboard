// 🚚 출고 관리: 주문 관리에서 출고 '승인' 된 주문을 묶음별로 (묶음 아닌 주문은 한 줄씩)
//   묶음 · 주문 (누르면 안의 주문) + DOC CLS · CARGO CLS · ETD · ETA 날짜
//   패킹 승인 금액 (그 업체 수출 통화) · 실제 입금 금액 (+ 짧은 메모)
//   외화정리 · 수출면장 · 배차 · 관리부출고 ○ → ● (관리부출고는 날짜 = 주문 관리 '출고일')
//   ON BOARD ☐ · 출고마감 · 결재서류 ○
//   저장: 묶음이면 묶음 안 주문마다 bundle.ship 에 같이, 묶음 아니면 order.ship (주문 관리 묶음과 같은 방식)
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useLookups, useStore } from '../data/store';
import { DateCell } from '../components/OrderCells';
import { Modal } from '../components/ui';
import { fmtCur, useOrderUsd } from '../lib/sales';
import { deleteRequestFile, uploadShipFile } from '../lib/trade';
import type { Claim, Company, Order, RequestFile, ShipInfo } from '../types';
import { useAccess } from '../components/AuthGate';
import { isPersonal } from '../lib/team';
import TradeShipping from './TradeShipping';

type FileStep = 'fx' | 'license' | 'truck' | 'out' | 'closeOut' | 'papers';
const FILE_STEP_LABEL: Record<FileStep, string> = { fx: '외화정리', license: '수출면장', truck: '배차', out: '관리부출고', closeOut: '출고마감', papers: '결재서류' };

type Group = {
  key: string;
  team?: string; // 무역사무 화면: 어느 조 주문인지
  name: string;
  color?: string;
  bundleId?: string;
  orders: Order[]; // 묶음 안 주문 전부
  approved: Order[]; // 그중 출고 승인된 것
  ship: ShipInfo;
  shipDate?: string; // 관리부출고 날짜 (= 주문 관리 출고일)
  companyId: string | null;
};
type StepKey = 'fx' | 'license' | 'truck' | 'onBoard' | 'closeOut' | 'papers';
/** 무역사무도 체크하는 단계 (조원은 ON BOARD 까지 모두) */
const STEP_NAME: Record<StepKey, string> = { fx: '외화정리', license: '수출면장', truck: '배차', onBoard: 'ON BOARD', closeOut: '출고마감', papers: '결재서류' };
const FIELD_NAME: Record<string, string> = { docCls: 'DOC CLS', cargoCls: 'CARGO CLS', docClsTime: 'DOC CLS 시간', cargoClsTime: 'CARGO CLS 시간', etd: 'ETD', eta: 'ETA', etdPort: 'ETD 항구', etaPort: 'ETA 항구', calLabel: '달력 이름', onBoardDate: 'ON BOARD 날짜' };
const TRADE_STEPS: StepKey[] = ['fx', 'license', 'truck', 'onBoard', 'closeOut', 'papers']; // 무역사무도 ON BOARD (조원 칸) 누를 수 있음
type Mode = 'team' | 'trade';

const dot = (iso?: string) => (iso ? iso.slice(2).replace(/-/g, '.') : '');
const num = (s: string) => {
  const n = Number(s.replace(/[^\d.-]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? undefined : n;
};

/** 조 화면: 우리 조 주문 */
export default function Shipping() {
  const { data, saveMany } = useStore();
  const { companies } = useLookups();
  // 팀장님 · 이사님 (개인 공간): 무역사무처럼 1~3조 전부 · 보기만
  if (isPersonal(useAccess().viewTeam)) return <TradeShipping readOnly />;
  return <ShipBoard mode="team" orders={data.orders} claims={data.claims} companies={companies} saveOrders={(os) => saveMany('orders', os)} />;
}

/** 출고 관리 화면 (조 · 무역사무 같이 씀) */
export function ShipBoard({ mode, orders, claims = [], companies, saveOrders, readOnly = false, tabs, viewExtra }: { mode: Mode; orders: Order[]; claims?: Claim[]; companies: Company[]; saveOrders: (os: Order[]) => Promise<void> | void; readOnly?: boolean; tabs?: ReactNode; viewExtra?: ReactNode }) {
  const trade = mode === 'trade';
  const acc = useAccess();
  const me = acc.accountName || acc.email.split('@')[0] || '알 수 없음';
  const myRole = acc.role === 'trade' ? '무역사무' : acc.role === 'admin' ? '관리자' : '조원';
  // readOnly: 팀장님 · 이사님 — 무역사무 화면 그대로, 아무것도 못 고침
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const fxc = useOrderUsd(companies, orders);
  // 외화 금액 칸의 통화: 업체 수출 통화 (원화 업체면 ERP 외화는 USD)
  const fgnCur = (o: Order) => (fxc.curOf(o) === 'KRW' ? 'USD' : fxc.curOf(o));
  const [tab, setTab] = useState<'open' | 'done' | 'all'>('open');
  const [co, setCo] = useState('');
  const [teamF, setTeamF] = useState('');
  const [q, setQ] = useState('');
  const [coOpen, setCoOpen] = useState(false); // 업체 칩은 '업체 선택' 을 눌렀을 때만
  const [kinds, setKinds] = useState<CalKind[]>([]); // 달력: DOC · CARGO · ETD · ETA 골라 보기 (비면 모두)
  const [calPick, setCalPick] = useState<string | null>(null); // 누른 묶음 (상세 창 — 목록 · 달력 같이)
  // 방금 열어 봤던 줄: 창을 닫아도 (다른 걸 누르거나 페이지를 나가기 전까지) 색 · 굵게
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  useEffect(() => {
    if (calPick) setLastSeen(calPick);
  }, [calPick]);
  const [files, setFiles] = useState<{ key: string; step: FileStep } | null>(null);
  const viewKey = trade ? 'gd:shipView:trade' : 'gd:shipView';
  const [view, setView] = useState<'list' | 'cal'>(() => {
    try {
      return localStorage.getItem(viewKey) === 'cal' ? 'cal' : 'list';
    } catch {
      return 'list';
    }
  });
  const pickView = (v: 'list' | 'cal') => {
    setView(v);
    try {
      localStorage.setItem(viewKey, v);
    } catch {
      /* 무시 */
    }
  };

  // 출고 승인된 주문이 있는 묶음 · 주문 (조마다 따로)
  const groups = useMemo(() => {
    const byBundle = new Map<string, Order[]>();
    const singles: Order[] = [];
    const tagOf = (o: Order) => (o as Order & { team?: string }).team;
    for (const o of orders) {
      if (o.bundle) {
        const k = `${tagOf(o) ?? ''}|${o.bundle.id}`;
        byBundle.set(k, [...(byBundle.get(k) ?? []), o]);
      } else if (o.outStatus === 'approved') singles.push(o);
    }
    const out: Group[] = [];
    for (const [k, os] of byBundle) {
      const approved = os.filter((o) => o.outStatus === 'approved');
      if (!approved.length) continue;
      const b = os[0].bundle!;
      out.push({ key: `b:${k}`, team: tagOf(os[0]), name: b.name || '묶음', color: b.color, bundleId: b.id, orders: os, approved, ship: b.ship ?? {}, shipDate: b.shipDate, companyId: os[0].companyId });
    }
    for (const o of singles) out.push({ key: `o:${tagOf(o) ?? ''}|${o.id}`, team: tagOf(o), name: o.name, orders: [o], approved: [o], ship: o.ship ?? {}, shipDate: o.shipDate, companyId: o.companyId });
    // 최근 출고(ETD · 관리부출고 · 승인일) 먼저
    const when = (g: Group) => g.ship.etd || g.shipDate || g.approved.map((o) => o.outDate ?? o.orderDate ?? '').sort().at(-1) || '';
    return out.sort((a, b) => when(b).localeCompare(when(a)));
  }, [orders]);

  const query = q.trim().toLowerCase();
  const hit = (g: Group) =>
    !query || `${g.name} ${companyById.get(g.companyId ?? '')?.name ?? ''} ${g.orders.map((o) => `${o.name} ${o.storeCode ?? ''} ${o.expNo ?? ''}`).join(' ')}`.toLowerCase().includes(query);
  const base = groups.filter((g) => (!co || g.companyId === co) && (!teamF || g.team === teamF) && hit(g));
  const isDone = (g: Group) => !!g.ship.papers; // 완료 = 결재서류 체크 → '완료' 탭으로
  const shown = base.filter((g) => (tab === 'all' ? true : tab === 'done' ? isDone(g) : !isDone(g)));
  const coIds = [...new Set(groups.filter((g) => !teamF || g.team === teamF).map((g) => g.companyId).filter((x): x is string => !!x))];
  const teams = [...new Set(groups.map((g) => g.team).filter((x): x is string => !!x))].sort();

  // 저장: 묶음이면 묶음 안 주문 모두에, 아니면 그 주문에
  const saveShip = (g: Group, patch: Partial<ShipInfo>, shipDate?: string | null) => {
    if (readOnly) return;
    // ETD 를 바꾸면 ON BOARD 도 같이 (따로 쓴 ON BOARD 날짜는 지우고 새 ETD 를 따라감)
    if ('etd' in patch && patch.etd !== g.ship.etd && g.ship.onBoardDate) patch = { ...patch, onBoardDate: undefined };
    // 📜 기록: 바뀐 칸마다 한 줄 (누가 · 언제 · 뭘)
    const whats = describe(g, patch, shipDate);
    const at = new Date().toISOString();
    const log = whats.length ? [...(g.ship.log ?? []), ...whats.map((what) => ({ at, by: me, role: myRole, what }))].slice(-200) : g.ship.log;
    const ship = JSON.parse(JSON.stringify({ ...g.ship, ...patch, log })) as ShipInfo;
    const sd = shipDate !== undefined ? { shipDate: shipDate || undefined } : {};
    void saveOrders(g.bundleId ? g.orders.map((o) => ({ ...o, bundle: { ...o.bundle!, ship, ...sd } })) : [{ ...g.orders[0], ship, ...sd }]);
  };
  // 기록 문장 만들기
  const dotD = (d?: string | null) => (d ? d.replace(/-/g, '.') : '');
  const describe = (g: Group, patch: Partial<ShipInfo>, shipDate?: string | null): string[] => {
    const out: string[] = [];
    const cur = curOf(g);
    const old = g.ship as Record<string, unknown>;
    for (const [k, v] of Object.entries(patch) as [keyof ShipInfo, unknown][]) {
      if (k === 'log' || JSON.stringify(old[k] ?? null) === JSON.stringify(v ?? null)) continue;
      if (k === 'onBoardDate' && 'etd' in patch) continue; // ETD 를 따라 바뀐 건 ETD 줄에 같이 ("ON BOARD 도 같이")
      if (k in STEP_NAME) out.push(`${STEP_NAME[k as StepKey]} ${v ? '✓' : '체크 해제'}`);
      else if (k === 'received') out.push(v === undefined ? '실제 입금 지움' : `실제 입금 ${fmtCur(cur, v as number)}`);
      else if (k === 'receivedMemo') out.push(v ? `입금 메모 "${v}"` : '입금 메모 지움');
      else if (k === 'files') {
        const o = (old.files ?? {}) as Record<string, RequestFile[]>;
        const n = (v ?? {}) as Record<string, RequestFile[]>;
        for (const st of new Set([...Object.keys(o), ...Object.keys(n)])) {
          const a = o[st]?.length ?? 0;
          const b = n[st]?.length ?? 0;
          if (a !== b) out.push(`📎 ${FILE_STEP_LABEL[st as FileStep] ?? st} 파일 ${b > a ? `추가 (${(n[st] ?? []).at(-1)?.name ?? ''})` : '삭제'}`);
        }
      } else if (k === 'claimIds') {
        const a = (old.claimIds as string[] | undefined) ?? [];
        const b = (v as string[] | undefined) ?? [];
        const name = (id: string) => claims.find((c) => c.id === id)?.title ?? '클레임';
        b.filter((x) => !a.includes(x)).forEach((x) => out.push(`🧾 클레임 연결 "${name(x)}"`));
        a.filter((x) => !b.includes(x)).forEach((x) => out.push(`🧾 클레임 끊음 "${name(x)}"`));
      } else if (k === 'etd' && g.ship.onBoardDate) out.push(`ETD ${v ? dotD(String(v)) : '지움'} (ON BOARD 도 같이)`);
      else out.push(`${FIELD_NAME[k] ?? k} ${v === undefined || v === '' ? '지움' : /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? dotD(String(v)) : String(v)}`);
    }
    if (shipDate !== undefined && (shipDate || '') !== (g.shipDate ?? '')) out.push(shipDate ? `관리부출고 ${dotD(shipDate)}` : '관리부출고 날짜 지움');
    return out;
  };
  // 구매확인서 업체 (국내 수출 형태): 외화정리 · 수출면장 · ON BOARD 는 없는 단계 → 못 누름
  const isPurchase = (g: Group) => companyById.get(g.companyId ?? '')?.exportForm === '구매확인서';
  const NO_PURCHASE: string[] = ['fx', 'license', 'onBoard'];
  const step = (g: Group, k: StepKey, label: string) => {
    const on = !!g.ship[k];
    if (isPurchase(g) && NO_PURCHASE.includes(k))
      return (
        <span className="sh-step na" title={`구매확인서 업체라 ${label}은 없어요`}>
          –
        </span>
      );
    // 조원 · 무역사무: 모든 단계 체크 (팀장님 · 이사님은 보기만)
    const can = !readOnly && (!trade || TRADE_STEPS.includes(k));
    return can ? (
      <button className={`sh-step ${on ? 'on' : ''}`} title={`${label} ${on ? '완료 (누르면 취소)' : '— 누르면 완료'}`} onClick={() => saveShip(g, { [k]: !on })}>
        {on ? '●' : '○'}
      </button>
    ) : (
      <span className={`sh-step ro ${on ? 'on' : ''}`} title={`${label} ${on ? '완료' : '아직'} (조에서 체크)`}>
        {on ? '●' : '○'}
      </span>
    );
  };
  // 단계별 링크 · 사진 · 파일 (무역사무가 올리고 조원도 봄)
  const clip = (g: Group, k: FileStep) => {
    const n = g.ship.files?.[k]?.length ?? 0;
    if ((!trade || readOnly) && !n) return null;
    if (isPurchase(g) && NO_PURCHASE.includes(k) && !n) return null;
    return (
      <button className={`sh-clip ${n ? 'has' : ''}`} onClick={() => setFiles({ key: g.key, step: k })} title={trade && !readOnly ? '링크 · 사진 · 파일 올리기 / 보기' : '올린 링크 · 사진 · 파일 보기'}>
        📎{n ? n : '+'}
      </button>
    );
  };
  // 묶음 상세 (목록에서 펼침 · 달력에서 누르면 창): 출고 일정 + 안의 주문
  const detailBody = (g: Group) => (
    <>
                            {/* 구매확인서 업체는 DOC · CARGO · ETD · ETA 없음 */}
                            {!isPurchase(g) && (
                            <>
                            <div className="sh-detail-h small">{trade ? '출고 일정 (조에서 써요)' : '출고 일정 — 눌러서 날짜 · 항구를 써요'}</div>
                          <div className="sh-dates">
                            {(
                              [
                                ['docCls', 'DOC CLS'],
                                ['cargoCls', 'CARGO CLS'],
                                ['etd', 'ETD'],
                                ['eta', 'ETA'],
                              ] as const
                            ).map(([k, l]) => (
                              <div key={k} className={`sh-dl ${g.ship[k] ? 'set' : ''}`}>
                                {/* ETD · ETA: 이름 바로 옆에 항구 */}
                                <span className="sh-dl-h">
                                  {l}
                                  {(k === 'etd' || k === 'eta') &&
                                    (trade ? (
                                      (k === 'etd' ? g.ship.etdPort : g.ship.etaPort) && <span className="sh-port-ro">{k === 'etd' ? g.ship.etdPort : g.ship.etaPort}</span>
                                    ) : (
                                      <TextInput
                                        className="sh-port"
                                        placeholder="항구"
                                        value={k === 'etd' ? g.ship.etdPort : g.ship.etaPort}
                                        onSave={(v) => saveShip(g, k === 'etd' ? { etdPort: v || undefined } : { etaPort: v || undefined })}
                                      />
                                    ))}
                                </span>
                                <span className="sh-dl-v">
                                  {trade ? <div className="cell-view">{g.ship[k] ? g.ship[k]!.replace(/-/g, '.') : '-'}</div> : <DateCell value={g.ship[k]} onSave={(v) => saveShip(g, { [k]: v || undefined })} />}
                                  {/* DOC · CARGO CLS: 시간 (몇 시) */}
                                  {(k === 'docCls' || k === 'cargoCls') &&
                                    (trade ? (
                                      g.ship[k === 'docCls' ? 'docClsTime' : 'cargoClsTime'] && <span className="sh-hour-ro">{g.ship[k === 'docCls' ? 'docClsTime' : 'cargoClsTime']}시</span>
                                    ) : (
                                      <select
                                        className="sh-hour"
                                        value={g.ship[k === 'docCls' ? 'docClsTime' : 'cargoClsTime'] ?? ''}
                                        onChange={(e) => saveShip(g, { [k === 'docCls' ? 'docClsTime' : 'cargoClsTime']: e.target.value || undefined })}
                                        title="몇 시"
                                      >
                                        <option value="">시간</option>
                                        {Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0')).map((h) => (
                                          <option key={h} value={h}>
                                            {h}시
                                          </option>
                                        ))}
                                      </select>
                                    ))}
                                </span>
                              </div>
                            ))}
                          </div>
                            </>
                            )}
                            {/* 안의 주문: 클레임 '주문 상세' 와 같은 표 */}
                            <div className="detail-table-wrap">
                              <table className="detail-table">
                                <thead>
                                  <tr>
                                    <th>주문</th>
                                    <th>주문일자</th>
                                    <th>매장코드</th>
                                    <th>출고 장소</th>
                                    <th>패킹 완료일</th>
                                    <th className="r">원화 금액</th>
                                    <th className="r">외화 금액</th>
                                    <th>출고 승인</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {g.orders.map((o) => (
                                    <tr key={o.id}>
                                      <td>
                                        <a className="detail-order-link" href={`#/orders?c=${o.companyId ?? ''}&o=${o.id}`} title="주문 관리에서 보기">
                                          <b>{o.name}</b>
                                        </a>
                                        {o.note && <div className="detail-note">{o.note}</div>}
                                      </td>
                                      <td className="nowrap">{o.orderDate?.replace(/-/g, '.') ?? ''}</td>
                                      <td>{o.storeCode ?? ''}</td>
                                      <td>{o.shipFrom ?? ''}</td>
                                      <td>{o.packing ?? ''}</td>
                                      <td className="r">{o.amountKRW !== undefined ? `₩${Math.round(o.amountKRW).toLocaleString()}` : '-'}</td>
                                      <td className="r">{o.amountForeign !== undefined && o.amountForeign !== null ? fmtCur(fgnCur(o), o.amountForeign) : '-'}</td>
                                      <td className="nowrap">
                                        <span className={`tag ${o.outStatus === 'approved' ? 'green' : 'gray'}`}>
                                          {o.outStatus === 'approved' ? `승인${o.outDate ? ` ${dot(o.outDate)}` : ''}` : o.outStatus === 'partial' ? '일부 승인' : '대기'}
                                        </span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                                {g.orders.length > 1 && (
                                  <tfoot>
                                    <tr>
                                      <td colSpan={5}>합계</td>
                                      <td className="r">₩{Math.round(g.orders.reduce((a, o) => a + (o.amountKRW ?? 0), 0)).toLocaleString()}</td>
                                      <td className="r">{fmtCur(fgnCur(g.orders[0]), g.orders.reduce((a, o) => a + (o.amountForeign ?? 0), 0))}</td>
                                      <td />
                                    </tr>
                                  </tfoot>
                                )}
                              </table>
                            </div>
    </>
  );
  const curOf = (g: Group) => fxc.curOf(g.orders[0]);
  // 패킹 승인 금액: 그 업체 수출 통화로 — 원화로 거래하는 업체(수출 통화 KRW)는 원화 금액, 아니면 외화 금액
  const packing = (g: Group) => g.approved.reduce((a, o) => a + ((curOf(g) === 'KRW' ? o.amountKRW : o.amountForeign) ?? 0), 0);
  // 클레임 연결: 이 출고에서 빼고 받을 클레임 금액 → 입금 받아야 하는 금액 = 패킹 승인 − 클레임 (같은 통화만 뺌)
  const claimTeam = (c: Claim) => (c as Claim & { team?: string }).team;
  const claimCur = (c: Claim) => (c.currency === 'FOREIGN' ? companyById.get(c.companyId ?? '')?.exportCurrency || 'USD' : c.currency || 'KRW');
  const linkedClaims = (g: Group) => (g.ship.claimIds ?? []).map((id) => claims.find((c) => c.id === id && claimTeam(c) === g.team)).filter((c): c is Claim => !!c);
  const expected = (g: Group) => {
    const ls = linkedClaims(g);
    if (!ls.length) return null;
    const cur = curOf(g);
    const same = ls.filter((c) => claimCur(c) === cur).reduce((a, c) => a + (c.claimAmount ?? 0), 0);
    const other = ls.filter((c) => claimCur(c) !== cur);
    return { amount: Math.round((packing(g) - same) * 100) / 100, claimSum: same, other };
  };
  const fileGroup = files ? groups.find((g) => g.key === files.key) : undefined;

  return (
    <div className="page">
      <div className="page-head">
        <h1>출고 관리</h1>
        <p className="muted">
          {readOnly
            ? '1~3조에서 출고 승인된 주문을 묶음별로 모아 봐요 (보기만 · 고치는 건 각 조와 무역사무에서).'
            : trade
            ? '각 조에서 출고 승인된 주문이 묶음별로 들어와요. 실제 입금을 쓰고 외화정리 · 수출면장 · 배차 · ON BOARD · 출고마감 · 결재서류를 체크하고, 관리부출고는 날짜를 써요 (그 조 주문 관리 출고일에 같이). 📎 로 단계마다 링크 · 사진 · 파일을 올리면 조원도 봐요.'
            : '주문 관리에서 출고 승인된 주문이 묶음별로 들어와요. 묶음 이름을 누르면 안의 주문이 보여요. 붉은 칸(실제 입금 · ON BOARD)은 조원이 쓰는 칸이에요. 관리부출고 날짜는 주문 관리 출고일에 같이 들어가요.'}
        </p>
      </div>
      {tabs}
      {/* 맨 위: 목록 · 달력 */}
      <div className="sh-viewbar">
        <span className="seg">
          <button className={view === 'list' ? 'on' : ''} onClick={() => pickView('list')}>
            📋 목록
          </button>
          <button className={view === 'cal' ? 'on' : ''} onClick={() => pickView('cal')}>
            📅 달력
          </button>
          {viewExtra}
        </span>
      </div>
      {/* 그 아래: 거르기 · 검색 · 업체 고르기 */}
      <div className="card toolbar sh-toolbar">
        <div className="sh-filter-row">
          {view === 'list' && (
            <span className="seg">
              {(
                [
                  ['open', '진행중'],
                  ['done', '완료'],
                  ['all', '전체'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {l} {k === 'open' ? base.filter((g) => !isDone(g)).length : k === 'done' ? base.filter(isDone).length : base.length}
                </button>
              ))}
            </span>
          )}
          {trade && (
            <select value={teamF} onChange={(e) => (setTeamF(e.target.value), setCo(''))}>
              <option value="">조 전체</option>
              {teams.map((t) => (
                <option key={t} value={t}>
                  {t}조
                </option>
              ))}
            </select>
          )}
          {view === 'list' ? (
            <input className="search sh-search" placeholder="🔍 묶음 · 주문 · 매장코드 · 업체" value={q} onChange={(e) => setQ(e.target.value)} />
          ) : (
            <span className="seg sh-kinds" title="달력에 볼 일정 (여러 개 고를 수 있어요)">
              <button className={!kinds.length ? 'on' : ''} onClick={() => setKinds([])}>
                전체
              </button>
              {(['doc', 'cargo', 'etd', 'eta'] as CalKind[]).map((k) => (
                <button key={k} className={`k-btn-${k} ${kinds.includes(k) ? 'on' : ''}`} onClick={() => setKinds((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))}>
                  {KIND_LABEL[k].replace(' CLS', '')}
                </button>
              ))}
            </span>
          )}
          <button className={`sh-co-toggle ${co ? 'set' : ''}`} onClick={() => setCoOpen((v) => !v)}>
            {co ? (
              <>
                <span className="dot" style={{ background: companyById.get(co)?.color }} /> {companyById.get(co)?.name ?? co}
              </>
            ) : (
              '업체 선택'
            )}{' '}
            {coOpen ? '▴' : '▾'}
          </button>
        </div>
        {/* 업체 고르기: 주문 관리처럼 칩 (전체도 볼 수 있음) */}
        {coOpen && (
        <div className="company-chips sh-cos">
          <button className={`cchip ${!co ? 'on' : ''}`} onClick={() => (setCo(''), setCoOpen(false))}>
            업체 전체 <span className="cchip-n">{groups.filter((g) => (!teamF || g.team === teamF) && !isDone(g)).length}</span>
          </button>
          {coIds.map((id) => {
            const c = companyById.get(id);
            const n = groups.filter((g) => g.companyId === id && (!teamF || g.team === teamF) && !isDone(g)).length;
            return (
              <button key={id} className={`cchip ${co === id ? 'on' : ''}`} style={{ '--c': c?.color ?? '#999' } as CSSProperties} onClick={() => (setCo(co === id ? '' : id), setCoOpen(false))} title={co === id ? '다시 누르면 업체 전체' : '이 업체만'}>
                <span className="dot" style={{ background: c?.color }} />
                {c?.name ?? id}
                <span className="cchip-n">{n}</span>
                {co === id && <span className="cchip-x">✕</span>}
              </button>
            );
          })}
        </div>
        )}
      </div>

      {view === 'cal' ? (
        <ShipCalendar
          groups={base}
          coName={(id) => (companyById.get(id ?? '')?.name ?? '').replace(/\s*\(.*\)\s*$/, '')}
          onLabel={(g, label) => saveShip(g, { calLabel: label || undefined })}
          onOpen={(g) => setCalPick(g.key)}
          kinds={kinds}
        />
      ) : (
      <div className="card sh-card">
        {shown.length === 0 ? (
          <p className="muted small">{groups.length ? '여기 해당하는 출고가 없어요.' : '아직 출고 승인된 주문이 없어요. 주문 관리에서 출고 승인이 되면 여기 들어와요.'}</p>
        ) : (
          <div className="table-scroll">
            <table className="sh-table">
              <thead>
                <tr>
                  <th className="sh-name-h">묶음 · 출고 일정</th>
                  <th className="r">패킹 승인 금액</th>
                  <th className="sh-th-team" title="조원이 쓰는 칸">실제 입금</th>
                  <th className="sh-c">외화정리</th>
                  <th className="sh-c">수출면장</th>
                  <th className="sh-c">배차</th>
                  <th className="sh-c">관리부출고</th>
                  <th className="sh-c sh-th-team" title="조원이 체크하는 칸">ON BOARD</th>
                  <th className="sh-c">출고마감</th>
                  <th className="sh-c">결재서류</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((g) => {
                  const cur = curOf(g);
                  return (
                    <Fragment key={g.key}>
                      <tr className={`sh-row ${isDone(g) ? 'done' : ''} ${lastSeen === g.key ? 'last-seen' : ''}`} style={{ '--c': g.color ?? companyById.get(g.companyId ?? '')?.color ?? '#8c2f3c' } as CSSProperties}>
                        <td className="sh-name">
                          <button className="sh-title" onClick={() => setCalPick(g.key)} title="눌러서 상세 (출고 일정 · 안의 주문)">
                            <span className="sh-dot" />
                            {g.team && <span className="sh-team">{g.team}조</span>}
                            <b>{g.name}</b>
                            <span className="muted small">
                              {companyById.get(g.companyId ?? '')?.name ?? ''} · 주문 {g.orders.length}개{g.approved.length < g.orders.length ? ` (승인 ${g.approved.length})` : ''} ›
                            </span>
                          </button>
                          {/* 출고 일정은 묶음을 눌러 상세에서 써요 — 여기엔 적힌 것만 짧게 */}
                          {(g.ship.docCls || g.ship.cargoCls || g.ship.etd || g.ship.eta) && (
                            <div className="sh-dates-sum small">
                              {g.ship.docCls && <span className="k-doc">DOC {dot(g.ship.docCls)}{g.ship.docClsTime ? ` ${g.ship.docClsTime}시` : ''}</span>}
                              {g.ship.cargoCls && <span className="k-cargo">CARGO {dot(g.ship.cargoCls)}{g.ship.cargoClsTime ? ` ${g.ship.cargoClsTime}시` : ''}</span>}
                              {g.ship.etd && <span className="k-etd">ETD {dot(g.ship.etd)}{g.ship.etdPort ? ` ${g.ship.etdPort}` : ''}</span>}
                              {g.ship.eta && <span className="k-eta">ETA {dot(g.ship.eta)}{g.ship.etaPort ? ` ${g.ship.etaPort}` : ''}</span>}
                            </div>
                          )}
                        </td>
                        <td className="r sh-amt">
                          {fmtCur(cur, packing(g)) || '-'}
                          {(() => {
                            const ex = expected(g);
                            return ex ? (
                              <div className="sh-expect" title={`클레임 ${fmtCur(cur, ex.claimSum)} 뺀 금액`}>
                                받을 {fmtCur(cur, ex.amount)}
                              </div>
                            ) : null;
                          })()}
                        </td>
                        <td className="sh-recv">
                          {readOnly ? (
                            <>
                              <div className="sh-amt">{g.ship.received !== undefined ? fmtCur(cur, g.ship.received) : <span className="muted">-</span>}</div>
                              {g.ship.receivedMemo && <div className="muted small">{g.ship.receivedMemo}</div>}
                            </>
                          ) : (
                            <>
                              <div className="sh-money-row">
                                <MoneyInput cur={cur} value={g.ship.received} onSave={(v) => saveShip(g, { received: v })} />
                                <MemoInput value={g.ship.receivedMemo} onSave={(v) => saveShip(g, { receivedMemo: v || undefined })} />
                              </div>
                            </>
                          )}
                        </td>
                        <td className="sh-c">
                          {step(g, 'fx', '외화정리')}
                          {clip(g, 'fx')}
                        </td>
                        <td className="sh-c">
                          {step(g, 'license', '수출면장')}
                          {clip(g, 'license')}
                        </td>
                        <td className="sh-c">
                          {step(g, 'truck', '배차')}
                          {clip(g, 'truck')}
                        </td>
                        <td className="sh-c sh-out">
                          {/* 관리부출고: 날짜를 쓰면 완료 · 그 날짜가 주문 관리 출고일 */}
                          <span className={`sh-step ${g.shipDate ? 'on' : ''}`} aria-hidden="true">
                            {g.shipDate ? '●' : '○'}
                          </span>
                          {readOnly ? <div className="cell-view">{g.shipDate ? g.shipDate.replace(/-/g, '.') : '-'}</div> : <DateCell value={g.shipDate} onSave={(v) => saveShip(g, {}, v ?? null)} />}
                          {clip(g, 'out')}
                        </td>
                        <td className="sh-c sh-out">
                          {step(g, 'onBoard', 'ON BOARD')}
                          {/* ON BOARD 날짜: 기본은 ETD 날짜 (흐리게) · 눌러서 바꾸면 그 날짜 + ON BOARD 완료 · 지우면 다시 ETD (구매확인서 업체는 없음) */}
                          {!isPurchase(g) &&
                            (() => {
                              const d = g.ship.onBoardDate ?? g.ship.etd;
                              const fromEtd = !g.ship.onBoardDate && !!g.ship.etd;
                              return (
                                <div className={fromEtd ? 'sh-from-etd' : ''} title={fromEtd ? 'ETD 날짜를 그대로 보여주는 중 — 눌러서 바꿀 수 있어요' : 'ON BOARD 날짜'}>
                                  {readOnly ? (
                                    d && <div className="cell-view">{d.replace(/-/g, '.')}</div>
                                  ) : (
                                    <DateCell value={d} onSave={(v) => saveShip(g, v ? { onBoardDate: v, onBoard: true } : { onBoardDate: undefined })} />
                                  )}
                                  {/* 딜레이: ON BOARD − ETD (ETD 는 안 바뀜 · ETD 가 바뀌면 ETD 칸에서) */}
                                  {d && g.ship.etd && (() => {
                                    const n = Math.round((Date.parse(d) - Date.parse(g.ship.etd)) / 86400000);
                                    return (
                                      <div className={`sh-delay ${n > 0 ? 'late' : ''}`} title="ON BOARD − ETD (ETD 가 바뀐 거면 ETD 칸에서 바꿔 주세요 — ON BOARD 도 같이 바뀌어요)">
                                        (딜레이 {n >= 0 ? '+' : ''}
                                        {n}일)
                                      </div>
                                    );
                                  })()}
                                </div>
                              );
                            })()}
                        </td>
                        <td className="sh-c">
                          {step(g, 'closeOut', '출고마감')}
                          {clip(g, 'closeOut')}
                        </td>
                        <td className="sh-c">
                          {step(g, 'papers', '결재서류')}
                          {clip(g, 'papers')}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}
      {calPick &&
        (() => {
          const g = groups.find((x) => x.key === calPick);
          if (!g) return null;
          const cur = curOf(g);
          const stepTxt = (k: StepKey, l: string) =>
            isPurchase(g) && NO_PURCHASE.includes(k) ? null : (
            <span key={k} className={`sh-pill ${g.ship[k] ? 'on' : ''}`}>
              {g.ship[k] ? '●' : '○'} {l}
            </span>
          );
          return (
            <Modal
              title={`🚚 ${g.team ? `${g.team}조 · ` : ''}${g.name}`}
              onClose={() => setCalPick(null)}
              wide
              headExtra={
                <label className="sh-cal-name small" title="달력에 쓰는 이름 · 비우면 묶음 이름 앞 5글자 · 이 묶음 날짜 모두에 같이 바뀌어요">
                  <span>📅 달력 이름</span>
                  {readOnly ? <b>{g.ship.calLabel || g.name.slice(0, 5)}</b> : <TextInput value={g.ship.calLabel} placeholder={g.name.slice(0, 5)} onSave={(v) => saveShip(g, { calLabel: v || undefined })} />}
                </label>
              }
            >
              <div className="sh-pop">
                <p className="muted small" style={{ marginTop: 0 }}>
                  {companyById.get(g.companyId ?? '')?.name ?? ''} · 주문 {g.orders.length}개 · 패킹 승인 <b>{fmtCur(cur, packing(g)) || '-'}</b>
                  {g.ship.received !== undefined && <> · 실제 입금 <b>{fmtCur(cur, g.ship.received)}</b></>}
                  {g.ship.receivedMemo && ` (${g.ship.receivedMemo})`}
                  {(() => {
                    const ex = expected(g);
                    return ex ? (
                      <span className="sh-expect-line">
                        입금 받아야 하는 금액 <b>{fmtCur(cur, ex.amount)}</b> <span className="muted">(패킹 승인 − 클레임 {fmtCur(cur, ex.claimSum)})</span>
                        {ex.other.length > 0 && <span className="warn"> · 통화가 다른 클레임 {ex.other.map((c) => fmtCur(claimCur(c), c.claimAmount ?? 0)).join(', ')} 은 안 뺐어요</span>}
                      </span>
                    ) : null;
                  })()}
                </p>
                <div className="sh-pills">
                  {stepTxt('fx', '외화정리')}
                  {stepTxt('license', '수출면장')}
                  {stepTxt('truck', '배차')}
                  <span className={`sh-pill ${g.shipDate ? 'on' : ''}`}>{g.shipDate ? '●' : '○'} 관리부출고{g.shipDate ? ` ${dot(g.shipDate)}` : ''}</span>
                  {stepTxt('onBoard', 'ON BOARD')}
                  {stepTxt('closeOut', '출고마감')}
                  {stepTxt('papers', '결재서류')}
                </div>
                {detailBody(g)}
                {/* 🧾 클레임 연결: 이 출고에서 뺄 클레임 → 위 '입금 받아야 하는 금액' */}
                <div className="sh-claims">
                  <b className="small">🧾 클레임 연결</b>
                  {linkedClaims(g).map((c) => (
                    <span key={c.id} className="rq-order-chip">
                      {c.title} · {fmtCur(claimCur(c), c.claimAmount ?? 0) || '금액 없음'}
                      {!readOnly && (
                        <button className="link" onClick={() => saveShip(g, { claimIds: (g.ship.claimIds ?? []).filter((x) => x !== c.id) })}>
                          끊기
                        </button>
                      )}
                    </span>
                  ))}
                  {(() => {
                    const pool = claims.filter((c) => claimTeam(c) === g.team && !(g.ship.claimIds ?? []).includes(c.id));
                    const same = pool.filter((c) => c.companyId === g.companyId);
                    const list = (same.length ? same : pool).sort((a, b) => String(b.shipDate ?? b.createdAt ?? '').localeCompare(String(a.shipDate ?? a.createdAt ?? '')));
                    if (readOnly) return !linkedClaims(g).length && <span className="muted small">연결한 클레임 없음</span>;
                    return list.length ? (
                      <select
                        value=""
                        onChange={(e) => e.target.value && saveShip(g, { claimIds: [...(g.ship.claimIds ?? []), e.target.value] })}
                        title="이 출고에서 뺄 클레임"
                      >
                        <option value="">+ 클레임 연결하기</option>
                        {list.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title} · {fmtCur(claimCur(c), c.claimAmount ?? 0) || '금액 없음'}
                            {c.companyId !== g.companyId ? ` (${companyById.get(c.companyId ?? '')?.name ?? '다른 업체'})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      !linkedClaims(g).length && <span className="muted small">연결할 클레임이 없어요 (클레임 탭에서 먼저 기록)</span>
                    );
                  })()}
                </div>
                {/* 📜 기록: 누가 뭘 눌렀는지 (최근 것부터) */}
                <details className="sh-log">
                  <summary className="small">📜 기록 {g.ship.log?.length ? `(${g.ship.log.length})` : ''}</summary>
                  {g.ship.log?.length ? (
                    <ul className="small">
                      {[...g.ship.log].reverse().map((l, i) => (
                        <li key={i}>
                          <span className="muted">{new Date(l.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span> <b>{l.by}</b>
                          {l.role && <span className="muted"> ({l.role})</span>} · {l.what}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">아직 기록이 없어요 (이제부터 바꾸는 것마다 남아요).</p>
                  )}
                </details>
              </div>
            </Modal>
          );
        })()}
      {files && fileGroup && (
        <ShipFiles
          title={`${fileGroup.team ? `${fileGroup.team}조 · ` : ''}${fileGroup.name} · ${FILE_STEP_LABEL[files.step]}`}
          list={fileGroup.ship.files?.[files.step] ?? []}
          canEdit={trade && !readOnly}
          folder={`${fileGroup.team ?? 'x'}-${fileGroup.key.replace(/[^\w-]/g, '_')}`}
          onChange={(next) => saveShip(fileGroup, { files: { ...(fileGroup.ship.files ?? {}), [files.step]: next.length ? next : undefined } })}
          onClose={() => setFiles(null)}
        />
      )}
    </div>
  );
}

/** 단계별 링크 · 사진 · 파일: 무역사무는 올리고 지우기 · 조원은 보기 */
function ShipFiles({ title, list, canEdit, folder, onChange, onClose }: { title: string; list: RequestFile[]; canEdit: boolean; folder: string; onChange: (next: RequestFile[]) => void; onClose: () => void }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const isImg = (f: RequestFile) => /\.(png|jpe?g|gif|webp|heic)$/i.test(f.name) || f.url.startsWith('data:image');
  const addLink = () => {
    const u = link.trim();
    if (!u) return;
    const url = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    onChange([...list, { name: u.replace(/^https?:\/\//i, '').slice(0, 60), url }]);
    setLink('');
  };
  const upload = async (fs: FileList | File[] | null) => {
    if (!fs?.length) return;
    setBusy(true);
    setErr('');
    try {
      const added: RequestFile[] = [];
      for (const f of Array.from(fs)) {
        if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name}: 20MB 넘는 파일은 못 올려요`);
        added.push(await uploadShipFile(folder, f));
      }
      onChange([...list, ...added]);
    } catch (e) {
      setErr(`올리지 못했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  // 끌어다 놓기 · Ctrl+V (캡처한 사진 등) 로도 올림
  const [over, setOver] = useState(false);
  const uploadRef = useRef(upload);
  uploadRef.current = upload;
  useEffect(() => {
    if (!canEdit) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (!files.length) return; // 글자 붙여넣기는 그대로 (링크 칸)
      e.preventDefault();
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      void uploadRef.current(files.map((f, i) => (/^image\.\w+$/i.test(f.name) || !f.name ? new File([f], `붙여넣기_${stamp}${i ? `_${i}` : ''}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`, { type: f.type }) : f)));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [canEdit]);
  return (
    <Modal title={`📎 ${title}`} onClose={onClose}>
      <div
        className={`sh-drop ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (!canEdit) return;
          e.preventDefault();
          setOver(false);
          void upload(Array.from(e.dataTransfer.files));
        }}
      >
      {list.length === 0 ? (
        <p className="muted small">아직 올린 게 없어요.</p>
      ) : (
        <ul className="sh-files">
          {list.map((f, i) => (
            <li key={`${f.url}-${i}`}>
              <a href={f.url} target="_blank" rel="noreferrer">
                {isImg(f) ? <img src={f.url} alt="" /> : <span>{f.path ? '📄' : '🔗'}</span>}
                <span className="sh-file-name">{f.name}</span>
              </a>
              {canEdit && (
                <button
                  className="link small danger-text"
                  onClick={() => {
                    if (!confirm(`'${f.name}' 을(를) 뺄까요?`)) return;
                    void deleteRequestFile(f);
                    onChange(list.filter((_, j) => j !== i));
                  }}
                >
                  빼기
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="sh-file-add">
          <input placeholder="링크 붙여넣기 (https://…)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} />
          <button onClick={addLink} disabled={!link.trim()}>
            링크 넣기
          </button>
          <button className="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? '올리는 중…' : '📷 사진 · 파일'}
          </button>
          <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />
        </div>
      )}
      {canEdit && <p className="muted small sh-drop-hint">{busy ? '올리는 중…' : '파일을 여기로 끌어다 놓거나, 캡처한 사진은 Ctrl+V 로 바로 올려요'}</p>}
      </div>
      {err && <p className="warn small">{err}</p>}
    </Modal>
  );
}

// ───────── 달력: DOC CLS (연두) · CARGO CLS (보라) · ETD / ETA (흰) · 출고 (빨강)
type CalKind = 'doc' | 'cargo' | 'etd' | 'eta' | 'out';
type CalEv = { date: string; kind: CalKind; text: string; g: Group };
const KIND_LABEL: Record<CalEv['kind'], string> = { doc: 'DOC CLS', cargo: 'CARGO CLS', etd: 'ETD', eta: 'ETA', out: '출고' };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function ShipCalendar({ groups, coName, onLabel, onOpen, kinds }: { groups: Group[]; coName: (id: string | null) => string; onLabel: (g: Group, label: string) => void; onOpen: (g: Group) => void; kinds: CalKind[] }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [edit, setEdit] = useState<{ key: string; v: string } | null>(null);
  const labelOf = (g: Group) => g.ship.calLabel || g.name.slice(0, 5);
  const events = useMemo(() => {
    const out: CalEv[] = [];
    for (const g of groups) {
      const head = `${coName(g.companyId)}) ${labelOf(g)}`;
      const add = (date: string | undefined, kind: CalEv['kind'], extra = '') => date && (!kinds.length || kinds.includes(kind)) && out.push({ date, kind, text: `${head} ${KIND_LABEL[kind]}${extra ? ` ${extra}` : ''}`, g });
      add(g.ship.docCls, 'doc', g.ship.docClsTime ? `${g.ship.docClsTime}시` : '');
      add(g.ship.cargoCls, 'cargo', g.ship.cargoClsTime ? `${g.ship.cargoClsTime}시` : '');
      add(g.ship.etd, 'etd', g.ship.etdPort);
      add(g.ship.eta, 'eta', g.ship.etaPort);
      add(g.shipDate, 'out');
    }
    const order: CalEv['kind'][] = ['out', 'doc', 'cargo', 'etd', 'eta'];
    return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups, kinds]);
  const byDate = new Map<string, CalEv[]>();
  for (const e of events) byDate.set(e.date, [...(byDate.get(e.date) ?? []), e]);
  // 이 달 달력: 일요일부터 6주
  const start = new Date(month);
  start.setDate(1 - start.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
  const weeks = days[35].getMonth() !== month.getMonth() ? 5 : 6;
  const todayIso = ymd(new Date());
  const go = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="card sh-cal">
      <div className="sh-cal-head">
        <b>
          {month.getFullYear()}년 {month.getMonth() + 1}월
        </b>
        <span className="sh-cal-legend small">
          <i className="k-doc" /> DOC CLS <i className="k-cargo" /> CARGO CLS <i className="k-etd" /> ETD · ETA <i className="k-out" /> 출고
        </span>
        <span className="sh-cal-nav">
          <button onClick={() => go(-1)} aria-label="이전 달">
            ‹
          </button>
          <button
            onClick={() => {
              const d = new Date();
              setMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            }}
          >
            오늘
          </button>
          <button onClick={() => go(1)} aria-label="다음 달">
            ›
          </button>
        </span>
      </div>
      <div className="sh-cal-grid">
        {['일', '월', '화', '수', '목', '금', '토'].map((w) => (
          <div key={w} className="sh-cal-w">
            {w}
          </div>
        ))}
        {days.slice(0, weeks * 7).map((d) => {
          const iso = ymd(d);
          const evs = byDate.get(iso) ?? [];
          return (
            <div key={iso} className={`sh-cal-day ${d.getMonth() !== month.getMonth() ? 'other' : ''} ${d.getDay() === 0 || d.getDay() === 6 ? 'weekend' : ''} ${iso === todayIso ? 'today' : ''}`}>
              <span className="sh-cal-num">{d.getDate() === 1 ? `${d.getMonth() + 1}월 1일` : d.getDate()}</span>
              {evs.map((e, i) => {
                const key = `${iso}-${e.g.key}-${e.kind}-${i}`;
                return edit?.key === key ? (
                  <input
                    key={key}
                    className="sh-ev-edit"
                    autoFocus
                    value={edit.v}
                    maxLength={20}
                    title="달력에 쓰는 묶음 이름 (이 묶음 날짜 모두에 같이 바뀌어요) · 비우면 묶음 이름 앞 5글자"
                    onChange={(x) => setEdit({ key, v: x.target.value })}
                    onKeyDown={(x) => {
                      if (x.key === 'Enter') (x.target as HTMLInputElement).blur();
                      if (x.key === 'Escape') setEdit(null);
                    }}
                    onBlur={() => {
                      if (edit.v.trim() !== labelOf(e.g)) onLabel(e.g, edit.v.trim() === e.g.name.slice(0, 5) ? '' : edit.v.trim());
                      setEdit(null);
                    }}
                  />
                ) : (
                  <button
                    key={key}
                    className={`sh-ev k-${e.kind}`}
                    title={`${e.text}\n누르면 주문 상세`}
                    onClick={() => onOpen(e.g)}
                  >
                    {e.text}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted small" style={{ margin: '8px 0 0' }}>
        일정을 누르면 그 묶음의 상세 창이 열려요 (출고 일정 · 안의 주문 · 달력에 쓰는 이름)
      </p>
    </div>
  );
}

/** 짧은 글 칸 (항구 등): 칸에서 나가면 저장 */
function TextInput({ value, onSave, placeholder, className }: { value?: string; onSave: (v: string) => void; placeholder?: string; className?: string }) {
  const [v, setV] = useState(value ?? '');
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setV(value ?? '');
  }
  return (
    <input
      className={className}
      placeholder={placeholder}
      maxLength={30}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value ?? '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 실제 입금 금액: 칸에서 나가면 저장 */
function MoneyInput({ cur, value, onSave }: { cur: string; value?: number; onSave: (v?: number) => void }) {
  const show = (v?: number) => (v === undefined ? '' : v.toLocaleString(undefined, { maximumFractionDigits: 2 }));
  const [v, setV] = useState(show(value));
  const [last, setLast] = useState(value);
  if (last !== value) {
    setLast(value);
    setV(show(value));
  }
  return (
    <span className="sh-money">
      <span className="muted small">{cur}</span>
      <input
        inputMode="decimal"
        placeholder="입금액"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = num(v);
          if (n !== value) onSave(n);
          setV(show(n));
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}
/** 짧은 메모: 입금액 옆 📝 아이콘 · 누르면 칸 · 적은 메모는 아래 작은 글자 (누르면 고침) */
function MemoInput({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(value ?? '');
  const start = () => (setV(value ?? ''), setOpen(true));
  return (
    <>
      <button className={`sh-memo-btn ${value ? 'has' : ''}`} onClick={start} title={value ? `메모: ${value} (누르면 고침)` : '메모 쓰기'}>
        📝
      </button>
      {open ? (
        <input
          className="sh-memo"
          autoFocus
          placeholder="메모"
          maxLength={80}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            if (v.trim() !== (value ?? '')) onSave(v.trim());
            setOpen(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setOpen(false);
          }}
        />
      ) : (
        value && (
          <button className="sh-memo-view" onClick={start} title="눌러서 메모 고치기">
            {value}
          </button>
        )
      )}
    </>
  );
}
