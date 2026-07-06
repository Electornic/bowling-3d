import { rollStats } from './Scoreboard';
import type { GameMode } from './GameState';

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

const KEY = 'bowling3d.stats.v1';

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
  return {
    full: f
      ? `최고 ${f.best} · 평균 ${Math.round(f.totalScore / f.games)} · 스트라이크 ${pct(f.strikes, f.strikeChances)}% · 스페어 ${pct(f.spares, f.spareChances)}% (${f.games}판)`
      : '기록 없음',
    blitz: b ? `최고 ${b.best} (${b.games}판)` : '기록 없음',
    spare: sp ? `최고 ${sp.best}/10 (${sp.games}판)` : '기록 없음',
  };
}
