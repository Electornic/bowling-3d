/**
 * 합성 충돌음 (Web Audio, 에셋 0). 도안 §10.
 * contact force 임펄스 크기 → 볼륨·피치. user gesture(클릭/키)로 AudioContext 활성.
 * 다중 충돌 폭주 방지(최소 간격).
 */
export class SoundManager {
  private ctx: AudioContext | null = null;
  enabled = true;
  private lastPlay = 0;

  constructor() {
    const resume = () => {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  /** 충돌음: magnitude(contact force) → 볼륨·피치로 매핑 */
  playHit(magnitude: number) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime;
    if (now - this.lastPlay < 0.025) return; // 동시 다중충돌 폭주 방지 (도안 §12)
    this.lastPlay = now;

    const vol = Math.min(1, magnitude / 60) * 0.35;
    if (vol < 0.01) return;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 110 + Math.min(magnitude, 120) * 3; // 셀수록 높은 음
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.14);
  }
}
