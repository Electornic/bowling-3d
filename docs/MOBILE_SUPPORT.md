# 모바일 대응 — 설계 문서

> 작성: 2026-06-14 (6차 세션). 데스크톱(마우스 hover + 키보드) 전제로 만들어진 게임을
> 모바일 터치에서 정상 플레이 가능하게 만드는 작업의 진단 · 설계 · 단계 계획.
> 본 문서는 **구현 전 설계 합의용**. 결정된 기본안은 각 절 머리에 표기하고, 검토한 대안도 함께 남긴다.

---

## 0. TL;DR

- **핵심 막힘**: 터치엔 hover가 없어 "조준 후 차징"이 불가능 — 캔버스를 누르는 순간 곧장 파워 차징이 시작된다([Controls.ts:236](../src/input/Controls.ts)). 발사 인터랙션 모델 재설계가 1순위.
- **발사안**: 두 후보 **ⓐ 풀백 슬링샷 / ⓑ 상대 드래그+홀드 차징** 보류(§2) — 실플레이 감 본 뒤 확정. ⓑ는 타이밍 압박이 잔존하고 ⓐ는 데스크톱과 손맛이 갈림. 어느 쪽이든 **멀티터치·pointercancel 견고성(§2.4)** 은 필수.
- **나머지**: 반응형 UI 재배치(고정 px → 충돌·오버플로), 뷰포트/제스처 잠금(줌·당겨서새로고침 차단), safe-area, 가로 권장 안내.
- **단계**: M0(플레이 가능) → M1(레이아웃) → M2(폴리시). M0만으로 "모바일에서 일단 굴러간다" 달성.

---

## 1. 현 상태 진단

### 1.1 이미 되는 것
- **포인터 통합** — 입력 전부 `pointerdown/move/up`. 마우스·터치가 같은 이벤트로 들어옴([Controls.ts:226](../src/input/Controls.ts)).
- **스핀 드래그 바** — `spinTrack`에 `touchAction:'none'` + 드래그 핸들러가 있어 **터치로 스핀 설정 가능**([Controls.ts:146](../src/input/Controls.ts), [252](../src/input/Controls.ts)). → 로드맵의 "터치엔 스핀 입력 없음"([GAMEPLAY_ROADMAP.md:20](GAMEPLAY_ROADMAP.md)) 메모는 stale.
- **해상도 대응** — 풀스크린 + `resize` 핸들러([Engine.ts:90](../src/core/Engine.ts)). `setPixelRatio(min(dpr,2))`, `maxCcdSubsteps=4`(저FPS 터널링 보완)는 모바일을 이미 고려.
- **저FPS 물리 안전** — `Loop`의 `MAX_FRAME=0.25` 클램프([Loop.ts:52](../src/core/Loop.ts))로 프레임이 크게 벌어져도 스파이럴 없이 최대 15스텝만 진행. 고정 timestep이라 **물리·궤적은 프레임레이트 독립** — 저FPS는 *체감/렌더* 문제지 물리 깨짐이 아니다.
- **오디오 언락(이미 됨)** — `SoundManager`가 `pointerdown`/`keydown`에서 `AudioContext.resume()`([SoundManager.ts:15](../src/audio/SoundManager.ts)). 모바일 자동재생 정책의 첫 제스처 언락은 **신규 작업 아님**. (단 `new AudioContext()`만 — 구형 iOS 대상이면 `webkitAudioContext` 폴백 한 줄 검토.)

### 1.2 깨지는 것 / 빠진 것

