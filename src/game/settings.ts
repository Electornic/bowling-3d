// 인게임 설정 (일시정지 모달) — localStorage 영속. stats.v1·rewards.v1과 같은 `bowling3d.*` 컨벤션.
// 물리/밸런스/기록에 영향 없는 항목만 둔다(사운드·햅틱·그래픽 품질·언어). 볼 무게·오일·난이도는 시작 메뉴 전용
// — 한 매치 도중 바꾸면 점수 일관성이 깨지므로 의도적으로 제외.
import type { LocaleSetting } from '../i18n';

export type Quality = 'high' | 'perf';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  quality: Quality;
  /** 표시 언어. 'auto' = 기기 언어를 따른다(i18n.detectLocale). 저장값은 로케일 코드. */
  lang: LocaleSetting;
}

const KEY = 'bowling3d.settings.v1';
const DEFAULTS: Settings = { sound: true, haptics: true, quality: 'high', lang: 'auto' };

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULTS, ...parsed }; // 누락 키는 기본값으로 메움(스키마 진화 안전)
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 저장 실패 무시 (프라이빗 모드 등) */
  }
}
