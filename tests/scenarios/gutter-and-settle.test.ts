import { describe, it, expect } from 'vitest';
import { createMatch, DT } from '../helpers/fakeScene';
import { LANE_WIDTH, GUTTER_WIDTH, GUTTER_DEPTH, BALL_RADIUS, SETTLE_TIMEOUT } from '../../src/game/constants';

/**
 * 잘 안 풀린 투구 — 거터, 레인 이탈, 핀이 안 멎는 상황.
 *
 * 사용자 체감으론 "공이 도랑에 빠졌다" 한 줄이지만 상태머신엔 갈래가 셋이다:
 * 핀 충돌 래치 · 모서리 perch 보정 · 정산 타임아웃. 셋 다 조용히 깨지면
 * "점수가 이상하다"·"공이 멈춘 채 게임이 안 넘어간다"로만 드러난다.
 */
const solo = () => createMatch({ mode: 'full', players: [{ name: 'ME' }] });

describe('거터', () => {
  it('0점으로 정산되고 gutter 이벤트가 뜬다', () => {
    const m = solo();
    const r = m.roll({ gutter: true });

    expect(r.knocked).toBe(0);
    expect(m.game.rolls[0]).toEqual([0]);
    expect(m.events.map((e) => e.type)).toContain('gutter');
    expect(m.game.ball).toBe(2); // 프레임은 계속된다
  });

  /**
   * 레인 이탈 래치 — 공 중심이 레인 폭(±0.525)을 벗어나면 그 투구 내내 핀 충돌을 끈다.
   *
   * ⚠️ 이 래치는 **상태 분기 밖**에서 돌아야 한다. 예전엔 ROLLING 분기 안에 있었는데,
   * SETTLING 전환 문턱(0.416)이 래치 문턱(0.525)보다 앞이라 공이 0.416에서 SETTLING으로
   * 빠져나간 뒤엔 코드가 더는 안 돌았다 — 실제 훅의 횡속(1~2 m/s)에선 한 번도 발동하지 않았고,
   * 그 결과 거터볼이 코너 핀을 쓰러뜨렸다(`sim/gutter-return-sim` 실측 113핀).
   * 아래 세 단정이 그 회귀를 붙잡는다.
   */
  it('현실적인 횡속(0.5~2 m/s)에서도 레인을 벗어나면 걸린다', () => {
    for (const vx of [0.5, 1, 2, 4, 6, 8]) {
      const m = solo();
      m.game.throwBall(0, 1, 0);
      m.ball.body.setLinvel({ x: vx, y: 0, z: 8 });
      for (let i = 0; i < 600 && !m.ball.pinCollisionOff && m.game.state !== 'AIMING'; i++) m.step();

      expect(m.ball.pinCollisionOff, `횡속 ${vx} m/s에서 래치가 안 걸렸다`).toBe(true);
    }
  });

  it('SETTLING으로 넘어간 뒤에 레인을 벗어나도 걸린다 (래치가 상태 분기 밖에 있다)', () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    m.ball.body.setLinvel({ x: 1, y: 0, z: 8 });
    // 0.416을 넘어 SETTLING이 될 때까지 — 이 시점엔 아직 0.525 미만이라 래치가 안 걸려 있다
    for (let i = 0; i < 600 && m.game.state === 'ROLLING'; i++) m.step();
    expect(m.game.state).toBe('SETTLING');
    expect(Math.abs(m.ball.body.translation().x)).toBeLessThan(LANE_WIDTH / 2);
    expect(m.ball.pinCollisionOff).toBe(false);

    // 계속 밀려나 0.525를 넘으면 — SETTLING인데도 걸려야 한다
    for (let i = 0; i < 600 && Math.abs(m.ball.body.translation().x) <= LANE_WIDTH / 2; i++) m.step();
    expect(m.ball.pinCollisionOff).toBe(true);
  });

  it('레인 안에 머무는 투구엔 안 걸린다 — 멀쩡한 핀폴을 죽이지 않는다', () => {
    const m = solo();
    m.roll({ knock: 10 }, { drain: false });

    expect(m.ball.pinCollisionOff).toBe(false);
  });

  it('래치는 다음 투구에서 풀린다 — 공 리셋이 되돌린다', () => {
    const m = solo();
    m.roll({ gutter: true }); // 정산·리셋까지 진행

    expect(m.ball.pinCollisionOff).toBe(false);
    expect(m.game.readyToThrow).toBe(true);
  });

  it('거터엔 임팩트가 없다 — 핀을 하나도 안 건드렸으니 슬로모도 크래시음도 없다', () => {
    const m = solo();
    m.roll({ gutter: true });

    expect(m.impacts).toHaveLength(0);
    expect(m.timeScales.every((s) => s === 1)).toBe(true);
  });

  it('거터 2연속이면 오픈 프레임 0점으로 넘어간다', () => {
    const m = solo();
    m.roll({ gutter: true });
    m.roll({ gutter: true });

    expect(m.game.frame).toBe(2);
    expect(m.game.rolls[0]).toEqual([0, 0]);
  });
});

