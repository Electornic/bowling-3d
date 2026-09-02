/**
 * 실제 레인 지오메트리를 그대로 세운 Rapier 월드 — 거터·캐핑 보드·킥백·피트까지.
 *
 * [headless.ts](./headless.ts)와 왜 따로 두는가: 그쪽은 **레인 폭짜리 평판 하나**만 깔아
 * "공이 어떻게 구르는가"(속도·스키드·훅·진입각)를 재는 모션 리그다. 옆으로 벗어난 공이
 * 어디에 부딪혀 어디로 가는지는 일부러 모델링하지 않는다. 거터볼의 **행선지**를 물으려면
 * [Lane.ts](../../src/scene/Lane.ts)가 만드는 옆 지오메트리가 전부 있어야 한다:
 *
 *   레인 바닥  x ∈ ±[0, 0.525]      윗면 y=0
 *   거터 홈    x ∈ ±[0.525, 0.755]  윗면 y=−GUTTER_DEPTH(−0.0476), 마찰 0.08
 *   캐핑 보드  x ∈ ±[0.755, 0.855]  윗면 y=0 — 거터 바깥 벽
 *   킥백       x ∈ ±[0.755, 0.805]  y 0..PIN_BAY_TOP(0.6) — **핀덱 옆에만** 있는 높은 벽
 *   피트       핀덱 뒤 z, 바닥 y=−0.85
 *
 * 킥백이 관건이다 — 거터 바깥 벽이 핀덱 근처에서만 4.76cm에서 60cm로 솟는다. 거기 맞은
 * 거터볼이 레인 쪽으로 되튈 수 있는지가 여기서 재려는 것이다.
 *
 * 스텝당 처리(마찰 전환 + 슬립 임펄스)는 headless.ts와 같다 — 즉 게임의 Ball·Lane과 같다.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  LANE_WIDTH,
  LANE_START_Z,
  GUTTER_WIDTH,
  GUTTER_DEPTH,
  KICKBACK_START_Z,
  PIN_BAY_TOP,
  PIN_ROWS,
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  PIN_HEIGHT,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  PIN_FALL_ANGLE,
  PIN_COLLISION_GROUPS,
  BALL_GROUPS_ALL,
  BALL_GROUPS_NO_PINS,
  BALL_RADIUS,
  BALL_START_Z,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  BALL_ANGULAR_DAMPING,
  FRICTION_K,
  REF_MASS,
  SLIP_EPS,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
  PIN_DECK_END,
  launchStateWith,
  LAUNCH_TUNING,
} from '../../src/game/constants';
import { hookFactor } from '../../src/game/oil';
import { PIN_RADIUS } from '../../src/scene/Pin';
import { DT, MASS_10LB, SCALE_10LB } from './headless';

const UP_COS_FALL = Math.cos(PIN_FALL_ANGLE);
/** GameState.update의 ROLLING 분기가 SETTLING으로 넘기는 문턱 */
export const SETTLING_X = LANE_WIDTH / 2 - BALL_RADIUS;
/** GameState.update의 거터 래치(setPinCollision(false)) 문턱 */
export const LATCH_X = LANE_WIDTH / 2;

export interface GutterThrow {
  aim: number;
  power: number;
  spin: number;
  /**
   * 거터 래치를 어디에 두는가. 기본 `'every-step'`이 **현재 출하 동작**(`GameState.latchLaneExit`).
   * `'rolling-branch'`는 2026-09-02 이전 배치 — 회귀를 재현해 보여주는 용도다.
   */
  latchPlacement?: 'every-step' | 'rolling-branch';
  steps?: number;
}

