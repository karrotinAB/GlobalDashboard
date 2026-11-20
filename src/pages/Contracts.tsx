// 계약서 보관함 (도구함 › 계약서) — 관리자만
//   [검색] 조항 · 업체로 찾기 (보증금 → deposit 처럼 같은 뜻 말도 같이) → 업체별로 해당 조항
//   [계약서] 업체별 목록 → 열면 조항으로 정리된 본문 (제목 굵게) + 원본 파일
//   [올리기] 업체 · 계약서 이름 · 계약일 · 원본 파일 · OCR 텍스트 붙여넣기 (조항 자동 정리 미리보기)
import { Fragment, useMemo, useState, type ReactNode } from 'react';
import { isLeader, useAccess } from '../components/AuthGate';
import { isPersonal } from '../lib/team';
import { useFullName } from './Petty';
import { Modal } from '../components/ui';
import { useLookups } from '../data/store';
import { today, uid } from '../lib/date';
import { deleteClip, deleteClipFolder, saveClip, saveClipFolder, useClipFolders, useClips, deleteContract, expandQuery, FIELD_RE, isField, langOf, parseArticles, SUB, TITLE, saveContract, uploadContractFile, useContracts, type ClipFolder, type Contract, type ContractFile, canSeeFolder, canSetFolderVis, FOLDER_VIS } from '../lib/contracts';

const dots = (iso?: string) => (iso ? iso.replace(/-/g, '.') : '');

/** 글 안에서 찾은 말 <mark> */
/** (최신) · (주요) 표시 */
function Marks({ c }: { c: Contract }) {
  return (
    <>
      {c.latest && <span className="ct-mark ct-mark-new">최신</span>}
      {c.main && <span className="ct-mark ct-mark-main">주요</span>}
    </>
  );
}

function hl(text: string, groups: string[][]): ReactNode {
  const words = groups.flat().filter(Boolean).sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}
