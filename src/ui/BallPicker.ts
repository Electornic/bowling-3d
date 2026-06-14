import type { GameState } from '../game/GameState';
import { makeBallSpec } from '../game/BallSpec';
import { isCoarsePointer } from '../core/device';
import { css, NEON, FONT_UI, rgba, applyPanel, ensureNeonStyles } from './theme';

/**
 * 볼 무게 선택 슬라이더 (도안 §4.5). 6~16 lb 무단계.
 * 사람 플레이어 전용 — GameState가 턴별로 공 스펙을 적용한다.
 * 네온 글래스 패널 + 커스텀 슬라이더 + 무게↔색 매핑을 보여주는 공 스와치.
 *
 * 데스크톱: 우상단 상시 패널. 터치(coarse): 점수판(상단중앙)과의 충돌을 피하려
 * **컴팩트 칩**(현재 무게+스와치)으로 접고, 탭하면 슬라이더가 펼쳐진다 (MOBILE_SUPPORT.md §3).
 */
export class BallPicker {
  private readonly value: HTMLSpanElement;
  private readonly swatch: HTMLDivElement;

  constructor(game: GameState) {
    ensureNeonStyles();
    const coarse = isCoarsePointer();

    const wrap = document.createElement('div');
    applyPanel(wrap, NEON.cyan);
    css(wrap, {
      position: 'fixed',
      color: NEON.text,
      font: FONT_UI,
      padding: coarse ? '8px 10px' : '12px 14px',
      width: coarse ? 'auto' : '210px',
      maxWidth: '60vw',
      zIndex: '20',
    });
    if (coarse) {
      // 터치: 상단(점수판·플레이어 이름)과 겹쳐 하단 좌측으로. 하단 게이지 도크 위에 얹고
      // 슬라이더는 위로 펼침(column-reverse + bottom 앵커 → 펼치면 위로 자람).
      css(wrap, {
        bottom: 'calc(136px + env(safe-area-inset-bottom))',
        left: 'calc(12px + env(safe-area-inset-left))',
        display: 'flex',
        flexDirection: 'column-reverse',
        gap: '10px',
      });
    } else {
      css(wrap, {
        top: 'calc(12px + env(safe-area-inset-top))',
        right: 'calc(12px + env(safe-area-inset-right))',
      });
    }

    // 공통: 무게값 텍스트 + 스와치(무게=색 미리보기)
    this.value = document.createElement('span');
    this.value.textContent = '10 lb';
    css(this.value, { color: NEON.cyan, font: "700 16px/1 ui-monospace, 'SF Mono', monospace" });

    this.swatch = document.createElement('div');
    css(this.swatch, {
      width: '30px',
      height: '30px',
      borderRadius: '50%',
      flex: '0 0 auto',
      boxShadow:
        'inset -4px -5px 7px rgba(0,0,0,0.55), inset 3px 3px 6px rgba(255,255,255,0.22), 0 0 8px rgba(0,0,0,0.4)',
    });

    // 슬라이더 (6~16 lb)
    const input = document.createElement('input');
    input.type = 'range';
    input.className = 'neon-range';
    input.min = '6';
    input.max = '16';
    input.step = '0.5';
    input.value = '10';
    input.addEventListener('input', () => {
      const lb = parseFloat(input.value);
      this.syncVisual(lb);
      // 사람 스펙으로 저장 — AI 턴 중엔 게임이 사람 차례에 다시 적용 (로드맵 P1.5)
      game.setHumanBallSpec(makeBallSpec(lb));
    });

    if (coarse) {
      // === 컴팩트 칩 + 탭 펼침 ===
      const chip = document.createElement('div');
      css(chip, { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' });
      css(this.swatch, { width: '24px', height: '24px' });
      const caret = document.createElement('span');
      caret.textContent = '▾';
      css(caret, { color: NEON.dim, fontSize: '11px' });
      chip.appendChild(this.swatch);
      chip.appendChild(this.value);
      chip.appendChild(caret);

      // 펼침 영역 (슬라이더) — 기본 접힘
      const drawer = document.createElement('div');
      css(drawer, { display: 'none', minWidth: '180px' }); // 간격은 wrap의 column-reverse + gap이 담당
      const label = document.createElement('div');
      label.textContent = '볼 무게';
      css(label, {
        color: NEON.dim,
        fontSize: '11px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        marginBottom: '8px',
      });
      drawer.appendChild(label);
      drawer.appendChild(input);

      let open = false;
      const setOpen = (o: boolean) => {
        open = o;
        drawer.style.display = o ? 'block' : 'none';
        caret.textContent = o ? '▴' : '▾';
      };
      chip.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        setOpen(!open);
      });
      // 바깥 탭 시 접기 (canvas 등) — drawer 내부 조작은 stopPropagation으로 보존
      drawer.addEventListener('pointerdown', (e) => e.stopPropagation());
      window.addEventListener('pointerdown', () => {
        if (open) setOpen(false);
      });

      wrap.appendChild(chip);
      wrap.appendChild(drawer);
    } else {
      // === 데스크톱: 상시 패널 ===
      const head = document.createElement('div');
      css(head, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '11px' });
      const label = document.createElement('span');
      label.textContent = '볼 무게';
      css(label, { color: NEON.dim, fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase' });
      head.appendChild(label);
      head.appendChild(this.value);

      const bodyRow = document.createElement('div');
      css(bodyRow, { display: 'flex', alignItems: 'center', gap: '12px' });
      bodyRow.appendChild(this.swatch);
      bodyRow.appendChild(input);

      wrap.appendChild(head);
      wrap.appendChild(bodyRow);
    }

    this.syncVisual(10); // 초기 스와치/값 (게임 스펙은 Boot의 makeBallSpec(10)과 일치)
    document.body.appendChild(wrap);
  }

  /** 값 텍스트 + 스와치 색 동기화 (게임 스펙 적용은 호출부에서 별도) */
  private syncVisual(lb: number) {
    const hex = makeBallSpec(lb).color.toString(16).padStart(6, '0');
    this.value.textContent = `${lb} lb`;
    this.swatch.style.background = `radial-gradient(circle at 34% 30%, ${rgba('#ffffff', 0.45)}, #${hex} 62%)`;
  }
}
