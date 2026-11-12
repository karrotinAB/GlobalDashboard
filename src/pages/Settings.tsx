import { useEffect, useRef, useState } from 'react';
import { ROLE_NAME, setViewAsMember, useAccess } from '../components/AuthGate';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { COUNTRY_NAMES } from '../lib/worldHolidays';
import DateInput from '../components/DateInput';
import { DEFAULT_TEAM, TEAMS } from '../lib/team';
import AccessAdmin from '../components/AccessAdmin';
import { SalesApiAdmin, StoreAreaSection } from '../components/SalesSettings';
import ChangePassword from '../components/ChangePassword';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { seedData } from '../data/seed';
import { COLLECTIONS } from '../data/backend';
import { today, uid, pickColor } from '../lib/date';
import type { Collections, Company, Member } from '../types';

const TIMEZONES = [
  'Asia/Seoul',
  'Asia/Ulaanbaatar',
  'Asia/Almaty',
  'Asia/Tashkent',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Singapore',
  'Asia/Kuala_Lumpur',
  'Asia/Bangkok',
  'Asia/Ho_Chi_Minh',
  'Asia/Jakarta',
  'Asia/Manila',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Madrid',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'America/New_York',
  'America/Los_Angeles',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Guayaquil',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** side: 지금 보고 있던 쪽 (조 대시보드 / 무역사무 페이지) */
export default function Settings({ side = 'team' }: { side?: 'team' | 'trade' }) {
  const { data, mode, save, saveMany, remove } = useStore();
  const access = useAccess();
  const { members, companies, isMine, hasMirror } = useLookups();
  const accounts = useAccounts(access.canManage);
  // 팀장님·이사님 업체 관리: 검색 + 내 업체 → 1조 → 2조 → 3조 순
  const [coQ, setCoQ] = useState('');
  const [onlyMine, setOnlyMine] = useState(false);
  const coList = (() => {
    if (!hasMirror) return companies;
    const rank = (c: Company) => (c.team ? Number(c.team) : 0);
    const q = coQ.trim().toLowerCase();
    return [...companies]
      .sort((a, b) => rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name))
      .filter((c) => !onlyMine || isMine(c))
      .filter((c) => !q || `${c.name} ${c.country ?? ''} ${(c.storeCodes ?? []).join(' ')} ${c.team ? `${c.team}조` : ''}`.toLowerCase().includes(q));
  })();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `global-dashboard-backup-${today()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Collections>;
      if (!confirm('백업 파일의 데이터를 추가/덮어쓸까요? (같은 ID는 덮어쓰고, 나머지는 유지돼요)')) return;
      for (const col of COLLECTIONS) {
        const items = parsed[col];
        if (Array.isArray(items) && items.length) await saveMany(col, items as never);
      }
      setMsg('가져오기 완료!');
    } catch (e) {
      setMsg(`가져오기 실패: ${(e as Error).message}`);
    }
  };

  const loadSample = async () => {
    if (!confirm('기본 담당자(유정·민지·가영)를 넣을까요? 같은 ID는 덮어써요.')) return;
    const s = seedData();
    for (const col of COLLECTIONS) await saveMany(col, s[col] as never);
    setMsg('기본 담당자를 넣었어요.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>설정</h1>
        {access.role !== 'trade' && <span className="tag gray">{access.viewLabel}</span>}
        {access.realRole === 'admin' && (
          <button
            className={`view-as ${access.role === 'admin' ? '' : 'on'}`}
            onClick={() => setViewAsMember(access.role === 'admin')}
            title={access.role === 'admin' ? '사이트 전체를 일반 조원 화면으로 봐요 (실제 권한은 그대로)' : '관리자 화면으로 돌아가요'}
          >
            {access.role === 'admin' ? '👤 일반 유저' : '🛡 관리자'}
          </button>
        )}
      </div>

      {/* 무역사무 담당자: 무역사무 계정, 또는 관리자가 무역사무 페이지에서 설정에 들어왔을 때만 */}
      {(access.role === 'trade' || ((access.role === null || access.role === 'admin') && side === 'trade')) && <TradeMembersSection />}
      {access.role === 'trade' ? (
        access.email && <ChangePassword />
      ) : (
      <>
      {access.email && <ChangePassword />}
      <section className="card">
        <h2>담당자 ({access.viewLabel})</h2>
        <table className="settings-table">
          <thead>
            <tr>
              <th>이름</th>
              <th>로그인 이메일 (본인 카드)</th>
              <th>mem 이름</th>
              <th>색</th>
              <th>순서</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <MemberRow key={m.id} m={m} accounts={accounts} onSave={(x) => save('members', x)} onDelete={() => confirm(`${m.name} 삭제?`) && remove('members', m.id)} />
            ))}
          </tbody>
        </table>
        <button
          onClick={() => save('members', { id: uid(), name: '새 담당자', color: pickColor(members.map((m) => m.color)), order: members.length } satisfies Member)}
        >
          + 담당자 추가
        </button>
      </section>
      {access.email && DATA_MODE !== 'local' && <MyCalendars email={access.email} />}
      {access.role === 'admin' && <CalendarAdmin />}
      <section className="card">
        <h2>업체 관리</h2>
        <p className="muted small">
          타임존을 넣으면 홈 화면에 그 나라 시계가 나와요. <b>매장코드</b>(ERP 매장코드 앞 4자리, 여러 개면 쉼표)를 넣으면 ERP 에 새 주문이 들어올 때 그
          업체 주문 관리에 '새 주문'으로 자동 등록돼요.
        </p>
        {hasMirror && (
          <div className="co-search">
            <input className="search" placeholder="🔍 업체 이름 · 나라 · 매장코드" value={coQ} onChange={(e) => setCoQ(e.target.value)} />
            <label className="check-line small">
              <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> 내 담당만
            </label>
            <span className="muted small">{coList.length}곳</span>
          </div>
        )}
        <div className="table-scroll">
          <table className="settings-table">
            <thead>
              <tr>
                {hasMirror && <th title="체크한 업체만 주간 할일·주문 관리·클레임에 보여요">내 담당</th>}
                <th>업체명</th>
                <th>나라 (시계 이름)</th>
                <th>매장코드 (4자리)</th>
                <th>타임존</th>
                <th>색</th>
                <th>순서</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {coList.map((c) => (
                <CompanyRow
                  key={c.id}
                  c={c}
                  mine={hasMirror ? isMine(c) : undefined}
                  onMine={(on) => {
                    const cur = data.config.find((x) => x.id === 'myCompanies');
                    const base = cur?.companyIds ?? companies.filter((x) => isMine(x)).map((x) => x.id);
                    const next = on ? [...new Set([...base, c.id])] : base.filter((id) => id !== c.id);
                    save('config', { ...(cur ?? { id: 'myCompanies' }), companyIds: next });
                  }}
                  onSave={(x) => save('companies', x)} onDelete={
                  access.role === 'member' || c.team
                    ? undefined
                    : () =>
                        confirm(
                          `'${c.name}' 업체를 삭제할까요?\n\n이 업체의 할일·주문은 지워지지 않고 '기타 / 업체 없음'으로 옮겨져요.`,
                        ) && remove('companies', c.id)
                } />
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={() =>
            save('companies', { id: uid(), name: '새 업체', country: '', color: pickColor(companies.map((c) => c.color)), order: companies.length } satisfies Company)
          }
        >
          + 업체 추가
        </button>
      </section>
      <StoreAreaSection />
      <section className="card">
        <h2>데이터</h2>
        <div className="btn-row">
          <button onClick={exportJson}>백업 다운로드 (JSON)</button>
          <button onClick={() => fileRef.current?.click()}>백업 가져오기</button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importJson(f);
              e.target.value = '';
            }}
          />
          {access.viewTeam === DEFAULT_TEAM && <button onClick={loadSample}>기본 담당자 넣기</button>}
        </div>
        {msg && <p className="small">{msg}</p>}
        <p className="muted small">
          할일 {data.tasks.length} · 주문 {data.orders.length} · 근태 기록 {data.attendance.length} · 무역사무 요청 {data.requests.length}
        </p>
      </section>

      {/* 아래는 관리자용 */}
      <section className="card">
        <h2>저장 방식</h2>
        {mode === 'firestore' ? (
          <p>
            <span className="tag green">팀 공유 (Firebase)</span> 모든 팀원이 같은 데이터를 보고, 바뀐 내용이 실시간으로 반영돼요.
            {access.email && (
              <span className="muted small">
                {' '}
                · {access.email} 로그인 중 ({access.role ? ROLE_NAME[access.role] : ''})
              </span>
            )}
          </p>
        ) : (
          <p>
            <span className="tag gray">로컬 모드</span> 테스트용이라 이 브라우저에만 저장돼요.
          </p>
        )}
      </section>

      {access.role === 'admin' && <AccessAdmin />}
      {access.canManage && (
        <section className="card">
          <h2>
            홈 화면 구성 <span className="tag gray">관리자만 보이는 칸</span>
          </h2>
          <p className="muted small">켜면 홈 화면에 모든 사람에게 보여요.</p>
          {(
            [
              ['showUrgent', '🔥 급한 일 (마감 지났거나 오늘·내일인 할일)'],
              ['showPipeline', '📦 진행중 주문 단계 (단계별 막대)'],
            ] as const
          ).map(([k, label]) => {
            const cfg = data.config.find((c) => c.id === 'home') ?? { id: 'home' };
            return (
              <label key={k} className="check-line toggle-line">
                <input type="checkbox" checked={!!cfg[k]} onChange={(e) => save('config', { ...cfg, [k]: e.target.checked })} />
                {label}
              </label>
            );
          })}
        </section>
      )}
      {access.canManage && <HolidayAdmin />}
      {access.role === 'admin' && <MemAutoSection />}
      {access.role === 'admin' && <SalesApiAdmin />}




      </>
      )}
    </div>
  );
}

/** 관리자가 '대시보드 사용자'에 저장해 둔 계정 (담당자 로그인 이메일 고르기용) */
function useAccounts(enabled: boolean) {
  const [list, setList] = useState<{ email: string; name?: string }[]>([]);
  useEffect(() => {
    if (!enabled || DATA_MODE === 'local') return;
    return onSnapshot(
      collection(db, 'roles'),
      (snap) => setList(snap.docs.map((d) => ({ email: d.id, name: d.get('name') as string | undefined })).sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email))),
      () => setList([]),
    );
  }, [enabled]);
  return list;
}

function MemberRow({ m, accounts, onSave, onDelete }: { m: Member; accounts: { email: string; name?: string }[]; onSave: (m: Member) => void; onDelete: () => void }) {
  const [name, setName] = useState(m.name);
  const [memName, setMemName] = useState(m.memName ?? '');
  const [email, setEmail] = useState(m.email ?? '');
  const isAdmin = useAccess().canManage;
  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && onSave({ ...m, name: name.trim() })} />
      </td>
      <td>
        {isAdmin && accounts.length > 0 ? (
          // 관리자가 저장해 둔 계정 중에서 고르기
          <select
            value={m.email ?? ''}
            onChange={(e) => {
              setEmail(e.target.value);
              onSave({ ...m, email: e.target.value || undefined });
            }}
          >
            <option value="">— 연결 안 함 —</option>
            {m.email && !accounts.some((a) => a.email === m.email) && <option value={m.email}>{m.email} (사용자 목록에 없음)</option>}
            {accounts.map((a) => (
              <option key={a.email} value={a.email}>
                {a.name ? `${a.name} · ${a.email}` : a.email}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="email"
            value={email}
            disabled={!isAdmin}
            placeholder={isAdmin ? '이 사람의 로그인 이메일' : '관리자만 설정'}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => email.trim().toLowerCase() !== (m.email ?? '') && onSave({ ...m, email: email.trim().toLowerCase() || undefined })}
          />
        )}
      </td>
      <td>
        <input
          value={memName}
          placeholder={`비우면 '…${m.name}'로 찾음`}
          onChange={(e) => setMemName(e.target.value)}
          onBlur={() => memName.trim() !== (m.memName ?? '') && onSave({ ...m, memName: memName.trim() || undefined })}
        />
      </td>
      <td>
        <input type="color" value={m.color} onChange={(e) => onSave({ ...m, color: e.target.value })} />
      </td>
      <td>
        <input type="number" className="num" value={m.order} onChange={(e) => onSave({ ...m, order: Number(e.target.value) })} />
      </td>
      <td>
        {onDelete && (
          <button className="danger small" onClick={onDelete}>
            삭제
          </button>
        )}
      </td>
    </tr>
  );
}

function CompanyRow({
  c,
  onSave,
  onDelete,
  mine,
  onMine,
}: {
  c: Company;
  onSave: (c: Company) => void;
  onDelete?: () => void;
  mine?: boolean; // 팀장님·이사님: '내 담당' (undefined 면 칸 없음)
  onMine?: (on: boolean) => void;
}) {
  const mineCell =
    mine === undefined ? null : (
      <td className="c-mine">
        <input type="checkbox" checked={mine} onChange={(e) => onMine?.(e.target.checked)} title="체크하면 주간 할일·주문 관리·클레임에 이 업체가 보여요" />
      </td>
    );
  const [moving, setMoving] = useState(false);
  // 담당 조 바꾸기: 업체와 그 업체의 할일·주문·클레임을 다른 조로 (서버에서 옮김)
  const move = async (to: string) => {
    if (!c.team || to === c.team) return;
    if (!confirm(`'${c.name}' 업체를 ${c.team}조 → ${to}조로 옮길까요?\n\n이 업체의 할일·주문·클레임도 같이 ${to}조로 옮겨지고, ${c.team}조 대시보드에서는 안 보여요.`)) return;
    setMoving(true);
    try {
      const r = (await httpsCallable(functions, 'moveCompanyTeam')({ companyId: c.id, from: c.team, to })).data as { tasks: number; orders: number; claims: number };
      alert(`${to}조로 옮겼어요 ✓ (할일 ${r.tasks} · 주문 ${r.orders} · 클레임 ${r.claims})`);
    } catch (e) {
      alert(`옮기지 못했어요: ${(e as Error).message}\n(서버 함수를 새로 올렸는지 확인해 주세요 — deploy.bat)`);
    } finally {
      setMoving(false);
    }
  };
  // 팀장님·이사님 화면의 조 업체: 보기만 + 담당 조 바꾸기 (조에서 고치면 여기도 바로 바뀜)
  if (c.team)
    return (
      <tr className="mirror-row">
        {mineCell}
        <td>
          {c.name} <span className="tag gray small">{c.team}조 업체</span>
        </td>
        <td>{c.country}</td>
        <td>{(c.storeCodes ?? []).join(', ')}</td>
        <td>{c.timezone ?? ''}</td>
        <td>
          <span className="dot" style={{ background: c.color }} />
        </td>
        <td colSpan={2}>
          <label className="move-team" title="담당 조를 바꾸면 그 조 대시보드로 옮겨가요 (할일·주문·클레임 포함)">
            <span className="muted small">담당</span>
            <select value={c.team} disabled={moving || DATA_MODE === 'local'} onChange={(e) => void move(e.target.value)}>
              {TEAMS.map((t) => (
                <option key={t} value={t}>
                  {t}조
                </option>
              ))}
            </select>
            {moving && <span className="muted small">옮기는 중…</span>}
          </label>
        </td>
      </tr>
    );
  const [name, setName] = useState(c.name);
  const [country, setCountry] = useState(c.country);
  const [codes, setCodes] = useState((c.storeCodes ?? []).join(', '));
  const saveCodes = () => {
    const list = [...new Set(codes.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\d{4}$/.test(x)))];
    setCodes(list.join(', '));
    if (JSON.stringify(list) !== JSON.stringify(c.storeCodes ?? [])) onSave({ ...c, storeCodes: list.length ? list : undefined });
  };
  return (
    <tr>
      {mineCell}
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && onSave({ ...c, name: name.trim() })} />
      </td>
      <td>
        <input value={country} onChange={(e) => setCountry(e.target.value)} onBlur={() => country !== c.country && onSave({ ...c, country })} />
      </td>
      <td>
        <input
          className="store-codes"
          value={codes}
          placeholder="예: 8212"
          inputMode="numeric"
          onChange={(e) => setCodes(e.target.value)}
          onBlur={saveCodes}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          title="ERP 매장코드 앞 4자리 (STORE_CODE). 여러 개면 쉼표로"
        />
      </td>
      <td>
        <select value={c.timezone ?? ''} onChange={(e) => onSave({ ...c, timezone: e.target.value || undefined })}>
          <option value="">(시계 없음)</option>
          {[...new Set([...(c.timezone ? [c.timezone] : []), ...TIMEZONES])].map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </td>
      <td>
        <input type="color" value={c.color ?? '#888888'} onChange={(e) => onSave({ ...c, color: e.target.value })} />
      </td>
      <td>
        <input type="number" className="num" value={c.order} onChange={(e) => onSave({ ...c, order: Number(e.target.value) })} />
      </td>
      <td>
        {onDelete && (
          <button className="danger small" onClick={onDelete}>
            삭제
          </button>
        )}
      </td>
    </tr>
  );
}

/** 무역사무 담당자 카드 (관리자·무역사무가 관리). 로그인 이메일을 넣으면 그 사람 카드가 됨 */
function TradeMembersSection() {
  const { data, save, remove } = useStore();
  const isAdmin = useAccess().role !== 'trade';
  const list = [...data.tradeMembers].sort((a, b) => a.order - b.order);
  return (
    <section className="card">
      <h2>무역사무 담당자</h2>
      <p className="muted small">무역사무 홈의 팀 카드와 요청의 '처리자'로 쓰여요. mem 출퇴근은 2조와 같은 확장 프로그램으로 같이 들어와요. 로그인 이메일은 관리자만 넣을 수 있어요 (본인은 홈에서 '이 카드가 나예요').</p>
      <table className="settings-table">
        <thead>
          <tr>
            <th>이름</th>
            <th>로그인 이메일 (본인 카드)</th>
            <th>mem 이름</th>
            <th>색</th>
            <th>순서</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((m) => (
            <TradeMemberRow key={m.id} m={m} isAdmin={isAdmin} onSave={(x) => save('tradeMembers', x)} onDelete={() => confirm(`${m.name} 삭제?`) && remove('tradeMembers', m.id)} />
          ))}
        </tbody>
      </table>
      <button onClick={() => save('tradeMembers', { id: uid(), name: '새 담당자', color: pickColor(list.map((m) => m.color)), order: list.length } satisfies Member)}>+ 담당자 추가</button>
    </section>
  );
}

function TradeMemberRow({ m, isAdmin, onSave, onDelete }: { m: Member; isAdmin: boolean; onSave: (m: Member) => void; onDelete: () => void }) {
  const [name, setName] = useState(m.name);
  const [email, setEmail] = useState(m.email ?? '');
  const [memName, setMemName] = useState(m.memName ?? '');
  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && onSave({ ...m, name: name.trim() })} />
      </td>
      <td>
        <input
          type="email"
          value={email}
          disabled={!isAdmin}
          placeholder={isAdmin ? '이 사람의 로그인 이메일' : '관리자만 설정'}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => email.trim().toLowerCase() !== (m.email ?? '') && onSave({ ...m, email: email.trim().toLowerCase() || undefined })}
        />
      </td>
      <td>
        <input
          value={memName}
          placeholder={`비우면 '…${m.name}'로 찾음`}
          onChange={(e) => setMemName(e.target.value)}
          onBlur={() => memName.trim() !== (m.memName ?? '') && onSave({ ...m, memName: memName.trim() || undefined })}
        />
      </td>
      <td>
        <input type="color" value={m.color} onChange={(e) => onSave({ ...m, color: e.target.value })} />
      </td>
      <td>
        <input type="number" className="num" value={m.order} onChange={(e) => onSave({ ...m, order: Number(e.target.value) })} />
      </td>
      <td>
        <button className="danger small" onClick={onDelete}>
          삭제
        </button>
      </td>
    </tr>
  );
}

/** 나라별 추가 공휴일: 공휴일 서비스에 없는 휴일(음력 등)을 관리자가 넣음 → 홈 세계 시계에 '공휴일' */
function HolidayAdmin() {
  const { data, save } = useStore();
  const cfg = data.config.find((c) => c.id === 'holidays') ?? { id: 'holidays' };
  const list = [...(cfg.holidays ?? [])].sort((a, b) => b.date.localeCompare(a.date));
  const [code, setCode] = useState('MN');
  const [date, setDate] = useState<string | undefined>();
  const [name, setName] = useState('');
  const codes = Object.entries(COUNTRY_NAMES).sort((a, b) => a[1].localeCompare(b[1]));
  const add = () => {
    if (!date || !name.trim()) return;
    const next = [...(cfg.holidays ?? []).filter((h) => !(h.code === code && h.date === date)), { code, date, name: name.trim() }];
    save('config', { ...cfg, holidays: next });
    setName('');
    setDate(undefined);
  };
  return (
    <section className="card">
      <h2>
        나라별 추가 공휴일 <span className="tag gray">관리자만 보이는 칸</span>
      </h2>
      <p className="muted small">
        홈 세계 시계의 공휴일은 무료 공휴일 서비스에서 불러와요. 음력 휴일처럼 서비스에 빠진 날은 여기에 넣으면 그 나라 시계에 '공휴일'로 보여요. (시계에
        마우스를 올리면 몇 개 불러왔는지 보여요)
      </p>
      <div className="btn-row holiday-add">
        <select value={code} onChange={(e) => setCode(e.target.value)}>
          {codes.map(([c, n]) => (
            <option key={c} value={c}>
              {n} ({c})
            </option>
          ))}
        </select>
        <DateInput value={date} placeholder="날짜 예: 20261111" onChange={setDate} />
        <input placeholder="휴일 이름 (예: 칭기즈칸 탄생일)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="primary" onClick={add} disabled={!date || !name.trim()}>
          추가
        </button>
      </div>
      {list.length > 0 && (
        <table className="settings-table">
          <tbody>
            {list.map((h) => (
              <tr key={h.code + h.date}>
                <td>{COUNTRY_NAMES[h.code] ?? h.code}</td>
                <td>{h.date.replace(/-/g, '.')}</td>
                <td>{h.name}</td>
                <td>
                  <button
                    className="danger small"
                    onClick={() => save('config', { ...cfg, holidays: (cfg.holidays ?? []).filter((x) => !(x.code === h.code && x.date === h.date)) })}
                  >
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/** mem 근태 서버 자동 가져오기 (관리자): 마지막 결과 + 지금 가져오기 */
function MemAutoSection() {
  const { data } = useStore();
  const last = data.memDirectory.find((d) => d.id === '_status')?.lastRun;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = (await httpsCallable(functions, 'syncMemNow')()).data as { ok: boolean; saved?: number; read?: number; error?: string };
      setMsg(r.ok ? `가져왔어요 ✓ mem ${r.read}줄 중 대시보드 사람 ${r.saved}명` : `실패: ${r.error}`);
    } catch (e) {
      setMsg(`실패: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요)`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>
        mem 근태 자동 가져오기 <span className="tag gray">관리자만 보이는 칸</span>
      </h2>
      <p className="muted small">
        서버가 평일 9시~10시엔 10분마다, 그 뒤엔 12시 · 2시 · 4시 · 5시 · 6시 · 7시에 mem 에 로그인해서 부서 근태 현황만 읽어요. 노트북을 안 켜도 돼요. 아이디·비밀번호는 Firebase 비밀값 저장소에만 있고
        이 사이트에서는 볼 수 없어요.
      </p>
      <p className="small">
        마지막 실행:{' '}
        {last ? (
          <>
            {new Date(last.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} ·{' '}
            {last.ok ? (
              <span className="tag green">성공 · {last.saved}명 ({(last.names ?? []).join(', ')})</span>
            ) : (
              <span className="tag red">실패 · {last.error}</span>
            )}
          </>
        ) : (
          <span className="muted">아직 없음</span>
        )}
      </p>
      <button className="primary" onClick={run} disabled={busy || DATA_MODE === 'local'}>
        {busy ? '가져오는 중…' : '지금 가져오기'}
      </button>
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

/** 구글 캘린더 연결 (관리자): 이름·색·iCal 비공개 주소. 주소는 서버에만 저장되고 다시 보여줄 때는 가려서 */
function CalendarAdmin() {
  type Row = { id?: string; name: string; color: string; url: string; masked?: string };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try {
      const r = (await httpsCallable(functions, 'calendarConfig')()).data as { list: Row[] };
      setRows(r.list.map((x) => ({ ...x, url: '' })));
    } catch (e) {
      setRows([]);
      setMsg(`목록을 못 불러왔어요: ${(e as Error).message} (서버 함수를 올렸는지 확인해 주세요)`);
    }
  };
  const save = async () => {
    if (!rows) return;
    setBusy(true);
    setMsg('');
    try {
      const r = (await httpsCallable(functions, 'saveCalendars')({ list: rows.map(({ id, name, color, url }) => ({ id, name, color, url: url || undefined })) })).data as {
        count: number;
      };
      setMsg(`저장했어요 ✓ 달력 ${r.count}개 — 달력 탭에서 확인해 보세요`);
      await load();
    } catch (e) {
      setMsg(`저장 실패: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const set = (i: number, p: Partial<Row>) => setRows((l) => (l ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)));
  return (
    <section className="card">
      <h2>
        구글 캘린더 <span className="tag gray">관리자만 보이는 칸</span>
      </h2>
      <p className="muted small">
        달력 탭에 보일 구글 캘린더예요. 구글 캘린더 → 설정 → 해당 캘린더 → <b>캘린더 통합</b> → <b>iCal 형식의 비공개 주소</b>를 복사해 붙여넣어 주세요. 주소는
        서버에만 저장되고 이 사이트에서는 다시 볼 수 없어요 (그 주소만 있으면 일정을 볼 수 있으니 다른 곳에 공유하지 마세요).
      </p>
      {DATA_MODE === 'local' ? (
        <p className="muted small">로컬 테스트 모드에서는 쓸 수 없어요.</p>
      ) : rows === null ? (
        <button onClick={load}>달력 목록 불러오기</button>
      ) : (
        <>
          <table className="settings-table">
            <thead>
              <tr>
                <th>이름</th>
                <th>색</th>
                <th>iCal 비공개 주소</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id ?? `new${i}`}>
                  <td>
                    <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="예: 부서 일정" />
                  </td>
                  <td>
                    <input type="color" value={r.color} onChange={(e) => set(i, { color: e.target.value })} />
                  </td>
                  <td>
                    <input
                      className="cal-url"
                      value={r.url}
                      onChange={(e) => set(i, { url: e.target.value })}
                      placeholder={r.masked ? `저장됨: ${r.masked} (바꿀 때만 입력)` : 'https://calendar.google.com/calendar/ical/…/basic.ics'}
                    />
                  </td>
                  <td>
                    <button className="danger small" onClick={() => setRows((l) => (l ?? []).filter((_, j) => j !== i))}>
                      빼기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="btn-row">
            <button onClick={() => setRows((l) => [...(l ?? []), { name: '', color: pickColor((l ?? []).map((x) => x.color)), url: '' }])}>+ 달력 추가</button>
            <button className="primary" onClick={save} disabled={busy}>
              {busy ? '저장 중…' : '저장'}
            </button>
          </div>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

/** 내 달력: 각자 보고 싶은 구글 캘린더(iCal 비공개 주소)를 추가 — 본인 달력 페이지에만 보임 */
function MyCalendars({ email }: { email: string }) {
  type Row = { id: string; name: string; color: string; url: string };
  const [rows, setRows] = useState<Row[] | null>(null);
  const [msg, setMsg] = useState('');
  const ref = doc(db, 'userCalendars', email);
  useEffect(() => {
    getDoc(ref)
      .then((s) => setRows(((s.data()?.list as Row[]) ?? []).map((r) => ({ ...r }))))
      .catch((e) => {
        setRows([]);
        setMsg(`못 불러왔어요: ${(e as Error).message} (보안 규칙을 올렸는지 확인해 주세요 — deploy.bat)`);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);
  const set = (i: number, p: Partial<Row>) => setRows((l) => (l ?? []).map((x, j) => (j === i ? { ...x, ...p } : x)));
  const save = async () => {
    if (!rows) return;
    const list = rows
      .map((r) => ({ ...r, name: r.name.trim() || '내 달력', url: r.url.trim().replace(/^webcal:/, 'https:') }))
      .filter((r) => r.url);
    if (list.some((r) => !/^https:\/\//.test(r.url))) return setMsg('주소는 https:// 로 시작하는 iCal 주소여야 해요');
    try {
      await setDoc(ref, { list, updatedAt: new Date().toISOString() });
      setRows(list);
      setMsg(`저장했어요 ✓ 내 달력 ${list.length}개 — 달력 페이지에서 나에게만 보여요`);
    } catch (e) {
      setMsg(`저장 실패: ${(e as Error).message}`);
    }
  };
  return (
    <section className="card">
      <h2>내 달력</h2>
      <p className="muted small">
        내가 보고 싶은 구글 캘린더를 추가하면 <b>나의 달력 페이지에만</b> 보여요 (다른 사람에게는 안 보여요). 구글 캘린더 → 설정 → 해당 캘린더 → 캘린더 통합 →{' '}
        <b>iCal 형식의 비공개 주소</b>를 붙여넣어 주세요.
      </p>
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <table className="settings-table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>색</th>
                  <th>iCal 비공개 주소</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id}>
                    <td>
                      <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="예: 내 일정" />
                    </td>
                    <td>
                      <input type="color" value={r.color} onChange={(e) => set(i, { color: e.target.value })} />
                    </td>
                    <td>
                      <input className="cal-url" value={r.url} onChange={(e) => set(i, { url: e.target.value })} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
                    </td>
                    <td>
                      <button className="danger small" onClick={() => setRows((l) => (l ?? []).filter((_, j) => j !== i))}>
                        빼기
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="btn-row">
            <button onClick={() => setRows((l) => [...(l ?? []), { id: uid(), name: '', color: pickColor((l ?? []).map((x) => x.color)), url: '' }])}>+ 내 달력 추가</button>
            <button className="primary" onClick={save}>
              저장
            </button>
          </div>
        </>
      )}
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}
