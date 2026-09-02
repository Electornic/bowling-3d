# 사운드 — 현재 상태와 백로그

> 작성: 2026-09-02. **도안 [§10](GAME_DESIGN.md)은 *설계 의도*이고 이 문서는 *현재 구현 상태 + 남은 작업*이다.**
> 둘이 여러 군데 갈렸다(§3) — 도안만 보고 작업하면 틀린 걸 만든다.
> 값이 이 문서와 코드에서 갈리면 **코드가 단일 소스**다([SoundManager.ts](../src/audio/SoundManager.ts)).

---

## 0. TL;DR

- **소리는 8종**: 릴리스 · 굴림 럼블 · 핀 크래시 · 핀세터 기계음(합성) · 하우스 PA 차임(합성, 이벤트 5종) · **옆 레인 굴림·크래시** · 해금 차임 · BGM. 남은 무음은 §5.
- **방향은 리얼·다이제틱으로 확정**(2026-09-02 사용자) — 기계음·홀 소리로 장소를 만들고 축하는 절제. 군중 반응 ✗.
- **마스터 버스가 있다**(§4.1, 2026-09-02 추가) — 모든 소스 → `masterGain` → 리미터 → destination.
  새 소리는 `this.bus()`에만 꽂으면 되고, 클리핑·마스터 볼륨·사운드 OFF 뮤트를 따로 챙길 필요가 없다.
- `GameState.onEvent` 5종(strike·spare·gutter·splitConverted·gameOver)에 PA 차임이 붙었다(§2.6, 2026-09-02).
- 에셋은 셋(wav 둘 + BGM mp3 하나). BGM은 2026-09-02에 합성 칩튠에서 실제 트랙으로 바뀌었다(§6).

---

## 1. 신호 경로 — 지금 이렇게 생겼다

```
strike.wav  ──(BufferSource → Gain)──┐
roll.wav    ──(BufferSource → 피킹필터 → Gain)──┤
BGM mp3     ──(BufferSource loop → musicGain)──┼──▶ masterGain ──▶ DynamicsCompressor ──▶ ctx.destination
해금 차임    ──(Oscillator → Gain)──┘              (볼륨·뮤트)     (리미터 −2dB/20:1)
```

**마스터 버스는 2026-09-02에 생겼다.** 그 전엔 네 경로가 각자 `destination`에 직결이었고 Web Audio는 거기 꽂힌
신호를 단순 합산해 최악 합 1.93이 그대로 출력됐다. 지금은 `SoundManager.bus()`가 유일한 입구다 — 설정 근거는 §4.1.

- `AudioContext`는 **첫 user gesture**(`pointerdown`/`keydown`)에 생성·resume된다. 그 시점에
  wav 둘과 mp3를 지연 디코드한다. 제스처 전엔 합성 폴백뿐이다.
- **BGM 디코드는 wav들과 별도 경로다.** 같은 `Promise.all`에 묶으면 1.5MB mp3 하나가 실패할 때
  strike/roll까지 날아가 SFX 전체가 무음이 된다.
- 리버브(컨볼버) 버스는 **2026-09-01에 걷어냈다.** 합성 크래시 폴백만 쓰고 있었고 그 폴백은
  실제로 도달하지 않는 경로였다.
- 백그라운드 진입 시 `ctx.suspend()`([Boot.ts:128](../src/core/Boot.ts)) — 배터리·발열. §7의 함정과 직결된다.

---

## 2. 현재 나는 소리 4종

| 소리 | 음원 | 게인 | 훅 |
|---|---|---|---|
| 핀 크래시 | `strike.wav` (2.25s 디코드) | 3층 엔벨로프(§2.2): 크랙 0.85~**1.0** · 바디 0.25~1.0 | `game.onPinImpact` + `replay.onImpact` |
| 굴림 럼블 | `roll.wav` (1.07s, 심리스 루프 가공) | `t^1.5 × 0.85` → 최대 **0.85** · 슬로모 피치·LPF 연동(§2.3) | `game.onRoll` + `replay.onBall` |
| 해금 차임 | 합성 2음 (A5→E6) | 0.22 | [Boot.ts:303](../src/core/Boot.ts) |
| BGM | mp3 48.013s 루프 | 메뉴 **0.35** / 매치 **0.08** | [Boot.ts:101](../src/core/Boot.ts) |
| 핀세터 기계음 | 합성 4층(§2.5) | 모터 0.06 · 활주 0.05~0.09 · 쿵 0.16~0.32 · 탁 0.14~0.19 | `pins.onCycle` + `environment.onAmbMachine` |
| 하우스 PA 차임 | 합성 blip + 스피커 필터(§2.6) | 0.16~0.22 | `game.onEvent` 5종([Boot.ts](../src/core/Boot.ts) `wireGameEvents`) |
| 릴리스 | 합성 팝 + 둥 + 노크(§2.7) | 0.05 · 0.18~0.40 · 0.10~0.16 | `game.onThrow(power)` — 사람·AI 공통 |
| 옆 레인 굴림·크래시 | roll.wav 레인별 루프 · strike.wav(§2.8) | 주 레인 값 × 거리 감쇠 0.16/0.10 | `environment.onAmbBall` |

