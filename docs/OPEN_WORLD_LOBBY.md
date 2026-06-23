# 오픈월드 로비 — 대기실 / 게임장 구조 + 가로 전환 (설계)

> 작성: 2026-06-23 (오픈월드 개조 논의 세션). 현재 **"유령 볼러 + 레일 카메라 + DOM 메뉴"**
> 구조 위에, **"걸어다니는 대기실 → 레인 접근 → 게임장(볼러 모션이 보이는)"** 흐름을 얹는 개조.
>
> **상태: 슬라이스 1·2 + 2-씬 아키텍처 구현·커밋·푸시됨 (`de6dcaa`, develop=origin/develop) — 아래 "## 구현 현황" 참조.** 설계 시 실제 코드를 읽고 확인:
> [Engine.ts](../src/core/Engine.ts) · [CameraRig.ts](../src/camera/CameraRig.ts) ·
> [GameState.ts](../src/game/GameState.ts) · [ai.ts](../src/game/ai.ts) ·
> [Environment.ts](../src/scene/Environment.ts) · [Lane.ts](../src/scene/Lane.ts) ·
> [Ball.ts](../src/scene/Ball.ts) · [rewards.ts](../src/game/rewards.ts) ·
> [device.ts](../src/core/device.ts) · [tauri.conf.json](../src-tauri/tauri.conf.json).
>
> **핵심 결정 (이 세션):** 모바일은 **가로 고정(landscape lock)**. "세로 화면 ⟂ 오픈월드"는
> 구조적 모순(좁고 긴 열쇠구멍 vs 넓게 누비기)이라, 어떤 세로용 조작을 넣어도 절반은 깎인다 →
> **가로로 통일**해 조이스틱 자유보행을 복원한다. 데스크탑은 네이티브 가로(1280×800)라 **같은
> 레이아웃을 공짜로 재사용**하고, 갈리는 축은 화면이 아니라 **입력**(키보드/마우스 vs 터치)뿐이다.
>
> **범위 밖(보류):** 스마트컨트랙트/토큰 연동은 별도 논의로 미룸 — 이 문서는 클라이언트 구조만.
>
> **v2 (2026-06-23): 2차 독립 검토 + 웹 리서치 반영** — §11 미해결 설계 결정 추가(릴리스 페이즈 삽입점·AI/핫시트 처리·로비 걸을 영역 등), Tauri iOS 보강, 로비 이동 KCC 대안, 모바일 드로우콜 예산, 레퍼런스 확장. (검토: 서브에이전트가 실제 코드 대조.)
>
> **v3 (2026-06-23): 3차 검토 반영** — "릴리스 타이밍(기존 파워밴드)" ↔ "릴리스 페이즈(신규 스윙 비주얼)" 용어 disambiguation(§5.1), iOS Safari `ScreenOrientation.lock` 미지원 경고(§2), §2 구현 메모 중복 정리, `isLowEnd`/`Ball.launch` 인용 정밀화, PointerLockControls·MDN orientation 레퍼런스 추가. (검토: 서브에이전트 코드 재대조 + 웹 레퍼런스 검증.)
>
> 관련 문서: [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md) (저사양·픽셀비·터치) ·
> [GAME_DESIGN.md](./GAME_DESIGN.md) (좌표·상태머신·카메라 연출) ·
> [REWARDS.md](./REWARDS.md) (스킨 불변식) · [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) ·
> [APP_PACKAGING.md](./APP_PACKAGING.md) (Tauri 데스크탑/모바일).

---

## 구현 현황 (2026-06-23, develop · **커밋 `de6dcaa`·푸시 완료**)

이 문서는 설계서지만 아래가 **실제 구현·검증됨**. ⚠️ **중요 변경**: §2/§5는 로비→레인을 *한 씬 연속
walk-in*으로 묘사하나, 사용자 요구로 **로비/레인 두 개의 별도 씬 + 터미널 로딩 전환**으로 구현됨.

- **슬라이스 1 (로비 루프)** ✅ — `LOBBY` 상태 + `toLobby()`([GameState.ts](../src/game/GameState.ts)),
  비물리 아바타 이동(WASD/방향키 + 터치 조이스틱), 3인칭 팔로우캠([CameraRig.ts](../src/camera/CameraRig.ts)
  `setLobbyAvatar` + `LOBBY` case), 입장 포털 도달 → `startMatch`.
- **슬라이스 2 (NPC)** ✅ — [ai.ts](../src/game/ai.ts) `kim/yoon/han`을 로비 캐릭터로(이름 라벨 Sprite +
  근접 대사 버블 + `E`/탭 대결 → vs AI 매치).
- **2-씬 아키텍처** ✅ — [Engine.ts](../src/core/Engine.ts) `lobbyScene`(레인 씬과 분리, 환경맵 공유) +
  `setScreen('lane'|'lobby')` 렌더 스왑 + `addLobby()`. 로비 = 네온 그리드 라운지(레인·핀 안 보임).
  전환은 [Transition.ts](../src/ui/Transition.ts) 터미널 로더 톤 오버레이가 **불투명 구간에 씬 스왑**해 가림.
  로비 객체는 [Lobby.ts](../src/scene/Lobby.ts)가 `engine.addLobby`로 구축. 4경로 배선은 [Boot.ts](../src/core/Boot.ts).
- 흐름: **메뉴 →(로딩)→ 로비 라운지 → 걷기 → 포털/NPC →(로딩)→ 레인 게임**. (`__enterLobby` DEV 글로벌로 진입)

