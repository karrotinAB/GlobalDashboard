import { SALES_CURRENCIES } from '../lib/sales';
import { disablePush, enablePush, sendTestPush, usePushState } from '../lib/push';
import { setBubblePreview, setWishOn, useBubblePreview, useWishOn } from '../lib/bdayMsgs';
import { openWishPreview } from '../components/BirthdayWish';
import { useFxSetting, writeFx, type FxLevel, type FxMode } from '../components/WeatherFx';
import { BLINKS, isXmas, PALETTES, XMAS_FROM, XMAS_TO, useLightsSetting, writeLights, type LightBlink, type LightPalette, type LightsCfg } from '../components/LightsFx';
import { saveWorkTypes, useWorkTypes } from '../lib/workTypes';
import { useEffect, useRef, useState } from 'react';
import { ROLE_NAME, setViewAsMember, useAccess } from '../components/AuthGate';
import { httpsCallable } from 'firebase/functions';
import { collection, doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { COUNTRY_NAMES } from '../lib/worldHolidays';
import DateInput from '../components/DateInput';
import { DEFAULT_TEAM, TEAMS } from '../lib/team';
import { isFresh, syncWeatherNow, useWeatherRaw, weatherFxOf } from '../lib/weather';
import AccessAdmin from '../components/AccessAdmin';
import { SalesApiAdmin, StoreAreaSection } from '../components/SalesSettings';
import ChangePassword from '../components/ChangePassword';
import { Modal } from '../components/ui';
import { useFullName } from '../lib/fullName';
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
  const myFullName = useFullName(access.email ?? ''); // 팀장님 · 이사님 인사용 (성까지)
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

  // 일반 설정 (모두에게 보이는 것) · 관리자 설정 (관리자에게만 보이는 것) 탭
  const hasAdminTab = access.role !== 'trade' && (access.role === 'admin' || access.role === null || access.canManage);
  const [stab, setStab] = useState<'general' | 'admin' | 'header'>(() => {
    try {
      const t = localStorage.getItem('gd:settingsTab');
      return t === 'admin' || t === 'header' ? t : 'general';
    } catch {
      return 'general';
    }
  });
  const pickTab = (t: 'general' | 'admin' | 'header') => {
    setStab(t);
    try {
      localStorage.setItem('gd:settingsTab', t);
    } catch {
      /* 무시 */
    }
  };
  const showGen = !hasAdminTab || stab === 'general';
  const showAdm = hasAdminTab && stab === 'admin';
  const showHdr = hasAdminTab && stab === 'header' && (access.realRole === 'admin' || access.role === null);

  return (
    <div className="page">
      {(() => {
        // 접속한 사람 이름: 내 담당자 카드(조·무역사무) → 계정 이름 → 이메일 앞
        const mine = [...members, ...data.tradeMembers].find((m) => !!access.email && m.email?.toLowerCase() === access.email);
        const name = mine?.name ?? access.accountName ?? (access.email ? access.email.split('@')[0] : '');
        if (!name) return null;
        // 조원(PM): '2조 가영님' · 무역사무: '무역사무 ○○님' · 팀장님 · 이사님: '이락연 팀장님' (성까지 붙은 이름)
        const role = access.realRole ?? access.role;
        const who =
          role === 'lead' || role === 'director' ? (
            <>
              <b>{myFullName || name}</b> {role === 'lead' ? '팀장님' : '이사님'}
            </>
          ) : role === 'trade' ? (
            <>
              무역사무 <b>{name}</b>님
            </>
          ) : (
            <>
              {/^\d+$/.test(String(access.team ?? '')) ? `${access.team}조 ` : ''}
              <b>{name}</b>님
            </>
          );
        return <p className="settings-hello">안녕하세요 {who} 👋</p>;
      })()}
      <div className="page-head">
        <h1>설정</h1>
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

      {/* 일반 설정 · 관리자 설정 (관리자에게만 탭이 보임) */}
      {hasAdminTab && (
        <div className="seg settings-tabs">
          <button className={stab === 'general' ? 'on' : ''} onClick={() => pickTab('general')}>
            ⚙️ 일반 설정
          </button>
          <button className={stab === 'admin' ? 'on' : ''} onClick={() => pickTab('admin')}>
            🛡 관리자 설정
          </button>
          {(access.realRole === 'admin' || access.role === null) && (
            <button className={stab === 'header' ? 'on' : ''} onClick={() => pickTab('header')}>
              🎨 헤더 설정
            </button>
          )}
        </div>
      )}
      {/* 무역사무 담당자: 무역사무 계정, 또는 관리자가 무역사무 페이지에서 설정에 들어왔을 때만 */}
      {showGen && (access.role === 'trade' || ((access.role === null || access.role === 'admin') && side === 'trade')) && (
        <>
          <TradeMembersSection />
          <WorkTypesSection />
        </>
      )}
      {access.role === 'trade' ? (
        <>
          {access.email && <PushSection email={access.email} />}
          {access.email && <ChangePassword />}
        </>
      ) : (
      <>
      {showGen && access.email && <PushSection email={access.email} />}
      {showGen && access.email && <ChangePassword />}
      {/* 헤더 설정 (관리자): 날씨 효과 · 꼬마전구 · 생일 한마디 */}
      {showHdr && <WishSection />}
      {showHdr && <WeatherFxSection />}
      {showHdr && <LightsSection />}
      {showGen && (
      <section className="card">
        <h2>담당자 ({access.viewLabel})</h2>
        <table className="settings-table members-table">
          <thead>
            <tr>
              <th>이름</th>
              <th className="m-hide">로그인 이메일 (본인 카드)</th>
              <th className="m-hide">mem 이름</th>
              <th>색</th>
              <th className="m-hide">순서</th>
              <th className="m-hide" />
              <th className="m-only">설정</th>
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
      )}
      {showGen && access.email && DATA_MODE !== 'local' && <MyCalendars email={access.email} />}
      {showAdm && access.role === 'admin' && <CalendarAdmin />}
      {showGen && (
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
          <table className="settings-table companies-table">
            <thead>
              <tr>
                {hasMirror && <th title="체크한 업체만 주간 할일·주문 관리·클레임에 보여요">내 담당</th>}
                <th>업체명</th>
                <th className="m-hide">나라 (시계 이름)</th>
                <th className="m-hide">매장코드 (4자리)</th>
                <th className="m-hide">타임존</th>
                <th className="m-hide" title="이 업체 주문 외화가 USD 가 아니면 골라 주세요. 화면에는 USD 로 바꿔서 보여주고 원래 외화는 아래 작게">수출 통화</th>
                <th>색</th>
                <th className="m-hide">순서</th>
                <th className="m-hide" />
                <th className="m-only">설정</th>
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
      )}
      {showGen && side !== 'trade' && <StoreAreaSection />}
      {showGen && (
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
      )}

      {/* 아래는 관리자용 (관리자 설정 탭) */}
      {showAdm && (
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
      )}

      {showAdm && access.role === 'admin' && <AccessAdmin />}
      {showAdm && access.role === 'admin' && <OrderNameAdmin />}
      {showAdm && access.canManage && <HolidayAdmin />}
      {showAdm && access.role === 'admin' && <MemAutoSection />}
      {showAdm && access.role === 'admin' && <SalesApiAdmin />}




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
  const [gear, setGear] = useState(false); // 휴대폰: ⚙ 눌러 나머지 설정
  const isAdmin = useAccess().canManage;
  const nameEl = <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && onSave({ ...m, name: name.trim() })} />;
  const emailEl =
    isAdmin && accounts.length > 0 ? (
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
    );
  const memEl = (
    <input
      value={memName}
      placeholder={`비우면 '…${m.name}'로 찾음`}
      onChange={(e) => setMemName(e.target.value)}
      onBlur={() => memName.trim() !== (m.memName ?? '') && onSave({ ...m, memName: memName.trim() || undefined })}
    />
  );
  const colorEl = <input type="color" value={m.color} onChange={(e) => onSave({ ...m, color: e.target.value })} />;
  const orderEl = <input type="number" className="num" value={m.order} onChange={(e) => onSave({ ...m, order: Number(e.target.value) })} />;
  const delEl = onDelete && (
    <button className="danger small" onClick={onDelete}>
      삭제
    </button>
  );
  return (
    <tr>
      <td className="c-name">{nameEl}</td>
      <td className="m-hide">{emailEl}</td>
      <td className="m-hide">{memEl}</td>
      <td className="c-color">{colorEl}</td>
      <td className="m-hide">{orderEl}</td>
      <td className="m-hide">{delEl}</td>
      <td className="m-only">
        <button className="co-gear" title="이 담당자 설정" onClick={() => setGear(true)}>
          ⚙
        </button>
        {gear && (
          <Modal title={`${m.name} 설정`} onClose={() => setGear(false)}>
            <div className="mset">
              <label>
                <span>이름</span>
                {nameEl}
              </label>
              <label>
                <span>로그인 이메일 (본인 카드)</span>
                {emailEl}
              </label>
              <label>
                <span>mem 이름</span>
                {memEl}
              </label>
              <div className="mset-row">
                <label>
                  <span>색</span>
                  {colorEl}
                </label>
                <label>
                  <span>순서</span>
                  {orderEl}
                </label>
              </div>
            </div>
            <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
              {delEl ?? <span />}
              <button className="primary" onClick={() => setGear(false)}>
                닫기
              </button>
            </div>
          </Modal>
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
  const [gear, setGear] = useState(false); // 휴대폰: ⚙ 눌러 나머지 설정
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
  const moveEl = (
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
  );
  // 팀장님·이사님 화면의 조 업체: 보기만 + 담당 조 바꾸기 (조에서 고치면 여기도 바로 바뀜)
  if (c.team)
    return (
      <tr className="mirror-row">
        {mineCell}
        <td>
          {c.name} <span className="tag gray small">{c.team}조 업체</span>
        </td>
        <td className="m-hide">{c.country}</td>
        <td className="m-hide">{(c.storeCodes ?? []).join(', ')}</td>
        <td className="m-hide">{c.timezone ?? ''}</td>
        <td className="m-hide">{c.exportCurrency || 'USD'}</td>
        <td>
          <span className="dot" style={{ background: c.color }} />
        </td>
        <td colSpan={2} className="m-hide">
          {moveEl}
        </td>
        <td className="m-only">
          <button className="co-gear" title="이 업체 설정" onClick={() => setGear(true)}>
            ⚙
          </button>
          {gear && (
            <Modal title={`${c.name} (${c.team}조 업체)`} onClose={() => setGear(false)}>
              <p className="muted small" style={{ marginTop: 0 }}>
                {c.team}조 업체라 여기서는 보기만 해요 (고치는 건 {c.team}조에서).
              </p>
              <div className="mset">
                <div className="mset-view">
                  <span>나라 (시계 이름)</span>
                  <b>{c.country || '—'}</b>
                </div>
                <div className="mset-view">
                  <span>매장코드</span>
                  <b>{(c.storeCodes ?? []).join(', ') || '—'}</b>
                </div>
                <div className="mset-view">
                  <span>타임존</span>
                  <b>{c.timezone || '—'}</b>
                </div>
                <label>
                  <span>담당 조 바꾸기</span>
                  {moveEl}
                </label>
              </div>
              <div className="btn-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
                <button className="primary" onClick={() => setGear(false)}>
                  닫기
                </button>
              </div>
            </Modal>
          )}
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
  const nameEl = <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && onSave({ ...c, name: name.trim() })} />;
  const countryEl = <input value={country} onChange={(e) => setCountry(e.target.value)} onBlur={() => country !== c.country && onSave({ ...c, country })} />;
  const codesEl = (
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
  );
  const tzEl = (
    <select value={c.timezone ?? ''} onChange={(e) => onSave({ ...c, timezone: e.target.value || undefined })}>
      <option value="">(시계 없음)</option>
      {[...new Set([...(c.timezone ? [c.timezone] : []), ...TIMEZONES])].map((tz) => (
        <option key={tz} value={tz}>
          {tz}
        </option>
      ))}
    </select>
  );
  const curEl = (
    <select value={c.exportCurrency ?? 'USD'} onChange={(e) => onSave({ ...c, exportCurrency: e.target.value === 'USD' ? undefined : e.target.value })} title="주문 외화 통화 (기본 USD)">
      {['USD', 'KRW', ...SALES_CURRENCIES.filter((x) => x !== 'KRW' && x !== 'USD')].map((x) => (
        <option key={x}>{x}</option>
      ))}
    </select>
  );
  const colorEl = <input type="color" value={c.color ?? '#888888'} onChange={(e) => onSave({ ...c, color: e.target.value })} />;
  const orderEl = <input type="number" className="num" value={c.order} onChange={(e) => onSave({ ...c, order: Number(e.target.value) })} />;
  const delEl = onDelete && (
    <button className="danger small" onClick={onDelete}>
      삭제
    </button>
  );
  return (
    <tr>
      {mineCell}
      <td className="c-name">{nameEl}</td>
      <td className="m-hide">{countryEl}</td>
      <td className="m-hide">{codesEl}</td>
      <td className="m-hide">{tzEl}</td>
      <td className="m-hide">{curEl}</td>
      <td className="c-color">{colorEl}</td>
      <td className="m-hide">{orderEl}</td>
      <td className="m-hide">{delEl}</td>
      <td className="m-only">
        <button className="co-gear" title="이 업체 설정" onClick={() => setGear(true)}>
          ⚙
        </button>
        {gear && (
          <Modal title={`${c.name} 설정`} onClose={() => setGear(false)}>
            <div className="mset">
              <label>
                <span>업체명</span>
                {nameEl}
              </label>
              <label>
                <span>나라 (시계 이름)</span>
                {countryEl}
              </label>
              <label>
                <span>매장코드 (4자리 · 여러 개면 쉼표)</span>
                {codesEl}
              </label>
              <label>
                <span>타임존</span>
                {tzEl}
              </label>
              <label>
                <span>수출 통화 (기본 USD)</span>
                {curEl}
              </label>
              <div className="mset-row">
                <label>
                  <span>색</span>
                  {colorEl}
                </label>
                <label>
                  <span>순서</span>
                  {orderEl}
                </label>
              </div>
            </div>
            <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 14 }}>
              {delEl ?? <span />}
              <button className="primary" onClick={() => setGear(false)}>
                닫기
              </button>
            </div>
          </Modal>
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

/** 무역사무 작업유형: 무역사무(·관리자)가 넣고 · 이름 바꾸고 · 지움 */
function WorkTypesSection() {
  const list = useWorkTypes();
  const { data, saveMany } = useStore();
  const [text, setText] = useState('');
  const [edit, setEdit] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [err, setErr] = useState('');
  const save = (next: string[]) => saveWorkTypes(next).catch((e) => setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`));
  const used = (w: string) => data.requests.filter((r) => r.workType === w);
  const rename = async (from: string) => {
    const to = editText.trim();
    setEdit(null);
    if (!to || to === from) return;
    if (list.includes(to)) return setErr(`'${to}' 은(는) 이미 있어요`);
    await save(list.map((x) => (x === from ? to : x)));
    // 이미 이 작업유형으로 적힌 업무도 같이 바꿈
    const rs = used(from);
    if (rs.length && confirm(`'${from}' 으로 적힌 업무 ${rs.length}개도 '${to}' 로 바꿀까요?`)) await saveMany('requests', rs.map((r) => ({ ...r, workType: to })));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    void save(next);
  };
  // 목록에 없는데 업무에 적혀 있는 작업유형 (예전 이름)
  const orphans = [...new Set(data.requests.map((r) => r.workType).filter((w): w is string => !!w && !list.includes(w)))];
  return (
    <section className="card">
      <h2>작업유형</h2>
      <p className="muted small">무역사무 업무의 '작업유형' 목록이에요. 이름을 누르면 고치고, ✕ 로 지워요. ▲▼ 로 순서를 바꿔요.</p>
      {err && <p className="warn small">{err}</p>}
      <div className="wt-edit-list">
        {list.map((w, i) => (
          <div key={w} className="wt-edit-row">
            <span className="wt-edit-move">
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} title="위로">
                ▲
              </button>
              <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, 1)} title="아래로">
                ▼
              </button>
            </span>
            {edit === w ? (
              <input
                autoFocus
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onBlur={() => void rename(w)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setEdit(null);
                }}
              />
            ) : (
              <button
                className="wt-edit-name"
                onClick={() => {
                  setEdit(w);
                  setEditText(w);
                }}
                title="눌러서 이름 고치기"
              >
                {w}
              </button>
            )}
            <span className="muted small">{used(w).length ? `업무 ${used(w).length}개` : ''}</span>
            <button
              className="icon-btn"
              title="지우기"
              onClick={() => confirm(`'${w}' 작업유형을 지울까요?${used(w).length ? ` (이미 이걸로 적힌 업무 ${used(w).length}개는 그대로 남아요)` : ''}`) && void save(list.filter((x) => x !== w))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="wt-edit-add">
        <input
          placeholder="새 작업유형"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !list.includes(text.trim())) {
              void save([...list, text.trim()]);
              setText('');
            }
          }}
        />
        <button
          className="primary"
          disabled={!text.trim() || list.includes(text.trim())}
          onClick={() => {
            void save([...list, text.trim()]);
            setText('');
          }}
        >
          추가
        </button>
      </div>
      {orphans.length > 0 && (
        <p className="muted small" style={{ marginTop: 10 }}>
          목록에 없는데 업무에 적혀 있는 작업유형: {orphans.map((o) => `'${o}' (${used(o).length}개)`).join(', ')}
        </p>
      )}
    </section>
  );
}

/** 헤더 날씨 효과 (실험 · 관리자만): 이 브라우저에서만 켜져요. 실제 날씨와는 아직 연결 안 함 */
/** 지금 받아 둔 기상청 날씨 (서초구 반포대로 · 매시 50분) + 그래서 헤더에 뜨는 효과 */
function WeatherNowBox() {
  const w = useWeatherRaw();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const SKY: Record<number, string> = { 1: '☀️ 맑음', 3: '⛅ 구름 많음', 4: '☁️ 흐림' };
  const KIND: Record<string, string> = { rain: '☔ 비', sleet: '🌨️ 비 · 눈', snow: '❄️ 눈' };
  const hm = (iso: string) => `${Number(iso.slice(11, 13))}시`;
  const fresh = isFresh(w);
  const fx = fresh ? weatherFxOf(w) : null;
  const FXW: Record<string, string> = { rain: '☔ 비', snow: '❄️ 눈', frost: '🧊 서리' };
  const LV = ['', '약하게', '보통', '강하게'];
  const refresh = async () => {
    setBusy(true);
    setMsg('');
    try {
      await syncWeatherNow();
      setMsg('새로 받았어요 ✓');
    } catch (e) {
      setMsg(`못 받았어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wx-now">
      <div className="wx-now-head">
        <b>📡 지금 받아 둔 날씨</b>
        <span className="muted small">기상청 초단기예보 · 서초구 반포대로 · 매시 50분 (못 받으면 10분에 한 번 더 · 하루 종일)</span>
        <button className="small" disabled={busy} onClick={() => void refresh()}>
          {busy ? '받는 중…' : '↻ 지금 다시 받기'}
        </button>
        {msg && <span className="small muted">{msg}</span>}
      </div>
      {w === undefined ? (
        <p className="muted small">불러오는 중…</p>
      ) : !w ? (
        <p className="muted small">아직 받은 날씨가 없어요 (서버를 올렸는지 · secrets/weather 키가 있는지 확인)</p>
      ) : (
        <>
          <div className="wx-now-main">
            <span className="wx-now-temp">{typeof w.temp === 'number' ? `${w.temp}°` : '–'}</span>
            <span>{w.now ? `${KIND[w.now]} 오는 중` : (SKY[w.sky ?? 0] ?? '–')}</span>
            {w.hours?.[0]?.rn && <span className="muted small">1시간 강수량 {w.hours[0].rn}</span>}
            <span className="muted small">
              받은 때 {w.at ? new Date(w.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–'}
              {!fresh && ' · 3시간 넘게 지나서 지금은 안 써요'}
              {w.error && w.triedAt && <span className="warn"> · {new Date(w.triedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false })}에 못 받음: {w.error}</span>}
            </span>
            <span className="wx-now-fx">
              → 헤더 효과: <b>{fx ? `${FXW[fx.mode]}${fx.mode === 'frost' ? '' : ` ${LV[fx.level]}`}` : '없음'}</b>
            </span>
          </div>
          {(w.hours?.length ?? 0) > 0 && (
            <div className="wx-now-hours">
              {w.hours!.slice(0, 6).map((x) => (
                <div key={x.at} className={x.kind ? 'wet' : ''}>
                  <span className="muted">{hm(x.at)}</span>
                  <b>{typeof x.temp === 'number' ? `${x.temp}°` : ''}</b>
                  <span>{x.kind ? KIND[x.kind] : SKY[x.sky ?? 0] ?? '–'}</span>
                  {x.rn && !/없음/.test(x.rn) && <span className="muted">{x.rn}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WeatherFxSection() {
  const fx = useFxSetting();
  const set = (p: Partial<{ mode: FxMode; level: FxLevel }>) => writeFx({ ...fx, ...p });
  return (
    <section className="card">
      <h2>🌧 헤더 날씨 효과 미리보기</h2>
      <p className="muted small">
        실제로는 지금 비 · 눈이 오면 (기상청) 모두의 헤더에 자동으로 떠요. 세기는 1시간 강수량으로: 3mm 미만 약하게 · 15mm 미만 보통 · 그 이상 강하게. 비는 약하게 = 물방울 + 아주 살짝 빗줄기 · 보통 = 뒤로 빗줄기 · 강하게 = 쏴쏴 쏟아짐. 눈은 보통부터 헤더 아래에 조금씩 쌓여요 (강하게는 더 많이). 비 · 눈 없이 영하 10도 이하면 🧊 서리가 끼고, 마우스로 문지르면 투명해졌다가 그린 때부터 1분 동안 서서히 다시 서리가 껴요. 여기서 켜면 관리자 이 브라우저에서만 미리 봐요 (실제 날씨보다 먼저 · 끄면 실제 날씨대로).
      </p>
      <WeatherNowBox />
      <div className="wxfx-ctl">
        <div className="seg">
          {(
            [
              ['off', '끔'],
              ['rain', '☔ 비'],
              ['snow', '❄️ 눈'],
              ['frost', '🧊 서리'],
            ] as [FxMode, string][]
          ).map(([k, l]) => (
            <button key={k} className={fx.mode === k ? 'on' : ''} onClick={() => set({ mode: k })}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          {(
            [
              [1, '약하게'],
              [2, '보통'],
              [3, '강하게'],
            ] as [FxLevel, string][]
          ).map(([k, l]) => (
            <button key={k} className={fx.level === k ? 'on' : ''} disabled={fx.mode === 'off' || fx.mode === 'frost'} onClick={() => set({ level: k })}>
              {l}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 헤더 꼬마전구 미리보기 (관리자 · 이 브라우저에서만) */
function LightsSection() {
  const v = useLightsSetting();
  const set = (p: Partial<LightsCfg>) => writeLights({ ...v, ...p });
  return (
    <section className="card">
      <h2>{isXmas() ? '🎄 헤더 꼬마전구' : '🎄 헤더 꼬마전구 미리보기'}</h2>
      <p className="muted small">
        {isXmas()
          ? `메리 크리스마스! ${XMAS_FROM.replace('-', '/')} ~ ${XMAS_TO.replace('-', '/')} 동안 헤더에 꼬마전구가 켜져요. 색 · 깜빡임 · 줄 수를 골라 보세요 (이 브라우저에 저장 · 끌 수도 있어요).`
          : `헤더 위쪽에 꼬마전구를 달아 봐요. 지금은 관리자 이 브라우저에서만 보여요 (${XMAS_FROM.replace('-', '/')} ~ ${XMAS_TO.replace('-', '/')} 크리스마스 기간엔 모두에게 켜지고, 헤더 오른쪽 아래에서 각자 고를 수 있어요 — 헤더에 마우스를 올리면 나와요).`}
      </p>
      <div className="wxfx-ctl">
        <div className="seg">
          <button className={!v.on ? 'on' : ''} onClick={() => set({ on: false })}>
            끔
          </button>
          <button className={v.on ? 'on' : ''} onClick={() => set({ on: true })}>
            켬
          </button>
        </div>
        <div className="seg">
          {(Object.keys(PALETTES) as LightPalette[]).map((k) => (
            <button key={k} className={v.palette === k ? 'on' : ''} disabled={!v.on} onClick={() => set({ palette: k })}>
              {PALETTES[k].label}
            </button>
          ))}
        </div>
        <div className="seg">
          {(Object.keys(BLINKS) as LightBlink[]).map((k) => (
            <button key={k} className={v.blink === k ? 'on' : ''} disabled={!v.on} onClick={() => set({ blink: k })}>
              {BLINKS[k]}
            </button>
          ))}
        </div>
        <div className="seg">
          {([1, 2, 3] as const).map((k) => (
            <button key={k} className={v.strands === k ? 'on' : ''} disabled={!v.on} onClick={() => set({ strands: k })}>
              {k}줄
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** 생일 한마디 (헤더 설정 · 관리자): 켜면 모두에게 · 미리보기는 이 브라우저에서만 */
function WishSection() {
  const on = useWishOn();
  const bubbles = useBubblePreview();
  const [err, setErr] = useState('');
  return (
    <section className="card">
      <h2>🎂 생일 한마디</h2>
      <p className="muted small">
        생일인 날 접속한 사람들에게 '생일자에게 한마디' 팝업이 떠요 (25자까지 · 빠른 문구 3개). 보낸 한마디는 생일자 홈 헤더에 말풍선으로 (“생일축하드려요” -가영) 떠요. 생일은 관리자 설정 › 대시보드 사용자의 생일 칸에서 넣어요.
      </p>
      {err && <p className="warn small">{err}</p>}
      <div className="wxfx-ctl">
        <div className="seg">
          <button className={!on ? 'on' : ''} onClick={() => setWishOn(false).catch((e) => setErr(`저장 실패: ${(e as Error).message} (deploy.bat)`))}>
            끔
          </button>
          <button className={on ? 'on' : ''} onClick={() => setWishOn(true).catch((e) => setErr(`저장 실패: ${(e as Error).message} (deploy.bat)`))}>
            켬 (모두에게)
          </button>
        </div>
        <button onClick={openWishPreview}>🔍 팝업 미리보기</button>
        <button className={bubbles ? 'primary' : ''} onClick={() => setBubblePreview(!bubbles)}>
          {bubbles ? '💬 말풍선 미리보기 끄기' : '💬 헤더 말풍선 미리보기'}
        </button>
      </div>
      <p className="muted small" style={{ marginBottom: 0 }}>미리보기는 관리자 이 브라우저에서만 보이고 저장되지 않아요. 말풍선 미리보기는 홈 헤더에서 확인하세요.</p>
    </section>
  );
}

/** 🔔 휴대폰/노트북 알림 (이 기기): 보고방 새 보고 · 답글 · 반응, 전도금 마감 전날 */
function PushSection({ email }: { email: string }) {
  const [st, recheck, why] = usePushState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (on: boolean) => {
    setBusy(true);
    setMsg('');
    try {
      if (on) await enablePush(email);
      else await disablePush();
      setMsg(on ? '이 기기에서 알림을 받아요 ✓' : '이 기기 알림을 껐어요');
    } catch (e) {
      setMsg(`못 했어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      recheck();
    }
  };
  return (
    <section className="card">
      <h2>🔔 휴대폰/노트북 알림</h2>
      <p className="muted small">
        보고방에 새 보고가 올라오거나, 내 보고 · 댓글에 답글이나 반응이 달리면 알려줘요. 전도금 마감 전날(14일 · 말일 전날) 오전 10시에도 알려줘요. 알림을 누르면 그 페이지로 바로 열려요. 기기마다 따로 켜요.
      </p>
      <div className="wxfx-ctl" style={{ alignItems: 'center' }}>
        {st === 'on' ? (
          <>
            <span className="tag green">켜짐 · 이 기기</span>
            <button
              disabled={busy}
              title="내가 알림을 켠 모든 기기로 테스트 알림을 하나 보내요"
              onClick={async () => {
                setBusy(true);
                setMsg('');
                try {
                  const n = await sendTestPush();
                  setMsg(n ? `테스트 알림을 보냈어요 (${n}대) — 몇 초 안에 안 뜨면 브라우저 · 윈도우 알림 설정을 확인해 주세요` : '보낼 기기를 못 찾았어요 — 끄고 다시 켜 보세요');
                } catch (e) {
                  setMsg(`못 보냈어요: ${(e as Error).message} (서버 함수를 올렸는지 확인 — deploy.bat)`);
                } finally {
                  setBusy(false);
                }
              }}
            >
              🔔 테스트 알림 보내기
            </button>
            <button disabled={busy} onClick={() => void run(false)}>
              끄기
            </button>
          </>
        ) : (
          <button className="primary" disabled={busy || st !== 'off'} onClick={() => void run(true)}>
            {busy ? '켜는 중…' : '🔔 이 기기에서 알림 받기'}
          </button>
        )}
      </div>
      {why && <p className="muted small" style={{ marginBottom: 0 }}>{why}</p>}
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
  );
}

/** 관리자 설정 › 🏷 주문 이름 자동으로: 업체마다 자동 등록 주문 이름을 그대로 / 매장 약자 / 매장명 (지금 보고 있는 조의 업체) */
function OrderNameAdmin() {
  const { save } = useStore();
  const { companies } = useLookups();
  const access = useAccess();
  const list = companies.filter((c) => (c.storeCodes ?? []).length > 0);
  const modeOf = (c: Company) => c.orderNameMode ?? (c.orderNameByStore ? 'abbr' : '');
  return (
    <section className="card">
      <h2>🏷 주문 이름 자동으로</h2>
      <p className="muted small">
        ERP 에서 자동 등록된 주문(ERP 번호 · 새 주문)의 이름을 업체마다 바꿔요. <b>매장 약자</b>는 매장 설정의 약자(없으면 판매 데이터 지점 이름), <b>매장명</b>은 회사 API 의 매장 이름(STORE_NAME)이에요. 진행중 주문만 · 사람이 직접 바꾼 이름은 그대로예요. 지금 보고 있는 {access.viewLabel} 업체예요.
      </p>
      {list.length === 0 ? (
        <p className="muted small">매장코드가 있는 업체가 없어요.</p>
      ) : (
        <table className="mini-table on-table">
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <b>{c.name}</b> <span className="muted small">매장코드 {(c.storeCodes ?? []).join(', ')}</span>
                </td>
                <td>
                  <select
                    value={modeOf(c)}
                    onChange={(e) => save('companies', { ...c, orderNameMode: (e.target.value || undefined) as Company['orderNameMode'], orderNameByStore: undefined })}
                  >
                    <option value="">그대로 (ERP 번호)</option>
                    <option value="abbr">매장 약자 (예: 3글자)</option>
                    <option value="storeName">매장명 (STORE_NAME)</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