**핀 크래시는 "한 사건 = 한 소리"다.** 개별 contact마다 울리던 방식은 슬로모 중 contact가 띄엄띄엄
들어와 '탭탭탭'으로 들려서 투구당 1회로 통일했다. 세기는 **서 있던 핀 수**로 정한다(풀랙=쾅, 1~2핀=톡).
`STRIKE_LEADIN = 0.10`으로 리드인을 건너뛰어 영상 충돌과 동기시킨다.

### 2.1 굴림 게인 곡선 (2026-09-02 재조정)

곡선이 `t²`이던 시절엔 **보통 속도에서 BGM에 묻혔다** (사용자 보고: "굴러가는 효과음이 좀 묻힌다",
핀 크래시는 들린다고 했다). 지수를 1.5로 완만하게 하고 BGM을 함께 내렸다.

| 공 속도 (m/s) | 3 | 5 | 7 | 9 | 10.5 |
|---|---|---|---|---|---|
| `t` | 0.21 | 0.42 | 0.63 | 0.84 | 1.00 |
| 이전 `t²×0.7` | 0.031 | 0.124 | 0.279 | 0.496 | 0.700 |
| **현재 `t^1.5×0.85`** | **0.082** | **0.232** | **0.427** | **0.657** | **0.850** |
| 이전 BGM(0.12) 대비 | 0.26× | 1.03× | 2.33× | 4.14× | 5.83× |
| **현재 BGM(0.08) 대비** | **1.03×** | **2.90×** | **5.33×** | **8.21×** | **10.62×** |

`t = clamp((speed − 1) / (MAX_SPEED − 1))`, `MAX_SPEED = 10.5`.
speed 5에서 이전 굴림 0.124 vs 당시 BGM 0.12 — **1.03배, 사실상 동일 레벨**이었다. 저역이라
마스킹에도 훨씬 약하다. 크래시(0.55~1.0)가 안 묻힌 건 당연했고 그래서 크래시는 손대지 않았다.

⚠️ **피크를 0.85에서 멈춘 이유**: 임팩트 순간엔 공이 아직 빠르게 굴러 굴림과 크래시가 겹친다. 당시엔 마스터 버스가
없어 0.85 + 1.0 = 1.85가 곧 클리핑이었다. 이제 리미터가 넘치는 만큼 누르지만(§4.1) **리미터는 안전망이지 밸런스
도구가 아니다** — 크래시가 굴림보다 크게 들리는 비율은 게인이 정한다. 더 필요하면 여전히 BGM을 내리는 게 순서다.

⚠️ **저속(speed 3)은 아직 1.03배로 아슬아슬하다.** 살살 굴릴 때 여전히 묻힐 수 있다.

### 2.2 크래시 — 3층 엔벨로프 + 변주 (2026-09-02)

`strike.wav`를 5 ms RMS로 재보면 **크랙 0.105~0.125 s(피크 0.83) → 클래터 ~0.5 s(0.15~0.5) → 잔해·잔향 ~2.2 s**다.
예전엔 핀 수로 볼륨과 길이만 잘라 1핀이 "풀랙 소리를 0.3초에서 끊은 것"이었다(§8.1 "임팩트는 3층" 위반).

| 핀 수 | 크랙 게인 | 바디·테일 게인 | 길이 |
|---|---|---|---|
| 1 | 0.865 | 0.325 | 0.48 s |
| 5 | 0.925 | 0.625 | 1.2 s |
| 10 | 1.0 | 1.0 | 2.1 s |

한 소스에 게인 자동화를 그린다 — 크랙은 +25 ms까지 유지, 25 ms 램프로 바디 레벨로 내려간다. 소스가 하나라 이음새 클릭이 없다.
**변주**: `playbackRate` ±3%(≈ ±0.5 semitone) + 시작 오프셋 ±3 ms(크랙 앞 리드인 안에서만 — 어택은 안 잘린다).

### 2.3 슬로모 동기 (2026-09-02)

`onRoll(speed, inGutter, timeScale)`의 세 번째 인자로 그 스텝의 화면 배속이 온다. 굴림음은 **피치 √timeScale**(바닥 0.32 → 0.57,
≈ −10 semitone — 1옥타브 이내 관례) + **로패스 800 Hz ← 18 kHz**(배속에 2차 매핑, 정상 근처선 투명). 실측: `setRoll(8, false, 0.32)`
→ playbackRate 0.648 · LPF 800 Hz, 배속 1 → 1.145 · 18 kHz.

### 2.4 리플레이 사운드 (2026-09-02)

리플레이는 물리를 얼려 `onRoll`·`onPinImpact`가 안 불린다 — 그래서 스트라이크 리플레이가 **무음으로 다시 부딪히고** 있었다.
`Replay.onImpact`(핀이 처음 움직인 스냅을 재생이 지나는 순간, `game.impactStanding`으로 같은 세기)와 `Replay.onBall`(스냅 간
이동으로 잰 공 속도, 배율 0.9)을 Boot가 같은 SoundManager로 배선한다. 실측: 리플레이 시작 0.62 s 뒤 크래시 재발화,
굴림은 시작부터 크래시 +0.22 s(핀덱 끝)까지 들리고 프리즈·스킵에서 0.

