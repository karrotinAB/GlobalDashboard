import { useMemo } from 'react';
import { useSpaceData } from '../data/store';
import SalesPanel from '../components/SalesPanel';
import { TEAMS } from '../lib/team';
import type { Company } from '../types';

/** 무역사무 페이지 '수출매출': 1·2·3조 업체를 모두 모아 판매데이터 / 수출매출(비중) — 팀장님·이사님 화면과 같은 내용 */
export default function TradeExport() {
  const c1 = useSpaceData('1', ['companies']).data.companies;
  const c2 = useSpaceData('2', ['companies']).data.companies;
  const c3 = useSpaceData('3', ['companies']).data.companies;
  const companies = useMemo(() => {
    const by: Record<string, Company[] | undefined> = { '1': c1, '2': c2, '3': c3 };
    return TEAMS.flatMap((t) => (by[t] ?? []).map((c) => ({ ...c, team: t })));
  }, [c1, c2, c3]);
  return (
    <div className="page">
      <div className="page-head">
        <h1>수출매출</h1>
        <p className="muted">1·2·3조 업체의 판매 데이터와 수출 매출 · 비중이에요 (보기만).</p>
      </div>
      <SalesPanel companies={companies} allTeams />
    </div>
  );
}
