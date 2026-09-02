import { describe, it, expect, beforeAll } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { throwGutter, SETTLING_X, LATCH_X } from '../helpers/laneWorld';
import { AIM_RANGE, GUTTER_DEPTH, BALL_RADIUS } from '../../src/game/constants';

/**
 * 거터볼 행선지 스캔 (`GUTTER_SIM=1`) — 레인을 벗어난 공이 되돌아와 핀을 건드리는가.
 *
 * 배경: `GameState.update`의 거터 래치(`setPinCollision(false)`)는 ROLLING 분기 안에만 있는데,
 * SETTLING 전환 문턱(0.416)이 래치 문턱(0.525)보다 앞이라 현실적인 횡속에선 실행되지 않는다
 * (`scenarios/gutter-and-settle`가 그 사실을 붙잡고 있다). 여기서 재는 건 **그래서 실제로
 * 무효 핀폴이 생기는가**다 — [laneWorld.ts](../helpers/laneWorld.ts)가 거터·캐핑·킥백·피트까지
 * 실제 지오메트리를 그대로 세운다.
 *
 * 왜 중요한가: [Lane.ts](../../src/scene/Lane.ts)가 거터 깊이를 옛 0.13에서 규격 0.0476으로
 * 낮추면서 *"공 중심을 레인면 아래로 눌러 옆면이 막게 하던 역할은 이제 거터 래치가 대신한다"*고
 * 적었다. 그 대체재가 안 도는 것이다.
 */
// @types/node 미설치 환경 — env 게이트용 최소 선언 (다른 sim 파일과 같은 관용구)
declare const process: { env: Record<string, string | undefined> };

