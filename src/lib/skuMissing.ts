// 번역: 수출 분류 · 영문명이 빈 제품 목록 (서버가 회사 API 에서 찾아 skuMissing/{앞 2자리} 에 저장 · 모두가 같이 봄)
import { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { DATA_MODE } from '../data/store';

export interface MissingItem {
  code: string;
  ko: string; // sku_nickname_kor (없으면 sku_name_kor)
  type: string; // sku_type_name (상품 · 제품 …)
  lrg: string; // 수출 대분류 코드 (비었으면 '')
  midd: string; // 수출 중분류 코드
  eng: string; // 영문 제품명
  reg: string; // 등록일
}
export interface MissingMeta {
  phase?: 'full' | 'inc';
  page?: number;
  count?: number;
  lastReg?: string;
  order?: 'asc' | 'desc' | 'mixed';
  at?: string;
  fullAt?: string;
  recheckAt?: string;
  lockUntil?: string | null;
  stopped?: string;
  error?: string;
  lastAdded?: number;
  nightAt?: string; // 새벽 자동 (0시 ~ 7시 30분, 30분마다)
  nightError?: string;
  rescan?: boolean; // 거르는 기준이 바뀌어서 처음부터 다시 훑는 중
  lastDropped?: number; // 지난번에 목록에서 뺀 수
  lastScanned?: number;
  // 확인용 (관리자): 지난번 본 제품들의 빈 칸 수 · 대분류 값 분포 · 칸 이름 예시
  lastStats?: { seen: number; lrgEmpty: number; middEmpty: number; engEmpty: number; lrgVals: Record<string, number> };
  lastSample?: { lrgEmpty: boolean; code: string; fields: Record<string, string> } | null;
}

// 로컬 테스트용 예시
const DEMO: MissingItem[] = [
  { code: '10230017', ko: '오토 스프링노트 (A5)', type: '상품', lrg: '', midd: '', eng: '', reg: '2026-11-18' },
  { code: '10230018', ko: '오토 스프링노트 (A5)', type: '제품', lrg: '', midd: '', eng: '', reg: '2026-11-18' },
  { code: '20450227', ko: '산리오 키링 3종', type: '상품', lrg: '03', midd: '', eng: '', reg: '2026-11-19' },
  { code: '31020045', ko: '젤리 볼펜 0.5', type: '제품', lrg: '', midd: '', eng: 'Jelly Ballpen 0.5', reg: '2026-11-20' },
];

export function useSkuMissing(): { list: MissingItem[] | null; meta: MissingMeta } {
  const [list, setList] = useState<MissingItem[] | null>(null);
  const [meta, setMeta] = useState<MissingMeta>({});
  useEffect(() => {
    if (DATA_MODE === 'local') {
      setList(DEMO);
      setMeta({ phase: 'inc', count: DEMO.length, lastReg: '2026-11-20', at: new Date().toISOString() });
      return;
    }
    return onSnapshot(
      collection(db, 'skuMissing'),
      (snap) => {
        const out: MissingItem[] = [];
        let m: MissingMeta = {};
        snap.docs.forEach((d) => {
          if (d.id === '_meta') {
            m = d.data() as MissingMeta;
            return;
          }
          try {
            const v = JSON.parse((d.get('data') as string) ?? '{}') as Record<string, string[]>;
            for (const [code, a] of Object.entries(v)) out.push({ code, ko: a[0] ?? '', type: a[1] ?? '', lrg: a[2] ?? '', midd: a[3] ?? '', eng: a[4] ?? '', reg: a[5] ?? '' });
          } catch {
            /* 무시 */
          }
        });
        // 최근 등록된 것부터
        out.sort((a, b) => b.reg.localeCompare(a.reg) || a.code.localeCompare(b.code));
        setList(out);
        setMeta(m);
      },
      () => setList([]),
    );
  }, []);
  return { list, meta };
}

export type LoadResult = { added: number; dropped?: number; scanned: number; stopped?: string; busy?: boolean; phase: string; count: number; lastReg: string; order: string; page: number };
/** ⬇ 없는거 불러오기 (처음엔 전부 훑고, 그 뒤엔 지난번 등록일 이후만) */
export async function loadMissingNow(): Promise<LoadResult> {
  if (DATA_MODE === 'local') return { added: 0, scanned: 0, phase: 'inc', count: DEMO.length, lastReg: '2026-11-20', order: 'asc', page: 1 };
  return (await httpsCallable(functions, 'skuMissingLoad', { timeout: 560000 })({})).data as LoadResult;
}
/** 🔄 새로고침: 이 코드들만 다시 확인 → 다 채워졌으면 목록에서 빠짐 */
export async function recheckMissingNow(codes: string[]): Promise<{ checked: number; removed: number; left: number; stopped?: string; count: number }> {
  if (DATA_MODE === 'local') return { checked: codes.length, removed: 0, left: 0, count: DEMO.length };
  return (await httpsCallable(functions, 'skuMissingRecheck', { timeout: 320000 })({ codes })).data as { checked: number; removed: number; left: number; stopped?: string; count: number };
}

/** 제품코드 → 줄 번호 대신 쓰는 고정 숫자 (고친 것 · 고른 분류를 코드별로 기억) */
export const rowKeyOf = (code: string) => {
  if (/^\d{1,9}$/.test(code)) return Number(code);
  let h = 7;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) % 2000000000;
  return 2000000000 + h;
};