describe('핀을 스치기만 한 투구', () => {
  it('임팩트는 나지만 점수는 0 — 거터와 달리 크래시음이 울린다', () => {
    const m = solo();
    const r = m.roll({ jostleOnly: true });

    expect(r.knocked).toBe(0);
    expect(m.impacts).toEqual([10]); // 던질 때 서 있던 핀 수를 넘긴다
    expect(m.events.map((e) => e.type)).toContain('gutter'); // knocked 0은 모드 무관 gutter 연출
  });

  it('임팩트는 투구당 정확히 1회다', () => {
    const m = solo();
    m.roll({ knock: 4 });

    expect(m.impacts).toHaveLength(1);
  });
});

describe('레인 끝 모서리 perch 보정', () => {
  /**
   * 느린 거터볼이 레인 끝 날카로운 모서리에 균형을 잡고 골로 안 빠지는 물리 아티팩트를
   * `GameState.settleGutterPerch()`가 결정적으로 정리한다. 여기선 공을 그 자세로 직접 세워놓고
   * 보정이 한 번만, 올바른 방향으로 도는지 본다.
   */
  const perchBall = () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    m.ball.body.setTranslation({ x: LANE_WIDTH / 2 + 0.01, y: BALL_RADIUS, z: 5 });
    m.ball.body.setLinvel({ x: 0, y: 0, z: 0.2 }); // 거의 멈춘 채 모서리를 타고 감
    return m;
  };

  it('공을 거터 골 중앙으로 옮기고 앞으로 굴려 보낸다', () => {
    const m = perchBall();
    m.step(3);

    const t = m.ball.body.translation();
    expect(t.x).toBeCloseTo(LANE_WIDTH / 2 + GUTTER_WIDTH / 2, 6); // 골 중앙
    expect(m.ball.body.linvel().z).toBeGreaterThan(1); // 멈춰 있지 않고 뒤끝까지 굴러간다
  });

  it('한 투구에 한 번만 보정한다 — 재스냅으로 공이 붙잡히지 않는다', () => {
    const m = perchBall();
    m.step(3);
    const vz1 = m.ball.body.linvel().z;
    m.step(3);

    expect(m.ball.body.linvel().z).toBe(vz1); // 두 번째 스텝에서 속도를 다시 덮지 않았다
  });

  it('보정 y가 규격 거터 깊이를 따른다 — 골 바닥에 정확히 앉는다', () => {
    // 예전엔 옛 거터 깊이 0.13을 하드코딩해 공을 골 바닥보다 8.2cm 아래로 처박았다
    // (Lane.ts는 이미 규격 GUTTER_DEPTH=0.0476로 옮겨간 뒤였다).
    const m = perchBall();
    m.step(3);

    expect(m.ball.body.translation().y).toBeCloseTo(BALL_RADIUS - GUTTER_DEPTH, 6);
  });

  it('이미 골에 앉은 공은 안 건드린다 — 얹힌 공만 보정 대상이다', () => {
    // 옛 가드(`t.y <= -0.01`)는 규격 깊이로 앉은 공 중심(+0.061)을 걸러내지 못해
    // **멀쩡히 골을 굴러가는 거터볼까지 매번 재보정**했다.
    const m = solo();
    m.game.throwBall(0, 1, 0);
    m.ball.body.setTranslation({ x: LANE_WIDTH / 2 + GUTTER_WIDTH / 2, y: BALL_RADIUS - GUTTER_DEPTH, z: 5 });
    m.ball.body.setLinvel({ x: 0, y: 0, z: 0.2 });
    m.step(3);

    expect(m.ball.body.linvel().z).toBeCloseTo(0.2, 6); // 전진 속도를 덮지 않았다
    expect(m.ball.body.translation().y).toBeCloseTo(BALL_RADIUS - GUTTER_DEPTH, 6);
  });
});

describe('정산 타임아웃', () => {
  it('핀이 영영 안 멎어도 SETTLE_TIMEOUT이 지나면 정산한다 — 게임이 멈추지 않는다', () => {
    const m = solo();
    const r = m.roll({ knock: 6, neverSettle: true });

    expect(r.knocked).toBe(6);
    expect(m.game.rolls[0]).toEqual([6]);
    expect(m.game.state).toBe('AIMING');
  });

  it('타임아웃 경로라도 프레임은 규칙대로 끝난다', () => {
    const m = solo();
    m.roll({ knock: 10, neverSettle: true }); // 안 멎는 스트라이크

    expect(m.game.frame).toBe(2);
    expect(m.events.some((e) => e.type === 'strike')).toBe(true);
  });

  it('타임아웃은 SETTLE_TIMEOUT 부근에서 걸린다 (즉시도, 무한도 아니다)', () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    let steps = 0;
    while (m.game.state === 'ROLLING' || m.game.state === 'SETTLING') {
      if (m.game.state === 'ROLLING') for (const p of m.pins.pins) p.jostle(Infinity);
      m.step();
      if (++steps > 4000) break;
    }
    // ROLLING 구간(공이 핀덱을 지나는 시간) + SETTLING 타임아웃
    expect(steps * DT).toBeGreaterThan(SETTLE_TIMEOUT);
    expect(steps * DT).toBeLessThan(SETTLE_TIMEOUT + 5);
  });
});
