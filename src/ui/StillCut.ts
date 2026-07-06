/**
 * 스트라이크/스페어/거터 스틸컷 오버레이 (item 2 폴리싱) — 점수판 아래 풀와이드 검은 밴드(방송 자막 바).
 * 점수판(Hud) 바로 아래에 가로 전체 폭 밴드를 깔고(높이는 콘텐츠 핏), 배경은 투명→진한 검정으로
 * 스며들며(프리즈된 3D가 블러+반투명으로 비쳐 리얼), 큰 캡션이 왼쪽 밖에서 오른쪽으로 "슉" 들어와
 * 착지한다(스피드라인 동반, 하단 액센트 바 왼→오). 밴드 아래 화면은 안 덮음. 결과를 색으로 구분
 * (스트라이크 골드/핑크, 스페어 시안, 거터 회색·글로우X). 전광판(announce) 미표시. 순수 DOM·물리 미터치.
 */
export type StillCutKind = 'strike' | 'spare' | 'gutter';

const HOLD_MS: Record<StillCutKind, number> = { strike: 1800, spare: 1450, gutter: 1550 }; // [튜닝] 유지 시간
const DEFAULT_TOP = '22%'; // [튜닝] 점수판을 못 찾을 때 폴백 상단 위치 (평소엔 점수판 하단에 자동 정렬)
const ANCHOR_GAP = 14; // [튜닝] 점수판 하단과 밴드 사이 간격(px)

// [튜닝] 색·글자 크기 — 검은 밴드 위라 스트로크 없이 색+글로우로 팝. 밴드 높이는 이 크기에 따라 핏.
const CFG: Record<StillCutKind, { color: string; accent: string; glow: string; size: string }> = {
  strike: { color: '#ffe08a', accent: '#ff2d78', glow: 'rgba(255,45,120,0.6)', size: 'clamp(32px,7.5vw,62px)' },
  spare: { color: '#c9f4fb', accent: '#22d3ee', glow: 'rgba(34,211,238,0.55)', size: 'clamp(28px,6vw,50px)' },
  gutter: { color: '#aeb6c2', accent: '#5c6472', glow: 'rgba(0,0,0,0)', size: 'clamp(24px,5vw,42px)' },
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

  /** 결과 스틸컷 발화. kind=strike|spare|gutter, label=큰 문구, sub=보조 문구. */
  show(kind: StillCutKind, label: string, sub = '') {
    if (this.hideTimer != null) clearTimeout(this.hideTimer);
    this.root.replaceChildren();
    this.root.style.opacity = '1';
    this.root.style.transition = '';
    this.root.appendChild(this.buildBand(kind, label, sub));
    this.root.style.display = 'block';
    this.hideTimer = window.setTimeout(() => this.hide(), HOLD_MS[kind]);
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

    // 점수판 아래 풀와이드 밴드 — 가로 전체 폭, 높이 콘텐츠 핏. 배경은 sc-tint로 투명→진한 검정,
    // backdrop blur로 뒤 3D가 스모크 글래스처럼 비쳐 리얼.
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
      '-webkit-backdrop-filter:blur(3px)',
      'backdrop-filter:blur(3px)',
      'animation:sc-tint 0.42s ease-out both',
    ].join(';');

    // 왼→오 밀려가는 스피드라인(횡방향 모션라인). 거터는 생략(힘없음).
    if (!gutter) {
      const streak = document.createElement('div');
      streak.style.cssText = [
        'position:absolute',
        'inset:0',
        `background:repeating-linear-gradient(0deg,transparent 0 5px,${c.accent}22 5px 6px)`,
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
      gutter ? '' : `text-shadow:0 0 22px ${c.glow},0 4px 20px rgba(0,0,0,0.7)`,
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
        `color:${gutter ? '#7d8696' : c.accent}`,
        'animation:sc-sub 0.55s ease-out both',
      ].join(';');
      band.appendChild(s);
    }

    // 하단 풀와이드 액센트 바 — 왼→오로 그어지며 착지 강조
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:absolute',
      'left:0',
      'right:0',
      'bottom:0',
      'height:4px',
      'transform-origin:left center',
      `background:${gutter ? c.accent : `linear-gradient(90deg,${c.accent},${c.color})`}`,
      gutter ? 'opacity:0.5' : `box-shadow:0 0 14px ${c.glow}`,
      `animation:sc-bar ${gutter ? '0.55s' : '0.5s'} cubic-bezier(0.2,0.9,0.3,1) both`,
    ].join(';');
    band.appendChild(bar);

    return band;
  }
}
