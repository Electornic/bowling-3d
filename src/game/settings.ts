// 사용자 설정 — localStorage 영속. stats.v1·rewards.v1과 같은 `starlite.*` 컨벤션.
// 사운드·햅틱·그래픽 품질·언어는 물리/밸런스/기록에 영향이 없고, **볼 무게만 예외**다:
// 물리에 영향을 주지만 "매번 다시 고르게 하지 말자"는 이유로 함께 저장한다(2026-09-01).
// 시작 메뉴와 일시정지 모달 둘 다에서 바꿀 수 있고, 적용 시점은 GameState.setHumanBallSpec이 가른다.
// ⚠️ 오일 패턴은 여전히 **매치 시작에 굳는다** — 도중에 바꾸면 점수 일관성이 깨진다(선택 UI는 없다).
import type { LocaleSetting } from '../i18n';

export type Quality = 'high' | 'perf';

export interface Settings {
  sound: boolean;
  haptics: boolean;
  quality: Quality;
  /** 표시 언어. 'auto' = 기기 언어를 따른다(i18n.detectLocale). 저장값은 로케일 코드. */
  lang: LocaleSetting;
  /** 볼 무게(lb, 6~16). 슬라이더의 마지막 선택을 기억한다 — 매 판 다시 고르지 않게. */
  ballLb: number;
}

const KEY = 'starlite.settings.v1';
const LEGACY_KEY = 'bowling3d.settings.v1'; // 구 이름(NEON LANES) 시절 키 — migrateLegacy()가 한 번 옮긴다
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

const DEFAULTS: Settings = { sound: true, haptics: true, quality: 'high', lang: 'auto', ballLb: 10 };

export function loadSettings(): Settings {
  migrateLegacy();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged = { ...DEFAULTS, ...parsed }; // 누락 키는 기본값으로 메움(스키마 진화 안전)
    // 무게만 값 검증 — 슬라이더 범위 밖 값이 저장돼 있으면 물리 상수가 이상해진다(손상된 저장소·구버전).
    if (!Number.isFinite(merged.ballLb) || merged.ballLb < 6 || merged.ballLb > 16) merged.ballLb = DEFAULTS.ballLb;
    return merged;
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
