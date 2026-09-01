/**
 * 스트라이크/스페어/거터 스틸컷 오버레이 — 점수판 아래 풀와이드 **코믹 패널**(방송 자막 바 계보).
 * 점수판(Hud) 바로 아래에 가로 전체 폭 밴드를 깔고(높이는 콘텐츠 핏), 큰 캡션이 왼쪽 밖에서
 * 오른쪽으로 "슉" 들어와 착지한다(스피드라인 동반, 하단 액센트 규선 왼→오). 밴드 아래는 안 덮음.
 * 결과를 색으로 구분(스트라이크 브릭, 스페어 터쿼이즈, 스플릿 세이지, 거터 무채색). 순수 DOM·물리 미터치.
 *
 * 이벤트 텍스트 연출은 **전부 여기 하나**다 — 예전엔 전광판 캔버스에 76px 글자를 직접 그리는 경로가
 * 따로 있었지만(스플릿·AI 턴), 연출 언어가 둘로 갈리고 커스텀 전광판까지 덮어서 걷어냈다.
 *
 * ⚠️ 2026-09-02에 **팝아트(마스킹 유닛 카탈로그 300 갈래)로 밀었다.** 예전엔 반투명 검정 위에
 * 네온 글로우 텍스트(`text-shadow:0 0 22px`)와 그라데이션 바였다 — 글로우·그라데는 걷어내는 중인
 * 표식이고, 정작 이 컴포넌트는 이미 스피드라인·스큐 진입·큰 이탤릭 레터링으로 **코믹의 문법을
 * 절반쯤 갖고 있었다.** 나머지 절반을 채운다:
 *  · **하프톤 점 필드** — 300 갈래의 정의적 장치(radial-gradient 6px 타일).
 *  · **방사 버스트** — 코믹의 임팩트 장치(repeating-conic-gradient). 거터는 없다(디플레이팅).
 *  · **하드 오프셋 레터링** — 흐린 글로우 → 0.05em 어긋난 단색 그림자(2색 잉크 인쇄의 그 느낌).
 *  · **하드 규선** — 그라데이션 바 → 단색 액센트 규선(위 테두리 + 아래 그어지는 바).
 * 스트라이크만 **플랫 원색 블록**(브릭)이고 나머지는 잉크 패널이다 — 가장 센 순간에 가장 센 장치를 쓴다
 * (이벤트의 경중은 색·크기·모션이 말한다는 아래 HOLD_MS 원칙의 연장).
 */
import { INK, NEON, rgba } from './theme';

export type StillCutKind = 'strike' | 'spare' | 'split' | 'gutter';

/**
 * [튜닝] 유지 시간 — **모든 종류가 같다.**
 *
 * 예전엔 종류마다 1450~1800으로 갈라 뒀는데, 인트로 애니메이션(sc-fly 0.5s + sc-sub 0.55s)은
 * 어느 쪽이든 같아서 그 차이가 "밴드가 머무는 시간"으로만 드러났다 — 350ms 차이는 연출로 읽히지
 * 않고 **버그로 읽힌다**(사용자 지적). 이벤트의 경중은 색·크기·모션이 말하게 두고 시간은 고정한다.
 */
const HOLD_MS = 1600;
const DEFAULT_TOP = '22%'; // [튜닝] 점수판을 못 찾을 때 폴백 상단 위치 (평소엔 점수판 하단에 자동 정렬)
const ANCHOR_GAP = 14; // [튜닝] 점수판 하단과 밴드 사이 간격(px)

