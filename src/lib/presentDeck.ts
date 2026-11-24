// IT 발표 모드 순서 (관리자 › 프로필 › 🎤 IT 발표 모드)
//   한 칸 = 화면 한 장. page 가 있으면 그 페이지로 넘어가서 실제 화면 위에 메모가 크게 뜸
//   target 이 있으면 그 부분만 밝게 (나머지는 어둡게), 없으면 화면 전체가 그대로 보임
//   page 가 없는 칸은 표지·설명 슬라이드 (화면 전체를 덮음): body · flow(상자 그림) · cols(두 칸 비교) · table(표)
//   section 이 바뀌는 곳이 목차의 한 묶음 (발표 중 '목차' 버튼 / T 키)
//   내용 고치기: 이 파일의 글만 바꾸면 됨 (body 는 한 줄 = 한 문단, '· ' 로 시작하면 점 목록)

export interface PresentTarget {
  /** CSS 선택자 (예: 'section', '.tabs', 'h1') */
  sel: string;
  /** 이 글자가 들어있는 것만 (예: '지금 몇 시') */
  text?: string;
  /** 찾은 것에서 위로 올라가 이걸 밝게 (예: h2 를 찾고 'section' 전체를 밝게) */
  closest?: string;
  /** 이 장에 오면 안의 버튼을 눌러 드롭다운을 열어 둠 (다음 장으로 가면 닫음) */
  open?: boolean;
}

export interface FlowRow {
  /** 상자들 (t = 굵은 글, s = 작은 설명) */
  items: { t: string; s?: string; hot?: boolean }[];
  /** 상자 사이에 → (기본 true) */
  arrows?: boolean;
  /** 줄 앞 작은 이름표 */
  label?: string;
}

export interface PresentStep {
  /** 목차 묶음 이름 (바뀌는 곳에서 새 묶음) */
  section: string;
  /** 넘어갈 페이지 (#/home 의 home). 없으면 표지/설명 슬라이드 */
  page?: string;
  target?: PresentTarget;
  /** 작은 글씨 머리말 */
  kicker?: string;
  title: string;
  body?: string[];
  flow?: FlowRow[];
  cols?: { title: string; tone?: 'good' | 'warn'; items: string[] }[];
  /** 첫 줄 = 머리줄 */
  table?: string[][];
  /** 표에서 칠할 줄 (머리줄 빼고 1부터) */
  hotRows?: number[];
  /** 아래 작은 글씨 (출처 · 주의) */
  foot?: string;
  /** page 와 같이: 실제 화면을 어둡게 깔고 그 위에 슬라이드 */
  over?: boolean;
  /** 페이지를 옮기지 않고 지금 화면 그대로 (어디서 누르는지 보여줄 때) */
  stay?: boolean;
  /** 메모 없이 화면만 보여주기 */
  bare?: boolean;
  /** 메모 위치 (기본: 오른쪽 아래) */
  note?: 'right' | 'left' | 'bottom' | 'top';
}

const S0 = '시작';
const S1 = '1. 이게 뭔가요';
const S2 = '2. 기능 둘러보기';
const S3 = '3. 사용 기술 · 작업 방식';
const S4 = '4. 사용 중인 API';
const S5 = '5. ERP 연동 · 실행 시간';
const S6 = '6. 계정 · 비밀번호';
const S8 = '7. Firebase 용량';
const S9 = '8. 운영 현황';
const SE = '마무리';

