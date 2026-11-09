# 🌏 Global Dashboard

우리 조(해외 업체 담당) 전용 대시보드. 구글 시트로 하던 **주간 할일**과 **주문 정리**를 한 곳에서 관리해요.

## 화면

| 화면 | 내용 |
| --- | --- |
| 🏠 홈 | 서울 + 담당 업체 나라 시계(시차·업무시간 표시), 오늘 퇴근/시차/휴가, 이번주 할일 요약·급한 일, 진행중 주문 요약, (준비중) 판매/수출 데이터 |
| ✅ 주간 할일 | 담당자별 요약표(할일/완료/남은거/오늘까지/내일까지/기한지남), 업체별·담당자별·마감순 보기, 담당자·업체·상태·검색 필터 |
| 📦 주문 관리 | 실주문 → ERP → 입고 → 출고 → 인보이스 체크, 진행중/완료 탭, 단계별 "안 된 건" 바로 보기, 완료건 포함 검색 |
| ⚙️ 설정 | 담당자·업체(타임존/색) 관리, 백업 다운로드/가져오기 |

### 매주 시트 복사 안 해도 되는 이유
- 할일은 한 번만 만들면 **끝날 때까지 매주 자동으로 따라와요.**
- 완료한 일은 완료한 주까지만 보이고, 다음 주부터는 사라져요.
- ◀ 버튼으로 지난주를 보면 **그 주 일요일 기준 상태**로 보여요 (= 금요일에 멈춰둔 시트).

### 주문 "완료" 기준
`출고` + `인보이스` 둘 다 체크되면 완료. 그 외에 끝난 건은 주문 수정 화면에서 "수동 완료 처리".

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
- 로그인: Authentication > 이메일/비밀번호. 각자 로그인 화면의 **"계정 만들기"로 가입 → 메일 인증**
- 접근 권한: Firestore `access/{이메일}` 문서의 `role` (`admin` / `member`). **대시보드 설정 > 접근 권한(관리자만 보임)에서 추가·삭제**
- 첫 관리자 1명만 콘솔에서 직접 만들기: Firestore > 데이터 > 컬렉션 `access` > 문서 ID = 내 이메일(소문자) > 필드 `role` = `admin`
- 보안 규칙: `firestore.rules` 를 콘솔 > Firestore > 규칙 에 붙여넣고 게시 (이메일을 적지 않으므로 한 번만 하면 됨)
- 처음 로그인하면 설정 → 백업 가져오기로 JSON 데이터를 넣음 (실제 업무 데이터는 공개 저장소에 두지 않음)

## mem 근태 연결
설정 화면의 **🕘 2조 근태 보내기** 버튼을 즐겨찾기바로 끌어다 놓고,
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
