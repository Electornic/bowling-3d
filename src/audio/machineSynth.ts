import type { MachineCue, MachinePhase } from './cues';

/**
 * 핀세터 합성기 — 기준 기계는 **Brunswick GS-X** (2026-09-02 재설계, SOUND.md §2.5).
 *
 * 왜 다시 만들었나: 이전 4층(톱니 48 Hz 모터 험 · 노이즈 BPF 스윕 활주 · 80→55 Hz 사인 '쿵' · 삼각파 '탁')을 오프라인 렌더해
 * 재보니 **에너지 95%가 400 Hz 아래**(센트로이드 164 Hz)였다. 헤드폰에선 신스 베이스 드론 + 킥드럼, 폰 스피커(≈400 Hz 이하
 * 재생 불가)에선 그 둘이 통째로 사라져 쉬익·딱딱만 남았다. 실녹음(Freesound #449961 클로즈 · #675332 기계 시점)은 200 Hz~5 kHz에
 * 촘촘한 질감과 타격 트랜지언트가 있다. 그래서 "무엇을 어떻게 만드느냐"보다 **어느 대역에 무엇을 두느냐**를 먼저 정했다.
 *
 * GS-X의 구동 구조(운영 매뉴얼 47-902005-GBR): 테이블 모터·스윕 모터는 각각 **브레이크가 달린 벨트 구동**(V-belt · sweep drive belt),
 * 디스트리뷰터·트랜스포트 밴드도 벨트 구동, 선 핀은 테이블의 핀 홀더가 **스포팅 텅(솔레노이드)** 으로 집는다. 그래서 층은 다섯이다:
 *
 *   bed     연속음 — 벨트·롤러 바닥(노이즈 BPF 650 Hz, 롤러 주기 11 Hz AM) + **저역 럼블(LPF 170 ×2, 7 Hz AM — 무게, 피드백 ②)**
 *           + 벨트 히스(2.6 kHz) + 60 Hz 전원 모터 험의 120 Hz(아주 작게)
 *           + 래틀(1.5~3.5 kHz 틱 + 600~900 Hz 노크, 초당 2~3회, 바닥보다 13 dB 튄다 — 첫 설계에선 26 dB 아래라 안 들렸다)
 *   drive   테이블·스윕이 움직이는 동안의 **벨트 모터 부하음** — 파셜 6개 PeriodicWave(테이블 176 Hz · 스윕 236 Hz) → BPF 620/780 로
 *           3~4차 배음이 비치는 기어·벨트 와인(톤 0.5) + 1.0 kHz 노이즈 'shhh'(1.0). 느린 피치 워블 + 13 Hz 롤러 AM. 시동 시 120 ms 스핀업,
 *           방향에 따라 ±2% 드리프트. 끝은 다음 단계의 clack. ⚠️ 처음엔 톱니 2개 디튠이었고 사용자 청취에서 "신스 같다" — DRIVE_PARTIALS 주석.
 *   clack   부품이 끝에 닿고 브레이크가 잡히는 **중역 타격** — 노이즈 BPF 0.8~1.1 kHz 버스트 + 판금 울림(노이즈 공진 900·1700 Hz Q3) + 몸통(130→75 Hz 사인 + LPF 220).
 *           weight 0(테이블 스톱)~1(스윕 보드가 데크를 침). 저역은 몸통에만, 그것도 weight 비례. ⚠️ 울림이 삼각파 파셜(520·1380 Hz)이었을 때
 *           단계 정지 7번이 음정 있는 '통.통.통'으로 들렸다(피드백 ④) — 합성 타격음에 오실레이터 톤을 두지 않는다(몸통 사인은 70 ms, 음정 아래).
 *   clatter **새 층** — 스윕이 데드우드를 피트로 밀어 넣을 때 핀들이 쏟아지는 나무 클래터 — knock(320~620 Hz 공진 노이즈, 몸통 LPF 220) × 핀 수(≤9, 35 ms 이상 간격).
 *           실기계에서 볼러가 듣는 가장 큰 기계 사건인데 이전엔 무음이었다(SOUND.md §5 B). 핀 수(cue.pins)가 밀도를 정한다.
 *   pinSet  테이블이 핀을 스폿에 놓는 '탁' × n — knock(280~420 Hz 공진 노이즈, 핀 바닥이 데크를 친다), 160 ms 안에 흩어서.
 *   knock   위 둘과 bed 래틀이 공유하는 **나무 노크 원자** — 노이즈 버스트로 공진 필터(Q7)를 때린다. 삼각파 톤이었을 때 '통통통통' 실로폰이 됐다(피드백 ③).
 *   tong    스포팅 텅 솔레노이드 클릭 — 2 kHz+ 4 ms + 2.4 kHz 짧은 울림(3.2 kHz에서 내렸다 — 피드백 ③ '밝다').
 *
 * 레벨 목표(플레이 레인, machineBus 앞): 연속음 RMS ≈ −40 dBFS · 타격 피크 ≈ −20 dBFS · 400 Hz 아래 에너지 ≤ 35% · 폰 HPF 400 Hz 손실 ≤ 4 dB.
 * 크래시(strike.wav 50 ms 최대 RMS −6 dBFS)·굴림(−13 dBFS)보다 확실히 아래, BGM(0.08)보다 살짝 위.
 *
 * 이 클래스는 **BaseAudioContext만** 받는다 — OfflineAudioContext로 한 사이클을 렌더해 대역 에너지·단계별 RMS를 잴 수 있다(SOUND.md §7).
 * 모든 예약 소스는 레인별 voice에 등록되어 `done`(cut)에서 한 번에 끊긴다 — clatter·drive는 최대 1 s 앞까지 예약하므로, 등록 없이는
 * 투구가 먼저 시작돼 연출이 잘린 뒤에도 소리가 이어진다.
 */