- **슬라이스 3 (볼러 모션)** ✅ 코드 — 모든 투구가 `AIMING → RELEASING(스윙) → ROLLING`을 거친다(M1:
  [GameState.ts](../src/game/GameState.ts) `throwBall`→`releaseBall`, `RELEASE_SWING_SEC`=0.55s). 절차적 캡슐
  볼러 [Bowler.ts](../src/scene/Bowler.ts)가 공 뒤에서 백스윙→다운스윙→릴리스(progress=1=launch 프레임 동기)→
  팔로스루. 배선은 [Boot.ts](../src/core/Boot.ts) onFrame이 `game.state`로 가시성·스윙 구동. AI 턴도 같은
  단일 통로라 볼러가 자동 재생(H2: 위치 고정·코스메틱, 물리는 `computeAiThrow`). 카메라는 RELEASING=AIMING
  뷰 재사용([CameraRig.ts](../src/camera/CameraRig.ts)). tsc·vitest 32·빌드 OK, **실기 비주얼(볼러 위치·스윙
  손맛) 미확인** — dev 확인 필요.

**다음 (문서 순서):** 슬라이스 0 가로 락(`tauri android/ios init` 후 매니페스트), 슬라이스 4 스킨/테마(§8).
§5.1 "씬 3분할 금지"는 게임플레이 한정이라 로비/레인 분리와 무관(확인됨). 슬라이스 3 후속: 볼러 위치/크기·
스윙 타이밍(`RELEASE_SWING_SEC`) 손맛 튜닝, RELEASING 전용 카메라(3c polish — 현재 AIMING 뷰 재사용).

✅ **결과→로비 복귀 구현됨:** 로비에서 시작한 매치(포털 솔로/NPC 대결)는 종료 후 결과 화면 버튼이 **"🚶 로비로"**가
되어 로비로 복귀(터미널 전환 경유), 메뉴 직접 시작·hotseat 2인전은 **"메뉴로"** 유지(§11 H3). 출처 추적은
[Boot.ts](../src/core/Boot.ts) `matchOrigin`+`returnFromMatch`, 결과 버튼 라벨은 [Menu.ts](../src/ui/Menu.ts)
`showResult(…, returnLabel)`. tsc 클린·vitest 32·빌드 OK.

> ⚠️ **검증 주의:** 헤드리스 프리뷰는 `document.hidden`이라 앱의 `visibilitychange → loop.stop()`로 RAF 루프가
> 멈춘다(아바타가 안 움직여 보이는 등은 버그 아님). preview 검증 시 `__game`/`__engine`/`__cameraRig`/`__lobby`
> 전역으로 `update()`·`render()`를 **수동 구동**해야 최신 프레임이 잡힌다.

---

## 0. 현재 구조 진단 — 오픈월드의 반대편

엔진(Three.js + Rapier)은 범용 3D라 막는 건 없다. 문제는 **현재 설계가 "단일 레인을 보여주는 것"에
최적화돼 있다**는 점. 오픈월드에 필요한 빌딩 블록 관점에서 본 현 상태:

| 요소 | 현재 | 오픈월드에 필요한 것 |
|---|---|---|
| **카메라** | [CameraRig.ts](../src/camera/CameraRig.ts) — 게임상태별 **레일 카메라**(위치 하드코딩). 자유 이동 개념 없음 | 걸어다니는 아바타 추적 카메라(3인칭 팔로우) |
| **게임 흐름** | [GameState.ts](../src/game/GameState.ts) — `MENU→AIMING→ROLLING→SETTLING→GAME_OVER`. 진입점은 DOM 메뉴의 `startMatch` | 상위에 `LOBBY` 공간 상태 추가 |
| **AI** | [ai.ts](../src/game/ai.ts) — **던지기 수치(aim/power/spin)만** 있는 통계 모델. 3D 캐릭터 없음 | NPC 3D 모델 + 근접 대사 |
| **사람/볼러** | **존재하지 않음.** 공이 혼자 발사됨(유령 볼러) | 굴리는 모션 = 완전 신규 |
| **월드** | [Environment.ts](../src/scene/Environment.ts) — 레인+옆레인+벽, **전부 시각 전용(콜라이더 없음)** | 걸을 바닥/벽 콜라이더(또는 비물리 이동) |
| **메뉴** | [Menu.ts](../src/ui/Menu.ts) 998줄 — 모드/공/오일/스킨/통계 전부 DOM 오버레이 | 설정 진입을 로비/레인으로 재배치 |
| **방향** | 세로(portrait) 기준으로 FOV·HUD·터치존 튜닝 | **가로(landscape) 고정** (§2) |

**한 줄 결론:** 불가능한 건 없다. **"유령 볼러 · 레일 카메라 · 세로 DOM 메뉴" 전제 3개를 걷어내는
것**이 작업의 본체다. 그중 절반은 이미 깔린 시스템(아래)을 재활용한다.

---

## 1. 4개 빌딩 블록 — 난이도와 재사용 포인트

| 블록 | 난이도 | 핵심 | 재사용 |
|---|---|---|---|
| **① 레인 트리거** | ★☆☆☆ | 근접 시 "게임 시작?" → 확인 → 게임 진입 | **기존 `startMatch(config)` 그대로 호출.** 지금 메뉴 버튼이 하던 일을 월드 트리거로 이동 |
| **② NPC 근접 대사** | ★★☆☆ | 로비에 캐릭터 세우고 가까이 가면 대사 | [ai.ts](../src/game/ai.ts) `AI_PROFILES`에 **이름+tagline(대사)이 이미 있음** (§6) |
| **③ 자유 이동 카메라** | ★★★☆ | 걸어다니기 + 따라다니는 카메라 | [CameraRig](../src/camera/CameraRig.ts)의 `lerp` 스무딩 패턴 재사용. 가로 고정으로 조이스틱 부담 해소(§2·§4) |
| **④ 볼러 모션** | ★★★★ | 게임장에서 사람이 굴리는 애니메이션 | **신규.** 캐릭터/애니메이션 시스템이 현재 0 (§7) |

