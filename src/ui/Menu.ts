import type { GameMode, MatchConfig, GameSummary, AimAid } from '../game/GameState';
import { AI_PROFILES } from '../game/ai';
import { statsSummary } from '../game/Stats';
import { isCoarsePointer } from '../core/device';
import { SKINS, ACHIEVEMENTS, loadRewards, saveSelectedSkin, unlockedSkinIds, resolveSkin, achievementForSkin, isScreenCustomUnlocked, saveCustomScreen, VIDEO_MARKER, type CustomScreenMedia } from '../game/rewards';
import { fileToScreenSource, fileToScreenVideo } from './screenMedia';
import { saveScreenVideo, loadScreenVideo, clearScreenVideo } from '../game/screenStore';
import type { BallSkin, SkinFinish } from '../game/rewards';
import type { Settings, Quality } from '../game/settings';
import { t, getLocale, detectLocale, LOCALES, LOCALE_LABEL, type I18nKey, type LocaleSetting } from '../i18n';
import { css, HOUSE, PANEL_BG, rgba } from '../ui/theme'; // 디자인 시스템 단일소스(#6) — 로컬 css 복제 제거, 하우스 팔레트 토큰 공유
import { buildResultSheets, SHEET_MAX } from './Hud'; // 결과 모달 점수 시트 — HUD와 같은 렌더러(마크 규칙·5칸 접기 공유)

// === UI juice: 마이크로 모션 — 정적 CSS(.menu-panel button 트랜지션 + juicePanelIn/juiceFadeIn 키프레임 +
// 모션최소화 + View Transitions 커브)는 ui.css로 이동(#4). main.ts가 전역 import하므로 별도 주입 불필요.
// transform/opacity만 써 GPU 합성·레이아웃 무영향. 게임 루프/조준선/물리는 절대 안 건드림.
/** 애니메이션 클래스 재트리거 (리플로우로 리셋 후 재부여) — 재선택·재진입마다 매번 재생되게. */
function playOnce(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth; // 강제 리플로우 → 애니메이션 리셋
  el.classList.add(cls);
}

/** 인게임 일시정지 모달 설정 (Boot이 주입) — 토글은 즉시 적용 + 저장, 모달은 재렌더로 상태 반영. */
export interface PauseConfig {
  settings: Settings;
  onSound: (v: boolean) => void;
  onHaptics: (v: boolean) => void;
  onQuality: (q: Quality) => void;
  onResume: () => void;
  onForfeit: () => void;
}

const COARSE = isCoarsePointer();
/**
 * 결과 모달 점수 시트의 행 폭. **정해진 값이어야 한다** — flex-basis:0 셀은 부모 폭이 안 정해지면
 * 내용폭으로 무너져 빈 칸이 찌그러진다(HUD가 같은 이유로 뷰포트 기준 폭을 쓴다).
 *
 * 두 갈래인 건 **패널의 폭이 정해지는 방식이 반대**라서다:
 * · COARSE — 패널이 `min(360px,92vw)` 고정(border-box)이다. 폭이 이미 정해져 있으니 `100%`가 곧
 *   정해진 값이고, 패딩·테두리를 호출부가 다시 세지 않아도 된다. (뷰포트 식을 여기 복제했다가
 *   테두리 1px×2를 빠뜨려 2px 넘쳤고, 92vw>360이 되는 큰 폰에선 패널이 360에 걸려 35px까지
 *   벌어졌다 — 패널 폭 공식을 두 곳에 두면 반드시 갈린다.)
 * · 데스크톱 — 패널이 내용에 맞춰 자란다(content-box). `100%`는 잡을 기준이 없어 무너지므로
 *   시트가 폭을 **정해줘야** 한다. SHEET_MAX에서 멈추고, 좁은 창에서는 패널 바깥 폭(+패딩 64
 *   +테두리 2)이 92vw를 넘지 않게 그만큼 뺀다.
 */
const RESULT_SHEET_W = COARSE ? '100%' : `min(calc(92vw - 66px), ${SHEET_MAX}px)`;
/** 일시정지 언어 칩을 몇 개까지 펼칠지(자동 포함). 그 이상은 '더보기 ▸'로 접는다 — langChips 주석. */
const LANG_CHIP_MAX = 5; // 터치 환경: 버튼/칩 히트영역 ≥44px (MOBILE_SUPPORT.md §3.1)

const hex6 = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * 스킨 마감을 CSS 그라데이션 스와치로 근사 — 시트는 3D 미사용·DOM 전용이라 실제 머티리얼을 흉내만 낸다.
 * 글로우는 인게임 bloom 도입 전이라(docs/legacy/REWARDS.md §11) 시트에서는 헤일로를 살짝 더 줘 마감 구분을 돕는다.
 */
function skinPreviewStyle(skin: BallSkin): { background: string; shadow: string } {
  if (skin.finish === 'chrome') {
    return {
      background: 'linear-gradient(145deg,#f5f8ff 0%,#aeb6c4 30%,#2a3140 50%,#c9d2e0 70%,#6b7686 100%)',
      shadow: 'inset -3px -4px 7px rgba(0,0,0,0.4)',
    };
  }
  if (skin.finish === 'glow' && skin.emissive != null) {
    const e = hex6(skin.emissive);
    const base = hex6(skin.color ?? 0x111111);
    return {
      background: `radial-gradient(circle at 36% 30%,#ffffff,${e} 42%,${base})`,
      shadow: `0 0 12px ${e}cc,inset -4px -5px 8px rgba(0,0,0,0.45)`,
    };
  }
  if (skin.useWeightColor) {
    // classic — 무게 기반 색은 런타임에 바뀌지만 미리보기는 대표 블루로 고정
    return {
      background: 'radial-gradient(circle at 35% 30%,#9fcfff,#4aa3ff 42%,#1c5fa0)',
      shadow: 'inset -3px -4px 7px rgba(0,0,0,0.45)',
    };
  }
  const c = hex6(skin.color ?? 0x888888);
  return {
    background: `radial-gradient(circle at 35% 30%,#ffffff,${c} 46%,#5c626b)`, // 끝단 = 중성 그림자(구 tailwind gray-500)
    shadow: 'inset -3px -4px 7px rgba(0,0,0,0.3)',
  };
}

// ⚠️ 문자열이 아니라 **키** 맵이다 — 모듈 로드 시점엔 로케일이 없다(i18n/index.ts 규칙 2).
const FINISH_KEY: Record<SkinFinish, I18nKey> = {
  matte: 'finish.matte',
  satin: 'finish.satin',
  metallic: 'finish.metallic',
  chrome: 'finish.chrome',
  glow: 'finish.glow',
};

/**
 * 사운드 on/off 아이콘 (인라인 SVG, currentColor 상속).
 * 스피커 콘 + 음파 1줄, off면 슬래시. 24 그리드에 스트로크 2 — 17px에서 픽셀 정렬이 맞는다.
 */
const SPEAKER_SVG = (on: boolean): string =>
  `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
  `<path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4z" fill="currentColor" stroke="none"/>` +
  (on ? `<path d="M15.8 9.2a4 4 0 0 1 0 5.6"/>` : `<path d="M16.2 9.8l5 4.4M21.2 9.8l-5 4.4"/>`) +
  `</svg>`;

// 프라이머리 버튼 액센트(#7) — 배경 + 그 위 텍스트색. start/again=fire · handoff/resume=ice · equip=gold.
// 색만 프리셋으로 묶고 크기(패딩·폰트·라운드)는 호출부가 제각각이라 옵션으로 — 손복사 5곳을 바이트 동일하게 접는다.
//
// ⚠️ 셋 다 **웜 그라디언트**였고 정지점 6개가 전부 Tailwind 기본값(amber-500 `#f59e0b` ·
// red-500 `#ef4444` · cyan-400 `#22d3ee` · blue-500 `#3b82f6` · amber-400 `#fbbf24`)이었다.
// 그라데 CTA는 그 자체로 표식인 데다, 값이 기본값이라 두 겹으로 걸렸다. **단색 인쇄 버튼**으로 바꾼다 —
// 미드센추리 하우스 사인은 잉크 한 벌로 찍고, 면이 평평해야 슬랩 레터링이 산다.
// 키 이름(fire/ice/gold)은 호출부 5곳의 의미 구분이라 유지한다. 대비는 전부 6:1 이상.
const BTN_ACCENTS = {
  fire: { bg: HOUSE.brick, fg: HOUSE.cream }, // 7.1:1
  ice: { bg: HOUSE.turquoise, fg: '#10171a' }, // 6.2:1
  gold: { bg: HOUSE.mustard, fg: '#1a1205' }, // 8.2:1
} as const;
type BtnAccent = keyof typeof BTN_ACCENTS;

