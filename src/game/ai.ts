import { BALL_START_Z, HEADPIN_Z } from './constants';
import { oilEndZ } from './oil';

/**
 * AI 라이벌 (로드맵 P1.5). 같은 물리를 쓰되 (aim, power, spin)에
 * 성격별 평균·분산을 줘서 던진다 — 난이도·개성이 파라미터 몇 개.
 *
 * 조준 캘리브레이션 (sim-carry.mjs 실측, 10lb 기준):
 * - 직구: 진입 x ≈ aim × 19.29
 * - 풀스핀 훅 풀파워: 진입 x ≈ aim × 19.29 − 0.33 (훅 드리프트 33cm)
 * - 포켓(스트라이크 윈도우 중심): 직구 ≈ 0cm, 훅(+1 스핀, −x로 휨) ≈ +6.7cm
 */

export interface AiProfile {
  key: string;
  name: string;
  tagline: string;
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
    name: '초보',
    tagline: '착실한 직구 — 꾸준하지만 포켓을 자주 놓친다',
    style: 'straight',
    power: 1.0,
    powerJitter: 0.05,
    aimJitterCm: 10, // 매치 sim 확정: mean ~130 (쉬움). SPIN_FEEL_AND_AI_LADDER.md §3
    spareAimJitterCm: 7,
    spin: 0,
    ballLb: 10,
  },
  {
    key: 'yoon',
    name: '중수',
    tagline: '풀스핀 한 방 승부 — 대박 아니면 쪽박',
    style: 'hook',
    power: 1.0,
    powerJitter: 0.04,
    aimJitterCm: 4, // 매치 sim 확정: mean ~169, sd ~28(최대) 와일드카드 — 중간 정타율에서 boom/bust 변동 피크
    spareAimJitterCm: 7,
    spin: 1,
    ballLb: 10,
  },
  {
    key: 'han',
    name: '고수',
    tagline: '빈틈없는 정밀 직구 — 포켓도 스페어도 놓치지 않는다',
    style: 'straight',
    power: 0.95,
    powerJitter: 0.05,
    aimJitterCm: 1, // 매치 sim 확정: mean ~228 (정밀). 좁은 3cm 포켓 밴드라 정타율 필수
    spareAimJitterCm: 1.2,
    spin: 0,
    ballLb: 10,
  },
];

export const ENTRY_DIST = HEADPIN_Z - BALL_START_Z; // ≈19.29 (aim → 진입 x 변환 거리) — Controls도 공유(#9)
// 풀스핀 풀파워 훅 드리프트 (m) — 오일 endZ의 함수 (P3). sim-carry 총휨 스캔(endZ 12.5→9.42, 선형 적합):
//   endZ 10.5(하우스) 실측 0.30→캘리 0.33 / 9.5(숏)≈0.40 / 12.5(롱)≈0.19. 기울기 ≈0.070 m per endZ 1m.
//   오일이 짧을수록(숏·레인 마름) 훅이 길게 살아 드리프트↑ → AI가 그만큼 더 바깥을 노려 보정.
//   직구형(spin 0)은 훅이 없어 오일 무관 — 이 보정은 훅형(윤)만 받는다. 하우스에서 정확히 0.33(거동 보존).
const HOOK_DRIFT_HOUSE = 0.33;
const HOOK_DRIFT_SLOPE = 0.07;
function hookDriftFor(oilEnd: number): number {
  return Math.max(0.1, Math.min(0.55, HOOK_DRIFT_HOUSE - HOOK_DRIFT_SLOPE * (oilEnd - 10.5)));
}
const POCKET_X_STRAIGHT = -0.07; // 진입 x 포켓 — 매치 sim 미세스윕: 스트라이크 밴드 −8~−6cm 중심(power 1.0/0.95). 0(헤드핀 정면)은 노즈히트=스플릿이라 직구가 안 터졌다
const POCKET_X_HOOK = 0.05; // 매치 sim 훅 스윕: 발사오프셋 T≈0.38(=0.05+HOOK_DRIFT_HOUSE) 중심이 스트라이크 밴드 중앙

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
