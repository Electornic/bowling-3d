/**
 * 오일 상태 — 레인 위 오일 패턴을 런타임에 바꾸기 위한 가변 모듈 (P3 숙련 깊이).
 *
 * 원래 OIL_END_Z / HOOK_RAMP / hookFactor 는 constants.ts의 고정 상수였다. 매치(오일 프리셋)·
 * 프레임 경과(레인 마름)마다 달라지게 하려면 가변 상태가 필요하고, 물리(Lane·Ball)와
 * 예측선(Controls)이 **같은 값**을 봐야 정합이 유지된다. 그래서 세 소비 지점이 모두
 * 여기서 읽는 단일 가변 모듈로 뽑았다.
 *
 * 앞 구간은 오일로 미끄러져 직진(hook 0), endZ부터 마찰이 살아나며 훅이 "막판에" 꺾인다(ramp 동안 1로).
 * ⚠️ 레인 콜라이더는 마찰 결합 Min 필수 (Lane.ts) — 기본 Average면 공 마찰(0.1)과 평균돼
 *    오일 존 슬립이 일찍 닫혀 훅의 절반이 오일 존에서 새어나간다 (constants.ts LANE_FRICTION_* 주석).
 *
 * geometry(endZ·ramp)만 가변 — 마찰값(LANE_FRICTION_OIL/DRY·FRICTION_K)은 constants에 고정이다.
 * 덕분에 sim-carry.mjs의 --oilEnd / --hookRamp 만으로 프리셋·마름을 그대로 검증할 수 있다.
 */

export type OilPattern = 'house' | 'short' | 'long';

/**
 * 오일 프리셋 — 훅이 "꺾이기 시작하는 지점"(endZ)을 옮겨 라인 읽기를 강요한다. house가 기준.
 * 같은 (aim·spin·power)라도 브레이크 지점이 달라 최적 라인이 이동 → 플레이어가 다시 조준해야 함.
 *   house : endZ 10.5 — 기존 상수와 정확히 동일 (거동 보존 기준점). 훅이 최적해인 친화적 패턴.
 *   short : endZ 9.5  — 일찍 깨짐 → 풀스핀이 과훅(포켓 넘김)이라 스핀을 덜거나 더 직진/바깥 조준.
 *   long  : endZ 12.5 — 늦게 깨짐 → 스키드 길어 훅이 약하고 늦음, 직진 강요·포켓각 만들기 어려움.
 * sim-carry --oilEnd 로 스캔 확정(하우스 직구4/훅7 → short 직구6/훅3, long 직구4/훅3·진입각↓).
 * ramp는 3.5 고정(스냅 날카로움 동일) — endZ만 움직여 효과를 격리·검증 단순화.
 */
export const OIL_PRESETS: Record<OilPattern, { endZ: number; ramp: number }> = {
  house: { endZ: 10.5, ramp: 3.5 },
  short: { endZ: 9.5, ramp: 3.5 },
  long: { endZ: 12.5, ramp: 3.5 },
};

// 현재 유효 오일 geometry (가변). 기본 = house. resetOil / advanceOilDrying 이 갱신한다.
let endZ = OIL_PRESETS.house.endZ;
let ramp = OIL_PRESETS.house.ramp;
let baseEndZ = OIL_PRESETS.house.endZ; // 마름 누적 기준 (프리셋 원점 — advanceOilDrying이 여기서 뺀다)

// --- 레인 전환(오일 마름, Step 3) ---
// 프레임이 진행되며 오일이 닳아 드라이 존이 앞으로 확장 → 훅이 더 일찍 산다. full 모드에서만 체감.
export const OIL_DRY_PER_FRAME = 0.12; // 완료 프레임당 endZ가 뒤로 물러나는 양 (m)
export const OIL_DRY_MAX = 1.5; // 누적 상한 (m) — 과도한 후반 훅 폭주 방지

/** 오일 존 끝 z(현재값). 예측선 'normal'이 여기까지만 그린다 / 광택 비주얼 길이. */
export function oilEndZ(): number {
  return endZ;
}

/**
 * 주입 측면력 게이트: 오일 존 0 → 드라이 존 1 (smoothstep).
 * 가변 endZ/ramp를 읽는다 (구 constants.hookFactor 대체 — 시그니처·수식 동일).
 */
export function hookFactor(z: number): number {
  const t = Math.min(1, Math.max(0, (z - endZ) / ramp));
  return t * t * (3 - 2 * t);
}

/** 매치 시작 — 프리셋 적용 + 마름 초기화. startMatch의 리셋 체크리스트에서 호출. */
export function resetOil(pattern: OilPattern): void {
  const p = OIL_PRESETS[pattern];
  baseEndZ = p.endZ;
  endZ = p.endZ;
  ramp = p.ramp;
}

/**
 * 레인 마름 적용 (Step 3) — 완료된 프레임 수에 비례해 오일 존을 앞으로 당긴다.
 * 호출부(GameState.finishFrame)에서 full 모드 여부를 게이트한다(oil.ts는 모드를 모름).
 */
export function advanceOilDrying(framesCompleted: number): void {
  const shift = Math.min(framesCompleted * OIL_DRY_PER_FRAME, OIL_DRY_MAX);
  endZ = baseEndZ - shift;
}
