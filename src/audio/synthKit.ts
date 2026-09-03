/**
 * 합성 공용 원자 — pitSfx.ts · uiSfx.ts가 나눠 쓴다(machineSynth.ts는 자기 Voice 수명 관리가 있어 별도).
 * BaseAudioContext만 받으므로 OfflineAudioContext로 그대로 렌더된다(SOUND.md §7.x — 합성 파라미터는 눈으로 A/B 하지 않고 렌더로 잰다).
 *
 * 규칙(청취 피드백 ③·④, 2026-09-03): **타격음에 오실레이터 톤을 두지 않는다.** 노이즈 버스트로 필터를 때린 감쇠 공진이 목재·금속 타격으로
 * 읽히고, 삼각파·사인은 '실로폰 통'이 된다. 여기 있는 건 전부 노이즈 기반이다.
 */
export const EPS = 0.0001;
export const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

/** 1초 백색 노이즈 버퍼(루프용). SoundManager는 자기 것을 캐시해 넘기고, 오프라인 렌더는 이걸로 만든다. */
export function makeNoise(ctx: BaseAudioContext): AudioBuffer {
  const len = ctx.sampleRate;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * 노이즈 버스트 → 필터 → 게인 엔벨로프(어택 → 지수 감쇠). 반환 없음.
 * ⚠️ 필터 노이즈의 RMS는 게인보다 훨씬 작다 — BPF Q4는 대역이 f/4 Hz라 백색 노이즈의 그 비율만 통과한다(150 Hz Q4 → −33 dB).
 * 그래서 좁은 대역 소리의 gain 값은 1을 훌쩍 넘기도 한다. 값은 렌더 실측으로 맞춘다.
 */
export function burst(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  filter: { type: BiquadFilterType; f: number; q?: number },
  gain: number,
  attack: number,
  decay: number,
): void {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  n.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = filter.type;
  bq.frequency.value = filter.f;
  if (filter.q !== undefined) bq.Q.value = filter.q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(EPS, t + decay);
  n.connect(bq).connect(g).connect(out);
  n.start(t);
  n.stop(t + decay + 0.03);
}

/**
 * 필터 중심이 f0 → f1로 미끄러지는 노이즈 '스윕'(슉). 게인은 어택 뒤 peakAt까지 올라 끝에서 꺼진다 — 스윕은 버스트와 달리
 * 중간이 제일 크다(패널이 지나가는 소리). 반환 없음.
 */
export function sweep(
  ctx: BaseAudioContext,
  out: AudioNode,
  noise: AudioBuffer,
  t: number,
  dur: number,
  f0: number,
  f1: number,
  q: number,
  gain: number,
  peakAt = 0.45,
): void {
  const n = ctx.createBufferSource();
  n.buffer = noise;
  n.loop = true;
  const bq = ctx.createBiquadFilter();
  bq.type = 'bandpass';
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(EPS, t);
  g.gain.exponentialRampToValueAtTime(gain, t + dur * peakAt);
  g.gain.exponentialRampToValueAtTime(EPS, t + dur);
  n.connect(bq).connect(g).connect(out);
  n.start(t);
  n.stop(t + dur + 0.03);
}
