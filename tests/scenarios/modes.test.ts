import { describe, it, expect } from 'vitest';
import { createMatch } from '../helpers/fakeScene';
import { SPARE_LEAVES } from '../../src/game/GameState';
import { PIN_NUMBERS } from '../../src/game/splits';

/**
 * 풀게임 말고 나머지 두 모드 — 블리츠(3프레임)와 스페어 챌린지(10라운드 1구).
 *
 * 둘 다 `frames`와 정산 경로만 다르고 같은 상태머신을 탄다. 그래서 조용히 깨지는 자리도
 * 같다: 마지막 프레임 규칙이 3프레임에 안 붙거나, 스페어 모드가 있지도 않은 핀세터를 돌린다.
 */

describe('블리츠 (3프레임)', () => {
  const blitz = () => createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });

  it('프레임 수가 3이고 5구 퍼펙트가 90', () => {
    const m = blitz();
    expect(m.hud.last.frames).toBe(3);

    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(90);
    expect(m.summary?.frames).toBe(3);
  });

  it('마지막 프레임 보너스 규칙이 3프레임에 그대로 붙는다 — 올 스페어 45', () => {
    const m = blitz();
    for (let i = 0; i < 3; i++) { m.roll({ knock: 5 }); m.roll({ knock: 5 }); }
    m.roll({ knock: 5 }); // 3프레임 스페어 보너스

    expect(m.summary?.players[0].score).toBe(45);
    expect(m.summary?.players[0].rolls).toEqual([[5, 5], [5, 5], [5, 5, 5]]);
  });

  it('3프레임 오픈이면 보너스 없이 끝난다', () => {
    const m = blitz();
    for (let i = 0; i < 2; i++) { m.roll({ knock: 9 }); m.roll({ knock: 0 }); }
    m.roll({ knock: 4 });
    m.roll({ knock: 3 });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].rolls[2]).toEqual([4, 3]);
  });
});

describe('스페어 챌린지 (10라운드 · 라운드당 1구)', () => {
  const spare = () => createMatch({ mode: 'spare', players: [{ name: 'ME' }] });
  const numbersOf = (mask: boolean[]) => PIN_NUMBERS.filter((_, i) => mask[i]).sort((a, b) => a - b);

  it('첫 라운드는 SPARE_LEAVES[0] 배치로 시작한다', () => {
    const m = spare();

    expect(m.hud.last.frames).toBe(SPARE_LEAVES.length);
    expect(m.pins.standingNumbers()).toEqual([...SPARE_LEAVES[0]].sort((a, b) => a - b));
  });

  it('라운드마다 코스 순서대로 배치가 갈린다', () => {
    const m = spare();
    for (let round = 0; round < 4; round++) {
      expect(m.pins.standingNumbers()).toEqual([...SPARE_LEAVES[round]].sort((a, b) => a - b));
      m.roll(); // 전부 처리
    }
  });

  it('핀세터 사이클을 돌지 않는다 — 레이아웃을 갈아끼운다', () => {
    const m = spare();
    m.roll();
    m.roll();

    expect(m.pins.cycles).toEqual([]);
    expect(m.game.readyToThrow).toBe(true);
  });

  it('전부 성공하면 점수 = 변환 수 10', () => {
    const m = spare();
    for (let i = 0; i < SPARE_LEAVES.length; i++) m.roll();

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(SPARE_LEAVES.length);
    expect(m.events.filter((e) => e.type === 'spare')).toHaveLength(SPARE_LEAVES.length);
  });

  it('놓친 라운드는 세지 않는다 — 남긴 핀이 하나라도 있으면 실패', () => {
    const m = spare();
    m.roll(); // 6-10 성공
    m.roll({ leave: [SPARE_LEAVES[1][0]] }); // 버킷에서 하나 남김 = 실패
    for (let i = 2; i < SPARE_LEAVES.length; i++) m.roll();

    expect(m.summary?.players[0].score).toBe(SPARE_LEAVES.length - 1);
  });

  it('1구뿐이라 라운드 2구가 없다 — 실패해도 곧장 다음 배치로', () => {
    const m = spare();
    m.roll({ knock: 0 });

    expect(m.game.frame).toBe(2);
    expect(m.game.ball).toBe(1);
    expect(numbersOf(m.hud.last.standing!)).toEqual([...SPARE_LEAVES[1]].sort((a, b) => a - b));
  });

  it('스플릿 연출은 안 뜬다 — 풀랙에 던진 게 아니다', () => {
    const m = spare();
    // 코스에 7-10(피날레)이 있지만 standingAtThrow가 10이 아니라 스플릿 게이트를 안 탄다
    for (let i = 0; i < SPARE_LEAVES.length; i++) m.roll();

    expect(m.events.some((e) => e.type === 'splitConverted')).toBe(false);
  });
});
