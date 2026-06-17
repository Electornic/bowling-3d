import type { GameMode, MatchConfig, GameSummary, AimAid } from '../game/GameState';
import type { OilPattern } from '../game/oil';
import { AI_PROFILES } from '../game/ai';
import { statsSummary } from '../game/Stats';
import { isCoarsePointer } from '../core/device';

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

const COARSE = isCoarsePointer(); // 터치 환경: 버튼/칩 히트영역 ≥44px (MOBILE_SUPPORT.md §3.1)

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
  { key: 'beginner', label: '초급', desc: '하우스 + 풀 예측선 — 가장 쉬움', oil: 'house', aim: 'easy' },
  { key: 'intermediate', label: '중급', desc: '하우스 + 훅 숨김 — 라인 직접 읽기', oil: 'house', aim: 'normal' },
  { key: 'advanced', label: '고급', desc: '숏 패턴 + 방향 표식만 — 라인은 실력', oil: 'short', aim: 'pro' },
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
  private rivalKey: string | null = null;
  private weight = 10; // 볼 무게(lb) — 시작 메뉴에서 선택 (인게임 BallPicker 대체)
  private difficulty: Difficulty = 'beginner'; // 난이도 프리셋 (P3 §2.7) — 오일+예측선 큐레이션
  private oilPattern: OilPattern = 'house'; // 오일 패턴 (P3) — 초급 프리셋과 일치
  private aimAid: AimAid = 'easy'; // 예측선 난이도 (P3, UI 전용) — 기본 easy(§2.7)

  constructor(
    private readonly onStart: (cfg: MatchConfig) => void,
    private readonly onMenu: () => void,
    private readonly onWeight: (lb: number) => void,
  ) {
    this.backdrop = document.createElement('div');
    css(this.backdrop, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(6,8,14,0.72)',
      backdropFilter: 'blur(4px)',
      zIndex: '40',
    });
    this.panel = document.createElement('div');
    css(this.panel, {
      background: 'rgba(14,17,27,0.96)',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: '16px',
      padding: '28px 32px',
      color: '#e8edf5',
      font: '500 14px/1.5 system-ui, sans-serif',
      minWidth: COARSE ? 'auto' : '340px', // 좁은 폰에서 340px 강제 → 가로 오버플로 방지
      maxWidth: '92vw',
      // 짧은 가로(landscape) 화면에서 내용이 넘치면 잘림 → 패널 내부 세로 스크롤 허용.
      // dvh: iOS 동적 주소창이 vh에 포함돼 밀리는 문제 회피. pan-y: 세로 스크롤만(핀치/더블탭 줌 차단). (§3·§4)
      maxHeight: '90dvh',
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

  // --- 시작 메뉴 ---
  showMenu() {
    this.panel.replaceChildren();
    this.panel.appendChild(this.title('🎳 BOWLING 3D'));

    // 모드 선택
    this.panel.appendChild(this.sectionLabel('모드'));
    const modeRow = document.createElement('div');
    css(modeRow, { display: 'flex', gap: '8px', marginBottom: '14px' });
    const modeBtns = new Map<GameMode, HTMLButtonElement>();
    for (const m of MODES) {
      const b = this.chipButton(`${m.label}`, m.desc);
      b.onclick = () => {
        this.mode = m.key;
        if (m.key === 'spare') this.rivalKey = null; // 스페어 챌린지는 솔로만
        this.refreshChips(modeBtns, this.mode);
        this.refreshRivalChips(rivalBtns);
      };
      modeBtns.set(m.key, b);
      modeRow.appendChild(b);
    }
    this.panel.appendChild(modeRow);

    // 상대 선택
    this.panel.appendChild(this.sectionLabel('상대 (AI 라이벌)'));
    const rivalRow = document.createElement('div');
    css(rivalRow, { display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' });
    const rivalBtns = new Map<string | null, HTMLButtonElement>();
    const solo = this.chipButton('혼자', '연습 모드');
    solo.onclick = () => {
      this.rivalKey = null;
      this.refreshRivalChips(rivalBtns);
    };
    rivalBtns.set(null, solo);
    rivalRow.appendChild(solo);
    for (const p of AI_PROFILES) {
      const b = this.chipButton(`${p.name} · ${p.difficulty}`, p.tagline);
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

    // 난이도 프리셋 (P3 §2.7 — 오일+예측선을 한 손잡이로 큐레이션. '커스텀'에서만 두 축 따로)
    this.panel.appendChild(this.sectionLabel('난이도'));
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
    wInput.step = '0.5';
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
    const players: MatchConfig['players'] = [{ name: '나' }];
    if (this.mode !== 'spare' && this.rivalKey) {
      const profile = AI_PROFILES.find((p) => p.key === this.rivalKey);
      if (profile) players.push({ name: profile.name, ai: profile });
    }
    this.hide();
    this.onStart({ mode: this.mode, players, oilPattern: this.oilPattern, aimAid: this.aimAid });
  }

  // --- 결과 화면 ---
  showResult(summary: GameSummary) {
    this.panel.replaceChildren();
    const solo = summary.players.length === 1;
    const me = summary.players[0];

    let headline: string;
    if (summary.mode === 'spare') headline = `스페어 ${me.score}/10 성공!`;
    else if (solo) headline = `최종 ${me.score}점`;
    else if (summary.winner === -1) headline = '무승부!';
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
}