---

### 2.5 핀세터 기계음 — 합성 4층 (2026-09-02)

큐는 [cues.ts](../src/audio/cues.ts)의 `MachineCue` — PinSet(플레이 레인)과 Environment(옆 레인 4개)가 **같은 어휘**로
단계 시작 시각에 `SoundManager.machineCue(cue, lane)`를 부른다. 이름이 다른 앰비언트 단계 셋은 Environment가 번역한다
(hoist→lift · set→return · rack→set). CC0 녹음은 통짜 앰비언스뿐이라(§8.4) 전부 합성이다.

| 층 | 만드는 법 | 언제 |
|---|---|---|
| motor | 톱니파 48·96.3 Hz → LPF 380 + 노이즈 BPF 1.5 kHz 래틀 | guard 시작 ~ done (cut이면 60 ms, 자연 종료면 300 ms 잦아듦) |
| whir | 노이즈 BPF를 단계 길이 동안 f0→f1 스윕 | 매 단계 — 내려가는 부품은 하강(650→480), 올라가는 부품은 상승(420→820), 스윕은 750→1000 |
| clunk | 노이즈 LPF 240 버스트 + 사인 80→55 Hz | grip/sweep 시작(바가 가드에 닿음) · return 시작(끝, 0.32로 가장 무겁게) · set 시작(귀환) · done(0.16) |
| tak | 노이즈 BPF 2.6 kHz 8 ms + 삼각파 950→700 Hz 40 ms | raise 시작에 핀 수만큼 140 ms 안에 흩어서(피치·게인 ±) |

실측 큐 순서 — 새 랙: `guard → sweep → return → set(10) → raise(10) → done`(3.05 s), 리스팟 4핀: `guard → grip → lift → sweep →
return → set(4) → raise(4) → done`(4.05 s). 옆 레인 4개(cx ±1.61·±3.22)는 거리 감쇠 `0.42/(1+|cx|)` + LPF 1.4 kHz + 팬 `cx/6`.
⚠️ 발견한 버그 하나: rack 모드의 시프트 조건이 `>`라 cycleT가 정확히 0.55에 떨어지는 스텝에 ② 분기로 새어 `grip` 큐를
한 번 쐈다 — `>=`로 고쳤다(PinSet 주석). **일시정지·리플레이**엔 물리가 멈춰 사이클이 서는데 모터 노드는 돌므로
`Boot.applyPause`가 `setMachinePaused`로 기계 버스를 뮤트한다(실측 0 ↔ 1).

### 2.6 하우스 PA 차임 — 게임 이벤트 5종 (2026-09-02)

리얼·다이제틱 방향의 축하음: 관중이 아니라 **볼링장 천장 스피커(PA)가 내는 신호음**이다. 해금 차임과 같은 합성 `blip`을
쓰고, `paOut()` 필터 체인(HPF 300 · 2.2 kHz +3 dB 프레즌스 · LPF 6 kHz)을 거쳐 "저 위 스피커" 질감을 준다. 각 음엔 옥타브 위
배음을 18%로 얹어 종소리 광택을 낸다. 어휘는 §8.1대로 **좋은 일 = 상승 장3화음 아르페지오, 나쁜 일 = 하강, 세기 = 음 수**.

| 이벤트 | 음 | 길이 | 타이밍 |
|---|---|---|---|
| strike 스트릭 1·2·3·4+ | C5 E5 G5 (+C6 +E6 +G6) → 3·4·5·6음 | 0.9~1.2 s | **스틸컷 슬램과 같은 스텝** — 리플레이 프리즈 콜백 안(이벤트 시각이 아니다. 리플레이 중엔 크래시 재발화가 울린다) |
| spare | G5 → C6 | 0.6 s | 즉시 |
| gutter(0핀) | E4 → C4 삼각파, 느리게 | 0.7 s | 즉시 — 디플레이팅 |
| splitConverted | C5 F5 A5 C6 + 긴 종지 | 1.25 s | 즉시 — 가장 희귀하니 가장 길다 |
| gameOver 승/솔로 | C5 E5 G5 C6 종지 | 1.29 s | 결과 모달과 동시 |
| gameOver 무 | G5 G5 | 0.7 s | |
| gameOver 패 | E5 C5 G4 삼각파 | 1.1 s | |
| + 신기록 | 종지 꼬리에 C6 E6 C6 E6 트릴 | +0.25 s | 승 스팅어 1.54 s |

`playGameOverSting`은 길이를 돌려주고 Boot가 **해금 차임을 그 뒤에 잇는다**(`playUnlock(delay)`) — 같은 순간 울리면 둘이 뭉개진다.
실측(헤드리스): 스트라이크 차임 스텝 = 스틸컷 show 스텝(697 = 697), streak 인자 1, 크래시는 라이브 121·리플레이 414.

### 2.7 릴리스 트랜지언트 (2026-09-02)

