// 보고방: 조원이 쓰고 (제목만 보이고 누르면 내용), 팀장님·이사님이 각자 확인 체크 + 답변
import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useAccess } from '../components/AuthGate';
import { useStore } from '../data/store';
import { isPersonal, TEAMS } from '../lib/team';
import { uid } from '../lib/date';
import RichEditor from '../components/RichEditor';
import { usePeople } from '../components/AddressBook';
import { FileBox, ImageZoom, isImageFile } from '../components/RequestParts';
import { memoHtml } from '../lib/richtext';
import type { RequestFile } from '../types';
import { downloadFile, uploadReportFile, CHECK_LABEL, deleteReport, isLeaderRole, isUnseen, markSeen, saveReport, useReports, type CheckRole, type Report } from '../lib/reports';

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
  const shown = useMemo(
    () => (list ?? []).filter((r) => (!teamF || r.team === teamF) && (!onlyOpen || !myCheck || !r.checks?.[myCheck])),
    [list, teamF, onlyOpen, myCheck],
  );
  const canWrite = !leaderView && (space === 'trade' ? access.role === 'trade' || access.role === 'admin' || access.role === null : access.role !== 'trade');
  const toggleCheck = (r: Report, k: CheckRole) => {
    const checks = { ...(r.checks ?? {}) };
    if (checks[k]) delete checks[k];
    else checks[k] = { by: myName, email: access.email || undefined, at: new Date().toISOString() };
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

      {writing && (
        <ReportForm
          id={writing}
          onCancel={() => setWriting(null)}
          onSave={(title, body, files) => {
            const now = new Date().toISOString();
            void saveReport({ id: writing, team: myTeam, title, body, files, authorEmail: access.email || undefined, authorName: myName, createdAt: now, checks: {}, replies: [] });
            setWriting(null);
          }}
        />
      )}

      {leaderView && (
        <div className="toolbar rp-tools">
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
          {myCheck && (
            <label className="check-line small">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> 내가 확인 안 한 것만
            </label>
          )}
        </div>
      )}

      <section className="card rp-card">
        {list === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="muted small">{list.length ? '조건에 맞는 보고가 없어요.' : '아직 올라온 보고가 없어요.'}</p>
        ) : (
          <table className="rp-table">
            <thead>
              <tr>
                {leaderView && <th className="rp-team">조</th>}
                <th className="rp-title">제목</th>
                <th className="rp-who">작성자</th>
                <th className="rp-date">올린 날</th>
                <th className="rp-chk">팀장님 확인</th>
                <th className="rp-chk">이사님 확인</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const open = openId === r.id;
                const unseen = !leaderView && isUnseen(r, access.email);
                const fresh = leaderView && myCheck && !r.checks?.[myCheck];
                return (
                  <Fragment key={r.id}>
                    <tr className={`rp-row ${open ? 'open' : ''}`}>
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
                            if (!open && !leaderView) markSeen(r);
                          }}
                        >
                          <span className="rp-caret">{open ? '▾' : '▸'}</span>
                          {r.title}
                          {(r.replies ?? []).length > 0 && <span className="rp-n">💬 {r.replies!.length}</span>}
                          {unseen && <span className="rp-new">새 답변</span>}
                          {fresh && <span className="rp-new blue">확인 전</span>}
                        </button>
                      </td>
                      <td className="rp-who">{nameOf(r.authorEmail, r.authorName)}</td>
                      <td className="rp-date">{when(r.createdAt)}</td>
                      {(['lead', 'director'] as CheckRole[]).map((k) => {
                        const c = r.checks?.[k];
                        const mine = myCheck === k || access.role === 'admin'; // 관리자는 두 칸 다
                        return (
                          <td key={k} className={`rp-chk ${c ? 'on' : ''}`}>
                            {/* 확인한 사람 이름만 (누르면 날짜·시간) */}
                            {mine ? (
                              <span className="rp-chk-label">
                                <input type="checkbox" checked={!!c} onChange={() => toggleCheck(r, k)} title={`${CHECK_LABEL[k]} 확인 (누르면 바뀜)`} />
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
}: {
  id: string;
  init?: { title: string; body: string; files?: RequestFile[] };
  onSave: (title: string, body: string, files: RequestFile[]) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(init?.title ?? '');
  const [body, setBody] = useState(init?.body ?? '');
  const [files, setFiles] = useState<RequestFile[]>(init?.files ?? []);
  const submit = () => title.trim() && onSave(title.trim(), body, files);
  return (
    <div className="card rp-form">
      <input className="rp-form-title" autoFocus placeholder="제목" value={title} onChange={(e) => setTitle(e.target.value)} />
      <RichEditor initial={init?.body} onChange={setBody} placeholder="보고 내용을 자유롭게 적어 주세요 (Ctrl+Enter 로 올리기)" onCtrlEnter={submit} />
      <div className="rp-files-label muted small">사진 · 파일 (캡처한 사진은 아래 칸을 누르고 Ctrl+V 로 붙여넣기)</div>
      <FileBox reqId={id} files={files} onChange={setFiles} uploader={(f) => uploadReportFile(id, f)} />
      <div className="btn-row" style={{ justifyContent: 'flex-end' }}>
        <button onClick={onCancel}>취소</button>
        <button className="primary" disabled={!title.trim()} onClick={submit}>
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
  const [zoom, setZoom] = useState<RequestFile | null>(null);
  if (editing)
    return (
      <ReportForm
        id={r.id}
        init={{ title: r.title, body: r.body, files: r.files }}
        onCancel={() => setEditing(false)}
        onSave={(title, body, files) => {
          void saveReport({ ...r, title, body, files, updatedAt: new Date().toISOString() });
          setEditing(false);
        }}
      />
    );
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
          {r.updatedAt && <span className="muted small">고침 {when(r.updatedAt)}</span>}
        </div>
      )}
      <div className="rp-replies">
        {(r.replies ?? []).map((x) => (
          <div key={x.id} className={`rp-reply ${isLeaderRole(x.role) ? 'leader' : ''}`}>
            <span className="rp-reply-arrow" aria-hidden="true">
              ↳
            </span>
            <span className="rp-reply-who">
              {nameOf(x.email, x.name)}
              {isLeaderRole(x.role) && <span className="rp-role">{CHECK_LABEL[x.role]}</span>}
            </span>
            <span className="rp-reply-text">{x.text}</span>
            <span className="muted small">{when(x.at)}</span>
            {x.email && x.email === access.email && (
              <button className="icon-btn" title="답변 지우기" onClick={() => confirm('이 답변을 지울까요?') && void saveReport({ ...r, replies: (r.replies ?? []).filter((y) => y.id !== x.id) })}>
                ✕
              </button>
            )}
          </div>
        ))}
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
