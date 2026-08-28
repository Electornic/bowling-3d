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
  // --- 텍스트 3단 스케일 ---
  // 회색 텍스트가 UI 전반에 9종(#aeb6c4·#aab3c2·#9aa3b2·#9aa6bd·#8a93a3·#7d8696·#6b7686 …)으로
  // 흩어져 있었다. NEON에 중성색이 text·dim 둘뿐이라 중간 톤을 전부 호출부에서 즉석으로 만든 결과다
  // (POLISH_BACKLOG #6이 "스케일 시스템 부재"로 미뤄둔 항목).
  //
  // 메뉴 서피스 실측 — 패널 rgba(14,17,27,0.96) ← 스크림 0.45 ← 3D 배경 → 합성 #11131d(휘도 0.007).
  // 그 위 WCAG 대비: text 15.74 · dim 7.55 · faint 5.98. 전부 본문 기준(4.5) 통과.
  //
  // ⚠️ **4단(더 흐린 '미해금' 톤)은 일부러 안 만들었다.** 휘도 0.007짜리 서피스에서는
  // "눈에 띄게 더 흐리다"와 "4.5:1을 넘는다"를 동시에 만족시킬 수 없다 — 구 #6b7686이 정확히
  // 그 자리(4.02)에서 미달이었다. 잠김 상태는 라벨 색 단계(gold/text/faint)와 상태 열이 이미 지므로
  // 텍스트를 읽기 어렵게 만들어 표현할 필요가 없다.
  text: '#e8edf5', // 본문·강조
  dim: '#9aa6bd', // 보조 (섹션 라벨·비활성)
  faint: '#8a93a3', // 3차 (설명·미해금·안내)
} as const;

export const FONT_UI = '600 13px/1.4 system-ui, -apple-system, sans-serif';
export const FONT_DIGITS = "700 14px/1 ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, monospace";

/** hex(#rrggbb) → rgba() 문자열 (알파 합성용) */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/**
 * 공통 네온 글래스 패널 스타일 (쿨 슬레이트 그라데 + 네온 테두리 + 글로우 + 블러).
 *
 * 배경은 **홀에**, 정체성은 **액센트에**. 예전 딥퍼플(색상 264°)은 벽이 검을 때 전광판과 한 세트로
 * 읽혀 맞았지만, 벽·천장이 채워진 뒤 조준 프레임 색상 히스토그램을 재보니
 * 웜 우드 30° 43.1% · 쿨 슬레이트 210° 29.9% · 무채색 13.9% = **저채도 건축이 87%**이고
 * 고채도(퍼플 270° 4.4% · 핑크 330° 0.9% · 시안 180° 0.9%)는 전부 전광판·조명기구였다.
 * 즉 퍼플 패널은 '방'이 아니라 '화면'에 속한 색이 됐다. 220° 슬레이트로 옮겨 벽 색군에 넣는다
 * (Menu.ts 자체 패널 rgba(14,17,27) = 226°와도 같은 계열로 통일).
 * 네온은 안 버린다 — 테두리·글로우의 accent가 그대로 지고, 액센트는 호출부가 정한다.
 */
export function applyPanel(el: HTMLElement, accent: string = NEON.cyan): void {
  css(el, {
    background: 'linear-gradient(155deg, rgba(16,20,30,0.86), rgba(7,9,15,0.92))',
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
