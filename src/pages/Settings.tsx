import { useRef, useState } from 'react';
import { ROLE_NAME, useAccess } from '../components/AuthGate';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { COUNTRY_NAMES } from '../lib/worldHolidays';
import DateInput from '../components/DateInput';
import { DEFAULT_TEAM, TEAMS } from '../lib/team';
import AccessAdmin from '../components/AccessAdmin';
import ChangePassword from '../components/ChangePassword';
import { DATA_MODE, useLookups, useStore } from '../data/store';
import { seedData } from '../data/seed';
import { COLLECTIONS } from '../data/backend';
import { today, uid } from '../lib/date';
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
  'America/Guayaquil',
  'America/Mexico_City',
  'America/Sao_Paulo',
  'Australia/Sydney',
];

/** side: 지금 보고 있던 쪽 (조 대시보드 / 무역사무 페이지) */
export default function Settings({ side = 'team' }: { side?: 'team' | 'trade' }) {
  const { data, mode, save, saveMany, remove } = useStore();
  const access = useAccess();
  const { members, companies } = useLookups();
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
      </div>

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
      {/* 무역사무 담당자: 무역사무 계정, 또는 관리자가 무역사무 페이지에서 설정에 들어왔을 때만 */}
      {(access.role === 'trade' || ((access.role === null || access.role === 'admin') && side === 'trade')) && <TradeMembersSection />}
      {access.role === 'trade' ? (
        access.email && <ChangePassword />
      ) : (
      <>
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
              <MemberRow key={m.id} m={m} onSave={(x) => save('members', x)} onDelete={() => confirm(`${m.name} 삭제?`) && remove('members', m.id)} />
            ))}
          </tbody>
        </table>
        <button
          onClick={() => save('members', { id: uid(), name: '새 담당자', color: '#e0f0e0', order: members.length } satisfies Member)}
        >
          + 담당자 추가
        </button>
      </section>


      <section className="card">
        <h2>업체 관리</h2>
        <p className="muted small">
          타임존을 넣으면 홈 화면에 그 나라 시계가 나와요. <b>매장코드</b>(ERP 매장코드 앞 4자리, 여러 개면 쉼표)를 넣으면 ERP 에 새 주문이 들어올 때 그
          업체 주문 관리에 '새 주문'으로 자동 등록돼요.
        </p>
        <div className="table-scroll">
          <table className="settings-table">
            <thead>
              <tr>
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
              {companies.map((c) => (
                <CompanyRow key={c.id} c={c} onSave={(x) => save('companies', x)} onDelete={
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
            save('companies', { id: uid(), name: '새 업체', country: '', color: '#888888', order: companies.length } satisfies Company)
          }
        >
          + 업체 추가
        </button>
      </section>

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
      </>
      )}
    </div>
  );
}

function MemberRow({ m, onSave, onDelete }: { m: Member; onSave: (m: Member) => void; onDelete: () => void }) {
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
        {onDelete && (
          <button className="danger small" onClick={onDelete}>
            삭제
          </button>
        )}
      </td>
    </tr>
  );
}

function CompanyRow({ c, onSave, onDelete }: { c: Company; onSave: (c: Company) => void; onDelete?: () => void }) {
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
      <button onClick={() => save('tradeMembers', { id: uid(), name: '새 담당자', color: '#d9c7e8', order: list.length } satisfies Member)}>+ 담당자 추가</button>
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
        서버가 평일 하루 6번(9:00 · 10:00 · 10:30 · 18:00 · 18:30 · 19:00) mem 에 로그인해서 부서 근태 현황만 읽어요. 노트북을 안 켜도 돼요. 아이디·비밀번호는 Firebase 비밀값 저장소에만 있고
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
