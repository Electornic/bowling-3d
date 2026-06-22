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
    return raw ? (JSON.parse(raw) as Record<string, ModeStats>) : {};
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
  if (mode !== 'spare' && mode !== 'obstacle' && mode !== 'power' && mode !== 'duckpin') {
    // 라운드형(스페어·장애물·파워)은 rolls가 1구/스테이지, 덕핀(#5)은 3구/프레임이라 rollStats(2구 가정)와
    // 안 맞아 스트라이크/스페어% 집계 제외 — 최고/평균/판수만 기록.
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
export function statsSummary(): {
  full: string;
  blitz: string;
  spare: string;
  obstacle: string;
  power: string;
  duckpin: string;
} {
  const all = loadStats();
  const f = all['full'];
  const b = all['blitz'];
  const sp = all['spare'];
  const ob = all['obstacle'];
  const pw = all['power'];
  const dp = all['duckpin'];
  return {
    full: f
      ? `최고 ${f.best} · 평균 ${Math.round(f.totalScore / f.games)} · 스트라이크 ${pct(f.strikes, f.strikeChances)}% · 스페어 ${pct(f.spares, f.spareChances)}% (${f.games}판)`
      : '기록 없음',
    blitz: b ? `최고 ${b.best} (${b.games}판)` : '기록 없음',
    spare: sp ? `최고 ${sp.best}/10 (${sp.games}판)` : '기록 없음',
    obstacle: ob ? `최고 ${ob.best}/10 (${ob.games}판)` : '기록 없음',
    power: pw ? `최고 ${pw.best}핀 (${pw.games}판)` : '기록 없음',
    duckpin: dp ? `최고 ${dp.best} · 평균 ${Math.round(dp.totalScore / dp.games)} (${dp.games}판)` : '기록 없음',
  };
}
