import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';

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

/** 투구 표기: 0 = '–', 10 = 'X' (스트라이크는 호출부에서 별도 처리) */
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

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

/**
 * 볼링 점수표 HUD (상단 중앙) — 플레이어별 시트 + 상태줄 + 이벤트 배너.
 * 누적은 보너스가 확정된 프레임까지만 표시 (실제 점수표 규칙).
 * 멀티(AI 라이벌) 대응: 시트 세로 스택, 현재 플레이어 골드 하이라이트 (로드맵 P1.5).
 */
export class Hud {
  private readonly wrap: HTMLDivElement;
  private readonly sheets: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly bannerEl: HTMLDivElement;
  private bannerTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
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
    css(this.sheets, { display: 'flex', flexDirection: 'column', gap: '4px' });

    this.status = document.createElement('div');
    css(this.status, {
      color: '#e8edf5',
      font: '600 13px/1.2 system-ui, sans-serif',
      background: 'rgba(10,12,20,0.55)',
      padding: '5px 12px',
      borderRadius: '8px',
      whiteSpace: 'nowrap',
    });

    this.wrap.appendChild(this.sheets);
    this.wrap.appendChild(this.status);
    document.body.appendChild(this.wrap);

    // 이벤트 배너 (STRIKE!/스플릿 등) — 화면 중앙 상단, 잠깐 떴다 사라짐
    this.bannerEl = document.createElement('div');
    css(this.bannerEl, {
      position: 'fixed',
      top: '24%',
      left: '50%',
      transform: 'translate(-50%, -50%) scale(0.9)',
      font: '800 46px/1.1 system-ui, sans-serif',
      color: '#ffd54a',
      textShadow: '0 2px 18px rgba(255,160,0,0.55), 0 1px 2px rgba(0,0,0,0.8)',
      opacity: '0',
      transition: 'opacity 0.18s ease, transform 0.18s ease',
      zIndex: '30',
      pointerEvents: 'none',
      whiteSpace: 'nowrap',
      textAlign: 'center',
    });
    document.body.appendChild(this.bannerEl);
  }

  /** 이벤트 텍스트 팝 (P2 연속 스트라이크/스플릿 피드백) */
  banner(text: string, color = '#ffd54a', ms = 1500) {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.style.opacity = '1';
    this.bannerEl.style.transform = 'translate(-50%, -50%) scale(1)';
    if (this.bannerTimer) clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => {
      this.bannerEl.style.opacity = '0';
      this.bannerEl.style.transform = 'translate(-50%, -50%) scale(0.9)';
    }, ms);
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
    const row = document.createElement('div');
    css(row, { display: 'flex', alignItems: 'center', gap: '6px' });

    if (d.players.length > 1) {
      const name = document.createElement('div');
      name.textContent = (p.ai ? '🤖 ' : '') + p.name;
      css(name, {
        font: '600 12px/1 system-ui, sans-serif',
        color: active ? '#ffd54a' : '#aab3c2',
        background: 'rgba(10,12,20,0.66)',
        padding: '6px 8px',
        borderRadius: '8px',
        minWidth: '74px',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      });
      row.appendChild(name);
    }

    const sheet = document.createElement('div');
    css(sheet, {
      display: 'flex',
      gap: '3px',
      padding: '6px',
      background: 'rgba(10,12,20,0.66)',
      borderRadius: '10px',
      font: '600 12px/1 system-ui, sans-serif',
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
          border: `1.5px solid ${isCurrent ? '#ffd54a' : 'rgba(255,255,255,0.16)'}`,
          borderRadius: '6px',
          color: done ? (cleared ? '#4ade80' : '#ef6a6a') : '#dfe6f2',
          fontSize: '13px',
        });
        box.textContent = done ? (cleared ? '✓' : '✗') : '';
        sheet.appendChild(box);
      }
      const total = document.createElement('div');
      css(total, {
        display: 'flex',
        alignItems: 'center',
        padding: '0 6px',
        color: '#fff',
        fontSize: '14px',
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
        border: `1.5px solid ${isCurrent ? '#ffd54a' : 'rgba(255,255,255,0.16)'}`,
        borderRadius: '6px',
        overflow: 'hidden',
        background: 'rgba(255,255,255,0.04)',
      });

      const marks = document.createElement('div');
      css(marks, { display: 'flex', justifyContent: 'flex-end' });
      for (const m of f === d.frames - 1 ? marksLast(fr) : marksNormal(fr)) {
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
        marks.appendChild(cell);
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

      box.appendChild(marks);
      box.appendChild(score);
      sheet.appendChild(box);
    }
    row.appendChild(sheet);
    return row;
  }
}
