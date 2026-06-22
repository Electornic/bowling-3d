import type { GameMode } from './GameState';

/**
 * 보상 시스템 (로드맵 ③ 승리 보상) — 업적(뱃지) + 코스메틱 볼 스킨. 설계: docs/REWARDS.md.
 * 스킨 = 머티리얼 파라미터만(물리/AI 사다리 무영향, §3 불변식). 과금·가챠 없음, localStorage.
 * v1 = core 업적 6 + classic 포함 7스킨. stretch(perfect/spare_master/clean)·애니 스킨은 P5.
 */

export type SkinFinish = 'matte' | 'satin' | 'metallic' | 'chrome' | 'glow';

/** 볼 스킨 — 외형 전용(§3 #1). massKg·maxSpeedScale 불가침. */
export interface BallSkin {
  id: string;
  label: string;
  finish: SkinFinish;
  /** classic만 — 무게 기반 색을 유지(skin.color 무시) */
  useWeightColor?: boolean;
  color?: number;
  roughness?: number;
  metalness?: number;
  /** 크롬/메탈릭 반사 강도 (씬 environment IBL 활용). 크롬 가독성 게이트(§14 P2): 실측 후 상향 가능. */
  envMapIntensity?: number;
  /** 글로우 색 — bloom 도입 전엔 "밝은 색"으로 우아하게 강등(§11). */
  emissive?: number;
  emissiveIntensity?: number;
  /** 그립·로고 마크 색(어두운 공 대비) — Ball.ts 알려진 이슈 동시 해결(§7/§9). */
  decorColor?: number;
}

export type AchievementTier = 'core' | 'stretch';

/** 업적 — gameOver 시점 데이터로 판정(§8). 스킬/마스터리만(그라인드 없음). */
export interface Achievement {
  id: string;
  badge: string;
  desc: string;
  icon: string;
  reward: string; // SkinId
  tier: AchievementTier;
}

/** 기본·항상 해금 스킨. AI 볼·미해금 시 폴백. */
export const CLASSIC_SKIN: BallSkin = {
  id: 'classic',
  label: '클래식',
  finish: 'metallic',
  useWeightColor: true,
  roughness: 0.25,
  metalness: 0.3,
};

/** v1 스킨 카탈로그(§7). obsidian·holo·pulse는 stretch라 P5. */
export const SKINS: Record<string, BallSkin> = {
  classic: CLASSIC_SKIN,
  satin: { id: 'satin', label: '새틴', finish: 'satin', color: 0xdfe4ec, roughness: 0.4, metalness: 0.45, envMapIntensity: 0.8 },
  ember: { id: 'ember', label: '엠버', finish: 'glow', color: 0x331100, roughness: 0.5, metalness: 0.2, emissive: 0xff7a18, emissiveIntensity: 1.1, decorColor: 0xffd9a8 },
  chrome: { id: 'chrome', label: '크롬', finish: 'chrome', color: 0xdfe6ee, roughness: 0.04, metalness: 1.0, envMapIntensity: 1.4, decorColor: 0x1a2230 },
  galaxy: { id: 'galaxy', label: '갤럭시', finish: 'glow', color: 0x1a1247, roughness: 0.4, metalness: 0.5, emissive: 0x5a2ad6, emissiveIntensity: 0.7, decorColor: 0xcdbcff },
  volt: { id: 'volt', label: '볼트', finish: 'glow', color: 0x1a1a00, roughness: 0.45, metalness: 0.2, emissive: 0xfff200, emissiveIntensity: 1.0, decorColor: 0x222200 },
  sunset: { id: 'sunset', label: '선셋', finish: 'glow', color: 0xff5e8a, roughness: 0.5, metalness: 0.2, emissive: 0xff3a6e, emissiveIntensity: 0.8, decorColor: 0x5e0a22 },
};

/** v1 업적(§6 core 6). 전부 gameOver 데이터로 판정. */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_game', badge: '첫 발걸음', desc: '첫 게임 완주', icon: '🎳', reward: 'satin', tier: 'core' },
  { id: 'beat_kim', badge: '입문 졸업', desc: '초보 격파', icon: '🥉', reward: 'ember', tier: 'core' },
  { id: 'beat_han', badge: '명인 격파', desc: '고수 격파', icon: '🏅', reward: 'chrome', tier: 'core' },
  { id: 'beat_yoon', badge: '하이롤러', desc: '중수 격파', icon: '🎰', reward: 'galaxy', tier: 'core' },
  { id: 'score_200', badge: '200 클럽', desc: '풀게임 200점 돌파', icon: '💯', reward: 'volt', tier: 'core' },
  { id: 'turkey', badge: '터키', desc: '한 게임 3연속 스트라이크', icon: '🦃', reward: 'sunset', tier: 'core' },
];

