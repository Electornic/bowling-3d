/**
 * ② AI 난이도 사다리 — 헤드리스 매치 sim (SPIN_FEEL_AND_AI_LADDER.md §3).
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
 * 실행: `AI_SIM=1 npx vitest run tests/ai-match-sim.test.ts` (기본 N=120, `AI_SIM_N`로 조정).
 * 평소 `vitest run`엔 runIf 가드로 안 낀다 (느림).
 */
import { describe, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { AI_PROFILES, computeAiThrow, type AiProfile } from '../src/game/ai';
import { totalScore } from '../src/game/Scoreboard';
import {
  PIN_ROWS,
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  LANE_WIDTH,
  PIN_HEIGHT,
  BALL_RADIUS,
  FRICTION_K,
  REF_MASS,
  SLIP_EPS,
  SPIN_RATE,
  ROLL_RATIO,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
  BALL_FRICTION,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  PIN_MASS,
  effectiveSpin,
} from '../src/game/constants';
import { hookFactor, resetOil, type OilPattern } from '../src/game/oil';

// @types/node 미설치 환경 — env 게이트용 최소 선언 (런타임은 node가 제공)
declare const process: { env: Record<string, string | undefined> };

// 핀 격자 (sim-carry와 동일 배치, constants에서 유도 — 하드코딩 없음)
const PIN_RADIUS = 0.06;
const PINS: { x: number; z: number }[] = [];
PIN_ROWS.forEach((cols, r) => {
  for (const c of cols) PINS.push({ x: c * PIN_SPACING, z: HEADPIN_Z + r * ROW_GAP });
});
const ALL_IDX = PINS.map((_, i) => i);
const ALL_XS = PINS.map((p) => p.x);

const PIN_DECK_END = HEADPIN_Z + 3 * ROW_GAP;
const UP_COS_45 = Math.cos(Math.PI / 4);
const DT = 1 / 60;
// 10lb 기준 (ai.ts 캘리브레이션 basis) — sim-carry throwOnce 기본값과 동일
const MASS_KG = 4.5359;
const SPEED_SCALE = 0.928;

/**
 * 한 투구를 Rapier로 굴려 **남아 선 핀 인덱스**를 반환.
 * standing = 이번에 세워둘 핀 인덱스(스페어면 1구 후 남은 핀만). 격자 원위치에 리스팟.
 */
function throwPhysics(aim: number, power: number, spin: number, standing: number[]): number[] {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.maxCcdSubsteps = 4;
  const startZ = -2;
  const endZ = PIN_DECK_END + 1.5;

  const floorBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, (startZ + endZ) / 2),
  );
  const floorCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(LANE_WIDTH / 2, 0.05, (endZ - startZ) / 2)
      .setFriction(LANE_FRICTION_OIL)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0),
    floorBody,
  );

  const bodies: { idx: number; body: RAPIER.RigidBody }[] = [];
  for (const idx of standing) {
    const { x, z } = PINS[idx];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, PIN_HEIGHT / 2, z)
        .setCcdEnabled(true)
        .setLinearDamping(PIN_LINEAR_DAMPING),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
        .setRestitution(PIN_RESTITUTION)
        .setFriction(0.3)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        .setMass(PIN_MASS),
      body,
    );
    bodies.push({ idx, body });
  }

  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BALL_RADIUS, -1)
      .setCcdEnabled(true)
      .setLinearDamping(0.05)
      .setAngularDamping(0.1),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(MASS_KG).setRestitution(0.1).setFriction(BALL_FRICTION),
    ball,
  );

  const speed = (5 + power * 7) * SPEED_SCALE;
  const len = Math.hypot(aim, 1);
  const vx0 = (aim / len) * speed;
  const vz0 = (1 / len) * speed;
  ball.setLinvel({ x: vx0, y: 0, z: vz0 }, true);
  ball.setAngvel(
    {
      x: (vz0 / BALL_RADIUS) * ROLL_RATIO,
      y: 0,
      z: -(vx0 / BALL_RADIUS) * ROLL_RATIO + effectiveSpin(spin) * SPIN_RATE,
    },
    true,
  );

  for (let i = 0; i < 480; i++) {
    // 480스텝(8s) = sim-carry와 동일 — 핀이 완전히 정착해야 스트라이크 과소계상이 없다
    const tr = ball.translation();
    floorCol.setFriction(
      LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hookFactor(tr.z),
    );
    const h = hookFactor(tr.z);
    if (h > 0 && tr.y <= BALL_RADIUS + 0.005) {
      const v = ball.linvel();
      const w = ball.angvel();
      const slipX = v.x + w.z * BALL_RADIUS;
      const slipZ = v.z - w.x * BALL_RADIUS;
      const m = Math.hypot(slipX, slipZ);
      if (m > SLIP_EPS) {
        const f = FRICTION_K * REF_MASS * 9.81 * h;
        ball.applyImpulse({ x: -(slipX / m) * f * DT, y: 0, z: -(slipZ / m) * f * DT }, true);
      }
    }
    world.timestep = DT;
    world.step();
  }

  const still: number[] = [];
  for (const { idx, body } of bodies) {
    const q = body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const t = body.translation();
    if (Math.abs(t.x) <= LANE_WIDTH / 2 && upY > UP_COS_45 && t.y > PIN_HEIGHT * 0.25) still.push(idx);
  }
  return still;
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
          console.log(`   ${profile.name} 5프레임 샘플 rolls=${JSON.stringify(rolls)}`);
        }
      }
      const N = Number(process.env.AI_SIM_N ?? 120);
      // 오일 프리셋별 사다리 (P3 옵션 c 검증) — resetOil로 물리·AI 조준이 함께 프리셋 반영.
      // AI_SIM_OIL로 한정 가능(예: house만). 기본은 3종 전부.
      const patterns = (process.env.AI_SIM_OIL ?? 'house,short,long').split(',') as OilPattern[];
      for (const pattern of patterns) {
        resetOil(pattern);
        console.log(`\n=== AI 매치 sim — 오일 ${pattern} (N=${N} 게임/프로필) ===`);
        for (const profile of AI_PROFILES) {
          const scores = Array.from({ length: N }, () => playGame(profile));
          const s = describeStats(scores);
          console.log(
            `  ${profile.name.padEnd(7)} aimJ=${String(profile.aimJitterCm).padStart(4)} spareJ=${String(profile.spareAimJitterCm).padStart(4)} spin=${profile.spin}` +
              ` → mean=${s.mean.toFixed(1).padStart(6)}  sd=${s.sd.toFixed(1).padStart(5)}  min=${String(s.min).padStart(3)}  max=${String(s.max).padStart(3)}  p50=${String(s.p50).padStart(3)}`,
          );
        }
      }
      resetOil('house'); // 전역 오일 상태 복원
    },
  );
});
