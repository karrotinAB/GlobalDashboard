// 계약서 보관함 (도구함 › 계약서) — 관리자만
//   [검색] 조항 · 업체로 찾기 (보증금 → deposit 처럼 같은 뜻 말도 같이) → 업체별로 해당 조항
//   [계약서] 업체별 목록 → 열면 조항으로 정리된 본문 (제목 굵게) + 원본 파일
//   [올리기] 업체 · 계약서 이름 · 계약일 · 원본 파일 · OCR 텍스트 붙여넣기 (조항 자동 정리 미리보기)
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { useAccess } from '../components/AuthGate';
import { useLookups } from '../data/store';
import { today, uid } from '../lib/date';
import { deleteContract, expandQuery, parseArticles, saveContract, uploadContractFile, useContracts, type Contract, type ContractFile } from '../lib/contracts';

const dots = (iso?: string) => (iso ? iso.replace(/-/g, '.') : '');

/** 글 안에서 찾은 말 <mark> */
function hl(text: string, groups: string[][]): ReactNode {
  const words = groups.flat().filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}
const has = (text: string, g: string[]) => {
  const t = text.toLowerCase();
  return g.some((w) => t.includes(w));
};

export default function Contracts() {
  const access = useAccess();
  const isAdmin = access.role === 'admin' || access.role === null;
  const list = useContracts(isAdmin);
  const [tab, setTab] = useState<'search' | 'list' | 'new'>('search');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  if (!isAdmin)
    return (
      <div className="page">
        <div className="page-head">
          <h1>계약서</h1>
        </div>
        <p className="card muted">계약서 보관함은 지금은 관리자만 볼 수 있어요.</p>
      </div>
    );
  const open = list?.find((c) => c.id === openId);
  const editing = list?.find((c) => c.id === editId);
  return (
    <div className="page">
      <div className="page-head">
        <h1>계약서</h1>
        <p className="muted">계약서를 업체별로 보관하고, 조항으로 찾아봐요. 원본(스캔본)은 참고용으로 같이 올려 두고, 내용은 OCR 텍스트를 붙여넣으면 조항별로 정리돼요.</p>
      </div>
      <div className="seg pc-tabs">
        <button className={tab === 'search' && !open ? 'on' : ''} onClick={() => (setTab('search'), setOpenId(null))}>
          🔍 조항 검색
        </button>
        <button className={tab === 'list' && !open ? 'on' : ''} onClick={() => (setTab('list'), setOpenId(null))}>
          📁 업체별 계약서
        </button>
        <button className={tab === 'new' && !open ? 'on' : ''} onClick={() => (setTab('new'), setOpenId(null), setEditId(null))}>
          ＋ 계약서 올리기
        </button>
      </div>
      {list === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : open ? (
        <ContractView c={open} onBack={() => setOpenId(null)} onEdit={() => (setEditId(open.id), setTab('new'), setOpenId(null))} />
      ) : tab === 'search' ? (
        <Search list={list} onOpen={setOpenId} />
      ) : tab === 'list' ? (
        <ByCompany list={list} onOpen={setOpenId} />
      ) : (
        <Upload key={editing?.id ?? 'new'} init={editing} by={access.accountName || access.email} onSaved={(id) => (setEditId(null), setOpenId(id))} />
      )}
    </div>
  );
}