const KEY = 'bowling3d.rewards.v1';

export interface RewardStore {
  earned: string[];
  selectedSkin: string;
}

const emptyStore = (): RewardStore => ({ earned: [], selectedSkin: 'classic' });

export function loadRewards(): RewardStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const s = JSON.parse(raw) as Partial<RewardStore>;
    return {
      earned: Array.isArray(s.earned) ? s.earned.filter((x): x is string => typeof x === 'string') : [],
      selectedSkin: typeof s.selectedSkin === 'string' ? s.selectedSkin : 'classic',
    };
  } catch {
    return emptyStore(); // 시크릿 모드 등 localStorage 불가
  }
}

function save(store: RewardStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    // 저장 실패는 치명적이지 않음
  }
}

/** 새로 달성된 업적 id를 earned에 병합 (멱등). */
export function recordRewards(freshIds: string[]) {
  if (!freshIds.length) return;
  const store = loadRewards();
  for (const id of freshIds) if (!store.earned.includes(id)) store.earned.push(id);
  save(store);
}

/** 장착 스킨 저장 (없는 스킨 id는 무시). */
export function saveSelectedSkin(id: string) {
  if (!SKINS[id]) return;
  const store = loadRewards();
  store.selectedSkin = id;
  save(store);
}

/** [DEV] 보상 저장 초기화 — 디버그 글로벌(__resetRewards)에서 호출. */
export function resetRewards() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** earned 업적에서 해금된 스킨 id 집합(classic 항상 포함). */
export function unlockedSkinIds(earned: string[]): Set<string> {
  const set = new Set<string>(['classic']);
  for (const a of ACHIEVEMENTS) if (earned.includes(a.id)) set.add(a.reward);
  return set;
}

/** id → 스킨 객체 (없으면 classic). */
export function resolveSkin(id: string): BallSkin {
  return SKINS[id] ?? CLASSIC_SKIN;
}

/** 스킨을 해금하는 업적(잠금 조건 표시용). */
export function achievementForSkin(skinId: string): Achievement | undefined {
  return ACHIEVEMENTS.find((a) => a.reward === skinId);
}

export interface EvalInput {
  mode: GameMode;
  humanScore: number;
  /** 승자 인덱스. 0=인간 승, -1=무승부, 1+=AI 승 */
  winner: number;
  /** 이번 매치 AI 라이벌 key들 ('kim'|'han'|'yoon') */
  rivalKeys: string[];
  /** 인간 플레이어의 프레임별 투구 (turkey 판정) */
  rolls: number[][];
  frames: number;
}

/** 프레임별 rolls에서 최대 연속 스트라이크 수(§13). 마지막 프레임은 투구별 평탄화. */
export function maxConsecutiveStrikes(rolls: number[][], frames: number): number {
  const tokens: boolean[] = [];
  const last = frames - 1;
  for (let f = 0; f < rolls.length; f++) {
    const fr = rolls[f] ?? [];
    if (f < last) {
      tokens.push(fr[0] === 10); // 1~9프레임: 1구 스트라이크 여부
    } else {
      for (const r of fr) tokens.push(r === 10); // 마지막 프레임: 투구별
    }
  }
  let max = 0;
  let run = 0;
  for (const t of tokens) {
    run = t ? run + 1 : 0;
    if (run > max) max = run;
  }
  return max;
}

/**
 * 이번 게임으로 "새로" 달성된 업적 id (이미 earned 제외). DOM·전역 의존 0(순수함수, §8).
 * winner===0(인간 승)만 격파 인정. first_game은 멱등으로 첫 게임에만.
 */
export function evaluateAchievements(input: EvalInput, alreadyEarned: string[]): string[] {
  const got = new Set(alreadyEarned);
  const fresh: string[] = [];
  const add = (id: string, cond: boolean) => {
    if (cond && !got.has(id)) fresh.push(id);
  };
  const beat = (key: string) => input.winner === 0 && input.rivalKeys.includes(key);

  add('first_game', true); // 첫 gameOver(멱등으로 1회만)
  add('beat_kim', beat('kim'));
  add('beat_han', beat('han'));
  add('beat_yoon', beat('yoon'));
  add('score_200', input.mode === 'full' && input.humanScore >= 200);
  // 라운드형(스페어·장애물)은 rolls가 프레임 구조가 아니라 turkey 판정 제외 (오탐 방지).
  add('turkey', input.mode !== 'spare' && input.mode !== 'obstacle' && maxConsecutiveStrikes(input.rolls, input.frames) >= 3);
  return fresh;
}
