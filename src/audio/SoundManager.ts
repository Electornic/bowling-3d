import { MAX_SPEED, SLOWMO_SCALE } from '../game/constants';
import type { MachineCue, MachineLane, AmbBallCue } from './cues';
import { MachineSynth } from './machineSynth';
import { schedulePitDrop, scheduleBallReturn } from './pitSfx';
import { makeNoise } from './synthKit';
import type { GameSummary } from '../game/GameState';
/**
 * 사운드 (Web Audio). 도안 §10.
 *
 * ⚠️ **에셋 0이 아니다** — `strike.wav`·`roll.wav`(각 ~390KB)와 BGM mp3(1.5MB)를 첫 user
 * gesture 뒤에 디코드해 쓴다. 합성으로 남아 있는 건 굴림 폴백 노이즈와 해금 차임 둘뿐이다.
 * (README·CLAUDE.md의 에셋 목록은 이 셋을 다 세야 한다 — 번들 크기 볼 때 빼먹지 말 것.)
 *
 * 소리 7종: 릴리스(합성, playRelease) · 핀 크래시(투구 1회, strike.wav) · 굴림 럼블(지속, roll.wav 루프) · 핀세터 기계음(합성, machineCue) ·
 * 하우스 PA 차임(합성, playEvent — 스트라이크·스페어·거터·스플릿 컨버전·게임오버) · 해금 차임(합성) ·
 * 메뉴 BGM(mp3 루프, MUSIC_URL). AudioContext는 클릭/키 제스처로 활성된다.
 *
 * 신호 경로 (SOUND.md §1): 모든 소스 → masterGain → DynamicsCompressor(리미터) → destination.
 * 소스는 `destination`에 직결하지 않고 반드시 `this.bus()`에 꽂는다 — 안 그러면 마스터 볼륨·
 * 사운드 OFF 뮤트·클리핑 방지 셋 다 그 소스만 빠져나간다.
 */
// strike.wav 앞 리드인(공백~0.1s) 건너뛰고 크랙부터 재생 → 영상 충돌과 동기.
// 0.105s에 날카로운 크랙(피크 0.113s)이 있어 그 직전(0.10)부터 재생 — 어택 보존 + 충돌 동기.
// 더 빠르게 = 값↑, 늦게 = 값↓.
const STRIKE_LEADIN = 0.10;

/**
 * 메뉴/매치 배경음악 에셋 — Pixabay "Reggae Ruckus" (업로더: Mi_Music).
 * 48.0s · 44.1kHz 스테레오 · 256kbps · 1.5MB.
 *
 * 출처: https://pixabay.com/ko/music/%EB%A0%88%EA%B2%8C-reggae-ruckus-157890/
 * 다운로드: 2026-09-02 · Pixabay Content License (상업/비상업 무료, 출처표기 의무 없음)
 *
 * 날짜를 남기는 이유: Pixabay는 구 Pixabay License → 현 Content License로 조항을 개정한
 * 이력이 있고 **적용 기준이 다운로드 시점**이다. 게임 내 배경음 재생은 허용 범위지만,
 * 음원 파일 자체의 재배포·판매와 Content ID 등 저작권 관리 서비스 등록은 금지다.
 */