/** 폴더 강조 말 → 같은 뜻 말까지 (claim ↔ 클레임) */
const kwGroups = (words?: string[]) => (words ?? []).flatMap((w) => expandQuery(w));
/** 찾는 말(노랑) + 폴더 강조 말(폴더 색) 같이 칠하기 */
function hl2(text: string, search: string[][], kw: string[][]): ReactNode {
  const s = search.flat().filter(Boolean);
  const k = kw.flat().filter(Boolean);
  const words = [...s, ...k].sort((a, b) => b.length - a.length);
  if (!words.length) return text;
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${words.map(esc).join('|')})`, 'gi');
  const isSearch = (p: string) => s.some((w) => w.toLowerCase() === p.toLowerCase());
  return text.split(re).map((p, i) => (i % 2 ? <mark key={i} className={isSearch(p) ? '' : 'ct-kw'}>{p}</mark> : <Fragment key={i}>{p}</Fragment>));
}
/** 쉼표로 나눈 말 목록 */
const splitWords = (t: string) => [...new Set(t.split(/[,，、\n]/).map((w) => w.trim()).filter(Boolean))];

/** 문단 하나: 소제목은 굵게 · 'Label: value' 는 라벨 굵게 · 나머지는 보통 문단 */
function Para({ p, groups, intro }: { p: string; groups: string[][]; intro?: boolean }) {
  if (p.startsWith(TITLE)) return <div className="ct-sub ct-doc-title">{hl(p.slice(1), groups)}</div>;
  if (p.startsWith(SUB)) return <div className="ct-sub">{hl(p.slice(1), groups)}</div>;
  const m = isField(p) ? p.match(FIELD_RE) : null;
  if (m)
    return (
      <p className="ct-field">
        <b>{hl(m[1].trim(), groups)}:</b> {hl(m[2], groups)}
      </p>
    );
  return <p className={intro ? 'ct-intro' : undefined}>{hl(p, groups)}</p>;
}
const has = (text: string, g: string[]) => {
  const t = text.toLowerCase();
  return g.some((w) => t.includes(w));
};

export default function Contracts() {
  const access = useAccess();
  const isAdmin = access.role === 'admin' || access.role === null;
  const list = useContracts(isAdmin);
  const [tab, setTab] = useState<'search' | 'list' | 'new' | 'scrap'>('list');
  // 글을 긁으면 '✂️ 스크랩' 버튼 → 폴더 골라 저장
  const [pick, setPick] = useState<{ text: string; cid: string; head?: string; x: number; y: number } | null>(null);
  const [scrap, setScrap] = useState<{ text: string; cid: string; head?: string } | null>(null);
  const onMouseUp = () => {
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().replace(/\s+/g, ' ').trim() ?? '';
      if (!sel || sel.rangeCount === 0 || text.length < 3) return setPick(null);
      const node = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
      const box = node?.closest('[data-cid]') as HTMLElement | null;
      if (!box) return setPick(null);
      const head = (node?.closest('[data-head]') as HTMLElement | null)?.dataset.head;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      setPick({ text, cid: box.dataset.cid!, head, x: rect.right, y: rect.top });
    }, 0);
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [newCo, setNewCo] = useState(''); // 업체별 목록에서 '＋ 이 업체에 계약서 더 올리기'
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
    <div className="page" onMouseUp={onMouseUp}>
      {pick && (
        <button
          className="ct-scrap-pop"
          style={{ left: Math.min(window.innerWidth - 110, pick.x + 6), top: Math.max(8, pick.y - 40) }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseUp={(e) => e.stopPropagation()}
          onClick={() => {
            setScrap({ text: pick.text, cid: pick.cid, head: pick.head });
            setPick(null);
            window.getSelection()?.removeAllRanges();
          }}
        >
          ✂️ 스크랩
        </button>
      )}
      {scrap && list && <ScrapModal s={scrap} c={list.find((x) => x.id === scrap.cid)} by={access.accountName || access.email} onClose={() => setScrap(null)} />}
      <div className="page-head">
        <h1>계약서</h1>
        <p className="muted">계약서를 업체별로 보관하고, 조항으로 찾아봐요. 원본(스캔본)은 참고용으로 같이 올려 두고, 내용은 OCR 텍스트를 붙여넣으면 조항별로 정리돼요.</p>
      </div>
      <div className="seg pc-tabs">
        <button className={tab === 'list' && !open ? 'on' : ''} onClick={() => (setTab('list'), setOpenId(null))}>
          📁 업체별 계약서
        </button>
        <button className={tab === 'search' && !open ? 'on' : ''} onClick={() => (setTab('search'), setOpenId(null))}>
          🔍 조항 검색
        </button>
        <button className={tab === 'scrap' && !open ? 'on' : ''} onClick={() => (setTab('scrap'), setOpenId(null))}>
          📌 스크랩
        </button>
        <button className={tab === 'new' && !open ? 'on' : ''} onClick={() => (setTab('new'), setOpenId(null), setEditId(null), setNewCo(''))}>
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
        <ByCompany list={list} onOpen={setOpenId} onAdd={(co) => (setNewCo(co), setEditId(null), setTab('new'))} />
      ) : tab === 'scrap' ? (
        <ScrapTab list={list} onOpen={setOpenId} />
      ) : (
        <Upload key={editing?.id ?? `new:${newCo}`} init={editing} company0={newCo} list={list} by={access.accountName || access.email} onSaved={(id) => (setEditId(null), setOpenId(id))} />
      )}
    </div>
  );
}

/** 우리 조만 / 전체 (검색 · 업체별 계약서 같이 기억)
 *  우리 조 계약서: 올린 조가 지금 조이거나, (조 기록이 없는 예전 것은) 업체가 우리 조 업체 */
function useCtScope() {
  const access = useAccess();
  const { companies: myCos } = useLookups();
  const [scope, setScopeState] = useState<'mine' | 'all'>(() => {
    try {
      return localStorage.getItem('gd:ctScope') === 'mine' ? 'mine' : 'all';
    } catch {
      return 'all';
    }
  });
  const setScope = (k: 'mine' | 'all') => {
    setScopeState(k);
    try {
      localStorage.setItem('gd:ctScope', k);
    } catch {
      /* 무시 */
    }
  };
  // 팀장님 · 이사님 공간: 조 구분 없이 모든 계약서 (버튼도 안 보임)
  const leaderSpace = isLeader(access.role) || isPersonal(access.viewTeam);
  const isMine = (c: Contract) => (c.team ? c.team === access.viewTeam : myCos.some((m) => m.name === c.company));
  const seg = (onChange?: () => void) => (leaderSpace ? null : (
    <div className="seg ct-scope">
      {(['mine', 'all'] as const).map((k) => (
        <button key={k} className={scope === k ? 'on' : ''} onClick={() => (setScope(k), onChange?.())}>
          {k === 'mine' ? `우리 조만 (${access.viewLabel})` : '전체'}
        </button>
      ))}
    </div>
  ));
  return { scope: leaderSpace ? ('all' as const) : scope, isMine, seg, access, myCos };
}

function Search({ list, onOpen }: { list: Contract[]; onOpen: (id: string) => void }) {
  const { scope, isMine, seg, access, myCos } = useCtScope();
  const [q, setQ] = useState('');
  const [co, setCo] = useState('');
  const [onlyNew, setOnlyNew] = useState(false); // 최신 버전만
  const [onlyMain, setOnlyMain] = useState(false); // 주요 계약서만
  const groups = useMemo(() => expandQuery(q), [q]);
  const companies = [...new Set(list.filter((c) => scope === 'all' || isMine(c)).map((c) => c.company))];
  // 업체 → [계약서, 맞는 조항들] — 보여주는 건 원문, 번역본은 같은 순서의 조항 (번역 버튼)
  type Part = { head: string; body: string[]; section?: boolean };
  const results = useMemo(() => {
    if (!groups.length) return [];
    const out: { c: Contract; orig: Part[]; trans: (Part | undefined)[] }[] = [];
    const partsOf = (t?: string): Part[] => {
      if (!t) return [];
      const { intro, articles } = parseArticles(t);
      return [...(intro.length ? [{ head: '(앞부분)', body: intro }] : []), ...articles];
    };
    const hit = (a?: Part) => !!a && groups.every((g) => has(`${a.head}\n${a.body.join('\n')}`, g));
    for (const c of list) {
      if (co && c.company !== co) continue;
      if (scope === 'mine' && !isMine(c)) continue;
      if (onlyNew && !c.latest) continue;
      if (onlyMain && !c.main) continue;
      const O = partsOf(c.text);
      const T = partsOf(c.text2);
      // 원문이나 번역본 어느 쪽에서든 맞으면 그 순서의 조항 (원문/번역본 조항 수가 다르면 제목 번호로 맞춤)
      const num = (h: string) => h.match(/\d+/)?.[0];
      const pairOf = (k: number) => (T.length === O.length ? T[k] : T.find((x) => num(x.head) && num(x.head) === num(O[k]?.head ?? '') && !!x.section === !!O[k]?.section));
      const idx = new Set<number>();
      O.forEach((a, k) => (hit(a) || hit(pairOf(k))) && idx.add(k));
      if (T.length && T.length !== O.length) T.forEach((a) => hit(a) && O.forEach((o, k) => num(o.head) && num(o.head) === num(a.head) && idx.add(k)));
      if (!O.length) T.forEach((a, k) => hit(a) && idx.add(k));
      const ks = [...idx].sort((a, b) => a - b);
      if (ks.length) out.push({ c, orig: O.length ? ks.map((k) => O[k]) : ks.map((k) => T[k]), trans: O.length ? ks.map(pairOf) : [] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, groups, co, onlyNew, onlyMain, scope, access.viewTeam, myCos]);
  return (
    <>
      <div className="card ct-search">
        <input className="search" autoFocus placeholder="🔍 조항 찾기 (예: 보증금 · 로열티 · 해지 · deposit)" value={q} onChange={(e) => setQ(e.target.value)} />
        {seg(() => setCo(''))}
        <select value={co} onChange={(e) => setCo(e.target.value)}>
          <option value="">업체 전체</option>
          {companies.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="ct-opt" title="(최신) 표시한 계약서에서만 찾기">
          <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} /> 최신 버전만
        </label>
        <label className="ct-opt" title="(주요) 표시한 계약서에서만 찾기">
          <input type="checkbox" checked={onlyMain} onChange={(e) => setOnlyMain(e.target.checked)} /> 주요 계약서만
        </label>
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
          {results.map((r) => (
            <SearchCard key={r.c.id} r={r} groups={groups} onOpen={onOpen} />
          ))}
        </div>
      )}
    </>
  );
}

/** 검색 결과 한 업체: 원문 조항 · 코너 '번역' 누르면 같은 조항의 번역본 */
function SearchCard({ r, groups, onOpen }: { r: { c: Contract; orig: { head: string; body: string[]; section?: boolean }[]; trans: ({ head: string; body: string[]; section?: boolean } | undefined)[] }; groups: string[][]; onOpen: (id: string) => void }) {
  const [tr, setTr] = useState(false);
  const { c } = r;
  const show = tr ? r.trans : r.orig;
  return (
    <section className="card ct-result" data-cid={c.id}>
      <div className="ct-result-head">
        <b>{c.company}</b>
        <span className="muted small">
          {c.title}
          {c.signedAt ? ` · ${dots(c.signedAt)}` : ''}
        </span>
        <Marks c={c} />
        <span className="ct-result-tools">
          {c.text2?.trim() && r.trans.length > 0 && (
            <button className={`ct-tr-btn ${tr ? 'on' : ''}`} onClick={() => setTr(!tr)} title={tr ? '원문으로' : '이 조항들의 번역본 보기'}>
              {tr ? `원문 (${langOf(c.text)})` : `번역 (${langOf(c.text2)})`}
            </button>
          )}
          <button className="link small" onClick={() => onOpen(c.id)}>
            계약서 열기 ›
          </button>
        </span>
      </div>
      {show.map((a, i) =>
        a ? (
          <div key={i} className={a.section ? 'ct-art ct-section' : 'ct-art'} data-head={a.head}>
            <div className="ct-art-head">{hl(a.head, groups)}</div>
            {a.body.map((p, j) => (
              <Para key={j} p={p} groups={groups} />
            ))}
          </div>
        ) : (
          <p key={i} className="muted small">
            (이 조항은 번역본에서 못 찾았어요)
          </p>
        ),
      )}
    </section>
  );
}

function ByCompany({ list: all, onOpen, onAdd }: { list: Contract[]; onOpen: (id: string) => void; onAdd: (company: string) => void }) {
  const { scope, isMine, seg } = useCtScope();
  const list = scope === 'all' ? all : all.filter(isMine);
  const byCo = new Map<string, Contract[]>();
  for (const c of list) byCo.set(c.company, [...(byCo.get(c.company) ?? []), c]);
  if (!all.length) return <p className="card muted">아직 올린 계약서가 없어요. '＋ 계약서 올리기'로 시작해요.</p>;
  return (
    <div className="ct-cos">
      <div className="ct-cos-bar">
        {seg()}
        <span className="muted small">
          업체 {byCo.size}곳 · 계약서 {list.length}개
        </span>
      </div>
      {list.length === 0 && <p className="card muted">우리 조 계약서가 아직 없어요. '전체'를 눌러 보세요.</p>}
      {[...byCo.entries()].map(([co, cs]) => (
        <section key={co} className="card ct-co">
          <div className="ct-co-head">
            <h2>{co}</h2>
            <button className="link small" onClick={() => onAdd(co)}>
              ＋ 이 업체에 계약서 더 올리기
            </button>
          </div>
          {[...cs].sort((a, b) => Number(!!b.latest) - Number(!!a.latest) || Number(!!b.main) - Number(!!a.main) || (b.signedAt ?? '').localeCompare(a.signedAt ?? '')).map((c) => (
            <button key={c.id} className="trip-row" onClick={() => onOpen(c.id)}>
              <span className="trip-row-icon">📄</span>
              <b>{c.title}</b>
              <Marks c={c} />
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
  // 원문 / 번역본 / 나란히
  const [which, setWhich] = useState<'orig' | 'trans' | 'both'>('orig');
  const { intro, articles } = useMemo(() => parseArticles((which === 'trans' ? c.text2 : c.text) ?? ''), [c.text, c.text2, which]);
  const trans = useMemo(() => parseArticles(c.text2 ?? ''), [c.text2]);
  const [q, setQ] = useState('');
  const groups = useMemo(() => expandQuery(q), [q]);
  return (
    <>
      <button className="link trip-back" onClick={onBack}>
        ← 목록
      </button>
      <div className="ct-view">
        <article className="card ct-doc" data-cid={c.id}>
          <div className="ct-doc-head">
            <div>
              <h2>
                {c.title} <Marks c={c} />
              </h2>
              <span className="muted small">
                {c.company}
                {c.signedAt ? ` · 계약일 ${dots(c.signedAt)}` : ''}
              </span>
            </div>
            <input className="search" placeholder="🔍 이 계약서에서 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {c.text2?.trim() && (
            <div className="seg ct-lang-seg">
              <button className={which === 'orig' ? 'on' : ''} onClick={() => setWhich('orig')}>
                원문 ({langOf(c.text)})
              </button>
              <button className={which === 'trans' ? 'on' : ''} onClick={() => setWhich('trans')}>
                번역본 ({langOf(c.text2)})
              </button>
              <button className={which === 'both' ? 'on' : ''} onClick={() => setWhich('both')}>
                나란히 보기
              </button>
            </div>
          )}
          {which === 'both' && c.text2?.trim() ? (
            <div className="ct-both">
              {[parseArticles(c.text ?? ''), trans].map((d, k) => (
                <div key={k} className="ct-both-col">
                  <div className="ct-lang">{k ? `번역본 (${langOf(c.text2)})` : `원문 (${langOf(c.text)})`}</div>
                  {d.intro.map((p, i) => (
                    <Para key={`i${i}`} p={p} groups={groups} intro />
                  ))}
                  {d.articles.map((a) => (
                    <section key={a.no} className={a.section ? 'ct-art ct-section' : 'ct-art'} data-head={a.head}>
                      <div className="ct-art-head">{hl(a.head, groups)}</div>
                      {a.body.map((p, j) => (
                        <Para key={j} p={p} groups={groups} />
                      ))}
                    </section>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <>
          {!c.text?.trim() && <p className="muted">아직 OCR 텍스트를 넣지 않았어요. '고치기'에서 붙여넣어 주세요.</p>}
          {intro.map((p, i) => (
            <Para key={`i${i}`} p={p} groups={groups} intro />
          ))}
          {articles.map((a) => {
            const hit = groups.length > 0 && groups.every((g) => has(`${a.head}\n${a.body.join('\n')}`, g));
            if (groups.length && !hit) return null;
            return (
              <section key={a.no} id={`ct-art-${a.no}`} className={a.section ? 'ct-art ct-section' : 'ct-art'} data-head={a.head}>
                <div className="ct-art-head">{hl(a.head, groups)}</div>
                {a.body.map((p, j) => (
                  <Para key={j} p={p} groups={groups} />
                ))}
              </section>
            );
          })}
            </>
          )}
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
              <ul className="ct-toc">
                {articles.map((a, i) => (
                  // Section 아래 Article 은 들여쓰기 (그 앞에 Section 이 하나라도 있으면)
                  <li key={a.no} className={a.section ? 'ct-toc-sec' : articles.slice(0, i).some((x) => x.section) ? 'ct-toc-sub' : undefined}>
                    {/* 누르면 그 조항으로 (찾기 중이면 찾기를 풀고) */}
                    <button
                      className="ct-toc-btn"
                      onClick={() => {
                        const go = () => {
                          const el = document.getElementById(`ct-art-${a.no}`);
                          if (!el) return;
                          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                          el.classList.add('ct-flash');
                          setTimeout(() => el.classList.remove('ct-flash'), 1500);
                        };
                        if (q || which === 'both') {
                          setQ('');
                          if (which === 'both') setWhich('orig');
                          setTimeout(go, 60);
                        } else go();
                      }}
                    >
                      {a.head}
                    </button>
                  </li>
                ))}
              </ul>
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

function Upload({ init, company0, list, by, onSaved }: { init?: Contract; company0?: string; list: Contract[]; by?: string; onSaved: (id: string) => void }) {
  const access = useAccess();
  const { companies } = useLookups();
  const [id] = useState(init?.id ?? uid());
  const [company, setCompany] = useState(init?.company ?? company0 ?? '');
  const [latest, setLatest] = useState(init?.latest ?? false);
  const [main, setMain] = useState(init?.main ?? false);
  // 같은 업체에 이미 올린 계약서 (새로 올릴 때 보여줌)
  const sameCo = list.filter((c) => c.id !== init?.id && company.trim() && c.company === company.trim());
  const [title, setTitle] = useState(init?.title ?? '');
  const [signedAt, setSignedAt] = useState(init?.signedAt ?? '');
  const [text, setText] = useState(init?.text ?? '');
  const [text2, setText2] = useState(init?.text2 ?? '');
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
      // 같은 업체 · 같은 계약서 이름에서 (최신) 은 하나만: 이걸 최신으로 하면 예전 것의 (최신) 은 뗌
      if (latest) for (const o of sameCo) if (o.latest && o.title.trim().toLowerCase() === title.trim().toLowerCase()) await saveContract({ ...o, latest: false });
      await saveContract({ id, company: company.trim(), title: title.trim(), signedAt: signedAt || undefined, files, text: text || undefined, text2: text2 || undefined, note: note.trim() || undefined, latest: latest || undefined, main: main || undefined, team: init?.team ?? access.viewTeam, createdAt: init?.createdAt ?? new Date().toISOString(), by: init?.by ?? by });
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
        <div className="ct-marks-pick">
          <label className={`ct-mark-toggle ${latest ? 'on new' : ''}`}>
            <input type="checkbox" checked={latest} onChange={(e) => setLatest(e.target.checked)} /> (최신) 최신 버전
          </label>
          <label className={`ct-mark-toggle ${main ? 'on main' : ''}`}>
            <input type="checkbox" checked={main} onChange={(e) => setMain(e.target.checked)} /> (주요) 주요 계약서
          </label>
          <span className="muted small">검색할 때 '최신 버전만' · '주요 계약서만' 으로 골라 찾을 수 있어요</span>
        </div>
        {sameCo.length > 0 && (
          <p className="muted small ct-same-co">
            이 업체에 올린 계약서 {sameCo.length}개:{' '}
            {sameCo.map((c) => `${c.title}${c.latest ? ' (최신)' : ''}${c.main ? ' (주요)' : ''}`).join(' · ')} — 새 계약서로 따로 저장돼요
            {latest && sameCo.some((o) => o.latest && o.title.trim().toLowerCase() === title.trim().toLowerCase()) ? '. 이름이 같은 예전 계약서의 (최신) 은 떼요' : ''}
          </p>
        )}
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
            원문 OCR 텍스트 <span className="muted small">— 그대로 붙여넣어 주세요. Article · 제N조 · 1. 제목 줄을 찾아 조항으로 나누고, 끊긴 줄은 이어 붙여요</span>
          </span>
          <textarea rows={14} value={text} onChange={(e) => setText(e.target.value)} placeholder={'예)\nARTICLE 1. DEFINITIONS\n...\nARTICLE 5. SECURITY DEPOSIT\nThe Licensee shall pay ...'} />
        </label>
        <label className="ct-text-label">
          <span>
            번역본 텍스트 <span className="muted small">— {text.trim() ? `원문이 ${langOf(text)}라서 ${langOf(text) === '한글' ? '영어' : '한글'} 버전` : '원문이 한글이면 영어, 영어면 한글 버전'} (있으면 붙여넣어 주세요. 검색도 같이 돼요)</span>
          </span>
          <textarea rows={8} value={text2} onChange={(e) => setText2(e.target.value)} placeholder="번역본 (선택)" />
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
              <Para key={`i${i}`} p={p} groups={[]} intro />
            ))}
            {parsed.articles.map((a) => (
              <section key={a.no} className={a.section ? 'ct-art ct-section' : 'ct-art'}>
                <div className="ct-art-head">{a.head}</div>
                {a.body.map((p, j) => (
                  <Para key={j} p={p} groups={[]} />
                ))}
              </section>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** 볼 수 있는 폴더만 (나만 · 우리 조 · 전체) */
function useMyFolders() {
  const access = useAccess();
  const all = useClipFolders(true);
  const email = (access.email ?? '').toLowerCase();
  return { folders: all?.filter((f) => canSeeFolder(f, email, access.viewTeam)) ?? null, email, team: access.viewTeam };
}
/** 공개 범위 고르기 */
function VisSelect({ value, onChange, disabled }: { value: ClipFolder['vis']; onChange: (v: 'me' | 'team' | 'all') => void; disabled?: boolean }) {
  return (
    <select className="ct-vis" value={value ?? 'all'} disabled={disabled} title={disabled ? '만든 사람만 바꿀 수 있어요' : '이 폴더를 누가 볼 수 있나'} onChange={(e) => onChange(e.target.value as 'me' | 'team' | 'all')}>
      {(Object.keys(FOLDER_VIS) as (keyof typeof FOLDER_VIS)[]).map((k) => (
        <option key={k} value={k}>
          {FOLDER_VIS[k]}
        </option>
      ))}
    </select>
  );
}

/** 스크랩 저장: 폴더 고르기 (또는 새 폴더 이름 정해서 만들기) · 메모 */
function ScrapModal({ s: sel, c, by, onClose }: { s: { text: string; cid: string; head?: string }; c?: Contract; by?: string; onClose: () => void }) {
  const { folders, email, team } = useMyFolders();
  const [vis, setVis] = useState<'me' | 'team' | 'all'>('all');
  const [folderId, setFolderId] = useState('');
  const [newName, setNewName] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const making = folderId === '__new' || (folders?.length === 0 && !folderId);
  const picked = folders?.find((f) => f.id === folderId);
  // 폴더 강조할 말: 고른 폴더에 이미 있는 말로 채워 두고, 고치면 폴더에 저장
  const [wordsText, setWordsText] = useState('');
  const [wordsFor, setWordsFor] = useState('');
  if (wordsFor !== folderId) {
    setWordsFor(folderId);
    setWordsText((picked?.words ?? []).join(', '));
  }
  const save = async () => {
    try {
      let fid = folderId;
      if (making) {
        const name = newName.trim();
        if (!name) return setErr('폴더 이름을 정해 주세요');
        const exist = folders?.find((f) => f.name === name);
        fid = exist?.id ?? uid();
        if (!exist) await saveClipFolder({ id: fid, name, words: splitWords(wordsText), vis, email: email || undefined, team, createdAt: new Date().toISOString(), by });
      }
      if (!fid) return setErr('폴더를 골라 주세요');
      const f = folders?.find((x) => x.id === fid);
      if (f && JSON.stringify(f.words ?? []) !== JSON.stringify(splitWords(wordsText))) await saveClipFolder({ ...f, words: splitWords(wordsText) });
      await saveClip({ id: uid(), folderId: fid, text: sel.text, contractId: sel.cid, company: c?.company ?? '', title: c?.title ?? '', head: sel.head, note: note.trim() || undefined, at: new Date().toISOString(), by });
      onClose();
    } catch (e) {
      setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
    }
  };
  return (
    <Modal title="✂️ 스크랩" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>
        {c?.company} · {c?.title}
        {sel.head ? ` · ${sel.head}` : ''}
      </p>
      <blockquote className="ct-clip-quote">{sel.text}</blockquote>
      <div className="ct-scrap-form">
        <label>
          <span>폴더</span>
          <select value={making ? '__new' : folderId} onChange={(e) => setFolderId(e.target.value)}>
            <option value="">폴더 고르기</option>
            {(folders ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.vis === 'me' ? '🔒' : f.vis === 'team' ? '👥' : '📁'} {f.name}
              </option>
            ))}
            <option value="__new">＋ 새 폴더 만들기</option>
          </select>
        </label>
        {making && (
          <label>
            <span>새 폴더 이름</span>
            <input autoFocus placeholder="예: 보증금 조항 모음" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
          </label>
        )}
        {making && (
          <label>
            <span>공개 범위</span>
            <VisSelect value={vis} onChange={setVis} />
          </label>
        )}
        {(making || picked) && (
          <label>
            <span>이 폴더에서 강조할 말 (쉼표로 나눠요 · 폴더 모든 스크랩에 칠해져요)</span>
            <input placeholder="예: claim, credit note, 클레임, 3 months" value={wordsText} onChange={(e) => setWordsText(e.target.value)} />
          </label>
        )}
        <label>
          <span>메모 (선택)</span>
          <input placeholder="예: 몽골은 5만 달러" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>
      {err && <p className="warn small">{err}</p>}
      <div className="btn-row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button onClick={onClose}>취소</button>
        <button className="primary" onClick={() => void save()}>
          저장
        </button>
      </div>
    </Modal>
  );
}

/** 📌 스크랩: 폴더별로 모아 보기 · 폴더 이름 바꾸기 · 찾기 (글 · 업체 · 조항 · 메모 · 폴더 이름) */
function ScrapTab({ list, onOpen }: { list: Contract[]; onOpen: (id: string) => void }) {
  const { folders, email, team } = useMyFolders();
  const allClips = useClips(true);
  // 볼 수 없는 폴더 (남의 '나만' · 다른 조 '우리 조') 의 스크랩은 빼고
  const clips = allClips && folders ? allClips.filter((c) => folders.some((f) => f.id === c.folderId)) : null;
  const [newVis, setNewVis] = useState<'me' | 'team' | 'all'>('all');
  const [fid, setFid] = useState(''); // '' = 모든 폴더
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameText, setNameText] = useState('');
  const [newName, setNewName] = useState('');
  const groups = useMemo(() => expandQuery(q), [q]);
  const folderName = (id: string) => folders?.find((f) => f.id === id)?.name ?? '(지운 폴더)';
  const shown = (clips ?? []).filter((c) => (!fid || c.folderId === fid) && (!groups.length || groups.every((g) => has(`${c.text}\n${c.company}\n${c.title}\n${c.head ?? ''}\n${c.note ?? ''}\n${folderName(c.folderId)}`, g))));
  // 폴더 이름으로 찾기: 찾는 말이 폴더 이름에 들어가면 그 폴더도 위에 보여줌
  const matchFolders = q.trim() ? (folders ?? []).filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const count = (id: string) => (clips ?? []).filter((c) => c.folderId === id).length;
  return (
    <div className="ct-scrap">
      <aside className="card ct-folders">
        <button className={`ct-folder ${!fid ? 'on' : ''}`} onClick={() => setFid('')}>
          📚 모든 스크랩 <span className="muted small">{(clips ?? []).length}</span>
        </button>
        {(folders ?? []).map((f) =>
          renaming === f.id ? (
            <input
              key={f.id}
              autoFocus
              className="ct-folder-rename"
              value={nameText}
              onChange={(e) => setNameText(e.target.value)}
              onBlur={() => {
                if (nameText.trim() && nameText.trim() !== f.name) void saveClipFolder({ ...f, name: nameText.trim() });
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(null);
              }}
            />
          ) : (
            <div key={f.id} className={`ct-folder ${fid === f.id ? 'on' : ''}`}>
              <button className="ct-folder-name" onClick={() => setFid(f.id)}>
                {f.vis === 'me' ? '🔒' : f.vis === 'team' ? '👥' : '📁'} {f.name} <span className="muted small">{count(f.id)}</span>
              </button>
              <button className="icon-btn" title="폴더 이름 바꾸기" onClick={() => (setRenaming(f.id), setNameText(f.name))}>
                ✎
              </button>
              <button
                className="icon-btn"
                title="폴더 지우기"
                onClick={async () => {
                  if (!confirm(`'${f.name}' 폴더를 지울까요? (안의 스크랩 ${count(f.id)}개도 같이 지워요)`)) return;
                  for (const c of (clips ?? []).filter((x) => x.folderId === f.id)) await deleteClip(c.id);
                  await deleteClipFolder(f.id);
                  if (fid === f.id) setFid('');
                }}
              >
                ✕
              </button>
            </div>
          ),
        )}
        <div className="ct-folder-new">
          <input placeholder="＋ 새 폴더 이름" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && newName.trim() && (void saveClipFolder({ id: uid(), name: newName.trim(), vis: newVis, email: email || undefined, team, createdAt: new Date().toISOString() }), setNewName(''))} />
          <VisSelect value={newVis} onChange={setNewVis} />
        </div>
        <p className="muted small" style={{ margin: '6px 4px 0' }}>
          계약서 글을 긁으면 '✂️ 스크랩' 이 떠요. 🔒 나만 · 👥 우리 조 · 📁 전체 공개 (폴더 머리에서 바꿔요)
        </p>
      </aside>
      <section className="ct-scrap-main">
        <div className="card ct-search">
          <input className="search" placeholder="🔍 스크랩 찾기 (글 · 업체 · 조항 · 메모 · 폴더 이름)" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">
            {fid ? `📁 ${folderName(fid)} · ` : ''}
            {shown.length}개
          </span>
        </div>
        {matchFolders.length > 0 && (
          <div className="ct-folder-hits">
            <span className="muted small">이름이 맞는 폴더:</span>
            {matchFolders.map((f) => (
              <button key={f.id} className="cchip" onClick={() => (setFid(f.id), setQ(''))}>
                📁 {f.name} ({count(f.id)})
              </button>
            ))}
          </div>
        )}
        {clips === null ? (
          <p className="muted small">불러오는 중…</p>
        ) : shown.length === 0 ? (
          <p className="muted small">{q ? '맞는 스크랩이 없어요.' : '아직 스크랩이 없어요. 계약서나 검색 결과에서 글을 긁어 보세요.'}</p>
        ) : (
          // 같은 폴더 스크랩은 한 카드에 붙여서
          [...new Set(shown.map((c) => c.folderId))].map((f) => (
            <article key={f} className="card ct-clip-group">
              <FolderHead email={email} team={team} f={folders?.find((x) => x.id === f)} name={folderName(f)} count={shown.filter((c) => c.folderId === f).length} onPick={() => setFid(f)} />
              {shown
                .filter((c) => c.folderId === f)
                .map((c) => (
                  // 비교해서 보기 좋게: 왼쪽 업체 · 가운데 스크랩한 글 · 오른쪽 열기/지우기 (한 줄씩)
                  <div key={c.id} className="ct-clip-row">
                    <div className="ct-clip-co">
                      <b>{c.company}</b>
                      <span className="muted small" title={`${c.title}${c.head && c.head !== '(앞부분)' ? ` · ${c.head}` : ''}`}>
                        {c.title}
                        {c.head && c.head !== '(앞부분)' ? ` · ${c.head}` : ''}
                      </span>
                    </div>
                    <div className="ct-clip-body">
                      <div className="ct-clip-text">{hl2(c.text, groups, kwGroups(folders?.find((x) => x.id === c.folderId)?.words))}</div>
                      {c.note && <div className="ct-clip-note">📝 {hl(c.note, groups)}</div>}
                      <div className="ct-clip-by muted">
                        <ByName v={c.by} />
                        {dots(c.at.slice(0, 10))}
                      </div>
                    </div>
                    <div className="ct-clip-side">
                      {list.some((x) => x.id === c.contractId) && (
                        <button className="link small" onClick={() => onOpen(c.contractId)}>
                          열기 ›
                        </button>
                      )}
                      <button className="icon-btn" title="스크랩 지우기" onClick={() => confirm('이 스크랩을 지울까요?') && void deleteClip(c.id)}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

/** 넣은 사람: 이메일로 저장된 것도 이름으로 */
function ByName({ v }: { v?: string }) {
  const name = useFullName(v ?? '');
  if (!v) return null;
  return <>{(v.includes('@') ? name : v) + ' · '}</>;
}

/** 스크랩 폴더 머리: 이름 · 개수 · 🖍 강조할 말 (눌러서 고치기) */
function FolderHead({ f, name, count, onPick, email, team }: { f?: ClipFolder; name: string; count: number; onPick: () => void; email: string; team: string }) {
  const [edit, setEdit] = useState(false);
  const [text, setText] = useState('');
  const save = () => {
    setEdit(false);
    if (f && JSON.stringify(splitWords(text)) !== JSON.stringify(f.words ?? [])) void saveClipFolder({ ...f, words: splitWords(text) });
  };
  return (
    <div className="ct-clip-group-head">
      <button className="link" onClick={onPick}>
        {f?.vis === 'me' ? '🔒' : f?.vis === 'team' ? '👥' : '📁'} {name}
      </button>
      <span className="muted small">{count}개</span>
      {f && <VisSelect value={f.vis} disabled={!canSetFolderVis(f, email)} onChange={(v) => void saveClipFolder({ ...f, vis: v, email: f.email ?? (email || undefined), team: f.team ?? team })} />}
      {f &&
        (edit ? (
          <input
            className="ct-kw-input"
            autoFocus
            placeholder="강조할 말 (쉼표로) 예: claim, credit note, 클레임"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') setEdit(false);
            }}
          />
        ) : (
          <button className="ct-kw-btn" title="이 폴더 스크랩에서 칠할 말 정하기" onClick={() => (setText((f.words ?? []).join(', ')), setEdit(true))}>
            🖍{' '}
            {f.words?.length ? (
              f.words.map((w) => (
                <mark key={w} className="ct-kw">
                  {w}
                </mark>
              ))
            ) : (
              <span className="muted">강조할 말 넣기</span>
            )}
          </button>
        ))}
    </div>
  );
}