굴림 럼블이 0에서 τ=0.02로 페이드인이라 소리에 '던진 순간'이 없었다. 실제 릴리스는 **엄지가 빠지는 팝 → 60 ms 뒤 공이 레인에
닿는 둥** 두 사건이라 그 순서로 합성한다. 게임은 공을 레인 높이에서 바로 발사하므로 낙차는 없지만 귀는 이 순서를 기대한다.

| 층 | 만드는 법 | 게인 |
|---|---|---|
| pop | 노이즈 HPF 3 kHz 4 ms | 0.05 (power 무관) |
| thud | 노이즈 LPF 180 Hz 90 ms + 사인 95→58 Hz 160 ms | 0.18 + 0.22·power |
| knock | 노이즈 BPF 420 Hz Q2 45 ms — 레인 보드의 '탁'. 없으면 둥이 킥드럼처럼 들린다 | 0.10 + 0.06·power |

훅은 `GameState.throwBall` 한 곳(`onThrow(power)`)이라 AI 투구도 같이 울린다. 리플레이 창(임팩트 전 1.3 s) 밖이라 재발화 없음.
실측: throwBall 스텝에 호출(power 0.62), 최대 power 단독 리미터 −0.55 dB.

### 2.8 옆 레인 굴림·크래시 (2026-09-02)

옆 레인 4개는 시각으론 공이 굴러 핀을 쳤는데 소리는 기계음만 있었다. `Environment.onAmbBall`이 `AmbBallCue`(cues.ts)를 보낸다:
- **roll** — 투구 시작. 속도 = 캔드 경로 평균(`(AMB_BALL_END_Z − BALL_START_Z) / rollT`, 4.9~6.5 m/s). SoundManager가 roll.wav를
  레인마다 따로 돌리고 게인·피치는 주 레인 `setRoll`과 같은 식(`t^1.5×0.85`, `0.85+0.4t`). 어택은 0.35 s로 흐릿하게(멀리서 들리는 굴림).
- **crash** — 핀이 처음 움직인 스텝(|v| > 0.5 m/s, `GameState.notifyImpact`와 같은 기준). 캔드 구간엔 핀이 움직일 일이 없어
  물리에 넘어간(`ballLive`) 뒤에만 본다. 세기 = 그 순간 서 있던 핀 수(최소 1). 굴림은 여기서 끊는다 — 주 레인이 PIN_DECK_END에서 끊는 자리.
- **stop** — 크래시 없이 settle로 넘어간 안전망.

출구는 기계음과 같은 `laneOut`(거리 게인 `0.42/(1+|cx|)` · LPF 1.4 kHz · 팬 `cx/6`)이라 `machineBus`는 사실상 **옆 레인 + 기계 버스**고
일시정지 뮤트도 그 전부에 걸린다. 실측 90 s: 굴림 22 · 크래시 18(핀 10·10·5·4·2…) · stop 2, roll→crash 3.0~3.7 s, 동시 굴림 최대 3.

---

## 3. 도안 §10과 갈린 지점 — 그대로 따르면 틀린다

| 도안 §10 | 실제 | 왜 |
|---|---|---|
| howler.js 또는 Web Audio | **Web Audio 직접** | 의존성 0. howler는 도입 안 함 |
| `CONTACT_FORCE_EVENTS`로 충돌 세기 읽기 | **안 쓴다** — 서 있던 핀 수로 스케일 | 슬로모 중 contact가 흩어져 '탭탭탭'이 됨 |
| 핀-핀 충돌 = 가벼운 딸각 | **없다** | 위와 같은 이유. 임팩트 1회로 통일 |
| 공-핀 충돌 임펄스로 볼륨·피치 | 핀 수로 볼륨·**길이** 스케일 | 1핀 0.3s ~ 풀랙 2.1s |
| 부팅 때 프리로드 | **첫 제스처에 지연 디코드** | 자동재생 정책상 ctx가 제스처 전엔 없음 |
| 메뉴 BGM | ~~합성 칩튠~~ → **mp3 트랙** | 2026-09-02 교체 |
| 보이스 풀링 / 최소 간격 | **불필요해졌다** | 임팩트가 투구당 1회라 폭주 자체가 없음 |

즉 §10의 **음원 목록(어떤 이벤트에 소리가 필요한가)은 여전히 유효**하지만,
**구현 방식 서술은 대부분 폐기됐다.**

---

## 4. 배관 — 마스터 버스 (2026-09-02 완료)

### 4.1 마스터 버스

```
(모든 소스) ──▶ masterGain ──▶ DynamicsCompressorNode ──▶ ctx.destination
                (볼륨·뮤트)      (리미터: 합을 눌러줌)
```

버스가 없던 시절 최악 합은 `굴림 0.85 + 크래시 1.0 + BGM 0.08 = 1.93`이었다 — ±1.0을 넘는 만큼 출력에서 하드
클리핑(지직)이고, 소리를 더 얹으려면 기존 게인을 전부 재조정해야 했다. 지금은 `SoundManager.bus()`가 ctx 생성과 같은
순간에 세워지고 네 소스가 전부 거기에 꽂힌다. `sound.volume`(0~1)이 전체 볼륨 한 손잡이다(아직 UI엔 안 노출).