describe.runIf(process.env.GUTTER_SIM)('거터볼 행선지', () => {
  beforeAll(async () => { await RAPIER.init(); });

  /** 플레이어가 실제로 낼 수 있는 조준값(±AIM_RANGE=0.08) 안쪽만 쓴다 — 재현 가능한 상황이어야 의미가 있다. */
  const AIMS = [0.028, 0.032, 0.036, 0.04, 0.05, 0.06, 0.07, 0.08];
  const SPINS = [-1, 0, 1];
  const POWERS = [0.3, 0.6, 1.0];

  it('① 옛 배치(ROLLING 분기 안)면 래치가 안 걸리고 무효 핀폴이 난다 — 회귀 방어', () => {
    expect(AIMS[AIMS.length - 1]).toBeLessThanOrEqual(AIM_RANGE);
    const gutterSeat = -GUTTER_DEPTH + BALL_RADIUS; // 홈에 앉은 공 중심 y ≈ 0.061

    console.log(`\nSETTLING 문턱 |x|>${SETTLING_X.toFixed(3)} · 래치 문턱 |x|>${LATCH_X.toFixed(3)} · 거터 착좌 y≈${gutterSeat.toFixed(3)}\n`);
    console.log('aim    pw spin | 이탈z max|x|  y@max | 래치 복귀 minX  | 무효핀폴');
    console.log('-'.repeat(68));

    let fell = 0, latched = 0, returned = 0, invalid = 0, invalidPins = 0;
    for (const aim of AIMS) for (const power of POWERS) for (const spin of SPINS) {
      const r = throwGutter({ aim, power, spin, latchPlacement: 'rolling-branch' });
      if (!r.fellIntoGutter) continue;
      fell++;
      if (r.latchFires) latched++;
      if (r.returnedToLane) returned++;
      if (r.knockedAfterExit > 0) { invalid++; invalidPins += r.knockedAfterExit; }
      console.log(
        `${aim.toFixed(3)} ${power.toFixed(1)} ${spin.toString().padStart(2)}  |` +
          ` ${r.exitZ!.toFixed(1).padStart(5)} ${r.maxAbsX.toFixed(3)}  ${r.yAtMaxX.toFixed(3)} |` +
          `  ${r.latchFires ? 'O' : '.'}   ${r.returnedToLane ? 'O' : '.'}` +
          `  ${r.minXAfterExit === null ? '  -  ' : r.minXAfterExit.toFixed(3)}` +
          `@${r.zAtMinX === null ? ' -  ' : r.zAtMinX.toFixed(1).padStart(4)}${r.returnedBeforeKickback ? '조기' : '    '} |` +
          `   ${r.knockedAfterExit}${r.knockedAfterExit > 0 ? ' ⚠️' : ''}`,
      );
    }
    console.log('-'.repeat(68));
    console.log(`거터 홈까지 빠진 공 ${fell}개 — 래치 발동 ${latched} · 레인 복귀 ${returned} · 무효 핀폴 ${invalid}개 투구 / 총 ${invalidPins}핀\n`);

    // 옛 배치에선 래치가 한 번도 안 걸리고, 그 결과 무효 핀폴이 실제로 난다.
    expect(latched).toBe(0);
    expect(invalid).toBeGreaterThan(0);
  });

  it('② 현재 배치(상태 분기 밖)면 무효 핀폴이 0이다', () => {
    let old = 0, now = 0, latched = 0, fell = 0;
    for (const aim of AIMS) for (const power of POWERS) for (const spin of SPINS) {
      const a = throwGutter({ aim, power, spin, latchPlacement: 'rolling-branch' });
      if (!a.fellIntoGutter) continue;
      fell++;
      old += a.knockedAfterExit;
      const b = throwGutter({ aim, power, spin }); // 기본 = 현재 출하 동작
      now += b.knockedAfterExit;
      if (b.latchFires) latched++;
    }
    console.log(`\n무효 핀폴 총합 — 옛 배치 ${old}핀 → 현재 ${now}핀 (거터볼 ${fell}개 중 래치 발동 ${latched})\n`);

    expect(old).toBeGreaterThan(0);
    expect(now).toBe(0);
    expect(latched).toBe(fell); // 거터로 빠진 공은 예외 없이 잠긴다
  });

  it('④ 훅 측면력은 레인 밖 공에 걸리지 않는다 — 상태머신이 이미 막고 있다', () => {
    /**
     * `Ball.applySpinForce`는 `GameState.update`의 **ROLLING 분기 안에서만** 불린다. 그런데 ROLLING을
     * 벗어나는 문턱이 0.416이고 그때 공은 아직 레인 위(중심 0.416 + 반지름 0.109 = 레인 끝 0.525)다.
     * 즉 거터에 앉은 공에는 훅이 원래 안 걸린다 — 별도 가드가 필요 없다는 근거를 실측으로 남긴다.
     */
    let total = 0;
    for (const aim of AIMS) for (const power of POWERS) for (const spin of SPINS) {
      total += throwGutter({ aim, power, spin }).hookStepsOffLane;
    }
    console.log(`\n훅 임펄스가 레인 밖 공에 걸린 스텝 — ${total}회 (거터볼 ${AIMS.length * POWERS.length * SPINS.length}투구 전체)\n`);
    expect(total).toBe(0);
  });

  it('③ 레인에 남은 투구는 수정 전후가 완전히 같다 — 멀쩡한 핀폴을 죽이지 않는다', () => {
    /**
     * 오탐 검사. 대조군을 "정상 조준"으로 잡으면 안 된다 — 훅이 과하면 조준이 얌전해도
     * 거터로 빠지는 게 정상이다(실측: aim −0.02 · spin +0.5가 왼쪽 거터로 들어간다).
     * 물어야 할 건 **레인을 안 벗어난 투구가 수정에 영향을 받는가**다. 받으면 안 된다.
     */
    let onLaneShots = 0;
    let scoring = 0;
    for (const aim of [-0.02, -0.01, -0.005, 0, 0.005, 0.01, 0.02]) {
      for (const power of [0.5, 0.75, 1.0]) {
        for (const spin of [-1, -0.5, 0, 0.5, 1]) {
          const plain = throwGutter({ aim, power, spin }); // 현재 출하 동작
          if (plain.leftLane) continue; // 거터볼은 ①②의 몫
          onLaneShots++;
          if (plain.knocked > 0) scoring++;
          const oldPlacement = throwGutter({ aim, power, spin, latchPlacement: 'rolling-branch' });
          expect(plain.knocked, `aim=${aim} pw=${power} spin=${spin} 의 핀폴이 래치 이동으로 바뀌었다`).toBe(oldPlacement.knocked);
          expect(plain.latchFires).toBe(false);
        }
      }
    }
    console.log(`\n레인에 남은 투구 ${onLaneShots}개(그중 핀을 쓰러뜨린 것 ${scoring}개) — 수정 전후 핀폴 전부 동일\n`);
    expect(onLaneShots).toBeGreaterThan(20);
    expect(scoring).toBeGreaterThan(10);
  });
});
