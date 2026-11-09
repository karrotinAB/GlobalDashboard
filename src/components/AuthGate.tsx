import { useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { Cover } from './ui';

const ERRORS: Record<string, string> = {
  'auth/invalid-credential': '이메일이나 비밀번호가 맞지 않아요.',
  'auth/invalid-email': '이메일 형식을 확인해 주세요.',
  'auth/too-many-requests': '시도가 너무 많아요. 잠시 후 다시 해 주세요.',
  'auth/network-request-failed': '인터넷 연결을 확인해 주세요.',
  'auth/user-disabled': '사용이 중지된 계정이에요.',
};

export function logout() {
  return signOut(auth);
}

export function currentEmail() {
  return auth.currentUser?.email ?? '';
}

/** 로그인해야 대시보드가 보임 (계정은 Firebase 콘솔에서 관리자가 만듦) */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  if (user === undefined) return <div className="page muted" style={{ textAlign: 'center' }}>불러오는 중…</div>;
  if (user) return <>{children}</>;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg('');
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setMsg(ERRORS[code] ?? `로그인 실패 (${code || '알 수 없는 오류'})`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!email.trim()) {
      setMsg('이메일을 먼저 적어 주세요.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMsg('비밀번호 재설정 메일을 보냈어요. 메일함을 확인해 주세요.');
    } catch (err) {
      const code = (err as { code?: string }).code ?? '';
      setMsg(ERRORS[code] ?? `메일을 보내지 못했어요 (${code})`);
    }
  };

  return (
    <div className="login">
      <Cover tall />
      <form className="login-card" onSubmit={submit}>
        <div className="login-icon">🍂</div>
        <h1>2조 Dashboard</h1>
        <p className="muted small">우리 조 계정으로 로그인해 주세요</p>
        <input type="email" placeholder="이메일" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input type="password" placeholder="비밀번호" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
        <button className="primary" type="submit" disabled={busy}>
          {busy ? '로그인 중…' : '로그인'}
        </button>
        <div className="login-msg">{msg}</div>
        <button type="button" className="link" onClick={reset}>
          비밀번호를 잊어버렸어요
        </button>
      </form>
    </div>
  );
}