const MODES: { key: GameMode; labelKey: I18nKey; descKey: I18nKey }[] = [
  { key: 'full', labelKey: 'mode.full', descKey: 'mode.full.desc' },
  { key: 'blitz', labelKey: 'mode.blitz', descKey: 'mode.blitz.desc' },
  { key: 'spare', labelKey: 'mode.spare', descKey: 'mode.spare.desc' },
];

const AIM_AIDS: { key: AimAid; labelKey: I18nKey; descKey: I18nKey }[] = [
  { key: 'easy', labelKey: 'aim.easy', descKey: 'aim.easy.desc' },
  { key: 'normal', labelKey: 'aim.normal', descKey: 'aim.normal.desc' },
  { key: 'hard', labelKey: 'aim.hard', descKey: 'aim.hard.desc' },
];

/**
 * 시작 메뉴 + 결과 화면 오버레이 (로드맵 P1).
 * 모드 선택(풀게임/블리츠/스페어 챌린지) + 상대 선택(혼자/AI 라이벌 3인) + 통계 표시.
 * 게임 본체와는 onStart(config) 콜백으로만 연결.
 */
export class MenuUI {
  private readonly backdrop: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private mode: GameMode = 'full';
  private rivalKey: string | null = null; // null=혼자 · 그 외=AI 라이벌 key
  private weight: number; // 볼 무게(lb) — 시작 메뉴·일시정지 모달에서 선택. 초기값은 저장된 설정.
  private aimAid: AimAid = 'easy'; // 조준 보조 (P3, UI 전용) — 기본 easy(§2.7 스마트 기본값)
  private selectedSkin: string = loadRewards().selectedSkin; // 장착 볼 스킨 (보상)
  private skinTab: 'skins' | 'achievements' | 'screen' = 'skins'; // 컬렉션 시트 활성 탭 (A안 탭형)

  constructor(
    private readonly onStart: (cfg: MatchConfig) => void,
    private readonly onMenu: () => void,
    private readonly onWeight: (lb: number) => void,
    private readonly onSkinChange: (id: string) => void,
    private readonly onCustomScreen: (media: CustomScreenMedia | null) => void, // 히든 보상 — 전광판 커스텀
    private readonly settings: Settings, // 시작 메뉴 사운드 토글이 읽는 현재 설정 (pause 모달과 동일 객체)
    private readonly onSound: (v: boolean) => void, // 토글 시 적용+저장 (Boot 주입)
    private readonly onLang: (v: LocaleSetting) => void, // 언어 변경 시 적용+저장 (Boot 주입)
  ) {
    this.weight = settings.ballLb; // 지난 판에서 고른 무게로 시작 (설정에 영속)
    this.backdrop = document.createElement('div');
    css(this.backdrop, {
      position: 'fixed',
      inset: '0',
      height: '100dvh', // 동적 툴바(iOS) 대응 — vh 대신 dvh
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      // safe-area를 패딩으로 비켜 중앙정렬된 패널이 노치/Dynamic Island/홈바 밑으로 파고들지 않게.
      // max(inset, 12~16px): 인셋 없는 데스크톱에서도 최소 여백 보장.
      boxSizing: 'border-box',
      padding:
        'max(env(safe-area-inset-top), 16px) max(env(safe-area-inset-right), 12px) max(env(safe-area-inset-bottom), 16px) max(env(safe-area-inset-left), 12px)',
      // 0.72 → 0.45: 벽·천장을 채운 뒤로는 스크림이 방금 만든 홀을 덮고 있었다.
      // 패널 자체가 rgba(14,17,27,0.96)로 거의 불투명해 **텍스트 가독성은 스크림에 의존하지 않는다**
      // (실측 대비: 스크림 0.72든 0.45든 패널 위 합성 휘도 0.006~0.009로 동일). 순수하게 배경 노출량 조절.
      // blur(4px)는 걷었다 — 위 주석대로 **가독성이 스크림에 의존하지 않으므로** 순수 장식이었고,
      // 프로스티드 표면은 걷어내는 중인 표식이다. 알파는 0.45 그대로 둔다(홀을 보여주려던 결정 유지).
      // 부수 효과로 벽·천장·핀 랙이 더 또렷해져 원래 의도에 오히려 가까워진다.
      background: 'rgba(6,8,14,0.45)',
      zIndex: '40',
    });
    this.panel = document.createElement('div');
    this.panel.classList.add('menu-panel'); // 스코프드 CSS(.menu-panel button)로 전 버튼 마이크로 모션
    css(this.panel, {
      position: 'relative', // 우상단 사운드 토글 등 absolute 자식의 기준
      background: PANEL_BG, // 0.96 → 완전 불투명. applyPanel과 같은 서피스(색상 220°)로 통일
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '4px', // 16px → 4px. applyPanel(3px)과 같은 계열 — 미드센추리 인쇄물은 모서리를 굴리지 않는다
      padding: '28px 32px',
      color: HOUSE.text,
      font: '500 14px/1.5 system-ui, sans-serif',
      // 모바일은 뷰 무관 고정 폭으로 통일 — 안 그러면 패널이 내용 너비에 맞춰져, 내용이 좁은
      // 컬렉션 시트가 메뉴보다 홀쭉해진다. border-box+92vw 상한으로 좁은 폰 가로 오버플로도 방지.
      width: COARSE ? 'min(360px, 92vw)' : '',
      minWidth: COARSE ? '' : '340px',
      boxSizing: COARSE ? 'border-box' : '',
      maxWidth: '92vw',
      // 짧은 가로(landscape) 화면에서 내용이 넘치면 잘림 → 패널 내부 세로 스크롤 허용.
      // 100%: 백드롭의 safe-area 패딩 안쪽으로만 차게(노치/홈바 비침). pan-y: 세로 스크롤만(핀치/더블탭 줌 차단). (§3·§4)
      maxHeight: '100%',
      overflowY: 'auto',
      touchAction: 'pan-y',
      boxShadow: '0 18px 60px rgba(0,0,0,0.5)',
    });
    this.backdrop.appendChild(this.panel);
    document.body.appendChild(this.backdrop);
  }

  hide() {
    this.backdrop.style.display = 'none';
  }

  /**
   * 백드롭 노출. 등장 애니는 **실제 열림(숨김→노출)에만** 재생한다.
   * 이미 열린 상태에서의 재렌더(스킨 선택 후 showSkins 재호출 등)는 애니 없이 내용만 교체 → "닫혔다 열림" 깜빡임 방지.
   */
  private reveal() {
    const opening = this.backdrop.style.display === 'none' || this.backdrop.style.display === '';
    this.backdrop.style.display = 'flex';
    if (opening) {
      playOnce(this.backdrop, 'juice-fade-in');
      playOnce(this.panel, 'juice-panel-in');
    }
  }

  /** 우상단 사운드 on/off 토글 (시작 메뉴). 끄면 메뉴 BGM·지속음까지 멎는다(SoundManager.enabled setter). */
  private soundToggle(): HTMLButtonElement {
    const b = document.createElement('button');
    const paint = () => {
      // 🔊/🔇 이모지 → 인라인 SVG. 이모지는 플랫폼마다 자형·색이 달라 UI 아이콘으로 못 쓰고
      // (안드로이드에선 컬러 자형이 튄다), 이모지를 아이콘으로 쓰는 것 자체가 걷어내는 중인 표식이다.
      // currentColor라 버튼 색 상태를 그대로 따라간다.
      b.innerHTML = SPEAKER_SVG(this.settings.sound);
      b.setAttribute('aria-label', t(this.settings.sound ? 'menu.sound.off' : 'menu.sound.on'));
    };
    css(b, {
      position: 'absolute',
      top: '16px',
      right: '16px',
      width: '40px',
      height: '40px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.14)',
      background: 'rgba(255,255,255,0.04)',
      color: HOUSE.text,
      fontSize: '18px',
      lineHeight: '1',
      padding: '0',
      cursor: 'pointer',
    });
    paint();
    b.onclick = () => {
      this.onSound(!this.settings.sound); // 적용+저장은 Boot 핸들러가 (settings.sound 갱신 포함)
      paint();
    };
    return b;
  }

