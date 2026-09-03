# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

브라우저 3D 볼링 게임 (Three.js + Rapier WASM + TypeScript, Vite). 같은 코드를 Tauri v2로
데스크톱·모바일 앱으로도 패키징한다. 개요·조작·물리 하이라이트는 [README.md](README.md).

## 명령

```bash
npm run dev            # 개발 서버 http://localhost:5173
npm run build          # tsc 타입체크 + vite build → dist/
npm test               # Vitest watch
npx vitest run         # 1회 실행 (CI 용도)
npx tsc --noEmit       # 타입만
```

## 테스트는 4층이다 — 어디에 새 테스트를 넣을지 여기서 정한다

```
tests/unit/       순수함수 (점수·스플릿·보상·이징) — 의존성 0
tests/scenarios/  사용자 시나리오 E2E — 가짜 씬으로 GameState 상태머신을 끝까지 굴린다
tests/sim/        실물리 측정 (Rapier) — 대부분 env 게이트
tests/geometry/   씬 상수 커플링 회귀 (카메라 시선·핀덱 레이아웃)
tests/helpers/    headless.ts(Rapier 한 벌) · fakeScene.ts(가짜 씬 한 벌)
```

**`scenarios/`가 기본값이다.** "사용자가 겪는 흐름"이 조금이라도 걸리면 여기 쓴다.
[tests/helpers/fakeScene.ts](tests/helpers/fakeScene.ts)가 `Ball`·`PinSet`·`Hud`·`Lane`을 스텁으로
갈아끼워 Three·Rapier 없이 `throwBall → ROLLING → SETTLING → score → finishFrame → gameOver`
전 구간을 밀리초 단위로 돌린다(`GameState`가 넷을 전부 `import type`으로만 받아서 가능하다).

```ts
const m = createMatch({ mode: 'full', players: [{ name: 'ME' }] });
m.roll({ knock: 10 });        // 스트라이크
m.roll({ leave: [7, 10] });   // 7-10 남기기
m.roll({ gutter: true });     // 거터
m.aiRoll({ knock: 4 });       // AI가 스스로 던질 때까지 펌프한 뒤 정산
m.events / m.hud.views / m.summary / m.impacts / m.timeScales / m.pins.cycles
```

⚠️ 스텁은 **무엇이 쓰러지는지를 물리로 정하지 않는다** — 테스트 스크립트가 정한다. 캐리·조준·
훅 척도는 `sim/`과 `sim-carry.mjs`의 몫이다. 스텁 시그니처는 `Pick<진짜클래스, …>`로 묶여 있어
협력자 API가 바뀌면 `npm run build`(tsc)가 깨진다 — 멤버를 추가하면 `Used*` 타입에도 적을 것.

단일 테스트 / 게이트된 테스트:

```bash
npx vitest run tests/scenarios          # 시나리오 E2E만 (수십 ms)
npx vitest run tests/unit/scoreboard.test.ts
AI_SIM=1 npx vitest run tests/sim/ai-match-sim.test.ts
```

게이트된 sim은 `describe.runIf(env)`로 **기본 skip**이다 — `npm test`가 "4 skipped"를 보고하는 건 정상이다.
모션·조준 셋은 [tests/helpers/headless.ts](tests/helpers/headless.ts)(레인 폭 평판 하나) 위에서 굴리고,
거터 스캔만 [tests/helpers/laneWorld.ts](tests/helpers/laneWorld.ts)(거터·캐핑·킥백·피트까지 실제 지오메트리)를
쓴다 — 옆으로 벗어난 공의 행선지는 평판으로는 물을 수 없다. 둘 다 상수는 `constants.ts`를 **import**한다(게임과 1:1). `sim-carry.mjs`는 `.ts`를 못 import해 상수를 **복사**하므로 값이 갈릴 수 있다 —
핀 캐리 스캔에만 쓰고 모션·조준은 아래를 쓴다. ⚠️ vitest는 통과한 테스트의 `console.log`를 숨긴다 —
표를 보려면 `--reporter=verbose`.

