import { rollStats } from './Scoreboard';
import type { GameMode } from './GameState';
import { t } from '../i18n';

/**
 * 하이스코어 + 통계 (localStorage, 로드맵 P1).
 * 모드별 분리 저장 — full(10프레임)만 평균/스트라이크%/스페어%까지,
 * blitz/spare는 최고 기록과 판수만 의미가 있다.
 */

export interface ModeStats {
  best: number;
  games: number;
  totalScore: number;
  strikes: number;
  strikeChances: number;
  spares: number;
  spareChances: number;
}

const KEY = 'starlite.stats.v1';
const LEGACY_KEY = 'bowling3d.stats.v1'; // 구 이름(NEON LANES) 시절 키 — migrateLegacy()가 한 번 옮긴다
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


const emptyStats = (): ModeStats => ({
  best: 0,
  games: 0,
  totalScore: 0,
  strikes: 0,
  strikeChances: 0,
  spares: 0,
  spareChances: 0,
});

export function loadStats(): Record<string, ModeStats> {
  migrateLegacy();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    // 형태 방어(#3): JSON.parse는 파싱 throw만 막고 "유효 JSON·잘못된 형태"는 통과한다.
    // 손상/레거시 엔트리({} 또는 부분 필드)가 있으면 best/games 등이 undefined가 되어
    // recordGame의 Math.max(undefined, …)나 statsSummary의 나눗셈이 NaN이 되고, 그대로 재저장돼
    // "평균 NaN·스트라이크 NaN%"로 고착된다. 각 엔트리를 emptyStats()에 병합해 숫자 필드를 항상 보장.
    // (settings.ts { ...DEFAULTS, ...parsed } / rewards.ts 필드검증과 동일한 방어 관용구.)
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, ModeStats> = {};
    for (const [mode, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (v && typeof v === 'object') clean[mode] = { ...emptyStats(), ...(v as Partial<ModeStats>) };
    }
    return clean;
  } catch {
    return {}; // 시크릿 모드 등 localStorage 불가 환경 — 통계 없이 동작
  }
}

/** 게임 종료 시 1회 호출 (사람 플레이어 기록만). newBest 여부 반환. */
export function recordGame(
  mode: GameMode,
  score: number,
  rolls: number[][],
  frames: number,
): { newBest: boolean; best: number } {
  const all = loadStats();
  const s = all[mode] ?? emptyStats();
  const newBest = score > s.best;
  s.best = Math.max(s.best, score);
  s.games += 1;
  s.totalScore += score;
  if (mode !== 'spare') {
    const rs = rollStats(rolls, frames);
    s.strikes += rs.strikes;
    s.strikeChances += rs.strikeChances;
    s.spares += rs.spares;
    s.spareChances += rs.spareChances;
  }
  all[mode] = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // 저장 실패는 치명적이지 않음
  }
  return { newBest, best: s.best };
}

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

/** 메뉴 표시용 요약 문자열들 */
export function statsSummary(): { full: string; blitz: string; spare: string } {
  const all = loadStats();
  const f = all['full'];
  const b = all['blitz'];
  const sp = all['spare'];
  // `count`는 복수형 스위치다 — 영어만 `(1 game)` / `(3 games)`로 갈린다(i18n/index.ts 규칙 3).
  return {
    full: f
      ? t('stats.full', {
          best: f.best,
          avg: Math.round(f.totalScore / f.games),
          strikePct: pct(f.strikes, f.strikeChances),
          sparePct: pct(f.spares, f.spareChances),
          count: f.games,
        })
      : t('stats.none'),
    blitz: b ? t('stats.blitz', { best: b.best, count: b.games }) : t('stats.none'),
    spare: sp ? t('stats.spare', { best: sp.best, count: sp.games }) : t('stats.none'),
  };
}
