import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useStore } from '../data/store';
import { Modal } from './ui';
import type { Role } from './AuthGate';
import SharedLogins from './SharedLogins';

/** 주소록에 쓰는 연락처 (관리자가 설정 > 대시보드 사용자에서 넣음): contacts/{이메일} */
export interface Contact {
  name?: string; // 주소록에 보일 이름 (관리자가 설정에서 · 본인 것도 됨)
  office?: string; // 회사번호
  mobile?: string; // 개인번호
}

interface Person {
  email: string;
  name: string;
  role: Role;
  team?: string;
  office?: string;
  mobile?: string;
}

/** 대시보드 사용자(roles) + 연락처(contacts) 실시간 */
export function usePeople(enabled = true) {
  const [roles, setRoles] = useState<{ email: string; role: Role; name?: string; team?: string; space?: string }[] | null>(null);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (DATA_MODE === 'local' || !enabled) {
      setRoles([]);
      return;
    }
    const u1 = onSnapshot(
      collection(db, 'roles'),
      (snap) => setRoles(snap.docs.map((d) => ({ email: d.id, role: d.data().level as Role, name: d.data().name as string | undefined, team: d.data().team as string | undefined, space: d.data().space as string | undefined }))),
      (e) => {
        setError(e.message);
        setRoles([]);
      },
    );
    const u2 = onSnapshot(
      collection(db, 'contacts'),
      (snap) => setContacts(Object.fromEntries(snap.docs.map((d) => [d.id, d.data() as Contact]))),
      () => {},
    );
    return () => {
      u1();
      u2();
    };
  }, [enabled]);
  return { roles, contacts, error };
}

const GROUPS: { key: string; label: string; match: (p: Person) => boolean }[] = [
  { key: 'director', label: '이사님', match: (p) => p.role === 'director' },
  { key: 'lead', label: '팀장님', match: (p) => p.role === 'lead' },
  { key: '1', label: '1조', match: (p) => (p.role === 'member' || p.role === 'admin') && (p.team ?? '2') === '1' },
  { key: '2', label: '2조', match: (p) => (p.role === 'member' || p.role === 'admin') && (p.team ?? '2') === '2' },
  { key: '3', label: '3조', match: (p) => (p.role === 'member' || p.role === 'admin') && (p.team ?? '2') === '3' },
  { key: 'trade', label: '무역사무', match: (p) => p.role === 'trade' },
];

/** 위쪽 '주소록' 버튼 + 창 */
export default function AddressBook({ className, label = '📇 주소록' }: { className?: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)} title="주소록 (이름 · 이메일 · 회사번호 · 개인번호)">
        {label}
      </button>
      {open && <AddressBookModal onClose={() => setOpen(false)} />}
    </>
  );
}

