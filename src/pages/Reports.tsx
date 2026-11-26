// 보고방: 조원이 쓰고 (제목만 보이고 누르면 내용), 팀장님·이사님이 각자 확인 체크 + 답변
import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { useAccess } from '../components/AuthGate';
import { useStore } from '../data/store';
import { isPersonal, TEAMS } from '../lib/team';
import { uid } from '../lib/date';
import RichEditor from '../components/RichEditor';
import { usePeople } from '../components/AddressBook';
import PeoplePicker, { type PersonOpt } from '../components/PeoplePicker';
import { FileBox, ImageZoom, isImageFile } from '../components/RequestParts';
import { memoHtml } from '../lib/richtext';
import type { RequestFile } from '../types';
import { downloadFile, isUnseenLeader, needsCheck, uploadReportFile, CHECK_LABEL, deleteReport, isLeaderRole, isUnseen, markSeen, saveReport, seenBefore, useReports, type CheckRole, type Report, type ReportReply, REACTIONS } from '../lib/reports';

const when = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Reports({ space }: { space?: 'trade' } = {}) {
  const access = useAccess();
  const { data } = useStore();
  const leaderView = !space && isPersonal(access.viewTeam); // 팀장님·이사님 화면: 모든 조 + 무역사무
  const myTeam = space ?? access.viewTeam; // 이 보고방 ('1'·'2'·'3' 또는 'trade')
  const teamName = (t: string) => (t === 'trade' ? '무역사무' : `${t}조`);
  const myCheck: CheckRole | null = isLeaderRole(access.role) ? access.role : null;
  const list = useReports(leaderView ? null : myTeam);
  // 이름은 계정 이름으로 (주소록 이름 → 사용자 목록 이름 → 담당자 카드 → 저장된 이름 → 이메일 앞)
  const { roles, contacts } = usePeople();
  const nameOf = (email?: string, fallback?: string) => {
    const e = email?.toLowerCase();
    if (!e) return fallback ?? '';
    return (
      contacts[e]?.name ||
      roles?.find((r) => r.email === e)?.name ||
      [...data.members, ...data.tradeMembers].find((m) => m.email?.toLowerCase() === e)?.name ||
      fallback ||
      e.split('@')[0]
    );
  };
  const myName = nameOf(access.email, access.accountName) || '나';
  // 확인란 동그라미 색: 그 사람 담당자 카드 색 (없으면 기본)
  const colorOf = (email?: string) => [...data.members, ...data.tradeMembers].find((m) => !!email && m.email?.toLowerCase() === email.toLowerCase())?.color;
  const [teamF, setTeamF] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [writing, setWriting] = useState<string | null>(null); // 새로 쓰는 보고 id (파일을 그 아래에 올림)
  // 주소로 온 보고 (#/reports?r=id) 는 펼쳐서
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('r'));
  useEffect(() => {
    const h = () => {
      const r = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('r');
      if (r) setOpenId(r);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  // 검색: 제목 · 내용 · 답글 · 첨부 이름 · 작성자 · 작성 날짜 (11/16, 2026-11-16, 2026.11.16, 11월 16일 …)
  const [q, setQ] = useState('');
  const hay = (r: Report) => {
    const d = new Date(r.createdAt);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    const dd = d.getDate();
    const p2 = (n: number) => String(n).padStart(2, '0');
    const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
    return [
      r.title,
      text(r.body ?? ''),
      ...(r.replies ?? []).map((x) => `${x.text} ${nameOf(x.email, x.name)}`),
      ...(r.files ?? []).map((f) => f.name),
      nameOf(r.authorEmail, r.authorName),
      teamName(r.team),
      `${m}/${dd} ${p2(m)}/${p2(dd)} ${y}-${p2(m)}-${p2(dd)} ${y}.${p2(m)}.${p2(dd)} ${y}.${m}.${dd} ${String(y).slice(2)}.${p2(m)}.${p2(dd)} ${m}월 ${dd}일 ${m}월${dd}일 ${y}${p2(m)}${p2(dd)}`,
    ]
      .join(' ')
      .toLowerCase();
  };
  const shown = (list ?? []).filter((r) => {
    if (teamF && r.team !== teamF) return false;
    if (onlyOpen && myCheck && (!needsCheck(r, myCheck) || r.checks?.[myCheck])) return false;
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return true;
    const h = hay(r);
    return words.every((w) => h.includes(w)); // 여러 단어는 모두 들어간 것만
  });
  const canWrite = !leaderView && (space === 'trade' ? access.role === 'trade' || access.role === 'admin' || access.role === null : access.role !== 'trade');
  const toggleCheck = (r: Report, k: CheckRole) => {
 // 한 번 확인한 건 되돌릴 수 없음
    if (r.checks?.[k]) return;
    const checks = { ...(r.checks ?? {}) };
    checks[k] = { by: myName, email: access.email || undefined, at: new Date().toISOString() };
    void saveReport({ ...r, checks });
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>보고방</h1>
        <p className="muted">
          {leaderView
            ? '1·2·3조 · 무역사무에서 올라온 보고예요. 제목을 누르면 내용이 펼쳐져요 · 확인란에 체크하면 업무 관리(주간 할일)의 할일도 완료돼요.'
            : `${space === 'trade' ? '무역사무' : access.viewLabel} 보고는 ${space === 'trade' ? '무역사무 팀원' : '우리 조원'}과 팀장님·이사님만 봐요. 제목을 누르면 내용이 펼쳐져요.`}
        </p>
        {canWrite && (
          <button className="primary" onClick={() => setWriting(uid())}>
            ＋ 보고 쓰기
          </button>
        )}
      </div>
      <ul className="rp-guide">
          <li>
            <b>확인자 설정</b> 보고 쓸 때 확인할 분(팀장님 · 이사님)을 고를 수 있어요
          </li>
          <li>
            <b>☑ 확인</b> 팀장님 · 이사님은 확인란을 눌러 주세요
          </li>
          {/* 두 번째 줄: 확인 완료 · 반응 (늘 같은 줄) */}
          <li className="rp-guide-break" aria-hidden="true" />
          <li>
            → 확인자가 모두 누르면 <span className="rp-done-tag">✅ 확인 완료</span>
          </li>
          <li>
            <b>😊 반응</b> 내용·댓글을 봤으면 이모티콘으로 반응해 주세요
          </li>
        </ul>

      {writing && (
        <ReportForm
          id={writing}
          team={myTeam}
          onCancel={() => setWriting(null)}
          onSave={(title, body, files, to, share) => {
            const now = new Date().toISOString();
            void saveReport({ id: writing, team: myTeam, title, body, files, to, authorEmail: access.email || undefined, authorName: myName, createdAt: now, checks: {}, replies: [], ...(share.people.length ? { sharePeople: share.people, shareTeams: share.teams } : {}) });
            setWriting(null);
          }}
        />
      )}

      <div className="toolbar rp-tools">
        <input className="search rp-search" placeholder="🔍 제목 · 내용 · 작성자 · 날짜 (예: 11/16)" value={q} onChange={(e) => setQ(e.target.value)} />
        {leaderView && (
          <div className="seg">
            <button className={!teamF ? 'on' : ''} onClick={() => setTeamF('')}>
              전체 조
            </button>
            {[...TEAMS, 'trade'].map((t) => (
              <button key={t} className={teamF === t ? 'on' : ''} onClick={() => setTeamF(teamF === t ? '' : t)}>
                {teamName(t)}
              </button>
            ))}
          </div>
        )}
        {leaderView && myCheck && (
          <label className="check-line small">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 내가 확인 안 한 것만
          </label>
        )}
      </div>

      <section className="card rp-card">
        {list === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="muted small">{list.length ? (q.trim() ? `'${q.trim()}' 에 맞는 보고가 없어요.` : '조건에 맞는 보고가 없어요.') : '아직 올라온 보고가 없어요.'}</p>
        ) : (
          <table className={`rp-table ${leaderView && myCheck ? `rp-mine-${myCheck}` : ''}`}>
            <thead>
              <tr>
                {leaderView && <th className="rp-team">조</th>}
                <th className="rp-title">제목</th>
                <th className="rp-who">작성자</th>
                <th className="rp-date">올린 날</th>
                <th className="rp-chk rp-c-lead">
                  <span className="rp-th-long">팀장님 확인</span>
                  <span className="rp-th-short">팀장님</span>
                </th>
                <th className="rp-chk rp-c-director">
                  <span className="rp-th-long">이사님 확인</span>
                  <span className="rp-th-short">이사님</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const open = openId === r.id;
                const unseen = leaderView ? !!myCheck && isUnseenLeader(r, myCheck, access.email) : isUnseen(r, access.email);
                const fresh = leaderView && myCheck && needsCheck(r, myCheck) && !r.checks?.[myCheck];
                // 확인자로 고른 사람이 모두 확인하면 '확인 완료'
                const need = (['lead', 'director'] as CheckRole[]).filter((k) => needsCheck(r, k));
                const allChecked = need.length > 0 && need.every((k) => r.checks?.[k]);
                return (
                  <Fragment key={r.id}>
                    <tr className={`rp-row ${open ? 'open' : ''} ${allChecked ? 'all-checked' : ''}`}>
                      {leaderView && (
                        <td className="rp-team">
                          <span className="team-tag">{teamName(r.team)}</span>
                        </td>
                      )}
                      <td className="rp-title">
                        <button
                          className="rp-title-btn"
                          onClick={() => {
                            setOpenId(open ? null : r.id);
                            if (!open) markSeen(r); // 열어 보면 알림 꺼짐
                          }}
                        >
                          <span className="rp-caret">{open ? '▾' : '▸'}</span>
                          {/* 휴대폰: 제목 옆에 어느 조 보고인지 */}
                          <span className={`rp-src rp-title-team t-${r.team}`}>{teamName(r.team)}</span>
                          {r.title}
                          {/* 공유: 다른 조에서 받은 것 / 우리가 공유한 것 */}
                          {!leaderView && r.team !== myTeam && <span className="rp-shared in">🔗 {teamName(r.team)}에서 공유</span>}
                          {r.team === myTeam && (r.shareTeams ?? []).length > 0 && <span className="rp-shared">🔗 {(r.shareTeams ?? []).map(teamName).join(' · ')}</span>}
                          {(r.replies ?? []).length > 0 && <span className="rp-n">💬 {r.replies!.length}</span>}
                          {unseen && <span className="rp-new">{leaderView ? 'NEW' : '새 답변'}</span>}
                          {fresh && <span className="rp-new blue">확인 전</span>}
                          {allChecked && <span className="rp-done-tag">✅ 확인 완료</span>}
                        </button>
                      </td>
                      <td className="rp-who">{nameOf(r.authorEmail, r.authorName)}</td>
                      <td className="rp-date">{when(r.createdAt)}</td>
                      {(['lead', 'director'] as CheckRole[]).map((k) => {
                        const c = r.checks?.[k];
                        const mine = myCheck === k || access.role === 'admin'; // 관리자는 두 칸 다
                        // 확인자로 안 고른 칸은 비워 둠
                        if (!needsCheck(r, k) && !c)
                          return (
                            <td key={k} className={`rp-chk rp-chk-off rp-c-${k}`} title={`${CHECK_LABEL[k]} 확인 없음`}>
                              <span className="rp-chk-none" />
                            </td>
                          );
                        return (
                          <td key={k} className={`rp-chk rp-c-${k} ${c ? 'on' : ''}`}>
                            {/* 휴대폰: 체크칸만 (내 칸은 누를 수 있음) */}
                            <input className="rp-chk-mobile" type="checkbox" checked={!!c} disabled={!mine} onChange={() => toggleCheck(r, k)} title={c ? `${shortName(nameOf(c.email, c.by))} ${when(c.at)}` : `${CHECK_LABEL[k]} 확인`} />
                            {/* 확인한 사람 이름만 (누르면 날짜·시간) */}
                            {mine ? (
                              <span className="rp-chk-label">
                                <input type="checkbox" checked={!!c} onChange={() => toggleCheck(r, k)} title={c ? '확인했어요 (되돌릴 수 없어요)' : `${CHECK_LABEL[k]} 확인`} />
                                {c ? <CheckName name={shortName(nameOf(c.email, c.by))} at={when(c.at)} color={colorOf(c.email)} /> : <span className="muted">확인</span>}
                              </span>
                            ) : c ? (
                              <CheckName name={shortName(nameOf(c.email, c.by))} at={when(c.at)} color={colorOf(c.email)} />
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {open && (
                      <tr className="rp-detail-row">
                        {/* 내용은 제목 칸 아래부터 확인란 앞까지 */}
                        {leaderView && <td className="rp-pad" />}
                        <td colSpan={3}>
                          <ReportDetail r={r} myName={myName} nameOf={nameOf} canEdit={access.role === 'admin' || (!!access.email && r.authorEmail === access.email)} canDelete={access.role === 'admin' || (!!access.email && r.authorEmail === access.email)} />
                        </td>
                        <td className="rp-pad" colSpan={2} />
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ReportForm({
  id,
  init,
  onSave,
  onCancel,
  team,
}: {
  id: string;
  init?: { title: string; body: string; files?: RequestFile[]; to?: CheckRole[]; share?: string[] };
  onSave: (title: string, body: string, files: RequestFile[], to: CheckRole[], share: { people: string[]; teams: string[] }) => void;
  onCancel: () => void;
  team: string;
}) {
  // 🔗 공유: 다른 조 · 무역사무 사람을 추가하면 그 조 보고방에도 보이고, 그 사람에게 알림
  const access = useAccess();
  const { roles, contacts } = usePeople();
  const people: PersonOpt[] = (roles ?? [])
    .filter((x) => x.role !== 'auditor' && x.email !== (access.email ?? '').toLowerCase() && !((x.role === 'member' || x.role === 'admin') && (x.team ?? '2') === team) && !(x.role === 'trade' && team === 'trade'))
    .map((x) => ({
      key: x.email,
      name: contacts[x.email]?.name || x.name || x.email.split('@')[0],
      group: x.role === 'trade' ? '무역사무' : x.role === 'lead' ? '팀장님' : x.role === 'director' ? '이사님' : `${x.team ?? '2'}조`,
    }))
    .sort((a, b) => (a.group ?? '').localeCompare(b.group ?? '', 'ko') || a.name.localeCompare(b.name, 'ko'));
  const [share, setShare] = useState<string[]>(init?.share ?? []);
  const teamsOf = (emails: string[]) =>
    [...new Set(emails.map((e) => roles?.find((x) => x.email === e)).flatMap((x) => (!x ? [] : x.role === 'trade' ? ['trade'] : x.role === 'member' || x.role === 'admin' ? [String(x.team ?? '2')] : [])))].filter((t) => t !== team);
  const [title, setTitle] = useState(init?.title ?? '');
  const [body, setBody] = useState(init?.body ?? '');
  const [files, setFiles] = useState<RequestFile[]>(init?.files ?? []);
  // 확인자: 팀장님 · 이사님 (둘 다 가능). 체크한 분의 주간 할일에만 올라가고, 그분 확인란만 생김
  const [to, setTo] = useState<CheckRole[]>(init?.to ?? ['lead', 'director']);
  const flip = (k: CheckRole) => setTo((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const submit = () => title.trim() && to.length > 0 && onSave(title.trim(), body, files, (['lead', 'director'] as CheckRole[]).filter((k) => to.includes(k)), { people: share, teams: teamsOf(share) });
  return (
    <div className="card rp-form">
      <div className="rp-form-top">
        <input className="rp-form-title" autoFocus placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="rp-to" title="확인받을 분 (체크한 분의 주간 할일에만 올라가요)">
          <span className="muted small">확인자</span>
          {(['lead', 'director'] as CheckRole[]).map((k) => (
            <label key={k} className={`rp-to-opt ${to.includes(k) ? 'on' : ''}`}>
              <input type="checkbox" checked={to.includes(k)} onChange={() => flip(k)} />
              {CHECK_LABEL[k]}
            </label>
          ))}
        </div>
      </div>
      <div className="rp-share" title="다른 조 · 무역사무 사람을 추가하면 그 조 보고방에도 보이고, 추가한 사람에게 알림이 가요">
        <span className="muted small">🔗 같이 볼 사람</span>
        <PeoplePicker value={share} people={people} onChange={setShare} emptyLabel="우리 조만" />
        {share.length > 0 && <span className="muted small">→ {teamsOf(share).map((t) => (t === 'trade' ? '무역사무' : `${t}조`)).join(' · ') || '팀장님 · 이사님'} 보고방에도 보여요</span>}
      </div>
      <RichEditor initial={init?.body} onChange={setBody} placeholder="보고 내용을 자유롭게 적어 주세요 (Ctrl+Enter 로 올리기)" onCtrlEnter={submit} />
      <div className="rp-files-label muted small">사진 · 파일 (캡처한 사진은 아래 칸을 누르고 Ctrl+V 로 붙여넣기)</div>
      <FileBox reqId={id} files={files} onChange={setFiles} uploader={(f) => uploadReportFile(id, f)} />
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>취소</button>
        {!to.length && <span className="warn small">확인자를 한 분 이상 골라 주세요</span>}
        <button className="primary" disabled={!title.trim() || !to.length} onClick={submit}>
          {init ? '저장' : '올리기'}
        </button>
      </div>
    </div>
  );
}

function ReportDetail({ r, myName, nameOf, canEdit, canDelete }: { r: Report; myName: string; nameOf: (email?: string, fallback?: string) => string; canEdit: boolean; canDelete: boolean }) {
  const access = useAccess();
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const [subTo, setSubTo] = useState<string | null>(null); // 대댓글 다는 답글
  const [subText, setSubText] = useState('');
  // 이 보고를 열기 전에 본 때 — 그 뒤에 내 답글에 달린 대댓글은 빨간 점
  const [prevSeen] = useState(() => seenBefore(r.id));
  const me = (access.email ?? '').toLowerCase();
  const [zoom, setZoom] = useState<RequestFile | null>(null);
  if (editing)
    return (
      <ReportForm
        id={r.id}
        init={{ title: r.title, body: r.body, files: r.files, to: r.to, share: r.sharePeople }}
        team={r.team}
        onCancel={() => setEditing(false)}
        onSave={(title, body, files, to, share) => {
          // 처음 올린 뒤 첫 번째 고치기에서 확인자로 넣은 분만 주간 할일에 다시 넣음 (두 번째 고치기부터는 안 넣음)
          const before = r.to ?? (['lead', 'director'] as CheckRole[]);
          const added = to.filter((k) => !before.includes(k));
          const first = !r.edits;
          const retask = first && added.length ? [...new Set([...(r.retask ?? []), ...added])] : r.retask;
          void saveReport({ ...r, title, body, files, to, retask, sharePeople: share.people.length ? share.people : undefined, shareTeams: share.people.length ? share.teams : undefined, edits: (r.edits ?? 0) + 1, updatedAt: new Date().toISOString() });
          setEditing(false);
        }}
      />
    );
  const sendSub = (parentId: string) => {
    const text = subText.trim();
    if (!text) return;
    void saveReport({
      ...r,
      replies: [...(r.replies ?? []), { id: uid(), name: myName, email: access.email || undefined, role: access.role ?? undefined, text, at: new Date().toISOString(), parentId }],
    });
    setSubText('');
    setSubTo(null);
    markSeen(r);
  };
  const send = () => {
    const text = reply.trim();
    if (!text) return;
    void saveReport({
      ...r,
      replies: [...(r.replies ?? []), { id: uid(), name: myName, email: access.email || undefined, role: access.role ?? undefined, text, at: new Date().toISOString() }],
    });
    setReply('');
    setReplying(false);
    markSeen(r); // 내가 쓴 답변은 알림 안 띄움
  };
  const parentMine = (x: ReportReply) => ((r.replies ?? []).find((y) => y.id === x.parentId)?.email ?? '').toLowerCase() === me && !!me;
  const renderReply = (x: ReportReply) => (
          <div key={x.id} className={`rp-reply ${isLeaderRole(x.role) ? 'leader' : ''} ${x.parentId ? 'sub' : ''}`}>
            <span className="rp-reply-arrow" aria-hidden="true">
              ↳
            </span>
            <span className="rp-reply-who">
              {nameOf(x.email, x.name)}
              {isLeaderRole(x.role) && <span className="rp-role">{CHECK_LABEL[x.role]}</span>}
            </span>
            <span className="rp-reply-text">{x.text}</span>
            {/* 내 답글에 새로 달린 대댓글 */}
            {x.parentId && parentMine(x) && x.at > prevSeen && (x.email ?? '').toLowerCase() !== me && <span className="rp-new-dot" title="내 답글에 새 답글" />}
            <span className="muted small">{when(x.at)}</span>
            {/* 이모지 반응: 누구나 (다시 누르면 취소) · 올려 보면 누가 눌렀는지 */}
            <Reactions
              x={x}
              me={access.email}
              myName={myName}
              nameOf={nameOf}
              onChange={(reactions) => void saveReport({ ...r, replies: (r.replies ?? []).map((y) => (y.id === x.id ? { ...y, reactions, ack: undefined } : y)) })}
            />
            {!x.parentId && (
              <button className="link small rp-sub-btn" onClick={() => (setSubTo(subTo === x.id ? null : x.id), setSubText(''))}>
                ↳ 답글
              </button>
            )}
            {x.email && x.email === access.email && (
              <button className="icon-btn" title="답변 지우기" onClick={() => confirm('이 답변을 지울까요?') && void saveReport({ ...r, replies: (r.replies ?? []).filter((y) => y.id !== x.id && y.parentId !== x.id) })}>
                ✕
              </button>
            )}
          </div>
  );
  return (
    <div className="rp-detail">
      {r.body ? <div className="rp-body memo-rich-view" dangerouslySetInnerHTML={{ __html: memoHtml(r.body) }} /> : <div className="rp-body muted">내용 없음</div>}
      {/* 사진은 네모 썸네일 (누르면 크게), 파일은 한 줄 이름 (누르면 내려받기) */}
      {(r.files ?? []).some(isImageFile) && (
        <div className="rq-files view rp-files">
          {r.files!.filter(isImageFile).map((f, i) => (
            <a
              key={i}
              className="rq-thumb"
              href={f.url}
              title={f.name}
              onClick={(e) => {
                e.preventDefault();
                setZoom(f);
              }}
            >
              <img src={f.url} alt={f.name} />
            </a>
          ))}
        </div>
      )}
      {(r.files ?? []).some((f) => !isImageFile(f)) && (
        <ul className="rp-filelist">
          {r.files!
            .filter((f) => !isImageFile(f))
            .map((f, i) => (
              <li key={i}>
                <a
                  href={f.url}
                  download={f.name}
                  title="누르면 내려받기"
                  onClick={(e) => {
                    e.preventDefault();
                    void downloadFile(f);
                  }}
                >
                  <span className="rp-file-ic">📎</span>
                  {f.name}
                  <span className="rp-file-dl">⬇</span>
                </a>
              </li>
            ))}
        </ul>
      )}
      {zoom && <ImageZoom f={zoom} onClose={() => setZoom(null)} />}
      {/* 답글쓰기 (누르면 답글 칸) · 고치기 · 지우기 */}
      {(
        <div className="rp-actions">
          <button className="link small" onClick={() => setReplying((v) => !v)}>
            ↳ 답글쓰기
          </button>
          {r.updatedAt && <span className="muted small">고침 {when(r.updatedAt)}</span>}
          {/* 고치기 · 지우기는 맨 오른쪽 */}
          <span className="rp-actions-right">
            {canEdit && (
              <button className="link small" onClick={() => setEditing(true)}>
                ✎ 고치기
              </button>
            )}
            {canDelete && (
              <button className="link small danger-text" onClick={() => confirm(`"${r.title}" 보고를 지울까요?`) && void deleteReport(r.id)}>
                🗑 지우기
              </button>
            )}
          </span>
        </div>
      )}
      <div className="rp-replies">
        {(r.replies ?? [])
          .filter((x) => !x.parentId || !(r.replies ?? []).some((y) => y.id === x.parentId))
          .map((x) => {
            const kids = (r.replies ?? []).filter((y) => y.parentId === x.id);
            const newKid = kids.some((y) => y.at > prevSeen && (y.email ?? '').toLowerCase() !== me) && (x.email ?? '').toLowerCase() === me;
            return (
              <div key={x.id} className={`rp-thread ${newKid ? 'has-new' : ''}`}>
                {renderReply(x)}
                {kids.length > 0 && <div className="rp-subs">{kids.map((y) => renderReply(y))}</div>}
                {subTo === x.id && (
                  <div className="rp-reply-box rp-sub-box">
                    <textarea
                      rows={2}
                      autoFocus
                      placeholder={`${nameOf(x.email, x.name)}님 답글에 답하기 (Ctrl+Enter 로 올리기)`}
                      value={subText}
                      onChange={(e) => setSubText(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendSub(x.id)}
                    />
                    <button onClick={() => setSubTo(null)}>취소</button>
                    <button className="primary" disabled={!subText.trim()} onClick={() => sendSub(x.id)}>
                      올리기
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        {/* 답글: '답글쓰기'를 눌렀을 때만 */}
        {replying && (
        <div className="rp-reply-box">
          <textarea
            rows={2}
            autoFocus
            placeholder="답글 쓰기 (Ctrl+Enter 로 올리기)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
          />
          <button onClick={() => setReplying(false)}>취소</button>
          <button className="primary" disabled={!reply.trim()} onClick={send}>
            올리기
          </button>
        </div>
        )}

      </div>
    </div>
  );
}

/** 확인란 이름: 세 글자 한글 이름은 성을 빼고 (예: 이승재 → 승재) */
const shortName = (n: string) => (/^[가-힣]{3}$/.test(n) ? n.slice(1) : n);

/** 확인한 사람 이름 — 누르면 날짜·시간 */
function CheckName({ name, at, color }: { name: string; at: string; color?: string }) {
  const [show, setShow] = useState(false);
  return (
    <button type="button" className="rp-chk-name" style={{ '--c': color ?? '#8c2f3c' } as CSSProperties} onClick={() => setShow((v) => !v)} title={at}>
      <span className="rp-chk-pill">{name}</span>
      {show && <span className="rp-chk-at">{at}</span>}
    </button>
  );
}

/** 답글 이모지 반응: 눌린 이모지 + 수 (누가 눌렀는지 이름 표시), 😊+ 로 고르기 */
function Reactions({
  x,
  me,
  myName,
  nameOf,
  onChange,
}: {
  x: ReportReply;
  me: string;
  myName: string;
  nameOf: (email?: string, fallback?: string) => string;
  onChange: (r: Record<string, { email?: string; name: string; at: string }[]>) => void;
}) {
  const [pick, setPick] = useState(false);
  const [tip, setTip] = useState<string | null>(null);
  // 예전 '담당 확인'(ack)은 👍 로 보여줌
  const cur = x.reactions ?? (x.ack ? { '👍': [{ name: x.ack.by ?? '', at: x.ack.at }] } : {});
  const mine = (e: string) => (cur[e] ?? []).some((p) => (me && p.email === me) || (!p.email && p.name === myName));
  const toggle = (e: string) => {
    const list = cur[e] ?? [];
    const next = { ...cur, [e]: mine(e) ? list.filter((p) => !((me && p.email === me) || (!p.email && p.name === myName))) : [...list, { email: me || undefined, name: myName, at: new Date().toISOString() }] };
    if (!next[e].length) delete next[e];
    onChange(JSON.parse(JSON.stringify(next)));
    setPick(false);
  };
  const names = (e: string) => (cur[e] ?? []).map((p) => nameOf(p.email, p.name)).join(', ');
  return (
    <span className="rp-reacts">
      {REACTIONS.filter((e) => cur[e]?.length).map((e) => (
        <span key={e} className="rp-react-wrap" onMouseEnter={() => setTip(e)} onMouseLeave={() => setTip(null)}>
          <button className={`rp-react ${mine(e) ? 'on' : ''}`} onClick={() => toggle(e)} onFocus={() => setTip(e)} onBlur={() => setTip(null)} aria-label={`${e} ${names(e)}`}>
            {e} <b>{cur[e].length}</b>
          </button>
          {tip === e && <span className="rp-react-tip">{names(e)}</span>}
        </span>
      ))}
      <span className="rp-react-wrap">
        <button className="rp-react add" onClick={() => setPick((v) => !v)} title="반응 남기기">
          😊<span>＋</span>
        </button>
        {pick && (
          <span className="rp-react-pick" onMouseLeave={() => setPick(false)}>
            {REACTIONS.map((e) => (
              <button key={e} className={mine(e) ? 'on' : ''} onClick={() => toggle(e)}>
                {e}
              </button>
            ))}
          </span>
        )}
      </span>
    </span>
  );
}
