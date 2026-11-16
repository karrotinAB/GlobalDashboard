// 팀장님·이사님 화면: 조 업체(team 표시)의 클레임은 그 조 공간에 있음 → 필요한 조만 불러와 합침 (읽기만)
import { useMemo } from 'react';
import { useSpaceData } from '../data/store';
import type { Claim, Company } from '../types';

export function useMirrorClaims(companies: Company[]) {
  const need = new Set(companies.map((c) => c.team).filter(Boolean) as string[]);
  const c1 = useSpaceData('1', need.has('1') ? ['claims'] : []).data.claims;
  const c2 = useSpaceData('2', need.has('2') ? ['claims'] : []).data.claims;
  const c3 = useSpaceData('3', need.has('3') ? ['claims'] : []).data.claims;
  return useMemo(() => [...(c1 ?? []), ...(c2 ?? []), ...(c3 ?? [])] as Claim[], [c1, c2, c3]);
}
