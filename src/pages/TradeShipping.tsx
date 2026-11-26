// 무역사무 › 🚚 출고 관리: 1~3조에서 출고 승인된 주문을 묶음별로 (조원 화면과 같은 표)
//   무역사무가 고치는 것: 외화정리 · 수출면장 · 배차 · 관리부출고(날짜 → 그 조 주문 관리 출고일) · 출고마감 · 결재서류 · 단계별 파일
//   저장: 그 조 주문 문서의 ship · shipDate · bundle(ship · shipDate) 만 (서버 규칙도 이 칸만 허락)
import { useMemo, useState, type ReactNode } from 'react';
import { deleteField, doc, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { DATA_MODE, useSpaceData } from '../data/store';
import { physName, TEAMS } from '../lib/team';
import { ShipBoard } from './Shipping';
import OrdersPacking from './OrdersPacking';
import type { Claim, Company, Order } from '../types';

type Tagged = Order & { team?: string };

export default function TradeShipping({ readOnly = false }: { readOnly?: boolean } = {}) {
  // 무역사무: 🚚 출고 관리 · 🗓 관리부 패킹 (팀장님 · 이사님 보기 화면은 출고 관리만)
  const [tab, setTab] = useState<'ship' | 'pack'>(() => {
    try {
      return !readOnly && localStorage.getItem('gd:tshipTab') === 'pack' ? 'pack' : 'ship';
    } catch {
      return 'ship';
    }
  });
  const pickTab = (t: 'ship' | 'pack') => {
    setTab(t);
    try {
      localStorage.setItem('gd:tshipTab', t);
    } catch {
      /* 무시 */
    }
  };
  // 📋 목록 · 📅 달력 · 🗓 관리부 패킹 를 한 줄에 (목록 · 달력은 출고 관리 화면 안의 보기)
  const goShip = (v: 'list' | 'cal') => {
    try {
      localStorage.setItem('gd:shipView:trade', v);
    } catch {
      /* 무시 */
    }
    pickTab('ship');
  };
  if (tab === 'pack' && !readOnly)
    return (
      <OrdersPacking
        title="출고 관리"
        tabs={
          <div className="sh-viewbar">
            <span className="seg">
              <button onClick={() => goShip('list')}>📋 목록</button>
              <button onClick={() => goShip('cal')}>📅 달력</button>
              <button className="on">🗓 관리부 패킹</button>
            </span>
          </div>
        }
      />
    );
  return <TradeShipBoard readOnly={readOnly} viewExtra={readOnly ? undefined : <button onClick={() => pickTab('pack')}>🗓 관리부 패킹</button>} />;
}

function TradeShipBoard({ readOnly, viewExtra }: { readOnly: boolean; viewExtra?: ReactNode }) {
  const t1 = useSpaceData('1', ['orders', 'companies', 'claims']);
  const t2 = useSpaceData('2', ['orders', 'companies', 'claims']);
  const t3 = useSpaceData('3', ['orders', 'companies', 'claims']);
  const spaces = { '1': t1, '2': t2, '3': t3 } as const;
  // 저장하자마자 바로 보이게 (서버에서 다시 오면 그걸로)
  const [patched, setPatched] = useState<Record<string, Tagged>>({});
  const orders = useMemo(
    () =>
      TEAMS.flatMap((t) =>
        ((spaces[t].data.orders as Order[] | undefined) ?? []).map((o) => patched[`${t}|${o.id}`] ?? ({ ...o, team: t } as Tagged)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t1.data.orders, t2.data.orders, t3.data.orders, patched],
  );
  const companies = useMemo(() => {
    const seen = new Set<string>();
    return TEAMS.flatMap((t) => ((spaces[t].data.companies as Company[] | undefined) ?? []).filter((c) => !seen.has(c.id) && seen.add(c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t1.data.companies, t2.data.companies, t3.data.companies]);

  const claims = useMemo(
    () => TEAMS.flatMap((t) => ((spaces[t].data.claims as Claim[] | undefined) ?? []).map((c) => ({ ...c, team: t }) as Claim)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t1.data.claims, t2.data.claims, t3.data.claims],
  );
  const saveOrders = async (os: Order[]) => {
    if (readOnly) return; // 팀장님 · 이사님: 보기만
    const list = os as Tagged[];
    setPatched((p) => ({ ...p, ...Object.fromEntries(list.map((o) => [`${o.team}|${o.id}`, o])) }));
    const clean = <T,>(v: T) => (v === undefined ? deleteField() : JSON.parse(JSON.stringify(v)));
    if (DATA_MODE === 'local') {
      // 로컬 테스트: 그 조 저장소에 바로
      for (const t of TEAMS) {
        const key = t === '2' ? 'global-dashboard:v3' : `global-dashboard:v3:t${t}`;
        const mine = list.filter((o) => o.team === t);
        if (!mine.length) continue;
        const all = JSON.parse(localStorage.getItem(key) ?? '{}');
        all.orders = (all.orders ?? []).map((x: Order) => {
          const n = mine.find((o) => o.id === x.id);
          return n ? { ...x, ship: n.ship, shipDate: n.shipDate, bundle: n.bundle } : x;
        });
        localStorage.setItem(key, JSON.stringify(all));
      }
      return;
    }
    for (const t of TEAMS) {
      const mine = list.filter((o) => o.team === t);
      if (!mine.length) continue;
      const b = writeBatch(db);
      // 출고 관리 칸만 고침 (다른 칸은 건드리지 않음)
      for (const o of mine) b.update(doc(db, physName('orders', t), o.id), o.bundle ? { bundle: clean(o.bundle) } : { ship: clean(o.ship), shipDate: clean(o.shipDate) });
      await b.commit();
    }
  };

  const loading = [t1, t2, t3].some((s) => !s.ready);
  const err = [t1, t2, t3].map((s) => s.error).find(Boolean);
  return (
    <>
      {err && <p className="warn small page">주문을 못 불러왔어요 (서버 규칙을 새로 올렸는지 확인 — deploy.bat): {err}</p>}
      {loading && !orders.length ? <p className="muted small page">불러오는 중…</p> : <ShipBoard mode="trade" readOnly={readOnly} viewExtra={viewExtra} orders={orders} claims={claims} companies={companies} saveOrders={saveOrders} />}
    </>
  );
}