→ ④가 가장 큰 신규 작업이라 **구현 순서에서 맨 뒤로**(§9). ①②③만으로도 "대기실→레인→게임"
루프 전체가 손에 잡힌다.

---

## 2. 모바일 방향 — 가로 고정 (핵심 결정)

### 왜 가로인가 (세로의 구조적 한계)

- **트윈스틱(왼손 이동 + 오른손 시점)은 가로를 강제**한다. 세로에서 두 엄지로 양쪽 코너를 잡는 건
  답답하다.
- 반대로 **레인은 세로가 native** — 길게 뻗는 레인이 세로 화면을 위로 채우는 게 자연스럽고, 가로로
  돌리면 옆레인·벽이 화면을 먹어 "부담스럽다". [Engine.ts](../src/core/Engine.ts)의 FOV 52°도 이를 뒷받침하는
  정황(단, 이는 추론 — 코드 주석은 "레인 비중↑"으로 좁힌다고만 적혀 있고 portrait를 명시하진 않음, [fov-doc]).
- 즉 **세로 ⟂ 오픈월드**가 본질. 세로에 어떤 조작을 얹어도(조이스틱은 부담, 핫스팟은 탐험감 죽음)
  반쪽이 된다. **줌(핀치)도 해법이 아니다** — "제자리에서 들여다보기"지 "누비기"가 아니라 오픈월드
  핵심을 못 살린다. (줌은 §6 NPC 클로즈업 양념으로만 의미.)
- **해소: 가로로 통일.** 가로면 조이스틱이 자연스럽고 탐험감도 산다. 레인의 "부담"은 *프레이밍*
  문제라 카메라 구도로 푼다(실제 볼링 게임 다수가 가로).

### 레이아웃 1벌, 입력 2벌

갈리는 축은 "데스크탑 vs 모바일"이 아니라 **화면 ⊥ 입력**이다:

| | 데스크탑 | 모바일 |
|---|---|---|
| **레이아웃** | 가로 (네이티브, 1280×800) | 가로 (락) → **같은 한 벌** |
| **입력** | 키보드 + 마우스 (WASD/클릭) | 터치 조이스틱 ([nipplejs] 등) |

입력 분기는 이미 코드에 있다 — [device.ts](../src/core/device.ts) `isCoarsePointer()`로 "터치냐 마우스냐"를
판정(현재 [Engine.ts:12](../src/core/Engine.ts) `isLowEnd`가 `isCoarsePointer() && deviceMemory<=4`로 사용). **화면이 아니라 포인터 종류로** 조작계를 바꾼다.

### ⚠️ "리프레이밍만 하면"은 낙관 — 가로 모드는 한 세트

레인 카메라 하나가 아니라 다음을 **가로용으로** 손봐야 한다:

| 바꿀 것 | 현재 | 가로에서 |
|---|---|---|
| 레인 카메라 | [CameraRig](../src/camera/CameraRig.ts) 상태별 위치·FOV가 세로 기준 | 가로 비율용 위치/FOV 재튜닝 (가장 쉬움) |
| HUD/스코어보드 | [Hud.ts](../src/ui/Hud.ts) 세로 레이아웃 | 상단 바 등 가로 배치 |
| 메뉴 | [Menu.ts](../src/ui/Menu.ts) 998줄 세로 DOM | 가로 레이아웃 (분할이 소프트 선행, §10) |
| 터치 존 | [Controls.ts](../src/input/Controls.ts) 세로 엄지 도달범위 | 가로 엄지 위치 |

### 구현 메모 — Tauri 방향 락