| 리미터 파라미터 | 값 | 근거 |
|---|---|---|
| threshold | −2 dB (0.79) | 실측 리덕션: 굴림 최대 + 풀랙 크래시 겹침 **−2.34 dB** · 크래시 단독 −1.2 dB · 굴림 단독 −0.33 dB. 겹침에서만 본격적으로 물린다 |
| ratio | 20 : 1 | 리미터로 동작 |
| knee | 4 dB | −6 dB부터 완만하게 들어가 '벽에 부딪히는' 느낌 방지 |
| attack | 3 ms | Chromium 구현은 약 6 ms 룩어헤드(pre-delay)가 있어 크래시 첫 트랜지언트도 잡힌다 |
| release | 150 ms | 크래시 뒤 굴림·BGM이 눌린 채 머물면 '펌핑'. 짧게 |

⚠️ **DynamicsCompressorNode는 자동 메이크업 게인을 끌 수 없다** (Chromium: `(1/fullRangeGain)^0.6`).
threshold를 낮출수록 전체가 그만큼 커진다 — −2 dB에선 약 +1.1 dB라 상대 밸런스가 그대로여서 §2의 게인표를 다시
잡지 않았다. threshold를 −6 dB 이하로 내리면 그때는 `masterGain`으로 보정할 것.

`masterGain`은 리미터 **앞**이다 — 전체 볼륨을 내리면 리미터에 덜 걸리는 게 자연스럽다.

### 4.2 사운드 OFF는 마스터 뮤트로도 막힌다

예전엔 `enabled` setter가 '지속음'(굴림 럼블·BGM)을 **각각 찾아가서** 껐고, 새 루프를 거기 안 넣으면 사운드 OFF에서도
계속 울렸다. 지금은 setter가 그 둘을 여전히 멎게 하고(소스를 실제로 멈춰 CPU 절약) **추가로 마스터를 0으로 램프**한다.
새 소리는 `bus()`에만 꽂으면 되고 setter에 등록할 필요가 없다.

---

## 5. 효과음 백로그

### A. ~~`GameState.onEvent` 5종~~ — **완료(§2.6, 2026-09-02)**

strike(스트릭 차등)·spare·gutter·splitConverted·gameOver(승/무/패/신기록) 전부 PA 차임으로 붙었다.

### B. 물리·기계음 — 체감 기여 최대

| 지점 | 훅 | 메모 |
|---|---|---|
| ~~핀세터 사이클~~ | `PinSet.onCycle` | **완료(§2.5)** — 7단계 큐 + 합성 4층. 옆 레인 4개도 같은 큐로 감쇠 재생 |
| ~~릴리스 / 레인 착지~~ | `game.onThrow` | **완료(§2.7)** — 팝 + 둥 + 노크, power 비례 |
| **거터 진입** | [Boot.ts:493](../src/core/Boot.ts) | `setRoll(v, inGutter)`로 **플래그가 이미 넘어온다.** 진입 엣지만 잡으면 끝 |
| 데드우드 → 피트 낙하 | `PinSet` 스윕 ④단계 | 임팩트 1회 통일은 의도된 설계이니 별개 레이어로 |
| ~~옆 레인 굴림·크래시~~ | `environment.onAmbBall` | **완료(§2.8)** |
| 공 리턴 | — | 레일 연출이 씬에 있는지부터 확인 필요 |

### C. UI

| 지점 | 훅 |
|---|---|
| 파워 게이지 차징 / 릴리스 | [Controls.ts:497](../src/input/Controls.ts) · [:511](../src/input/Controls.ts) — `chargeDir`로 오르내리니 피치 연동 가능 |
| 스핀 조절 스텝 | [Controls.ts:465](../src/input/Controls.ts) — `SPIN_STEP` 단위 틱 |
| 조준 이동 | 미세 틱 (과하면 거슬림 — 주의) |
| 버튼 클릭 / 호버 | [Menu.ts:171](../src/ui/Menu.ts) `.menu-panel button` 스코프드 CSS가 이미 전 버튼 모션을 잡고 있어 같은 지점에 걸면 된다 |
| 스킨 장착 | [Menu.ts:689](../src/ui/Menu.ts) |
| 언어 변경 | [Menu.ts:582](../src/ui/Menu.ts) |
| 화면 전환 | `Menu.showScreen` / `showSkins` / `showLangs` |

### D. 연출 동기

| 지점 | 훅 |
|---|---|
| 스틸컷 슬램 | [StillCut.ts:123](../src/ui/StillCut.ts) — `strike`/`spare`/`gutter`/`split` 4종 |
| ~~슬로모 진입/복귀~~ | **완료(§2.3)** — 굴림 피치·LPF가 배속을 따라간다. 별도 진입음은 미정 |
| 리플레이 시작/종료 | [Replay.ts](../src/scene/Replay.ts) `start()` — 임팩트·굴림 재발화는 **완료(§2.4)**, 시작/종료 큐는 미정 |
| 일시정지/해제 | `loop.paused` — 사유가 둘(리플레이·메뉴)이라 합산 주의 |

