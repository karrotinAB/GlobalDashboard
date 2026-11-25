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
/** 저장된 재고(7번째) · 수출구분(8번째)로 거름 — 서버 functions/skuMissing.js isExcluded 와 같은 기준 */
function excludedRow(a: string[]): boolean {
  if (a.length < 8) return false;
  const q = String(a[6] ?? '').replace(/,/g, '').trim();
  if (q !== '' && Number.isFinite(Number(q)) && Number(q) <= 100) return true;
  const e = String(a[7] ?? '').trim();
  return /제한|불가|금지/.test(e) || /^n$/i.test(e) || e === '01';
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
  nightAt?: string; // 아침 7시 자동 (하루 한 번)
  nightError?: string;
  mode?: 'all' | 'default'; // 'all' = 빈 제품 전체받기 (재고 · 수출 상관없이)
  filterVer?: number; // 지금 목록을 거른 기준 번호 (다 훑으면 올라감)
  rescanVer?: number;
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
        const allMode = (snap.docs.find((d) => d.id === '_meta')?.get('mode') as string | undefined) === 'all';
        snap.docs.forEach((d) => {
          if (d.id === '_meta') {
            m = d.data() as MissingMeta;
            return;
          }
          try {
            const v = JSON.parse((d.get('data') as string) ?? '{}') as Record<string, string[]>;
            for (const [code, a] of Object.entries(v)) {
              if (a.length >= 9 && a[8] !== '-' && !String(a[8] ?? '').trim()) continue; // 일반 대분류 없음 (바코드 없는 제품)
              if (!allMode && excludedRow(a)) continue; // 재고 100 이하 · 수출 불가 (서버가 다음 불러오기 때 목록에서도 뺌) · 전체받기면 다 보임
              out.push({ code, ko: a[0] ?? '', type: a[1] ?? '', lrg: a[2] ?? '', midd: a[3] ?? '', eng: a[4] ?? '', reg: a[5] ?? '' });
            }
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
//   mode: 'all' = 빈 제품 전체받기 (재고 · 수출 상관없이) · 'default' = 기본 (재고 100 초과 · 수출 가능만) · 없으면 지난번 그대로
export async function loadMissingNow(mode?: 'all' | 'default'): Promise<LoadResult> {
  if (DATA_MODE === 'local') return { added: 0, scanned: 0, phase: 'inc', count: DEMO.length, lastReg: '2026-11-20', order: 'asc', page: 1 };
  return (await httpsCallable(functions, 'skuMissingLoad', { timeout: 560000 })(mode ? { mode } : {})).data as LoadResult;
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
