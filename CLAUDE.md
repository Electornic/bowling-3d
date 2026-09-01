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

단일 테스트 / 게이트된 테스트:

```bash
npx vitest run tests/scoreboard.test.ts
AI_SIM=1 npx vitest run tests/ai-match-sim.test.ts
```

`tests/ai-match-sim.test.ts`는 `describe.runIf(process.env.AI_SIM)`으로 **기본 skip**이다
(헤드리스 매치 sim이라 느리다). `AI_SIM_N`(기본 120) · `AI_SIM_OIL`(기본 `house,short,long`) ·
`AI_SIM_DEBUG`로 조절한다. `npm test`가 "1 skipped"를 보고하는 건 정상이다.

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
const tick = () => { __engine.step(1/60); __game.update(1/60); __engine.sync(1); __cameraRig.update(1/60, 1); };
```

**스크린샷은 탭을 깨워 루프를 재개시킨다.** 특정 프레임을 잡으려면 대상을 실제로 정지시켜야
한다(예: 공의 linvel·angvel을 매 스텝 0으로 눌러 고정). 안 그러면 캡처된 이미지가 측정한
상태와 다르다 — 실제로 그 차이를 버그로 오진한 적이 있다.

`document.hidden`이면 `innerWidth/innerHeight`가 **0**일 수 있고, 뷰포트를 바꿔도
`camera.aspect`가 낡은 값으로 남는다. 레이아웃·프레이밍을 재기 전에 리로드해서 aspect를 확인한다.

디버그 전역(`Boot.ts` 하단): `__game` `__ball` `__pins` `__engine` `__environment` `__cameraRig`
`__sound` `__controls` `__unlockAllRewards` `__resetRewards`.

## 서로를 모르는 채 커플링된 상수들

가장 자주 조용히 깨지는 부분이다. **한쪽만 바꾸면 다른 쪽이 깨진다.**

- **핀 베이 개구부 ↔ 카메라 포즈.** 핀덱 위가 캐노피로 덮여 있어서, 카메라에서 핀 꼭대기로 가는
  시선이 개구부 앞모서리를 넘으면 핀이 잘린다. `PIN_BAY_TOP`·`APPROACH_POS`·`GAMEOVER_POS`가
  얽혀 있고 [tests/camera-sightline.test.ts](tests/camera-sightline.test.ts)가 그 커플링을
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
- **오일 광택 시트는 마름을 안 따라간다** (알려진 불일치). `Lane.applyOilVisual`이 매치 시작에
  프리셋 `endZ`로 한 번만 깔지만, `advanceOilDrying`이 프레임마다 실제 endZ를 최대 1.5m 당긴다.
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

- **`docs/`의 셋만 현재 문서다**: `GAME_DESIGN.md`(설계 도안 — 코드 주석이 "도안 §N"으로 참조) ·
  `MOBILE_SUPPORT.md` · `APP_PACKAGING.md`.
- **`docs/legacy/`는 그때의 근거·측정 기록**이다. 코드 주석이 절 번호로 참조하므로 지우지 않지만,
  **현재 상태의 서술로는 믿지 말 것.** 특히 `PROGRESS.md`는 2026-07-13에서 멈춰 있다.
- **기능이 실제로 어떻게 굴러가는지는 코드와 커밋 메시지가 단일 소스다.** 이 리포는 커밋 메시지에
  근거·실측·대안 검토를 길게 남기는 관례가 있다 — 왜 이 값인지 궁금하면 `git log`가 문서보다 낫다.
- **외부 에셋은 사운드 둘뿐**이다: `src/audio/roll.wav`(383KB)·`strike.wav`(388KB). 나머지
  (도형·텍스처·UI·해금 차임·메뉴 BGM)는 전부 코드 생성이다. README가 오래 "에셋 0개"라고
  적고 있었는데 2026-09-01에 고쳤다 — 번들 크기를 볼 때 이 둘을 빼먹지 말 것.

## 손대지 말 것

- **단일 청크 2.9MB(gzip ~1.0MB) 빌드 경고는 의도된 트레이드오프다.** three + rapier WASM이 부팅
  시 전부 필요하고 터미널 로더 연출이 그 시간을 덮는다. 코드 스플리팅으로 "고치지" 말 것.
- 물리·점수·AI 사다리에 영향이 가는 값(`constants.ts`의 마찰·스핀·캐리 튜닝)은 눈으로 A/B 하지
  말고 sim으로 재라 — `AI_SIM` 게이트와 `sim-carry.mjs`가 그 용도다.

## 커밋

- 메시지는 **한국어**, conventional-commit 접두어(`feat`·`fix`·`polish`·`refactor`·`revert`).
- 제목은 무엇을 바꿨는지 + **왜**를 한 줄로. 본문에 근거·실측 수치·고려한 대안·남은 리스크를 적는다.
  이 리포에서 커밋 메시지는 사실상 설계 기록이다.
- 요청받지 않은 push·merge는 하지 않는다.
