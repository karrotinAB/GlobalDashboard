import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Cover } from './ui';

export type Role = 'admin' | 'member';

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

/** 로그인 → 이메일 인증 → 관리자가 준 권한 확인 → 대시보드 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [verified, setVerified] = useState(false);
  const [role, setRole] = useState<Role | 'none' | undefined>(undefined);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setVerified(!!u?.emailVerified);
        setRole(undefined);
      }),
    [],
  );

  // 내 권한 문서를 실시간으로 봄 → 관리자가 추가하면 바로 열림
  useEffect(() => {
    if (!user || !verified || !user.email) return;
    const email = user.email.toLowerCase();
    return onSnapshot(
      doc(db, 'access', email),
      (snap) => {
        const r = snap.data()?.role;
        setRole(r === 'admin' || r === 'member' ? r : 'none');
      },
      () => setRole('none'),
    );
  }, [user, verified]);

  if (user === undefined) return <Centered>불러오는 중…</Centered>;
  if (!user) return <LoginForm />;
  if (!verified) return <VerifyEmail user={user} onVerified={() => setVerified(true)} />;
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
        <div className="login-icon">🍂</div>
        <h1>2조 Dashboard</h1>
        {children}
      </div>
    </div>
  );
}

function LoginForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg('');
    if (mode === 'signup' && pw !== pw2) {
      setMsg('비밀번호 확인이 달라요.');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email.trim(), pw);
      else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
        await sendEmailVerification(cred.user);
      }
    } catch (err) {
      setMsg(errMsg(err, mode === 'login' ? '로그인 실패' : '가입 실패'));
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
      <div className="seg login-seg">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>
          로그인
        </button>
        <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>
          처음이에요 (계정 만들기)
        </button>
      </div>
      <form className="login-form" onSubmit={submit}>
        <input type="email" placeholder="이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input
          type="password"
          placeholder={mode === 'signup' ? '비밀번호 (6자 이상)' : '비밀번호'}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
        />
        {mode === 'signup' && (
          <input type="password" placeholder="비밀번호 확인" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required />
        )}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '잠시만요…' : mode === 'login' ? '로그인' : '계정 만들기'}
        </button>
        <div className="login-msg">{msg}</div>
        {mode === 'login' ? (
          <button type="button" className="link" onClick={reset}>
            비밀번호를 잊어버렸어요
          </button>
        ) : (
          <p className="muted small login-note">가입 후 메일 인증을 하고, 관리자가 권한을 주면 대시보드가 열려요.</p>
        )}
      </form>
    </Shell>
  );
}

function VerifyEmail({ user, onVerified }: { user: User; onVerified: () => void }) {
  const [msg, setMsg] = useState('');
  const check = async () => {
    await user.reload();
    if (auth.currentUser?.emailVerified) {
      await auth.currentUser.getIdToken(true); // 인증 완료가 보안 규칙에 반영되도록 토큰 새로 받기
      onVerified();
    } else setMsg('아직 인증 전이에요. 메일함(스팸함 포함)의 링크를 눌러 주세요.');
  };
  const resend = async () => {
    try {
      await sendEmailVerification(user);
      setMsg('인증 메일을 다시 보냈어요.');
    } catch (err) {
      setMsg(errMsg(err, '메일을 보내지 못했어요'));
    }
  };
  return (
    <Shell>
      <p>
        <b>{user.email}</b> 로 인증 메일을 보냈어요.
        <br />
        메일의 링크를 누른 뒤 아래 버튼을 눌러 주세요.
      </p>
      <button className="primary" onClick={check}>
        인증했어요
      </button>
      <div className="login-msg">{msg}</div>
      <div className="login-links">
        <button className="link" onClick={resend}>
          메일 다시 보내기
        </button>
        <button className="link" onClick={logout}>
          다른 계정으로
        </button>
      </div>
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
