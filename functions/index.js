// Firebase 서버 함수 (배포: 저장소 폴더에서  npx firebase-tools deploy --only functions)
//  - syncOrderAmounts     : 30분마다 자동으로 주문 금액 갱신
//  - syncOrderAmountsNow  : 주문 관리의 '금액 새로고침' 버튼 (대시보드 사용자만)
//  - inspectOrderApi      : 관리자 확인용 — ERP API 응답 원본 보기 (아무것도 저장 안 함)
// API 키: Firestore 콘솔 > secrets 컬렉션 > erp 문서 > apiKey 필드 (보안 규칙상 사이트에서는 못 읽음)

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { diff, inspect, needsSync, syncOne } from './sync.js';

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

async function runSync({ companyId } = {}) {
  const key = await apiKey();
  const snap = companyId ? await db.collection('orders').where('companyId', '==', companyId).get() : await db.collection('orders').get();
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
  await db.doc('config/apiSync').set({ id: 'apiSync', ...result, ranAt: FieldValue.serverTimestamp() }, { merge: true });
  logger.info('sync done', result);
  return result;
}

export const syncOrderAmounts = onSchedule({ schedule: 'every 30 minutes', region: REGION, timeZone: 'Asia/Seoul' }, async () => {
  await runSync();
});

export const syncOrderAmountsNow = onCall({ region: REGION }, async (req) => {
  const email = req.auth?.token?.email?.toLowerCase();
  if (!email) throw new HttpsError('unauthenticated', '로그인이 필요해요');
  const role = (await db.doc(`roles/${email}`).get()).get('level');
  if (role !== 'admin' && role !== 'member') throw new HttpsError('permission-denied', '대시보드 사용자만 쓸 수 있어요');
  try {
    return await runSync({ companyId: typeof req.data?.companyId === 'string' ? req.data.companyId : undefined });
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
