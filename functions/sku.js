// 제품 정보 (이미지 · 팀 · 대/중/소분류): artbox getSkuList API → skuInfo/{제품코드 앞 4자리} 에 모아 저장
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
  return { key, header: String(d.header ?? 'X-API-Key').trim() || 'X-API-Key', url: String(d.url ?? BASE).trim() || BASE };
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
async function fetchPage(cfg, page, fetchImpl, { wait = sleep } = {}) {
  const u = new URL(cfg.url);
  u.searchParams.set('PAGE', String(page));
  u.searchParams.set('PAGE_SIZE', String(PAGE_SIZE));
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
  return listOf(body);
}

/** 한 줄 → { code, i, t, l, m, s } (칸 이름 대소문자 · 밑줄 달라도) */
export function normalize(it) {
  const pick = (re) => {
    const k = keyOf(it, re);
    return k ? String(it[k] ?? '').trim() : '';
  };
  const code = pick(/^(sku(cd|code|no)?|item(cd|code)|prod(uct)?(cd|code)|goods(cd|code)|code)$/i);
  return {
    code,
    i: pick(/^(imageurl|imgurl|image|img|thumbnail|thumburl)$/i),
    t: pick(/^teamname$/i),
    l: pick(/^largename$/i),
    m: pick(/^middlename$/i),
    s: pick(/^smallname$/i),
  };
}

/**
 * 모든 페이지 받아서 저장. 페이지 사이에 쉬고 (gapMs), 받은 쪽은 바로 저장 (중간에 멈춰도 남음).
 * 다 못 받고 멈추면 skuMeta/main.resumePage 에 다음 쪽을 적어 두고, 다음에 거기서부터 이어서 받음.
 */
/** 시즌품: 팀 · 대/중/소분류 이름 중 '시즌' 이 들어간 게 있으면 ('비시즌' 은 빼고) */
export const isSeasonSku = (n) => [n.t, n.l, n.m, n.s].some((x) => x && /시즌/.test(x) && !/비시즌/.test(x));

export async function syncSku(db, { fetchImpl = fetch, maxPages = 400, gapMs = 1500, budgetMs = 480000, wait = sleep } = {}) {
  const cfg = await skuCfg(db);
  const metaRef = db.doc('skuMeta/main');
  const meta = (await metaRef.get()).data() ?? {};
  const start = Number(meta.resumePage) > 1 ? Number(meta.resumePage) : 1;
  const t0 = Date.now();
  let pages = 0;
  let count = 0;
  let keys = meta.keys ?? [];
  let done = false;
  let stopped = '';
  let page = start;
  // 시즌품 목록: skuSeason/main.codes { 제품코드: true } (처음부터 받을 때 비우고 다시 채움)
  const seasonRef = db.doc('skuSeason/main');
  if (start === 1) await seasonRef.set({ codes: {}, at: new Date().toISOString() });
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
    if (page === 1 && list[0]) keys = Object.keys(list[0]).slice(0, 40);
    // 이 쪽의 제품을 앞 4자리 묶음 문서에 합쳐 저장 (다른 제품은 그대로)
    const chunks = new Map();
    const season = {};
    for (const it of list) {
      const n = normalize(it);
      if (!n.code) continue;
      if (isSeasonSku(n)) season[n.code] = true;
      const { code, ...info } = n;
      const p = code.slice(0, 4);
      if (!chunks.has(p)) chunks.set(p, {});
      chunks.get(p)[code] = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
      count++;
    }
    if (chunks.size) {
      const batch = db.batch();
      const at = new Date().toISOString();
      for (const [p, items] of chunks) batch.set(db.doc(`skuInfo/${p}`), { items, at }, { merge: true });
      if (Object.keys(season).length) batch.set(seasonRef, { codes: season, at }, { merge: true });
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
      ? { at, count: total, pages: page, keys, resumePage: 1, partialCount: 0, stopped: '' }
      : { ...meta, keys, resumePage: page, partialCount: total, stopped: stopped || '다 못 받음', triedAt: at },
  );
  return { count: total, pages, done, nextPage: done ? null : page, stopped, keys, at };
}
