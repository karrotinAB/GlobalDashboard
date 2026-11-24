import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { usePeople } from './AddressBook';
import { saveBirthdays, useBirthdays, type Birthday } from '../lib/birthdays';
import { uid } from '../lib/date';
import { deleteApp, initializeApp } from 'firebase/app';
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth';
import { db, firebaseConfig, functions } from '../firebase';
import { httpsCallable } from 'firebase/functions';
import { isLeader, ROLE_NAME, useAccess, type Role } from './AuthGate';
import { DEFAULT_TEAM, newPersonalSpace, teamLabel, TEAMS } from '../lib/team';

interface Row {
  email: string;
  role: Role;
  name?: string;
  team?: string; // 조원·관리자의 조 (없으면 2조)
  space?: string; // 팀장님·이사님의 개인 대시보드 공간
}

const ROLE_LABEL = ROLE_NAME;
const ROLE_ORDER: Record<Role, number> = { admin: 0, director: 1, lead: 2, member: 3, trade: 4, auditor: 5 };
const ROLE_OPTIONS: Role[] = ['member', 'trade', 'lead', 'director', 'admin', 'auditor'];

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
  const bdays = useBirthdays();
  const me = useAccess();
  const [rows, setRows] = useState<Row[]>([]);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [team, setTeam] = useState<string>(me.viewTeam);
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const { contacts } = usePeople(); // 주소록 번호 (contacts/{이메일})

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'roles'),
        (snap) =>
          setRows(
            snap.docs
              .map((d) => ({ email: d.id, role: d.data().level as Role, name: d.data().name as string | undefined, team: d.data().team as string | undefined, space: d.data().space as string | undefined }))
              .filter((r) => r.role in ROLE_ORDER)
              .sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : ROLE_ORDER[a.role] - ROLE_ORDER[b.role])),
          ),
        (err) => setMsg(`목록을 못 불러왔어요: ${err.message}`),
      ),
    [],
  );

  const put = async (e: string, r: Role, n?: string, t?: string) => {
    try {
      // 팀장님·이사님: 처음이면 개인 대시보드 공간을 만들어 줌 (권한을 바꿔도 공간은 그대로)
      const space = isLeader(r) ? rows.find((x) => x.email === e)?.space ?? newPersonalSpace() : rows.find((x) => x.email === e)?.space;
      await setDoc(doc(db, 'roles', e), {
        level: r,
        ...(n ? { name: n } : {}),
        ...(r === 'member' || r === 'admin' ? { team: t ?? DEFAULT_TEAM } : {}),
        ...(space ? { space } : {}),
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
      if (await put(e, me.auditor ? 'auditor' : role, name.trim() || undefined, team)) {
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
      {me.auditor && <p className="warn small">🔒 IT 검토용 계정은 사용자 · 권한을 볼 수만 있어요 · 맨 아래에서 IT 검토용 계정만 새로 추가할 수 있어요</p>}
      <fieldset className="plain-fieldset" disabled={!!me.auditor}>
      <p className="muted small">
        여기 추가한 사람만 대시보드에 로그인해서 쓸 수 있어요. 이메일과 임시 비밀번호를 넣으면 로그인 계정까지 만들어져요.
        <br />
        <b>조원</b> = 자기 조(1조·2조·3조) 대시보드 사용 · <b>무역사무</b> = 무역사무 페이지만 · <b>팀장님·이사님</b> = 각자 자기만 쓰는 대시보드 + 1~3조 현황 보기 · <b>관리자</b> = 조원 + 모든 조·무역사무 페이지 보기, 사용자 추가/삭제, 업체 삭제, 카드 주인 이메일 연결. 새로 추가하는 사람은 기본이 조원이에요.
        (목록에서 빼도 로그인 계정은 남지만 아무것도 볼 수 없어요)
      </p>
      <table className="settings-table">
        <thead>
          <tr>
            <th>이메일</th>
            <th>이름</th>
            <th>권한</th>
            <th>조</th>
            <th>회사번호</th>
            <th>개인번호</th>
            <th>생일</th>
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
                <td>
                  <NameInput
                    value={contacts[r.email]?.name || r.name}
                    onSave={(n) => {
                      // 주소록 이름 (본인 것도 저장됨) + 다른 사람은 사용자 목록 이름도 같이
                      setDoc(doc(db, 'contacts', r.email), { name: n }, { merge: true }).catch((e) => setMsg(`이름 저장 실패: ${(e as Error).message} (서버 규칙을 새로 올렸는지 확인 — deploy.bat)`));
                      if (!self) void put(r.email, r.role, n || undefined, r.team);
                    }}
                  />
                </td>
                <td>
                  {self ? (
                    ROLE_LABEL[r.role]
                  ) : (
                    <select value={r.role} onChange={(e) => put(r.email, e.target.value as Role, r.name, r.team)}>
                      {ROLE_OPTIONS.map((o) => (
                        <option key={o} value={o}>
                          {ROLE_LABEL[o]}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
                <td>
                  {r.role === 'trade' || r.role === 'auditor' || isLeader(r.role) ? (
                    <span className="muted small">{isLeader(r.role) ? '개인 대시보드' : r.role === 'auditor' ? 'IT팀 대시보드' : '-'}</span>
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
                  <PhoneInput email={r.email} field="office" value={contacts[r.email]?.office} onError={setMsg} />
                </td>
                <td>
                  <PhoneInput email={r.email} field="mobile" value={contacts[r.email]?.mobile} onError={setMsg} />
                </td>
                <td>
                  <BirthdayInput email={r.email} name={r.name} list={bdays} onError={setMsg} />
                </td>
                <td>
                  {!self && (
                    <button
                      className="danger small"
                      onClick={async () => {
                        if (!confirm(r.role === 'auditor' ? `${r.name || r.email} (IT 검토용) 을 뺄까요?\n\n· 로그인 계정이 지워져요\n· 이 계정이 넣은 가짜 데이터도 모두 같이 지워져요` : `${r.name || r.email} 을(를) 대시보드 사용자에서 뺄까요?\n\n· 로그인 계정이 지워져서 더 이상 로그인할 수 없어요\n· 남긴 기록(보고 · 댓글 · 업무 등)과 이름은 그대로 남아요`)) return;
                        try {
                          const res = await httpsCallable(functions, 'removeUser')({ email: r.email });
                          const d = res.data as { name: string; account: 'deleted' | 'none'; dummies?: number };
                          setMsg(`${d.name} 님을 뺐어요 ✓ ${d.account === 'deleted' ? '로그인 계정도 지웠어요' : '(로그인 계정은 원래 없었어요)'}${d.dummies ? ` · 가짜 데이터 ${d.dummies}개도 지웠어요` : ''}`);
                        } catch (err) {
                          setMsg(`빼지 못했어요: ${(err as Error).message} — 서버 함수를 새로 올렸는지 확인해 주세요 (deploy.bat)`);
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
      </fieldset>
      {/* 계정 추가: IT 검토용 계정은 IT 검토용 계정만 만들 수 있음 (서버 규칙도 같음) */}
      <form className="btn-row" onSubmit={add}>
        <input type="email" placeholder="추가할 이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
        <input placeholder="이름 (선택)" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 100 }} />
        <input placeholder="임시 비밀번호 (6자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} style={{ flex: 1, minWidth: 140 }} autoComplete="off" />
        <select value={me.auditor ? 'auditor' : role} onChange={(e) => setRole(e.target.value as Role)} disabled={!!me.auditor}>
          {(me.auditor ? (['auditor'] as Role[]) : ROLE_OPTIONS).map((o) => (
            <option key={o} value={o}>
              {ROLE_LABEL[o]}
            </option>
          ))}
        </select>
        {!me.auditor && (role === 'member' || role === 'admin') && (
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

/** 주소록 번호 칸: 칸에서 나가면 저장 (contacts/{이메일}) */
function PhoneInput({ email, field, value, onError }: { email: string; field: 'office' | 'mobile'; value?: string; onError: (m: string) => void }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <input
      className="phone-input"
      value={v}
      inputMode="tel"
      placeholder={field === 'office' ? '02-…' : '010-…'}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const t = v.trim();
        if (t === (value ?? '')) return;
        setDoc(doc(db, 'contacts', email), { [field]: t }, { merge: true }).catch((e) => onError(`번호 저장 실패: ${(e as Error).message} (서버 규칙을 새로 올렸는지 확인 — deploy.bat)`));
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 이름 칸: 칸에서 나가면 저장 */
function NameInput({ value, onSave }: { value?: string; onSave: (n: string) => void }) {
  const [v, setV] = useState(value ?? '');
  useEffect(() => setV(value ?? ''), [value]);
  return (
    <input
      className="name-input"
      value={v}
      placeholder="이름"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v.trim() !== (value ?? '') && onSave(v.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

/** 생일 칸 (월·일): 고르면 바로 저장 (homeCfg/birthdays · 이메일로 찾아 바꿈) · 비우면 지움 */
function BirthdayInput({ email, name, list, onError }: { email: string; name?: string; list: Birthday[] | null; onError: (m: string) => void }) {
  const cur = list?.find((b) => b.email?.toLowerCase() === email.toLowerCase());
  const save = (md: string) => {
    if (!list) return;
    const rest = list.filter((b) => b.email?.toLowerCase() !== email.toLowerCase());
    const next = md ? [...rest, { id: cur?.id ?? uid(), name: name || email.split('@')[0], email: email.toLowerCase(), md }] : rest;
    saveBirthdays(next).catch((e) => onError(`생일 저장 실패: ${(e as Error).message} (서버 규칙을 새로 올렸는지 확인 — deploy.bat)`));
  };
  // 월 · 일만 고르기 (연도 없음). 둘 다 고르면 저장, 월을 비우면 지움
  const [mm, setMm] = useState(cur?.md.slice(0, 2) ?? '');
  const [dd, setDd] = useState(cur?.md.slice(3, 5) ?? '');
  useEffect(() => {
    setMm(cur?.md.slice(0, 2) ?? '');
    setDd(cur?.md.slice(3, 5) ?? '');
  }, [cur?.md]);
  const pick = (m: string, d: string) => {
    setMm(m);
    setDd(d);
    if (!m) return save('');
    if (m && d) save(`${m}-${d}`);
  };
  const days = mm ? new Date(2000, Number(mm), 0).getDate() : 31; // 2월은 29일까지
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    <span className="bday-input" title="생일 (당일 본인 인사말이 생일 인사로, TODAY 카드에 '오늘 ○○ 생일이에요')">
      <select value={mm} onChange={(e) => pick(e.target.value, dd && Number(dd) <= new Date(2000, Number(e.target.value), 0).getDate() ? dd : '')}>
        <option value="">월</option>
        {Array.from({ length: 12 }, (_, i) => (
          <option key={i} value={two(i + 1)}>
            {i + 1}월
          </option>
        ))}
      </select>
      <select value={dd} disabled={!mm} onChange={(e) => pick(mm, e.target.value)}>
        <option value="">일</option>
        {Array.from({ length: days }, (_, i) => (
          <option key={i} value={two(i + 1)}>
            {i + 1}일
          </option>
        ))}
      </select>
    </span>
  );
}
