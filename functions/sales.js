// 판매 데이터 (POS 계산 건) → 지점(STORE_ID)·일자별 합계 → salesMonthly/{매장코드 4자리}_{YYYY-MM}
//   { code, month, branches: { [STORE_ID]: { name, days: { '01': 금액, … }, cnt: { '01': 건수, … } } }, updatedAt }
// 주소·칸 이름: Firestore secrets/sales 문서 (설정 > 판매 데이터 API 에서 관리자가 저장, 사이트에서는 못 읽음)
//   url        : API 주소 (…/getsalesdata.asp 같은 전체 주소)
//   dateParam  : 날짜(시작)를 넣는 파라미터 이름 (기본 DATE_FROM)
//   endParam   : 끝 날짜 파라미터 이름 (기본 DATE_TO, 비우면 하루씩 부름)
//   storeParam : 매장코드 4자리 파라미터 (기본 STORE_CODE) — 매장코드마다 한 번 부름
//     예) getExportSalesUpload.asp?STORE_CODE=8254&DATE_FROM=2026.10.01&DATE_TO=2026.10.10
//     지점은 응답의 지점 칸으로 나눔 (약자면 ERP 거래처 정보로 지점 코드로 바꿈)
//   dateFormat : 'dot' 2026.11.12 · 'dash' 2026-11-12 · 'compact' 20261112
//   fields     : { date, amount, store, storeCode, name } 응답 칸 이름 (비우면 자동으로 찾음)
// API 키는 ERP 와 같은 것 (secrets/erp apiKey → X-API-Key 헤더)

const pad = (n) => String(n).padStart(2, '0');
/** 지점 약자처럼 생겼는지 (LDC, MEG, BKS …) — '(주)그랜드에스코리아' 같은 회사 이름은 아님 */
export const isAbbr = (a) => /^[A-Za-z0-9][A-Za-z0-9 ._\-&]{0,15}$/.test(String(a ?? '').trim());

export function fmtDate(iso, format = 'dot') {
  const [y, m, d] = iso.split('-');
  return format === 'dash' ? iso : format === 'compact' ? `${y}${m}${d}` : `${y}.${m}.${d}`;
}

/** 응답 날짜 → YYYY-MM-DD ('2026.11.12', '20261112', '2026-11-12 13:20:00', '2026/11/12' …) */
export function parseDate(v) {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

export const toNum = (v) => {
  if (typeof v === 'number') return v;
  const n = Number(String(v ?? '').replace(/[,\s원₩$]/g, ''));
  return Number.isFinite(n) ? n : undefined;
};

/** 응답 칸 이름 자동 찾기 (설정에서 정한 이름이 먼저) */
export function detectFields(rows, over = {}) {
  const keys = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r ?? {})))];
  // 설정에 넣은 칸 이름이 응답에 없으면 무시 (예: 칸 이름 대신 매장코드 숫자를 넣은 경우)
  over = Object.fromEntries(Object.entries(over ?? {}).filter(([, v]) => v && keys.includes(v)));
  const find = (...res) => {
    for (const re of res) {
      const k = keys.find((k) => re.test(k));
      if (k) return k;
    }
    return undefined;
  };
  const numeric = (k) => rows.slice(0, 20).some((r) => toNum(r?.[k]) !== undefined && r?.[k] !== '' && r?.[k] !== null);
  const amountKeys = keys.filter(numeric);
  const pickAmt = (...res) => {
    for (const re of res) {
      const k = amountKeys.find((k) => re.test(k));
      if (k) return k;
    }
    return undefined;
  };
  return {
    date: over.date || find(/^SALE_?DATE$/i, /^SALE_?DT$/i, /SALE.*(DATE|DT)/i, /(^|_)DATE$/i, /DATE|일자|날짜/i, /_DT$/i),
    amount:
      over.amount ||
      pickAmt(/^(TOTAL_)?SALE_?AMT$/i, /^(NET|REAL|PAY|TOT(AL)?)_?(SALE_?)?AMT$/i, /SALE.*AMT/i, /AMT|AMOUNT|금액/i, /PRICE|매출/i),
    store:
      over.store ||
      find(/^STORE_?ID$/i, /^SHOP_?ID$/i, /^BRANCH_?(ID|CODE|CD|NO)$/i, /^BRANCH_?ABBR$/i, /^STORE_?CD$/i, /STORE.*(ID|NO)$/i, /BRANCH(?!.*(NM|NAME))/i, /지점/i, /^STORE_?CODE$/i, /SHOP|STORE|매장/i),
    storeCode: over.storeCode || find(/^STORE_?CODE$/i),
    name: over.name || find(/^STORE_?(NM|NAME)$/i, /^SHOP_?(NM|NAME)$/i, /(STORE|SHOP|BRANCH).*(NM|NAME)/i, /매장명|지점명/i),
  };
}

