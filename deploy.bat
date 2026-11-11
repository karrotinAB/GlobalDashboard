@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ==== 2조 Dashboard: 서버 함수 + 보안 규칙 올리기 ====
echo.
echo [1/3] GitHub 에서 최신 코드 받는 중...
git pull
if errorlevel 1 goto :fail
echo.
echo [2/3] 서버 함수 준비 중 (npm install)...
pushd functions
call npm install --no-audit --no-fund
popd
if errorlevel 1 goto :fail
echo.
echo [3/3] Firebase 에 올리는 중 (서버 함수 + Firestore 규칙 + Storage 규칙)...
call npx firebase-tools deploy --only functions,firestore:rules,storage
if errorlevel 1 goto :fail
echo.
echo 끝! 창을 닫아도 돼요.
pause
exit /b 0
:fail
echo.
echo 문제가 생겼어요. 위 빨간 글씨를 캡처해서 보내 주세요.
pause
exit /b 1
