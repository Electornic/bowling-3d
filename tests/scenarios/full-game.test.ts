import { describe, it, expect } from 'vitest';
import { createMatch, playOpenFrames } from '../helpers/fakeScene';

/**
 * 게임 한 판을 처음부터 끝까지 — 사용자가 "한 게임 쳤다"고 말할 때의 그 흐름.
 *
 * `Scoreboard.totalScore`는 이미 단위테스트가 있다. 여기서 보는 건 **상태머신이 그 함수에
 * 올바른 rolls를 먹이는가**다: 프레임이 제때 넘어가는지, 10프레임 보너스 투구가 규칙대로
 * 나오는지, 게임이 정확히 그 순간 끝나는지.
 */
const solo = () => createMatch({ mode: 'full', players: [{ name: 'ME' }] });

describe('풀게임 완주', () => {
  it('퍼펙트 게임 — 12구 전부 스트라이크로 300, 스트라이크 이벤트 12회', () => {
    const m = solo();
    for (let i = 0; i < 12; i++) m.roll({ knock: 10 });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(300);
    const streaks = m.events.filter((e) => e.type === 'strike').map((e) => (e as { streak: number }).streak);
    expect(streaks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(m.summary?.newBest).toBe(true);
  });

  it('올 거터 — 20구 0점, 거터 이벤트 20회, 프레임은 정상 진행', () => {
    const m = solo();
    for (let i = 0; i < 20; i++) m.roll({ gutter: true });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(0);
    expect(m.events.filter((e) => e.type === 'gutter')).toHaveLength(20);
    expect(m.summary?.players[0].rolls).toHaveLength(10);
  });

  it('올 스페어 (5,5)×10 + 보너스 5 = 150', () => {
    const m = solo();
    for (let i = 0; i < 10; i++) {
      m.roll({ knock: 5 });
      m.roll({ knock: 5 });
    }
    m.roll({ knock: 5 }); // 10프레임 스페어 보너스

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(150);
    expect(m.events.filter((e) => e.type === 'spare')).toHaveLength(10);
  });

  it('혼합 게임 — 위키백과 표준 예제 167점이 그대로 나온다', () => {
    const m = solo();
    const frames = [[10], [7, 3], [9, 0], [10], [0, 8], [8, 2], [0, 6], [10], [10], [10, 8, 1]];
    for (const f of frames) for (const n of f) m.roll({ knock: n });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(167);
    expect(m.summary?.players[0].rolls).toEqual(frames);
  });

  it('게임은 마지막 투구에서 정확히 끝난다 — 그 전까진 AIMING으로 돌아온다', () => {
    const m = solo();
    playOpenFrames(m, 9);
    expect(m.game.state).toBe('AIMING');
    expect(m.game.frame).toBe(10);

    m.roll({ knock: 9 });
    expect(m.game.state).toBe('AIMING'); // 10프레임 2구가 남았다
    m.roll({ knock: 0 });
    expect(m.game.state).toBe('GAME_OVER'); // 오픈이라 보너스 없음
  });
});

describe('10프레임 보너스 규칙', () => {
  it('1구 스트라이크 → 새 랙으로 2·3구', () => {
    const m = solo();
    playOpenFrames(m, 9);
    const from = m.pins.cycles.length;

    m.roll({ knock: 10 });
    expect(m.pins.cycles.slice(from)).toEqual(['rack']); // 다 치웠으니 새 랙
    expect(m.game.ball).toBe(2);
    m.roll({ knock: 4 });
    expect(m.game.ball).toBe(3); // 스트라이크로 얻은 보너스 3구
    m.roll({ knock: 6 });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].rolls[9]).toEqual([10, 4, 6]);
  });

  it('1구 오픈 → 잔존 핀 리스팟, 2구에 메우면(스페어) 새 랙으로 3구', () => {
    const m = solo();
    playOpenFrames(m, 9);
    const from = m.pins.cycles.length;

    m.roll({ knock: 5 });
    expect(m.pins.cycles.slice(from)).toEqual(['respot']); // 남았으니 되놓기
    m.roll({ knock: 5 }); // 스페어
    expect(m.pins.cycles.slice(from)).toEqual(['respot', 'rack']);
    expect(m.game.ball).toBe(3);
    m.roll({ knock: 7 });

    expect(m.summary?.players[0].rolls[9]).toEqual([5, 5, 7]);
  });

  it('1·2구 오픈이면 3구 없이 종료', () => {
    const m = solo();
    playOpenFrames(m, 9);
    m.roll({ knock: 5 });
    m.roll({ knock: 3 });

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].rolls[9]).toEqual([5, 3]);
  });

  it('2구까지 스트라이크면 3구도 새 랙 — 10프레임 XXX', () => {
    const m = solo();
    playOpenFrames(m, 9);
    const from = m.pins.cycles.length;

    m.roll({ knock: 10 });
    m.roll({ knock: 10 });
    expect(m.pins.cycles.slice(from)).toEqual(['rack', 'rack']);
    m.roll({ knock: 10 });
    expect(m.summary?.players[0].rolls[9]).toEqual([10, 10, 10]);
  });
});
