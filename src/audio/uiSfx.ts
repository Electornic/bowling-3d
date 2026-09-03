/**
 * UI 효과음 + 리플레이 큐 — 합성, BaseAudioContext만 받는다(OfflineAudioContext 렌더로 잰다, SOUND.md §7.x). 2026-09-03, SOUND.md §2.12·§2.13.
 *
 * 어휘는 **스코어러 콘솔의 물리 스위치**다 — 미드센추리 하우스의 레인 옆 콘솔은 릴레이·토글·노브로 되어 있고, 그 소리는 전부 짧은 노이즈
 * 공진이다. 이 게임의 다른 합성음과 자리가 갈린다: PA 차임은 천장 스피커(paOut 필터), 기계음은 18 m 앞 핀덱 너머(laneOut 감쇠), 이건 **손 앞**이라
 * 필터 없이 드라이하다. 삑·삐 같은 오실레이터 톤은 두지 않는다(청취 피드백 ③·④ 규칙 — 톤은 '신스 티'다). 위계(§8.1 4단):
 *
 *   배경  hover   버튼 위로 마우스가 들어올 때(마우스만 — 터치엔 호버가 없다)          아주 작게 (피크 ≈ −36 dBFS)
 *   보조  open    패널 등장(juicePanelIn .26 s에 맞춘 0.2 s 슉 — 종이가 미끄러지는 소리)   −28~−30
 *         close   패널 닫힘(반대 방향 0.16 s)
 *         detent  노브 노치 — 스핀 스텝(휠·바 드래그)·볼 무게 슬라이더. x = 위치 0..1 → 밝기   −24
 *         charge  래칫 폴 — 파워 게이지 칸마다. x = 파워 0..1 → 700→1800 Hz. 오를수록 밝고 내려오면 어두워져 **핑퐁 방향이 들린다**   −26
 *   주요  click   버튼 누름 — 접점 클릭 + 버튼 몸통 공진 + 낮은 판 (스위치 '톡')             −20
 *         equip   볼 장착 — 랙에서 공을 집어 옆 공에 '클랙'(pitSfx 랙 도착과 같은 어휘, 손 안이라 필터 없음)   −18
 *
 * 조준 이동엔 소리를 넣지 않는다 — §8.1 "빠르게 반복되는 조작에는 소리를 넣지 않는다". 마우스 조준은 hover로 매 프레임 바뀌는 연속값이라
 * 어떤 양자화든 틱의 흐름이 되고, 터치는 조준 드래그가 차징과 동시라 래칫과 겹친다.
 *
 * 리플레이 큐(scheduleReplayCue)는 UI가 아니라 연출 전환이다 — 리플레이는 이 게임에서 유일하게 홀 밖으로 나가는 장치(카메라 컷·0.9배·프리즈)라
 * 같은 비(非)다이제틱 층의 짧은 슉을 준다. 'in' 상승 0.3 s · 'out' 하강 0.24 s, 피크 −24 dBFS. 스틸컷 차임이 기각된 이유(게임 징글로 들림)를
 * 피해 음정 없는 공기 소리로만 한다.
 */
import { rnd, clamp, burst, sweep } from './synthKit';

export type UiSfx = 'click' | 'hover' | 'open' | 'close' | 'detent' | 'charge' | 'equip';

// ── 레벨 상수(진폭 배율, 리미터 앞) — §7.x 렌더 실측으로 맞춘 값(§2.12 표). 좁은 BPF는 게인이 커 보여도 RMS는 −20~−30 dB 아래다 ─────────
const CLICK_CONTACT = 0.18;
const CLICK_BODY = 1.1;
const CLICK_LOW = 0.27;
const HOVER = 0.25; // 0.14는 피크 −36.5 — BGM 메뉴 RMS(−22.6) 아래 14 dB라 안 들렸다. ≈ −31로
const OPEN = 0.3;
const CLOSE = 0.25;
const DETENT = 0.55;
const DETENT_EDGE = 0.045;
const CHARGE = 0.63; // 700 Hz 기준 — 위로 갈수록 (700/f)^0.75로 줄인다(BPF 노이즈의 RMS는 √대역폭 ∝ √f, 피크는 그보다 더 f에 붙어 렌더로 0.75를 잡았다). 실측 피크 −26(x=0) → −24(x=1) — 위가 살짝 큰 건 '팽팽해진다'로 남겼다
const CHARGE_LOW = 0.05;
const EQUIP = 1.4;
const REPLAY_IN = 0.2;
const REPLAY_OUT = 0.19;

