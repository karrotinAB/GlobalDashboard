// 매장명: 회사 API getpartnerinfo.asp?STORE_ID= 의 STORE_NAME → storeNames/{STORE_ID} = { name, at }
//   주문 관리에서 '주문 이름을 매장명으로' 를 켠 업체의 주문 이름에 씀. 한 번 찾은 매장은 다시 안 물음
//   회사 API 제한 (1분 30번) → 부를 때마다 2.1초 이상 쉼 · 한 번에 최대 25곳
import { call, exCfg, flat, listOf } from './skuMissing.js';
import { RateLimited } from './sku.js';

const URL = 'https://ex.artbox.kr/api/getpartnerinfo.asp';
const MAX = 25;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// force: 이미 적어 둔 매장도 (이름이 빈 것 포함) 다시 물음 · 결과마다 응답 앞부분을 같이 돌려줌 (관리자 확인용)
export async function lookupStoreNames(db, ids0, { fetchImpl = fetch, wait = sleep, force = false } = {}) {
  const ids = [...new Set((ids0 ?? []).map((x) => String(x ?? '').trim()).filter((x) => /^[0-9A-Za-z-]{3,20}$/.test(x)))];
  const todo = [];
  for (const id of ids) if (force || !(await db.doc(`storeNames/${id}`).get()).exists) todo.push(id);
  if (!todo.length) return { asked: 0, found: 0, left: 0, results: [] };
  const sec = (await db.doc('secrets/sku').get()).data() ?? {};
  // 키: 매장 정보는 주문(ERP) 쪽 키로 열리는 경우가 많음 → partnerKey(있으면) · ERP 키 · 제품(번역) 키 순서로, 401/403 이면 다음 키
  const erp = (await db.doc('secrets/erp').get()).data() ?? {};
  const erpField = Object.keys(erp).find((k) => k.replace(/[_\s-]/g, '').toLowerCase() === 'apikey');
  const cfgs = [];
  if (sec.partnerKey) cfgs.push({ key: String(sec.partnerKey).trim(), header: String(sec.partnerHeader ?? 'X-API-Key').trim() || 'X-API-Key' });
  if (erpField && erp[erpField]) cfgs.push({ key: String(erp[erpField]).trim(), header: 'X-API-Key' });
  try {
    cfgs.push(await exCfg(db, sec));
  } catch {
    /* 제품 키가 없어도 됨 */
  }
  if (!cfgs.length) throw new Error('API 키가 없어요 (secrets/erp 또는 secrets/sku)');
  let ki = 0;
  const url = String(sec.partnerUrl ?? URL).trim() || URL;
  const last = { at: 0 };
  let found = 0;
  let asked = 0;
  let stopped = '';
  const results = [];
  for (const id of todo.slice(0, MAX)) {
    let body;
    try {
      for (;;) {
        try {
          body = await call(url, cfgs[ki], { STORE_ID: id }, fetchImpl, wait, last);
          break;
        } catch (e) {
          // 키가 안 맞으면 다음 키로 (맞는 키를 찾으면 그 뒤 매장도 그 키로)
          if (/API 40[13]/.test(e.message) && ki < cfgs.length - 1) {
            ki++;
            continue;
          }
          throw e;
        }
      }
    } catch (e) {
      stopped = e instanceof RateLimited ? e.message : `오류: ${e.message}${/API 40[13]/.test(e.message) ? ` — 키 ${cfgs.length}개(${cfgs.length > 1 ? 'ERP · 제품' : '하나'}) 모두 안 맞아요` : ''}`;
      results.push({ id, name: '', error: stopped });
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
    results.push({ id, name, raw: JSON.stringify(body).slice(0, 300) });
  }
  return { asked, found, left: todo.length - asked, stopped, results };
}