function AddressBookModal({ onClose }: { onClose: () => void }) {
  const { roles, contacts, error } = usePeople();
  const [q, setQ] = useState('');
  // 탭: 주소록 · ID/PW (같이 쓰는 계정)
  const [tab, setTab] = useState<'people' | 'logins'>(() => {
    try {
      return localStorage.getItem('gd:abTab') === 'logins' ? 'logins' : 'people';
    } catch {
      return 'people';
    }
  });
  const pickTab = (t: 'people' | 'logins') => {
    setTab(t);
    try {
      localStorage.setItem('gd:abTab', t);
    } catch {
      /* 무시 */
    }
  };
  const people = useMemo<Person[]>(
    () =>
      (roles ?? []).map((r) => ({
        ...r,
        name: contacts[r.email]?.name || r.name || r.email.split('@')[0],
        office: contacts[r.email]?.office,
        mobile: contacts[r.email]?.mobile,
      })),
    [roles, contacts],
  );
  const norm = (x: string) => x.toLowerCase().replace(/[\s-]/g, '');
  const nq = norm(q);
  const hit = (p: Person) => !nq || norm(`${p.name} ${p.email} ${p.office ?? ''} ${p.mobile ?? ''}`).includes(nq);
  // 누르면 복사 (이메일·번호)
  const [copied, setCopied] = useState('');
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(text);
    window.setTimeout(() => setCopied((c) => (c === text ? '' : c)), 1500);
  };
  // 회사번호는 마지막 세 자리(내선)를 굵게: 02-520-6044 → 02-520-6<b>044</b>
  const tail = (v: string) => {
    const m = v.match(/^(.*?)(\d)(\D*)(\d)(\D*)(\d)(\D*)$/);
    if (!m) return v;
    return (
      <>
        {m[1]}
        <b className="ab-ext">
          {m[2]}
          {m[3]}
          {m[4]}
          {m[5]}
          {m[6]}
        </b>
        {m[7]}
      </>
    );
  };
  // 칸 자체를 누르면 복사 (복사된 칸은 잠깐 초록)
  const cell = (key: string, v?: string, boldTail = false) =>
    v ? (
      <td key={key} className={`ab-cell ${copied === v ? 'done' : ''}`} onClick={() => void copy(v)} title="누르면 복사">
        {boldTail ? tail(v) : v}
        {copied === v && <span className="ab-toast">복사됨 ✓</span>}
      </td>
    ) : (
      <td key={key} className="ab-empty">
        —
      </td>
    );
  const groups = GROUPS.map((g) => ({ g, list: people.filter((p) => g.match(p) && hit(p)).sort((a, b) => a.name.localeCompare(b.name, 'ko')) })).filter((x) => x.list.length);
  return (
    <Modal title={tab === 'people' ? '📇 주소록' : '🔑 같이 쓰는 계정'} onClose={onClose} wide>
      <div className="seg ab-tabs">
        <button className={tab === 'people' ? 'on' : ''} onClick={() => pickTab('people')}>
          📇 주소록
        </button>
        <button className={tab === 'logins' ? 'on' : ''} onClick={() => pickTab('logins')}>
          🔑 ID/PW
        </button>
      </div>
      <div className="ab-top">
        <input className="search ab-search" autoFocus placeholder={tab === 'people' ? '🔍 이름 · 이메일 · 번호' : '🔍 용도 · ID · 비고'} value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{tab === 'people' ? '이메일·번호 칸을 누르면 복사돼요' : 'ID · PW 칸을 누르면 복사돼요 · PW 는 👁 로 보기 · 용도를 누르면 로그인 페이지로 · 로그인이 안 되면 ⚠ 를 눌러 알려 주세요 · 누구나 넣고 고칠 수 있어요'}</span>
      </div>
      {tab === 'logins' ? (
        <SharedLogins q={q} copy={(t) => void copy(t)} copied={copied} />
      ) : (
      <>
      {DATA_MODE === 'local' && <p className="muted small">로컬 모드에서는 주소록이 없어요.</p>}
      {roles === null && <p className="muted small">불러오는 중…</p>}
      {error && <p className="warn small">주소록을 못 불러왔어요 — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)</p>}
      {groups.length > 0 && (
        <div className="ab-wrap">
          <table className="ab-table">
            <thead>
              <tr>
                <th className="ab-g">구분</th>
                <th>담당자</th>
                <th>회사번호</th>
                <th>개인번호</th>
                <th>이메일</th>
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(({ g, list }) =>
                list.map((p, i) => (
                  <tr key={p.email} className={i === 0 ? 'ab-first' : ''}>
                    {i === 0 && (
                      <th className="ab-g" rowSpan={list.length}>
                        {g.label}
                      </th>
                    )}
                    <td className="ab-name">{p.name}</td>
                    {cell('o', p.office, true)}
                    {cell('m', p.mobile)}
                    {cell('e', p.email)}
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      )}
      {roles !== null && !groups.length && DATA_MODE !== 'local' && <p className="muted small">맞는 사람이 없어요.</p>}
      </>
      )}
    </Modal>
  );
}

/** 세 글자 한글 이름은 성 빼고 (이가영 → 가영) */
export const shortName = (n: string) => (/^[가-힣]{3}$/.test(n) ? n.slice(1) : n);

/** 이메일·아이디 → 계정 이름 (주소록 이름 → 사용자 목록 이름 → 담당자 카드), 두 글자로 */
export function useNameOf() {
  const { roles, contacts } = usePeople();
  const { data } = useStore();
  return (email?: string, fallback?: string) => {
    let e = (email ?? '').toLowerCase();
    // 예전 기록은 아이디(이메일 앞부분)만 있음 → 그걸로 이메일 찾기
    if (!e && fallback && /^[a-z0-9._-]+$/i.test(fallback)) e = roles?.find((r) => r.email.split('@')[0] === fallback.toLowerCase())?.email ?? '';
    const name =
      (e && (contacts[e]?.name || roles?.find((r) => r.email === e)?.name || [...data.members, ...data.tradeMembers].find((m) => m.email?.toLowerCase() === e)?.name)) ||
      fallback ||
      (e ? e.split('@')[0] : '');
    return shortName(name);
  };
}