/** 계산 건들 → { 'STORE_ID|YYYY-MM-DD': { storeId, code, name, date, amount, count } } */
export function aggregate(rows, f, fallbackDate, forcedStore, { abbrToId = {}, code: callCode } = {}) {
  const out = new Map();
  for (const r of rows) {
    // 지점: 응답의 지점 칸 (약자면 지점 코드로 바꿈). 지점 칸이 없으면 부른 매장코드 하나로
    const raw = String(r?.[f.store] ?? '').trim();
    const storeId = forcedStore || abbrToId[raw.toUpperCase()] || raw || callCode || '';
    if (!storeId) continue;
    const date = parseDate(r?.[f.date]) ?? fallbackDate;
    const amt = toNum(r?.[f.amount]);
    if (!date || amt === undefined) continue;
    const code = String(callCode || (f.storeCode && r?.[f.storeCode]) || storeId.slice(0, 4)).trim();
    const k = `${storeId}|${date}`;
    const cur = out.get(k) ?? { storeId, code, name: f.name ? String(r?.[f.name] ?? '').trim() : '', date, amount: 0, count: 0 };
    cur.amount += amt;
    cur.count += 1;
    if (!cur.name && f.name) cur.name = String(r?.[f.name] ?? '').trim();
    out.set(k, cur);
  }
  return [...out.values()];
}

/** API 한 번 부르기 → 계산 건 목록 */
export async function fetchSales(cfg, apiKey, fromIso, toIso, fetchImpl = fetch, extra = {}) {
  if (!cfg?.url) throw new Error('판매 데이터 API 주소가 아직 없어요 (설정 > 판매 데이터 API)');
  const u = new URL(cfg.url);
  for (const [k, v] of Object.entries(extra)) if (k && v) u.searchParams.set(k, v);
  u.searchParams.set(cfg.dateParam || 'DATE_FROM', fmtDate(fromIso, cfg.dateFormat));
  if (cfg.endParam) u.searchParams.set(cfg.endParam, fmtDate(toIso ?? fromIso, cfg.dateFormat));
  const res = await fetchImpl(u.toString(), { headers: { 'X-API-Key': apiKey, Accept: 'application/json' } });
  if (!res.ok) {
    // 400 같은 오류: API 가 돌려준 설명도 같이 (무엇이 틀렸는지 보려고)
    const why = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 160);
    const err = new Error(`판매 API HTTP ${res.status}${why ? ` — ${why}` : ''}`);
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`판매 API: JSON 이 아님 (${text.slice(0, 80)})`);
  }
  const rows = Array.isArray(body) ? body : body?.items ?? body?.Items ?? body?.Infos ?? body?.data ?? body?.Data ?? body?.rows ?? body?.list ?? [];
  if (!Array.isArray(rows)) return { rows: [], body };
  if (body && body.success === false && !rows.length) return { rows: [], body }; // 데이터 없음
  return { rows, body };
}

/** 서울 날짜로 오늘부터 n일 전까지 ['2026-11-12', '2026-11-11', …] */
export function lastDays(n, now = new Date()) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date(now.getTime() - i * 86400000)));
  return out;
}

