import {
  BALL_RADIUS,
  BALL_START_Z,
  HEADPIN_Z,
  FRICTION_K,
  REF_MASS,
  SLIP_EPS,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
  BALL_FRICTION,
  BALL_LINEAR_DAMPING,
  launchState,
} from './constants';
import { hookFactor } from './oil';

/** 조준선 예측 적분 스텝(s). Rapier의 1/60보다 굵다 — 화면에 그릴 점 수만 필요하고, 정확도는 tests/predict.test.ts가 잰다. */
export const PREVIEW_DT = 0.08;

export interface PredictOpts {
  aim: number;
  power: number;
  spin: number;
  massKg: number;
  speedScale: number;
  /** 적분 종료 z. 이 z를 넘는 첫 스텝에서 멈추고, 마지막 점을 정확히 endZ로 트림한다. */
  endZ: number;
  dt?: number;
  maxSteps?: number;
}

/**
 * 공 경로 예측 — **발사 물리(Ball.launch + Ball.applySpinForce + Lane 마찰)를 폐형으로 근사**한 적분기.
 * Controls의 조준선이 쓰고, tests/predict.test.ts가 같은 입력을 Rapier 헤드리스 투구와 대조한다.
 *
 * 모델(Rapier 쪽과의 대응):
 * - 접촉점 슬립 = (vx + ωz·R, vz − ωx·R). 슬립 > SLIP_EPS면 슬립 반대 방향으로 감속.
 * - 감속 = 주입 측면력(FRICTION_K·REF_MASS·g·hook / m) + Rapier 자체 마찰(min(공, 레인)·g).
 *   Rapier 마찰은 회전도 정렬시키므로(굴림으로 수렴) ωz·R을 같은 방향으로 깎는다 — 계수 2.5는
 *   구의 관성(2/5 mR²)에서 나오는 접촉 마찰의 각가속 비 5/2다(τ = f·R, I = 2/5 mR² → ω̇·R = 5/2·f/m).
 * - 선형 감쇠 BALL_LINEAR_DAMPING — Rapier가 매 스텝 v·(1/(1+damping·dt))로 깎는 것과 같은 식.
 *
 * ⚠️ 여기 상수는 전부 constants.ts import다 — Ball.ts와 값이 갈릴 수 없다. 모델 **모양**이 갈리는지만
 *    (예: Rapier 마찰의 실제 거동) 테스트가 감시한다.
 */
export function predictPath(o: PredictOpts): number[][] {
  const dt = o.dt ?? PREVIEW_DT;
  const maxSteps = o.maxSteps ?? 400;
  const s = launchState(o.aim, o.power, o.spin, o.speedScale);
  let vx = s.vx;
  let vz = s.vz;
  let wzR = s.wz * BALL_RADIUS;
  let wxR = s.wx * BALL_RADIUS;
  const inject = (FRICTION_K * REF_MASS * 9.81) / o.massKg;
  const dampK = 1 / (1 + BALL_LINEAR_DAMPING * dt);

  const path: number[][] = [[0, BALL_START_Z]];
  let x = 0;
  let z = BALL_START_Z;
  for (let i = 0; i < maxSteps && z < o.endZ && z < HEADPIN_Z; i++) {
    const slipX = vx + wzR;
    const slipZ = vz - wxR;
    const mag = Math.hypot(slipX, slipZ);
    const hook = hookFactor(z);
    if (mag > SLIP_EPS) {
      const laneFric = LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hook;
      const rapier = Math.min(BALL_FRICTION, laneFric) * 9.81;
      const a = inject * hook + rapier;
      // 한 스텝에 슬립을 다 잡아먹지 않게 — 굵은 dt에서 부호가 뒤집혀 지그재그가 나는 것 방지
      const da = Math.min(a * dt, mag);
      vx -= (slipX / mag) * da;
      vz -= (slipZ / mag) * da;
      // 마찰 토크: 슬립 방향으로 접촉점 회전 속도가 슬립을 줄이는 쪽으로 (구 5/2 비)
      const dw = Math.min(rapier * 2.5 * dt, mag);
      wzR -= (slipX / mag) * dw;
      wxR += (slipZ / mag) * dw;
    }
    vx *= dampK;
    vz *= dampK;
    x += vx * dt;
    z += vz * dt;
    path.push([x, z]);
  }
  // 마지막 점을 정확히 endZ에 트림 — 적분 스텝 단위로 끝점이 튀는 것 제거
  if (path.length >= 2) {
    const a = path[path.length - 2];
    const b = path[path.length - 1];
    if (b[1] > o.endZ && b[1] !== a[1]) {
      const t = (o.endZ - a[1]) / (b[1] - a[1]);
      b[0] = a[0] + (b[0] - a[0]) * t;
      b[1] = o.endZ;
    }
  }
  return path;
}
