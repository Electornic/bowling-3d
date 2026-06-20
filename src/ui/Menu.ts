import type { GameMode, MatchConfig, GameSummary, AimAid } from '../game/GameState';
import type { OilPattern } from '../game/oil';
import { AI_PROFILES } from '../game/ai';
import { statsSummary } from '../game/Stats';
import { isCoarsePointer } from '../core/device';
import { SKINS, ACHIEVEMENTS, loadRewards, saveSelectedSkin, unlockedSkinIds, resolveSkin, achievementForSkin } from '../game/rewards';
import type { BallSkin, SkinFinish } from '../game/rewards';
import type { Settings, Quality } from '../game/settings';

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

/** 인게임 일시정지 모달 설정 (Boot이 주입) — 토글은 즉시 적용 + 저장, 모달은 재렌더로 상태 반영. */
export interface PauseConfig {
  settings: Settings;
  onSound: (v: boolean) => void;
  onHaptics: (v: boolean) => void;
  onQuality: (q: Quality) => void;
  onResume: () => void;
  onForfeit: () => void;
}

const COARSE = isCoarsePointer(); // 터치 환경: 버튼/칩 히트영역 ≥44px (MOBILE_SUPPORT.md §3.1)

const hex6 = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

/**
 * 스킨 마감을 CSS 그라데이션 스와치로 근사 — 시트는 3D 미사용·DOM 전용이라 실제 머티리얼을 흉내만 낸다.
 * 글로우는 인게임 bloom 도입 전이라(REWARDS.md §11) 시트에서는 헤일로를 살짝 더 줘 마감 구분을 돕는다.
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
    background: `radial-gradient(circle at 35% 30%,#ffffff,${c} 46%,#6b7280)`,
    shadow: 'inset -3px -4px 7px rgba(0,0,0,0.3)',
  };
}

const FINISH_LABEL: Record<SkinFinish, string> = {
  matte: '무광',
  satin: '새틴',
  metallic: '메탈릭',
  chrome: '크롬',
  glow: '글로우',
};

const MODES: { key: GameMode; label: string; desc: string }[] = [
  { key: 'full', label: '풀게임', desc: '10프레임 정식 룰' },
  { key: 'blitz', label: '블리츠', desc: '3프레임 스피드전' },
  { key: 'spare', label: '스페어 챌린지', desc: '클래식 리브 10연속 픽업 (솔로)' },
];

const OIL_PATTERNS: { key: OilPattern; label: string; desc: string }[] = [
  { key: 'house', label: '하우스', desc: '표준 — 훅이 가장 잘 통하는 친화적 패턴' },
  { key: 'short', label: '숏', desc: '일찍 깨짐 — 풀스핀은 과훅이라 라인을 다시 읽어야' },
  { key: 'long', label: '롱', desc: '늦게 깨짐 — 스키드 길고 훅 약함, 직진 강요' },
];

const AIM_AIDS: { key: AimAid; label: string; desc: string }[] = [
  { key: 'easy', label: '이지', desc: '훅 끝까지 그리는 풀 예측선' },
  { key: 'normal', label: '노멀', desc: '오일 존(직진 구간)까지만 — 훅은 직접 읽기' },
  { key: 'pro', label: '프로', desc: '조준 방향 표식만 — 라인은 온전히 실력' },
];

type Difficulty = 'beginner' | 'intermediate' | 'advanced' | 'custom';

// 난이도 프리셋 (P3 §2.7 — 적응형 대신 큐레이션): 오일+예측선을 한 손잡이로 묶고, 커스텀은 두 축 따로.
// 캐주얼은 '난이도' 하나만 보고, 고수는 커스텀에서 세밀 조정. 매핑은 P0 손맛 후 튜닝 여지.
const DIFFICULTY_PRESETS: { key: Difficulty; label: string; desc: string; oil?: OilPattern; aim?: AimAid }[] = [
  { key: 'beginner', label: '쉬움', desc: '하우스 + 풀 예측선 — 가장 쉬움', oil: 'house', aim: 'easy' },
  { key: 'intermediate', label: '보통', desc: '하우스 + 훅 숨김 — 라인 직접 읽기', oil: 'house', aim: 'normal' },
  { key: 'advanced', label: '어려움', desc: '숏 패턴 + 방향 표식만 — 라인은 실력', oil: 'short', aim: 'pro' },
  { key: 'custom', label: '커스텀', desc: '오일·예측선 직접 선택' },
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
  private rivalKey: string | null = null; // null=혼자 · 'human'=로컬 2인 교대전 · 그 외=AI 라이벌 key
  private p1Name = '1P'; // 로컬 교대전 플레이어 이름 (rivalKey==='human'일 때 사용)
  private p2Name = '2P';
  private weight = 10; // 볼 무게(lb) — 시작 메뉴에서 선택 (인게임 BallPicker 대체)
  private difficulty: Difficulty = 'beginner'; // 난이도 프리셋 (P3 §2.7) — 오일+예측선 큐레이션
  private oilPattern: OilPattern = 'house'; // 오일 패턴 (P3) — 초급 프리셋과 일치
  private aimAid: AimAid = 'easy'; // 예측선 난이도 (P3, UI 전용) — 기본 easy(§2.7)
  private selectedSkin: string = loadRewards().selectedSkin; // 장착 볼 스킨 (보상)

  constructor(
    private readonly onStart: (cfg: MatchConfig) => void,
    private readonly onMenu: () => void,
    private readonly onWeight: (lb: number) => void,
    private readonly onSkinChange: (id: string) => void,
    private readonly settings: Settings, // 시작 메뉴 사운드 토글이 읽는 현재 설정 (pause 모달과 동일 객체)
    private readonly onSound: (v: boolean) => void, // 토글 시 적용+저장 (Boot 주입)
  ) {
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
      background: 'rgba(6,8,14,0.72)',
      backdropFilter: 'blur(4px)',
      zIndex: '40',
    });
    this.panel = document.createElement('div');
    css(this.panel, {
      position: 'relative', // 우상단 사운드 토글 등 absolute 자식의 기준
      background: 'rgba(14,17,27,0.96)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px',
      padding: '28px 32px',
      color: '#e8edf5',
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

  /** 우상단 사운드 on/off 토글 (시작 메뉴). 끄면 메뉴 BGM·지속음까지 멎는다(SoundManager.enabled setter). */
  private soundToggle(): HTMLButtonElement {
    const b = document.createElement('button');
    const paint = () => {
      b.textContent = this.settings.sound ? '🔊' : '🔇';
      b.setAttribute('aria-label', this.settings.sound ? '사운드 끄기' : '사운드 켜기');
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
      color: '#e8edf5',
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

  // --- 시작 메뉴 ---
  showMenu() {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('🎳 BOWLING 3D'));
    this.panel.appendChild(this.soundToggle()); // 우상단 사운드 토글

    // 로컬 교대전 이름 입력 — '2인' 선택 시에만 노출. 생성은 여기서(모드/상대 칩 onclick이 syncNameWrap를
    // 참조해야 함), DOM 배치는 상대 row 아래(아래에서 append). 모드가 스페어면 2인 불가라 자동 숨김.
    const nameWrap = this.buildNameInputs();
    const syncNameWrap = () => {
      nameWrap.style.display = this.mode !== 'spare' && this.rivalKey === 'human' ? 'flex' : 'none';
    };

    // 모드 선택
    this.panel.appendChild(this.sectionLabel('모드'));
    const modeRow = document.createElement('div');
    css(modeRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    const modeBtns = new Map<GameMode, HTMLButtonElement>();
    for (const m of MODES) {
      const b = this.chipButton(`${m.label}`, m.desc);
      b.onclick = () => {
        this.mode = m.key;
        if (m.key === 'spare') this.rivalKey = null; // 스페어 챌린지는 솔로만 (2인·AI 모두 불가)
        this.refreshChips(modeBtns, this.mode);
        this.refreshRivalChips(rivalBtns);
        syncNameWrap();
      };
      modeBtns.set(m.key, b);
      modeRow.appendChild(b);
    }
    this.panel.appendChild(modeRow);

    // 상대 선택 — 혼자 / 👥 2인(로컬 교대전) / AI 라이벌 3인
    this.panel.appendChild(this.sectionLabel('상대'));
    const rivalRow = document.createElement('div');
    css(rivalRow, { display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' });
    const rivalBtns = new Map<string | null, HTMLButtonElement>();
    const solo = this.chipButton('혼자', '연습 모드');
    solo.onclick = () => {
      this.rivalKey = null;
      this.refreshRivalChips(rivalBtns);
      syncNameWrap();
    };
    rivalBtns.set(null, solo);
    rivalRow.appendChild(solo);
    // 로컬 2인 교대전 (사람 vs 사람) — ai 없는 플레이어 2명으로 매치 구성(start). 한 기기 번갈아 투구.
    const human = this.chipButton('👥 2인', '한 기기 교대전 — 사람 vs 사람');
    human.onclick = () => {
      if (this.mode === 'spare') return; // 스페어 챌린지는 솔로만
      this.rivalKey = 'human';
      this.refreshRivalChips(rivalBtns);
      syncNameWrap();
    };
    rivalBtns.set('human', human);
    rivalRow.appendChild(human);
    for (const p of AI_PROFILES) {
      const b = this.chipButton(p.name, p.tagline);
      b.onclick = () => {
        if (this.mode === 'spare') return;
        this.rivalKey = p.key;
        this.refreshRivalChips(rivalBtns);
        syncNameWrap();
      };
      rivalBtns.set(p.key, b);
      rivalRow.appendChild(b);
    }
    this.panel.appendChild(rivalRow);
    this.panel.appendChild(nameWrap); // 2인 선택 시 노출되는 이름 입력 (display는 syncNameWrap가 관리)

    this.refreshChips(modeBtns, this.mode);
    this.refreshRivalChips(rivalBtns);
    syncNameWrap();

    // 난이도 프리셋 (P3 §2.7 — 오일+예측선을 한 손잡이로 큐레이션. '커스텀'에서만 두 축 따로)
    this.panel.appendChild(this.sectionLabel('레인 난이도'));
    const diffRow = document.createElement('div');
    css(diffRow, { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' });
    const diffBtns = new Map<Difficulty, HTMLButtonElement>();

    // 커스텀 전용 컨테이너 — 프리셋 선택 시 숨김, '커스텀'에서만 노출
    const customWrap = document.createElement('div');
    const oilBtns = new Map<OilPattern, HTMLButtonElement>();
    const aimBtns = new Map<AimAid, HTMLButtonElement>();

    for (const d of DIFFICULTY_PRESETS) {
      const b = this.chipButton(d.label, d.desc);
      b.onclick = () => {
        this.difficulty = d.key;
        if (d.oil && d.aim) {
          this.oilPattern = d.oil;
          this.aimAid = d.aim;
          this.refreshChips(oilBtns, this.oilPattern);
          this.refreshChips(aimBtns, this.aimAid);
        }
        customWrap.style.display = d.key === 'custom' ? 'block' : 'none';
        this.refreshChips(diffBtns, this.difficulty);
      };
      diffBtns.set(d.key, b);
      diffRow.appendChild(b);
    }
    this.panel.appendChild(diffRow);
    this.refreshChips(diffBtns, this.difficulty);

    // 커스텀 — 오일 패턴 (어디서 훅이 깨지는지가 달라져 라인 읽기를 강요)
    customWrap.appendChild(this.sectionLabel('오일 패턴'));
    const oilRow = document.createElement('div');
    css(oilRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    for (const o of OIL_PATTERNS) {
      const b = this.chipButton(o.label, o.desc);
      b.onclick = () => {
        this.oilPattern = o.key;
        this.refreshChips(oilBtns, this.oilPattern);
      };
      oilBtns.set(o.key, b);
      oilRow.appendChild(b);
    }
    customWrap.appendChild(oilRow);

    // 커스텀 — 조준 보조 (예측선 난이도, 점수·물리 무영향)
    customWrap.appendChild(this.sectionLabel('조준 보조'));
    const aimRow = document.createElement('div');
    css(aimRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    for (const a of AIM_AIDS) {
      const b = this.chipButton(a.label, a.desc);
      b.onclick = () => {
        this.aimAid = a.key;
        this.refreshChips(aimBtns, this.aimAid);
      };
      aimBtns.set(a.key, b);
      aimRow.appendChild(b);
    }
    customWrap.appendChild(aimRow);

    this.panel.appendChild(customWrap);
    this.refreshChips(oilBtns, this.oilPattern);
    this.refreshChips(aimBtns, this.aimAid);
    customWrap.style.display = this.difficulty === 'custom' ? 'block' : 'none';

    // 볼 무게 (인게임 HUD 대신 여기서 — 한 번 정하면 끝인 설정이라 매 투구 컨트롤과 분리)
    this.panel.appendChild(this.sectionLabel('볼 무게'));
    const wRow = document.createElement('div');
    css(wRow, { display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' });
    const wInput = document.createElement('input');
    wInput.type = 'range';
    wInput.min = '6';
    wInput.max = '16';
    wInput.step = '1'; // 1파운드 단위
    wInput.value = String(this.weight);
    css(wInput, { flex: '1', accentColor: '#22d3ee', minHeight: COARSE ? '44px' : '' });
    const wVal = document.createElement('span');
    wVal.textContent = `${this.weight} lb`;
    css(wVal, { font: "700 14px/1 ui-monospace, 'SF Mono', monospace", color: '#22d3ee', minWidth: '54px', textAlign: 'right' });
    wInput.addEventListener('input', () => {
      this.weight = parseFloat(wInput.value);
      wVal.textContent = `${this.weight} lb`;
      this.onWeight(this.weight);
    });
    wRow.appendChild(wInput);
    wRow.appendChild(wVal);
    this.panel.appendChild(wRow);

    // 볼 스킨 진입 (외형 전용 — 시작 버튼 안 밀게 무게 슬라이더 아래 한 줄, REWARDS.md §10.1)
    const skinBtn = document.createElement('button');
    skinBtn.textContent = `🎨 컬렉션 · ${resolveSkin(this.selectedSkin).label} ▸`;
    css(skinBtn, {
      width: '100%',
      padding: COARSE ? '12px' : '10px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.05)',
      color: '#e8edf5',
      font: '700 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
      marginBottom: '14px',
    });
    skinBtn.onclick = () => this.showSkins();
    this.panel.appendChild(skinBtn);

    // 시작
    const start = document.createElement('button');
    start.textContent = '게임 시작';
    css(start, {
      width: '100%',
      padding: '12px',
      borderRadius: '10px',
      border: 'none',
      background: 'linear-gradient(90deg,#f59e0b,#ef4444)',
      color: '#fff',
      font: '800 16px/1 system-ui, sans-serif',
      cursor: 'pointer',
      marginBottom: '14px',
    });
    start.onclick = () => this.start();
    this.panel.appendChild(start);

    // 통계 (localStorage)
    const s = statsSummary();
    const stats = document.createElement('div');
    css(stats, {
      borderTop: '1px solid rgba(255,255,255,0.1)',
      paddingTop: '10px',
      font: '500 12px/1.7 system-ui, sans-serif',
      color: '#aab3c2',
    });
    stats.innerHTML = `풀게임 — ${s.full}<br>블리츠 — ${s.blitz}<br>스페어 챌린지 — ${s.spare}`;
    this.panel.appendChild(stats);

    // 조작법
    const help = document.createElement('div');
    css(help, { marginTop: '8px', font: '500 11px/1.6 system-ui, sans-serif', color: '#6b7686' });
    help.textContent = COARSE
      ? '누른 채 좌우로 조준 · 떼면 파워 발사 · 하단 바 = 스핀'
      : '마우스 이동 = 조준 · 꾹 눌렀다 떼기 = 파워 발사 · Q/E = 좌/우 스핀';
    this.panel.appendChild(help);

    this.backdrop.style.display = 'flex';
  }

  private start() {
    // 로컬 교대전: 사람 2명(ai 없음). 그 외: 사람 1명 + (AI 라이벌 선택 시) AI 1명. 이름 빈칸은 기본값.
    let players: MatchConfig['players'];
    if (this.mode !== 'spare' && this.rivalKey === 'human') {
      players = [{ name: this.p1Name.trim() || '1P' }, { name: this.p2Name.trim() || '2P' }];
    } else {
      players = [{ name: '나' }];
      if (this.mode !== 'spare' && this.rivalKey) {
        const profile = AI_PROFILES.find((p) => p.key === this.rivalKey);
        if (profile) players.push({ name: profile.name, ai: profile });
      }
    }
    this.hide();
    this.onStart({ mode: this.mode, players, oilPattern: this.oilPattern, aimAid: this.aimAid });
  }

  // --- 결과 화면 ---
  showResult(summary: GameSummary, fresh: string[] = []) {
    this.panel.replaceChildren();
    const solo = summary.players.length === 1;
    const me = summary.players[0];

    const hotseat = summary.players.filter((p) => !p.ai).length > 1; // 사람 2인 교대전 — 'P1 시점' 문구 대신 이름
    let headline: string;
    if (summary.mode === 'spare') headline = `스페어 ${me.score}/10 성공!`;
    else if (solo) headline = `최종 ${me.score}점`;
    else if (summary.winner === -1) headline = '무승부!';
    else if (hotseat) headline = `🏆 ${summary.players[summary.winner].name} 승리!`;
    else if (summary.winner === 0) headline = '🏆 승리!';
    else headline = `패배… ${summary.players[summary.winner].name}의 승리`;
    this.panel.appendChild(this.title(headline));

    const list = document.createElement('div');
    css(list, { marginBottom: '14px', font: '600 15px/2 system-ui, sans-serif' });
    summary.players.forEach((p, i) => {
      const row = document.createElement('div');
      css(row, {
        display: 'flex',
        justifyContent: 'space-between',
        gap: '24px',
        color: i === summary.winner ? '#ffd54a' : '#e8edf5',
      });
      const unit = summary.mode === 'spare' ? `/10` : '점';
      row.innerHTML = `<span>${p.ai ? '🤖 ' : ''}${p.name}</span><span>${p.score}${unit}</span>`;
      list.appendChild(row);
    });
    this.panel.appendChild(list);

    if (summary.newBest) {
      const badge = document.createElement('div');
      badge.textContent = '✨ 새 기록!';
      css(badge, {
        color: '#ffd54a',
        font: '800 14px/1 system-ui, sans-serif',
        marginBottom: '14px',
      });
      this.panel.appendChild(badge);
    }

    // 업적 해금 토스트 (보상, REWARDS.md §10.3) — 결과 화면 일괄 + 즉시 장착 버튼
    if (fresh.length) {
      const box = document.createElement('div');
      css(box, {
        borderRadius: '10px',
        border: '1px solid rgba(255,213,74,0.4)',
        background: 'rgba(255,213,74,0.08)',
        padding: '10px 12px',
        marginBottom: '14px',
      });
      for (const id of fresh) {
        const ach = ACHIEVEMENTS.find((a) => a.id === id);
        if (!ach) continue;
        const row = document.createElement('div');
        css(row, { font: '700 13px/1.6 system-ui, sans-serif', color: '#ffd54a' });
        row.textContent = `${ach.icon} NEW · ${ach.badge} → ${resolveSkin(ach.reward).label}`;
        box.appendChild(row);
      }
      const lastAch = ACHIEVEMENTS.find((a) => a.id === fresh[fresh.length - 1]);
      if (lastAch) {
        const skin = resolveSkin(lastAch.reward);
        const equip = document.createElement('button');
        equip.textContent = `${skin.label} 장착하기`;
        css(equip, {
          marginTop: '8px',
          width: '100%',
          padding: '9px',
          borderRadius: '8px',
          border: 'none',
          background: 'linear-gradient(90deg,#fbbf24,#f59e0b)',
          color: '#1a1205',
          font: '800 13px/1 system-ui, sans-serif',
          cursor: 'pointer',
        });
        equip.onclick = () => {
          this.equipSkin(skin.id);
          equip.textContent = `✓ ${skin.label} 장착됨`;
          equip.disabled = true;
          equip.style.opacity = '0.7';
          equip.style.cursor = 'default';
        };
        box.appendChild(equip);
      }
      this.panel.appendChild(box);
    }

    const note = document.createElement('div');
    css(note, { font: '500 12px/1.5 system-ui, sans-serif', color: '#aab3c2', marginBottom: '16px' });
    note.textContent = '프레임별 점수는 상단 점수표에서 확인';
    this.panel.appendChild(note);

    const btnRow = document.createElement('div');
    css(btnRow, { display: 'flex', gap: '8px' });
    const again = document.createElement('button');
    again.textContent = '다시 하기';
    css(again, {
      flex: '1',
      padding: '11px',
      borderRadius: '10px',
      border: 'none',
      background: 'linear-gradient(90deg,#f59e0b,#ef4444)',
      color: '#fff',
      font: '700 14px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    again.onclick = () => this.start(); // 같은 설정으로 재시작
    const menu = document.createElement('button');
    menu.textContent = '메뉴로';
    css(menu, {
      flex: '1',
      padding: '11px',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'transparent',
      color: '#e8edf5',
      font: '700 14px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    menu.onclick = () => {
      this.onMenu();
      this.showMenu();
    };
    btnRow.appendChild(again);
    btnRow.appendChild(menu);
    this.panel.appendChild(btnRow);

    this.backdrop.style.display = 'flex';
  }

  // --- 로컬 교대전 핸드오프 ---
  /**
   * 다음 플레이어 차례 — 한 기기 교대전에서 기기를 넘길 때 끼우는 차단 오버레이.
   * 탭 전까지 입력은 Boot이 game.inputLocked로 잠그고(조준선·게이지·발사·스핀 차단), 백드롭이 캔버스·
   * 하단 도크 포인터를 가린다. 직전 플레이어 조준이 다음 사람에게 새지 않게 하는 게 핵심. onReady에서 해제.
   */
  showHandoff(name: string, onReady: () => void) {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('🔄 다음 차례'));

    const who = document.createElement('div');
    who.textContent = name;
    css(who, { font: '800 30px/1.2 system-ui, sans-serif', textAlign: 'center', color: '#ffd54a', marginBottom: '6px' });
    this.panel.appendChild(who);

    const sub = document.createElement('div');
    sub.textContent = '기기를 넘겨주세요 · 준비되면 시작';
    css(sub, { font: '500 13px/1.5 system-ui, sans-serif', color: '#aab3c2', textAlign: 'center', marginBottom: '20px' });
    this.panel.appendChild(sub);

    const go = document.createElement('button');
    go.textContent = '내 차례 시작 ▶';
    css(go, {
      width: '100%',
      padding: '13px',
      minHeight: COARSE ? '48px' : '',
      borderRadius: '11px',
      border: 'none',
      background: 'linear-gradient(90deg,#22d3ee,#3b82f6)',
      color: '#06121a',
      font: '800 15px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    go.onclick = () => {
      this.hide();
      onReady();
    };
    this.panel.appendChild(go);

    this.backdrop.style.display = 'flex';
  }

  // --- 인게임 포기 확인 ---
  // 인게임 일시정지 모달 — 계속하기 + 안전 설정(사운드·햅틱·그래픽) + 조작 안내 + 포기.
  // 네이티브 confirm()은 iOS 웹뷰/시뮬레이터/PWA에서 falsy를 반환해 못 씀 → 앱 내부 DOM 오버레이.
  showPause(cfg: PauseConfig) {
    const s = cfg.settings;
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('⏸ 일시정지'));

    // 설정 (게임 중 변경해도 안전 — 물리·점수·기록 무영향. 토글 → 즉시 적용·저장 후 재렌더로 상태 반영)
    const list = document.createElement('div');
    css(list, { display: 'flex', flexDirection: 'column', gap: '7px', marginBottom: '14px' });
    list.appendChild(
      this.settingRow('🔊 사운드', s.sound ? '켜짐' : '꺼짐', s.sound, () => {
        cfg.onSound(!s.sound);
        this.showPause(cfg);
      }),
    );
    list.appendChild(
      this.settingRow('📳 햅틱', s.haptics ? '켜짐' : '꺼짐', s.haptics, () => {
        cfg.onHaptics(!s.haptics);
        this.showPause(cfg);
      }),
    );
    list.appendChild(
      this.settingRow('🖼️ 그래픽', s.quality === 'high' ? '고품질' : '성능', s.quality === 'high', () => {
        cfg.onQuality(s.quality === 'high' ? 'perf' : 'high');
        this.showPause(cfg);
      }),
    );
    this.panel.appendChild(list);

    // 조작 안내 (입력 환경별)
    const help = document.createElement('div');
    css(help, {
      font: '500 12px/1.7 system-ui, sans-serif',
      color: '#8a93a3',
      padding: '10px 13px',
      borderRadius: '10px',
      background: 'rgba(255,255,255,0.03)',
      border: '1px solid rgba(255,255,255,0.06)',
      marginBottom: '16px',
    });
    help.innerHTML = COARSE
      ? '🎯 <b>드래그</b> 조준 · <b>홀드</b> 파워 · <b>하단 바</b> 스핀'
      : '🎯 <b>마우스</b> 조준 · <b>꾹 눌렀다 떼기</b> 파워 · <b>Q / E</b> 스핀';
    this.panel.appendChild(help);

    // 계속하기 (주 버튼)
    const resume = document.createElement('button');
    resume.textContent = '▶ 계속하기';
    css(resume, {
      width: '100%',
      padding: '13px',
      minHeight: COARSE ? '48px' : '',
      borderRadius: '11px',
      border: 'none',
      background: 'linear-gradient(90deg,#22d3ee,#3b82f6)',
      color: '#06121a',
      font: '800 15px/1 system-ui, sans-serif',
      cursor: 'pointer',
      marginBottom: '8px',
    });
    resume.onclick = cfg.onResume;
    this.panel.appendChild(resume);

    // 포기 (파괴적, 하단)
    const quit = document.createElement('button');
    quit.textContent = '포기하고 나가기';
    css(quit, {
      width: '100%',
      padding: '11px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '10px',
      border: '1px solid rgba(239,68,68,0.5)',
      background: 'transparent',
      color: '#f87171',
      font: '700 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    quit.onclick = cfg.onForfeit;
    this.panel.appendChild(quit);

    const note = document.createElement('div');
    note.textContent = '포기 시 현재 게임 기록은 저장되지 않아요.';
    css(note, { font: '500 11px/1.4 system-ui, sans-serif', color: '#6b7686', textAlign: 'center', marginTop: '9px' });
    this.panel.appendChild(note);

    this.backdrop.style.display = 'flex';
  }

  // 일시정지 설정 행 — 라벨 + 현재값 알약 토글 버튼. active면 초록 강조.
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
    css(l, { font: '600 14px/1 system-ui, sans-serif', color: '#e8edf5' });
    const btn = document.createElement('button');
    btn.textContent = valueText;
    css(btn, {
      minWidth: '64px',
      minHeight: COARSE ? '36px' : '',
      padding: '7px 13px',
      borderRadius: '999px',
      border: `1px solid ${active ? '#5dca8f' : 'rgba(255,255,255,0.2)'}`,
      background: active ? 'rgba(93,202,143,0.16)' : 'rgba(255,255,255,0.04)',
      color: active ? '#5dca8f' : '#9aa3b2',
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
    const t = document.createElement('div');
    t.textContent = text;
    css(t, {
      font: '800 24px/1.2 system-ui, sans-serif',
      marginBottom: '18px',
      textAlign: 'center',
    });
    return t;
  }

  private sectionLabel(text: string): HTMLDivElement {
    const l = document.createElement('div');
    l.textContent = text;
    css(l, { font: '700 12px/1 system-ui, sans-serif', color: '#aab3c2', marginBottom: '8px' });
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
      color: '#e8edf5',
      font: '600 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    return b;
  }

  /** 로컬 교대전 플레이어 이름 입력 2칸 (rivalKey==='human'일 때만 노출 — syncNameWrap가 토글). */
  private buildNameInputs(): HTMLDivElement {
    const wrap = document.createElement('div');
    css(wrap, { display: 'none', flexDirection: 'column', gap: '8px', marginBottom: '14px' });
    const field = (tag: string, value: string, onChange: (v: string) => void): HTMLDivElement => {
      const rowEl = document.createElement('div');
      css(rowEl, { display: 'flex', alignItems: 'center', gap: '10px' });
      const lab = document.createElement('span');
      lab.textContent = tag;
      css(lab, { font: '800 12px/1 system-ui, sans-serif', color: '#ffd54a', minWidth: '26px' });
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      input.maxLength = 8;
      css(input, {
        flex: '1',
        minWidth: '0',
        padding: COARSE ? '11px 12px' : '9px 11px',
        minHeight: COARSE ? '44px' : '',
        borderRadius: '9px',
        border: '1px solid rgba(255,255,255,0.18)',
        background: 'rgba(255,255,255,0.05)',
        color: '#e8edf5',
        font: '600 13px/1 system-ui, sans-serif',
        boxSizing: 'border-box',
      });
      input.addEventListener('input', () => onChange(input.value));
      rowEl.appendChild(lab);
      rowEl.appendChild(input);
      return rowEl;
    };
    wrap.appendChild(field('1P', this.p1Name, (v) => (this.p1Name = v)));
    wrap.appendChild(field('2P', this.p2Name, (v) => (this.p2Name = v)));
    return wrap;
  }

  private refreshChips<T>(map: Map<T, HTMLButtonElement>, active: T) {
    for (const [k, b] of map) {
      b.style.borderColor = k === active ? '#ffd54a' : 'rgba(255,255,255,0.18)';
      b.style.background = k === active ? 'rgba(255,213,74,0.14)' : 'rgba(255,255,255,0.05)';
      b.style.color = k === active ? '#ffd54a' : '#e8edf5';
    }
  }

  private refreshRivalChips(map: Map<string | null, HTMLButtonElement>) {
    const spareMode = this.mode === 'spare';
    for (const [k, b] of map) {
      const active = k === this.rivalKey;
      b.style.borderColor = active ? '#ffd54a' : 'rgba(255,255,255,0.18)';
      b.style.background = active ? 'rgba(255,213,74,0.14)' : 'rgba(255,255,255,0.05)';
      b.style.color = active ? '#ffd54a' : '#e8edf5';
      if (k !== null) {
        b.style.opacity = spareMode ? '0.35' : '1';
        b.style.cursor = spareMode ? 'not-allowed' : 'pointer';
      }
    }
  }

  // --- 컬렉션 시트 (REWARDS.md §10.2 — 같은 패널 세 번째 뷰. 스킨 미리보기 + 업적 진행 겸용) ---
  // 인게임 상단 '업적 아일랜드' 탭으로 열 때: 닫으면 메뉴가 아니라 게임으로 복귀.
  showCollection(onBack: () => void) {
    this.showSkins(onBack, '← 게임으로');
  }

  private showSkins(onBack: () => void = () => this.showMenu(), backLabel = '← 메뉴로') {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('🎨 컬렉션'));

    const earned = loadRewards().earned;
    const unlocked = unlockedSkinIds(earned);
    const skinList = Object.values(SKINS);

    // 스킨 섹션 — 마감을 보여주는 미리보기 볼 + 잠금 조건(다음 목표 후크)
    this.panel.appendChild(this.collectionHeader('볼 스킨', `${unlocked.size} / ${skinList.length} 해금`));
    const grid = document.createElement('div');
    css(grid, { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '20px' });
    for (const skin of skinList) {
      const isUnlocked = unlocked.has(skin.id);
      const isEquipped = this.selectedSkin === skin.id;

      const ball = document.createElement('span');
      if (isUnlocked) {
        const p = skinPreviewStyle(skin);
        css(ball, { width: '42px', height: '42px', borderRadius: '50%', flex: '0 0 auto', background: p.background, boxShadow: p.shadow });
      } else {
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
          opacity: '0.85',
        });
        ball.textContent = '🔒';
      }

      const labelEl = document.createElement('div');
      labelEl.textContent = skin.label;
      css(labelEl, { font: '700 13px/1.2 system-ui, sans-serif', color: isEquipped ? '#ffd54a' : isUnlocked ? '#e8edf5' : '#6b7686' });
      const subEl = document.createElement('div');
      subEl.textContent = isUnlocked ? FINISH_LABEL[skin.finish] : achievementForSkin(skin.id)?.desc ?? '잠김';
      css(subEl, { font: '500 10px/1.3 system-ui, sans-serif', color: isUnlocked ? (isEquipped ? '#caa86a' : '#8a93a3') : '#7d8696', marginTop: '2px' });
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
        border: isEquipped ? '1px solid #ffd54a' : isUnlocked ? '1px solid rgba(255,255,255,0.16)' : '1px solid rgba(255,255,255,0.1)',
        background: isEquipped ? 'rgba(255,213,74,0.14)' : isUnlocked ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.02)',
        cursor: isUnlocked ? 'pointer' : 'not-allowed',
      });
      cell.appendChild(ball);
      cell.appendChild(textWrap);

      if (isEquipped) {
        const pill = document.createElement('span');
        pill.textContent = '장착';
        css(pill, { position: 'absolute', top: '7px', right: '8px', font: '800 9px/1 system-ui, sans-serif', color: '#1a1205', background: '#ffd54a', borderRadius: '5px', padding: '2px 5px' });
        cell.appendChild(pill);
      }

      if (isUnlocked) {
        cell.onclick = () => {
          this.equipSkin(skin.id);
          this.showSkins(onBack, backLabel);
        };
      }
      grid.appendChild(cell);
    }
    this.panel.appendChild(grid);

    // 업적 섹션 — 6개 뱃지를 한자리에(딴 것 ✓ / 잠긴 것 조건+해금 스킨). 솔로 게임의 동기 엔진(§1).
    const earnedCount = ACHIEVEMENTS.filter((a) => earned.includes(a.id)).length;
    this.panel.appendChild(this.collectionHeader('업적', `${earnedCount} / ${ACHIEVEMENTS.length} 달성`));
    const achWrap = document.createElement('div');
    css(achWrap, { display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '20px' });
    for (const a of ACHIEVEMENTS) {
      const got = earned.includes(a.id);
      const row = document.createElement('div');
      css(row, {
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        padding: '9px 11px',
        borderRadius: '9px',
        background: got ? 'rgba(255,213,74,0.08)' : 'rgba(255,255,255,0.02)',
        border: got ? '1px solid rgba(255,213,74,0.22)' : '1px solid rgba(255,255,255,0.08)',
        opacity: got ? '1' : '0.75',
      });
      const icon = document.createElement('span');
      icon.textContent = a.icon;
      css(icon, { font: '18px/1 system-ui, sans-serif', flex: '0 0 auto', filter: got ? '' : 'grayscale(1)' });
      const badge = document.createElement('div');
      badge.textContent = a.badge;
      css(badge, { font: '700 12px/1.3 system-ui, sans-serif', color: got ? '#ffd54a' : '#9aa3b2' });
      const desc = document.createElement('div');
      desc.textContent = `${a.desc} · ${resolveSkin(a.reward).label} 해금`;
      css(desc, { font: '500 10px/1.3 system-ui, sans-serif', color: got ? '#8a93a3' : '#6b7686' });
      const body = document.createElement('div');
      css(body, { flex: '1' });
      body.appendChild(badge);
      body.appendChild(desc);
      const status = document.createElement('span');
      status.textContent = got ? '✓' : '🔒';
      css(status, { flex: '0 0 auto', font: got ? '800 13px/1 system-ui, sans-serif' : '600 11px/1 system-ui, sans-serif', color: got ? '#5dca8f' : '#6b7686' });
      row.appendChild(icon);
      row.appendChild(body);
      row.appendChild(status);
      achWrap.appendChild(row);
    }
    this.panel.appendChild(achWrap);

    const back = document.createElement('button');
    back.textContent = backLabel;
    css(back, {
      width: '100%',
      padding: '11px',
      minHeight: COARSE ? '44px' : '',
      borderRadius: '10px',
      border: '1px solid rgba(255,255,255,0.25)',
      background: 'transparent',
      color: '#e8edf5',
      font: '700 14px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    back.onclick = onBack;
    this.panel.appendChild(back);

    this.backdrop.style.display = 'flex';
  }

  // 컬렉션 섹션 헤더 — 라벨 + 진행도 카운트(예: "3 / 7 해금")
  private collectionHeader(label: string, count: string): HTMLDivElement {
    const h = document.createElement('div');
    css(h, { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' });
    const l = document.createElement('span');
    l.textContent = label;
    css(l, { font: '700 12px/1 system-ui, sans-serif', color: '#aab3c2' });
    const c = document.createElement('span');
    c.textContent = count;
    css(c, { font: "600 11px/1 ui-monospace, 'SF Mono', monospace", color: '#6b7686' });
    h.appendChild(l);
    h.appendChild(c);
    return h;
  }

  private equipSkin(id: string) {
    this.selectedSkin = id;
    saveSelectedSkin(id);
    this.onSkinChange(id);
  }
}