```bash
BALL_SIM=1 npx vitest run tests/sim/ball-motion-sim.test.ts --reporter=verbose   # 볼 모션 척도(속도·감속·스키드·애펙스·훅·진입각) vs 실볼링
BALL_SIM=1 BALL_SIM_OVERRIDE='{"rollRatio":0.85,"spinRate":20}' npx vitest run tests/sim/ball-motion-sim.test.ts --reporter=verbose  # 레버 스윕
AI_CAL=1 npx vitest run tests/sim/ai-calibrate.test.ts --reporter=verbose        # AI 포켓·훅 드리프트 스캔 (ai.ts 상수 근거)
AI_SIM=1 npx vitest run tests/sim/ai-match-sim.test.ts --reporter=verbose        # AI 사다리 점수 분포 (AI_SIM_N 기본 120). 오일은 하우스 하나
GUTTER_SIM=1 npx vitest run tests/sim/gutter-return-sim.test.ts --reporter=verbose # 거터볼 행선지 — 레인 복귀·무효 핀폴 (아래 '거터 래치' 절)
```

`tests/sim/predict.test.ts`(항상 실행)는 조준선 적분기 `predict.ts`를 Rapier와 대조한다 — 발사 물리를
바꾸면 조준선이 거짓말하는지 여기서 잡힌다.

앱 패키징은 `npm run app:dev` · `ios:dev` · `android:dev` (준비물은
[docs/APP_PACKAGING.md](docs/APP_PACKAGING.md)).

**빌드가 코드와 무관하게 깨지면 `npm install`부터.** node_modules가 낡으면 tsc가 엉뚱한 곳에서
터진다.

## 시간축이 둘이다 — 이 구조를 모르면 어디에 코드를 넣을지 틀린다

[Loop.ts](src/core/Loop.ts)가 고정 timestep accumulator를 돌리고 콜백을 **두 개** 받는다.
[Boot.ts](src/core/Boot.ts)가 그 배선의 단일 지점이다.

| | 언제 | 여기서 도는 것 |
|---|---|---|
| `onStep(dt)` | 물리 스텝마다 (고정 1/60) | `replay.record` → `game.update` |
| `onFrame(dt)` | 렌더 프레임마다 (가변) | `controls.update` → `cameraRig.update` → `environment.update` |

- **물리 dt는 절대 스케일하지 않는다.** `loop.timeScale`(AI 빨리감기·슬로모)은 accumulator
  **유입 시간만** 스케일하고 각 스텝은 `FIXED_DT`를 유지한다 — 결정성·궤적 검증 때문이다.
  시간에 기대는 연출은 `timeScale`을 인자로 받아 자기가 곱한다.
- `loop.paused`는 **물리만** 멈춘다. `onFrame`과 render는 계속 돈다. 그래서 일시정지·리플레이
  중에 시간을 쓰는 것들(파워 차징·옆 레인 사이클)을 각자 얼려줘야 한다 — 안 그러면 물리는
  멈춘 채 게이지만 오르고 옆 레인 핀이 순간이동한다. 일시정지 사유가 둘(리플레이·메뉴)이라
  하나의 `paused`를 공유하니 합산해서 쓴다.
- `Engine.sync(alpha)`가 물리 위치를 **메시로 보간**한다. `Engine.step()`만 부르면
  `mesh.position`은 안 움직인다 — `CameraRig`가 보간된 메시 위치를 추적하므로 카메라도 안 움직인다.

## 프리뷰에서 검증할 때 (헤드리스 함정)

**⚠️ 최악의 함정: `Engine.step(dt)`에 dt를 빼면 안 된다.** 생략하면 `world.timestep=undefined`
→ NaN → 약 6스텝째에 `RuntimeError: unreachable` 패닉이 뜨고, 그 패닉이 **WASM borrow를
누수시켜 이후 모든 호출이 "recursive use of an object"** 가 된다. 에러는 마지막으로 부른 API에서
뜨므로 엉뚱한 함수를 범인으로 오진하게 된다. 그 에러를 만나면 그 함수를 의심하지 말고 **직전에
dt 없는 step이 있었는지** 부터 보고, 페이지를 리로드한다.