/**
 * [튜닝] 종류별 색·글자 크기. 밴드 높이는 글자 크기에 따라 핏.
 *
 * ⚠️ **컬러를 두 번 고쳤다.** 기록해 둘 값어치가 있는 실패다.
 *  ① 1차: 브릭만 색면, 나머지는 잉크 패널 → 스트라이크만 바뀐 셈이 됐다(하프톤·버스트가 안 보였다).
 *  ② 2차: 팔레트 원색을 그대로 색면으로 깔고 글자를 잉크로 뒤집었다 → 대비는 통과했지만
 *     **탁했다**(사용자 지적). 원인은 명확하다 — `turquoise #3aa8a0`·`sage #5c9e6b`는
 *     **중간톤 저채도**다. 1px 테두리 알파 38%에서 좋은 색이 100px 솔리드 색면에서는 무너진다.
 *     거기다 밝은 색면 둘 옆에 어두운 브릭 하나가 서니 명암이 들쭉날쭉해 한 세트로 안 읽혔다.
 *  ③ 지금: **깊은 인쇄 잉크로 통일.** 셋 다 어두운 고채도 색면 + cream 레터링 + 잉크 오프셋이다.
 *     위계는 명암 반전이 아니라 **색온도와 크기**가 진다(브릭 62px > 터쿼이즈·그린 50px > 거터 42px).
 *
 * ground의 깊은 값은 팔레트와 **같은 색상(hue)의 인쇄 농도판**이다 — 터쿼이즈 176°·그린 140°를
 * 유지하면서 명도를 내리고 채도를 올렸다. 잉크로 단순 혼색(mix-to-ink)하면 안 된다:
 * 원색 자체가 저채도라 섞을수록 탁해진다(sage를 62% 섞으면 #314733 올리브 진흙이 된다 — 실산출).
 *
 * 역할을 필드로 쪼갠 이유:
 *  · `sub`는 `outline`과 **분리**한다 — 한 필드였을 때 브릭 위 잉크 보조문구가 2.0:1로 안 읽혔다.
 *    테두리는 장식이라 낮은 대비가 허용되지만 보조문구는 글자다.
 *  · `outline`(패널 윤곽)과 `bar`(왼→오로 그어지는 액센트)도 다르다 — 윤곽은 잉크라 어두운 색면
 *    위에서 은은한 모서리로 앉고, 바는 **보여야 하는 연출**이라 cream이다.
 *
 * 실측 대비(cream on ground): strike 7.1 · spare 6.4 · split 6.8 · gutter 4.6. 전부 본문 기준 통과.
 * 거터만 축하가 아니라 디플레이팅이라 색면 0 · 버스트 0 · 그림자 0이 의도다.
 */
const CFG: Record<
  StillCutKind,
  { ground: string; text: string; sub: string; outline: string; bar: string; shadow: string; dot: string; burst: string; size: string }
> = {
  strike: {
    ground: NEON.brick, // 348° — 팔레트 원색 그대로. 이미 인쇄 농도라 손댈 게 없었다
    text: NEON.cream,
    sub: NEON.cream,
    outline: INK,
    bar: NEON.cream,
    shadow: INK,
    dot: rgba(INK, 0.3),
    burst: rgba(NEON.cream, 0.16),
    size: 'clamp(32px,7.5vw,62px)',
  },
  spare: {
    ground: '#0d5a54', // turquoise와 같은 176°, 인쇄 농도
    text: NEON.cream,
    sub: NEON.cream,
    outline: INK,
    bar: NEON.cream,
    shadow: INK,
    dot: rgba(INK, 0.28),
    burst: rgba(NEON.cream, 0.12),
    size: 'clamp(28px,6vw,50px)',
  },
  split: {
    ground: '#14572f', // sage와 같은 140°, 인쇄 농도
    text: NEON.cream,
    sub: NEON.cream,
    outline: INK,
    bar: NEON.cream,
    shadow: INK,
    dot: rgba(INK, 0.28),
    burst: rgba(NEON.cream, 0.12),
    size: 'clamp(28px,6vw,50px)',
  },
  gutter: {
    ground: INK,
    text: '#aeb6c2',
    sub: NEON.faint,
    outline: '#5c6472',
    bar: '#5c6472',
    shadow: '',
    dot: 'rgba(92,100,114,0.22)',
    burst: '',
    size: 'clamp(24px,5vw,42px)',
  },
};