export const PRESENT_DECK: PresentStep[] = [
  // ───────── 표지
  {
    section: S0,
    kicker: 'IT 실 발표 · 글로벌사업부',
    title: 'Global Dashboard',
    body: ['글로벌사업부 업무를 더 쉽고 정확하게'],
  },

  // ───────── 1. 이게 뭔가요
  {
    section: S1,
    page: 'home',
    bare: true,
    title: '홈 화면 한번 쓱',
  },
  {
    section: S1,
    page: 'home',
    over: true,
    kicker: S1,
    title: '흩어진 업무를 한 곳에서',
    body: [
      '글로벌사업부가 더 정돈된 환경에서 일할 수 있도록 만든 내부 웹 대시보드',
      '· 기록 — 할일 · 주문 · 클레임 · 보고 · 요청을 온라인으로 바로',
      '· 확인 — 진행 단계 · 마감 · 출퇴근 · 매출을 한눈에',
      '· 공유 — 같은 화면을 조원 · 무역사무 · 팀장님 · 이사님이 실시간으로',
    ],
  },
  {
    section: S1,
    kicker: '부서 구조',
    title: '글로벌사업부 = 이사 · 팀장 / 무역사무 / 조 3개',
    flow: [
      { label: '리더', arrows: false, items: [{ t: '이사님', s: '1~3조 현황 보기 · 보고 답변' }, { t: '팀장님', s: '1~3조 현황 보기 · 보고 답변' }] },
      { label: '실무', arrows: false, items: [{ t: '1조', s: '해외 업체 담당' }, { t: '2조', s: '해외 업체 담당' }, { t: '3조', s: '해외 업체 담당' }, { t: '무역사무', s: '조의 요청 처리' }] },
    ],
    foot: '각자 로그인하면 자기 자리에 맞는 화면만 보여요 (조원 → 자기 조 · 무역사무 → 무역사무 페이지 · 리더 → 개인 대시보드 + 조 현황)',
  },

  // ───────── 2. 기능 둘러보기 (쓱쓱)
  {
    section: S2,
    page: 'home',
    bare: true,
    title: '홈 둘러보기 (자유롭게 스크롤)',
  },
  {
    section: S2,
    page: 'home',
    target: { sel: 'h2', text: '👋', closest: 'section' },
    kicker: '홈',
    title: '출퇴근 시간 확인',
    body: ['조원별 출근 · 퇴근 예정 · 휴가가 오늘 기준으로'],
  },
  {
    section: S2,
    page: 'home',
    target: { sel: 'h2', text: '지금 몇 시', closest: 'section' },
    kicker: '홈',
    title: '내가 맡은 업체 나라 시간',
    body: ['나라별 현재 시각 · 업무시간인지 · 그 나라 공휴일'],
  },
  {
    section: S2,
    page: 'home',
    target: { sel: 'section.card.sales' },
    kicker: '홈',
    title: '내 업체의 판매 · 수출 매출',
    body: ['업체별 판매 데이터 · 수출 매출 · 비중 (회사 API 에서 자동으로)'],
    note: 'top',
  },
  {
    section: S2,
    page: 'todos',
    kicker: '주간 할일',
    title: '조원끼리 할일 기록',
    body: ['업체별 · 담당자별 · 마감순 보기', '각 조원은 자기 할일만 필터해서 볼 수도 있음', '끝날 때까지 매주 자동으로 따라와서 시트 복사가 필요 없음'],
  },
  {
    section: S2,
    page: 'orders',
    kicker: '주문 관리',
    title: '새 주문을 묶고, 출고까지 추적',
    body: ['실주문 → ERP → 입고 → 인보이스 → 출고', '단계별 “안 된 건” 바로 보기 — 출고 전까지 놓치는 단계 없게'],
  },
  {
    section: S2,
    page: 'claims',
    kicker: '클레임',
    title: '주문 정보를 끌어와 클레임 기록',
    body: ['주문 관리의 패킹 금액(원화 · 외화)을 그대로 가져옴', '클레임 금액 · 비율 · 서류 · 환급 완료까지'],
  },
  {
    section: S2,
    page: 'reports',
    kicker: '보고방',
    title: '팀장님 · 이사님께 보고 → 답글',
    body: ['보고 올리기 · 확인 표시 · 답변이 한 줄로', '새 답변은 빨간 점 + 알림'],
  },
  {
    section: S2,
    page: 'requests',
    kicker: '무역사무요청',
    title: '무역사무팀에 업무 요청',
    body: ['요청 · 진행 상태 · 처리 예상일 · 댓글', '요청에 각 조의 주문 · 클레임이 연결돼서 무역사무팀도 바로 확인'],
  },
  {
    section: S2,
    page: 'home',
    target: { sel: 'button', text: '주소록' },
    kicker: '주소록',
    title: '주소록 · ID/PW',
    body: ['주소록: 부서 사람들 이름 · 이메일 · 회사번호', 'ID/PW: 같이 쓰는 업무 계정 모음 (로그인한 부서 사람만 · 코드 저장소에는 없음)'],
  },
  {
    section: S2,
    page: 'home',
    stay: true,
    target: { sel: '.profile:not(.tools)', open: true },
    kicker: '어디서 여나요',
    title: '오른쪽 위 내 계정 › 전도금',
    body: ['눌러서 들어가 볼게요'],
  },
  {
    section: S2,
    page: 'petty',
    kicker: '전도금',
    title: '전도금 수합',
    flow: [
      { items: [{ t: '각자 기록', s: '1~15일 / 16일~말일' }, { t: '영수증 사진 첨부', s: '외화는 그날 환율로 원화' }, { t: '담당자 [관리] 탭', s: '기간별로 모아 보기 · 프린트' }] },
    ],
  },
  {
    section: S2,
    page: 'home',
    stay: true,
    target: { sel: '.profile.tools', open: true },
    kicker: '어디서 여나요',
    title: '오른쪽 위 🧰 도구함 › 출장신청서',
    body: ['도구함을 눌러 출장신청서로'],
  },
  {
    section: S2,
    page: 'trip',
    kicker: '도구함 › 출장신청서',
    title: '출장비 정리 + 대체휴가 신청서',
    body: ['전도금과 같은 방식으로 출장비 · 교통비 기록 → A4 신청서 · 영수증 정리 프린트', '🌴 대체휴가 신청서도 여기서 바로 작성'],
  },
  {
    section: S2,
    page: 'home',
    stay: true,
    target: { sel: '.profile.tools', open: true },
    kicker: '어디서 여나요',
    title: '🧰 도구함 › 계약서',
    body: ['도구함을 눌러 계약서로'],
  },
  {
    section: S2,
    page: 'contract',
    kicker: '도구함 › 계약서',
    title: '계약서를 모아두고 키워드로 찾기',
    body: ['조항 · 업체로 검색 (보증금 → deposit 처럼 같은 뜻 말도 같이)', '원본 파일 + 조항별로 정리된 본문 · 관리자만'],
  },
  {
    section: S2,
    page: 'home',
    stay: true,
    target: { sel: '.profile.tools', open: true },
    kicker: '어디서 여나요',
    title: '🧰 도구함 › 제품번역',
    body: ['도구함을 눌러 제품번역으로'],
  },
  {
    section: S2,
    page: 'translate',
    kicker: '도구함 › 제품번역',
    title: '빈 칸 제품 자동 번역 · 분류',
    flow: [
      { items: [{ t: '회사 제품 API', s: '영문명 · 수출 분류가 빈 제품' }, { t: '사전으로 자동 번역', s: '한글 → 영어 단어장 (모두 같이 키움)' }, { t: '분류 자동 추천', s: '수출 분류표 + 지난번에 고른 기록' }] },
    ],
    note: 'top',
  },

  // ───────── 3. 사용 기술 · 작업 방식
  {
    section: S3,
    kicker: S3,
    title: '어떻게 만들고, 어떻게 올라가나',
    flow: [
      { label: '만들기', items: [{ t: 'Claude 와 대화', s: '요청 → 코드 작성' }, { t: 'GitHub', s: '코드 자동 반영' }, { t: 'GitHub Actions', s: '자동 빌드 · 배포' }, { t: 'GitHub Pages', s: '화면 호스팅 (공개)' }] },
      { label: '데이터', arrows: false, items: [{ t: 'Firebase Auth', s: '로그인', hot: true }, { t: 'Firestore', s: '데이터베이스', hot: true }, { t: 'Storage', s: '첨부 파일', hot: true }, { t: 'Cloud Functions', s: '서버 · API 호출', hot: true }] },
    ],
    foot: 'Firebase = Google Cloud · 서울 리전 (asia-northeast3)',
  },
  {
    section: S3,
    kicker: '여기가 핵심',
    title: '공개 GitHub 에는 “틀”만 있어요',
    cols: [
      { title: '공개 GitHub (누구나 볼 수 있음)', tone: 'warn', items: ['화면 코드 (버튼 · 표 · 디자인)', '보안 규칙 · 서버 함수의 코드', 'Firebase 연결 주소 (공개용 값)', '❌ 업무 데이터 · 비밀번호 · API 키 없음'] },
      { title: 'Firebase (로그인 + 권한 있는 사람만)', tone: 'good', items: ['로그인 계정 · 비밀번호 (Google 이 암호화)', '업무 데이터 전부 (Firestore)', 'API 키 · 비밀값 (secrets)', '첨부 파일 (Storage)'] },
    ],
    foot: '코드를 봐도 데이터에는 못 들어감 — 들어가는 문은 로그인 + 서버 쪽 보안 규칙',
  },

  // ───────── 4. 사용 중인 API
  {
    section: S4,
    kicker: S4,
    title: '어떤 API 를 어디서 쓰나',
    table: [
      ['API', '부르는 곳', '쓰는 페이지'],
      ['회사 ERP 주문 · 출고 (getexorderdata · getoutbounddata)', '서버', '주문 관리 · 클레임 · 수출매출'],
      ['회사 판매 데이터 (POS)', '서버', '홈 판매 데이터 · 수출매출'],
      ['회사 제품 정보 (getSkuList · getproductinfo)', '서버', '제품번역'],
      ['회사 거래처 정보 (getpartnerinfo)', '서버', '매장 이름 · 지점'],
      ['mem 근태', '서버 (+ 크롬 확장)', '홈 출퇴근'],
      ['한국은행 ECOS 환율', '서버', '수출매출 · 전도금 · 출장 외화'],
      ['기상청 초단기예보 (공공데이터포털)', '서버', '홈 날씨'],
      ['구글 캘린더 (iCal)', '서버', '달력 · 한국 공휴일'],
      ['date.nager.at 공휴일 (키 없음 · 공개)', '브라우저', '홈 나라 시계'],
    ],
    foot: '키가 필요한 API 는 전부 서버에서만 부름 → 브라우저에는 키가 한 번도 안 내려감',
  },
  // API 마다 실제로 쓰는 화면으로 넘어가며 그 부분을 밝게
  {
    section: S4,
    page: 'orders',
    target: { sel: 'th', text: '원화 금액', closest: 'table' },
    kicker: 'API · 어디서 쓰나',
    title: '회사 ERP 주문 · 출고 → 주문 관리',
    body: ['실주문 · 출고 승인 · 원화/외화 금액이 ERP 에서 자동으로', '· 평일 9~18시 30분마다 + ↻ 주문 불러오기 버튼'],
    note: 'top',
  },
  {
    section: S4,
    page: 'home',
    target: { sel: 'section.card.sales' },
    kicker: 'API · 어디서 쓰나',
    title: '회사 판매 데이터 (POS) → 홈 판매 · 수출',
    body: ['업체별 판매 데이터 · 비중 · 수출 매출 (주 1회 + 버튼)'],
    note: 'top',
  },
  {
    section: S4,
    page: 'translate',
    target: { sel: '.tr-upload' },
    kicker: 'API · 어디서 쓰나',
    title: '회사 제품 정보 → 제품번역',
    body: ['영문명 · 수출 분류가 빈 제품을 회사 API 에서 찾아옴', '· 재고 100 이하 · 수출제한 제품은 빼고 · 새벽에 자동으로 이어서'],
    note: 'bottom',
  },
  {
    section: S4,
    page: 'orders',
    target: { sel: 'th.c-name', closest: 'table' },
    kicker: 'API · 어디서 쓰나',
    title: '회사 거래처 정보 → 주문 이름 (매장명)',
    body: ['ERP 에서 들어온 새 주문 이름을 매장명으로 (한 번 찾은 매장은 저장 · 다시 안 물음)'],
    note: 'top',
  },
  {
    section: S4,
    page: 'home',
    target: { sel: 'h2', text: '👋', closest: 'section' },
    kicker: 'API · 어디서 쓰나',
    title: 'mem 근태 → 홈 출퇴근',
    body: ['출근 · 퇴근 예정 · 휴가 · 대체시차 (평일 정해진 시간에 서버가 가져옴)'],
  },
  {
    section: S4,
    page: 'petty',
    target: { sel: '.pc-add-expense' },
    kicker: 'API · 어디서 쓰나',
    title: '한국은행 ECOS 환율 → 전도금 · 출장 · 수출매출',
    body: ['외화로 적으면 그날 환율로 원화가 자동으로 들어감'],
    note: 'top',
  },
  {
    section: S4,
    page: 'home',
    target: { sel: '.zone-slider' },
    kicker: 'API · 어디서 쓰나',
    title: '기상청 초단기예보 → 홈 날씨',
    body: ['이번 주 · 오늘 일정 옆 세 번째 장 (오늘의 날씨) + 헤더 비 · 눈 효과', '· 하루 종일 시간마다 10분 · 50분에 받아 둠'],
  },
  {
    section: S4,
    page: 'calendar',
    kicker: 'API · 어디서 쓰나',
    title: '구글 캘린더 (iCal) → 달력 · 한국 공휴일',
    body: ['부서 일정 · 공휴일을 달력에 (비공개 iCal 주소는 서버에만)'],
  },
  {
    section: S4,
    page: 'home',
    target: { sel: 'h2', text: '지금 몇 시', closest: 'section' },
    kicker: 'API · 어디서 쓰나',
    title: 'date.nager.at 공휴일 → 홈 나라 시계',
    body: ['나라별 공휴일 (키 없는 공개 API · 브라우저에서 바로)'],
  },

  // ───────── 5. ERP 연동
  {
    section: S5,
    kicker: S5,
    title: 'ERP 데이터는 이렇게 가져와요',
    flow: [
      { items: [{ t: '서버 함수', s: '서울 리전 · 정해진 시간' }, { t: 'secrets/erp', s: 'API 키 읽기 (서버만)', hot: true }, { t: 'ERP API', s: 'X-API-Key 헤더 · 읽기만' }, { t: 'Firestore 저장', s: '주문 금액 · 출고 승인' }, { t: '화면', s: '실시간 반영' }] },
    ],
  },
  {
    section: S5,
    kicker: '실행 시간 (서울 기준)',
    title: '자동 실행 일정',
    table: [
      ['작업', '언제'],
      ['주문 금액 · 출고 승인 (ERP)', '평일 9:00~18:30 · 30분마다'],
      ['mem 근태', '평일 9시대 10분마다 + 10 · 12 · 14 · 16 · 17 · 18 · 19시'],
      ['수출 매출 다시 계산', '매일 새벽 4~5시 · 10분마다'],
      ['판매 데이터 다시 계산', '매주 월요일 아침 7시'],
      ['제품 정보 · 빈 제품 찾기', '매일 새벽 0~7시 · 30분마다'],
      ['날씨', '매시 10분 · 50분'],
      ['전도금 알림', '매일 10시'],
    ],
    hotRows: [1, 3, 4, 5], // 회사 ERP · 판매 · 제품 API 를 부르는 작업
    foot: '+ 화면의 “새로고침” 버튼 (로그인 · 권한 확인 후에만 실행)',
  },

  // ───────── 6. 계정
  {
    section: S6,
    kicker: S6,
    title: '계정은 관리자가 만들고, 비밀번호는 본인만',
    flow: [
      { items: [{ t: '관리자', s: '이메일 + 임시 비밀번호로 계정 생성 · 권한 지정' }, { t: '본인', s: '첫 로그인 후 내 비밀번호로 변경' }, { t: '이후', s: '관리자도 비밀번호를 모름' }] },
    ],
    body: [
      '· 비밀번호는 Firebase Authentication(Google)이 암호화해서 보관 — 관리자 화면 · DB 어디에도 없음',
      '· 잊어버리면 본인 이메일로 재설정 메일',
      '· 대시보드 사용자 목록에서 빼면 로그인 계정도 같이 삭제',
    ],
  },
  {
    section: S6,
    page: 'settings',
    kicker: '데모 · 관리자만 보이는 칸',
    title: '설정 › 대시보드 사용자',
    body: ['여기 있는 이메일만 로그인 가능', '권한: 관리자 · 조원 · 무역사무 · 팀장님 · 이사님'],
  },


  // ───────── 8. Firebase 용량
  {
    section: S8,
    kicker: S8,
    title: '용량 · 비용',
    table: [
      ['항목', '무료 한도 (Blaze 요금제 기준)', '우리 쪽 관리'],
      ['Firestore 저장', '1 GiB', '글 · 숫자 위주 (사진은 Storage)'],
      ['Firestore 읽기 / 쓰기', '하루 5만 / 2만 회', '브라우저 캐시로 다시 읽기 줄임'],
      ['Storage (첨부 파일)', '종량제', '파일 1개 20MB 제한 (계약서 50MB)'],
      ['Cloud Functions', '월 200만 회 호출', '정해진 시간에만 · 필요할 때만'],
    ],
    foot: '현재 사용량은 Firebase 콘솔 › 사용량 및 결제에서 — 발표 전에 숫자 확인해서 말하기',
  },

  // ───────── 9. 운영 현황
  {
    section: S9,
    kicker: S9,
    title: '배포 · 계정 · 백업은 이렇게',
    table: [
      ['', '지금 방식'],
      ['화면 배포', 'main 에 반영되면 GitHub Actions 가 자동 빌드 → GitHub Pages'],
      ['서버 함수 · 보안 규칙 배포', '관리자 PC 에서 deploy.bat (Firebase 에 로그인한 관리자만)'],
      ['서비스 계정', 'GitHub 에 Firebase 키 · 서비스 계정 파일 없음 — 서버 함수는 Google 기본 계정으로 실행'],
      ['백업', '설정 › 백업 다운로드 (JSON, 수동)'],
      ['로그 · 오류', 'Firebase 콘솔 › Functions 로그'],
    ],
    foot: '개선 예정: Firestore 자동 예약 백업 · 사용량 알림',
  },

  // ───────── 마무리
  {
    section: SE,
    title: '감사합니다',
  },
];

/** 목차: 묶음 이름 + 그 묶음의 첫 칸 번호 */
export const PRESENT_TOC: { section: string; start: number; steps: { i: number; title: string }[] }[] = PRESENT_DECK.reduce(
  (acc, s, i) => {
    const last = acc[acc.length - 1];
    if (last && last.section === s.section) last.steps.push({ i, title: s.title });
    else acc.push({ section: s.section, start: i, steps: [{ i, title: s.title }] });
    return acc;
  },
  [] as { section: string; start: number; steps: { i: number; title: string }[] }[],
);
