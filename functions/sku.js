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

async function fetchPage(cfg, page, fetchImpl) {
  const u = new URL(cfg.url);
  u.searchParams.set('PAGE', String(page));
  u.searchParams.set('PAGE_SIZE', String(PAGE_SIZE));
  const res = await fetchImpl(u.toString(), { headers: { [cfg.header]: cfg.key, Accept: 'application/json' } });
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

export async function syncSku(db, { fetchImpl = fetch, maxPages = 400 } = {}) {
  const cfg = await skuCfg(db);
  const chunks = new Map(); // 앞4자리 → { 코드: info }
  let pages = 0;
  let count = 0;
  let keys = [];
  for (let page = 1; page <= maxPages; page++) {
    const list = await fetchPage(cfg, page, fetchImpl);
    pages++;
    if (page === 1 && list[0]) keys = Object.keys(list[0]).slice(0, 40);
    for (const it of list) {
      const n = normalize(it);
      if (!n.code) continue;
      const p = n.code.slice(0, 4);
      if (!chunks.has(p)) chunks.set(p, {});
      const { code, ...info } = n;
      // 빈 칸은 빼고 저장 (용량 줄이기)
      chunks.get(p)[code] = Object.fromEntries(Object.entries(info).filter(([, v]) => v));
      count++;
    }
    if (list.length < PAGE_SIZE) break;
  }
  if (!count) throw new Error(`제품을 하나도 못 읽었어요 (받은 칸: ${keys.join(', ') || '없음'})`);
  const at = new Date().toISOString();
  let batch = db.batch();
  let n = 0;
  for (const [p, items] of chunks) {
    batch.set(db.doc(`skuInfo/${p}`), { items, at });
    if (++n % 400 === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  await batch.commit();
  await db.doc('skuMeta/main').set({ at, count, pages, chunks: chunks.size, keys });
  return { count, pages, chunks: chunks.size, keys, at };
}