/** 레인 하나의 출구 게인 + 거기 물린 예약 소스들. cut에서 게인을 램프해 끊고 소스를 멈춘다. startedAt은 바닥(bed)의 시동 시각. */
interface Voice {
  gain: GainNode;
  srcs: AudioScheduledSourceNode[];
  startedAt: number;
}

// ── 레벨 상수 — 위 목표를 오프라인 렌더로 맞춘 값(SOUND.md §2.5 실측표) ─────────────────────────
// ⚠️ 이 값들은 '진폭 배율'이고 RMS가 아니다. 필터를 거친 노이즈의 RMS는 게인보다 훨씬 작다(바닥 경로 실측: 게인 1.0에 −20 dBFS) —
// 값끼리 눈으로 비교하지 말고 오프라인 렌더로 잰다(SOUND.md §7). 첫 두 렌더는 정지 로직 버그(fadeOut 주석)로 바닥이 감쇠 중이어서
// 레벨을 두 번 잘못 잡았다 — 바닥 값을 바꾸면 반드시 startBed→stopBed(4.05 s) 렌더의 1~4 s 구간 RMS로 확인할 것.
const BED_VOL = 0.09; // 연속 바닥 — 정상 상태 RMS ≈ −41 dBFS(바닥만 −40.8)
const BED_MAX_S = 6; // 래틀 틱을 미리 예약하는 최대 길이(사이클 4.05 s + 여유)
const DRIVE_TABLE_VOL = 0.066; // 톤을 반으로 줄이며 4 dB 빠진 층 레벨을 2.5 dB만 되돌렸다(이전보다 살짝 뒤로)
const DRIVE_SWEEP_VOL = 0.06;
const DRIVE_TONE = 0.5; // 구동 톤(PeriodicWave) 배율 — 노이즈보다 작아야 한다(사용자 청취: 톤이 앞서면 신스)
const DRIVE_NOISE = 1.0; // 벨트 노이즈 배율
const CLACK_SWEEP_GUARD = 0.14; // 스윕 보드가 가드(데크 위)에 닿는다 — 가장 무겁다
const CLACK_SWEEP_END = 0.12; // 스윕 후단 정지
const CLACK_SWEEP_BACK = 0.1; // 스윕 가드 복귀
const CLACK_TABLE = 0.045; // 테이블 브레이크 스톱(가볍다) — 0.06에서 내림(피드백 ④: 정지음 7번의 박자가 도드라졌다)
const CLACK_HOME = 0.08; // 사이클 끝 — 테이블·스윕 귀환
const CLACK_RING_NORM = 3; // 판금 울림(노이즈 BPF Q3)의 대역폭 손실 보정 — 4에선 무거운 클랙 피크가 −13.4로 2.5 dB 올라서 3(§7.x 렌더, 목표 −15)
const TONG_VOL = 0.035; // 0.05 → 0.035 (피드백 ③ '밝다' — 그립 클릭도 한몫)
const PINSET_VOL = 0.18; // knock(240~360 Hz)은 같은 vol에서 삼각파보다 작게 나와(좁은 대역 + 짧은 감쇠) 0.11 → 0.18 — 실측 10핀 피크 ≈ −18 dBFS(옛 −19.5)
const CLATTER_VOL = 0.17; // 사이클에서 가장 큰 사건 — 스윕 구간이 바닥보다 3 dB 이상 튀어야 한다
/**
 * knock 보정. BPF Q7은 백색 노이즈를 f/7 Hz 대역만 통과시켜 RMS가 게인의 약 −30 dB(450 Hz에서 0.03)로 떨어진다 — 옛 삼각파 노크(진폭 = 게인)와
 * 같은 vol 척도를 유지하려고 안에서 곱한다. 이론값 7.6(450 Hz, 피크 ≈ 3.5×RMS 가정) → §7.x 렌더로 맞춘 값.
 */
const KNOCK_NORM = 7.5;
const KNOCK_BODY = 4; // 몸통(LPF 220 노이즈) 보정 — 노크 피크의 절반쯤

