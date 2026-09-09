import { defineConfig } from 'vite';

export default defineConfig({
  // 어느 하위 경로에 올려도 그대로 열리도록 상대 경로로 뽑는다
  base: './',
  server: { port: 5180 },
});
