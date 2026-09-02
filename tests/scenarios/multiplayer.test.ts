import { describe, it, expect } from 'vitest';
import { createMatch, DT, type MatchDriver } from '../helpers/fakeScene';
import { AI_PROFILES } from '../../src/game/ai';
import { RIVAL_SKINS, CLASSIC_SKIN } from '../../src/game/rewards';

/**
 * vs AI — 차례 교대, 각자의 점수, 승패.
 *
 * 점수 상태(frame/ball/rolls)는 플레이어별로 분리돼 있고 물리 객체(핀·공)는 **공유**다.
 * 그 경계가 새면 상대 프레임에 내 점수가 붙거나, 교대 순간 핀이 안 서 있다.
 */
const KIM = AI_PROFILES[0];
const vsAi = (mode: 'full' | 'blitz' = 'blitz') =>
  createMatch({ mode, players: [{ name: 'ME' }, { name: 'RIVAL', ai: KIM }] });

/**
 * 블리츠(3프레임) 한 판 — 사람은 전부 스트라이크(퍼펙트 90), AI는 전부 거터(0).
 * 거터는 오픈이라 마지막 프레임에도 보너스 투구가 없다 — AI는 프레임당 2구 그대로.
 */
function playBlitzHumanPerfect(m: MatchDriver) {
  for (const frame of [1, 2, 3]) {
    m.roll({ knock: 10 });
    if (frame === 3) { m.roll({ knock: 10 }); m.roll({ knock: 10 }); } // 마지막 프레임 보너스 2구
    m.aiRoll({ gutter: true });
    m.aiRoll({ gutter: true });
  }
}

describe('차례 교대', () => {
  it('프레임 단위로 번갈아 친다 — 사람 F1 → AI F1 → 사람 F2', () => {
    const m = vsAi();
    expect(m.game.isHumanTurn()).toBe(true);
    expect(m.game.current).toBe(0);

    m.roll({ knock: 10 }); // 사람 F1 종료
    expect(m.game.current).toBe(1);
    expect(m.game.isHumanTurn()).toBe(false);
    expect(m.game.frame).toBe(1); // AI도 1프레임부터

    m.aiRoll({ knock: 10 }); // AI F1 종료
    expect(m.game.current).toBe(0);
    expect(m.game.frame).toBe(2);
  });

  it('교대할 때마다 새 랙이 내려온다', () => {
    const m = vsAi();
    m.roll({ knock: 4 });
    m.roll({ knock: 3 }); // 오픈으로 프레임 종료 → 교대
    expect(m.pins.cycles).toEqual(['respot', 'rack']);
    expect(m.pins.standingCount()).toBe(10);
  });

  it('점수는 플레이어별로 분리된다 — 상대 투구가 내 rolls에 섞이지 않는다', () => {
    const m = vsAi();
    m.roll({ knock: 7 });
    m.roll({ knock: 2 });
    m.aiRoll({ knock: 5 });
    m.aiRoll({ knock: 5 });

    expect(m.game.current).toBe(0);
    expect(m.game.rolls[0]).toEqual([7, 2]); // 사람 1프레임
    expect(m.hud.last.players[1].rolls[0]).toEqual([5, 5]); // AI 1프레임
  });

  it('차례가 바뀌면 공 스킨도 바뀐다 — AI는 자기 색, 사람은 내 스킨', () => {
    const m = vsAi();
    expect(m.ball.skin).toBe(CLASSIC_SKIN);

    m.roll({ knock: 10 });
    expect(m.ball.skin).toBe(RIVAL_SKINS[KIM.key]);

    m.aiRoll({ knock: 10 });
    expect(m.ball.skin).toBe(CLASSIC_SKIN);
  });
});

describe('AI 자동 투구', () => {
  it('AI 차례가 되면 사람 입력 없이 스스로 던진다', () => {
    const m = vsAi();
    m.roll({ knock: 10 });
    expect(m.game.state).toBe('AIMING');

    m.step(Math.ceil(1.0 / DT)); // 생각 시간(0.9s)만 흘려보낸다

    expect(m.game.state).not.toBe('AIMING'); // 던졌다
  });

  it('핀세터가 도는 동안은 생각 시간을 안 센다 — 사이클 끝나자마자 즉발하지 않는다', () => {
    const m = vsAi();
    m.roll({ knock: 10 }, { drain: false }); // 사이클을 돌린 채로 AI 차례로 넘어감
    expect(m.pins.cycling).toBe(true);

    let steps = 0;
    while (m.game.state === 'AIMING' && steps < 2000) { m.step(); steps++; }
    const cycleEnded = steps * DT;

    // 사이클(rack ≈ 3.05s)이 다 돈 **뒤에** 생각 시간 0.9s가 붙는다
    expect(cycleEnded).toBeGreaterThan(3.05 + 0.8);
  });
});

describe('승패 판정', () => {
  it('사람이 이기면 winner 0, 요약에 라이벌 key가 실린다', () => {
    const m = vsAi();
    playBlitzHumanPerfect(m);

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.winner).toBe(0);
    expect(m.summary?.players[0]).toMatchObject({ name: 'ME', ai: false, score: 90 });
    expect(m.summary?.players[1]).toMatchObject({ name: 'RIVAL', ai: true, score: 0, aiKey: KIM.key });
  });

  it('AI가 이기면 winner 1', () => {
    const m = vsAi();
    for (const frame of [1, 2, 3]) {
      const last = frame === 3;
      m.roll({ gutter: true });
      m.roll({ gutter: true });
      if (last) { /* 오픈이라 보너스 없음 */ }
      m.aiRoll({ knock: 10 });
      if (last) { m.aiRoll({ knock: 10 }); m.aiRoll({ knock: 10 }); }
    }

    expect(m.summary?.winner).toBe(1);
    expect(m.summary?.players[1].score).toBe(90);
  });

  it('동점이면 winner -1 (무승부)', () => {
    const m = vsAi();
    for (const frame of [1, 2, 3]) {
      void frame;
      m.roll({ gutter: true });
      m.roll({ gutter: true });
      m.aiRoll({ gutter: true });
      m.aiRoll({ gutter: true });
    }

    expect(m.summary?.winner).toBe(-1);
    expect(m.summary?.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('솔로는 항상 winner 0', () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });

    expect(m.summary?.winner).toBe(0);
  });
});
