import type { Ball } from '../scene/Ball';
import type { GameState } from '../game/GameState';
import { makeBallSpec } from '../game/BallSpec';

/**
 * 볼 무게 선택 슬라이더 (도안 §4.5). 6~16 lb 무단계.
 * AIMING 중에만 무게 변경 적용 (굴러가는 중 변경 방지).
 */
export class BallPicker {
  constructor(ball: Ball, game: GameState) {
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
      if (game.state === 'AIMING') ball.setSpec(makeBallSpec(lb));
    });

    wrap.appendChild(label);
    wrap.appendChild(input);
    document.body.appendChild(wrap);
  }
}
