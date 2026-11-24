import { useAccess } from '../components/AuthGate';
import { useMirrorClaims } from '../lib/teamClaims';
import { rectOf, viewW } from '../lib/zoom';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useIsMobile } from '../lib/useMobile';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { today, uid } from '../lib/date';
import { isOrderDone, type Claim, type ClaimFile, type Order } from '../types';
import { EditableText, MoreMenu } from '../components/SheetCells';
import { Modal } from '../components/ui';
import { AmountCell, fmtFX, fmtKRW, parseAmount } from '../components/OrderCells';
import DateInput from '../components/DateInput';
import CompanyPicker from '../components/CompanyPicker';
import { LinkedTeamView } from './Overview';
import { storage } from '../firebase';
import { claimConverted, claimCur, claimCurOptions, claimPacking, curOptionLabel, fmtMoney, useClaimFx } from '../lib/claimCur';
import { exportCur } from '../lib/sales';

type Source = {
  key: string;
  source: Claim['source'];
  sourceId?: string;
  label: string;
  companyId: string | null;
  krw: number;
  fx: number;
  date?: string; // 주문일자 (묶음은 가장 최근)
  done: boolean; // 출고 완료
  count?: number; // 묶음 안 주문 수
  detail?: string; // 묶음 안 주문 이름들
};

const sum = (os: Order[], k: 'amountKRW' | 'amountForeign') => os.reduce((a, o) => a + (o[k] ?? 0), 0);

