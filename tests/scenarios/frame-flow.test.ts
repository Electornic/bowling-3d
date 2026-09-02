import { describe, it, expect } from 'vitest';
import { createMatch } from '../helpers/fakeScene';

/**
 * 프레임 안에서 벌어지는 일 — 1구와 2구 사이, 그리고 프레임과 프레임 사이.
 *
 * 특히 **핀세터 게이팅**: 실제 볼링장은 직렬이라 기계가 다 돌아야 다음 공을 던진다.
 * 예전엔 사이클과 조준이 병렬로 돌아 레이크가 데드우드를 미는 중에 던질 수 있었고,
 * `throwBall`의 `finishCycle()`이 연출을 끊어 핀이 순간이동했다(`GameState.readyToThrow` 주석).
 * 그 회귀를 여기서 잡는다.
 */
const solo = () => createMatch({ mode: 'full', players: [{ name: 'ME' }] });

describe('1구 → 2구', () => {
  it('핀이 남으면 리스팟 사이클을 돌고 2구로 — 프레임은 그대로', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });

    expect(m.pins.cycles).toEqual(['respot']);
    expect(m.game.frame).toBe(1);
    expect(m.game.ball).toBe(2);
    expect(m.game.state).toBe('AIMING');
    expect(m.pins.standingNumbers()).toEqual([7, 10]); // 되놓아진 잔존 핀
  });

  it('스트라이크면 2구 없이 새 랙 + 다음 프레임', () => {
    const m = solo();
    m.roll({ knock: 10 });

    expect(m.pins.cycles).toEqual(['rack']);
    expect(m.game.frame).toBe(2);
    expect(m.game.ball).toBe(1);
    expect(m.pins.standingCount()).toBe(10);
  });

  it('2구까지 던지면 남은 핀이 있어도 프레임이 끝나고 새 랙', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });
    m.roll({ leave: [10] }); // 7만 처리, 10 남김 = 오픈 프레임

    expect(m.pins.cycles).toEqual(['respot', 'rack']);
    expect(m.game.frame).toBe(2);
    expect(m.pins.standingCount()).toBe(10);
    expect(m.game.rolls[0]).toEqual([8, 1]);
  });

  it('투구마다 공이 리셋된다', () => {
    const m = solo();
    const before = m.ball.resets;
    m.roll({ leave: [7, 10] });
    m.roll({ knock: 2 });

    expect(m.ball.resets).toBeGreaterThanOrEqual(before + 2); // 2구 준비 + 다음 프레임 준비
  });
});

describe('핀세터 게이팅 — 기계가 도는 동안엔 못 던진다', () => {
  it('사이클 중 readyToThrow가 false다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] }, { drain: false });

    expect(m.pins.cycling).toBe(true);
    expect(m.game.state).toBe('AIMING'); // 조준 상태이긴 하지만
    expect(m.game.readyToThrow).toBe(false); // 던질 수는 없다
  });

  it('사이클 중 throwBall을 불러도 무시된다 — 상태도 rolls도 안 변한다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] }, { drain: false });
    const rollsBefore = JSON.stringify(m.game.rolls);

    m.game.throwBall(0, 1, 0);

    expect(m.game.state).toBe('AIMING');
    expect(JSON.stringify(m.game.rolls)).toBe(rollsBefore);
  });

  it('사이클이 끝나면 다시 던질 수 있다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] }, { drain: false });
    expect(m.game.readyToThrow).toBe(false);

    m.drainCycle();

    expect(m.pins.cycling).toBe(false);
    expect(m.game.readyToThrow).toBe(true);
  });

  it('사이클이 끝나는 순간 HUD가 1회 갱신된다 — 남은 핀 수·라벨 확정 지점', () => {
    const m = solo();
    m.roll({ leave: [7, 10] }, { drain: false });
    const viewsBefore = m.hud.views.length;
    expect(m.hud.last.resetting).toBe(true);

    m.drainCycle();

    expect(m.hud.views.length).toBeGreaterThan(viewsBefore);
    expect(m.hud.last.resetting).toBe(false);
    expect(m.hud.last.standing?.filter(Boolean)).toHaveLength(2);
  });
});

describe('리스팟 vs 새 랙', () => {
  it('리스팟은 선 핀만 그대로 두고 데드우드를 치운다', () => {
    const m = solo();
    m.roll({ leave: [2, 4, 5, 8] }); // 버킷

    expect(m.pins.standingNumbers()).toEqual([2, 4, 5, 8]);
    expect(m.pins.standingCount()).toBe(4);
  });

  it('새 랙은 프레임이 어떻게 끝났든 10개를 되돌린다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });
    m.roll({ leave: [10] }); // 오픈으로 끝

    expect(m.pins.standingNumbers()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
