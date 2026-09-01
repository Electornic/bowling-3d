/**
 * 공통 네온/신스웨이브 UI 토큰 + 헬퍼.
 * 씬(Environment.ts)의 팔레트와 통일 — 모든 오버레이 UI(점수판·볼무게·파워·스핀)가
 * 같은 비주얼 언어를 쓰도록 한 곳에서 관리한다.
 */

export const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>): void => {
  Object.assign(el.style, style);
};

/**
 * 하우스 팔레트 (Environment.ts 전광판·띠와 동일 색).
 *
 * ⚠️ 2026-09-02에 **값이 전부 바뀌었다.** 구 팔레트의 액센트 8색은 Tailwind 기본 팔레트
 * 리터럴이었다 — cyan-400 `#22d3ee` · purple-500 `#a855f7` · green-400 `#4ade80` ·
 * amber-500 `#f59e0b` … 디자인 의도로 도달한 색이 아니라 **기본값이라서 그 자리에 있던 색**이고,
 * 그게 "AI가 뽑은 화면"으로 읽히는 가장 큰 단일 원인이었다(연출이 아니라 팔레트다).
 *
 * 새 값은 **미드센추리 볼링 하우스 인쇄 팔레트**다. 근거가 둘이다:
 *  ① 실제 마스킹 유닛 카탈로그 62종을 훑으니 미드센추리 계열(크림·브릭·터쿼이즈·머스터드)이
 *     한 갈래로 실재했고, 신스웨이브 선셋은 0종이었다.
 *  ② 아래 applyPanel 주석의 방 실측과 맞물린다 — 웜 우드 30° 43.1% · 쿨 슬레이트 210° 29.9%.
 *     터쿼이즈는 그 쿨 축, 머스터드는 그 웜 축에 얹힌다. 브릭은 **핀 넥 스트라이프**라
 *     방에 실물로 존재하는 유일한 고채도색이다(핀 10개 × 옆 레인).
 *
 * 이름이 색상값을 서술한다(구 cyan·pink·gold와 같은 규칙) — 값만 갈아치우면 이름이 거짓이 되므로
 * 키까지 함께 바꿨다. `NEON`이라는 객체명은 유지한다: 게임 이름이 NEON LANES이고,
 * 코스믹 볼링(90년대부터 블랙라이트·glow ink가 업계 표준 옵션)이 실재하는 근거이며,
 * Hud·Controls가 `ensureNeonStyles()`를 "네온 UI 표시 전 1회 호출" 계약으로 이미 부른다.
 */
export const NEON = {
  turquoise: '#3aa8a0', // 프라이머리 — 쿨 축 210°와 같은 계열에서 채도를 뺀 자리
  brick: '#c8102e', // 핫 액센트 — 핀 넥 스트라이프. 방에 실재하는 고채도색
  mustard: '#e0a12b', // 강조 — 메이플 30°와 같은 색상군
  amber: '#eab861', // mustard의 밝은 짝
  cream: '#ebe4d6', // 미드센추리 바탕색 (구 ice — 쿨 화이트에서 웜으로)
  sage: '#5c9e6b', // 성공 (구 green — tailwind green-400이었다)
  red: '#d1483f', // 실패·경고 (브릭보다 탈색해 액센트와 구분)
  // --- 텍스트 3단 스케일 ---
  // 회색 텍스트가 UI 전반에 9종(#aeb6c4·#aab3c2·#9aa3b2·#9aa6bd·#8a93a3·#7d8696·#6b7686 …)으로
  // 흩어져 있었다. NEON에 중성색이 text·dim 둘뿐이라 중간 톤을 전부 호출부에서 즉석으로 만든 결과다
  // (docs/legacy/POLISH_BACKLOG.md #6이 "스케일 시스템 부재"로 미뤄둔 항목).
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
 * 공통 패널 스타일 (불투명 슬레이트 단색 + 액센트 하드 보더).
 *
 * ⚠️ **글래스모피즘을 해체했다** (2026-09-02). 구현이 «반투명 그라데 배경 + 1px 밝은 액센트 보더 +
 * 옅은 글로우 + `blur(8px)`»였는데, 이 네 조합은 업계에서 정리된 "AI가 뽑은 UI" 지표의 정의와
 * 문자 그대로 일치했다. 셋을 걷었다 — 그라데 → 불투명 단색 · 글로우 → 순수 드롭섀도 · 블러 → 제거.
 * 라운드도 12px → 3px: 미드센추리 인쇄물은 모서리를 굴리지 않고, 12px는 그 자체로 흔한 표식이다.
 * 액센트는 보더에만 남긴다(한쪽 굵은 액센트 레일은 또 다른 표식이라 쓰지 않는다).
 *
 * 부수 효과로 가독성이 올랐다 — 블러는 뒤 3D 씬의 고휘도 픽셀을 완전히 못 지우지만 불투명은 지운다.
 *
 * 배경은 **홀에**, 정체성은 **액센트에**. 예전 딥퍼플(색상 264°)은 벽이 검을 때 전광판과 한 세트로
 * 읽혀 맞았지만, 벽·천장이 채워진 뒤 조준 프레임 색상 히스토그램을 재보니
 * 웜 우드 30° 43.1% · 쿨 슬레이트 210° 29.9% · 무채색 13.9% = **저채도 건축이 87%**이고
 * 고채도(퍼플 270° 4.4% · 핑크 330° 0.9% · 시안 180° 0.9%)는 전부 전광판·조명기구였다.
 * 즉 퍼플 패널은 '방'이 아니라 '화면'에 속한 색이 됐다. 220° 슬레이트로 옮겨 벽 색군에 넣는다
 * (Menu.ts 자체 패널 rgba(14,17,27) = 226°와도 같은 계열로 통일).
 * 네온은 안 버린다 — 테두리·글로우의 accent가 그대로 지고, 액센트는 호출부가 정한다.
 */
export function applyPanel(el: HTMLElement, accent: string = NEON.turquoise): void {
  css(el, {
    background: PANEL_BG,
    border: `1px solid ${rgba(accent, 0.38)}`,
    borderRadius: '3px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
  });
}

/** 패널 서피스 단색 (색상 220° — 위 실측의 쿨 슬레이트 축). text/dim/faint 대비 계산의 기준면. */
export const PANEL_BG = '#151a20';

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
