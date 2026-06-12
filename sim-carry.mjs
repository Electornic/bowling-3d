// 직구 vs 훅의 포켓 윈도우(스트라이크 진입 폭) 비교 — 핀 10개 풀 시뮬
// P0.5 캐리 튜닝용 CLI 오버라이드: node sim-carry.mjs --pinRest 0.1 --pinFric 0.4 --ballRest 0.1 --pinMass 1.5 --pinComY -0.05
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? parseFloat(argv[i + 1]) : def;
}

const BALL_RADIUS = 0.109;
const PIN_HEIGHT = 0.38;
const PIN_RADIUS = 0.06;
// 기본값 = 게임 코드와 동일 (P0.5 확정: pinRest 0.3, pinDamp 0.8 — constants.ts 참고)
const PIN_MASS = arg('pinMass', 1.5);
const PIN_RESTITUTION = arg('pinRest', 0.3);
const PIN_FRICTION = arg('pinFric', 0.3);
const BALL_RESTITUTION = arg('ballRest', 0.1);
const PIN_COM_Y = arg('pinComY', 0); // 핀 무게중심 y 오프셋 (0=기하 중심, 음수=하향)
const PIN_DAMP = arg('pinDamp', 0.8); // 핀 선형 감쇠 — 날아가는 핀 감속 (체인 스캐터 억제)
const PIN_SPACING = 0.3048;
const HEADPIN_Z = 18.29;
const ROW_GAP = PIN_SPACING * Math.cos(Math.PI / 6);
const PIN_DECK_END = HEADPIN_Z + 3 * ROW_GAP;
const LANE_WIDTH = 1.05;
const OIL_END_Z = 10.5;
const HOOK_RAMP = 3.5;
const LANE_FRICTION_OIL = 0.015;
const LANE_FRICTION_DRY = 0.14;
const BALL_FRICTION = 0.1;
const FRICTION_K = 0.16;
const REF_MASS = 5.0;
const SLIP_EPS = 0.05;
const SPIN_RATE = 14;
const ROLL_RATIO = 0.75;
const dt = 1 / 60;
const ROWS = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];
const UP_COS_45 = Math.cos(Math.PI / 4);

function hookFactor(z) {
  const t = Math.min(1, Math.max(0, (z - OIL_END_Z) / HOOK_RAMP));
  return t * t * (3 - 2 * t);
}

/** 한 번 던지고 (쓰러진 핀 수, 헤드핀 도달 시 진입 x·각도) 반환 */
function throwOnce({ aim, power, spin, massKg = 4.5359, speedScale = 0.928 }) {
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

  const pins = [];
  ROWS.forEach((cols, r) => {
    for (const c of cols) {
      const x = c * PIN_SPACING;
      const z = HEADPIN_Z + r * ROW_GAP;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, PIN_HEIGHT / 2, z)
          .setCcdEnabled(true)
          .setLinearDamping(PIN_DAMP),
      );
      const desc = RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
        .setRestitution(PIN_RESTITUTION)
        .setFriction(PIN_FRICTION)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      if (PIN_COM_Y !== 0) {
        // 무게중심 하향: 실린더 관성 근사값 유지, COM만 내림
        const ix = (PIN_MASS * (3 * PIN_RADIUS ** 2 + PIN_HEIGHT ** 2)) / 12;
        const iy = (PIN_MASS * PIN_RADIUS ** 2) / 2;
        desc.setMassProperties(PIN_MASS, { x: 0, y: PIN_COM_Y, z: 0 }, { x: ix, y: iy, z: ix }, { x: 0, y: 0, z: 0, w: 1 });
      } else {
        desc.setMass(PIN_MASS);
      }
      world.createCollider(desc, body);
      pins.push(body);
    }
  });

  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(0, BALL_RADIUS, -1)
      .setCcdEnabled(true)
      .setLinearDamping(0.05)
      .setAngularDamping(0.1),
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(massKg).setRestitution(BALL_RESTITUTION).setFriction(BALL_FRICTION),
    ball,
  );

  const speed = (5 + power * 7) * speedScale;
  const len = Math.hypot(aim, 1);
  const vx0 = (aim / len) * speed;
  const vz0 = (1 / len) * speed;
  ball.setLinvel({ x: vx0, y: 0, z: vz0 }, true);
  ball.setAngvel(
    { x: (vz0 / BALL_RADIUS) * ROLL_RATIO, y: 0, z: -(vx0 / BALL_RADIUS) * ROLL_RATIO + spin * SPIN_RATE },
    true,
  );

  let entryX = null;
  let entryAngleDeg = null;
  for (let i = 0; i < 60 * 8; i++) {
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
        ball.applyImpulse({ x: -(slipX / m) * f * dt, y: 0, z: -(slipZ / m) * f * dt }, true);
      }
    }
    world.timestep = dt;
    world.step();
    const p = ball.translation();
    if (entryX === null && p.z >= 18.0) {
      const v = ball.linvel();
      entryX = p.x + (v.x / v.z) * (HEADPIN_Z - p.z); // 헤드핀 z로 외삽
      entryAngleDeg = (Math.atan2(Math.abs(v.x), v.z) * 180) / Math.PI;
    }
  }
  // 정착 후 스탠딩 카운트 (PinSet.isStanding 동일 기준)
  let standing = 0;
  for (const p of pins) {
    const q = p.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const t = p.translation();
    if (Math.abs(t.x) <= LANE_WIDTH / 2 && upY > UP_COS_45 && t.y > PIN_HEIGHT * 0.25) standing++;
  }
  return { knocked: 10 - standing, entryX, entryAngleDeg };
}

