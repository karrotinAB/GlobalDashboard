// 수출매출 지난 데이터 한 번 채우기 (ERP 직접): 2026-01-01 ~ 오늘, 주문 관리에 없는 지난 출고 금액
// 앞으로의 데이터는 주문 관리(ERP 연결)로 — 화면에서 같은 EXP_NO 는 한 번만 셈
//  ① getexorderdata(ORDER_DATE 만) → 그날 모든 매장 주문 → 대시보드 업체 매장코드(4자리)인 것만 exportOrders/{EXP_NO}
//  ② getoutbounddata(EXP_NO) → 줄별 출고일·상태·금액
//  ③ 모아서 exportMonthly/{코드}_{YYYY-MM} (그 달 출고승인 금액 + 주문 목록)
// 시간 제한(약 8분) 안에서 할 만큼 하고 exportSync/state 에 어디까지 했는지 남김 → 다음 실행이 이어서
import { call } from './sync.js';

const num = (v) => (v === null || v === undefined || v === '' ? undefined : Number(String(v).replace(/,/g, '')));
const r2 = (n) => Math.round((n ?? 0) * 100) / 100;
const dot = (iso) => iso.replaceAll('-', '.');
const iso = (d) => String(d ?? '').replaceAll('.', '-').slice(0, 10);
const seoulToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function pool(items, n, fn, until) {
  let i = 0;
  const run = async () => {
    while (i < items.length && Date.now() < until) {
      const it = items[i++];
      await fn(it);
    }
  };
  await Promise.all(Array.from({ length: n }, run));
}

/**
 * @param codes Set<string> 대시보드 업체 매장코드(4자리)
 * @param from 처음 채울 날짜 (예: 2026-01-01)
 */
export async function runExportSync(db, apiKey, codes, { from = '2026-01-01', budgetMs = 480000, fetchImpl = fetch } = {}) {
  const until = Date.now() + budgetMs;
  const stateRef = db.doc('exportSync/state');
  const state = (await stateRef.get()).data() ?? {};
  const today = seoulToday();
  const errors = [];
  let scanned = 0;
  let found = 0;
  let checked = 0;

  if (state.from === from && state.backfillDone) return { skipped: '이미 다 채웠어요', ...(state.last ?? {}) };

  // ① 날짜 훑기: from 부터 오늘까지 (cursor 에 이어서)
  const orders = db.collection('exportOrders');
  let cursor = state.from === from && state.cursor ? state.cursor : from;
  const end = state.from === from && state.end ? state.end : today; // 처음 시작한 날까지 (그 뒤는 주문 관리로)
  while (cursor <= end && Date.now() < until) {
    try {
      const infos = await call('getexorderdata.asp', { ORDER_DATE: dot(cursor) }, apiKey, fetchImpl);
      scanned++;
      const batch = db.batch();
      let n = 0;
      for (const info of infos) {
        const storeId = String(info.STORE_ID ?? '').trim();
        const code = String(info.STORE_CODE ?? storeId.slice(0, 4)).trim();
        const expNo = info.EXP_NO ? String(info.EXP_NO) : '';
        if (!expNo || !codes.has(code)) continue;
        batch.set(
          orders.doc(expNo),
          { expNo, code, storeId, orderDate: iso(info.ORDER_DATE ?? cursor), planK: num(info.TOTAL_OUT_AMT_K) ?? 0, planF: num(info.TOTAL_OUT_AMT_F) ?? 0, curr: info.CURR_CODE ?? null },
          { merge: true },
        );
        n++;
      }
      if (n) await batch.commit();
      found += n;
      cursor = addDays(cursor, 1);
    } catch (e) {
      errors.push(`${cursor}: ${e.message}`);
      break; // 실패한 날부터 다음 실행에 다시
    }
  }
  const datesDone = cursor > end;
  await stateRef.set({ from, end, cursor, at: new Date().toISOString() }, { merge: true });

  // ② 출고 내역: 아직 안 본 주문 (오래된 것부터)
  const todo = (await orders.get()).docs
    .map((d) => d.data())
    .filter((o) => !o.checkedAt)
    .sort((a, b) => (a.orderDate ?? '').localeCompare(b.orderDate ?? ''));
  await pool(
    todo,
    4,
    async (o) => {
      try {
        const rows = await call('getoutbounddata.asp', { EXP_NO: o.expNo }, apiKey, fetchImpl);
        const outRows = rows.map((r) => ({ date: iso(r.OUT_DATE) || null, status: r.OUT_STATUS ?? '', k: num(r.TOTAL_OUTBOUND_AMT_K) ?? 0, f: num(r.TOTAL_OUTBOUND_AMT_F) ?? 0 }));
        await orders.doc(o.expNo).set({ outRows, checkedAt: new Date().toISOString() }, { merge: true });
        checked++;
      } catch (e) {
        errors.push(`${o.expNo}: ${e.message}`);
      }
    },
    until,
  );
  const backfillDone = datesDone && checked >= todo.length;

  // ③ 모아서 쓰기
  const all = (await orders.get()).docs.map((d) => d.data());
  const monthly = new Map(); // code_month → { shipK, shipF, items }
  for (const o of all) {
    const ok = (o.outRows ?? []).filter((r) => r.status === '출고승인' && r.date);
    for (const r of ok) {
      const id = `${o.code}_${r.date.slice(0, 7)}`;
      const m = monthly.get(id) ?? { code: o.code, month: r.date.slice(0, 7), shipK: 0, shipF: 0, items: [] };
      m.shipK += r.k;
      m.shipF += r.f;
      const it = m.items.find((x) => x.expNo === o.expNo);
      if (it) {
        it.k = r2(it.k + r.k);
        it.f = r2(it.f + r.f);
        if (r.date > it.outDate) it.outDate = r.date;
      } else m.items.push({ expNo: o.expNo, storeId: o.storeId, orderDate: o.orderDate, outDate: r.date, k: r2(r.k), f: r2(r.f) });
      monthly.set(id, m);
    }
  }
  const at = new Date().toISOString();
  for (const [id, m] of monthly) await db.doc(`exportMonthly/${id}`).set({ ...m, shipK: Math.round(m.shipK), shipF: r2(m.shipF), at });
  const result = { scanned, found, checked, orders: all.length, waiting: todo.length - checked, backfillDone, cursor, end, errors: errors.slice(0, 10), at };
  await stateRef.set({ last: result, backfillDone }, { merge: true });
  return result;
}
