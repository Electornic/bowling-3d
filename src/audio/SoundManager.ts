/**
 * 합성 충돌음 (Web Audio, 에셋 0). 도안 §10.
 * contact force 임펄스 크기 → 볼륨·피치. user gesture(클릭/키)로 AudioContext 활성.
 * 다중 충돌 폭주 방지(최소 간격).
 */
/** 1~2핀(스페어 정리)은 가벼운 '톡', 그 이상은 풀 크래시로 분기 (playRackCrash). */
const LIGHT_HIT_MAX = 2;

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

  /** 충돌음: magnitude(contact force) → 볼륨·피치로 매핑. 레인 굴림 등 일반 접촉용. */
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

  /**
   * 투구당 1회 핀 임팩트음 (GameState.notifyImpact가 명령). 개별 contact마다 소리내던
   * 방식은 슬로모 중 contact가 띄엄띄엄 들어와 '여러 번/탭탭탭'으로 들려서, 임팩트는
   * '한 사건 = 한 소리'로 통일. 세기는 '서 있던 핀 수'로 — 풀랙=쾅, 1~2핀=가벼운 톡.
   */
  playRackCrash(standingCount: number) {
    if (!this.ctx || !this.enabled) return;
    if (standingCount <= LIGHT_HIT_MAX) this.click(70);
    else this.crash(0, standingCount);
  }

  /** 1~2핀 딸각 — 짧고 또렷한 고음 틱 */
  private click(magnitude: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const vol = Math.min(1, magnitude / 60) * 0.4;
    if (vol < 0.01) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = 220 + Math.min(magnitude, 160) * 4;
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * 풀랙 크래시 — 투구당 1회(playRackCrash가 호출). 어택은 고-Q 공명 '톡'(나무 크랙),
   * 뒤로 노이즈 클러터 '구름'(미세 클릭 다발)이 깔리고, 무게감은 저역 쿵 1발.
   * 어택이 노이즈 스웰이면 '쉭'으로 들려서 — 크랙을 앞세우고 노이즈 어택은 살짝 늦춘다.
   */
  private crash(magnitude: number, count: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const intensity = Math.min(1, count / 10);

    // 0) 어택 크랙 — 짧은 고-Q 공명 '톡'. 노이즈 스웰 대신 또렷한 나무 타격으로 시작.
    const crackBuf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.05), ctx.sampleRate);
    const cd = crackBuf.getChannelData(0);
    for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * (1 - i / cd.length);
    const crack = ctx.createBufferSource();
    crack.buffer = crackBuf;
    const cbp = ctx.createBiquadFilter();
    cbp.type = 'bandpass';
    cbp.frequency.value = 520 + intensity * 180;
    cbp.Q.value = 9; // 고Q → 노이즈가 피치 있는 '톡'으로
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.34 + intensity * 0.2, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
    crack.connect(cbp).connect(cg).connect(ctx.destination);
    crack.start(now);
    crack.stop(now + 0.06);

    // 1) 나무 클러터 '구름' — 베이스 노이즈 워시 + 앞쪽 밀집 미세 클릭. 크랙 뒤로 깔리는 잔해.
    //    필터 Q를 올려(쉭 노이즈 → 톤 있는 우드) + 어택을 살짝 늦춰 크랙이 앞서게.
    const dur = 0.5 + intensity * 0.25;
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      const decay = (1 - t) * (1 - t);
      let s = (Math.random() * 2 - 1) * 0.5 * decay;
      if (Math.random() < 0.05 * (1 - t)) s += (Math.random() * 2 - 1) * 0.8; // 미세 클릭 폭주
      data[i] = Math.max(-1, Math.min(1, s));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 800 + intensity * 300;
    bp1.Q.value = 5;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 1900 + intensity * 500;
    bp2.Q.value = 6;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, now);
    ng.gain.exponentialRampToValueAtTime(0.22 + intensity * 0.14, now + 0.03); // 살짝 늦은 어택(크랙이 앞)
    ng.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bp1).connect(ng);
    noise.connect(bp2).connect(ng);
    ng.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);

    // 2) 저역 쿵 (thud) — 한 발만 (무게감)
    const osc = ctx.createOscillator();
    const og = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.12);
    og.gain.setValueAtTime(0.0001, now);
    og.gain.exponentialRampToValueAtTime(0.26 + intensity * 0.18, now + 0.008);
    og.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(og).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
  }
}
