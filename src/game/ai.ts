import { BALL_START_Z, HEADPIN_Z } from './constants';
import { oilEndZ, OIL_END_Z } from './oil';
import type { I18nKey } from '../i18n';

/**
 * AI 라이벌 (로드맵 P1.5). 같은 물리를 쓰되 (aim, power, spin)에
 * 성격별 평균·분산을 줘서 던진다 — 난이도·개성이 파라미터 몇 개.
 *
 * 조준 캘리브레이션 (tests/ai-calibrate.test.ts 스캔, 10lb 기준 — `AI_CAL=1`로 다시 찍는다):
 * - 직구: 진입 x ≈ aim × 19.29
 * - 풀스핀 훅 풀파워: 진입 x ≈ aim × 19.29 − 0.29 (훅 드리프트 29cm, 하우스 39 ft 새 오일 — 재매핑 전 34 ft 오일에서 33cm)
 * - 포켓(스트라이크 밴드 중심): 직구 ≈ −7cm, 훅(+1 스핀, −x로 휨) ≈ +6.5cm
 */

export interface AiProfile {
  key: string;
  /**
   * 이름·소개는 **키**다(문자열이 아니다) — 이 배열은 모듈 로드 시점에 만들어지고 그때는 로케일이
   * 아직 정해지지 않았다. 매치가 시작될 때 `t()`로 풀어 `GameState`의 플레이어 이름이 된다.
   */
  nameKey: I18nKey;
  taglineKey: I18nKey;
  style: 'straight' | 'hook';
  /** 1구(풀랙) 파워 평균 */
  power: number;
  powerJitter: number;
  /** 1구 조준 표준편차 (진입 x 기준, cm) */
  aimJitterCm: number;
  /** 스페어 처리 조준 표준편차 (cm) — 작을수록 스페어 장인 */
  spareAimJitterCm: number;
  spin: number;
  /** AI 공 무게 (캘리브레이션은 10lb 기준) */
  ballLb: number;
}

// 초→중→고 난이도 순으로 노출 (메뉴는 배열 순서대로 렌더). 라이벌 식별은 key(kim/yoon/han)로 — 저장/업적 호환 유지.
export const AI_PROFILES: AiProfile[] = [
  {
    key: 'kim',
    nameKey: 'ai.kim',
    taglineKey: 'ai.kim.tagline',
    style: 'straight',
    power: 1.0,
    powerJitter: 0.05,
    aimJitterCm: 10, // 매치 sim 확정: mean ~130 (쉬움). 2026-09-02 실척도 재매핑 뒤 재측정 134(N=120, 하우스). docs/legacy/SPIN_FEEL_AND_AI_LADDER.md §3
    spareAimJitterCm: 7,
    spin: 0,
    ballLb: 10,
  },
  {
    key: 'yoon',
    nameKey: 'ai.yoon',
    taglineKey: 'ai.yoon.tagline',
    style: 'hook',
    power: 1.0,
    powerJitter: 0.04,
    aimJitterCm: 4, // 매치 sim 확정: mean ~169, sd ~28(최대) 와일드카드 — 중간 정타율에서 boom/bust 변동 피크. 재매핑 뒤 163/sd 24
    spareAimJitterCm: 7,
    spin: 1,
    ballLb: 10,
  },
  {
    key: 'han',
    nameKey: 'ai.han',
    taglineKey: 'ai.han.tagline',
    style: 'straight',
    power: 0.95,
    powerJitter: 0.05,
    aimJitterCm: 1, // 매치 sim 확정: mean ~228 (정밀). 좁은 3cm 포켓 밴드라 정타율 필수. 재매핑 뒤 234
    spareAimJitterCm: 1.2,
    spin: 0,
    ballLb: 10,
  },
];

export const ENTRY_DIST = HEADPIN_Z - BALL_START_Z; // ≈19.29 (aim → 진입 x 변환 거리) — Controls도 공유(#9)
// 풀스핀 풀파워 훅 드리프트 (m) — 유효 오일 endZ의 함수. 오일은 하우스 하나(OIL_END_Z 11.9)지만 **마름**이 endZ를
//   프레임마다 최대 1.5 m 당기므로 함수로 남긴다. 2026-09-02 ai-calibrate 스캔(실척도 재매핑 뒤):
//   endZ 11.9 스트라이크 밴드 T 34~37 → 드리프트 0.29 (모션 sim 풀파워 풀스핀 총휨과 일치) /
//   endZ 10.5(마름 끝 근처) 밴드 46~47 → 0.40 / endZ 13.4 밴드 28~30 → 0.23. 마름 방향 기울기 ≈0.08, 반대쪽 0.04 —
//   마름 쪽을 따라 0.07(재매핑 전과 같은 값). 직구형(spin 0)은 훅이 없어 무관 — 훅형(윤)만 받는다.
const HOOK_DRIFT_HOUSE = 0.29;
const HOOK_DRIFT_SLOPE = 0.07;
function hookDriftFor(oilEnd: number): number {
  return Math.max(0.1, Math.min(0.55, HOOK_DRIFT_HOUSE - HOOK_DRIFT_SLOPE * (oilEnd - OIL_END_Z)));
}
const POCKET_X_STRAIGHT = -0.07; // 진입 x 포켓 — 매치 sim 미세스윕: 스트라이크 밴드 −8~−6cm 중심(power 1.0/0.95). 0(헤드핀 정면)은 노즈히트=스플릿이라 직구가 안 터졌다
const POCKET_X_HOOK = 0.065; // ai-calibrate 하우스(11.9) 훅 스트라이크 밴드 T 34~37cm 중앙 35.5 − 드리프트 0.29 (재매핑 전 0.05)

/** 표준정규 난수 (Box-Muller) — Controls 릴리스 타이밍 노이즈도 공유(#9). */
export function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/**
 * AI 투구 파라미터 결정.
 * - 풀랙: 성격대로 포켓 노림 (직구/훅)
 * - 스페어: 남은 핀 무게중심 x를 직구로 노림 (와이드 스플릿은 자연히 어려움)
 */
export function computeAiThrow(
  profile: AiProfile,
  standingXs: number[],
): { aim: number; power: number; spin: number } {
  const fullRack = standingXs.length >= 10;
  if (fullRack) {
    const noise = (gauss() * profile.aimJitterCm) / 100;
    const target =
      profile.style === 'hook' ? POCKET_X_HOOK + hookDriftFor(oilEndZ()) : POCKET_X_STRAIGHT;
    return {
      aim: (target + noise) / ENTRY_DIST,
      power: clamp01(profile.power + gauss() * profile.powerJitter),
      spin: profile.spin,
    };
  }
  // 스페어 처리: 잔여 핀 centroid를 직구로
  const cx = standingXs.reduce((s, x) => s + x, 0) / Math.max(1, standingXs.length);
  const noise = (gauss() * profile.spareAimJitterCm) / 100;
  return {
    aim: (cx + noise) / ENTRY_DIST,
    power: clamp01(0.8 + gauss() * 0.05),
    spin: 0,
  };
}
