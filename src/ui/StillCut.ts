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
 * accent·dot·burst는 theme.ts 팔레트에서 유도한다 — 예전엔 #ff2d78·#22d3ee·#4ade80을 리터럴로
 * 다시 적어 뒀고, 그러면 팔레트를 바꿔도 여기만 옛 색으로 남는다.
 * color(큰 글자)는 각 accent를 흰쪽으로 끌어올린 **패널 전용 톤**이라 팔레트에 없는 값이 맞다.
 *
 * ⚠️ 플랫 원색 블록이 **브릭 하나뿐인 건 대비 실측 때문이다.** 브릭은 휘도 0.067이라 cream 글자가
 * 7.1:1로 통과하지만, 터쿼이즈(0.307)·세이지(0.272)를 ground로 쓰면 cream이 2.3:1로 떨어진다.
 * 그래서 나머지는 잉크 패널 + 밝은 글자로 두고, 원색은 하프톤·버스트·규선으로만 진다.
 * 거터만 예외: 축하가 아니라 디플레이팅이라 무채색 + 버스트 0 + 그림자 0이 의도다.
 */
const CFG: Record<StillCutKind, { ground: string; color: string; accent: string; dot: string; burst: string; size: string }> = {
  strike: {
    ground: NEON.brick,
    color: NEON.cream,
    accent: INK,
    dot: rgba(INK, 0.24),
    burst: rgba(NEON.cream, 0.1),
    size: 'clamp(32px,7.5vw,62px)',
  },
  spare: { ground: INK, color: '#c9f4fb', accent: NEON.turquoise, dot: rgba(NEON.turquoise, 0.2), burst: rgba(NEON.turquoise, 0.07), size: 'clamp(28px,6vw,50px)' },
  split: { ground: INK, color: '#d5fae1', accent: NEON.sage, dot: rgba(NEON.sage, 0.2), burst: rgba(NEON.sage, 0.07), size: 'clamp(28px,6vw,50px)' },
  gutter: { ground: INK, color: '#aeb6c2', accent: '#5c6472', dot: 'rgba(92,100,114,0.22)', burst: '', size: 'clamp(24px,5vw,42px)' },
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
    const layers = [`radial-gradient(${c.dot} 1.4px, transparent 1.5px)`];
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
      `border-top:3px solid ${c.accent}`, // 위 규선 — 코믹 셀의 테두리
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
        `background:repeating-linear-gradient(0deg,transparent 0 5px,${c.accent} 5px 6px)`,
        'opacity:0.5',
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
      `color:${c.color}`,
      // 하드 오프셋 그림자 — 2색 잉크 인쇄의 어긋난 판. em이라 글자 크기에 따라 같이 커진다.
      // (예전엔 `0 0 22px 글로우`였다. 흐린 발광은 인쇄물에 없다.)
      gutter ? '' : `text-shadow:0.05em 0.05em 0 ${c.accent}`,
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
        `color:${gutter ? NEON.faint : c.accent}`,
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
      `background:${c.accent}`,
      gutter ? 'opacity:0.5' : '',
      `animation:sc-bar ${gutter ? '0.55s' : '0.5s'} cubic-bezier(0.2,0.9,0.3,1) both`,
    ]
      .filter(Boolean)
      .join(';');
    band.appendChild(bar);

    return band;
  }
}