숨은 탭에서는 `visibilitychange` 핸들러가 `loop.stop()`을 부르므로 **rAF가 한 프레임도 안
굴러간다**(버그 아님). GIF 프레임도 안 넘어가고 무음 `<video>`는 `paused`로 남고 부팅 로더가
안 걷힌다. 수동 구동 패턴:

```js
const tick = () => { __replay.record(__game.state); __engine.step(1/60); __game.update(1/60); __engine.sync(1); __cameraRig.update(1/60, 1); };
```

`__replay.record`를 빼면 스냅이 없어 스트라이크 리플레이가 뜨지 않는다(`start()`가 false). 리플레이가 활성이면 그 프레임은
물리 대신 `__replay.update(1/60)`만 부른다(Boot.onFrame과 같은 분기).

**스크린샷은 탭을 깨워 루프를 재개시킨다.** 특정 프레임을 잡으려면 대상을 실제로 정지시켜야
한다(예: 공의 linvel·angvel을 매 스텝 0으로 눌러 고정). 안 그러면 캡처된 이미지가 측정한
상태와 다르다 — 실제로 그 차이를 버그로 오진한 적이 있다.

`document.hidden`이면 `innerWidth/innerHeight`가 **0**일 수 있고, 뷰포트를 바꿔도
`camera.aspect`가 낡은 값으로 남는다. 레이아웃·프레이밍을 재기 전에 리로드해서 aspect를 확인한다.

**오디오도 같이 멈춘다** — `visibilitychange` 핸들러가 `ctx.suspend()`를 부르므로 `ctx.currentTime`이
정지하고 모든 게인 램프가 얼어붙는다(실측: wall 1.568s에 audio 0s). 증상은 "레벨 전환이 안 된다"로
보이는데 원인은 정지다. 재기 전에 `__sound.resume()`. 상세는 [SOUND.md §7](docs/SOUND.md).

디버그 전역(`Boot.ts` 하단): `__game` `__ball` `__pins` `__engine` `__environment` `__cameraRig`
`__sound` `__controls` `__stillCut` `__replay`(숨은 탭에선 `__replay.update(1/60)`로 손수 굴린다) `__unlockAllRewards`
`__resetRewards` `__previewScreenUnlock`(결과 화면의 전광판 해금 박스 미리보기 — 보상을 전부 해금 상태로 바꾸니 끝나면
`__resetRewards()`).

## 서로를 모르는 채 커플링된 상수들

가장 자주 조용히 깨지는 부분이다. **한쪽만 바꾸면 다른 쪽이 깨진다.**

- **핀 베이 개구부 ↔ 카메라 포즈.** 핀덱 위가 캐노피로 덮여 있어서, 카메라에서 핀 꼭대기로 가는
  시선이 개구부 앞모서리를 넘으면 핀이 잘린다. `PIN_BAY_TOP`·`APPROACH_POS`·`GAMEOVER_POS`가
  얽혀 있고 [tests/geometry/camera-sightline.test.ts](tests/geometry/camera-sightline.test.ts)가 그 커플링을
  붙잡는다. 카메라 포즈를 손대면 이 테스트를 먼저 본다.
- **릴리스 팔로우는 상수가 아니라 임팩트 포즈에서 유도된다** (2026-09-01 리니어 체이스 정식화).
  `approachZFor(fov, aspect)`가 파킹 z를 정하고, 체이스 거리는 `HEADPIN_Z − 그 값`이며, 파킹은
  별도 목적지가 아니라 **클램프 상한**이다(체이스가 헤드핀에서 정확히 거기 닿는다).
  높이도 하나다 — `APPROACH_POS.y`가 곧 팔로우 높이(`FOLLOW_Y`)다. 위치 블렌드도 dolly 속도
  상한도 없으니 **그 둘을 다시 넣으려 하지 말 것**(서지의 원인이 그 블렌드였다).
  ⚠️ 세로폰은 가로 화각이 좁아 더 물러난다. 그래서 "데스크톱에서 좋아 보이는 카메라 값"이
  모바일에서 반대로 동작할 수 있다 — 실측 임팩트 간격 데스크톱 1.44m vs 세로폰 3.13m.