const MUSIC_URL = new URL('./mi_music-reggae-ruckus-157890.mp3', import.meta.url).href;

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
    // 마스터도 함께 — 위 둘은 소스를 실제로 멎게 해 CPU를 아끼는 것이고, 마스터 뮤트는 "여기 안 적힌
    // 지속음이 사운드 OFF에서 계속 울리는" 구조적 구멍을 막는다(SOUND.md §4.2). 새 소리는 bus()에만
    // 꽂으면 되고 이 setter에 등록할 필요가 없다.
    this.applyMaster();
  }

  constructor() {
    const resume = () => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.bus(); // 마스터 버스를 ctx와 같은 순간에 세운다 — 첫 소리가 어느 경로든 버스를 거치게
      }
      if (this.ctx.state === 'suspended') this.transition('resume');
      void this.loadSamples();
      void this.loadMusic();
    };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 마스터 버스 — 모든 소스 → masterGain → limiter(DynamicsCompressor) → destination.
  //
  // 왜 필요했나 (2026-09-02, SOUND.md §4.1): 네 소스가 각자 destination에 직결이었고 Web Audio는
  // 거기 꽂힌 신호를 단순 합산한다. 임팩트 순간엔 공이 아직 빠르게 굴러 굴림(최대 0.85)과 크래시(최대 1.0)가
  // 겹치고 BGM(0.08)까지 얹혀 최악 합 1.93 — ±1.0을 넘는 만큼 출력단에서 하드 클리핑(지직)이다.
  // 그래서 굴림 피크를 0.85에서 더 못 올렸고, 소리를 더 얹으려면 기존 게인을 전부 재조정해야 했다.
  //
  // 리미터 설정 근거:
  //  · threshold −2 dB(0.79) · ratio 20 · knee 4. 브라우저 실측(2026-09-02, `limiterReduction`):
  //    굴림 10.5 m/s + 풀랙 크래시 겹침 → 최대 **−2.34 dB**, 크래시 단독 → −1.2 dB, 굴림 단독 → −0.33 dB.
  //    즉 겹침에서만 본격적으로 물리고 임팩트의 "쾅"은 여전히 다른 모든 소리보다 크게 남는다(상대 밸런스 유지).
  //  · attack 3 ms — Chromium 구현은 약 6 ms 룩어헤드(pre-delay)가 있어 크래시 첫 트랜지언트도 잡는다.
  //  · release 150 ms — 크래시 뒤 굴림·BGM이 눌린 채 오래 머물면 '펌핑'으로 들린다. 짧게.
  //  ⚠️ DynamicsCompressorNode는 **자동 메이크업 게인**을 끌 수 없다(Chromium: (1/fullRangeGain)^0.6).
  //    threshold를 낮출수록 전체가 그만큼 커진다 — −2 dB에선 약 +1.1 dB로, 굴림 vs BGM 같은 상대 밸런스는
  //    안 변하니 튜닝값을 다시 잡지 않았다. threshold를 −6 이하로 내리면 그때는 masterGain으로 보정할 것.
  //  · masterGain은 리미터 **앞**이다(SOUND.md §4.1 그림). 전체 볼륨을 내리면 리미터에 덜 걸리는 게 자연스럽다.
  // ────────────────────────────────────────────────────────────────────────────
  private masterGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private _volume = 1;

  /** 마스터 볼륨 0~1 (전체 한 손잡이). 사운드 OFF는 별개 — `enabled`가 마스터를 0으로 뮤트한다. */
  get volume(): number {
    return this._volume;
  }
  set volume(v: number) {
    this._volume = Math.max(0, Math.min(1, v));
    this.applyMaster();
  }

  /** 리미터가 지금 누르고 있는 양(dB, ≤0). 검증용(SOUND.md §7) — 굴림 최대 + 풀랙 크래시를 겹치면 음수여야 한다. */
  get limiterReduction(): number {
    return this.limiter?.reduction ?? 0;
  }

  /** 소스가 꽂을 입구. ctx가 있으면 항상 버스를 돌려주고, 없으면(제스처 전) 호출하면 안 된다. */
  private bus(): AudioNode {
    const ctx = this.ctx!;
    if (!this.masterGain) {
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -2;
      lim.knee.value = 4;
      lim.ratio.value = 20;
      lim.attack.value = 0.003;
      lim.release.value = 0.15;
      lim.connect(ctx.destination);
      const g = ctx.createGain();
      g.gain.value = this._enabled ? this._volume : 0;
      g.connect(lim);
      this.masterGain = g;
      this.limiter = lim;
    }
    return this.masterGain;
  }

  /** enabled·volume을 마스터 게인 하나로 합산 반영. 짧은 램프로 뮤트/언뮤트 클릭 방지. */
  private applyMaster() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const g = this.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(this._enabled ? this._volume : 0, now, 0.02);
  }

  // 실제 녹음 샘플 (strike=충돌, roll=굴림). ctx 생성 후 지연 디코드, 그 전엔 합성 폴백.
  private strikeBuf: AudioBuffer | null = null;
  private rollBuf: AudioBuffer | null = null;
  private samplesLoading = false;
  private rollSrc: AudioBufferSourceNode | null = null;
  private rollMax = 0.12; // 굴림 최대 게인 (합성=0.12, 샘플=0.85 — 생성 시 결정)

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

  // --- 공 굴림 럼블 (지속음) ---
  // 레인 위 공의 저역 우르릉. 루프 노이즈 1개를 계속 돌리고 게인만 움직여(start/stop 클릭 방지)
  // 속도에 음량·밝기를 종속 → 굴러갈 때 살아나고 멈추면 사라진다. 임팩트 직전 긴장감.
  // 저역이라 리버브 기여가 미미해 드라이(리버브 없음) — 마스터 버스를 거쳐 나간다.
  private rollGain: GainNode | null = null;
  private rollLp: BiquadFilterNode | null = null;
  private rollGutterFilter: BiquadFilterNode | null = null; // 거터 홀로우용 피킹 필터 (레인=평탄/바이패스)
  private rollTone: BiquadFilterNode | null = null; // 슬로모용 로패스 — 정상 배속엔 18kHz(투명), 슬로모 바닥에서 800Hz
  /**
   * 굴림 세기 갱신 (GameState가 매 스텝 공 속도로 호출). speed=공 속도(m/s), 0이면 무음.
   * @param timeScale 그 스텝의 화면 배속(슬로모 SLOWMO_SCALE~1). 리플레이도 자기 재생 배율을 넘긴다.
   *
   * **슬로모 동기 (2026-09-02, SOUND.md §8.3)**: 화면은 느려지는데 굴림음은 정상 속도로 웅웅거리면 "화면만 느려진 것"으로
   * 읽힌다. Max Payne·Superhot 계열의 관례대로 재생 속도를 내리고(피치↓) 고역을 깎는다(둔하고 먼 질감).
   *  · 피치는 √timeScale — SLOWMO_SCALE 0.32를 그대로 쓰면 1.6옥타브라 아티팩트 구간이고(관례: 1옥타브 이내),
   *    √0.32 = 0.57 ≈ −10 semitone이 딱 그 안이다.
   *  · 로패스는 배속에 2차로 매핑해 정상 배속 근처에선 거의 안 걸리고 바닥에서만 800Hz까지 닫힌다.
   *  · 리플레이(0.9배)는 피치 0.95·LPF 16.8kHz라 사실상 라이브와 같다 — 의도.
   */
  setRoll(speed: number, inGutter = false, timeScale = 1) {
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
      const tone = ctx.createBiquadFilter(); // 슬로모 로패스 (평시 투명)
      tone.type = 'lowpass';
      tone.frequency.value = 18000;
      tone.Q.value = 0.5;
      if (this.rollBuf) {
        src.buffer = this.rollBuf; // makeSeamlessLoop로 가공된 무한 루프 버퍼 (이음새 매끈)
        src.connect(gf).connect(tone).connect(g).connect(this.bus()); // 자체 스펙트럼이라 평시 LP는 투명(+거터 피킹)
        this.rollMax = 0.85;
      } else {
        const len = Math.ceil(ctx.sampleRate * 1.0); // 폴백: 합성 저역 노이즈
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 280;
        src.connect(lp).connect(gf).connect(tone).connect(g).connect(this.bus());
        this.rollLp = lp;
        this.rollMax = 0.12;
      }
      src.start(); // 굴림 루프 시작 (통째 루프 — 이음새 클릭 없음)
      this.rollSrc = src;
      this.rollGain = g;
      this.rollGutterFilter = gf;
      this.rollTone = tone;
    }
    const now = ctx.currentTime;
    // 거터 진입 엣지 (2026-09-03, SOUND.md §2.9) — 이 투구에서 inGutter가 처음 참이 되는 스텝에 '덜컥' 한 번. 음색 변화(아래 피킹·피치)는
    // 이미 있었지만 '빠지는 순간'이 없었다(§5 B). 래치는 speed 0(정지·핀덱 뒤·리셋)에서 풀린다 — GameState.emitRoll이 매 스텝 부르므로
    // 다음 투구의 첫 스텝엔 항상 풀려 있다. 레인으로 되올라오는 일은 규격 거터에선 거의 없지만, 오면 다시 울리게 둔다.
    if (speed <= 0.01) this.gutterWas = false;
    else if (inGutter && !this.gutterWas) {
      this.gutterWas = true;
      this.playGutterDrop(speed);
    } else if (!inGutter) this.gutterWas = false;
    const MAX = MAX_SPEED; // 속도 1~MAX_SPEED → 게인·피치·밝기 종속 (예전엔 12 하드코딩 — 상수가 바뀌자 상단이 비었다)
    const t = Math.max(0, Math.min(1, (speed - 1) / (MAX - 1)));
    const gutterMul = inGutter ? 0.85 : 1; // 거터는 살짝만 작게 (사라지지 않게)
    // 곡선이 t²이던 시절엔 **보통 속도에서 BGM에 묻혔다** (2026-09-02, 사용자 보고: "굴러가는 효과음이
    // 좀 묻힌다" — 핀 크래시는 들린다고 했다). 실측 대조: speed 5에서 t²×0.7 = 0.124인데 매치 중
    // BGM이 0.12다. 즉 굴림이 배경음악과 **같은 레벨**이었고, 게다가 저역이라 마스킹에 훨씬 약하다.
    //   speed  |    3      5      7      9   10.5
    //   t²×0.7 | 0.031  0.124  0.279  0.496  0.700   ← 이전
    //   t^1.5  | 0.082  0.232  0.425  0.655  0.850   ← 현재 (×0.85)
    // 지수를 1.5로 완만하게 해 중속 구간을 ~2배 올렸다. 최대치는 0.7→0.85로만 올렸다 — 크래시가
    // 최대 1.0이고 임팩트 순간엔 공이 아직 빠르게 굴러 둘이 겹치므로, 당시엔 합 1.85가 곧 클리핑이었다.
    // 지금은 마스터 리미터가 넘치는 만큼 눌러 주지만(bus() 주석), 리미터는 안전망이지 밸런스 도구가
    // 아니다 — 크래시가 굴림보다 크게 들리려면 게인 비율은 여기서 정한다. 더 필요하면 BGM을 내리는 게 순서다.
    this.rollGain.gain.setTargetAtTime(Math.pow(t, 1.5) * this.rollMax * gutterMul, now, 0.02); // 빠른 추종 (지연감 줄임, 클릭은 방지)
    const slow = Math.max(SLOWMO_SCALE, Math.min(1, timeScale)); // 빨리감기(>1)는 피치를 올리지 않는다 — 다람쥐 소리 방지
    const rateMul = Math.sqrt(slow); // 슬로모 바닥 0.57 (≈ −10 semitone)
    this.rollSrc!.playbackRate.setTargetAtTime(((inGutter ? 0.95 : 0.85) + t * 0.4) * rateMul, now, 0.05); // 거터는 살짝 높게(텅한 질감)
    if (this.rollTone) {
      const u = (slow - SLOWMO_SCALE) / (1 - SLOWMO_SCALE); // 0 = 슬로모 바닥, 1 = 정상
      this.rollTone.frequency.setTargetAtTime(800 + (18000 - 800) * u * u, now, 0.03);
    }
    if (this.rollGutterFilter) {
      this.rollGutterFilter.gain.setTargetAtTime(inGutter ? 12 : 0, now, 0.04); // 거터: 380Hz 공명 부각(홀로우), 레인=평탄
    }
    if (this.rollLp) this.rollLp.frequency.setTargetAtTime(220 + t * 200, now, 0.05);
  }

  private gutterWas = false;

  /**
   * 거터 진입 '덜컥' — 공(약 7 kg)이 레인 모서리에서 4.8 cm 아래 골로 떨어져 채널 바닥을 치는 소리. 셋으로 만든다:
   *  · 몸통 : 사인 95→60 Hz 110 ms + LPF 260 노이즈 60 ms — 무게
   *  · 채널 : 노이즈 공진 BPF 380 Hz Q4 80 ms — 굴림음의 거터 피킹(380 Hz)과 같은 자리라 '그 골 안'으로 이어진다
   *  · 모서리: 노이즈 HPF 1.5 kHz 5 ms — 공이 레인 모서리를 스치는 짧은 '틱'
   * 세기는 속도에 살짝만 비례(0.8 + 0.2·t) — 낙차는 속도와 무관하다. 오실레이터는 몸통 사인 하나뿐(70 ms대, 음정 아래 — 타격음 톤 금지 규칙의 예외 범위).
   * 실측(§7.x, 리미터 앞): 피크 ≈ −14 dBFS(클랙 −15와 클래터 −16 사이). 스틸컷이 무음이 된 뒤 거터의 유일한 사건음이다.
   * ⚠️ 오프라인 렌더에서 bus()를 거치면 DynamicsCompressor의 시동 구간이 첫 50 ms를 11 dB 눌러 −25로 보인다 — 잴 때는 bus를 destination으로 바꿔 잰다.
   */
  private playGutterDrop(speed: number) {
    const ctx = this.ctx!;
    const out = this.bus();
    const t0 = ctx.currentTime;
    const k = 0.8 + 0.2 * Math.max(0, Math.min(1, (speed - 1) / (MAX_SPEED - 1)));
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t0);
    o.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.2 * k, t0 + 0.005);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09); // 110 → 90 ms: 길면 킥드럼
    o.connect(og).connect(out);
    o.start(t0);
    o.stop(t0 + 0.12);
    const body = ctx.createBufferSource();
    body.buffer = this.noise();
    const blp = ctx.createBiquadFilter();
    blp.type = 'lowpass';
    blp.frequency.value = 260;
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.0001, t0);
    bg.gain.exponentialRampToValueAtTime(0.16 * k, t0 + 0.002);
    bg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
    body.connect(blp).connect(bg).connect(out);
    body.start(t0);
    body.stop(t0 + 0.09);
    const ch = ctx.createBufferSource();
    ch.buffer = this.noise();
    ch.loop = true;
    const cb = ctx.createBiquadFilter();
    cb.type = 'bandpass';
    cb.frequency.value = 380;
    cb.Q.value = 4;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.0001, t0);
    // BPF Q4는 대역이 좁아(95 Hz) 노이즈 RMS가 게인의 약 −24 dB — 보정 배율. 1.4에선 스펙트럼의 2%뿐이어서(순수 저역 '쿵', 폰에선 사라짐)
    // 2.6으로: 150~600 Hz가 ~35%가 되어야 '채널에 떨어졌다'가 들린다. 4.5에선 피크가 −6~−9 dBFS로 튀어 전체를 6 dB 내렸다(§7.x 렌더).
    cg.gain.exponentialRampToValueAtTime(2.6 * k, t0 + 0.003);
    cg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    ch.connect(cb).connect(cg).connect(out);
    ch.start(t0);
    ch.stop(t0 + 0.13);
    const edge = ctx.createBufferSource();
    edge.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    const eg = ctx.createGain();
    eg.gain.setValueAtTime(0.12 * k, t0);
    eg.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.005);
    edge.connect(hp).connect(eg).connect(out);
    edge.start(t0);
    edge.stop(t0 + 0.02);
  }

  /**
   * 공 피트 낙하 → 쿠션 타격 + 볼 리턴 사슬 (2026-09-03, SOUND.md §2.10·§2.11 — 합성은 pitSfx.ts).
   * 첫 버전(사인 70→45 Hz 한 방)은 청취에서 "밋밋"했다(피드백 ⑤): 실제 피트는 쿠션 '둥' → 프레임 클렁크 → 볼 도어 → 액셀러레이터 → 서브웨이
   * 럼블 → 랙 클랙으로 4~5 s에 걸친 사건 사슬이다. 출구는 machineBus — 일시정지(메뉴)에 기계음과 함께 뮤트된다. speed = 착지 속력(m/s).
   */
  playPitDrop(speed: number) {
    if (!this.ctx || !this.enabled) return;
    const out = this.machineOut();
    const t0 = this.ctx.currentTime;
    schedulePitDrop(this.ctx, out, this.noise(), t0, speed);
    scheduleBallReturn(this.ctx, out, this.noise(), t0);
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

  /**
   * suspend/resume은 **경합한다.** 탭 가시성이 빠르게 뒤집히면 앞 전이가 끝나기 전에 다음 전이가
   * 들어와 `InvalidStateError: Transition was aborted`가 unhandled rejection으로 콘솔에 쌓인다
   * (헤드리스 검증 중 15건 관측). 실패해도 다음 visibilitychange가 다시 맞춰주므로 삼킨다.
   */
  private transition(kind: 'suspend' | 'resume') {
    this.ctx?.[kind]().catch(() => {});
  }

  /** 백그라운드 진입 시 오디오 스레드 정지 (배터리/발열). visibilitychange에서 호출 (MOBILE_SUPPORT.md §6). */
  suspend() {
    if (this.ctx?.state === 'running') this.transition('suspend');
  }

  /** 포그라운드 복귀 시 재개. */
  resume() {
    if (this.ctx?.state === 'suspended') this.transition('resume');
  }

  /**
   * 릴리스 트랜지언트 (2026-09-02, SOUND.md §2.7) — throwBall 순간 1회. 굴림 럼블은 0에서 τ=0.02로 페이드인이라 소리에
   * '던진 순간'이 없었다(§5 B). 실제 릴리스는 두 사건이다: 엄지가 빠지는 **팝**(짧은 고역 클릭) → 60 ms 뒤 공이 레인에
   * 닿는 **둥**(레인 판이 울리는 저역 + 나무 노크). 게임은 공을 레인 높이에서 바로 발사하므로 착지 낙차는 없지만 귀는
   * 그 순서를 기대한다 — 팝을 먼저 두고 둥을 뒤에 둔다. 세기는 power(0~1)로: 살살 놓으면 노크만, 세게 던지면 판이 운다.
   *  · pop  : 노이즈 HPF 3 kHz 4 ms, 0.05 (power 무관 — 엄지는 늘 같은 소리)
   *  · thud : 노이즈 LPF 180 Hz 90 ms + 사인 95→58 Hz 160 ms, 0.18 + 0.22·power
   *  · knock: 노이즈 BPF 420 Hz Q2 45 ms, 0.10 + 0.06·power — 레인 보드의 '탁'. 이게 없으면 둥이 킥드럼처럼 들린다.
   * 리플레이는 임팩트 직전 1.3 s만 재생하므로 릴리스는 재생 창 밖 — 재발화 없음.
   */
  playRelease(power: number) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const out = this.bus();
    const k = Math.max(0, Math.min(1, power));
    const t = ctx.currentTime;
    this.click(out, t, 0.05); // 팝
    const t1 = t + 0.06; // 둥
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 180;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t1);
    ng.gain.exponentialRampToValueAtTime(0.18 + 0.22 * k, t1 + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.09);
    n.connect(lp).connect(ng).connect(out);
    n.start(t1);
    n.stop(t1 + 0.12);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(95, t1);
    o.frequency.exponentialRampToValueAtTime(58, t1 + 0.16);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t1);
    og.gain.exponentialRampToValueAtTime(0.16 + 0.2 * k, t1 + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.17);
    o.connect(og).connect(out);
    o.start(t1);
    o.stop(t1 + 0.2);
    const w = ctx.createBufferSource(); // 나무 노크
    w.buffer = this.noise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 2;
    const wg = ctx.createGain();
    wg.gain.setValueAtTime(0.1 + 0.06 * k, t1);
    wg.gain.exponentialRampToValueAtTime(0.0001, t1 + 0.045);
    w.connect(bp).connect(wg).connect(out);
    w.start(t1);
    w.stop(t1 + 0.07);
  }

  /**
   * 투구당 1회 핀 임팩트음 (GameState.notifyImpact가 명령). 개별 contact마다 소리내던
   * 방식은 슬로모 중 contact가 띄엄띄엄 들어와 '여러 번/탭탭탭'으로 들려서, 임팩트는
   * '한 사건 = 한 소리'로 통일. 세기는 '서 있던 핀 수'로 — 풀랙=쾅, 1~2핀=가벼운 톡.
   */
  playRackCrash(standingCount: number) {
    // 샘플이 없으면 **소리를 안 낸다.** 예전엔 합성 크래시(고-Q 크랙 + 노이즈 클러터 + 서브베이스
    // + 우드 클랙 다발 ≈ 145줄)가 폴백이었는데, 디코드는 첫 제스처에 시작하고 첫 투구는 그보다
    // 몇 초 뒤라 **실제로는 도달한 적이 없는 경로**였다. 컨볼루션 리버브 버스도 그 폴백만 쓰고
    // 있어서 같이 걷어냈다(2026-09-01). 이제 여기서 무음이면 wav 디코드가 실패한 것이다.
    if (!this.ctx || !this.enabled || !this.strikeBuf) return;
    this.playStrike(standingCount); // 핀수로 볼륨·길이 스케일 — 1~2핀도 가벼운 실제 타격음이 된다
  }

  /**
   * 스트라이크 녹음 재생 — 녹음에 자연 잔향이 이미 들어 있어 리버브 없이 버스로 보낸다.
   *
   * **3층 엔벨로프 (2026-09-02, SOUND.md §8.1 "임팩트는 3층")** — strike.wav의 엔벨로프를 5ms RMS로 재보면
   * 크랙(트랜지언트) 0.105~0.125s(피크 0.83) → 클래터(바디) ~0.5s(0.15~0.5) → 잔해·잔향(테일) ~2.2s로 나뉜다.
   * 예전엔 핀 수로 **볼륨과 길이만** 잘랐다 — 1핀은 "풀랙 소리를 0.3초에서 끊은 것"이라 '톡'이 아니라 잘린 '쾅'이었다.
   * 지금은 한 소스에 게인 자동화를 그려 **크랙은 거의 그대로, 바디·테일만 핀 수에 비례**시킨다. 공이 핀을 치는
   * 어택은 1핀이든 10핀이든 같은 사건이고, 달라지는 건 그 뒤 쓰러지는 핀들의 클래터 양이다.
   *  · 크랙 게인 0.85~1.0 · 바디 게인 0.25~1.0 (1핀 0.33) · 길이는 여전히 0.3~2.1s(테일을 핀 수만큼만 남긴다).
   *  · 크랙→바디 전환은 크랙이 끝나는 +25ms에서 25ms 램프 — 경계가 없는 한 소스라 이음새 클릭이 없다.
   *
   * **변주 (§8.1 "반복 피로")** — 단일 샘플이라 투구마다 똑같았다. playbackRate ±3%(≈ ±0.5 semitone)와 시작
   * 오프셋 ±3ms를 흔든다. 오프셋은 크랙(0.105s) 앞 리드인 안에서만 움직여 어택을 절대 자르지 않는다.
   * 게인 자동화는 ctx 시각 기준이라 배속이 바뀌어도 크랙 위치 오차는 5ms×3% = 무시 가능.
   */
  private playStrike(count: number, out: AudioNode = this.bus()) {
    // out = 출구. 기본은 마스터 버스, 옆 레인 크래시는 laneOut(거리 감쇠)으로 들어온다(ambBallCue).
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.strikeBuf!;
    const g = ctx.createGain();
    const intensity = Math.min(1, count / 10);
    const crack = 0.85 + intensity * 0.15; // 어택은 사건이 같으니 거의 고정
    const body = 0.25 + intensity * 0.75; // 클래터·잔해는 쓰러지는 핀 수만큼 — 1핀 0.33, 풀랙 1.0
    // 적은 핀은 짧게(크랙+짧은 잔해), 많을수록 풀 클래터 — 1핀에 풀랙 소리 나는 부자연 방지.
    const dur = 0.3 + intensity * 1.8; // 1핀≈0.3s, 풀랙≈2.1s — 짧은 컷이 "안 들린다" 느낌 줄임
    const CRACK_END = 0.025; // 재생 시작(리드인 0.10) 기준 크랙 구간 끝 = 원본 0.125s
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(crack, now + 0.008); // 8ms 페이드인 — 시작 클릭 제거(크랙 어택은 0.105부터라 안 깎임)
    g.gain.setValueAtTime(crack, now + CRACK_END);
    g.gain.linearRampToValueAtTime(body, now + CRACK_END + 0.025); // 크랙 → 바디 레벨
    g.gain.setValueAtTime(body, now + Math.max(CRACK_END + 0.03, dur - 0.06));
    g.gain.linearRampToValueAtTime(0.0001, now + dur); // 끝 60ms 페이드아웃 — 자르기 클릭 제거
    src.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.03; // ±3% 피치 변주
    const offset = STRIKE_LEADIN + (Math.random() * 2 - 1) * 0.003; // ±3ms — 크랙(0.105) 앞에서만 움직인다
    src.connect(g).connect(out); // 드라이(리버브 없음)
    src.start(0, offset, dur); // 임팩트 구간부터, 길이는 핀수 비례
  }

  /**
   * 합성 단음 — 지수 어택/릴리즈로 클릭 없는 '삑'. 지금은 해금 차임이 유일한 호출자다.
   * (BGM이 합성 칩튠이던 시절엔 노트 재생도 이걸 거쳤고, 그래서 출력 노드를 인자로 받는다 —
   * 호출자는 destination이 아니라 `this.bus()`를 넘긴다.)
   */
  private blip(
    dest: AudioNode,
    freq: number,
    time: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    attack = 0.006,
  ) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(g).connect(dest);
    o.start(time);
    o.stop(time + dur + 0.02); // 릴리즈가 다 흐른 뒤 정리 (조기 stop = 뚝 끊김)
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 하우스 PA 차임 — 게임오버 스팅어·해금 차임만. 스틸컷 4종은 2026-09-02에 도장 쿵으로 갔다가 2026-09-03에 소리를 뺐다(핀세터 사이클과
  // 같은 순간에 시작해 묻힌다 — SOUND.md §2.6). 방향은 리얼·다이제틱: 관중 반응이 아니라
  // **이 볼링장 천장 스피커가 내는 신호음**이다(실제 하우스가 스트라이크에 전광판 애니메이션 + 짧은 팡파르를 내듯).
  // 해금 차임과 같은 합성 계열(blip)이고, 스피커 질감을 위해 paOut() 필터 체인(HPF 300 · 2.2kHz 프레즌스 · LPF 6k)을 거친다
  // — UI 소리와 구분되고 "저 위 스피커"로 읽힌다.
  //
  // 어휘(§8.1 위계·일관성): 좋은 일은 **상승 장3화음 아르페지오**, 나쁜 일은 **하강**. 세기는 음 수로 —
  //   strike 스트릭 1·2·3·4+ → 3·4·5·6음(라벨 STRIKE/DOUBLE/TURKEY/n-BAGGER와 같이 갈린다) · spare 2음 · splitConverted 4음 + 긴 종지
  //   gutter 하강 2음(삼각파, 느리게 — 디플레이팅) · gameOver 승/솔로 = 4음 종지 · 무 = 같은 음 2번 · 패 = 하강 3음, 신기록이면 트릴 추가.
  // 타이밍은 **스틸컷이 뜨는 순간**에 맞춘다 — 스트라이크는 이벤트 시각이 아니라 리플레이 프리즈 콜백(Boot). 레벨 0.16~0.22.
  // ────────────────────────────────────────────────────────────────────────────
  private paChain: AudioNode | null = null;

  private paOut(): AudioNode {
    if (!this.paChain) {
      const ctx = this.ctx!;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 300;
      const pk = ctx.createBiquadFilter();
      pk.type = 'peaking';
      pk.frequency.value = 2200;
      pk.Q.value = 1;
      pk.gain.value = 3;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 6000;
      hp.connect(pk).connect(lp).connect(this.bus());
      this.paChain = hp;
    }
    return this.paChain;
  }

  /** MIDI 노트 → Hz. C5=72. */
  private static mtof(m: number): number {
    return 440 * Math.pow(2, (m - 69) / 12);
  }

  /**
   * 노트 열을 PA로 재생. gap = 음 사이 간격(s), dur = 각 음 길이(s), last = 마지막 음 길이(종지는 길게).
   * 반환 = 전체 길이(s) — 뒤에 이어 붙일 소리(해금 차임)가 겹치지 않게 호출자가 쓴다.
   */
  private chime(notes: number[], gap: number, dur: number, vol: number, type: OscillatorType = 'sine', last = dur): number {
    const ctx = this.ctx!;
    const out = this.paOut();
    const now = ctx.currentTime;
    notes.forEach((m, i) => {
      const t = now + i * gap;
      const d = i === notes.length - 1 ? last : dur;
      this.blip(out, SoundManager.mtof(m), t, d, type, vol, 0.012);
      this.blip(out, SoundManager.mtof(m + 12), t, d * 0.6, 'sine', vol * 0.18, 0.012); // 옥타브 위 배음 — 종소리 광택
    });
    return (notes.length - 1) * gap + last;
  }


  /**
   * 게임 종료 스팅어. 승/솔로 = 상승 4음 종지(C E G C), 무 = G 두 번, 패 = 하강 3음(E C G4). 신기록이면 뒤에 트릴(C6 E6 C6 E6).
   * 반환 = 전체 길이(s) — Boot가 해금 차임을 그 뒤에 잇는다(둘이 같은 순간 울리면 뭉개진다).
   */
  playGameOverSting(summary: GameSummary): number {
    if (!this.ctx || !this.enabled) return 0;
    const solo = summary.players.length === 1;
    let len: number;
    if (solo || summary.winner === 0) len = this.chime([72, 76, 79, 84], 0.13, 0.36, 0.2, 'sine', 0.9);
    else if (summary.winner === -1) len = this.chime([79, 79], 0.2, 0.3, 0.17, 'sine', 0.5);
    else len = this.chime([76, 72, 67], 0.2, 0.36, 0.16, 'triangle', 0.7);
    if (summary.newBest) {
      const ctx = this.ctx;
      const out = this.paOut();
      const t0 = ctx.currentTime + len - 0.25; // 종지 꼬리에 겹쳐 시작 — 별개 사건이 아니라 '반짝임'으로 붙는다
      [84, 88, 84, 88].forEach((m, i) => this.blip(out, SoundManager.mtof(m), t0 + i * 0.07, 0.18, 'sine', 0.14, 0.008));
      len += 0.25;
    }
    return len;
  }

  /** 업적/스킨 해금 '딩' — 합성 2음 차임. 결과 화면 토스트와 함께. delay = 게임오버 스팅어 뒤에 잇기(초). */
  playUnlock(delay = 0) {
    if (!this.ctx || !this.enabled) return;
    const now = this.ctx.currentTime + delay;
    [880, 1318.5].forEach((freq, i) => {
      this.blip(this.bus(), freq, now + i * 0.11, 0.3, 'sine', 0.22, 0.012); // A5 → E6 상승
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 핀세터 기계음 — 합성, 기준 기계는 Brunswick GS-X (2026-09-02 재설계, SOUND.md §2.5). 방향은 리얼·다이제틱.
  //
  // 합성 자체는 machineSynth.ts(MachineSynth)가 갖는다 — BaseAudioContext만 받으므로 OfflineAudioContext로도 그대로 렌더된다.
  // 브라우저 콘솔에서 `import('/src/audio/machineSynth.ts')`로 한 사이클을 렌더해 대역 에너지·단계별 RMS를 재는 게 검증 방법이다
  // (SOUND.md §7). 층 구성·레벨 근거·이전 설계가 왜 저역 드론이 됐는지는 그 파일 상단 주석.
  // 여기 남는 건 배선이다: 레인별 출구(laneOut — 거리 게인·LPF·팬) · 기계 버스(machineBus — 일시정지 뮤트) · 공유 노이즈 버퍼.
  //
  // 옆 레인(Environment)은 같은 큐를 cx와 함께 보낸다 — laneOut()이 거리로 게인·LPF·팬을 정한다. 옆 레인 공(굴림·크래시)도
  // 같은 출구를 쓰므로 machineBus는 사실상 '옆 레인 + 기계' 버스다 — 일시정지 뮤트도 그 전부에 걸린다.
  // 레벨 기준: 크래시 1.0 · 굴림 ≤0.85 · BGM 0.08. 기계는 볼러가 18m 뒤에서 듣는 소리라 연속음 RMS −40 dBFS · 타격 피크 −20 dBFS 근처(§2.5 실측표).
  // ⚠️ 일시정지(메뉴·리플레이)에 물리가 멈추면 사이클도 멈추는데 합성기의 연속음은 노드라 계속 돈다 — setMachinePaused로 뮤트한다.
  // ────────────────────────────────────────────────────────────────────────────
  private machineBus: GainNode | null = null;
  private machinePaused = false;
  private noiseBuf: AudioBuffer | null = null;
  private readonly laneOuts = new Map<string, GainNode>();
  private machine: MachineSynth | null = null;

  /** 일시정지(메뉴·리플레이)에 기계음 뮤트 — Boot.applyPause가 loop.paused와 같은 값으로 부른다. */
  setMachinePaused(p: boolean) {
    this.machinePaused = p;
    if (!this.ctx || !this.machineBus) return;
    const now = this.ctx.currentTime;
    this.machineBus.gain.cancelScheduledValues(now);
    this.machineBus.gain.setTargetAtTime(p ? 0 : 1, now, 0.03);
  }

  /**
   * 핀세터 단계 큐 (PinSet.onCycle · Environment.onAmbMachine). lane 생략 = 플레이 레인.
   * done은 enabled와 무관하게 넘긴다 — 사운드를 끈 뒤에도 돌고 있던 연속음·예약 소스를 끊어야 하니까.
   */
  machineCue(cue: MachineCue, lane: MachineLane = { key: 'main', cx: 0 }) {
    if (!this.ctx) return;
    if (cue.phase !== 'done' && !this.enabled) return;
    if (!this.machine) this.machine = new MachineSynth(this.ctx, this.noise());
    this.machine.cue(cue, lane.key, this.laneOut(lane), this.ctx.currentTime, this.enabled);
  }


  // ── 옆 레인 공 소리 (2026-09-02, SOUND.md §2.8) — 기계음과 같은 laneOut 감쇠 경로(거리 게인·LPF 1.4k·팬)로,
  // 굴림은 roll.wav를 레인마다 따로 돌리고(속도→게인·피치는 주 레인 setRoll과 같은 식) 크래시는 playStrike를 그 출구로 보낸다.
  // 굴림은 crash 큐에서 끊는다 — 주 레인이 PIN_DECK_END에서 끊는 것과 같은 자리다. 세기는 그 순간 서 있던 핀 수.
  private readonly ambRolls = new Map<string, { src: AudioBufferSourceNode; gain: GainNode }>();

  ambBallCue(cue: AmbBallCue, lane: MachineLane) {
    if (!this.ctx) return;
    if (cue.kind === 'stop' || cue.kind === 'crash') this.ambRollStop(lane.key);
    if (!this.enabled) return;
    if (cue.kind === 'roll') this.ambRollStart(lane, cue.speed);
    else if (cue.kind === 'crash' && this.strikeBuf) this.playStrike(cue.pins, this.laneOut(lane));
  }

  private ambRollStart(lane: MachineLane, speed: number) {
    if (!this.rollBuf) return; // 샘플 전(첫 제스처 직후)이면 이번 굴림은 건너뛴다 — 옆 레인은 폴백 노이즈까지 낼 가치가 없다
    this.ambRollStop(lane.key);
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const t = Math.max(0, Math.min(1, (speed - 1) / (MAX_SPEED - 1)));
    const src = ctx.createBufferSource();
    src.buffer = this.rollBuf;
    src.loop = true;
    src.playbackRate.value = 0.85 + t * 0.4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.pow(t, 1.5) * 0.85, now + 0.35); // 멀리서 들리는 굴림은 어택이 흐릿하다
    src.connect(g).connect(this.laneOut(lane));
    src.start(now);
    this.ambRolls.set(lane.key, { src, gain: g });
  }

  private ambRollStop(key: string) {
    const r = this.ambRolls.get(key);
    if (!r) return;
    this.ambRolls.delete(key);
    const now = this.ctx!.currentTime;
    r.gain.gain.cancelScheduledValues(now);
    r.gain.gain.setValueAtTime(Math.max(0.0001, r.gain.gain.value), now);
    r.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    r.src.stop(now + 0.15);
  }

  private machineOut(): GainNode {
    const ctx = this.ctx!;
    if (!this.machineBus) {
      this.machineBus = ctx.createGain();
      this.machineBus.gain.value = this.machinePaused ? 0 : 1;
      this.machineBus.connect(this.bus());
    }
    return this.machineBus;
  }

  /**
   * 레인별 출구 — 플레이 레인(cx≈0)은 드라이, 옆 레인은 거리 감쇠 0.42/(1+|cx|)(인접 ≈0.16 · 그 다음 ≈0.1) +
   * LPF 1.4kHz(벽·거리) + 스테레오 팬(cx/6). 한 번 만들어 캐시한다.
   */
  private laneOut(lane: MachineLane): AudioNode {
    const hit = this.laneOuts.get(lane.key);
    if (hit) return hit;
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const dist = Math.abs(lane.cx);
    if (dist < 0.5) {
      g.gain.value = 1;
      g.connect(this.machineOut());
    } else {
      g.gain.value = 0.42 / (1 + dist);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-1, Math.min(1, lane.cx / 6));
      g.connect(lp).connect(pan).connect(this.machineOut());
    }
    this.laneOuts.set(lane.key, g);
    return g;
  }

  private noise(): AudioBuffer {
    if (!this.noiseBuf) this.noiseBuf = makeNoise(this.ctx!); // 1초 백색 노이즈 — 모든 합성 층이 공유(루프)
    return this.noiseBuf;
  }

  /** 릴레이·핑거 클릭 — 고역 노이즈 4ms. */
  private click(out: AudioNode, t: number, vol: number) {
    const ctx = this.ctx!;
    const n = ctx.createBufferSource();
    n.buffer = this.noise();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.004);
    n.connect(hp).connect(g).connect(out);
    n.start(t);
    n.stop(t + 0.02);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // 메뉴 배경음악 — mp3 통째 루프 (에셋/라이선스는 MUSIC_URL 주석). 메뉴/결과 화면에서 풀 레벨,
  // 매치 중엔 잔잔하게 죽인 배경으로 깔고(굴림·크래시와 안 싸울 레벨) 계속 돈다. 완전 정지는
  // 사운드 OFF에서만. 로더의 TAP(user gesture)으로 ctx가 풀린 뒤 호출되므로 모바일에서도 바로 울린다.
  //
  // 예전엔 합성 칩튠 아르페지오였다(I–V–vi–IV, 룩어헤드 스케줄러로 32스텝 예약). 실제 트랙으로
  // 바꾸면서 스케줄러·MUSIC_PROG·mtof가 통째로 사라졌다 — 지금은 버퍼 하나를 loop=true로 돌리고
  // musicGain만 움직인다. setInterval도 없어졌다.
  // ────────────────────────────────────────────────────────────────────────────
  private musicGain: GainNode | null = null;
  private musicSrc: AudioBufferSourceNode | null = null;
  private musicBuf: AudioBuffer | null = null;
  private musicLoading = false;
  private musicOn = false;
  // ⚠️ 레벨은 칩튠 시절 값(0.62/0.22)을 이어 쓸 수 없다 — 그땐 oscillator blip 몇 개(vol 0.07~0.16)를
  // 합친 소리였고 지금은 마스터링된 풀스케일 트랙이라 같은 게인이면 훨씬 크게 들린다. 아래는 그 차이를
  // 감안한 재조정값이고, 최종 밸런스는 귀로 맞출 것.
  private readonly musicVol = 0.35; // 메뉴/결과 풀 레벨
  // 0.12 → 0.08 (2026-09-02). 굴림 곡선을 t^1.5로 올린 뒤에도 저속(speed 3 → 0.082)이 BGM 0.12보다
  // 작아 살살 굴릴 때 여전히 묻혔다. SFX 피크는 당시 클리핑 여유가 없어(굴림 0.85 + 크래시 1.0) 더 못 올렸고
  // 배경을 내리는 쪽이 순서였다. 이제 speed 3에서도 1.03배로 굴림이 앞선다. (마스터 리미터가 생긴 뒤에도
  // 이 비율은 그대로 둔다 — 리미터는 넘치는 피크를 자르는 안전망이고 밸런스는 게인 비율이 정한다.)
  private readonly musicMatchVol = 0.08; // 매치 중 배경 레벨 — 굴림(최대 0.85)·크래시(최대 1.0)에 안 묻히게 죽임

  /**
   * BGM mp3 지연 디코드 — 첫 user gesture(ctx 생성) 후 1회. Vite가 에셋으로 emit.
   *
   * wav들과 **별도 경로인 이유**: loadSamples의 Promise.all에 묶으면 1.5MB mp3 하나가 실패할 때
   * strike/roll까지 같이 날아가 SFX 전체가 무음이 된다. BGM 실패는 BGM만 잃게 격리한다.
   * 디코드된 PCM은 48s×44.1kHz×2ch×float32 ≈ 17MB로 wav 둘을 합친 것보다 훨씬 무겁다.
   */
  private async loadMusic() {
    if (!this.ctx || this.musicLoading || this.musicBuf) return;
    this.musicLoading = true;
    const ctx = this.ctx;
    try {
      this.musicBuf = await ctx.decodeAudioData(await (await fetch(MUSIC_URL)).arrayBuffer());
    } catch {
      /* 디코드 실패 — BGM 없이 진행 (SFX는 영향 없음) */
    }
    this.musicLoading = false;
  }

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

  /** 음악 게인을 목표 레벨로 부드럽게 (메뉴↔매치 크로스). musicGain만 만져 재생 위치는 안 건드림. */
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
    if (!this.musicBuf) {
      // 아직 디코드 전 — musicOn을 세우면 setMenuMusic이 두 번 다시 startMusic을 안 불러 영구 무음이 된다.
      void this.loadMusic(); // (첫 제스처에 이미 시작됐으면 멱등하게 빠짐)
      return;
    }
    this.musicOn = true;
    const ctx = this.ctx;
    if (!this.musicGain) {
      this.musicGain = ctx.createGain();
      this.musicGain.connect(this.bus()); // 드라이 — 리버브 없이 마스터 버스로
    }
    // stopMusic이 페이드아웃 뒤 정지로 예약해 둔 이전 노드가 아직 살아 있을 수 있다(0.55s 창).
    // 그 안에 사운드를 다시 켜면 게인이 되살아나며 두 벌이 겹쳐 들리므로 즉시 끊는다.
    this.musicSrc?.stop();
    const now = ctx.currentTime;
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setValueAtTime(0.0001, now);
    this.musicGain.gain.exponentialRampToValueAtTime(this.musicVol, now + 0.8); // 페이드인
    // mp3는 인코더 지연·패딩 때문에 앞뒤에 미세한 무음이 붙어 루프 이음새가 완벽하진 않다.
    // roll.wav처럼 크로스페이드(makeSeamlessLoop)로 가공하면 음악의 마디가 깨지므로 통째 루프로 둔다.
    const src = ctx.createBufferSource();
    src.buffer = this.musicBuf;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSrc = src;
  }

  private stopMusic() {
    if (!this.musicOn) return;
    this.musicOn = false;
    if (this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      const g = this.musicGain.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(0.0001, now + 0.5); // 페이드아웃
      this.musicSrc?.stop(now + 0.55); // 페이드가 다 흐른 뒤 정지 — 즉시 stop이면 뚝 끊긴다
    } else {
      this.musicSrc?.stop();
    }
    // musicSrc 참조는 남긴다 — 0.55s 안에 다시 켜질 때 startMusic이 겹침을 끊는 데 쓴다.
    // (정지된 BufferSource는 재사용 불가라 startMusic은 매번 새로 만든다.)
  }
}