/**
 * 연속음 구성 비율(bed 게인 BED_VOL 기준). 테스트가 성분을 하나씩 켜 보려고 노출한다.
 * ⚠️ 값은 '진폭 배율'이지 RMS가 아니다 — 필터를 거친 노이즈의 RMS는 원 노이즈보다 훨씬 작아서(BPF 900 Q0.6: 약 −17 dB),
 * 같은 배율의 사인 험이 노이즈를 13 dB나 덮어버렸다(첫 렌더 실측: 120 Hz 아래 52%). 그래서 험은 노이즈보다 한 자릿수 작다.
 */
export interface BedMix {
  floor: number; // 벨트·롤러 바닥 노이즈(BPF 650, 11 Hz AM)
  hiss: number; // 벨트 히스(BPF 2.6 kHz)
  hum: number; // 120 Hz(+240) 전원 모터 험
  rattle: number; // 판금 틱 + 핀 노크
  rumble: number; // 저역 럼블(LPF 170 ×2, 7 Hz AM) — 무게. 청취 피드백 ②로 들어왔다(아래 RUMBLE_REL)
}
const BED_MIX: BedMix = { floor: 1, hiss: 0.25, hum: 0.05, rattle: 0.5, rumble: 1 };
/**
 * 럼블 게인(g 기준 배율). **청취 피드백 ②(2026-09-02 밤)**: 사용자가 옛 4층(48 Hz 톱니 드론 + 킥드럼)이 더 낫다고 했다.
 * 재보니 A-가중 음량은 같고(26.1 vs 27.3) 300 Hz~3 kHz도 같은데 **20~150 Hz가 21 dB** 차이(36.1 vs 14.8) — "더 크게"가 아니라
 * "더 무겁게"였다. 볼러는 18 m 뒤 마스킹 유닛 너머에서 듣고, 거리·장애물은 고역을 깎고 저역을 남긴다 — 클로즈 녹음 스펙트럼
 * (200 Hz~5 kHz)을 목표로 잡은 재설계가 그 자리의 무게를 잃었던 것. 옛 것의 '이상함'(48 Hz 톱니 험, 휘익 스윕)은 두고
 * '좋았던 것'(저역 몸통·쿵의 무게·움직임 감)만 되살린다: ① 이 럼블 ② clack의 저역 몸통 ③ drive 노이즈의 방향 스윕(±15%).
 * 필터 노이즈 RMS는 게인보다 훨씬 작다(LPF 170 두 번 뒤 약 −26 dB) — 값은 §7.x 렌더로 맞춘 것: 3.0에서 20~150 Hz 27.0(옛 36.1과
 * 첫 GS-X 14.8의 사이), 4.5에서 ≈30 — 옛 무게의 절반쯤(dB)을 되살리는 자리로 골랐다. 더 무겁게 원하면 이 값 하나.
 */
const RUMBLE_REL = 4.5;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const EPS = 0.0001;

/**
 * 게인을 **지금 값에서** tail 동안 EPS로 지운다. 지금 값은 읽지 않고 **계산한다** — 두 번 데였다:
 *  · `param.value`는 OfflineAudioContext에서 그래프를 미리 짜는 시점에 자동화 전 초깃값(1.0)을 돌려줘, 0.03으로 돌던 바닥이
 *    정지 순간 1.0으로 점프해 +30 dB 버스트가 났다(실측 피크 −1.7 dBFS · 정지 뒤 꼬리 −21 dBFS).
 *  · `cancelAndHoldAtTime(now)`는 취소할 미래 이벤트가 없으면(바닥은 시동 램프 하나뿐) 홀드를 안 넣어, 뒤에 붙인 지수 램프가
 *    **시동 램프 끝(0.25 s)에서부터** 내려갔다 — 정상 구간이 4 s 내내 감쇠 중이었다(실측: 험 진폭 0.02인데 RMS −60 dBFS).
 * 시동 램프는 EPS→level 지수 0.25 s로 우리가 예약한 것이니 그 곡선을 그대로 되짚으면 지금 값이 나온다.
 */
const BED_RAMP = 0.25;
function fadeOut(p: AudioParam, now: number, tail: number, level: number, startedAt: number) {
  const u = clamp((now - startedAt) / BED_RAMP, 0, 1);
  const cur = EPS * Math.pow(level / EPS, u);
  p.cancelScheduledValues(now);
  p.setValueAtTime(cur, now);
  p.exponentialRampToValueAtTime(EPS, now + tail);
}

