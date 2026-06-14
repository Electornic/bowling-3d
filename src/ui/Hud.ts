import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';
import { css, NEON, FONT_UI, FONT_DIGITS, rgba, applyPanel, ensureNeonStyles } from './theme';

export interface HudPlayerView {
  name: string;
  ai: boolean;
  frame: number;
  ball: number;
  rolls: number[][];
  conversions: number;
}

export interface HudView {
  state: GameStateName;
  mode: GameMode;
  frames: number;
  current: number;
  standing: number;
  players: HudPlayerView[];
}

const STATE_LABEL: Record<string, string> = {
  AIMING: '조준',
  ROLLING: '롤링!',
  SETTLING: '핀 카운트…',
  GAME_OVER: '게임 종료',
};

// 스페어 챌린지 라운드 성공 판정용 (성공 = knocked가 그 라운드 리브 전부)
const SPARE_LEAVE_SIZES = SPARE_LEAVES.map((l) => l.length);

/** 투구 표기: 0 = '–', 10 = 'X' (스트라이크는 호출부에서 별도 처리) — 실제 볼링장 표준 표기 */
const num = (r: number | undefined): string => (r === undefined ? '' : r === 0 ? '–' : String(r));

/** 일반 프레임 두 칸 마크 */
function marksNormal(fr: number[]): string[] {
  if (fr[0] === 10) return ['', 'X']; // 전통 표기: 스트라이크는 둘째 칸
  if (fr.length >= 2 && fr[0] + fr[1] === 10) return [num(fr[0]), '/'];
  return [num(fr[0]), num(fr[1])];
}

