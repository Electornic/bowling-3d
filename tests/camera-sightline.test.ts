import { describe, it, expect } from 'vitest';
import {
  PIN_BAY_TOP,
  PIN_BAY_FRONT_Z,
  PIN_HEIGHT,
  HEADPIN_Z,
  PIN_ROWS,
  PIN_SPACING,
  ROW_GAP,
  BALL_RADIUS,
  CAM_APPROACH_Z,
  PIN_DECK_END,
} from '../src/game/constants';
import { APPROACH_POS, APPROACH_TARGET, GAMEOVER_POS, approachZFor } from '../src/camera/CameraRig';
import {
  REPLAY_CAM_Y,
  REPLAY_LOOK_Y_OFF,
  REPLAY_TRAIL_NEAR,
  REPLAY_TRAIL_FAR,
} from '../src/scene/Replay';

/** 리플레이가 헤드핀에서 파킹하는 포즈 (Replay.placeCamera와 같은 식, 공은 레인 위 y=BALL_RADIUS) */
const REPLAY_PARKED = {
  y: REPLAY_CAM_Y,
  z: HEADPIN_Z - REPLAY_TRAIL_NEAR,
} as const;

/**
 * 핀 베이 개구부는 카메라를 제약한다.
 *
 * 베이를 만들면서 핀덱 위가 마스킹 유닛(캐노피)으로 덮였다. 그 아랫단 앞모서리가
 * (y = PIN_BAY_TOP, z = PIN_BAY_FRONT_Z)이고, 카메라에서 핀 꼭대기로 가는 시선이
 * 이 모서리보다 위를 지나면 **핀이 캐노피 뒤로 잘린다.**
 *
 * 실제로 그랬다 — 개구부를 1.0→0.6으로 낮췄을 때 접근 카메라(y 1.25, z 15.8)의
 * 뒷줄 핀이 12cm 잘렸고, 게임오버 카메라(y 3.2, z 12.5)는 33cm 잘렸다.
 * 개구부 높이와 카메라 포즈는 서로를 모른 채 각각 정해지므로, 둘 중 하나만 건드려도
 * 조용히 깨진다. 이 테스트가 그 커플링을 붙잡아 둔다.
 */

/** 핀 10개의 (x, z) — PinSet과 같은 정삼각 배치 */
const PINS = PIN_ROWS.flatMap((cols, row) =>
  cols.map((c) => ({ x: c * PIN_SPACING, z: HEADPIN_Z + row * ROW_GAP })),
);

/**
 * 카메라 (0, cy, cz)에서 높이 topY인 핀 꼭대기를 볼 때, 캐노피 앞모서리 평면(z=PIN_BAY_FRONT_Z)에서
 * 시선의 높이가 개구부 상단보다 얼마나 **아래**인가. 양수 = 안 가려짐(여유), 음수 = 잘림.
 */
function clearance(cy: number, cz: number, topY: number): number {
  let worst = Infinity;
  for (const p of PINS) {
    const f = (PIN_BAY_FRONT_Z - cz) / (p.z - cz);
    worst = Math.min(worst, PIN_BAY_TOP - (cy + (topY - cy) * f));
  }
  return worst;
}

const FOV = 40; // Engine의 세로 fov (종횡비와 무관하게 고정)

/**
 * 팔로우 파킹 포즈 — 높이는 APPROACH_POS.y(= 체이스 높이 FOLLOW_Y), z는 **종횡비에서 유도된다**.
 * 체이스 거리가 HEADPIN_Z − 이 z이므로, 이 포즈가 곧 임팩트 순간의 카메라다.
 * 좁은 화면일수록 뒤로 물러나 여유가 늘어나지만, 여기 고정해 방향이 뒤집히면 잡히게 한다.
 */
const parked = (aspect: number): [number, number] => [APPROACH_POS.y, approachZFor(FOV, aspect)];