**Tauri v2에는 방향 락 통합 설정이 없다.** 플랫폼 매니페스트를 수동 편집한다
([discussion #13407], [issue #13408]):

- **Android:** `src-tauri/gen/android/AndroidManifest.xml`의 액티비티에
  `android:screenOrientation="landscape"`.
- **iOS:** Xcode `General > Deployment Info > iPhone/iPad orientation`을 landscape로 제한
  (= `Info.plist`의 `UISupportedInterfaceOrientations`).
- **웹 폴백:** `screen.orientation.lock('landscape')` — **Android Chrome 한정**(풀스크린 진입 후에만
  허용). ⚠️ **iOS Safari는 `ScreenOrientation.lock()` 자체를 미지원**([orientation-lock],
  [bcd-orientation])이라 iOS 웹/PWA엔 방향 락 수단이 없다 → iOS는 위 네이티브 `Info.plist` 경로에만
  의존. 웹은 브라우저 미리보기용 점진 향상으로만 취급.
- ⚠️ **현재 `src-tauri/gen/android`·`gen/apple`이 아직 생성되지 않았다**(스키마만 존재). 모바일
  프로젝트를 `tauri android/ios init`으로 생성한 *후에* 매니페스트가 생기므로, 방향 락은 그 시점에
  적용한다. [APP_PACKAGING.md](./APP_PACKAGING.md)와 연동.
- **데스크탑:** [tauri.conf.json](../src-tauri/tauri.conf.json)이 `1280×800` / `minWidth 640` /
  `minHeight 480` / `resizable: true`. 이미 가로 native. 세로창 찌그러짐을 막고 싶으면 `minWidth >
  minHeight`로 두거나 목표 비율 레터박스. 안 막아도 [Engine.onResize](../src/core/Engine.ts)가
  `camera.aspect`를 갱신해 **리플로우는 안전**(키보드 조작이라 방향 무관).
- ⚠️ 2026-06 기준 유지보수되는 orientation 플러그인 없음([issue #13408] 오픈). `tauri-plugin-keep-screen-on`은 웨이크락 전용(방향 아님).

---

## 3. 데스크탑은 어떻게 — 추가 작업 ≈ 0

가로 고정 결정의 **수혜자**가 데스크탑이다.

- 모니터·창이 태생적으로 와이드 → "방향 락"이라는 개념 자체가 모바일 전용. 데스크탑은 **모바일용으로
  만든 가로 레이아웃을 그대로 물려받는다**(§2 "레이아웃 1벌").
- 유일한 데스크탑 고유 작업은 **입력(키보드/마우스)** 인데, 이건 어차피 만들 것이고
  `isCoarsePointer()`로 이미 분기 가능.
- 엣지: 사용자가 창을 세로로 찌그러뜨려도(min 640×480 안에서 640×800 가능) `onResize`가 잡고,
  WASD는 방향 무관이라 안 깨진다.

---

## 4. 이동 컨트롤 스펙트럼 (가로 전제)

| 방식 | 느낌 | 방향 | 난이도 | 비고 |
|---|---|---|---|---|
| 핫스팟 탭 | NPC/레인을 탭하면 카메라 글라이드 | 세로도 OK | ★ | 탐험감 약함. 가로 포기 시의 폴백 |
| 싱글스틱 + 오토캠 | 왼손 이동, 시점 자동 | 세로 OK | ★★ | 가로 안 갈 때의 절충 |
| **트윈스틱 / WASD** | 자유보행 + 시점 | **가로** | ★★★ | **가로 확정이므로 이걸 채택** |

- **모바일:** 가상 조이스틱 ([nipplejs] — DOM `zone`에 붙여 `move` 이벤트의 `vector.x/y`로 이동).
  좌하단 이동 스틱. 작은 로비라 시점 스틱 없이 **싱글스틱 + 팔로우캠**으로 시작하고, 필요 시 우측
  시점 스틱 추가.
- **데스크탑:** WASD/방향키 + (옵션) 마우스 시점.
- **카메라:** 3인칭 팔로우. 아바타 뒤 오프셋을 목표로 `camera.position.lerp(target, k)` — 이미
  [CameraRig](../src/camera/CameraRig.ts)가 쓰는 프레임독립 스무딩(`1 - exp(-6·dt)`)과 동일 계열.
  레퍼런스의 권장 계수 0.05~0.1과 정합. ([three.js 3인칭 카메라][tps-cam], [Smooth Camera][inkfood])

---

## 5. 상태머신 확장 — `LOBBY` 추가

현재 `GameStateName = 'MENU' | 'AIMING' | 'ROLLING' | 'SETTLING' | 'GAME_OVER'`
([GameState.ts](../src/game/GameState.ts)). 여기에 로비를 얹는다:

```
LOBBY ──(레인 근접 + 확인)──▶ AIMING ──▶ ROLLING ──▶ SETTLING ──▶ GAME_OVER
  ▲                                                                    │
  └──────────────────── 게임 끝 → 로비 복귀 ◀────────────────────────┘
```

- **`MENU` → `LOBBY` 승격은 "시작 버튼 교체"가 아니다:** 현재 MENU는 와이드 시네마틱 배경 + DOM
  메뉴인데, 그 DOM 메뉴가 사실 **설정 허브**다(모드·상대·난이도·오일·예측선·스킨·통계). 로비로
  바꿀 때 이 허브를 어디로 보낼지가 핵심 — **§6.1 매트릭스**로 정리(전면 메뉴 → 레인 앞 컨텍스트 패널).
- **[CameraRig](../src/camera/CameraRig.ts) `switch(this.game.state)`에 `LOBBY` case 추가** — 아바타
  팔로우. 기존 AIMING~GAME_OVER case는 그대로(가로용 수치만 재튜닝, §2).
- **[Controls](../src/input/Controls.ts)** — `LOBBY`에선 이동, `AIMING`~에선 기존 조준/파워. 분기는
  **`GameState.inputLocked` 필드를 Controls가 읽는** 기존 패턴을 확장(상태값으로 입력 모드 전환).
- **진입:** 레인 트리거가 `startMatch({ mode, players, ... })` 호출(기존 시그니처 그대로).
- **복귀:** `gameOver` 이벤트/결과 화면 → `toMenu()` 대신 `toLobby()`(로비 상태로 복귀, 카메라 위치
  로비로).

### 5.1 게임장 연출 = 카메라 페이즈 (THREE.Scene 3분할 아님)

게임장을 "굴리기 + 굴러가기 + 핀 임팩트" 3개로 쪼갤지 고민할 수 있는데 — **별도 `THREE.Scene` 3개로
나누면 안 된다.** 공의 물리/궤적은 연속(릴리스→레인→핀이 한 시뮬)이라 씬을 갈아끼우면 중간에 공이
끊긴다. **하나의 씬 위에서 카메라 디렉터 상태(페이즈)로** 나누는 게 정답이고, 골격은 이미 있다:

| 페이즈 | 현재 | 상태 |
|---|---|---|
| 굴리기(릴리스) | 없음 — 공이 혼자 발사(유령 볼러) | **신규.** 볼러 스윙 비트(§7) — AIMING→ROLLING 사이 삽입 (삽입 방식은 카메라 case가 아니라 `RELEASING` 서브상태/게이트 → **§11 M1**) |
| 굴러가기 | [CameraRig](../src/camera/CameraRig.ts) `ROLLING` 팔로우캠 | 구현됨 |
| 핀 임팩트 | `SETTLING` + 슬로모/푸시인/셰이크(`notifyImpact`) | 구현됨 |

> **⚠️ 용어 — "릴리스 타이밍"(기존) ≠ "릴리스 페이즈"(신규):** 코드에 이미 있는 "릴리스 타이밍"과
> 헷갈리지 말 것.
> - **릴리스 타이밍** = *이미 구현된* 파워 띠 골드 구간 입력 정확도([Controls.ts:42-44](../src/input/Controls.ts)
>   `POWER_SWEET_LO = RELEASE_SWEET_LO`, commit 135d1fc) — **게임플레이 메커닉**.
> - **릴리스 페이즈**(여기서 신규) = 볼러 **스윙 비주얼 비트**. 볼러 캐릭터·`RELEASING` 서브상태 둘 다
>   코드에 없음([GameState.ts:231](../src/game/GameState.ts) `throwBall`이 즉시 `ROLLING` flip).
> - **연결:** 스윙은 *새 입력을 만들지 않고* **기존 파워밴드 릴리스 이벤트를 트리거/싱크 포인트로
>   재사용**한다 — 스윙 다운→릴리스 프레임에서 기존 `throwBall(aim, power, spin)` 발사(§7·§11 M1/M2).

즉 "3분할 신규"가 아니라 **"기존 2개 + 신규 1개(릴리스)"**다. ⚠️ 현재 ROLLING↔SETTLING은 **의도적
연속 블렌딩**(`u` smoothstep으로 공 진행도에 카메라 종속, [CameraRig.ts](../src/camera/CameraRig.ts) 주석
"임계 스위치 대신 비례 보간")이라 — **하드컷으로 되돌리면 "툭 끊김"이 재발한다.** 컷이 필요하면
릴리스→굴러가기 전환에서만 주고, 굴러가기→임팩트는 지금의 연속 블렌딩을 유지하는 걸 권장.

**거터:** 별도 분기 불필요 — [CameraRig.ts](../src/camera/CameraRig.ts)가 이미 `b.y <= -1.5`(공이 거터로
떨어짐)면 `u=1`로 즉시 핀덱뷰 전환한다(직감 "빠질 때쯤 변환"과 일치). 거터는 임팩트 축하 비트를
건너뛰고 공이 골로 빠지는 걸 짧게 보여주면 됨.

---

## 6. NPC — `ai.ts`를 캐릭터로 승격

[ai.ts](../src/game/ai.ts)의 `AI_PROFILES`에 **이름과 대사가 이미 있다**:

| key | 이름 | tagline (= 대사 후보) |
|---|---|---|
| `kim` | 초보 | "착실한 직구 — 꾸준하지만 포켓을 자주 놓친다" |
| `yoon` | 중수 | "풀스핀 한 방 승부 — 대박 아니면 쪽박" |
| `han` | 고수 | "빈틈없는 정밀 직구 — 포켓도 스페어도 놓치지 않는다" |

- **배치:** 로비에 3개 캐릭터 메시 세우기(절차적 또는 glTF, §7과 공유).
- **근접 대사:** 매 프레임 플레이어↔NPC 거리 체크 → 반경 진입 시 말풍선(DOM 오버레이 또는 인월드
  스프라이트). 거리 기반 대사 전환은 표준 패턴. ([Proximity Dialogue Trigger][pixelcrushers],
  [월드빌딩 NPC 대사][gamedev-npc])
- **상호작용 프롬프트:** "대결하기 [E]" / 탭. (["Press E" 프록시미티 프롬프트][bloxcreators] 패턴)
- **말 걸기 → 매치:** 해당 NPC와 `startMatch({ mode, players: [{name:'나'}, {name, ai: profile}] })`.
  즉 **NPC 선택이 곧 상대 선택** — 기존 메뉴의 "AI 라이벌 고르기"를 공간화한 것.

### 6.1 ⚠️ 메뉴 매트릭스 → 공간 매핑 (NPC만으론 부족)

[Menu.ts](../src/ui/Menu.ts)는 단순 시작버튼이 아니라 **직교 두 축 + 설정 다발**이다 — NPC(§6)는 이 중
"AI 상대" 칸 하나만 푼다. 나머지(혼자·2인 교대전·스페어, 그리고 모든 설정)의 집을 정해야 한다:

| 메뉴 축 | 값 ([Menu.ts](../src/ui/Menu.ts)) | 로비에서의 집 |
|---|---|---|
| 모드 | 풀게임 / 블리츠 / 스페어 챌린지(솔로) | 레인 앞 **시작 패널** |
| 상대 | 혼자 / 👥 2인 교대전 / AI 라이벌 3 | **AI = NPC 대화** · 혼자 = 빈 레인 진입 · 2인 = 패널 토글 |
| 난이도 | 쉬움/보통/어려움 (오일+예측선 프리셋) | 레인 앞 **시작 패널** |
| 오일·예측선·스킨 | `oilPattern`·`aimAid`·`selectedSkin` | 패널(오일/예측선) · 스킨 = 로비 키오스크/락커 |
| 통계 | `statsSummary` | 로비 보드/전광판 |

**하이브리드 원칙:** 로비 = *상대·분위기·코스메틱*(NPC·스킨·통계), 레인 앞 패널 = *판 세팅*(모드·
난이도·오일·예측선). 스페어·혼자·2인은 NPC 없이 **레인 진입 → 시작 패널**로 들어간다. → 기존
[Menu.ts](../src/ui/Menu.ts)는 **버리는 게 아니라 "레인 앞 컨텍스트 패널"로 축소·이식**한다.

---

## 7. 볼러 모션 — 가장 큰 신규 작업

현재 캐릭터·애니메이션 시스템이 **0**(공이 혼자 발사). 두 갈래:

- **(a) 절차적 로우폴리 볼러** — 캡슐 몸통 + 구 머리 + 실린더 팔. 스윙을 손코딩 키프레임으로,
  릴리스 순간을 `throwBall`→`Ball.launch` 호출 프레임에 동기(`throwBall`이 `Ball.launch`를 호출하는
  래퍼). **이 프로젝트의 "에셋 0 · 절차적" 철학과 일치**
  (핀 `LatheGeometry`, 나무결·네온 전부 절차적). 1차 추천.
- **(b) glTF 리깅 + Mixamo 볼링 모션 + `AnimationMixer`** — 고퀄이지만 에셋 파이프라인/로더/라이선스
  도입. "0 에셋" 패턴이 깨짐. 표준 재생: `mixer = new AnimationMixer(scene)` →
  `mixer.clipAction(clip).play()`, `Clock`으로 `mixer.update(dt)`.
  ([three.js 애니메이션 시스템][d3-anim], [Mixamo+glTF 워크플로][donmccurdy], [glTF 애니메이션][sbcode])
- **동기화 포인트:** 스윙 다운→릴리스 프레임에서 `throwBall(aim, power, spin)` 발사. NPC 턴(AI 투구)에도
  같은 볼러를 재사용하면 일관됨(현재 AI는 `computeAiThrow` 수치만, 시각은 유령).

---

## 8. 스킨 / 테마 — 별도 트랙 (이미 절반 깔림)

스킨 시스템이 공에는 **이미 구현돼 있다** — [rewards.ts](../src/game/rewards.ts)의 `BallSkin` +
[Ball.ts](../src/scene/Ball.ts) `setSkin`/`applyMaterial`. "스킨 = 머티리얼 파라미터"라는 패턴을
배경·레인·캐릭터로 확장한다.

| 대상 | 현재 | 스킨화 |
|---|---|---|
| 공 | `BallSkin`(finish/color/metalness/emissive…) **구현됨** | (기준 패턴) |
| 레인 | [Lane.ts](../src/scene/Lane.ts) `makeWoodTexture(light, dark)` 절차적 | 톤/텍스처 파라미터 세트 = 레인 스킨 |
| 배경 | [Environment.ts](../src/scene/Environment.ts) 네온색·포스터·전광판 절차적 | 컬러/패턴 프리셋 = 테마(네온/우드/우주 등) |
| 캐릭터 | (신규, §7) | NPC·볼러 머티리얼/실루엣 프리셋 |

- **절차적 스킨(에셋 0):** 파라미터 세트만 바꾸면 됨 — 이 코드베이스에 가장 잘 맞고 비용 낮음.
- **에셋 스킨:** 텍스처(PNG)/glTF 도입 시 고퀄이지만 번들·로더·용량 관리 필요(모바일 주의).
- ⚠️ **물리 불가침:** 스킨은 외형만 — [rewards.ts](../src/game/rewards.ts) §3 불변식(massKg·maxSpeedScale·
  AI 사다리 무영향)과 동일 정책을 레인/배경 스킨에도 적용(레인 스킨이 마찰·오일을 바꾸면 안 됨).

---

## 9. 구현 순서 (슬라이스)

작게 증명하며 ④(최대 작업)를 맨 뒤로 미루는 경로:

| 슬라이스 | 내용 | 선행 | 산출 |
|---|---|---|---|
| **0. 가로 모드** | 방향 락(모바일) + 레인캠/HUD/메뉴 가로 리프레이밍 + 입력 분기 골격 | — | 가로로 도는 기존 게임 |
| **1. 로비 루프** | `LOBBY` + 이동(조이스틱/WASD) + 팔로우캠(**플레이스홀더 캡슐 아바타**) + 레인 트리거 → `startMatch` | 0 | **걸어가서 게임 시작되는 루프** |
| **2. NPC** | 캐릭터 3명 + 근접 대사 + "대결" → `startMatch(vs AI)` | 1 | 사회적 레이어 |
| **3. 볼러 모션** | 절차적 볼러 + 스윙(릴리스 동기) — 슬라이스 1의 캡슐을 애니 볼러로 교체 + 릴리스 페이즈(§5.1·§11 M1/M2/H1/H2) | 1 (2와 캐릭터 공유) | "사람이 굴리는" 게임장 |
| **4. 스킨/테마** | 레인·배경·캐릭터 스킨 확장 | §8 | 코스메틱 |

> 슬라이스 0+1만으로 "대기실 → 레인 → 게임" 전체 루프가 완성된다. 2·3·4는 독립적으로 얹는다.
> ⚠️ **숨은 의존성:** 슬라이스 1의 3인칭 팔로우캠은 *보이는 아바타*를 전제한다 → 1은 캡슐
> 플레이스홀더(또는 1인칭)로 시작하고, 애니메이션 볼러(④ = 슬라이스 3)가 나중에 교체한다.

---

## 10. ⚠️ 가로지르는 제약 / 리스크

- **[Menu.ts](../src/ui/Menu.ts) 998줄 가로화:** 구조 감사의 분할 권고 대상. 가로 레이아웃 + 로비
  재배치를 얹기 전 **분할이 소프트 선행**.
- **컨트롤 언어 분기:** `LOBBY` 이동 vs `AIMING~` 조준이 같은 입력 장치를 다르게 해석한다. 상태 전환
  시 모드가 명확히 읽히도록(HUD 힌트/커서 변경).
- **성능(모바일):** 로비 + NPC 3 + 볼러 지오메트리가 추가된다. [device.ts](../src/core/device.ts)
  `isLowEnd` 경로(픽셀비·섀도우 다운)와 [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md) 정책을 신규 메시에도
  적용(로우폴리·인스턴싱·LOD 고려). 2026 가이드 기준 **드로우콜 <50(모바일)** 목표; 추가
  지오메트리(로비·NPC·볼러)는 `InstancedMesh`+`THREE.LOD`로 예산 내 유지 ([100 tips][perf-tips]).
- **Tauri 방향 락 미성숙:** 통합 설정 없음 → 매니페스트 수동(§2). 모바일 프로젝트 생성 후 적용,
  업그레이드 시 매니페스트 보존 주의.
- **이동 = 물리 vs 비물리:** 로비 걷기를 Rapier 캐릭터 컨트롤러로 할지, 단순 위치 적분 + 경계 클램프로
  할지 결정 필요. 작은 로비라 **비물리(클램프) 권장**(충돌 슬라이딩 비용 회피). 평평한 단일 바닥이면
  비물리 클램프로 충분(1차 권장). 단 계단/경사/장애물이 생기면 Rapier `KinematicCharacterController`
  (`createCharacterController`/`computeColliderMovement`, 오토스텝·스냅·경사)가 벽 슬라이딩·충돌을 공짜로
  줘 업그레이드 경로로 둔다 ([Rapier KCC][rapier-kcc], [doppl3r 예제][doppl3r-kcc]).
- **범위 밖:** 스마트컨트랙트/토큰 연동은 이 문서에서 다루지 않음(별도 설계 시 점수·보상·스킨 소유권과
  엮는 지점만 후속 검토).

---

## 11. 설계 결정 — 슬라이스 1·2 반영 재평가 (2026-06-23)

2차 독립 검토가 찾은 8개 공백 중 **4개(H4·M3·M4 + H3 정책)는 슬라이스 1·2 구현(`de6dcaa`)으로
해소**됐고, **볼러 모션(슬라이스 3)의 직접 선행은 H1·H2·M1·M2** 4개만 남았다(②). 라인 번호는
`de6dcaa` 기준 갱신. *(이전 "2차 검토" 표는 슬라이스 1 착수 전 기준이라 이 재평가로 대체.)*

### ① 해소됨 (슬라이스 1·2, `de6dcaa`)

| 항목 | 결정(확정) | 구현 위치 |
|---|---|---|
| H4 로비 걸을 영역 | 비물리 위치적분 + 경계 클램프 사각형 `x∈±4.2, z∈[−8.5,−2.5]` (Rapier KCC 불필요) | [Lobby.ts:16-19](../src/scene/Lobby.ts) 상수 · [:300-302](../src/scene/Lobby.ts) clamp |
| M3 `toLobby()` | 오일/레인 시각을 기본(house)으로 복원 | [GameState.ts:222](../src/game/GameState.ts) `toLobby` (`resetOil`+`applyOilVisual`) |
| M4 CameraRig | 아바타 주입 + LOBBY/MENU case 분리 | [CameraRig.ts:38](../src/camera/CameraRig.ts) `setLobbyAvatar` · [:81](../src/camera/CameraRig.ts) LOBBY case |
| H3 핫시트 정책 | hotseat = 통계·하이스코어 미저장(파티 모드) | [GameState.ts:166](../src/game/GameState.ts) `isHotseat` · [:569](../src/game/GameState.ts) gameOver 분기. *로비 복귀 분기는 §구현현황 "후속거리"에서.* |

### ② 슬라이스 3(볼러 모션) 선행 — 미구현, 착수 전 확정

모든 투구(사람·AI·마지막프레임 보너스)가 **`throwBall` 단일 통로**를 지난다 — 사람=Controls→throwBall,
AI=[GameState.ts:336](../src/game/GameState.ts) `update` AIMING case→throwBall, 보너스=score 후
`state='AIMING'` 재진입→throwBall. 스윙 비트는 이 한 곳만 손대면 전 경로에 적용된다.

| 항목 | 문제 | 결정 방향 | 근거(`de6dcaa`) |
|---|---|---|---|
| M1 릴리스 삽입점 | `throwBall`이 `launch` 직후 즉시 `ROLLING` flip — 스윙 들어갈 틈 없음 | `throwBall`을 **2단 분리**: `beginRelease(aim,power,spin)`(파라미터 보관 + `state='RELEASING'` + 스윙 시작) → 스윙 다운스윙 **릴리스 프레임**에서 기존 `ballObj.launch`+`state='ROLLING'`. `GameStateName`에 `'RELEASING'` 추가 | [GameState.ts:249-259](../src/game/GameState.ts) `throwBall` · [:22](../src/game/GameState.ts) `GameStateName` |
| H1 릴리스 페이즈 키잉 | 스윙이 프레임당 1회로 묶이면 보너스·AI 투구 누락 | 스윙은 **매 `throwBall`(=매 AIMING→ROLLING)** 발동. M1의 단일 통로라 자동 충족(프레임당 게이팅 금지) | [GameState.ts:336](../src/game/GameState.ts)(AI) · [:474-495](../src/game/GameState.ts)(보너스 재진입) |
| H2 AI 볼러 | AI는 Controls 미경유, 로비 NPC만 있고 레인 볼러 없음 | 레인에 **볼러 1구 배치**(사람/AI 공용). AI 턴엔 같은 스윙을 **코스메틱 재생**, 물리는 `computeAiThrow` 그대로 | [GameState.ts:310-336](../src/game/GameState.ts) AI 분기 · [ai.ts](../src/game/ai.ts) `computeAiThrow` |
| M2 스윙 timeScale | `setTimeScale`(슬로모/AI빨리감기)와 desync 가능 | RELEASING은 ROLLING 전이라 **임팩트 슬로모와 시간상 안 겹침** → 사람 스윙은 프레임 dt로 OK. **AI 빨리감기만 sim-time 구동**(현 `AI_FAST_FORWARD=1`이라 무해, 2~3배 상향 시 대비) | [GameState.ts:308-324](../src/game/GameState.ts) `setTimeScale` · [Loop.ts](../src/core/Loop.ts) |

> 볼러 시각은 §7 (a) 절차적 로우폴리 추천 — 로비 NPC([Lobby.ts](../src/scene/Lobby.ts) `makeFigure`)의
> 캡슐+구+바이저를 레인 볼러로 재사용하면 로비↔레인 인물 톤이 일관된다.

---

## 레퍼런스

**Tauri 방향 락 / 웹 orientation**
- [Force window orientation landscape in V2? — discussion #13407][discussion #13407]
- [feat: App orientation for iOS/Android — issue #13408][issue #13408]
- [Tauri Mobile Plugin Development](https://v2.tauri.app/develop/plugins/develop-mobile/)
- [ScreenOrientation.lock() — MDN][orientation-lock] · [iOS Safari 미지원 — browser-compat #19355][bcd-orientation] — 웹 폴백 한계(§2).

**모바일 조이스틱 / 카메라**
- [nipplejs (GitHub)][nipplejs] · [nipplejs 데모](https://yoannmoi.net/nipplejs/) · [nipplejs (npm)](https://www.npmjs.com/package/nipplejs)
- [three.js 3인칭 카메라 (forum)][tps-cam] · [Smooth Camera — INKFOOD][inkfood] · [3인칭 캐릭터 컨트롤러 (Medium)](https://medium.com/javascript-alliance/creating-a-third-person-character-controller-in-three-js-20850e7f2fb2) · [3인칭 카메라 충돌 (forum)][cam-collision]
- [PointerLockControls — three.js 예제][pointerlock] · [docs][pointerlock-docs] — 데스크탑 WASD+마우스룩 표준(§4 "(옵션) 마우스 시점").

**캐릭터 애니메이션**
- [The three.js Animation System — Discover three.js][d3-anim]
- [Animated glTF characters with Mixamo & Blender — Don McCurdy][donmccurdy]
- [GLTF Animations — sbcode][sbcode]

**NPC 근접 대사 / 상호작용**
- [Proximity Dialogue Trigger — Pixel Crushers][pixelcrushers]
- [ProximityPrompt "Press E" 패턴][bloxcreators] · [Roblox Proximity Prompts 문서][proximity-prompts]
- [Worldbuilding With NPC Dialogue — Game Developer][gamedev-npc]

**추가 (2차 리서치)**
- [Rapier 캐릭터 컨트롤러 (JS)][rapier-kcc] — KCC 오토스텝·스냅·경사 처리(§10 업그레이드 경로).
- [doppl3r KCC 예제][doppl3r-kcc] — three.js + Rapier KinematicCharacterController 동작 예제.
- [3인칭 카메라 충돌 (forum)][cam-collision] — 팔로우캠이 벽을 뚫지 않게 하는 충돌 처리.
- [Roblox Proximity Prompts 문서][proximity-prompts] — "Press E" 근접 프롬프트 UI 레퍼런스(§6).
- [PerspectiveCamera.fov — three.js docs][fov-doc] — FOV는 *세로* 시야각 정의(가로/반응형 프레이밍 근거, §2).
- [Three.js Best Practices — 100 tips][perf-tips] — 드로우콜 <50(모바일) 등 성능 예산(§10).
- [InstancedMesh 성능 예제][instancing] — 동일 지오메트리 대량 배치(로비·NPC·볼러, §10).

[nipplejs]: https://github.com/yoannmoinet/nipplejs
[tps-cam]: https://discourse.threejs.org/t/third-person-camera/18624
[inkfood]: https://www.inkfood.com/smooth-camera/
[d3-anim]: https://discoverthreejs.com/book/first-steps/animation-system/
[donmccurdy]: https://www.donmccurdy.com/2017/11/06/creating-animated-gltf-characters-with-mixamo-and-blender/
[sbcode]: https://sbcode.net/threejs/gltf-animation/
[pixelcrushers]: https://www.pixelcrushers.com/dialogue_system/manual2x/html/triggers_and_interaction.html
[bloxcreators]: https://www.bloxcreators.com/beginner-tutorials/how-to-create-interactive-npc-experience-with-proximity-prompts/
[gamedev-npc]: https://www.gamedeveloper.com/design/worldbuilding-with-npc-dialogue-a-beginner-s-guide
[discussion #13407]: https://github.com/tauri-apps/tauri/discussions/13407
[issue #13408]: https://github.com/tauri-apps/tauri/issues/13408
[rapier-kcc]: https://rapier.rs/docs/user_guides/javascript/character_controller/
[doppl3r-kcc]: https://github.com/doppl3r/kinematic-character-controller-example
[cam-collision]: https://discourse.threejs.org/t/camera-collision-in-third-person-orbit-controlls/61443
[proximity-prompts]: https://create.roblox.com/docs/ui/proximity-prompts
[fov-doc]: https://threejs.org/docs/#api/en/cameras/PerspectiveCamera.fov
[perf-tips]: https://www.utsubo.com/blog/threejs-best-practices-100-tips
[instancing]: https://threejs.org/examples/webgl_instancing_performance.html
[orientation-lock]: https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock
[bcd-orientation]: https://github.com/mdn/browser-compat-data/issues/19355
[pointerlock]: https://threejs.org/examples/misc_controls_pointerlock.html
[pointerlock-docs]: https://threejs.org/docs/#examples/en/controls/PointerLockControls
