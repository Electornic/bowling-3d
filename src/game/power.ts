/**
 * 파워 스로(#4) 코스 데이터 — 순수 데이터·기하만 (THREE/RAPIER 의존 0).
 *
 * GameState(라운드 흐름)·PinSet(랙 배치)·Hud(스테이지 표시)·테스트가 공용으로 읽는다.
 * obstacles.ts와 같은 분리 원칙 — vitest(node)에서 랙 좌표를 THREE/RAPIER 없이 직접 검증한다.
 *
 * 좌표계(constants.ts와 동일): world +x = 볼러/화면 왼쪽, +z = 다운레인.
 * 삼각 랙: 행 r(0=헤드핀 쪽)은 r+1개 핀, z=HEADPIN_Z+r·ROW_GAP(뒤로 갈수록 멀어짐),
 * x=(i − r/2)·PIN_SPACING (i=0..r). 행 0~3은 표준 10핀 랙과 정확히 일치 — 표준 핀이 그대로 앞 4행을 채운다.
 *
 * 설계 원칙(GAME_MODES_EXPANSION §4): 거터 대신 벽, 핀 다수의 삼각 랙을 한 구로 최대한 쓸기.
 * 점수 = 쓰러뜨린 핀 누적(라운드형, 스테이지마다 행 수↑). 직구 풀파워가 정답인 '캐리 쇼케이스'.
 */

import { HEADPIN_Z, PIN_SPACING, ROW_GAP, POWER_MAX_ROWS } from './constants';

/**
 * 스테이지별 삼각 랙 행 수 (쉬움 → 어려움). 1스테이지 = 표준 10핀 랙(친숙한 출발),
 * 이후 한 행씩 늘어 마지막은 POWER_MAX_ROWS(10행 = 55핀). 핀 수 = 행 수의 삼각수.
 *   4행=10 · 5행=15 · 6행=21 · 7행=28 · 8행=36 · 9행=45 · 10행=55
 */
export const POWER_STAGES: number[] = [4, 5, 6, 7, 8, 9, 10];

/** rows행 삼각 랙의 핀 개수 = rows(rows+1)/2 (삼각수). */
export function pinCountForRows(rows: number): number {
  return (rows * (rows + 1)) / 2;
}

/** 파워 풀에 필요한 최대 핀 수 (PinSet 풀 크기) = 마지막 스테이지. */
export const POWER_MAX_PINS = pinCountForRows(POWER_MAX_ROWS);

/**
 * rows행 삼각 랙의 핀 좌표 (행 0부터, 각 행 좌→우). PinSet.setPowerRack가 이 순서로
 * 풀 핀을 place()한다. 표준 10핀이 앞 10슬롯(행 0~3)을 home과 동일 위치로 채운다.
 */
export function powerRackPositions(rows: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let r = 0; r < rows; r++) {
    const z = HEADPIN_Z + r * ROW_GAP;
    for (let i = 0; i <= r; i++) {
      out.push({ x: (i - r / 2) * PIN_SPACING, z });
    }
  }
  return out;
}
