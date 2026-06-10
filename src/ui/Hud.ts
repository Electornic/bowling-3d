import { frameScores } from '../game/Scoreboard';

export interface HudData {
  frame: number;
  ball: number;
  standing: number;
  state: string;
  rolls: number[][];
  score: number;
}

const STATE_LABEL: Record<string, string> = {
  AIMING: '조준',
  ROLLING: '롤링!',
  SETTLING: '핀 카운트…',
  GAME_OVER: '게임 종료',
};

/** 투구 표기: 0 = '–', 10 = 'X' (스트라이크는 호출부에서 별도 처리) */
const num = (r: number | undefined): string => (r === undefined ? '' : r === 0 ? '–' : String(r));

/** 프레임 1~9 두 칸 마크 */
function marksNormal(fr: number[]): string[] {
  if (fr[0] === 10) return ['', 'X']; // 전통 표기: 스트라이크는 둘째 칸
  if (fr.length >= 2 && fr[0] + fr[1] === 10) return [num(fr[0]), '/'];
  return [num(fr[0]), num(fr[1])];
}

/** 10프레임 세 칸 마크 (스트라이크/스페어 뒤 보너스 투구 규칙) */
function marksTenth(fr: number[]): string[] {
  const c: string[] = ['', '', ''];
  if (fr[0] !== undefined) c[0] = fr[0] === 10 ? 'X' : num(fr[0]);
  if (fr[1] !== undefined) {
    if (fr[0] === 10) c[1] = fr[1] === 10 ? 'X' : num(fr[1]);
    else c[1] = fr[0] + fr[1] === 10 ? '/' : num(fr[1]);
  }
  if (fr[2] !== undefined) {
    const freshRack = fr[1] === 10 || fr[0] + fr[1] === 10; // 직전이 X 또는 / → 새 핀
    if (freshRack) c[2] = fr[2] === 10 ? 'X' : num(fr[2]);
    else c[2] = fr[1] + fr[2] === 10 ? '/' : num(fr[2]);
  }
  return c;
}

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

/**
 * 볼링 점수표 HUD (상단 중앙) — 프레임별 투구 마크(X·/·–) + 누적 점수.
 * 누적은 보너스가 확정된 프레임까지만 표시 (실제 점수표 규칙).
 */
export class Hud {
  private readonly sheet: HTMLDivElement;
  private readonly status: HTMLDivElement;

  constructor() {
    const wrap = document.createElement('div');
    css(wrap, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      zIndex: '20',
      pointerEvents: 'none',
      maxWidth: '96vw',
    });

    this.sheet = document.createElement('div');
    css(this.sheet, {
      display: 'flex',
      gap: '3px',
      padding: '6px',
      background: 'rgba(10,12,20,0.66)',
      borderRadius: '10px',
      font: '600 12px/1 system-ui, sans-serif',
    });

    this.status = document.createElement('div');
    css(this.status, {
      color: '#e8edf5',
      font: '600 13px/1.2 system-ui, sans-serif',
      background: 'rgba(10,12,20,0.55)',
      padding: '5px 12px',
      borderRadius: '8px',
      whiteSpace: 'nowrap',
    });

    wrap.appendChild(this.sheet);
    wrap.appendChild(this.status);
    document.body.appendChild(wrap);
  }

  update(d: HudData) {
    const cum = frameScores(d.rolls.flat());
    this.sheet.replaceChildren();

    for (let f = 0; f < 10; f++) {
      const fr = d.rolls[f] ?? [];
      const isCurrent = f === d.frame - 1 && d.state !== 'GAME_OVER';

      const box = document.createElement('div');
      css(box, {
        border: `1.5px solid ${isCurrent ? '#ffd54a' : 'rgba(255,255,255,0.16)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)',
      });

      const row = document.createElement('div');
      css(row, { display: 'flex', justifyContent: 'flex-end' });
      for (const m of f === 9 ? marksTenth(fr) : marksNormal(fr)) {
        const cell = document.createElement('div');
        css(cell, {
          width: '15px',
          height: '16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderLeft: '1px solid rgba(255,255,255,0.14)',
          color: m === 'X' || m === '/' ? '#ffd54a' : '#dfe6f2',
        });
        cell.textContent = m;
        row.appendChild(cell);
      }

      const score = document.createElement('div');
      css(score, {
        height: '18px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '13px',
        color: '#fff',
      });
      score.textContent = cum[f] !== undefined ? String(cum[f]) : '';

      box.appendChild(row);
      box.appendChild(score);
      this.sheet.appendChild(box);
    }

    this.status.textContent =
      d.state === 'GAME_OVER'
        ? `🎳 게임 종료 — 최종 ${d.score}점`
        : `${d.frame}프레임 ${d.ball}구 · 선 핀 ${d.standing} · ${STATE_LABEL[d.state] ?? d.state}`;
  }
}
