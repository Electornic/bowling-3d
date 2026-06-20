/**
 * 합성 충돌음 (Web Audio, 에셋 0). 도안 §10.
 * contact force 임펄스 크기 → 볼륨·피치. user gesture(클릭/키)로 AudioContext 활성.
 * 다중 충돌 폭주 방지(최소 간격).
 */
/** 1~2핀(스페어 정리)은 가벼운 '톡', 그 이상은 풀 크래시로 분기 (playRackCrash). */
const LIGHT_HIT_MAX = 2;
// strike.wav 앞 리드인(공백~0.1s, 크랙 피크 @0.113s) 건너뛰고 크랙부터 재생 → 영상 충돌과 동기.
// strike.wav는 0.105s에 날카로운 크랙(피크 0.113s) — 그 직전(0.10)부터 재생해 어택 보존 + 충돌 동기.
// (strike2.wav였으면 0.60. 더 빠르게=값↑, 늦게=값↓.)
const STRIKE_LEADIN = 0.10;

export class SoundManager {
  private ctx: AudioContext | null = null;
  private _enabled = true;
  /**
   * 사운드 on/off. 끄는 순간 '지속음'(굴림 럼블)과 메뉴 음악을 즉시 멎게 한다.
   * 굴리는 도중 끄면 setRoll이 early-return해 rollGain이 마지막 값에 얼어붙어 럼블이 계속 울리던
   * 버그 방지. (일회성 충돌음은 짧아 자연 종료라 별도 처리 불필요.)
   */
  get enabled(): boolean {
    return this._enabled;
  }
  set enabled(v: boolean) {
    this._enabled = v;
    if (!v) {
      if (this.ctx && this.rollGain) {
        const now = this.ctx.currentTime;
        this.rollGain.gain.cancelScheduledValues(now);
        this.rollGain.gain.setTargetAtTime(0, now, 0.02); // 럼블 즉시 페이드아웃(클릭 방지)
      }
      this.stopMusic(); // 메뉴 음악도 정지
    }
  }
  private lastPlay = 0;