function Search({ list, onOpen }: { list: Contract[]; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [co, setCo] = useState('');
  const groups = useMemo(() => expandQuery(q), [q]);
  const companies = [...new Set(list.map((c) => c.company))];
  // 업체 → [계약서, 맞는 조항들]
  const results = useMemo(() => {
    if (!groups.length) return [];
    const out: { c: Contract; hits: { head: string; body: string[] }[] }[] = [];
    for (const c of list) {
      if (co && c.company !== co) continue;
      const { intro, articles } = parseArticles(c.text ?? '');
      const parts = [...(intro.length ? [{ head: '(앞부분)', body: intro }] : []), ...articles];
      const hits = parts.filter((a) => groups.every((g) => has(`${a.head}\n${a.body.join('\n')}`, g)));
      if (hits.length) out.push({ c, hits });
    }
    return out;
  }, [list, groups, co]);
  return (
    <>
      <div className="card ct-search">
        <input className="search" autoFocus placeholder="🔍 조항 찾기 (예: 보증금 · 로열티 · 해지 · deposit)" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={co} onChange={(e) => setCo(e.target.value)}>
          <option value="">업체 전체</option>
          {companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        {groups.some((g) => g.length > 1) && (
          <p className="muted small" style={{ width: '100%', margin: 0 }}>
            같이 찾는 말: {groups.map((g) => g.join(' · ')).join(' / ')}
          </p>
        )}
      </div>
      {!q.trim() ? (
        <p className="muted small">찾을 말을 넣으면 업체마다 그 내용이 들어간 조항을 보여줘요. 한글로 찾아도 영어 계약서의 같은 뜻 조항을 같이 찾아요.</p>
      ) : results.length === 0 ? (
        <p className="muted small">맞는 조항이 없어요.</p>
      ) : (
        <div className="ct-results">
          {results.map(({ c, hits }) => (
            <section key={c.id} className="card ct-result">
              <div className="ct-result-head">
                <b>{c.company}</b>
                <span className="muted small">
                  {c.title}
                  {c.signedAt ? ` · ${dots(c.signedAt)}` : ''}
                </span>
                <button className="link small" onClick={() => onOpen(c.id)}>
                  계약서 열기 ›
                </button>
              </div>
              {hits.map((a, i) => (
                <div key={i} className="ct-art">
                  <div className="ct-art-head">{hl(a.head, groups)}</div>
                  {a.body.map((p, j) => (
                    <p key={j}>{hl(p, groups)}</p>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function ByCompany({ list, onOpen }: { list: Contract[]; onOpen: (id: string) => void }) {
  const byCo = new Map<string, Contract[]>();
  for (const c of list) byCo.set(c.company, [...(byCo.get(c.company) ?? []), c]);
  if (!list.length) return <p className="card muted">아직 올린 계약서가 없어요. '＋ 계약서 올리기'로 시작해요.</p>;
  return (
    <div className="ct-cos">
      {[...byCo.entries()].map(([co, cs]) => (
        <section key={co} className="card ct-co">
          <h2>{co}</h2>
          {cs.map((c) => (
            <button key={c.id} className="trip-row" onClick={() => onOpen(c.id)}>
              <span className="trip-row-icon">📄</span>
              <b>{c.title}</b>
              <span className="muted small">{dots(c.signedAt)}</span>
              <span className="muted small">
                조항 {parseArticles(c.text ?? '').articles.length}개 · 파일 {(c.files ?? []).length}개
              </span>
              <span className="trip-row-go">열기 ›</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function ContractView({ c, onBack, onEdit }: { c: Contract; onBack: () => void; onEdit: () => void }) {
  const { intro, articles } = useMemo(() => parseArticles(c.text ?? ''), [c.text]);
  const [q, setQ] = useState('');
  const groups = useMemo(() => expandQuery(q), [q]);
  return (
    <>
      <button className="link trip-back" onClick={onBack}>
        ← 목록
      </button>
      <div className="ct-view">
        <article className="card ct-doc">
          <div className="ct-doc-head">
            <div>
              <h2>{c.title}</h2>
              <span className="muted small">
                {c.company}
                {c.signedAt ? ` · 계약일 ${dots(c.signedAt)}` : ''}
              </span>
            </div>
            <input className="search" placeholder="🔍 이 계약서에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {!c.text?.trim() && <p className="muted">아직 OCR 텍스트를 넣지 않았어요. '고치기'에서 붙여넣어 주세요.</p>}
          {intro.map((p, i) => (
            <p key={`i${i}`} className="ct-intro">
              {hl(p, groups)}
            </p>
          ))}
          {articles.map((a) => {
            const hit = groups.length > 0 && groups.every((g) => has(`${a.head}\n${a.body.join('\n')}`, g));
            if (groups.length && !hit) return null;
            return (
              <section key={a.no} className="ct-art">
                <div className="ct-art-head">{hl(a.head, groups)}</div>
                {a.body.map((p, j) => (
                  <p key={j}>{hl(p, groups)}</p>
                ))}
              </section>
            );
          })}
        </article>
        <aside className="card ct-side">
          <h3>원본 파일</h3>
          {(c.files ?? []).length === 0 ? (
            <p className="muted small">올린 파일이 없어요.</p>
          ) : (
            <ul className="ct-files">
              {c.files!.map((f) => (
                <li key={f.url}>
                  <a href={f.url} target="_blank" rel="noreferrer">
                    📎 {f.name}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {articles.length > 0 && (
            <>
              <h3>조항</h3>
              <ol className="ct-toc">
                {articles.map((a) => (
                  <li key={a.no}>{a.head}</li>
                ))}
              </ol>
            </>
          )}
          {c.note && <p className="small">{c.note}</p>}
          <div className="btn-row" style={{ gap: 8, marginTop: 10 }}>
            <button onClick={onEdit}>✎ 고치기</button>
            <button
              className="danger"
              onClick={async () => {
                if (!confirm(`'${c.company} · ${c.title}' 계약서를 지울까요?`)) return;
                await deleteContract(c.id);
                onBack();
              }}
            >
              지우기
            </button>
          </div>
        </aside>
      </div>
    </>
  );
}

function Upload({ init, by, onSaved }: { init?: Contract; by?: string; onSaved: (id: string) => void }) {
  const { companies } = useLookups();
  const [id] = useState(init?.id ?? uid());
  const [company, setCompany] = useState(init?.company ?? '');
  const [title, setTitle] = useState(init?.title ?? '');
  const [signedAt, setSignedAt] = useState(init?.signedAt ?? '');
  const [text, setText] = useState(init?.text ?? '');
  const [note, setNote] = useState(init?.note ?? '');
  const [files, setFiles] = useState<ContractFile[]>(init?.files ?? []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const parsed = useMemo(() => parseArticles(text), [text]);
  const addFiles = async (list: File[]) => {
    setBusy(true);
    setErr('');
    try {
      const up: ContractFile[] = [];
      for (const f of list) up.push(await uploadContractFile(id, f));
      setFiles((x) => [...x, ...up]);
    } catch (e) {
      setErr(`파일을 올리지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    } finally {
      setBusy(false);
    }
  };
  const ok = company.trim() && title.trim();
  const save = async () => {
    if (!ok) return;
    try {
      await saveContract({ id, company: company.trim(), title: title.trim(), signedAt: signedAt || undefined, files, text: text || undefined, note: note.trim() || undefined, createdAt: init?.createdAt ?? new Date().toISOString(), by: init?.by ?? by });
      onSaved(id);
    } catch (e) {
      setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <div className="ct-upload">
      <section className="card">
        <h2 style={{ marginTop: 0 }}>{init ? '계약서 고치기' : '계약서 올리기'}</h2>
        <div className="ct-form">
          <label>
            <span>업체 *</span>
            <input list="ct-cos" placeholder="업체 이름" value={company} onChange={(e) => setCompany(e.target.value)} />
            <datalist id="ct-cos">
              {companies.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </label>
          <label>
            <span>계약서 이름 *</span>
            <input placeholder="예: Master Franchise Agreement" value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            <span>계약일</span>
            <input type="date" value={signedAt} max={today()} onChange={(e) => setSignedAt(e.target.value)} />
          </label>
        </div>
        <div
          className="ct-files-box"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void addFiles([...e.dataTransfer.files]);
          }}
        >
          <b>원본 파일 (스캔본 · 참고용)</b>
          {files.map((f, i) => (
            <span key={f.url + i} className="file-chip">
              <a href={f.url} target="_blank" rel="noreferrer">
                📎 {f.name}
              </a>
              <button className="x" onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                ×
              </button>
            </span>
          ))}
          <label className="pc-rc-btn">
            {busy ? '올리는 중…' : '＋ 파일'}
            <input type="file" multiple accept=".pdf,image/*,.doc,.docx" hidden onChange={(e) => void addFiles([...(e.target.files ?? [])])} />
          </label>
          <span className="muted small">끌어다 놓아도 돼요</span>
        </div>
        <label className="ct-text-label">
          <span>
            OCR 텍스트 <span className="muted small">— 그대로 붙여넣어 주세요. Article · 제N조 · 1. 제목 줄을 찾아 조항으로 나누고, 끊긴 줄은 이어 붙여요</span>
          </span>
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'예)\nARTICLE 1. DEFINITIONS\n...\nARTICLE 5. SECURITY DEPOSIT\nThe Licensee shall pay ...'} />
        </label>
        <label className="ct-text-label">
          <span>메모</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 2027년 갱신 예정" />
        </label>
        {err && <p className="warn small">{err}</p>}
        <div className="btn-row" style={{ gap: 8 }}>
          <button className="primary" disabled={!ok || busy} onClick={() => void save()}>
            저장
          </button>
        </div>
      </section>
      <section className="card ct-preview">
        <h3 style={{ marginTop: 0 }}>
          정리 미리보기 <span className="muted small">조항 {parsed.articles.length}개</span>
        </h3>
        {!text.trim() ? (
          <p className="muted small">OCR 텍스트를 붙여넣으면 여기서 계약서 모양으로 미리 봐요.</p>
        ) : (
          <div className="ct-doc ct-doc-mini">
            {parsed.intro.map((p, i) => (
              <p key={`i${i}`} className="ct-intro">
                {p}
              </p>
            ))}
            {parsed.articles.map((a) => (
              <section key={a.no} className="ct-art">
                <div className="ct-art-head">{a.head}</div>
                {a.body.map((p, j) => (
                  <p key={j}>{p}</p>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
