/**
 * 게임 단위 = 1m. 표준 볼링 규격을 그대로 사용 (도안 §3, §4.4).
 */

// --- 좌표·규격 ---
export const LANE_LENGTH = 18.29; // 파울라인(z=0) → 1번핀
export const LANE_WIDTH = 1.05;
export const BALL_RADIUS = 0.109; // 지름 21.8cm (무게 무관 고정)
export const PIN_HEIGHT = 0.38;
export const PIN_MASS = 1.5;
export const PIN_SPACING = 0.3048; // 핀 중심거리 12인치
export const GUTTER_WIDTH = 0.23;
export const BALL_START_Z = -1; // 공 시작 (파울라인 뒤)

// --- 핀 배치 (정삼각형) ---
export const HEADPIN_Z = 18.29; // 1번핀
export const ROW_GAP = PIN_SPACING * Math.cos(Math.PI / 6); // ≈0.264 행 간격
export const PIN_DECK_END = HEADPIN_Z + 3 * ROW_GAP; // ≈19.08 마지막 행 (전환 트리거 기준 §4.2)
// 행별 핀 열 오프셋 (PIN_SPACING 배수). 행 0=헤드핀 ... 행 3=뒷줄. PinSet·splits 공용.
export const PIN_ROWS: readonly (readonly number[])[] = [
  [0],
  [-0.5, 0.5],
  [-1, 0, 1],
  [-1.5, -0.5, 0.5, 1.5],
];

// --- 핀 캐리 밸런스 (P0.5, sim-carry.mjs 그리드 스캔으로 확정) ---
// 선형 감쇠 0.8: 날아가는 핀을 감속시켜 "운 좋은 체인 스트라이크"를 억제 →
// 직구 풀파워 윈도우 8/31→4/31, 훅 풀파워 7/31 유지 (직구의 1.75배, 최적해 역전).
// 반발 0.2→0.3: 감쇠로 죽은 미드파워 캐리를 핀-핀 에너지 전달로 일부 복원.
export const PIN_RESTITUTION = 0.3;
export const PIN_LINEAR_DAMPING = 0.8;

// --- 물리 (도안 §4.4 튜닝 시작값) ---
export const GRAVITY = -9.81;
export const TIMESTEP = 1 / 60;
export const REF_MASS = 5.0; // 스핀 측면력 기준 질량 (≈11lb = 슬라이더 중앙)
export const FRICTION_K = 0.16; // 스핀 측면력 계수 — 드라이 존에서만 작용 (hookFactor 게이트)

// --- 오일 패턴 → 레이트 훅 (스키드→훅) ---
// 앞 구간은 오일로 미끄러져 직진, OIL_END_Z부터 마찰이 살아나며 훅이 "막판에" 꺾인다.
// ⚠️ 레인 콜라이더는 마찰 결합 Min 필수 (Lane.ts) — 기본 Average면 공 마찰(0.1)과
//    평균돼 오일 존 슬립이 일찍 닫혀 훅의 절반이 오일 존에서 새어나간다.
export const LANE_FRICTION_OIL = 0.015; // 오일 존 (직진 스키드 — 슬립 보존)
export const LANE_FRICTION_DRY = 0.14; // 드라이 존 (Rapier 자체 마찰도 훅에 가세)
export const BALL_FRICTION = 0.1;
export const OIL_END_Z = 10.5; // 오일 존 끝 — 훅 램프 시작
export const HOOK_RAMP = 3.5; // 풀 훅까지 램프 길이 (m)

/** 주입 측면력 게이트: 오일 존 0 → 드라이 존 1 (smoothstep) */
export function hookFactor(z: number): number {
  const t = Math.min(1, Math.max(0, (z - OIL_END_Z) / HOOK_RAMP));
  return t * t * (3 - 2 * t);
}
export const SLIP_EPS = 0.05; // 이하면 롤링으로 간주
export const SPIN_RATE = 14; // 발사 스핀 ωz = spin·SPIN_RATE (rad/s) — 훅 연료. 풀스핀 미드파워 총휨 ~61cm
export const ROLL_RATIO = 0.75; // 발사 시 진행방향 굴림 비율 (1=노슬립, 낮을수록 스키드↑=훅 연료↑)
export const MIN_SPEED = 5;
export const MAX_SPEED = 12;
// 마우스 화면폭 전체 → aim ±AIM_RANGE. 레인은 ±1.6°밖에 안 되므로(0.525/18.3)
// 1.0이면 화면 4%만 벗어나도 거터행 — ±4.6°로 눌러야 조준이 가능하다.
export const AIM_RANGE = 0.08;
export const SETTLE_VEL_EPS = 0.05;
export const SETTLE_TIMEOUT = 4; // s
export const PIN_FALL_ANGLE = Math.PI / 4; // 45° 쓰러짐 임계
