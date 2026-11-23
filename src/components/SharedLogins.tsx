// 주소록 › ID/PW 탭: 우리가 같이 쓰는 계정 (용도 · ID · PW · 비고) — 대시보드 사용자 누구나 보고 · 넣고 · 고치고 · 지움
//   sharedLogins/{id} = { use, login, pw, note, by, at }  (Firestore: 로그인한 대시보드 사용자만 읽고 씀 · 코드 저장소엔 안 들어감)
import { useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE } from '../data/store';
import { useAccess } from './AuthGate';
import { uid } from '../lib/date';
import { useNameOf } from './AddressBook';

export interface SharedLogin {
  id: string;
  use: string; // 용도 (예: 관세청 유니패스)
  url?: string; // 로그인 페이지 주소 (용도를 누르면 열림)
  login: string; // ID
  pw: string;
  note?: string;
  by?: string;
  at?: string;
  broken?: { by: string; at: string }; // '로그인 안 돼요' 알림 — 고쳐서 저장하면 사라짐
}

const LS = 'gd:sharedLogins';
const readLocal = (): SharedLogin[] => {
  try {
    return JSON.parse(localStorage.getItem(LS) ?? '[]') as SharedLogin[];
  } catch {
    return [];
  }
};
const writeLocal = (l: SharedLogin[]) => {
  try {
    localStorage.setItem(LS, JSON.stringify(l));
  } catch {
    /* 무시 */
  }
  window.dispatchEvent(new Event('gd-shared-logins'));
};

function useSharedLogins() {
  const [list, setList] = useState<SharedLogin[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (DATA_MODE === 'local') {
      const load = () => setList(readLocal());
      load();
      window.addEventListener('gd-shared-logins', load);
      return () => window.removeEventListener('gd-shared-logins', load);
    }
    return onSnapshot(
      collection(db, 'sharedLogins'),
      (snap) => setList(snap.docs.map((d) => ({ ...(d.data() as Omit<SharedLogin, 'id'>), id: d.id }))),
      () => {
        setError(true);
        setList([]);
      },
    );
  }, []);
  return { list, error };
}
async function saveLogin(x: SharedLogin) {
  const v = JSON.parse(JSON.stringify(x)) as SharedLogin;
  if (DATA_MODE === 'local') return writeLocal([...readLocal().filter((y) => y.id !== x.id), v]);
  const { id, ...rest } = v;
  await setDoc(doc(db, 'sharedLogins', id), rest);
}
async function removeLogin(id: string) {
  if (DATA_MODE === 'local') return writeLocal(readLocal().filter((y) => y.id !== id));
  await deleteDoc(doc(db, 'sharedLogins', id));
}

type Draft = { use: string; url: string; login: string; pw: string; note: string };
const blank: Draft = { use: '', url: '', login: '', pw: '', note: '' };
/** 링크: http(s) 만 · 'www.xx.com' 처럼 쓰면 https:// 붙임 */
const cleanUrl = (u: string) => {
  const t = u.trim();
  if (!t) return '';
  const v = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  return /^https?:\/\//i.test(v) ? v : '';
};

