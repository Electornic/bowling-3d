import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';
import { css, NEON, FONT_UI, FONT_DIGITS, rgba, applyPanel, ensureNeonStyles } from './theme';

// 점수판은 항상 한 줄(스크롤 0). 행 폭 = min(96vw, SHEET_MAX), 프레임·셀은 flex-basis:0 비례 분배 →
// 칸이 비어도(초반 빈 칸) 안 찌그러지고 좁으면 균일 축소. (UI_REVAMP.md "A — 한 줄 꽉 채우기")
// 높이·폰트는 뷰포트 폭에 clamp로 자동 연동 — 폭만 줄던 고정 px 상수를 없애, 작은 폰(~320)에서 칸이
// 홀쭉해지거나 3자리 점수가 넘치지 않게 비율째 축소하고, 큰 폰/데스크톱은 상한(과대 방지)에서 멈춘다.
// 기준선: 320px(최소 지원 — 구형 iPhone SE)에서 floor, ~390px+에서 ceiling(현 데스크톱 크기).
// 상태바를 없애고 그 자리(우상단)에 점수판이 들어오면서 **약 1/3 키웠다.**
// 근거: 주변시는 여러 자리 판독값을 못 읽는다 → 두 갈래 중 하나를 골라야 한다. 숨기거나(온디맨드),
// **곁눈으로도 읽히게 크고 굵게** 만들거나. 후자를 택했고, 그러면 원문 처방("big and bold, stark
// contrasts")대로 실제로 커져야 한다. 작게 두면 상시 노출의 비용만 지고 이득이 없다.
const SHEET_MAX = 560; // 420 → 560 (데스크톱·대형폰 상한). 좁은 화면은 96vw가 이긴다.
const NAME_W = 102; // 멀티 이름 패널 폭(여유 포함) — 풀 시트 행 폭에 가산
const CELL_H = 'clamp(17px, 5.2vw, 22px)'; // 마크 박스 높이
const SCORE_H = 'clamp(20px, 6.2vw, 26px)'; // 누적 점수 줄 높이
const DIGIT_FS = 'clamp(13px, 4.3vw, 18px)'; // 마크·누적 점수 글자 크기

/**
 * 점수판 위치 — **반응형이 인라인 스타일로는 안 된다**(미디어 쿼리가 필요하고, 인라인은 항상 이긴다).
 * 그래서 위치·정렬만 주입 스타일시트가 갖고, display 토글만 인라인이 쓴다.
 *
 * 넓은 화면: 없애버린 상태바 자리 = 우상단(top 8). 상단이 한 줄로 끝난다.
 * 좁은 화면: ☰ 메뉴(좌상단)와 한 줄에 못 들어간다 — 10프레임 시트가 최소 그 폭을 요구하므로
 *   버튼 줄 **아래로** 내려 가운데 정렬한다(예전 배치와 같은 자리). 가로로 피할 수 없어 세로로 비킨다.
 */

