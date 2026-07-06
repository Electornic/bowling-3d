import { describe, it, expect } from 'vitest';
import { slowmoScale } from '../src/game/GameState';
import { SLOWMO_SCALE } from '../src/game/constants';

/**
 * 슬로모 배속 이징(#8) — update()에서 순수함수로 추출해 단위테스트 가능해진 지점.
 * p = timer/total (1→0), scale = SLOWMO_SCALE + (1-SLOWMO_SCALE)·(1-p)².
 */
describe('slowmoScale', () => {
  it('충돌 직후(timer=total, p=1) 최대 슬로모(SLOWMO_SCALE)', () => {
    expect(slowmoScale(1, 1)).toBeCloseTo(SLOWMO_SCALE, 6);
  });

  it('복원 완료(timer=0, p=0) 정상속도 1.0', () => {
    expect(slowmoScale(0, 1)).toBeCloseTo(1, 6);
  });

  it('중간(p=0.5)은 (1-p)² 이징이라 선형 중점보다 SLOWMO_SCALE 쪽에 머묾', () => {
    const mid = slowmoScale(0.5, 1); // (1-0.5)²=0.25 → SLOWMO_SCALE + 0.25·(1-SLOWMO_SCALE)
    const linearMid = (SLOWMO_SCALE + 1) / 2;
    expect(mid).toBeLessThan(linearMid); // 전반부 느리게 머묾 → 중간값이 선형 중점보다 작음(느린 쪽)
    expect(mid).toBeGreaterThan(SLOWMO_SCALE); // 그래도 복원은 시작됨
    expect(mid).toBeLessThan(1);
  });

  it('timer가 total을 초과해도 p는 1로 클램프(오버슈트 방지)', () => {
    expect(slowmoScale(5, 1)).toBeCloseTo(SLOWMO_SCALE, 6);
  });

  it('음수 timer도 p는 0으로 클램프(정상속도 유지)', () => {
    expect(slowmoScale(-3, 1)).toBeCloseTo(1, 6);
  });
});
