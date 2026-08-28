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
} from '../src/game/constants';
import { APPROACH_POS, GAMEOVER_POS } from '../src/camera/CameraRig';
import { REPLAY_CAM_Y_OFF, REPLAY_TRAIL_NEAR } from '../src/scene/Replay';

/** 리플레이가 헤드핀에서 파킹하는 포즈 (Replay.placeCamera와 같은 식, 공은 레인 위 y=BALL_RADIUS) */
const REPLAY_PARKED = {
  y: Math.max(0.45, BALL_RADIUS + REPLAY_CAM_Y_OFF),
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

const POSES: Array<[string, number, number]> = [
  ['AIMING', 0.75, -2.7],
  ['MENU', 1.7, -3.4],
  ['접근(핀덱)', APPROACH_POS.y, APPROACH_POS.z],
  ['GAME_OVER', GAMEOVER_POS.y, GAMEOVER_POS.z],
  ['리플레이 파킹', REPLAY_PARKED.y, REPLAY_PARKED.z],
];

describe('핀 베이가 카메라 시선을 가리지 않는다', () => {
  it.each(POSES)('%s — 서 있는 핀 10개가 캐노피에 안 잘린다', (_name, cy, cz) => {
    expect(clearance(cy, cz, PIN_HEIGHT)).toBeGreaterThan(0.02);
  });

  // 날아오르는 핀도 대체로 보여야 한다. 베이 구간 실측 핀 꼭대기 최대는 0.518
  // (24구·82,278 핀프레임, 0.55 초과 0건) — 접근 카메라는 그 높이까지 담아야 크래시가 보인다.
  it('접근 카메라는 튀어오르는 핀(0.518)까지 담는다', () => {
    expect(clearance(APPROACH_POS.y, APPROACH_POS.z, 0.518)).toBeGreaterThan(0);
  });

  // 리플레이는 **크래시를 보여주는 게 목적인 연출**이라 튀어오르는 핀이 잘리면 안 된다.
  // 예전 포즈(+0.55 → y 0.659)는 여유 −0.001로 정확히 잘리고 있었고, 이 테스트가 없어 안 잡혔다.
  it('리플레이 파킹 카메라는 튀어오르는 핀(0.518)까지 담는다', () => {
    expect(clearance(REPLAY_PARKED.y, REPLAY_PARKED.z, 0.518)).toBeGreaterThan(0.02);
  });

  // 회귀 방향 고정: 개구부를 더 낮추면 반드시 이 테스트가 먼저 깨져야 한다.
  it('개구부를 낮추면 접근 카메라가 깨진다 (커플링 확인)', () => {
    const f = (PIN_BAY_FRONT_Z - APPROACH_POS.z) / (HEADPIN_Z + 3 * ROW_GAP - APPROACH_POS.z);
    const sightY = APPROACH_POS.y + (PIN_HEIGHT - APPROACH_POS.y) * f;
    expect(PIN_BAY_TOP).toBeGreaterThan(sightY); // 지금은 통과, 개구부가 sightY 밑으로 내려가면 실패
  });
});
