import { describe, it, expect } from 'vitest';
import { createMatch } from '../helpers/fakeScene';
import { SLOWMO_SCALE, LANE_WIDTH, PIN_DECK_END } from '../../src/game/constants';

/**
 * 연출 피드백 계약 — 슬로모·크래시음·굴림 럼블·HUD 갱신.
 *
 * 전부 `GameState`가 콜백으로 밀어내는 값이라 화면 없이도 단정할 수 있다. 여기가 비면
 * "가끔 소리가 두 번 난다"·"거터인데 슬로모가 걸린다" 같은 회귀를 사람 눈으로만 잡게 된다.
 */
const solo = () => createMatch({ mode: 'full', players: [{ name: 'ME' }] });

describe('임팩트 (크래시음 + 슬로모)', () => {
  it('핀이 실제로 움직여야 발동한다 — 인자는 던질 때 서 있던 핀 수', () => {
    const m = solo();
    m.roll({ knock: 10 });
    expect(m.impacts).toEqual([10]);

    m.roll({ leave: [7, 10] }); // 2프레임 1구
    m.roll({ knock: 2 }); // 2구: 서 있던 핀 2개
    expect(m.impacts).toEqual([10, 10, 2]);
  });

  it('투구당 정확히 1회 — 같은 투구에서 핀이 또 움직여도 다시 안 운다', () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    for (let i = 0; i < 200 && m.game.state === 'ROLLING'; i++) {
      m.step();
      if (i === 60) for (const p of m.pins.pins) p.knockDown();
      if (i === 90) for (const p of m.pins.pins) p.jostle(); // 2차 충돌 흉내
    }

    expect(m.impacts).toHaveLength(1);
  });

  it('슬로모는 SLOWMO_SCALE에서 시작해 1.0으로 복원된다', () => {
    const m = solo();
    m.roll({ knock: 10 });

    // 첫 샘플은 이미 한 스텝(1/60) 소모된 뒤라 정확히 바닥값(SLOWMO_SCALE)은 아니다 —
    // computeTimeScale이 slowmoTimer를 깎고 나서 배속을 낸다. 바닥 아래로는 절대 안 내려간다.
    const min = Math.min(...m.timeScales);
    expect(min).toBeGreaterThanOrEqual(SLOWMO_SCALE);
    expect(min).toBeLessThan(SLOWMO_SCALE + 0.02);
    expect(m.timeScales[m.timeScales.length - 1]).toBe(1); // 끝나면 정상속도
  });

  it('거터엔 슬로모도 크래시음도 없다', () => {
    const m = solo();
    m.roll({ gutter: true });

    expect(m.impacts).toHaveLength(0);
    expect(Math.min(...m.timeScales)).toBe(1);
  });
});

describe('굴림 럼블 오디오', () => {
  it('레인 위를 구르는 동안 속도가 실리고, 핀덱을 넘으면 끊긴다', () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    for (let i = 0; i < 400 && m.ball.body.translation().z < PIN_DECK_END + 0.5; i++) m.step();

    expect(Math.max(...m.rollAudio.map((r) => r.speed))).toBeGreaterThan(1);
    expect(m.rollAudio[m.rollAudio.length - 1].speed).toBe(0); // 핀덱 뒤 = 무음
  });

  it('거터 홈에 들어가면 inGutter가 선다 — 음색 분기', () => {
    const m = solo();
    m.game.throwBall(0, 1, 0);
    m.ball.body.setLinvel({ x: LANE_WIDTH, y: 0, z: 8 });
    for (let i = 0; i < 400 && m.game.state !== 'AIMING'; i++) m.step();

    expect(m.rollAudio.some((r) => r.inGutter)).toBe(true);
  });

  it('조준 중엔 무음이다', () => {
    const m = solo();
    m.step(30);

    expect(m.rollAudio.every((r) => r.speed === 0)).toBe(true);
  });
});

describe('HUD 계약', () => {
  it('매치가 시작되면 모드·프레임 수·플레이어가 실린다', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }, { name: 'RIVAL' }] });

    expect(m.hud.last).toMatchObject({ state: 'AIMING', mode: 'full', frames: 10, current: 0 });
    expect(m.hud.last.players.map((p) => p.name)).toEqual(['ME', 'RIVAL']);
    expect(m.hud.last.standing).toHaveLength(10);
  });

  it('상태 전이마다 갱신된다 — ROLLING·SETTLING이 화면에 남지 않는다', () => {
    const m = solo();
    m.roll({ knock: 4 });

    const states = m.hud.views.map((v) => v.state);
    expect(states).toContain('ROLLING');
    expect(states).toContain('SETTLING');
    expect(m.hud.last.state).toBe('AIMING');
  });

  it('핀세터가 도는 동안 resetting이 서고, 끝나면 내려간다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] }, { drain: false });
    expect(m.hud.last.resetting).toBe(true);

    m.drainCycle();
    expect(m.hud.last.resetting).toBe(false);
  });

  it('남은 핀 마스크가 실제 핀 상태와 같다', () => {
    const m = solo();
    m.roll({ leave: [2, 4, 5, 8] });

    expect(m.hud.last.standing).toEqual(m.pins.standingMask());
    expect(m.hud.last.standing?.filter(Boolean)).toHaveLength(4);
  });

  it('게임이 끝나면 GAME_OVER가 마지막으로 실린다', () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });

    expect(m.hud.last.state).toBe('GAME_OVER');
  });

  it('메뉴로 나가면 플레이어가 비워지고 핀이 다시 선다', () => {
    const m = solo();
    m.roll({ knock: 4 });
    m.game.toMenu();

    expect(m.hud.last.state).toBe('MENU');
    expect(m.hud.last.players).toEqual([]);
    expect(m.pins.standingCount()).toBe(10);
  });
});
