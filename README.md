# 🌏 Global Dashboard

우리 조(해외 업체 담당) 전용 대시보드. 구글 시트로 하던 **주간 할일**과 **주문 정리**를 한 곳에서 관리해요.

## 화면

| 화면 | 내용 |
| --- | --- |
| 🏠 홈 | 서울 + 담당 업체 나라 시계(시차·업무시간 표시), 오늘 퇴근/시차/휴가, 이번주 할일 요약·급한 일, 진행중 주문 요약, (준비중) 판매/수출 데이터 |
| ✅ 주간 할일 | 담당자별 요약표(할일/완료/남은거/오늘까지/내일까지/기한지남), 업체별·담당자별·마감순 보기, 담당자·업체·상태·검색 필터 |
| 📦 주문 관리 | 실주문 → ERP → 입고 → 인보이스 → 출고 체크 (출고 = 완료), 진행중/완료 탭, 단계별 "안 된 건" 바로 보기, 완료건 포함 검색 |
| 🧾 클레임 | 묶음/주문을 골라 패킹금액(원화·외화)을 자동으로 가져오고, 클레임 금액·비율·출고날짜·서류작성·환급 완료·파일 관리. 주문 관리의 [클레임] 버튼은 환급 안 된 클레임이 있으면 빨강 |
| ⚙️ 설정 | 담당자·업체(타임존/색) 관리, 백업 다운로드/가져오기 |

### 매주 시트 복사 안 해도 되는 이유
- 할일은 한 번만 만들면 **끝날 때까지 매주 자동으로 따라와요.**
- 완료한 일은 완료한 주까지만 보이고, 다음 주부터는 사라져요.
- ◀ 버튼으로 지난주를 보면 **그 주 일요일 기준 상태**로 보여요 (= 금요일에 멈춰둔 시트).

### 주문 "완료" 기준
진행 순서는 실주문 → ERP 등록 → 입고처리 → 인보이스 → 출고. 마지막 `출고`에 체크하면 완료. 출고 없이 끝난 건은 ⋯ 메뉴의 "수동 완료 처리".

## 로컬에서 실행

```bash
npm install
npm run dev
```

기본은 Firebase(팀 공유)에 연결되고 로그인 화면이 먼저 나와요.
혼자 테스트할 때는 `.env` 에 `VITE_DATA_MODE=local` 을 넣으면 브라우저에만 저장돼요.

## Firebase (프로젝트: `global-dash-1d62d`)

- 설정값: `src/firebase.ts` (공개용 값)
- 데이터: Firestore 컬렉션 `members`, `companies`, `tasks`, `orders`, `attendance`
- 로그인: Authentication > 이메일/비밀번호 (**사용자 작업 > 생성(가입) 사용 설정은 켜 둘 것**: 관리자 화면이 계정을 만들 때 필요)
- 계정 만들기: 관리자가 대시보드 설정 > 대시보드 사용자에서 이메일 + 임시 비밀번호로 추가 → 본인이 로그인 후 설정 > 내 비밀번호 바꾸기
- 접근 권한: Firestore `roles/{이메일}` 문서의 `level` (`admin` / `member`). **대시보드 설정 > 대시보드 사용자(관리자만 보이는 칸)에서 추가·삭제. 추가한 사람은 기본이 조원(member)**
- 첫 관리자 1명만 콘솔에서 직접 만들기: ① Authentication > Users > 사용자 추가 ② Firestore > 데이터 > 컬렉션 `roles` > 문서 ID = 내 이메일(소문자) > 필드 `level` = `admin`
- 보안 규칙: `firestore.rules` 를 콘솔 > Firestore > 규칙 에 붙여넣고 게시 (이메일을 적지 않으므로 한 번만 하면 됨)
- 처음 로그인하면 설정 → 백업 가져오기로 JSON 데이터를 넣음 (실제 업무 데이터는 공개 저장소에 두지 않음)

