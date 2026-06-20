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
// ⓐ 스핀 레버 CLI (기본값 = constants.ts와 동일 — import 아니라 복사라 드리프트 시 재확인):
//   node sim-carry.mjs --rollRatio 0.6 --slipEps 0.03 --spinRate 14 --frictionK 0.16 --oilEnd 10.5 --hookRamp 3.5
const OIL_END_Z = arg('oilEnd', 10.5);
const HOOK_RAMP = arg('hookRamp', 3.5);
const LANE_FRICTION_OIL = 0.015;
const LANE_FRICTION_DRY = 0.14;
const BALL_FRICTION = 0.1;
const FRICTION_K = arg('frictionK', 0.16);
const REF_MASS = 5.0;
const SLIP_EPS = arg('slipEps', 0.05);
const SPIN_RATE = arg('spinRate', 14);
const ROLL_RATIO = arg('rollRatio', 0.75);
const SPIN_POW = arg('spinPow', 1); // 레버4 ⓐ: 스핀 입력 저역 부스트 (1=선형, 0.5=√곡선 → 약스핀 증폭, 풀스핀 1.0 불변→가드 안전)
const dt = 1 / 60;
const ROWS = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];
const UP_COS_45 = Math.cos(Math.PI / 4);

function hookFactor(z) {
  const t = Math.min(1, Math.max(0, (z - OIL_END_Z) / HOOK_RAMP));
  return t * t * (3 - 2 * t);
}

