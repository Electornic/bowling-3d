import { defineConfig } from 'vite';

export default defineConfig({
  // PORT: 프리뷰/CI가 임의 포트를 줄 때 사용 (기본 5173)
  server: { host: true, port: Number(process.env.PORT) || 5173 },
  // @dimforge/rapier3d-compat는 WASM을 JS에 인라인해 별도 설정이 필요 없음
});
