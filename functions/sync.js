// 주문 금액 자동 채우기 (서버에서만 돌아감 — API 키는 브라우저로 절대 안 내려감)
//
// ① API 1 getexorderdata: 주문일자 + 매장코드(STORE_ID) → EXP_NO, 예정 금액(TOTAL_OUT_AMT_K/F)
// ② API 2 getoutbounddata: EXP_NO → '출고승인' 줄이 있으면 출고 금액(TOTAL_OUTBOUND_AMT_K/F) 합계로 교체
//
// 사람이 직접 쓴 금액(amountSource === 'manual')은 건드리지 않음.

const BASE = 'https://ex.artbox.kr/api';
const RECHECK_APPROVED_MS = 24 * 60 * 60 * 1000; // 출고승인 끝난 건은 하루에 한 번만 다시 확인

const toApiDate = (iso) => iso.replace(/-/g, '.'); // 2026-09-28 → 2026.09.28
const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const r2 = (n) => (n === undefined ? undefined : Math.round(n * 100) / 100); // 외화: 소수 둘째 자리
const r0 = (n) => (n === undefined ? undefined : Math.round(n)); // 원화: 정수

async function call(path, params, apiKey, fetchImpl) {
  const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
  const res = await fetchImpl(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${path}: JSON 이 아님 (${text.slice(0, 80)})`);
  }
  return body.success ? body.Infos ?? [] : []; // 데이터 없음 = success:false
}

/** 이 주문을 API 로 갱신할 대상인지 */
export function needsSync(o, now = Date.now()) {
  if (o.amountSource === 'manual') return false;
  if (!o.storeCode || !/^\d+$/.test(String(o.storeCode).trim())) return false; // 826702~4 같은 건 건너뜀
  if (!o.orderDate || o.orderDate < '2025-01-01') return false; // API 조회 하한
  if (o.outStatus === 'approved' && o.apiSyncedAt && now - Date.parse(o.apiSyncedAt) < RECHECK_APPROVED_MS) return false;
  return true;
}

/**
 * 주문 하나를 API 로 확인해서 바뀐 값만 돌려줌 (없으면 null)
 * @returns {Promise<object|null>}
 */
export async function syncOne(o, apiKey, fetchImpl = fetch) {
  const infos = await call('getexorderdata.asp', { ORDER_DATE: toApiDate(o.orderDate), STORE_ID: String(o.storeCode).trim() }, apiKey, fetchImpl);
  const info = infos[0];
  if (!info) return null; // 아직 ERP 에 없음
  const next = {
    expNo: String(info.EXP_NO),
    fxCode: info.CURR_CODE || undefined,
    amountKRW: r0(num(info.TOTAL_OUT_AMT_K)),
    amountForeign: r2(num(info.TOTAL_OUT_AMT_F)),
    amountSource: 'api-order',
    outStatus: 'pending',
  };

  const out = await call('getoutbounddata.asp', { EXP_NO: next.expNo }, apiKey, fetchImpl);
  const approved = out.filter((r) => r.OUT_STATUS === '출고승인');
  if (approved.length) {
    next.amountKRW = r0(approved.reduce((a, r) => a + (num(r.TOTAL_OUTBOUND_AMT_K) ?? 0), 0));
    next.amountForeign = r2(approved.reduce((a, r) => a + (num(r.TOTAL_OUTBOUND_AMT_F) ?? 0), 0));
    next.amountSource = 'api-outbound';
    next.outStatus = approved.length === out.length ? 'approved' : 'partial';
    next.outDate = approved.map((r) => r.OUT_DATE).filter(Boolean).sort().pop()?.replace(/\./g, '-');
  }
  return next;
}

/** 바뀐 칸만 골라냄 */
export function diff(o, next) {
  const changed = {};
  for (const [k, v] of Object.entries(next)) if (v !== undefined && o[k] !== v) changed[k] = v;
  return changed;
}
