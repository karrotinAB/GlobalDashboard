// 도구함 › 4. 업무협조전 (모두): 종류를 고르면 그 양식이 문서처럼 뜨고, 문서 안 빈칸에 바로 씀 (전도금 신청서처럼)
//   📥 주문 불러오기 → 나라 · 업체 · 매장 · 주문일자 · 패킹완료일이 빈칸에 자동으로 · 제목 / 내용 따로 클립보드 복사
//   연락처: 기본 = 나 (주소록 이름 · 회사번호) · 다른 사람으로 바꿀 수 있음
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAccess } from '../components/AuthGate';
import { usePeople } from '../components/AddressBook';
import { parseDate } from '../components/DateInput';
import { useLookups, useStore } from '../data/store';
import { useStoreNames } from '../lib/storeNames';
import type { Order } from '../types';

const dot = (s?: string | null) => (s ? s.slice(0, 10).replace(/-/g, '.') : '');
const coShort = (n: string) => n.replace(/\s*\(.*\)\s*$/, '').trim();

/** 업무협조전 종류 (양식 추가는 여기에) */
const KINDS = [
  { key: 'packing', no: 1, label: '주문 등록 후 패킹 요청', icon: '📦', color: '#3f7d5a' },
  { key: 'arrival', no: 2, label: '관리부에 입고 안내', icon: '🚛', color: '#b5652b' },
  { key: 'inbound', no: 3, label: '전산 입고 및 패킹리스트 등록 요청', icon: '📥', color: '#2f6fb3' },
  { key: 'out', no: 4, label: '출고 요청', icon: '🚚', color: '#8c2f3c' },
] as const;
const QTY = '주문서상의 주문수량으로 등록';
type Kind = (typeof KINDS)[number]['key'];

type Line = { store: string; date: string };
interface Draft {
  kind: Kind;
  companyId: string;
  country: string;
  coName: string;
  orderIds: string[];
  lines: Line[]; // 2. 주문일자 줄 (주문을 불러오면 채워짐 · 직접 고치고 더할 수 있음)
  content: string; // 1. 내용 (비우면 자동)
  note1: string | null; // 비고 (null = 안 씀)
  note2: string | null;
  packDate: string; // 비우면 자동 (불러온 주문 패킹완료일 중 가장 늦은 날)
  personEmail: string;
  personName: string;
  personPhone: string;
  titleEdit?: string | null; // ✎ 제목을 통째로 직접 고친 것 (null/없음 = 양식대로)
  // 3. 전산 입고 및 패킹리스트 등록 요청
  orderName?: string; // 비우면 불러온 주문 이름 (묶음이면 묶음 이름)
  storeText?: string; // 2. 매장코드 (비우면 불러온 주문 매장코드)
  dateText?: string; // 3. 주문일자 (비우면 불러온 주문 주문일자)
  inboundDate?: string; // 4. 입고등록일자 (직접)
  qty?: string; // 5. 입고 수량 및 패킹수량 (비우면 '주문서상의 주문수량으로 등록')
  note3?: string | null; // 6. 비고 (null = 안 씀)
  // 2. 관리부에 입고 안내
  inDates?: string[]; // 1. 요약: 1) 입고날짜 (요일) — 여러 날 가능
  boxes?: string; // 2. 수량 (몇 박스)
  note4?: string | null; // 수량 아래 비고 (null = 안 씀)
  // 4. 출고 요청
  fcl?: boolean; // 제목에 FCL
  outContent?: string; // 1. 내 용 (비우면 자동: 매장명 매장번호 출고 요청.)
  outDate?: string; // 2. 일 자 (비우면 불러온 주문 관리부 출고일)
  outTime?: string; // 작업시간
  works?: string[]; // 3. 작업 내용 줄 ('- ' 빼고)
  dispatch?: number; // 0 없음 · 1 포워딩 컨테이너 · 2 배차 완료 · 3 배차 필요
  follow?: number; // (1 · 2 일 때) 0 없음 · 1 확인되는대로 전달 · 2 배차정보 직접
  followText?: string;
  yardCode?: string; // 4. 입고지
  yardPerson?: string;
  yardAddr?: string;
  refNote?: string; // 5. 참고사항
}
const DISPATCH = ['', '포워딩업체에서 컨테이너 배송 예정.', '배차 완료', '광혜원 배차 필요'];
const FOLLOW1 = '배차정보 및 컨테이너 정보는 확인되는대로 전달드리겠습니다.';
/** 입고지 세 줄 통째로 붙여넣기 → 장치장코드 · 담당자 · 주소 (이름표가 없으면 순서대로) */
const parseYard = (t: string) => {
  const out: { yardCode?: string; yardPerson?: string; yardAddr?: string } = {};
  const rest: string[] = [];
  for (const raw of t.split(/\r?\n/).map((x) => x.trim()).filter(Boolean)) {
    const m = raw.match(/^(장치장\s*코드|담당자|주\s*소)\s*[:：]?\s*(.*)$/);
    if (m) {
      if (/장치장/.test(m[1])) out.yardCode = m[2];
      else if (/담당/.test(m[1])) out.yardPerson = m[2];
      else out.yardAddr = m[2];
    } else if (!/^입고지\s*[:：]?$/.test(raw)) rest.push(raw.replace(/^입고지\s*[:：]\s*/, ''));
  }
  for (const k of ['yardCode', 'yardPerson', 'yardAddr'] as const) if (out[k] === undefined && rest.length) out[k] = rest.shift();
  return out;
};
const NOTE4 = '*해당 박스는 패킹된채로 관리부 입고되어, 출고될 예정입니다.';
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
/** 2026.11.27 → 2026.11.27 (금) — 날짜로 못 읽으면 그대로 */
const withDay = (s: string) => {
  const iso = parseDate(s);
  return iso ? `${iso.replace(/-/g, '.')} (${WEEK[new Date(`${iso}T00:00:00`).getDay()]})` : s;
};
const EMPTY: Draft = { kind: 'packing', companyId: '', country: '', coName: '', orderIds: [], lines: [], content: '', note1: null, note2: null, packDate: '', personEmail: '', personName: '', personPhone: '' };
const LS = 'gd:coopDraft2';

