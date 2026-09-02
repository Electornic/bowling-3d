import { describe, it, expect } from 'vitest';
import { PIN_ROWS, PIN_SPACING, ROW_GAP, HEADPIN_Z } from '../../src/game/constants';
import { PIN_NUMBERS } from '../../src/game/splits';
import { DISPLAY_ROWS } from '../../src/ui/PinDeck';

/**
 * 남은 핀 인디케이터(PinDeck)의 **좌우·앞뒤가 실제 씬과 같은 방향을 가리키는지**.
 *
 * 이건 눈으로 안 잡힌다: 도면이 거울상이 되어도 에러가 안 나고, 씬의 핀은 조준 화면에서
 * 폭 6px·행 간 1.3px라 육안 대조가 불가능하다(PinDeck 헤더 주석의 실측). 그런데 틀리면
 * 플레이어가 반대쪽을 노린다 — 인디케이터가 있는 것보다 없는 게 나은 상태가 된다.
 *
 * 그래서 **world 좌표에서 독립적으로 유도해** 대조한다. 기준은 splits.ts의 규칙 두 개:
 *   · 번호는 행 내 x **내림차순**으로 매긴다 (볼러 왼쪽부터)
 *   · world +x = 화면 왼쪽
 * 따라서 "화면 왼쪽→오른쪽" = "x 내림차순" = "번호 오름차순"이어야 한다.
 */

/** 인덱스 → world (x, z). PinSet 생성 순서(행별, PIN_ROWS 순서)와 같다. */
const GEOM = (() => {
  const out: { x: number; z: number }[] = [];
  PIN_ROWS.forEach((cols, r) => {
    for (const c of cols) out.push({ x: c * PIN_SPACING, z: HEADPIN_Z + r * ROW_GAP });
  });
  return out;
})();

const geomOf = (num: number) => GEOM[PIN_NUMBERS.indexOf(num)];

describe('PinDeck 도면 배치', () => {
  it('10개 핀을 빠짐없이 한 번씩 담는다', () => {
    const flat = DISPLAY_ROWS.flat();
    expect(flat.length).toBe(GEOM.length);
    expect([...flat].sort((a, b) => a - b)).toEqual([...PIN_NUMBERS].sort((a, b) => a - b));
  });

  it('행 구성이 핀덱 격자와 같다 (뒷줄 4 → 헤드핀 1)', () => {
    expect(DISPLAY_ROWS.map((r) => r.length)).toEqual([...PIN_ROWS].reverse().map((r) => r.length));
  });

  it('위 행이 더 먼 행이다 — 볼러 시점의 +z가 화면 위', () => {
    const zs = DISPLAY_ROWS.map((row) => geomOf(row[0]).z);
    for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeLessThan(zs[i - 1]);
  });

  it('행 내 좌→오 = world x 내림차순 (화면 왼쪽이 +x) — 거울상 방지', () => {
    for (const row of DISPLAY_ROWS) {
      const xs = row.map((n) => geomOf(n).x);
      for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan(xs[i - 1]);
    }
  });

  it('한 행의 핀들은 같은 z에 있다 (행을 잘못 묶지 않았다)', () => {
    for (const row of DISPLAY_ROWS) {
      const zs = row.map((n) => geomOf(n).z);
      for (const z of zs) expect(z).toBeCloseTo(zs[0], 9);
    }
  });
});
