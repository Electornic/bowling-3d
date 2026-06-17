/**
 * 입력 기기 판별 (모바일 대응, docs/MOBILE_SUPPORT.md §2 공통 전제).
 * 터치 분기는 두 신호로 — 정적 환경 판정은 `isCoarsePointer()`(레이아웃/힌트용),
 * 개별 이벤트 분기는 `e.pointerType === 'touch'`(Controls). 둘을 섞지 않는다.
 */

/** coarse 포인터(손가락) 환경인가 — UI 레이아웃·힌트 분기용. */
export function isCoarsePointer(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
}
