/**
 * AI 조준 캘리브레이션 스캔 — ai.ts의 POCKET_X_*·HOOK_DRIFT_*를 정하는 근거 표.
 *
 * 실행: `AI_CAL=1 npx vitest run tests/ai-calibrate.test.ts`
 *
 * 발사 오프셋 T(m) = aim × ENTRY_DIST 를 1cm 간격으로 스캔해 (스타일 × 파워)별 쓰러진 핀 수를 찍는다.
 * 결정 시뮬이라 표본 1개로 충분하다. 스트라이크(10)가 연속으로 나오는 밴드의 **중앙**이 그 스타일의 포켓이다.
 * 훅형의 T는 포켓 x + 훅 드리프트(발사 직선과 진입 x의 차)라, 직구 포켓과의 차이가 곧 HOOK_DRIFT다.
 * 오일은 하우스 하나(oil.ts). 마름에 따른 HOOK_DRIFT_SLOPE를 다시 적합하려면 AI_CAL_DRY=프레임수로
 * advanceOilDrying(n)을 적용한 레인에서도 찍는다.
 */
import { describe, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeadless } from '../helpers/headless';
import { ENTRY_DIST } from '../../src/game/ai';
import { OIL_END_Z, resetOil, advanceOilDrying, oilEndZ } from '../../src/game/oil';

declare const process: { env: Record<string, string | undefined> };

describe.runIf(process.env.AI_CAL)('AI 조준 캘리브레이션 스캔', () => {
  it('발사 오프셋 T → 쓰러진 핀 수 (스타일 × 파워 × 오일)', { timeout: 600_000 }, async () => {
    await RAPIER.init();
    const H = createHeadless();
    const styles = [
      { label: '직구 pw1.00', power: 1.0, spin: 0, from: -0.2, to: 0.2 },
      { label: '직구 pw0.95', power: 0.95, spin: 0, from: -0.2, to: 0.2 },
      { label: '직구 pw0.80', power: 0.8, spin: 0, from: -0.2, to: 0.2 }, // 스페어 처리 파워
      { label: '훅   pw1.00', power: 1.0, spin: 1, from: 0.1, to: 0.7 },
    ];
    // AI_CAL_DRY=n 이면 n프레임 마른 레인(endZ − min(0.12n, 1.5))에서도 찍는다 — 드리프트 기울기 적합용
    const dryFrames = Number(process.env.AI_CAL_DRY ?? 0);
    for (const frames of dryFrames > 0 ? [0, dryFrames] : [0]) {
      resetOil();
      advanceOilDrying(frames);
      console.log(`\n=== 오일 하우스 endZ ${OIL_END_Z} · 마름 ${frames}프레임 → 유효 endZ ${oilEndZ().toFixed(2)} ===`);
      for (const st of styles) {
        let line = `  ${st.label} | `;
        const strikes: number[] = [];
        for (let T = st.from; T <= st.to + 1e-9; T += 0.01) {
          const k = H.throwOnce({ aim: T / ENTRY_DIST, power: st.power, spin: st.spin }).knocked;
          if (k === 10) strikes.push(T);
          line += `${Math.round(T * 100)}:${k} `;
        }
        console.log(line);
        if (strikes.length) {
          const lo = Math.min(...strikes);
          const hi = Math.max(...strikes);
          console.log(`    → 스트라이크 T ${Math.round(lo * 100)}~${Math.round(hi * 100)}cm (${strikes.length}개) 중앙 ${(((lo + hi) / 2) * 100).toFixed(1)}cm`);
        } else console.log('    → 스트라이크 없음');
      }
    }
    resetOil();
  });
});
