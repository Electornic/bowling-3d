/**
 * 입력 기기 판별 (모바일 대응, docs/MOBILE_SUPPORT.md §2 공통 전제).
 * 터치 분기는 두 신호로 — 정적 환경 판정은 `isCoarsePointer()`(레이아웃/힌트용),
 * 개별 이벤트 분기는 `e.pointerType === 'touch'`(Controls). 둘을 섞지 않는다.
 */

/** coarse 포인터(손가락) 환경인가 — UI 레이아웃·힌트 분기용. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}

/**
 * 세로(폰) 게임이라 데스크탑에선 가운데 칼럼으로 제약한다 — 캔버스·HUD·도크가 와이드 화면에서
 * 좌우로 퍼지고 레인 원근이 과하게 넓어지는 걸 막는다. 폰은 100vw < STAGE_MAX_W라 풀폭(무영향).
 */
export const STAGE_MAX_W = 480;

/** 현재 스테이지(게임 칼럼) 폭 — 데스크탑은 STAGE_MAX_W 상한, 폰은 화면폭. 캔버스·조준 매핑 공용. */
export function stageWidth(): number {
  return Math.min(window.innerWidth, STAGE_MAX_W);
}