export class StillCut {
  private readonly root: HTMLDivElement;
  private hideTimer: number | null = null;

  constructor() {
    // 스틸컷 sc-* 키프레임은 ui.css로 이동(#4) — main.ts가 전역 import하므로 별도 주입 불필요.
    this.root = document.createElement('div');
    this.root.style.cssText = ['position:fixed', 'inset:0', 'z-index:28', 'display:none', 'pointer-events:none', 'overflow:hidden'].join(';');
    document.body.appendChild(this.root);
  }

  /** 결과 스틸컷 발화. kind=strike|spare|split|gutter, label=큰 문구, sub=보조 문구. */
  show(kind: StillCutKind, label: string, sub = '') {
    if (this.hideTimer != null) clearTimeout(this.hideTimer);
    this.root.replaceChildren();
    this.root.style.opacity = '1';
    this.root.style.transition = '';
    this.root.appendChild(this.buildBand(kind, label, sub));
    this.root.style.display = 'block';
    this.hideTimer = window.setTimeout(() => this.hide(), HOLD_MS);
  }

  hide() {
    if (this.hideTimer != null) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
    if (this.root.style.display === 'none') return;
    this.root.style.transition = 'opacity 0.22s';
    this.root.style.opacity = '0';
    window.setTimeout(() => {
      this.root.style.display = 'none';
      this.root.replaceChildren();
    }, 230);
  }

  /** 점수판(#hud-scoreboard) 하단 바로 아래 top(px)을 계산 — 없거나 숨김이면 폴백. */
  private resolveTop(): string {
    const sb = document.getElementById('hud-scoreboard');
    if (sb) {
      const r = sb.getBoundingClientRect();
      if (r.height > 0) return `${Math.round(r.bottom + ANCHOR_GAP)}px`;
    }
    return DEFAULT_TOP;
  }

