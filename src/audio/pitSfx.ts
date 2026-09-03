/**
 * 피트 사운드 — 공이 핀덱 뒤로 떨어진 뒤의 사건 사슬 (2026-09-03, SOUND.md §2.10·§2.11).
 *
 * 왜 다시 만들었나(청취 피드백 ⑤ "공 낙하음이 좀 밋밋한 거 같은데"): 첫 버전은 사인 70→45 Hz + 저역 노이즈 한 방(0.1 s, 150 Hz 아래 87~95%)
 * 이었다. 실제 GS-X 피트(Brunswick GS 액셀러레이터 매뉴얼·부품표)에서 공은 **볼 쿠션**(고무 페이싱 합판 보드 + 피벗 프레임 + 유압 쇽업소버,
 * 하단 임팩트 스트립 4개)을 치고, 움직이는 **트랜스포트 밴드**(고무 벨트)에 밀려 스프링 암 **볼 도어**를 열고, 1/2 HP 플랫 벨트
 * **액셀러레이터**가 물어 리턴 트랙(서브웨이)으로 쏘아 올려 볼 리프트를 거쳐 랙에 도착한다. 실녹음(Freesound #144062, CC0 6 s)은
 * 6 s 동안 사건 6개, 전부 중역 중심(로그 센트로이드 600~725 Hz, 300 Hz 아래 30%대), 200~300 ms 길이였다. '밋밋'의 정체는
 * **서브 사인 한 방 + 후속 사건 없음**이다. 그래서 둘로 나눈다:
 *
 *   schedulePitDrop    쿠션 타격 — whump(공 질량, LPF 140) + 보드 3모드 공진(150·240·380 Hz, 220 ms) + 고무 슬랩(1.8 kHz 12 ms)
 *                      + 0.3 s 뒤 프레임 클렁크(쿠션 프레임이 쇽업소버로 돌아와 스톱에 닿는다). 전부 마스킹 유닛 너머 → LPF 3 kHz.
 *   scheduleBallReturn 볼 리턴 사슬 — 볼 도어 클랙(+1.0 s) → 액셀러레이터 스핀업 + 발사 'whoomp'(+1.1~1.9 s) → 서브웨이 럼블(+2.0~4.3 s,
 *                      볼러 쪽으로 **다가온다**: 레벨↑·LPF 열림) → 랙 도착 클랙 ×2(+4.4 s, 볼러 옆이라 필터 없음). 화면에 리턴 레일은 없다 —
 *                      오프스크린 소리로 '기다리는 시간'(POST_BALL_HOLD·핀세터 사이클)을 채운다. 백로그 §5 B '공 리턴'이 이걸로 닫힌다.
 *
 * 타격음에 오실레이터 톤을 두지 않는다(피드백 ③·④ 규칙) — 전부 노이즈 공진이다. BaseAudioContext만 쓰므로 OfflineAudioContext로 렌더해 잰다(§7.x).
 * 레벨(리미터 앞)은 §2.10·§2.11 실측표. 출구는 SoundManager가 machineBus를 넘긴다 — 일시정지(메뉴)에 함께 뮤트되게.
 */
import { EPS, rnd, clamp, burst } from './synthKit'; // 공용 원자 — uiSfx.ts와 나눠 쓴다

// ── 레벨 상수(진폭 배율, 리미터 앞). 필터 노이즈 RMS는 게인보다 훨씬 작다 — 값은 §7.x 렌더로 맞춘 것 ─────────────
const CUSHION_WHUMP = 0.3;
const CUSHION_BOARD = 4.0; // 3모드 합. BPF Q4 150 Hz는 대역 37 Hz라 RMS가 게인의 −33 dB. 5.0에선 피크 −6~−9 dBFS로 튀어 4.0(목표 −10)
const CUSHION_SLAP = 0.14;
const FRAME_CLUNK = 0.85; // 0.55에선 타격보다 14 dB 아래(−22)라 안 들렸다 — 목표 −8 dB(≈ −17)
const DOOR_CLACK = 0.45;
const ACCEL_WHIR = 0.11;
const LAUNCH_WHOOMP = 0.35;
const SUBWAY_RUMBLE = 0.4; // 0.22는 50 ms RMS −38(기계 바닥 −33 아래)이라 묻혔다 — 도착 직전 ≈ −31
const RACK_CLACK = 0.9; // 볼러 옆 1~2 m — 0.5(−22)는 멀었다. 목표 −16

