/**
 * 볼링 점수 계산 (도안 §7). 순수함수 — flat한 투구(rolls) 배열을 받는다.
 * 점수는 저장하지 않고 매번 rolls에서 재계산 → 스트라이크/스페어 보너스가 단순해짐.
 *
 * rolls 예: 퍼펙트 = [10,10,10,10,10,10,10,10,10,10,10,10] (12개)
 *           올 스페어 = [5,5, 5,5, ... , 5,5, 5] (21개)
 */

const STRIKE = 10;

/** 완성된 프레임들의 누적 점수 배열 (HUD 점수판용). 미완 프레임은 제외. */
export function frameScores(rolls: number[]): number[] {
  const out: number[] = [];
  let total = 0;
  let i = 0;

  for (let f = 0; f < 10; f++) {
    if (rolls[i] === undefined) break;

    if (rolls[i] === STRIKE) {
      // 스트라이크: 10 + 다음 2구 (보너스 미도착이면 중단)
      if (rolls[i + 1] === undefined || rolls[i + 2] === undefined) break;
      total += 10 + rolls[i + 1] + rolls[i + 2];
      i += 1;
    } else if (rolls[i] + (rolls[i + 1] ?? 0) === 10) {
      // 스페어: 10 + 다음 1구
      if (rolls[i + 1] === undefined || rolls[i + 2] === undefined) break;
      total += 10 + rolls[i + 2];
      i += 2;
    } else {
      // 오픈: 두 구 합
      if (rolls[i + 1] === undefined) break;
      total += rolls[i] + rolls[i + 1];
      i += 2;
    }
    out.push(total);
  }
  return out;
}

/** 최종 총점 (완성된 프레임까지의 누적) */
export function totalScore(rolls: number[]): number {
  const s = frameScores(rolls);
  return s.length ? s[s.length - 1] : 0;
}
