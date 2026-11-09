import { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from '../firebase';

/** 설정 > 내 비밀번호 바꾸기 (관리자가 준 임시 비밀번호를 바꿀 때) */
export default function ChangePassword() {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [next2, setNext2] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const user = auth.currentUser;
    if (!user?.email) return;
    if (next.length < 6) return setMsg('새 비밀번호는 6자 이상으로 해 주세요.');
    if (next !== next2) return setMsg('새 비밀번호 확인이 달라요.');
    setBusy(true);
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, cur));
      await updatePassword(user, next);
      setCur('');
      setNext('');
      setNext2('');
      setMsg('비밀번호를 바꿨어요 ✓');
    } catch (err) {
      const code = (err as { code?: string }).code;
      setMsg(code === 'auth/invalid-credential' || code === 'auth/wrong-password' ? '지금 비밀번호가 맞지 않아요.' : `바꾸지 못했어요 (${code})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>내 비밀번호 바꾸기</h2>
      <form className="btn-row" onSubmit={submit}>
        <input type="password" placeholder="지금 비밀번호" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        <input type="password" placeholder="새 비밀번호 (6자 이상)" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required />
        <input type="password" placeholder="새 비밀번호 확인" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} required />
        <button className="primary" type="submit" disabled={busy}>
          바꾸기
        </button>
      </form>
      {msg && <p className="small" style={{ marginBottom: 0 }}>{msg}</p>}
    </section>
  );
}
