import type { GameState } from '../game/GameState';
import { makeBallSpec } from '../game/BallSpec';

/**
 * 볼 무게 선택 슬라이더 (도안 §4.5). 6~16 lb 무단계.
 * 사람 플레이어 전용 — GameState가 턴별로 공 스펙을 적용한다.
 */
export class BallPicker {
  constructor(game: GameState) {
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      color: '#e8edf5',
      font: '600 13px/1.6 system-ui, sans-serif',
      background: 'rgba(16,16,24,0.62)',
      padding: '10px 14px',
      borderRadius: '10px',
      zIndex: '20',
    } as CSSStyleDeclaration);

    const label = document.createElement('div');
    label.textContent = '볼 무게: 10 lb';

    const input = document.createElement('input');
    input.type = 'range';
    input.min = '6';
    input.max = '16';
    input.step = '0.5';
    input.value = '10';
    input.style.width = '170px';

    input.addEventListener('input', () => {
      const lb = parseFloat(input.value);
      label.textContent = `볼 무게: ${lb} lb`;
      // 사람 스펙으로 저장 — AI 턴 중엔 게임이 사람 차례에 다시 적용 (로드맵 P1.5)
      game.setHumanBallSpec(makeBallSpec(lb));
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    document.body.appendChild(wrap);
  }
}
