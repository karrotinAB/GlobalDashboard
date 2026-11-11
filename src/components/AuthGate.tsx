import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { Cover } from './ui';
import { DEFAULT_TEAM, isPersonal, savedViewLabel, savedViewTeam, spaceLabel, TEAMS } from '../lib/team';

export type Role = 'admin' | 'member' | 'trade' | 'lead' | 'director'; // trade = 무역사무, lead = 팀장님, director = 이사님
export const ROLE_NAME: Record<Role, string> = { admin: '관리자', member: '조원', trade: '무역사무', lead: '팀장님', director: '이사님' };
/** 팀장님·이사님: 자기만의 대시보드 + 모든 조 현황 보기 */
export const isLeader = (r: Role | null) => r === 'lead' || r === 'director';

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

interface Access {
  email: string;
  role: Role | null;
  team: string; // 내 조 (roles.team, 없으면 2조)
  viewTeam: string; // 지금 보고 있는 조 (관리자는 골라 볼 수 있음, 팀장님·이사님은 자기 공간)
  viewLabel: string; // 화면 이름: '2조' / '팀장님' …
  canManage: boolean; // 이 공간을 관리 (업체 삭제·홈 구성 등): 관리자·팀장님·이사님·로컬
  accountName?: string; // 설정 > 대시보드 사용자에 적힌 이름 (roles.name)
  realRole?: Role | null; // 실제 권한 (관리자가 '일반 유저로 보기' 중이면 role 은 member, realRole 은 admin)
}

/** 관리자의 '일반 유저로 보기' (화면만 조원처럼, 실제 권한은 그대로) */
const AS_MEMBER_KEY = 'gd:asMember';
export function viewingAsMember(): boolean {
  try {
    return localStorage.getItem(AS_MEMBER_KEY) === '1';
  } catch {
    return false;
  }
}
export function setViewAsMember(on: boolean) {
  try {
    if (on) localStorage.setItem(AS_MEMBER_KEY, '1');
    else localStorage.removeItem(AS_MEMBER_KEY);
  } catch {
    /* 무시 */
  }
  window.location.hash = '/home';
  window.location.reload();
}
const localTeam = savedViewTeam() ?? DEFAULT_TEAM;
const AccessContext = createContext<Access>({ email: '', role: null, team: localTeam, viewTeam: localTeam, viewLabel: spaceLabel(localTeam), canManage: true });
/** 지금 로그인한 사람의 이메일·권한·조 (로컬 모드면 role = null) */
export const useAccess = () => useContext(AccessContext);

export function logout() {
  return signOut(auth);
}

/** 로그인 → 관리자가 준 권한 확인 → 대시보드 */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [role, setRole] = useState<Role | 'none' | undefined>(undefined);
  const [team, setTeam] = useState<string>(DEFAULT_TEAM);
  const [space, setSpace] = useState<{ id?: string; name?: string }>({});

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
        const t = String(snap.data()?.team ?? DEFAULT_TEAM);
        setTeam((TEAMS as readonly string[]).includes(t) ? t : DEFAULT_TEAM);
        const sp = snap.data()?.space;
        setSpace({ id: isPersonal(sp) ? sp : undefined, name: snap.data()?.name });
        setRole(r === 'admin' || r === 'member' || r === 'trade' || r === 'lead' || r === 'director' ? r : 'none');
      },
      () => setRole('none'),
    );
  }, [user]);

  if (user === undefined) return <Centered>불러오는 중…</Centered>;
  if (!user) return <LoginForm />;
  if (role === undefined) return <Centered>권한 확인 중…</Centered>;
  if (role === 'none') return <NoAccess email={user.email ?? ''} />;
  const leader = isLeader(role);
  if (leader && !space.id) return <NoAccess email={user.email ?? ''} />; // 개인 공간이 아직 없음 (관리자가 권한을 다시 저장하면 생김)
  // 관리자 '일반 유저로 보기': 자기 조의 조원처럼 (다른 조·무역사무·관리자 메뉴 안 보임)
  if (role === 'admin' && viewingAsMember()) {
    return (
      <AccessContext.Provider
        value={{ email: (user.email ?? '').toLowerCase(), role: 'member', team, viewTeam: team, viewLabel: spaceLabel(team), canManage: false, accountName: space.name, realRole: 'admin' }}
      >
        {children}
      </AccessContext.Provider>
    );
  }
  const viewTeam = leader ? space.id! : role === 'admin' ? savedViewTeam() ?? team : team;
  const viewLabel = leader
    ? space.name
      ? `${space.name} (${ROLE_NAME[role]})` // 이름 먼저: '이락연 (팀장님)'
      : ROLE_NAME[role]
    : isPersonal(viewTeam)
      ? savedViewLabel() ?? '개인 대시보드'
      : spaceLabel(viewTeam);
  const canManage = role === 'admin' || leader;
  return (
    <AccessContext.Provider value={{ email: (user.email ?? '').toLowerCase(), role, team, viewTeam, viewLabel, canManage, accountName: space.name, realRole: role }}>
      {children}
    </AccessContext.Provider>
  );
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
        <h1>Global Dashboard</h1>
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
