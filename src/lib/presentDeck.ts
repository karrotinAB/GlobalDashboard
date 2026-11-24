// IT 발표 모드 순서 (관리자 › 프로필 › 🎤 IT 발표 모드)
//   한 칸 = 화면 한 장. page 가 있으면 그 페이지로 넘어가서 실제 화면 위에 메모가 크게 뜸
//   target 이 있으면 그 부분만 밝게 (나머지는 어둡게), 없으면 화면 전체가 그대로 보임
//   page 가 없는 칸은 표지·설명 슬라이드 (화면 전체를 덮음)
//   내용 고치기: 이 파일의 글만 바꾸면 됨 (body 는 한 줄 = 한 문단, '· ' 로 시작하면 점 목록)

export interface PresentTarget {
  /** CSS 선택자 (예: 'section', '.tabs', 'h1') */
  sel: string;
  /** 이 글자가 들어있는 것만 (예: '지금 몇 시') */
  text?: string;
  /** 찾은 것에서 위로 올라가 이걸 밝게 (예: h2 를 찾고 'section' 전체를 밝게) */
  closest?: string;
}

export interface PresentStep {
  /** 넘어갈 페이지 (#/home 의 home). 없으면 표지/설명 슬라이드 */
  page?: string;
  target?: PresentTarget;
  /** 작은 글씨 머리말 (예: '1. 화면 구성') */
  kicker?: string;
  title: string;
  body?: string[];
  /** 메모 위치 (기본: 오른쪽 아래) */
  note?: 'right' | 'left' | 'bottom' | 'top';
}

export const PRESENT_DECK: PresentStep[] = [
  {
    kicker: 'IT 실 발표',
    title: 'Global Dashboard',
    body: ['해외 업체 담당 조가 쓰는 업무 대시보드', '구글 시트로 하던 주간 할일 · 주문 정리 · 무역사무 요청을 한 곳에서'],
  },
  {
    kicker: '전체 구조',
    title: '어떻게 만들어져 있나',
    body: [
      '· 화면: React + TypeScript (Vite 빌드) → GitHub Pages 에 올림 (main 에 올리면 자동 배포)',
      '· 로그인: Firebase Authentication (이메일 + 비밀번호)',
      '· 데이터: Firestore (팀 공유, 실시간으로 바로 반영)',
      '· 파일: Firebase Storage (클레임 · 영수증 첨부)',
      '· 서버 작업: Cloud Functions (ERP API 호출 · 정해진 시간 자동 실행)',
    ],
  },
  {
    page: 'home',
    target: { sel: '.tabs' },
    kicker: '1. 화면 구성',
    title: '탭 하나 = 업무 하나',
    body: ['홈 · 주간 할일 · 주문 관리 · 클레임 · 보고방 · 무역사무요청', '오른쪽 위: 무역사무 페이지 · 주소록 · 도구함 · 내 계정'],
    note: 'bottom',
  },
  {
    page: 'home',
    target: { sel: 'h2', text: '지금 몇 시', closest: 'section' },
    kicker: '1. 화면 구성 · 홈',
    title: '담당 나라 시계 · 업무시간',
    body: ['업체 나라별 현재 시각 · 시차 · 지금 업무시간인지', '나라별 공휴일도 같이 표시'],
  },
  {
    page: 'todos',
    kicker: '2. 주간 할일',
    title: '매주 시트 복사가 필요 없어요',
    body: ['한 번 만든 할일은 끝날 때까지 매주 자동으로 따라옴', '지난주 보기 = 그 주 일요일 기준 상태 (금요일에 멈춰둔 시트와 같음)'],
  },
  {
    page: 'orders',
    kicker: '3. 주문 관리 · ERP 연결',
    title: 'ERP 금액 자동 채우기',
    body: [
      '· 매장코드 + 주문일자로 ERP API 2개 호출 (getexorderdata · getoutbounddata)',
      '· 평일 9:00~18:30 30분마다 자동 + 수동 새로고침 버튼',
      '· API 키는 서버(Cloud Functions)에서만 읽음 — 브라우저에서는 못 읽게 막혀 있음',
    ],
  },
  {
    page: 'requests',
    kicker: '4. 무역사무요청',
    title: '조 → 무역사무 업무 요청',
    body: ['요청 · 진행 상태 · 댓글이 한 곳에', '무역사무 계정은 무역사무 페이지만 보임'],
  },
  {
    page: 'settings',
    kicker: '5. 계정 · 권한',
    title: '누가 무엇을 볼 수 있나',
    body: [
      '· 관리자 화면 › 대시보드 사용자 에 있는 이메일만 로그인 가능',
      '· 권한: 관리자 · 조원 · 무역사무 · 팀장님 · 이사님',
      '· 권한 검사는 Firestore 보안 규칙(서버)에서 — 화면만 숨기는 게 아님',
    ],
  },
  {
    kicker: '6. 보안',
    title: '데이터는 어디에, 어떻게 지키나',
    body: [
      '· 실제 업무 데이터는 Firestore 에만 (GitHub 저장소에는 없음)',
      '· 사이트 코드 안의 Firebase 설정값은 공개용 값 (보안은 규칙으로)',
      '· ERP API 키 · 비밀값: secrets 컬렉션 → 규칙상 브라우저에서 읽기 금지',
      '· 파일 업로드도 Storage 규칙으로 로그인한 사람만',
    ],
  },
  {
    kicker: '7. 근태 연결',
    title: 'mem 근태 → 대시보드',
    body: ['크롬 확장 프로그램: mem 부서 근태 현황이 뜰 때마다 자동 반영', '대안: 즐겨찾기 버튼 (북마클릿) 한 번 누르기', 'mem 쪽 API 가 있으면 확장 없이 서버에서 바로 받을 수 있음'],
  },
  {
    kicker: '마무리',
    title: 'IT 실에 여쭤보고 싶은 것',
    body: ['· mem · ERP 공식 API / 계정 연동 가능 여부', '· 사내 보안 정책상 외부 호스팅(GitHub Pages · Firebase) 괜찮은지', '· 질문 받을게요 🙌'],
  },
];
