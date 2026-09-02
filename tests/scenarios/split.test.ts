import { describe, it, expect } from 'vitest';
import { createMatch, playOpenFrames } from '../helpers/fakeScene';

/**
 * 스플릿 — 발생은 조용히, 변환은 크게.
 *
 * `detectSplit` 자체는 단위테스트가 있다(`unit/splits`). 여기서 보는 건 **상태머신이 그 판정을
 * 언제 들고 언제 버리는가**다. 게이트가 `standingAtThrow === 10`인 이유(10프레임 보너스 랙도
 * 사실상 1구다)와, 발생 배너를 일부러 안 띄운다는 결정이 코드로 지켜지는지.
 */
const solo = () => createMatch({ mode: 'full', players: [{ name: 'ME' }] });

describe('스플릿 변환', () => {
  it('7-10을 메우면 spare가 아니라 splitConverted가 뜬다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });
    m.roll({ knock: 2 });

    const types = m.events.map((e) => e.type);
    expect(types).toContain('splitConverted');
    expect(types).not.toContain('spare'); // 스플릿 연출이 스페어를 대체한다
    expect(m.events.find((e) => e.type === 'splitConverted')).toMatchObject({ label: '7-10' });
  });

  it('스플릿이 아닌 리브(슬리퍼 2-8)를 메우면 그냥 spare다', () => {
    const m = solo();
    m.roll({ leave: [2, 8] });
    m.roll({ knock: 2 });

    const types = m.events.map((e) => e.type);
    expect(types).toContain('spare');
    expect(types).not.toContain('splitConverted');
  });

  it('스플릿 발생 자체는 아무 이벤트도 안 낸다 (부정 피드백 배제 결정)', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });

    expect(m.events.map((e) => e.type)).toEqual([]); // 1구 뒤 조용하다
  });

  it('못 메우면 연출 없이 오픈 프레임으로 끝난다', () => {
    const m = solo();
    m.roll({ leave: [7, 10] });
    m.roll({ leave: [10] }); // 7만 처리

    const types = m.events.map((e) => e.type);
    expect(types).not.toContain('splitConverted');
    expect(types).not.toContain('spare');
    expect(m.game.frame).toBe(2);
  });

  it('빅포 4-6-7-10 변환도 라벨이 그대로 실린다', () => {
    const m = solo();
    m.roll({ leave: [4, 6, 7, 10] });
    m.roll({ knock: 4 });

    expect(m.events.find((e) => e.type === 'splitConverted')).toMatchObject({ label: '4-6-7-10' });
  });
});

describe('스플릿 판정을 들고 있는 범위', () => {
  it('프레임이 끝나면 버린다 — 다음 프레임 스페어가 splitConverted로 새지 않는다', () => {
    const m = solo();
    // 1구 거터(전부 서 있음 → 스플릿 아님) → 2구에 스플릿을 남기지만 그 프레임은 곧 끝난다
    m.roll({ gutter: true });
    m.roll({ leave: [7, 10] });
    expect(m.game.frame).toBe(2);

    // 다음 프레임에서 평범한 스페어
    m.roll({ knock: 5 });
    m.roll({ knock: 5 });

    const types = m.events.map((e) => e.type);
    expect(types).toContain('spare');
    expect(types).not.toContain('splitConverted');
  });

  it('10프레임 보너스 랙의 스플릿도 변환하면 연출된다 (게이트가 ball이 아니라 standingAtThrow인 이유)', () => {
    const m = solo();
    playOpenFrames(m, 9);

    m.roll({ knock: 10 }); // 10프레임 1구 스트라이크 → 새 랙
    m.roll({ leave: [3, 10] }); // 보너스 랙에 던진 2구가 베이비 스플릿을 남긴다
    m.roll({ knock: 2 }); // 3구로 메움

    expect(m.events.find((e) => e.type === 'splitConverted')).toMatchObject({ label: '3-10' });
  });
});
