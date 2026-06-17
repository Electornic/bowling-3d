import { describe, it, expect } from 'vitest';
import { evaluateAchievements, maxConsecutiveStrikes } from '../src/game/rewards';

const base = { mode: 'full' as const, humanScore: 0, winner: 0, rivalKeys: [] as string[], rolls: [] as number[][], frames: 10 };

describe('maxConsecutiveStrikes', () => {
  it('counts 3 strikes across early frames (turkey)', () => {
    expect(maxConsecutiveStrikes([[10],[10],[10],[3,4],[],[],[],[],[],[]], 10)).toBe(3);
  });
  it('counts XXX in the 10th frame', () => {
    expect(maxConsecutiveStrikes([[1,2],[3,4],[5,4],[2,3],[1,1],[2,2],[3,3],[1,2],[4,5],[10,10,10]], 10)).toBe(3);
  });
  it('2 consecutive is not a turkey', () => {
    expect(maxConsecutiveStrikes([[10],[10],[3,4],[],[],[],[],[],[],[]], 10)).toBe(2);
  });
  it('non-consecutive strikes do not chain', () => {
    expect(maxConsecutiveStrikes([[10],[3,4],[10],[2,2],[],[],[],[],[],[]], 10)).toBe(1);
  });
});

describe('evaluateAchievements', () => {
  it('grants first_game on the first ever gameOver', () => {
    expect(evaluateAchievements(base, [])).toContain('first_game');
  });
  it('first_game is idempotent', () => {
    expect(evaluateAchievements(base, ['first_game'])).not.toContain('first_game');
  });
  it('beat_han only when the human wins vs han', () => {
    expect(evaluateAchievements({ ...base, winner: 0, rivalKeys: ['han'] }, [])).toContain('beat_han');
    expect(evaluateAchievements({ ...base, winner: 1, rivalKeys: ['han'] }, [])).not.toContain('beat_han');
    expect(evaluateAchievements({ ...base, winner: -1, rivalKeys: ['han'] }, [])).not.toContain('beat_han');
  });
  it('score_200 only in full mode at >=200', () => {
    expect(evaluateAchievements({ ...base, humanScore: 200 }, [])).toContain('score_200');
    expect(evaluateAchievements({ ...base, humanScore: 199 }, [])).not.toContain('score_200');
    expect(evaluateAchievements({ ...base, mode: 'blitz', humanScore: 250 }, [])).not.toContain('score_200');
  });
  it('turkey from rolls, never in spare mode', () => {
    const turkey = [[10],[10],[10],[1,2],[],[],[],[],[],[]];
    expect(evaluateAchievements({ ...base, rolls: turkey }, [])).toContain('turkey');
    expect(evaluateAchievements({ ...base, mode: 'spare', rolls: turkey }, [])).not.toContain('turkey');
  });
  it('already-earned ids never returned again', () => {
    const fresh = evaluateAchievements({ ...base, winner: 0, rivalKeys: ['han'] }, ['first_game', 'beat_han']);
    expect(fresh).not.toContain('first_game');
    expect(fresh).not.toContain('beat_han');
  });
});