| # | 문제 | 근거 | 영향 |
|---|---|---|---|
| 1 | **조준·파워 결합** — 터치엔 hover가 없어 누르는 즉시 차징 시작, "조준 후 차징" 불가. 절대좌표 조준이라 처음 닿는 x가 그대로 조준에 편입 | [Controls.ts:234](../src/input/Controls.ts)(aim=clientX 절대), [239](../src/input/Controls.ts)(down=즉시 charging) | **치명** — 정조준 발사 불가 |
| 2 | **UI 고정 px 충돌/오버플로** — 볼무게(구 우상단 210px 패널 → 시작 메뉴로 이동해 해소) ↔ 점수판(상단중앙, 풀게임 폭 ~400px+) 좁은 폰에서 겹침/잘림. 파워·스핀(우하단 240px)도 좁은 폭 미고려 | [Hud.ts:76](../src/ui/Hud.ts), [Controls.ts:73](../src/input/Controls.ts) | 높음 |
| 3 | **뷰포트/제스처 미처리** — `viewport-fit`/safe-area 없음, `touch-action`/`user-scalable` 미설정 → 더블탭 줌·핀치 줌·당겨서새로고침·롱프레스 메뉴가 플레이 방해 | [index.html:5](../index.html) | 높음 |
| 4 | **방향 미처리** — 레인이 화면을 세로로 가르는 구도라 세로 폰에서 레인이 과도하게 좁음 | [CameraRig.ts:75](../src/camera/CameraRig.ts)(AIMING 뷰) | 중 |
| 5 | **키보드 의존 잔재** — Q/E 스핀, 조작 안내문이 데스크톱 문구 그대로 | [Controls.ts:258](../src/input/Controls.ts), [Menu.ts:141](../src/ui/Menu.ts) | 중 |

---

## 2. 설계 결정 — 터치 발사 인터랙션 모델

> **상태: ⓑ 확정(2026-06-14).** 두 후보 — ⓐ 풀백 슬링샷 / ⓑ 상대 드래그 + 홀드 차징 — 중
> **ⓑ(상대 드래그 + 홀드 차징)** 를 채택해 구현. 데스크톱과 파워 핑퐁을 공유(손맛 일관)하고 코드
> 변경이 작은 쪽. 실플레이 후 타이밍 압박(§2.2)이 거슬리면 ⓐ로 재검토. (탈락: 스와이프 통합 / 온스크린 분리.)

공통 전제: 터치 기기(`pointerType === 'touch'` 또는 `matchMedia('(pointer: coarse)')`)에서만 분기.
데스크톱 경로(hover 조준 + press 핑퐁 차징)는 **두 안 모두 변경 없음**.

### 2.1 후보 비교

| | ⓐ 풀백 슬링샷 | ⓑ 상대 드래그 + 홀드 차징 |
|---|---|---|
| 제스처 | 한 번의 드래그: **세로 거리=파워, 가로=조준**, 릴리스=발사 | down에서 차징 시작(파워 핑퐁), **드래그 가로=조준 델타**, 릴리스=발사 |
| 조준-파워 분리 | **완전 분리** — 타이밍 압박 없음, 거리로 파워 확정 | **부분 분리** — 위치 편향은 제거되나 *파워 핑퐁이 누르는 즉시 돌아 타이밍 압박은 잔존* (아래 2.2) |
| 코드 변경량 | 중 — 파워를 핑퐁→드래그 거리로 교체(터치 한정), 발사 트리거 재배선 | 소 — 차징/핑퐁/발사·스핀 바 재사용, `pointermove` 절대→상대 + anchor 기록만 |
| 데스크톱과의 손맛 | **분기**(핑퐁 파워는 데스크톱만) — 로드맵 P3 "릴리스 타이밍" 스킬 메타와 플랫폼 갈림 | **동일**(핑퐁 파워 공유) |
| 볼링다움 | 높음(끌어당겨 굴림) | 보통 |

스핀(두 안 공통): 기존 하단 드래그 바 재사용. 던지기 전 미리 세팅(값 유지) → 이후 발사 제스처. 한 손가락 순차 흐름. (플릭 스핀은 조준 드래그와 충돌 → 보류.) 실측 모바일 볼링 사례에선 **드래그에 커브를 줘 스핀** 또는 **둘째 손가락으로 스핀**도 쓰이나, 우리 하단 바가 더 단순·저위험이라 우선 유지(단 바 자체가 터치 타깃으로 작음 → §3.1).

> **실현 가능성(검색 검증 2026-06)**: ⓐ 슬링샷(예: Bubble Golf)·ⓑ 드래그 조준 **둘 다 상용 모바일 게임에서 검증된 패턴** — 어느 쪽도 기술적 리스크 없음. 선택은 손맛 문제.

