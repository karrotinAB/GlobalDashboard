// 번역: [번역] 엑셀을 올리면 비어 있는 분류·영문 제품명을 찾아 사전으로 자동 번역 · 모르는 단어는 채워서 사전에 추가
//       [사전] 한글 → 영어 단어장 (모두 같이 씀, 계속 업데이트)
import { useMemo, useRef, useState } from 'react';
import { useAccess } from '../components/AuthGate';
import { deleteDict, saveDict, translate, useDict, type DictEntry } from '../lib/dict';

type Tab = 'translate' | 'dict';

// 엑셀에서 찾을 칸 (띄어쓰기 무시하고 비교)
const TARGETS = [
  { key: 'mainCode', label: '수출대분류', names: ['수출대분류', '수출대분류코드'] },
  { key: 'mainName', label: '수출대분류명', names: ['수출대분류명'] },
  { key: 'mainEn', label: '수출대분류 영문명', names: ['수출대분류영문명'] },
  { key: 'subCode', label: '수출중분류', names: ['수출중분류', '수출중분류코드'] },
  { key: 'subName', label: '수출중분류명', names: ['수출중분류명'] },
  { key: 'subEn', label: '수출중분류 영문명', names: ['수출중분류영문명'] },
  { key: 'enName', label: '영문 제품명', names: ['영문제품명', '영문상품명', '제품영문명', '상품영문명'] },
] as const;
type TKey = (typeof TARGETS)[number]['key'];
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
/** 머리줄 칸 이름 → 어떤 칸인지 (비슷하면 찾음: [F9]수출 대분류 · 수출 대분류명 · 영어 제품명 …) */
const classify = (raw: unknown): TKey | 'koName' | 'code' | null => {
  const h = norm(raw).replace(/\[[^\]]*\]|\([^)]*\)|[*:·]/g, '');
  if (!h) return null;
  const eng = /영문|영어|eng|english/.test(h);
  const named = /명$|이름|name/.test(h);
  for (const [lv, code, name, en] of [
    ['대분류', 'mainCode', 'mainName', 'mainEn'],
    ['중분류', 'subCode', 'subName', 'subEn'],
  ] as const) {
    if (h.includes(lv)) return eng ? en : named ? name : code;
  }
  if (/제품명|상품명|품명|productname|itemname/.test(h)) return eng ? 'enName' : 'koName';
  if (/제품코드|상품코드|품번|바코드|itemcode/.test(h)) return 'code';
  return null;
};

interface Sheet {
  fileName: string;
  sheetName: string;
  headerRow: number; // 0부터
  headers: string[];
  col: Partial<Record<TKey | 'koName' | 'code', number>>;
  rows: { r: number; cells: unknown[] }[]; // 데이터 줄 (엑셀 줄 번호 r: 0부터)
  wb: unknown; // 원본 (내려받을 때 채워 넣음)
}

export default function Translate() {
  const [tab, setTab] = useState<Tab>('translate');
  return (
    <div className="page">
      <div className="page-head">
        <h1>번역</h1>
        <p className="muted">엑셀을 올리면 비어 있는 분류·영문 제품명을 찾아서 사전으로 자동 번역해요. 모르는 단어는 채워 넣으면 사전에 저장돼서 다음부터 자동으로 들어가요.</p>
      </div>
      <div className="seg tr-tabs">
        <button className={tab === 'translate' ? 'on' : ''} onClick={() => setTab('translate')}>
          📄 번역
        </button>
        <button className={tab === 'dict' ? 'on' : ''} onClick={() => setTab('dict')}>
          📖 사전
        </button>
      </div>
      {tab === 'translate' ? <TranslateTab /> : <DictTab />}
    </div>
  );
}

function useDictMap() {
  const list = useDict();
  return useMemo(() => {
    const map = new Map((list ?? []).map((e) => [e.ko, e.en]));
    const keys = [...map.keys()].sort((a, b) => b.length - a.length); // 긴 단어부터
    return { list, map, keys };
  }, [list]);
}

