/**
 * 볼 모션 척도 sim — 게임의 발사 물리가 **실제 볼링 수치**와 어디서 어긋나는지 표로 뽑는다.
 *
 * 실행: `BALL_SIM=1 npx vitest run tests/ball-motion-sim.test.ts`  (평소엔 runIf 가드로 skip)
 *
 * 비교 기준(2026-09-02 레퍼런스 조사 — 커밋 본문·USBC·arXiv 2210.06753·Fröhlich):
 *   릴리스 17~21 mph(7.6~9.4 m/s) · 핀 도달 16~18 mph(7.2~8.0) · 레인 감속 2~3 mph(0.9~1.3 m/s) ·
 *   소요 2~3 s · 레브 200~600 rpm(순수 롤 ~700 rpm 대비 30~85%) · 브레이크포인트 40~45 ft(12.2~13.7 m) ·
 *   진입각 4~6°(이상 6) · 훅 총량 리그 8~15보드(22~41 cm), 크랭커 20보드+(55 cm+).
 *
 * 단정(BALL_SIM일 때만): 골드 띠 중앙(파워 0.75, 10 lb) 직구의 릴리스·도달 속도·감속이 위 범위 안.
 * 나머지는 표로만 — 스핀 축은 "어디까지 실제처럼"이 튜닝 대상이라 숫자를 고정하지 않는다.
 */
import { describe, it, expect } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { createHeadless, MASS_10LB, SCALE_10LB, CONTACT_Z } from '../helpers/headless';
import {
  RELEASE_SWEET_LO,
  RELEASE_SWEET_HI,
  MIN_SPEED,
  MAX_SPEED,
  SPIN_RATE,
  ROLL_RATIO,
  BALL_LINEAR_DAMPING,
  BALL_RADIUS,
  BALL_START_Z,
} from '../../src/game/constants';
import { oilEndZ, resetOil } from '../../src/game/oil';

declare const process: { env: Record<string, string | undefined> };

const MPH = 2.23694;
const FT = 3.28084;
const BOARD = 0.0274; // USBC 보드 폭
const f = (v: number | null, d = 1, w = 7) => (v === null ? 'n/a'.padStart(w) : v.toFixed(d).padStart(w));

