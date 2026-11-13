// Firebase 서버 함수 (배포: 저장소 폴더에서  npx firebase-tools deploy --only functions)
//  - syncOrderAmounts     : 평일 9:00~18:30 (서울) 30분마다 자동으로 주문 금액 갱신
//  - syncOrderAmountsNow  : 주문 관리의 '금액 새로고침' 버튼 (대시보드 사용자만)
//  - inspectOrderApi      : 관리자 확인용 — ERP API 응답 원본 보기 (아무것도 저장 안 함)
//  - syncMemAttendance / syncMemNow : mem 근태 자동 가져오기 (맨 아래)
// API 키: Firestore 콘솔 > secrets 컬렉션 > erp 문서 > apiKey 필드 (보안 규칙상 사이트에서는 못 읽음)

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { diff, inspect, needsSync, syncOne } from './sync.js';
import { fetchMemRows, toRecords } from './mem.js';
import { importNewOrders } from './importOrders.js';
import { loadCalendars } from './calendar.js';
import { countryHolidays } from './holidays.js';
import { defineSecret } from 'firebase-functions/params';

initializeApp();
const db = getFirestore();
const REGION = 'asia-northeast3'; // 서울 (Firestore 와 같은 곳)

async function apiKey() {
  const snap = await db.doc('secrets/erp').get();
  // 칸 이름 대소문자가 달라도 읽음 (apiKey / apikey / API_KEY …)
  const data = snap.data() ?? {};
  const field = Object.keys(data).find((k) => k.replace(/[_\s-]/g, '').toLowerCase() === 'apikey');
  const key = field ? data[field] : undefined;
  if (!key) throw new Error('secrets/erp 문서에 apiKey 칸이 없어요');
  return String(key).trim();
}

// 조마다 컬렉션이 따로: 2조 = orders, 1조 = t1_orders, 3조 = t3_orders (config 도 같은 규칙)
// 팀장님·이사님 개인 대시보드: p1a2b3c4_orders …
const TEAMS = ['1', '2', '3'];
const isPersonal = (t) => typeof t === 'string' && /^p[a-z0-9]+$/.test(t);
const colOf = (team, name) => (team === '2' ? name : isPersonal(team) ? `${team}_${name}` : `t${team}_${name}`);

/** 모든 조 + 개인 대시보드 공간 */
async function allSpaces() {
  const roles = await db.collection('roles').get();
  const personal = roles.docs.map((d) => d.get('space')).filter(isPersonal);
  return [...TEAMS, ...new Set(personal)];
}

async function runSync({ companyId, team } = {}) {
  const key = await apiKey();
  const teams = team && (TEAMS.includes(team) || isPersonal(team)) ? [team] : await allSpaces();
  // ① 새 주문 자동 등록 (매장코드가 있는 업체만) → ② 금액 갱신 (새로 만든 주문도 같이)
  const imp = await importNewOrders(db, colOf, teams, key).catch((e) => ({ created: 0, errors: [e.message] }));
  if (imp.created || imp.errors?.length) logger.info('order import', imp);
  let all = { checked: 0, updated: 0, errors: [...(imp.errors ?? [])].slice(0, 5) };
  for (const t of teams) {
    const r = await runTeam(key, t, companyId);
    all = { checked: all.checked + r.checked, updated: all.updated + r.updated, errors: [...all.errors, ...r.errors].slice(0, 10) };
  }
  return { ...all, imported: imp.created ?? 0, at: new Date().toISOString() };
}