export default function SharedLogins({ q, copy, copied }: { q: string; copy: (t: string) => void; copied: string }) {
  const { list, error } = useSharedLogins();
  const { email, accountName } = useAccess();
  const [show, setShow] = useState<Set<string>>(new Set()); // PW 보이는 줄
  const [editing, setEditing] = useState<string | null>(null); // 고치는 줄 id ('new' = 새 줄)
  const [d, setD] = useState<Draft>(blank);
  const norm = (x: string) => x.toLowerCase().replace(/\s/g, '');
  const nq = norm(q);
  // 용도별로 묶어서 (용도 가나다 → 그 안에서 ID)
  const groups = useMemo(() => {
    const rows = (list ?? []).filter((x) => !nq || norm(`${x.use} ${x.login} ${x.note ?? ''}`).includes(nq));
    const m = new Map<string, SharedLogin[]>();
    for (const x of rows.sort((a, b) => a.use.localeCompare(b.use, 'ko') || a.login.localeCompare(b.login))) m.set(x.use, [...(m.get(x.use) ?? []), x]);
    return [...m.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, nq]);
  const uses = useMemo(() => [...new Set((list ?? []).map((x) => x.use))].sort((a, b) => a.localeCompare(b, 'ko')), [list]);
  const start = (x?: SharedLogin) => {
    setEditing(x?.id ?? 'new');
    // 같은 용도에 이미 링크가 있으면 새 줄에도 미리 채움
    setD(x ? { use: x.use, url: x.url ?? (list ?? []).find((y) => y.use === x.use && y.url)?.url ?? '', login: x.login, pw: x.pw, note: x.note ?? '' } : blank);
  };
  const ok = d.use.trim() && (d.login.trim() || d.pw.trim());
  const submit = async () => {
    if (!ok) return;
    const base = editing && editing !== 'new' ? (list ?? []).find((x) => x.id === editing) : undefined;
    await saveLogin({ id: base?.id ?? uid(), use: d.use.trim(), url: cleanUrl(d.url) || undefined, login: d.login.trim(), pw: d.pw, note: d.note.trim() || undefined, by: accountName ?? email, at: new Date().toISOString() });
    setEditing(null);
    setD(blank);
  };
  // ⚠ 로그인 안 돼요 → 모두에게 '업데이트 필요' (고쳐서 저장하거나 '해결됨' 을 누르면 사라짐)
  const report = (x: SharedLogin) => {
    if (!confirm(`'${x.use}' ${x.login} 로그인이 안 되나요?\n모두에게 '업데이트 필요' 표시가 떠요. ID/PW 를 아는 사람이 고쳐서 저장하면 사라져요.`)) return;
    void saveLogin({ ...x, broken: { by: accountName ?? email, at: new Date().toISOString() } });
  };
  const resolve = (x: SharedLogin) => {
    const { broken: _b, ...rest } = x;
    void _b;
    void saveLogin(rest);
  };
  const nameOf = useNameOf();
  const when = (iso: string) => {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submit();
    if (e.key === 'Escape') setEditing(null);
  };
  const toggle = (id: string) =>
    setShow((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const form = (
    <tr className="sl-form">
      <td>
        <input
          list="sl-uses"
          autoFocus
          placeholder="용도 (예: 유니패스)"
          value={d.use}
          onChange={(e) => {
            const use = e.target.value;
            // 이미 있는 용도를 고르면 그 링크를 가져옴 (비어 있을 때만)
            const known = (list ?? []).find((x) => x.use === use && x.url)?.url;
            setD({ ...d, use, url: d.url || known || '' });
          }}
          onKeyDown={keys}
        />
        <input className="sl-url-in" placeholder="🔗 로그인 페이지 링크 (선택)" value={d.url} onChange={(e) => setD({ ...d, url: e.target.value })} onKeyDown={keys} />
        <datalist id="sl-uses">
          {uses.map((u) => (
            <option key={u} value={u} />
          ))}
        </datalist>
      </td>
      <td>
        <input placeholder="ID" value={d.login} onChange={(e) => setD({ ...d, login: e.target.value })} onKeyDown={keys} autoComplete="off" />
      </td>
      <td>
        <input placeholder="PW" value={d.pw} onChange={(e) => setD({ ...d, pw: e.target.value })} onKeyDown={keys} autoComplete="off" />
      </td>
      <td>
        <input placeholder="비고" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} onKeyDown={keys} />
      </td>
      <td className="sl-act">
        <span className="sl-btns">
          <button className="primary small" disabled={!ok} onClick={() => void submit()}>
            {editing === 'new' ? '추가' : '저장'}
          </button>
          <button className="small" onClick={() => setEditing(null)}>
            취소
          </button>
        </span>
      </td>
    </tr>
  );
  const copyCell = (v: string, label: string, masked = false) =>
    v ? (
      <span className={`ab-cell-in ${copied === v ? 'done' : ''}`} onClick={() => copy(v)} title={`누르면 ${label} 복사`}>
        {masked ? '●●●●●●' : v}
        {copied === v && <span className="ab-toast">복사됨 ✓</span>}
      </span>
    ) : (
      <span className="ab-empty">—</span>
    );
  return (
    <>
      {error && <p className="warn small">ID/PW 를 못 불러왔어요 — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)</p>}
      {list === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <div className="ab-wrap">
          <table className="ab-table sl-table">
            <thead>
              <tr>
                <th className="ab-g">용도</th>
                <th>ID</th>
                <th>PW</th>
                <th>비고</th>
                <th className="sl-act-h" />
              </tr>
            </thead>
            <tbody>
              {groups.flatMap(([use, rows]) => {
                // 이 용도 안에서 고치는 줄이 있으면 묶지 않고 줄마다 용도 (칸이 안 어긋나게)
                const grouped = !rows.some((x) => x.id === editing);
                return rows.map((x, i) =>
                  editing === x.id ? (
                    <FormRow key={x.id}>{form}</FormRow>
                  ) : (
                    <tr key={x.id}>
                      {(!grouped || i === 0) && (
                        <th className="ab-g" rowSpan={grouped ? rows.length : 1}>
                          {(() => {
                            const link = (grouped ? rows.find((y) => y.url)?.url : x.url) ?? '';
                            return link ? (
                              <a className="sl-use-link" href={link} target="_blank" rel="noopener noreferrer" title={`로그인 페이지 열기 — ${link}`}>
                                {use} <span className="sl-ext">↗</span>
                              </a>
                            ) : (
                              use
                            );
                          })()}
                        </th>
                      )}
                      <td className={`ab-cell sl-id ${x.broken ? 'sl-broken' : ''}`}>
                        {copyCell(x.login, 'ID')}
                        {x.broken && (
                          <span className="sl-warn" title={`${nameOf(x.broken.by.includes('@') ? x.broken.by : undefined, x.broken.by)}님이 ${when(x.broken.at)}에 '로그인 안 돼요' 라고 알렸어요 — ID/PW 를 고쳐서 저장하면 사라져요`}>
                            ⚠ 업데이트 필요
                            <small>
                              {nameOf(x.broken.by.includes('@') ? x.broken.by : undefined, x.broken.by)} · {when(x.broken.at)}
                            </small>
                          </span>
                        )}
                      </td>
                      <td className="ab-cell sl-pw">
                        {copyCell(x.pw, 'PW', !show.has(x.id))}
                        {x.pw && (
                          <button className="sl-eye" onClick={() => toggle(x.id)} title={show.has(x.id) ? 'PW 가리기' : 'PW 보기'}>
                            {show.has(x.id) ? '🙈' : '👁'}
                          </button>
                        )}
                      </td>
                      <td className="sl-note">{x.note || <span className="ab-empty">—</span>}</td>
                      <td className="sl-act">
                        {x.broken ? (
                          <button className="small sl-resolve" title="다시 로그인 돼요 (경고 지우기)" onClick={() => resolve(x)}>
                            해결됨
                          </button>
                        ) : (
                          <button className="icon-btn sl-report" title="로그인이 안 돼요 → 모두에게 '업데이트 필요' 표시" onClick={() => report(x)}>
                            ⚠
                          </button>
                        )}
                        <button className="icon-btn" title="고치기 (저장하면 경고도 사라져요)" onClick={() => start(x)}>
                          ✎
                        </button>
                        <button className="icon-btn" title="지우기" onClick={() => confirm(`'${x.use}' ${x.login} 을(를) 지울까요?`) && void removeLogin(x.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  ),
                );
              })}
              {!groups.length && editing !== 'new' && (
                <tr>
                  <td colSpan={5} className="muted small">
                    {(list ?? []).length ? '맞는 계정이 없어요.' : '아직 등록된 계정이 없어요. 아래 ＋ 계정 추가로 넣어 주세요.'}
                  </td>
                </tr>
              )}
              {editing === 'new' ? (
                form
              ) : (
                <tr>
                  <td colSpan={5} className="sl-add">
                    <button className="link" onClick={() => start()}>
                      ＋ 계정 추가
                    </button>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
function FormRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