### 우선순위 제안

1. ~~§4.1 마스터 버스~~ — **2026-09-02 완료**
2. ~~B 핀세터 사이클~~ — **2026-09-02 완료**(§2.5)
3. ~~A `onEvent` 5종~~ — **2026-09-02 완료**(§2.6)
4. ~~B 릴리스 트랜지언트~~ — **2026-09-02 완료**(§2.7)
5. ~~B 옆 레인 굴림·크래시~~ — **2026-09-02 완료**(§2.8)
6. **B 거터 진입 엣지 · 공 피트 낙하**
7. **C UI 틱**(클릭·차징·스핀 스텝 — 합성)

---

## 6. 에셋 대장

| 파일 | 크기 | 용도 | 출처 |
|---|---|---|---|
| `src/audio/roll.wav` | 383KB | 굴림 럼블 (심리스 루프로 가공) | — |
| `src/audio/strike.wav` | 388KB | 핀 크래시 | — |
| `src/audio/mi_music-reggae-ruckus-157890.mp3` | 1.5MB | 메뉴/매치 BGM | Pixabay |

**BGM 라이선스** — Pixabay "Reggae Ruckus" (업로더: Mi_Music), 48.013s · 44.1kHz 스테레오 · 256kbps.
다운로드 **2026-09-02**, Pixabay Content License (상업/비상업 무료, 출처표기 의무 없음).

⚠️ 날짜를 남기는 이유: Pixabay는 구 Pixabay License → 현 Content License로 조항을 개정한 이력이 있고
**적용 기준이 다운로드 시점**이다. 게임 내 배경음 재생은 허용 범위지만 **음원 파일 자체의 재배포·판매**와
**Content ID 등 저작권 관리 서비스 등록은 금지**다.

에셋을 추가하면 [CLAUDE.md](../CLAUDE.md)와 [README.md](../README.md)의 에셋 목록도 갱신할 것 —
둘 다 개수를 명시적으로 세고 있다.

---

## 7. 검증 방법

`SoundManager`를 참조하는 **테스트는 없다**(오디오는 4층 테스트 구조 밖이다). 브라우저에서 직접 잰다.
디버그 전역 `__sound`로 내부 상태를 읽을 수 있다.

```js
const s = __sound;
s.ctx.state;              // 'running'이어야 함
s.musicBuf.duration;      // 48.013 — mp3 디코드 성공
s.musicGain.gain.value;   // 메뉴 0.35 / 매치 0.08
s.rollMax;                // 0.85 (샘플) — setRoll 최초 호출 전엔 0.12(폴백)
s.setMenuMusic(false);    // Boot.ts:101이 매 프레임 하는 것과 동일
s.setRoll(5);             // 중속 굴림
s.masterGain.gain.value;  // enabled ? volume : 0
s.limiterReduction;       // 현재 게인 리덕션(dB, ≤0). 굴림 10.5 + 크래시 10핀을 겹치면 음수로 내려가야 한다
s.volume = 0.5;           // 마스터 볼륨 (아직 UI 미노출)
```

**리플레이 사운드를 보는 법**: 수동 tick에 **`__replay.record(__game.state)`를 `step` 앞에 꼭 넣어야** 한다(Boot.onStep 순서) —
빠지면 스냅이 없어 `replay.start()`가 false를 돌려 리플레이 자체가 안 뜬다. 리플레이 중엔 물리 대신 `__replay.update(1/60)`.
`__sound.playRackCrash`·`setRoll`을 래핑해 호출을 세면 라이브 1회 + 리플레이 1회가 나와야 한다. 스트라이크 재현은 `throwBall(-0.07/19.29, 1.0, 0)`.

**기계음 큐를 보는 법**: `__sound.machineCue`를 래핑해 (phase, dur, pins, lane.key)를 모으고, tick에 `__environment.update(dt, rolling, 1)`을
넣으면 옆 레인 큐(`amb±1.61`·`amb±3.22`)도 같이 온다. 새 랙은 6큐·리스팟은 8큐가 정답이고 `__sound.motors.size`는 done 뒤 0이어야 한다.
⚠️ `readyToThrow`가 사이클 중엔 false라 "던져서 끊기(cut)"는 게임 경로로 안 난다 — cut은 `toMenu()`(resetAll → finishCycle)로 본다.

**리미터가 실제로 물리는지 보는 법**: `s.setRoll(10.5); s.playRackCrash(10);` 직후 25 ms 간격으로 `s.limiterReduction`을
폴링한다(렌더 양자마다 갱신되는 읽기 전용 값). 2026-09-02 실측: 겹침 −2.34 → 300 ms 뒤 −1.3 dB(release 150 ms로 풀림),
크래시 단독 −1.2 dB, 굴림 단독 −0.33 dB. 사운드 OFF → `s.masterGain.gain.value` 0, ON → 1, `s.volume = 0.5` → 0.5.

### ⚠️ 함정 — 브라우저 패널에서는 오디오 시간이 멈춰 있다

