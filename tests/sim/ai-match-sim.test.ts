/**
 * ② AI 난이도 사다리 — 헤드리스 매치 sim (docs/legacy/SPIN_FEEL_AND_AI_LADDER.md §3).
 *
 * 왜 vitest `.ts`인가: `.mjs`(sim-carry)는 `.ts`를 import 못 한다. 이 스크립트는
 * `computeAiThrow`(ai.ts)·`totalScore`(Scoreboard.ts)·물리 상수(constants.ts)를
 * **그대로 import** → 점수식·AI 로직·물리가 게임과 1:1 (sim-carry는 상수 복사라 드리프트 위험,
 * 여기는 import라 0).
 *
 * 제약 처리(콜아웃 ⓐ-ⓒ):
 *  ⓐ Scoreboard/computeAiThrow 순수함수 재사용 (import).
 *  ⓑ GameState 10프레임 흐름은 Three/Rapier/DOM 결합이라 재사용 불가 → playGame()으로 재작성.
 *  ⓒ 스페어 분기 = 투구별 Rapier 핀 시뮬 (throwPhysics가 남은 핀만 세워 실제로 굴림).
 *
 * 실행: `AI_SIM=1 npx vitest run tests/ai-match-sim.test.ts --reporter=verbose` (기본 N=120, `AI_SIM_N`로 조정).
 * 평소 `vitest run`엔 runIf 가드로 안 낀다 (느림).
 */
import { describe, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AI_PROFILES, computeAiThrow, type AiProfile } from '../../src/game/ai';
import { totalScore } from '../../src/game/Scoreboard';
import { createHeadless, PINS, ALL_IDX, ALL_XS } from '../helpers/headless';
import { resetOil } from '../../src/game/oil';

// @types/node 미설치 환경 — env 게이트용 최소 선언 (런타임은 node가 제공)
declare const process: { env: Record<string, string | undefined> };

// 물리는 tests/helpers/headless.ts 한 벌(constants import — 게임과 1:1). 여기는 매치 흐름만.
const H = createHeadless();

/**
 * 한 투구를 Rapier로 굴려 **남아 선 핀 인덱스**를 반환.
 * standing = 이번에 세워둘 핀 인덱스(스페어면 1구 후 남은 핀만). 격자 원위치에 리스팟.
 */
function throwPhysics(aim: number, power: number, spin: number, standing: number[]): number[] {
  return H.throwOnce({ aim, power, spin, standing }).standing;
}

/** 풀랙(10핀) 투구 — computeAiThrow가 fullRack 분기(포켓 노림) */
function fullThrow(profile: AiProfile): number[] {
  const { aim, power, spin } = computeAiThrow(profile, ALL_XS);
  return throwPhysics(aim, power, spin, ALL_IDX);
}
/** 스페어 투구 — 남은 핀 centroid 직구 */
function spareThrow(profile: AiProfile, standing: number[]): number[] {
  const { aim, power, spin } = computeAiThrow(profile, standing.map((i) => PINS[i].x));
  return throwPhysics(aim, power, spin, standing);
}

/** 10프레임 풀게임 → 최종 점수 (Scoreboard.totalScore 재사용) */
function playGame(profile: AiProfile): number {
  const rolls: number[] = [];
  for (let f = 0; f < 9; f++) {
    const a1 = fullThrow(profile);
    const k1 = 10 - a1.length;
    if (k1 === 10) {
      rolls.push(10);
      continue;
    }
    const a2 = spareThrow(profile, a1);
    rolls.push(k1, a1.length - a2.length);
  }
  // 10프레임 — 보너스 규칙
  const a1 = fullThrow(profile);
  const k1 = 10 - a1.length;
  if (k1 === 10) {
    rolls.push(10);
    const a2 = fullThrow(profile); // 새 랙
    const k2 = 10 - a2.length;
    rolls.push(k2);
    if (k2 === 10) rolls.push(10 - fullThrow(profile).length);
    else rolls.push(a2.length - spareThrow(profile, a2).length);
  } else {
    const a2 = spareThrow(profile, a1);
    const k2 = a1.length - a2.length;
    rolls.push(k1, k2);
    if (k1 + k2 === 10) rolls.push(10 - fullThrow(profile).length); // 스페어 → 보너스 새 랙
  }
  return totalScore(rolls);
}

function describeStats(scores: number[]) {
  const n = scores.length;
  const mean = scores.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(scores.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
  const sorted = [...scores].sort((a, b) => a - b);
  return { mean, sd, min: sorted[0], max: sorted[n - 1], p50: sorted[Math.floor(n / 2)] };
}

describe.runIf(process.env.AI_SIM)('② AI 사다리 매치 sim', () => {
  it(
    '프로필별 풀게임 점수 분포 (mean/sd/min/max)',
    { timeout: 600_000 },
    async () => {
      await RAPIER.init();
      if (process.env.AI_SIM_DEBUG) {
        // 훅 포켓 스윕: 발사 오프셋 T(m) = POCKET_X_HOOK + HOOK_DRIFT_FULL. spin=1, power=1.0
        let hl = '[DEBUG] 훅 발사오프셋 T 스윕 (spin=1, pw=1.0): ';
        for (let T = 0.28; T <= 0.46; T += 0.02) {
          const k = 10 - throwPhysics(T / 19.29, 1.0, 1, ALL_IDX).length;
          hl += `${T.toFixed(2)}:${k} `;
        }
        console.log(hl);
        for (const profile of AI_PROFILES) {
          const rolls: number[] = [];
          for (let f = 0; f < 5; f++) {
            const a1 = fullThrow(profile);
            const k1 = 10 - a1.length;
            if (k1 === 10) { rolls.push(10); continue; }
            rolls.push(k1, a1.length - spareThrow(profile, a1).length);
          }
          console.log(`   ${profile.key} 5프레임 샘플 rolls=${JSON.stringify(rolls)}`);
        }
      }
      const N = Number(process.env.AI_SIM_N ?? 120);
      // 오일은 하우스 하나(oil.ts, 2026-09-02). 마름은 매치 흐름(GameState)에서만 도니 여기선 새 오일 고정.
      resetOil();
      console.log(`\n=== AI 매치 sim — 하우스 오일 (N=${N} 게임/프로필) ===`);
      for (const profile of AI_PROFILES) {
        const scores = Array.from({ length: N }, () => playGame(profile));
        const s = describeStats(scores);
        console.log(
          `  ${profile.key.padEnd(7)} aimJ=${String(profile.aimJitterCm).padStart(4)} spareJ=${String(profile.spareAimJitterCm).padStart(4)} spin=${profile.spin}` +
            ` → mean=${s.mean.toFixed(1).padStart(6)}  sd=${s.sd.toFixed(1).padStart(5)}  min=${String(s.min).padStart(3)}  max=${String(s.max).padStart(3)}  p50=${String(s.p50).padStart(3)}`,
        );
      }
    },
  );
});
