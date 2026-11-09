import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAccess, type Role } from './AuthGate';

interface Row {
  email: string;
  role: Role;
  name?: string;
}

const ROLE_LABEL: Record<Role, string> = { admin: '관리자', member: '조원' };

/** 설정 > 접근 권한 (관리자만 보임). 여기 있는 이메일만 대시보드를 볼 수 있음 */
export default function AccessAdmin() {
  const me = useAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [msg, setMsg] = useState('');

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'access'),
        (snap) =>
          setRows(
            snap.docs
              .map((d) => ({ email: d.id, ...(d.data() as Omit<Row, 'email'>) }))
              .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'admin' ? -1 : 1)),
          ),
        (err) => setMsg(`목록을 못 불러왔어요: ${err.message}`),
      ),
    [],
  );

  const put = async (e: string, r: Role, n?: string) => {
    try {
      await setDoc(doc(db, 'access', e), { role: r, ...(n ? { name: n } : {}), addedBy: me.email, addedAt: serverTimestamp() });
      setMsg('');
      return true;
    } catch (err) {
      setMsg(`저장 실패: ${(err as Error).message}`);
      return false;
    }
  };

  const add = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return setMsg('이메일 형식을 확인해 주세요.');
    if (e === me.email) return setMsg('내 권한은 여기서 바꿀 수 없어요.');
    if (await put(e, role, name.trim() || undefined)) {
      setEmail('');
      setName('');
      setMsg(`${e} 추가했어요. 그 사람이 가입·메일 인증을 하면 바로 들어올 수 있어요.`);
    }
  };

  return (
    <section className="card">
      <h2>접근 권한 (관리자)</h2>
      <p className="muted small">
        여기 있는 이메일만 대시보드를 볼 수 있어요. 새 사람은 로그인 화면에서 "계정 만들기"로 가입하고 메일 인증을 하면 돼요. (순서는 상관없어요)
      </p>
      <table className="settings-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>이름</th>
            <th>권한</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const self = r.email === me.email;
            return (
              <tr key={r.email}>
                <td>
                  {r.email}
                  {self && <span className="muted small"> (나)</span>}
                </td>
                <td>{r.name}</td>
                <td>
                  {self ? (
                    ROLE_LABEL[r.role]
                  ) : (
                    <select value={r.role} onChange={(e) => put(r.email, e.target.value as Role, r.name)}>
                      <option value="member">조원</option>
                      <option value="admin">관리자</option>
                    </select>
                  )}
                </td>
                <td>
                  {!self && (
                    <button
                      className="danger small"
                      onClick={async () => {
                        if (!confirm(`${r.email} 의 접근 권한을 뺄까요?`)) return;
                        try {
                          await deleteDoc(doc(db, 'access', r.email));
                        } catch (err) {
                          setMsg(`삭제 실패: ${(err as Error).message}`);
                        }
                      }}
                    >
                      권한 빼기
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <form className="btn-row" onSubmit={add}>
        <input type="email" placeholder="추가할 이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
        <input placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">조원</option>
          <option value="admin">관리자</option>
        </select>
        <button className="primary" type="submit">
          추가
        </button>
      </form>
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
  );
}