  constructor() {
    const resume = () => {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      void this.loadSamples();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  /**
   * 리버브 버스 (드라이 + 합성 IR 컨볼루션 웨트). 실제 볼링장은 천장 높고 단단한 면뿐인
   * 거대 공간이라 잔향이 길다(실측 RT≈2.5s) — 드라이 합성음이 "합성 같다"의 1순위 원인이라
   * 한 '공간'에 앉혀 현실감을 얹는다. IR은 코드 합성(노이즈×지수감쇠)이라 에셋 0 유지.
   * 충돌·굴림음이 같은 버스를 거쳐 같은 방에 있게. ctx는 첫 user gesture에 생기므로 지연 생성.
   */
  // 실제 녹음 샘플 (strike=충돌, roll=굴림). ctx 생성 후 지연 디코드, 그 전엔 합성 폴백.
  private strikeBuf: AudioBuffer | null = null;
  private rollBuf: AudioBuffer | null = null;
  private samplesLoading = false;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollMax = 0.1; // 굴림 최대 게인 (합성=0.1, 샘플=0.7 — 생성 시 결정)

  /** strike/roll wav 지연 디코드 — 첫 user gesture(ctx 생성) 후 1회. Vite가 에셋으로 emit. */
  private async loadSamples() {
    if (!this.ctx || this.samplesLoading || this.strikeBuf) return;
    this.samplesLoading = true;
    const ctx = this.ctx;
    const load = async (url: string) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    try {
      const [s, r] = await Promise.all([
        load(new URL('./strike.wav', import.meta.url).href),
        load(new URL('./roll.wav', import.meta.url).href),
      ]);
      this.strikeBuf = s;
      this.rollBuf = this.makeSeamlessLoop(r); // 지속 구간만 추출+크로스페이드 → 끊김·뽁 없는 무한 루프
    } catch {
      /* 디코드 실패 — 합성 폴백 유지 */
    }
    this.samplesLoading = false;
  }

  private busIn: GainNode | null = null;
  private out(): AudioNode {
    const ctx = this.ctx!;
    if (this.busIn) return this.busIn;
    const busIn = ctx.createGain();
    busIn.connect(ctx.destination); // 드라이 경로
    // 웨트 경로: 저역은 빼고(잔향 머드 방지 — sub/thud는 드라이로만) 컨볼루션 잔향만 얹는다.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 250;
    const conv = ctx.createConvolver();
    conv.buffer = this.makeIR(1.1, 2.4); // 꼬리 ~1.1s — '큰 방'이되 동굴처럼 번지지 않게
    const wet = ctx.createGain();
    wet.gain.value = 0.3; // 잔향 양 — 공간감, 과하면 스피치 불명료(실제 볼링장 문제)
    busIn.connect(hp).connect(conv).connect(wet).connect(ctx.destination);
    this.busIn = busIn;
    return busIn;
  }

  // --- 공 굴림 럼블 (지속음) ---
  // 레인 위 공의 저역 우르릉. 루프 노이즈 1개를 계속 돌리고 게인만 움직여(start/stop 클릭 방지)
  // 속도에 음량·밝기를 종속 → 굴러갈 때 살아나고 멈추면 사라진다. 임팩트 직전 긴장감.
  // 저역이라 리버브 기여가 미미해 드라이 직결(컨볼버 상시 가동 CPU 절약).
  private rollGain: GainNode | null = null;
  private rollLp: BiquadFilterNode | null = null;
  private rollGutterFilter: BiquadFilterNode | null = null; // 거터 홀로우용 피킹 필터 (레인=평탄/바이패스)
  /** 굴림 세기 갱신 (GameState가 매 스텝 공 속도로 호출). speed=공 속도(m/s), 0이면 무음. */
  setRoll(speed: number, inGutter = false) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    if (!this.rollGain) {
      const g = ctx.createGain();
      g.gain.value = 0;
      const src = ctx.createBufferSource();
      src.loop = true;
      // 거터 홀로우용 피킹 필터 — 레인 위엔 0dB(평탄=바이패스), 거터 진입 시 380Hz를 공명시켜 '채널 안 텅텅'.
      // (하이패스로 저역을 깎으면 굴림음 자체가 저역 럼블이라 통째로 사라짐 → 피킹 부스트로 음색만 바꾼다.)
      const gf = ctx.createBiquadFilter();
      gf.type = 'peaking';
      gf.frequency.value = 380;
      gf.Q.value = 2.2;
      gf.gain.value = 0;
      if (this.rollBuf) {
        src.buffer = this.rollBuf; // makeSeamlessLoop로 가공된 무한 루프 버퍼 (이음새 매끈)
        src.connect(gf).connect(g).connect(ctx.destination); // 자체 스펙트럼이라 LP 없이 드라이(+거터 피킹)
        this.rollMax = 0.7;
      } else {
        const len = Math.ceil(ctx.sampleRate * 1.0); // 폴백: 합성 저역 노이즈
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 280;
        src.connect(lp).connect(gf).connect(g).connect(ctx.destination);
        this.rollLp = lp;
        this.rollMax = 0.1;
      }
      src.start(); // 굴림 루프 시작 (통째 루프 — 이음새 클릭 없음)
      this.rollSrc = src;
      this.rollGain = g;
      this.rollGutterFilter = gf;
    }
    const now = ctx.currentTime;
    const MAX = 12; // ≈ MAX_SPEED. 속도 1~12 → 게인·피치·밝기 종속.
    const t = Math.max(0, Math.min(1, (speed - 1) / (MAX - 1)));
    const gutterMul = inGutter ? 0.85 : 1; // 거터는 살짝만 작게 (사라지지 않게)
    this.rollGain.gain.setTargetAtTime(t * t * this.rollMax * gutterMul, now, 0.02); // 빠른 추종 (지연감 줄임, 클릭은 방지)
    this.rollSrc!.playbackRate.setTargetAtTime((inGutter ? 0.95 : 0.85) + t * 0.4, now, 0.05); // 거터는 살짝 높게(텅한 질감)
    if (this.rollGutterFilter) {
      this.rollGutterFilter.gain.setTargetAtTime(inGutter ? 12 : 0, now, 0.04); // 거터: 380Hz 공명 부각(홀로우), 레인=평탄
    }
    if (this.rollLp) this.rollLp.frequency.setTargetAtTime(220 + t * 200, now, 0.05);
  }

  /**
   * 굴림 녹음(페이드인+지속+페이드아웃 = 1회성)을 끊김 없는 루프로 가공: 지속 구간만 잘라
   * 끝↔처음을 크로스페이드 → 루프 경계의 진폭 불연속('뽁') + 통째 루프 시 끝단 페이드 무음
   * 구간을 지나며 생기던 '중간 끊김'을 둘 다 제거. (원본 길이/엔벨로프 분석 기반 구간.)
   */
  private makeSeamlessLoop(buf: AudioBuffer): AudioBuffer {
    const ctx = this.ctx!;
    const sr = buf.sampleRate;
    const s0 = Math.min(buf.length - 1, Math.floor(0.45 * sr)); // 페이드인 이후
    const s1 = Math.min(buf.length, Math.floor(1.6 * sr)); // 페이드아웃 이전
    const cf = Math.floor(0.08 * sr); // 80ms 크로스페이드
    const loopLen = Math.max(1, s1 - s0 - cf);
    const out = ctx.createBuffer(buf.numberOfChannels, loopLen, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < loopLen; i++) dst[i] = src[s0 + i];
      // 경계 매끈: 처음(head, w↑)에 '그 다음에 올 꼬리'(1−w)를 섞어 out[끝]→out[0]이 원본상 연속이 되게.
      for (let j = 0; j < cf && j < loopLen; j++) {
        const w = j / cf;
        dst[j] = dst[j] * w + src[s0 + loopLen + j] * (1 - w);
      }
    }
    return out;
  }

