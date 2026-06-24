/**
 * 레인 스킨 — 외형 전용 프리셋 (OPEN_WORLD_LOBBY §8 스킨/테마, 슬라이스 4).
 * 공 스킨(rewards.ts BallSkin)의 "스킨 = 머티리얼 파라미터" 패턴을 레인 바닥으로 확장.
 *
 * ⚠️ 물리 불가침(§8): 마찰·오일·훅은 oil.ts/constants가 소유 — 레인 스킨은 나무 톤·광택(roughness/
 * metalness)만 바꾼다. 해금/업적 없음(테마는 취향이라 그라인드 부적절) → 전부 선택 가능, localStorage 저장.
 */
export interface LaneSkin {
  id: string;
  label: string;
  light: string; // makeWoodTexture 밝은 판자 톤
  dark: string; // makeWoodTexture 어두운 판자 톤
  roughness: number;
  metalness: number;
}

/** 레인 스킨 카탈로그 — 나무 톤 3 + 모던 합성 1(에셋 0, 절차 텍스처 색만 교체). classic = 기존 기본값. */
export const LANE_SKINS: LaneSkin[] = [
  { id: 'classic', label: '클래식', light: '#c89048', dark: '#96682c', roughness: 0.48, metalness: 0.05 },
  { id: 'maple', label: '메이플', light: '#e6c188', dark: '#b58a4c', roughness: 0.42, metalness: 0.05 },
  { id: 'cherry', label: '체리', light: '#b86a44', dark: '#7c3c24', roughness: 0.4, metalness: 0.08 },
  { id: 'graphite', label: '그래파이트', light: '#3c4452', dark: '#1f2530', roughness: 0.3, metalness: 0.45 },
];

const KEY = 'bowling3d.laneSkin.v1';

/** 저장된 레인 스킨 id (없거나 미존재 id면 'classic'). */
export function loadLaneSkinId(): string {
  try {
    const id = localStorage.getItem(KEY);
    return id && LANE_SKINS.some((s) => s.id === id) ? id : 'classic';
  } catch {
    return 'classic'; // 시크릿 모드 등 localStorage 불가
  }
}

/** 레인 스킨 선택 저장 (미존재 id는 무시). */
export function saveLaneSkinId(id: string) {
  if (!LANE_SKINS.some((s) => s.id === id)) return;
  try {
    localStorage.setItem(KEY, id);
  } catch {
    // 저장 실패는 비치명적
  }
}

/** id → 레인 스킨 (없으면 classic). */
export function resolveLaneSkin(id: string): LaneSkin {
  return LANE_SKINS.find((s) => s.id === id) ?? LANE_SKINS[0];
}
