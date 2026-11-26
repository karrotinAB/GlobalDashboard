// 도구함 › 4. 업무협조전 (지금은 관리자만): 종류를 고르면 제목 · 양식이 나오고 빈칸만 채움
//   주문을 연결하면 나라 · 업체 · 매장 · 주문일자 · 패킹완료일이 자동으로 · 제목 / 내용 따로 클립보드 복사
//   연락처: 기본 = 나 (주소록 이름 · 회사번호) · 다른 사람으로 바꿀 수 있음
import { useEffect, useMemo, useState } from 'react';
import { useAccess } from '../components/AuthGate';
import { usePeople } from '../components/AddressBook';
import { parseDate } from '../components/DateInput';
import { useLookups, useStore } from '../data/store';
import { useStoreNames } from '../lib/storeNames';
import type { Order } from '../types';

const dot = (s?: string | null) => (s ? s.slice(0, 10).replace(/-/g, '.') : '');
const coShort = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();

/** 업무협조전 종류 (양식 추가는 여기에) */
const KINDS = [{ key: 'packing', label: '1. 주문 등록 후 패킹 요청' }] as const;
type Kind = (typeof KINDS)[number]['key'];

interface Draft {
  kind: Kind;
  companyId: string;
  country: string;
  coName: string;
  orderIds: string[];
  extraLines: string[]; // 주문 말고 직접 쓴 주문일자 줄
  content: string; // 1. 내용 (비우면 자동)
  note1: string;
  note2: string;
  packDate: string; // 비우면 자동 (연결한 주문 패킹완료일 중 가장 늦은 날)
  personEmail: string;
  personName: string; // 비우면 주소록 이름
  personPhone: string; // 비우면 주소록 회사번호
}
const EMPTY: Draft = { kind: 'packing', companyId: '', country: '', coName: '', orderIds: [], extraLines: [], content: '', note1: '', note2: '', packDate: '', personEmail: '', personName: '', personPhone: '' };
const LS = 'gd:coopDraft';