  /** 합성 임펄스 응답: 스테레오 노이즈 × 지수감쇠. seconds=꼬리 길이, decay=감쇠 가파름. */
  private makeIR(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  /** 백그라운드 진입 시 오디오 스레드 정지 (배터리/발열). visibilitychange에서 호출 (MOBILE_SUPPORT.md §6). */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  /** 포그라운드 복귀 시 재개. */
  resume() {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
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
    osc.connect(gain).connect(this.out()); // 굴림음도 룸 리버브 경유 (같은 공간)
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
    if (this.strikeBuf) this.playStrike(standingCount); // 실제 샘플(핀수로 볼륨·길이 스케일) — 1~2핀도 합성 '뽁' 대신 가벼운 실제 타격음
    else if (standingCount <= LIGHT_HIT_MAX) this.click(70); // 디코드 전 폴백
    else this.crash(0, standingCount);
  }

  /** 실제 스트라이크 녹음 재생 — 자연 잔향 포함이라 합성 리버브 우회(드라이, 이중 잔향 방지). */
  private playStrike(count: number) {
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.strikeBuf!;
    const g = ctx.createGain();
    const intensity = Math.min(1, count / 10);
    const vol = 0.4 + intensity * 0.6; // 1핀≈0.4, 풀랙=1.0
    // 적은 핀은 짧게(크랙+짧은 잔해), 많을수록 풀 클래터 — 1핀에 풀랙 소리 나는 부자연 방지.
    const dur = 0.25 + intensity * 1.8; // 1핀≈0.25s, 풀랙≈2s
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + 0.012); // 12ms 페이드인 — 시작 클릭 제거
    g.gain.setValueAtTime(vol, now + Math.max(0.05, dur - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, now + dur); // 끝 60ms 페이드아웃 — 자르기 클릭 제거
    src.connect(g).connect(ctx.destination); // 드라이
    src.start(0, STRIKE_LEADIN, dur); // 임팩트 구간부터, 길이는 핀수 비례
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
    osc.connect(gain).connect(this.out());
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
    crack.connect(cbp).connect(cg).connect(this.out());
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
    ng.connect(this.out());
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
    osc.connect(og).connect(this.out());
    osc.start(now);
    osc.stop(now + 0.24);

    // 2b) 서브베이스 — 큰 스트라이크일수록 바닥을 치는 묵직한 흉부 thump. intensity 게이트(count≳3부터
    //     점증, 작은 히트엔 0)로 가벼운 정리 투구는 그대로 두고 풀랙만 무게를 얹는다. 저역 쿵(2)보다
    //     한 옥타브 아래(70→34Hz)·긴 감쇠 → 헤드폰/우퍼에서 '쿵' 잔향. 랩탑 스피커엔 거의 안 들림(의도).
    const subVol = Math.max(0, intensity - 0.3) * 0.5; // count 3 이하=0, 풀랙(10)≈0.35
    if (subVol > 0.01) {
      const sub = ctx.createOscillator();
      const sg = ctx.createGain();
      sub.type = 'sine';
      sub.frequency.setValueAtTime(70, now);
      sub.frequency.exponentialRampToValueAtTime(34, now + 0.18);
      sg.gain.setValueAtTime(0.0001, now);
      sg.gain.exponentialRampToValueAtTime(subVol, now + 0.012);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
      sub.connect(sg).connect(this.out());
      sub.start(now);
      sub.stop(now + 0.36);
    }

    // 3) 나무 핀 클래터 — 이산 우드 클랙 다발. 노이즈 워시만으론 '쉭'에 가까워, 핀끼리 부딪는
    //    피치 있는 '딱딱딱'을 여러 발 스태거해 실제 나무 클래터 질감을 더한다.
    //    한 번의 playRackCrash 안에서 스케줄되는 '한 이벤트'라 슬로모 '탭탭탭' 아티팩트 없음.
    const clacks = 3 + Math.round(intensity * 5); // 핀 많을수록 촘촘 (~3~8발)
    for (let i = 0; i < clacks; i++) {
      const t = now + 0.015 + Math.random() * (0.32 + intensity * 0.25); // ~0.5s 창에 분산
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = 380 + Math.random() * 520; // 나무 공명 대역
      const v = (0.05 + Math.random() * 0.07) * (0.6 + intensity * 0.6);
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05 + Math.random() * 0.04);
      o.connect(g).connect(this.out());
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  /** 업적/스킨 해금 '딩' — 합성 2음 차임(에셋 0). 결과 화면 토스트와 함께. */
  playUnlock() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const t = now + i * 0.11; // A5 → E6 상승
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.22, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.32);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 메뉴 배경음악 — 칩튠 아르페지오 루프 (Web Audio 합성, 에셋 0). 메뉴/결과 화면에서만 재생,
  // 매치 중엔 잔잔하게 죽인 배경으로 깔고(굴림·크래시와 안 싸울 레벨), 메뉴/결과에서 풀 레벨로 스월.
  // 완전 정지는 사운드 OFF에서만. 룩어헤드 스케줄러로 정확 타이밍.
  // 로더의 TAP(user gesture)으로 ctx가 풀린 뒤 호출되므로 모바일에서도 바로 울린다.
  // ───────────────────────────────────────────────────────────────────────────
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  private musicNextTime = 0;
  private musicOn = false;
  private readonly musicVol = 0.5; // 메뉴/결과 풀 레벨 (배경이라 작게)
  private readonly musicMatchVol = 0.14; // 매치 중 잔잔한 배경 레벨 — 굴림·크래시 SFX와 안 싸울 만큼 죽임
  // I–V–vi–IV (C장조) — 보편적으로 듣기 좋은 진행. 코드당 8스텝(16분음표)×4코드 = 32스텝 루프.
  // arp=아르페지오 노트(MIDI), bass=루트 저음(MIDI).
  private readonly MUSIC_PROG = [
    { arp: [60, 64, 67, 72], bass: 36 }, // C
    { arp: [62, 67, 71, 74], bass: 43 }, // G
    { arp: [64, 69, 72, 76], bass: 45 }, // Am
    { arp: [65, 69, 72, 77], bass: 41 }, // F
  ];

  /**
   * BGM 레벨 제어 (멱등, Loop onFrame이 매 프레임 게임 상태로 호출). 예전엔 매치 시작 시 완전 정지였으나,
   * 굴림·크래시와 안 싸울 만큼 죽인 '잔잔한 배경'으로 매치 중에도 깔아 둔다(사용자 요청). 완전 정지는
   * 사운드 OFF(enabled setter→stopMusic)에서만.
   * @param menu true=메뉴/결과(풀 볼륨), false=매치(잔잔하게 죽임)
   */
  setMenuMusic(menu: boolean) {
    if (!this.musicOn) {
      this.startMusic(); // 첫 시작: 자체 페이드인(→ musicVol). 블라스트 방지로 레벨 조정은 다음 프레임부터
      return;
    }
    this.setMusicLevel(menu ? this.musicVol : this.musicMatchVol);
  }

  /** 음악 게인을 목표 레벨로 부드럽게 (메뉴↔매치 크로스). musicGain만 만져 스케줄러/노트는 안 건드림. */
  private setMusicLevel(vol: number) {
    if (!this.ctx || !this.musicGain || !this.musicOn) return;
    const now = this.ctx.currentTime;
    const g = this.musicGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(Math.max(0.0001, vol), now, 0.4); // 0.4s 시정수 — 스월 인/아웃
  }

  private startMusic() {
    if (!this.enabled || this.musicOn) return;
    if (!this.ctx || this.ctx.state !== 'running') return; // 제스처 전이면 다음 프레임에 재시도
    this.musicOn = true;
    const ctx = this.ctx;
    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.connect(ctx.destination); // 드라이 — 볼링장 리버브 우회
    }
    const now = ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(0.0001, now);
    this.musicGain.gain.exponentialRampToValueAtTime(this.musicVol, now + 0.8); // 페이드인
    this.musicStep = 0;
    this.musicNextTime = now + 0.1;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 25);
  }

  private stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    if (this.musicTimer != null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(0.0001, now + 0.5); // 페이드아웃 (스케줄된 잔여 노트가 잦아듦)
    }
  }

  /** 룩어헤드 스케줄러 — 현재시각+lookahead까지의 스텝을 미리 예약 (정확 타이밍). */
  private scheduleMusic() {
    const ctx = this.ctx;
    if (!ctx || !this.musicOn) return;
    const stepDur = 60 / 112 / 4; // 16분음표 @112BPM ≈ 0.134s
    const lookahead = 0.12;
    while (this.musicNextTime < ctx.currentTime + lookahead) {
      this.playMusicStep(this.musicStep, this.musicNextTime, stepDur);
      this.musicNextTime += stepDur;
      this.musicStep = (this.musicStep + 1) % 32;
    }
  }

  private playMusicStep(i: number, time: number, stepDur: number) {
    const chord = this.MUSIC_PROG[Math.floor(i / 8) % this.MUSIC_PROG.length];
    const local = i % 8;
    this.musicTone(this.mtof(chord.arp[local % chord.arp.length]), time, stepDur * 0.9, 'square', 0.07); // 아르페지오
    if (local === 0 || local === 4) this.musicTone(this.mtof(chord.bass), time, stepDur * 3.6, 'triangle', 0.16); // 베이스(half마다)
    if (local === 0) this.musicTone(this.mtof(chord.arp[0] + 12), time, stepDur * 1.6, 'square', 0.03); // 코드 전환 반짝임
  }

  /** 음악용 단음 — musicGain 경유(페이드/볼륨 일괄). 클릭 방지 위해 짧은 어택/릴리즈. */
  private musicTone(freq: number, time: number, dur: number, type: OscillatorType, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(this.musicGain!);
    o.start(time);
    o.stop(time + dur + 0.02);
  }

  /** MIDI 노트 → 주파수(Hz). */
  private mtof(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }
}
