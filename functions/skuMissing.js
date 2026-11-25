// 번역: 수출 분류 · 영문명이 빈 제품 목록 (모두가 같이 봄)
//   ⬇ 없는거 불러오기 (bulk: getproductinfo_bulk.asp?page=&page_size=)
//     처음 한 번: 전부 훑으며 빈 것만 저장 · 등록일(reg_date) 순서도 확인
//     그 뒤: 지난번 가장 늦은 등록일 이후 제품만 (등록일 순서대로 앞쪽 / 뒤쪽 몇 쪽만)
//   🔄 새로고침 (bulk ?SKU_CODE= 앞자리 검색): 채우고 있는 코드만 다시 보고, 다 채워졌으면 목록에서 뺌
//   제품 정보 (팀 · 대/중분류)도 여기서 같이 skuInfo 에 저장 (getSkuList · getproductinfo 개별은 안 씀 — IT실 안내)
//   회사 API 제한: 1분에 30번 (API마다) · 한 쪽 최대 2,000개 → 부를 때마다 2.1초 이상 쉼
//   저장: skuMissing/h000~h255 (제품코드를 고르게 나눈 칸) = {  (예전 앞 2자리 문서는 다음 실행 때 옮김) data: '{"코드":[닉네임, 구분, 대분류, 중분류, 영문명, 등록일]}' }
//         skuMissing/_meta = { phase, page, order, lastReg, lastPage, count, at, ... }
import { skuCfg, RateLimited, storeItems, isComplete } from './sku.js';

const BULK = 'https://ex.artbox.kr/api/getproductinfo_bulk.asp';
const SIZE = 2000;
const GAP = 2100; // 1분 30번 아래로
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const META = 'skuMissing/_meta';
/** 키: secrets/sku 의 exKey · exHeader (새 API 키가 다르면) → 없으면 기존 apiKey · header */
//   키가 거절되면(401 · 403) 다른 키로 다시: exKey → 제품 키(apiKey) → 주문(ERP) 키 — call() 이 alts 를 차례로 씀
export async function exCfg(db, sec) {
  const hdr = String(sec.exHeader ?? sec.header ?? 'X-API-Key').trim() || 'X-API-Key';
  const list = [];
  if (sec.exKey) list.push({ key: String(sec.exKey).trim(), header: hdr });
  try {
    const c = await skuCfg(db);
    list.push({ key: c.key, header: String(sec.exHeader ?? c.header).trim() || c.header });
  } catch {
    /* 제품 키가 없어도 됨 */
  }
  const erp = (await db.doc('secrets/erp').get()).data() ?? {};
  const ef = Object.keys(erp).find((k) => k.replace(/[_\s-]/g, '').toLowerCase() === 'apikey');
  if (ef && erp[ef]) list.push({ key: String(erp[ef]).trim(), header: 'X-API-Key' });
  const uniq = list.filter((x, i) => x.key && list.findIndex((y) => y.key === x.key && y.header === x.header) === i);
  if (!uniq.length) throw new Error('회사 API 키가 없어요 (secrets/sku 또는 secrets/erp)');
  const [first, ...alts] = uniq;
  return { ...first, alts, tried: uniq.length };
}