export interface GutterResult {
  /** 공이 레인 폭을 벗어났는가 (|x| > LANE_WIDTH/2) */
  leftLane: boolean;
  /** 실제로 래치가 걸렸는가 (핀 충돌이 꺼졌는가) */
  latchFires: boolean;
  /** 옛 배치(ROLLING 분기 안)였다면 걸렸을까 — SETTLING 전환 전에 |x| > 0.525를 넘었는가 */
  latchWouldFireInRollingBranch: boolean;
  /** 레인을 벗어난 **뒤** 다시 레인 폭 안으로 돌아왔는가 */
  returnedToLane: boolean;
  /** 레인을 벗어난 뒤 되돌아온 최소 |x| (돌아온 적 없으면 null) */
  minXAfterExit: number | null;
  /**
   * **레인 구간(z ≤ 핀덱 끝)에서** 도달한 최대 |x| — 문턱만 스쳤는지, 거터 홈까지 들어갔는지 가른다.
   * 피트 낙하 뒤 값은 제외한다(거기서 x가 얼마든 핀폴과 무관하고 계측만 오염시킨다).
   */
  maxAbsX: number;
  /** 최대 |x|에 있었을 때의 공 중심 y — 거터 홈에 앉으면 −GUTTER_DEPTH+BALL_RADIUS(0.061) 부근 */
  yAtMaxX: number;
  /** 처음 레인 폭을 벗어난 z (안 벗어났으면 null) */
  exitZ: number | null;
  /** minXAfterExit를 찍은 z — 어디서 레인으로 돌아왔는지 (킥백 구간이면 벽 반동) */
  zAtMinX: number | null;
  /** 핀덱 앞(z < KICKBACK_START_Z)에서 이미 레인으로 복귀했는가 */
  returnedBeforeKickback: boolean;
  /** 공 중심이 거터 홈 안(|x| ≥ 레인끝 + 반지름의 절반)까지 들어간 적이 있는가 = '진짜 거터볼' */
  fellIntoGutter: boolean;
  /** 정착 후 쓰러진 핀 수 */
  knocked: number;
  /** 레인을 벗어난 뒤 쓰러진 핀 수 = 규칙상 무효여야 하는 핀폴 */
  knockedAfterExit: number;
  /** 훅 임펄스가 **레인 밖에 있는 공**에 걸린 스텝 수 — 0이어야 정상(상태머신이 이미 막는다) */
  hookStepsOffLane: number;
}

/**
 * 거터볼 한 개를 굴려 행선지를 본다.
 *
 * `latchFixed`는 제안 수정(래치를 ROLLING 분기에 가두지 않는다)을 흉내낸다 — 레인을 벗어난
 * 그 스텝에 곧장 핀 충돌을 끈다. 끄고/켜고 같은 시드로 돌려 차이를 재는 게 이 함수의 용도다.
 */