export default function Coop() {
  const access = useAccess();
  const { data } = useStore();
  const { myCompanies: companies, companyById } = useLookups();
  const { roles, contacts } = usePeople();
  const [d, setD] = useState<Draft>(() => {
    try {
      return { ...EMPTY, ...(JSON.parse(localStorage.getItem(LS) ?? '{}') as Partial<Draft>) };
    } catch {
      return EMPTY;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LS, JSON.stringify(d));
    } catch {
      /* 무시 */
    }
  }, [d]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const co = companyById.get(d.companyId);
  const coOrders = useMemo(
    () => data.orders.filter((o) => o.companyId === d.companyId).sort((a, b) => String(b.orderDate ?? b.createdAt).localeCompare(String(a.orderDate ?? a.createdAt))),
    [data.orders, d.companyId],
  );
  const linked = d.orderIds.map((id) => data.orders.find((o) => o.id === id)).filter((o): o is Order => !!o);
  const stores = [...new Set(linked.map((o) => String(o.storeCode ?? '').trim()).filter(Boolean))];
  const storeNames = useStoreNames(stores, stores.length > 0);

  // 자동으로 채우는 값
  const country = d.country || co?.country || '';
  const coName = d.coName || coShort(co?.name ?? '');
  const autoContent =
    stores.length === 1 ? [country, storeNames[stores[0]] || coName, stores[0], '패킹 요청'].filter(Boolean).join(' ') : [country, coName, stores.join(', '), stores.length ? '패킹 요청' : ''].filter(Boolean).join(' ');
  const content = d.content || autoContent;
  const autoPack = linked.map((o) => (o.packing ? parseDate(o.packing) : null)).filter((x): x is string => !!x).sort().at(-1) ?? '';
  const packDate = d.packDate || dot(autoPack);
  // 연락처: 기본 = 나
  const people = useMemo(
    () =>
      (roles ?? [])
        .filter((r) => r.role !== 'auditor')
        .map((r) => ({ email: r.email, name: contacts[r.email]?.name || r.name || r.email.split('@')[0], phone: contacts[r.email]?.office ?? '' }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [roles, contacts],
  );
  const personEmail = d.personEmail || access.email;
  const person = people.find((p) => p.email === personEmail);
  const personName = d.personName || person?.name || access.accountName || '';
  const personPhone = d.personPhone || person?.phone || '';

  const orderLines = [...linked.map((o) => `- ${o.storeCode ?? ''} ${dot(o.orderDate)} 주문`.replace(/\s+/g, ' ')), ...d.extraLines.filter((x) => x.trim()).map((x) => (x.trim().startsWith('-') ? x.trim() : `- ${x.trim()}`))];
  const title = `(업무협조전-글로벌사업부) ${[country, coName].filter(Boolean).join(' ')} 패킹 요청`;
  const body = [
    '상기의 건에 대하여 아래와 같이 요청하오니 업무 협조 바랍니다.',
    '',
    '-------------- 아      래 ---------------',
    '',
    `1. 내 용 :  ${content}`,
    ...(d.note1.trim() ? [d.note1.trim()] : []),
    '',
    '2. 주문일자',
    ...orderLines,
    ...(d.note2.trim() ? [d.note2.trim()] : []),
    '',
    `3. 패킹완료일자: ${packDate}`,
    '',
    '',
    `해당 업무협조전 관련 사항은 글로벌사업부 ${[personName, personPhone].filter(Boolean).join(' ')} 에게 연락 바랍니다. 끝.`,
  ].join('\n');

  const [copied, setCopied] = useState('');
  const copy = async (what: 'title' | 'body') => {
    const t = what === 'title' ? title : body;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(''), 1500);
  };
  const missing = [!country && '나라', !coName && '업체', !orderLines.length && '주문일자', !packDate && '패킹완료일자', !personName && '연락처 이름'].filter(Boolean) as string[];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>🤝 업무협조전</h1>
          <p className="muted">종류를 고르고 빈칸만 채우면 돼요. 주문을 연결하면 나라 · 업체 · 매장 · 주문일자 · 패킹완료일이 자동으로 들어가요. 다 되면 제목 / 내용을 따로 복사해요.</p>
        </div>
      </div>
      <div className="coop-grid">
        <section className="card coop-form">
          <label className="coop-row">
            <span>종류</span>
            <select value={d.kind} onChange={(e) => set({ kind: e.target.value as Kind })}>
              {KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <label className="coop-row">
            <span>업체</span>
            <select value={d.companyId} onChange={(e) => set({ companyId: e.target.value, orderIds: [], country: '', coName: '' })}>
              <option value="">업체 고르기</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="coop-row two">
            <label>
              <span>나라</span>
              <input value={d.country} placeholder={co?.country || '나라'} onChange={(e) => set({ country: e.target.value })} />
            </label>
            <label>
              <span>업체명</span>
              <input value={d.coName} placeholder={coShort(co?.name ?? '') || '업체명'} onChange={(e) => set({ coName: e.target.value })} />
            </label>
          </div>

          <div className="coop-row">
            <span>주문 연결</span>
            <div className="coop-orders">
              {linked.map((o) => (
                <span key={o.id} className="rq-order-chip">
                  {o.name} · {o.storeCode} · {dot(o.orderDate)}
                  <button className="link" onClick={() => set({ orderIds: d.orderIds.filter((x) => x !== o.id) })}>
                    ✕
                  </button>
                </span>
              ))}
              <select value="" disabled={!d.companyId} onChange={(e) => e.target.value && set({ orderIds: [...d.orderIds, e.target.value] })}>
                <option value="">{d.companyId ? '+ 주문 추가하기' : '(업체를 먼저 골라요)'}</option>
                {coOrders
                  .filter((o) => !d.orderIds.includes(o.id))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} · {o.storeCode ?? ''} · {dot(o.orderDate)}
                    </option>
                  ))}
              </select>
            </div>
          </div>

          <label className="coop-row">
            <span>1. 내용</span>
            <input value={d.content} placeholder={autoContent || '예: 몽골 ○○점 826701 에어건 패킹 요청'} onChange={(e) => set({ content: e.target.value })} />
          </label>
          <label className="coop-row">
            <span className="muted">비고 (필요시)</span>
            <textarea rows={2} value={d.note1} onChange={(e) => set({ note1: e.target.value })} />
          </label>
          <div className="coop-row">
            <span>2. 주문일자</span>
            <div className="coop-lines">
              {linked.length === 0 && d.extraLines.length === 0 && <span className="muted small">주문을 연결하면 '- 매장번호 주문일자 주문' 이 자동으로 들어가요</span>}
              {linked.map((o) => (
                <div key={o.id} className="muted small">
                  - {o.storeCode} {dot(o.orderDate)} 주문
                </div>
              ))}
              {d.extraLines.map((x, i) => (
                <div key={i} className="coop-extra">
                  <input value={x} placeholder="826701 2026.11.20 주문" onChange={(e) => set({ extraLines: d.extraLines.map((y, j) => (j === i ? e.target.value : y)) })} />
                  <button className="link" onClick={() => set({ extraLines: d.extraLines.filter((_, j) => j !== i) })}>
                    ✕
                  </button>
                </div>
              ))}
              <button className="link small" onClick={() => set({ extraLines: [...d.extraLines, ''] })}>
                + 줄 직접 추가
              </button>
            </div>
          </div>
          <label className="coop-row">
            <span className="muted">비고 (필요시)</span>
            <textarea rows={2} value={d.note2} onChange={(e) => set({ note2: e.target.value })} />
          </label>
          <label className="coop-row">
            <span>3. 패킹완료일자</span>
            <input value={d.packDate} placeholder={dot(autoPack) || '2026.12.09'} onChange={(e) => set({ packDate: e.target.value })} />
          </label>

          <div className="coop-row">
            <span>연락처</span>
            <div className="coop-person">
              <select value={personEmail} onChange={(e) => set({ personEmail: e.target.value, personName: '', personPhone: '' })}>
                {!people.some((p) => p.email === personEmail) && <option value={personEmail}>{personName || '나'}</option>}
                {people.map((p) => (
                  <option key={p.email} value={p.email}>
                    {p.name}
                    {p.email === access.email ? ' (나)' : ''}
                  </option>
                ))}
              </select>
              <input value={d.personName} placeholder={person?.name || '이름'} onChange={(e) => set({ personName: e.target.value })} title="이름 (비우면 주소록 이름)" />
              <input value={d.personPhone} placeholder={person?.phone || '회사번호'} onChange={(e) => set({ personPhone: e.target.value })} title="회사번호 (비우면 주소록 회사번호)" />
            </div>
          </div>
          <button className="link small" onClick={() => confirm('다 비우고 새로 쓸까요?') && setD({ ...EMPTY, kind: d.kind })}>
            ↺ 새로 쓰기
          </button>
        </section>

        <section className="card coop-preview">
          <div className="coop-copy">
            <b>제목</b>
            <button className={copied === 'title' ? 'primary' : ''} onClick={() => void copy('title')}>
              {copied === 'title' ? '✓ 복사됨' : '📋 제목 복사'}
            </button>
          </div>
          <pre className="coop-text coop-title">{title}</pre>
          <div className="coop-copy">
            <b>내용</b>
            <button className={copied === 'body' ? 'primary' : ''} onClick={() => void copy('body')}>
              {copied === 'body' ? '✓ 복사됨' : '📋 내용 복사'}
            </button>
          </div>
          <pre className="coop-text">{body}</pre>
          {missing.length > 0 && <p className="warn small">아직 빈 칸: {missing.join(' · ')}</p>}
        </section>
      </div>
    </div>
  );
}