  private buildBand(kind: StillCutKind, label: string, sub: string): HTMLDivElement {
    const c = CFG[kind];
    const gutter = kind === 'gutter';

    // 점수판 아래 풀와이드 밴드 — 가로 전체 폭, 높이 콘텐츠 핏. 밴드 자체는 투명한 레이아웃 껍데기다.
    // ⚠️ 배경을 밴드에 직접 주지 않는다 — 바탕은 아래 `ground` 레이어가 갖고 혼자 페이드인해야
    //    **큰 글자의 왼→오 진입이 페이드에 묻히지 않는다**(예전 sc-tint는 밴드 배경을 직접 애니메이션해
    //    둘이 한 덩어리로 움직였다).
    const band = document.createElement('div');
    band.style.cssText = [
      'position:absolute',
      `top:${this.resolveTop()}`,
      'left:0',
      'right:0',
      'padding:18px 5vw',
      'box-sizing:border-box',
      'overflow:hidden', // 왼쪽 밖에서 날아오는 캡션 클립
      'display:flex',
      'flex-direction:column',
      'align-items:center',
      'gap:6px',
    ].join(';');

    // ── 바탕: 플랫 잉크/원색 + 하프톤 점 + 방사 버스트 (300 갈래의 세 장치) ──
    // 하프톤은 6px 타일의 radial-gradient — 캔버스도 이미지도 필요 없다.
    // 버스트는 repeating-conic-gradient 쐐기. 밴드가 납작해서(전폭 × ~100px) 중심에서 퍼지는
    // 쐐기가 좌우로 길게 눕고, 그게 마침 코믹의 임팩트 선처럼 읽힌다.
    const ground = document.createElement('div');
    const layers = [`radial-gradient(${c.dot} 1.7px, transparent 1.8px)`]; // 1.4 → 1.7px: 6px 타일에서 점이 '보이는' 최소 크기
    const sizes = ['6px 6px'];
    if (c.burst) {
      layers.push(`repeating-conic-gradient(from 0deg at 50% 50%, ${c.burst} 0deg 3.5deg, transparent 3.5deg 11deg)`);
      sizes.push('100% 100%');
    }
    ground.style.cssText = [
      'position:absolute',
      'inset:0',
      `background-color:${c.ground}`,
      `background-image:${layers.join(',')}`,
      `background-size:${sizes.join(',')}`,
      `border-top:4px solid ${c.outline}`, // 코믹 패널 윤곽 — 장식이라 대비 기준 대신 두께로 읽힌다
      'box-shadow:0 12px 34px rgba(0,0,0,0.5)',
      'animation:sc-ground 0.42s ease-out both',
    ].join(';');
    band.appendChild(ground);

    // 왼→오 밀려가는 스피드라인(횡방향 모션라인). 거터는 생략(힘없음).
    // 예전엔 `${accent}22`(알파 13%)였는데 하프톤 위에 얹히면 묻힌다 — 액센트 단색 선을 마스크로만 죽인다.
    if (!gutter) {
      const streak = document.createElement('div');
      streak.style.cssText = [
        'position:absolute',
        'inset:0',
        // 스피드라인은 **보여야 하는 연출**이라 bar와 같은 cream이다. 잉크로 두면 어두운 색면에서 사라진다.
        `background:repeating-linear-gradient(0deg,transparent 0 5px,${c.bar} 5px 6px)`,
        'opacity:0.34',
        '-webkit-mask:linear-gradient(90deg,#000 0%,transparent 60%)',
        'mask:linear-gradient(90deg,#000 0%,transparent 60%)',
        'animation:sc-streak 0.6s ease-out both',
      ].join(';');
      band.appendChild(streak);
    }

    const big = document.createElement('div');
    big.textContent = label;
    big.style.cssText = [
      `font:900 italic ${c.size}/1 system-ui,sans-serif`,
      'letter-spacing:-0.02em',
      'white-space:nowrap',
      'text-align:center',
      'position:relative',
      'will-change:transform',
      `color:${c.text}`,
      // 하드 오프셋 그림자 — 2색 잉크 인쇄의 어긋난 판. em이라 글자 크기에 따라 같이 커진다.
      // (예전엔 `0 0 22px 글로우`였다. 흐린 발광은 인쇄물에 없다.)
      c.shadow ? `text-shadow:0.05em 0.05em 0 ${c.shadow}` : '',
      `animation:${gutter ? 'sc-fly-limp 0.55s ease-out both' : 'sc-fly 0.5s cubic-bezier(0.16,1.1,0.3,1) both'}`,
    ]
      .filter(Boolean)
      .join(';');
    band.appendChild(big);

    if (sub) {
      const s = document.createElement('div');
      s.textContent = sub;
      s.style.cssText = [
        'font:800 clamp(11px,2vw,15px)/1 system-ui,sans-serif',
        'letter-spacing:0.16em',
        'text-align:center',
        'position:relative',
        // 스트라이크는 바탕이 브릭이라 accent(잉크)가 보조문구로 맞다. 잉크 패널 쪽은 accent가 원색이다.
        `color:${c.sub}`, // rule과 분리된 항목 — 테두리는 장식이지만 이건 글자다(브릭 위 잉크 2.0:1 사고)
        'animation:sc-sub 0.55s ease-out both',
      ].join(';');
      band.appendChild(s);
    }

    // 하단 풀와이드 규선 — 왼→오로 그어지며 착지 강조. 단색·글로우 0(그라데 + 0 0 14px였다).
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'bottom:0',
      'height:4px',
      'transform-origin:left center',
      `background:${c.bar}`,
      gutter ? 'opacity:0.5' : '',
      `animation:sc-bar ${gutter ? '0.55s' : '0.5s'} cubic-bezier(0.2,0.9,0.3,1) both`,
    ]
      .filter(Boolean)
      .join(';');
    band.appendChild(bar);

    return band;
  }
}
