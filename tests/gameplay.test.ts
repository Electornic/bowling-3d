import { describe, it, expect } from 'vitest';
import { totalScore, frameScores, isNoTapStrike, rollStats } from '../src/game/Scoreboard';
import { detectSplit, pinIndexByNumber, PIN_NUMBERS } from '../src/game/splits';
import { OBSTACLE_STAGES } from '../src/game/obstacles';
import { LANE_WIDTH } from '../src/game/constants';

/** 핀 번호 목록 → standingMask */
const mask = (standing: number[]): boolean[] =>
  PIN_NUMBERS.map((n) => standing.includes(n));

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

describe('detectSplit (인접 그래프 판정)', () => {
  it('7-10은 스플릿', () => {
    const r = detectSplit(mask([7, 10]));
    expect(r.isSplit).toBe(true);
    expect(r.label).toBe('7-10');
  });

  it('베이비 스플릿 3-10, 2-7도 스플릿', () => {
    expect(detectSplit(mask([3, 10])).isSplit).toBe(true);
    expect(detectSplit(mask([2, 7])).isSplit).toBe(true);
  });

  it('4-6 (5번 다운) 스플릿, 5-7도 스플릿', () => {
    expect(detectSplit(mask([4, 6])).isSplit).toBe(true);
    expect(detectSplit(mask([5, 7])).isSplit).toBe(true);
  });

  it('슬리퍼 2-8은 스플릿 아님 (일직선, 사이 핀 없음)', () => {
    expect(detectSplit(mask([2, 8])).isSplit).toBe(false);
  });

  it('헤드핀이 서 있으면 스플릿 아님 (1-2-4-7 피켓 펜스)', () => {
    expect(detectSplit(mask([1, 2, 4, 7])).isSplit).toBe(false);
  });

  it('인접 클러스터(2-4-5)는 스플릿 아님, 단일 핀도 아님', () => {
    expect(detectSplit(mask([2, 4, 5])).isSplit).toBe(false);
    expect(detectSplit(mask([10])).isSplit).toBe(false);
  });

  it('빅포 4-6-7-10은 스플릿', () => {
    const r = detectSplit(mask([4, 6, 7, 10]));
    expect(r.isSplit).toBe(true);
    expect(r.label).toBe('4-6-7-10');
  });

  it('핀 번호 매핑: 인덱스0=1번, 뒷줄 좌→우 7~10', () => {
    expect(PIN_NUMBERS[0]).toBe(1);
    expect(pinIndexByNumber(1)).toBe(0);
    // 뒷줄(인덱스 6~9)은 x 내림차순으로 7,8,9,10 — 인덱스 6은 x가 가장 작음(화면 오른쪽) = 10번
    expect(PIN_NUMBERS[6]).toBe(10);
    expect(PIN_NUMBERS[9]).toBe(7);
  });
});

describe('노탭 (No-Tap) — isNoTapStrike 술어 + record-as-10 회귀', () => {
  it('9핀 노탭: 풀랙 9핀↑ = 스트라이크, 8핀 = 아님', () => {
    expect(isNoTapStrike(1, 10, 9)).toBe(true); // 9개 쓰러뜨림 → 스트라이크
    expect(isNoTapStrike(2, 10, 9)).toBe(false); // 8개 → 아님
    expect(isNoTapStrike(0, 10, 9)).toBe(true); // 클린 스트라이크
  });

  it('8핀 노탭: 풀랙 8핀↑ = 스트라이크', () => {
    expect(isNoTapStrike(2, 10, 8)).toBe(true);
    expect(isNoTapStrike(3, 10, 8)).toBe(false);
  });

  it('⚠️ 1-then-9 버그 가드: 2구는 풀랙(standingAtThrow=10) 아니라 변환 안 됨', () => {
    expect(isNoTapStrike(9, 10, 9)).toBe(false); // 1구 1핀(standing 9) → record 1
    expect(isNoTapStrike(0, 9, 9)).toBe(false); // 2구 9핀 정리(throw 9) → record 9 → [1,9] 스페어 유지
  });

  it('noTap=10(기본)은 비활성 — 일반 스트라이크와 동일', () => {
    expect(isNoTapStrike(0, 10, 10)).toBe(true); // 풀랙 전멸만 스트라이크
    expect(isNoTapStrike(1, 10, 10)).toBe(false); // 9핀은 스트라이크 아님(노탭 꺼짐)
  });

  it('record-as-10 결과를 frameScores가 일관 처리: F1 노탭스트라이크[10] + F2 스페어[1,9]', () => {
    // F1=10+(보너스 1,9)=20, F2 스페어=10+(다음1구 5)=15 → 누적 [20,35] (F3 미완)
    expect(frameScores([10, 1, 9, 5])).toEqual([20, 35]);
  });
});

describe('장애물 레인 — OBSTACLE_STAGES 코스 데이터 검증', () => {
  // 핀 x좌표 (splits.ts GEOM과 동일). 7·10(±0.457)은 표적이면 거터 직구로 우연히 맞을 수 있어 제외돼야 함.
  const PIN_X: Record<number, number> = {
    1: 0, 2: 0.1524, 3: -0.1524, 4: 0.3048, 5: 0, 6: -0.3048, 7: 0.4572, 8: 0.1524, 9: -0.1524, 10: -0.4572,
  };

  it('10 스테이지', () => {
    expect(OBSTACLE_STAGES.length).toBe(10);
  });

  it('모든 스테이지: 핀 1개 이상 · 번호 1~10 · 중복 없음', () => {
    OBSTACLE_STAGES.forEach((st, i) => {
      expect(st.pins.length, `stage ${i + 1} pins`).toBeGreaterThan(0);
      expect(new Set(st.pins).size, `stage ${i + 1} 중복`).toBe(st.pins.length);
      for (const n of st.pins) {
        expect(n, `stage ${i + 1} 핀번호`).toBeGreaterThanOrEqual(1);
        expect(n, `stage ${i + 1} 핀번호`).toBeLessThanOrEqual(10);
      }
    });
  });

  it('모든 배리어: 레인 폭 안 · z는 오일 브레이크(9.5)~핀덱 사이', () => {
    const half = LANE_WIDTH / 2;
    OBSTACLE_STAGES.forEach((st, i) => {
      expect(st.barriers.length, `stage ${i + 1} 배리어`).toBeGreaterThan(0);
      for (const b of st.barriers) {
        const w = b.w ?? 0.22; // Barrier.ts DEF_W
        expect(Math.abs(b.x) + w / 2, `stage ${i + 1} 배리어 x폭`).toBeLessThanOrEqual(half + 1e-9);
        expect(b.z, `stage ${i + 1} 배리어 z 하한`).toBeGreaterThan(9.5);
        expect(b.z, `stage ${i + 1} 배리어 z 상한`).toBeLessThan(18);
      }
    });
  });

  it('표적 핀은 |x| ≤ 0.31 (외곽핀 7·10 직구 우연 픽업 방지 → 훅 필수 보존)', () => {
    OBSTACLE_STAGES.forEach((st, i) => {
      for (const n of st.pins) {
        expect(Math.abs(PIN_X[n]), `stage ${i + 1} 표적 핀 ${n}`).toBeLessThanOrEqual(0.31);
      }
    });
  });
});
