import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';
import { css, NEON, FONT_UI, FONT_DIGITS, rgba, applyPanel, ensureNeonStyles } from './theme';

// 점수판은 항상 한 줄(스크롤 0). 행 폭 = min(96vw, SHEET_MAX), 프레임·셀은 flex-basis:0 비례 분배 →
// 칸이 비어도(초반 빈 칸) 안 찌그러지고 좁으면 균일 축소. (UI_REVAMP.md "A — 한 줄 꽉 채우기")
// 높이·폰트는 뷰포트 폭에 clamp로 자동 연동 — 폭만 줄던 고정 px 상수를 없애, 작은 폰(~320)에서 칸이
// 홀쭉해지거나 3자리 점수가 넘치지 않게 비율째 축소하고, 큰 폰/데스크톱은 상한(과대 방지)에서 멈춘다.
// 기준선: 320px(최소 지원 — 구형 iPhone SE)에서 floor, ~390px+에서 ceiling(현 데스크톱 크기).
const SHEET_MAX = 420; // 한 줄 시트 최대 폭(데스크톱·대형폰 상한). 폰은 96vw가 이긴다.
const NAME_W = 102; // 멀티 이름 패널 폭(여유 포함) — 풀 시트 행 폭에 가산
const CELL_H = 'clamp(14px, 4.3vw, 17px)'; // 마크 박스 높이 (320→14 / 390+→17)
const SCORE_H = 'clamp(16px, 5.1vw, 20px)'; // 누적 점수 줄 높이
const DIGIT_FS = 'clamp(11px, 3.6vw, 14px)'; // 마크·누적 점수 글자 크기 (좁은 셀 3자리 넘침 방지)

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
      // ☰ 메뉴 버튼(좌상단, 높이 40px)과 안 겹치게 그 아래로 — 점수판은 풀폭(≈96vw)이라 좌우 코너 모두
      // 버튼과 충돌하므로 가로로 피할 수 없어 세로로 비킨다(프레임 폭=가독성은 유지).
      top: 'calc(56px + env(safe-area-inset-top))',
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

    // 상태 표시줄: 메뉴 버튼(좌상단)과 대칭으로 우상단 모서리에 — 점수판을 아래(top:56px)로 내리며
    // 비어버린 상단 띠를 채워 좌/우 대칭 툴바를 만든다(점수판 폭·가독성은 그대로 유지). 길면 …로 자름.
    this.status = document.createElement('div');
    applyPanel(this.status, NEON.cyan);
    css(this.status, {
      position: 'fixed',
      top: 'calc(8px + env(safe-area-inset-top))',
      right: 'calc(8px + env(safe-area-inset-right))',
      maxWidth: 'calc(50vw - 52px)', // 우측 절반만 — 중앙 업적 아일랜드·좌상단 메뉴와 충돌 방지
      zIndex: '21',
      display: 'none',
      pointerEvents: 'none',
      color: NEON.text,
      font: FONT_UI,
      // 좌상단 메뉴·중앙 아일랜드(둘 다 height 40)와 같은 가로선에 맞추려면 상태바도 40px여야 한다
      // (top은 같으니 높이를 맞춰 세로 중심 일치). 세로 패딩 10px + 내용 ~20px = 40px. block 유지(ellipsis 동작).
      minHeight: '40px',
      boxSizing: 'border-box',
      padding: '10px 14px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      letterSpacing: '0.02em',
    });

    this.wrap.appendChild(this.sheets);
    document.body.appendChild(this.wrap);
    document.body.appendChild(this.status);
  }

  update(d: HudView) {
    if (d.state === 'MENU' || !d.players.length) {
      this.wrap.style.display = 'none';
      this.status.style.display = 'none';
      return;
    }
    this.wrap.style.display = 'flex';
    this.status.style.display = 'block';
    this.sheets.replaceChildren();

    d.players.forEach((p, i) => {
      this.sheets.appendChild(this.renderSheet(d, p, i === d.current));
    });

    const cur = d.players[d.current];
    if (d.state === 'GAME_OVER') {
      this.status.textContent = '🎳 게임 종료';
    } else if (d.mode === 'spare') {
      this.status.textContent = `스페어 ${cur.frame}/${d.frames} · 성공 ${cur.conversions}`;
    } else {
      // 중앙 업적 아일랜드와 공존하도록 컴팩트하게. 누구 차례인지는 점수판 골드 하이라이트 + 차례 배너로,
      // 선 핀 수는 3D 장면으로 보이므로 상태바에서는 생략(프레임·구·상태만).
      this.status.textContent = `${cur.frame}F · ${cur.ball}구 · ${STATE_LABEL[d.state] ?? d.state}`;
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
        : `min(96vw, ${SHEET_MAX + (multi ? NAME_W : 0)}px)`;
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
          width: 'clamp(20px, 6vw, 24px)',
          height: 'clamp(22px, 6.7vw, 26px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '6px',
          border: isCurrent ? '0' : `1.5px solid ${rgba(NEON.ice, 0.16)}`,
          animation: isCurrent ? 'neonPulse 1.4s ease-in-out infinite' : '',
          color: done ? (cleared ? NEON.green : NEON.red) : '#dfe6f2',
          fontSize: DIGIT_FS,
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
        fontSize: 'clamp(13px, 4vw, 15px)',
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
          height: CELL_H,
          fontSize: DIGIT_FS, // FONT_DIGITS의 14px를 뷰포트 연동으로 덮어씀(좁은 폰 축소)
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
        height: SCORE_H,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: DIGIT_FS,
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
