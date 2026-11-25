// 제품 정보 (팀 · 대/중분류 · 이미지): 예전엔 getSkuList → 이제 getproductinfo_bulk (skuMissing.js) 가 skuInfo/{앞 5자리} 에 저장
//   (getSkuList 로 받던 syncSku · lookupSkus 는 안 씀 — IT실: bulk 하나로)
//   인증키: Firestore 콘솔 > secrets 컬렉션 > sku 문서 > apiKey 칸 (사이트에서는 못 읽음)
//           (선택) header 칸: 키를 보낼 헤더 이름 (없으면 X-API-Key) · url 칸: 주소 (없으면 아래 BASE)
//   저장: skuInfo/{앞4자리} = { items: { 제품코드: { i: imageUrl, t: teamName, l: largeName, m: middleName, s: smallName } }, at }
//         skuMeta/main = { at, count, pages, keys (첫 줄의 칸 이름들 — 확인용) }
const BASE = 'https://artbox.kr/api_ab/getSkuList.asp';
const PAGE_SIZE = 500;

const keyOf = (obj, re) => Object.keys(obj ?? {}).find((k) => re.test(k.replace(/[_\s-]/g, '')));

export async function skuCfg(db) {
  const d = (await db.doc('secrets/sku').get()).data() ?? {};
  const kf = keyOf(d, /^apikey$/i);
  const key = kf ? String(d[kf]).trim() : '';
  if (!key) throw new Error('secrets/sku 문서에 apiKey 칸이 없어요 (Firestore 콘솔에서 넣어 주세요)');
  return { key, header: String(d.header ?? 'X-API-Key').trim() || 'X-API-Key', url: String(d.url ?? BASE).trim() || BASE, codeParam: String(d.codeParam ?? '').trim() };
}

/** 응답에서 제품 목록 배열 찾기 ({ Infos: [...] } · { data: [...] } · [...] …) */
function listOf(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const k of ['Infos', 'infos', 'data', 'Data', 'list', 'List', 'items', 'Items', 'rows', 'result', 'Result']) if (Array.isArray(body[k])) return body[k];
  const arr = Object.values(body).find((v) => Array.isArray(v));
  if (arr) return arr;
  // { data: { list: [...] } } 처럼 한 겹 더
  for (const v of Object.values(body)) if (v && typeof v === 'object' && !Array.isArray(v)) {
    const inner = listOf(v);
    if (inner.length) return inner;
  }
  return [];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export class RateLimited extends Error {}

