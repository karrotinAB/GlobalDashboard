// ERP 새 주문 자동 등록
// getexorderdata 를 STORE_ID 없이 날짜만 넣어 부르면 그날 모든 매장의 주문이 옴 (날짜 하나에 한 번).
// STORE_CODE(매장코드 앞 4자리)가 업체의 storeCodes 와 맞으면, 그 공간(조·개인 대시보드)의 주문 관리에 '새 주문'을 만듦.
//  - 이미 같은 EXP_NO, 또는 같은 매장코드(STORE_ID)+주문일자 주문이 있으면 안 만듦
//  - 한 번 만든 건 apiImports/{공간}_{EXP_NO} 에 기록 → 사람이 지워도 다시 안 만듦 (이 컬렉션은 사이트에서 못 읽음)
//  - 그 뒤 금액은 기존 금액 갱신(sync.js)이 매장코드+주문일자로 계속 갱신
import { call } from './sync.js';

const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(v));
const r0 = (n) => (n === undefined || Number.isNaN(n) ? undefined : Math.round(n));
const r2 = (n) => (n === undefined || Number.isNaN(n) ? undefined : Math.round(n * 100) / 100);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/** 서울 날짜로 오늘부터 n일 전까지 ['2026.11.11', '2026.11.10', …] */
export function recentDates(n, now = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    out.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(d).replaceAll('-', '.'));
  }
  return out.filter((d) => d >= '2025.01.01');
}

/**
 * @param db Firestore (admin)
 * @param colOf (space, name) => 컬렉션 이름
 * @param spaces 공간 목록 ('1','2','3','p…')
 */
export async function importNewOrders(db, colOf, spaces, apiKey, { days = 3, fetchImpl = fetch } = {}) {
  // 공간마다: 매장코드 → 업체
  const maps = [];
  for (const space of spaces) {
    const cos = await db.collection(colOf(space, 'companies')).get();
    const byCode = new Map();
    for (const d of cos.docs) for (const code of d.get('storeCodes') ?? []) byCode.set(String(code).trim(), d.id);
    if (byCode.size) maps.push({ space, byCode, orders: null });
  }
  if (!maps.length) return { created: 0, checkedDates: 0, note: '매장코드가 있는 업체가 없어요' };

  let created = 0;
  const made = [];
  const errors = [];
  const dates = recentDates(days);
  for (const date of dates) {
    let infos = [];
    try {
      infos = await call('getexorderdata.asp', { ORDER_DATE: date }, apiKey, fetchImpl);
    } catch (e) {
      errors.push(`${date}: ${e.message}`);
      continue;
    }
    for (const info of infos) {
      const storeId = String(info.STORE_ID ?? '').trim();
      const code = String(info.STORE_CODE ?? storeId.slice(0, 4)).trim();
      const expNo = info.EXP_NO ? String(info.EXP_NO) : '';
      const orderDate = String(info.ORDER_DATE ?? date).replaceAll('.', '-');
      for (const m of maps) {
        const companyId = m.byCode.get(code);
        if (!companyId) continue;
        const seenRef = db.doc(`apiImports/${m.space}_${expNo || `${storeId}_${orderDate}`}`);
        if ((await seenRef.get()).exists) continue; // 한 번 만든 적 있음 (지웠어도 다시 안 만듦)
        if (!m.orders) m.orders = (await db.collection(colOf(m.space, 'orders')).get()).docs.map((d) => d.data());
        const dup = m.orders.some((o) => (expNo && String(o.expNo ?? '') === expNo) || (String(o.storeCode ?? '').trim() === storeId && o.orderDate === orderDate));
        if (!dup) {
          const now = new Date().toISOString();
          const order = {
            id: uid(),
            companyId,
            name: '새 주문',
            realOrder: false,
            erp: false,
            inbound: false,
            invoice: false,
            shipped: false,
            storeCode: storeId,
            orderDate,
            amountKRW: r0(num(info.TOTAL_OUT_AMT_K)),
            amountForeign: r2(num(info.TOTAL_OUT_AMT_F)),
            amountSource: 'api-order',
            outStatus: 'pending',
            expNo: expNo || undefined,
            fxCode: info.CURR_CODE || undefined,
            autoImported: true,
            sort: Date.parse(orderDate),
            createdAt: now,
          };
          await db.doc(`${colOf(m.space, 'orders')}/${order.id}`).set(JSON.parse(JSON.stringify(order)));
          m.orders.push(order);
          created++;
          made.push(`${m.space}:${storeId} ${orderDate}`);
        }
        await seenRef.set({ space: m.space, expNo, storeId, orderDate, at: new Date().toISOString(), created: !dup });
      }
    }
  }
  return { created, checkedDates: dates.length, made: made.slice(0, 20), errors };
}