const POSES: Array<[string, number, number]> = [
  ['AIMING', 0.75, -2.7],
  ['MENU', 1.7, -3.4],
  ['파킹(와이드 16:9)', ...parked(16 / 9)],
  ['파킹(데스크톱)', ...parked(0.998)],
  ['파킹(세로폰)', ...parked(0.462)],
  ['GAME_OVER', GAMEOVER_POS.y, GAMEOVER_POS.z],
  ['리플레이 파킹', REPLAY_PARKED.y, REPLAY_PARKED.z],
];

describe('핀 베이가 카메라 시선을 가리지 않는다', () => {
  it.each(POSES)('%s — 서 있는 핀 10개가 캐노피에 안 잘린다', (_name, cy, cz) => {
    expect(clearance(cy, cz, PIN_HEIGHT)).toBeGreaterThan(0.02);
  });

  // 날아오르는 핀도 대체로 보여야 한다. 베이 구간 실측 핀 꼭대기 최대는 0.518
  // (24구·82,278 핀프레임, 0.55 초과 0건) — 파킹 카메라는 그 높이까지 담아야 크래시가 보인다.
  // 높이가 0.60 → 0.45로 내려가며 여유가 0.035 → 0.106으로 3배가 됐다(리니어 체이스 정식화).
  it('파킹 카메라는 튀어오르는 핀(0.518)까지 담는다', () => {
    expect(clearance(APPROACH_POS.y, APPROACH_POS.z, 0.518)).toBeGreaterThan(0.1);
  });

  // 리플레이는 **크래시를 보여주는 게 목적인 연출**이라 튀어오르는 핀이 잘리면 안 된다.
  // 예전 포즈(+0.55 → y 0.659)는 여유 −0.001로 정확히 잘리고 있었고, 이 테스트가 없어 안 잡혔다.
  it('리플레이 파킹 카메라는 튀어오르는 핀(0.518)까지 담는다', () => {
    expect(clearance(REPLAY_PARKED.y, REPLAY_PARKED.z, 0.518)).toBeGreaterThan(0.02);
  });

  // 회귀 방향 고정: 개구부를 더 낮추면 반드시 이 테스트가 먼저 깨져야 한다.
  it('개구부를 낮추면 파킹 카메라가 깨진다 (커플링 확인)', () => {
    const f = (PIN_BAY_FRONT_Z - APPROACH_POS.z) / (HEADPIN_Z + 3 * ROW_GAP - APPROACH_POS.z);
    const sightY = APPROACH_POS.y + (PIN_HEIGHT - APPROACH_POS.y) * f;
    expect(PIN_BAY_TOP).toBeGreaterThan(sightY); // 지금은 통과, 개구부가 sightY 밑으로 내려가면 실패
  });
});

/**
 * 전광판은 카메라를 **위쪽으로도** 제약한다.
 *
 * 마스킹 유닛 앞면이 곧 화면이라 전광판 아랫단 y는 개구부 상단(PIN_BAY_TOP)과 **같다**
 * (Environment: scrBottom = PIN_BAY_TOP, z = 캐노피 앞면 − 0.03). 그래서 개구부 위를 보는
 * 카메라는 필연적으로 전광판을 본다 — 문제는 "보이냐"가 아니라 **얼마나 보이냐**다.
 *
 * 기준은 라이브 파킹 카메라다. 리플레이가 그보다 많이 보여주면 '카메라가 떠 있다'는 인상이 된다.
 * 실제로 그랬다: 시선 오프셋 0.20 시절 추적 구간이 34~38%(당시 라이브 27.8%)였다.
 * ⚠️ 2026-09-01 라이브가 12.4%로 내려앉아 그 부등호가 뒤집혔다 — 아래 개별 테스트 주석 참고.
 */
const SCREEN_BOTTOM_Y = PIN_BAY_TOP;
const SCREEN_Z = PIN_BAY_FRONT_Z - 0.03;
const HALF_FOV = (FOV / 2) * (Math.PI / 180); // 위 FOV (세로축이라 종횡비와 무관하게 고정)

