import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { Modal } from './ui';
import type { Role } from './AuthGate';

/** 주소록에 쓰는 연락처 (관리자가 설정 > 대시보드 사용자에서 넣음): contacts/{이메일} */
export interface Contact {
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
export function usePeople() {
  const [roles, setRoles] = useState<{ email: string; role: Role; name?: string; team?: string }[] | null>(null);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (DATA_MODE === 'local') {
      setRoles([]);
      return;
    }
    const u1 = onSnapshot(
      collection(db, 'roles'),
      (snap) => setRoles(snap.docs.map((d) => ({ email: d.id, role: d.data().level as Role, name: d.data().name as string | undefined, team: d.data().team as string | undefined }))),
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
  }, []);
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
  const people = useMemo<Person[]>(
    () =>
      (roles ?? []).map((r) => ({
        ...r,
        name: r.name || r.email.split('@')[0],
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
  const cp = (v?: string) =>
    v ? (
      <button type="button" className={`ab-copy ${copied === v ? 'done' : ''}`} onClick={() => void copy(v)} title="누르면 복사">
        {v}
        <span className="ab-copied">{copied === v ? '복사됨 ✓' : '⧉'}</span>
      </button>
    ) : (
      <span className="muted">—</span>
    );
  return (
    <Modal title="📇 주소록" onClose={onClose} wide>
      <input className="search ab-search" autoFocus placeholder="🔍 이름 · 이메일 · 번호" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="muted small ab-hint">이메일·번호를 누르면 복사돼요</p>
      {DATA_MODE === 'local' && <p className="muted small">로컬 모드에서는 주소록이 없어요.</p>}
      {roles === null && <p className="muted small">불러오는 중…</p>}
      {error && <p className="warn small">주소록을 못 불러왔어요 — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)</p>}
      <div className="ab-groups">
        {GROUPS.map((g) => {
          const list = people.filter((p) => g.match(p) && hit(p)).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
          if (!list.length) return null;
          return (
            <section key={g.key} className="ab-group">
              <h3>
                {g.label} <span className="muted small">{list.length}명</span>
              </h3>
              <div className="sales-table-wrap">
                <table className="mini-table ab-table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>이메일</th>
                      <th>회사번호</th>
                      <th>개인번호</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.email}>
                        <td>
                          <b>{p.name}</b>
                        </td>
                        <td>{cp(p.email)}</td>
                        <td>{cp(p.office)}</td>
                        <td>{cp(p.mobile)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
        {roles !== null && !people.some(hit) && DATA_MODE !== 'local' && <p className="muted small">맞는 사람이 없어요.</p>}
      </div>
    </Modal>
  );
}
