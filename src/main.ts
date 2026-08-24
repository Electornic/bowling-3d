import './ui/styles/ui.css'; // 정적 UI 스타일·애니메이션(#4) — Vite가 <head>에 주입. 토큰은 theme.ts가 :root 변수로 방출.
import { inject } from '@vercel/analytics';
import { boot } from './core/Boot';

// Vercel Web Analytics — 웹 배포판 전용. 스크립트·수집 엔드포인트가 전부 같은 오리진의
// /_vercel/insights/* 라서 Vercel이 서빙하지 않는 APK(tauri://localhost)에선 404만 난다.
// TAURI_ENV_PLATFORM은 tauri CLI가 beforeBuildCommand에 주입하는 빌드타임 상수(vite.config.ts envPrefix)
// → 앱 빌드에선 이 분기가 통째로 사라진다. 실행 중 주입되는 __TAURI_INTERNALS__는 그 폴백.
const isTauri =
  Boolean(import.meta.env.TAURI_ENV_PLATFORM) || '__TAURI_INTERNALS__' in window;
if (!isTauri) {
  // dev는 'development' — 네트워크로 안 쏘고 콘솔에만 찍어 배포 데이터를 오염시키지 않는다.
  inject({ mode: import.meta.env.DEV ? 'development' : 'production' });
}

boot().catch((e) => {
  console.error('[bowling-3d] Boot failed:', e);
  // 터미널 로더에 실패를 알려 빨간 ERROR 줄 + 'TAP TO RETRY'로 표시(index.html). 로더 부재 시 평문 폴백.
  const w = window as Window & { __loaderError?: (msg: string) => void };
  const msg = (e && e.message) || String(e);
  if (w.__loaderError) {
    w.__loaderError(msg);
  } else {
    const el = document.getElementById('loading');
    if (el) el.textContent = 'Boot failed: ' + msg;
  }
});
