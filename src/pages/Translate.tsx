// 번역: [번역] 회사 API 에서 수출 분류 · 영문 제품명이 빈 제품을 불러와 (모두가 같이 봄) 사전으로 자동 번역 · 모르는 단어는 채워서 사전에 추가
//       [사전] 한글 → 영어 단어장 (모두 같이 씀, 계속 업데이트)
import { useNameOf } from '../components/AddressBook';
import { rectOf, viewH, viewW } from '../lib/zoom';
import { useEffect, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type ReactNode, type SetStateAction } from 'react';

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

import { useAccess } from '../components/AuthGate';
import { today } from '../lib/date';
import { loadMissingNow, recheckMissingNow, rowKeyOf, useSkuMissing, type MissingMeta } from '../lib/skuMissing';
import { seasonOfCode, syncSkuNow, useSku, useSkuMeta, useSkuPaths, useSkuSeason, type SkuMeta } from '../lib/sku';
import { deleteDict, fixJunkTypes, isPattern, saveDict, setDictTags, translate, useDict, type DictEntry, type Piece } from '../lib/dict';
import { catKey, catLabel, gramsOf, makeRecommender, NO_CAT, saveCategories, savePicks, deletePicks, useCatPicks, useCategories, type Cat, type CatPick } from '../lib/categories';

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
  wb: unknown; // (예전: 올린 엑셀 원본) — 지금은 안 씀
}
// 빈 제품 목록 → 표 칸: 제품코드 · 구분(상품/제품) · 한글 제품명(닉네임) · 수출 대분류 3칸 · 중분류 3칸 · 영문 제품명 · 등록일
const SHEET_HEADERS = ['제품코드', '구분', '한글 제품명', '수출대분류', '수출대분류명', '수출대분류 영문명', '수출중분류', '수출중분류명', '수출중분류 영문명', '영문 제품명', '등록일'];
const SHEET_COL: Sheet['col'] = { code: 0, koName: 2, mainCode: 3, mainName: 4, mainEn: 5, subCode: 6, subName: 7, subEn: 8, enName: 9 };

