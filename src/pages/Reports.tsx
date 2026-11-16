// 보고방: 조원이 쓰고 (제목만 보이고 누르면 내용), 팀장님·이사님이 각자 확인 체크 + 답변
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAccess } from '../components/AuthGate';
import { useStore } from '../data/store';
import { isPersonal, TEAMS } from '../lib/team';
import { uid } from '../lib/date';
import RichEditor from '../components/RichEditor';
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
  const myName =
    data.members.find((m) => !!access.email && m.email?.toLowerCase() === access.email)?.name ?? access.accountName ?? (access.email ? access.email.split('@')[0] : '나');
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
                const unseen = !leaderView && isUnseen(r);
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
                      <td className="rp-who">{r.authorName ?? ''}</td>
                      <td className="rp-date">{when(r.createdAt)}</td>
                      {(['lead', 'director'] as CheckRole[]).map((k) => {
                        const c = r.checks?.[k];
                        const mine = myCheck === k || access.role === 'admin'; // 관리자는 두 칸 다
                        return (
                          <td key={k} className={`rp-chk ${c ? 'on' : ''}`}>
                            {mine ? (
                              <label className="rp-chk-label" title={`${CHECK_LABEL[k]} 확인 (누르면 바뀜)`}>
                                <input type="checkbox" checked={!!c} onChange={() => toggleCheck(r, k)} />
                                {c ? when(c.at) : '확인'}
                              </label>
                            ) : c ? (
                              <span title={`${c.by} · ${when(c.at)}`}>✓ {when(c.at)}</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                    {open && (
                      <tr className="rp-detail-row">
                        <td colSpan={leaderView ? 6 : 5}>
                          <ReportDetail r={r} myName={myName} canEdit={!!access.email && r.authorEmail === access.email} canDelete={access.role === 'admin' || (!!access.email && r.authorEmail === access.email)} />
                        </td>
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

function ReportDetail({ r, myName, canEdit, canDelete }: { r: Report; myName: string; canEdit: boolean; canDelete: boolean }) {
  const access = useAccess();
  const [editing, setEditing] = useState(false);
  const [reply, setReply] = useState('');
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
    markSeen(r); // 내가 쓴 답변은 알림 안 띄움
  };
  return (
    <div className="rp-detail">
      {r.body ? <div className="rp-body memo-rich-view" dangerouslySetInnerHTML={{ __html: memoHtml(r.body) }} /> : <div className="rp-body muted">내용 없음</div>}
      {(r.files ?? []).length > 0 && (
        <div className="rq-files view rp-files">
          {r.files!.map((f, i) => (
            <a
              key={i}
              className="rq-thumb"
              href={f.url}
              target="_blank"
              rel="noreferrer"
              title={f.name}
              download={isImageFile(f) ? undefined : f.name}
              onClick={(e) => {
                e.preventDefault();
                // 사진은 크게 보기, 나머지 파일은 바로 내려받기
                if (isImageFile(f)) setZoom(f);
                else void downloadFile(f);
              }}
            >
              {isImageFile(f) ? <img src={f.url} alt={f.name} /> : <span>⬇ {f.name}</span>}
            </a>
          ))}
        </div>
      )}
      {zoom && <ImageZoom f={zoom} onClose={() => setZoom(null)} />}
      {(canEdit || canDelete) && (
        <div className="rp-actions">
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
            <span className="rp-reply-who">
              {x.name}
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
        {/* 답변은 팀장님·이사님 (+ 관리자) */}
        {(isLeaderRole(access.role) || access.role === 'admin') && (
        <div className="rp-reply-box">
          <textarea
            rows={2}
            placeholder="답변 쓰기 (Ctrl+Enter 로 올리기)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && send()}
          />
          <button className="primary" disabled={!reply.trim()} onClick={send}>
            답변
          </button>
        </div>
        )}
      </div>
    </div>
  );
}
