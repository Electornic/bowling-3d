import { frameScores } from '../game/Scoreboard';
import { SPARE_LEAVES, type GameStateName, type GameMode } from '../game/GameState';
import { t, type I18nKey } from '../i18n';
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
/**
 * 좁은 화면 판정 — **주입 CSS의 @media와 같은 값이어야 한다.** 두 곳이 갈리면
 * 알약/시트 가시성(CSS)과 5칸 청크(JS)가 서로 다른 폭에서 전환돼 한 줄 10칸이 좁은 화면에 남는다.
 */
const NARROW_Q = '(max-width: 760px)';
const isNarrowSheet = () => matchMedia(NARROW_Q).matches;

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
#hud-pill{ display:none; }

@media (max-width:760px){
  /* 좁은 화면 = 격자를 상시로 두지 않는다. 10프레임 한 줄은 폰에서 칸이 ~30px 슬리버가 되고
     상단 16%를 먹어 위·옆으로 다 답답하다(실측 320px: 307×74, 상단 UI 130px). */
  #hud-scoreboard{ display:none; }
  #hud-scoreboard.is-open:not(.is-hidden){
    /* 펼침은 상단 띠가 아니라 **화면 중앙 패널** — 상단에 밀어 넣으면 열어도 답답하다.
       열었을 땐 점수를 보려는 순간이라 레인을 가려도 된다. */
    display:flex;
    top:50%; left:50%; right:auto;
    transform:translate(-50%, -50%);
    align-items:center;
    max-width:96vw;
  }
  #hud-pill:not(.is-hidden){
    display:inline-flex; align-items:center;
    position:fixed; z-index:21;
    top:calc(8px + env(safe-area-inset-top));
    right:calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-right));
    pointer-events:auto;
  }
}`;
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

// ⚠️ 문자열이 아니라 **키** 맵 — 모듈 로드 시점엔 로케일이 없다(i18n/index.ts 규칙 2).
const STATE_KEY: Record<string, I18nKey> = {
  AIMING: 'hud.state.aiming',
  ROLLING: 'hud.state.rolling',
  SETTLING: 'hud.state.counting',
  GAME_OVER: 'hud.state.gameover',
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
/**
 * 지금 왜 못 던지는지까지 담은 상태 텍스트. 핀세터가 도는 동안은 상태가 AIMING이어도 던질 수
 * 없으므로 그걸 우선한다(GameState.readyToThrow와 같은 조건).
 */
const stateText = (d: HudView): string => {
  if (d.resetting && d.state === 'AIMING') return t('hud.resetting');
  const key = STATE_KEY[d.state];
  return key ? t(key) : d.state; // 모르는 상태는 원문 노출(디버깅 단서를 지우지 않는다)
};

export class Hud {
  private readonly wrap: HTMLDivElement;
  private readonly sheets: HTMLDivElement;
  /**
   * 옛 우상단 상태바를 없앤 대신, 그 텍스트를 **점수판 안쪽 첫 줄**로 접어 넣었다.
   * 떠 있는 요소는 줄이지만 정보는 버리지 않는다 — 특히 '핀 정리 중…'은 왜 못 던지는지를
   * 말하는 **기능 정보**라, 없애면 플레이어가 입력 버그로 읽는다(GameState.readyToThrow와 같은 조건).
   */
  private readonly stateLine: HTMLDivElement;
  /**
   * 좁은 화면 전용 알약 — 격자를 접은 자리에 **현재 점수**를 남긴다.
   * ⚠️ 점수를 반드시 넣어야 한다: 옛 상태 줄은 `1F · 1구 · 조준`으로 **점수가 없었고**,
   * 점수는 격자 안에만 있었다. 격자를 접으면서 알약에 점수를 안 넣으면 점수가 통째로 사라진다.
   */
  private readonly pill: HTMLButtonElement;
  private readonly pillLabel: HTMLSpanElement;
  private readonly pillCaret: HTMLSpanElement;
  /** 좁은 화면에서 전체 시트를 펼쳤는가. 넓은 화면에선 의미 없다(항상 보인다). */
  private expanded = false;
  /** 마지막 뷰 — 브레이크포인트가 넘어갈 때 재렌더하려고 들고 있는다(리사이즈는 상태 변화가 없다). */
  private lastView: HudView | null = null;
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

    // --- 좁은 화면 알약 ---
    this.pill = document.createElement('button');
    this.pill.id = 'hud-pill';
    this.pill.type = 'button';
    this.pill.classList.add('is-hidden');
    this.pill.setAttribute('aria-controls', 'hud-scoreboard');
    this.pill.setAttribute('aria-expanded', 'false');
    applyPanel(this.pill, NEON.cyan);
    css(this.pill, {
      // 좌상단 ☰ 메뉴(높이 40)와 같은 가로선 — top이 같으니 높이를 맞춰 세로 중심을 일치시킨다.
      minHeight: '40px',
      boxSizing: 'border-box',
      padding: '10px 13px',
      cursor: 'pointer',
      appearance: 'none',
      color: NEON.text,
      font: FONT_UI,
      letterSpacing: '0.02em',
      whiteSpace: 'nowrap',
      gap: '8px',
    });
    this.pillLabel = document.createElement('span');
    this.pillCaret = document.createElement('span');
    this.pillCaret.textContent = '▾';
    css(this.pillCaret, {
      opacity: '0.65',
      fontSize: '10px',
      transition: 'transform 0.18s ease', // 감속만 — 오버슈트·스프링 재도입 금지(확정 사항)
    });
    this.pill.append(this.pillLabel, this.pillCaret);
    this.pill.onclick = () => {
      this.expanded = !this.expanded;
      this.applyExpanded();
    };
    document.body.appendChild(this.pill);

    // 시트는 매 update()마다 통째로 재렌더되니 상태 변화엔 자동으로 따라간다. 리사이즈만
    // 상태 변화가 없어 스스로 재렌더되지 않으므로 브레이크포인트 전환에서 한 번 밀어준다.
    matchMedia(NARROW_Q).addEventListener('change', () => {
      if (this.lastView) this.update(this.lastView);
    });
  }

  private applyExpanded() {
    this.wrap.classList.toggle('is-open', this.expanded);
    this.pillCaret.style.transform = this.expanded ? 'rotate(180deg)' : '';
    this.pill.setAttribute('aria-expanded', String(this.expanded));
  }

  update(d: HudView) {
    this.lastView = d;
    if (d.state === 'MENU' || !d.players.length) {
      this.wrap.classList.add('is-hidden');
      this.pill.classList.add('is-hidden');
      this.expanded = false; // 매치를 나가면 접힘으로 리셋
      this.applyExpanded();
      this.prevScores = []; // 새 게임 시작 시 팝 오발동 방지
      return;
    }
    this.wrap.classList.remove('is-hidden');
    this.pill.classList.remove('is-hidden');
    this.applyExpanded();
    this.sheets.replaceChildren();

    d.players.forEach((p, i) => {
      this.sheets.appendChild(this.renderSheet(d, p, i === d.current, i));
    });

    const cur = d.players[d.current];
    if (d.state === 'GAME_OVER') {
      this.stateLine.textContent = t('hud.stateLine.gameover');
    } else if (d.mode === 'spare') {
      this.stateLine.textContent = t('hud.stateLine.spare', { frame: cur.frame, frames: d.frames, made: cur.conversions });
    } else {
      // 중앙 업적 아일랜드와 공존하도록 컴팩트하게. 누구 차례인지는 점수판 골드 하이라이트 + 차례 배너로,
      // 선 핀 수는 3D 장면으로 보이므로 상태바에서는 생략(프레임·구·상태만).
      // 핀세터가 도는 동안은 상태가 AIMING이어도 던질 수 없다 — 라벨이 그걸 말해야
      // 플레이어가 '왜 안 던져지지'로 읽지 않는다 (GameState.readyToThrow와 같은 조건).
      this.stateLine.textContent = t('hud.stateLine.frame', { frame: cur.frame, ball: cur.ball, label: stateText(d) });
    }

    // --- 알약 라벨: 프레임 · 구 · **현재 점수** ---
    // 점수가 이 알약의 존재 이유다. 상태 라벨은 '조준'처럼 자명한 값이면 생략하고,
    // 던질 수 없는 이유를 말할 때만(핀 정리 중·핀 카운트·롤링) 뒤에 붙인다 — 길이를 아끼려고.
    const cum = frameScores(cur.rolls.flat(), d.frames);
    let total = 0;
    for (let i = cum.length - 1; i >= 0; i--) {
      if (cum[i] !== undefined) {
        total = cum[i];
        break;
      }
    }
    if (d.state === 'GAME_OVER') {
      this.pillLabel.textContent = t('hud.pill.gameover', { total });
    } else if (d.mode === 'spare') {
      this.pillLabel.textContent = t('hud.pill.spare', { frame: cur.frame, frames: d.frames, made: cur.conversions });
    } else {
      // ⚠️ '조준'이라는 **문자열**이 아니라 **상태**로 판정한다 — 번역되면 문자열이 달라져서
      //    텍스트 비교는 한국어에서만 맞는 코드가 된다(영어에선 상태가 늘 붙어 알약이 넘친다).
      const plain = d.state === 'AIMING' && !d.resetting;
      const suffix = plain ? '' : ` · ${stateText(d)}`;
      this.pillLabel.textContent = t('hud.pill.frame', { frame: cur.frame, ball: cur.ball, total, suffix });
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

    // --- 좁은 화면: 5칸씩 두 줄 ---
    // 한 줄 10칸은 375px에서 마크 셀이 15.3px밖에 안 된다(실측). 5칸씩 쪼개면 31~34px — 2.1배.
    // 세로는 ~65px 늘지만 모바일 시트는 이제 **화면 중앙 패널**이라(상단 띠가 아니라) 그 여유가 있다.
    // 원래 "항상 한 줄(스크롤 0)" 전제는 상단 띠 시절의 제약이었다.
    //
    // ⚠️ CSS 그리드(repeat(5,1fr))로 하면 안 된다 — 10프레임은 마크 칸이 3개라 남들 2칸 폭에
    //    쑤셔넣게 된다. 아래처럼 DOM을 행으로 쪼개면 각 행이 자기 안에서 flex 비례 배분을 해서
    //    (1행 10유닛 / 2행 11유닛) 행 간 마크 셀 차이가 ~9%로 그친다.
    const narrow = isNarrowSheet();
    const perLine = 5;
    const lines: HTMLDivElement[] = [];
    if (narrow && d.frames > perLine) {
      css(sheet, { flexDirection: 'column' });
      for (let i = 0; i < Math.ceil(d.frames / perLine); i++) {
        const ln = document.createElement('div');
        css(ln, { display: 'flex', gap: '3px' });
        lines.push(ln);
        sheet.appendChild(ln);
      }
    }
    const lineFor = (f: number) => (lines.length ? lines[Math.floor(f / perLine)] : sheet);

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
      lineFor(f).appendChild(box);
    }
    this.prevScores[index] = cum; // 다음 렌더 비교용 저장
    row.appendChild(sheet);
    return row;
  }

}
