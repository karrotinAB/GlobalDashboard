// 번역: [번역] 엑셀을 올리면 비어 있는 분류·영문 제품명을 찾아 사전으로 자동 번역 · 모르는 단어는 채워서 사전에 추가
//       [사전] 한글 → 영어 단어장 (모두 같이 씀, 계속 업데이트)
import { useNameOf } from '../components/AddressBook';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';

// 작업 중인 것 (올린 엑셀 · 고친 영문 · 고른 분류 · 채우던 단어)은 자동 저장:
//   다른 탭·페이지 = 메모리에 그대로, 새로고침·창 닫기 = 이 브라우저에 저장된 걸로 다시 (엑셀 파일은 IndexedDB)
const keep: Record<string, unknown> = {};
const LS = 'gd:translate:';
const NO_LS = new Set(['sheet']); // 엑셀 덩어리는 따로 (IndexedDB)
function useKept<T>(key: string, init: T): [T, Dispatch<SetStateAction<T>>] {
  const [v, setV] = useState<T>(() => {
    if (key in keep) return keep[key] as T;
    if (!NO_LS.has(key))
      try {
        const raw = localStorage.getItem(LS + key);
        if (raw !== null) return JSON.parse(raw) as T;
      } catch {
        /* 무시 */
      }
    return init;
  });
  useEffect(() => {
    keep[key] = v;
    if (!NO_LS.has(key))
      try {
        localStorage.setItem(LS + key, JSON.stringify(v));
      } catch {
        /* 저장 공간이 모자라면 메모리에만 */
      }
  }, [key, v]);
  return [v, setV];
}

// 올린 엑셀 파일 원본을 브라우저(IndexedDB)에 저장 · 다시 꺼내기
const idb = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('gd-translate', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
async function saveFile(name: string, buf: ArrayBuffer) {
  try {
    const db = await idb();
    db.transaction('files', 'readwrite').objectStore('files').put({ name, buf, at: Date.now() }, 'last');
  } catch {
    /* 저장 못 해도 작업은 계속 */
  }
}
async function loadFile(): Promise<{ name: string; buf: ArrayBuffer } | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const g = db.transaction('files').objectStore('files').get('last');
      g.onsuccess = () => res((g.result as { name: string; buf: ArrayBuffer }) ?? null);
      g.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}
import { useAccess } from '../components/AuthGate';
import { deleteDict, isPattern, saveDict, translate, useDict, type DictEntry } from '../lib/dict';
import { catKey, catLabel, makeRecommender, saveCategories, savePicks, deletePicks, useCatPicks, useCategories, type Cat } from '../lib/categories';

type Tab = 'translate' | 'dict' | 'cats';

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
const PAGE = 100; // 표는 100줄씩
const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();
/** 머리줄 칸 이름 → 어떤 칸인지 (비슷하면 찾음: [F9]수출 대분류 · 수출 대분류명 · 영어 제품명 …) */
const classify = (raw: unknown): TKey | 'koName' | 'code' | 'season' | null => {
  const h = norm(raw).replace(/\[[^\]]*\]|\([^)]*\)|[*:·]/g, '');
  if (!h) return null;
  if (/시즌/.test(h)) return 'season'; // 시즌품구분 (00 비시즌품 / 01 시즌품)
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
  col: Partial<Record<TKey | 'koName' | 'code' | 'season', number>>;
  rows: { r: number; cells: unknown[] }[]; // 데이터 줄 (엑셀 줄 번호 r: 0부터)
  wb: unknown; // 원본 (내려받을 때 채워 넣음)
}

