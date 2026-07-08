# 게임필·주스 폴리싱 — 라운드 2 스펙

> **배경**: 폴리싱 백로그(`archive/POLISH_BACKLOG.md` #1~14) 소진 후, 코드 감사 + 레퍼런스 교차 조사(Vlambeer *Art of Screenshake* · Eiserloh *Juicing Cameras* · Web Audio 절차 합성)로 도출한 다음 폴리싱 라운드.
> **검증 기반**: three **r184**, `@dimforge/rapier3d-compat 0.19.3` 설치 소스 실측. 코드 스케치는 우리 파이프라인(고정 timestep + 보간, [Loop.ts](../src/core/Loop.ts) · [Engine.ts](../src/core/Engine.ts) · [SoundManager.ts](../src/audio/SoundManager.ts))에 맞춰 작성.

## 관통 원칙 (레퍼런스 합의)

1. **하나의 임팩트 에너지 스칼라에서 파생** — 흔들림·파티클·소리 피치/음량·플래시·슬로모를 각각 굴리지 말고 *한* 임팩트 세기(공 KE 또는 Rapier contact force)에서 팬아웃. 피드백이 응집된다.
2. **대비·절제** — 큰 이벤트에 큰 피드백을 *아껴서* 몰아준다. **거터·오픈프레임은 일부러 밋밋하게** 둬야 스트라이크가 산다. 전부 주스칠하면 아무것도 안 산다.
3. **레이어링** — 각 이펙트는 개별적으로 작게, 여러 개의 합이 손맛을 만든다. 티어 N을 N−1보다 크게 만드는 건 *음량*이 아니라 *새 레이어 종류*.
4. **결정성 불변** — 물리 스텝 수를 바꾸는 연출 금지. 리플레이는 스냅샷 재생([Replay.ts](../src/scene/Replay.ts))이라, 스텝 0개 추가/삭제면 궤적·버퍼가 바이트 동일하게 재현된다.
5. **zero-asset 유지** — 파티클(gl_PointCoord 디스크)·플래시(CSS 그라디언트)·소리(합성) 전부 절차적. 새 에셋 0.

## 우선순위 & 착수 순서

| 순 | 항목 | 노력 | 리스크 | 왜 이 순서 |
|---|---|---|---|---|
| 0 | **A0 공통 인프라**(리미터·헬퍼) | S | 낮음 | per-voice 합산 전 **필수 선행** — 특히 A2 clack 다발 없으면 클리핑 |
| 1 | **A 오디오 quick-win** (A1·A3~A6) | S~M | 낮음 | 렌더러 안 건드림. 트리거·API 실측 통과, 기존 훅(`onEvent`·버튼 빌더 등)에 얹는 단순 배선 |
| 2 | **B1 히트스톱** | S | 낮음 | `Loop` + 1줄. 렌더 파이프라인 무관, 즉효 |
| 3 | **A2 per-pin clack ★** | S→M | 낮음~중 | 헤드라인(우리 물리 강점)이자 실작업 대부분. `onContact` 시그니처 확장 = Engine·drain·Boot 3곳 + 카메라 경로 공유 → **배선 갭**(§A2) 해소가 핵심. 트리거·API는 실측 통과 |
| 4 | **B2 핀 파티클 + 플래시** | M | 중 | 자족 클래스(`ImpactFx`). 시각 최대 구멍 |
| 5 | **C 블룸** | L | 높음 | 렌더러 수술 + AA/ACES 재검증 + 실기 발열. **별도 브랜치**(REWARDS §16 #6) |

---

# A. 오디오 패스

현 [SoundManager.ts](../src/audio/SoundManager.ts)가 이미 가진 것을 **기반으로 확장**: 리버브 버스 `out()`, `mtof()`, `MUSIC_PROG`(I–V–vi–IV), `crash()`/`playStrike()`, 굴림 럼블 `setRoll()`, 룩어헤드 스케줄러(음악), `playUnlock()`. AudioContext 언락(첫 제스처)도 처리됨.

**두 가지 사전 사실:**
- **마스터 리미터가 없다.** 모든 보이스가 `ctx.destination` 직결(드라이) 또는 `out()`→destination. per-pin 보이스를 합치면 **클리핑** → A0의 마스터 체인을 **먼저** 만든다.
- 코드는 이미 *"0으로 exp 램프 금지"* 규칙(`0.0001`/`0.001` 타깃)과 `currentTime` 기반 룩어헤드를 지킨다. 그대로 재사용.

## A0. 공통 인프라 (선행 필수)

### 마스터 리미터 + 버스
`out()`의 드라이 탭과 흩어진 `.connect(ctx.destination)`을 전부 `master()` 경유로 교체. **음악은 판단**: `musicGain`까지 리미터에 태우면 강한 clack 캐스케이드에 BGM이 펌핑될 수 있다(A6 `setMusicLevel` 덕킹과 별개 현상). 거슬리면 음악만 리미터 앞단(자체 게인 → destination)에 둔다.

```ts
private masterNode: GainNode | null = null;
private master(): AudioNode {
  const ctx = this.ctx!;
  if (this.masterNode) return this.masterNode;
  const g = ctx.createGain();
  g.gain.value = 0.8;               // 헤드룸: 리미터 전 ~2dB 여유
  const lim = ctx.createDynamicsCompressor();
  lim.threshold.value = -3;         // 피크 근처부터 잡기
  lim.knee.value = 0;               // 하드니 = 브릭월
  lim.ratio.value = 20;             // ≥20:1 = 리미팅
  lim.attack.value = 0.003;         // 3ms — clack 트랜지언트 포착
  lim.release.value = 0.10;         // 100ms — 펌핑 없이 회복
  g.connect(lim).connect(ctx.destination);
  this.masterNode = g;
  return g;
}
```
> MDN 기본값(threshold −24, ratio 12)은 *컴프레서*라 리미팅이 안 된다. 위 값(threshold≈−3, knee 0, ratio 20)이 브릭월. 튜닝 중 `lim.reduction`(dB)을 읽어 스트라이크 캐스케이드가 얼마나 세게 때리는지 확인 — −10dB에 상시 붙어 있으면 리미터에 기대지 말고 per-voice peak를 낮춘다.

### 퍼커시브 엔벨로프 헬퍼
```ts
/** 빠른 리니어 어택(시작 클릭 제거) → 엡실론까지 exp 감쇠(0 금지). */
private perc(g: GainNode, t0: number, peak: number, attack = 0.0015, decay = 0.06) {
  const p = g.gain;
  p.setValueAtTime(0.0001, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
}
```

### 노이즈 버퍼 팩토리 (핑크=Paul Kellet, 브라운=누설적분)
`AudioBuffer`로 프리렌더 후 **캐시**(`crash()`는 매 호출 새 버퍼를 만든다 — 캐싱은 이 팩토리가 새로 들이는 개선). `ScriptProcessorNode`(폐기)·`AudioWorklet`(과함) 불필요.
```ts
private noiseCache = new Map<string, AudioBuffer>();
private noiseBuf(kind: 'white'|'pink'|'brown', seconds: number): AudioBuffer {
  const key = `${kind}:${seconds}`; const hit = this.noiseCache.get(key); if (hit) return hit;
  const ctx = this.ctx!, len = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
  if (kind === 'white') { for (let i=0;i<len;i++) d[i]=Math.random()*2-1; }
  else if (kind === 'pink') {                 // ±0.05dB > 9.2Hz
    let b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
    for (let i=0;i<len;i++){ const w=Math.random()*2-1;
      b0=0.99886*b0+w*0.0555179; b1=0.99332*b1+w*0.0750759; b2=0.96900*b2+w*0.1538520;
      b3=0.86650*b3+w*0.3104856; b4=0.55000*b4+w*0.5329522; b5=-0.7616*b5-w*0.0168980;
      d[i]=(b0+b1+b2+b3+b4+b5+b6+w*0.5362)*0.11; b6=w*0.115926; }
  } else {                                     // brown/red: −6dB/oct, ×3.5 makeup
    let last=0; for (let i=0;i<len;i++){ const w=Math.random()*2-1; last=(last+0.02*w)/1.02; d[i]=last*3.5; }
  }
  this.noiseCache.set(key, buf); return buf;
}
```
`pink`=클러터/스키드 워시, `brown`=저역 럼블/thud 바디, `white`=날카로운 어택 틱.

### 스케줄링 규약
- **타이밍은 `ctx.currentTime` 기준**(오디오 스레드, 샘플 정확). `setTimeout`은 스케줄러 깨우기(룩어헤드)에만 — 이벤트 타이밍엔 금지.
- **한 임팩트 = 한 `t0`**: 충돌 프레임에 `const t0 = ctx.currentTime` 한 번 잡고 crash 바디·clack·sting을 전부 그 `t0`에서 스케줄. sub-sound마다 `currentTime` 재호출하면 프레임 단위로 드리프트.
- **슬로모 캐스케이드**: clack은 접촉이 물리적으로 발생하는 시점의 `currentTime + jitter`에 예약 → 슬로모가 실시간으로 캐스케이드를 늘려준다(이게 연출, 옛 버그 아님).

## A1. 릴리스 thunk + skid
**트리거**: `GameState.throwBall()` 맨 위, `power∈[0,1]`. 공이 레인에 닿는 묵직한 "톡 + 스륵".
**노드**: `sine(thok) → gain → destination`(드라이) 병렬 `brown noise → bandpass → gain → out()`(웨트).

| 레이어 | 파라미터 |
|---|---|
| thok | `sine`, freq `180→(60+20p)` @0.09s, peak `0.22+0.40p`, decay `0.16+0.10p` |
| skid | `brown 0.4s`, rate `1.0→0.8`, bandpass f `1000+2200p` Q `0.7`, peak `0.04+0.11p`, decay `0.12+0.22p` |

**함정**: freq를 0으로 exp 램프 금지(바닥 `60+20p` 클램프). thok은 **드라이**(2.5s 룸 꼬리에 저역 머드 방지 — `out()`의 "sub/thud는 드라이" 규칙과 동일). `throwBall` 중복 호출 가드.

## A2. per-pin clack ★ (헤드라인)

레퍼런스가 *"녹음 샘플로는 불가능한 절차적 게임의 반칙급 강점"*으로 지목. Rapier 접촉마다 짧은 클랙 → **물리와 일치하는 핀 캐리 사운드** 창발.

**기존 `onPinImpact`(투구당 1회 collapsed crash)와 모순 아님.** body(thud/sub/어택 크랙)는 `crash()`가 그대로 담당, **clack만 per-contact 별도 훅**. 40ms 클랙 다발은 옛 "탭탭탭" 버그(풀 크래시를 per-contact 재생)와 다르다.

**트리거 소스**: [Engine.ts:166](../src/core/Engine.ts:166)이 이미 `drainContactForceEvents((e) => onContact(e.totalForceMagnitude()))`를 돈다. threshold 필터는 Rapier `collider.setContactForceEventThreshold(T)` + `ActiveEvents.CONTACT_FORCE_EVENTS`로 서브임계 micro-contact를 JS 도달 전에 차단(둘 다 0.19.3 실존 확인: [collider.d.ts:242](../node_modules/@dimforge/rapier3d-compat/geometry/collider.d.ts) · `ActiveEvents.CONTACT_FORCE_EVENTS = 2`).

⚠️ **배선 갭 — A2 실작업 대부분이 여기**: 현 `onContact`는 **magnitude만** 넘기고([Engine.ts:46](../src/core/Engine.ts:46)) 볼-레인·핀-바닥·핀-핀·볼-핀을 **구분 없이** 발화한다. 지금은 Boot가 `ball.z > PIN_CONTACT_Z`로만 걸러 카메라 연출에 쓸 뿐([Boot.ts:279-285](../src/core/Boot.ts:279)). `pinContact(mag, ballPin)`의 `ballPin`을 얻고 clack을 핀 관련 접촉으로 한정하려면 콜백에서 `e.collider1()/collider2()`를 볼 콜라이더 핸들과 비교해야 한다 → **`onContact` 시그니처를 `(mag, isPin, ballPin)`류로 넓히거나**, Engine 안에서 핸들 비교 후 가공해 넘기는 **전용 clack 훅**을 신설. magnitude-only 그대로 두면 clack이 굴림·2구 핀정리 전 구간에 오발화한다.

**임펄스→피치/게인 매핑**: `e = clamp(mag / MAG_REF, 0, 1)`(`MAG_REF`=깨끗한 볼-핀 타격 force, 튜닝 노출). 핀 공명 ~400–1100Hz.
- 피치 `f = (420 + 620e) * detune`, `detune = 2^(rand(−0.6,0.6)/12)` (±60센트 — 캐스케이드가 "여러 핀"으로 들리는 핵심)
- 게인 `peak = 0.04 + 0.10e` (e² 아님 — 약한 핀-핀도 들리게), 볼-핀은 `peak*1.3, f*0.9`(묵직)
- Q `6 + 8e`, decay `0.03 + 0.05e`
- **타임 지터** `t0 + rand()*0.012`: 한 물리 스텝 내 접촉들이 같은 `currentTime`에 몰려 위상 스택(클리핑+가짜음)되는 걸 분산

**보이스 관리** (핵심 — 200ms에 수십 접촉):
```ts
private clackBus: GainNode | null = null;
private activeClacks: GainNode[] = [];
private lastClackAt = 0;
private readonly MAX_CLACKS = 14;       // 폴리포니 상한
private readonly CLACK_MIN_DT = 0.006;  // 온셋 최소 간격(이하는 귀가 병합)
private readonly MAG_REF = 800;         // 튜닝: 깨끗한 볼-핀 타격 force

pinContact(mag: number, ballPin: boolean) {
  if (!this.ctx || !this.enabled) return;
  const ctx = this.ctx;
  if (!this.clackBus) { this.clackBus = ctx.createGain(); this.clackBus.gain.value = 0.6; this.clackBus.connect(this.out()); }
  const now = ctx.currentTime;
  const t0 = Math.max(now, this.lastClackAt + this.CLACK_MIN_DT) + Math.random()*0.012; // 스로틀+지터
  this.lastClackAt = t0;
  if (this.activeClacks.length >= this.MAX_CLACKS) {            // 캡 초과 → 가장 오래된 보이스 스틸
    const v = this.activeClacks.shift()!;
    v.gain.cancelScheduledValues(t0); v.gain.setValueAtTime(Math.max(0.0001, v.gain.value), t0);
    v.gain.setTargetAtTime(0.0001, t0, 0.004);                 // 클릭 없이 빠른 릴리즈
  }
  const e = Math.max(0, Math.min(1, mag / this.MAG_REF));
  const detune = Math.pow(2, (Math.random()*1.2-0.6)/12);
  const f = (420 + 620*e) * detune * (ballPin ? 0.9 : 1);
  const peak = (0.04 + 0.10*e) * (ballPin ? 1.3 : 1);
  const decay = 0.03 + 0.05*e;
  const o = ctx.createOscillator(), bp = ctx.createBiquadFilter(), g = ctx.createGain();
  o.type='triangle'; o.frequency.value=f; bp.type='bandpass'; bp.frequency.value=f; bp.Q.value=6+8*e;
  this.perc(g, t0, peak, 0.0012, decay);
  o.connect(bp).connect(g).connect(this.clackBus!); o.start(t0); o.stop(t0+decay+0.03);
  this.activeClacks.push(g);
  o.onended = () => { const i=this.activeClacks.indexOf(g); if(i>=0) this.activeClacks.splice(i,1); o.disconnect(); bp.disconnect(); g.disconnect(); };
}
```
**왜 안 터지나**: (a) Rapier threshold가 홍수를 JS 전에 거름 (b) `CLACK_MIN_DT`+지터가 온셋 밀도 상한 (c) `MAX_CLACKS`가 라이브 노드 상한(oldest-steal) (d) detune+지터로 비상관 합 → 피크 ≈ `A·√N`(≠ `A·N`), clackBus(0.6)+리미터가 흡수.
**함정**: clack 타이밍을 *물리* 클록에 묶지 말 것(슬로모가 뭉갬) — 항상 `currentTime+jitter`. `clackBus` per-contact 재생성 금지. `onended`로 배열 정리 안 하면 누수.

## A3. 스트릭 에스컬레이션
**트리거**: `game.onEvent`의 `'strike'` 케이스에서 `e.streak`로 티어 분기(2=더블, 3=터키, 4+=N-bagger). 신호는 이미 있다 — `{type:'strike', streak}`([GameState.ts:82](../src/game/GameState.ts:82))가 정산 시 발화, [Boot.ts:202-212](../src/core/Boot.ts:202)의 StillCut·`environment.pulse('strike', e.streak)` 옆에 배선. crash(임팩트)는 `onPinImpact`발이라 sting은 정산 시점에 얹혀 "쾅 → STRIKE!" 순서가 자연스럽다. ⚠️ `playStrike`(private wav 재생기)에 걸지 말 것 — 핀이 쓰러진 **모든** 투구에 울리고 인자는 standingCount(연속 스트라이크 수 아님)라 스트릭 훅이 아니다.
**규칙**: 티어 N을 N−1보다 *categorically* 크게 = **새 레이어 종류 추가**(음량 아님).

| 티어 | 누적 추가 |
|---|---|
| 2 더블 | 2음 상승 핑(루트→5도) |
| 3 터키 | 트라이어드 아르페지오 + 옥타브 위 반짝임 |
| 4~5 | + 옥타브 상향 + 상승 라이저(pink 노이즈 lowpass 400→6000 스윕) |
| 6+ | + 서브베이스 드롭(90→38Hz, 드라이) + 리버브 증가 |

`mtof`+`MUSIC_PROG[0].arp`(C 트라이어드 `[60,64,67,72]`) 재사용, sting은 `out()`(웨트)로 crash 위에 얹고 sub는 드라이. 아르페지오 스텝 0.07s. `tier` 캡으로 12-bagger가 게인을 리미터 밖으로 밀지 않게 — *레이어*가 "크다"를 담당.

## A4. UI 클릭 틱
**트리거**: 버튼 `pointerdown`(공용 빌더 `primaryButton`/`ghostButton`에 1회 배선 → 전 버튼 커버). ~40ms.
```ts
uiTick(kind: 'primary'|'secondary' = 'primary') {
  if (!this.ctx || !this.enabled) return;
  const ctx=this.ctx, t0=ctx.currentTime, o=ctx.createOscillator(), g=ctx.createGain();
  o.type='triangle'; o.frequency.value = kind==='primary' ? 880 : 587;  // A5 vs D5
  this.perc(g, t0, 0.08, 0.001, 0.035); o.connect(g).connect(ctx.destination); // 드라이
  o.start(t0); o.stop(t0+0.05);
}
```
**함정**: 1ms 어택(클릭온클릭 방지), 30ms 내 연타 스로틀, 드라이(볼링장 리버브에 UI 넣지 말 것). GAME_DESIGN §10 "UI 버튼 클릭 피드백" 미구현분 해소.

## A5. 스페어 확인 chime
**트리거**: 2구에 10핀 정리. 일반 히트 crash와도, 업적 딩(`playUnlock`=고음 sine 880→1318)과도 구별. 차별화: **중음역·트라이앵글+약한 벨 배음·상승 완전5도(해결감)·웨트**.
`[67,74]`(G4→D5), 각 음에 `triangle`(v0.16) + `sine` 옥타브 벨(v0.05, mul2), `out()`. 스페어가 업적도 해금하면 ~250ms 스태거.

## A6. 승리/하이스코어 스팅 (+패배)
**트리거**: 게임 종료. 승리=`MUSIC_PROG` 상승 아르페지오(2옥타브, 마지막 음 서스테인, 웨트). 하이스코어=+옥타브 반짝임. **패배=하강 2음 소프트**(A4→F4, `sine`, 느리게·작게 — "womp"). 패배는 승리 라인 피치다운이 아니라 *하강+느림+작음+sine*이 핵심. 재생 중 메뉴 음악 `setMusicLevel`로 덕킹.
현 상태: `newBest`는 정적 골드 텍스트뿐([Menu.ts:587](../src/ui/Menu.ts:587)), 결과 화면 사운드는 신규 업적 있을 때 `playUnlock`만([Boot.ts:264](../src/core/Boot.ts:264)) → 개인기록/승리가 **무음**. 배지 CSS 팝도 함께.

---

# B. 임팩트 모먼트

## B1. 히트스톱 (freeze-frame)

첫 볼↔포켓 접촉에서 물리를 ~40–80ms 얼리고(렌더는 계속) 기존 슬로모로 이어짐. 격투게임 hitlag.

**설계 선택**: `Loop`에 **벽시계 freeze 프리미티브** 추가 = "accumulator freeze". `timeScale=0`보다 우월(그건 `update()`의 슬로모 재계산과 싸움). `loop.paused` 재사용 금지(**Replay 소유**) → 전용 필드.

**결정성**: freeze 동안 `engine.step`/`onStep` 미실행 → 물리 스텝 0개 → `Replay.record`가 스냅샷 0개 기록 → 버퍼 바이트 동일 → 특수샷 리플레이 궤적 완전 재현. 우리 불변식 "물리 dt는 절대 스케일 안 함"([Loop.ts:16](../src/core/Loop.ts:16)) 준수 — freeze는 accumulator에 시간을 *안 넣을* 뿐.

**freeze 후 슬로모 자동 연결**: `notifyImpact`가 이미 `slowmoTimer` 설정, 그 타이머는 `computeTimeScale()`(=`onStep`)에서만 감소 → freeze 중 `onStep` 미실행이라 타이머 무손실 → 재개 시 소비 시작. 추가 코드 0.

```ts
// Loop.ts
private hitstop = 0; // 남은 프리즈(실시간 초)
hitStop(sec: number) {                          // 결정성: 스텝 0개 → 궤적·리플레이 불변
  if (this.paused) return;                       // 리플레이 중 무시
  this.hitstop = Math.max(this.hitstop, Math.min(sec, 0.12)); // 최장 채택 + 상한
}
get frozen(): boolean { return this.hitstop > 0; }
// tick() 안:
const frozen = this.hitstop > 0;
if (frozen) this.hitstop -= frame;               // 실시간 소모(timeScale 무관)
if (!this.paused && !frozen) {                    // ← 프리즈면 물리 블록 통째 스킵
  this.acc += frame * this.timeScale;
  while (this.acc >= FIXED_DT) { this.engine.step(FIXED_DT); this.onStep?.(FIXED_DT); this.acc -= FIXED_DT;
    if (this.paused) { this.acc = 0; break; } }
  this.engine.sync(this.acc / FIXED_DT);
}
this.onFrame?.(frame); this.engine.render();      // 프리즈 중에도 렌더·DOM 연출은 돈다
```
**트리거** ([GameState.ts](../src/game/GameState.ts) `notifyImpact`의 `if(hit)`): 공 KE로 duration(결정적, Rapier 추가 배선 불필요).
```ts
const v = this.ballObj.body.linvel(); const speed = Math.hypot(v.x,v.y,v.z);
const ke = 0.5 * this.humanSpec.massKg * speed*speed;      // KE ≈ [40..300]. ※ humanSpec=사람 공; AI 턴은 makeBallSpec(ai.ballLb)로 질량 상이 — 연출용(40–80ms 클램프)이라 무해하나 엄밀히는 활성 턴 스펙
const t = Math.max(0, Math.min(1, (ke - 40) / (300 - 40)));
this.requestHitstop?.(0.04 + 0.04 * t);                    // 40→80ms. Boot: game.requestHitstop = s => loop.hitStop(s)
```
**함정**: duration 캡(≤120ms — 슬로모 0.32가 이미 깊어 긴 freeze는 행으로 읽힘). 저사양은 ~30ms로 짧게(선택). `MAX_FRAME`이 재개 프레임을 이미 클램프(따라잡기 폭주 없음). 크래시음은 `onPinImpact`에서 트리거 순간 울려 freeze 프레임 중 울림(타격 셀링), 굴림 럼블은 `onStep`발이라 freeze 중 자연 침묵. 카메라 push-in은 `onFrame`발이라 freeze 중에도 lean-in이 이어진다([Boot.ts:284](../src/core/Boot.ts:284)) — 격투게임식 완전 정지와 달리 "물리 정지 + 카메라만 살짝 밀림", 버그 아님(실기 판단).

## B2. 핀 파티클 + 스크린 플래시

신규 `scene/ImpactFx.ts`. **스파크**=사전할당 `THREE.Points` 풀(링버퍼 재활용), 둥근 점은 `gl_PointCoord` 소프트 디스크 `ShaderMaterial`(텍스처 0), additive·`depthWrite:false`. **플래시**=DOM 오버레이(StillCut 관용, z26), `mix-blend-mode:screen` + radial-gradient + WAAPI `.animate()` 1콜(GPU 합성, per-frame JS 0).

**왜 DOM 플래시**: WebGL 풀스크린 쿼드는 상시 per-frame 패스 비용 + 블룸이 증폭. DOM 오버레이는 유휴 시 0비용·테마 쉬움·블룸이 안 건드림.

**풀링**: 고정 `BufferGeometry`(size `max`), alive/dead = `life[i]>0`, 링버퍼 `cursor`로 재활용(포화 시 oldest 덮음). dead는 `aLife=0`→shader `discard`. **per-frame 할당 0**: 타입배열 생성자서 사전할당, `update()`는 in-place, `needsUpdate`는 움직였을 때만.

**세기**: `burst(pocketPos, standing)` — 파티클 수·플래시 peak를 서있던 핀 수로 스케일. 포켓 위치=충돌 시 공 위치.

**onFrame 구동**: `const simDt = (loop.paused || loop.frozen) ? 0 : dt * loop.timeScale; impactFx.update(simDt);` — 슬로모 동기 + **히트스톱 중 파티클도 정지**(simDt=0 early-return).

**결정성**: 프레젠테이션 전용, 결정적 `onPinImpact`가 먹임, 물리 무관. `Math.random` 스프레드 OK(sim 아님, 미기록). 파티클은 리플레이에 없음(원하면 Replay `slam` 콜백서 `burst` 호출 — 선택).

**모바일 가드**: 지배 비용은 additive **오버드로 fill-rate**(pixelRatio와 같은 레버). 풀 `40 vs 128`·`uSize` 축소 on `isLowEnd()`; fill 빡세면 저사양은 파티클 0·플래시만. `mix-blend-mode` 약한 컴포지터 잰크 대비 폴백(blend 빼도 골드 그라디언트가 플래시로 읽힘).

**함정**: `points.frustumCulled = false` 필수(풀이 원점서 죽어있을 때 컬링 회피). 블룸 켜지면 additive 점도 블룸됨(보너스, 과하면 블룸 threshold↑). 전체 `ImpactFx` 스케치(shader 포함)는 비주얼 리서치 원문 참조.

**대안(셰이더 회피)**: `PointsMaterial({ map: canvasTex, blending: AdditiveBlending, depthWrite:false, sizeAttenuation:true })` — `canvasTex`=생성 시 1회 그린 radial-gradient 디스크. 여전히 에셋 0, per-particle 알파 페이드 정밀도만 손해.

---

# C. 블룸 (별도 브랜치급)

REWARDS.md §11에 이미 스펙 있음 — 아래는 r184 실측 **검증·심화**(정정 포함).

**전환**: `Engine.render()`를 `renderer.render` 직접 → `composer.render()`(`RenderPass → UnrealBloomPass → OutputPass`).

**두 must-fix (현재 ACES 직접 렌더라):**
- **(B) 톤매핑** — `RenderPass`는 컴포저의 `HalfFloatType` 타깃에 **선형-HDR**로 렌더(three는 렌더타깃엔 톤매핑/sRGB 미적용, 캔버스에만). 블룸은 선형 HDR에서 동작. **`OutputPass`가 맨 끝에 ACES+sRGB 적용**(r184 `OutputPass.js:93-112` 실측 — `renderer.toneMapping`/`outputColorSpace`를 읽어 `ACES_FILMIC_TONE_MAPPING`/`SRGB_TRANSFER` define). → **renderer의 ACES+SRGBColorSpace 그대로 두고 `OutputPass`만 끝에**. 결과=오늘 룩+블룸.
- **(A) 안티에일리어싱** — 컴포저가 렌더타깃에 그리면 캔버스 `antialias:true` 무효. EffectComposer 기본 타깃은 MSAA 없음(`EffectComposer.js:69` 실측). **커스텀 멀티샘플 타깃**: `new WebGLRenderTarget(w, h, { type: HalfFloatType, samples: 4 })`(WebGL2 MSAA, r184은 WebGL2-only). 거터벽 엣지크롤 회귀(§11-A/§16) 직접 해소.

```ts
// Engine.ts — imports: three/addons/postprocessing/{EffectComposer,RenderPass,UnrealBloomPass,OutputPass}.js
private composer: EffectComposer | null = null;
private bloomPass: UnrealBloomPass | null = null;
readonly isLowEndDevice = this.lowEnd;            // B2도 재사용
private readonly bloomEnabled = !this.lowEnd;     // 저사양 OFF(§11-C)
// 생성자, renderer/scene/camera/lights 이후:
if (this.bloomEnabled) {
  const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(this.renderer, rt);
  composer.setPixelRatio(this.renderer.getPixelRatio()); composer.setSize(innerWidth, innerHeight);
  composer.addPass(new RenderPass(this.scene, this.camera));      // 선형-HDR
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight),
    0.6,   // strength — 절제(씬 전체가 씻기지 않게)
    0.5,   // radius
    0.85); // threshold — emissive/HDR만 헤일로, 조명받은 면은 유지
  composer.addPass(bloom); composer.addPass(new OutputPass());    // ACES+sRGB(§11-B)
  this.composer = composer; this.bloomPass = bloom;
}
// render(): this.composer ? this.composer.render() : this.renderer.render(scene, camera)  // 저사양=기존 파이프
// onResize/setQuality: composer.setSize + bloomPass.resolution.set + composer.setPixelRatio 미러 필수
```

**정정 vs REWARDS §11-A**: `antialias:true`를 **유지**한다(§11-A는 "false" 권고). 저사양 direct-render 경로가 네이티브 MSAA를 쓰고, 컴포저 경로는 `samples:4`가 담당 — 저사양 OFF 분기가 있으니 둘 다 필요.

**네온-신스웨이브 시작값**: threshold 0.85 / strength 0.6 / radius 0.5. 배경 `0x101018`(매우 어둠)+매트 레인이라 밝은 픽셀만 블룸. ACES가 블룸 *후* 하이라이트 압축하니 헤일로가 약하면 strength 0.6→0.9. **글로우 스킨은 global threshold를 낮추지 말고 `emissiveIntensity`를 올려 승격**(REWARDS 글로우 0.7–1.1 → ~1.5–2.5; 채도 높은 네온 `#ff2d78`은 luma 낮아 흰 emissive보다 더 높여야 동등 헤일로). 이게 §11 "블룸 착지 시 글로우 스킨 자동 승격".

**모바일/발열**: `UnrealBloomPass`는 5레벨 mip 분리 블러 — 구 `BloomPass`보다 비쌈. `isLowEnd()` OFF(부팅 1회 판정 재사용). 내부 RT는 HalfFloat 반해상도라 비용 유계지만 **실기 측정 필수**(§16 P2 게이트). 런타임 토글(퍼포먼스 모드)은 lazy 생성 또는 `render()` 분기+dispose — 부팅 게이트가 가장 단순.

**생태계 주의**: `EffectComposer`는 현 three 로드맵서 WebGL "레거시"(전방=`WebGPURenderer`+`RenderPipeline`). 지금 쓰기 OK(이 프로젝트 WebGLRenderer), 향후 WebGPU 이관 시 이 파일 교체됨.

---

## 레퍼런스

- Vlambeer — [The Art of Screenshake](https://www.youtube.com/watch?v=AJdEqssNZ-U) (대비·레이어링)
- Squirrel Eiserloh — [Juicing Your Cameras With Math (GDC 2016)](http://www.mathforgameprogrammers.com/gdc2016/GDC2016_Eiserloh_Squirrel_JuicingYourCameras.pdf) (trauma·noise·spring)
- [noisehack — Web Audio 노이즈 합성](https://noisehack.com/generate-noise-web-audio-api/) · [Paul Kellet pink (musicdsp #76)](https://www.musicdsp.org/en/latest/Filters/76-pink-noise-filter.html)
- [web.dev — A Tale of Two Clocks](https://web.dev/articles/audio-scheduling) (currentTime 스케줄러) · [alemangui — the ugly click](http://alemangui.github.io/ramp-to-value) (0 램프 금지)
- [three.js unreal_bloom 예제](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_postprocessing_unreal_bloom.html) · three r184 설치 소스(`OutputPass`/`EffectComposer`/`UnrealBloomPass`) 실측
- [Rapier TempContactForceEvent](https://rapier.rs/javascript3d/classes/TempContactForceEvent.html) (`totalForceMagnitude`/`maxForceMagnitude`)
- 관련 내부: [DECISIONS.md](DECISIONS.md) §7(shake 폐기·push-in 대체) · §11(무드 스크린 text-free) · [REWARDS.md](REWARDS.md) §11·§16(블룸)
