/**
 * 화면 전환 로딩 오버레이 (OPEN_WORLD_LOBBY 슬라이스 2).
 * index.html 부팅 터미널 로더와 같은 톤(다크 #05060a · 모노스페이스 · `> … OK` 네온 로그 · 마젠타 커서)을
 * 로비↔레인 전환에 재사용. **불투명해진 순간 swap()을 실행**해 씬 교체를 가린 뒤 짧게 머물고 페이드아웃.
 * 타이밍은 setTimeout 기반이라 RAF 루프(가시성 throttle) 상태와 무관하게 동작한다.
 */

const FONT = '14px/1.75 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 로그 세그먼트 색 — index.html 로더 팔레트와 동일. */
function segStyle(cls?: string): string {
  switch (cls) {
    case 'ok':
      return 'color:#4ade80'; // OK = 초록
    case 'ac':
      return 'color:#22d3ee;text-shadow:0 0 9px rgba(34,211,238,0.55)'; // 강조 = 시안
    case 'dim':
      return 'opacity:0.45'; // 프롬프트 '> '
    default:
      return 'color:#cfd6e4';
  }
}

export type LogSeg = [string, string?]; // [텍스트, 클래스?('ok'|'ac'|'dim')]

export class Transition {
  private readonly el: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private busy = false;

  constructor() {
    this.el = document.createElement('div');
    this.el.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:900', // 메뉴(40)·도크·로비 UI(25) 위, 부팅 로더(1000) 아래
      'display:none',
      'align-items:center',
      'justify-content:center',
      'padding:24px',
      'background:#05060a',
      'color:#cfd6e4',
      `font:${FONT}`,
      'opacity:0',
      'transition:opacity 0.3s ease',
    ].join(';');
    const term = document.createElement('div');
    term.style.cssText = 'width:min(540px,90vw)';
    this.log = document.createElement('div');
    term.appendChild(this.log);
    this.el.appendChild(term);
    document.body.appendChild(this.el);
  }

  get active(): boolean {
    return this.busy;
  }

  /**
   * 전환 재생: 페이드인 → (불투명 시) swap() → 로그 표시 → 페이드아웃.
   * swap()은 정확히 화면이 가려진 동안 실행되어 씬 교체가 보이지 않는다. 재진입 시에도 swap은 보장.
   */
  async play(lines: LogSeg[][], swap: () => void): Promise<void> {
    if (this.busy) {
      swap();
      return;
    }
    this.busy = true;
    this.log.innerHTML = '';
    this.el.style.display = 'flex';
    await wait(20); // display 반영 후 opacity 트랜지션 트리거
    this.el.style.opacity = '1';
    await wait(300); // 페이드인 완료 → 완전 불투명
    try {
      swap(); // 씬·상태 교체 (가려진 채)
    } catch {
      /* 전환은 계속 진행 — 실패해도 오버레이는 닫는다 */
    }
    for (const segs of lines) this.appendLine(segs);
    await wait(440); // 로그를 잠깐 보여줌
    this.el.style.opacity = '0';
    await wait(320);
    this.el.style.display = 'none';
    this.busy = false;
  }

  private appendLine(segs: LogSeg[]) {
    const d = document.createElement('div');
    for (const [text, cls] of segs) {
      const sp = document.createElement('span');
      sp.textContent = text;
      sp.style.cssText = segStyle(cls);
      d.appendChild(sp);
    }
    const cur = document.createElement('span'); // 마젠타 블록 커서
    cur.textContent = '▋';
    cur.style.cssText = 'color:#ff2d78;text-shadow:0 0 8px #ff2d78;margin-left:2px';
    d.appendChild(cur);
    this.log.appendChild(d);
  }
}
