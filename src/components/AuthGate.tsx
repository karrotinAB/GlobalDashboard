import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Cover } from './ui';

export type Role = 'admin' | 'member' | 'trade'; // trade = 무역사무

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': '이메일이나 비밀번호가 맞지 않아요.',
  'auth/invalid-email': '이메일 형식을 확인해 주세요.',
  'auth/email-already-in-use': '이미 가입된 이메일이에요. 로그인해 주세요.',
  'auth/weak-password': '비밀번호는 6자 이상으로 해 주세요.',
  'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/user-disabled': '사용이 중지된 계정이에요.',
  'auth/operation-not-allowed': 'Firebase 콘솔에서 이메일/비밀번호 로그인이 꺼져 있어요.',
};
const errMsg = (err: unknown, fallback: string) => {
  const code = (err as { code?: string }).code ?? '';
  return ERRORS[code] ?? `${fallback} (${code || '알 수 없는 오류'})`;
};

const AccessContext = createContext<{ email: string; role: Role | null }>({ email: '', role: null });
/** 지금 로그인한 사람의 이메일과 권한 (로컬 모드면 role = null) */
export const useAccess = () => useContext(AccessContext);

export function logout() {
  return signOut(auth);
}

/** 로그인 → 관리자가 준 권한 확인 → 대시보드 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [role, setRole] = useState<Role | 'none' | undefined>(undefined);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setRole(undefined);
      }),
    [],
  );

  // 내 권한 문서를 실시간으로 봄 → 관리자가 추가하면 바로 열림
  useEffect(() => {
    if (!user || !user.email) return;
    const email = user.email.toLowerCase();
    return onSnapshot(
      doc(db, 'roles', email),
      (snap) => {
        const r = snap.data()?.level;
        setRole(r === 'admin' || r === 'member' || r === 'trade' ? r : 'none');
      },
      () => setRole('none'),
    );
  }, [user]);

  if (user === undefined) return <Centered>불러오는 중…</Centered>;
  if (!user) return <LoginForm />;
  if (role === undefined) return <Centered>권한 확인 중…</Centered>;
  if (role === 'none') return <NoAccess email={user.email ?? ''} />;
  return <AccessContext.Provider value={{ email: (user.email ?? '').toLowerCase(), role }}>{children}</AccessContext.Provider>;
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="page muted" style={{ textAlign: 'center' }}>
      {children}
    </div>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="login">
      <Cover tall />
      <div className="login-card">
        <div className="login-icon">
          <img className="jelly" src="./jelly.png" alt="" />
        </div>
        <h1>2조 Dashboard</h1>
        {children}
      </div>
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (err) {
      setMsg(errMsg(err, '로그인 실패'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) return setMsg('이메일을 먼저 적어 주세요.');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg('비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.');
    } catch (err) {
      setMsg(errMsg(err, '메일을 보내지 못했어요'));
    }
  };

  return (
    <Shell>
      <p className="muted small" style={{ margin: 0 }}>
        관리자가 만들어 준 계정으로 로그인해 주세요
      </p>
      <form className="login-form" onSubmit={submit}>
        <input type="email" placeholder="이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="비밀번호" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '잠시만요…' : '로그인'}
        </button>
        <div className="login-msg">{msg}</div>
        <button type="button" className="link" onClick={reset}>
          비밀번호를 잊어버렸어요
        </button>
      </form>
    </Shell>
  );
}

function NoAccess({ email }: { email: string }) {
  return (
    <Shell>
      <p>
        <b>{email}</b>
        <br />
        아직 대시보드 권한이 없어요. 관리자에게 이 이메일을 추가해 달라고 말해 주세요.
      </p>
      <p className="muted small">관리자가 추가하면 이 화면이 저절로 열려요.</p>
      <button className="link" onClick={logout}>
        로그아웃
      </button>
    </Shell>
  );
}
