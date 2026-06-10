import type { Engine } from './Engine';

const FIXED_DT = 1 / 60; // 고정 물리 스텝 (도안 §4.4 TIMESTEP)
const MAX_FRAME = 0.25; // 탭 전환 등으로 프레임이 크게 벌어질 때 클램프

/**
 * 고정 timestep accumulator 루프 (도안 §B.6).
 * - onStep: 물리 스텝마다 (게임 상태머신)
 * - onFrame: 렌더 프레임마다 (UI·카메라 보간), 인자는 프레임 dt
 */
export class Loop {
  private readonly engine: Engine;
  private readonly onStep?: (dt: number) => void;
  private readonly onFrame?: (dt: number) => void;
  private acc = 0;
  private last = 0;
  private running = false;

  constructor(
    engine: Engine,
    onStep?: (dt: number) => void,
    onFrame?: (dt: number) => void,
  ) {
    this.engine = engine;
    this.onStep = onStep;
    this.onFrame = onFrame;
  }

  start() {
    this.running = true;
    this.last = performance.now() / 1000;
    requestAnimationFrame(this.tick);
  }

  stop() {
    this.running = false;
  }

  private tick = () => {
    if (!this.running) return;

    const now = performance.now() / 1000;
    let frame = now - this.last;
    this.last = now;
    if (frame > MAX_FRAME) frame = MAX_FRAME;

    this.acc += frame;
    while (this.acc >= FIXED_DT) {
      this.engine.step(FIXED_DT);
      this.onStep?.(FIXED_DT); // 게임 상태머신 (물리 스텝과 동기)
      this.acc -= FIXED_DT;
    }

    this.engine.sync(this.acc / FIXED_DT); // 잔여시간으로 보간 (도안 §B.6, 떨림 방지)
    this.onFrame?.(frame); // UI·카메라 (매 렌더 프레임 1회)
    this.engine.render();
    requestAnimationFrame(this.tick);
  };
}
