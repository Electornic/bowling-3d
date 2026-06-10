import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true },
  // @dimforge/rapier3d-compat는 WASM을 JS에 인라인해 별도 설정이 필요 없음
});