- **리플레이 카메라 높이 = 라이브 높이**(`REPLAY_CAM_Y = APPROACH_POS.y`, 2026-09-02에 정리).
  전에는 공 위 0.42 오프셋으로 0.5285에 앉아 라이브(0.45)보다 8cm 높았고, 전광판 점유율이
  라이브 12.45% < 리플레이 파킹 18.21%로 **역전**돼 있었다(미결 항목이었다 — 이제 닫혔다).
  ⚠️ **높이만 낮추면 반대로 나빠진다.** 시선 목표가 그대로면 낮출수록 광축 피치가 완만해져 프레임
  위쪽이 더 열린다 — 점유율을 지배하는 건 높이가 아니라 **피치**다(높이만 내렸을 때 파킹 9.55% /
  추적 34.2%로 추적이 악화). 높이와 `REPLAY_LOOK_Y_OFF`를 **함께** 내려야 한다
  (채택: 0.45 / −0.04 → 파킹 4.98% · 추적 30.6%). 스윕 실측표는 `Replay.REPLAY_LOOK_Y_OFF` 주석.
- **거터 래치는 상태 분기 밖에 있어야 한다** (2026-09-02 수정 · `GameState.latchLaneExit`).
  SETTLING 전환 문턱(`|x| > LANE_WIDTH/2 − BALL_RADIUS` = 0.416)이 래치 문턱(`|x| > LANE_WIDTH/2` = 0.525)보다
  **앞**이다. 그래서 래치를 ROLLING 분기 안에 두면 공이 0.416에서 빠져나간 뒤 0.525를 넘어도 코드가 안 돈다 —
  두 문턱을 한 스텝(1/60s)에 건너뛰려면 횡속 6.5 m/s가 필요한데 실제 훅은 1~2 m/s대라 **사실상 영영 안 걸린다.**
  그 사이 [Lane.ts](src/scene/Lane.ts)는 거터 깊이를 옛 0.13에서 규격 `GUTTER_DEPTH`(0.0476)로 낮추면서
  *"공 중심을 눌러 옆면이 막게 하던 역할은 래치가 대신한다"*고 적어, **대체재가 안 도는 채로 원래 방어를 걷은**
  상태였다. 규격 깊이 거터는 홈에 앉은 공이 코너 핀(7·10)에 11.6mm 파고들 만큼 얕다(`Ball.setPinCollision` 주석).
  실측(`GUTTER_SIM=1`, 조준 범위 ±`AIM_RANGE` 안): 옛 배치는 거터볼 60개 중 래치 0 · **무효 핀폴 113핀**,
  현재 배치는 **0핀**(래치 60/60) · 레인에 남은 79투구는 핀폴 전부 동일. 복귀 지점은 전부 z≈19.0(핀덱)이라
  기전은 벽 반동이 아니라 **핀과의 직접 접촉**이다.
  ⚠️ 래치엔 `z ≤ PIN_DECK_END` 가드가 붙어 있다 — 피트에서 새로 잠그면 굴러떨어지는 핀이 공을 통과한다.
  ⚠️ **훅 측면력엔 별도 가드가 필요 없다.** `applySpinForce`는 ROLLING에서만 불리고 ROLLING은 0.416에서
  끝나는데, 그때 공은 아직 레인 위(0.416 + 0.109 = 레인 끝)다 — 거터에 앉은 공에 훅이 걸린 스텝은 실측 **0회**다.
