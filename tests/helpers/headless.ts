/**
 * 헤드리스 투구 — Rapier 월드에 레인·(선택) 핀·공을 올리고 한 번 굴린다.
 *
 * ai-match-sim(사다리)·ball-motion-sim(모션 척도)·predict(조준선 대조)가 **이 한 벌**을 쓴다.
 * 물리 상수는 전부 constants.ts **import**라 게임과 갈릴 수 없다(sim-carry.mjs는 .ts를 못 import해서
 * 상수를 복사한다 — 그쪽은 드리프트 주의).
 *
 * 스텝당 처리는 Ball.applySpinForce + Lane.updateFriction과 같다:
 *   레인 마찰 = 오일 + (드라이−오일)·hookFactor(z)  →  접지 중 슬립 > SLIP_EPS면 주입 측면 임펄스  →  world.step
 */
import RAPIER from '@dimforge/rapier3d-compat';
import {
  PIN_ROWS,
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  LANE_WIDTH,
  PIN_HEIGHT,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  PIN_FALL_ANGLE,
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
  LAUNCH_TUNING,
  launchStateWith,
  type LaunchTuning,
} from '../../src/game/constants';
import { hookFactor } from '../../src/game/oil';

export const PIN_RADIUS = 0.06;
export const DT = 1 / 60;
/** 10lb 기준 — ai.ts 캘리브레이션 basis(BallSpec.makeBallSpec(10)과 같은 값) */
export const MASS_10LB = 4.5359;
export const SCALE_10LB = 0.928;
/** 공이 헤드핀에 닿는 z(공 반지름 + 핀 반지름 앞) — 자유 굴림 구간의 끝 */
export const CONTACT_Z = HEADPIN_Z - BALL_RADIUS - PIN_RADIUS;
const UP_COS_FALL = Math.cos(PIN_FALL_ANGLE);

export const PINS: { x: number; z: number }[] = [];
PIN_ROWS.forEach((cols, r) => {
  for (const c of cols) PINS.push({ x: c * PIN_SPACING, z: HEADPIN_Z + r * ROW_GAP });
});
export const ALL_IDX = PINS.map((_, i) => i);
export const ALL_XS = PINS.map((p) => p.x);

export interface ThrowOpts {
  aim: number;
  power: number;
  spin: number;
  massKg?: number;
  speedScale?: number;
  /** 세워둘 핀 인덱스. 생략 = 10개 전부, [] = 핀 없음(순수 볼 모션). */
  standing?: number[];
  /** 총 스텝 수. 핀이 완전히 정착하려면 8s(480)가 필요하다 — 모션만 볼 땐 줄여도 된다. */
  steps?: number;
  /** true면 매 스텝 [x, z]를 path에 남긴다(조준선 대조용). */
  recordPath?: boolean;
  /** 레버 스윕용 상수 덮어쓰기 — 생략하면 constants.ts 그대로(= 게임). 튠 결정 뒤엔 constants에 옮겨 적는다. */
  override?: Partial<Override>;
}

export interface Override extends LaunchTuning {
  linearDamping: number;
  frictionK: number;
  ballFriction: number;
  laneFrictionOil: number;
  laneFrictionDry: number;
  slipEps: number;
}
export const DEFAULTS: Override = {
  ...LAUNCH_TUNING,
  linearDamping: BALL_LINEAR_DAMPING,
  frictionK: FRICTION_K,
  ballFriction: BALL_FRICTION,
  laneFrictionOil: LANE_FRICTION_OIL,
  laneFrictionDry: LANE_FRICTION_DRY,
  slipEps: SLIP_EPS,
};

export interface ThrowResult {
  /** 정착 후 남아 선 핀 인덱스 */
  standing: number[];
  knocked: number;
  // --- 볼 모션 척도 (실볼링 수치와 비교하는 값들) ---
  releaseSpeed: number; // m/s
  /** z=18.0(핀 접촉 직전) 통과 시 속도. null = 거기까지 못 갔다(거터·정지) */
  speedAtPins: number | null;
  timeToPins: number | null; // s (파울라인 z=0 → 18.0)
  /** 접촉점 슬립이 처음 SLIP_EPS 아래로 내려간 z(= 스키드 끝, 순수 롤 시작). null = 핀까지 계속 슬립 */
  slipCloseZ: number | null;
  /** 발사 직선에서 2cm 이상 벗어나기 시작한 z(= 훅 시작). null = 끝까지 직선 */
  breakZ: number | null;
  /** 접촉 직전(CONTACT_Z) 발사 직선 대비 횡 편차(m). 음수 = −x(오른손 훅 방향) */
  hookAtContact: number | null;
  /** z 17.0 → 접촉 직전 사이의 횡 변위(m) — "막판 스냅" */
  snap: number | null;
  /** 헤드핀 z로 외삽한 진입 x(m)와 진입각(°) — sim-carry와 같은 정의 */
  entryX: number | null;
  entryAngleDeg: number | null;
  path?: number[][];
}

export interface HeadlessWorld {
  throwOnce(o: ThrowOpts): ThrowResult;
}

/** RAPIER.init() 뒤에 호출. 월드는 투구마다 새로 만든다(결정성·상태 누수 0). */
export function createHeadless(): HeadlessWorld {
  return { throwOnce };
}

