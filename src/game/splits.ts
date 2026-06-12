import { PIN_ROWS, PIN_SPACING, ROW_GAP } from './constants';

/**
 * 스플릿 감지 (로드맵 P1). 순수 로직 — PinSet의 standingMask()를 받는다.
 *
 * 핀 인덱스 = PinSet 생성 순서(행별, PIN_ROWS 순서).
 * 핀 번호 = 볼링 표준(볼러 기준 왼쪽부터). world +x = 화면 왼쪽 = 볼러 왼쪽이므로
 * 행 내에서 x 내림차순으로 번호를 매긴다.
 *
 * 스플릿 판정(USBC 정의 근사): 헤드핀 다운 + 잔여 핀 2개 이상 +
 * 잔여 핀들이 인접 그래프에서 비연결. 인접 = 격자 이웃(중심거리 ≈ 12인치)
 * + 일직선 슬리퍼 쌍(2-8, 3-9 — 사이에 핀이 없어 스플릿이 아님).
 */

interface PinGeom {
  num: number;
  x: number;
  z: number;
}

// 인덱스별 (번호, 좌표). z는 헤드핀 기준 상대값이면 충분.
const GEOM: PinGeom[] = (() => {
  const out: PinGeom[] = [];
  let nextNum = 1;
  PIN_ROWS.forEach((cols, r) => {
    // 행 내 x 내림차순(볼러 왼쪽부터)으로 번호 부여 후, 생성 순서(cols 순)로 저장
    const xs = cols.map((c) => c * PIN_SPACING);
    const order = [...xs].sort((a, b) => b - a);
    for (const x of xs) {
      out.push({ num: nextNum + order.indexOf(x), x, z: r * ROW_GAP });
    }
    nextNum += cols.length;
  });
  return out;
})();

/** 인덱스 → 볼링 핀 번호 (1~10) */
export const PIN_NUMBERS: readonly number[] = GEOM.map((g) => g.num);

/** 핀 번호 → 인덱스 */
export function pinIndexByNumber(num: number): number {
  return GEOM.findIndex((g) => g.num === num);
}

// 인접 그래프: 격자 이웃(거리 ≤ 핀 간격×1.05) + 슬리퍼 쌍(2-8, 3-9)
const ADJ: boolean[][] = (() => {
  const n = GEOM.length;
  const adj = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const link = (i: number, j: number) => {
    adj[i][j] = true;
    adj[j][i] = true;
  };
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(GEOM[i].x - GEOM[j].x, GEOM[i].z - GEOM[j].z);
      if (d <= PIN_SPACING * 1.05) link(i, j);
    }
  }
  link(pinIndexByNumber(2), pinIndexByNumber(8));
  link(pinIndexByNumber(3), pinIndexByNumber(9));
  return adj;
})();

export interface SplitInfo {
  isSplit: boolean;
  /** 잔여 핀 번호 (오름차순) */
  pins: number[];
  /** 표시용 라벨, 예: "7-10" */
  label: string;
}

/** 1구 후 standingMask로 스플릿 판정. 헤드핀(인덱스 0) 다운 + 잔여 비연결. */
export function detectSplit(standing: boolean[]): SplitInfo {
  const pins = standing
    .map((s, i) => (s ? GEOM[i].num : -1))
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const label = pins.join('-');
  const none = { isSplit: false, pins, label };

  if (standing[0]) return none; // 헤드핀이 서 있으면 스플릿 아님
  if (pins.length < 2) return none;

  // 잔여 핀들의 연결 요소 수 (BFS)
  const idxs = standing.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const seen = new Set<number>([idxs[0]]);
  const queue = [idxs[0]];
  while (queue.length) {
    const cur = queue.pop()!;
    for (const next of idxs) {
      if (!seen.has(next) && ADJ[cur][next]) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return { isSplit: seen.size < idxs.length, pins, label };
}
