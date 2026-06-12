import type { GameMode, MatchConfig, GameSummary } from '../game/GameState';
import { AI_PROFILES } from '../game/ai';
import { statsSummary } from '../game/Stats';

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>) => Object.assign(el.style, style);

const MODES: { key: GameMode; label: string; desc: string }[] = [
  { key: 'full', label: '풀게임', desc: '10프레임 정식 룰' },
  { key: 'blitz', label: '블리츠', desc: '3프레임 스피드전' },
  { key: 'spare', label: '스페어 챌린지', desc: '클래식 리브 10연속 픽업 (솔로)' },
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

  constructor(
    private readonly onStart: (cfg: MatchConfig) => void,
    private readonly onMenu: () => void,
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
      minWidth: '340px',
      maxWidth: '92vw',
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
      const b = this.chipButton(p.name, p.tagline);
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
    help.textContent = '마우스 이동 = 조준 · 꾹 눌렀다 떼기 = 파워 발사 · Q/E = 좌/우 스핀';
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
    this.onStart({ mode: this.mode, players });
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
      padding: '9px 12px',
      borderRadius: '9px',
      border: '1px solid rgba(255,255,255,0.18)',
      background: 'rgba(255,255,255,0.05)',
      color: '#e8edf5',
      font: '600 13px/1 system-ui, sans-serif',
      cursor: 'pointer',
    });
    return b;
  }

  private refreshChips(map: Map<GameMode, HTMLButtonElement>, active: GameMode) {
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
