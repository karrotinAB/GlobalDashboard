import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base: './' 로 두면 GitHub Pages / Vercel / Netlify 어디에 올려도 동작함 (hash 라우팅 사용)
export default defineConfig({
  base: './',
  plugins: [react()],
});