function TranslateTab() {
  const { email, accountName } = useAccess();
  const { list, map, keys } = useDictMap();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useState<Record<number, string>>({}); // 줄 → 직접 고친 영문 제품명
  const [newWords, setNewWords] = useState<Record<string, string>>({});
  const [onlyTodo, setOnlyTodo] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async (f: File) => {
    setErr('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      // 찾을 칸이 2개 이상 있는 첫 시트·첫 줄을 머리줄로
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: '', raw: false });
        for (let h = 0; h < Math.min(aoa.length, 15); h++) {
          // 칸 이름이 비슷하면 찾음 (띄어쓰기 · [F9] 같은 앞 글자 · 영어/영문 차이 무시). 같은 종류는 처음 나온 칸
          const col: Sheet['col'] = {};
          (aoa[h] ?? []).forEach((x, i) => {
            const k = classify(x);
            if (k && col[k] === undefined) col[k] = i;
          });
          if (TARGETS.filter((t) => col[t.key] !== undefined).length < 2) continue;
          const rows = aoa
            .slice(h + 1)
            .map((cells, i) => ({ r: h + 1 + i, cells }))
            .filter((x) => x.cells.some((c) => String(c ?? '').trim()));
          setSheet({ fileName: f.name, sheetName: sn, headerRow: h, headers: (aoa[h] ?? []).map((x) => String(x ?? '')), col, rows, wb });
          setEdits({});
          return;
        }
      }
      setErr("머리줄에서 '수출 대분류', '영어 제품명' 같은 칸을 못 찾았어요. 칸 이름에 '대분류' · '중분류' · '제품명' 이 들어가 있는지 확인해 주세요.");
    } catch (e) {
      setErr(`엑셀을 못 읽었어요: ${(e as Error).message}`);
    }
  };

  const cell = (row: { cells: unknown[] }, k: keyof Sheet['col']) => (sheet?.col[k] !== undefined ? String(row.cells[sheet.col[k]!] ?? '').trim() : '');
  // 비어 있는 칸이 있는 줄 + 자동 번역
  const view = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((row) => {
      const empty = TARGETS.filter((t) => sheet.col[t.key] !== undefined && !cell(row, t.key)).map((t) => t.key);
      const ko = cell(row, 'koName');
      const tr = ko ? translate(ko, map, keys) : { en: '', unknown: [] as string[], pieces: [] };
      return { row, empty, ko, tr };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, map, keys]);
  const todo = view.filter((v) => v.empty.length);
  const shown = onlyTodo ? todo : view;
  const needEn = todo.filter((v) => v.empty.includes('enName'));
  const unknownAll = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of needEn) for (const u of v.tr.unknown) c.set(u, (c.get(u) ?? 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]);
  }, [needEn]);
  const enOf = (v: (typeof view)[number]) => edits[v.row.r] ?? v.tr.en;
  // 모르는 단어를 누르면: 그 단어가 나온 제품명들 (잘못 끊어 읽지 않았는지 확인용)
  const [peek, setPeek] = useState<string | null>(null);
  const peekRows = peek ? needEn.filter((v) => v.tr.unknown.includes(peek)) : [];
  const mark = (name: string, w: string) => {
    const i = name.indexOf(w);
    return i < 0 ? name : (
      <>
        {name.slice(0, i)}
        <mark>{w}</mark>
        {name.slice(i + w.length)}
      </>
    );
  };

  const addWords = async () => {
    const list = Object.entries(newWords)
      .filter(([, en]) => en.trim())
      .map(([ko, en]) => ({ ko, en }));
    if (!list.length) return;
    await saveDict(list, accountName ?? email);
    setNewWords({});
  };

  const download = async () => {
    if (!sheet) return;
    const XLSX = await import('xlsx');
    const wb = sheet.wb as import('xlsx').WorkBook;
    const ws = wb.Sheets[sheet.sheetName];
    const c = sheet.col.enName;
    if (c === undefined) return;
    let n = 0;
    for (const v of needEn) {
      const en = enOf(v);
      if (!en || /\[[^\]]+\]/.test(en)) continue; // 모르는 단어가 남은 건 비워 둠
      ws[XLSX.utils.encode_cell({ r: v.row.r, c })] = { t: 's', v: en };
      n++;
    }
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    if (range.e.c < c) range.e.c = c;
    ws['!ref'] = XLSX.utils.encode_range(range);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = sheet.fileName.replace(/(\.xlsx?|\.csv)?$/i, '_번역.xlsx');
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    alert(`영문 제품명 ${n}줄을 채워서 받았어요. (모르는 단어가 남은 줄은 비워 뒀어요)`);
  };

  return (
    <div className="tr-wrap">
      <div className="card tr-upload">
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && void load(e.target.files[0])} />
        <button className="primary" onClick={() => fileRef.current?.click()}>
          📤 엑셀 올리기
        </button>
        {sheet ? (
          <span className="muted small">
            {sheet.fileName} · {sheet.sheetName} · 전체 {sheet.rows.length}줄 중 <b>빈 칸 있는 줄 {todo.length}</b> · 영문 제품명 빈 줄 {needEn.length}
            {sheet.col.koName === undefined && ' · ⚠ 한글 제품명 칸을 못 찾아서 자동 번역은 안 돼요'}
          </span>
        ) : (
          <span className="muted small">찾는 칸: {TARGETS.map((t) => t.label).join(' · ')} (+ 한글 제품명)</span>
        )}
        {sheet && sheet.col.enName !== undefined && (
          <button className="tr-dl" onClick={() => void download()}>
            ⬇ 채운 엑셀 받기
          </button>
        )}
      </div>
      {err && <p className="warn small">{err}</p>}
      {list === null && <p className="muted small">사전 불러오는 중…</p>}

      {sheet && unknownAll.length > 0 && (
        <div className="card tr-unknown">
          <div className="tr-unknown-head">
            <b>사전에 없는 단어 {unknownAll.length}개</b>
            <span className="muted small">영어를 채우고 [사전에 추가]를 누르면 바로 다시 번역돼요</span>
            <button className="primary" disabled={!Object.values(newWords).some((x) => x.trim())} onClick={() => void addWords()}>
              사전에 추가
            </button>
          </div>
          <div className="tr-unknown-list">
            {unknownAll.map(([ko, n]) => (
              <label key={ko} className={`tr-word ${peek === ko ? 'on' : ''}`}>
                <button type="button" className="tr-ko tr-ko-btn" onClick={() => setPeek(peek === ko ? null : ko)} title="어느 제품명에서 나왔는지 보기">
                  {ko}
                </button>
                <span className="muted small">{n}줄</span>
                <input placeholder="영어" value={newWords[ko] ?? ''} onChange={(e) => setNewWords((w) => ({ ...w, [ko]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && void addWords()} />
              </label>
            ))}
          </div>
          {peek && (
            <div className="tr-peek">
              <div className="tr-peek-head">
                <b>'{peek}'</b> 가 나온 제품명 {peekRows.length}개
                <button className="icon-btn" onClick={() => setPeek(null)} aria-label="닫기">
                  ✕
                </button>
              </div>
              <ul>
                {peekRows.slice(0, 50).map((v) => (
                  <li key={v.row.r}>
                    <span className="muted small">{v.row.r + 1}줄</span> {mark(v.ko, peek)}
                    <span className="muted small"> → {v.tr.en}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sheet && (
        <div className="card tr-rows">
          <div className="tr-rows-head">
            <label className="check-line small">
              <input type="checkbox" checked={onlyTodo} onChange={(e) => setOnlyTodo(e.target.checked)} /> 빈 칸 있는 줄만
            </label>
            <span className="muted small">{shown.length}줄</span>
          </div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th>줄</th>
                  {sheet.col.code !== undefined && <th>코드</th>}
                  <th>제품명</th>
                  <th>영문 제품명</th>
                  {TARGETS.filter((t) => t.key !== 'enName' && sheet.col[t.key] !== undefined).map((t) => (
                    <th key={t.key}>{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((v) => {
                  const enEmpty = v.empty.includes('enName');
                  const en = enOf(v);
                  const left = /\[[^\]]+\]/.test(en);
                  return (
                    <tr key={v.row.r}>
                      <td className="muted">{v.row.r + 1}</td>
                      {sheet.col.code !== undefined && <td className="tr-code">{cell(v.row, 'code')}</td>}
                      <td className="tr-ko-name">{v.ko}</td>
                      <td className={`tr-en ${enEmpty ? (left ? 'part' : 'auto') : ''}`}>
                        {enEmpty ? (
                          <input value={en} onChange={(e) => setEdits((x) => ({ ...x, [v.row.r]: e.target.value }))} title={left ? '[ ] 안의 단어가 사전에 없어요' : '사전으로 자동 번역'} />
                        ) : (
                          cell(v.row, 'enName')
                        )}
                      </td>
                      {TARGETS.filter((t) => t.key !== 'enName' && sheet.col[t.key] !== undefined).map((t) => (
                        <td key={t.key} className={v.empty.includes(t.key) ? 'tr-empty' : ''}>
                          {cell(v.row, t.key) || '비어 있음'}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 500 && <p className="muted small">처음 500줄만 보여요 (받는 엑셀에는 전부 들어가요)</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function DictTab() {
  const { email, accountName } = useAccess();
  const { list } = useDictMap();
  const [q, setQ] = useState('');
  const [ko, setKo] = useState('');
  const [en, setEn] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editEn, setEditEn] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const nq = q.trim().toLowerCase();
  const shown = (list ?? []).filter((e) => !nq || e.ko.toLowerCase().includes(nq) || e.en.toLowerCase().includes(nq)).sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
  const add = async () => {
    if (!ko.trim() || !en.trim()) return;
    await saveDict([{ ko, en }], accountName ?? email);
    setKo('');
    setEn('');
  };
  // 엑셀로 한꺼번에: 첫 칸 한글 · 둘째 칸 영어
  const bulk = async (f: File) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const rows = aoa.map((r) => ({ ko: String(r[0] ?? '').trim(), en: String(r[1] ?? '').trim() })).filter((r) => /[가-힣]/.test(r.ko) && r.en);
    if (!rows.length) return setMsg('넣을 단어를 못 찾았어요 (첫 칸 한글, 둘째 칸 영어)');
    await saveDict(rows, accountName ?? email);
    setMsg(`${rows.length}개 단어를 사전에 넣었어요 ✓`);
  };
  return (
    <div className="card tr-dict">
      <div className="tr-dict-tools">
        <input className="search" placeholder="🔍 한글 · 영어로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{(list ?? []).length}개 단어</span>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && void bulk(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} title="첫 칸 한글, 둘째 칸 영어인 엑셀">
          📥 엑셀로 한꺼번에 넣기
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
      <div className="tr-dict-add">
        <input placeholder="한글 (예: 스티커)" value={ko} onChange={(e) => setKo(e.target.value)} />
        <span>→</span>
        <input placeholder="영어 (예: Sticker)" value={en} onChange={(e) => setEn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <button className="primary" disabled={!ko.trim() || !en.trim()} onClick={() => void add()}>
          추가
        </button>
      </div>
      {list === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : (
        <table className="tr-table tr-dict-table">
          <thead>
            <tr>
              <th>한글</th>
              <th>영어</th>
              <th>넣은 사람</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((e: DictEntry) => (
              <tr key={e.id}>
                <td className="tr-ko">{e.ko}</td>
                <td>
                  {editing === e.id ? (
                    <input
                      autoFocus
                      value={editEn}
                      onChange={(x) => setEditEn(x.target.value)}
                      onBlur={() => {
                        if (editEn.trim() && editEn.trim() !== e.en) void saveDict([{ ko: e.ko, en: editEn }], accountName ?? email);
                        setEditing(null);
                      }}
                      onKeyDown={(x) => x.key === 'Enter' && (x.target as HTMLInputElement).blur()}
                    />
                  ) : (
                    <button
                      className="tr-en-btn"
                      onClick={() => {
                        setEditing(e.id);
                        setEditEn(e.en);
                      }}
                      title="눌러서 고치기"
                    >
                      {e.en}
                    </button>
                  )}
                </td>
                <td className="muted small">{e.by ?? ''}</td>
                <td>
                  <button className="icon-btn" title="지우기" onClick={() => confirm(`'${e.ko}' 를 사전에서 지울까요?`) && void deleteDict(e.id)}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr>
                <td colSpan={4} className="muted small">
                  {list.length ? '맞는 단어가 없어요.' : '아직 사전이 비어 있어요. 위에서 단어를 넣거나 엑셀로 한꺼번에 넣어 주세요.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
