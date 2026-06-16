import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';
import { isCoarsePointer } from '../core/device';
import { css, NEON, FONT_UI, FONT_DIGITS, rgba, applyPanel, ensureNeonStyles } from './theme';

// 점수판은 항상 한 줄(스크롤 0). 행에 정해진 폭(min(96vw, 자연폭))을 주고 프레임·셀을 flex-basis:0으로
// 비례 분배 → 칸이 비어도(초반 빈 칸) 안 찌그러지고, 좁으면 균일 축소. (UI_REVAMP.md "A — 한 줄 꽉 채우기")
const COARSE = isCoarsePointer();
const CELL = COARSE ? 13 : 17; // 칸 높이(px) 겸 자연폭 산정 기준 — 실제 칸 폭은 flex로 분배
const NAT_SHEET = 21 * CELL + 39; // 풀 시트 자연폭: 21칸 + 9갭(27px) + 패딩(12px). 데스크톱은 이 폭, 폰은 96vw로 축소
const NAME_W = 102; // 멀티 이름 패널 폭(여유 포함) — 풀 시트 행 폭에 가산
const SCORE_H = COARSE ? 17 : 20; // 누적점수 줄 높이(px)
const SCORE_FS = COARSE ? 12 : 14; // 누적점수 폰트(px) — 좁은 셀(~26px 프레임)에 3자리(176/300) 여유(폭 84%)

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
      // 상단 점수판: 노치/Dynamic Island/상태바 침범 방지 (iOS WKWebView는 viewport-fit=cover로 인셋 제공)
      top: 'calc(10px + env(safe-area-inset-top))',
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
    css(this.sheets, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' });

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
    const multi = d.players.length > 1;

    const row = document.createElement('div');
    // 풀 시트는 정해진 폭(min(96vw, 자연폭))을 줘야 flex-basis:0 셀이 빈 칸도 안 찌그러뜨림.
    // 스페어는 내용이 비지 않으니 내용폭(fit-content)으로 충분.
    // 멀티는 두 플레이어 모두 풀 시트로 쌓아 직관적 비교(active 행이 이미 폭을 정하므로 풀로 깔아도 폭 추가 0).
    const rowWidth =
      d.mode === 'spare'
        ? 'fit-content'
        : `min(96vw, ${NAT_SHEET + (multi ? NAME_W : 0)}px)`;
    css(row, { display: 'flex', alignItems: 'center', gap: '6px', width: rowWidth, maxWidth: '96vw' });

    if (multi) {
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
      flex: '1 1 0', // 행 폭(정해진 값)을 채움 — 멀티는 이름 패널 제외분
      minWidth: '0',
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
        flex: `${f === d.frames - 1 ? 3 : 2} 1 0`, // 칸 수(일반2/마지막3) 비례 분배 → 모든 셀 폭 균일
        minWidth: '0',
        borderRadius: '7px',
        overflow: 'hidden',
        background: isCurrent ? rgba(NEON.gold, 0.1) : 'rgba(255,255,255,0.04)',
        border: isCurrent ? '0' : `1.5px solid ${rgba(NEON.ice, 0.14)}`,
        animation: isCurrent ? 'neonPulse 1.4s ease-in-out infinite' : '',
      });

      const marks = document.createElement('div');
      css(marks, { display: 'flex' });
      for (const m of f === d.frames - 1 ? marksLast(fr) : marksNormal(fr)) {
        const cell = document.createElement('div');
        css(cell, {
          flex: '1 1 0', // basis:0 비례 분배 — 빈 칸도 내용과 무관하게 폭 유지(찌그러짐 방지)
          minWidth: '0',
          height: `${CELL}px`,
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
        height: `${SCORE_H}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: `${SCORE_FS}px`,
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
