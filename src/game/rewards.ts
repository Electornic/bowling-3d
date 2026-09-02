import type { GameMode } from './GameState';
import type { I18nKey } from '../i18n';

/**
 * 보상 시스템 (로드맵 ③ 승리 보상) — 업적(뱃지) + 코스메틱 볼 스킨. 설계: docs/legacy/REWARDS.md.
 * 스킨 = 머티리얼 파라미터만(물리/AI 사다리 무영향, §3 불변식). 과금·가챠 없음, localStorage.
 * v1 = core 업적 6 + classic 포함 7스킨. stretch(perfect/spare_master/clean)·애니 스킨은 P5.
 */

export type SkinFinish = 'matte' | 'satin' | 'metallic' | 'chrome' | 'glow' | 'gloss';

/** 볼 스킨 — 외형 전용(§3 #1). massKg·maxSpeedScale 불가침. */
export interface BallSkin {
  id: string;
  /**
   * 표시 이름은 **키로 들고 있는다**(문자열이 아니다). 이 레코드는 모듈 로드 시점에 만들어지는데
   * 그때는 로케일이 아직 정해지지 않았고, 문자열을 굳혀 두면 언어를 바꿔도 옛 언어로 남는다.
   */
  labelKey: I18nKey;
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
  /** 뱃지 이름·설명도 키다 — BallSkin.labelKey와 같은 이유. */
  badgeKey: I18nKey;
  descKey: I18nKey;
  reward: string; // SkinId
  tier: AchievementTier;
}

/**
 * 기본·항상 해금 스킨 = **하우스 볼**. AI 볼·미해금 시 폴백.
 * 색은 무게가 정한다(BallSpec.houseBallColor — 실제 공용 공처럼 무게별 무지개). 마감은 광택 폴리에스터 하나:
 * 금속성 0, 낮은 러프니스로 하이라이트만 또렷하게. 전엔 '클래식·메탈릭'이었는데 메탈릭이면 크롬과 겹치고,
 * 실물 하우스 볼은 금속이 아니다(2026-09-02). id는 'classic' 그대로 — localStorage 장착값 호환.
 */
export const CLASSIC_SKIN: BallSkin = {
  id: 'classic',
  labelKey: 'skin.house',
  finish: 'gloss',
  useWeightColor: true,
  roughness: 0.18,
  metalness: 0.0,
  envMapIntensity: 1.0,
};

/**
 * v1 스킨 카탈로그(§7). obsidian·holo·pulse는 stretch라 P5.
 *
 * 2026-09-02 톤 재조정 — 글로우 4종이 네온 플라스틱처럼 빛나 하우스 팔레트(크림·브릭·머스터드·터쿼이즈·월넛)와
 * 어긋났다(사용자 지적: 네온·글래스를 걷어낸 UI와 공만 딴 세상). 마감의 다양성(새틴·글로우·크롬)은 보상 정체성이라
 * 유지하고, **색을 팔레트 안으로, 발광은 절반 이하로** 내렸다: 글로우는 "빛나는 공"이 아니라 "속에서 은은히
 * 달아오른 공"으로. 물리 파라미터는 없다(§3 불변식).
 *   satin  — 푸른 흰색 → 크림. 하우스 종이 색.
 *   ember  — 주황 네온 → 그을린 시에나 위에 브릭 발광(불씨).
 *   galaxy — 바이올렛 네온 → 잉크 네이비 위에 낮은 바이올렛(밤하늘).
 *   volt   — 형광 옐로 → 올리브 위에 머스터드 발광(백열 필라멘트).
 *   sunset — 핫핑크 → 로즈 위에 브릭 발광(석양 잔광).
 */
export const SKINS: Record<string, BallSkin> = {
  classic: CLASSIC_SKIN,
  satin: { id: 'satin', labelKey: 'skin.satin', finish: 'satin', color: 0xebe4d6, roughness: 0.45, metalness: 0.15, envMapIntensity: 0.8, decorColor: 0x2a2320 },
  ember: { id: 'ember', labelKey: 'skin.ember', finish: 'glow', color: 0x5a1e0a, roughness: 0.5, metalness: 0.1, emissive: 0xc8102e, emissiveIntensity: 0.45, decorColor: 0xf3d9b8 },
  chrome: { id: 'chrome', labelKey: 'skin.chrome', finish: 'chrome', color: 0xdfe6ee, roughness: 0.04, metalness: 1.0, envMapIntensity: 1.4, decorColor: 0x1a2230 },
  galaxy: { id: 'galaxy', labelKey: 'skin.galaxy', finish: 'glow', color: 0x1c1a3a, roughness: 0.4, metalness: 0.3, emissive: 0x4b3fb0, emissiveIntensity: 0.35, decorColor: 0xcdbcff },
  volt: { id: 'volt', labelKey: 'skin.volt', finish: 'glow', color: 0x3a3006, roughness: 0.45, metalness: 0.1, emissive: 0xe0a12b, emissiveIntensity: 0.5, decorColor: 0x2a2200 },
  sunset: { id: 'sunset', labelKey: 'skin.sunset', finish: 'glow', color: 0xc94a5a, roughness: 0.5, metalness: 0.1, emissive: 0xe0632b, emissiveIntensity: 0.35, decorColor: 0x3b0d18 },
};

