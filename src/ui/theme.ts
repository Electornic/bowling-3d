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

let varsEmitted = false;
/**
 * NEON 팔레트를 :root CSS 변수(--neon-*)로 1회 방출 — ui.css(정적 애니메이션·의사요소, #4)가 var()로 소비(#5).
 * TS의 NEON이 유일 소스: CSS·DOM-JS·WebGL 세 세계가 같은 상수를 공유해 드리프트 0.
 * (함수명 유지 — Hud·Controls가 "네온 UI 표시 전 1회 호출" 계약으로 이미 부른다. .neon-range·키프레임은 ui.css로 이동.)
 */
export function ensureNeonStyles(): void {
  if (varsEmitted) return;
  varsEmitted = true;
  const root = document.documentElement.style;
  for (const [k, v] of Object.entries(NEON)) root.setProperty(`--neon-${k}`, v);
}