async function runTeam(key, team, companyId) {
  const orders = db.collection(colOf(team, 'orders'));
  const snap = companyId ? await orders.where('companyId', '==', companyId).get() : await orders.get();
  const now = Date.now();
  let checked = 0;
  let updated = 0;
  const errors = [];
  for (const d of snap.docs) {
    const o = { ...d.data(), id: d.id };
    if (!needsSync(o, now)) continue;
    checked++;
    try {
      const next = await syncOne(o, key);
      const changed = next ? diff(o, next) : {};
      const stamp = { apiSyncedAt: new Date().toISOString() };
      if (Object.keys(changed).length) {
        await d.ref.update({ ...changed, ...stamp });
        updated++;
      } else if (next) {
        await d.ref.update(stamp);
      }
    } catch (e) {
      errors.push(`${o.name}: ${e.message}`);
      logger.warn('sync failed', o.id, e.message);
    }
  }
  const result = { checked, updated, errors: errors.slice(0, 10), at: new Date().toISOString() };
  await db.doc(`${colOf(team, 'config')}/apiSync`).set({ id: 'apiSync', ...result, ranAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info('sync done', team, result);
  return result;
}

// 평일(월~금) 업무시간에만: 서울 시간 9:00 ~ 18:30, 30분마다
export const syncOrderAmounts = onSchedule({ schedule: '*/30 9-18 * * 1-5', region: REGION, timeZone: 'Asia/Seoul' }, async () => {
  await runSync();
});

export const syncOrderAmountsNow = onCall({ region: REGION }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const me = await db.doc(`roles/${email}`).get();
  const role = me.get('level');
  if (!['admin', 'member', 'lead', 'director'].includes(role)) throw new HttpsError('permission-denied', '대시보드 사용자만 쓸 수 있어요');
  let team = typeof req.data?.team === 'string' ? req.data.team : undefined;
  // 개인 대시보드는 그 주인(또는 관리자)만
  if (isPersonal(team) && role !== 'admin' && me.get('space') !== team) throw new HttpsError('permission-denied', '내 대시보드만 새로고침할 수 있어요');
  if (!team && role !== 'admin') team = role === 'member' ? String(me.get('team') ?? '2') : me.get('space');
  try {
    return await runSync({
      companyId: typeof req.data?.companyId === 'string' ? req.data.companyId : undefined,
      team,
    });
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

export const inspectOrderApi = onCall({ region: REGION }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const role = (await db.doc(`roles/${email}`).get()).get('level');
  if (role !== 'admin') throw new HttpsError('permission-denied', '관리자만 쓸 수 있어요');
  const { orderDate, storeCode, expNo } = req.data ?? {};
  try {
    return await inspect({ orderDate, storeCode, expNo }, await apiKey());
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// ------------------------------------------------------------------
// mem 근태 자동 가져오기 (노트북을 안 켜도 됨)
//  - syncMemAttendance(+Morning) : 평일 9~10시 10분마다, 12·14·16·17·18·19시 (서울)
//  - syncMemNow        : 설정 화면 '지금 가져오기' 버튼 (관리자만, 결과·오류 확인용)
// 아이디·비밀번호: Firebase 비밀값 저장소 (MEM_ID, MEM_PASSWORD) — 이 함수만 읽음
// 주소·칸 이름: Firestore secrets/mem 문서 (functions/mem.js 맨 위 설명)
// ------------------------------------------------------------------
const MEM_ID = defineSecret('MEM_ID');
const MEM_PASSWORD = defineSecret('MEM_PASSWORD');

const seoulDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()); // 2026-11-11

async function runMemSync() {
  const date = seoulDate();
  const status = db.doc('memDirectory/_status');
  try {
    const cfg = (await db.doc('secrets/mem').get()).data();
    if (!cfg) throw new Error('secrets/mem 문서가 없어요 (로그인 주소·근태 주소를 넣어 주세요)');
    // 입력할 때 같이 들어간 줄바꿈·앞뒤 공백 제거 (비밀번호 안쪽 글자는 그대로)
    const id = String(MEM_ID.value() ?? '').trim();
    const pw = String(MEM_PASSWORD.value() ?? '').replace(/^[\r\n]+|[\r\n]+$/g, '');
    if (!id || !pw) throw new Error('MEM_ID / MEM_PASSWORD 비밀값이 없어요');
    // 모든 공간(1~3조·팀장님·이사님·무역사무)이 올려 둔 mem 이름
    const dir = await db.collection('memDirectory').get();
    const names = [...new Set(dir.docs.flatMap((d) => (d.id === '_status' ? [] : d.get('names') ?? [])))];
    if (!names.length) throw new Error('공용 mem 이름 목록이 비어 있어요 (대시보드를 한 번 열면 채워져요)');
    const rows = await fetchMemRows(cfg, id, pw, date);
    const recs = toRecords(rows, names, date);
    const batch = db.batch();
    for (const r of recs) batch.set(db.doc(`memAttendance/${r.id}`), JSON.parse(JSON.stringify(r)));
    await batch.commit();
    const result = { ok: true, at: new Date().toISOString(), date, read: rows.length, saved: recs.length, names: recs.map((r) => r.name) };
    await status.set({ id: '_status', names: [], lastRun: result }, { merge: true });
    logger.info('mem sync', result);
    return result;
  } catch (e) {
    const result = { ok: false, at: new Date().toISOString(), date, error: e.message };
    await status.set({ id: '_status', names: [], lastRun: result }, { merge: true });
    logger.warn('mem sync failed', e.message);
    return result;
  }
}

// 평일: 9시 · 10시 · 12시 · 2시 · 4시 · 5시 · 6시 · 7시 (서울, 정각)
// + 출근 시간대 9:10 ~ 9:50 은 10분마다 (9:00 · 10:00 은 위에서) → 9~10시는 10분 간격
const memOpts = { region: REGION, timeZone: 'Asia/Seoul', secrets: [MEM_ID, MEM_PASSWORD] };
export const syncMemAttendance = onSchedule({ ...memOpts, schedule: '0 9,10,12,14,16,17,18,19 * * 1-5' }, async () => {
  await runMemSync();
});
export const syncMemAttendanceMorning = onSchedule({ ...memOpts, schedule: '10-50/10 9 * * 1-5' }, async () => {
  await runMemSync();
});

export const syncMemNow = onCall({ region: REGION, secrets: [MEM_ID, MEM_PASSWORD] }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const role = (await db.doc(`roles/${email}`).get()).get('level');
  if (role !== 'admin') throw new HttpsError('permission-denied', '관리자만 쓸 수 있어요');
  return runMemSync();
});

// ------------------------------------------------------------------
// 업체 담당 조 바꾸기 (팀장님·이사님·관리자): 업체와 그 업체의 할일·주문·클레임을 다른 조로 옮김
// 조원은 다른 조 데이터를 못 고치므로 서버에서 권한 확인 후 처리
// ------------------------------------------------------------------
export const moveCompanyTeam = onCall({ region: REGION }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const role = (await db.doc(`roles/${email}`).get()).get('level');
  if (!['admin', 'lead', 'director'].includes(role)) throw new HttpsError('permission-denied', '팀장님·이사님·관리자만 바꿀 수 있어요');
  const { companyId, from, to } = req.data ?? {};
  if (typeof companyId !== 'string' || !TEAMS.includes(from) || !TEAMS.includes(to) || from === to) throw new HttpsError('invalid-argument', '업체·조를 확인해 주세요');

  const src = db.doc(`${colOf(from, 'companies')}/${companyId}`);
  const snap = await src.get();
  if (!snap.exists) throw new HttpsError('not-found', '업체를 찾을 수 없어요');
  const destCount = (await db.collection(colOf(to, 'companies')).count().get()).data().count;

  // 옮길 것: 업체 + 그 업체의 할일·주문·클레임
  const moves = [{ from: src, to: db.doc(`${colOf(to, 'companies')}/${companyId}`), data: { ...snap.data(), order: destCount } }];
  const counts = {};
  for (const name of ['tasks', 'orders', 'claims']) {
    const docs = (await db.collection(colOf(from, name)).where('companyId', '==', companyId).get()).docs;
    counts[name] = docs.length;
    for (const d of docs) moves.push({ from: d.ref, to: db.doc(`${colOf(to, name)}/${d.id}`), data: d.data() });
  }
  for (let i = 0; i < moves.length; i += 200) {
    const batch = db.batch();
    for (const m of moves.slice(i, i + 200)) {
      batch.set(m.to, m.data);
      batch.delete(m.from);
    }
    await batch.commit();
  }
  logger.info('company moved', { companyId, from, to, by: email, ...counts });
  return { ok: true, name: snap.get('name'), ...counts };
});

// ------------------------------------------------------------------
// 구글 캘린더 (iCal 비공개 주소). 주소는 secrets/calendars 에만 — 사이트에서는 일정만 받음
//  - calendarEvents : 기간 안 일정 (대시보드 사용자 모두)
//  - calendarConfig / saveCalendars : 달력 목록 보기·저장 (관리자, 주소는 가려서 보여줌)
// ------------------------------------------------------------------
async function roleOf(req) {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  return (await db.doc(`roles/${email}`).get()).get('level');
}
const calList = async () => ((await db.doc('secrets/calendars').get()).get('list') ?? []).filter((c) => c && c.url);

export const calendarEvents = onCall({ region: REGION }, async (req) => {
  const role = await roleOf(req);
  if (!['admin', 'member', 'trade', 'lead', 'director'].includes(role)) throw new HttpsError('permission-denied', '대시보드 사용자만 볼 수 있어요');
  const from = new Date(req.data?.from);
  const to = new Date(req.data?.to);
  if (Number.isNaN(+from) || Number.isNaN(+to) || to <= from || to - from > 70 * 86400000) throw new HttpsError('invalid-argument', '기간을 확인해 주세요');
  const shared = await calList();
  // 내 달력: userCalendars/{내 이메일} (본인만 읽고 쓰는 문서)
  const email = req.auth.token.email.toLowerCase();
  const mine = ((await db.doc(`userCalendars/${email}`).get()).get('list') ?? [])
    .filter((c) => c && typeof c.url === 'string' && /^https:\/\//.test(c.url.replace(/^webcal:/, 'https:')))
    .slice(0, 10)
    .map((c, i) => ({ id: `u_${c.id ?? i}`, name: String(c.name || '내 달력'), color: c.color || '#7a4bb0', url: c.url.replace(/^webcal:/, 'https:'), mine: true }));
  const list = [...shared, ...mine];
  const { events, errors } = await loadCalendars(list, from, to);
  return { calendars: list.map(({ id, name, color, mine: m }) => ({ id, name, color, mine: !!m })), events, errors };
});

export const calendarConfig = onCall({ region: REGION }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 볼 수 있어요');
  return { list: (await calList()).map(({ id, name, color, url }) => ({ id, name, color, masked: `${url.slice(0, 48)}…` })) };
});

export const saveCalendars = onCall({ region: REGION }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 바꿀 수 있어요');
  const old = await calList();
  const input = Array.isArray(req.data?.list) ? req.data.list.slice(0, 10) : [];
  const list = [];
  for (const c of input) {
    const id = String(c.id || Math.random().toString(36).slice(2, 10));
    const url = c.url ? String(c.url).trim().replace(/^webcal:/, 'https:') : old.find((o) => o.id === id)?.url;
    if (!url || !/^https:\/\//.test(url)) throw new HttpsError('invalid-argument', `'${c.name}' 주소를 확인해 주세요 (https:// 로 시작하는 iCal 주소)`);
    list.push({ id, name: String(c.name || '달력').slice(0, 30), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#8c2f3c', url });
  }
  await db.doc('secrets/calendars').set({ list });
  return { ok: true, count: list.length };
});

// ------------------------------------------------------------------
// 나라별 공휴일·기념일 (음력 포함, 구글 공휴일 달력) — 홈 세계 시계용
// 나라·해마다 holidayCache/{코드}_{해} 에 7일 보관 (사이트에서는 이 함수로만 받음)
// ------------------------------------------------------------------
export const worldHolidays = onCall({ region: REGION }, async (req) => {
  const role = await roleOf(req);
  if (!['admin', 'member', 'trade', 'lead', 'director'].includes(role)) throw new HttpsError('permission-denied', '대시보드 사용자만');
  const year = Number(req.data?.year);
  const codes = (Array.isArray(req.data?.codes) ? req.data.codes : []).map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 15);
  if (!Number.isInteger(year) || year < 2025 || year > 2100) throw new HttpsError('invalid-argument', '해를 확인해 주세요');
  const out = {};
  for (const cc of [...new Set(codes)]) {
    const ref = db.doc(`holidayCache/${cc}_${year}`);
    const hit = await ref.get();
    if (hit.exists && Date.now() - Date.parse(hit.get('at')) < 7 * 86400000) {
      out[cc] = hit.get('days') ?? null;
      continue;
    }
    try {
      const days = await countryHolidays(cc, year);
      await ref.set({ at: new Date().toISOString(), days: days ?? null });
      out[cc] = days;
    } catch (e) {
      logger.warn('holiday fetch failed', cc, e.message);
      out[cc] = hit.exists ? hit.get('days') ?? null : null;
    }
  }
  return out;
});

// ------------------------------------------------------------------
// 판매 데이터 (POS 계산 건 → 지점·일자별 합계) — 홈 맨 아래 '업체별 판매 데이터'
// 매주 월요일 아침 7시(서울) 지난 달 + 이번 달을 다시 계산 (salesBackfill). 주소·칸 이름은 secrets/sales
// ------------------------------------------------------------------
import { detectFields, fetchSales, isAbbr, lastDays, monthDays, syncSalesDates, aggregate } from './sales.js';
import { syncFx } from './fx.js';

// 기본값: getExportSalesUpload.asp?STORE_CODE=8254&DATE_FROM=2026.10.01&DATE_TO=2026.10.10
const SALES_DEFAULTS = { dateParam: 'DATE_FROM', endParam: 'DATE_TO', storeParam: 'STORE_CODE', dateFormat: 'dot' };
const salesCfg = async () => {
  const d = (await db.doc('secrets/sales').get()).data() ?? {};
  const out = { ...SALES_DEFAULTS, fields: {} };
  for (const [k, v] of Object.entries(d)) if (v !== undefined && v !== null) out[k] = v;
  return out;
};
/** 매장코드 → { STORE_ID: 지점 약자(BRANCH_NAME) } (storeBranches 에 7일 보관) */
async function branchesFor(code) {
  const ref = db.doc(`storeBranches/${code}`);
  const hit = await ref.get();
  if (hit.exists && Object.keys(hit.get('branches') ?? {}).length && Date.now() - Date.parse(hit.get('at')) < 7 * 86400000) return hit.get('branches');
  const branches = await branchesOf(code, await apiKey(), { known: Object.keys(hit.get('branches') ?? {}) });
  await ref.set({ code, branches, at: new Date().toISOString() });
  return branches;
}
// 설정 › 매장 평수에서 직접 넣은 지점 약자 (STORE_ID → 약자) — 자동으로 불러온 이름보다 먼저
let abbrOverrides = {};
async function allStoreCodes() {
  const codes = new Set();
  abbrOverrides = {};
  for (const space of await allSpaces()) {
    for (const d of (await db.collection(colOf(space, 'companies')).get()).docs) {
      if (!d.get('salesOn')) continue; // 설정에서 '판매데이터 수집 중' 켠 업체만
      for (const c of d.get('storeCodes') ?? []) codes.add(String(c).trim());
      for (const [sid, a] of Object.entries(d.get('storeAbbr') ?? {})) if (a) abbrOverrides[sid] = String(a).trim();
    }
  }
  return codes;
}
/** 지점 목록 + 직접 넣은 약자 */
async function branchesWithAbbr(code) {
  const base = await branchesFor(code).catch(() => ({}));
  const out = { ...base };
  for (const [sid, a] of Object.entries(abbrOverrides)) if (sid.startsWith(code)) out[sid] = a;
  return out;
}
async function runSales({ days = 3, month, only, stores, from, to } = {}) {
  const cfg = await salesCfg();
  if (!cfg.url) return { skipped: '판매 데이터 API 주소가 아직 없어요' };
  const key = await apiKey();
  let codes = await allStoreCodes();
  // 업체 하나만 (그 업체 매장코드만) — API 를 덜 부르려고
  if (only?.length) codes = new Set([...codes].filter((c) => only.includes(c)));
  if (!codes.size) return { skipped: "'판매데이터 수집 중'을 켠 업체(매장코드 있는)가 없어요" };
  const today = lastDays(1)[0];
  // 기간: 직접 (from~to) / 한 달 / 최근 n일
  let dates = month ? monthDays(month, today) : lastDays(days);
  if (from && to) {
    dates = [];
    for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`) && dates.length < 93; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10));
    dates = dates.filter((d) => d <= today);
  }
  const r = await syncSalesDates(db, cfg, key, dates, [...codes], { branchesFor: branchesWithAbbr, onlyStores: stores?.length ? new Set(stores) : undefined });
  // 로열티 환율 (ECOS): 그 달 + 앞 달 (월초 주말은 앞 달 마지막 영업일 환율을 씀)
  const fxMonth = month ?? today.slice(0, 7);
  const fx = await runFx([prevMonth(fxMonth), fxMonth]).catch((e) => ({ errors: [e.message] }));
  const result = { ...r, errors: [...(r.errors ?? []), ...(fx.errors ?? [])].slice(0, 10), fxSaved: fx.saved ?? 0, month: month ?? null, at: new Date().toISOString() };
  await db.doc('salesStatus/last').set(result);
  logger.info('sales sync', result);
  return result;
}

// ---- ECOS 환율 (로열티: 판매일 환율로 원화·달러 환산) ----
const prevMonth = (m) => {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
async function ecosKey() {
  const k = (await db.doc('secrets/ecos').get()).get('apiKey');
  return k ? String(k).trim() : '';
}
async function fxCurrencies() {
  const set = new Set(['USD']);
  for (const space of await allSpaces()) {
    for (const d of (await db.collection(colOf(space, 'companies')).get()).docs) if (d.get('royalty') && d.get('salesCurrency')) set.add(String(d.get('salesCurrency')));
  }
  return [...set];
}
async function runFx(months) {
  const key = await ecosKey();
  if (!key) return { saved: 0, errors: ['ECOS 인증키가 아직 없어요 (설정 > 판매 데이터 API)'] };
  return syncFx(db, key, await fxCurrencies(), months);
}
export const syncFxNow = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있어요');
  const month = typeof req.data?.month === 'string' && /^\d{4}-\d{2}$/.test(req.data.month) ? req.data.month : lastDays(1)[0].slice(0, 7);
  return runFx([prevMonth(month), month]);
});

// (자동 가져오기는 아래 salesBackfill: 매주 월요일 7시)

// 관리자: 지금 가져오기 (최근 n일 또는 한 달 통째로 — 지난 달 채우기)
export const syncSalesNow = onCall({ region: REGION, timeoutSeconds: 540 }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있어요');
  const month = typeof req.data?.month === 'string' && /^\d{4}-\d{2}$/.test(req.data.month) ? req.data.month : undefined;
  const days = Math.min(Math.max(Number(req.data?.days) || 3, 1), 31);
  const only = Array.isArray(req.data?.codes) ? req.data.codes.map((c) => String(c).trim()).filter((c) => /^\d{4}$/.test(c)).slice(0, 20) : undefined;
  try {
    const stores = Array.isArray(req.data?.branches) ? req.data.branches.map((x) => String(x).trim()).filter((x) => /^\d{5,8}$/.test(x)).slice(0, 50) : undefined;
    const isoOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (isoOk(req.data?.from) && isoOk(req.data?.to) && req.data.from <= req.data.to) return await runSales({ from: req.data.from, to: req.data.to, only, stores });
    return await runSales(month ? { month, only, stores } : { days, only, stores });
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// 관리자: API 응답 원본 보기 (저장 안 함) — 칸 이름 확인용
export const inspectSalesApi = onCall({ region: REGION }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 볼 수 있어요');
  const date = typeof req.data?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.data.date) ? req.data.date : lastDays(2)[1];
  const cfg = await salesCfg();
  try {
    // 확인용: 고른 매장코드·지점·기간 (없으면 판매데이터 켠 첫 업체 · 최근 7일)
    await allStoreCodes();
    const code = /^\d{4}$/.test(String(req.data?.code ?? '')) ? String(req.data.code) : [...(await allStoreCodes())][0];
    const branches = code ? await branchesWithAbbr(code) : {};
    const abbrToId = {};
    for (const [sid, a] of Object.entries(branches)) if (a) abbrToId[String(a).toUpperCase()] = sid;
    const isoOk = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
    const to = isoOk(req.data?.to) ? req.data.to : date;
    const from = isoOk(req.data?.from) ? req.data.from : cfg.endParam ? lastDays(8)[7] : date;
    const pickSid = /^\d{5,8}$/.test(String(req.data?.sid ?? '')) ? String(req.data.sid) : Object.entries(branches).find(([, a]) => isAbbr(a))?.[0];
    const abbr = pickSid ? branches[pickSid] : undefined;
    const bp = cfg.branchParam || 'BRANCH_ABBR';
    // 시도: ① 매장코드 4자리 + 지점 약자 → ② 6자리 지점 코드만 → ③ 매장코드 4자리만
    const tries = [];
    if (code && abbr) tries.push({ [cfg.storeParam]: code, [bp]: abbr });
    if (pickSid) tries.push({ [cfg.storeParam]: pickSid });
    if (code) tries.push({ [cfg.storeParam]: code });
    const key = await apiKey();
    const attempts = [];
    let res = null;
    let extra = {};
    let first = pickSid ? [abbr, pickSid] : undefined;
    for (const t of tries) {
      const q = Object.entries(t).map(([k, v]) => `${k}=${v}`).join('&');
      try {
        const r = await fetchSales(cfg, key, from, to, fetch, t);
        attempts.push(`${q} → ${r.rows.length}줄`);
        if (r.rows.length && !res) {
          res = r;
          extra = t;
          if (!t[bp] && t[cfg.storeParam] === code) first = undefined;
        }
      } catch (e) {
        attempts.push(`${q} → ${e.message.slice(0, 160)}`);
      }
      if (res) break;
    }
    if (!res) res = { rows: [], body: null };
    const { rows, body } = res;
    const fields = detectFields(rows, cfg.fields ?? {});
    const sums = aggregate(rows, fields, from === to ? to : undefined, first?.[1], { abbrToId, code }).sort((a, b) => b.amount - a.amount).slice(0, 15);
    return { attempts, date: from === to ? to : `${from} ~ ${to}`, called: Object.entries(extra).map(([k, v]) => `${k}=${v}`).join('&'), total: rows.length, keys: Object.keys(rows[0] ?? {}), sample: rows.slice(0, 5), fields, sums, top: rows.length ? undefined : JSON.stringify(body).slice(0, 500) };
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

export const salesConfig = onCall({ region: REGION }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 볼 수 있어요');
  const c = await salesCfg();
  return { hasEcos: !!(await ecosKey()), hasUrl: !!c.url, masked: c.url ? `${c.url.slice(0, 40)}…` : '', dateParam: c.dateParam, endParam: c.endParam, storeParam: c.storeParam, dateFormat: c.dateFormat, fields: c.fields ?? {} };
});

export const saveSalesConfig = onCall({ region: REGION }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 바꿀 수 있어요');
  const d = req.data ?? {};
  const old = await salesCfg();
  const url = d.url ? String(d.url).trim() : old.url;
  if (url && !/^https?:\/\//.test(url)) throw new HttpsError('invalid-argument', 'http(s):// 로 시작하는 주소를 넣어 주세요');
  const name = (v) => String(v ?? '').trim().replace(/[^\w가-힣]/g, '').slice(0, 40);
  const fields = Object.fromEntries(['date', 'amount', 'store', 'storeCode', 'name'].map((k) => [k, name(d.fields?.[k])]).filter(([, v]) => v));
  if (d.ecosKey) await db.doc('secrets/ecos').set({ apiKey: String(d.ecosKey).trim() });
  await db.doc('secrets/sales').set({
    url: url ?? '',
    dateParam: name(d.dateParam) || 'DATE_FROM',
    endParam: name(d.endParam),
    storeParam: name(d.storeParam),
    dateFormat: ['dot', 'dash', 'compact'].includes(d.dateFormat) ? d.dateFormat : 'dot',
    fields,
  });
  return { ok: true };
});

// ------------------------------------------------------------------
// 지점 목록·이름 (설정 > 매장 평수): 매장코드 4자리로 시작하는 지점을 ERP 거래처 정보에서
// storeBranches/{코드} 에 7일 보관 (사이트는 읽기만)
// ------------------------------------------------------------------
import { branchesOf } from './branches.js';

export const storeBranches = onCall({ region: REGION, timeoutSeconds: 300 }, async (req) => {
  const role = await roleOf(req);
  if (!['admin', 'member', 'lead', 'director'].includes(role)) throw new HttpsError('permission-denied', '대시보드 사용자만');
  const codes = (Array.isArray(req.data?.codes) ? req.data.codes : []).map((c) => String(c).trim()).filter((c) => /^\d{4}$/.test(c)).slice(0, 30);
  const refresh = !!req.data?.refresh;
  const key = await apiKey();
  const out = {};
  for (const code of [...new Set(codes)]) {
    const ref = db.doc(`storeBranches/${code}`);
    const hit = await ref.get();
    if (!refresh && hit.exists && Date.now() - Date.parse(hit.get('at')) < 7 * 86400000) {
      out[code] = hit.get('branches') ?? {};
      continue;
    }
    const branches = await branchesOf(code, key, { known: Object.keys(hit.get('branches') ?? {}) });
    await ref.set({ code, branches, at: new Date().toISOString() });
    out[code] = branches;
  }
  return out;
});

// ------------------------------------------------------------------
// 수출매출 지난 데이터 한 번 채우기 (2026-01-01 ~ 시작한 날): ERP 에서 직접 → exportMonthly
// 새벽 4시부터 (4:00~5:50) 10분마다 이어서 하고, 다 채우면 그 뒤로는 아무것도 안 함 (앞으로는 주문 관리 데이터로)
// ------------------------------------------------------------------
import { runExportSync } from './exportData.js';

async function everyStoreCode() {
  const codes = new Set();
  for (const space of await allSpaces()) {
    for (const d of (await db.collection(colOf(space, 'companies')).get()).docs) for (const c of d.get('storeCodes') ?? []) codes.add(String(c).trim());
  }
  return codes;
}
async function runBackfill() {
  const r = await runExportSync(db, await apiKey(), await everyStoreCode(), { from: '2026-01-01' });
  logger.info('export backfill', r);
  return r;
}
export const exportBackfill = onSchedule({ schedule: '*/10 4-5 * * *', region: REGION, timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  await runBackfill();
});
export const exportBackfillNow = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있어요');
  try {
    return await runBackfill();
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// ------------------------------------------------------------------
// 판매 데이터 지난 달 한 번 채우기 (2026-01 ~ 이번 달): 첫 월요일 7시부터 10분마다 한 달씩 이어서, 다 채우면 멈춤
// 어디까지 했는지: salesBackfill/state { next: 'YYYY-MM', done }
// ------------------------------------------------------------------
async function runSalesBackfill({ from = '2026-01', budgetMs = 450000 } = {}) {
  const ref = db.doc('salesBackfill/state');
  const st = (await ref.get()).data() ?? {};
  if (st.from === from && st.done) return { skipped: '이미 다 채웠어요', ...st };
  const until = Date.now() + budgetMs;
  const thisMonth = lastDays(1)[0].slice(0, 7);
  const end = st.from === from && st.end ? st.end : thisMonth;
  let next = st.from === from && st.next ? st.next : from;
  const results = [];
  while (next <= end && Date.now() < until) {
    const r = await runSales({ month: next });
    results.push({ month: next, rows: r.rows ?? 0, errors: (r.errors ?? []).length, skipped: r.skipped });
    if (r.skipped) break; // 주소·업체 설정이 없으면 다음에
    const [y, m] = next.split('-').map(Number);
    next = `${m === 12 ? y + 1 : y}-${String((m % 12) + 1).padStart(2, '0')}`;
  }
  const state = { from, end, next, done: next > end, at: new Date().toISOString(), last: results };
  await ref.set(state);
  logger.info('sales backfill', state);
  return state;
}
// 매주 월요일 아침 7시 (7:00~7:50 10분마다 이어서):
//  처음 한 번은 2026년 1월부터 이번 달까지 → 그 뒤로는 매주 '지난 달 + 이번 달' 만 다시 (한 달 치를 한꺼번에 올리는 매장도 잡히게)
export const salesBackfill = onSchedule({ schedule: '*/10 7 * * 1', region: REGION, timeZone: 'Asia/Seoul', timeoutSeconds: 540, memory: '512MiB' }, async () => {
  const ref = db.doc('salesBackfill/state');
  const st = (await ref.get()).data() ?? {};
  if (!st.done) {
    await runSalesBackfill();
    return;
  }
  const today = lastDays(1)[0];
  const thisMonth = today.slice(0, 7);
  const months = [prevMonth(thisMonth), thisMonth];
  // 이번 주 몇 번째 달까지 했는지 (10분마다 이어서)
  let idx = st.weeklyDate === today ? st.weeklyIdx ?? 0 : 0;
  const until = Date.now() + 450000;
  const results = [];
  while (idx < months.length && Date.now() < until) {
    const r = await runSales({ month: months[idx] });
    results.push({ month: months[idx], rows: r.rows ?? 0, errors: (r.errors ?? []).length, skipped: r.skipped ?? null });
    idx++;
  }
  await ref.set({ weeklyDate: today, weeklyIdx: idx, lastWeekly: { at: new Date().toISOString(), results } }, { merge: true });
});
export const salesBackfillNow = onCall({ region: REGION, timeoutSeconds: 540, memory: '512MiB' }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있어요');
  try {
    return await runSalesBackfill();
  } catch (e) {
    throw new HttpsError('internal', e.message);
  }
});

// ------------------------------------------------------------------
// 지난 수출 주문 (ERP 채우기 결과 exportOrders) → 각 조 주문 관리에 넣기 (관리자 버튼)
// 이미 같은 EXP_NO 주문이 있으면 건너뜀. 전부 출고승인 난 건은 '완료'로, 아니면 진행중으로
// 다 끝난 건은 erpArchive 표시 → 금액 자동 갱신이 다시 안 부름 (API 를 덜 부르려고)
// ------------------------------------------------------------------
export const importExportOrders = onCall({ region: REGION, timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  if ((await roleOf(req)) !== 'admin') throw new HttpsError('permission-denied', '관리자만 할 수 있어요');
  const all = (await db.collection('exportOrders').get()).docs.map((d) => d.data());
  const iso = (v) => (v ? String(v).replaceAll('.', '-').slice(0, 10) : undefined);
  const r2 = (n) => Math.round(n * 100) / 100;
  let created = 0;
  let skipped = 0;
  const perTeam = {};
  for (const team of TEAMS) {
    const cos = (await db.collection(colOf(team, 'companies')).get()).docs;
    const byCode = new Map();
    for (const d of cos) for (const c of d.get('storeCodes') ?? []) byCode.set(String(c).trim(), d.id);
    if (!byCode.size) continue;
    const ordersCol = db.collection(colOf(team, 'orders'));
    const have = new Set((await ordersCol.get()).docs.map((d) => String(d.get('expNo') ?? '')).filter(Boolean));
    let batch = db.batch();
    let n = 0;
    for (const o of all) {
      const companyId = byCode.get(o.code);
      if (!companyId) continue;
      if (have.has(o.expNo)) {
        skipped++;
        continue;
      }
      const rows = o.outRows ?? [];
      const ok = rows.filter((x) => x.status === '출고승인');
      const done = rows.length > 0 && ok.length === rows.length;
      const id = `erp${o.expNo}`;
      const order = {
        id,
        companyId,
        name: `ERP ${o.expNo}`,
        realOrder: true,
        erp: true,
        inbound: done,
        invoice: done,
        shipped: done,
        storeCode: o.storeId,
        orderDate: iso(o.orderDate),
        expNo: o.expNo,
        amountKRW: Math.round(ok.length ? ok.reduce((a, x) => a + (x.k ?? 0), 0) : o.planK ?? 0),
        amountForeign: r2(ok.length ? ok.reduce((a, x) => a + (x.f ?? 0), 0) : o.planF ?? 0),
        planKRW: Math.round(o.planK ?? 0),
        planForeign: r2(o.planF ?? 0),
        amountSource: ok.length ? 'api-outbound' : 'api-order',
        outStatus: done ? 'approved' : ok.length ? 'partial' : 'pending',
        outDate: ok.map((x) => iso(x.date)).filter(Boolean).sort().pop(),
        outRows: rows.map((x) => ({ date: x.date ?? null, status: x.status ?? '', k: x.k ?? null, f: x.f ?? null })),
        autoImported: true,
        erpArchive: done || undefined,
        apiSyncedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      for (const k of Object.keys(order)) if (order[k] === undefined) delete order[k];
      batch.set(ordersCol.doc(id), order);
      have.add(o.expNo);
      n++;
      created++;
      perTeam[team] = (perTeam[team] ?? 0) + 1;
      if (n >= 400) {
        await batch.commit();
        batch = db.batch();
        n = 0;
      }
    }
    if (n) await batch.commit();
  }
  return { created, skipped, perTeam, total: all.length };
});
