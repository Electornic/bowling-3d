import { describe, it, expect } from 'vitest';
import { totalScore, frameScores } from '../src/game/Scoreboard';

/** [a,b]를 n번 반복해 평탄화 */
const repeat = (pair: number[], n: number): number[] => Array(n).fill(pair).flat();

describe('Scoreboard (도안 §7.1 표준 케이스)', () => {
  it('올 거터 = 0', () => {
    expect(totalScore(Array(20).fill(0))).toBe(0);
  });

  it('퍼펙트 게임(12 스트라이크) = 300', () => {
    expect(totalScore(Array(12).fill(10))).toBe(300);
  });

  it('올 스페어 (5,5)×10 + 5 = 150', () => {
    expect(totalScore([...repeat([5, 5], 10), 5])).toBe(150);
  });

  it('올 9핀 오픈 (9,0)×10 = 90', () => {
    expect(totalScore(repeat([9, 0], 10))).toBe(90);
  });

  it('올 1핀 = 20', () => {
    expect(totalScore(Array(20).fill(1))).toBe(20);
  });

  it('스페어→스트라이크 보너스 누적: [5,5,10,3,4] → [20,37,44]', () => {
    const rolls = [5, 5, 10, 3, 4, ...Array(12).fill(0)];
    expect(frameScores(rolls).slice(0, 3)).toEqual([20, 37, 44]);
  });

  it('미완 게임은 완성 프레임까지만', () => {
    expect(totalScore([3, 4])).toBe(7); // 1프레임만
    expect(totalScore([10])).toBe(0); // 스트라이크 보너스 미도착 → 아직 0
    expect(frameScores([3, 4]).length).toBe(1);
  });
});
