// 관리부 패킹 상태 (회사 API — 아직 못 받음 · 틀만): 주문마다 '패킹리스트 등록여부' · '최종승인 여부'
//   → 주문 문서의 packListDone / packListAt · finalApproved / finalApprovedAt 을 채움
//   사이트(주문 관리 › 관리부 패킹)는 이 칸만 보면 바로 ✓ 완료 · ⚠ 지연 · 팔렛트 채운 원을 그림
//
// TODO (API 받으면):
//   1. URL · 요청 파라미터 (EXP_NO? 매장코드 + 주문일자? 기간?) 와 키 (secrets/erp apiKey 로 되는지)
//   2. 응답 칸 이름 · 값 모양 (O/X · Y/N · 날짜?) → toBool / toDate 고치기
//   3. 주문 맞추기 기준 (EXP_NO 가 제일 확실) → matchOrder 고치기
//   4. index.js 에 연결: import { syncPackStatus } from './packStatus.js' + 스케줄 (예: 평일 9~18시 30분마다, 진행중 ERP 등록 주문만)
//   회사 API 제한: 1분 30번 → 부를 때마다 2.1초 이상 쉼 (skuMissing.js call() 그대로 써도 됨)

const API_URL = ''; // TODO

/** 'O' · 'Y' · '1' · true · 날짜 글자 → true */
export const toBool = (v) => {
  if (v === true) return true;
  const s = String(v ?? '').trim().toUpperCase();
  return s === 'O' || s === 'Y' || s === '1' || s === 'TRUE' || /^\d{4}[-.]?\d{2}[-.]?\d{2}/.test(s);
};
/** 날짜처럼 생긴 값 → YYYY-MM-DD (아니면 undefined) */
export const toDate = (v) => {
  const m = String(v ?? '').match(/(\d{4})[-.]?(\d{2})[-.]?(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
};

/** API 한 줄 → { packListDone, packListAt, finalApproved, finalApprovedAt } — TODO: 실제 칸 이름으로 */
export function statusOf(row) {
  const pack = row?.PACKING_LIST_YN ?? row?.packing_list_yn; // TODO
  const appr = row?.FINAL_APPROVAL_YN ?? row?.final_approval_yn; // TODO
  return {
    ...(pack !== undefined ? { packListDone: toBool(pack), packListAt: toDate(pack) } : {}),
    ...(appr !== undefined ? { finalApproved: toBool(appr), finalApprovedAt: toDate(appr) } : {}),
  };
}

/** 진행중 ERP 등록 주문들의 상태를 API 로 확인해서 바뀐 것만 저장 — TODO: API 받으면 채우기 */
export async function syncPackStatus(db, { teams = ['1', '2', '3'] } = {}) {
  if (!API_URL) return { skipped: '패킹 상태 API 가 아직 없어요' };
  void db;
  void teams;
  // for (const t of teams) {
  //   const col = t === '2' ? 'orders' : `t${t}_orders`;
  //   const snap = await db.collection(col).where('erp', '==', true).get();
  //   for (const d of snap.docs) { ... API 로 확인 → statusOf(row) → 바뀐 칸만 d.ref.update(...) }
  // }
  return { updated: 0 };
}