- **거터 깊이를 바꾸면 `GameState`의 perch 보정도 같이 봐야 한다** (2026-09-02 정리).
  `settleGutterPerch`가 "골에 앉았는가"를 판정하고 앉힐 y를 정하는데, 그 기준이 `GUTTER_SEAT_Y =
  BALL_RADIUS − GUTTER_DEPTH`(0.061)다. 예전엔 상수 없이 옛 깊이 0.13을 하드코딩(`t.y <= -0.01`,
  `y = -0.13 + BALL_RADIUS`)하고 있어서, Lane이 규격 깊이로 옮겨간 뒤 ① 이미 골을 잘 굴러가는 거터볼까지
  **매번 재보정**하고 ② 공을 골 바닥보다 8.2cm 아래로 처박아 한 프레임 파묻혔다 튀어나왔다.
- **오일 광택 시트는 마름을 안 따라간다** (알려진 불일치). `Lane.applyOilVisual`이 매치 시작에
  `OIL_END_Z`(11.9 m, 오일은 하우스 하나)로 한 번만 깔지만, `advanceOilDrying`이 프레임마다 실제 endZ를 최대 1.5m 당긴다.
  후반 프레임에선 "어디서 꺾이는지"의 시각 단서가 실제 브레이크 지점보다 뒤에 있다.
- **좁은 화면 판정이 두 곳에 있다.** [Hud.ts](src/ui/Hud.ts)의 `NARROW_Q`(JS)와 주입 CSS의
  `@media (max-width:760px)`가 **같은 값이어야** 한다. 갈리면 알약/시트 가시성과 5칸 청크가
  서로 다른 폭에서 전환된다.

## UI 규칙

- **가시성은 클래스로만 다룬다.** 인라인 `style.display`는 항상 미디어 쿼리를 이기므로 한 곳이라도
  인라인으로 쓰면 좁은 화면 분기가 죽는다.
- **flex-basis:0 셀에는 부모의 정해진 폭이 필요하다.** 안 정해지면 내용폭으로 무너져 빈 칸이
  찌그러진다. `fit-content`로는 안 되고, 뷰포트 기준 값이나 이미 폭이 정해진 부모의 `100%`를 쓴다.
  ⚠️ **검증은 빈 상태로** 하라 — 채운 콘텐츠가 collapse를 가린다.
- **`Line2`(조준선)에 알파를 쓰지 말 것.** 정점마다 라운드 캡을 그려 인접 세그먼트가 선폭 절반씩
  겹치므로, `opacity < 1`이면 이음매마다 알파가 두 번 곱해져 얼룩·점선처럼 보인다. 톤은 색값으로만
  조절한다. 정점 간격도 선폭보다 촘촘해지면 같은 증상이 나므로 `MIN_SEG_PX`가 선폭에서 파생된다.
- 점수 시트는 HUD와 결과 모달이 [Hud.ts](src/ui/Hud.ts)의 `buildSheet` **한 벌을 공유**한다.
  마크 규칙과 좁은 화면 5칸 2줄 접기가 갈리지 않게 하려는 것이니, 분기가 필요하면 `SheetOpts`에
  인자를 추가한다.

## i18n

규칙의 단일 소스는 [src/i18n/index.ts](src/i18n/index.ts) 주석이다. 요점만:

1. **`ko`가 원본 사전**이고 나머지는 `Record<I18nKey, string>`이다 → 번역 누락이 **tsc 에러**로
   잡힌다. 키를 추가·삭제할 때 4개 로케일을 함께 건드린다.
2. **모듈 로드 시점에 문자열을 굳히지 않는다.** 데이터 레코드(스킨·업적·AI 프로필)는 문자열이 아니라
   **키**를 들고, 그릴 때 `t()`로 푼다. 안 그러면 언어를 바꿔도 옛 언어가 남는다.
3. `<html lang>`을 반드시 갱신한다 — `system-ui`는 한·중·일이 한자 글리프를 공유해서 lang이
   틀리면 일본어 화면에 중국어 자형이 나온다.

