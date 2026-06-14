import type { GameState } from '../game/GameState';
import { makeBallSpec } from '../game/BallSpec';
import { css, NEON, FONT_UI, rgba, applyPanel, ensureNeonStyles } from './theme';

/**
 * 볼 무게 선택 슬라이더 (도안 §4.5). 6~16 lb 무단계.
 * 사람 플레이어 전용 — GameState가 턴별로 공 스펙을 적용한다.
 * 네온 글래스 패널 + 커스텀 슬라이더 + 무게↔색 매핑을 보여주는 공 스와치.
 */
export class BallPicker {
  constructor(game: GameState) {
    ensureNeonStyles();

    const wrap = document.createElement('div');
    applyPanel(wrap, NEON.cyan);
    css(wrap, {
      position: 'fixed',
      top: '12px',
      right: '12px',
      width: '210px',
      color: NEON.text,
      font: FONT_UI,
      padding: '12px 14px',
      zIndex: '20',
    });

    // 헤더: 라벨 + 현재 무게값
    const head = document.createElement('div');
    css(head, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: '11px',
    });
    const label = document.createElement('span');
    label.textContent = '볼 무게';
    css(label, {
      color: NEON.dim,
      fontSize: '11px',
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
    });
    const value = document.createElement('span');
    value.textContent = '10 lb';
    css(value, { color: NEON.cyan, font: "700 16px/1 ui-monospace, 'SF Mono', monospace" });
    head.appendChild(label);
    head.appendChild(value);

    // 본문: 공 스와치(무게=색 미리보기) + 슬라이더
    const bodyRow = document.createElement('div');
    css(bodyRow, { display: 'flex', alignItems: 'center', gap: '12px' });

    const swatch = document.createElement('div');
    css(swatch, {
      width: '30px',
      height: '30px',
      borderRadius: '50%',
      flex: '0 0 auto',
      boxShadow:
        'inset -4px -5px 7px rgba(0,0,0,0.55), inset 3px 3px 6px rgba(255,255,255,0.22), 0 0 8px rgba(0,0,0,0.4)',
    });

    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'neon-range';
    input.min = '6';
    input.max = '16';
    input.step = '0.5';
    input.value = '10';

    bodyRow.appendChild(swatch);
    bodyRow.appendChild(input);

    // 시각 동기화 (값 텍스트 + 스와치 색). 게임 스펙 적용은 호출부에서 별도 — Boot이 이미 10lb 세팅.
    const syncVisual = (lb: number) => {
      const hex = makeBallSpec(lb).color.toString(16).padStart(6, '0');
      value.textContent = `${lb} lb`;
      swatch.style.background = `radial-gradient(circle at 34% 30%, ${rgba('#ffffff', 0.45)}, #${hex} 62%)`;
    };

    input.addEventListener('input', () => {
      const lb = parseFloat(input.value);
      syncVisual(lb);
      // 사람 스펙으로 저장 — AI 턴 중엔 게임이 사람 차례에 다시 적용 (로드맵 P1.5)
      game.setHumanBallSpec(makeBallSpec(lb));
    });
    syncVisual(10); // 초기 스와치/값만 (게임 스펙은 Boot의 makeBallSpec(10)과 일치)

    wrap.appendChild(head);
    wrap.appendChild(bodyRow);
    document.body.appendChild(wrap);
  }
}
