// 지점 이름 (getpartnerinfo.asp → BRANCH_NAME) + 매장코드 4자리로 시작하는 지점 목록
// 결과는 storeBranches/{매장코드 4자리} 에 저장: { code, branches: { [STORE_ID]: 이름 }, at }
// 1) STORE_ID 없이 / 4자리로 불렀을 때 목록이 오면 그걸 씀
// 2) 안 오면 4자리 + 01~99 를 하나씩 확인 (한 번 해 두면 7일 보관)
import { call } from './sync.js';

// 지점 약자(LDC 등)가 판매 API 의 BRANCH_ABBR 로 쓰임 → 약자 칸이 따로 있으면 그걸 먼저
const nameOf = (r) => String(r?.BRANCH_ABBR ?? r?.BRANCH_NAME ?? r?.STORE_NAME ?? r?.STORE_NM ?? '').trim();
const idOf = (r) => String(r?.STORE_ID ?? '').trim();

async function safeCall(params, key, fetchImpl) {
  try {
    return await call('getpartnerinfo.asp', params, key, fetchImpl);
  } catch {
    return [];
  }
}

/** 매장코드 4자리 → { STORE_ID: 이름 } */
export async function branchesOf(code, key, { fetchImpl = fetch, known = [] } = {}) {
  const out = {};
  const add = (rows, fallbackId) => {
    for (const r of rows) {
      const id = idOf(r) || fallbackId;
      if (id && id.startsWith(code)) out[id] = nameOf(r) || out[id] || '';
    }
  };
  // 4자리로 부르면 그 매장들이 다 오는 경우
  add(await safeCall({ STORE_ID: code }, key, fetchImpl));
  if (Object.keys(out).length <= 1) {
    // 하나씩: code+01 … code+99 (10개씩 동시에)
    const ids = [...new Set([...Array.from({ length: 99 }, (_, i) => `${code}${String(i + 1).padStart(2, '0')}`), ...known.filter((k) => k.startsWith(code))])];
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const res = await Promise.all(part.map((id) => safeCall({ STORE_ID: id }, key, fetchImpl)));
      res.forEach((rows, j) => add(rows.slice(0, 1).filter((r) => !idOf(r) || idOf(r) === part[j]), part[j]));
    }
  }
  return out;
}
