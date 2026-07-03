/**
 * 공통 네온/신스웨이브 UI 토큰 + 헬퍼.
 * 씬(Environment.ts)의 팔레트와 통일 — 모든 오버레이 UI(점수판·볼무게·파워·스핀)가
 * 같은 비주얼 언어를 쓰도록 한 곳에서 관리한다.
 */

export const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>): void => {
  Object.assign(el.style, style);
};

/** 씬 네온 팔레트 (Environment.ts 전광판·네온 띠와 동일 색) */
export const NEON = {
  cyan: '#22d3ee',
  pink: '#ff2d78',
  purple: '#a855f7',
  gold: '#ffd54a',
  amber: '#ffd86b',
  ice: '#dfe8ff',
  green: '#4ade80',
  red: '#ef6a6a',
  text: '#e8edf5',
  dim: '#9aa6bd',
} as const;

export const FONT_UI = '600 13px/1.4 system-ui, -apple-system, sans-serif';
export const FONT_DIGITS = "700 14px/1 ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, monospace";

/** hex(#rrggbb) → rgba() 문자열 (알파 합성용) */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** 공통 네온 글래스 패널 스타일 (딥퍼플 그라데 + 네온 테두리 + 글로우 + 블러) */
export function applyPanel(el: HTMLElement, accent: string = NEON.cyan): void {
  css(el, {
    background: 'linear-gradient(155deg, rgba(26,11,48,0.86), rgba(8,4,20,0.92))',
    border: `1px solid ${rgba(accent, 0.3)}`,
    borderRadius: '12px',
    boxShadow: `0 6px 26px rgba(0,0,0,0.5), 0 0 18px ${rgba(accent, 0.14)}`,
    backdropFilter: 'blur(8px)',
  });
  el.style.setProperty('-webkit-backdrop-filter', 'blur(8px)');
}

let stylesInjected = false;
/**
 * 인라인 style로 걸 수 없는 의사요소(range 슬라이더 썸/트랙)와 키프레임을 1회 주입.
 * 네이티브 <input type=range>를 네온 룩으로 바꾸려면 ::-webkit-slider-thumb 등이 필요.
 */
export function ensureNeonStyles(): void {
  if (stylesInjected) return;
  stylesInjected = true;
  const s = document.createElement('style');
  s.textContent = `
.neon-range {
  -webkit-appearance: none; appearance: none;
  width: 100%; height: 6px; border-radius: 999px; outline: none; cursor: pointer; margin: 0;
  background: linear-gradient(90deg, ${NEON.cyan}, ${NEON.purple}, ${NEON.pink});
}
.neon-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 18px; height: 18px; border-radius: 50%;
  background: #fff; border: 2px solid ${NEON.cyan};
  box-shadow: 0 0 10px ${rgba(NEON.cyan, 0.9)}, 0 1px 3px rgba(0,0,0,0.6);
}
.neon-range::-moz-range-thumb {
  width: 18px; height: 18px; border: 2px solid ${NEON.cyan}; border-radius: 50%;
  background: #fff; box-shadow: 0 0 10px ${rgba(NEON.cyan, 0.9)};
}
.neon-range::-moz-range-track { height: 6px; border-radius: 999px; background: transparent; }
/* 터치(coarse): 슬라이더 썸 18→28px로 키워 손가락 타깃 확보 (MOBILE_SUPPORT.md §3.1) */
@media (pointer: coarse) {
  .neon-range { height: 10px; }
  .neon-range::-webkit-slider-thumb { width: 28px; height: 28px; }
  .neon-range::-moz-range-thumb { width: 28px; height: 28px; }
}
@keyframes neonPulse {
  0%, 100% { box-shadow: inset 0 0 0 1.5px ${rgba(NEON.gold, 0.55)}, 0 0 9px ${rgba(NEON.gold, 0.3)}; }
  50%      { box-shadow: inset 0 0 0 1.5px ${rgba(NEON.gold, 1)}, 0 0 16px ${rgba(NEON.gold, 0.55)}; }
}
/* 누적 점수가 새로 뜨거나 바뀔 때 톡 튀는 팝 (Hud) — 차분한 감속 이징, 피크에서 골드 플래시 */
@keyframes juiceScorePop {
  0%   { transform: scale(1); }
  30%  { transform: scale(1.28); color: ${NEON.gold}; }
  100% { transform: scale(1); }
}
.juice-score-pop { animation: juiceScorePop 0.42s cubic-bezier(0.22, 1, 0.36, 1); }
@media (prefers-reduced-motion: reduce) { .juice-score-pop { animation: none; } }
`;
  document.head.appendChild(s);
}