export default function Translate() {
  const [tab, setTab] = useKept<Tab>('tab', 'translate');
  return (
    <div className="page">
      <div className="page-head">
        <h1>제품번역</h1>
        <p className="muted">엑셀을 올리면 비어 있는 분류·영문 제품명을 찾아서 사전으로 자동 번역해요. 모르는 단어는 채워 넣으면 사전에 저장돼서 다음부터 자동으로 들어가요.</p>
      </div>
      <div className="seg tr-tabs">
        <button className={tab === 'translate' ? 'on' : ''} onClick={() => setTab('translate')}>
          📄 번역
        </button>
        <button className={tab === 'dict' ? 'on' : ''} onClick={() => setTab('dict')}>
          📖 사전
        </button>
        <button className={tab === 'cats' ? 'on' : ''} onClick={() => setTab('cats')}>
          🗂 분류
        </button>
      </div>
      {tab === 'translate' ? <TranslateTab /> : tab === 'dict' ? <DictTab /> : <CatsTab />}
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
  const { email, accountName, role } = useAccess();
  const isAdmin = role === 'admin' || role === null; // 관리자 (로컬 모드 포함)
  const { list, map, keys } = useDictMap();
  const [sheet, setSheet] = useKept<Sheet | null>('sheet', null);
  const [err, setErr] = useState('');
  const [edits, setEdits] = useKept<Record<number, string>>('edits', {}); // 줄 → 직접 고친 영문 제품명
  const [keepParen, setKeepParen] = useKept<Record<number, string[]>>('keepParen', {}); // 줄 → 빼지 말고 번역할 괄호
  // '사전에 없는 단어'에서 ✕ 로 뺀 단어: 번역하지 않음 (영문 제품명에서 빠짐)
  const [hidden, setHidden] = useKept<string[]>('hiddenWords', []);
  const [onlyTodo, setOnlyTodo] = useKept('onlyTodo', true);
  const [page0, setPage] = useKept('page', 0);
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  useEffect(() => {
    if (sheet) return;
    setRestoring(true);
    void loadFile()
      .then((f) => f && load({ name: f.name, arrayBuffer: async () => f.buf }, false))
      .finally(() => setRestoring(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // fresh = 새로 올린 파일 (고친 것·고른 분류 비움) / 아니면 저장해 둔 파일 다시 열기 (그대로 둠)
  const load = async (f: { name: string; arrayBuffer: () => Promise<ArrayBuffer> }, fresh = true) => {
    setErr('');
    try {
      const XLSX = await import('xlsx');
      const buf = await f.arrayBuffer();
      if (fresh) void saveFile(f.name, buf.slice(0));
      const wb = XLSX.read(buf, { type: 'array' });
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
          if (fresh) {
            setEdits({});
            setKeepParen({});
            setCodePre('');
            setSeasonF('');
            setCatSel({});
            setPage(0);
          }
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
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const view = useMemo(() => {
    if (!sheet) return [];
    return sheet.rows.map((row) => {
      const empty = TARGETS.filter((t) => sheet.col[t.key] !== undefined && !cell(row, t.key)).map((t) => t.key);
      const ko = cell(row, 'koName');
      // 영어로 옮길 땐 ( ) 괄호와 그 안 내용은 빼고 번역 (한글 제품명은 그대로, 뺀 부분은 화면에 표시)
      //   노란 부분을 누르면 살려서 같이 번역 (keepParen)
      const kept = keepParen[row.r] ?? [];
      const parens: string[] = ko.match(/\([^()]*\)|（[^（）]*）/g) ?? [];
      const cut = parens.filter((x) => !kept.includes(x));
      const koEn = cut.length ? ko.replace(/\([^()]*\)|（[^（）]*）/g, (m) => (kept.includes(m) ? m : ' ')).replace(/\s{2,}/g, ' ').trim() : ko;
      const tr0 = koEn ? translate(koEn, map, keys) : { en: '', unknown: [] as string[], pieces: [] };
      // 뺀 단어는 영문에서 지움 ([호] → 없음)
      const skipped = tr0.unknown.filter((u) => hiddenSet.has(u));
      const en = skipped.length ? skipped.reduce((a, w) => a.split(`[${w}]`).join(''), tr0.en).replace(/\s{2,}/g, ' ').replace(/\s+([)\],.])/g, '$1').trim() : tr0.en;
      const tr = { ...tr0, en, unknown: tr0.unknown.filter((u) => !hiddenSet.has(u)), skipped };
      // 시즌품구분: '01 시즌품' → S, '00 비시즌품' → N
      const sv = cell(row, 'season');
      const season: 'S' | 'N' | undefined = /비시즌/.test(sv) ? 'N' : /시즌/.test(sv) ? 'S' : undefined;
      return { row, empty, ko, tr, cut, parens, season };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, map, keys, keepParen, hiddenSet]);
  // 괄호 살리기/다시 빼기 (그 줄에 직접 고친 영문은 지우고 새로 번역)
  const toggleParen = (r: number, part: string) => {
    setKeepParen((x) => {
      const cur = x[r] ?? [];
      const next = cur.includes(part) ? cur.filter((y) => y !== part) : [...cur, part];
      const o = { ...x };
      if (next.length) o[r] = next;
      else delete o[r];
      return o;
    });
    setEdits((x) => {
      if (!(r in x)) return x;
      const o = { ...x };
      delete o[r];
      return o;
    });
  };
  const todo = useMemo(() => view.filter((v) => v.empty.length), [view]);
  // 표 검색: 제품명 · 코드 · 영문 제품명 (띄어 쓰면 모두 들어간 것만)
  const [rowQ, setRowQ] = useKept('rowQ', '');
  const [codePre, setCodePre] = useKept('codePre', ''); // 제품코드 앞 2자리
  const [seasonF, setSeasonF] = useKept<'' | 'S' | 'N'>('seasonF', ''); // 시즌품만 / 비시즌품만
  const codePres = useMemo(() => {
    const c = new Map<string, number>();
    for (const v of onlyTodo ? todo : view) {
      const code = cell(v.row, 'code');
      if (code.length >= 2) c.set(code.slice(0, 2), (c.get(code.slice(0, 2)) ?? 0) + 1);
    }
    return [...c.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyTodo, todo, view]);
  const shown = useMemo(() => {
    const base0 = onlyTodo ? todo : view;
    const base1 = codePre ? base0.filter((v) => cell(v.row, 'code').startsWith(codePre)) : base0;
    const base = seasonF ? base1.filter((v) => v.season === seasonF) : base1;
    const words = rowQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return base;
    return base.filter((v) => {
      const h = `${v.ko} ${cell(v.row, 'code')} ${cell(v.row, 'enName')} ${v.tr.en}`.toLowerCase();
      return words.every((w) => h.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyTodo, todo, view, rowQ, codePre, seasonF]);
  const page = Math.min(page0, Math.max(0, Math.ceil(shown.length / PAGE) - 1));
  const needEn = useMemo(() => todo.filter((v) => v.empty.includes('enName')), [todo]);
  const unknownAll = useMemo(() => {
    const c = new Map<string, number>();
    // 뺀 단어도 세어 둠 (뺀 단어 보기에서 다시 살릴 수 있게)
    for (const v of needEn) for (const u of [...v.tr.unknown, ...v.tr.skipped]) c.set(u, (c.get(u) ?? 0) + 1);
    // 긴 단어부터 (짧은 단어를 먼저 넣으면 '러기지'가 '러기'+'지' 로 잘못 끊길 수 있어서) · 같은 길이는 많이 나온 순
    return [...c.entries()].sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);
  }, [needEn]);
  const enOf = (v: (typeof view)[number]) => edits[v.row.r] ?? v.tr.en;

  // 수출 분류: 분류표 · 고른 기록 · 이 파일에서 이미 채워진 줄로 추천
  const { rows: cats } = useCategories();
  const picks = useCatPicks();
  const catByKey = useMemo(() => new Map((cats ?? []).map((c) => [catKey(c), c])), [cats]);
  const catGroups = useMemo(() => {
    const g = new Map<string, Cat[]>();
    for (const c of cats ?? []) g.set(`${c.mainCode} ${c.mainName}`, [...(g.get(`${c.mainCode} ${c.mainName}`) ?? []), c]);
    return [...g.entries()];
  }, [cats]);
  const catCols = TARGETS.filter((t) => t.key !== 'enName' && sheet?.col[t.key] !== undefined);
  const recommend = useMemo(() => {
    const inFile = view
      .filter((v) => v.ko && cell(v.row, 'mainCode') && cell(v.row, 'subCode'))
      .map((v) => ({ ko: v.ko, cat: `${cell(v.row, 'mainCode')}-${cell(v.row, 'subCode')}`, season: v.season }));
    return makeRecommender([...inFile, ...picks.map((p) => ({ ko: p.ko, cat: p.cat, season: p.season }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, picks]);
  const [catSel, setCatSel] = useKept<Record<number, string>>('catSel', {}); // 줄 → 고른 분류
  const needCat = (v: (typeof view)[number]) => catCols.some((t) => v.empty.includes(t.key));
  const sugCache = useMemo(() => new Map<number, ReturnType<typeof recommend>>(), [recommend]);
  const sugOf = (v: (typeof view)[number]) => {
    if (!v.ko || !needCat(v)) return null;
    if (!sugCache.has(v.row.r)) sugCache.set(v.row.r, recommend(v.ko, v.season));
    return sugCache.get(v.row.r)!;
  };
  // 같은 제품명으로 고른 적 있으면 바로 그 분류
  const chosen = (v: (typeof view)[number]) => {
    if (catSel[v.row.r] !== undefined) return catSel[v.row.r];
    const sg = sugOf(v);
    return sg?.exact && catByKey.has(sg.cat) ? sg.cat : '';
  };
  const pickCat = (v: (typeof view)[number], key: string) => {
    setCatSel((x) => ({ ...x, [v.row.r]: key }));
    if (key && v.ko) void savePicks([{ ko: v.ko, cat: key, season: v.season }], accountName ?? email);
  };
  // 자동 적용 초기화: 지금 보고 있는 페이지(검색 결과 · 이 페이지) 줄만 — 고른 분류 비우고 그 제품명들의 고른 기록도 지움
  const resetAuto = async () => {
    const vis = shown.slice(page * PAGE, page * PAGE + PAGE).filter((v) => needCat(v));
    if (!vis.length) return;
    if (!confirm(`지금 보고 있는 페이지 ${vis.length}줄의 분류를 비우고, 그 제품명들의 고른 기록도 지울까요?\n(다른 페이지는 그대로예요)`)) return;
    try {
      await deletePicks(vis.map((v) => v.ko).filter(Boolean));
      setCatSel((x) => {
        const o = { ...x };
        for (const v of vis) o[v.row.r] = ''; // 자동 적용(같은 제품명)도 다시 안 들어가게 빈칸으로
        return o;
      });
    } catch (e) {
      alert(`지우지 못했어요: ${(e as Error).message}`);
    }
  };
  const applyAllSuggestions = () => {
    const next: Record<number, string> = {};
    const save: { ko: string; cat: string; season?: 'S' | 'N' }[] = [];
    // 지금 보고 있는 쪽(검색 결과 · 페이지)에 보이는 줄에만
    for (const v of shown.slice(page * PAGE, page * PAGE + PAGE)) {
      if (!needCat(v) || chosen(v)) continue;
      const sg = sugOf(v);
      if (sg && catByKey.has(sg.cat)) {
        next[v.row.r] = sg.cat;
        save.push({ ko: v.ko, cat: sg.cat, season: v.season });
      }
    }
    setCatSel((x) => ({ ...x, ...next }));
    if (save.length) void savePicks(save, accountName ?? email);
  };
  const catValue = (c: Cat, k: string) => (k === 'mainCode' ? c.mainCode : k === 'mainName' ? c.mainName : k === 'mainEn' ? c.mainEn : k === 'subCode' ? c.subCode : k === 'subName' ? c.subName : k === 'subEn' ? c.subEn : '');


  // all: 관리자만 — 모르는 단어 [ ] 가 남은 영문 제품명도 그대로 채워서 받기
  const download = async (all = false) => {
    if (!sheet) return;
    const XLSX = await import('xlsx');
    const wb = sheet.wb as import('xlsx').WorkBook;
    const ws = wb.Sheets[sheet.sheetName];
    const c = sheet.col.enName;
    let n = 0;
    if (c !== undefined)
      for (const v of needEn) {
        const en = enOf(v);
        if (!en || (!all && /\[[^\]]+\]/.test(en))) continue; // 모르는 단어가 남은 건 비워 둠 (관리자 '덜 된 것도' 는 그대로)
        ws[XLSX.utils.encode_cell({ r: v.row.r, c })] = { t: 's', v: en };
        n++;
      }
    // 고른 수출 분류: 빈 칸만 채움 (코드는 글자로 — 01 의 0 이 안 없어지게)
    let nc = 0;
    let maxC = c ?? 0;
    for (const v of todo) {
      const cat = catByKey.get(chosen(v));
      if (!cat) continue;
      for (const t of catCols) {
        if (!v.empty.includes(t.key)) continue;
        const col = sheet.col[t.key]!;
        ws[XLSX.utils.encode_cell({ r: v.row.r, c: col })] = { t: 's', v: catValue(cat, t.key) };
        maxC = Math.max(maxC, col);
      }
      nc++;
    }
    const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1');
    if (range.e.c < maxC) range.e.c = maxC;
    ws['!ref'] = XLSX.utils.encode_range(range);
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const url = URL.createObjectURL(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = sheet.fileName.replace(/(\.xlsx?|\.csv)?$/i, '_번역.xlsx');
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    alert(all ? `영문 제품명 ${n}줄(모르는 단어 [ ] 가 남은 것 포함) · 수출 분류 ${nc}줄을 채워서 받았어요.` : `영문 제품명 ${n}줄 · 수출 분류 ${nc}줄을 채워서 받았어요. (모르는 단어가 남은 영문 제품명, 분류를 안 고른 줄은 비워 뒀어요)`);
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
            <span className="tr-saved" title="고친 것·고른 분류는 이 브라우저에 자동 저장돼요 (새로고침해도 그대로)">💾 자동 저장</span> {sheet.fileName} · {sheet.sheetName} · 전체 {sheet.rows.length}줄 중 <b>빈 칸 있는 줄 {todo.length}</b> · 영문 제품명 빈 줄 {needEn.length}
            {sheet.col.koName === undefined && ' · ⚠ 한글 제품명 칸을 못 찾아서 자동 번역은 안 돼요'}
          </span>
        ) : (
          <span className="muted small">{restoring ? '저장해 둔 작업 불러오는 중… · ' : ''}찾는 칸: {TARGETS.map((t) => t.label).join(' · ')} (+ 한글 제품명)</span>
        )}
        {sheet && (
          <button className="tr-dl" onClick={() => void download()}>
            ⬇ 채운 엑셀 받기
          </button>
        )}
        {sheet && isAdmin && (
          <button className="tr-dl tr-dl-all" onClick={() => void download(true)} title="관리자만: 모르는 단어가 [ ] 로 남은 영문 제품명도 그대로 채워서 받아요">
            ⬇ 덜 된 것도 받기
          </button>
        )}
      </div>
      {err && <p className="warn small">{err}</p>}
      {list === null && <p className="muted small">사전 불러오는 중…</p>}

      {sheet && unknownAll.length > 0 && <UnknownWords words={unknownAll} hidden={hidden} setHidden={setHidden} rowsOf={(w) => needEn.filter((v) => v.tr.unknown.includes(w) || v.tr.skipped.includes(w)).map((v) => ({ r: v.row.r, ko: v.ko, en: v.tr.en }))} />}

      {sheet && (
        <div className="card tr-rows">
          <div className="tr-rows-head">
            <label className="check-line small">
              <input type="checkbox" checked={onlyTodo} onChange={(e) => (setOnlyTodo(e.target.checked), setPage(0))} /> 빈 칸 있는 줄만
            </label>
            <input className="search tr-row-q" placeholder="🔍 제품명 · 코드로 찾기" value={rowQ} onChange={(e) => (setRowQ(e.target.value), setPage(0))} />
            {sheet.col.code !== undefined && codePres.length > 0 && (
              <select className={`tr-code-pre ${codePre ? 'set' : ''}`} value={codePre} onChange={(e) => (setCodePre(e.target.value), setPage(0))} title="제품코드 앞 2자리로 거르기">
                <option value="">코드 앞자리 전체</option>
                {codePres.map(([k, n]) => (
                  <option key={k} value={k}>
                    {k}… ({n}줄)
                  </option>
                ))}
                {codePre && !codePres.some(([k]) => k === codePre) && <option value={codePre}>{codePre}… (0줄)</option>}
              </select>
            )}
            {sheet.col.season !== undefined && (
              <select className={`tr-code-pre ${seasonF ? 'set' : ''}`} value={seasonF} onChange={(e) => (setSeasonF(e.target.value as '' | 'S' | 'N'), setPage(0))} title="시즌품구분으로 거르기">
                <option value="">시즌 전체</option>
                <option value="S">🎄 시즌품만 ({view.filter((v) => v.season === 'S').length})</option>
                <option value="N">비시즌품만</option>
              </select>
            )}
            <span className="muted small">{shown.length}줄</span>
            {catCols.length > 0 && !!cats?.length && (
              <button className="tr-sug-all" onClick={applyAllSuggestions} title="지금 화면에 보이는 줄(검색 결과 · 이 페이지)에만 추천 분류를 한꺼번에 넣어요 (고른 기록에도 남음)">
                ✨ 이 페이지 추천 분류 넣기
              </button>
            )}
            {catCols.length > 0 && (
              <button className="tr-reset" onClick={resetAuto} title="지금 보고 있는 페이지(검색 결과 · 이 페이지) 줄의 분류만 비우고, 그 제품명들의 고른 기록도 지워요. 다른 페이지는 그대로예요.">
                ↺ 이 페이지 초기화
              </button>
            )}
            {catCols.length > 0 && !cats?.length && <span className="warn small">분류 탭에서 분류표 엑셀을 먼저 올려 주세요</span>}
          </div>
          <div className="tr-table-wrap">
            <table className="tr-table">
              <thead>
                <tr>
                  <th>줄</th>
                  {sheet.col.code !== undefined && <th>코드</th>}
                  <th>제품명</th>
                  <th>영문 제품명</th>
                  {catCols.length > 0 && <th>수출 분류 고르기</th>}
                  {catCols.map((t) => (
                    <th key={t.key}>{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((v) => {
                  const enEmpty = v.empty.includes('enName');
                  const en = enOf(v);
                  const left = /\[[^\]]+\]/.test(en);
                  return (
                    <tr key={v.row.r}>
                      <td className="muted">{v.row.r + 1}</td>
                      {sheet.col.code !== undefined && <td className="tr-code">{cell(v.row, 'code')}</td>}
                      <td className="tr-ko-name">
                        {v.season === 'S' && (
                          <span className="tr-season" title="시즌품 (엑셀 시즌품구분)">
                            🎄 시즌
                          </span>
                        )}
                        {v.parens.length
                          ? v.ko.split(/(\([^()]*\)|（[^（）]*）)/).map((part, i) =>
                              v.parens.includes(part) ? (
                                <mark
                                  key={i}
                                  className={v.cut.includes(part) ? 'tr-cut' : 'tr-cut kept'}
                                  title={v.cut.includes(part) ? '영문 번역에서 뺀 부분 — 누르면 살려서 같이 번역해요' : '같이 번역 중 — 누르면 다시 빼요'}
                                  onClick={() => toggleParen(v.row.r, part)}
                                >
                                  {part}
                                </mark>
                              ) : (
                                part
                              ),
                            )
                          : v.ko}
                      </td>
                      <td className={`tr-en ${enEmpty ? (left ? 'part' : 'auto') : ''}`}>
                        {enEmpty ? (
                          <input value={en} onChange={(e) => setEdits((x) => ({ ...x, [v.row.r]: e.target.value }))} title={left ? '[ ] 안의 단어가 사전에 없어요' : '사전으로 자동 번역'} />
                        ) : (
                          cell(v.row, 'enName')
                        )}
                      </td>
                      {catCols.length > 0 && (
                        <td className="tr-cat">
                          {needCat(v) ? (
                            (() => {
                              const val = chosen(v);
                              const sg = !val ? sugOf(v) : null;
                              const sc = sg && catByKey.get(sg.cat);
                              return (
                                <>
                                  <CatPicker value={val} cur={catByKey.get(val)} groups={catGroups} disabled={!cats?.length} onPick={(k) => pickCat(v, k)} />
                                  {sc && (
                                    <button className="tr-sug" onClick={() => pickCat(v, sg!.cat)} title={`비슷한 제품: ${sg!.like}`}>
                                      추천: {catLabel(sc)} <span className="muted">· 비슷: {sg!.like.length > 18 ? `${sg!.like.slice(0, 18)}…` : sg!.like}</span>
                                    </button>
                                  )}
                                </>
                              );
                            })()
                          ) : (
                            <span className="muted small">채워져 있음</span>
                          )}
                        </td>
                      )}
                      {catCols.map((t) => {
                        const cat = v.empty.includes(t.key) ? catByKey.get(chosen(v)) : undefined;
                        return (
                          <td key={t.key} className={v.empty.includes(t.key) ? (cat ? 'tr-filled' : 'tr-empty') : ''}>
                            {cat ? catValue(cat, t.key) : cell(v.row, t.key) || '비어 있음'}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > PAGE && (
              <div className="tr-pager">
                <button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  ◀
                </button>
                <span className="small">
                  {page * PAGE + 1}–{Math.min(shown.length, (page + 1) * PAGE)} / {shown.length}줄
                </span>
                <button disabled={(page + 1) * PAGE >= shown.length} onClick={() => setPage(page + 1)}>
                  ▶
                </button>
                <span className="muted small">(받는 엑셀에는 전부 들어가요)</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DictTab() {
  const { email, accountName } = useAccess();
  const nameOf = useNameOf(); // 넣은 사람: 이메일 대신 이름 두 글자
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
      <p className="muted small" style={{ marginTop: 0 }}>
        숫자가 들어간 단어는 <b>틀</b>로 번역해요. 예: <code>0호0합</code> → <code>No.0 0-Ply</code> 로 넣으면 3호5합 → No.3 5-Ply, 12호 2합 → No.12 2-Ply (숫자는 차례대로 옮겨져요)
      </p>
      <div className="tr-dict-add">
        <input placeholder="한글 (예: 스티커 · 0호0합)" value={ko} onChange={(e) => setKo(e.target.value)} />
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
                <td className="tr-ko">
                  {e.ko}
                  {isPattern(e.ko) && <span className="tag small tr-pat">틀</span>}
                </td>
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
                <td className="muted small">{e.by ? (e.by.includes('@') ? nameOf(e.by) : nameOf(undefined, e.by)) : ''}</td>
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

/** 분류 탭: 수출 대분류·중분류 표 (엑셀로 올림) + 고른 기록 수 */
function CatsTab() {
  const { email, accountName } = useAccess();
  const { rows, meta } = useCategories();
  const picks = useCatPicks();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const upload = async (f: File) => {
    setMsg('');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false });
      // 머리줄: '대분류' · '중분류' 가 들어간 칸
      let h = -1;
      const col: Record<string, number> = {};
      for (let i = 0; i < Math.min(aoa.length, 10) && h < 0; i++) {
        const hs = (aoa[i] ?? []).map((x) => norm(x));
        const find = (lv: string, kind: 'code' | 'name' | 'en') =>
          hs.findIndex((x) => x.includes(lv) && (kind === 'en' ? /영문|영어|eng/.test(x) : kind === 'code' ? /코드|code/.test(x) : /명$|name$/.test(x) && !/영문|영어|eng/.test(x)));
        const m = { mainCode: find('대분류', 'code'), mainName: find('대분류', 'name'), mainEn: find('대분류', 'en'), subCode: find('중분류', 'code'), subName: find('중분류', 'name'), subEn: find('중분류', 'en') };
        if (m.mainCode >= 0 && m.subCode >= 0 && m.subName >= 0) {
          h = i;
          Object.assign(col, m);
        }
      }
      if (h < 0) return setMsg("머리줄에서 '대분류코드' · '중분류코드' · '중분류명' 칸을 못 찾았어요.");
      const get = (r: unknown[], k: string) => (col[k] >= 0 ? String(r[col[k]] ?? '').trim() : '');
      const list: Cat[] = aoa
        .slice(h + 1)
        .map((r) => ({ mainCode: get(r, 'mainCode'), mainName: get(r, 'mainName'), mainEn: get(r, 'mainEn'), subCode: get(r, 'subCode'), subName: get(r, 'subName'), subEn: get(r, 'subEn') }))
        .filter((c) => /^\d+$/.test(c.mainCode) && /^\d+$/.test(c.subCode)); // 영어 머리줄 같은 건 빼고
      if (!list.length) return setMsg('분류 줄을 못 찾았어요.');
      await saveCategories(list, accountName ?? email);
      setMsg(`분류 ${list.length}개를 저장했어요 ✓ (대분류 ${new Set(list.map((c) => c.mainCode)).size}개)`);
    } catch (e) {
      setMsg(`엑셀을 못 읽었어요: ${(e as Error).message}`);
    }
  };
  const nq = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((c) => !nq || `${c.mainName} ${c.mainEn} ${c.subName} ${c.subEn} ${c.mainCode}-${c.subCode}`.toLowerCase().includes(nq));
  const pickCount = (k: string) => picks.filter((p) => p.cat === k).length;
  return (
    <div className="card tr-dict">
      <div className="tr-dict-tools">
        <input className="search" placeholder="🔍 분류 이름 · 영문 · 코드" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">
          {(rows ?? []).length}개 분류 · 고른 기록 {picks.length}개{meta.at ? ` · 올린 날 ${new Date(meta.at).toLocaleDateString('ko-KR')}` : ''}
        </span>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <button className="primary" onClick={() => fileRef.current?.click()} title="대분류코드 · 대분류명 · 대분류 영문명 · 중분류코드 · 중분류명 · 중분류 영문명">
          📤 분류표 엑셀 올리기
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        올리면 전체가 새 분류표로 바뀌어요. 번역 탭에서 줄마다 분류를 고르면 기록이 남고, 다음에 비슷한 제품명이 나오면 그 분류를 추천해요.
      </p>
      {msg && <p className="small">{msg}</p>}
      {rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : !rows.length ? (
        <p className="muted small">아직 분류표가 없어요. [분류표 엑셀 올리기]로 넣어 주세요.</p>
      ) : (
        <div className="tr-table-wrap">
          <table className="tr-table">
            <thead>
              <tr>
                <th>대분류</th>
                <th>대분류명</th>
                <th>대분류 영문명</th>
                <th>중분류</th>
                <th>중분류명</th>
                <th>중분류 영문명</th>
                <th>고른 횟수</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={catKey(c)}>
                  <td className="tr-code">{c.mainCode}</td>
                  <td>{c.mainName}</td>
                  <td className="muted">{c.mainEn}</td>
                  <td className="tr-code">{c.subCode}</td>
                  <td>
                    <b>{c.subName}</b>
                  </td>
                  <td className="muted">{c.subEn}</td>
                  <td className="muted small">{pickCount(catKey(c)) || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 사전에 없는 단어: 많이 나온 순 · 찾기 · 80개씩 더 보기. 채운 것만 사전에 저장 (입력해도 표는 다시 안 그림) */
function UnknownWords({
  words,
  rowsOf,
  hidden,
  setHidden,
}: {
  words: [string, number][];
  rowsOf: (w: string) => { r: number; ko: string; en: string }[];
  hidden: string[];
  setHidden: Dispatch<SetStateAction<string[]>>;
}) {
  const { email, accountName } = useAccess();
  const [newWords, setNewWords] = useKept<Record<string, string>>('newWords', {});
  const [saveMsg, setSaveMsg] = useState('');
  const [q, setQ] = useState('');
  const [more, setMore] = useState(1);
  const [peek, setPeek] = useState<string | null>(null);
  // ✕ 로 뺀 단어 = 번역하지 않는 단어 (영문 제품명에서 빠짐 · 뺀 단어 보기에서 다시 살릴 수 있음)
  const [showHidden, setShowHidden] = useState(false);
  const STEP = 80;
  const nq = q.trim();
  const list = (showHidden ? words.filter(([w]) => hidden.includes(w)) : words.filter(([w]) => !hidden.includes(w))).filter(([w]) => !nq || w.includes(nq));
  const filled = Object.values(newWords).filter((x) => x.trim()).length;
  const addWords = async () => {
    const items = Object.entries(newWords)
      .filter(([, en]) => en.trim())
      .map(([ko, en]) => ({ ko, en }));
    if (!items.length) return;
    try {
      await saveDict(items, accountName ?? email);
      setNewWords((w) => Object.fromEntries(Object.entries(w).filter(([k]) => !items.some((x) => x.ko === k))));
      setSaveMsg(`${items.length}개 단어를 사전에 넣었어요 ✓`);
    } catch (e) {
      setSaveMsg(`사전에 못 넣었어요: ${(e as Error).message} (서버 규칙을 새로 올렸는지 확인 — deploy.bat)`);
    }
    window.setTimeout(() => setSaveMsg(''), 4000);
  };
  const peekRows = peek ? rowsOf(peek) : [];
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
  return (
    <div className="card tr-unknown">
      <div className="tr-unknown-head">
        <b>사전에 없는 단어 {words.length - hidden.filter((h) => words.some(([w]) => w === h)).length}개</b>
        {hidden.length > 0 && (
          <button className="link small" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? '← 목록으로' : `뺀 단어 ${hidden.length}개 보기`}
          </button>
        )}
        <input className="search tr-unknown-q" placeholder="🔍 단어 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">아는 단어만 채워도 돼요 — 채운 것만 사전에 들어가고 바로 다시 번역돼요</span>
        {saveMsg && <span className="small tr-save-msg">{saveMsg}</span>}
        <button className="primary" disabled={!filled} onClick={() => void addWords()}>
          사전에 추가{filled ? ` (${filled})` : ''}
        </button>
      </div>
      <div className="tr-unknown-list">
        {list.slice(0, STEP * more).map(([ko, n]) => (
          <label key={ko} className={`tr-word ${peek === ko ? 'on' : ''}`}>
            <button type="button" className="tr-ko tr-ko-btn" onClick={() => setPeek(peek === ko ? null : ko)} title="어느 제품명에서 나왔는지 보기">
              {ko}
            </button>
            <span className="muted small">{n}줄</span>
            <input placeholder="영어" value={newWords[ko] ?? ''} onChange={(e) => setNewWords((w) => ({ ...w, [ko]: e.target.value }))} onKeyDown={(e) => e.key === 'Enter' && void addWords()} />
            <button
              type="button"
              className="icon-btn tr-word-x"
              title={showHidden ? '다시 번역하기 (목록에 다시 넣기)' : '이 단어는 번역 안 함 (영문 제품명에서 빠져요)'}
              onClick={(e) => {
                e.preventDefault();
                setHidden((h) => (showHidden ? h.filter((x) => x !== ko) : [...h, ko]));
              }}
            >
              {showHidden ? '↩' : '✕'}
            </button>
          </label>
        ))}
      </div>
      {list.length > STEP * more && (
        <button className="link small tr-more" onClick={() => setMore(more + 1)}>
          더 보기 ({list.length - STEP * more}개 더)
        </button>
      )}
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
              <li key={v.r}>
                <span className="muted small">{v.r + 1}줄</span> {mark(v.ko, peek)}
                <span className="muted small"> → {v.en}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 수출 분류 고르기: 고르기 상자 모양 그대로, 열면 맨 위에 검색칸 (코드 · 대분류 · 중분류 · 영문) */
function CatPicker({ value, cur, groups, disabled, onPick }: { value: string; cur?: Cat; groups: [string, Cat[]][]; disabled: boolean; onPick: (k: string) => void }) {
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const [q, setQ] = useState('');
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const close = () => (setPos(null), setQ(''));
  useEffect(() => {
    if (!pos) return;
    const down = (e: MouseEvent) => !pop.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node) && close();
    const scroll = (e: Event) => !pop.current?.contains(e.target as Node) && close();
    document.addEventListener('mousedown', down);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', down);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  // 고른 분류가 보이게 스크롤
  useEffect(() => {
    if (pos) pop.current?.querySelector('.cat-opt.on')?.scrollIntoView({ block: 'center' });
  }, [pos]);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (c: Cat) => {
    const h = `${c.mainCode} ${c.mainName} ${c.mainEn} ${c.subCode} ${c.subName} ${c.subEn} ${catKey(c)}`.toLowerCase();
    return words.every((w) => h.includes(w));
  };
  const list = groups.map(([g, l]) => [g, words.length ? l.filter(hit) : l] as const).filter(([, l]) => l.length);
  const pick = (k: string) => {
    onPick(k);
    close();
  };
  const openIt = () => {
    if (pos) return close();
    const r = btn.current!.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 360 && r.top > window.innerHeight - r.bottom;
    setPos({ left: r.left, top: up ? r.top : r.bottom, width: Math.max(r.width, 240), up });
  };
  return (
    <div className="cat-pick">
      <button ref={btn} type="button" className={`cat-pick-btn ${value ? 'set' : ''}`} disabled={disabled} title={disabled ? '분류 탭에서 분류표를 먼저 올려 주세요' : ''} onClick={openIt}>
        <span>{cur ? catLabel(cur) : disabled ? '분류표 없음' : '분류 고르기'}</span>
        <span className="cat-caret">⌄</span>
      </button>
      {pos && (
        <div
          ref={pop}
          className={`cat-pop ${pos.up ? 'up' : ''}`}
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: window.innerHeight - pos.top + 2 } : { top: pos.top + 2 }) }}
        >
          <input
            autoFocus
            className="cat-q"
            placeholder="🔍 분류 찾기"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'Enter' && list[0]?.[1][0]) pick(catKey(list[0][1][0]));
            }}
          />
          <div className="cat-pop-list">
            {!words.length && (
              <button className={`cat-opt none ${!value ? 'on' : ''}`} onClick={() => pick('')}>
                분류 고르기
              </button>
            )}
            {list.map(([g, l]) => (
              <div key={g}>
                <div className="cat-grp">{g}</div>
                {l.map((c) => (
                  <button key={catKey(c)} className={`cat-opt ${catKey(c) === value ? 'on' : ''}`} onClick={() => pick(catKey(c))}>
                    {catLabel(c)}
                  </button>
                ))}
              </div>
            ))}
            {!list.length && <div className="cat-empty">맞는 분류가 없어요</div>}
          </div>
        </div>
      )}
    </div>
  );
}