/** UI 효과음 1회. t0 = ctx 시각, x = 종류별 보조값(charge: 파워 0..1 · detent: 위치 0..1). */
export function scheduleUi(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, kind: UiSfx, x = 0): void {
  switch (kind) {
    case 'click':
      // 스위치 '톡' — 접점 클릭(HPF 2.5k 3 ms) → 2 ms 뒤 버튼 몸통 공진(BPF 1.1k Q3 18 ms) + 낮은 판(LPF 300 20 ms)
      burst(ctx, out, noise, t0, { type: 'highpass', f: 2500 }, CLICK_CONTACT, 0.001, 0.003);
      burst(ctx, out, noise, t0 + 0.002, { type: 'bandpass', f: 1100 * rnd(0.96, 1.04), q: 3 }, CLICK_BODY, 0.001, 0.018);
      burst(ctx, out, noise, t0 + 0.002, { type: 'lowpass', f: 300 }, CLICK_LOW, 0.002, 0.02);
      return;
    case 'hover':
      burst(ctx, out, noise, t0, { type: 'bandpass', f: 1400 * rnd(0.97, 1.03), q: 4 }, HOVER, 0.001, 0.012);
      return;
    case 'open':
      sweep(ctx, out, noise, t0, 0.2, 500, 2200, 1.5, OPEN, 0.45);
      return;
    case 'close':
      sweep(ctx, out, noise, t0, 0.16, 2000, 500, 1.5, CLOSE, 0.35);
      return;
    case 'detent': {
      // 노브 노치 — 8 ms 공진 틱 + 2 ms 모서리. 위치가 바깥일수록 살짝 밝다(1.5 → 2.0 kHz)
      const f = 1500 + 500 * clamp(x, 0, 1);
      burst(ctx, out, noise, t0, { type: 'bandpass', f: f * rnd(0.98, 1.02), q: 4 }, DETENT * Math.pow(1500 / f, 0.75), 0.001, 0.01); // 밝아져도 크기는 같게(charge와 같은 보정)
      burst(ctx, out, noise, t0, { type: 'highpass', f: 3000 }, DETENT_EDGE, 0.0005, 0.002);
      return;
    }
    case 'charge': {
      // 래칫 폴 — 파워에 지수 매핑(귀는 로그다): 0 → 700 Hz, 1 → 1800 Hz. 낮은 몸통이 '기계'를 준다
      const f = 700 * Math.pow(1800 / 700, clamp(x, 0, 1));
      burst(ctx, out, noise, t0, { type: 'bandpass', f: f * rnd(0.98, 1.02), q: 3 }, CHARGE * Math.pow(700 / f, 0.75), 0.001, 0.01);
      burst(ctx, out, noise, t0, { type: 'lowpass', f: 400 }, CHARGE_LOW, 0.001, 0.008);
      return;
    }
    case 'equip':
      burst(ctx, out, noise, t0, { type: 'bandpass', f: 1200 * rnd(0.95, 1.05), q: 3 }, EQUIP, 0.001, 0.012);
      burst(ctx, out, noise, t0, { type: 'bandpass', f: 480 * rnd(0.95, 1.05), q: 3 }, EQUIP * 0.7, 0.002, 0.035);
      burst(ctx, out, noise, t0, { type: 'lowpass', f: 220 }, 0.05, 0.002, 0.04);
      return;
  }
}

/**
 * 리플레이 진입('in' — 첫 재생 프레임) / 복귀('out' — finish, 스킵 포함) 슉. 반환 = 길이(초).
 * 진입은 낮은 데서 열리며 올라가고(300 → 3 kHz, 0.3 s), 복귀는 반대로 닫힌다(0.24 s). 둘 다 BPF Q1 — 대역이 넓어 '공기'로 들린다.
 */
export function scheduleReplayCue(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, dir: 'in' | 'out'): number {
  if (dir === 'in') {
    sweep(ctx, out, noise, t0, 0.3, 300, 3000, 1, REPLAY_IN, 0.55);
    return 0.3;
  }
  sweep(ctx, out, noise, t0, 0.24, 2600, 300, 1, REPLAY_OUT, 0.35);
  return 0.24;
}