  // --- 시작 메뉴 --- (섹션별 빌더로 분해, #8후반 — 각 빌더는 자족적으로 this.panel에 append)
  showMenu() {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('STARLITE LANES')); // 브랜드명 — 번역 대상이 아니다(4개 언어에서 차용어로 통한다)
    this.panel.appendChild(this.soundToggle()); // 우상단 사운드 토글
    this.buildMatchupSection(); // 모드 + 상대
    this.buildAimAidSection(); // 조준 난이도 (예측선 표시량 — 점수·물리 무영향)
    this.buildWeightSection(); // 볼 무게 슬라이더
    this.buildSkinEntry(); // 컬렉션 진입
    this.buildStartButton(); // 게임 시작
    this.buildStatsFooter(); // 통계 + 조작법
    this.reveal();
  }

  /** 모드(풀/블리츠/스페어) + 상대(혼자/AI) — 칩맵이 서로를 참조해 한 섹션에 묶는다. */
  private buildMatchupSection(): void {
    // 모드 선택
    this.panel.appendChild(this.sectionLabel(t('menu.section.mode')));
    const modeRow = document.createElement('div');
    css(modeRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    const modeBtns = new Map<GameMode, HTMLButtonElement>();
    for (const m of MODES) {
      const b = this.chipButton(t(m.labelKey), t(m.descKey));
      b.onclick = () => {
        this.mode = m.key;
        if (m.key === 'spare') this.rivalKey = null; // 스페어 챌린지는 솔로만 (AI 불가)
        this.refreshChips(modeBtns, this.mode);
        this.refreshRivalChips(rivalBtns);
      };
      modeBtns.set(m.key, b);
      modeRow.appendChild(b);
    }
    this.panel.appendChild(modeRow);

    // 상대 선택 — 혼자 / AI 라이벌 3인
    this.panel.appendChild(this.sectionLabel(t('menu.section.rival')));
    const rivalRow = document.createElement('div');
    css(rivalRow, { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' });
    const rivalBtns = new Map<string | null, HTMLButtonElement>();
    const solo = this.chipButton(t('menu.rival.solo'), t('menu.rival.solo.desc'));
    solo.onclick = () => {
      this.rivalKey = null;
      this.refreshRivalChips(rivalBtns);
    };
    rivalBtns.set(null, solo);
    rivalRow.appendChild(solo);
    for (const p of AI_PROFILES) {
      const b = this.chipButton(t(p.nameKey), t(p.taglineKey));
      b.onclick = () => {
        if (this.mode === 'spare') return;
        this.rivalKey = p.key;
        this.refreshRivalChips(rivalBtns);
      };
      rivalBtns.set(p.key, b);
      rivalRow.appendChild(b);
    }
    this.panel.appendChild(rivalRow);

    this.refreshChips(modeBtns, this.mode);
    this.refreshRivalChips(rivalBtns);
  }

  /**
   * 조준 난이도 한 줄(쉬움/보통/어려움) — 예측선을 어디까지 그려주는지만 바뀐다. 점수·물리 무영향.
   *
   * 원래 여기가 '레인 난이도'(오일 패턴 + 조준 보조 두 축 + 커스텀 접기)였는데 오일 축을 걷었다.
   * 오일은 난이도가 아니라 **최적 전략이 이동하는** 축이라 단조 사다리에 안 맞는다 — sim-carry
   * 스트라이크 윈도우가 하우스 직구4/훅7 vs 숏 직구6/훅3이라, '어려움=숏'이 직구 플레이어에겐
   * 오히려 넓어졌다(AI 매치 sim도 프리셋 간 ±10점). 축이 하나가 되면서 프리셋 3종이 조준 보조
   * 3단과 1:1이 돼 커스텀 구분 자체가 사라졌다. (docs/legacy/OIL_META_AND_AUTO.md §1.2·§1.5·§2.8)
   *
   * ⚠️ 오일 *시스템*은 그대로 살아 있다 — 하우스 고정 + 풀게임 레인 마름(advanceOilDrying)이
   * 계속 돌고, AI hookDriftFor(endZ)도 그걸 따라간다. 여기서 뺀 건 선택 UI뿐이다.
   */
  private buildAimAidSection(): void {
    this.panel.appendChild(this.sectionLabel(t('menu.section.aim')));
    const aimRow = document.createElement('div');
    css(aimRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    const aimBtns = new Map<AimAid, HTMLButtonElement>();
    for (const a of AIM_AIDS) {
      const b = this.chipButton(t(a.labelKey), t(a.descKey));
      b.onclick = () => {
        this.aimAid = a.key;
        this.refreshChips(aimBtns, this.aimAid);
      };
      aimBtns.set(a.key, b);
      aimRow.appendChild(b);
    }
    this.panel.appendChild(aimRow);
    this.refreshChips(aimBtns, this.aimAid);
  }

  /** 볼 무게 섹션(라벨 + 슬라이더) — 시작 메뉴용. 일시정지 모달도 같은 슬라이더를 쓴다. */
  private buildWeightSection(): void {
    // 볼 무게 (인게임 HUD 대신 여기서 — 매 투구 컨트롤과 분리)
    this.panel.appendChild(this.sectionLabel(t('menu.section.weight')));
    this.panel.appendChild(this.weightRow());
  }

  /**
   * 볼 무게 슬라이더(6~16lb) — 입력 즉시 onWeight로 반영.
   *
   * 시작 메뉴와 일시정지 모달이 공유한다. 매치 중에 바꿔도 안전한 이유는 반영 시점이
   * `GameState.setHumanBallSpec`에 이미 갈려 있기 때문이다: AIMING(사람 차례)이면 즉시,
   * 굴러가는 중이면 저장만 하고 `applyBallSpecForTurn`이 **다음 투구**에 적용한다.
   */
  private weightRow(): HTMLElement {
    const wRow = document.createElement('div');
    css(wRow, { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' });
    const wInput = document.createElement('input');
    wInput.type = 'range';
    wInput.min = '6';
    wInput.max = '16';
    wInput.step = '1'; // 1파운드 단위
    wInput.value = String(this.weight);
    css(wInput, { flex: '1', accentColor: HOUSE.turquoise, minHeight: COARSE ? '44px' : '' });
    const wVal = document.createElement('span');
    wVal.textContent = `${this.weight} lb`;
    css(wVal, { font: "700 14px/1 ui-monospace, 'SF Mono', monospace", color: HOUSE.turquoise, minWidth: '54px', textAlign: 'right' });
    wInput.addEventListener('input', () => {
      this.weight = parseFloat(wInput.value);
      wVal.textContent = `${this.weight} lb`;
      this.onWeight(this.weight);
    });
    wRow.appendChild(wInput);
    wRow.appendChild(wVal);
    return wRow;
  }

  /** 컬렉션(볼 스킨) 진입 — 현재 장착 스킨 라벨을 표시하는 서브틀 버튼. */
  private buildSkinEntry(): void {
    // 볼 스킨 진입 (외형 전용 — 시작 버튼 안 밀게 무게 슬라이더 아래 한 줄, docs/legacy/REWARDS.md §10.1)
    const skinBtn = document.createElement('button');
    skinBtn.textContent = t('menu.skinEntry', { label: t(resolveSkin(this.selectedSkin).labelKey) });
    css(skinBtn, {
      width: '100%',
      padding: COARSE ? '12px' : '10px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.05)',
      color: HOUSE.text,
      font: '700 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
      marginBottom: '14px',
    });
    skinBtn.onclick = () => this.showSkins();
    this.panel.appendChild(skinBtn);
  }

  /** 게임 시작 버튼 (fire 프라이머리). */
  private buildStartButton(): void {
    const start = this.primaryButton(t('menu.start'), 'fire', { size: 16, padding: '12px', radius: 10, marginBottom: '14px' });
    start.onclick = () => this.start();
    this.panel.appendChild(start);
  }

  /** 모드별 최고기록 통계 + 입력 환경별 조작 안내 (패널 하단 푸터). */
  private buildStatsFooter(): void {
    // 통계 (localStorage)
    const s = statsSummary();
    const stats = document.createElement('div');
    css(stats, {
      borderTop: '1px solid rgba(255,255,255,0.1)',
      paddingTop: '10px',
      font: '500 12px/1.7 system-ui, sans-serif',
      color: HOUSE.dim,
    });
    stats.innerHTML = t('menu.statsFooter', { full: s.full, blitz: s.blitz, spare: s.spare });
    this.panel.appendChild(stats);

    // 조작법
    const help = document.createElement('div');
    css(help, { marginTop: '8px', font: '500 11px/1.6 system-ui, sans-serif', color: HOUSE.faint });
    help.textContent = COARSE
      ? t('menu.help.touch')
      : t('menu.help.mouse');
    this.panel.appendChild(help);

    // 언어 진입 — 푸터 톤(작고 흐리게)에 맞춘 한 줄. 우상단 코너 버튼으로 두지 않은 이유:
    // 사운드 토글(40px) 옆에 하나 더 놓으면 좁은 패널(min 340px)에서 타이틀과 겹친다.
    const lang = document.createElement('button');
    lang.textContent = `${LOCALE_LABEL[getLocale()]} ▸`; // 🌐 제거 — 언어 이름 자체가 이미 그 언어로 적혀 있다
    css(lang, {
      marginTop: '10px',
      padding: COARSE ? '8px 0' : '4px 0',
      minHeight: COARSE ? '36px' : '',
      background: 'transparent',
      border: 'none',
      color: HOUSE.dim,
      font: '600 11px/1.6 system-ui, sans-serif',
      cursor: 'pointer',
      textAlign: 'left',
    });
    lang.onclick = () => this.showLangs();
    this.panel.appendChild(lang);
  }

  /**
   * 언어 선택 시트. 각 언어는 **그 언어로** 적는다(번역하지 않는다) — 못 읽는 언어로 적혀 있으면
   * 고를 수가 없다. 'auto'는 지금 감지된 언어를 괄호로 함께 보여줘, 고르면 뭐가 될지 알 수 있게 한다.
   */
  private showLangs(onBack: () => void = () => this.showMenu(), backLabel = t('menu.back.menu')): void {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title(t('menu.section.lang')));

    const list = document.createElement('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' });
    const opts: { value: LocaleSetting; label: string }[] = [
      { value: 'auto', label: `${t('lang.auto')} · ${LOCALE_LABEL[detectLocale()]}` },
      ...LOCALES.map((c) => ({ value: c as LocaleSetting, label: LOCALE_LABEL[c] })),
    ];
    for (const o of opts) {
      const on = this.settings.lang === o.value;
      const b = document.createElement('button');
      b.textContent = o.label;
      css(b, {
        width: '100%',
        padding: COARSE ? '12px 14px' : '10px 13px',
        minHeight: COARSE ? '44px' : '',
        borderRadius: '10px',
        border: `1px solid ${on ? rgba(HOUSE.mustard, 0.5) : 'rgba(255,255,255,0.18)'}`,
        background: on ? rgba(HOUSE.mustard, 0.14) : 'rgba(255,255,255,0.05)',
        color: on ? HOUSE.mustard : HOUSE.text,
        font: `${on ? 800 : 600} 13px/1 system-ui, sans-serif`,
        cursor: 'pointer',
        textAlign: 'left',
      });
      b.onclick = () => {
        this.onLang(o.value); // 적용+저장은 Boot 핸들러가 (setLocale 포함)
        this.showLangs(onBack, backLabel); // 새 언어로 이 시트를 다시 그린다 — 바뀐 걸 즉시 보여준다
      };
      list.appendChild(b);
    }
    this.panel.appendChild(list);

    // ⚠️ backLabel은 **들어올 때의 언어**로 받은 문자열이다. 여기서 언어를 바꿨다면 이미 낡았으므로
    //    되돌아가는 라벨은 지금 언어로 다시 만든다(메뉴에서 왔으면 메뉴 라벨).
    const back = this.ghostButton(backLabel === t('menu.back.pause') ? t('menu.back.pause') : t('menu.back.menu'), { size: 13 });
    back.onclick = onBack;
    this.panel.appendChild(back);
    this.reveal();
  }

  private start() {
    // 사람 1명 + (AI 라이벌 선택 시) AI 1명.
    const players: MatchConfig['players'] = [{ name: t('menu.me') }];
    if (this.mode !== 'spare' && this.rivalKey) {
      const profile = AI_PROFILES.find((p) => p.key === this.rivalKey);
      if (profile) players.push({ name: t(profile.nameKey), ai: profile }); // 매치 시작 시점의 언어로 굳는다(진행 중 변경은 옛 이름 유지)
    }
    const go = () => {
      this.hide();
      this.onStart({ mode: this.mode, players, aimAid: this.aimAid }); // oilPattern 생략 = 하우스 고정(GameState 기본값)
    };
    // View Transitions로 메뉴→게임 크로스페이드 (지원 브라우저만; 미지원은 즉시). 3D 캔버스는 뒤에 상주.
    const startVT = (document as { startViewTransition?: (cb: () => void) => void }).startViewTransition?.bind(document);
    if (startVT) startVT(go);
    else go();
  }

  // --- 결과 화면 ---
  showResult(summary: GameSummary, fresh: string[] = []) {
    this.panel.replaceChildren();
    const solo = summary.players.length === 1;
    const me = summary.players[0];

    let headline: string;
    if (summary.mode === 'spare') headline = t('menu.result.spare', { score: me.score });
    else if (solo) headline = t('menu.result.final', { score: me.score });
    else if (summary.winner === -1) headline = t('menu.result.draw');
    else if (summary.winner === 0) headline = t('menu.result.win');
    else headline = t('menu.result.lose', { name: summary.players[summary.winner].name });
    this.panel.appendChild(this.title(headline));

    // 프레임별 점수 — 예전엔 「상단 점수표에서 확인」 안내 한 줄이었는데, **그 점수표를 이 모달이
    // 가리고 있었다**: 점수판은 z-index 20이고 백드롭이 40 + blur(4px)라 뒤에서 뭉개진다. 좁은
    // 화면에선 접혀 있으면 아예 display:none이라(Hud 미디어쿼리) 없는 걸 가리키기까지 했다.
    // HUD와 같은 렌더러라 좁은 화면 5칸 2줄 접기가 그대로 따라온다.
    //
    // 시트는 **각자 점수 줄 바로 아래**에 끼운다. 이름 패널을 옆에 붙이는 HUD 배치를 그대로
    // 가져오면 그 패널이 102px를 먹어 320px 멀티에서 세 자리 누적이 잘렸다 — 여기선 이름이
    // 바로 위 줄에 이미 있으니 위치로 소속을 말하고 폭은 격자에 준다.
    const sheets = buildResultSheets(summary, RESULT_SHEET_W);
    const list = document.createElement('div');
    css(list, { marginBottom: '14px', font: '600 15px/2 system-ui, sans-serif' });
    summary.players.forEach((p, i) => {
      const row = document.createElement('div');
      css(row, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '24px',
        color: i === summary.winner ? HOUSE.mustard : HOUSE.text,
      });
      const unit = summary.mode === 'spare' ? '/10' : t('menu.result.unit');
      row.innerHTML = `<span>${p.name}</span><span>${p.score}${unit}</span>`; // 🤖 제거 — 이름이 이미 구분한다(Hud 주석)
      list.appendChild(row);
      css(sheets[i], { marginBottom: '10px' });
      list.appendChild(sheets[i]);
    });
    this.panel.appendChild(list);

    if (summary.newBest) {
      const badge = document.createElement('div');
      badge.textContent = t('menu.result.newRecord');
      css(badge, {
        color: HOUSE.mustard,
        font: '800 14px/1 system-ui, sans-serif',
        marginBottom: '14px',
      });
      this.panel.appendChild(badge);
    }

    // 업적 해금 토스트 (보상, docs/legacy/REWARDS.md §10.3) — 결과 화면 일괄 + 즉시 장착 버튼
    if (fresh.length) {
      const box = document.createElement('div');
      css(box, {
        borderRadius: '10px',
        border: `1px solid ${rgba(HOUSE.mustard, 0.4)}`,
        background: rgba(HOUSE.mustard, 0.08),
        padding: '10px 12px',
        marginBottom: '14px',
      });
      for (const id of fresh) {
        const ach = ACHIEVEMENTS.find((a) => a.id === id);
        if (!ach) continue;
        const row = document.createElement('div');
        css(row, { font: '700 13px/1.6 system-ui, sans-serif', color: HOUSE.mustard });
        row.textContent = t('menu.result.newUnlock', { badge: t(ach.badgeKey), skin: t(resolveSkin(ach.reward).labelKey) });
        box.appendChild(row);
      }
      const lastAch = ACHIEVEMENTS.find((a) => a.id === fresh[fresh.length - 1]);
      if (lastAch) {
        const skin = resolveSkin(lastAch.reward);
        const equip = this.primaryButton(t('menu.result.equip', { label: t(skin.labelKey) }), 'gold', { size: 13, padding: '9px', radius: 8, marginTop: '8px' });
        equip.onclick = () => {
          this.equipSkin(skin.id);
          equip.textContent = t('menu.result.equipped', { label: t(skin.labelKey) });
          equip.disabled = true;
          equip.style.opacity = '0.7';
          equip.style.cursor = 'default';
        };
        box.appendChild(equip);
      }
      this.panel.appendChild(box);
    }

    const btnRow = document.createElement('div');
    css(btnRow, { display: 'flex', gap: '8px' });
    const again = this.primaryButton(t('menu.result.retry'), 'fire', { size: 14, padding: '11px', radius: 10, weight: 700, flex1: true });
    again.onclick = () => this.start(); // 같은 설정으로 재시작
    const menu = this.ghostButton(t('menu.toMenu'), { flex1: true });
    menu.onclick = () => {
      this.onMenu();
      this.showMenu();
    };
    btnRow.appendChild(again);
    btnRow.appendChild(menu);
    this.panel.appendChild(btnRow);

    this.reveal();
  }

  // --- 인게임 포기 확인 ---
  // 인게임 일시정지 모달 — 계속하기 + 안전 설정(사운드·햅틱·그래픽) + 조작 안내 + 포기.
  // 네이티브 confirm()은 iOS 웹뷰/시뮬레이터/PWA에서 falsy를 반환해 못 씀 → 앱 내부 DOM 오버레이.
  showPause(cfg: PauseConfig) {
    const s = cfg.settings;
    this.panel.replaceChildren();
    this.panel.appendChild(this.title(t('menu.pause.title')));

    // 설정 — 토글 → 즉시 적용·저장 후 재렌더로 상태 반영.
    // 이 목록(사운드·햅틱·그래픽·언어)은 물리·점수·기록에 무영향이다. 아래 볼 무게만 예외 —
    // 왜 허용하는지는 그 섹션 주석 참고.
    const list = document.createElement('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' });
    list.appendChild(
      this.settingRow(t('menu.pause.sound'), t(s.sound ? 'menu.on' : 'menu.off'), s.sound, () => {
        cfg.onSound(!s.sound);
        this.showPause(cfg);
      }),
    );
    list.appendChild(
      this.settingRow(t('menu.pause.haptics'), t(s.haptics ? 'menu.on' : 'menu.off'), s.haptics, () => {
        cfg.onHaptics(!s.haptics);
        this.showPause(cfg);
      }),
    );
    list.appendChild(
      this.settingRow(t('menu.pause.graphics'), t(s.quality === 'high' ? 'menu.quality.high' : 'menu.quality.perf'), s.quality === 'high', () => {
        cfg.onQuality(s.quality === 'high' ? 'perf' : 'high');
        this.showPause(cfg);
      }),
    );
    this.panel.appendChild(list);

    // 언어 — **행이 아니라 칩을 펼친다.** 이 모달에서 '행 + 오른쪽 칩'은 토글의 문법이라(사운드 켜짐 ·
    // 그래픽 고품질), 언어만 칩이 목록 입구인데 생김새가 같아 `한국어`가 상태로 읽혔다. 게다가 클릭이
    // 칩에만 걸려 있어 "언어" 글자를 눌러도 반응이 없었다 — 아무도 못 찾는 게 당연했다(사용자 제보).
    this.panel.appendChild(this.sectionLabel(t('menu.section.lang')));
    this.panel.appendChild(this.langChips(cfg));

    // 볼 무게 — **매치 중 변경 허용**(2026-09-01 결정). 무게는 속도·질량을 바꿔 캐리에 영향을 주는,
    // 이 모달에서 유일하게 물리에 닿는 항목이다. 그래도 여는 이유:
    //  · 실제 볼링장에서도 게임 도중 공을 바꾼다 — 막을 실물 근거가 없다.
    //  · 하이스코어는 이미 무게 자유 선택 위에 쌓인다(시작 메뉴에서 아무 무게나 고른다).
    //    '도중 변경'만 막는 건 기록 일관성을 실제로 지켜주지 못하면서 불편만 준다.
    // 반영은 다음 투구부터다(위 weightRow 주석 — 굴러가는 공에는 손대지 않는다).
    this.panel.appendChild(this.sectionLabel(t('menu.section.weight')));
    this.panel.appendChild(this.weightRow());

    // 업적·스킨 진입 — 상단 '업적 아일랜드'를 없앴으므로 **인게임에서 여기가 유일한 경로**다.
    // 진행도를 라벨에 얹어, 아일랜드가 상시로 말해주던 정보를 이 한 줄이 대신한다.
    // 닫으면 메뉴가 아니라 **일시정지로 복귀**한다 — 게임이 아직 진행 중이니까.
    const pauseEarned = loadRewards().earned;
    const pauseAchN = ACHIEVEMENTS.filter((a) => pauseEarned.includes(a.id)).length;
    const collBtn = document.createElement('button');
    collBtn.textContent = t('menu.pause.collection', { n: pauseAchN, total: ACHIEVEMENTS.length });
    css(collBtn, {
      width: '100%',
      padding: COARSE ? '12px' : '10px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '10px',
      border: `1px solid ${rgba(HOUSE.mustard, 0.34)}`, // 아일랜드가 쓰던 골드 테두리를 이어받는다
      background: 'rgba(255,255,255,0.05)',
      color: HOUSE.text,
      font: '700 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
      marginBottom: '14px',
    });
    collBtn.onclick = () => this.showSkins(() => this.showPause(cfg), t('menu.back.pause'));
    this.panel.appendChild(collBtn);

    // 조작 안내 (입력 환경별)
    const help = document.createElement('div');
    css(help, {
      font: '500 12px/1.7 system-ui, sans-serif',
      color: HOUSE.faint,
      padding: '10px 13px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: '16px',
    });
    help.innerHTML = COARSE
      ? t('menu.pause.help.touch')
      : t('menu.pause.help.mouse');
    this.panel.appendChild(help);

    // 계속하기 (주 버튼)
    const resume = this.primaryButton(t('menu.pause.resume'), 'ice', { size: 15, padding: '13px', radius: 11, coarseMinHeight: '48px', marginBottom: '8px' });
    resume.onclick = cfg.onResume;
    this.panel.appendChild(resume);

    // 포기 (파괴적, 하단)
    const quit = this.ghostButton(t('menu.pause.forfeit'), { danger: true, size: 13, coarseMinHeight: '44px' });
    quit.onclick = cfg.onForfeit;
    this.panel.appendChild(quit);

    const note = document.createElement('div');
    note.textContent = t('menu.pause.forfeitNote');
    css(note, { font: '500 11px/1.4 system-ui, sans-serif', color: HOUSE.faint, textAlign: 'center', marginTop: '9px' });
    this.panel.appendChild(note);

    this.reveal();
  }

  // 일시정지 설정 행 — 라벨 + 현재값 알약 토글 버튼. active면 초록 강조.
  /**
   * 일시정지 모달의 언어 선택 — 선택지를 그대로 펼친 칩 줄.
   *
   * 서브패널로 들어갔다 나오는 왕복이 없어지고(일시정지 중엔 그 한 단계가 유난히 번거롭다), 각 언어가
   * **그 언어로** 적혀 있어 못 읽는 사람도 자기 걸 찾는다(i18n 규칙). 시작 메뉴 푸터는 그대로 둔다 —
   * 거긴 급할 게 없는 화면이고 세로 여유도 있다.
   *
   * ⚠️ **언어가 늘어도 레이아웃이 안 깨지게** LANG_CHIP_MAX개까지만 칩으로 깔고, 넘치면 마지막을
   * `더보기 ▸`로 접어 기존 목록(showLangs)으로 보낸다. 실측 칩 폭이 49~73px이고 패널 안쪽이 약
   * 320px이라 5개가 두 줄이다 — 그 이상은 칩 벽이 되므로 목록이 맞다. 접을 땐 **자동과 현재 선택은
   * 반드시 남긴다**(지금 뭘 쓰는지가 안 보이면 안 된다).
   */
  private langChips(cfg: PauseConfig): HTMLDivElement {
    const row = document.createElement('div');
    css(row, { display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' });
    const all: { value: LocaleSetting; label: string }[] = [
      // 자동 칩은 **해석 결과를 안 붙인다.** 예전엔 `자동 · 한국어`로 뭐로 풀리는지 함께 적었는데,
      // 이 칩이 앉아 있는 화면의 모든 라벨(언어·볼 무게·계속하기·사운드)이 이미 그 언어로 렌더된다 —
      // 화면 전체가 가장 직접적으로 말하는 걸 한 번 더 적는 꼴이었다. 자세한 형태
      // (`자동 · 기기 설정 · 한국어`)는 여유 있는 시작 메뉴 목록(showLangs)이 갖는다.
      //
      // 폭도 같이 줄지만 **줄바꿈이 없어지는 건 아니다**(실측 375px: 칩 90.3→48.8px, 필요 폭
      // 375.4→333.9px. 행 가용폭이 279px이라 어느 쪽이든 두 줄이고, 나뉘는 모양만 3+2 → 4+1).
      // 데스크톱은 패널이 내용에 맞춰 자라 전후 모두 한 줄이고, 패널이 ~45px 좁아진다.
      { value: 'auto', label: t('lang.auto.short') },
      ...LOCALES.map((c) => ({ value: c as LocaleSetting, label: LOCALE_LABEL[c] })),
    ];
    let shown = all;
    let overflow = false;
    if (all.length > LANG_CHIP_MAX) {
      const keep = new Set<LocaleSetting>(['auto', this.settings.lang]);
      shown = all.filter((o) => keep.has(o.value));
      for (const o of all) {
        if (shown.length >= LANG_CHIP_MAX - 1) break; // 마지막 한 자리는 '더보기'
        if (!keep.has(o.value)) shown.push(o);
      }
      shown.sort((a, b) => all.indexOf(a) - all.indexOf(b)); // 원래 순서 유지
      overflow = true;
    }
    const chip = (label: string, on: boolean, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      css(b, {
        padding: COARSE ? '10px 13px' : '7px 13px',
        minHeight: COARSE ? '40px' : '',
        borderRadius: '999px',
        border: `1px solid ${on ? rgba(HOUSE.mustard, 0.5) : 'rgba(255,255,255,0.18)'}`,
        background: on ? rgba(HOUSE.mustard, 0.14) : 'rgba(255,255,255,0.05)',
        color: on ? HOUSE.mustard : HOUSE.text,
        font: `${on ? 800 : 600} 12px/1 system-ui, sans-serif`,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      b.onclick = onClick;
      return b;
    };
    for (const o of shown) {
      row.appendChild(
        chip(o.label, this.settings.lang === o.value, () => {
          this.onLang(o.value); // 적용+저장은 Boot 핸들러가 (setLocale 포함)
          this.showPause(cfg); // 새 언어로 모달을 다시 그린다 — 바뀐 걸 그 자리에서 보여준다
        }),
      );
    }
    if (overflow) {
      row.appendChild(chip(`${t('menu.more')} ▸`, false, () => this.showLangs(() => this.showPause(cfg), t('menu.back.pause'))));
    }
    return row;
  }

  private settingRow(label: string, valueText: string, active: boolean, onClick: () => void): HTMLDivElement {
    const row = document.createElement('div');
    css(row, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '10px 13px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
    });
    const l = document.createElement('span');
    l.textContent = label;
    css(l, { font: '600 14px/1 system-ui, sans-serif', color: HOUSE.text });
    const btn = document.createElement('button');
    btn.textContent = valueText;
    css(btn, {
      minWidth: '64px',
      minHeight: COARSE ? '36px' : '',
      padding: '7px 13px',
      borderRadius: '999px',
      border: `1px solid ${active ? '#5dca8f' : 'rgba(255,255,255,0.2)'}`,
      background: active ? 'rgba(93,202,143,0.16)' : 'rgba(255,255,255,0.04)',
      color: active ? '#5dca8f' : HOUSE.dim,
      font: '800 12px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    btn.onclick = onClick;
    row.appendChild(l);
    row.appendChild(btn);
    return row;
  }

  // --- 헬퍼 ---
  private title(text: string): HTMLDivElement {
    // ⚠️ 지역명 `t`를 쓰지 않는다 — 모듈 스코프의 i18n `t()`를 가려서, 이 안에서 번역을 부르면 조용히 깨진다.
    const el = document.createElement('div');
    el.textContent = text;
    css(el, {
      font: '800 24px/1.2 system-ui, sans-serif',
      marginBottom: '18px',
      textAlign: 'center',
    });
    return el;
  }

  private sectionLabel(text: string): HTMLDivElement {
    const l = document.createElement('div');
    l.textContent = text;
    css(l, { font: '700 12px/1 system-ui, sans-serif', color: HOUSE.dim, marginBottom: '8px' });
    return l;
  }

  private chipButton(label: string, desc: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.title = desc;
    b.textContent = label;
    css(b, {
      padding: COARSE ? '12px 14px' : '9px 12px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '9px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.05)',
      color: HOUSE.text,
      font: '600 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    return b;
  }

  /**
   * 프라이머리(그라디언트) 버튼 빌더(#7) — start/again/handoff/resume/equip 5곳의 손복사 접기.
   * accent가 색(그라디언트+텍스트), opts가 크기. 호출부마다 크기가 달라 옵션이 많지만 렌더는 기존과 바이트 동일.
   */
  private primaryButton(
    label: string,
    accent: BtnAccent,
    opts: {
      size: number; // 폰트 px
      padding: string;
      radius: number; // borderRadius px
      weight?: number; // 폰트 굵기 (기본 800)
      flex1?: boolean; // width:100% 대신 flex:1 (버튼 행)
      coarseMinHeight?: string; // 터치 환경 최소 높이
      marginTop?: string;
      marginBottom?: string;
    },
  ): HTMLButtonElement {
    const a = BTN_ACCENTS[accent];
    const b = document.createElement('button');
    b.textContent = label;
    css(b, {
      ...(opts.flex1 ? { flex: '1' } : { width: '100%' }),
      padding: opts.padding,
      minHeight: opts.coarseMinHeight && COARSE ? opts.coarseMinHeight : '',
      borderRadius: `${opts.radius}px`,
      border: 'none',
      background: a.bg,
      color: a.fg,
      font: `${opts.weight ?? 800} ${opts.size}px/1 system-ui, sans-serif`,
      cursor: 'pointer',
      ...(opts.marginTop ? { marginTop: opts.marginTop } : {}),
      ...(opts.marginBottom ? { marginBottom: opts.marginBottom } : {}),
    });
    return b;
  }

  /**
   * 고스트(투명+테두리) 버튼 빌더(#7) — 메뉴로/뒤로/포기 3곳. danger면 빨강 테두리·글자(포기).
   * 셋 다 padding 11px·radius 10px 공통, size·flex·minHeight만 다름.
   */
  private ghostButton(
    label: string,
    opts: { flex1?: boolean; size?: number; danger?: boolean; coarseMinHeight?: string } = {},
  ): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    css(b, {
      ...(opts.flex1 ? { flex: '1' } : { width: '100%' }),
      padding: '11px',
      minHeight: opts.coarseMinHeight && COARSE ? opts.coarseMinHeight : '',
      borderRadius: '10px',
      border: `1px solid ${opts.danger ? 'rgba(239,68,68,0.5)' : 'rgba(255,255,255,0.25)'}`,
      background: 'transparent',
      color: opts.danger ? '#f87171' : HOUSE.text,
      font: `700 ${opts.size ?? 14}px/1 system-ui, sans-serif`,
      cursor: 'pointer',
    });
    return b;
  }

  /** '장착' 골드 배지(#7) — 히어로(인라인)·스킨셀(우상단 absolute) 공용. */
  private equippedPill(absolute = false): HTMLSpanElement {
    const pill = document.createElement('span');
    pill.textContent = t('menu.collection.equip');
    css(pill, {
      font: '800 9px/1 system-ui, sans-serif',
      color: '#1a1205',
      background: HOUSE.mustard,
      borderRadius: '5px',
      ...(absolute ? { position: 'absolute', top: '7px', right: '8px', padding: '2px 5px' } : { padding: '3px 6px' }),
    });
    return pill;
  }

  /** 볼 스와치(#7) — skinPreviewStyle 그라데+섀도를 원형에 입힌 미리보기. 히어로 78px·그리드셀 42px 공용. */
  private ballSwatch(skin: BallSkin, size: number, flexNone = false): HTMLSpanElement {
    const el = document.createElement('span');
    const p = skinPreviewStyle(skin);
    css(el, {
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: '50%',
      ...(flexNone ? { flex: '0 0 auto' } : {}),
      background: p.background,
      boxShadow: p.shadow,
    });
    return el;
  }

  private refreshChips<T>(map: Map<T, HTMLButtonElement>, active: T) {
    for (const [k, b] of map) {
      const on = k === active;
      // 팝(바운스) 없이 색만 부드럽게 전환 (.menu-panel button transition이 담당). 여러 칩 동시 전환도 조용.
      b.style.borderColor = on ? HOUSE.mustard : 'rgba(255,255,255,0.18)';
      b.style.background = on ? rgba(HOUSE.mustard, 0.14) : 'rgba(255,255,255,0.05)';
      b.style.color = on ? HOUSE.mustard : HOUSE.text;
    }
  }

  private refreshRivalChips(map: Map<string | null, HTMLButtonElement>) {
    const spareMode = this.mode === 'spare';
    for (const [k, b] of map) {
      const active = k === this.rivalKey;
      b.style.borderColor = active ? HOUSE.mustard : 'rgba(255,255,255,0.18)';
      b.style.background = active ? rgba(HOUSE.mustard, 0.14) : 'rgba(255,255,255,0.05)';
      b.style.color = active ? HOUSE.mustard : HOUSE.text;
      if (k !== null) {
        b.style.opacity = spareMode ? '0.35' : '1';
        b.style.cursor = spareMode ? 'not-allowed' : 'pointer';
      }
    }
  }

  // --- 컬렉션 시트 (docs/legacy/REWARDS.md §10.2 — 같은 패널 세 번째 뷰. 스킨 미리보기 + 업적 진행 겸용) ---
  // 인게임 진입은 일시정지 모달이 showSkins를 직접 부른다(닫으면 메뉴가 아니라 일시정지로 복귀).
  private showSkins(onBack: () => void = () => this.showMenu(), backLabel = t('menu.back.menu')) {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title(t('menu.collection.title')));

    const earned = loadRewards().earned;
    const unlocked = unlockedSkinIds(earned);
    const skinList = Object.values(SKINS);
    const earnedCount = ACHIEVEMENTS.filter((a) => earned.includes(a.id)).length;

    // 히어로 — 지금 장착한 볼을 크게 뽐냄(A안 탭형의 상단 주인공). 아래 탭이 스킨/업적을 갈라 스크롤을 줄인다.
    const equipped = resolveSkin(this.selectedSkin);
    const hero = document.createElement('div');
    css(hero, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '7px',
      padding: '18px 0 15px',
      marginBottom: '16px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '14px',
    });
    const heroBall = this.ballSwatch(equipped, 78);
    const heroName = document.createElement('div');
    css(heroName, { display: 'flex', alignItems: 'center', gap: '7px', font: '700 16px/1 system-ui, sans-serif', color: HOUSE.mustard });
    const heroNameText = document.createElement('span');
    heroNameText.textContent = t(equipped.labelKey);
    heroName.appendChild(heroNameText);
    heroName.appendChild(this.equippedPill());
    const heroFinish = document.createElement('div');
    heroFinish.textContent = t('menu.collection.finish', { finish: t(FINISH_KEY[equipped.finish]) });
    css(heroFinish, { font: '500 11px/1 system-ui, sans-serif', color: HOUSE.faint });
    hero.appendChild(heroBall);
    hero.appendChild(heroName);
    hero.appendChild(heroFinish);
    this.panel.appendChild(hero);

    // 탭 바 — 볼 스킨 / 업적 (진행도 카운트를 탭에 얹어 인-컨텐츠 헤더 제거)
    const tabBar = document.createElement('div');
    css(tabBar, { display: 'flex', marginBottom: '14px', borderBottom: '1px solid rgba(255,255,255,0.1)' });
    const mkTab = (label: string, count: string): HTMLButtonElement => {
      // ⚠️ 지역명 `t` 금지 — i18n `t()`를 가린다(title()의 주석 참고).
      const btn = document.createElement('button');
      btn.textContent = label;
      const c = document.createElement('span');
      c.textContent = ` ${count}`;
      css(c, { font: '500 12px/1 system-ui, sans-serif', opacity: '0.7', marginLeft: '4px' });
      btn.appendChild(c);
      css(btn, {
        flex: '1',
        textAlign: 'center',
        padding: COARSE ? '11px 0' : '9px 0',
        minHeight: COARSE ? '44px' : '',
        background: 'transparent',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: HOUSE.faint,
        font: '700 13px/1 system-ui, sans-serif',
        cursor: 'pointer',
      });
      return btn;
    };
    const skinTabBtn = mkTab(t('menu.tab.skins'), `${unlocked.size}/${skinList.length}`);
    const achTabBtn = mkTab(t('menu.tab.achievements'), `${earnedCount}/${ACHIEVEMENTS.length}`);
    tabBar.appendChild(skinTabBtn);
    tabBar.appendChild(achTabBtn);
    // 전광판 탭은 core 업적을 전부 깨야 나타난다 — 히든이라 잠긴 상태를 아예 안 보여준다.
    const screenUnlocked = isScreenCustomUnlocked(earned);
    const screenTabBtn = screenUnlocked ? mkTab(t('menu.tab.screen'), '✦') : null;
    if (screenTabBtn) tabBar.appendChild(screenTabBtn);
    if (this.skinTab === 'screen' && !screenUnlocked) this.skinTab = 'skins'; // 해금 초기화 대비
    this.panel.appendChild(tabBar);

    // 탭 내용 — 활성 탭에 따라 갈아끼움(this.skinTab로 재빌드 후에도 탭 유지)
    const content = document.createElement('div');
    css(content, { marginBottom: '16px' });
    this.panel.appendChild(content);

    const buildSkinGrid = (): HTMLElement => {
      const grid = document.createElement('div');
      css(grid, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' });
      for (const skin of skinList) {
        const isUnlocked = unlocked.has(skin.id);
        const isEquipped = this.selectedSkin === skin.id;

        let ball: HTMLSpanElement;
        if (isUnlocked) {
          ball = this.ballSwatch(skin, 42, true);
        } else {
          ball = document.createElement('span');
          css(ball, {
            width: '42px',
            height: '42px',
            borderRadius: '50%',
            flex: '0 0 auto',
            background: '#2b3140',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            font: '17px/1 system-ui, sans-serif',
            // ⚠️ 색을 명시해야 한다 — 안 주면 상속이 rgba(16,16,16,0.3)으로 떨어져
            //    #2b3140 원 위에서 **아예 안 보인다**(렌더로 확인). dim이면 대비 5.0.
            color: HOUSE.dim,
            opacity: '0.85',
          });
          ball.textContent = '—'; // 🔒 → 활자 대시. 미해금 = '아직 없음'이고, 어두운 스와치 자체가 이미 신호다
        }

        const labelEl = document.createElement('div');
        labelEl.textContent = t(skin.labelKey);
        css(labelEl, { font: '700 13px/1.2 system-ui, sans-serif', color: isEquipped ? HOUSE.mustard : isUnlocked ? HOUSE.text : HOUSE.faint });
        const subEl = document.createElement('div');
        const unlockAch = achievementForSkin(skin.id);
        subEl.textContent = isUnlocked
          ? t(FINISH_KEY[skin.finish])
          : unlockAch ? t(unlockAch.descKey) : t('menu.collection.locked');
        css(subEl, { font: '500 10px/1.3 system-ui, sans-serif', color: isUnlocked && isEquipped ? '#caa86a' : HOUSE.faint, marginTop: '2px' });
        const textWrap = document.createElement('div');
        css(textWrap, { textAlign: 'center' });
        textWrap.appendChild(labelEl);
        textWrap.appendChild(subEl);

        const cell = document.createElement('button');
        cell.disabled = !isUnlocked;
        css(cell, {
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '7px',
          padding: '11px 11px 9px',
          minHeight: COARSE ? '52px' : '',
          borderRadius: '11px',
          border: isEquipped ? `1px solid ${HOUSE.mustard}` : isUnlocked ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(255,255,255,0.1)',
          background: isEquipped ? rgba(HOUSE.mustard, 0.14) : isUnlocked ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
          cursor: isUnlocked ? 'pointer' : 'not-allowed',
        });
        cell.appendChild(ball);
        cell.appendChild(textWrap);

        if (isEquipped) {
          cell.appendChild(this.equippedPill(true));
        }

        if (isUnlocked) {
          cell.onclick = () => {
            this.equipSkin(skin.id);
            this.showSkins(onBack, backLabel);
          };
        }
        grid.appendChild(cell);
      }
      return grid;
    };

    const buildAchList = (): HTMLElement => {
      const achWrap = document.createElement('div');
      css(achWrap, { display: 'flex', flexDirection: 'column', gap: '6px' });
      for (const a of ACHIEVEMENTS) {
        const got = earned.includes(a.id);
        const row = document.createElement('div');
        css(row, {
          display: 'flex',
          alignItems: 'center',
          gap: '11px',
          padding: '9px 11px',
          borderRadius: '9px',
          background: got ? rgba(HOUSE.mustard, 0.08) : 'rgba(255,255,255,0.02)',
          border: got ? `1px solid ${rgba(HOUSE.mustard, 0.22)}` : '1px solid rgba(255,255,255,0.08)',
          opacity: got ? '1' : '0.75',
        });
        const badge = document.createElement('div');
        badge.textContent = t(a.badgeKey);
        css(badge, { font: '700 12px/1.3 system-ui, sans-serif', color: got ? HOUSE.mustard : HOUSE.dim });
        const desc = document.createElement('div');
        desc.textContent = t('menu.collection.achUnlock', { desc: t(a.descKey), skin: t(resolveSkin(a.reward).labelKey) });
        // 해금/미해금을 설명 텍스트 색으로 나누지 않는다 — 미해금이었던 #6b7686이 대비 4.02로
        // 본문 기준 미달이었고, 상태는 오른쪽 상태 열(초록/faint)이 이미 진다.
        css(desc, { font: '500 10px/1.3 system-ui, sans-serif', color: HOUSE.faint });
        const body = document.createElement('div');
        css(body, { flex: '1' });
        body.appendChild(badge);
        body.appendChild(desc);
        const status = document.createElement('span');
        status.textContent = got ? '✓' : '—'; // ✓/— 활자 한 쌍 — 🔒는 이모지를 상태 아이콘으로 쓴 자리였다
        css(status, { flex: '0 0 auto', font: got ? '800 13px/1 system-ui, sans-serif' : '600 11px/1 system-ui, sans-serif', color: got ? '#5dca8f' : HOUSE.faint });
        row.appendChild(body);
        row.appendChild(status);
        achWrap.appendChild(row);
      }
      return achWrap;
    };

    /** 전광판 커스텀 — 히든 보상. 이미지·GIF를 골라 마퀴 배경으로 깐다. */
    const buildScreenPanel = (): HTMLElement => {
      const wrap = document.createElement('div');
      const current = loadRewards().customScreen;

      const isVideo = current === VIDEO_MARKER;
      const preview = document.createElement('div');
      css(preview, {
        width: '100%',
        aspectRatio: '3 / 1',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.14)',
        background:
          current && !isVideo ? `#04060c center/cover no-repeat url(${JSON.stringify(current)})` : 'rgba(255,255,255,0.04)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: HOUSE.faint,
        font: '600 12px/1 system-ui, sans-serif',
        marginBottom: '10px',
      });
      if (!current) preview.textContent = t('menu.screen.default');
      if (isVideo) preview.textContent = t('menu.screen.video');
      wrap.appendChild(preview);

      const status = document.createElement('div');
      css(status, { font: '500 11px/1.5 system-ui, sans-serif', color: HOUSE.faint, marginBottom: '10px', minHeight: '17px' });
      status.textContent = t('menu.screen.hint');
      wrap.appendChild(status);
      // 영상은 IndexedDB에 있어 동기로 못 읽는다 — 열린 뒤 이름·길이를 채워 넣는다.
      if (isVideo) {
        void loadScreenVideo().then((v) => {
          if (v) status.textContent = t('menu.screen.videoStatus', { name: v.name, dur: v.duration ? ` · ${t('media.seconds', { sec: v.duration })}` : '' });
        });
      }

      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*,video/*';
      css(input, { display: 'none' });
      input.onchange = async () => {
        const f = input.files?.[0];
        input.value = ''; // 같은 파일 재선택도 change가 뜨도록
        if (!f) return;
        status.textContent = t('menu.screen.processing');
        css(status, { color: HOUSE.faint });
        try {
          if (f.type.startsWith('video/')) {
            const vid = await fileToScreenVideo(f);
            await saveScreenVideo({ blob: vid.blob, name: vid.name, duration: vid.duration });
            saveCustomScreen(VIDEO_MARKER); // 실물은 IndexedDB, 여기엔 마커만
            this.onCustomScreen({ kind: 'video', blob: vid.blob });
          } else {
            const media = await fileToScreenSource(f);
            saveCustomScreen(media.src);
            // 저장 성공 확인 — 쿼터 초과 시 save()가 조용히 실패한다(스토어 정책)
            if (loadRewards().customScreen !== media.src) {
              throw new Error(t('menu.screen.noSpace'));
            }
            await clearScreenVideo(); // 이미지로 바꿨으면 남은 영상은 지운다(용량 회수)
            this.onCustomScreen({ kind: 'image', src: media.src });
          }
          this.showSkins(onBack, backLabel); // 미리보기 갱신
        } catch (e) {
          status.textContent = e instanceof Error ? e.message : t('menu.screen.failed');
          css(status, { color: '#f87171' });
        }
      };
      wrap.appendChild(input);

      const pick = this.primaryButton(t(current ? 'menu.screen.pickOther' : 'menu.screen.pick'), 'ice', {
        size: 13,
        padding: '10px',
        radius: 9,
        coarseMinHeight: '44px',
      });
      pick.onclick = () => input.click();
      wrap.appendChild(pick);

      if (current) {
        const reset = this.ghostButton(t('menu.screen.reset'), { size: 13, coarseMinHeight: '44px' });
        css(reset, { marginTop: '8px' });
        reset.onclick = () => {
          saveCustomScreen(null);
          void clearScreenVideo();
          this.onCustomScreen(null);
          this.showSkins(onBack, backLabel);
        };
        wrap.appendChild(reset);
      }
      return wrap;
    };

    let lastRenderedTab: string | null = null;
    const renderTab = () => {
      content.replaceChildren();
      content.appendChild(
        this.skinTab === 'skins' ? buildSkinGrid() : this.skinTab === 'achievements' ? buildAchList() : buildScreenPanel(),
      );
      // 페이드는 '실제 탭 전환'에만. 스킨 선택은 showSkins를 새로 호출(새 클로저 → lastRenderedTab=null)하므로
      // 페이드가 안 걸림 → 볼 그리드가 매번 사라졌다 나타나던 깜빡임 제거.
      if (lastRenderedTab !== null && lastRenderedTab !== this.skinTab) playOnce(content, 'juice-fade-in');
      lastRenderedTab = this.skinTab;
      const mark = (btn: HTMLButtonElement | null, on: boolean) => {
        if (btn) css(btn, { color: on ? HOUSE.turquoise : HOUSE.faint, borderBottomColor: on ? HOUSE.turquoise : 'transparent' });
      };
      mark(skinTabBtn, this.skinTab === 'skins');
      mark(achTabBtn, this.skinTab === 'achievements');
      mark(screenTabBtn, this.skinTab === 'screen');
    };
    skinTabBtn.onclick = () => {
      this.skinTab = 'skins';
      renderTab();
    };
    achTabBtn.onclick = () => {
      this.skinTab = 'achievements';
      renderTab();
    };
    if (screenTabBtn) {
      screenTabBtn.onclick = () => {
        this.skinTab = 'screen';
        renderTab();
      };
    }
    renderTab();

    const back = this.ghostButton(backLabel, { coarseMinHeight: '44px' });
    back.onclick = onBack;
    this.panel.appendChild(back);

    this.reveal();
  }

  private equipSkin(id: string) {
    this.selectedSkin = id;
    saveSelectedSkin(id);
    this.onSkinChange(id);
  }
}