/** 한 페이지. 429 (너무 잦음) · 503 이면 기다렸다 다시 (Retry-After 를 따르고, 없으면 5 · 15 · 30 · 60초) */
async function fetchPage(cfg, page, fetchImpl, { wait = sleep, extra = {}, size = PAGE_SIZE } = {}) {
  const u = new URL(cfg.url);
  u.searchParams.set('PAGE', String(page));
  u.searchParams.set('PAGE_SIZE', String(size));
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, String(v));
  const backoff = [5000, 15000, 30000, 60000];
  let res;
  for (let t = 0; ; t++) {
    res = await fetchImpl(u.toString(), { headers: { [cfg.header]: cfg.key, Accept: 'application/json' } });
    if (res.status !== 429 && res.status !== 503) break;
    if (t >= backoff.length) throw new RateLimited(`getSkuList ${res.status} — API 가 요청이 너무 잦다고 막았어요 (${page}쪽에서 멈춤)`);
    const ra = Number(res.headers?.get?.('retry-after'));
    await wait(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120000) : backoff[t]);
  }
  if (!res.ok) throw new Error(`getSkuList ${res.status}${res.status === 401 || res.status === 403 ? ' (키 확인)' : ''}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`getSkuList: JSON 이 아님 (${text.slice(0, 80)})`);
  }
  if (body && body.success === false && !listOf(body).length) return [];
  // 전체 개수를 같이 주면 기억 (totalCount · total_cnt · totalPage …)
  const tot = findTotal(body);
  if (tot) lastTotal = tot;
  return listOf(body);
}
let lastTotal = null;
function findTotal(body, depth = 0) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || depth > 2) return null;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    const key = k.replace(/[_\s-]/g, '').toLowerCase();
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      if (/^(total(count|cnt|rows|records|items)?|totcnt|count|recordcount|rowcount)$/.test(key)) out.count = n;
      if (/^(totalpages?|totpage|pagecount|lastpage)$/.test(key)) out.pages = n;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, findTotal(v, depth + 1) ?? {});
  }
  return out.count || out.pages ? out : null;
}

/** 한 줄 → { code, i, t, l, m, s } (칸 이름 대소문자 · 밑줄 달라도) */
/** 안쪽 묶음까지 한 겹으로 펼치기 ({ category: { teamName } } → teamName · 배열이면 첫 칸) */
/** 글자로 된 JSON ('{"teamName":…}') 이면 풀어서 */
const unjson = (v) => {
  if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
export function flatten(it, depth = 0, out = {}) {
  for (const [k, v0] of Object.entries(it ?? {})) {
    const v = unjson(v0);
    const x = Array.isArray(v) && v.length && typeof v[0] === 'object' ? v[0] : v;
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      if (depth < 3) flatten(x, depth + 1, out);
    } else if (!(k in out) || out[k] === '' || out[k] == null) out[k] = x;
  }
  return out;
}
/** 확인용: 칸 이름들 (안쪽은 '바깥.안쪽') */
export function keyPaths(it, pre = '', depth = 0) {
  const out = [];
  for (const [k, v0] of Object.entries(it ?? {})) {
    const v = unjson(v0);
    const x = Array.isArray(v) && v.length && typeof v[0] === 'object' ? v[0] : v;
    if (x && typeof x === 'object' && !Array.isArray(x) && depth < 3) out.push(...keyPaths(x, `${pre}${k}.`, depth + 1));
    else out.push(`${pre}${k}`);
  }
  return out;
}

export function normalize(raw) {
  const it = flatten(raw);
  const pick = (re) => {
    const k = keyOf(it, re);
    return k ? String(it[k] ?? '').trim() : '';
  };
  const code = pick(/^(sku(cd|code|no)?|item(cd|code)|prod(uct)?(cd|code)|goods(cd|code)|code)$/i);
  return {
    code,
    i: pick(/^(imageurl|imgurl|image|img|thumbnail|thumburl)$/i),
    t: pick(/^team(name|nm)$/i),
    l: pick(/^(large|lclass|lcls|big)(name|nm)$/i),
    m: pick(/^(middle|mid|mclass|mcls)(name|nm)$/i),
    s: pick(/^(small|sclass|scls)(name|nm)$/i),
  };
}

/**
 * 모든 페이지 받아서 저장. 페이지 사이에 쉬고 (gapMs), 받은 쪽은 바로 저장 (중간에 멈춰도 남음).
 * 다 못 받고 멈추면 skuMeta/main.resumePage 에 다음 쪽을 적어 두고, 다음에 거기서부터 이어서 받음.
 */
/** 묶음 문서 읽기: 새 모양 data(JSON 글자) · 예전 모양 지도(map 칸) 둘 다. asKeys 면 키 목록 */
function readJson(snap, oldField, asKeys = false) {
  const d = snap?.exists === false ? undefined : snap?.data?.();
  let v = {};
  if (d && typeof d.data === 'string') {
    try {
      v = JSON.parse(d.data);
    } catch {
      v = {};
    }
  } else if (d && d[oldField] && typeof d[oldField] === 'object') v = d[oldField];
  if (asKeys) return Array.isArray(v) ? v : Object.keys(v);
  return Array.isArray(v) ? {} : v;
}

/** skuPath 문서 → { 제품코드: 분류 } (예전 모양 · 새 모양 둘 다) */
function pathMapOf(snap) {
  const d = snap?.exists === false ? undefined : snap?.data?.();
  if (!d) return {};
  if (typeof d.data === 'string') {
    try {
      const v = JSON.parse(d.data);
      if (v && Array.isArray(v.p) && v.c) return Object.fromEntries(Object.entries(v.c).map(([k, i]) => [k, v.p[i]]));
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }
  return d.codes && typeof d.codes === 'object' ? d.codes : {};
}

/** 시즌품: 팀 · 대/중/소분류 이름 중 '시즌' 이 들어간 게 있으면 ('비시즌' 은 빼고) */
export const isSeasonSku = (n) => [n.t, n.l, n.m, n.s].some((x) => x && /시즌/.test(x) && !/비시즌/.test(x));

export async function syncSku(db, { fetchImpl = fetch, maxPages = 400, gapMs = 1500, budgetMs = 480000, wait = sleep, restart = false } = {}) {
  const cfg = await skuCfg(db);
  const metaRef = db.doc('skuMeta/main');
  const meta = (await metaRef.get()).data() ?? {};
  const start = !restart && Number(meta.resumePage) > 1 ? Number(meta.resumePage) : 1;
  const t0 = Date.now();
  let pages = 0;
  let count = 0;
  let keys = meta.keys ?? [];
  let done = false;
  let stopped = '';
  let page = start;
  let noCat = start > 1 ? Number(meta.noCat ?? 0) : 0;
  const noCatSamples = start > 1 ? [...(meta.noCatSamples ?? [])].slice(0, 3) : [];
  // 시즌품 목록: skuSeason/main.data = '["제품코드", …]' (처음부터 받을 때 비우고 다시 채움)
  const seasonRef = db.doc('skuSeason/main');
  const seasonAll = new Set(start === 1 ? [] : readJson(await seasonRef.get(), 'codes', true));
  for (; page < start + maxPages; page++) {
    if (Date.now() - t0 > budgetMs) {
      stopped = '시간이 다 돼서';
      break;
    }
    let list;
    try {
      list = await fetchPage(cfg, page, fetchImpl, { wait });
    } catch (e) {
      if (e instanceof RateLimited) {
        stopped = e.message;
        break;
      }
      throw e;
    }
    pages++;
    if (page === start && list[0]) keys = keyPaths(list[0]).slice(0, 60);
    // 이 쪽의 제품을 앞 4자리 묶음 문서에 합쳐 저장 (다른 제품은 그대로)
    const chunks = new Map();
    const season = {};
    // 제품코드 → 'SKU 대분류›중분류›소분류' (수출 분류 추천에 참고) : skuPath/{앞 2자리}.codes
    const paths = new Map();
    for (const it of list) {
      const n = normalize(it);
      if (!n.code) continue;
      if (isSeasonSku(n)) season[n.code] = true;
      if (!n.l && !n.m && !n.s) {
        // 확인용: 분류가 비어서 온 제품 수 · 예시 3개 (category 원래 모양)
        noCat++;
        if (noCatSamples.length < 3) noCatSamples.push({ code: n.code, category: JSON.stringify(it.category ?? it.Category ?? null).slice(0, 300) });
      } else {
        const p2 = n.code.slice(0, 2);
        if (!paths.has(p2)) paths.set(p2, {});
        paths.get(p2)[n.code] = [n.l, n.m, n.s].join('›');
      }
      const { code, ...info } = n;
      const p = code.slice(0, 5); // 앞 5자리 묶음 (4자리 묶음은 1MB 를 넘는 게 있어서)
      if (!chunks.has(p)) chunks.set(p, {});
      chunks.get(p)[code] = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
      count++;
    }
    // 묶음 문서는 글자 한 칸(JSON)으로 저장 — 칸이 수천 개인 지도(map)로 두면 Firestore 색인 한도(문서당 4만)에 걸림
    //   이미 있는 묶음은 읽어서 합친 뒤 통째로 다시 씀
    if (chunks.size || paths.size || Object.keys(season).length || page === start) {
      const at = new Date().toISOString();
      const batch = db.batch();
      for (const [p, items] of chunks) {
        const ref = db.doc(`skuInfo/${p}`);
        const old = readJson(await ref.get(), 'items');
        batch.set(ref, { data: JSON.stringify({ ...old, ...items }), at });
      }
      for (const [p2, codes] of paths) {
        // 같은 분류 글자를 제품마다 반복하지 않게: { p: [분류들], c: { 제품코드: 분류 번호 } }
        const ref = db.doc(`skuPath/${p2}`);
        const merged = { ...pathMapOf(await ref.get()), ...codes };
        const list = [...new Set(Object.values(merged))];
        const idx = new Map(list.map((x, i) => [x, i]));
        const c = Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, idx.get(v)]));
        batch.set(ref, { data: JSON.stringify({ p: list, c }), at });
      }
      for (const c of Object.keys(season)) seasonAll.add(c);
      batch.set(seasonRef, { data: JSON.stringify([...seasonAll]), at });
      await batch.commit();
    }
    if (list.length < PAGE_SIZE) {
      done = true;
      break;
    }
    await wait(gapMs);
  }
  if (!count && start === 1 && !stopped) throw new Error(`제품을 하나도 못 읽었어요 (받은 칸: ${keys.join(', ') || '없음'})`);
  const at = new Date().toISOString();
  const total = (start > 1 ? Number(meta.partialCount ?? 0) : 0) + count;
  await metaRef.set(
    done
      ? { at, count: total, pages: page, keys, resumePage: 1, partialCount: 0, stopped: '', noCat, noCatSamples, apiTotal: lastTotal ?? meta.apiTotal ?? null }
      : { ...meta, keys, resumePage: page, partialCount: total, stopped: stopped || '다 못 받음', triedAt: at, noCat, noCatSamples, apiTotal: lastTotal ?? meta.apiTotal ?? null },
  );
  return { count: total, pages, done, nextPage: done ? null : page, stopped, keys, at, noCat, noCatSamples };
}

// ---------- 엑셀에서 정보가 없는 제품코드만 하나씩 찾아오기 ----------
//   제품코드로 찾는 칸 이름: secrets/sku 의 codeParam (있으면) → 없으면 흔한 이름들을 한 번씩 해 보고
//   맞는 제품이 돌아오는 이름을 skuMeta/main.codeParam 에 기억 (다음부터는 그것만)
//   이미 받아 둔 정보가 다 있는 코드(이미지 · 팀 · 대/중/소분류)는 안 물음. 하나라도 비었으면 다음에 또 물어봄
//   (새 제품은 사진이 1~2주 뒤에 올라오기도 해서) — 같은 날 같은 코드를 두 번 묻지는 않음 (skuMiss/main) (회사 API 부담 줄이기)
const CODE_PARAMS = ['SKU_CODE', 'skuCode', 'SKU_CD', 'sku_code', 'SKU', 'sku', 'CODE', 'code', 'SEARCH_SKU', 'KEYWORD', 'SEARCH_WORD', 'searchWord'];
const LOOKUP_MAX = 300;

/** 제품 정보 묶어서 저장 (skuInfo · skuPath · skuSeason 에 합침) */
export async function storeItems(db, ns) {
  const at = new Date().toISOString();
  const chunks = new Map();
  const paths = new Map();
  const season = [];
  for (const n of ns) {
    if (isSeasonSku(n)) season.push(n.code);
    if (n.l || n.m || n.s) {
      const p2 = n.code.slice(0, 2);
      if (!paths.has(p2)) paths.set(p2, {});
      paths.get(p2)[n.code] = [n.l, n.m, n.s].join('›');
    }
    const { code, ...info } = n;
    const p = code.slice(0, 5);
    if (!chunks.has(p)) chunks.set(p, {});
    chunks.get(p)[code] = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
  }
  // 한 번에 500개 넘게 쓰면 안 돼서 400개마다 나눠 씀 (bulk 로 한 쪽 2,000개씩 받으면 묶음이 많음)
  let batch = db.batch();
  let ops = 0;
  const put = async (ref, v) => {
    batch.set(ref, v);
    if (++ops >= 400) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  };
  for (const [p, items] of chunks) {
    const ref = db.doc(`skuInfo/${p}`);
    await put(ref, { data: JSON.stringify({ ...readJson(await ref.get(), 'items'), ...items }), at });
  }
  for (const [p2, codes] of paths) {
    const ref = db.doc(`skuPath/${p2}`);
    const merged = { ...pathMapOf(await ref.get()), ...codes };
    const list = [...new Set(Object.values(merged))];
    const idx = new Map(list.map((x, i) => [x, i]));
    await put(ref, { data: JSON.stringify({ p: list, c: Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, idx.get(v)])) }), at });
  }
  if (season.length) {
    const ref = db.doc('skuSeason/main');
    await put(ref, { data: JSON.stringify([...new Set([...readJson(await ref.get(), 'codes', true), ...season])]), at });
  }
  if (ops) await batch.commit();
}

/** 필요한 정보가 다 있는지: 팀 · 대/중분류 (bulk 에는 이미지 · 소분류가 없을 수 있음) */
export const isComplete = (n) => !!(n && n.t && n.l && n.m);

/** 이 이름으로 code 를 찾으면 그 제품이 (몇 개 안에) 돌아오는지 */
async function tryCode(cfg, param, code, fetchImpl, wait) {
  const list = await fetchPage(cfg, 1, fetchImpl, { wait, extra: { [param]: code }, size: 20 });
  const ns = list.map(normalize).filter((n) => n.code);
  const hit = ns.find((n) => n.code === code);
  // 칸 이름을 무시하고 아무 제품이나 돌려주는 경우는 '찾기'가 아님
  return hit && ns.length <= 10 ? hit : null;
}

export async function lookupSkus(db, codes0, { fetchImpl = fetch, gapMs = 1000, wait = sleep, budgetMs = 240000 } = {}) {
  const cfg = await skuCfg(db);
  const metaRef = db.doc('skuMeta/main');
  const meta = (await metaRef.get()).data() ?? {};
  const missRef = db.doc('skuMiss/main');
  const miss = readJson(await missRef.get(), 'codes');
  // 찾는 칸 이름을 못 찾았던 적이 있으면 (codeParam 을 직접 넣기 전까지) 회사 API 에 안 물음
  if (!cfg.codeParam && !meta.codeParam && meta.lookupUnsupported) return { asked: 0, found: 0, none: 0, left: 0, unsupported: true };
  const day = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10); // 한국 날짜
  const todayK = day(new Date().toISOString());
  const all = [...new Set(codes0.map((c) => String(c ?? '').trim()).filter((c) => /^[0-9A-Za-z-]{4,20}$/.test(c)))];
  // 받아 둔 정보 읽기 (앞 5자리 묶음 + 예전 4자리 묶음)
  const have = {};
  for (const p of [...new Set(all.flatMap((c) => [c.slice(0, 5), c.slice(0, 4)]))]) Object.assign(have, readJson(await db.doc(`skuInfo/${p}`).get(), 'items'));
  const want = all.filter((c) => !isComplete(have[c]) && !(miss[c] && day(miss[c]) === todayK));
  const codes = want.slice(0, LOOKUP_MAX);
  let param = cfg.codeParam || meta.codeParam || '';
  const found = [];
  const none = [];
  let stopped = '';
  const t0 = Date.now();
  // 1) 찾는 칸 이름을 아직 모르면: 앞의 코드 3개까지로 이름들을 한 번씩 해 봄
  if (!param && codes.length) {
    outer: for (const code of codes.slice(0, 3)) {
      for (const p of CODE_PARAMS) {
        const hit = await tryCode(cfg, p, code, fetchImpl, wait).catch(() => null);
        await wait(gapMs);
        if (hit) {
          param = p;
          found.push(hit);
          await metaRef.set({ codeParam: p }, { merge: true });
          break outer;
        }
      }
      none.push(code);
    }
    if (!param) {
      await metaRef.set({ lookupAt: new Date().toISOString(), lookupNote: '제품코드로 찾는 칸을 못 찾았어요', lookupUnsupported: true }, { merge: true });
      return { asked: codes.length, found: 0, none: 0, left: want.length, unsupported: true };
    }
  }
  // 2) 남은 코드 하나씩 (1초씩 쉬며)
  const doneSet = new Set([...found.map((n) => n.code), ...none]);
  for (const code of codes) {
    if (doneSet.has(code)) continue;
    if (Date.now() - t0 > budgetMs) {
      stopped = '시간이 다 돼서';
      break;
    }
    let hit;
    try {
      hit = await tryCode(cfg, param, code, fetchImpl, wait);
    } catch (e) {
      if (e instanceof RateLimited) {
        stopped = e.message;
        break;
      }
      throw e;
    }
    if (hit) found.push(hit);
    else none.push(code);
    doneSet.add(code);
    await wait(gapMs);
  }
  if (found.length) await storeItems(db, found);
  const at = new Date().toISOString();
  // 다 채워진 건 잊고 (다시 물을 일 없음), 비었거나 못 찾은 건 오늘 물어봤다고만 적어 둠 → 내일 이후 또 물음
  const got = new Map(found.map((n) => [n.code, n]));
  for (const c of doneSet) {
    if (isComplete(got.get(c))) delete miss[c];
    else miss[c] = at;
  }
  await missRef.set({ data: JSON.stringify(miss), at });
  await metaRef.set({ lookupAt: at, lookupNote: `${found.length}개 찾음 · ${none.length}개 없음` }, { merge: true });
  return { asked: doneSet.size, found: found.length, none: none.length, left: want.length - doneSet.size, stopped, codeParam: param };
}