## ERP 금액 자동 채우기 (서버 함수 `functions/`)
주문의 매장코드 + 주문일자로 ERP API 를 불러서 원화/외화 금액을 채워요.
① `getexorderdata` → EXP_NO, 예정 금액 (`TOTAL_OUT_AMT_K/F`)  ② `getoutbounddata` → '출고승인' 줄이 하나라도 있으면 표시 '승인', 금액은 승인 난 줄의 출고 금액 합계. 표시를 누르면 API 2 줄별 내역과 예정 금액을 볼 수 있음 (확인용).
금액을 사람이 직접 고친 주문은 건드리지 않아요 (금액 두 칸을 다 비우면 다시 자동).
- API 키: Firestore 콘솔 > 컬렉션 `secrets` > 문서 `erp` > 필드 `apiKey` (문자열). 보안 규칙상 사이트에서는 못 읽음
- 평일 9:00~18:30(서울) 30분마다 자동 + 주문 관리의 '↻ 금액 새로고침' 버튼
- 배포 (PC 에서 한 번, Node.js 22 필요):
  `npx firebase-tools login` → `cd functions && npm install && cd ..` → `npx firebase-tools deploy --only functions`

## 클레임 파일 올리기
Firebase Storage 를 켜야 해요 (Blaze 요금제 필요, 무료 사용량 안에서는 0원). 켠 뒤 `storage.rules` 내용을 콘솔 > Storage > 규칙 에 붙여넣고 게시. Storage 없이도 🔗 링크 붙이기는 됨.

## mem 근태 연결
**크롬 확장 프로그램 (추천)**: `extension/` 폴더. 설정 화면에서 zip 을 받아 `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드. mem 탭에서 아이콘 → "mem으로 등록" 한 번 하면, 부서 근태 현황이 뜰 때마다 자동으로 대시보드에 반영. `extension/` 을 고치면 `python3 scripts/zip-extension.py` 로 zip 다시 만들기.

**북마크 버튼 (대안)**: 설정 화면의 **🕘 2조 근태 보내기** 버튼을 즐겨찾기바로 끌어다 놓고,
mem 의 부서 근태 현황 창을 연 상태에서 누르면 우리 조 출근·퇴근·휴가가 반영돼요.

## 배포

- **Firebase Hosting (추천)**: `npm run build` 후 `npx firebase-tools login` → `npx firebase-tools deploy --only hosting`
  → `https://global-dash-1d62d.web.app`
- **GitHub Pages**: `.github/workflows/deploy.yml` (main 에 push). 이 경우 Pages 주소를 Authentication > 설정 > 승인된 도메인에 추가

## 다음에 추가할 것 (아이디어)
- 업체별 판매/수출 데이터 (구글 시트 or CSV 연동 → 그래프)
- 로그인 + "내 할일" 기본 필터
- 할일 ↔ 주문 연결, 업체별 주문 탭 (에콰도르/카자흐스탄/Chara)

## 기술 스택
Vite + React + TypeScript, Firebase (Auth + Firestore)

## 서버 함수·보안 규칙 올리기 (Windows, 더블클릭)

처음 한 번:
1. Git 설치: https://git-scm.com/download/win (기본값으로 다음 → 다음)
2. cmd 에서 원하는 폴더로 가서 `git clone https://github.com/karrotinAB/GlobalDashboard.git`
3. 그 폴더에서 `npx firebase-tools login` (이미 로그인했으면 생략)

그다음부터는 `GlobalDashboard` 폴더의 **deploy.bat** 을 더블클릭하면
최신 코드 받기 → 서버 함수 준비 → 서버 함수 + Firestore 규칙 + Storage 규칙 올리기를 한 번에 해요.

## mem 근태 서버 자동 가져오기 (노트북 안 켜도 됨)

1. Firestore 콘솔 > `secrets` 컬렉션 > `mem` 문서를 만들고 칸을 넣어요 (값은 F12 > 네트워크에서 확인):
   `loginUrl`, `idField`, `pwField`, `attendanceUrl` (필요하면 `loginPageUrl`, `csrfField`, `extra`, `attendanceMethod`, `attendanceBody`)
   — 자세한 설명은 `functions/mem.js` 맨 위
2. deploy.bat 을 실행하면 처음 한 번 `MEM_ID`, `MEM_PASSWORD` 를 물어봐요 (입력한 값은 Firebase 비밀값 저장소에만 저장)
3. 설정 > mem 근태 자동 가져오기 > **지금 가져오기** 로 시험