export default function Translate() {
  const [tab, setTab] = useKept<Tab>('tab', 'translate');
  return (
    <div className="page">
      <div className="page-head">
        <h1>제품번역</h1>
        <p className="muted"><b>⬇ 없는거 불러오기</b>로 수출 분류 · 영문 제품명이 빈 제품을 회사에서 가져와 사전으로 자동 번역해요 (목록은 모두가 같이 봐요). 모르는 단어는 채워 넣으면 사전에 저장돼서 다음부터 자동으로 들어가요.</p>
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

/** 자동 번역 → 고친 영문: 바뀐 부분(앞뒤 같은 단어 빼고)과 그 자리의 한글 단어를 찾아 사전 저장 제안 */
function guessDictEdit(auto: string, edited: string, pieces: Piece[]): { ko: string; en: string } | null {
  const a = auto.trim().split(/\s+/);
  const b = edited.trim().split(/\s+/);
  if (!edited.trim() || a.join(' ') === b.join(' ')) return null;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  const oldMid = a.slice(i, a.length - j).join(' ');
  const newMid = b.slice(i, b.length - j).join(' ').replace(/^[([]+|[)\],.]+$/g, '');
  if (!newMid) return null;
  // 바뀐 자리에 있던 한글 단어 (사전 단어 · [모르는 단어])
  const ko = pieces
    .filter((p) => /[가-힣]/.test(p.text) && oldMid.includes(p.unknown ? `[${p.text}]` : p.en ?? '\u0000'))
    .map((p) => p.text)
    .join('');
  return { ko, en: newMid };
}

function useDictMap() {
  const list = useDict();
  return useMemo(() => {
    // 구분 없는 단어 = 기본 · 구분 있는 단어 (상품 · 제품 …) = 그 구분 제품에서만 기본 대신
    const map = new Map((list ?? []).filter((e) => !e.type).map((e) => [e.ko, e.en]));
    const keys = [...map.keys()].sort((a, b) => b.length - a.length); // 긴 단어부터
    const typed = new Map<string, Map<string, string>>();
    for (const e of list ?? []) if (e.type) typed.set(e.type, (typed.get(e.type) ?? new Map()).set(e.ko, e.en));
    const cache = new Map<string, { map: Map<string, string>; keys: string[] }>();
    /** 이 구분 제품에 쓸 사전 (구분 단어가 없으면 기본 그대로) */
    const forType = (type: string) => {
      const t = typed.get(type);
      if (!t) return { map, keys };
      if (!cache.has(type)) {
        const m = new Map([...map, ...t]);
        cache.set(type, { map: m, keys: [...m.keys()].sort((a, b) => b.length - a.length) });
      }
      return cache.get(type)!;
    };
    return { list, map, keys, forType, types: [...typed.keys()] };
  }, [list]);
}

function TranslateTab() {
  const { email, accountName, role } = useAccess();
  const isAdmin = role === 'admin' || role === null; // 관리자 (로컬 모드 포함)
  // 제품코드 · 제품명에 마우스 올리면 제품 이미지 · 팀 · 분류 (getproductinfo_bulk)
  const { bind: skuHover, card: skuCard } = useSkuHover();
  const { list, map, keys, forType } = useDictMap();
  const charKo = useMemo(() => new Set((list ?? []).filter((e) => (e.tags ?? []).includes('캐릭터')).map((e) => e.ko.trim())), [list]);
  // 영문 제품명을 고치면: 바뀐 부분을 사전에도 저장할지 물어봄
  const [ask, setAsk] = useState<{ r: number; ko: string; en: string; typeOnly: boolean } | null>(null);
  // 빈 제품 목록 (서버가 회사 API 에서 찾아 둔 것 · 모두가 같이 봄) → 표 한 장처럼
  const { list: missing, meta: mMeta } = useSkuMissing();
  const skuTotal = useSkuMeta()?.count ?? 0; // 회사 전체 제품 수 (제품 정보 받기에서)
  const { rows: cats } = useCategories();
  const sheet = useMemo<Sheet | null>(() => {
    if (!missing) return null;
    // 코드가 있으면 이름 · 영문명은 분류표에서 채워 둠 (비어 있는 칸만 고르게)
    const byMain = new Map<string, Cat>();
    const byBoth = new Map<string, Cat>();
    for (const c of cats ?? []) {
      if (!byMain.has(c.mainCode)) byMain.set(c.mainCode, c);
      byBoth.set(`${c.mainCode}-${c.subCode}`, c);
    }
    const rows = missing.map((m) => {
      const both = m.lrg && m.midd ? byBoth.get(`${m.lrg}-${m.midd}`) : undefined;
      const main = m.lrg ? both ?? byMain.get(m.lrg) : undefined;
      return {
        r: rowKeyOf(m.code),
        cells: [m.code, m.type, m.ko, m.lrg, main?.mainName ?? '', main?.mainEn ?? '', m.midd, both?.subName ?? '', both?.subEn ?? '', m.eng, m.reg],
      };
    });
    return { fileName: '수출분류_영문명', sheetName: '빈 제품', headerRow: 0, headers: SHEET_HEADERS, col: SHEET_COL, rows, wb: null };
  }, [missing, cats]);
  const typeOf = (row: { cells: unknown[] }) => String(row.cells[1] ?? '');
  const err = '';
  const [edits, setEdits] = useKept<Record<number, string>>('edits', {}); // 줄 → 직접 고친 영문 제품명
  const [keepParen, setKeepParen] = useKept<Record<number, string[]>>('keepParen', {}); // 줄 → 빼지 말고 번역할 괄호
  // '사전에 없는 단어'에서 ✕ 로 뺀 단어: 번역하지 않음 (영문 제품명에서 빠짐)
  const [hidden, setHidden] = useKept<string[]>('hiddenWords', []);
  // 줄 거르기: 전체 · 엑셀에서 빈 칸 있는 줄 · 아직 덜 채운 줄 (사이트에서 채운 것 빼고)
  const [rowF, setRowF] = useKept<'all' | 'excel' | 'left' | 'en' | 'cat'>('rowF', 'left');
  const onlyTodo = rowF !== 'all';
  const [page0, setPage] = useKept('page', 0);
  const cell = (row: { cells: unknown[] }, k: keyof Sheet['col']) => (sheet?.col[k] !== undefined ? String(row.cells[sheet.col[k]!] ?? '').trim() : '');
  // 비어 있는 칸이 있는 줄 + 자동 번역
  const hiddenSet = useMemo(() => new Set(hidden), [hidden]);
  const seasonSet = useSkuSeason();
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
      // 구분(상품 · 제품)마다 다른 단어 (예: 오토 → 상품 auto · 제품 Otto)
      const dt = forType(typeOf(row));
      const tr0 = koEn ? translate(koEn, dt.map, dt.keys) : { en: '', unknown: [] as string[], pieces: [] };
      // 뺀 단어는 영문에서 지움 ([호] → 없음)
      const skipped = tr0.unknown.filter((u) => hiddenSet.has(u));
      const en = skipped.length ? skipped.reduce((a, w) => a.split(`[${w}]`).join(''), tr0.en).replace(/\s{2,}/g, ' ').replace(/\s+([)\],.])/g, '$1').trim() : tr0.en;
      const tr = { ...tr0, en, unknown: tr0.unknown.filter((u) => !hiddenSet.has(u)), skipped };
      // 시즌: 제품 정보(getproductinfo_bulk)의 팀 · 대/중/소분류에 '시즌' 이 들어간 제품 (엑셀 시즌품구분은 안 씀)
      const season = seasonOfCode(seasonSet, cell(row, 'code'));
      // 캐릭터: 제품명에 사전의 🧸 캐릭터 단어가 들어 있으면
      const chars = [...new Set(tr0.pieces.filter((p) => p.en && charKo.has(p.text)).map((p) => p.text))];
      return { row, empty, ko, tr, cut, parens, season, chars };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, map, keys, forType, keepParen, hiddenSet, seasonSet, charKo]);
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
  // 찾기 · 코드 · 시즌으로 거른 줄 (덜 채운 줄만은 아래에서)
  const shownAll = useMemo(() => {
    const base0 = view;
    const base1 = codePre ? base0.filter((v) => cell(v.row, 'code').startsWith(codePre)) : base0;
    const base = seasonF && seasonSet ? base1.filter((v) => v.season === seasonF) : base1;
    const words = rowQ.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return base;
    return base.filter((v) => {
      const h = `${v.ko} ${cell(v.row, 'code')} ${cell(v.row, 'enName')} ${v.tr.en}`.toLowerCase();
      return words.every((w) => h.includes(w));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, rowQ, codePre, seasonF, seasonSet]);
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
  const picks = useCatPicks();
  const catByKey = useMemo(() => new Map((cats ?? []).map((c) => [catKey(c), c])), [cats]);
  // 코드 모양이 달라도 (01 · 1 · 001) 같은 분류로
  const catByNum = useMemo(() => new Map((cats ?? []).map((c) => [`${Number(c.mainCode)}-${Number(c.subCode)}`, c])), [cats]);
  const catOfCodes = (m: string, sub: string) => (m && sub ? catByKey.get(`${m}-${sub}`) ?? catByNum.get(`${Number(m)}-${Number(sub)}`) : undefined);
  const catGroups = useMemo(() => {
    const g = new Map<string, Cat[]>();
    for (const c of cats ?? []) g.set(`${c.mainCode} ${c.mainName}`, [...(g.get(`${c.mainCode} ${c.mainName}`) ?? []), c]);
    return [...g.entries()];
  }, [cats]);
  const catCols = TARGETS.filter((t) => t.key !== 'enName' && sheet?.col[t.key] !== undefined);
  // 제품코드 앞 2자리 (추천에 같이 씀)
  const preOf = (v: (typeof view)[number]) => {
    const c = cell(v.row, 'code');
    return /^\d{2}/.test(c) ? c.slice(0, 2) : undefined;
  };
  // 제품 정보의 SKU 분류 (대›중›소) — 같은 SKU 분류 제품들이 간 수출 분류를 추천에 참고
  const skuPaths = useSkuPaths();
  const pathOf = (code?: string) => (code && skuPaths ? skuPaths.get(code.trim()) : undefined);
  const recommend = useMemo(() => {
    // 이 파일에서 분류 칸이 다 채워진 줄만 예시로 (코드만 있고 이름이 빈 줄은 자기 자신을 추천해서 빼요) · 분류표에 있는 분류만
    const inFile = view
      .filter((v) => v.ko && !catCols.some((t) => v.empty.includes(t.key)))
      .map((v) => ({ v, c: catOfCodes(cell(v.row, 'mainCode'), cell(v.row, 'subCode')) }))
      .filter((x) => x.c)
      .map(({ v, c }) => ({ ko: v.ko, cat: catKey(c!), season: v.season, pre: preOf(v), path: pathOf(cell(v.row, 'code')) }));
    const known = (k: string) => k === NO_CAT || catByKey.has(k);
    return makeRecommender([...inFile, ...picks.filter((p) => known(p.cat)).map((p) => ({ ko: p.ko, cat: p.cat, season: seasonOfCode(seasonSet, p.code), pre: p.pre, path: pathOf(p.code) }))]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, picks, seasonSet, skuPaths, catByKey]);
  const [catSel, setCatSel] = useKept<Record<number, string>>('catSel', {}); // 줄 → 고른 분류
  const needCat = (v: (typeof view)[number]) => catCols.some((t) => v.empty.includes(t.key));
  const sugCache = useMemo(() => new Map<number, ReturnType<typeof recommend>>(), [recommend]);
  const sugOf = (v: (typeof view)[number]) => {
    if (!v.ko || !needCat(v)) return null;
    if (!sugCache.has(v.row.r)) sugCache.set(v.row.r, recommend(v.ko, v.season, preOf(v), pathOf(cell(v.row, 'code'))));
    return sugCache.get(v.row.r)!;
  };
  // 같은 제품명으로 고른 적 있으면 바로 그 분류
  const chosen = (v: (typeof view)[number]) => {
    if (catSel[v.row.r] !== undefined) return catSel[v.row.r];
    // 수출 대/중분류 코드는 있고 이름만 빈 줄: 분류표에서 그 코드 그대로 (이름 · 영문명만 채움)
    const byCode = catOfCodes(cell(v.row, 'mainCode'), cell(v.row, 'subCode'));
    if (byCode) return catKey(byCode);
    const sg = sugOf(v);
    return sg?.exact && (catByKey.has(sg.cat) || sg.cat === NO_CAT) ? sg.cat : '';
  };
  // '아직 덜 채운 줄만': 영문 제품명이 비었거나 [모르는 단어] 가 남은 줄 · 수출 분류를 아직 안 고른 줄
  //   고치는 중에 줄이 사라지지 않게, 체크하거나 거르기를 바꿀 때만 다시 거름
  const isLeft = (v: (typeof view)[number]) => (v.empty.includes('enName') && (!enOf(v) || /\[[^\]]+\]/.test(enOf(v)))) || (needCat(v) && !chosen(v));
  const [refilter, setRefilter] = useState(0);
  const shown = useMemo(
    () =>
      rowF === 'left'
        ? shownAll.filter(isLeft)
        : rowF === 'excel'
          ? shownAll.filter((v) => v.empty.length > 0)
          : rowF === 'en'
            ? shownAll.filter((v) => v.empty.includes('enName')) // 영문 제품명이 빈 줄
            : rowF === 'cat'
              ? shownAll.filter(needCat) // 수출 분류가 빈 줄
              : shownAll,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowF, shownAll, refilter],
  );
  const page = Math.min(page0, Math.max(0, Math.ceil(shown.length / PAGE) - 1));
  const pickCat = (v: (typeof view)[number], key: string) => {
    setCatSel((x) => ({ ...x, [v.row.r]: key }));
    if (key && v.ko) void savePicks([{ ko: v.ko, cat: key, season: v.season, pre: preOf(v), code: cell(v.row, 'code') || undefined }], accountName ?? email);
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
    const save: { ko: string; cat: string; season?: 'S' | 'N'; pre?: string; code?: string }[] = [];
    // 지금 보고 있는 쪽(검색 결과 · 페이지)에 보이는 줄에만
    for (const v of shown.slice(page * PAGE, page * PAGE + PAGE)) {
      if (!needCat(v) || chosen(v)) continue;
      const sg = sugOf(v);
      if (sg && catByKey.has(sg.cat)) {
        next[v.row.r] = sg.cat;
        save.push({ ko: v.ko, cat: sg.cat, season: v.season, pre: preOf(v), code: cell(v.row, 'code') || undefined });
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
    // 목록 그대로 + 채운 칸 (영문 제품명 · 고른 수출 분류) — 코드는 글자로 (01 의 0 이 안 없어지게)
    const out = new Map(sheet.rows.map((row) => [row.r, row.cells.map((x) => String(x ?? ''))]));
    const c = sheet.col.enName!;
    let n = 0;
    for (const v of needEn) {
      const en = enOf(v);
      if (!en || (!all && /\[[^\]]+\]/.test(en))) continue; // 모르는 단어가 남은 건 비워 둠 (관리자 '덜 된 것도' 는 그대로)
      out.get(v.row.r)![c] = en;
      n++;
    }
    let nc = 0;
    for (const v of todo) {
      const cat = catByKey.get(chosen(v));
      if (!cat) continue;
      for (const t of catCols) if (v.empty.includes(t.key)) out.get(v.row.r)![sheet.col[t.key]!] = catValue(cat, t.key);
      nc++;
    }
    const aoa = [sheet.headers, ...sheet.rows.map((row) => out.get(row.r)!)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    for (const k of Object.keys(ws)) if (!k.startsWith('!') && ws[k].t === 'n') ws[k] = { t: 's', v: String(ws[k].v) };
    ws['!cols'] = [{ wch: 11 }, { wch: 6 }, { wch: 36 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 8 }, { wch: 14 }, { wch: 18 }, { wch: 40 }, { wch: 11 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '빈 제품');
    XLSX.writeFile(wb, `수출분류_영문명_${today().replace(/-/g, '')}.xlsx`);
    alert(all ? `영문 제품명 ${n}줄(모르는 단어 [ ] 가 남은 것 포함) · 수출 분류 ${nc}줄을 채워서 받았어요.` : `영문 제품명 ${n}줄 · 수출 분류 ${nc}줄을 채워서 받았어요. (모르는 단어가 남은 영문 제품명, 분류를 안 고른 줄은 비워 뒀어요)`);
  };

  // ⬇ 없는거 불러오기 · 🔄 새로고침 (모두가 같이 보는 목록)
  const [busy, setBusy] = useState<'' | 'load' | 'recheck'>('');
  const [msg, setMsg] = useState('');
  // 내가 채우고 있는 것 = 영문 제품명이 완성됐거나 (모르는 단어 없이) 수출 분류를 고른 줄
  const filling = useMemo(
    () => (sheet ? view.filter((v) => (v.empty.includes('enName') && enOf(v) && !/\[[^\]]+\]/.test(enOf(v)) && edits[v.row.r] !== undefined) || catByKey.has(chosen(v))).map((v) => cell(v.row, 'code')) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, edits, catSel, catByKey],
  );
  const loadNow = async () => {
    setBusy('load');
    // 거르는 기준(서버 skuMissing.js FILTER_VER)이 바뀐 뒤 처음이면 서버가 처음부터 다시 훑음
    const reScan = (mMeta.filterVer ?? 1) < FILTER_VER_CLIENT;
    setMsg(
      reScan
        ? '새 기준(재고 100 이하 · 수출제한 01 빼기)으로 처음부터 다시 훑는 중… (몇 분 걸려요)'
        : mMeta.phase === 'inc'
          ? '지난번 등록일 이후 새 제품을 찾는 중…'
          : '전체 제품을 이어서 훑는 중이에요 (회사 API 제한 때문에 몇 분 걸려요)…',
    );
    try {
      const r = await loadMissingNow();
      setMsg(
        r.busy
          ? '다른 사람이 지금 불러오는 중이에요 — 조금 뒤에 다시 눌러 주세요'
          : `${r.phase === 'inc' ? '✓ ' : ''}${r.scanned.toLocaleString()}개를 보고 새로 ${r.added.toLocaleString()}개 넣고${r.dropped ? ` ${r.dropped.toLocaleString()}개 뺐어요` : ' 뺀 건 없어요'} · 목록 ${r.count.toLocaleString()}개${r.phase !== 'inc' ? ' · 아직 다 못 훑었어요 (다시 누르면 이어서)' : ''}`,
      );
    } catch (e) {
      setMsg(`못 불러왔어요: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };
  const recheck = async () => {
    if (!filling.length) return;
    setBusy('recheck');
    setMsg(`사이트에서 채운 ${filling.length.toLocaleString()}개가 ERP 에 들어갔는지 확인하는 중… (1개에 2초쯤 · 한 번에 100개 남짓)`);
    try {
      const r = await recheckMissingNow(filling);
      setMsg(`${r.checked}개 확인 → ${r.removed}개는 ERP 에 다 채워져서 목록에서 뺐어요${r.left ? ` · 남은 ${r.left}개는 다시 누르면 이어서` : ''}${r.stopped ? ` · ${r.stopped}` : ''}`);
    } catch (e) {
      setMsg(`확인 못 했어요: ${(e as Error).message}`);
    } finally {
      setBusy('');
    }
  };
  const fmtAt = (iso?: string) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="tr-wrap">
      <div className="card tr-upload">
        {/* 1줄: 하는 일 버튼 · 오른쪽에 받기 · 관리자 */}
        <div className="tr-up-row">
          <button className="primary" disabled={!!busy} onClick={() => void loadNow()} title="회사 API 에서 수출 대분류 · 중분류 · 영문 제품명이 빈 제품을 찾아와요 (처음엔 전부, 그 뒤엔 지난번 등록일 이후 새 제품만) · 매일 아침 7시에도 자동으로 불러와요">
            {busy === 'load' ? '불러오는 중…' : '⬇ 없는거 불러오기'}
          </button>
          <button disabled={!!busy || !filling.length} onClick={() => void recheck()} title="사이트에서 채운 제품을 ERP(회사 API)에서 다시 확인해서, ERP 에 수출 분류 · 영문명이 다 들어가 있으면 목록에서 빼요. 사이트에서만 채운 건 안 빠져요. (ERP 에 채워진 제품은 없는거 불러오기 · 아침 자동에서도 알아서 빠져요)">
            {busy === 'recheck' ? '확인 중…' : `🔄 ERP 반영 확인${filling.length ? ` (사이트에서 채운 ${filling.length.toLocaleString()}개)` : ''}`}
          </button>
          <span className="tr-up-spacer" />
          {sheet && sheet.rows.length > 0 && (
            <button onClick={() => void download()} title="채운 영문 제품명 · 수출 분류를 엑셀로">
              ⬇ 채운 엑셀 받기
            </button>
          )}
          {isAdmin && (
            <details className="tr-admin">
              <summary>관리자 ▾</summary>
              <div className="tr-admin-pop">
                <SkuSyncBtn />
                <ApiCheck meta={mMeta} />
                {sheet && sheet.rows.length > 0 && (
                  <button onClick={() => void download(true)} title="모르는 단어가 [ ] 로 남은 영문 제품명도 그대로 채워서 받아요">
                    ⬇ 덜 된 것도 받기
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
        {/* 2줄: 지금 상태 (조용히) */}
        {sheet ? (
          <div className="tr-up-status muted small">
            빈 제품 <b>{sheet.rows.length.toLocaleString()}개</b> · 영문 제품명 빈 것 {needEn.length.toLocaleString()}
            {mMeta.at && ` · 마지막 불러오기 ${fmtAt(mMeta.at)}`}
            {mMeta.nightAt && ` · 아침 자동 ${fmtAt(mMeta.nightAt)}`}
            {mMeta.lastReg && ` · 등록일 ${mMeta.lastReg.slice(0, 10)}까지 봄`}
          </div>
        ) : (
          <div className="tr-up-status muted small">목록 불러오는 중…</div>
        )}
        {/* 진행 상황: 지금 도는 중인지 · 전체 훑기 몇 % · 멈췄으면 언제 이어지는지 */}
        <ScanProgress meta={mMeta} total={skuTotal} busy={busy === 'load'} />
        {/* 3줄: 알릴 것만 (방금 결과 · 오류) */}
        {msg && <div className="small tr-sku-msg">{msg}</div>}
        {!msg && mMeta.nightError && <div className="warn small">아침 자동 불러오기 오류: {mMeta.nightError}</div>}
        {mMeta.order === 'mixed' && <div className="muted small">⚠ 등록일 순서가 섞여 있어서 새 제품을 찾을 때 처음부터 다시 봐요</div>}
      </div>
      {err && <p className="warn small">{err}</p>}
      {list === null && <p className="muted small">사전 불러오는 중…</p>}
      {skuCard}

      {sheet && unknownAll.length > 0 && <UnknownWords words={unknownAll} hidden={hidden} setHidden={setHidden} rowsOf={(w) => needEn.filter((v) => v.tr.unknown.includes(w) || v.tr.skipped.includes(w)).map((v) => ({ r: v.row.r, code: cell(v.row, 'code'), ko: v.ko, en: v.tr.en }))} />}

      {sheet && (
        <div className="card tr-rows">
          <div className="tr-rows-head">
            <select className={`tr-code-pre ${rowF !== 'all' ? 'set' : ''}`} value={rowF} onChange={(e) => (setRowF(e.target.value as 'all' | 'excel' | 'left' | 'en' | 'cat'), setPage(0))} title="어떤 줄을 볼지">
              <option value="left">아직 덜 채운 줄 (사이트에서 채운 것 빼고)</option>
              <option value="en">영문 제품명 빈 줄 ({view.filter((v) => v.empty.includes('enName')).length.toLocaleString()})</option>
              <option value="cat">수출 분류 빈 줄 ({view.filter(needCat).length.toLocaleString()})</option>
              <option value="excel">빈 칸 있는 줄 (전부)</option>
              <option value="all">모든 줄</option>
            </select>
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
            {/* 시즌 구분: 제품 정보(getproductinfo_bulk)의 팀 · 대/중/소분류에 '시즌' 이 있으면 시즌품 (제품 정보를 받기 전엔 고를 수 없음) */}
            <select
              className={`tr-code-pre ${seasonF ? 'set' : ''}`}
              value={seasonSet ? seasonF : ''}
              disabled={!seasonSet || sheet.col.code === undefined}
              onChange={(e) => (setSeasonF(e.target.value as '' | 'S' | 'N'), setPage(0))}
              title={
                sheet.col.code === undefined
                  ? '엑셀에 제품코드 칸이 없어서 시즌을 알 수 없어요'
                  : seasonSet
                    ? "시즌으로 거르기 (제품 정보의 팀 · 대/중/소분류에 '시즌' 이 들어간 제품)"
                    : '제품 정보를 아직 안 받아서 시즌을 알 수 없어요 (관리자: 🖼 제품 정보 받기)'
              }
            >
              <option value="">{seasonSet ? '시즌 전체' : '시즌 (제품 정보 받기 전)'}</option>
              <option value="S">🎄 시즌품만 ({view.filter((v) => v.season === 'S').length})</option>
              <option value="N">비시즌품만 ({view.filter((v) => v.season === 'N').length})</option>
            </select>
            <span className="muted small">{shown.length}줄</span>
            {rowF === 'left' && (
              <button className="link small" onClick={() => (setRefilter((n) => n + 1), setPage(0))} title="방금 채운 줄을 빼고 다시 거르기">
                ↻ 다시 거르기
              </button>
            )}
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
                {shown.slice(page * PAGE, page * PAGE + PAGE).map((v, i) => {
                  const enEmpty = v.empty.includes('enName');
                  const en = enOf(v);
                  const left = /\[[^\]]+\]/.test(en);
                  return (
                    <tr key={v.row.r}>
                      <td className="muted">{page * PAGE + i + 1}</td>
                      {sheet.col.code !== undefined && (
                        <td className="tr-code" {...skuHover(cell(v.row, 'code'))}>
                          {cell(v.row, 'code')}
                        </td>
                      )}
                      <td className="tr-ko-name" {...skuHover(cell(v.row, 'code'))}>
                        {typeOf(v.row) && <span className="tag small tr-type" title="구분 (sku_type_name) — 사전에 이 구분 단어가 있으면 그걸로 번역">{typeOf(v.row)}</span>}
                        {v.chars.length > 0 && (
                          <span className="tr-char-row" title={`사전의 캐릭터 단어: ${v.chars.join(', ')}`}>
                            🧸 캐릭터
                          </span>
                        )}
                        {v.season === 'S' && (
                          <span className="tr-season" title="시즌 (제품 정보의 팀 · 대/중/소분류에 '시즌')">
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
                          <>
                            <input
                              value={en}
                              onChange={(e) => setEdits((x) => ({ ...x, [v.row.r]: e.target.value }))}
                              onBlur={() => {
                                const g = guessDictEdit(v.tr.en, en, v.tr.pieces);
                                if (g && !(map.get(g.ko) === g.en)) setAsk({ r: v.row.r, ...g, typeOnly: false });
                              }}
                              title={left ? '[ ] 안의 단어가 사전에 없어요' : '사전으로 자동 번역'}
                            />
                            {ask?.r === v.row.r && (
                              <div className="tr-ask small">
                                <span>📖 사전에도 저장할까요?</span>
                                <input value={ask.ko} placeholder="한글" onChange={(e) => setAsk({ ...ask, ko: e.target.value })} />
                                →
                                <input value={ask.en} placeholder="영어" onChange={(e) => setAsk({ ...ask, en: e.target.value })} />
                                {typeOf(v.row) && (
                                  <label title="이 구분 제품에만 이 영어로 (예: 오토 → 상품이면 auto)">
                                    <input type="checkbox" checked={ask.typeOnly} onChange={(e) => setAsk({ ...ask, typeOnly: e.target.checked })} /> {typeOf(v.row)}에만
                                  </label>
                                )}
                                <button
                                  className="primary small"
                                  disabled={!/[가-힣]/.test(ask.ko) || !ask.en.trim()}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    void saveDict([{ ko: ask.ko, en: ask.en, ...(ask.typeOnly ? { type: typeOf(v.row) } : {}) }], accountName ?? email);
                                    setAsk(null);
                                  }}
                                >
                                  저장
                                </button>
                                <button className="link" onClick={() => setAsk(null)}>
                                  아니요
                                </button>
                              </div>
                            )}
                          </>
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
                                  {!val && cell(v.row, 'mainCode') && cell(v.row, 'subCode') && (
                                    <div className="warn small" title="이 줄의 수출 대/중분류 코드가 분류 탭의 분류표에 없어요">
                                      코드 {cell(v.row, 'mainCode')}-{cell(v.row, 'subCode')} 이 분류표에 없어요
                                    </div>
                                  )}
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
  const { list, types: dictTypes } = useDictMap();
  // 구분 (sku_type_name): 빈 제품 목록에 나온 것 + 사전에 이미 있는 것 (상품 · 제품 은 늘)
  // 실제 제품 구분 (상품 · 제품 + 제품 목록에 나오는 구분) — 사전 구분은 이것만
  const realTypes = useMemo(() => new Set(['상품', '제품']), []); // 사전 구분은 상품 · 제품만
  const typeOpts = useMemo(() => [...new Set(['상품', '제품', ...dictTypes.filter((t) => realTypes.has(t)), ...realTypes])], [dictTypes, realTypes]);
  const [q, setQ] = useState('');
  const [ko, setKo] = useState('');
  const [en, setEn] = useState('');
  const [type, setType] = useState('');
  const [isChar, setIsChar] = useState(false); // 넣을 때 '캐릭터' 태그
  const [onlyChar, setOnlyChar] = useState(false); // 캐릭터 단어만 보기
  const CHAR = '캐릭터';
  const hasChar = (e: DictEntry) => (e.tags ?? []).includes(CHAR);
  const toggleChar = (e: DictEntry) => void setDictTags(e, hasChar(e) ? (e.tags ?? []).filter((t) => t !== CHAR) : [...(e.tags ?? []), CHAR]);
  const nChar = (list ?? []).filter(hasChar).length;
  const [editing, setEditing] = useState<string | null>(null);
  const [editEn, setEditEn] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const nq = q.trim().toLowerCase();
  const shown = (list ?? [])
    .filter((e) => !nq || e.ko.toLowerCase().includes(nq) || e.en.toLowerCase().includes(nq) || (nq === '캐릭터' && (e.tags ?? []).includes('캐릭터')))
    .filter((e) => !onlyChar || (e.tags ?? []).includes('캐릭터'))
    .sort((a, b) => a.ko.localeCompare(b.ko, 'ko'));
  const add = async () => {
    if (!ko.trim() || !en.trim()) return;
    await saveDict([{ ko, en, type, ...(isChar ? { tags: [CHAR] } : {}) }], accountName ?? email);
    setKo('');
    setEn('');
  };
  const [untyping, setUntyping] = useState(false);
  // 엑셀로 한꺼번에: 첫 칸 한글 · 둘째 칸 영어
  const bulk = async (f: File) => {
    const XLSX = await import('xlsx');
    const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    // 셋째 칸은 구분(상품 · 제품 같은 짧은 말)일 때만 — 메모 같은 긴 글은 구분으로 안 넣음
    const typeOk = (t: string) => realTypes.has(t); // 상품 · 제품 같은 실제 구분만 (미번역 · 숫자 · 메모는 구분 아님)
    const rows = aoa.map((r) => ({ ko: String(r[0] ?? '').trim(), en: String(r[1] ?? '').trim(), type: typeOk(String(r[2] ?? '').trim()) ? String(r[2] ?? '').trim() : '' })).filter((r) => /[가-힣]/.test(r.ko) && r.en);
    if (!rows.length) return setMsg('넣을 단어를 못 찾았어요 (첫 칸 한글, 둘째 칸 영어, 셋째 칸 구분은 선택)');
    await saveDict(rows, accountName ?? email);
    setMsg(`${rows.length}개 단어를 사전에 넣었어요 ✓`);
  };
  return (
    <div className="card tr-dict">
      <div className="tr-dict-tools">
        <input className="search" placeholder="🔍 한글 · 영어로 찾기" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{(list ?? []).length}개 단어</span>
        <button className={`tr-char-filter ${onlyChar ? 'on' : ''}`} onClick={() => setOnlyChar((v) => !v)} title="캐릭터 태그를 단 단어만 보기">
          🧸 캐릭터만 {nChar > 0 && <b>{nChar}</b>}
        </button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && void bulk(e.target.files[0])} />
        <button onClick={() => fileRef.current?.click()} title="첫 칸 한글, 둘째 칸 영어 (셋째 칸에 상품 · 제품을 쓰면 그 구분에만)">
          📥 엑셀로 한꺼번에 넣기
        </button>
      </div>
      {msg && <p className="small">{msg}</p>}
      {(() => {
        // 이상한 구분 (상품 · 제품 같은 실제 제품 구분이 아닌 것: 미번역 · 53 · 메모 …) — 그 구분 제품이 없어서 그 단어는 아무 데도 안 쓰임
        const junk = (list ?? []).filter((e) => e.type && !realTypes.has(e.type));
        if (!junk.length) return null;
        return (
          <p className="small tr-untype">
            <b>상품 · 제품이 아닌 구분 단어 {junk.length}개</b> (예: {[...new Set(junk.map((e) => e.type))].slice(0, 5).join(' · ')}) — 이 구분 제품이 없어서 번역에 안 쓰여요{' '}
            <button
              className="link"
              disabled={untyping}
              onClick={async () => {
                if (!confirm(`상품 · 제품이 아닌 구분 ${junk.length}개를 모두 지울까요? ('구분 없음 (모두)' 로)\n같은 한글이 여러 개면 하나만 남겨요: 구분 없는 단어가 있으면 그것, 없으면 가장 최근에 넣은 영어. 상품 · 제품 구분 단어는 그대로예요.`)) return;
                setUntyping(true);
                const r = await fixJunkTypes(list ?? [], realTypes, accountName ?? email, (d, t) => setMsg(`정리하는 중… ${d.toLocaleString()} / ${t.toLocaleString()}`)).catch((e) => ({ fixed: 0, removed: 0, kept: [`오류: ${(e as Error).message}`] }));
                setUntyping(false);
                setMsg(`정리했어요 ✓ 구분 없음으로 ${r.fixed}개 · 겹쳐서 지운 것 ${r.removed}개${r.kept.length ? ` · 영어가 달라서 하나로 맞춘 것 ${r.kept.length}개: ${r.kept.slice(0, 8).join(', ')}${r.kept.length > 8 ? ' …' : ''}` : ''}`);
              }}
            >
              {untyping ? '정리하는 중…' : '구분 정리하기'}
            </button>
          </p>
        );
      })()}
      <p className="muted small" style={{ marginTop: 0 }}>
        <b>구분</b>을 고르면 그 구분 제품에만 써요. 예: <code>오토</code> → 상품이면 <code>auto</code>, 제품이면 <code>Otto</code> (구분 없는 단어는 모두에게) ·{' '}
        숫자가 들어간 단어는 <b>틀</b>로 번역해요. 예: <code>0호0합</code> → <code>No.0 0-Ply</code> 로 넣으면 3호5합 → No.3 5-Ply, 12호 2합 → No.12 2-Ply (숫자는 차례대로 옮겨져요)
      </p>
      <div className="tr-dict-add">
        <select value={type} onChange={(e) => setType(e.target.value)} title="구분: 이 구분(상품 · 제품) 제품에만 쓰기">
          <option value="">구분 없음 (모두)</option>
          {typeOpts.map((t) => (
            <option key={t} value={t}>
              {t}에만
            </option>
          ))}
        </select>
        <input placeholder="한글 (예: 스티커 · 0호0합)" value={ko} onChange={(e) => setKo(e.target.value)} />
        <span>→</span>
        <input placeholder="영어 (예: Sticker)" value={en} onChange={(e) => setEn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
        <label className={`tr-char-chk ${isChar ? 'on' : ''}`} title="캐릭터 이름이면 체크 (🧸 태그)">
          <input type="checkbox" checked={isChar} onChange={(e) => setIsChar(e.target.checked)} /> 🧸 캐릭터
        </label>
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
                  {e.type && <span className="tag small tr-type">{e.type}</span>}
                  <button className={`tr-char-tag ${hasChar(e) ? 'on' : ''}`} onClick={() => toggleChar(e)} title={hasChar(e) ? '캐릭터 태그 빼기' : '캐릭터 태그 달기'}>
                    🧸{hasChar(e) ? ' 캐릭터' : ''}
                  </button>
                </td>
                <td>
                  {editing === e.id ? (
                    <input
                      autoFocus
                      value={editEn}
                      onChange={(x) => setEditEn(x.target.value)}
                      onBlur={() => {
                        if (editEn.trim() && editEn.trim() !== e.en) void saveDict([{ ko: e.ko, en: editEn, type: e.type }], accountName ?? email);
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
  const seasonSet = useSkuSeason();
  const { rows, meta } = useCategories();
  const picks = useCatPicks();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'cats' | 'find' | 'logic'>('cats'); // 분류표 · 제품명으로 찾기 · 로직
  const [findQ, setFindQ] = useState(''); // 로직 탭에서 단어 누르면 그 단어로 찾기
  const realPicks = useMemo(() => picks.filter((p) => p.cat !== NO_CAT), [picks]); // '선택 안 함' 기록은 빼고
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
      if (h < 0) {
        // 제품명 + 수출 대분류 · 중분류 칸이 있으면 '분류된 제품' 엑셀 → 추천 배우기로
        const isProducts = aoa.slice(0, 15).some((r) => {
          const ks = (r ?? []).map((x) => classify(x));
          return ks.includes('koName') && ks.includes('mainCode') && ks.includes('subCode');
        });
        if (isProducts) {
          if (confirm("이 엑셀은 분류표가 아니라 '분류된 제품' 엑셀이에요 (제품명 · 수출 대분류 · 중분류).\n'분류된 제품 엑셀로 추천 배우기'로 넣을까요? (분류표는 그대로예요)")) return void learn(f);
          return setMsg("이 엑셀은 '분류된 제품' 엑셀이에요 — [📥 분류된 제품 엑셀로 추천 배우기] 버튼으로 올려 주세요.");
        }
        return setMsg("머리줄에서 '대분류코드' · '중분류코드' · '중분류명' 칸을 못 찾았어요.");
      }
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
  // 이미 분류가 채워진 제품 엑셀 → 고른 기록(추천 예시)으로 한꺼번에 넣기
  const learnRef = useRef<HTMLInputElement>(null);
  const [learning, setLearning] = useState(false);
  const learn = async (f: File) => {
    setMsg('');
    setLearning(true);
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
      const known = new Set((rows ?? []).map((c) => `${c.mainCode}-${c.subCode}`));
      const out: { ko: string; cat: string; season?: 'S' | 'N'; pre?: string; code?: string }[] = [];
      let skipped = 0;
      for (const sn of wb.SheetNames) {
        const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sn], { header: 1, defval: '', raw: false });
        for (let h = 0; h < Math.min(aoa.length, 15); h++) {
          const col: Partial<Record<string, number>> = {};
          (aoa[h] ?? []).forEach((x, i) => {
            const k = classify(x);
            if (k && col[k] === undefined) col[k] = i;
          });
          if (col.koName === undefined || col.mainCode === undefined || col.subCode === undefined) continue;
          const g = (r: unknown[], k: string) => (col[k] !== undefined ? String(r[col[k]!] ?? '').trim() : '');
          for (const r of aoa.slice(h + 1)) {
            const ko = g(r, 'koName');
            const m = g(r, 'mainCode');
            const sub = g(r, 'subCode');
            if (!ko || !/^\d+$/.test(m) || !/^\d+$/.test(sub)) continue;
            const cat = `${m}-${sub}`;
            if (known.size && !known.has(cat)) {
              skipped++;
              continue;
            }
            const code = g(r, 'code');
            out.push({ ko, cat, season: seasonOfCode(seasonSet, code), pre: /^\d{2}/.test(code) ? code.slice(0, 2) : undefined, code: code || undefined });
          }
          break;
        }
      }
      if (!out.length) return setMsg("제품명 · 수출 대분류 · 수출 중분류 칸이 채워진 줄을 못 찾았어요.");
      if (!confirm(`분류가 채워진 제품 ${out.length}개를 추천 예시로 넣을까요?${skipped ? `\n(분류표에 없는 분류 ${skipped}줄은 빼요)` : ''}\n같은 제품명은 새로 올린 분류로 바뀌어요.`)) return;
      await savePicks(out, accountName ?? email);
      setMsg(`제품 ${out.length}개를 추천 예시로 넣었어요 ✓ 이제 번역 탭 추천에 바로 쓰여요`);
    } catch (e) {
      setMsg(`엑셀을 못 읽었어요: ${(e as Error).message}`);
    } finally {
      setLearning(false);
    }
  };
  const nq = q.trim().toLowerCase();
  const shown = (rows ?? []).filter((c) => !nq || `${c.mainName} ${c.mainEn} ${c.subName} ${c.subEn} ${c.mainCode}-${c.subCode}`.toLowerCase().includes(nq));
  const pickCount = (k: string) => picks.filter((p) => p.cat === k).length;
  return (
    <div className="card tr-dict">
      <div className="tr-dict-tools">
        {mode === 'cats' && <input className="search" placeholder="🔍 분류 이름 · 영문 · 코드" value={q} onChange={(e) => setQ(e.target.value)} />}
        <span className="muted small">
          {(rows ?? []).length}개 분류 · 고른 기록 {picks.length}개{meta.at ? ` · 올린 날 ${new Date(meta.at).toLocaleDateString('ko-KR')}` : ''}
        </span>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
        <button className="primary" onClick={() => fileRef.current?.click()} title="대분류코드 · 대분류명 · 대분류 영문명 · 중분류코드 · 중분류명 · 중분류 영문명">
          📤 카테고리 엑셀 올리기
        </button>
        <input ref={learnRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => (e.target.files?.[0] && void learn(e.target.files[0]), (e.target.value = ''))} />
        <button disabled={learning || !rows?.length} onClick={() => learnRef.current?.click()} title="제품명 · 제품코드 · 수출 대분류 · 수출 중분류 칸이 있는 엑셀. 분류가 채워진 줄을 추천 예시로 넣어요">
          {learning ? '넣는 중…' : '📥 분류된 제품 엑셀로 추천 배우기'}
        </button>
      </div>
      <p className="muted small" style={{ marginTop: 0 }}>
        분류표를 올리면 전체가 새 분류표로 바뀌어요. 번역 탭에서 줄마다 분류를 고르면 기록이 남고, 다음에 비슷한 제품명이 나오면 그 분류를 추천해요. 이미 분류가 채워진 제품 엑셀을 '추천 배우기'로 올리면 그 제품들도 한꺼번에 추천 예시가 돼요.
      </p>
      {msg && <p className="small">{msg}</p>}
      <div className="seg tr-cat-mode">
        <button className={mode === 'cats' ? 'on' : ''} onClick={() => setMode('cats')}>
          📋 분류표
        </button>
        <button className={mode === 'find' ? 'on' : ''} onClick={() => setMode('find')}>
          🔎 제품명으로 분류 찾기
        </button>
        <button className={mode === 'logic' ? 'on' : ''} onClick={() => setMode('logic')}>
          🧠 로직
        </button>
      </div>
      {mode === 'logic' ? (
        <CatLogic picks={realPicks} rows={rows ?? []} onWord={(w) => (setFindQ(w), setMode('find'))} />
      ) : mode === 'find' ? (
        <ProductCatFinder key={findQ} q0={findQ} picks={realPicks} rows={rows ?? []} />
      ) : rows === null ? (
        <p className="muted small">불러오는 중…</p>
      ) : !rows.length ? (
        <p className="muted small">아직 분류표가 없어요. [카테고리 엑셀 올리기]로 넣어 주세요.</p>
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
  rowsOf: (w: string) => { r: number; code: string; ko: string; en: string }[];
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
  // 지금 목록을 엑셀로 (첫 칸 한글 · 둘째 칸 영어 → 채워서 사전 탭에서 다시 올리면 한꺼번에 들어감)
  const downloadWords = async () => {
    const XLSX = await import('xlsx');
    const aoa = [['한글', '영어', '나온 줄', '예시 제품명'], ...list.map(([w, n]) => [w, newWords[w] ?? '', n, rowsOf(w)[0]?.ko ?? ''])];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [{ wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 50 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, showHidden ? '뺀 단어' : '사전에 없는 단어');
    XLSX.writeFile(wb, showHidden ? '뺀_단어.xlsx' : '사전에_없는_단어.xlsx');
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
        <button onClick={() => void downloadWords()} title="지금 목록(찾기·뺀 단어 보기 그대로)을 엑셀로: 한글 · 영어 · 나온 줄 · 예시 제품명. 영어를 채워서 사전 탭 '엑셀로 한꺼번에 넣기'로 다시 올릴 수 있어요">
          ⬇ 엑셀로 받기
        </button>
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
                <span className="muted small">{v.code}</span> {mark(v.ko, peek)}
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
  const none = value === NO_CAT;
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
    const r = rectOf(btn.current!);
    const up = viewH() - r.bottom < 360 && r.top > viewH() - r.bottom;
    setPos({ left: r.left, top: up ? r.top : r.bottom, width: Math.max(r.width, 240), up });
  };
  return (
    <div className="cat-pick">
      <button ref={btn} type="button" className={`cat-pick-btn ${value ? 'set' : ''}`} disabled={disabled} title={disabled ? '분류 탭에서 분류표를 먼저 올려 주세요' : ''} onClick={openIt}>
        <span>{none ? '🚫 선택 안 함' : cur ? catLabel(cur) : disabled ? '분류표 없음' : '분류 고르기'}</span>
        <span className="cat-caret">⌄</span>
      </button>
      {pos && (
        <div
          ref={pop}
          className={`cat-pop ${pos.up ? 'up' : ''}`}
          style={{ left: pos.left, width: pos.width, ...(pos.up ? { bottom: viewH() - pos.top + 2 } : { top: pos.top + 2 }) }}
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
              <>
                <button className={`cat-opt none ${!value ? 'on' : ''}`} onClick={() => pick('')}>
                  분류 고르기
                </button>
                <button className={`cat-opt none ${none ? 'on' : ''}`} onClick={() => pick(NO_CAT)} title="이 제품은 수출 분류를 비워 둬요 (같은 제품명도 다음부터 비워 둠 · 추천 넣기에서도 빠짐)">
                  🚫 선택 안 함 (비워 두기)
                </button>
              </>
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

/** 분류 탭 › 제품명으로 찾기: 그 단어가 들어간 제품들이 어느 분류로 골라졌는지 (분류별 개수 · 제품명 예시) */
function ProductCatFinder({ picks, rows, q0 = '' }: { picks: CatPick[]; rows: Cat[]; q0?: string }) {
  const seasonSet = useSkuSeason();
  const [q, setQ] = useState(q0);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const word = q.trim();
  const squash = (t: string) => t.toLowerCase().replace(/\s+/g, '');
  const hits = useMemo(() => (word ? picks.filter((p) => squash(p.ko).includes(squash(word))) : []), [picks, word]);
  const groups = useMemo(() => {
    const m = new Map<string, CatPick[]>();
    for (const p of hits) m.set(p.cat, [...(m.get(p.cat) ?? []), p]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [hits]);
  const catOf = (k: string) => rows.find((c) => catKey(c) === k);
  // 단어 칠하기 (띄어쓰기 달라도)
  const mark = (t: string): ReactNode => {
    const re = new RegExp(`(${[...word.replace(/\s+/g, '')].map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')})`, 'gi');
    return t.split(re).map((x, i) => (i % 2 ? <mark key={i}>{x}</mark> : x));
  };
  const SHOW = 12;
  const [copied, setCopied] = useState('');
  const copy = async (p: CatPick) => {
    if (!p.code) return;
    try {
      await navigator.clipboard.writeText(p.code);
    } catch {
      // 클립보드 권한이 없으면 예전 방식
      const t = document.createElement('textarea');
      t.value = p.code;
      document.body.appendChild(t);
      t.select();
      document.execCommand('copy');
      t.remove();
    }
    setCopied(p.id);
    setTimeout(() => setCopied((x) => (x === p.id ? '' : x)), 1200);
  };
  const noCode = hits.filter((p) => !p.code).length;
  return (
    <div className="tr-catfind">
      <input className="search" autoFocus placeholder="🔎 제품명에 들어간 단어 (예: 키링 · 파우치 · 볼펜)" value={q} onChange={(e) => (setQ(e.target.value), setOpenCat(null))} />
      {!word ? (
        <p className="muted small">단어를 넣으면 그 단어가 들어간 제품(고른 기록 {picks.length.toLocaleString()}개)이 어느 분류로 분류됐는지 많은 순으로 보여줘요.</p>
      ) : !hits.length ? (
        <p className="muted small">'{word}' 가 들어간 제품 기록이 없어요.</p>
      ) : (
        <>
          <p className="muted small">
            '{word}' 들어간 제품 <b>{hits.length.toLocaleString()}개</b> → 분류 {groups.length}곳 · 제품명을 누르면 제품코드가 복사돼요
            {noCode > 0 && ` (제품코드 기록이 없는 ${noCode}개는 '추천 배우기'로 그 엑셀을 다시 올리면 생겨요)`}
          </p>
          <div className="tr-catfind-list">
            {groups.map(([k, ps]) => {
              const c = catOf(k);
              const pct = Math.round((ps.length / hits.length) * 100);
              const open = openCat === k;
              return (
                <section key={k} className="tr-catfind-row">
                  <div className="tr-catfind-head">
                    <span className="tr-code">{k}</span>
                    <span className="muted">{c?.mainName ?? '(분류표에 없음)'}</span>
                    <span className="muted">›</span>
                    <b>{c?.subName ?? ''}</b>
                    <span className="muted small">{c?.subEn}</span>
                    <span className="tr-catfind-bar" title={`${pct}%`}>
                      <i style={{ width: `${pct}%` }} />
                    </span>
                    <span className="tr-catfind-n">
                      {ps.length.toLocaleString()}개 <span className="muted small">({pct}%)</span>
                    </span>
                  </div>
                  <div className="tr-catfind-items">
                    {(open ? ps : ps.slice(0, SHOW)).map((p) => (
                      <button
                        key={p.id}
                        className={`tr-catfind-item ${p.code ? '' : 'no-code'} ${copied === p.id ? 'copied' : ''}`}
                        title={p.code ? `${p.code} · 눌러서 제품코드 복사` : '제품코드 기록 없음'}
                        onClick={() => void copy(p)}
                      >
                        {copied === p.id ? `✓ ${p.code} 복사됨` : mark(p.ko)}
                        {copied !== p.id && seasonOfCode(seasonSet, p.code) === 'S' && <span className="tr-season">시즌</span>}
                      </button>
                    ))}
                    {ps.length > SHOW && (
                      <button className="link small" onClick={() => setOpenCat(open ? null : k)}>
                        {open ? '접기' : `+ ${ps.length - SHOW}개 더 보기`}
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** 마우스 올린 칸 옆에 제품 이미지 카드 (잠깐 머무르면 뜨고, 카드 위로 옮겨도 유지) */
function useSkuHover() {
  const [hov, setHov] = useState<{ code: string; x: number; y: number; below: boolean } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const info = useSku(hov?.code ?? null);
  const bind = (code: string) =>
    code
      ? {
          onMouseEnter: (e: ReactMouseEvent<HTMLElement>) => {
            const r = rectOf(e.currentTarget);
            window.clearTimeout(timer.current);
            window.clearTimeout(hideTimer.current);
            timer.current = window.setTimeout(() => {
              // 칸 오른쪽에 (화면 끝이면 왼쪽), 위아래는 화면 안으로
              const x = r.right + 10 + 270 < viewW() ? r.right + 10 : Math.max(8, r.left - 280);
              const y = Math.max(8, Math.min(r.top - 30, viewH() - 370));
              setHov({ code, x, y, below: true });
            }, 250);
          },
          onMouseLeave: () => {
            window.clearTimeout(timer.current);
            hideTimer.current = window.setTimeout(() => setHov(null), 150);
          },
        }
      : {};
  const card = hov ? (
    <div
      className={`sku-card ${hov.below ? '' : 'up'}`}
      style={{ left: hov.x, top: hov.y }}
      onMouseEnter={() => window.clearTimeout(hideTimer.current)}
      onMouseLeave={() => setHov(null)}
    >
      {info === undefined ? (
        <p className="muted small">불러오는 중…</p>
      ) : info === null ? (
        <p className="muted small">
          {hov.code} 제품 정보가 없어요
          <br />
          (관리자: 🖼 제품 정보 받기)
        </p>
      ) : (
        <>
          {info.i ? (
            <a href={imgUrl(info.i)} target="_blank" rel="noreferrer" title="눌러서 새 창으로 크게 보기">
              <img
                key={imgUrl(info.i)}
                src={imgUrl(info.i)}
                alt={hov.code}
                onError={(e) => {
                  e.currentTarget.replaceWith(Object.assign(document.createElement('div'), { className: 'sku-noimg', textContent: '이미지를 못 불러왔어요 (눌러서 열기)' }));
                }}
              />
            </a>
          ) : (
            <div className="sku-noimg">이미지 없음</div>
          )}
          <div className="sku-meta">
            <b>{hov.code}</b>
            {info.t && <span className="sku-team">{info.t}</span>}
            <span className="sku-path">{[info.l, info.m, info.s].filter(Boolean).join(' › ') || '분류 없음'}</span>
          </div>
        </>
      )}
    </div>
  ) : null;
  return { bind, card };
}

/** 제품 이미지 주소: bulk image_dir 이 경로만 오면 (예: /upload/...) img.artbox.kr 을 앞에 붙임 (보통은 https://img.artbox.kr/goods/... 전체 주소로 옴) */
const imgUrl = (p: string) => (/^https?:\/\//i.test(p) ? p : p.startsWith('//') ? `https:${p}` : `https://img.artbox.kr${p.startsWith('/') ? '' : '/'}${p}`);

/** 관리자: 제품 정보 (이미지 · 팀 · 분류) 새로 받기 (그 뒤 새 제품은 엑셀의 빈 제품코드만 자동으로 찾아와요) */
function SkuSyncBtn() {
  const meta = useSkuMeta();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async (restart: boolean) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await syncSkuNow(restart);
      const head = `제품 정보 ${r.count.toLocaleString()}개 받았어요 ✓${r.done ? '' : ' · 나머지는 아침 7시에 이어서 받아요'}${r.stopped ? ` (${r.stopped})` : ''}`;
      setMsg(`${head}${r.noCat ? ` · 분류가 비어서 온 제품 ${r.noCat.toLocaleString()}개 (예: ${(r.noCatSamples ?? []).map((x) => `${x.code} category=${x.category}`).join(' / ')})` : ' · 모든 제품에 분류가 있어요'}`);
    } catch (e) {
      setMsg(`못 받았어요: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        className="tr-dl"
        disabled={busy}
        title={`제품코드 · 제품명에 마우스를 올리면 보이는 제품 이미지 · 팀 · 분류를 받아요 (getproductinfo_bulk · 매일 아침 7시 자동 · 지금 누르면 바로 한 번)${meta?.at ? `\n마지막: ${new Date(meta.at).toLocaleString('ko-KR')} · ${meta.count?.toLocaleString()}개` : ''}\n저장하는 건: 제품코드별 팀 · 대/중분류 (+ 시즌 여부 · 분류 경로)뿐이에요 — 나머지 칸은 받아서 바로 버려요${meta?.noCat ? `\n분류가 비어서 온 제품 ${meta.noCat.toLocaleString()}개 (예: ${(meta.noCatSamples ?? []).map((x) => `${x.code} category=${x.category}`).join(' / ')})` : ''}`}
        onClick={() => void run(false)}
      >
        {busy ? '받는 중… (몇 분 걸려요)' : '🖼 제품 정보 받기'}
      </button>
      {!busy && (
        <button className="link small" onClick={() => confirm('제품 정보를 지금 한 번 받을까요? (못 끝낸 건 아침 7시에 이어서)') && void run(true)} title="1쪽부터 다시 받기 (칸이 바뀌었을 때)">
          제품 정보 처음부터 다시
        </button>
      )}
      {/* 휴대폰에서도 보이게: 제품 정보 받은 상태 */}
      {!msg && meta && <span className="small tr-sku-status">{skuStatus(meta)}</span>}
      {msg && <span className="small tr-sku-msg">{msg}</span>}
    </>
  );
}

/** 분류 탭 › 로직: 추천이 어떻게 정해지는지 + 분류마다 반응하는 단어 · 코드 앞자리 · 헷갈리는 분류 (고른 기록으로 계산) */
function CatLogic({ picks, rows, onWord }: { picks: CatPick[]; rows: Cat[]; onWord: (w: string) => void }) {
  const seasonSet = useSkuSeason();
  const skuPaths = useSkuPaths();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const stats = useMemo(() => {
    // 같은 제품명은 하나로 (추천과 같게)
    const uniq = new Map(picks.filter((p) => p.ko && p.cat).map((p) => [p.ko.trim(), p]));
    const list = [...uniq.values()];
    const wordCat = new Map<string, Map<string, number>>(); // 단어 → 분류 → 제품 수
    const wordAll = new Map<string, number>();
    const preCat = new Map<string, Map<string, number>>(); // 코드 앞자리 → 분류 → 수
    const byCat = new Map<string, { n: number; season: number; pres: Map<string, number> }>();
    // SKU 분류 (대›중›소) → 수출 분류 수
    const pathCat = new Map<string, Map<string, number>>();
    for (const p of list) {
      const sp = p.code && skuPaths ? skuPaths.get(p.code.trim()) : undefined;
      if (sp) {
        const m = pathCat.get(sp) ?? new Map<string, number>();
        m.set(p.cat, (m.get(p.cat) ?? 0) + 1);
        pathCat.set(sp, m);
      }
      const c = byCat.get(p.cat) ?? { n: 0, season: 0, pres: new Map() };
      c.n++;
      if (seasonOfCode(seasonSet, p.code) === 'S') c.season++;
      if (p.pre) {
        c.pres.set(p.pre, (c.pres.get(p.pre) ?? 0) + 1);
        const m = preCat.get(p.pre) ?? new Map();
        m.set(p.cat, (m.get(p.cat) ?? 0) + 1);
        preCat.set(p.pre, m);
      }
      byCat.set(p.cat, c);
      for (const g of gramsOf(p.ko)) {
        if (!g.startsWith('w:')) continue; // 단어만 (2글자 묶음은 너무 많아서)
        const w = g.slice(2);
        if (w.length < 2) continue;
        wordAll.set(w, (wordAll.get(w) ?? 0) + 1);
        const m = wordCat.get(w) ?? new Map();
        m.set(p.cat, (m.get(p.cat) ?? 0) + 1);
        wordCat.set(w, m);
      }
    }
    // 분류마다: 반응하는 단어 (이 분류에 2번 이상 · 많이 나오고 이 분류로 많이 가는 순)
    const words = new Map<string, { w: string; n: number; prec: number }[]>();
    for (const [w, m] of wordCat) {
      const all = wordAll.get(w)!;
      for (const [cat, n] of m) {
        if (n < 2) continue;
        const arr = words.get(cat) ?? [];
        arr.push({ w, n, prec: n / all });
        words.set(cat, arr);
      }
    }
    for (const [cat, arr] of words) words.set(cat, arr.sort((a, b) => b.n * b.prec ** 2 - a.n * a.prec ** 2).slice(0, 24));
    // 코드 앞자리 대체 규칙: 앞자리 예시 3개 이상 · 60% 이상이 이 분류
    const preRule = new Map<string, { pre: string; n: number; all: number }[]>();
    for (const [pre, m] of preCat) {
      const all = [...m.values()].reduce((a, b) => a + b, 0);
      const [cat, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      if (all >= 3 && n / all >= 0.6) preRule.set(cat, [...(preRule.get(cat) ?? []), { pre, n, all }]);
    }
    // 분류마다: 이 분류로 많이 오는 SKU 분류 (그 SKU 분류 제품 중 이 분류 비율)
    const paths = new Map<string, { path: string; n: number; all: number }[]>();
    for (const [sp, m] of pathCat) {
      const all = [...m.values()].reduce((a, b) => a + b, 0);
      for (const [cat, n] of m) paths.set(cat, [...(paths.get(cat) ?? []), { path: sp, n, all }]);
    }
    for (const [cat, arr] of paths) paths.set(cat, arr.sort((a, b) => b.n - a.n).slice(0, 6));
    return { total: list.length, byCat, words, preRule, wordCat, paths };
  }, [picks, seasonSet, skuPaths]);
  const name = (k: string) => {
    const c = rows.find((x) => catKey(x) === k);
    return c ? `${c.mainName} › ${c.subName}` : '(분류표에 없음)';
  };
  const nq = q.trim().toLowerCase();
  const cats = (rows.length ? rows.map(catKey) : [...stats.byCat.keys()])
    .filter((k) => !nq || `${k} ${name(k)} ${(stats.words.get(k) ?? []).map((x) => x.w).join(' ')}`.toLowerCase().includes(nq))
    // 분류 코드 순 (01-01, 01-02 …)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <div className="tr-logic">
      <section className="tr-logic-how">
        <h3>추천은 이렇게 정해져요</h3>
        <ol>
          <li>
            <b>같은 제품명</b>을 고른 기록이 있으면 → 그 분류 그대로 (100%)
          </li>
          <li>
            <b>글자 유사도</b>: 제품명을 조각(단어 + 2글자씩)으로 나눠서, 기록된 제품명과 조각이 얼마나 겹치는지 0~1점으로 재요 (숫자 · 규격 mm/cm/g/매/개 등은 빼요).
            <br />
            예) 새 제품 "곰돌이 키링 파우치" = 곰돌이 · 키링 · 파우치 + 곰돌 · 돌이 · 키링 · 파우 · 우치 (8조각) / 기록 "곰돌이 키링" = 곰돌이 · 키링 + 곰돌 · 돌이 · 키링 (5조각) → 5조각이 다 겹치는데 길이가 달라서 조금 깎여 <b>약 0.88점</b>
            <br />
            분류마다 <b>제일 비슷한 제품 점수</b>에 <b>비슷한 제품이 여러 개면 조금 더</b> 얹어서, 가장 높은 분류를 추천해요. 0.2점도 안 되는 제품은 안 닮은 걸로 빼고, 제일 높은 게 0.3점도 안 되면 '글자로는 못 찾음' → 아래 SKU 분류 연결 · 코드 앞자리로 넘어가요.
          </li>
          <li>
            <b>보정</b>: ②에서 잰 제품마다 점수를 조금 올리거나 내려요. 같은 시즌끼리, 같은 코드대끼리는 같은 분류일 가능성이 높아서예요.
            <br />· 시즌 여부(제품 정보의 팀·분류에 '시즌')가 <b>같으면 점수 15% 올리고</b>, <b>다르면 30% 내려요</b>
            <br />· 제품코드 앞 2자리가 <b>같으면 15% 올리고</b>, <b>다르면 10% 내려요</b> (모르는 쪽이 있으면 그대로)
            <br />
            예) 0.88점짜리 기록이 시즌이 달라서 0.88 × 0.7 = 0.62 → 코드 앞자리는 같아서 0.62 × 1.15 = <b>0.71점</b>
          </li>
          <li>
            <b>SKU 분류 연결</b>: 제품 정보의 대›중›소분류가 같은 제품들(기록 3개 이상)이 간 수출 분류 비율 × 0.4 를 점수에 더해요 (소분류 기록이 적으면 대›중분류 5개 이상 × 0.25). 글자가 안 닮아도 그 분류 비율이 70% 이상이면 그 분류를 추천해요.
          </li>
          <li>
            <b>코드 앞자리 대체</b>: 글자로 못 찾으면 같은 코드 앞 2자리 제품(3개 이상) 중 60% 이상이 간 분류 (점수 30%)
          </li>
          <li className="muted">기록 800개 이상에 나오는 너무 흔한 글자 묶음은 후보 찾을 때 건너뛰어요. 고른 기록이 쌓일수록 정확해져요.</li>
        </ol>
      </section>
      <div className="tr-logic-tools">
        <input className="search" placeholder="🔍 분류 · 단어로 찾기 (예: 키링)" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">기록 {stats.total.toLocaleString()}개 (같은 제품명은 하나로) · 단어를 누르면 그 단어 들어간 제품을 봐요</span>
      </div>
      <div className="tr-logic-list">
        {cats.map((k) => {
          const c = stats.byCat.get(k);
          const ws = stats.words.get(k) ?? [];
          const rule = stats.preRule.get(k) ?? [];
          const pres = c ? [...c.pres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
          // 헷갈리는 분류: 이 분류의 주요 단어가 많이 가는 다른 분류
          const conf = new Map<string, number>();
          for (const x of ws.slice(0, 10)) for (const [o, n] of stats.wordCat.get(x.w) ?? []) if (o !== k) conf.set(o, (conf.get(o) ?? 0) + n);
          const confTop = [...conf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
          const isOpen = open === k;
          return (
            <section key={k} className={`tr-logic-row ${!c ? 'empty' : ''}`}>
              <button className="tr-logic-head" onClick={() => setOpen(isOpen ? null : k)}>
                <span className="tr-code">{k}</span>
                <b>{name(k)}</b>
                <span className="muted small">{c ? `기록 ${c.n.toLocaleString()}개` : '기록 없음 — 아직 추천 안 돼요'}</span>
                {c && c.season > 0 && <span className="tr-season">시즌 {Math.round((c.season / c.n) * 100)}%</span>}
                {rule.length > 0 && <span className="tr-logic-rule">코드 {rule.map((r) => r.pre).join(' · ')}… 대체</span>}
                <span className="tr-logic-words-mini">{ws.slice(0, 6).map((x) => x.w).join(' · ')}</span>
                <span className="muted">{isOpen ? '▴' : '▾'}</span>
              </button>
              {isOpen && c && (
                <div className="tr-logic-body">
                  <div>
                    <div className="tr-logic-label">반응하는 단어 (이 분류 제품 수 · 이 단어가 이 분류로 가는 비율)</div>
                    <div className="tr-logic-words">
                      {ws.length ? (
                        ws.map((x) => (
                          <button key={x.w} className={`tr-logic-word ${x.prec >= 0.8 ? 'strong' : x.prec < 0.5 ? 'weak' : ''}`} onClick={() => onWord(x.w)} title={`'${x.w}' 들어간 기록 중 ${Math.round(x.prec * 100)}% 가 이 분류`}>
                            {x.w} <small>{x.n} · {Math.round(x.prec * 100)}%</small>
                          </button>
                        ))
                      ) : (
                        <span className="muted small">아직 반복되는 단어가 없어요 (기록이 더 필요해요)</span>
                      )}
                    </div>
                    <div className="muted small">진한 색 = 거의 이 분류로만 가는 단어 (80%+) · 흐린 색 = 다른 분류로도 많이 가는 단어 (50% 밑)</div>
                  </div>
                  <div className="tr-logic-facts">
                    <div>
                      <span className="tr-logic-label">코드 앞자리</span> {pres.map(([p, n]) => `${p}… ${Math.round((n / c.n) * 100)}%`).join(' · ') || '없음'}
                    </div>
                    <div>
                      <span className="tr-logic-label">코드 대체 규칙</span>{' '}
                      {rule.length ? rule.map((r) => `${r.pre}… 제품은 글자로 못 찾으면 이 분류 (${r.n}/${r.all})`).join(' · ') : '없음 (글자 유사도로만)'}
                    </div>
                    <div>
                      <span className="tr-logic-label">연결된 SKU 분류 (대›중›소)</span>{' '}
                      {!skuPaths
                        ? '제품 정보를 받으면 보여요'
                        : (stats.paths.get(k) ?? []).length
                          ? (stats.paths.get(k) ?? []).map((x) => `${x.path} ${x.n}개 (그 분류의 ${Math.round((x.n / x.all) * 100)}%)`).join(' · ')
                          : '아직 없음'}
                    </div>
                    <div>
                      <span className="tr-logic-label">헷갈릴 수 있는 분류</span> {confTop.length ? confTop.map(([o, n]) => `${o} ${name(o)} (${n})`).join(' · ') : '거의 없음'}
                    </div>
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

/** 제품 정보 받은 상태 한 줄: 다 받았는지 · 이어 받는 중인지 */
function skuStatus(m: SkuMeta) {
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const err = m.nightError ? ` · ⚠ ${when(m.nightAt)} 받다가 멈춤: ${m.nightError}` : m.nightAt ? ` · 마지막 자동 받기 ${when(m.nightAt)}` : '';
  const all = m.apiTotal?.count ? ` / 전체 ${m.apiTotal.count.toLocaleString()}개` : m.apiTotal?.pages ? ` / 전체 ${m.apiTotal.pages}쪽` : '';
  if ((m.resumePage ?? 1) > 1) return `⏳ ${(m.partialCount ?? 0).toLocaleString()}개${all}까지 받음 · ${m.resumePage}쪽부터 아침 7시에 이어서 받아요${m.triedAt ? ` (마지막 ${when(m.triedAt)})` : ''}${err}`;
  if (m.at) return `✅ 제품 정보 ${(m.count ?? 0).toLocaleString()}개 다 받음 · ${when(m.at)}${m.noCat ? ` · 분류 빈 제품 ${m.noCat.toLocaleString()}개` : ''}`;
  return '아직 제품 정보를 안 받았어요';
}

/** 없는거 불러오기 진행 상황: 도는 중 / 멈춤(몇 %, 언제 이어지는지) / 다 훑음 */
/** 서버 functions/skuMissing.js 의 FILTER_VER 와 같게 (기준이 바뀌면 둘 다 올림) */
const FILTER_VER_CLIENT = 3;

function ScanProgress({ meta, total, busy }: { meta: MissingMeta; total: number; busy: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000); // 다른 사람이 돌리는 중인지 15초마다 다시 봄
    return () => clearInterval(t);
  }, []);
  const running = busy || (!!meta.lockUntil && Date.parse(meta.lockUntil) > Date.now());
  const full = meta.phase !== 'inc';
  const seen = Math.max(0, ((meta.page ?? 1) - 1) * 2000);
  const pct = full && total ? Math.min(99, Math.round((seen / total) * 100)) : 100;
  if (!meta.at && !running) return null;
  return (
    <div className={`tr-scan ${running ? 'run' : full ? 'pause' : 'done'}`}>
      <span className="tr-scan-state">{running ? '⏳ 지금 불러오는 중' : full ? '⏸ 멈춤' : '✓ 다 훑음'}</span>
      {full ? (
        <>
          <span className="tr-scan-bar" title={`${seen.toLocaleString()} / ${total ? total.toLocaleString() : '?'}개`}>
            <span style={{ width: `${pct}%` }} />
          </span>
          <span className="small">
            {meta.rescan ? '새 기준(재고 100 이하 · 수출제한 빼기)으로 ' : ''}전체 {total ? `${pct}% (${seen.toLocaleString()} / ${total.toLocaleString()}개)` : `${seen.toLocaleString()}개`} 봤어요
          </span>
          {!running && <span className="muted small">— ⬇ 없는거 불러오기를 누르면 이어서 해요 · 매일 아침 7시에 자동으로도 이어서 해요</span>}
        </>
      ) : (
        <span className="muted small">이제는 새로 등록된 제품만 봐요{meta.lastDropped ? ` · 지난번에 ${meta.lastDropped.toLocaleString()}개 뺐어요` : ''}</span>
      )}
    </div>
  );
}

/** 관리자 확인용: 지난번 불러오기에서 본 제품들 — 빈 칸 수 · 수출 대분류 값 · 회사 API 칸 이름 예시 */
function ApiCheck({ meta }: { meta: MissingMeta }) {
  const st = meta.lastStats;
  const sm = meta.lastSample;
  if (!st && !sm) return <span className="muted small">API 칸 확인: 다음 불러오기 뒤에 보여요</span>;
  const top = Object.entries(st?.lrgVals ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
  return (
    <details className="tr-apicheck">
      <summary className="small">🔍 API 칸 확인 (지난번 본 {st?.seen.toLocaleString() ?? 0}개)</summary>
      {st && (
        <p className="small">
          대분류 빈 것 <b>{st.lrgEmpty.toLocaleString()}</b> · 중분류 빈 것 <b>{st.middEmpty.toLocaleString()}</b> · 영문명 빈 것 <b>{st.engEmpty.toLocaleString()}</b>
        </p>
      )}
      {top.length > 0 && <p className="small muted">대분류 값: {top.map(([k, n]) => `${k} (${n.toLocaleString()})`).join(' · ')}</p>}
      {sm && (
        <div className="small">
          <div className="muted">
            {sm.lrgEmpty ? '대분류가 빈' : '예시'} 제품 {sm.code} 의 칸:
          </div>
          <code className="tr-apicheck-fields">{Object.entries(sm.fields).map(([k, v]) => `${k} = ${v || '(빈칸)'}`).join('\n')}</code>
        </div>
      )}
    </details>
  );
}