패널은 페이지 입장에서 `document.hidden`이라 앱의 `visibilitychange` 핸들러가 `ctx.suspend()`를
부른다. 그러면 **`ctx.currentTime`이 멈춰** 모든 `setTargetAtTime`·램프가 얼어붙는다
(실측: wall 1.568s 흐르는 동안 audio **0s**). 증상은 "레벨 전환이 안 된다"로 보이는데 원인은 정지다.

```js
__sound.resume();   // 재기 전에 반드시. 이후 visibilitychange가 없으면 running으로 유지된다
```

CLAUDE.md의 헤드리스 함정 절은 rAF·`loop.stop()`만 다루고 **AudioContext 정지는 여기에만 적혀 있다.**

측정 시 대기 시간은 시정수에 맞춘다 — 굴림 `τ=0.02`(≈100ms), BGM 레벨 `τ=0.4`(≈2s), 페이드인 0.8s.

### BGM이 안 울릴 때

`setMenuMusic`은 `Loop.onFrame`에서 불리고, **숨은 탭은 `loop.stop()`으로 rAF가 한 프레임도 안 돈다**
→ 호출 자체가 없어 BGM이 시작되지 않는다. `startMusic()`은 버퍼 디코드 전이면 `musicOn`을 세우지 않고
빠져 다음 프레임에 재시도한다(세우면 영구 무음이 된다).

---

## 8. 레퍼런스 — 효과음을 어떻게 넣을 것인가 (2026-09-02 조사)

> 요약만 적는다. 원문은 아래 링크. 여기 적힌 수치는 문헌의 관례값이고 이 게임의 채택값은 §2·§4다.

### 8.1 설계 원칙

- **위계 4단을 먼저 정한다** — 배경(호버) · 보조(내비게이션) · 주요(확인·상태 변화) · 결정적(경고·최상급 이벤트).
  이 게임에선 결정적 = 스플릿 컨버전·스트라이크 스트릭, 주요 = 크래시·스페어, 보조 = UI, 배경 = 앰비언트.
- **주파수로 자리를 나눈다** — 무게감 200~500 Hz · 정보 1~5 kHz · 주의 환기 8 kHz+. 굴림 럼블이 저역을 차지하므로
  UI·축하음은 중고역에 둔다.
- **짧게** — UI 마이크로인터랙션 100~300 ms. **빠르게 반복되는 조작에는 소리를 넣지 않는다**(조준 이동 ✗).
- **반복 피로 방지** — 같은 소리를 다시 낼 때 `playbackRate`/`detune`을 아주 조금 흔들거나, 변주 여러 개를
  "직전 것 제외 랜덤"으로 고른다. 범위는 작을수록 자연스럽다.
- **일관성** — 확인·취소 소리는 모든 화면에서 같다. 예외는 의도적일 때만.
- **임팩트는 3층** — 트랜지언트(어택) · 바디(무게) · 테일(잔해·잔향). 층 하나를 바꾸면 변주가 된다.

### 8.2 볼링 특화

실제 볼링장의 소리 층(문헌 공통): 굴림 저역 럼블 · 스트라이크 크래시+클래터 · 단핀 톡 · **볼 리턴 럼블** ·
**핀세터 윙윙** · **릴리스 엄지 '팝'**. 이 게임은 앞 셋만 있다.

| 방식 | 예 | 특징 |
|---|---|---|
| 캐주얼·연출형 | Wii Sports 볼링 | 미스에 군중 부잉, 스플릿 처리에 스튜디오 "WOW", 임팩트 팝 + 컨트롤러 진동 |
| 리얼·다이제틱 | 필드 레코딩 기반 | 기계음·홀 앰비언스로 장소를 만들고 축하는 절제 |

비주얼이 미드센추리 하우스라 **리얼 쪽이 맞다.** 축하음도 군중보다 하우스 PA 차임·전광판 버저 같은
"그 장소에 있을 법한 소리"가 어울린다. (⚠️ 아직 사용자 확정 아님.)

### 8.3 Web Audio 구현 관례

- **컴프레서를 마지막 노드로** — 완료(§4.1). 자동 메이크업 게인은 스펙 이슈 #2639로 열려 있어 우회가 정석.
- **덕킹 관례값** — −9 dB · 어택 500 ms · 릴리스 1000 ms(대화 기준). 과하면 산만. 이 게임은 매치 중 BGM을
  상시 낮추는 **정적 덕킹**이라 크래시 순간 추가 덕킹은 선택 사항 — 넣는다면 −6 dB · 100 ms · 800 ms 정도의 짧은 형태.
- **변주** — `playbackRate` 또는 `detune`(센트). 소스를 여러 개 만들어 시작 시각을 살짝 엇갈리게.
- **슬로모** — Max Payne·Superhot 계열은 LPF 800 Hz 부근 + 약 −6 dB + 피치 다운. 피치는 **1옥타브 이상 내리면
  아티팩트**. 여기선 굴림 `playbackRate`·LPF를 `slowmoScale()`에 묶으면 된다.
