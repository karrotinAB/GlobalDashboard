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
  let all = { checked: 0, updated: 0, errors: [] };
  for (const t of teams) {
    const r = await runTeam(key, t, companyId);
    all = { checked: all.checked + r.checked, updated: all.updated + r.updated, errors: [...all.errors, ...r.errors].slice(0, 10) };
  }
  return { ...all, at: new Date().toISOString() };
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
//  - syncMemAttendance : 평일 8:00~19:30 (서울) 30분마다
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

export const syncMemAttendance = onSchedule(
  { schedule: '*/30 8-19 * * 1-5', region: REGION, timeZone: 'Asia/Seoul', secrets: [MEM_ID, MEM_PASSWORD] },
  async () => {
    await runMemSync();
  },
);

export const syncMemNow = onCall({ region: REGION, secrets: [MEM_ID, MEM_PASSWORD] }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const role = (await db.doc(`roles/${email}`).get()).get('level');
  if (role !== 'admin') throw new HttpsError('permission-denied', '관리자만 쓸 수 있어요');
  return runMemSync();
});
