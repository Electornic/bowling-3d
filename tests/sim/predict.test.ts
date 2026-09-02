/**
 * 조준선 적분기(predict.ts) ↔ Rapier 헤드리스 투구 대조.
 *
 * 조준선은 발사 물리를 폐형으로 근사한 별도 적분기라, 상수를 공유해도 **모델 모양**이 어긋나면
 * 선이 거짓말을 한다(공이 선과 다른 데로 간다). 여기서 같은 (aim·spin·power)를 둘 다 굴려
 * 같은 z에서의 x 차이를 잰다. 미리보기 끝(BALL_START_Z+7.5, 오일 존 안)에서는 cm 단위로 맞아야
 * 하고, 훅 구간 끝(z 17)에서도 폭주하지 않아야 한다(선을 브레이크 뒤로 늘리는 날을 위해).
 */
import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeadless, MASS_10LB, SCALE_10LB } from '../helpers/headless';
import { predictPath } from '../../src/game/predict';
import { BALL_START_Z } from '../../src/game/constants';
import { resetOil } from '../../src/game/oil';

const PREVIEW_END = BALL_START_Z + 7.5; // Controls.updateAimArrow의 endZ와 같은 값
const HOOK_END = 17.0;

/** 경로에서 z를 지나는 지점의 x를 선형 보간 */
function xAt(path: number[][], z: number): number | null {
  for (let i = 1; i < path.length; i++) {
    const [x0, z0] = path[i - 1];
    const [x1, z1] = path[i];
    if (z0 <= z && z1 >= z) return z1 === z0 ? x0 : x0 + ((z - z0) / (z1 - z0)) * (x1 - x0);
  }
  return null;
}

const CASES = [
  { aim: 0, spin: 0 },
  { aim: 0.02, spin: 0 },
  { aim: 0, spin: 1 },
  { aim: 0.02, spin: 1 },
  { aim: -0.015, spin: -0.5 },
  { aim: 0.01, spin: 0.5 },
];

describe('조준선 적분기 ↔ Rapier 대조', () => {
  beforeAll(async () => {
    await RAPIER.init();
    resetOil();
  });

  it('미리보기 구간(오일 존) 끝에서 x 오차 ≤ 2cm, 훅 구간 끝(z17)에서 ≤ 12cm', () => {
    const H = createHeadless();
    const rows: string[] = [];
    let worstPreview = 0;
    let worstHook = 0;
    for (const c of CASES) {
      const power = 0.6; // Controls가 조준선에 쓰는 대표 파워
      const sim = H.throwOnce({ aim: c.aim, power, spin: c.spin, standing: [], steps: 300, recordPath: true, massKg: MASS_10LB, speedScale: SCALE_10LB });
      const pred = predictPath({ aim: c.aim, power, spin: c.spin, massKg: MASS_10LB, speedScale: SCALE_10LB, endZ: HOOK_END, dt: 0.08, maxSteps: 400 });
      const sp = xAt(sim.path!, PREVIEW_END)!;
      const pp = xAt(pred, PREVIEW_END)!;
      const sh = xAt(sim.path!, HOOK_END);
      const ph = xAt(pred, HOOK_END);
      const ePreview = Math.abs(sp - pp) * 100;
      const eHook = sh === null || ph === null ? NaN : Math.abs(sh - ph) * 100;
      worstPreview = Math.max(worstPreview, ePreview);
      if (!Number.isNaN(eHook)) worstHook = Math.max(worstHook, eHook);
      rows.push(
        `aim ${c.aim.toFixed(3).padStart(6)} spin ${c.spin.toFixed(1).padStart(4)} | z${PREVIEW_END.toFixed(1)}: sim ${(sp * 100).toFixed(1).padStart(6)} pred ${(pp * 100).toFixed(1).padStart(6)} (Δ${ePreview.toFixed(1)}cm)` +
          ` | z17: sim ${sh === null ? '  n/a' : (sh * 100).toFixed(1).padStart(6)} pred ${ph === null ? '  n/a' : (ph * 100).toFixed(1).padStart(6)} (Δ${Number.isNaN(eHook) ? 'n/a' : eHook.toFixed(1)}cm)`,
      );
    }
    console.log('\n[predict ↔ rapier]\n  ' + rows.join('\n  '));
    expect(worstPreview).toBeLessThanOrEqual(2);
    expect(worstHook).toBeLessThanOrEqual(12);
  });
});
