export interface Member {
  id: string;
  name: string;
  color: string; // 담당자 색
  order: number;
  character?: string; // public/characters 안 파일 이름 (예: c05)
  email?: string; // 이 카드 주인의 로그인 이메일 (본인만 말풍선·캐릭터를 바꿀 수 있음)
  memName?: string; // mem 에 표시되는 이름 (비워두면 이름 끝글자로 찾음: '길동' → '홍길동')
  status?: string; // 상태메시지
  clocks?: ClockPick[]; // 홈 화면에 보일 시계 (본인이 고름, 없으면 업체 나라들)
  team?: string; // 무역사무 화면에서 여러 조 담당자를 같이 읽을 때 붙는 조 (저장 안 함)
}

export interface ClockPick {
  tz: string; // IANA 시간대
  label: string; // 시계 이름 (예: 몽골)
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
  // ↓ ERP API 자동 채우기 (서버 함수 functions/ 가 씀)
  amountSource?: 'manual' | 'api-order' | 'api-outbound'; // 금액을 누가 채웠는지 (manual 이면 API 가 안 건드림)
  expNo?: string; // ERP 수출 주문번호 EXP_NO
  fxCode?: string; // 외화 통화 (USD 등)
  outStatus?: 'pending' | 'partial' | 'approved'; // 출고승인 상태
  outDate?: string; // 출고일 (출고승인)
  apiSyncedAt?: string;
  outRows?: { date: string | null; status: string; k: number | null; f: number | null }[]; // API 2 줄별 내역 (확인용)
  planKRW?: number; // API 1 예정 금액 (확인용)
  planForeign?: number;
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
  // id = 'apiSync': 서버 함수가 남기는 마지막 금액 갱신 결과
  checked?: number;
  updated?: number;
  errors?: string[];
  at?: string;
  // id = 'holidays': 공휴일 서비스에 없는 나라별 휴일 (관리자가 설정에서 추가)
  holidays?: ExtraHoliday[];
}

export interface ExtraHoliday {
  code: string; // 나라 코드 (MN, KZ …)
  date: string; // YYYY-MM-DD
  name: string;
}

export interface Collections {
  members: Member[];
  companies: Company[];
  tasks: Task[];
  orders: Order[];
  attendance: Attendance[];
  config: ConfigDoc[];
  claims: Claim[];
  requests: TradeRequest[];
  tradeMembers: Member[];
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

/* ------------------------------------------------------------------ */
/* 무역사무 요청 (2조 → 무역사무)                                       */
/* ------------------------------------------------------------------ */
export const PRIORITIES = ['초긴급', '마감일 오전', '마감일 퇴근 전', '이번주', '기한없음'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const WORK_TYPES = [
  '이메일 송부', '업무협조전', '선적서류작성(CI/PL등)', '재무팀 결재서류', '기타', '번역', '인수인계', '구매확인서',
  'Fedex 발송', '전자세금계산서', '외화정리', '회의', '전략물자비해당 자가판정서', '배차', '수출면장',
  '담당자에 진행상황 체크', '주문수동 생성', 'DHL 송부', '개발협력', '포워더 소통', '등기발송', '계약서류',
  'PO 수동 제작', '원산지 업무', '인증관련', '창고 소통', '미국법인(지사) 중국창고', 'HS 코드 관련', '출고마감',
] as const;

export type RequestStatus = 'requested' | 'progress' | 'done' | 'cancelled';
export const REQUEST_STATUS: Record<RequestStatus, string> = { requested: '요청됨', progress: '진행중', done: '완료', cancelled: '취소' };

export interface RequestFile {
  name: string;
  url: string;
  path?: string; // Storage 경로 (지울 때)
}

export interface RequestLog {
  at: string; // ISO
  by: string; // 이메일 또는 이름
  text: string; // 예: "제목: A → B", "취소함"
  prev?: string; // 바뀌기 전 긴 내용 (내용 수정 시)
}

export interface TradeRequest {
  id: string;
  title: string; // 업무 내용(제목)
  body?: string; // 자세한 내용
  files?: RequestFile[]; // 사진
  storeCode?: string;
  orderDate?: string; // YYYY-MM-DD
  requestedAt: string; // 의뢰일 YYYY-MM-DD
  team?: string; // 요청한 조 (없으면 2조)
  requesterId?: string; // 요청한 조의 담당자(members) id
  requesterEmail?: string;
  dueDate?: string;
  priority: Priority;
  workType?: string;
  eta?: string; // 처리 예상일
  status: RequestStatus;
  assigneeId?: string; // 무역사무 담당자(tradeMembers) id
  doneAt?: string; // 완료(또는 취소)한 날 YYYY-MM-DD
  log?: RequestLog[];
  createdAt: string;
}