/**
 * 쿠션 타격. t0 = 공이 피트 바닥/쿠션에 닿는 ctx 시각, speed = 그 순간 속력(m/s, 세기 0.7 + 0.3·clamp(v/6)).
 * @returns 프레임 클렁크 시각(ctx 초) — 리턴 사슬이 그 뒤에 이어진다.
 */
export function schedulePitDrop(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, speed: number): number {
  const k = 0.7 + 0.3 * clamp(speed / 6, 0, 1);
  // 피트는 마스킹 유닛 너머 0.85 m 아래 — 고역이 깎여 온다
  const far = ctx.createBiquadFilter();
  far.type = 'lowpass';
  far.frequency.value = 3000;
  far.connect(out);

  // whump — 공 질량이 보드를 미는 저역. 사인이 아니라 LPF 노이즈(음정 금지 규칙).
  burst(ctx, far, noise, t0, { type: 'lowpass', f: 140 }, CUSHION_WHUMP * k, 0.003, 0.09);

  // 보드 3모드 — 고무 페이싱 합판이 운다. 모드가 여럿이어야 '판'이고, 하나면 '핑'이다(knock의 교훈).
  {
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t0);
    g.gain.exponentialRampToValueAtTime(CUSHION_BOARD * k, t0 + 0.003);
    g.gain.exponentialRampToValueAtTime(EPS, t0 + 0.22);
    g.connect(far);
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    for (const [f, q, mg] of [
      [150, 4, 1],
      [240, 4, 0.8],
      [380, 5, 0.5],
    ] as const) {
      const bq = ctx.createBiquadFilter();
      bq.type = 'bandpass';
      bq.frequency.value = f * rnd(0.97, 1.03);
      bq.Q.value = q;
      const m = ctx.createGain();
      m.gain.value = mg;
      n.connect(bq).connect(m).connect(g);
    }
    n.start(t0);
    n.stop(t0 + 0.26);
  }

  // 슬랩 — 고무 페이싱에 공이 닿는 순간의 짧은 고역
  burst(ctx, far, noise, t0, { type: 'bandpass', f: 1800, q: 1 }, CUSHION_SLAP * k, 0.001, 0.012);

  // 프레임 클렁크 — 쿠션 프레임이 쇽업소버로 돌아와 스톱에 닿는다(GS 부품표 'Ball Cushion Stop'). 0.28~0.34 s 뒤, 타격보다 −8 dB쯤.
  const tc = t0 + rnd(0.28, 0.34);
  burst(ctx, far, noise, tc, { type: 'bandpass', f: 700, q: 2 }, FRAME_CLUNK * k, 0.002, 0.05);
  burst(ctx, far, noise, tc, { type: 'lowpass', f: 200 }, 0.12 * k, 0.002, 0.06);
  return tc;
}

/**
 * 볼 리턴 사슬. t0 = 쿠션 타격 시각. 실제 소요(피트 → 랙)는 4~7 s — 18 m 레인에 4.4 s를 잡았다.
 * @returns 전체 길이(초, 랙 클랙 끝까지)
 */