/** 마지막 프레임 세 칸 마크 (스트라이크/스페어 뒤 보너스 투구 규칙) */
function marksLast(fr: number[]): string[] {
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

/** 마크 글자색 — 스트라이크/스페어=골드, 그 외 평범 */
const markColor = (m: string): string => (m === 'X' || m === '/' ? NEON.gold : '#dfe6f2');

/**
 * 볼링 점수표 HUD (상단 중앙) — 플레이어별 시트 + 상태줄 + 이벤트 배너.
 * 누적은 보너스가 확정된 프레임까지만 표시 (실제 점수표 규칙).
 * 멀티(AI 라이벌) 대응: 시트 세로 스택, 현재 플레이어 골드 하이라이트 (로드맵 P1.5).
 * 비주얼은 씬과 통일된 네온 글래스 (theme.ts).
 */
export class Hud {
  private readonly wrap: HTMLDivElement;
  private readonly sheets: HTMLDivElement;
  private readonly status: HTMLDivElement;

  constructor() {
    ensureNeonStyles();

    this.wrap = document.createElement('div');
    css(this.wrap, {
      position: 'fixed',
      top: '10px',
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'none',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
      zIndex: '20',
      pointerEvents: 'none',
      maxWidth: '96vw',
    });

    this.sheets = document.createElement('div');
    css(this.sheets, { display: 'flex', flexDirection: 'column', gap: '5px' });

    this.status = document.createElement('div');
    applyPanel(this.status, NEON.cyan);
    css(this.status, {
      color: NEON.text,
      font: FONT_UI,
      padding: '5px 14px',
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    });

    this.wrap.appendChild(this.sheets);
    this.wrap.appendChild(this.status);
    document.body.appendChild(this.wrap);
  }

  update(d: HudView) {
    if (d.state === 'MENU' || !d.players.length) {
      this.wrap.style.display = 'none';
      return;
    }
    this.wrap.style.display = 'flex';
    this.sheets.replaceChildren();

    d.players.forEach((p, i) => {
      this.sheets.appendChild(this.renderSheet(d, p, i === d.current));
    });

    const cur = d.players[d.current];
    if (d.state === 'GAME_OVER') {
      this.status.textContent = '🎳 게임 종료';
    } else if (d.mode === 'spare') {
      this.status.textContent = `스페어 챌린지 ${cur.frame}/${d.frames} · 성공 ${cur.conversions} · ${STATE_LABEL[d.state] ?? d.state}`;
    } else {
      const who = d.players.length > 1 ? `${cur.name} · ` : '';
      this.status.textContent = `${who}${cur.frame}프레임 ${cur.ball}구 · 선 핀 ${d.standing} · ${STATE_LABEL[d.state] ?? d.state}`;
    }
  }

  private renderSheet(d: HudView, p: HudPlayerView, active: boolean): HTMLDivElement {
    const accent = active ? NEON.gold : NEON.cyan;
    const row = document.createElement('div');
    css(row, { display: 'flex', alignItems: 'center', gap: '6px' });

    if (d.players.length > 1) {
      const name = document.createElement('div');
      name.textContent = (p.ai ? '🤖 ' : '') + p.name;
      applyPanel(name, accent);
      css(name, {
        font: FONT_UI,
        color: active ? NEON.gold : NEON.dim,
        padding: '7px 9px',
        minWidth: '74px',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      });
      row.appendChild(name);
    }

    const sheet = document.createElement('div');
    applyPanel(sheet, accent);
    css(sheet, {
      display: 'flex',
      gap: '3px',
      padding: '6px',
      font: FONT_DIGITS,
    });

    if (d.mode === 'spare') {
      // 스페어 챌린지: 라운드별 ✓/✗ + 성공 수
      for (let f = 0; f < d.frames; f++) {
        const fr = p.rolls[f];
        const done = fr !== undefined && fr.length > 0;
        const cleared = done && fr[0] === SPARE_LEAVE_SIZES[f];
        const isCurrent = f === p.frame - 1 && d.state !== 'GAME_OVER';
        const box = document.createElement('div');
        css(box, {
          width: '24px',
          height: '26px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '6px',
          border: isCurrent ? '0' : `1.5px solid ${rgba(NEON.ice, 0.16)}`,
          animation: isCurrent ? 'neonPulse 1.4s ease-in-out infinite' : '',
          color: done ? (cleared ? NEON.green : NEON.red) : '#dfe6f2',
          fontSize: '14px',
        });
        box.textContent = done ? (cleared ? '✓' : '✗') : '';
        sheet.appendChild(box);
      }
      const total = document.createElement('div');
      css(total, {
        display: 'flex',
        alignItems: 'center',
        padding: '0 8px',
        color: '#fff',
        fontSize: '15px',
      });
      total.textContent = `${p.conversions}`;
      sheet.appendChild(total);
      row.appendChild(sheet);
      return row;
    }

    const cum = frameScores(p.rolls.flat(), d.frames);
    for (let f = 0; f < d.frames; f++) {
      const fr = p.rolls[f] ?? [];
      const isCurrent = active && f === p.frame - 1 && d.state !== 'GAME_OVER';

      const box = document.createElement('div');
      css(box, {
        borderRadius: '7px',
        overflow: 'hidden',
        background: isCurrent ? rgba(NEON.gold, 0.1) : 'rgba(255,255,255,0.04)',
        border: isCurrent ? '0' : `1.5px solid ${rgba(NEON.ice, 0.14)}`,
        animation: isCurrent ? 'neonPulse 1.4s ease-in-out infinite' : '',
      });

      const marks = document.createElement('div');
      css(marks, { display: 'flex', justifyContent: 'flex-end' });
      for (const m of f === d.frames - 1 ? marksLast(fr) : marksNormal(fr)) {
        const cell = document.createElement('div');
        css(cell, {
          width: '17px',
          height: '17px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderLeft: `1px solid ${rgba(NEON.ice, 0.14)}`,
          color: markColor(m),
        });
        cell.textContent = m;
        marks.appendChild(cell);
      }

      const score = document.createElement('div');
      css(score, {
        height: '20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '14px',
        color: '#fff',
      });
      score.textContent = cum[f] !== undefined ? String(cum[f]) : '';

      box.appendChild(marks);
      box.appendChild(score);
      sheet.appendChild(box);
    }
    row.appendChild(sheet);
    return row;
  }
}