function throwOnce(o: ThrowOpts): ThrowResult {
  const massKg = o.massKg ?? MASS_10LB;
  const speedScale = o.speedScale ?? SCALE_10LB;
  const standingIn = o.standing ?? ALL_IDX;
  const steps = o.steps ?? 480;
  const K: Override = { ...DEFAULTS, ...o.override };

  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.integrationParameters.maxCcdSubsteps = 4;
  const startZ = BALL_START_Z - 1;
  const endZ = PIN_DECK_END + 1.5;

  const floorBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, (startZ + endZ) / 2));
  const floorCol = world.createCollider(
    RAPIER.ColliderDesc.cuboid(LANE_WIDTH / 2, 0.05, (endZ - startZ) / 2)
      .setFriction(K.laneFrictionOil)
      .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
      .setRestitution(0),
    floorBody,
  );

  const bodies: { idx: number; body: RAPIER.RigidBody }[] = [];
  for (const idx of standingIn) {
    const { x, z } = PINS[idx];
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, PIN_HEIGHT / 2, z).setCcdEnabled(true).setLinearDamping(PIN_LINEAR_DAMPING),
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
      .setTranslation(0, BALL_RADIUS, BALL_START_Z)
      .setCcdEnabled(true)
      .setLinearDamping(K.linearDamping)
      .setAngularDamping(BALL_ANGULAR_DAMPING),
  );
  world.createCollider(RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(massKg).setRestitution(0.1).setFriction(K.ballFriction), ball);

  const s = launchStateWith(o.aim, o.power, o.spin, speedScale, K);
  ball.setLinvel({ x: s.vx, y: 0, z: s.vz }, true);
  ball.setAngvel({ x: s.wx, y: 0, z: s.wz }, true);
  const releaseSpeed = Math.hypot(s.vx, s.vz);
  const dirX = s.vx / releaseSpeed; // 발사 직선 x(z) = (dirX/dirZ)·(z − z0)
  const dirZ = s.vz / releaseSpeed;
  const lineX = (z: number) => ((z - BALL_START_Z) * dirX) / dirZ;

  const r: ThrowResult = {
    standing: [],
    knocked: 0,
    releaseSpeed,
    speedAtPins: null,
    timeToPins: null,
    slipCloseZ: null,
    breakZ: null,
    hookAtContact: null,
    snap: null,
    entryX: null,
    entryAngleDeg: null,
  };
  const path: number[][] | undefined = o.recordPath ? [[0, BALL_START_Z]] : undefined;
  let x17: number | null = null;
  let tCrossFoul: number | null = null;

  for (let i = 0; i < steps; i++) {
    const tr = ball.translation();
    const grounded = tr.y <= BALL_RADIUS + 0.005;
    floorCol.setFriction(K.laneFrictionOil + (K.laneFrictionDry - K.laneFrictionOil) * hookFactor(tr.z));
    const h = hookFactor(tr.z);
    const v = ball.linvel();
    const w = ball.angvel();
    const slipX = v.x + w.z * BALL_RADIUS;
    const slipZ = v.z - w.x * BALL_RADIUS;
    const m = Math.hypot(slipX, slipZ);
    if (r.slipCloseZ === null && grounded && m <= K.slipEps && tr.z < CONTACT_Z) r.slipCloseZ = tr.z;
    if (h > 0 && grounded && m > K.slipEps) {
      const f = K.frictionK * REF_MASS * 9.81 * h;
      ball.applyImpulse({ x: -(slipX / m) * f * DT, y: 0, z: -(slipZ / m) * f * DT }, true);
    }
    world.timestep = DT;
    world.step();

    const p = ball.translation();
    const t = (i + 1) * DT;
    if (path) path.push([p.x, p.z]);
    if (tCrossFoul === null && p.z >= 0) tCrossFoul = t;
    if (r.breakZ === null && p.z < CONTACT_Z && Math.abs(p.x - lineX(p.z)) >= 0.02) r.breakZ = p.z;
    if (x17 === null && p.z >= 17.0) x17 = p.x;
    if (r.hookAtContact === null && p.z >= CONTACT_Z) {
      r.hookAtContact = p.x - lineX(p.z);
      r.snap = x17 === null ? null : p.x - x17;
    }
    if (r.entryX === null && p.z >= 18.0) {
      const lv = ball.linvel();
      r.speedAtPins = Math.hypot(lv.x, lv.z);
      r.timeToPins = tCrossFoul === null ? null : t - tCrossFoul;
      r.entryX = p.x + (lv.x / lv.z) * (HEADPIN_Z - p.z);
      r.entryAngleDeg = (Math.atan2(Math.abs(lv.x), lv.z) * 180) / Math.PI;
    }
  }

  for (const { idx, body } of bodies) {
    const q = body.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const t = body.translation();
    if (Math.abs(t.x) <= LANE_WIDTH / 2 && upY > UP_COS_FALL && t.y > PIN_HEIGHT * 0.25) r.standing.push(idx);
  }
  r.knocked = standingIn.length - r.standing.length;
  if (path) r.path = path;
  world.free();
  return r;
}
