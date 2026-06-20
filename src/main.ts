import { boot } from './core/Boot';

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
