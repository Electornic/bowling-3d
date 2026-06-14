import { defineConfig } from 'vite';

// Tauri 모바일 dev: 실기기가 dev 서버에 접속하려면 PC의 LAN IP가 필요.
// `tauri [android|ios] dev`가 TAURI_DEV_HOST에 그 IP를 주입한다.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // Rust 컴파일 에러가 Vite 화면 클리어로 지워지지 않게 (Tauri 권장)
  clearScreen: false,
  // TAURI_ENV_* 변수를 클라이언트에 노출 (플랫폼 분기 등)
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    // 모바일 실기기 dev면 LAN IP로, 아니면 전체 인터페이스(host:true) — 기존 동작 유지
    host: host || true,
    // PORT: 프리뷰/CI가 임의 포트를 줄 때 사용 (기본 5173)
    port: Number(process.env.PORT) || 5173,
    // Tauri는 고정 포트를 기대 — 점유 시 조용히 바꾸지 않고 실패
    strictPort: true,
    hmr: host
      ? { protocol: 'ws', host, port: 1421 }
      : undefined,
    // src-tauri 변경은 Cargo가 감시 — Vite가 재빌드 트리거하지 않게
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // @dimforge/rapier3d-compat는 WASM을 JS에 인라인해 별도 설정이 필요 없음
});