/** 응답에서 제품 목록 */
export function listOf(body) {
  if (Array.isArray(body)) return body;
  if (!body || typeof body !== 'object') return [];
  for (const v of Object.values(body)) if (Array.isArray(v)) return v;
  for (const v of Object.values(body))
    if (v && typeof v === 'object') {
      const l = listOf(v);
      if (l.length) return l;
    }
  // 개별 조회가 제품 하나를 그대로 돌려주는 경우
  return Object.keys(body).some((k) => /sku/i.test(k)) ? [body] : [];
}
/** 안쪽까지 펼친 칸 이름 (밑줄 · 점 빼고 소문자) → 값. 글자로 된 JSON 도 풀어서 */
export function flat(obj, pre = '', out = {}, depth = 0) {
  for (const [k, v0] of Object.entries(obj ?? {})) {
    let v = v0;
    if (typeof v === 'string' && /^\s*[{[]/.test(v)) {
      try {
        v = JSON.parse(v);
      } catch {
        /* 그대로 */
      }
    }
    const key = `${pre}${k}`.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') v = v[0];
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flat(v, `${pre}${k}`, out, depth + 1);
    else out[key] = v;
  }
  return out;
}
const str = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pick = (f, re) => {
  const k = Object.keys(f).find((x) => re.test(x));
  return k ? str(f[k]) : '';
};
/** 한 줄 → { code, nick, type, lrg, midd, eng, reg } (snake_case · camelCase · 안쪽 묶음 다 됨) */
export function rowOf(raw) {
  const f = flat(raw);
  return {
    code: pick(f, /^(sku)?(code|cd)$|^skucode$/),
    nick: pick(f, /^sku(nick|nickname)(name)?kor$|nicknamekor$/),
    kor: pick(f, /^sku(name)?kor$|^skunamekor$/),
    type: pick(f, /^skutype(name|nm)$/),
    // 수출 대/중분류: export_ 로 시작하는 칸을 먼저 (일반 category_lrg_code 와 헷갈리지 않게)
    lrg: pick(f, /^export(info)?(export)?categor(y)?(lrg|large)(code|cd)$/) || pick(f, /^(export(info)?)?(export)?categor(y)?(lrg|large)(code|cd)$/),
    midd: pick(f, /^export(info)?(export)?categor(y)?(midd|middle|mid)(code|cd)$/) || pick(f, /^(export(info)?)?(export)?categor(y)?(midd|middle|mid)(code|cd)$/),
    eng: pick(f, /^sku(name)?eng$|^skunameeng$/),
    reg: pick(f, /^(sku)?regdate$|^regdt$|regdate$/),
    qty: pick(f, /^physicalqty$|physicalqty$/), // 실재고
    exp: pick(f, /^exportyn$|exportyn$|^export(gb|gubun|div|type)(cd|code)?$/), // 수출 가능 여부 · 수출구분
  };
}
/** 제품 정보 (번역 화면 마우스 올리면 · 시즌 구분): category_team_name · category_lrg_name · category_midd_name (+ 소분류 · 이미지 칸이 있으면) */
export function infoOf(raw) {
  const f = flat(raw);
  return {
    code: pick(f, /^(sku)?(code|cd)$|^skucode$/),
    t: pick(f, /^categor(y)?team(name|nm)$/) || pick(f, /^team(name|nm)$/),
    l: pick(f, /^categor(y)?(lrg|large)(name|nm)$/),
    m: pick(f, /^categor(y)?(midd|middle|mid)(name|nm)$/),
    s: pick(f, /^categor(y)?(sml|small|sm)(name|nm)$/),
    i: pick(f, /^(sku)?(imageurl|imgurl|image|img|thumbnail|thumburl|mainimg(url)?)$/),
  };
}
/** 비었다 = 수출 대분류 · 중분류 · 영문명 중 하나라도 비어 있음 */
export const isMissing = (r) => !r.lrg || !r.midd || !r.eng;
/** 번역할 필요 없는 제품: 실재고(physical_qty) 100개 이하 · 수출제한(export_yn = 수출제한 / N)
 *  칸이 아예 없으면 거르지 않음 */
export const isExcluded = (r) => {
  const q = str(r.qty).replace(/,/g, '');
  if (q !== '' && Number.isFinite(Number(q)) && Number(q) <= 100) return true;
  const e = str(r.exp);
  // ERP 수출구분: 01 = 수출제한 (코드) · 글자로 오면 '수출제한' · '수출불가능' · '불가' · '금지' · Y/N 이면 N
  //   ('수출가능' 은 통과 — '불가' 가 없음)
  return /제한|불가|금지/.test(e) || /^n$/i.test(e) || e === '01';
};
/** 목록에 둘 제품 = 비어 있고 + 거를 것이 아님 */
const wanted = (r) => isMissing(r) && !isExcluded(r);
// 거르는 기준이 바뀌면 숫자를 올림 → 다음 불러오기 때 처음부터 다시 훑으며 이미 있는 것도 다시 거름
const FILTER_VER = 4; // 2: 재고 100 이하 · 수출제한 글자 / 3: 수출구분 코드 01 도 / 4: 제품 정보(팀 · 분류)도 bulk 에서 같이 받음 → 한 번 전부 훑기
/** 등록일 비교용 (2026-11-20 · 20261120 · 2026-11-20 13:01:02 → 20261120130102) */
const regKey = (s) => str(s).replace(/[^\d]/g, '').padEnd(14, '0').slice(0, 14);

export async function call(url, cfg, params, fetchImpl, wait, last) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const backoff = [5000, 15000, 30000, 60000];
  for (let t = 0; ; t++) {
    const since = Date.now() - last.at;
    if (since < GAP) await wait(GAP - since);
    last.at = Date.now();
    const res = await fetchImpl(u.toString(), { headers: { [cfg.header]: cfg.key, Accept: 'application/json' } });
    if (res.status === 429 || res.status === 503) {
      if (t >= backoff.length) throw new RateLimited(`회사 API 가 요청이 너무 잦다고 막았어요 (${res.status})`);
      await wait(backoff[t]);
      continue;
    }
    // 키가 안 맞으면 다음 키로 (찾은 키는 이번 실행 동안 계속 씀)
    if ((res.status === 401 || res.status === 403) && cfg.alts?.length) {
      const next = cfg.alts.shift();
      cfg.key = next.key;
      cfg.header = next.header;
      t--;
      continue;
    }
    if (!res.ok) throw new Error(`회사 API ${res.status}${res.status === 401 || res.status === 403 ? ` (키 확인 · 키 ${cfg.tried ?? 1}개 모두 거절)` : ''}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`회사 API: JSON 이 아님 (${text.slice(0, 80)})`);
    }
  }
}

/** 저장된 빈 제품 목록 읽기 · 쓰기 (앞 2자리 묶음) */
async function readList(db) {
  const snap = await db.collection('skuMissing').get();
  const all = {};
  snap.docs.forEach((d) => {
    if (d.id === '_meta') return;
    try {
      Object.assign(all, JSON.parse(d.get('data') ?? '{}'));
    } catch {
      /* 무시 */
    }
  });
  return all;
}
// 문서 하나 = 제품코드를 256 칸에 고르게 나눈 묶음 h000 ~ h255 (Firestore 문서는 1MB 까지 · 앞 2자리 묶음은 한쪽에 몰려 넘쳤음)
//   한 칸 ≈ 목록 전체 / 256 → 수백만 개까지 1MB 아래
const shardOf = (c) => {
  let h = 0;
  for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `h${String(h % 256).padStart(3, '0')}`;
};
const isShard = (id) => id !== '_meta';
const isNewShard = (id) => /^h\d{3}$/.test(id);
/** 저장해 둔 재고 · 수출구분(7 · 8번째 칸)으로 지금 기준에 걸리는 제품을 목록에서 뺌 — 회사 API 다시 안 부름
 *  (기준만 바뀌었을 때 처음부터 다시 훑지 않아도 되게) */
async function pruneStored(db) {
  const all = await readList(db);
  const drop = {};
  for (const [code, a] of Object.entries(all)) {
    if (!Array.isArray(a) || a.length < 8) continue; // 재고 · 수출구분을 아직 안 적어 둔 예전 줄 → 다시 훑을 때 거름
    if (isExcluded({ qty: a[6], exp: a[7] })) drop[code] = null;
  }
  if (Object.keys(drop).length) await writeChanged(db, drop);
  return Object.keys(drop).length;
}
/** 예전 앞 2자리 문서 → 4자리 문서로 옮기고 지움 (한 번만, 그 뒤엔 할 일 없음) */
async function migrateShards(db) {
  const snap = await db.collection('skuMissing').get();
  const old = snap.docs.filter((d) => isShard(d.id) && !isNewShard(d.id));
  for (const d of old) {
    let v = {};
    try {
      v = JSON.parse(d.get('data') ?? '{}');
    } catch {
      v = {};
    }
    await d.ref.delete();
    if (Object.keys(v).length) await writeChanged(db, v);
  }
  return old.length;
}
async function writeChanged(db, changes) {
  // changes: { code: row | null }
  const by = new Map();
  for (const [c, v] of Object.entries(changes)) {
    const p = shardOf(c);
    if (!by.has(p)) by.set(p, {});
    by.get(p)[c] = v;
  }
  const at = new Date().toISOString();
  for (const [p, ch] of by) {
    const ref = db.doc(`skuMissing/${p}`);
    let cur = {};
    try {
      cur = JSON.parse((await ref.get()).get('data') ?? '{}');
    } catch {
      cur = {};
    }
    for (const [c, v] of Object.entries(ch)) {
      if (v) cur[c] = v;
      else delete cur[c];
    }
    if (Object.keys(cur).length) await ref.set({ data: JSON.stringify(cur), at });
    else await ref.delete().catch(() => {});
  }
}
// 재고 · 수출구분도 같이 적어 둠 → 다음에 거르는 기준이 바뀌어도 목록 안의 제품은 다시 안 불러오고 바로 거를 수 있게
const packRow = (r) => [r.nick || r.kor, r.type, r.lrg, r.midd, r.eng, r.reg, r.qty ?? '', r.exp ?? ''];

/**
 * ⬇ 없는거 불러오기. 한 번에 최대 budgetMs (함수 시간 안에서) — 다 못 하면 다음에 이어서 (page 기억)
 */
export async function loadMissing(db, { fetchImpl = fetch, wait = sleep, budgetMs = 470000, cfgUrl } = {}) {
  const sec = (await db.doc('secrets/sku').get()).data() ?? {};
  const cfg0 = await exCfg(db, sec);
  const cfg = { ...cfg0, bulk: String(sec.bulkUrl ?? cfgUrl ?? BULK).trim() || BULK };
  const metaRef = db.doc(META);
  const meta = (await metaRef.get()).data() ?? {};
  // 다른 사람이 지금 불러오는 중이면 기다림 (회사 API 제한을 같이 써서)
  if (meta.lockUntil && Date.parse(meta.lockUntil) > Date.now()) return { busy: true, ...publicMeta(meta) };
  const lockUntil = new Date(Date.now() + budgetMs + 60000).toISOString();
  await metaRef.set({ lockUntil }, { merge: true });
  await migrateShards(db); // 예전 앞 2자리 묶음 → 고르게 나눈 칸
  const pruned = await pruneStored(db); // 저장된 값으로 바로 거르기 (수출불가능 등)
  const t0 = Date.now();
  const last = { at: 0 };
  const changes = {};
  let added = 0;
  let dropped = pruned; // 목록에서 뺀 수 (저장된 값으로 바로 거른 것 포함)
  let scanned = 0;
  let stopped = '';
  const m = { ...meta };
  // 거르는 기준이 바뀌었으면: 처음부터 다시 훑기 (이미 불러온 것도 새 기준으로 정리)
  if ((m.filterVer ?? 1) !== FILTER_VER && m.rescanVer !== FILTER_VER) {
    m.phase = 'full';
    m.page = 1;
    m.rescan = true;
    m.rescanVer = FILTER_VER; // 이 기준으로 다시 훑는 중 (중간에 기준이 또 바뀌면 처음부터)
  }
  const isFull = m.phase !== 'inc';
  const known = new Set(Object.keys(await readList(db))); // 이미 목록에 있는 코드 (새로 더한 수만 셈)
  // 확인용: 이번에 본 제품들의 칸 (회사 API 가 어떤 이름 · 값으로 주는지) · 빈 칸 수 · 대분류 값 분포
  const st = { seen: 0, lrgEmpty: 0, middEmpty: 0, engEmpty: 0, lrgVals: {} };
  let sample = null;
  // 제품 정보 (팀 · 대/중분류): 본 제품 전부 → skuInfo (예전 getSkuList 대신)
  let infos = [];
  let infoCount = 0;
  const flushInfo = async () => {
    if (!infos.length) return;
    await storeItems(db, infos);
    infoCount += infos.length;
    infos = [];
  };
  const see = (raws) => {
    for (const raw of raws) {
      const n = infoOf(raw);
      if (n.code && (n.t || n.l || n.m || n.s || n.i)) infos.push(n);
      const r = rowOf(raw);
      if (!r.code) continue;
      st.seen++;
      if (!r.lrg) st.lrgEmpty++;
      if (!r.midd) st.middEmpty++;
      if (!r.eng) st.engEmpty++;
      const k = r.lrg || '(빈칸)';
      if (Object.keys(st.lrgVals).length < 40 || st.lrgVals[k]) st.lrgVals[k] = (st.lrgVals[k] ?? 0) + 1;
      // 대분류가 빈 제품 하나 (없으면 아무거나 하나) — 칸 이름 : 값
      if (!sample || (!r.lrg && !sample.lrgEmpty)) {
        const f = flat(raw);
        sample = { lrgEmpty: !r.lrg, code: r.code, fields: Object.fromEntries(Object.entries(f).filter(([k]) => /categ|export|lrg|midd|large|mid|eng|qty|yn/.test(k)).map(([k, v]) => [k, String(v ?? '').slice(0, 40)])) };
      }
    }
    return raws;
  };
  try {
    if (isFull) {
      // 처음: 전부 훑기 (이어서)
      let page = Number(m.page) > 1 ? Number(m.page) : 1;
      if (page === 1) {
        m.maxReg = '';
        m.asc = 0;
        m.desc = 0;
      }
      for (; ; page++) {
        if (Date.now() - t0 > budgetMs) {
          stopped = '시간이 다 돼서 (다시 누르면 이어서)';
          break;
        }
        const list = see(listOf(await call(cfg.bulk, cfg, { page, page_size: SIZE }, fetchImpl, wait, last))).map(rowOf).filter((r) => r.code);
        scanned += list.length;
        // 등록일 순서 보기 (쪽 안에서 앞 → 뒤)
        for (let i = 1; i < list.length; i++) {
          const a = regKey(list[i - 1].reg);
          const b = regKey(list[i].reg);
          if (a && b && a < b) m.asc = (m.asc ?? 0) + 1;
          if (a && b && a > b) m.desc = (m.desc ?? 0) + 1;
        }
        for (const r of list) {
          if (regKey(r.reg) > regKey(m.maxReg)) m.maxReg = r.reg;
          if (wanted(r)) {
            if (!known.has(r.code) && !changes[r.code]) added++;
            changes[r.code] = packRow(r);
          } else if (known.has(r.code) && changes[r.code] !== null) {
            changes[r.code] = null; // 이미 목록에 있지만 이제 필요 없음 (채워짐 · 재고 100 이하 · 수출제한)
            dropped++;
          }
        }
        if (Object.keys(changes).length > 3000) {
          await writeChanged(db, changes);
          for (const k of Object.keys(changes)) delete changes[k];
        }
        if (infos.length >= 4000) await flushInfo();
        if (list.length < SIZE) {
          // 끝까지 다 봄
          m.phase = 'inc';
          m.lastReg = m.maxReg;
          m.lastPage = page;
          m.order = (m.asc ?? 0) >= (m.desc ?? 0) * 3 ? 'asc' : (m.desc ?? 0) >= (m.asc ?? 0) * 3 ? 'desc' : 'mixed';
          m.page = 1;
          m.fullAt = new Date().toISOString();
          m.filterVer = FILTER_VER;
          m.rescan = false;
          break;
        }
        m.page = page + 1;
      }
    } else {
      // 그 뒤: 지난번 가장 늦은 등록일 이후만
      const since = regKey(m.lastReg);
      let maxReg = m.lastReg;
      const fresh = (r) => regKey(r.reg) >= since; // 같은 날 등록도 다시 봄 (이미 있으면 그냥 덮어씀)
      if (m.order === 'desc') {
        // 새 것이 앞쪽: 1쪽부터, 지난번 등록일보다 앞선 게 나오면 멈춤
        for (let page = 1; ; page++) {
          if (Date.now() - t0 > budgetMs) {
            stopped = '시간이 다 돼서';
            break;
          }
          const list = see(listOf(await call(cfg.bulk, cfg, { page, page_size: SIZE }, fetchImpl, wait, last))).map(rowOf).filter((r) => r.code);
          scanned += list.length;
          const news = list.filter(fresh);
          for (const r of news) {
            if (regKey(r.reg) > regKey(maxReg)) maxReg = r.reg;
            if (wanted(r)) {
              if (!known.has(r.code) && !changes[r.code]) added++;
              changes[r.code] = packRow(r);
            } else if (known.has(r.code) && changes[r.code] !== null) {
            changes[r.code] = null; // 이미 목록에 있지만 이제 필요 없음 (채워짐 · 재고 100 이하 · 수출제한)
            dropped++;
          }
          }
          if (news.length < list.length || list.length < SIZE) break;
        }
      } else {
        // 새 것이 뒤쪽 (또는 섞여 있음): 지난번 마지막 쪽부터 끝까지
        //   섞여 있으면 정확하지 않을 수 있어서, 처음부터 다시 (화면에 안내)
        let page = m.order === 'asc' ? Math.max(1, Number(m.lastPage) || 1) : 1;
        for (; ; page++) {
          if (Date.now() - t0 > budgetMs) {
            stopped = '시간이 다 돼서';
            break;
          }
          const list = see(listOf(await call(cfg.bulk, cfg, { page, page_size: SIZE }, fetchImpl, wait, last))).map(rowOf).filter((r) => r.code);
          scanned += list.length;
          for (const r of list.filter(fresh)) {
            if (regKey(r.reg) > regKey(maxReg)) maxReg = r.reg;
            if (wanted(r)) {
              if (!known.has(r.code) && !changes[r.code]) added++;
              changes[r.code] = packRow(r);
            } else if (known.has(r.code) && changes[r.code] !== null) {
            changes[r.code] = null; // 이미 목록에 있지만 이제 필요 없음 (채워짐 · 재고 100 이하 · 수출제한)
            dropped++;
          }
          }
          if (list.length < SIZE) {
            m.lastPage = page;
            break;
          }
        }
      }
      if (!stopped) m.lastReg = maxReg;
    }
  } catch (e) {
    stopped = e instanceof RateLimited ? e.message : `오류: ${e.message}`;
    if (!(e instanceof RateLimited) && !Object.keys(changes).length) {
      await metaRef.set({ lockUntil: null, error: e.message, errorAt: new Date().toISOString() }, { merge: true });
      throw e;
    }
  }
  if (Object.keys(changes).length) await writeChanged(db, changes);
  await flushInfo().catch((e) => (stopped = stopped || `제품 정보 저장 오류: ${e.message}`));
  if (infoCount) await db.doc('skuMeta/main').set({ at: new Date().toISOString(), lastInfo: infoCount, source: 'bulk' }, { merge: true });
  const count = Object.keys(await readList(db)).length;
  const out = { ...m, count, at: new Date().toISOString(), lockUntil: null, error: stopped && /오류/.test(stopped) ? stopped : '', stopped, lastAdded: added, lastDropped: dropped, lastScanned: scanned, lastStats: st, lastSample: sample };
  delete out.asc;
  delete out.desc;
  await metaRef.set({ ...out, asc: m.asc ?? 0, desc: m.desc ?? 0 });
  return { added, dropped, scanned, stopped, info: infoCount, ...publicMeta(out) };
}
const publicMeta = (m) => ({ phase: m.phase ?? 'full', count: m.count ?? 0, lastReg: m.lastReg ?? '', order: m.order ?? '', page: m.page ?? 1, rescan: !!m.rescan });

/** bulk 에서 제품코드 하나 찾기: SKU_CODE (앞자리 일치 검색) → 그중 코드가 같은 줄 */
async function bulkOne(cfg, code, fetchImpl, wait, last) {
  const raws = listOf(await call(cfg.bulk, cfg, { SKU_CODE: code, page: 1, page_size: 50 }, fetchImpl, wait, last));
  const raw = raws.find((x) => rowOf(x).code === code);
  return raw ? { row: rowOf(raw), info: infoOf(raw) } : null;
}

/** 🔄 새로고침: 이 코드들만 bulk (SKU_CODE) 로 다시 보고, 다 채워졌으면 목록에서 뺌 (한 번에 최대 budgetMs) */
export async function recheckMissing(db, codes0, { fetchImpl = fetch, wait = sleep, budgetMs = 230000 } = {}) {
  const sec = (await db.doc('secrets/sku').get()).data() ?? {};
  const cfg0 = await exCfg(db, sec);
  const cfg = { ...cfg0, bulk: String(sec.bulkUrl ?? BULK).trim() || BULK };
  await migrateShards(db);
  const list = await readList(db);
  const codes = [...new Set(codes0.map(str))].filter((c) => list[c]);
  const t0 = Date.now();
  const last = { at: 0 };
  const changes = {};
  let checked = 0;
  let removed = 0;
  let stopped = '';
  for (const code of codes) {
    if (Date.now() - t0 > budgetMs) {
      stopped = '시간이 다 돼서 (다시 누르면 이어서)';
      break;
    }
    let hit;
    try {
      hit = await bulkOne(cfg, code, fetchImpl, wait, last);
    } catch (e) {
      stopped = e instanceof RateLimited ? e.message : `오류: ${e.message}`;
      break;
    }
    checked++;
    if (!hit) continue;
    const r = hit.row;
    if (!wanted(r)) {
      changes[code] = null; // 다 채워졌거나, 재고 100 이하 · 수출제한
      removed++;
    } else changes[code] = packRow({ ...r, code });
  }
  if (Object.keys(changes).length) await writeChanged(db, changes);
  const count = Object.keys(await readList(db)).length;
  await db.doc(META).set({ count, recheckAt: new Date().toISOString() }, { merge: true });
  return { checked, removed, left: codes.length - checked, stopped, count };
}

/** 번역 엑셀에서 제품 정보가 없는 코드만 bulk (SKU_CODE) 로 찾기 — 예전 getSkuList 개별 찾기 대신
 *  한 번 찾아본 코드는 그날 다시 안 물음 (skuMiss/main) */
export async function lookupInfo(db, codes0, { fetchImpl = fetch, wait = sleep, budgetMs = 240000, max = 300 } = {}) {
  const sec = (await db.doc('secrets/sku').get()).data() ?? {};
  const cfg0 = await exCfg(db, sec);
  const cfg = { ...cfg0, bulk: String(sec.bulkUrl ?? BULK).trim() || BULK };
  const all = [...new Set(codes0.map(str).filter((c) => /^\d{2,8}$/.test(c)))];
  const have = {};
  for (const p of [...new Set(all.map((c) => c.slice(0, 5)))]) {
    try {
      Object.assign(have, JSON.parse((await db.doc(`skuInfo/${p}`).get()).get('data') ?? '{}'));
    } catch {
      /* 무시 */
    }
  }
  const missRef = db.doc('skuMiss/main');
  let miss = {};
  try {
    miss = JSON.parse((await missRef.get()).get('data') ?? '{}');
  } catch {
    miss = {};
  }
  const day = (iso) => new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
  const today = day(new Date().toISOString());
  const want = all.filter((c) => !isComplete(have[c]) && !(miss[c] && day(miss[c]) === today));
  const t0 = Date.now();
  const last = { at: 0 };
  const found = [];
  let asked = 0;
  let stopped = '';
  for (const code of want.slice(0, max)) {
    if (Date.now() - t0 > budgetMs) {
      stopped = '시간이 다 돼서';
      break;
    }
    let hit;
    try {
      hit = await bulkOne(cfg, code, fetchImpl, wait, last);
    } catch (e) {
      stopped = e instanceof RateLimited ? e.message : `오류: ${e.message}`;
      break;
    }
    asked++;
    const at = new Date().toISOString();
    if (hit && (hit.info.t || hit.info.l || hit.info.m)) found.push(hit.info);
    if (hit && isComplete(hit.info)) delete miss[code];
    else miss[code] = at;
  }
  if (found.length) await storeItems(db, found);
  await missRef.set({ data: JSON.stringify(miss), at: new Date().toISOString() });
  return { asked, found: found.length, none: asked - found.length, left: want.length - asked, stopped };
}