/** 전광판 아랫단부터 프레임 위끝까지가 화면 높이의 몇 %인가 (x=0 중앙열 기준, 0 = 안 보임). */
function screenBandPct(cy: number, cz: number, ly: number, lz: number): number {
  const pitch = Math.atan2(ly - cy, lz - cz);
  const toBottom = Math.atan2(SCREEN_BOTTOM_Y - cy, SCREEN_Z - cz) - pitch; // 광축 기준 각
  const ndcY = Math.tan(toBottom) / Math.tan(HALF_FOV);
  return ndcY >= 1 ? 0 : ((1 - ndcY) / 2) * 100;
}

/** 리플레이 카메라 포즈 (Replay.placeCamera와 같은 식 — 공은 레인 위, py는 그 높이로 클램프) */
function replayPose(ballZ: number) {
  const u = Math.max(0, Math.min(1, (ballZ - CAM_APPROACH_Z) / (HEADPIN_Z - CAM_APPROACH_Z)));
  const e = u * u * (3 - 2 * u);
  const trail = REPLAY_TRAIL_FAR + (REPLAY_TRAIL_NEAR - REPLAY_TRAIL_FAR) * e;
  return {
    cy: REPLAY_CAM_Y,
    cz: Math.min(ballZ, HEADPIN_Z) - trail,
    ly: BALL_RADIUS + REPLAY_LOOK_Y_OFF,
    lz: Math.min(ballZ + 1.2, PIN_DECK_END + 0.4),
  };
}

describe('전광판이 프레임을 잡아먹지 않는다', () => {
  const live = screenBandPct(APPROACH_POS.y, APPROACH_POS.z, APPROACH_TARGET.y, APPROACH_TARGET.z);

  // 27.8% → 12.4%. 리니어 체이스 정식화로 카메라가 0.60 → 0.45로 내려앉은 결과다
  // (낮을수록 시선이 덜 들려 전광판이 덜 들어온다).
  it('라이브 파킹 카메라의 전광판 점유율이 기준선이다 (약 12%)', () => {
    expect(live).toBeGreaterThan(8);
    expect(live).toBeLessThan(18);
  });

  // ⚠️ **이 단정은 한 번 약해졌다가 복구됐다.** 2026-09-01 라이브가 0.45로 내려앉으며 부호가
  // 뒤집혀(라이브 12.45% < 리플레이 18.21%) '차이가 8%p 아래'로 완화됐고, 프레이밍 재측정은
  // 미결로 남았다. 2026-09-02에 리플레이 카메라 높이를 라이브와 맞추고 시선을 함께 내려
  // **4.98%**가 되면서 원래 의도("리플레이가 라이브보다 덜 보여준다")로 되돌렸다.
  // 높이만 낮추면 안 되는 이유는 Replay.REPLAY_LOOK_Y_OFF 주석에 실측표로 남겼다.
  it('리플레이 파킹이 라이브보다 전광판을 덜 보여준다', () => {
    const p = replayPose(HEADPIN_Z);
    expect(screenBandPct(p.cy, p.cz, p.ly, p.lz)).toBeLessThan(live); // 4.98% < 12.45%
  });

  // 추적 구간은 원근상 라이브 접근보다 넓게 잡힐 수밖에 없다(멀수록 높은 벽이 더 들어온다).
  // 라이브 팔로우도 같은 위치에서 30%대를 담으므로 목표는 '0'이 아니라 **옛 값(최대 39.6%)에서
  // 확실히 내려온 상태**의 고정이다.
  it.each([9, 12, 14, 16, 17])('리플레이 추적(공 z=%s)의 전광판 점유율이 31%% 아래', (bz) => {
    const p = replayPose(bz);
    expect(screenBandPct(p.cy, p.cz, p.ly, p.lz)).toBeLessThan(31); // 실측 최대 30.6% (구 31.7%)
  });

  // 리플레이 카메라가 개구부 상단 위로 올라가면 전광판이 급격히 들어온다. 포즈를 공 높이에
  // 클램프하는 이유이기도 하다(튀어오른 공을 따라 카메라가 올라가지 않게).
  it('리플레이 카메라는 개구부 상단보다 낮게 앉는다', () => {
    expect(replayPose(HEADPIN_Z).cy).toBeLessThan(PIN_BAY_TOP);
  });
});