function ensureSheetStyles(): void {
  if (document.getElementById('hud-sheet-css')) return;
  const st = document.createElement('style');
  st.id = 'hud-sheet-css';
  // ⚠️ 가시성을 **클래스로만** 다룬다. 인라인 style.display 는 항상 미디어 쿼리를 이기므로
  //    한 곳이라도 인라인으로 쓰면 좁은 화면 분기가 죽는다.
  st.textContent = `
#hud-scoreboard{
  position:fixed; z-index:20; pointer-events:none;
  display:flex; flex-direction:column; gap:6px;
  top:calc(8px + env(safe-area-inset-top));
  right:calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-right));
  align-items:flex-end;
  /* ☰ 메뉴 버튼(좌상단, 오른쪽 끝 ~107px)을 절대 침범하지 않게 */
  max-width:calc(100vw - 128px - env(safe-area-inset-left) - env(safe-area-inset-right));
}
#hud-scoreboard.is-hidden{ display:none; }
`;
  document.head.appendChild(st);
}

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
  resetting?: boolean; // 핀세터 가동 중 (조준 불가) — 상태 라벨이 이걸 우선한다
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
  /**
   * 옛 우상단 상태바를 없앤 대신, 그 텍스트를 **점수판 안쪽 첫 줄**로 접어 넣었다.
   * 떠 있는 요소는 줄이지만 정보는 버리지 않는다 — 특히 '핀 정리 중…'은 왜 못 던지는지를
   * 말하는 **기능 정보**라, 없애면 플레이어가 입력 버그로 읽는다(GameState.readyToThrow와 같은 조건).
   */
  private readonly stateLine: HTMLDivElement;
  // 직전 렌더의 누적 점수(플레이어별) — 값이 바뀐 셀만 팝시키려 비교 (매 프레임 재렌더라 필요). MENU서 리셋.
  private prevScores: (number | undefined)[][] = [];

  constructor() {
    ensureNeonStyles();
    ensureSheetStyles(); // 위치·반응형은 주입 스타일시트가 갖는다 (인라인으로는 미디어 쿼리 불가)

    this.wrap = document.createElement('div');
    this.wrap.id = 'hud-scoreboard'; // StillCut 밴드를 점수판 하단에 자동 정렬하려는 위치 측정 앵커
    // 위치·가시성 전부 스타일시트 소유. 인라인 style은 여기서 한 줄도 쓰지 않는다.
    this.wrap.classList.add('is-hidden');

    // 상태 줄 — 옛 상태바의 내용물. 시트 위에 얹혀 패널의 헤더처럼 읽힌다.
    this.stateLine = document.createElement('div');
    css(this.stateLine, {
      font: FONT_UI,
      fontSize: '11px',
      letterSpacing: '0.06em',
      color: NEON.dim,
      padding: '0 4px',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      maxWidth: '100%',
    });

    this.sheets = document.createElement('div');
    css(this.sheets, { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' });

    this.wrap.append(this.stateLine, this.sheets);
    document.body.appendChild(this.wrap);
  }

  update(d: HudView) {
    if (d.state === 'MENU' || !d.players.length) {
      this.wrap.classList.add('is-hidden');
      this.prevScores = []; // 새 게임 시작 시 팝 오발동 방지
      return;
    }
    this.wrap.classList.remove('is-hidden');
    this.sheets.replaceChildren();

    d.players.forEach((p, i) => {
      this.sheets.appendChild(this.renderSheet(d, p, i === d.current, i));
    });

    const cur = d.players[d.current];
    if (d.state === 'GAME_OVER') {
      this.stateLine.textContent = '🎳 게임 종료';
    } else if (d.mode === 'spare') {
      this.stateLine.textContent = `스페어 ${cur.frame}/${d.frames} · 성공 ${cur.conversions}`;
    } else {
      // 중앙 업적 아일랜드와 공존하도록 컴팩트하게. 누구 차례인지는 점수판 골드 하이라이트 + 차례 배너로,
      // 선 핀 수는 3D 장면으로 보이므로 상태바에서는 생략(프레임·구·상태만).
      // 핀세터가 도는 동안은 상태가 AIMING이어도 던질 수 없다 — 라벨이 그걸 말해야
      // 플레이어가 '왜 안 던져지지'로 읽지 않는다 (GameState.readyToThrow와 같은 조건).
      const label = d.resetting && d.state === 'AIMING' ? '핀 정리 중…' : (STATE_LABEL[d.state] ?? d.state);
      this.stateLine.textContent = `${cur.frame}F · ${cur.ball}구 · ${label}`;
    }
  }

  private renderSheet(d: HudView, p: HudPlayerView, active: boolean, index: number): HTMLDivElement {
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
    const prev = this.prevScores[index]; // 직전 렌더 값 (첫 렌더면 undefined → 팝 안 함)
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
      // 점수가 새로 뜨거나(이전 undefined) 값이 바뀌면 팝 — 첫 렌더는 조용히.
      if (prev && cum[f] !== undefined && cum[f] !== prev[f]) score.classList.add('juice-score-pop');

      box.appendChild(marks);
      box.appendChild(score);
      sheet.appendChild(box);
    }
    this.prevScores[index] = cum; // 다음 렌더 비교용 저장
    row.appendChild(sheet);
    return row;
  }

}
