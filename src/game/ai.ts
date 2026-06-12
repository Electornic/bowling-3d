import { BALL_START_Z, HEADPIN_Z } from './constants';

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

export const AI_PROFILES: AiProfile[] = [
  {
    key: 'kim',
    name: '김부장',
    tagline: '안정 직구형 — 꾸준히 포켓을 노린다',
    style: 'straight',
    power: 1.0,
    powerJitter: 0.05,
    aimJitterCm: 6,
    spareAimJitterCm: 3.5,
    spin: 0,
    ballLb: 10,
  },
  {
    key: 'han',
    name: '한프로',
    tagline: '스페어 장인 — 1구는 평범, 뒷처리가 무섭다',
    style: 'straight',
    power: 0.95,
    powerJitter: 0.05,
    aimJitterCm: 7,
    spareAimJitterCm: 1.2,
    spin: 0,
    ballLb: 10,
  },
  {
    key: 'yoon',
    name: '도박사 윤',
    tagline: '풀스핀 도박형 — 터지면 스트라이크, 망하면 스플릿',
    style: 'hook',
    power: 1.0,
    powerJitter: 0.04,
    aimJitterCm: 4.5,
    spareAimJitterCm: 5,
    spin: 1,
    ballLb: 10,
  },
];

const ENTRY_DIST = HEADPIN_Z - BALL_START_Z; // ≈19.29 (aim → 진입 x 변환 거리)
const HOOK_DRIFT_FULL = 0.33; // 풀스핀 풀파워 훅 드리프트 (m, 실측)
const POCKET_X_STRAIGHT = 0.0;
const POCKET_X_HOOK = 0.067; // +x = 볼러 왼쪽 — 훅(−x로 휨)의 미러 포켓

/** 표준정규 난수 (Box-Muller) */
function gauss(): number {
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
      profile.style === 'hook' ? POCKET_X_HOOK + HOOK_DRIFT_FULL : POCKET_X_STRAIGHT;
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
