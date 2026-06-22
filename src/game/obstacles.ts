/**
 * 장애물 레인(#3) 코스 데이터 — 순수 데이터·타입만 (THREE/RAPIER 의존 0).
 *
 * GameState(라운드 흐름)·Barrier(렌더/물리)·Hud(코스 표시)·테스트가 공용으로 읽는다.
 * SPARE_LEAVES가 GameState에 묶여 무거운 모듈 그래프(THREE/RAPIER) 없이는 못 가져오던 문제를
 * 피하려 데이터를 여기로 분리 — 덕분에 vitest(node)에서 스테이지 구조를 직접 검증할 수 있다.
 *
 * 좌표계(constants.ts·splits.ts와 동일): world +x = 볼러/화면 왼쪽, +z = 다운레인.
 * 핀 번호 x: 1=0 · 2=+0.152 · 3=−0.152 · 4=+0.305 · 5=0 · 6=−0.305 · 7=+0.457 · 8=+0.152 · 9=−0.152 · 10=−0.457.
 * 훅 방향: spin>0(R)→공이 −x로 휨 · spin<0(L)→+x로 휨 (Ball.launch/applySpinForce).
 *
 * 설계 원칙(GAME_MODES_EXPANSION §3): 배리어를 표적 핀의 직선 경로 위에 두어 **직구는 막히고
 * 훅으로 감아 돌아야** 풀린다. short 오일 고정(endZ 9.5 → z>9.5부터 훅) + aimAid='easy' 강제는
 * GameState.startMatch가 담당. 배리어는 전부 z>9.5(오일 브레이크 뒤)라 옆을 직진으로 지난 뒤 휜다.
 * ⚠️ "직구 불가"는 sim/플레이테스트로 보장(문서 §3 열린 질문) — 실측 후 좌표 미세조정 여지.
 */

/** 네온 배리어 1개. (x,z)=레인 중심 좌표, w/h/d=크기(생략 시 Barrier.ts 기본값). color=네온 발광색. */
export interface BarrierSpec {
  x: number;
  z: number;
  /** x폭 (기본 0.22) — 표적을 가릴 만큼 넓어야 직구가 막힌다 */
  w?: number;
  /** 높이 (기본 0.40) — 공(지름 0.218)을 확실히 막게 */
  h?: number;
  /** z깊이 (기본 0.10) */
  d?: number;
  /** 네온 발광색 (기본 시안) */
  color?: number;
}

/** 한 스테이지 = 서 있는 핀 번호 + 배리어 배치. 1구로 전부 쓰러뜨리면 클리어(scoreObstacleMode). */
export interface ObstacleStage {
  pins: number[];
  barriers: BarrierSpec[];
}

const CYAN = 0x22d3ee;
const PINK = 0xff2d78;
const AMBER = 0xf59e0b;

/**
 * 10 코스 (쉬움 → 어려움). 검증된 패턴 = **한쪽으로 치우친 2핀 표적 + 그 직선 경로를 가리는 방벽**:
 * 직진은 막히고, 옆으로 진입해 훅으로 감아 돌아야 닿는다. 표적은 |x|≤0.31(7·10 제외)로 둬 거터를 탄
 * 직구가 외곽 핀을 우연히 맞히는 걸 막는다. 2핀(세로쌍=앞핀 캐리, 가로쌍=훅 캐리)이라 단발로 클리어 가능.
 *
 * ⚠️ 좌표·폭은 sim 스윕으로 "훅이면 클리어 / 직구는 0핀"을 확인해 확정했다(브라우저 수동 스텝 검증).
 * 초반(1~7)은 창이 비교적 넓고, 후반(8~10)은 이중 방벽/센터라 정밀 라인이 필요하다. 추가 플레이테스트로
 * 미세조정 여지(문서 §3 열린 질문). 훅 방향: spin>0(R)→−x로 휨 · spin<0(L)→+x로 휨.
 */
export const OBSTACLE_STAGES: ObstacleStage[] = [
  // 1. 첫 커브(왼쪽) — 좌측 세로쌍(2·8) 앞 좁은 방벽. 오른쪽 진입 → L훅(+x). 가장 관대.
  { pins: [2, 8], barriers: [{ x: 0.12, z: 12, w: 0.22, color: CYAN }] },
  // 2. 첫 커브(오른쪽) — 우측 세로쌍(3·9), 1의 거울. R훅(−x).
  { pins: [3, 9], barriers: [{ x: -0.12, z: 12, w: 0.22, color: CYAN }] },
  // 3. 왼쪽 스프레드 — 좌측 가로 벌어진 2·4, 훅으로 둘 다 캐리.
  { pins: [2, 4], barriers: [{ x: 0.15, z: 13, w: 0.28, color: CYAN }] },
  // 4. 오른쪽 스프레드 — 우측 3·6, 3의 거울.
  { pins: [3, 6], barriers: [{ x: -0.15, z: 13, w: 0.28, color: CYAN }] },
  // 5. 센터 길막 — 정중앙 좁은 방벽 뒤 센터 기둥(1·5). 좌우 어느 쪽으로 감든 정밀 복귀 필요.
  { pins: [1, 5], barriers: [{ x: 0, z: 12, w: 0.18, color: PINK }] },
  // 6. 왼쪽 넓은 벽 — 더 넓고 깊은 방벽(z14). 강한 L훅으로 크게 감기.
  { pins: [2, 4], barriers: [{ x: 0.17, z: 14, w: 0.34, color: PINK }] },
  // 7. 오른쪽 넓은 벽 — 6의 거울. 강한 R훅.
  { pins: [3, 6], barriers: [{ x: -0.17, z: 14, w: 0.34, color: PINK }] },
  // 8. 이중 관문(오른쪽) — 진입 방벽(우) + 마무리 방벽(좌, 깊숙이). 좁은 라인으로 우측 핀.
  {
    pins: [3, 9],
    barriers: [
      { x: -0.14, z: 12, w: 0.26, color: AMBER },
      { x: 0.14, z: 15.5, w: 0.22, color: AMBER },
    ],
  },
  // 9. 이중 관문(왼쪽) — 8의 거울.
  {
    pins: [2, 8],
    barriers: [
      { x: 0.14, z: 12, w: 0.26, color: AMBER },
      { x: -0.14, z: 15.5, w: 0.22, color: AMBER },
    ],
  },
  // 10. 피날레 — 센터-우(1·3) 핀포인트, 넓은 방벽. 가장 정밀한 라인.
  { pins: [1, 3], barriers: [{ x: -0.05, z: 13.5, w: 0.34, color: PINK }] },
];