function sweep(label, mk) {
  const rows = [];
  for (let i = 0; i <= 30; i++) {
    const r = throwOnce(mk(i));
    rows.push(r);
  }
  // 진입 x로 정렬해 스트라이크 윈도우 추출
  rows.sort((a, b) => a.entryX - b.entryX);
  const strikes = rows.filter((r) => r.knocked === 10);
  const nine = rows.filter((r) => r.knocked >= 9);
  const win = (list) =>
    list.length
      ? `${(Math.min(...list.map((r) => r.entryX)) * 100).toFixed(1)}~${(Math.max(...list.map((r) => r.entryX)) * 100).toFixed(1)}cm (${list.length}/31)`
      : '없음 (0/31)';
  const avgAngle = rows.reduce((s, r) => s + r.entryAngleDeg, 0) / rows.length;
  console.log(`\n=== ${label} (평균 진입각 ${avgAngle.toFixed(1)}°) ===`);
  console.log(`  스트라이크 진입 x 윈도우: ${win(strikes)}`);
  console.log(`  9핀+ 윈도우: ${win(nine)}`);
  const dist = {};
  rows.forEach((r) => { dist[r.knocked] = (dist[r.knocked] ?? 0) + 1; });
  console.log(`  핀 분포: ${JSON.stringify(dist)}`);
}

console.log(
  `[params] pinMass=${PIN_MASS} pinRest=${PIN_RESTITUTION} pinFric=${PIN_FRICTION} ballRest=${BALL_RESTITUTION} pinComY=${PIN_COM_Y} pinDamp=${PIN_DAMP}`,
);

// 진입 x가 대략 -16cm ~ +14cm(헤드핀 좌우)를 쓸도록 aim 스캔
// 직구 풀파워: aim 직결. 훅(스핀+1, 미드): 기본 -60.6cm 휨 보상 후 스캔
sweep('직구 풀파워 (스핀 0)', (i) => ({ aim: (-0.16 + i * 0.01) / 19.29 * 1.0, power: 1, spin: 0 }));
sweep('직구 미드파워 (스핀 0)', (i) => ({ aim: (-0.16 + i * 0.01) / 19.29, power: 0.55, spin: 0 }));
sweep('풀스핀 훅 미드파워', (i) => ({ aim: (0.606 - 0.16 + i * 0.01) / 19.29, power: 0.55, spin: 1 }));
sweep('풀스핀 훅 풀파워', (i) => ({ aim: (0.33 - 0.16 + i * 0.01) / 19.29, power: 1, spin: 1 }));