/** 한 달의 날짜들 ['2026-10-01' … '2026-10-31'] (오늘 이후는 뺌) */
export function monthDays(month, todayIso) {
  const [y, m] = month.split('-').map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${pad(i + 1)}`).filter((d) => !todayIso || d <= todayIso);
}

/**
 * 날짜들을 가져와서 salesMonthly 에 씀 (그 날짜의 값은 새로 계산한 합계로 바꿈)
 * @param codes 대시보드에 등록된 매장코드(4자리) — 이 매장들만 저장
 */
export async function syncSalesDates(db, cfg, apiKey, dates, codes, { fetchImpl = fetch, branchesFor } = {}) {
  const f0 = cfg.fields ?? {};
  codes = codes ? new Set(codes) : null;
  const errors = [];
  let rows = 0;
  const groups = []; // [{ fallbackDate, rows, store }]
  const sorted = [...dates].sort();
  // 부를 단위: 지점별(매장코드+지점 약자) / 매장별 / 전체
  // 설정 › 매장 평수의 지점 목록 (ERP 거래처 정보): 약자 → STORE_ID
  const abbrToId = {};
  const abbrsOf = {}; // 매장코드 → [[약자, STORE_ID]]
  if (branchesFor) {
    for (const code of codes ?? []) {
      try {
        for (const [sid, abbr] of Object.entries(await branchesFor(code))) {
          const a = String(abbr ?? '').trim();
          if (!a) continue;
          abbrToId[a.toUpperCase()] = sid;
          if (isAbbr(a)) (abbrsOf[code] ??= []).push([a, sid]);
          else errors.push(`${sid}: 지점 이름 '${a}' 은 약자로 못 써서 건너뜀 — 설정 › 매장 평수에서 약자를 직접 넣어 주세요`);
        }
      } catch {
        /* 지점 목록 없어도 진행 */
      }
    }
  }
  // 부르는 단위: 지점 약자가 있으면 지점마다 (STORE_CODE=8254&BRANCH_ABBR=LDC), 없으면 매장코드로 한 번
  const bp = cfg.branchParam || 'BRANCH_ABBR';
  const units = [];
  if (cfg.storeParam) {
    for (const code of codes ?? []) {
      const list = abbrsOf[code] ?? [];
      if (list.length) for (const [a, sid] of list) units.push({ code, store: sid, extra: { [cfg.storeParam]: code, [bp]: a } });
      else units.push({ code, extra: { [cfg.storeParam]: code } });
    }
  } else units.push({ extra: {} });

  for (const u of units) {
    const label = Object.values(u.extra).filter(Boolean).join('/') || '전체';
    if (cfg.endParam) {
      // 기간 API: 날짜 구간 한 번에
      const fb = sorted.length === 1 ? sorted[0] : undefined;
      try {
        const r = await fetchSales(cfg, apiKey, sorted[0], sorted[sorted.length - 1], fetchImpl, u.extra);
        groups.push({ fallbackDate: fb, rows: r.rows, code: u.code, store: u.store });
      } catch (e) {
        if (u.store) {
          errors.push(`${label}: ${e.message}`);
          continue;
        }
        // 매장코드만으로 안 되면 (지점 약자가 꼭 필요한 API) → 지점 약자를 붙여 지점마다 다시
        const abbrs = u.code ? Object.entries(abbrToId).filter(([a, sid]) => sid.startsWith(u.code) && isAbbr(a)) : [];
        if (!abbrs.length || !e.status || e.status >= 500) {
          errors.push(`${label}: ${e.message}`);
          continue;
        }
        const failed = [];
        for (const [abbr, sid] of abbrs) {
          try {
            const r = await fetchSales(cfg, apiKey, sorted[0], sorted[sorted.length - 1], fetchImpl, { ...u.extra, [bp]: abbr });
            groups.push({ fallbackDate: fb, rows: r.rows, code: u.code, store: sid });
          } catch (e2) {
            failed.push(`${abbr}: ${e2.message}`);
          }
        }
        if (failed.length) errors.push(`${label}: 매장코드만으로 ${e.message} → 지점별로 다시 불렀는데 ${failed.length}곳 실패 (${failed.slice(0, 2).join(' / ')})`);
      }
    } else {
      for (const d of sorted) {
        try {
          const r = await fetchSales(cfg, apiKey, d, d, fetchImpl, u.extra);
          groups.push({ fallbackDate: d, rows: r.rows, code: u.code, store: u.store });
        } catch (e) {
          errors.push(`${label} ${d}: ${e.message}`);
        }
      }
    }
  }
  // 문서별로 모아서 한 번씩 씀
  const docs = new Map(); // id → { code, month, branches }
  for (const g of groups) {
    rows += g.rows.length;
    if (!g.rows.length) continue;
    const f = detectFields(g.rows, f0);
    if ((!f.store && !g.code && !g.store) || !f.amount || (!f.date && !g.fallbackDate)) {
      errors.push(`칸 이름을 못 찾았어요 (매장: ${f.store ?? '?'}, 금액: ${f.amount ?? '?'}, 날짜: ${f.date ?? '?'}) — 설정에서 칸 이름을 넣어 주세요`);
      continue;
    }
    for (const a of aggregate(g.rows, f, g.fallbackDate, g.store, { abbrToId, code: g.code })) {
      if (codes && !codes.has(a.code)) continue;
      const month = a.date.slice(0, 7);
      const id = `${a.code}_${month}`;
      const doc = docs.get(id) ?? { code: a.code, month, branches: {} };
      const b = (doc.branches[a.storeId] ??= { days: {}, cnt: {} });
      if (a.name) b.name = a.name;
      const dd = a.date.slice(8, 10);
      b.days[dd] = Math.round(((b.days[dd] ?? 0) + a.amount) * 100) / 100;
      b.cnt[dd] = (b.cnt[dd] ?? 0) + a.count;
      docs.set(id, doc);
    }
  }
  for (const [id, doc] of docs) {
    await db.doc(`salesMonthly/${id}`).set({ ...doc, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return { dates: dates.length, rows, docs: docs.size, errors: errors.slice(0, 10) };
}