describe.runIf(process.env.BALL_SIM)('볼 모션 척도 sim', () => {
  it('파워 × 스핀 그리드 — 실볼링 수치와 대조', { timeout: 300_000 }, async () => {
    await RAPIER.init();
    resetOil();
    const H = createHeadless();
    const sweetMid = (RELEASE_SWEET_LO + RELEASE_SWEET_HI) / 2;
    const fullRoll = ((MIN_SPEED + sweetMid * (MAX_SPEED - MIN_SPEED)) * SCALE_10LB) / BALL_RADIUS; // rad/s, 순수 롤
    console.log(
      `\n[상수] 속도 ${MIN_SPEED}~${MAX_SPEED} m/s (${(MIN_SPEED * MPH).toFixed(1)}~${(MAX_SPEED * MPH).toFixed(1)} mph) · 10lb ×${SCALE_10LB}` +
        ` · 골드띠 ${RELEASE_SWEET_LO}~${RELEASE_SWEET_HI} · 감쇠 ${BALL_LINEAR_DAMPING} · SPIN_RATE ${SPIN_RATE} rad/s (${((SPIN_RATE * 60) / (2 * Math.PI)).toFixed(0)} rpm 측면)` +
        ` · ROLL_RATIO ${ROLL_RATIO} (골드띠 중앙 전방 회전 ${((fullRoll * ROLL_RATIO * 60) / (2 * Math.PI)).toFixed(0)} rpm / 순수롤 ${((fullRoll * 60) / (2 * Math.PI)).toFixed(0)}) · 오일 endZ ${oilEndZ()} m (${(oilEndZ() * FT).toFixed(0)} ft)`,
    );

    // 레버 스윕: BALL_SIM_OVERRIDE='{"rollRatio":0.85,"spinRate":20};{"frictionK":0.1}' 처럼 ;로 여러 조합.
    // 각 조합은 골드 띠 3점 × 스핀 3점의 압축 표로 찍는다. 기본(오버라이드 없음)은 전체 그리드.
    const overrides = (process.env.BALL_SIM_OVERRIDE ?? '')
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => JSON.parse(s) as Record<string, number>);
    const compact = overrides.length > 0;
    const powers = compact ? [RELEASE_SWEET_LO, sweetMid, RELEASE_SWEET_HI] : [0.3, 0.5, RELEASE_SWEET_LO, sweetMid, RELEASE_SWEET_HI, 1.0];
    const spins = compact ? [0, 0.5, 1.0] : [0, 0.25, 0.5, 0.75, 1.0];
    const runs = compact ? overrides : [{}];
    const cells: { power: number; spin: number; r: ReturnType<typeof H.throwOnce> }[] = [];
    for (const override of runs) {
      console.log(
        `\n${compact ? `[override ${JSON.stringify(override)}]` : '[기본]'}` +
          '\n  pow  spin | rel m/s(mph) pins m/s(mph)  Δv m/s  time s | skidEnd m(ft) apex m(ft) | hook cm(boards) snap cm  entry°' +
          (compact ? '' : '\n  (apex = 훅만큼 바깥으로 조준해 헤드핀 정면에 들어오게 한 두 번째 투구에서 x가 최대인 z — 실볼링의 브레이크포인트 정의)'),
      );
      for (const power of powers) {
        for (const spin of spins) {
          const r = H.throwOnce({ aim: 0, power, spin, standing: [], steps: 360, massKg: MASS_10LB, speedScale: SCALE_10LB, override });
          if (!compact) cells.push({ power, spin, r });
          const dv = r.speedAtPins === null ? null : r.releaseSpeed - r.speedAtPins;
          // 애펙스: 훅을 상쇄하는 바깥 조준으로 다시 굴려 경로의 x 최대점 z를 찾는다(스핀 0이면 정의 없음)
          let apexZ: number | null = null;
          if (spin > 0 && r.hookAtContact !== null) {
            const aim = -r.hookAtContact / (CONTACT_Z - BALL_START_Z);
            const r2 = H.throwOnce({ aim, power, spin, standing: [], steps: 360, recordPath: true, massKg: MASS_10LB, speedScale: SCALE_10LB, override });
            let best = -Infinity;
            for (const [x, z] of r2.path!) {
              if (z > CONTACT_Z) break;
              if (x > best) {
                best = x;
                apexZ = z;
              }
            }
          }
          console.log(
            `  ${power.toFixed(2)} ${spin.toFixed(2)} | ${f(r.releaseSpeed, 2, 5)}(${f(r.releaseSpeed * MPH, 1, 4)}) ${f(r.speedAtPins, 2, 5)}(${f(r.speedAtPins === null ? null : r.speedAtPins * MPH, 1, 4)})` +
              `  ${f(dv, 2, 5)}  ${f(r.timeToPins, 2, 5)} | ${f(r.slipCloseZ, 1, 6)}(${f(r.slipCloseZ === null ? null : r.slipCloseZ * FT, 0, 3)}) ${f(apexZ, 1, 5)}(${f(apexZ === null ? null : apexZ * FT, 0, 3)})` +
              ` | ${f(r.hookAtContact === null ? null : r.hookAtContact * 100, 1, 6)}(${f(r.hookAtContact === null ? null : Math.abs(r.hookAtContact) / BOARD, 1, 4)}) ${f(r.snap === null ? null : r.snap * 100, 1, 6)}  ${f(r.entryAngleDeg, 1, 5)}`,
          );
        }
      }
    }
    if (compact) return; // 스윕 모드는 표만 — 게이트는 게임 상수(기본 실행)에만 건다

    // 게이트 — 골드 띠 중앙(가장 흔한 투구)이 실볼링 범위 안이어야 한다. 범위는 파일 상단 레퍼런스 그대로.
    const ref = cells.find((c) => c.power === sweetMid && c.spin === 0)!.r;
    expect(ref.releaseSpeed).toBeGreaterThanOrEqual(7.6); // 17 mph
    expect(ref.releaseSpeed).toBeLessThanOrEqual(9.4); // 21 mph
    expect(ref.speedAtPins).not.toBeNull();
    expect(ref.speedAtPins!).toBeGreaterThanOrEqual(7.2); // 16 mph
    expect(ref.speedAtPins!).toBeLessThanOrEqual(8.1); // 18 mph
    expect(ref.releaseSpeed - ref.speedAtPins!).toBeGreaterThanOrEqual(0.7); // ~1.5 mph (직구는 하한 살짝 아래까지 허용)
    expect(ref.releaseSpeed - ref.speedAtPins!).toBeLessThanOrEqual(1.35); // 3 mph
    expect(ref.timeToPins!).toBeGreaterThanOrEqual(2.0);
    expect(ref.timeToPins!).toBeLessThanOrEqual(3.0);
    // 풀스핀 골드 띠 중앙 — 진입각 4~6°, 훅 12~22보드(크랭커 영역), 애펙스는 apex 열 참고(표)
    const hook = cells.find((c) => c.power === sweetMid && c.spin === 1)!.r;
    expect(hook.entryAngleDeg!).toBeGreaterThanOrEqual(4);
    expect(hook.entryAngleDeg!).toBeLessThanOrEqual(6.5);
    expect(Math.abs(hook.hookAtContact!) / BOARD).toBeGreaterThanOrEqual(12);
    expect(Math.abs(hook.hookAtContact!) / BOARD).toBeLessThanOrEqual(22);
  });
});