// --- 상대 공 스킨 (언락 대상 아님 — SKINS 레코드에 안 넣어 컬렉션에 노출되지 않음) ---
// AI: 난이도별 신스랭크 팔레트 + 은은한 글로우 (초보=시안 / 중수=바이올렛 / 고수=마젠타). key는 AI_PROFILES와 일치.
export const RIVAL_SKINS: Record<string, BallSkin> = {
  kim: { id: 'rival-kim', labelKey: 'ai.kim', finish: 'glow', color: 0x22d3ee, roughness: 0.4, metalness: 0.3, emissive: 0x22d3ee, emissiveIntensity: 0.5, decorColor: 0x06323a },
  yoon: { id: 'rival-yoon', labelKey: 'ai.yoon', finish: 'glow', color: 0xa855f7, roughness: 0.4, metalness: 0.3, emissive: 0xa855f7, emissiveIntensity: 0.5, decorColor: 0x2a1147 },
  han: { id: 'rival-han', labelKey: 'ai.han', finish: 'glow', color: 0xf0369b, roughness: 0.4, metalness: 0.3, emissive: 0xf0369b, emissiveIntensity: 0.5, decorColor: 0x4a0a2e },
};
/** v1 업적(§6 core 6). 전부 gameOver 데이터로 판정. */
export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first_game', badgeKey: 'ach.first_game', descKey: 'ach.first_game.desc', reward: 'satin', tier: 'core' },
  { id: 'beat_kim', badgeKey: 'ach.beat_kim', descKey: 'ach.beat_kim.desc', reward: 'ember', tier: 'core' },
  { id: 'beat_han', badgeKey: 'ach.beat_han', descKey: 'ach.beat_han.desc', reward: 'chrome', tier: 'core' },
  { id: 'beat_yoon', badgeKey: 'ach.beat_yoon', descKey: 'ach.beat_yoon.desc', reward: 'galaxy', tier: 'core' },
  { id: 'score_200', badgeKey: 'ach.score_200', descKey: 'ach.score_200.desc', reward: 'volt', tier: 'core' },
  { id: 'turkey', badgeKey: 'ach.turkey', descKey: 'ach.turkey.desc', reward: 'sunset', tier: 'core' },
];

const KEY = 'starlite.rewards.v1';
const LEGACY_KEY = 'bowling3d.rewards.v1'; // 구 이름(NEON LANES) 시절 키 — migrateLegacy()가 한 번 옮긴다
/**
 * 구 키 일회성 인계 — 이름을 NEON LANES → STARLITE LANES로 바꾸면서 접두사가 `bowling3d.*` →
 * `starlite.*`로 갔다. 웹은 이미 배포돼 있어서 키만 갈면 **해금·설정·통계가 통째로 날아간다.**
 * 새 키가 비었고 구 키가 있으면 한 번 옮기고 구 키를 지운다.
 * ⚠️ 2026-10 이후엔 지워도 된다 — 그때쯤 활성 사용자는 전부 새 키를 갖는다.
 */
function migrateLegacy(): void {
  try {
    if (localStorage.getItem(KEY) != null) return;
    const old = localStorage.getItem(LEGACY_KEY);
    if (old == null) return;
    localStorage.setItem(KEY, old);
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* 시크릿 모드 등 — 인계 실패는 조용히 넘긴다(기본값으로 시작) */
  }
}


export interface RewardStore {
  earned: string[];
  selectedSkin: string;
  /**
   * 히든 보상 — 전광판 커스텀. core 업적을 **전부** 달성해야 열린다.
   * 스킨과 달리 업적 1개당 1개로 떨어지지 않는 '완주 보상'이라 별도 필드다.
   *
   * 값은 둘 중 하나다:
   *  · 이미지·GIF → data URL 그대로 (작아서 localStorage에 들어간다)
   *  · 비디오     → VIDEO_MARKER. 실제 Blob은 IndexedDB(screenStore.ts)에 있다.
   * 마커를 두는 이유: "설정돼 있나?" 판정과 해금·초기화 경로를 여기 한 곳에 유지하려고.
   */
  customScreen: string | null;
}

const emptyStore = (): RewardStore => ({ earned: [], selectedSkin: 'classic', customScreen: null });

export function loadRewards(): RewardStore {
  migrateLegacy();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyStore();
    const s = JSON.parse(raw) as Partial<RewardStore>;
    return {
      earned: Array.isArray(s.earned) ? s.earned.filter((x): x is string => typeof x === 'string') : [],
      selectedSkin: typeof s.selectedSkin === 'string' ? s.selectedSkin : 'classic',
      customScreen: typeof s.customScreen === 'string' ? s.customScreen : null,
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

/** 전광판에 적용할 미디어 — Menu → Boot → Environment로 넘어가는 형태. */
export type CustomScreenMedia = { kind: 'image'; src: string } | { kind: 'video'; blob: Blob };

/** 보상 스토어에 들어가는 '비디오가 설정됨' 마커 — 실물은 IndexedDB에 있다. */
export const VIDEO_MARKER = 'video';

/**
 * 전광판 커스텀 이미지 저장 (null=기본 마스킹 유닛 아트로 복귀).
 * ⚠️ 같은 localStorage 키에 들어가므로 저장 전에 반드시 축소·용량 검사를 거칠 것
 * (screenMedia.ts). 원본을 그대로 넣으면 5MB 쿼터를 한 방에 넘긴다.
 */
export function saveCustomScreen(dataUrl: string | null) {
  const store = loadRewards();
  store.customScreen = dataUrl;
  save(store);
}

/**
 * 전광판 커스텀 해금 조건 — **core 업적 전부**.
 * stretch 티어(perfect·spare_master·clean, P5 예정)는 일부러 뺐다. '전부'로 잡으면
 * 나중에 stretch가 추가될 때 이미 연 사람의 해금이 도로 잠긴다.
 */
export function isScreenCustomUnlocked(earned: string[]): boolean {
  return ACHIEVEMENTS.filter((a) => a.tier === 'core').every((a) => earned.includes(a.id));
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
  add('turkey', input.mode !== 'spare' && maxConsecutiveStrikes(input.rolls, input.frames) >= 3);
  return fresh;
}
