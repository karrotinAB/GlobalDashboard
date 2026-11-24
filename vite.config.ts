import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// base: './' 로 두면 GitHub Pages / Vercel / Netlify 어디에 올려도 동작함 (hash 라우팅 사용)
export default defineConfig({
  base: './',
  plugins: [react()],
  // 앱의 Firestore 는 모두 가드를 거침 (IT 검토용 계정의 가짜 데이터 표시 · 다른 사람의 가짜 데이터 숨김) — src/lib/fsGuard.ts
  resolve: { alias: [{ find: /^firebase\/firestore$/, replacement: fileURLToPath(new URL('./src/lib/fsGuard.ts', import.meta.url)) }] },
});