- **모바일** — 제스처 언락은 완료. 프로그램 볼륨 제어가 막힌 기기가 있어 마스터 볼륨 UI는 "OS 볼륨 우선" 전제.
  디코드 PCM 메모리 주의(BGM만 17 MB). 오디오 스프라이트는 HTMLAudio 시절 기법 — 버퍼별 fetch인 여기엔 불필요.

### 8.4 음원 출처 실사 (CC0 필터)

| 필요한 소리 | Freesound CC0 | Pixabay |
|---|---|---|
| 핀세터 기계음(클로즈) | kyles "pin serving machine mechanism close" · craigsmith "from pin setting machine perspective" | 없음 |
| 핀세터(앰비언스 섞임) | felix.blume 기계실 뒤 · alexanderdanner 캔들핀 2건 — 통짜라 단계별로 쓰기 어려움 | 동일 2건 |
| 홀 앰비언스 | dagray 01a/01b(모노) · craigsmith R19-30 · 루프 가능 1건 | 1:37 · 11:04 필드 레코딩 |
| 단핀 톡 | 여러 건 | "Single bowling pin knock" |
| **볼 리턴 · 거터 · 릴리스 팝** | **없음** | **없음** |

볼 리턴·거터 진입·릴리스 팝은 CC0로 구하기 어렵다 → **합성 또는 기존 wav 가공.** Uppbeat "pin sweep"은
크레딧·구독 조건이 있어 BGM 때 기각한 **플랫폼 스코프 함정**과 같은 검토가 필요하다.

### 8.5 이 게임에 적용하면

1. **핀세터** — 필드 녹음은 통짜라 7단계에 못 맞춘다. 모터 험(저역 톱니 + LPF)·릴레이 클릭(짧은 노이즈 버스트)·
   핀 놓이는 탁(우드 노이즈)을 합성해 단계 콜백에 얹거나, craigsmith 녹음을 원샷 서너 개로 잘라 쓴다.
   옆 레인은 같은 소리를 감쇠·LPF해 재사용.
2. **크래시 변주** — 단일 샘플이라 매번 같다. `playbackRate` ±3% + 시작 오프셋 미세 변화.
3. **축하음** — 리얼 방향이면 하우스 PA 차임 2~3음(해금 차임과 같은 합성 계열)으로 스트라이크·스페어·컨버전을 음정만
   다르게. 거터는 하강 톤.
4. **UI** — 클릭만(터치 전제라 호버 없음), 100~200 ms, 확인 = 협화음 · 취소 = 낮은 단음. 조준 이동엔 넣지 않는다.
5. **슬로모** — 굴림 `playbackRate` 0.5~1.0 + LPF 800 Hz를 진행도에 묶는다.
6. **덕킹** — 정적 레벨로 충분하면 생략.

### 출처

- [Best Practices for Game UI Sounds — SFX Engine](https://sfxengine.com/blog/best-practices-for-game-ui-sounds)
- [Game Sound Design: Principles — gamedesignskills](https://gamedesignskills.com/game-design/sound/)
- [Audio feedback in games — audiogamejam.org](https://audiogamejam.org/audio-feedback-in-games/)
- [UI Sound Design Guide — uisfx.com](https://uisfx.com/ui-sound-design)
- [Impact Sound Effect Guide — SFX Engine](https://sfxengine.com/blog/impact-sound-effect)
- [Bowling sounds — Morphic](https://morphic.com/resources/sounds/bowling-sound-effects) · [Bowling — Evocative Sound](https://www.evocativesound.com/2024/10/31/bowling/)
- [Wii Sports — Soundeffects Wiki](https://soundeffects.fandom.com/wiki/Wii_Sports)
- [Developing game audio with the Web Audio API — web.dev](https://web.dev/articles/webaudio-games) · [Audio for Web games — MDN](https://developer.mozilla.org/en-US/docs/Games/Techniques/Audio_for_Web_Games)
- [Sound Effect Variation — Andrew Mushel](https://andrewmushel.com/articles/sound-effect-variation-in-unity/)
- [Game Audio Theory: Ducking — Game Developer](https://www.gamedeveloper.com/audio/game-audio-theory-ducking) · [Side-chaining in Wwise — MCV](https://mcvuk.com/development-news/audio-guide-side-chaining-in-wwise/)
- [DynamicsCompressorNode makeup gain — WebAudio #2639](https://github.com/WebAudio/web-audio-api/issues/2639)
- [Slow motion sound effects — Morphic](https://morphic.com/resources/sounds/slow-motion-sound-effects) · [timeScale와 오디오 피치 — Bugnet](https://bugnet.io/blog/fix-unity-timescale-affecting-audio-pitch)
- Freesound CC0 검색: [pinsetter](https://freesound.org/search/?q=pinsetter&f=license%3A%22Creative+Commons+0%22) · [bowling machine](https://freesound.org/search/?q=bowling+machine&f=license%3A%22Creative+Commons+0%22) · [bowling](https://freesound.org/search/?q=bowling&f=license%3A%22Creative+Commons+0%22)
- [Pixabay bowling SFX](https://pixabay.com/sound-effects/search/bowling/) · [Uppbeat pin sweep](https://uppbeat.io/sfx/bowling-alley-pin-sweep/10793/26831)