/** 한 번 던지고 (쓰러진 핀 수, 헤드핀 도달 시 진입 x·각도) 반환 */
function throwOnce({ aim, power, spin, massKg = 4.5359, speedScale = 0.928, pinDamp = PIN_DAMP, pinRest = PIN_RESTITUTION }) {
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
  const pinStart = [];
  ROWS.forEach((cols, r) => {
    for (const c of cols) {
      const x = c * PIN_SPACING;
      const z = HEADPIN_Z + r * ROW_GAP;
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic()
          .setTranslation(x, PIN_HEIGHT / 2, z)
          .setCcdEnabled(true)
          .setLinearDamping(pinDamp),
      );
      const desc = RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
        .setRestitution(pinRest)
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
      pinStart.push({ x, z });
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
    { x: (vz0 / BALL_RADIUS) * ROLL_RATIO, y: 0, z: -(vx0 / BALL_RADIUS) * ROLL_RATIO + Math.sign(spin) * Math.pow(Math.abs(spin), SPIN_POW) * SPIN_RATE },
    true,
  );

  let entryX = null;
  let entryAngleDeg = null;
  let xOilEnd = null; // ⓒ 곡률용 체크포인트: 오일 끝 / z17 / 접촉 직전
  let x17 = null;
  let xContact = null;
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
    if (xOilEnd === null && p.z >= OIL_END_Z) xOilEnd = p.x;
    if (x17 === null && p.z >= 17.0) x17 = p.x;
    if (xContact === null && p.z >= 18.11) xContact = p.x; // PIN_CONTACT_Z≈18.11 — 접촉 직전 (자유 굴림 곡률만)
    if (entryX === null && p.z >= 18.0) {
      const v = ball.linvel();
      entryX = p.x + (v.x / v.z) * (HEADPIN_Z - p.z); // 헤드핀 z로 외삽
      entryAngleDeg = (Math.atan2(Math.abs(v.x), v.z) * 180) / Math.PI;
    }
  }
  // 정착 후 스탠딩 카운트 (PinSet.isStanding 동일 기준) + 흩어짐(시작점→정착점 수평거리, cm)
  let standing = 0;
  let maxScatter = 0;
  let sumScatter = 0;
  for (let pi = 0; pi < pins.length; pi++) {
    const p = pins[pi];
    const q = p.rotation();
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const t = p.translation();
    if (Math.abs(t.x) <= LANE_WIDTH / 2 && upY > UP_COS_45 && t.y > PIN_HEIGHT * 0.25) standing++;
    const dist = Math.hypot(t.x - pinStart[pi].x, t.z - pinStart[pi].z) * 100;
    if (dist > maxScatter) maxScatter = dist;
    sumScatter += dist;
  }
  return { knocked: 10 - standing, entryX, entryAngleDeg, xOilEnd, x17, xContact, maxScatter, meanScatter: sumScatter / pins.length };
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

// ⓑ (파워 × 스핀) 훅 그리드 — aim=0(직진 발사)에서 순수 훅 변위를 본다.
// ⓒ 총휨 = 접촉 직전 x, 막판스냅 = 마지막 ~1m(z17.0→18.11) 횡변위. "밋밋한 평탄 구간" 식별 + 스냅 게이트 베이스라인.
function spinGrid() {
  const powers = [0.4, 0.55, 0.7, 0.85, 1.0];
  const spins = [0.25, 0.5, 0.75, 1.0];
  const grid = spins.map((spin) =>
    powers.map((power) => {
      const r = throwOnce({ aim: 0, power, spin });
      const total = (r.xContact ?? 0) * 100;
      const snap = ((r.xContact ?? 0) - (r.x17 ?? 0)) * 100;
      return { total, snap };
    }),
  );
  const fmt = (n) => n.toFixed(1).padStart(8);
  const head = '  spin\\pow' + powers.map((p) => p.toFixed(2).padStart(8)).join('');
  const table = (label, pick) => {
    console.log(`\n=== ${label} ===`);
    console.log(head);
    grid.forEach((row, si) => {
      console.log('  ' + spins[si].toFixed(2).padStart(7) + row.map((c) => fmt(pick(c))).join(''));
    });
  };
  table('ⓑ 훅 그리드: 총휨 cm (aim=0, 접촉 직전 x — 음수=훅 방향)', (c) => c.total);
  table('ⓒ 훅 그리드: 막판 스냅 cm (z17.0→18.11, |값| 클수록 "확 꺾임")', (c) => c.snap);
}

// ⓓ fly-out 트레이드오프: 핀 선형감쇠를 낮추면 핀이 더 멀리 튕겨나가(시각 역동성↑) 보이지만,
//    5차가 밝혔듯 감쇠는 직구 캐리를 선택적으로 깎는 유일한 레버라 낮추면 직구 윈도우가 부활 →
//    "훅이 최적해" 밸런스가 무너진다. 그 트레이드오프를 숫자로: 감쇠별 (직구풀/훅풀 스트라이크
//    윈도우 = 밸런스) vs (포켓 스트라이크 핀 흩어짐 cm = 역동성)을 한 표로 본다.
function strikeCount(mk, pinDamp, pinRest) {
  let strikes = 0;
  for (let i = 0; i <= 30; i++) {
    if (throwOnce({ ...mk(i), pinDamp, pinRest }).knocked === 10) strikes++;
  }
  return strikes;
}
function bestHit(mk, pinDamp, pinRest) {
  let best = null;
  for (let i = 0; i <= 30; i++) {
    const r = throwOnce({ ...mk(i), pinDamp, pinRest });
    if (!best || r.knocked > best.knocked) best = r;
  }
  return best;
}
function flyoutSweep(pinRest = PIN_RESTITUTION) {
  const straight = (i) => ({ aim: ((-0.16 + i * 0.01) / 19.29) * 1.0, power: 1, spin: 0 });
  const hook = (i) => ({ aim: (0.33 - 0.16 + i * 0.01) / 19.29, power: 1, spin: 1 });
  const damps = [0.8, 0.65, 0.5, 0.35, 0.2];
  console.log(`\n=== ⓓ fly-out 트레이드오프 (pinRest=${pinRest}) — 역동성(흩어짐) vs 밸런스(윈도우) ===`);
  console.log('  damp | 직구풀 | 훅풀  | 훅/직구 | 흩어짐 max/mean cm (훅 풀랙)');
  for (const d of damps) {
    const sStr = strikeCount(straight, d, pinRest);
    const sHook = strikeCount(hook, d, pinRest);
    const hit = bestHit(hook, d, pinRest);
    const ratio = sStr ? (sHook / sStr).toFixed(2) : '∞';
    console.log(
      `  ${d.toFixed(2)} | ${String(sStr).padStart(4)}/31 | ${String(sHook).padStart(2)}/31 | ${ratio.padStart(5)} | ${hit.maxScatter.toFixed(1).padStart(6)} / ${hit.meanScatter.toFixed(1)} (knocked ${hit.knocked})`,
    );
  }
}

// ⓔ 릴리스 타이밍 = aim 실행 노이즈 (P3 / P0.5 레버②). 설계 근거: 실볼링의 직구 천장(~180)은
//    물리가 아니라 *실행 분산*이 만든다 — 노이즈 0인 마우스 입력엔 그게 없어 직구가 250까지 뚫린다.
//    포켓을 노린 채 진입 x에 gaussian σ(cm)를 주입해 σ별 기대 핀/스트라이크율을 잰다. 직구(좁은
//    윈도우)가 훅(넓은 윈도우)보다 빨리 무너지면 "200+는 훅으로만"이 노이즈만으로 성립한다는 증거.
const ENTRY_DIST = HEADPIN_Z - (-1); // ≈19.29 = HEADPIN_Z − BALL_START_Z (ai.ts와 동일: 진입x ≈ aim×ENTRY_DIST)
function gaussNoise() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
// 스타일별 포켓 최적 발사 진입x(m)를 σ=0에서 자동 보정 (스캔 argmax mean-knocked) — 하드코딩 드리프트
// 가정 제거(파워마다 훅 드리프트가 달라 미드훅의 최적 발사가 풀파워와 다름). 결정 시뮬이라 1회 평가로 충분.
function calibrateEntryX(power, spin, centerGuess) {
  let best = null;
  for (let i = -12; i <= 12; i++) {
    const entryX = centerGuess + i * 0.01; // ±12cm, 1cm 스텝
    const knocked = throwOnce({ aim: entryX / ENTRY_DIST, power, spin }).knocked;
    if (!best || knocked > best.knocked) best = { entryX, knocked };
  }
  return best.entryX;
}
function noiseSweep() {
  const N = Math.round(arg('noiseN', 300)); // 스타일·σ당 표본 수
  const sigmas = [0, 2, 3, 4, 5, 6, 8]; // 진입 x 표준편차 (cm) — 실행 분산
  const styles = [
    { label: '직구 풀파워  ', power: 1.0, spin: 0, guess: -0.07 },
    { label: '직구 미드0.7 ', power: 0.7, spin: 0, guess: -0.07 },
    { label: '훅 풀파워    ', power: 1.0, spin: 1, guess: 0.38 },
    { label: '훅 미드0.7   ', power: 0.7, spin: 1, guess: 0.34 },
  ];
  console.log(`\n=== ⓔ 릴리스 타이밍 노이즈 sweep (N=${N}/셀, σ=진입x cm 표준편차) ===`);
  console.log('  (포켓을 노린 채 gaussian aim 노이즈 주입 → 평균 핀 / 스트라이크% / 9핀+%)');
  for (const st of styles) {
    const baseX = calibrateEntryX(st.power, st.spin, st.guess);
    const meanRow = [];
    const strikeRow = [];
    const nineRow = [];
    for (const sigma of sigmas) {
      let sumK = 0;
      let strikes = 0;
      let nines = 0;
      for (let n = 0; n < N; n++) {
        const entryX = baseX + (sigma === 0 ? 0 : gaussNoise() * (sigma / 100)); // m
        const r = throwOnce({ aim: entryX / ENTRY_DIST, power: st.power, spin: st.spin });
        sumK += r.knocked;
        if (r.knocked === 10) strikes++;
        if (r.knocked >= 9) nines++;
      }
      meanRow.push((sumK / N).toFixed(2).padStart(7));
      strikeRow.push(`${Math.round((strikes / N) * 100)}%`.padStart(7));
      nineRow.push(`${Math.round((nines / N) * 100)}%`.padStart(7));
    }
    console.log(`\n  ${st.label} (발사 진입x=${(baseX * 100).toFixed(0)}cm)`);
    console.log('    σ(cm) ' + sigmas.map((s) => String(s).padStart(7)).join(''));
    console.log('    평균핀' + meanRow.join(''));
    console.log('    스트%' + strikeRow.join('') + '   ← 직구가 σ에 빨리 무너지면 OK');
    console.log('    9핀+%' + nineRow.join(''));
  }
}
if (argv.includes('--noise')) {
  noiseSweep();
  process.exit(0);
}

console.log(
  `[params] pinMass=${PIN_MASS} pinRest=${PIN_RESTITUTION} pinFric=${PIN_FRICTION} ballRest=${BALL_RESTITUTION} pinComY=${PIN_COM_Y} pinDamp=${PIN_DAMP}`,
);
console.log(
  `[spin]   spinRate=${SPIN_RATE} rollRatio=${ROLL_RATIO} slipEps=${SLIP_EPS} frictionK=${FRICTION_K} oilEnd=${OIL_END_Z} hookRamp=${HOOK_RAMP}`,
);

// 진입 x가 대략 -16cm ~ +14cm(헤드핀 좌우)를 쓸도록 aim 스캔
// 직구 풀파워: aim 직결. 훅(스핀+1, 미드): 기본 -60.6cm 휨 보상 후 스캔
sweep('직구 풀파워 (스핀 0)', (i) => ({ aim: (-0.16 + i * 0.01) / 19.29 * 1.0, power: 1, spin: 0 }));
sweep('직구 미드파워 (스핀 0)', (i) => ({ aim: (-0.16 + i * 0.01) / 19.29, power: 0.55, spin: 0 }));
sweep('풀스핀 훅 미드파워', (i) => ({ aim: (0.606 - 0.16 + i * 0.01) / 19.29, power: 0.55, spin: 1 }));
sweep('풀스핀 훅 풀파워', (i) => ({ aim: (0.33 - 0.16 + i * 0.01) / 19.29, power: 1, spin: 1 }));

// ⓑⓒ 그리드는 맨 끝 — "밋밋한 구간" 한눈에
spinGrid();

// ⓓ 핀 fly-out 트레이드오프 (감쇠 스윕) — 무거우니 --flyout 플래그일 때만 (기본 실행 재현성/속도 유지)
if (argv.includes('--flyout')) {
  flyoutSweep(0.3);
  flyoutSweep(0.5);
}
