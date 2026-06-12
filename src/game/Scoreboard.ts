/**
 * 볼링 점수 계산 (도안 §7). 순수함수 — flat한 투구(rolls) 배열을 받는다.
 * 점수는 저장하지 않고 매번 rolls에서 재계산 → 스트라이크/스페어 보너스가 단순해짐.
 *
 * rolls 예: 퍼펙트 = [10,10,10,10,10,10,10,10,10,10,10,10] (12개)
 *           올 스페어 = [5,5, 5,5, ... , 5,5, 5] (21개)
 */

const STRIKE = 10;

/** 완성된 프레임들의 누적 점수 배열 (HUD 점수판용). 미완 프레임은 제외.
 *  frames: 게임 길이 (10=풀게임, 3=블리츠 — 마지막 프레임이 보너스 투구 프레임) */
export function frameScores(rolls: number[], frames = 10): number[] {
  const out: number[] = [];
  let total = 0;
  let i = 0;

  for (let f = 0; f < frames; f++) {
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
export function totalScore(rolls: number[], frames = 10): number {
  const s = frameScores(rolls, frames);
  return s.length ? s[s.length - 1] : 0;
}

export interface RollStats {
  strikes: number;
  strikeChances: number;
  spares: number;
  spareChances: number;
}

/** 프레임별 rolls에서 스트라이크/스페어 기회·성공 집계 (하이스코어 통계용, P1).
 *  마지막 프레임은 보너스 투구 규칙대로: X 뒤 새 랙 투구도 스트라이크 기회,
 *  스페어 변환 뒤 3구도 스트라이크 기회로 센다. */
export function rollStats(rolls: number[][], frames = 10): RollStats {
  const st: RollStats = { strikes: 0, strikeChances: 0, spares: 0, spareChances: 0 };

  for (let f = 0; f < Math.min(frames - 1, rolls.length); f++) {
    const fr = rolls[f];
    if (fr[0] === undefined) continue;
    st.strikeChances++;
    if (fr[0] === STRIKE) st.strikes++;
    else if (fr[1] !== undefined) {
      st.spareChances++;
      if (fr[0] + fr[1] === 10) st.spares++;
    }
  }

  const last = rolls[frames - 1];
  if (!last || last[0] === undefined) return st;
  st.strikeChances++;
  if (last[0] === STRIKE) {
    st.strikes++;
    if (last[1] !== undefined) {
      st.strikeChances++;
      if (last[1] === STRIKE) {
        st.strikes++;
        if (last[2] !== undefined) {
          st.strikeChances++; // 더블 뒤 3구도 새 랙 = 스트라이크 기회
          if (last[2] === STRIKE) st.strikes++;
        }
      } else if (last[2] !== undefined) {
        st.spareChances++;
        if (last[1] + last[2] === 10) st.spares++;
      }
    }
  } else if (last[1] !== undefined) {
    st.spareChances++;
    if (last[0] + last[1] === 10) {
      st.spares++;
      if (last[2] !== undefined) {
        st.strikeChances++;
        if (last[2] === STRIKE) st.strikes++;
      }
    }
  }
  return st;
}
