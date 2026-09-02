import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMatch, installLocalStorage, playOpenFrames, type MatchDriver } from '../helpers/fakeScene';
import { loadStats } from '../../src/game/Stats';
import { evaluateAchievements } from '../../src/game/rewards';
import { oilEndZ, OIL_END_Z, OIL_DRY_PER_FRAME } from '../../src/game/oil';
import { AI_PROFILES } from '../../src/game/ai';

/**
 * 게임이 끝난 **뒤**에 남는 것 — 하이스코어·통계·해금 판정, 그리고 게임 도중 변하는 레인 상태.
 *
 * `recordGame`은 `gameOver()` 안에서 조용히 불린다. 여기가 비면 "판을 쳤는데 통계가 안 는다"를
 * 사람이 메뉴를 열어봐야만 안다.
 */

describe('하이스코어 · 통계 누적', () => {
  let restore: () => void;
  beforeEach(() => { restore = installLocalStorage(); });
  afterEach(() => restore());

  const perfectBlitz = () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });
    return m;
  };

  it('첫 판은 newBest이고 통계에 1판으로 잡힌다', () => {
    const m = perfectBlitz();

    expect(m.summary?.newBest).toBe(true);
    expect(m.summary?.best).toBe(90);
    expect(loadStats().blitz).toMatchObject({ best: 90, games: 1, totalScore: 90 });
  });

  it('두 번째 판이 더 낮으면 best는 그대로, 판수·합계만 는다', () => {
    perfectBlitz();
    const m2 = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 6; i++) m2.roll({ gutter: true });

    expect(m2.summary?.newBest).toBe(false);
    expect(m2.summary?.best).toBe(90);
    expect(loadStats().blitz).toMatchObject({ best: 90, games: 2, totalScore: 90 });
  });

  it('모드별로 따로 쌓인다', () => {
    perfectBlitz();
    const full = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
    playOpenFrames(full, 9);
    full.roll({ knock: 9 });
    full.roll({ knock: 0 });

    const all = loadStats();
    expect(all.blitz.games).toBe(1);
    expect(all.full.games).toBe(1);
    expect(all.full.best).toBe(90); // 9-0 × 10프레임
  });

  it('스트라이크·스페어 기회가 함께 집계된다', () => {
    perfectBlitz();

    expect(loadStats().blitz).toMatchObject({ strikes: 5, strikeChances: 5, spares: 0 });
  });

  it('사람 점수만 기록된다 — AI가 이겨도 내 통계다', () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }, { name: 'RIVAL', ai: AI_PROFILES[0] }] });
    for (let i = 0; i < 3; i++) {
      m.roll({ gutter: true }); m.roll({ gutter: true });
      m.aiRoll({ knock: 10 });
      if (i === 2) { m.aiRoll({ knock: 10 }); m.aiRoll({ knock: 10 }); }
    }

    expect(m.summary?.players[1].score).toBe(90);
    expect(loadStats().blitz).toMatchObject({ best: 0, games: 1, totalScore: 0 });
  });

  it('localStorage가 없어도 게임은 끝난다 (시크릿 모드 등)', () => {
    restore(); // 스텁을 걷어낸다
    const m = perfectBlitz();

    expect(m.game.state).toBe('GAME_OVER');
    expect(m.summary?.players[0].score).toBe(90);
    restore = installLocalStorage(); // afterEach가 부를 것을 되돌려둔다
  });
});

describe('결과 요약 → 해금 판정 브리지', () => {
  /**
   * 해금 자체는 `Boot`가 배선한다(Three 필요). 여기서 보는 건 **요약이 판정에 필요한 걸 다 싣고
   * 오는가**다 — Boot의 매핑을 그대로 흉내내 붙여본다. 필드가 빠지면 여기서 먼저 깨진다.
   */
  const bridge = (m: MatchDriver) => {
    const sm = m.summary!;
    return evaluateAchievements(
      {
        mode: sm.mode,
        humanScore: sm.players[0].score,
        winner: sm.winner,
        rivalKeys: sm.players.slice(1).map((p) => p.aiKey).filter((k): k is string => !!k),
        rolls: sm.players[0].rolls,
        frames: sm.frames,
      },
      [],
    );
  };

  it('첫 판이면 first_game이 나온다', () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });

    expect(bridge(m)).toContain('first_game');
  });

  it('터키는 실제 rolls에서 잡힌다', () => {
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    for (let i = 0; i < 5; i++) m.roll({ knock: 10 });

    expect(bridge(m)).toContain('turkey');
  });

  it('라이벌을 이기면 그 key의 격파 업적이 나온다', () => {
    const han = AI_PROFILES[2];
    const m = createMatch({ mode: 'blitz', players: [{ name: 'ME' }, { name: 'HAN', ai: han }] });
    for (let i = 0; i < 3; i++) {
      m.roll({ knock: 10 });
      if (i === 2) { m.roll({ knock: 10 }); m.roll({ knock: 10 }); }
      m.aiRoll({ gutter: true }); m.aiRoll({ gutter: true });
    }

    expect(m.summary?.winner).toBe(0);
    expect(bridge(m)).toContain(`beat_${han.key}`);
  });

  it('풀게임 200점 이상이면 score_200', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
    for (let i = 0; i < 12; i++) m.roll({ knock: 10 });

    expect(m.summary?.players[0].score).toBe(300);
    expect(bridge(m)).toContain('score_200');
  });
});

describe('레인 마름 (오일)', () => {
  it('매치를 시작하면 오일을 새로 깐다', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });

    expect(oilEndZ()).toBeCloseTo(OIL_END_Z, 6);
    expect(m.lane.oilVisualCalls).toBe(1);
  });

  it('풀게임은 프레임이 넘어갈 때마다 오일 존이 앞당겨진다', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
    m.roll({ knock: 10 }); // 1프레임 완료
    expect(oilEndZ()).toBeCloseTo(OIL_END_Z - OIL_DRY_PER_FRAME, 6);

    m.roll({ knock: 10 }); // 2프레임 완료
    expect(oilEndZ()).toBeCloseTo(OIL_END_Z - 2 * OIL_DRY_PER_FRAME, 6);
  });

  it('한 프레임 안에서는 안 마른다 — 1구와 2구 사이는 그대로', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
    m.roll({ leave: [7, 10] });

    expect(oilEndZ()).toBeCloseTo(OIL_END_Z, 6);
  });

  it('블리츠·스페어는 마르지 않는다 (full 모드 게이트)', () => {
    const blitz = createMatch({ mode: 'blitz', players: [{ name: 'ME' }] });
    blitz.roll({ knock: 10 });
    blitz.roll({ knock: 10 });
    expect(oilEndZ()).toBeCloseTo(OIL_END_Z, 6);

    const spare = createMatch({ mode: 'spare', players: [{ name: 'ME' }] });
    spare.roll();
    spare.roll();
    expect(oilEndZ()).toBeCloseTo(OIL_END_Z, 6);
  });

  it('공이 구르는 동안 레인 마찰이 공 z를 따라 갱신된다', () => {
    const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
    m.roll({ knock: 10 });

    expect(m.lane.frictionZ.length).toBeGreaterThan(10);
    expect(Math.max(...m.lane.frictionZ)).toBeGreaterThan(OIL_END_Z); // 오일 존을 지나 드라이까지 갔다
  });
});