## 문서 신뢰도

- **`docs/`의 넷만 현재 문서다**: `GAME_DESIGN.md`(설계 도안 — 코드 주석이 "도안 §N"으로 참조) ·
  `MOBILE_SUPPORT.md` · `APP_PACKAGING.md` · [`SOUND.md`](docs/SOUND.md).
  ⚠️ **사운드는 도안 §10과 구현이 여러 군데 갈렸다**(howler.js·핀-핀 딸각·contact force 방식 전부 미채택).
  §10은 *설계 의도*이니 사운드 작업은 `SOUND.md`(현재 상태·게인 실측·효과음 백로그)를 먼저 볼 것.
- **`docs/legacy/`는 그때의 근거·측정 기록**이다. 코드 주석이 절 번호로 참조하므로 지우지 않지만,
  **현재 상태의 서술로는 믿지 말 것.** 특히 `PROGRESS.md`는 2026-07-13에서 멈춰 있다.
- **기능이 실제로 어떻게 굴러가는지는 코드와 커밋 메시지가 단일 소스다.** 이 리포는 커밋 메시지에
  근거·실측·대안 검토를 길게 남기는 관례가 있다 — 왜 이 값인지 궁금하면 `git log`가 문서보다 낫다.
- **외부 에셋은 사운드 셋뿐**이다: `src/audio/roll.wav`(383KB)·`strike.wav`(388KB)·
  `mi_music-reggae-ruckus-157890.mp3`(1.5MB, 메뉴/매치 BGM). 나머지(도형·텍스처·UI·해금 차임)는
  전부 코드 생성이다(핀세터 기계음·피트 사슬·UI 틱도 합성 — `machineSynth.ts`·`pitSfx.ts`·`uiSfx.ts`. 파라미터는 눈으로 A/B 하지 말고 OfflineAudioContext 렌더로 잰다 — SOUND.md §7. 스틸컷은 무음이다, §2.6). README가 오래 "에셋 0개"라고 적고 있었는데 2026-09-01에 고쳤고, BGM은
  2026-09-02에 합성 칩튠에서 실제 트랙으로 바뀌었다 — 번들 크기를 볼 때 이 셋을 빼먹지 말 것.

## 손대지 말 것

- **단일 청크 2.9MB(gzip ~1.0MB) 빌드 경고는 의도된 트레이드오프다.** three + rapier WASM이 부팅
  시 전부 필요하고 부팅 로더 연출(핀 랙 세팅 → 스트라이크, `index.html` 인라인)이 그 시간을 덮는다. 코드 스플리팅으로 "고치지" 말 것.
- 물리·점수·AI 사다리에 영향이 가는 값(`constants.ts`의 마찰·스핀·캐리 튜닝)은 눈으로 A/B 하지
  말고 sim으로 재라 — `BALL_SIM`·`AI_CAL`·`AI_SIM` 게이트가 그 용도다(명령 절). 2026-09-02 실척도
  재매핑의 기준은 **관측 가능한 궤적 수치**(릴리스/도달 속도·감속·스키드 끝·애펙스·진입각·훅 보드)다.
  내부 rpm을 실제에 맞추려 `SPIN_RATE`·`ROLL_RATIO`를 건드리면 관측값이 실제를 벗어난다(constants 주석).
  발사 물리를 바꾸면 `ai.ts`의 포켓·훅 드리프트를 `AI_CAL`로 다시 잡고 `AI_SIM`으로 사다리를 재확인한다.

## 커밋

- 메시지는 **한국어**, conventional-commit 접두어(`feat`·`fix`·`polish`·`refactor`·`revert`).
- 제목은 무엇을 바꿨는지 + **왜**를 한 줄로. 본문에 근거·실측 수치·고려한 대안·남은 리스크를 적는다.
  이 리포에서 커밋 메시지는 사실상 설계 기록이다.
- 요청받지 않은 push·merge는 하지 않는다.
