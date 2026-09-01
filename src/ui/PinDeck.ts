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
 * 표시 조건은 **리브가 있을 때만**(`standing < 10`) — 1구 풀랙에선 정보량이 0이라
 * 상시 노출의 비용만 진다. 스페어 챌린지는 매 라운드가 리브라 자동으로 상시가 된다.
 *
 * ⚠️ 마스크를 믿을 수 있는 시점이 좁다. `PinSet` 사이클 중 `standingMask()`는 중간값이고
 * (GameState.update의 `wasCycling` 주석), `refreshHud()`는 상태 전이 + 사이클 종료에만 불린다.
 * 그래서 AIMING이고 사이클이 멎었을 때만 그린다 — 그 창이 정확히 "확정된 마스크"의 창이다.
 * 프레임 단위 갱신은 필요하지도, 가능하지도 않다.
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

const DOT = 'clamp(14px, 3.8vw, 17px)';
const DOT_FS = 'clamp(8px, 2.2vw, 10px)';

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
  display:flex; flex-direction:column; align-items:center; gap:3px;
  padding:7px 9px; box-sizing:border-box;
}
#hud-pindeck.is-hidden{ display:none; }
#hud-pindeck .pd-row{ display:flex; gap:3px; }
#hud-pindeck .pd-dot{
  width:${DOT}; height:${DOT}; border-radius:50%;
  display:grid; place-items:center;
  font:700 ${DOT_FS}/1 ui-monospace, 'SF Mono', 'Roboto Mono', Menlo, monospace;
  /* 쓰러진 핀 = 자리는 남기고 비운다. 자리가 사라지면 삼각형이 무너져 도면으로 안 읽힌다. */
  background:transparent; color:${HOUSE.faint};
  border:1px solid ${rgba(HOUSE.cream, 0.28)};
  transition:background 0.16s ease, color 0.16s ease;
}
/* 서 있는 핀 = **플랫 크림 색면 + 잉크 숫자.** 예전엔 여기에 터쿼이즈 글로우(0 0 7px)가 있었는데,
   도면은 인쇄물이라 알이 발광하지 않는다 — 색면 대비만으로 이미 충분히 튄다(대비 15:1).
   transition에서 box-shadow도 뺐다(애니메이션할 대상이 없어졌다). */
#hud-pindeck .pd-dot.pd-up{
  background:${HOUSE.cream}; color:${INK};
  border-color:${HOUSE.cream};
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
    applyPanel(this.root, HOUSE.turquoise);
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
   * @param standing `PinSet.standingMask()` (인덱스별). 없으면 숨긴다.
   * @param show 표시할 창인가 — 호출부가 "AIMING이고 사이클이 멎었고 리브가 있다"를 판정한다.
   */
  update(standing: boolean[] | undefined, show: boolean): void {
    if (!show || !standing) {
      this.root.classList.add('is-hidden');
      this.sig = '';
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
