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

export async function call(path, params, apiKey, fetchImpl = fetch) {
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
  if (o.erpArchive) return false; // ERP 에서 넣은 지난 주문 (다 출고됨) — 다시 안 부름
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
  // API 2 가 준 줄별 내역을 그대로 남김 (대시보드에서 '승인/예정' 표시를 누르면 보임 → 금액 확인용)
  next.outRows = out.map((r) => ({
    date: r.OUT_DATE ?? null,
    status: r.OUT_STATUS ?? '',
    k: num(r.TOTAL_OUTBOUND_AMT_K) ?? null,
    f: num(r.TOTAL_OUTBOUND_AMT_F) ?? null,
  }));
  next.planKRW = next.amountKRW; // API 1 예정 금액 (비교용)
  next.planForeign = next.amountForeign;
  if (approved.length) {
    // 출고승인이 하나라도 있으면 금액 = 승인 난 줄의 출고 금액 합계
    next.amountKRW = r0(approved.reduce((a, r) => a + (num(r.TOTAL_OUTBOUND_AMT_K) ?? 0), 0));
    next.amountForeign = r2(approved.reduce((a, r) => a + (num(r.TOTAL_OUTBOUND_AMT_F) ?? 0), 0));
    next.amountSource = 'api-outbound';
    // 승인 안 난 줄이 남아 있으면 '일부', 전부 승인이면 '승인' (금액은 둘 다 승인 난 줄의 합계)
    next.outStatus = approved.length < out.length ? 'partial' : 'approved';
    next.outDate = approved.map((r) => r.OUT_DATE).filter(Boolean).sort().pop()?.replace(/\./g, '-');
  }
  return next;
}

/** 바뀐 칸만 골라냄 */
export function diff(o, next) {
  const changed = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    const same = typeof v === 'object' ? JSON.stringify(o[k]) === JSON.stringify(v) : o[k] === v;
    if (!same) changed[k] = v;
  }
  return changed;
}

/**
 * 관리자 확인용: API 1·2 가 준 응답을 가공하지 않고 그대로 돌려줌 (금액 계산·저장 안 함)
 * 매장코드/주문일자를 따로 주면 그걸로 조회 (다른 날짜로 시험해 볼 때)
 */
export async function inspect({ orderDate, storeCode, expNo }, apiKey, fetchImpl = fetch) {
  const raw = async (path, params) => {
    const url = `${BASE}/${path}?${new URLSearchParams(params)}`;
    const res = await fetchImpl(url, { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      /* JSON 아님 */
    }
    return { query: `${path}?${new URLSearchParams(params)}`, status: res.status, body, text: body ? undefined : text.slice(0, 2000) };
  };
  const api1 = orderDate && storeCode ? await raw('getexorderdata.asp', { ORDER_DATE: toApiDate(orderDate), STORE_ID: String(storeCode).trim() }) : null;
  const expNos = new Set(expNo ? [String(expNo)] : []);
  for (const r of api1?.body?.Infos ?? []) if (r.EXP_NO) expNos.add(String(r.EXP_NO));
  const api2 = [];
  for (const no of expNos) api2.push({ expNo: no, ...(await raw('getoutbounddata.asp', { EXP_NO: no })) });
  return { api1, api2 };
}