export function scheduleBallReturn(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number): number {
  // 피트·액셀러레이터·서브웨이는 마스킹 유닛 뒤·레인 아래 — LPF 2.2 kHz. 랙 도착만 볼러 옆이라 out으로 직접.
  const far = ctx.createBiquadFilter();
  far.type = 'lowpass';
  far.frequency.value = 2200;
  far.connect(out);

  // 1) 볼 도어 — 스프링 암 도어가 열리고 닫힌다(+1.0 s). 중역 노크 + 작은 몸통.
  const tDoor = t0 + rnd(0.95, 1.1);
  burst(ctx, far, noise, tDoor, { type: 'bandpass', f: 900, q: 2 }, DOOR_CLACK, 0.002, 0.045);
  burst(ctx, far, noise, tDoor, { type: 'lowpass', f: 300 }, 0.1, 0.002, 0.05);

  // 2) 액셀러레이터 — 플랫 벨트 모터가 물며 스핀업(노이즈 BPF 500→1100 Hz, 0.7 s 커진다) → 발사 'whoomp'
  const tAcc = tDoor + 0.12;
  const tLaunch = tAcc + 0.75;
  {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(500, tAcc);
    bp.frequency.exponentialRampToValueAtTime(1100, tLaunch);
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, tAcc);
    g.gain.exponentialRampToValueAtTime(ACCEL_WHIR * 0.5, tAcc + 0.1);
    g.gain.exponentialRampToValueAtTime(ACCEL_WHIR, tLaunch);
    g.gain.exponentialRampToValueAtTime(EPS, tLaunch + 0.25); // 공이 나가면 벨트가 헛돌며 잦아든다
    n.connect(bp).connect(g).connect(far);
    n.start(tAcc);
    n.stop(tLaunch + 0.3);
  }
  burst(ctx, far, noise, tLaunch, { type: 'lowpass', f: 250 }, LAUNCH_WHOOMP, 0.004, 0.07);
  burst(ctx, far, noise, tLaunch, { type: 'bandpass', f: 400, q: 2 }, 1.2, 0.003, 0.05);

  // 3) 서브웨이 럼블 — 공이 레인 아래 트랙으로 볼러 쪽에 **다가온다**: 레벨이 오르고 LPF가 열린다. 6 Hz AM = 트랙 이음새.
  const tSub = tLaunch + 0.1;
  const tArrive = tSub + 2.3;
  {
    const n = ctx.createBufferSource();
    n.buffer = noise;
    n.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(150, tSub);
    lp.frequency.exponentialRampToValueAtTime(420, tArrive);
    const am = ctx.createGain();
    am.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 6;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.25;
    lfo.connect(lfoG).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, tSub);
    g.gain.exponentialRampToValueAtTime(SUBWAY_RUMBLE * 0.45, tSub + 0.2);
    g.gain.exponentialRampToValueAtTime(SUBWAY_RUMBLE, tArrive - 0.05);
    g.gain.exponentialRampToValueAtTime(EPS, tArrive + 0.08);
    n.connect(lp).connect(am).connect(g).connect(out); // 다가오는 소리라 far 필터를 안 거친다 — LPF 자체가 거리다
    n.start(tSub);
    lfo.start(tSub);
    n.stop(tArrive + 0.12);
    lfo.stop(tArrive + 0.12);
  }

  // 4) 랙 도착 — 볼 리프트 끝에서 공이 기다리는 공을 친다. 우레탄·페놀 공끼리의 '클랙' ×2(둘째는 80 ms 뒤, 작게). 볼러 옆이라 필터 없음.
  for (const [dt, s] of [
    [0, 1],
    [0.08, 0.65],
  ] as const) {
    const t = tArrive + dt;
    burst(ctx, out, noise, t, { type: 'bandpass', f: 1200 * rnd(0.95, 1.05), q: 3 }, RACK_CLACK * s, 0.001, 0.012);
    burst(ctx, out, noise, t, { type: 'bandpass', f: 480 * rnd(0.95, 1.05), q: 3 }, RACK_CLACK * 0.7 * s, 0.002, 0.035);
    burst(ctx, out, noise, t, { type: 'lowpass', f: 220 }, 0.08 * s, 0.002, 0.04);
  }
  return tArrive + 0.2 - t0;
}
