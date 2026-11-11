import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import { db, firebaseConfig } from '../firebase';
import { useAccess, type Role } from './AuthGate';
import { DEFAULT_TEAM, teamLabel, TEAMS } from '../lib/team';

interface Row {
  email: string;
  role: Role;
  name?: string;
  team?: string; // 조원·관리자의 조 (없으면 2조)
}

const ROLE_LABEL: Record<Role, string> = { admin: '관리자', member: '조원', trade: '무역사무' };
const ROLE_ORDER: Record<Role, number> = { admin: 0, member: 1, trade: 2 };

/** 새 로그인 계정 만들기. 보조 앱으로 만들어서 관리자 본인의 로그인은 그대로 유지됨 */
async function createAccount(email: string, password: string): Promise<'created' | 'exists'> {
  const helper = initializeApp(firebaseConfig, `account-helper-${Date.now()}`);
  try {
    const helperAuth = getAuth(helper);
    await createUserWithEmailAndPassword(helperAuth, email, password);
    await signOut(helperAuth);
    return 'created';
  } catch (err) {
    if ((err as { code?: string }).code === 'auth/email-already-in-use') return 'exists';
    throw err;
  } finally {
    await deleteApp(helper);
  }
}

/** 설정 > 대시보드 사용자 (관리자만 보임). 여기 있는 이메일만 대시보드를 쓸 수 있음. 각자 조원/관리자 */
export default function AccessAdmin() {
  const me = useAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [team, setTeam] = useState<string>(me.viewTeam);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'roles'),
        (snap) =>
          setRows(
            snap.docs
              .map((d) => ({ email: d.id, role: d.data().level as Role, name: d.data().name as string | undefined, team: d.data().team as string | undefined }))
              .filter((r) => r.role in ROLE_ORDER)
              .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : ROLE_ORDER[a.role] - ROLE_ORDER[b.role])),
          ),
        (err) => setMsg(`목록을 못 불러왔어요: ${err.message}`),
      ),
    [],
  );

  const put = async (e: string, r: Role, n?: string, t?: string) => {
    try {
      await setDoc(doc(db, 'roles', e), {
        level: r,
        ...(n ? { name: n } : {}),
        ...(r !== 'trade' ? { team: t ?? DEFAULT_TEAM } : {}),
        addedBy: me.email,
        addedAt: serverTimestamp(),
      });
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
    if (pw.length < 6) return setMsg('임시 비밀번호는 6자 이상으로 해 주세요.');
    setBusy(true);
    try {
      const result = await createAccount(e, pw);
      if (await put(e, role, name.trim() || undefined, team)) {
        setMsg(
          result === 'created'
            ? `${e} 계정을 만들었어요. 임시 비밀번호를 알려 주고, 로그인 후 설정에서 비밀번호를 바꾸라고 해 주세요.`
            : `${e} 는 이미 있는 계정이라 권한만 줬어요. 원래 쓰던 비밀번호로 로그인하면 돼요.`,
        );
        setEmail('');
        setName('');
        setPw('');
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMsg(
        code === 'auth/operation-not-allowed' || code === 'auth/admin-restricted-operation'
          ? 'Firebase 콘솔 > Authentication > 설정 > 사용자 작업에서 "생성(가입) 사용 설정"을 켜 주세요.'
          : `계정을 만들지 못했어요 (${code ?? (err as Error).message})`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>
        대시보드 사용자 <span className="tag gray">관리자만 보이는 칸</span>
      </h2>
      <p className="muted small">
        여기 추가한 사람만 대시보드에 로그인해서 쓸 수 있어요. 이메일과 임시 비밀번호를 넣으면 로그인 계정까지 만들어져요.
        <br />
        <b>조원</b> = 자기 조(1조·2조·3조) 대시보드 사용 · <b>무역사무</b> = 무역사무 페이지만 · <b>관리자</b> = 조원 + 모든 조·무역사무 페이지 보기, 사용자 추가/삭제, 업체 삭제, 카드 주인 이메일 연결. 새로 추가하는 사람은 기본이 조원이에요.
        (목록에서 빼도 로그인 계정은 남지만 아무것도 볼 수 없어요)
      </p>
      <table className="settings-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>이름</th>
            <th>권한</th>
            <th>조</th>
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
                    <select value={r.role} onChange={(e) => put(r.email, e.target.value as Role, r.name, r.team)}>
                      <option value="member">조원</option>
                      <option value="trade">무역사무</option>
                      <option value="admin">관리자</option>
                    </select>
                  )}
                </td>
                <td>
                  {r.role === 'trade' ? (
                    <span className="muted small">-</span>
                  ) : self ? (
                    teamLabel(r.team)
                  ) : (
                    <select value={r.team ?? DEFAULT_TEAM} onChange={(e) => put(r.email, r.role, r.name, e.target.value)}>
                      {TEAMS.map((t) => (
                        <option key={t} value={t}>
                          {teamLabel(t)}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {!self && (
                    <button
                      className="danger small"
                      onClick={async () => {
                        if (!confirm(`${r.email}  을(를) 대시보드 사용자에서 뺄까요?`)) return;
                        try {
                          await deleteDoc(doc(db, 'roles', r.email));
                        } catch (err) {
                          setMsg(`삭제 실패: ${(err as Error).message}`);
                        }
                      }}
                    >
                      목록에서 빼기
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
        <input placeholder="임시 비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1, minWidth: 140 }} autoComplete="off" />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">조원</option>
          <option value="trade">무역사무</option>
          <option value="admin">관리자</option>
        </select>
        {role !== 'trade' && (
          <select value={team} onChange={(e) => setTeam(e.target.value)} title="어느 조 대시보드를 쓸지">
            {TEAMS.map((t) => (
              <option key={t} value={t}>
                {teamLabel(t)}
              </option>
            ))}
          </select>
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '만드는 중…' : '계정 만들고 추가'}
        </button>
      </form>
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
  );
}
