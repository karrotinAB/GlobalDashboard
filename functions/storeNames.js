// 매장명: 회사 API getpartnerinfo.asp?STORE_ID= 의 STORE_NAME → storeNames/{STORE_ID} = { name, at }
//   주문 관리에서 '주문 이름을 매장명으로' 를 켠 업체의 주문 이름에 씀. 한 번 찾은 매장은 다시 안 물음
//   회사 API 제한 (1분 30번) → 부를 때마다 2.1초 이상 쉼 · 한 번에 최대 25곳
import { call, exCfg, flat, listOf } from './skuMissing.js';
import { RateLimited } from './sku.js';

const URL = 'https://ex.artbox.kr/api/getpartnerinfo.asp';
const MAX = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function lookupStoreNames(db, ids0, { fetchImpl = fetch, wait = sleep } = {}) {
  const ids = [...new Set((ids0 ?? []).map((x) => String(x ?? '').trim()).filter((x) => /^[0-9A-Za-z-]{3,20}$/.test(x)))];
  const todo = [];
  for (const id of ids) if (!(await db.doc(`storeNames/${id}`).get()).exists) todo.push(id);
  if (!todo.length) return { asked: 0, found: 0, left: 0 };
  const sec = (await db.doc('secrets/sku').get()).data() ?? {};
  const cfg = await exCfg(db, sec);
  const url = String(sec.partnerUrl ?? URL).trim() || URL;
  const last = { at: 0 };
  let found = 0;
  let asked = 0;
  let stopped = '';
  for (const id of todo.slice(0, MAX)) {
    let body;
    try {
      body = await call(url, cfg, { STORE_ID: id }, fetchImpl, wait, last);
    } catch (e) {
      stopped = e instanceof RateLimited ? e.message : `오류: ${e.message}`;
      break;
    }
    asked++;
    const rows = listOf(body);
    const f = flat(rows[0] ?? body);
    const k = Object.keys(f).find((x) => /storename$|^storenm$/.test(x));
    const name = k ? String(f[k] ?? '').trim() : '';
    // 못 찾아도 적어 둠 (빈 이름) → 다시 안 물음
    await db.doc(`storeNames/${id}`).set({ name, at: new Date().toISOString() });
    if (name) found++;
  }
  return { asked, found, left: todo.length - asked, stopped };
}
