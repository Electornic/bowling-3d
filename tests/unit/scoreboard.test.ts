import { describe, it, expect } from 'vitest';
import { totalScore, frameScores, rollStats } from '../../src/game/Scoreboard';

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

describe('블리츠 모드 점수 (frames=3)', () => {
  it('퍼펙트 블리츠 (5 스트라이크) = 90', () => {
    expect(totalScore(Array(5).fill(10), 3)).toBe(90);
  });

  it('올 스페어 블리츠 (5,5)×3 + 5 = 45', () => {
    expect(totalScore([5, 5, 5, 5, 5, 5, 5], 3)).toBe(45);
  });

  it('마지막 프레임 보너스 규칙 유지: [3,4, 10, 10,5,3]', () => {
    // f1=7, f2=10+10+5=25(누적32), f3=10+5+3=18(누적50)
    expect(frameScores([3, 4, 10, 10, 5, 3], 3)).toEqual([7, 32, 50]);
  });

  it('frames 기본값 10은 기존과 동일 (퍼펙트 300)', () => {
    expect(totalScore(Array(12).fill(10))).toBe(300);
  });
});

describe('rollStats (하이스코어 통계 분류)', () => {
  it('퍼펙트 게임: 스트라이크 12/12', () => {
    const rolls = [...Array(9).fill([10]), [10, 10, 10]];
    expect(rollStats(rolls)).toEqual({
      strikes: 12,
      strikeChances: 12,
      spares: 0,
      spareChances: 0,
    });
  });

  it('올 스페어: 스페어 10/10', () => {
    const rolls = [...Array(9).fill([5, 5]), [5, 5, 5]];
    const st = rollStats(rolls);
    expect(st.spares).toBe(10);
    expect(st.spareChances).toBe(10);
    // 스페어 변환 뒤 10프레임 3구는 새 랙 = 스트라이크 기회
    expect(st.strikeChances).toBe(11);
    expect(st.strikes).toBe(0);
  });

  it('진행 중 게임 혼합: X / (5,5) / (3,4)', () => {
    expect(rollStats([[10], [5, 5], [3, 4]])).toEqual({
      strikes: 1,
      strikeChances: 3,
      spares: 1,
      spareChances: 2,
    });
  });
});
