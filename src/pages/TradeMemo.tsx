// 무역사무 '업체 메모': 업체 고르기 → 각 조 메모(주간 할일 업체 메모, 고정·읽기만) + 무역사무 체크박스 메모
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useSpaceData } from '../data/store';
import { useAccess } from '../components/AuthGate';
import { TEAMS } from '../lib/team';
import { memoHtml } from '../lib/richtext';
import { uid } from '../lib/date';
import { coKey, saveCoMemo, useTradeMemos, type MemoItem } from '../lib/tradeMemos';
import type { Company } from '../types';

export type TeamCo = Company & { team: string };

/** 1·2·3조 업체 중 매장코드가 있는 것 (조 표시 붙여서) */
export function useAllTeamCompanies(): TeamCo[] {
  const c1 = useSpaceData('1', ['companies']).data.companies;
  const c2 = useSpaceData('2', ['companies']).data.companies;
  const c3 = useSpaceData('3', ['companies']).data.companies;
  return useMemo(() => {
    const by: Record<string, Company[] | undefined> = { '1': c1, '2': c2, '3': c3 };
    // 매장코드(4자리)가 설정된 업체만
    return TEAMS.flatMap((t) =>
      [...(by[t] ?? [])]
        .filter((c) => (c.storeCodes ?? []).some((x) => /^\d{4}$/.test(x)))
        .sort((a, b) => a.order - b.order)
        .map((c) => ({ ...c, team: t })),
    );
  }, [c1, c2, c3]);
}

const when = (iso?: string) => (iso ? `${new Date(iso).getMonth() + 1}/${new Date(iso).getDate()}` : '');

export default function TradeMemo() {
  const cos = useAllTeamCompanies();
  const { memos } = useTradeMemos();
  const [pick, setPick] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('c') ?? '');
  const [q, setQ] = useState('');
  const cur = cos.find((c) => coKey(c.team, c.id) === pick);
  const nq = q.trim().toLowerCase();
  const openCount = (c: TeamCo) => (memos[coKey(c.team, c.id)]?.items ?? []).filter((x) => !x.done).length;
  const list = cos.filter((c) => !nq || `${c.name} ${c.country ?? ''}`.toLowerCase().includes(nq));
  return (
    <div className="page">
      <div className="page-head">
        <h1>업체 메모</h1>
        <p className="muted">업체를 고르면 각 조가 주간 할일에 남긴 업체 메모(고정)와 무역사무 체크 메모를 같이 봐요. 체크 안 된 메모는 무역사무 홈에 떠요.</p>
      </div>
      <div className="tm-wrap">
        <aside className="card tm-list">
          <input className="search" placeholder="🔍 업체 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
          {TEAMS.map((t) => {
            const l = list.filter((c) => c.team === t);
            if (!l.length) return null;
            return (
              <div key={t} className="tm-group">
                <div className="tm-group-head">{t}조</div>
                {l.map((c) => {
                  const k = coKey(c.team, c.id);
                  const n = openCount(c);
                  return (
                    <button key={k} className={`tm-co ${pick === k ? 'on' : ''}`} onClick={() => setPick(k)}>
                      <span className="dot" style={{ background: c.color }} />
                      <span className="tm-co-name">{c.name}</span>
                      {c.memo && <span className="tm-has" title="조 메모 있음">📝</span>}
                      {n > 0 && <span className="tm-n">{n}</span>}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {!cos.length && <p className="muted small">매장코드(4자리)가 설정된 업체가 없어요 (불러오는 중일 수도 있어요)</p>}
        </aside>
        <section className="tm-main">{cur ? <CompanyMemoView c={cur} items={memos[coKey(cur.team, cur.id)]?.items ?? []} /> : <div className="card muted tm-empty">왼쪽에서 업체를 골라 주세요</div>}</section>
      </div>
    </div>
  );
}

function CompanyMemoView({ c, items: saved }: { c: TeamCo; items: MemoItem[] }) {
  // 쓰자마자 바로 보이게 (서버에 저장되면 그걸로 맞춤) · 저장 실패하면 이유를 보여줌
  const [items, setItems] = useState<MemoItem[]>(saved);
  const [err, setErr] = useState('');
  useEffect(() => setItems(saved), [saved]);
  const { email, accountName } = useAccess();
  const key = coKey(c.team, c.id);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const by = accountName ?? (email ? email.split('@')[0] : '');
  const save = (next: MemoItem[]) => {
    setItems(next);
    setErr('');
    saveCoMemo(key, next).catch((e) => {
      setErr(`저장하지 못했어요: ${(e as Error).message} — 서버 규칙을 새로 올렸는지 확인해 주세요 (deploy.bat)`);
      setItems(saved);
    });
  };
  const add = () => {
    const t = text.trim();
    if (!t) return;
    save([...items, { id: uid(), text: t, by, at: new Date().toISOString() }]);
    setText('');
  };
  const open = items.filter((x) => !x.done);
  const done = items.filter((x) => x.done);
  const row = (x: MemoItem) => (
    <li key={x.id} className={`tm-item ${x.done ? 'done' : ''}`}>
      <input type="checkbox" checked={!!x.done} onChange={() => save(items.map((y) => (y.id === x.id ? { ...y, done: !y.done, doneAt: !y.done ? new Date().toISOString() : undefined } : y)))} />
      {editing === x.id ? (
        <input
          autoFocus
          className="tm-edit"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onBlur={() => {
            if (editText.trim() && editText.trim() !== x.text) save(items.map((y) => (y.id === x.id ? { ...y, text: editText.trim() } : y)));
            setEditing(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span
          className="tm-text"
          onDoubleClick={() => {
            setEditing(x.id);
            setEditText(x.text);
          }}
          title="두 번 눌러 고치기"
        >
          {x.text}
        </span>
      )}
      <span className="muted small tm-by">
        {x.by} {when(x.at)}
      </span>
      <button className="icon-btn" title="지우기" onClick={() => confirm('이 메모를 지울까요?') && save(items.filter((y) => y.id !== x.id))}>
        ✕
      </button>
    </li>
  );
  return (
    <div className="card tm-view" style={{ '--c': c.color ?? '#8c2f3c' } as CSSProperties}>
      <div className="tm-view-head">
        <span className="dot" style={{ background: c.color }} />
        <h2>{c.name}</h2>
        <span className="team-tag">{c.team}조</span>
        {c.country && <span className="muted small">{c.country}</span>}
      </div>
      {/* 조 메모: 주간 할일 업체 이름 옆 메모 (그 조에서만 고침) */}
      <div className="tm-team-memo">
        <div className="tm-sub">
          📌 {c.team}조 메모 <span className="muted small">· 주간 할일에서 {c.team}조가 쓴 메모 (여기서는 고칠 수 없어요)</span>
        </div>
        {c.memo ? <div className="tm-team-body memo-rich-view" dangerouslySetInnerHTML={{ __html: memoHtml(c.memo) }} /> : <p className="muted small">{c.team}조 메모가 아직 없어요.</p>}
      </div>
      <div className="tm-sub">✅ 무역사무 메모 {open.length > 0 && <span className="tm-n">{open.length}</span>}</div>
      <ul className="tm-items">{open.map(row)}</ul>
      {err && <p className="warn small">{err}</p>}
      <div className="tm-add">
        <input placeholder="메모 추가 (Enter)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="primary" disabled={!text.trim()} onClick={add}>
          추가
        </button>
      </div>
      {done.length > 0 && (
        <details className="tm-done">
          <summary className="muted small">체크한 메모 {done.length}개</summary>
          <ul className="tm-items">{done.map(row)}</ul>
        </details>
      )}
    </div>
  );
}
