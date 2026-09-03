/**
 * 남은 핀 인디케이터 (좌상단 ☰ 아래) — 핀덱 도면 그대로의 삼각형 10알.
 *
 * **왜 있나: 조준 화면에서 "어느 핀이 남았는지"는 3D가 말해주지 못한다.**
 * 실측(fov 40°, `AIM_PZ=-2.7`, 720p) — 핀 하나가 17.9px 높이 · 5.7px 폭이고, 앞줄 대비
 * 뒷줄 밑동 상승이 **1.28px**다. 4개 행이 사실상 한 줄로 겹친다. 게다가 `PIN_ROWS`가 x=0을
 * 공유하므로 **1번이 5번을, 2·3번이 8·9번을 거의 100% 가린다** — 앞 핀이 서 있으면 그 뒤 핀은
 * 화면에 존재하지 않는다. 개수는 씬이 말하지만(그래서 Hud 상태줄은 개수를 안 적는다)
 * **조합은 못 말한다.** 2구 조준의 실제 판단 입력은 조합이다.
 *
 * **매치 중엔 상시 노출**한다(2026-09-02, 사용자 요청). 전엔 리브가 있을 때만(`standing < 10`)
 * 보였다 — "1구 풀랙은 정보량 0"이라는 판단이었는데, 실제 채점 모니터의 핀 표시가 상시인 것처럼
 * 자리가 고정돼 있어야 눈이 습관적으로 찾아간다. 켜졌다 꺼졌다 하는 편이 오히려 시선 비용이 크다.
 *
 * ⚠️ 마스크를 믿을 수 있는 시점은 여전히 좁다. `PinSet` 사이클 중 `standingMask()`는 중간값이고
 * (GameState.update의 `wasCycling` 주석), `refreshHud()`는 상태 전이 + 사이클 종료에만 불린다.
 * 그래서 **그리는 건** AIMING이고 사이클이 멎었을 때만이다 — 그 창이 정확히 "확정된 마스크"의 창이다.
 * 그 밖의 시점(ROLLING·SETTLING·핀세터 가동)엔 **마지막으로 확정된 그림을 그대로 둔다**
 * (= 투구 직전에 서 있던 핀). 프레임 단위 갱신은 필요하지도, 가능하지도 않다.
 * 확정된 그림이 아직 하나도 없으면 숨긴다(빈 삼각형이 먼저 번쩍이지 않게).
 */
import { PIN_ROWS } from '../game/constants';
import { PIN_NUMBERS } from '../game/splits';
import { t } from '../i18n';
import { INK, HOUSE, applyPanel, rgba } from './theme';

/**
 * 화면 배치 = 실제 핀덱 도면. **뒷줄(7-8-9-10)이 위, 헤드핀(1)이 아래** — 볼러 시점에서
 * 레인 +z(멀어지는 쪽)가 화면 위이므로 그쪽이 위에 와야 도면과 씬이 같은 방향을 가리킨다.
 *
 * 행 내 좌→우 = 번호 오름차순이다: `splits.ts`가 world +x(= 화면 왼쪽 = 볼러 왼쪽)부터
 * 번호를 매기므로 작은 번호가 화면 왼쪽이다. 두 상수(`PIN_ROWS`·`PIN_NUMBERS`)에서 유도해
 * 레이아웃이 바뀌어도 여기 숫자를 다시 적을 일이 없게 한다.
 *
 * ⚠️ **좌우가 뒤집히면 조용히 틀린다** — 도면이 거울상이 되면 플레이어가 반대쪽을 노린다.
 * 에러도 안 나고 눈으로도 안 잡힌다(핀이 화면에서 6px다). tests/pindeck-layout.test.ts가
 * `splits.ts`의 번호 규칙과 이 배치의 좌우를 world x로 맞춰 붙잡는다.
 */
export const DISPLAY_ROWS: readonly (readonly number[])[] = (() => {
  const rows: number[][] = [];
  let i = 0;
  for (const cols of PIN_ROWS) rows.push(cols.map(() => PIN_NUMBERS[i++]).sort((a, b) => a - b));
  return rows.reverse();
})();

// 2026-09-02 확대(14~17 → 18~22): 상시 노출로 바뀌며 '읽는' 요소가 됐다 — 6px 핀은 봤을 때만 켜지는 표시엔 맞았지만 상시엔 작다.
const DOT = 'clamp(18px, 4.6vw, 22px)';
const DOT_FS = 'clamp(10px, 2.7vw, 12px)';