/** 문서 안 빈칸: 글자 수만큼 넓어지는 입력칸 */
function Blank({ value, auto, onChange, ph, w = 6, className = '' }: { value: string; auto?: string; onChange: (v: string) => void; ph: string; w?: number; className?: string }) {
  const shown = value || auto || '';
  return (
    <input
      className={`coop-blank ${value ? '' : auto ? 'auto' : 'empty'} ${className}`}
      value={shown}
      placeholder={ph}
      size={Math.max(w, [...(shown || ph)].reduce((a, ch) => a + (/[ㄱ-힣]/.test(ch) ? 2 : 1), 0) + 1)}
      onChange={(e) => onChange(e.target.value)}
      title={value ? '' : auto ? '자동으로 채운 값 — 고칠 수 있어요' : ph}
    />
  );
}

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
  const linked = d.orderIds.map((id) => data.orders.find((o) => o.id === id)).filter((o): o is Order => !!o);

  // 📥 주문 불러오기: 주문 · 묶음 (진행중 먼저)
  const [q, setQ] = useState('');
  const [finding, setFinding] = useState(false);
  const hits = useMemo(() => {
    const nq = q.trim().toLowerCase();
    const groups = new Map<string, Order[]>();
    for (const o of data.orders) {
      if (o.erpArchive) continue;
      const k = o.bundle ? `b:${o.bundle.id}` : o.id;
      groups.set(k, [...(groups.get(k) ?? []), o]);
    }
    return [...groups.entries()]
      .map(([k, os]) => {
        const o = os[0];
        const name = o.bundle ? `📦 ${o.bundle.name || '묶음'} (주문 ${os.length}개)` : o.name;
        const coN = companyById.get(o.companyId ?? '')?.name ?? '';
        const hay = [name, coN, ...os.map((x) => `${x.name} ${x.storeCode ?? ''} ${x.orderDate ?? ''}`)].join(' ').toLowerCase();
        const done = os.every((x) => x.closed || x.shipped);
        const last = os.map((x) => x.orderDate ?? x.createdAt).sort().at(-1) ?? '';
        return { k, os, name, hay, done, last, co: coN };
      })
      .filter((h) => !d.companyId || h.os[0].companyId === d.companyId)
      .filter((h) => (nq ? h.hay.includes(nq) : !h.done))
      .sort((a, b) => Number(a.done) - Number(b.done) || b.last.localeCompare(a.last))
      .slice(0, 15);
  }, [q, data.orders, companyById, d.companyId]);
  const loadFrom = (os: Order[], add = false) => {
    setD((x) => {
      const ids = add ? [...new Set([...x.orderIds, ...os.map((o) => o.id)])] : os.map((o) => o.id);
      const all = ids.map((id) => data.orders.find((o) => o.id === id)).filter((o): o is Order => !!o);
      return {
        ...x,
        companyId: os[0].companyId ?? x.companyId,
        orderIds: ids,
        lines: all.map((o) => ({ store: String(o.storeCode ?? ''), date: dot(o.orderDate) })),
        // 출고 요청 3. 작업 내용: 주문마다 '주문명 (매장코드 / 주문일자)'
        works: [...(add ? (x.works ?? []) : []), ...os.filter((o) => add ? !x.orderIds.includes(o.id) : true).map((o) => `${o.name} (${[o.storeCode, dot(o.orderDate)].filter(Boolean).join(' / ')})`)],
        ...(add ? {} : { country: '', coName: '', content: '', packDate: '', orderName: '', storeText: '', dateText: '', outContent: '', outDate: '' }),
      };
    });
    setQ('');
    setFinding(false);
  };

  const stores = [...new Set(d.lines.map((l) => l.store.trim()).filter(Boolean))];
  const storeNames = useStoreNames(stores, stores.length > 0);
  // 자동으로 채우는 값
  const autoCountry = co?.country || '';
  const autoCo = coShort(co?.name ?? '');
  const country = d.country || autoCountry;
  const coName = d.coName || autoCo;
  // 매장번호는 ( ) 안에: 나라 매장명 (매장번호) 패킹 요청
  const autoContent = stores.length === 1 ? [country, storeNames[stores[0]] || coName, `(${stores[0]})`, '패킹 요청'].filter(Boolean).join(' ') : stores.length ? [country, coName, `(${stores.join(', ')})`, '패킹 요청'].filter(Boolean).join(' ') : '';
  const content = d.content || autoContent;
  const autoPack = dot(linked.map((o) => (o.packing ? parseDate(o.packing) : null)).filter((x): x is string => !!x).sort().at(-1) ?? '');
  const packDate = d.packDate || autoPack;
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
  const autoName = person?.name || access.accountName || '';
  const autoPhone = person?.phone || '';
  const personName = d.personName || autoName;
  const personPhone = d.personPhone || autoPhone;

  const lineText = (l: Line) => `- ${[l.store.trim(), l.date.trim()].filter(Boolean).join(' ')} 주문`;
  // 3. 입고 및 패킹리스트: 주문명 · 매장코드 · 주문일자 (불러온 주문에서)
  const oneBundle = linked.length > 0 && linked.every((o) => o.bundle && o.bundle.id === linked[0].bundle?.id);
  const autoOrderName = !linked.length ? '' : oneBundle ? linked[0].bundle?.name || '' : [...new Set(linked.map((o) => o.name))].join(', ');
  const orderName = d.orderName || autoOrderName;
  const autoStores = stores.join(', ');
  const storeText = d.storeText || autoStores;
  const autoDates = [...new Set(d.lines.map((l) => l.date.trim()).filter(Boolean))].join(', ');
  const dateText = d.dateText || autoDates;
  const qty = d.qty || QTY;
  const isIn = d.kind === 'inbound';
  const isArr = d.kind === 'arrival';
  const isOut = d.kind === 'out';
  // 4. 출고 요청
  const autoOutContent = stores.length === 1 ? `${[storeNames[stores[0]] || coName, stores[0]].filter(Boolean).join(' ')} 출고 요청.` : stores.length ? `${[coName, stores.join(', ')].filter(Boolean).join(' ')} 출고 요청.` : '';
  const outContent = d.outContent || autoOutContent;
  const autoOutDate = dot(linked.map((o) => o.bundle?.shipDate || o.shipDate || '').filter(Boolean).sort().at(-1) ?? '');
  const outDate = d.outDate || autoOutDate;
  const works = d.works ?? [];
  const dispatchText = d.dispatch ? DISPATCH[d.dispatch] : '';
  const followText = d.dispatch && d.dispatch <= 2 ? (d.follow === 1 ? FOLLOW1 : d.follow === 2 ? (d.followText ?? '').trim() : '') : '';
  const autoTitle = d.kind === 'out'
    ? `(업무협조전-해외사업부) ${[country, coName, d.fcl ? 'FCL' : ''].filter(Boolean).join(' ')} 출고 요청`
    : isIn
    ? `(업무협조전-글로벌사업부) ${[country, coName, orderName].filter(Boolean).join(' ')} 전산 입고 및 패킹리스트 등록 요청`
    : isArr
      ? `(업무협조전-글로벌사업부) ${[country, coName, orderName].filter(Boolean).join(' ')} 입고 (입고조)`
      : `(업무협조전-글로벌사업부) ${[country, coName].filter(Boolean).join(' ')} 패킹 요청`;
  const inDates = d.inDates?.length ? d.inDates : [''];
  const bodyArr = [
    '상기의 건에 대하여 아래와 같이 요청하오니 업무 협조 바랍니다.',
    '',
    '--------------------------아 래----------------------------',
    '',
    '1. 요약 : ',
    ...inDates.filter((x) => x.trim()).map((x, i) => `${i + 1}) ${withDay(x.trim())}`),
    '',
    '2. 수량: ',
    d.boxes?.trim() ?? '',
    ...(d.note4?.trim() ? [d.note4.trim()] : []),
    '',
    `기타 문의사항은 글로벌 사업부 ${personName}${personPhone ? `(${personPhone})` : ''}에게 문의바랍니다.`,
    '',
    '끝.',
  ].join('\n');
  const title = d.titleEdit ?? autoTitle;
  const bodyIn = [
    '상기의 건에 대하여 아래와 같이 요청하오니 업무 협조 바랍니다.',
    '',
    ' --------------------------아 래----------------------------',
    '',
    `1. 내용: ${[country, coName, orderName].filter(Boolean).join(' ')} 전산 입고 및 패킹리스트 등록 요청`,
    `2. 매장코드 ${storeText}`,
    `3. 주문일자: ${dateText}`,
    `4. 입고등록일자: ${d.inboundDate ?? ''}`,
    `5. 입고 수량 및 패킹수량: ${qty}`,
    ...(d.note3?.trim() ? [`6. ${d.note3.trim()}`] : []),
    '',
    `해당 업무협조전 관련 사항은 글로벌사업부 ${personName}${personPhone ? `(${personPhone})` : ''}에게 연락 바랍니다. 끝.`,
  ].join('\n');
  const bodyPack = [
    '상기의 건에 대하여 아래와 같이 요청하오니 업무 협조 바랍니다.',
    '',
    '-------------- 아      래 ---------------',
    '',
    `1. 내 용 :  ${content}`,
    ...(d.note1?.trim() ? [d.note1.trim()] : []),
    '',
    '2. 주문일자',
    ...d.lines.filter((l) => l.store.trim() || l.date.trim()).map(lineText),
    ...(d.note2?.trim() ? [d.note2.trim()] : []),
    '',
    `3. 패킹완료일자: ${packDate}`,
    '',
    '',
    `해당 업무협조전 관련 사항은 글로벌사업부 ${[personName, personPhone].filter(Boolean).join(' ')} 에게 연락 바랍니다. 끝.`,
  ].join('\n');
  const bodyOut = [
    '상기의 건에 대하여 아래와 같이 요청드립니다.',
    '',
    '-------------- 아래 ---------------',
    '',
    `1. 내 용 : ${outContent}`,
    `2. 일 자 : ${[outDate ? withDay(outDate) : '', (d.outTime ?? '').trim()].filter(Boolean).join(' ')}`,
    '3. 작업 내용 :',
    ...works.filter((x) => x.trim()).map((x) => `- ${x.trim().replace(/^-\s*/, '')}`),
    ...(dispatchText ? ['', dispatchText] : []),
    ...(followText ? [followText] : []),
    '',
    '4. 입고지: ',
    `장치장코드: ${(d.yardCode ?? '').trim()}`,
    `담당자: ${(d.yardPerson ?? '').trim()}`,
    `주소 : ${(d.yardAddr ?? '').trim()}`,
    '',
    `5. 참고사항: ${(d.refNote ?? '').trim()}`,
    '',
    `기타 문의사항은 글로벌 사업부 ${personName}${personPhone ? `(${personPhone})` : ''}에게 문의바랍니다.`,
    '끝.',
  ].join('\n');
  const body = isOut ? bodyOut : isIn ? bodyIn : isArr ? bodyArr : bodyPack;

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
  const missing = (
    isOut
      ? [!country && '나라', !coName && '업체명', !outContent && '내용', !outDate && '출고일자', !works.some((x) => x.trim()) && '작업 내용', !personName && '연락처']
      : isArr
      ? [!country && '나라', !coName && '업체명', !orderName && '주문명', !inDates.some((x) => x.trim()) && '입고날짜', !d.boxes?.trim() && '수량', !personName && '연락처']
      : isIn
      ? [!country && '나라', !coName && '업체명', !orderName && '주문명', !storeText && '매장코드', !dateText && '주문일자', !d.inboundDate?.trim() && '입고등록일자', !personName && '연락처']
      : [!country && '나라', !coName && '업체명', !content && '내용', !d.lines.some((l) => l.store || l.date) && '주문일자', !packDate && '패킹완료일자', !personName && '연락처']
  ).filter(Boolean) as string[];
  const setLine = (i: number, p: Partial<Line>) => set({ lines: d.lines.map((l, j) => (j === i ? { ...l, ...p } : l)) });
  const kind = KINDS.find((k) => k.key === d.kind) ?? KINDS[0];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>🤝 업무협조전</h1>
          <p className="muted">종류를 고르면 양식이 떠요. 문서 안 빈칸에 바로 쓰고, 📥 주문을 불러오면 빈칸이 자동으로 채워져요. 다 되면 제목 / 내용을 따로 복사해요.</p>
        </div>
        {/* ERP 업무협조전 쓰기 바로가기 (새 창) */}
        <a className="coop-erp" href="https://erp.artbox.kr/menu00/menu00_01_write.asp" target="_blank" rel="noreferrer" title="ERP 업무협조전 쓰기 (새 창)" aria-label="ERP 업무협조전 쓰기">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M14 3h7v7M21 3l-9 9" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>ERP</span>
        </a>
      </div>
      {/* 종류: 색 카드 */}
      <div className="coop-kinds">
        <span className="coop-kinds-h">어떤 업무협조전?</span>
        {KINDS.map((k) => (
          <button key={k.key} className={`coop-kind ${d.kind === k.key ? 'on' : ''}`} style={{ '--k': k.color } as CSSProperties} onClick={() => d.kind !== k.key && set({ kind: k.key, titleEdit: null })}>
            <span className="coop-kind-n">{k.no}</span>
            <span aria-hidden="true">{k.icon}</span> {k.label}
          </button>
        ))}
      </div>

      {/* 📥 주문 불러오기 */}
      <div className="coop-loadbar">
        <span className="coop-load-h">📥 주문 불러오기</span>
        <select
          className="coop-co-pick"
          value={d.companyId}
          onChange={(e) => set({ companyId: e.target.value, orderIds: [], lines: [], country: '', coName: '', content: '', packDate: '', orderName: '', storeText: '', dateText: '' })}
          title="업체를 고르면 나라 · 업체명이 채워지고, 아래 검색에 그 업체 주문만 나와요"
        >
          <option value="">업체 고르기</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <div className="coop-load-box">
          <input value={q} placeholder={d.companyId ? '이 업체 주문 · 묶음 · 매장코드로 찾기 (누르면 진행중 주문)' : '주문 · 묶음 · 매장코드 · 업체로 찾기 (누르면 진행중 주문)'} onFocus={() => setFinding(true)} onChange={(e) => (setQ(e.target.value), setFinding(true))} />
          {finding && (
            <>
              <div className="coop-load-bg" onClick={() => setFinding(false)} />
              <div className="coop-hits">
                {hits.map((h) => (
                  <div key={h.k} className="coop-hit-row">
                    <button className="coop-hit" onClick={() => loadFrom(h.os)} title="이 주문으로 새로 채우기">
                      <b>{h.name}</b>
                      <span className="muted small">
                        {coShort(h.co)} · {[...new Set(h.os.map((o) => o.storeCode).filter(Boolean))].join(', ')} · {dot(h.last)}
                        {h.done ? ' · 완료' : ''}
                      </span>
                    </button>
                    {linked.length > 0 && (
                      <button className="link small" onClick={() => loadFrom(h.os, true)} title="지금 불러온 주문에 더하기">
                        + 더하기
                      </button>
                    )}
                  </div>
                ))}
                {!hits.length && <span className="muted small coop-nohit">맞는 주문이 없어요</span>}
              </div>
            </>
          )}
        </div>
        {linked.length > 0 && (
          <span className="coop-linked muted small">
            불러온 주문 {linked.length}개
            <button className="link small" onClick={() => set({ orderIds: [], lines: [] })}>
              비우기
            </button>
          </span>
        )}
        <button className="link small coop-reset" onClick={() => confirm('다 비우고 새로 쓸까요?') && setD({ ...EMPTY, kind: d.kind })}>
          ↺ 새로 쓰기
        </button>
      </div>

      <div className="coop-cols">
      {/* 문서: 빈칸에 바로 */}
      <section className="card coop-doc" style={{ '--k': kind.color } as CSSProperties}>
        <div className="coop-copy">
          <b>제목</b>
        </div>
        <div className="coop-paper coop-title">
          {d.titleEdit != null ? (
            // ✎ 제목 직접 고치기
            <>
              <input className="coop-title-edit" autoFocus value={d.titleEdit} onChange={(e) => set({ titleEdit: e.target.value })} />
              <button className="link small coop-title-btn" onClick={() => set({ titleEdit: null })} title="양식대로 (나라 · 업체명 빈칸) 돌아가기">
                ↺ 양식대로
              </button>
            </>
          ) : (
            <>
              <span>
                ({isOut ? '업무협조전-해외사업부' : '업무협조전-글로벌사업부'}) <Blank value={d.country} auto={autoCountry} ph="나라" onChange={(v) => set({ country: v })} />{' '}
                <Blank value={d.coName} auto={autoCo} ph="업체명" onChange={(v) => set({ coName: v })} />{' '}
                {isOut ? (
                  <>
                    <label className="coop-fcl" title="제목에 FCL 넣기">
                      <input type="checkbox" checked={!!d.fcl} onChange={(e) => set({ fcl: e.target.checked })} /> FCL
                    </label>{' '}
                    출고 요청
                  </>
                ) : isIn || isArr ? (
                  <>
                    <Blank value={d.orderName ?? ''} auto={autoOrderName} ph="주문명" onChange={(v) => set({ orderName: v })} /> {isArr ? '입고 (입고조)' : '전산 입고 및 패킹리스트 등록 요청'}
                  </>
                ) : (
                  '패킹 요청'
                )}
              </span>
              <button className="icon-btn coop-title-btn" onClick={() => set({ titleEdit: autoTitle })} title="제목 통째로 고치기">
                ✎
              </button>
            </>
          )}
        </div>

        <div className="coop-copy">
          <b>내용</b>
        </div>
        <div className="coop-paper">
          <p>{isOut ? '상기의 건에 대하여 아래와 같이 요청드립니다.' : '상기의 건에 대하여 아래와 같이 요청하오니 업무 협조 바랍니다.'}</p>
          <p className="coop-center">{isOut ? '-------------- 아래 ---------------' : isIn || isArr ? '--------------------------아 래----------------------------' : <>-------------- 아&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;래 ---------------</>}</p>

          {isOut ? (
            <>
              <p>
                1. 내 용 : <Blank value={d.outContent ?? ''} auto={autoOutContent} ph="매장명 매장번호 출고 요청." w={24} className="wide" onChange={(v) => set({ outContent: v })} />
              </p>
              <p>
                2. 일 자 : <Blank value={d.outDate ?? ''} auto={autoOutDate} ph="출고일자" w={10} onChange={(v) => set({ outDate: v })} />{' '}
                <span className="muted">{parseDate(outDate) ? `(${WEEK[new Date(`${parseDate(outDate)}T00:00:00`).getDay()]})` : '(요일)'}</span>{' '}
                <Blank value={d.outTime ?? ''} ph="작업시간 (예: 오전 10시)" w={12} onChange={(v) => set({ outTime: v })} />
              </p>
              <p>3. 작업 내용 :</p>
              {works.map((x, i) => (
                <p key={i} className="coop-line">
                  - <Blank value={x} ph="예: 팔렛트 1팔렛트 (입고 예정일)" w={30} className="wide" onChange={(v) => set({ works: works.map((y, j) => (j === i ? v : y)) })} />
                  <button className="link small" onClick={() => set({ works: works.filter((_, j) => j !== i) })} title="이 줄 빼기">
                    ✕
                  </button>
                </p>
              ))}
              <div className="coop-add-row">
                <select
                  value=""
                  onChange={(e) => {
                    const o = data.orders.find((x) => x.id === e.target.value);
                    if (o) set({ companyId: d.companyId || o.companyId || '', orderIds: [...d.orderIds, o.id], lines: [...d.lines, { store: String(o.storeCode ?? ''), date: dot(o.orderDate) }], works: [...works, `${o.name} (${[o.storeCode, dot(o.orderDate)].filter(Boolean).join(' / ')})`] });
                  }}
                  title="주문 리스트에서 골라 '주문명 (매장코드 / 주문일자)' 한 줄 더하기"
                >
                  <option value="">+ 주문 추가</option>
                  {data.orders
                    .filter((o) => !o.erpArchive && !d.orderIds.includes(o.id) && (!d.companyId || o.companyId === d.companyId))
                    .sort((a, b) => Number(!!(a.closed || a.shipped)) - Number(!!(b.closed || b.shipped)) || String(b.orderDate ?? b.createdAt).localeCompare(String(a.orderDate ?? a.createdAt)))
                    .map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name} · {o.storeCode ?? ''} · {dot(o.orderDate)}
                        {o.closed || o.shipped ? ' (완료)' : ''}
                      </option>
                    ))}
                </select>
                <button className="link small" onClick={() => set({ works: [...works, ''] })}>
                  + 줄 직접 추가
                </button>
              </div>
              {/* [선택] 배차 · 컨테이너 */}
              <div className="coop-pick-row">
                <select value={d.dispatch ?? 0} onChange={(e) => set({ dispatch: Number(e.target.value), follow: 0 })} title="배차 · 컨테이너 (선택)">
                  <option value={0}>배차 · 컨테이너 (선택 안 함)</option>
                  {DISPATCH.slice(1).map((t, i) => (
                    <option key={t} value={i + 1}>
                      {i + 1}. {t}
                    </option>
                  ))}
                </select>
                {!!d.dispatch && d.dispatch <= 2 && (
                  <select value={d.follow ?? 0} onChange={(e) => set({ follow: Number(e.target.value) })} title="그 다음 줄 (선택)">
                    <option value={0}>그 다음 줄 (없음)</option>
                    <option value={1}>배차정보 · 컨테이너 정보는 확인되는대로 전달</option>
                    <option value={2}>배차정보 직접 쓰기</option>
                  </select>
                )}
              </div>
              {!!d.dispatch && d.dispatch <= 2 && d.follow === 2 && (
                <div className="coop-note">
                  <textarea rows={2} value={d.followText ?? ''} placeholder="배차정보 (차량번호 · 기사님 연락처 등)" onChange={(e) => set({ followText: e.target.value })} />
                </div>
              )}
              <p className="coop-gap">
                4. 입고지:{' '}
                <button className="link small" onClick={() => { const t = prompt('입고지 세 줄을 통째로 붙여넣어 주세요\n(장치장코드 / 담당자 / 주소)'); if (t) set(parseYard(t)); }} title="장치장코드 · 담당자 · 주소 세 줄을 한 번에">
                  📋 세 줄 통째로 붙여넣기
                </button>
              </p>
              <p className="coop-line">
                장치장코드: <Blank value={d.yardCode ?? ''} ph="장치장코드" w={10} onChange={(v) => set({ yardCode: v })} />
              </p>
              <p className="coop-line">
                담당자: <Blank value={d.yardPerson ?? ''} ph="담당자" w={14} onChange={(v) => set({ yardPerson: v })} />
              </p>
              <p className="coop-line">
                주소 : <Blank value={d.yardAddr ?? ''} ph="주소" w={30} className="wide" onChange={(v) => set({ yardAddr: v })} />
              </p>
              <p className="coop-gap">
                5. 참고사항: <Blank value={d.refNote ?? ''} ph="(없으면 비워 둬요)" w={24} className="wide" onChange={(v) => set({ refNote: v })} />
              </p>
            </>
          ) : isArr ? (
            <>
              <p>1. 요약 :</p>
              {inDates.map((x, i) => (
                <p key={i} className="coop-line">
                  {i + 1}) <Blank value={x} ph="2026.11.27" w={10} onChange={(v) => set({ inDates: inDates.map((y, j) => (j === i ? v : y)) })} />{' '}
                  <span className="muted">{parseDate(x) ? `(${WEEK[new Date(`${parseDate(x)}T00:00:00`).getDay()]})` : '(요일)'}</span>
                  {inDates.length > 1 && (
                    <button className="link small" onClick={() => set({ inDates: inDates.filter((_, j) => j !== i) })} title="이 날짜 빼기">
                      ✕
                    </button>
                  )}
                </p>
              ))}
              <button className="link small coop-add" onClick={() => set({ inDates: [...inDates, ''] })}>
                + 날짜 추가
              </button>
              <p className="coop-gap">2. 수량:</p>
              <p className="coop-line">
                <Blank value={d.boxes ?? ''} ph="몇 박스 (예: 3박스)" w={14} onChange={(v) => set({ boxes: v })} />
              </p>
              {d.note4 != null ? (
                <div className="coop-note">
                  <textarea rows={2} value={d.note4} placeholder="비고" onChange={(e) => set({ note4: e.target.value })} />
                  <button className="link small" onClick={() => set({ note4: null })}>
                    ✕
                  </button>
                </div>
              ) : (
                <div className="coop-add-row">
                  <button className="link small" onClick={() => set({ note4: NOTE4 })} title={NOTE4}>
                    + 비고 (패킹된 채로 입고 · 출고 예정)
                  </button>
                  <button className="link small" onClick={() => set({ note4: '' })}>
                    + 비고 직접 쓰기
                  </button>
                </div>
              )}

            </>
          ) : isIn ? (
            <>
          <p>
            1. 내용: {[country, coName].filter(Boolean).join(' ')} <Blank value={d.orderName ?? ''} auto={autoOrderName} ph="주문명" onChange={(v) => set({ orderName: v })} /> 전산 입고 및 패킹리스트 등록 요청
          </p>
          <p>
            2. 매장코드 <Blank value={d.storeText ?? ''} auto={autoStores} ph="매장번호" w={8} onChange={(v) => set({ storeText: v })} />
          </p>
          <p>
            3. 주문일자: <Blank value={d.dateText ?? ''} auto={autoDates} ph="2026.11.20" w={10} onChange={(v) => set({ dateText: v })} />
          </p>
          <p>
            4. 입고등록일자: <Blank value={d.inboundDate ?? ''} ph="직접 입력" w={10} onChange={(v) => set({ inboundDate: v })} />
          </p>
          <p>
            5. 입고 수량 및 패킹수량: <Blank value={d.qty ?? ''} auto={QTY} ph={QTY} w={24} onChange={(v) => set({ qty: v })} />
          </p>
          {d.note3 != null ? (
            <div className="coop-note">
              <span>6.</span>
              <textarea rows={2} value={d.note3} placeholder="비고" onChange={(e) => set({ note3: e.target.value })} />
              <button className="link small" onClick={() => set({ note3: null })}>
                ✕
              </button>
            </div>
          ) : (
            <button className="link small coop-add" onClick={() => set({ note3: '' })}>
              + 6. 비고
            </button>
          )}
          {!linked.length && <p className="muted small">위에서 📥 주문을 불러오면 주문명 · 매장코드 · 주문일자가 채워져요</p>}

            </>
          ) : (
            <>
          <p>
            1. 내 용 :&nbsp; <Blank value={d.content} auto={autoContent} ph="나라 매장명 (매장번호) 패킹 요청" w={30} className="wide" onChange={(v) => set({ content: v })} />
          </p>
          {d.note1 !== null ? (
            <div className="coop-note">
              <textarea rows={2} value={d.note1} placeholder="비고" onChange={(e) => set({ note1: e.target.value })} />
              <button className="link small" onClick={() => set({ note1: null })}>
                ✕
              </button>
            </div>
          ) : (
            <button className="link small coop-add" onClick={() => set({ note1: '' })}>
              + 비고
            </button>
          )}

          <p className="coop-gap">2. 주문일자</p>
          {d.lines.map((l, i) => (
            <p key={i} className="coop-line">
              - <Blank value={l.store} ph="매장번호" w={8} onChange={(v) => setLine(i, { store: v })} /> <Blank value={l.date} ph="2026.11.20" w={10} onChange={(v) => setLine(i, { date: v })} /> 주문
              <button className="link small" onClick={() => set({ lines: d.lines.filter((_, j) => j !== i) })} title="이 줄 빼기">
                ✕
              </button>
            </p>
          ))}
          <div className="coop-add-row">
            <button className="link small" onClick={() => set({ lines: [...d.lines, { store: d.lines.at(-1)?.store ?? '', date: '' }] })}>
              + 주문 줄 직접 추가
            </button>
            {/* 주문 리스트에서 골라 한 줄 더하기 (업체를 골랐으면 그 업체 주문만) */}
            <select
              value=""
              onChange={(e) => {
                const o = data.orders.find((x) => x.id === e.target.value);
                if (o) set({ companyId: d.companyId || o.companyId || '', orderIds: [...d.orderIds, o.id], lines: [...d.lines, { store: String(o.storeCode ?? ''), date: dot(o.orderDate) }] });
              }}
              title="주문 리스트에서 골라 한 줄 더하기"
            >
              <option value="">+ 주문 리스트에서 고르기</option>
              {data.orders
                .filter((o) => !o.erpArchive && !d.orderIds.includes(o.id) && (!d.companyId || o.companyId === d.companyId))
                .sort((a, b) => Number(!!(a.closed || a.shipped)) - Number(!!(b.closed || b.shipped)) || String(b.orderDate ?? b.createdAt).localeCompare(String(a.orderDate ?? a.createdAt)))
                .map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} · {o.storeCode ?? ''} · {dot(o.orderDate)}
                    {d.companyId ? '' : ` · ${coShort(companyById.get(o.companyId ?? '')?.name ?? '')}`}
                    {o.closed || o.shipped ? ' (완료)' : ''}
                  </option>
                ))}
            </select>
          </div>
          {d.note2 !== null ? (
            <div className="coop-note">
              <textarea rows={2} value={d.note2} placeholder="비고" onChange={(e) => set({ note2: e.target.value })} />
              <button className="link small" onClick={() => set({ note2: null })}>
                ✕
              </button>
            </div>
          ) : (
            <button className="link small coop-add" onClick={() => set({ note2: '' })}>
              + 비고
            </button>
          )}

          <p className="coop-gap">
            3. 패킹완료일자: <Blank value={d.packDate} auto={autoPack} ph="2026.12.09" w={10} onChange={(v) => set({ packDate: v })} />
          </p>

            </>
          )}
          <p className="coop-gap2">
            {isArr || isOut ? '기타 문의사항은 글로벌 사업부' : '해당 업무협조전 관련 사항은 글로벌사업부'}{' '}
            <select
              className="coop-person"
              value={personEmail}
              onChange={(e) => set({ personEmail: e.target.value, personName: '', personPhone: '' })}
              title="연락받을 사람 (기본 = 나)"
            >
              {!people.some((p) => p.email === personEmail) && <option value={personEmail}>{autoName || '나'}</option>}
              {people.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.name}
                  {p.email === access.email ? ' (나)' : ''}
                </option>
              ))}
            </select>{' '}
            <Blank value={d.personName} auto={autoName} ph="이름" w={6} onChange={(v) => set({ personName: v })} /> <Blank value={d.personPhone} auto={autoPhone} ph="회사번호" w={12} onChange={(v) => set({ personPhone: v })} />{' '}
            {isArr || isOut ? '에게 문의바랍니다. 끝.' : isIn ? '에게 연락 바랍니다. 끝.' : ' 에게 연락 바랍니다. 끝.'}
          </p>
        </div>
        {missing.length > 0 && <p className="warn small">아직 빈 칸: {missing.join(' · ')}</p>}
      </section>
      {/* 옆: 완성된 글 (그대로 복사) */}
      <section className="card coop-out">
        <div className="coop-copy">
          <b>제목</b>
          <button className={copied === 'title' ? 'primary' : ''} onClick={() => void copy('title')}>
            {copied === 'title' ? '✓ 복사됨' : '📋 제목 복사'}
          </button>
        </div>
        <pre className="coop-text coop-out-title">{title}</pre>
        <div className="coop-copy">
          <b>내용</b>
          <button className={copied === 'body' ? 'primary' : ''} onClick={() => void copy('body')}>
            {copied === 'body' ? '✓ 복사됨' : '📋 내용 복사'}
          </button>
        </div>
        <pre className="coop-text">{body}</pre>
      </section>
      </div>
    </div>
  );
}