export function throwGutter(o: GutterThrow): GutterResult {
  const steps = o.steps ?? 600;
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.maxCcdSubsteps = 4;

  // --- Lane.ts와 같은 지오메트리 ---
  const startZ = LANE_START_Z;
  const deckEnd = PIN_DECK_END + 0.4;
  const len = deckEnd - startZ;
  const midZ = (startZ + deckEnd) / 2;
  const half = LANE_WIDTH / 2;
  const gw = GUTTER_WIDTH;
  const CAP_W = 0.1;
  const CAP_H = 0.1;
  const KICK_T = 0.05;
  const kickLen = deckEnd - KICKBACK_START_Z;
  const kickMidZ = (KICKBACK_START_Z + deckEnd) / 2;

  const fixedAt = (x: number, y: number, z: number) =>
    world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));

  const floorCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.05, len / 2)
      .setFriction(LANE_FRICTION_OIL)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0),
    fixedAt(0, -0.05, midZ),
  );

  for (const side of [-1, 1]) {
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(gw / 2, 0.05, len / 2).setFriction(0.08),
      fixedAt(side * (half + gw / 2), -GUTTER_DEPTH - 0.05, midZ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(CAP_W / 2, CAP_H / 2, len / 2).setFriction(0.08),
      fixedAt(side * (half + gw + CAP_W / 2), -CAP_H / 2, midZ),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(KICK_T / 2, PIN_BAY_TOP / 2, kickLen / 2),
      fixedAt(side * (half + gw + KICK_T / 2), PIN_BAY_TOP / 2, kickMidZ),
    );
  }

  // 피트 (핀덱 뒤) — 공이 여기로 빠져야 정착한다
  const PIT_DEPTH = 0.85;
  const PIT_LEN = 1.4;
  const pitHalfW = half + gw + 0.1;
  const pitMid = deckEnd + PIT_LEN / 2;
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(pitHalfW, 0.05, PIT_LEN / 2)
      .setFriction(0.75)
      .setRestitution(0)
      .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
    fixedAt(0, -PIT_DEPTH - 0.05, pitMid),
  );
  // 피트 뒷벽 + 양옆 벽 — 없으면 공이 월드 밖으로 자유낙하해 계측이 통째로 오염된다(실측 y −200m).
  const wallTop = 0.35;
  const wallH = wallTop + PIT_DEPTH;
  const wallCY = -PIT_DEPTH + wallH / 2;
  const frictionless = (d: RAPIER.ColliderDesc) =>
    d.setFriction(0).setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0).setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min);
  world.createCollider(
    frictionless(RAPIER.ColliderDesc.cuboid(pitHalfW, wallH / 2, 0.05)),
    fixedAt(0, wallCY, deckEnd + PIT_LEN),
  );
  for (const side of [-1, 1]) {
    world.createCollider(
      frictionless(RAPIER.ColliderDesc.cuboid(0.05, wallH / 2, PIT_LEN / 2)),
      fixedAt(side * pitHalfW, wallCY, pitMid),
    );
  }

  // --- 핀 10개 (Pin.ts와 같은 콜라이더·충돌 그룹) ---
  const pins: RAPIER.RigidBody[] = [];
  PIN_ROWS.forEach((cols, r) => {
    for (const c of cols) {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(c * PIN_SPACING, PIN_HEIGHT / 2, HEADPIN_Z + r * ROW_GAP)
          .setCcdEnabled(true)
          .setLinearDamping(PIN_LINEAR_DAMPING),
      );
      world.createCollider(
        RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
          .setMass(PIN_MASS)
          .setRestitution(PIN_RESTITUTION)
          .setFriction(0.3)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setCollisionGroups(PIN_COLLISION_GROUPS),
        body,
      );
      pins.push(body);
    }
  });
  const standingNow = () =>
    pins.filter((b) => {
      const q = b.rotation();
      const t = b.translation();
      return 1 - 2 * (q.x * q.x + q.z * q.z) > UP_COS_FALL && t.y > PIN_HEIGHT * 0.25 && Math.abs(t.x) <= half;
    }).length;

  // --- 공 (Ball.ts와 같은 콜라이더) ---
  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BALL_RADIUS, BALL_START_Z)
      .setCcdEnabled(true)
      .setLinearDamping(BALL_LINEAR_DAMPING)
      .setAngularDamping(BALL_ANGULAR_DAMPING),
  );
  const ballCol = world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS)
      .setMass(MASS_10LB)
      .setRestitution(0.1)
      .setFriction(BALL_FRICTION)
      .setCollisionGroups(BALL_GROUPS_ALL),
    ball,
  );

  const s = launchStateWith(o.aim, o.power, o.spin, SCALE_10LB, LAUNCH_TUNING);
  ball.setLinvel({ x: s.vx, y: 0, z: s.vz }, true);
  ball.setAngvel({ x: s.wx, y: 0, z: s.wz }, true);

  const r: GutterResult = {
    leftLane: false,
    latchFires: false,
    latchWouldFireInRollingBranch: false,
    returnedToLane: false,
    minXAfterExit: null,
    maxAbsX: 0,
    yAtMaxX: 0,
    exitZ: null,
    zAtMinX: null,
    returnedBeforeKickback: false,
    fellIntoGutter: false,
    knocked: 0,
    knockedAfterExit: 0,
    hookStepsOffLane: 0,
  };
  let settlingAt: number | null = null; // GameState가 SETTLING으로 넘긴 스텝
  let standingAtExit: number | null = null;

  for (let i = 0; i < steps; i++) {
    const t = ball.translation();
    const ax = Math.abs(t.x);

    // GameState.update ROLLING 분기 재현 (순서까지 같게)
    if (settlingAt === null) {
      if (ax > LATCH_X) r.latchWouldFireInRollingBranch = true;
      if (ax > SETTLING_X || t.z > PIN_DECK_END || t.y < -2) settlingAt = i;
    }
    // 래치 적용 — 'every-step'은 상태와 무관(현재 출하), 'rolling-branch'는 ROLLING인 동안만(옛 배치)
    // 'every-step'에도 z 가드가 있다(GameState.latchLaneExit) — 피트에선 새로 잠그지 않는다
    const latchable = o.latchPlacement === 'rolling-branch' ? settlingAt === i : t.z <= PIN_DECK_END;
    if (!r.latchFires && ax > LATCH_X && latchable) {
      r.latchFires = true;
      ballCol.setCollisionGroups(BALL_GROUPS_NO_PINS);
    }
    const onLane = t.z <= PIN_DECK_END && t.y > -0.5; // 피트 진입 전 = 핀폴에 영향을 줄 수 있는 구간
    if (onLane && ax > r.maxAbsX) { r.maxAbsX = ax; r.yAtMaxX = t.y; }
    // 공 중심이 레인 끝에서 반지름의 절반을 더 넘어가면 지지면이 없어 거터 홈으로 떨어진다
    if (onLane && ax >= LATCH_X + BALL_RADIUS / 2) r.fellIntoGutter = true;
    if (!r.leftLane && onLane && ax > LATCH_X) {
      r.leftLane = true;
      r.exitZ = t.z;
      standingAtExit = standingNow();
    }
    if (r.leftLane && onLane && ax <= LATCH_X) {
      r.returnedToLane = true;
      if (r.minXAfterExit === null || ax < r.minXAfterExit) { r.minXAfterExit = ax; r.zAtMinX = t.z; }
      if (t.z < KICKBACK_START_Z) r.returnedBeforeKickback = true;
    }

    // 마찰 전환은 매 스텝(Lane.updateFriction), 훅 임펄스는 **ROLLING일 때만**(Ball.applySpinForce).
    // ⚠️ 이 게이트가 게임과 갈리면 안 된다 — GameState.update가 applySpinForce를 ROLLING 분기
    // 안에서만 부르므로, SETTLING으로 넘어간 뒤(= |x|>0.416를 넘은 뒤)엔 측면력이 끊긴다.
    // headless.ts는 상태머신이 없어 매 스텝 먹이는데, 그대로 베끼면 훅을 과대평가한다.
    floorCol.setFriction(LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hookFactor(t.z));
    const rolling = settlingAt === null;
    const h = rolling ? hookFactor(t.z) : 0;
    const grounded = t.y <= BALL_RADIUS + 0.005;
    const v = ball.linvel();
    const w = ball.angvel();
    const slipX = v.x + w.z * BALL_RADIUS;
    const slipZ = v.z - w.x * BALL_RADIUS;
    const m = Math.hypot(slipX, slipZ);
    if (h > 0 && grounded && m > SLIP_EPS) {
      if (ax > LATCH_X) r.hookStepsOffLane++;
      const f = FRICTION_K * REF_MASS * 9.81 * h;
      ball.applyImpulse({ x: -(slipX / m) * f * DT, y: 0, z: -(slipZ / m) * f * DT }, true);
    }
    world.timestep = DT;
    world.step();
  }

  const standingEnd = standingNow();
  r.knocked = 10 - standingEnd;
  r.knockedAfterExit = standingAtExit === null ? 0 : Math.max(0, standingAtExit - standingEnd);
  world.free();
  return r;
}