function ensurePinDeckStyles(): void {
  if (document.getElementById('hud-pindeck-css')) return;
  const st = document.createElement('style');
  st.id = 'hud-pindeck-css';
  // ⚠️ 위치·가시성은 **전부 여기**가 갖는다. 인라인 style.display는 미디어 쿼리를 항상 이기므로
  //    한 곳이라도 인라인으로 쓰면 좁은 화면 분기가 죽는다(CLAUDE.md UI 규칙).
  st.textContent = `
#hud-pindeck{
  position:fixed; z-index:20; pointer-events:none;
  /* ☰ 메뉴 버튼(top 8, 높이 40) 바로 아래 8px — 같은 좌측 정렬선을 공유한다. */
  top:calc(56px + env(safe-area-inset-top));
  left:calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-left));
  display:flex; flex-direction:column; align-items:center; gap:4px;
  padding:8px 10px; box-sizing:border-box;
}
#hud-pindeck.is-hidden{ display:none; }
#hud-pindeck .pd-row{ display:flex; gap:4px; }
#hud-pindeck .pd-dot{
  width:${DOT}; height:${DOT}; border-radius:50%;
  display:grid; place-items:center;
  font:700 ${DOT_FS}/1 ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, monospace;
  /* 쓰러진 핀 = 자리는 남기고 비운다(꺼진 전구). 자리가 사라지면 삼각형이 무너져 도면으로 안 읽힌다. */
  background:${rgba(INK, 0.45)}; color:${HOUSE.faint};
  border:1px solid ${rgba(HOUSE.cream, 0.22)};
  transition:background 0.16s ease, color 0.16s ease, border-color 0.16s ease;
}
/* 서 있는 핀 = **켜진 앰버 전구 + 잉크 숫자.** 모델은 AMF 'Pindicator'(1953) — 마스킹 유닛 위에서 서 있는 핀을
   앰버 전구로 켜 주던 장치라, 미드센추리 하우스에 실제로 있던 물건이다. 예전의 크림 원판은 흰 점 10개로 읽혀
   팔레트 밖 요소처럼 보였다(사용자 2026-09-02: "컬러 좀 바꾸고"). 머스터드는 점수 시트의 현재 프레임 블록과 같은
   잉크 — 같은 뜻(지금 살아 있는 것). 글로우는 넣지 않는다 — 도면은 인쇄물이고 '켜짐'은 색면 대비(머스터드 위 잉크
   8:1)로 충분하다. transition에 box-shadow가 없는 것도 그래서다. */
#hud-pindeck .pd-dot.pd-up{
  background:${HOUSE.mustard}; color:${INK};
  border-color:${HOUSE.amber};
}

@media (max-width:760px){
  /* 좁은 화면에서 점수 시트를 펼치면 상단 띠(top 56, max-width 96vw)가 이 자리를 덮는다 —
     같은 top을 쓰므로 가로로는 피할 수 없다. 시트는 사용자가 방금 직접 펼친 것이고 곧 접히니
     그동안은 인디케이터가 비킨다. (Hud.applyExpanded가 클래스를 토글) */
  #hud-pindeck.is-covered{ display:none; }
}`;
  document.head.appendChild(st);
}

export class PinDeck {
  private readonly root: HTMLDivElement;
  private readonly dots = new Map<number, HTMLDivElement>();
  /** 직전 렌더의 마스크 서명 — 안 바뀌면 DOM을 안 만진다(update가 상태 전이마다 불린다). */
  private sig = '';

  constructor() {
    ensurePinDeckStyles();
    this.root = document.createElement('div');
    this.root.id = 'hud-pindeck';
    this.root.classList.add('is-hidden');
    this.root.setAttribute('role', 'img');
    applyPanel(this.root, HOUSE.cream); // 크림 규선 — 도크·점수 시트와 같은 인쇄 문법(2026-09-02 톤앤매너)
    for (const nums of DISPLAY_ROWS) {
      const row = document.createElement('div');
      row.className = 'pd-row';
      for (const n of nums) {
        const dot = document.createElement('div');
        dot.className = 'pd-dot';
        dot.textContent = String(n);
        this.dots.set(n, dot);
        row.appendChild(dot);
      }
      this.root.appendChild(row);
    }
    document.body.appendChild(this.root);
  }

  /**
   * @param standing 확정된 `PinSet.standingMask()` (인덱스별). 호출부가 "AIMING이고 사이클이
   *   멎었다"를 판정해 그때만 넘긴다. 없으면 **마지막 그림을 유지**한다(다시 그리지 않는다).
   * @param show 매치 중인가. false면 숨기고 그림도 버린다(다음 매치가 이전 랙을 잠깐 보이지 않게).
   */
  update(standing: boolean[] | undefined, show: boolean): void {
    if (!show) {
      this.root.classList.add('is-hidden');
      this.sig = '';
      return;
    }
    if (!standing) {
      // 미확정 시점 — 확정된 그림이 있으면 그대로 보이고, 없으면 아직 숨긴다.
      this.root.classList.toggle('is-hidden', this.sig === '');
      return;
    }
    this.root.classList.remove('is-hidden');
    const sig = standing.map((s) => (s ? '1' : '0')).join('');
    if (sig === this.sig) return;
    this.sig = sig;
    const up: number[] = [];
    standing.forEach((s, i) => {
      const n = PIN_NUMBERS[i];
      this.dots.get(n)?.classList.toggle('pd-up', s);
      if (s) up.push(n);
    });
    // 라벨은 매 갱신에 다시 넣는다 — 언어 변경을 따로 구독하지 않아도 다음 갱신에 따라온다.
    this.root.setAttribute('aria-label', t('hud.pindeck', { pins: up.sort((a, b) => a - b).join(', ') }));
  }

  /** 좁은 화면에서 점수 시트가 펼쳐져 이 자리를 덮는가 (위 미디어 쿼리와 짝). */
  setCovered(covered: boolean): void {
    this.root.classList.toggle('is-covered', covered);
  }
}
