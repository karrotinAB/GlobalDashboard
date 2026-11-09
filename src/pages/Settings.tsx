import { useEffect, useRef, useState } from 'react';
import { bookmarklet, memNames } from '../lib/mem';
import { useAccess } from '../components/AuthGate';
import AccessAdmin from '../components/AccessAdmin';
import ChangePassword from '../components/ChangePassword';
import { useLookups, useStore } from '../data/store';
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

export default function Settings() {
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
      </div>

      <section className="card">
        <h2>저장 방식</h2>
        {mode === 'firestore' ? (
          <p>
            <span className="tag green">팀 공유 (Firebase)</span> 모든 팀원이 같은 데이터를 보고, 바뀐 내용이 실시간으로 반영돼요.
            {access.email && <span className="muted small"> · {access.email} 로그인 중 ({access.role === 'admin' ? '관리자' : '조원'})</span>}
          </p>
        ) : (
          <p>
            <span className="tag gray">로컬 모드</span> 테스트용이라 이 브라우저에만 저장돼요.
          </p>
        )}
      </section>

      {access.role === 'admin' && <AccessAdmin />}
      {access.email && <ChangePassword />}

      <section className="card">
        <h2>담당자 (조원)</h2>
        <table className="settings-table">
          <thead>
            <tr>
              <th>이름</th>
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

      <MemSection members={members} />

      <section className="card">
        <h2>업체 관리</h2>
        <p className="muted small">타임존을 넣으면 홈 화면에 그 나라 시계가 나와요.</p>
        <div className="table-scroll">
          <table className="settings-table">
            <thead>
              <tr>
                <th>업체명</th>
                <th>나라 (시계 이름)</th>
                <th>타임존</th>
                <th>색</th>
                <th>순서</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {companies.map((c) => (
                <CompanyRow key={c.id} c={c} onSave={(x) => save('companies', x)} onDelete={
                  access.role === 'member'
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
          <button onClick={loadSample}>기본 담당자 넣기</button>
        </div>
        {msg && <p className="small">{msg}</p>}
        <p className="muted small">
          할일 {data.tasks.length} · 주문 {data.orders.length} · 근태 기록 {data.attendance.length}
        </p>
      </section>
    </div>
  );
}

function MemberRow({ m, onSave, onDelete }: { m: Member; onSave: (m: Member) => void; onDelete: () => void }) {
  const [name, setName] = useState(m.name);
  const [memName, setMemName] = useState(m.memName ?? '');
  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== m.name && onSave({ ...m, name: name.trim() })} />
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
  const [name, setName] = useState(c.name);
  const [country, setCountry] = useState(c.country);
  return (
    <tr>
      <td>
        <input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== c.name && onSave({ ...c, name: name.trim() })} />
      </td>
      <td>
        <input value={country} onChange={(e) => setCountry(e.target.value)} onBlur={() => country !== c.country && onSave({ ...c, country })} />
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

function MemSection({ members }: { members: Member[] }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const names = memNames(members);
  const dashUrl = window.location.origin + window.location.pathname;
  // React 는 javascript: 주소를 막아서 직접 넣음
  useEffect(() => {
    ref.current?.setAttribute('href', bookmarklet(dashUrl, names));
  }, [dashUrl, names.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="card">
      <h2>mem 근태 연결</h2>
      <h3 className="sub-title">⭐ 크롬 확장 프로그램 (자동, 추천)</h3>
      <ol className="mem-steps">
        <li>
          <a className="link-strong" href="./gd-extension.zip" download>
            확장 프로그램 내려받기 (zip)
          </a>{' '}
          → 압축 풀기
        </li>
        <li>
          크롬 주소창에 <code>chrome://extensions</code> → 오른쪽 위 <b>개발자 모드</b> 켜기 → <b>압축해제된 확장 프로그램을 로드합니다</b> → 압축 푼{' '}
          <b>2조-근태-보내기</b> 폴더 선택
        </li>
        <li>
          mem에 로그인한 탭에서 크롬 오른쪽 위 🧩 → <b>2조 근태 보내기</b> 🪼 → <b>"지금 보고 있는 사이트를 mem으로 등록"</b> (처음 한 번만)
        </li>
        <li>
          이제 mem에서 <b>부서 근태 현황</b>이 뜰 때마다 우리 조 근태가 자동으로 대시보드에 들어가요. 대시보드를 안 열어 뒀으면 다음에 열 때
          들어가요.
        </li>
      </ol>
      <p className="muted small">
        mem 화면에서 우리 조 이름({names.join(', ')})인 줄만 읽고 다른 사람 정보는 가져오지 않아요. 저장은 로그인된 대시보드가 해요.
      </p>

      <h3 className="sub-title">북마크 버튼 (확장 프로그램을 못 쓸 때)</h3>
      <ol className="mem-steps">
        <li>
          아래 버튼을 브라우저 <b>즐겨찾기바로 끌어다 놓기</b> (즐겨찾기바가 안 보이면 Ctrl+Shift+B)
        </li>
        <li>
          mem에서 <b>부서 근태 현황</b> 창을 연 상태로 그 즐겨찾기를 클릭 (한 명만 눌러도 우리 조 다 반영)
        </li>
      </ol>
      <a ref={ref} className="bookmarklet" onClick={(e) => e.preventDefault()} title="즐겨찾기바로 끌어다 놓으세요">
        🕘 2조 근태 보내기
      </a>
    </section>
  );
}