export default function Claims() {
  const auditorView = !!useAccess().auditor; // IT 검토용 계정
  const { data, save, saveMany, remove } = useStore();
  // 팀장님·이사님: '내 담당'에서 뺀 업체라도 클레임이 있으면 계속 보이고, ＋ 업체 추가에서 모든 업체(1~3조 포함)를 고를 수 있게
  //  (클레임 있는 업체는 칩으로, 나머지는 ＋ 업체 추가 목록에)
  const { companies, companyById } = useLookups();
  const allClaims = [...data.claims, ...useMirrorClaims(auditorView ? [] : companies)]; // 조 업체 클레임도 (칩·숫자) · IT팀은 이미 같이 불러옴
  // 주문 관리의 [클레임] 버튼으로 오면 #/claims?c=업체id
  const [companyFilter, setCompanyFilterState] = useState(() => {
    const fromLink = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c');
    try {
      if (fromLink) localStorage.setItem('gd:claims:sheet', fromLink);
      return fromLink ?? localStorage.getItem('gd:claims:sheet') ?? '';
    } catch {
      return fromLink ?? '';
    }
  });
  const setCompanyFilter = (id: string) => {
    setCompanyFilterState(id);
    try {
      localStorage.setItem('gd:claims:sheet', id);
    } catch {
      /* 저장 안 돼도 괜찮음 */
    }
  };
  const [showCompanies, setShowCompanies] = useState(false);
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState<Claim | null>(null);
  const isMobile = useIsMobile();
  const [mOpen, setMOpen] = useState<string | null>(null); // 휴대폰: 눌러서 펼친 클레임
  /** 묶음 이름을 나중에 바꿔도 따라가게: 지금 묶음/주문 이름, 없으면 저장된 이름 */
  const liveTitle = (c: Claim) =>
    (c.source === 'bundle'
      ? data.orders.find((o) => o.bundle?.id === c.sourceId)?.bundle?.name
      : c.source === 'order'
        ? data.orders.find((o) => o.id === c.sourceId)?.name
        : undefined) || c.title;
  const sheet = companyById.get(companyFilter);

  /** 클레임을 걸 수 있는 대상: 묶음(이름으로) + 개별 주문 */
  const sources = useMemo(() => {
    const list: Source[] = [];
    const bundles = new Map<string, Order[]>();
    for (const o of data.orders) if (o.bundle) bundles.set(o.bundle.id, [...(bundles.get(o.bundle.id) ?? []), o]);
    for (const [id, os] of bundles) {
      const b = os[0].bundle!;
      list.push({
        key: `b:${id}`,
        source: 'bundle',
        sourceId: id,
        label: b.name || `이름 없는 묶음 (${os.length}건)`,
        companyId: os[0].companyId,
        krw: sum(os, 'amountKRW'),
        fx: sum(os, 'amountForeign'),
        date: os.map((o) => o.orderDate ?? '').sort().pop(),
        done: os.every(isOrderDone),
        count: os.length,
        detail: os.map((o) => o.name).join(', '),
      });
    }
    // 개별 주문은 묶이지 않은 것만 (묶인 주문은 묶음으로만 고름)
    for (const o of data.orders.filter((x) => !x.bundle).sort((a, b) => (b.orderDate ?? '').localeCompare(a.orderDate ?? '')))
      list.push({ key: `o:${o.id}`, source: 'order', sourceId: o.id, label: o.name, companyId: o.companyId, krw: o.amountKRW ?? 0, fx: o.amountForeign ?? 0, date: o.orderDate, done: isOrderDone(o) });
    return list;
  }, [data.orders]);

  /** 패킹금액: 직접 쓴 값이 있으면 그것, 없으면 묶음/주문의 원화·외화 금액 (실시간, 통화가 다르면 출고날짜 환율로) */
  const fxTable = useClaimFx(data.claims, (k) => companyById.get(k.companyId ?? ''));
  const packingOf = (c: Claim): number | undefined => claimPacking(c, data.orders, companyById.get(c.companyId ?? ''), fxTable);
  const curOptions = claimCurOptions([...companies, ...(data.companies ?? [])]);

  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return data.claims
      .filter((c) => !companyFilter || !sheet || c.companyId === companyFilter)
      .filter((c) => !query || `${c.title} ${c.note ?? ''} ${companyById.get(c.companyId ?? '')?.name ?? ''}`.toLowerCase().includes(query))
      .sort((a, b) => claimKey(b) - claimKey(a) || b.createdAt.localeCompare(a.createdAt));
  }, [data.claims, companyFilter, sheet, q, companyById]);

  // 끌어서 순서 바꾸기: 지금 보이는 줄들의 순서값을 그대로 다시 나눠 씀 (클수록 위)
  const dragRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setOver(null);
  };
  const dropOn = (targetId: string, after: boolean) => {
    const fromId = dragRef.current;
    endDrag();
    if (!fromId || fromId === targetId) return;
    const from = rows.find((c) => c.id === fromId);
    if (!from) return;
    const keys = rows.map(claimKey).sort((a, b) => b - a);
    const list = rows.filter((c) => c.id !== fromId);
    list.splice(list.findIndex((c) => c.id === targetId) + (after ? 1 : 0), 0, from);
    const changed = list.map((c, i) => ({ ...c, sort: keys[i] - i * 0.001 })).filter((c) => data.claims.find((x) => x.id === c.id)?.sort !== c.sort);
    saveMany('claims', changed);
  };

  const patch = (c: Claim, p: Partial<Claim>) => save('claims', { ...c, ...p });

  // 파일: Storage 로 올리기 (Firebase 요금제가 Blaze 여야 켜짐) / 링크 붙이기
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<Claim | null>(null);
  const upload = async (c: Claim, file: File) => {
    setMsg(`'${file.name}' 올리는 중…`);
    try {
      const path = `claims/${c.id}/${Date.now()}-${file.name}`;
      const r = storageRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      patch(c, { files: [...(c.files ?? []), { name: file.name, url, path }] });
      setMsg('');
    } catch (e) {
      const code = (e as { code?: string }).code ?? '';
      setMsg(
        code.includes('unauthorized') || code.includes('unknown') || code.includes('bucket') || code.includes('project-not-found')
          ? '파일 저장소(Storage)가 아직 안 켜져 있어요. 관리자가 Firebase 에서 Storage 를 켜기 전까지는 🔗 링크로 붙여 주세요.'
          : `파일을 못 올렸어요 (${code || (e as Error).message})`,
      );
    }
  };
  const addLink = (c: Claim) => {
    const url = prompt('파일 링크를 붙여 넣어 주세요 (구글 드라이브 · 공유폴더 등)');
    if (!url?.trim()) return;
    const name = prompt('보여줄 이름 (비우면 링크 그대로)', '') || url.trim();
    patch(c, { files: [...(c.files ?? []), { name, url: url.trim() }] });
  };
  const removeFile = async (c: Claim, f: ClaimFile) => {
    if (!confirm(`'${f.name}' 을(를) 뺄까요?`)) return;
    if (f.path) await deleteObject(storageRef(storage, f.path)).catch(() => {});
    patch(c, { files: (c.files ?? []).filter((x) => x !== f) });
  };

  // 팀장님·이사님: 조 업체를 고르면 그 조의 클레임을 그대로 (보기만)
  // IT 검토용: 조 업체도 바로 고칠 수 있게 (고친 건 IT팀 사본 · 가짜 데이터)
  if (sheet?.team && !auditorView) return <LinkedTeamView company={sheet} kind="claims" onBack={() => setCompanyFilter('')} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>클레임</h1>
          <p className="muted">
            묶음이나 주문을 고르면 패킹금액을 주문 관리에서 자동으로 가져와요 (통화 선택 · 업체 수출 통화와 다르면 출고날짜 환율로 바꿔요). 클레임 금액을 쓰면 비율이 계산돼요.
          </p>
        </div>
      </div>

      {!sheet ? (
        <div className="pick-company">
          <p>
            <b>업체를 골라주세요</b> · 고른 업체의 클레임을 볼 수 있어요
          </p>
          <CompanyPicker
            companies={companies}
            hasData={(c) => allClaims.some((x) => x.companyId === c.id)}
            badge={(c) => {
              const open = allClaims.filter((x) => x.companyId === c.id && !x.refunded).length;
              return open > 0 && <span className="cchip-n red">{open}</span>;
            }}
            onPick={(id) => setCompanyFilter(id)}
            emptyText="아직 클레임이 있는 업체가 없어요. ＋ 업체 추가를 눌러 시작해요."
          />
        </div>
      ) : (
      <>
      <div className="toolbar">
        <button
          className={`company-toggle ${sheet || showCompanies ? 'on' : ''}`}
          onClick={() => setCompanyFilter('')}
          title="다른 업체 고르기"
        >
          {sheet ? (
            <>
              <span className="dot" style={{ background: sheet.color }} />
              {sheet.name} ✕
            </>
          ) : (
            <>업체 고르기 {showCompanies ? '▴' : '▾'}</>
          )}
        </button>
        <input className="search" placeholder="이름 / 비고 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        {showCompanies && !sheet && (
          <CompanyPicker
            companies={companies}
            hasData={(c) => allClaims.some((x) => x.companyId === c.id)}
            onPick={(id) => {
              setCompanyFilter(id);
              setShowCompanies(false);
            }}
          />
        )}
      </div>

      {msg && <div className="banner">{msg}</div>}

      <input
        ref={fileInput}
        type="file"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f && uploadFor.current) upload(uploadFor.current, f);
          e.target.value = '';
        }}
      />

      <div className="table-scroll claims-wrap">
        <table className="claim-table">
          <thead>
            <tr>
              <th className="k-date">출고날짜</th>
              <th className="k-title">업체명 및 주문</th>
              <th className="k-cur">통화</th>
              <th className="k-amt">패킹금액</th>
              <th className="k-amt">클레임 금액</th>
              <th className="k-rate">
                <span className="hide-m">클레임 </span>비율
              </th>
              <th className="k-chk">
                서류<span className="hide-m">작성</span>
              </th>
              <th className="k-chk">
                환급<span className="hide-m"> 완료</span>
              </th>
              <th className="k-files">파일</th>
              <th className="k-note">비고</th>
              <th className="k-more" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const packing = packingOf(c);
              const rate = packing && c.claimAmount !== undefined ? (c.claimAmount / packing) * 100 : undefined;
              const company = companyById.get(c.companyId ?? '');
              const cur = claimCur(c, company);
              const money = (v: number) => fmtMoney(cur, v);
              return (
                <tr
                  key={c.id}
                  className={`${c.refunded ? 'is-refunded' : c.docDone ? 'is-doc' : ''} ${mOpen === c.id ? 'm-open' : ''} ${dragId === c.id ? 'row-dragging' : ''} ${
                    over?.id === c.id ? (over.after ? 'drop-after' : 'drop-before') : ''
                  }`}
                  onDragOver={(e) => {
                    if (!dragRef.current) return;
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > r.top + r.height / 2;
                    if (over?.id !== c.id || over.after !== after) setOver({ id: c.id, after });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOn(c.id, over?.id === c.id ? over.after : false);
                  }}
                >
                  <td className="k-date" data-label="출고날짜">
                    <span
                      className="row-handle k-handle"
                      draggable
                      title="끌어서 위치 바꾸기"
                      onDragStart={(e) => {
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', c.title);
                        const tr = e.currentTarget.closest('tr');
                        if (tr) e.dataTransfer.setDragImage(tr, 20, 14);
                        dragRef.current = c.id;
                        setTimeout(() => setDragId(c.id), 0);
                      }}
                      onDragEnd={endDrag}
                    >
                      ⠿
                    </span>
                    <ClaimDate value={c.shipDate} onSave={(v) => patch(c, { shipDate: v })} />
                  </td>
                  <td className="k-title">
                    <div className="k-title-wrap">
                      <span className="k-icon" title={c.source === 'bundle' ? '묶음' : c.source === 'order' ? '주문' : '직접 입력'}>
                        {c.source === 'bundle' ? '🔗' : '💼'}
                      </span>
                      <button className="k-title-btn" onClick={() => (isMobile ? setMOpen(mOpen === c.id ? null : c.id) : setDetail(c))} title={isMobile ? '눌러서 자세히' : '눌러서 포함된 주문 보기'}>
                        {liveTitle(c)}
                      </button>
                      {!sheet && company && <span className="k-co">{company.country || company.name}</span>}
                    </div>
                  </td>
                  <td className="k-cur" data-label="통화">
                    <select
                      className={`cur-pill cur-sel ${cur === 'KRW' ? 'krw' : 'fx'}`}
                      title="통화 바꾸기 (패킹금액은 주문에서 다시 가져와요)"
                      value={cur}
                      onChange={(e) => patch(c, { currency: e.target.value, packingOverride: undefined })}
                    >
                      {[...curOptions, ...(curOptions.includes(cur) ? [] : [cur])].map((x) => (
                        <option key={x} value={x}>
                          {curOptionLabel(x)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="k-amt" data-label="패킹금액">
                    <div className="k-amt-wrap" title={c.packingOverride !== undefined ? '직접 쓴 금액' : '주문 관리에서 자동으로 가져온 금액'}>
                      <AmountCell
                        value={packing}
                        kind={cur === 'KRW' ? 'krw' : 'fx'}
                        display={money}
                        ph={cur === 'KRW' ? '₩' : fmtMoney(cur, 0).replace(/0$/, '')}
                        onSave={(v) => patch(c, { packingOverride: v })}
                      />
                      {c.packingOverride === undefined && packing !== undefined && (
                        <span className="auto-tag" title={claimConverted(c, company) ? `${exportCur(company)} 주문 금액을 출고날짜 환율로 바꾼 금액` : undefined}>
                          {claimConverted(c, company) ? '환산' : '자동'}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="k-amt" data-label="클레임 금액">
                    <AmountCell value={c.claimAmount} kind={cur === 'KRW' ? 'krw' : 'fx'} display={money} ph={cur === 'KRW' ? '₩' : fmtMoney(cur, 0).replace(/0$/, '')} onSave={(v) => patch(c, { claimAmount: v })} />
                  </td>
                  <td className="k-rate">{rate === undefined ? '' : `${rate.toFixed(3)}%`}</td>
                  <td className="k-chk">
                    <input type="checkbox" checked={c.docDone} onChange={() => patch(c, { docDone: !c.docDone })} aria-label="서류작성" />
                  </td>
                  <td className="k-chk">
                    <input type="checkbox" checked={c.refunded} onChange={() => patch(c, { refunded: !c.refunded })} aria-label="환급 완료" />
                  </td>
                  <td className="k-files" data-label="파일">
                    <div className="files">
                      {(c.files ?? []).map((f) => (
                        <span key={f.url} className="file-chip">
                          <a href={f.url} target="_blank" rel="noreferrer" title={f.name}>
                            📎 {f.name}
                          </a>
                          <button className="x" onClick={() => removeFile(c, f)} aria-label="빼기">
                            ×
                          </button>
                        </span>
                      ))}
                      {DATA_MODE === 'firestore' && (
                        <button
                          className="file-add"
                          title="파일 올리기"
                          onClick={() => {
                            uploadFor.current = c;
                            fileInput.current?.click();
                          }}
                        >
                          ＋파일
                        </button>
                      )}
                      <button className="file-add" title="링크 붙이기" onClick={() => addLink(c)}>
                        🔗
                      </button>
                    </div>
                  </td>
                  <td className="k-note" data-label="비고">
                    {isMobile ? (
                      <EditableText value={c.note ?? ''} oneLine expand placeholder="비고" onSave={(v) => patch(c, { note: v || undefined })} />
                    ) : (
                      <NoteCell value={c.note ?? ''} onSave={(v) => patch(c, { note: v || undefined })} />
                    )}
                  </td>
                  <td className="k-more">
                    {/* 휴대폰: 펼쳤을 때 포함된 주문 보기 */}
                    <button className="link small k-m-orders" onClick={() => setDetail(c)}>
                      📦 포함된 주문 보기
                    </button>
                    <MoreMenu
                      items={[{ label: '🗑 삭제', danger: true, onClick: () => confirm(`'${c.title}' 클레임을 삭제할까요?`) && remove('claims', c.id) }]}
                    />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="muted small pad">
                  아직 클레임이 없어요. 아래에서 묶음이나 주문을 골라 추가해 주세요.
                </td>
              </tr>
            )}
            <AddClaimRow
              curOptions={curOptions}
              defaultCur={exportCur(sheet)}
              sources={sources.filter((s) => s.companyId === sheet.id)}
              onAdd={(c) => save('claims', { ...c, companyId: sheet.id })}
            />
          </tbody>
        </table>
      </div>
      </>
      )}
      {detail && (
        <ClaimDetail
          title={liveTitle(detail)}
          orders={detail.source === 'bundle' ? data.orders.filter((o) => o.bundle?.id === detail.sourceId) : data.orders.filter((o) => o.id === detail.sourceId)}
          companyName={companyById.get(detail.companyId ?? '')?.name}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  );
}

function ClaimDate({ value, onSave }: { value?: string; onSave: (v?: string) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <DateInput autoFocus value={value} onChange={onSave} onDone={() => setEditing(false)} />;
  const d = value ? new Date(value) : null;
  return (
    <div className="cell-view editable nowrap" onClick={() => setEditing(true)}>
      {d ? `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일` : <span className="cell-ph">날짜</span>}
    </div>
  );
}

/** 표 맨 아래 '+ 클레임 추가': 묶음/주문 고르기 → 통화 · 출고날짜 · 클레임 금액 */
function AddClaimRow({ sources, curOptions, defaultCur, onAdd }: { sources: Source[]; curOptions: string[]; defaultCur: string; onAdd: (c: Claim) => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [currency, setCurrency] = useState<string>(defaultCur);
  const [shipDate, setShipDate] = useState<string | undefined>();
  const [claim, setClaim] = useState('');
  const [picking, setPicking] = useState(false);
  const src = sources.find((s) => s.key === key);

  if (!open) {
    return (
      <tr className="add-row">
        <td colSpan={11}>
          <button className="add-row-btn" onClick={() => setOpen(true)}>
            + 클레임 추가
          </button>
        </td>
      </tr>
    );
  }

  const pick = (k: string) => {
    setKey(k);
    const s = sources.find((x) => x.key === k);
    if (s) {
      setCurrency(s.fx > 0 || s.krw === 0 ? defaultCur : 'KRW');
    }
  };
  const submit = () => {
    if (!src) return; // 묶음이나 주문을 골라야 추가됨
    const t = src.label;
    onAdd({
      id: uid(),
      companyId: src?.companyId ?? null,
      source: src?.source ?? 'manual',
      sourceId: src?.sourceId,
      title: t,
      currency,
      claimAmount: parseAmount(claim),
      shipDate,
      docDone: false,
      refunded: false,
      createdAt: today(),
    });
    setKey('');
    setClaim('');
    setShipDate(undefined);
  };

  return (
    <tr className="add-row editing">
      <td className="k-date" data-add="출고날짜">
        <DateInput value={shipDate} onChange={setShipDate} placeholder="출고날짜" />
      </td>
      <td className="k-title" data-add="묶음 · 주문">
        <button className="pick-source" onClick={() => setPicking(true)} autoFocus>
          {src ? (
            <>
              {src.source === 'bundle' ? '🔗' : '💼'} {src.label} <span className="muted">· 바꾸기</span>
            </>
          ) : (
            '📋 묶음 · 주문 고르기'
          )}
        </button>
        {picking && (
          <SourcePicker
            sources={sources}
            onClose={() => setPicking(false)}
            onPick={(k) => {
              pick(k);
              setPicking(false);
            }}
          />
        )}
      </td>
      <td className="k-cur" data-add="통화">
        <select className="cell-input" value={currency} onChange={(e) => setCurrency(e.target.value)}>
          {curOptions.map((x) => (
            <option key={x} value={x}>
              {curOptionLabel(x)}
            </option>
          ))}
        </select>
      </td>
      <td className="k-amt k-add-pack muted small" data-add="패킹금액">{src ? (currency === 'KRW' ? fmtMoney('KRW', src.krw || undefined) : currency === defaultCur ? fmtMoney(currency, src.fx || undefined) : '환율로 바꿔요') || '금액 없음' : '자동'}</td>
      <td className="k-amt k-add-claim" data-add="클레임 금액">
        <input
          className="cell-input amt"
          placeholder="클레임 금액"
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()}
        />
      </td>
      <td colSpan={5} className="muted small k-add-go">
        Enter 또는 <button className="link small" onClick={submit}>추가</button>
      </td>
      <td className="k-more">
        <button className="icon-btn" title="닫기" onClick={() => setOpen(false)}>
          ✕
        </button>
      </td>
    </tr>
  );
}

/** 묶음 · 주문 고르기 팝업: 완료된 것까지 전부, 검색 가능 */
function SourcePicker({ sources, onClose, onPick }: { sources: Source[]; onClose: () => void; onPick: (key: string) => void }) {
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase();
  const list = sources.filter((s) => !query || `${s.label} ${s.detail ?? ''}`.toLowerCase().includes(query));
  const bundles = list.filter((s) => s.source === 'bundle');
  const orders = list.filter((s) => s.source === 'order');
  const row = (s: Source) => (
    <button key={s.key} className={`src-row ${s.done ? 'done' : ''}`} onClick={() => onPick(s.key)}>
      <span className="src-icon">{s.source === 'bundle' ? '🔗' : '💼'}</span>
      <span className="src-main">
        <b>{s.label}</b>
        {s.detail && <span className="muted small"> · {s.count}건: {s.detail}</span>}
      </span>
      <span className="src-date">{s.date ? s.date.slice(2).replace(/-/g, '.') : ''}</span>
      <span className="src-amt">{s.krw ? fmtKRW(s.krw) : ''}</span>
      <span className="src-amt">{s.fx ? fmtFX(s.fx) : ''}</span>
      <span className={`tag ${s.done ? 'green' : 'gray'}`}>{s.done ? '완료' : '진행중'}</span>
    </button>
  );
  return (
    <Modal title="묶음 · 주문 고르기" onClose={onClose} wide>
      <input className="src-search" autoFocus placeholder="이름으로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="src-list">
        {bundles.length > 0 && <h4>🔗 묶음 ({bundles.length})</h4>}
        {bundles.map(row)}
        {orders.length > 0 && <h4>💼 묶이지 않은 주문 ({orders.length})</h4>}
        {orders.map(row)}
        {!list.length && <p className="muted small">맞는 묶음·주문이 없어요.</p>}
      </div>
    </Modal>
  );
}

/** 클레임 이름을 누르면: 그 묶음/주문에 들어 있는 주문들 (금액 · 주문일자 · 매장코드 · 출고 장소 등) */
function ClaimDetail({ title, orders, companyName, onClose }: { title: string; orders: Order[]; companyName?: string; onClose: () => void }) {
  const list = [...orders].sort((a, b) => (a.orderDate ?? '').localeCompare(b.orderDate ?? ''));
  const krw = sum(list, 'amountKRW');
  const fx = sum(list, 'amountForeign');
  return (
    <Modal title={title} onClose={onClose} wide>
      <p className="muted small detail-sub">
        {companyName} · 주문 {list.length}건{krw ? ` · ${fmtKRW(krw)}` : ''}
        {fx ? ` · ${fmtFX(fx)}` : ''}
      </p>
      {list.length === 0 ? (
        <p className="muted small">연결된 주문을 찾을 수 없어요 (묶음이 풀렸거나 주문이 지워졌을 수 있어요).</p>
      ) : (
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
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id}>
                  <td>
                    <b>{o.name}</b>
                    {o.note && <div className="detail-note">{o.note}</div>}
                  </td>
                  <td className="nowrap">{o.orderDate?.replace(/-/g, '.') ?? ''}</td>
                  <td>{o.storeCode ?? ''}</td>
                  <td>{o.shipFrom ?? ''}</td>
                  <td>{o.packing ?? ''}</td>
                  <td className="r">{fmtKRW(o.amountKRW)}</td>
                  <td className="r">{fmtFX(o.amountForeign)}</td>
                  <td>
                    <span className={`tag ${isOrderDone(o) ? 'green' : 'gray'}`}>{isOrderDone(o) ? '완료' : '진행중'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
            {list.length > 1 && (
              <tfoot>
                <tr>
                  <td colSpan={5}>합계</td>
                  <td className="r">{krw ? fmtKRW(krw) : ''}</td>
                  <td className="r">{fx ? fmtFX(fx) : ''}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </Modal>
  );
}

/** 순서 기준값 (클수록 위): 직접 옮긴 순서, 없으면 출고날짜 (날짜 없는 건 맨 위) */
function claimKey(c: Claim) {
  return c.sort ?? (c.shipDate ? Date.parse(c.shipDate) : Date.parse('9999-01-01'));
}

/** 비고: 칸에는 📝 만 · 마우스 올리면 메모 보이고 · 누르면 아래로 펼쳐서 쓰기
 *  (표가 스크롤 상자라 잘리지 않게 화면 기준 위치로 띄움) */
function NoteCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [edit, setEdit] = useState(false);
  const [hover, setHover] = useState(false);
  const [text, setText] = useState(value);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const place = () => {
    const r = btn.current ? rectOf(btn.current) : null;
    if (r) setPos({ top: r.bottom + 4, right: Math.max(8, viewW() - r.right) });
  };
  // 쓰는 중에 화면을 굴리면 상자도 따라가게
  useEffect(() => {
    if (!edit) return;
    const f = () => {
      const r = btn.current ? rectOf(btn.current) : null;
      if (r) setPos({ top: r.bottom + 4, right: Math.max(8, viewW() - r.right) });
    };
    window.addEventListener('scroll', f, true);
    window.addEventListener('resize', f);
    return () => (window.removeEventListener('scroll', f, true), window.removeEventListener('resize', f));
  }, [edit]);
  const commit = () => {
    setEdit(false);
    if (text.trim() !== value) onSave(text.trim());
  };
  return (
    <div className="k-note-cell">
      <button
        ref={btn}
        className={`k-note-btn ${value ? 'has' : ''}`}
        onMouseEnter={() => (place(), setHover(true))}
        onMouseLeave={() => setHover(false)}
        onClick={() => (place(), setText(value), setEdit(true), setHover(false))}
        aria-label="비고"
      >
        {value ? '📝' : '＋'}
      </button>
      {value && hover && !edit && pos && (
        <div className="k-note-tip" style={{ top: pos.top, right: pos.right }}>
          {value}
        </div>
      )}
      {edit && pos && (
        <div className="k-note-pop" style={{ top: pos.top, right: pos.right }}>
          <textarea
            autoFocus
            rows={4}
            value={text}
            placeholder="비고 (Enter 저장 · Shift+Enter 줄바꿈 · Esc 취소)"
            onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
            onChange={(e) => setText(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                commit();
              }
              if (e.key === 'Escape') setEdit(false);
            }}
          />
          <div className="muted small">Enter 저장 · Shift+Enter 줄바꿈</div>
        </div>
      )}
    </div>
  );
}