### 2.2 ⓑ의 잔존 이슈 (정직 메모)
ⓑ의 anchor 방식은 **"닿은 위치가 조준에 편입되는 편향"만** 없앤다(§1.2 #1의 절반). `pointerdown`에서 여전히 즉시 차징을 시작하므로, 데스크톱이 분리해 둔 *조준(무시간)* 과 *파워(타이밍 압박)* 가 터치에선 다시 동시에 걸린다 — "차분히 조준 후 파워" 가 안 됨. ⓐ는 이 압박 자체를 없앤다. **확정 시 이 trade-off(플랫폼 손맛 분기 vs 타이밍 압박 제거)를 의식적으로 선택할 것.**

### 2.3 탈락 대안
- **스와이프 통합** — 한 스와이프에 방향=조준·속도=파워·곡선=스핀까지. 몰입 최고지만 속도→파워, 곡률→스핀 동시 튜닝이 과함. (ⓐ가 이 중 파워/조준만 떼어낸 경량 버전.)
- **온스크린 컨트롤 분리** — 조준 슬라이더 + 발사 버튼. 명확하나 화면을 더 가리고 "직접 굴린다" 느낌이 약함.

### 2.4 공통 구현 주의
- **상대 조준 게인** — `AIM_RANGE=0.08`이고 코드 주석상 **유효 레인은 ±1.6°뿐**([constants.ts:60](../src/game/constants.ts))으로 매우 좁다. 화면 가장자리에서 드래그를 시작하면 전체 범위 도달 전 화면 폭이 동나므로, `AIM_GAIN`(신설, [constants.ts](../src/game/constants.ts)) 보정 + 필요 시 anchor를 중앙 부근으로 보정. **최대 조준(±AIM_RANGE)이 화면폭 절반 정도 드래그로 닿게** 게인을 잡는다(조준 게인은 파워와 무관 — ⓑ의 파워는 핑퐁, ⓐ의 파워는 세로 드래그).
- **터치 이벤트 견고성(필수)** — 현 `Controls`는 `pointercancel`/`pointerId`/`isPrimary` 처리가 없다(grep 확인). 모바일에서 ① 둘째 손가락이 캔버스를 누르면 `power=0` 리셋([Controls.ts:240](../src/input/Controls.ts))되고 아무 손가락이나 떼면 발사 → 오발사, ② OS 제스처(컨트롤센터 스와이프·전화 수신)로 `pointercancel`이 오면 `pointerup`이 안 와 `charging`이 영구 고착. **픽스: `e.isPrimary`로 단일 포인터만 차징, `pointercancel`→차징 중단(발사 안 함).**
- **스핀 드래그도 같은 고착 위험** — `charging`뿐 아니라 `draggingSpin`도 OS 제스처 중단 시 `pointerup`이 안 와 영구 `true`로 고착된다([Controls.ts:254](../src/input/Controls.ts)에서 set, 해제는 `pointerup`에만 — [244](../src/input/Controls.ts)). **`pointercancel`에서 `charging`·`draggingSpin`을 함께 리셋**해야 완결.
- **영향 코드**: [Controls.ts](../src/input/Controls.ts)(`isTouch` 분기, anchor/상대 조준 또는 풀백 파워, `isPrimary`/`pointercancel`, 조작 힌트), [constants.ts](../src/game/constants.ts)(`AIM_GAIN`).

---

## 3. 반응형 UI 재배치

> 브레이크포인트: `(pointer: coarse)` 또는 `max-width: 640px`. 좁은 화면에서 컴팩트 레이아웃으로.

| 요소 | 현재 | 모바일안 |
|---|---|---|
| **점수판**([Hud.ts](../src/ui/Hud.ts)) | 상단중앙, 셀 17px×칸 + 누적 → 10프레임 ≈396px(이름칼럼 +74px). wrap에 `maxWidth:'96vw'`([Hud.ts:88](../src/ui/Hud.ts))가 **이미 있으나** 내부 셀이 고정 px라 96vw 초과분이 `overflow` 미처리로 화면 밖으로 삐져나감(무력) | 셀/폰트 축소 + 가로 스크롤 허용, 또는 **컴팩트 모드**(현재 프레임 + 누적점수만, 탭하면 전체 시트 펼침). 멀티는 세로 스택 유지. ⚠️ 탭 펼침 쓰려면 wrap의 `pointerEvents:'none'`([Hud.ts:87](../src/ui/Hud.ts))을 해당 요소만 `'auto'`로 |
| **볼무게**(시작 메뉴, [Menu.ts](../src/ui/Menu.ts)) | (구) 우상단 210px 인게임 패널 → 시작 메뉴 슬라이더로 이동 | 인게임 패널 제거(BallPicker 삭제)로 점수판 충돌 원천 해소 |
| **파워/스핀**([Controls.ts](../src/input/Controls.ts)) | 우하단 240px 고정 | 폭 `min(240px, 44vw)`, `bottom/right`에 `env(safe-area-inset-*)` 가산 |
| **메뉴/결과**([Menu.ts](../src/ui/Menu.ts)) | 중앙 패널, `overflow` 미처리 | **짧은 가로 화면(landscape 단변 ~375px)에서 내용이 뷰포트를 넘으면 잘림** → 패널에 `max-height: 90dvh; overflow:auto; touch-action: pan-y`(§4와 연동). **`vh` 금지 — iOS 동적 주소창이 `vh`에 포함돼 패널이 화면 밖으로 밀린다. `dvh`(동적, 보수적이면 `svh`)** 사용 |

원칙: 고정 px → `vw`/`clamp()`/`env()` 혼용. 충돌 매트릭스(상단중앙 점수판 ↔ 우상단 볼무게 ↔ 우하단 게이지)를 360/390/414px 폭에서 검증.

### 3.1 터치 타깃 크기·조작성 (UI 개선)

가이드라인(검색 검증): **WCAG 2.2 §2.5.8 = 24×24 CSS px(AA 최소)** · **Apple HIG = 44×44pt** · **Material = 48×48dp** · 실무 권장 **44×44**. 현 UI는 마우스 전제라 핵심 컨트롤이 과소 — 터치 시 히트영역을 키워야 한다(시각 두께는 유지하되 투명 패딩으로 확장 가능).

| 요소 | 현재 | 개선 |
|---|---|---|
| 스핀 트랙 | 높이 **10px**([Controls.ts:151](../src/input/Controls.ts)) | 세로 **히트영역 ≥44px**(투명 패딩) · 썸 16→**≥28px**([Controls.ts:178](../src/input/Controls.ts)) |
| 볼무게 슬라이더 썸 | **18px**([theme.ts `.neon-range`](../src/ui/theme.ts)) | 터치 시 썸 **≥28px** · 트랙 히트영역 ≥44px |
| 메뉴 칩/버튼 | padding 9~12px(높이 ~32px)([Menu.ts:260](../src/ui/Menu.ts)) | 높이 **≥44px** · 인접 타깃 간격 ≥8px |

⚠️ 얇은 스핀 바는 본질적으로 터치에 불리 — **큰 좌/우 스텝 버튼**이나 넓은 아크로 대체도 검토(§2 스핀 흐름과 연동). UI 개선은 M1 레이아웃과 같은 단계.

---

## 4. 뷰포트 · 제스처 · safe-area

[index.html](../index.html):
```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
```
> ⚠️ **iOS Safari는 `user-scalable=no`/`maximum-scale`를 iOS 10부터 무시한다(접근성).** 메타만으로는 iOS 핀치/더블탭 줌이 안 막히므로 메타는 **안드로이드 보조**로 보고, 실제 줌 차단은 `touch-action`이 담당한다 — iOS는 **Safari 13부터** `touch-action`으로 뷰포트 줌 비활성 가능. (웹 검색 검증 2026-06.)

전역 CSS:
```css
html, body { overscroll-behavior: none;   /* Android 당겨서새로고침 + iOS 러버밴딩 (Safari 16+) */
             -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
canvas     { touch-action: none; }         /* 게임 표면: 브라우저 제스처 전부 차단(우리가 처리) */
```
- ⚠️ **`touch-action: none`은 캔버스에만.** body 전체에 걸면 스크롤이 완전히 죽어 **짧은 화면에서 메뉴/결과 오버레이가 넘칠 때 스크롤 불가**가 된다. 넘칠 수 있는 오버레이 패널([Menu.ts](../src/ui/Menu.ts))엔 `overflow:auto; touch-action: pan-y`(세로 스크롤 허용 + 핀치/더블탭 줌 차단)를 따로 건다. 참고: `touch-action: manipulation`은 **더블탭 줌만 끄고 핀치 줌은 안 막는다** — 핀치까지 막으려면 `none`/`pan-y`.
- ⚠️ **높이 단위는 `dvh`/`svh`, `vh` 금지.** 캔버스는 JS `innerHeight`([Engine.ts:90](../src/core/Engine.ts) resize)로 잡혀 주소창 변동에 안전하지만, **CSS `vh`를 쓰는 패널(메뉴 `max-height` 등)은 iOS 동적 툴바 높이가 `vh`에 포함돼** 화면 밖으로 밀린다. 동적 추적은 `dvh`, 잘림이 절대 안 되면 가장 작은 뷰포트 기준 `svh`.
- 멀티터치 핀치 belt-and-suspenders: 캔버스 `touchstart`에서 `e.touches.length > 1` 시 `preventDefault`.
- `overscroll-behavior`는 **Safari 16+**부터 동작하고 html·body **양쪽**에 걸어야 한다(Chrome은 body, Safari는 html에서 먹음). 구형 iOS는 JS `touchmove` preventDefault 폴백.
- 캔버스 `contextmenu` preventDefault(롱프레스 메뉴 차단).
- iOS 주소창 show/hide에 따른 `innerHeight` 변동 → 기존 `resize` 핸들러([Engine.ts:90](../src/core/Engine.ts))로 흡수. 고정 패널은 `env(safe-area-inset-*)` 적용.

---

## 5. 화면 방향 (orientation)

> 기본안: **가로 권장(소프트 안내) + 세로도 플레이 가능**. 강제 잠금은 안 함.

- 세로 감지 시 비차단 오버레이로 "가로로 돌리면 더 잘 보여요" 1회 안내(`screen.orientation`/`matchMedia('(orientation: portrait)')`).
- 세로에서도 굴러가게: AIMING 카메라 FOV/거리를 방향에 따라 살짝 보정([CameraRig.ts:75](../src/camera/CameraRig.ts), [Engine.ts:58](../src/core/Engine.ts) FOV) — 세로면 레인이 화면을 더 채우도록. (M2에서 다듬기)

---

## 6. 성능 적응 (M2, 선택)

- 저사양 판정 시: `pixelRatio` 상한 1.5([Engine.ts:40](../src/core/Engine.ts)), `shadowMap` 1024→512([Engine.ts:72](../src/core/Engine.ts) `mapSize`) 또는 off([Engine.ts:43](../src/core/Engine.ts) `enabled`). ⚠️ **`antialias`는 `WebGLRenderer` 생성자 옵션([Engine.ts:38](../src/core/Engine.ts))이라 런타임 토글 불가** → boot 시 휴리스틱(dpr·`deviceMemory`·화면폭)으로 결정. `pixelRatio`·`shadowMap`은 런타임 조정 가능하므로 측정 FPS 기반 적응은 이 둘만.
- 임팩트 햅틱: `navigator.vibrate()`는 **Android Chrome 한정 보너스 — iOS Safari는 Vibration API 미지원**(웹 검색 검증 2026-06). feature-detect 후 Android에서만 `onPinImpact`([Boot.ts:125](../src/core/Boot.ts)) 훅에 연결, iOS는 무시(웹 폴백 없음).
- **그림자 정적화(큰 효과, 검색 검증)** — 공·핀이 멈춘 AIMING·MENU·GAME_OVER 동안 `renderer.shadowMap.autoUpdate=false`로 매 프레임 셰도우맵 재렌더 제거, ROLLING/SETTLING에만 켠다(시간 대부분이 조준 상태라 이득 큼). [Engine.ts:43](../src/core/Engine.ts).
- **비가시 시 렌더 정지** — `document.hidden`/`visibilitychange`에 `Loop.stop()`/`start()`([Loop.ts](../src/core/Loop.ts)) 재사용 → 백그라운드 배터리·발열 절감(rAF 기본 스로틀의 명시적 보강). **같은 핸들러에서 `AudioContext.suspend()`/`resume()`도 함께** 걸어 오디오 스레드까지 잠근다([SoundManager.ts](../src/audio/SoundManager.ts) `ctx` 노출 필요 — 현재 private).
- 물리 dt·결정성은 **불변** — 시각/입력 레이어만 적응.

---

## 7. 단계 계획

| 단계 | 범위 | 산출 | 난이도 |
|---|---|---|---|
| **M0 — 플레이 가능** | §2 터치 발사 모델(ⓐ/ⓑ 확정) **+ 멀티터치·pointercancel 견고성(§2.4)** + §4 뷰포트/제스처 잠금 + 조작 힌트 모바일화 | 모바일에서 정조준 발사·스핀까지 오발사 없이 정상 동작 | 중 |
| **M1 — 레이아웃·조작성** | §3 반응형 UI 재배치 + **§3.1 터치 타깃 ≥44px** + safe-area + §5 가로 권장 안내 | 좁은 폰에서 UI 충돌/오버플로 없음 + 컨트롤이 손가락으로 잡힘 | 중 |
| **M2 — 폴리시** | §6 성능 적응 품질 + 햅틱 + 방향별 카메라 보정 | 저사양 기기 체감 개선 | 하~중 |

추천 순서: **M0 → M1 → M2.** M0만으로 "모바일에서 일단 된다"가 성립, M1이 보기 좋게, M2가 마무리.

---

## 8. 검증 체크리스트

- [ ] 실기기 — iOS Safari / Android Chrome 각 1대 이상
- [ ] 더블탭 줌·핀치 줌 안 됨 / 당겨서새로고침·오버스크롤 안 됨 / 롱프레스 메뉴 안 뜸
- [ ] 화면 어디서 터치를 시작해도 조준 편향 없음 · 파워 설정(ⓐ 거리 / ⓑ 홀드) · 릴리스 발사
- [ ] 하단 스핀 바 드래그 동작 + 던지기까지 스핀 유지
- [ ] **둘째 손가락 터치해도 오발사·파워 리셋 없음** (isPrimary) · **OS 제스처 중단 후 차징 고착 없음** (pointercancel)
- [ ] 점수판 가독·미오버플로 @ 360 / 390 / 414px 폭 (풀게임 10프레임)
- [ ] 볼무게 ↔ 점수판 ↔ 게이지 비충돌
- [ ] 노치 safe-area 반영 (상·하·좌·우 인셋)
- [ ] 가로/세로 모두 플레이 가능, 세로 안내 1회
- [ ] FPS ≥ 30 (CCD 보완은 이미 적용)

---

## 9. 영향 받는 파일

| 파일 | M0 | M1 | M2 |
|---|---|---|---|
| [index.html](../index.html) | viewport/CSS 제스처 잠금 | safe-area | — |
| [src/input/Controls.ts](../src/input/Controls.ts) | 터치 분기·조준/파워·**isPrimary/pointercancel**·힌트 | 게이지 폭/safe-area | — |
| [src/game/constants.ts](../src/game/constants.ts) | `AIM_GAIN` | — | — |
| [src/ui/Hud.ts](../src/ui/Hud.ts) | — | 컴팩트 점수판 | — |
| ~~src/ui/BallPicker.ts~~ (삭제됨 — 볼무게 시작 메뉴로 이동) | — | — | — |
| [src/ui/theme.ts](../src/ui/theme.ts) | — | `.neon-range` 썸 ≥28px(터치) | — |
| [src/ui/Menu.ts](../src/ui/Menu.ts) | 조작 안내 모바일화 | 패널 overflow/스크롤 + 버튼 ≥44px | — |
| [src/camera/CameraRig.ts](../src/camera/CameraRig.ts) | — | — | 방향별 보정 |
| [src/core/Engine.ts](../src/core/Engine.ts) | — | — | 적응형 품질 |
| [src/core/Boot.ts](../src/core/Boot.ts) | — | — | 햅틱 연결 |
| [src/core/Loop.ts](../src/core/Loop.ts) | — | — | `visibilitychange` 정지/재개 |
| [src/audio/SoundManager.ts](../src/audio/SoundManager.ts) | — | — | 비가시 시 `ctx` suspend (private 노출) |

---

## 부록 A — 외부 검증 기록 (웹 검색, 2026-06-14)

§4·§6의 모바일 브라우저 동작은 변하므로 출처를 남긴다. 착수 전 재확인 권장.

| 주장 | 결론 | 출처 |
|---|---|---|
| iOS Safari가 `user-scalable=no`/`maximum-scale` 무시 | ✅ iOS 10부터(접근성) | [lukeplant.me.uk](https://lukeplant.me.uk/blog/posts/you-can-stop-using-user-scalable-no-and-maximum-scale-1-in-viewport-meta-tags-now/), [bugzilla.mozilla #1340064](https://bugzilla.mozilla.org/show_bug.cgi?id=1340064) |
| `touch-action`으로 iOS 줌 차단 | ✅ Safari 13+. `none`=줌·스크롤 차단, `manipulation`=더블탭만(핀치 안 막음) | [dev.to/shadowfaxrodeo](https://dev.to/shadowfaxrodeo/til-you-can-use-css-to-remove-the-double-tap-zoom-feature-on-ios-2dhi), [MDN touch-action](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action) |
| `overscroll-behavior` Safari 지원 | ⚠️ Safari 16+, html·body 양쪽, 구형은 JS 폴백 | [MDN overscroll-behavior](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior), [chrome dev blog](https://developer.chrome.com/blog/overscroll-behavior) |
| `navigator.vibrate()` iOS 지원 | ⚠️ iOS Safari 미지원 — Android 전용 | [caniuse vibrate](https://caniuse.com/mdn-api_navigator_vibrate), [mdn/browser-compat-data #29166](https://github.com/mdn/browser-compat-data/issues/29166) |
| 발사 제스처 실현 가능성 | ✅ 슬링샷·드래그조준 둘 다 상용 검증 패턴 | [Bubble Golf 슬링샷](https://apps.apple.com/us/app/-/id6758162684), [Trick Shot Bowling 2](https://apps.apple.com/us/app/id1488492145) |
| 포인터 implicit capture / pointercancel | ✅ touch pointerdown=암묵 캡처(up/cancel서 해제), **방향 전환·모달이 pointercancel 유발** | [W3C Pointer Events 3](https://www.w3.org/TR/pointerevents3/), [MDN Pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events) |
| 터치 타깃 최소 크기 | WCAG 2.2 §2.5.8=24px(AA), Apple HIG=44pt, Material=48dp, 권장 44 | [WCAG 2.5.8 guide](https://www.allaccessible.org/blog/wcag-258-target-size-minimum-implementation-guide), [LogRocket target sizes](https://blog.logrocket.com/ux-design/all-accessible-touch-target-sizes/) |
| three.js 모바일 최적화 | pixelRatio cap · shadowMap 512/`autoUpdate=false` · antialias off(boot) · 비가시 시 frameloop 정지 | [Codrops 2025](https://tympanus.net/codrops/2025/02/11/building-efficient-three-js-scenes-optimize-performance-while-maintaining-quality/), [utsubo 100 tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips) |

---

## 부록 B — 문서 정합성 TODO
- [GAMEPLAY_ROADMAP.md:20](GAMEPLAY_ROADMAP.md) "터치엔 스핀 입력 없음" → 스핀 바로 해소됨(stale). 모바일 착수 확정 시 본 문서로 대체 참조.
- [GAMEPLAY_ROADMAP.md:108](GAMEPLAY_ROADMAP.md) P3 "터치 스핀 입력"(플릭 안) → 본 문서 §2.3 대안으로 흡수.
- [PROGRESS.md:100](PROGRESS.md) "모바일 터치 검증" 체크 → §8 체크리스트로 구체화.