export class MachineSynth {
  private readonly beds = new Map<string, Voice>();
  private readonly voices = new Map<string, Voice>();
  private readonly lastPhase = new Map<string, MachinePhase>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly noise: AudioBuffer,
  ) {}

  /** 1초 백색 노이즈 — 모든 층이 공유(루프). SoundManager는 자기 버퍼를 넘기고, 오프라인 렌더는 이걸로 만든다. */
  static makeNoise(ctx: BaseAudioContext): AudioBuffer {
    const len = ctx.sampleRate;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * 단계 큐 하나를 소리로 푼다. `now`는 큐가 도착한 ctx 시각, `out`은 그 레인의 출구(거리 감쇠는 호출자가).
   * `audible=false`(사운드 OFF)면 done의 정리만 하고 소리는 내지 않는다.
   */
  cue(cue: MachineCue, key: string, out: AudioNode, now: number, audible = true): void {
    if (cue.phase === 'done') {
      const cut = !!cue.cut;
      this.stopBed(key, cut, now);
      this.stopVoice(key, cut, now);
      this.lastPhase.delete(key);
      if (!cut && audible) this.clack(this.voice(key, out), now, CLACK_HOME, 0.4); // 테이블·스윕 귀환, 브레이크
      return;
    }
    if (!audible) return;
    const v = this.voice(key, out);
    const prev = this.lastPhase.get(key);
    this.lastPhase.set(key, cue.phase);
    const dur = Math.max(0.1, cue.dur);
    switch (cue.phase) {
      case 'guard':
        this.startBed(key, out, now);
        this.drive(v, now, dur, 'sweep', 'down', DRIVE_SWEEP_VOL);
        break;
      case 'grip':
        this.clack(v, now, CLACK_SWEEP_GUARD, 1); // 스윕 보드가 가드에 닿았다
        this.drive(v, now, dur, 'table', 'down', DRIVE_TABLE_VOL);
        this.tong(v, now + dur * 0.65, TONG_VOL); // 핀 홀더의 스포팅 텅이 선 핀을 집는다
        break;
      case 'lift':
        this.clack(v, now, CLACK_TABLE, 0.25); // 테이블 하단 브레이크
        this.drive(v, now, dur, 'table', 'up', DRIVE_TABLE_VOL);
        break;
      case 'sweep':
        // rack은 grip·lift를 건너뛰어 여기서 스윕 보드가 가드에 닿는다. respot이면 테이블 상단 스톱(가볍게).
        if (prev === 'guard') this.clack(v, now, CLACK_SWEEP_GUARD, 1);
        else this.clack(v, now, CLACK_TABLE, 0.2);
        this.drive(v, now, dur, 'sweep', 'fwd', DRIVE_SWEEP_VOL);
        this.clatter(v, now + dur * 0.3, cue.pins, dur * 0.55); // 데드우드가 피트로 쏟아진다
        break;
      case 'return':
        this.clack(v, now, CLACK_SWEEP_END, 0.7); // 스윕 후단 정지
        this.drive(v, now, dur, 'sweep', 'back', DRIVE_SWEEP_VOL);
        break;
      case 'set':
        this.clack(v, now, CLACK_SWEEP_BACK, 0.6); // 스윕 가드 복귀 — 곧 테이블이 내려온다
        this.drive(v, now, dur, 'table', 'down', DRIVE_TABLE_VOL);
        break;
      case 'raise':
        this.pinSet(v, now, cue.pins); // 핀이 스폿에 놓인다
        this.clack(v, now + 0.02, CLACK_TABLE, 0.2);
        this.drive(v, now + 0.08, Math.max(0.1, dur - 0.08), 'table', 'up', DRIVE_TABLE_VOL);
        break;
    }
  }

  /** 모든 레인의 소리를 즉시 끊는다(컨텍스트 정리용). */
  stopAll(now: number): void {
    for (const key of [...this.beds.keys()]) this.stopBed(key, true, now);
    for (const key of [...this.voices.keys()]) this.stopVoice(key, true, now);
    this.lastPhase.clear();
  }

  // ── voice 관리 ──────────────────────────────────────────────────────────────

  private voice(key: string, out: AudioNode): Voice {
    let v = this.voices.get(key);
    if (!v) {
      const gain = this.ctx.createGain();
      gain.gain.value = 1;
      gain.connect(out);
      v = { gain, srcs: [], startedAt: 0 };
      this.voices.set(key, v);
    }
    return v;
  }

  private stopVoice(key: string, cut: boolean, now: number) {
    const v = this.voices.get(key);
    if (!v) return;
    this.voices.delete(key);
    if (cut) {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setValueAtTime(1, now);
      v.gain.gain.linearRampToValueAtTime(0, now + 0.03);
      for (const s of v.srcs) s.stop(now + 0.06);
    }
    // 자연 종료면 예약된 게 남아 있어도 다 짧은 꼬리라 그대로 끝나게 둔다
  }

  /** 소스를 레인 voice에 등록하고 start/stop을 예약한다. stop이 start보다 앞이면 아무 소리도 안 난다(Web Audio 규약) — cut이 그걸 이용한다. */
  private play(v: Voice, src: AudioScheduledSourceNode, t0: number, t1: number) {
    v.srcs.push(src);
    src.start(t0);
    src.stop(t1);
  }

  // ── bed: 연속 바닥 (벨트·롤러 + 히스 + 미세 험 + 래틀) ──────────────────────

  /** mix는 테스트용 — 성분을 하나씩 켜서 레벨을 잰다. 게임은 기본값(BED_MIX). */
  startBed(key: string, out: AudioNode, now: number, mix: Partial<BedMix> = {}): void {
    if (this.beds.has(key)) return;
    const m = { ...BED_MIX, ...mix };
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, now);
    g.gain.exponentialRampToValueAtTime(BED_VOL, now + BED_RAMP); // 모터 시동
    g.connect(out);
    const v: Voice = { gain: g, srcs: [], startedAt: now };
    this.beds.set(key, v);
    const tEnd = now + BED_MAX_S;

    // 벨트·롤러 바닥 — 롤러 주기로 진폭이 흔들린다(11 Hz). 이게 없으면 그냥 필터 노이즈다.
    // BPF 하나(900 Hz Q0.6)만 쓰니 센트로이드가 2.4 kHz로 올라가 쉬익거렸다(백색 노이즈는 위쪽 대역이 Hz로 더 넓다) —
    // 중심을 650으로 내리고 뒤에 LPF 2.2 kHz를 걸어 마스킹 유닛 너머의 둔한 웅웅으로 만든다.
    if (m.floor > 0) {
      const n = ctx.createBufferSource();
      n.buffer = this.noise;
      n.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      bp.Q.value = 0.7;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2200;
      const am = ctx.createGain();
      am.gain.value = 0.7 * m.floor;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 11;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.3 * m.floor;
      lfo.connect(lfoG).connect(am.gain);
      n.connect(bp).connect(lp).connect(am).connect(g);
      this.play(v, n, now, tEnd);
      this.play(v, lfo, now, tEnd);
    }

    // 저역 럼블 — 18 m 뒤에서 기계실이 웅웅대는 무게(RUMBLE_REL 주석). 노이즈를 LPF 170 두 번(급한 롤오프)으로 깎고
    // 7 Hz로 천천히 흔든다(회전체). 톱니 드론(48 Hz)처럼 음정이 있지 않아서 '전기 소음'으로 안 읽힌다.
    if (m.rumble > 0) {
      const r = ctx.createBufferSource();
      r.buffer = this.noise;
      r.loop = true;
      const l1 = ctx.createBiquadFilter();
      l1.type = 'lowpass';
      l1.frequency.value = 170;
      l1.Q.value = 0.7;
      const l2 = ctx.createBiquadFilter();
      l2.type = 'lowpass';
      l2.frequency.value = 170;
      l2.Q.value = 0.7;
      const am = ctx.createGain();
      am.gain.value = 0.75 * RUMBLE_REL * m.rumble;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 7;
      const lfoG = ctx.createGain();
      lfoG.gain.value = 0.25 * RUMBLE_REL * m.rumble;
      lfo.connect(lfoG).connect(am.gain);
      r.connect(l1).connect(l2).connect(am).connect(g);
      this.play(v, r, now, tEnd);
      this.play(v, lfo, now, tEnd);
    }

    // 벨트 히스 — 밴드가 도는 '쉬-' 고역
    if (m.hiss > 0) {
      const h = ctx.createBufferSource();
      h.buffer = this.noise;
      h.loop = true;
      const hb = ctx.createBiquadFilter();
      hb.type = 'bandpass';
      hb.frequency.value = 2600;
      hb.Q.value = 1;
      const hg = ctx.createGain();
      hg.gain.value = m.hiss;
      h.connect(hb).connect(hg).connect(g);
      this.play(v, h, now, tEnd);
    }

    // 전원 모터 험 — 60 Hz 전원의 120 Hz(+240). 18 m 뒤 마스킹 유닛 너머라 아주 작게. 헤드폰에서 '몸통'만 준다.
    if (m.hum > 0) {
      for (const [f, a] of [
        [120, 1],
        [240, 0.3],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = a * m.hum;
        o.connect(og).connect(g);
        this.play(v, o, now, tEnd);
      }
    }

    // 래틀 — 기계 안 판금·체인 틱과 핀이 디스트리뷰터로 떨어지는 노크. 바닥보다 몇 dB 튀어야 '기계'로 읽힌다.
    if (m.rattle > 0) {
      let t = now + rnd(0.15, 0.4);
      while (t < tEnd) {
        const vol = rnd(0.9, 1.8) * m.rattle; // g(=BED_VOL) 기준 배율
        const tk = ctx.createBufferSource();
        tk.buffer = this.noise;
        const tb = ctx.createBiquadFilter();
        tb.type = 'bandpass';
        tb.frequency.value = rnd(900, 2000); // 1.5~3.5 kHz였다 — 피드백 ③ '밝다'
        tb.Q.value = 4;
        const tg = ctx.createGain();
        tg.gain.setValueAtTime(vol, t);
        tg.gain.exponentialRampToValueAtTime(EPS, t + 0.006);
        tk.connect(tb).connect(tg).connect(g);
        this.play(v, tk, t, t + 0.02);
        // 절반은 노크가 붙는다(핀이 벨트에 닿는다). 삼각파 600~900 Hz였다 — 음정이 서서 '통'이 됐다(피드백 ③).
        if (Math.random() < 0.3) this.knock(v, t, rnd(350, 600), vol * 0.4, 0.04, 0); // 0.5·0.6 → 0.3·0.4 (피드백 ④ — 성긴 '톡'도 박자에 보였다)
        t += rnd(0.25, 0.6);
      }
    }
  }

  stopBed(key: string, cut: boolean, now: number): void {
    const v = this.beds.get(key);
    if (!v) return;
    this.beds.delete(key);
    const tail = cut ? 0.05 : 0.5; // 잘리면 즉시, 자연 종료면 벨트가 관성으로 잦아든다
    fadeOut(v.gain.gain, now, tail, BED_VOL, v.startedAt);
    for (const s of v.srcs) s.stop(now + tail + 0.02);
  }

  // ── drive: 테이블·스윕 벨트 모터 부하음 ─────────────────────────────────────

  /**
   * 구동 톤의 파셜. 처음엔 톱니 2개(디튠)였는데 사용자 청취(2026-09-02 밤)에서 "신스 같다" — 톱니는 1/n 배음이 무한히 이어지고
   * 디튠 비트가 슈퍼소 냄새를 낸다. 실제 벨트·기어 와인은 배음이 몇 개뿐이고 세기가 고르지 않다. 6개에서 끝나는 불규칙 롤오프.
   * 실측(§7.x tonal): 톱니 → 하모닉 12개(−30 dB 이내)·톤 비율 0.8, 이 파셜 → 4~5개·0.3대.
   */
  private static readonly DRIVE_PARTIALS: Record<'table' | 'sweep', readonly number[]> = {
    table: [1, 0.55, 0.42, 0.2, 0.09, 0.04],
    sweep: [1, 0.6, 0.33, 0.24, 0.08, 0.05],
  };
  private readonly waves = new Map<string, PeriodicWave>();

  private motorWave(part: 'table' | 'sweep'): PeriodicWave {
    let w = this.waves.get(part);
    if (!w) {
      const amps = MachineSynth.DRIVE_PARTIALS[part];
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => (imag[i + 1] = a));
      w = this.ctx.createPeriodicWave(real, imag);
      this.waves.set(part, w);
    }
    return w;
  }

  /**
   * `part`가 기본 주파수·필터를 정하고(테이블이 더 무겁다), `dir`은 끝으로 갈수록의 미세 드리프트만 정한다 —
   * 실제 모터는 방향으로 음정이 뒤집히지 않는다(이전 설계의 650→480 하강 스윕이 '휘익'으로 들린 이유).
   * 신스 티를 빼는 세 가지: ① 파셜 6개 PeriodicWave(위) ② 완벽한 음정 대신 느린 워블(벨트 슬립·부하 변동, 2.7 Hz ±0.4% + 0.6 Hz ±0.3%)
   * + 13 Hz 롤러 AM ③ 톤(0.5)보다 벨트 노이즈(1.0)가 크다 — 와인은 노이즈 속에서 비쳐야 한다.
   */
  drive(v: Voice, t: number, dur: number, part: 'table' | 'sweep', dir: 'down' | 'up' | 'fwd' | 'back', vol: number): void {
    const ctx = this.ctx;
    const f0 = part === 'table' ? 176 : 236;
    const fc = part === 'table' ? 620 : 780;
    const drift = dir === 'down' || dir === 'back' ? 0.98 : 1.02;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.08);
    g.gain.setValueAtTime(vol, t + Math.max(0.08, dur - 0.12));
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    g.connect(v.gain);
    // 톤 — PeriodicWave → BPF → 롤러 AM → g
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = fc;
    bp.Q.value = 1.2;
    const am = ctx.createGain();
    am.gain.value = DRIVE_TONE * 0.85;
    const roller = ctx.createOscillator();
    roller.type = 'sine';
    roller.frequency.value = 13;
    const rollerG = ctx.createGain();
    rollerG.gain.value = DRIVE_TONE * 0.15;
    roller.connect(rollerG).connect(am.gain);
    this.play(v, roller, t, t + dur + 0.05);
    bp.connect(am).connect(g);
    const o = ctx.createOscillator();
    o.setPeriodicWave(this.motorWave(part));
    o.frequency.setValueAtTime(f0 * 0.93, t); // 스핀업
    o.frequency.exponentialRampToValueAtTime(f0, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(f0 * drift, t + dur);
    for (const [fr, depth] of [
      [2.7, 0.004],
      [0.6, 0.003],
    ] as const) {
      const l = ctx.createOscillator(); // 워블
      l.type = 'sine';
      l.frequency.value = fr;
      const lg = ctx.createGain();
      lg.gain.value = f0 * depth;
      l.connect(lg).connect(o.frequency);
      this.play(v, l, t, t + dur + 0.05);
    }
    o.connect(bp);
    this.play(v, o, t, t + dur + 0.05);
    // 벨트 'shhh' — 톤보다 크다. 중심 1.0 kHz(1.3에선 톤을 줄인 뒤 전체가 쉬익 쪽으로 기울었다 — 센트로이드 2.0 kHz)
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const nb = ctx.createBiquadFilter();
    nb.type = 'bandpass';
    nb.Q.value = 1.0;
    // 방향 스윕 ±15% — 옛 설계의 650→480 '휘익'(Q1.4·큰 폭)이 준 **움직임 감**만 아주 옅게 되살린다(청취 피드백 ②).
    // 내려가는 부품은 내려가는 바람, 올라가는 부품은 올라가는 바람. 톤(PeriodicWave)은 그대로 — 음정이 뒤집히면 다시 신스가 된다.
    const down = dir === 'down' || dir === 'back';
    nb.frequency.setValueAtTime(1000 * (down ? 1.15 : 0.85), t);
    nb.frequency.linearRampToValueAtTime(1000 * (down ? 0.85 : 1.15), t + dur);
    const ng = ctx.createGain();
    ng.gain.value = DRIVE_NOISE;
    n.connect(nb).connect(ng).connect(g);
    this.play(v, n, t, t + dur + 0.05);
  }

  // ── clack: 끝 정지 + 브레이크 ───────────────────────────────────────────────

  /** weight 0(가벼운 테이블 스톱)~1(스윕 보드가 데크를 침). 저역 몸통은 weight 비례 — 0이면 순수 중역 클랙. */
  clack(v: Voice, t: number, vol: number, weight: number): void {
    const ctx = this.ctx;
    const w = clamp(weight, 0, 1);
    // 타격 노이즈
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 - 300 * w;
    bp.Q.value = 0.9;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol, t);
    ng.gain.exponentialRampToValueAtTime(EPS, t + 0.014 + 0.02 * w);
    n.connect(bp).connect(ng).connect(v.gain);
    this.play(v, n, t, t + 0.06);
    // 판금 울림 — 노이즈 공진(900 Hz Q3 + 1.7 kHz Q3 ×0.5), 60~130 ms 감쇠. 삼각파 파셜(520·1380 Hz)이었다 → 피드백 ④ "아직도 통.통.통":
    // 단계 정지마다(사이클에 7번, 약 0.5 s 간격) 음정이 선 520 Hz 톤이 +20~25 dB로 울려 그게 '통.통.통'이었다(§7.x 톤 사건 스캔 —
    // 0.54 · 1.14 · 1.62 · 2.55 · 3.0 · 3.54 · 4.05 s). 공진 노이즈는 금속 질감만 남기고 음정은 세우지 않는다 — knock과 같은 원리.
    {
      const rn = ctx.createBufferSource();
      rn.buffer = this.noise;
      rn.loop = true;
      const rg = ctx.createGain();
      rg.gain.setValueAtTime(EPS, t);
      rg.gain.exponentialRampToValueAtTime(vol * CLACK_RING_NORM, t + 0.003);
      rg.gain.exponentialRampToValueAtTime(EPS, t + 0.06 + 0.07 * w);
      rg.connect(v.gain);
      for (const [rf, mg] of [
        [900, 1],
        [1700, 0.5],
      ] as const) {
        const rb = ctx.createBiquadFilter();
        rb.type = 'bandpass';
        rb.frequency.value = rf * rnd(0.95, 1.05);
        rb.Q.value = 3;
        const mgn = ctx.createGain();
        mgn.gain.value = mg;
        rn.connect(rb).connect(mgn).connect(rg);
      }
      this.play(v, rn, t, t + 0.2);
    }
    // 몸통 — 판·프레임이 데크를 치는 저역 '쿵'. weight 비례. 첫 GS-X 버전은 150→110 Hz · vol×0.35 · 70 ms로 아주 작았는데
    // 청취 피드백 ②("옛 게 더 낫다")의 절반이 이 무게였다 — 옛 clunk(80→55 Hz 사인 + LPF 240 노이즈, 킥드럼)의 무게를 되살리되
    // 100 Hz 위(130→75)에 두고 노이즈를 섞어 드럼이 아니라 **판이 울리게** 한다. 위 금속 울림·타격 노이즈가 있어 킥드럼으로 안 읽힌다.
    if (w > 0.05) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(130, t);
      o.frequency.exponentialRampToValueAtTime(75, t + 0.12);
      const og = ctx.createGain();
      og.gain.setValueAtTime(EPS, t);
      og.gain.exponentialRampToValueAtTime(vol * 0.9 * w, t + 0.005);
      og.gain.exponentialRampToValueAtTime(EPS, t + 0.16);
      o.connect(og).connect(v.gain);
      this.play(v, o, t, t + 0.19);
      const bn = ctx.createBufferSource();
      bn.buffer = this.noise;
      const bl = ctx.createBiquadFilter();
      bl.type = 'lowpass';
      bl.frequency.value = 220;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(vol * 0.7 * w, t);
      bg.gain.exponentialRampToValueAtTime(EPS, t + 0.1);
      bn.connect(bl).connect(bg).connect(v.gain);
      this.play(v, bn, t, t + 0.13);
    }
  }

  // ── tong: 스포팅 텅 솔레노이드 ──────────────────────────────────────────────

  tong(v: Voice, t: number, vol: number): void {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.005);
    n.connect(hp).connect(g).connect(v.gain);
    this.play(v, n, t, t + 0.02);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2400;
    const og = ctx.createGain();
    og.gain.setValueAtTime(EPS, t);
    og.gain.exponentialRampToValueAtTime(vol * 0.4, t + 0.002);
    og.gain.exponentialRampToValueAtTime(EPS, t + 0.02);
    o.connect(og).connect(v.gain);
    this.play(v, o, t, t + 0.03);
  }

  // ── knock: 나무 노크 원자 (pinSet · clatter · bed 래틀이 공유) ─────────────────

  /**
   * 핀이 핀·데크·피트에 닿는 소리의 공통 원자 (청취 피드백 ③ 2026-09-03 "핀 리셋할 때 통통통통, 밝아").
   * 이전엔 삼각파(핀 놓기 560→430 Hz · 클래터 480~1100 Hz, 피치 드롭)로 만들어 **음정이 선 실로폰 '통'**이 됐다 — 핀 놓기 층의
   * 톤 피크 에너지가 78%였다(§7.x peaky). 노이즈 버스트로 공진 필터(BPF Q7)를 때리면 '음정이 있는 듯 없는' 감쇠 공진이 돼
   * 목재 타격으로 읽힌다. LPF 1.6 kHz로 밝기를 자르고(옛 노크는 900~2400 Hz + 2.2 kHz 클릭) 짧은 저역 몸통(LPF 220)이 무게를 준다.
   * f = 공진 중심(Hz), dec = 감쇠(s), vol = 옛 척도의 진폭 배율(KNOCK_NORM으로 보정), body = 몸통 비율(0이면 없음).
   */
  knock(v: Voice, t: number, f: number, vol: number, dec: number, body = 0.7): void {
    const ctx = this.ctx;
    // 두 모드(f · 1.7f) — 단일 공진 Q7은 '핑' 하나로 음정이 또렷해서(§7.x peaky 70%) 실로폰 티가 남았다. Q4로 넓히고 위에 약한
    // 둘째 모드를 얹으면 몸통이 있는 목재 타격에 가까워진다(핀은 나무 통이라 모드가 여럿이다). LPF 1.3 kHz로 밝기를 자른다.
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol * KNOCK_NORM, t + 0.002);
    g.gain.exponentialRampToValueAtTime(EPS, t + dec);
    lp.connect(g).connect(v.gain);
    for (const [mf, mg] of [
      [f, 1],
      [f * 1.7, 0.35],
    ] as const) {
      const res = ctx.createBiquadFilter();
      res.type = 'bandpass';
      res.frequency.value = mf;
      res.Q.value = 4;
      const rg = ctx.createGain();
      rg.gain.value = mg;
      n.connect(res).connect(rg).connect(lp);
    }
    this.play(v, n, t, t + dec + 0.02);
    if (body > 0) {
      const b = ctx.createBufferSource();
      b.buffer = this.noise;
      const bl = ctx.createBiquadFilter();
      bl.type = 'lowpass';
      bl.frequency.value = 220;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(EPS, t);
      bg.gain.exponentialRampToValueAtTime(vol * body * KNOCK_BODY, t + 0.002);
      bg.gain.exponentialRampToValueAtTime(EPS, t + 0.045);
      b.connect(bl).connect(bg).connect(v.gain);
      this.play(v, b, t, t + 0.07);
    }
  }

  // ── pinSet: 핀이 스폿에 놓이는 '탁' × n ─────────────────────────────────────

  /** 핀 바닥이 데크를 친다 — 낮은 공진(280~420 Hz), 160 ms 안에 흩어서. 같은 소리 n번은 기계총이 되니 피치·세기·시각을 흔든다. */
  pinSet(v: Voice, t0: number, n: number): void {
    const count = clamp(Math.round(n), 0, 10);
    for (let i = 0; i < count; i++) {
      const t = t0 + (i / Math.max(1, count - 1)) * 0.16 + rnd(0, 0.014);
      this.knock(v, t, rnd(240, 360), PINSET_VOL * rnd(0.8, 1.15), rnd(0.045, 0.065));
    }
  }

  // ── clatter: 데드우드가 피트로 쏟아진다 ─────────────────────────────────────

  /**
   * n = 쓸려 나가는 핀 수. 노크는 앞쪽에 몰리되(스윕이 앞줄 핀을 먼저 떨어뜨린다) 35 ms 이상 벌린다 — 겹치면 한 번의 큰 소리가 되고
   * 너무 촘촘하면 '드르륵'이 된다. 옛 13개 × 1.4는 너무 많았다(피드백 ③ '통통통통') — 핀 수만큼, 최대 9.
   */
  clatter(v: Voice, t0: number, n: number, span: number): void {
    const count = clamp(Math.round(n), 0, 10);
    if (count === 0) return;
    const knocks = clamp(count, 1, 9);
    const scale = 0.75 + 0.25 * (count / 10);
    const times: number[] = [];
    for (let k = 0; k < knocks; k++) times.push(t0 + Math.pow(Math.random(), 0.75) * span);
    times.sort((a, b) => a - b);
    for (let k = 1; k < times.length; k++) if (times[k] - times[k - 1] < 0.035) times[k] = times[k - 1] + 0.035;
    for (const t of times) this.knock(v, t, rnd(260, 520), CLATTER_VOL * rnd(0.7, 1.25) * scale, rnd(0.05, 0.09), 0.8);
  }
}
