export interface Member {
  id: string;
  name: string;
  color: string; // 담당자 색
  order: number;
  character?: string; // public/characters 안 파일 이름 (예: c05)
  email?: string; // 이 카드 주인의 로그인 이메일 (본인만 말풍선·캐릭터를 바꿀 수 있음)
  memName?: string; // mem 에 표시되는 이름 (비워두면 이름 끝글자로 찾음: '길동' → '홍길동')
  status?: string; // 상태메시지
}

export interface Company {
  id: string;
  name: string; // 예: 몽골 (SJNET)
  country: string; // 시계 라벨용 예: 몽골
  timezone?: string; // IANA 타임존 예: Asia/Ulaanbaatar
  color?: string;
  order: number;
  memo?: string; // 업체 메모 (주간 할일 화면 업체 이름 옆, 첫 줄만 보임)
  memoUpdatedAt?: string;
  memoUpdatedBy?: string;
}

export interface Task {
  id: string;
  companyId: string | null;
  title: string;
  assigneeIds: string[];
  dueDate?: string; // YYYY-MM-DD
  dueText?: string; // "9/20 이후 (오픈 이후)" 같은 자유 텍스트
  done: boolean;
  doneAt?: string; // YYYY-MM-DD
  note?: string;
  important?: boolean;
  num?: string; // 직접 정한 번호 (예: 1-1). 없으면 업체 안에서 자동 번호
  order: number;
  createdAt: string; // YYYY-MM-DD
}

export interface Order {
  id: string;
  companyId: string | null;
  name: string;
  realOrder: boolean; // 실주문 여부
  erp: boolean; // ERP 등록 여부
  inbound: boolean; // 입고처리 여부
  shipped: boolean; // 출고 여부
  invoice: boolean; // 인보이스 제작 여부
  storeCode?: string; // 주문넣은 매장코드
  orderDate?: string; // 주문넣은 일자
  packing?: string; // 패킹 완료일 (자유 텍스트)
  shipFrom?: string; // 출고 장소
  note?: string;
  closed?: boolean; // 수동 완료 처리 (출고/인보이스가 필요 없는 건 등)
  amountKRW?: number; // 원화 총 금액
  amountForeign?: number; // 외화 총 금액 ($)
  bundle?: OrderBundle; // 같이 출고되는 묶음
  sort?: number; // 직접 옮긴 순서 (클수록 위). 없으면 주문일자 순
  createdAt: string;
}

export interface OrderBundle {
  id: string;
  color: string;
  name?: string; // 예: 4번째 컨테이너
}

/** 주문 완료 기준: 출고(마지막 단계)에 체크, 또는 수동으로 완료 처리 */
export function isOrderDone(o: Order): boolean {
  return !!o.closed || o.shipped;
}

/** mem(근태 사이트) 부서 근태 현황에서 가져온 하루 기록. id = `${date}_${memberId}` */
export interface Attendance {
  id: string;
  memberId: string;
  date: string; // YYYY-MM-DD
  status: string; // 근무 / 연차 / 출장 / 대체휴가 ...
  start?: string; // 출근 HH:MM
  end?: string; // 퇴근 예정 HH:MM (출근 태그 기준)
  period?: string; // 휴가·출장 기간 텍스트 (예: 26.11.09~26.11.24)
  source?: 'mem';
  updatedAt?: string;
}

/** 클레임: 묶음 또는 개별 주문 기준. 패킹금액은 원래 주문 금액에서 자동으로 가져옴 (직접 고칠 수도 있음) */
export interface ClaimFile {
  name: string;
  url: string;
  path?: string; // Storage 에 올린 파일이면 경로 (지울 때 씀). 링크면 없음
}

export interface Claim {
  id: string;
  companyId: string | null;
  source: 'bundle' | 'order' | 'manual';
  sourceId?: string; // 묶음 id 또는 주문 id
  title: string; // 묶음 이름 / 주문명 (가져온 뒤 고칠 수 있음)
  currency: 'KRW' | 'FOREIGN';
  packingOverride?: number; // 직접 쓴 패킹금액 (없으면 주문에서 자동)
  claimAmount?: number;
  shipDate?: string; // 출고날짜 YYYY-MM-DD
  docDone: boolean; // 서류작성
  refunded: boolean; // 환급 완료
  files?: ClaimFile[];
  note?: string;
  sort?: number;
  createdAt: string;
}

/** 팀 공용 설정 (관리자만 바꿈). id = 'home' */
export interface ConfigDoc {
  id: string;
  showUrgent?: boolean; // 홈: 급한 일
  showPipeline?: boolean; // 홈: 진행중 주문 단계
}

export interface Collections {
  members: Member[];
  companies: Company[];
  tasks: Task[];
  orders: Order[];
  attendance: Attendance[];
  config: ConfigDoc[];
  claims: Claim[];
}

export type CollectionName = keyof Collections;
export type Item<C extends CollectionName> = Collections[C][number];

export const ORDER_STEPS = [
  { key: 'realOrder', label: '실주문' },
  { key: 'erp', label: 'ERP 등록' },
  { key: 'inbound', label: '입고처리' },
  { key: 'invoice', label: '인보이스' },
  { key: 'shipped', label: '출고' },
] as const;

export type OrderStepKey = (typeof ORDER_STEPS)[number]['key'];
