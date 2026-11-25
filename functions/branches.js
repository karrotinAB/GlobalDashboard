// 지점 이름 (getpartnerinfo.asp → BRANCH_NAME) + 매장코드 4자리로 시작하는 지점 목록
// 결과는 storeBranches/{매장코드 4자리} 에 저장: { code, branches: { [STORE_ID]: 이름 }, at }
// 4자리(점포코드)로 한 번 부르면 하위 매장 전체가 옴 (6자리 = 그 매장 하나) — 7일 보관
import { call } from './sync.js';

// 지점 약자(LDC 등)가 판매 API 의 BRANCH_ABBR 로 쓰임 → 약자 칸이 따로 있으면 그걸 먼저
const nameOf = (r) => String(r?.BRANCH_ABBR ?? r?.BRANCH_NAME ?? r?.STORE_NAME ?? r?.STORE_NM ?? '').trim();
const idOf = (r) => String(r?.STORE_ID ?? '').trim();
// 수출 형태: EXPORT_FORM_GUBN = '직수출' / '구매확인서'
const formOf = (r) => String(r?.EXPORT_FORM_GUBN ?? '').trim();

async function safeCall(params, key, fetchImpl) {
  try {
    return await call('getpartnerinfo.asp', params, key, fetchImpl);
  } catch {
    return [];
  }
}

/** 매장코드 4자리 → { STORE_ID: 이름 } */
// forms 를 넘기면 { STORE_ID: 수출 형태 } 도 같이 채움
export async function branchesOf(code, key, { fetchImpl = fetch, forms } = {}) {
  const out = {};
  const add = (rows, fallbackId) => {
    for (const r of rows) {
      const id = idOf(r) || fallbackId;
      if (id && id.startsWith(code)) {
        out[id] = nameOf(r) || out[id] || '';
        if (forms && formOf(r)) forms[id] = formOf(r);
      }
    }
  };
  // 4자리로 부르면 하위 매장이 다 옴 (IT실 안내) — 01~99 하나씩 물어보던 건 없앰
  add(await safeCall({ STORE_ID: code }, key, fetchImpl));
  return out;
}
