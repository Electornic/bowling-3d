# 개선 리뷰 & 백로그 (polishing 브랜치)

> 작성: 2026-07-06. 3축 병렬 서브에이전트 리뷰(성능·코드품질·버그) + preview UI 확인 + **3회 교차검토**로 확정.
> **총평**: 코어 엔지니어링·게임 로직은 검증 완료로 **매우 견고** — 점수 엔진·상태머신·스플릿·연속스트라이크·10프레임 보너스까지 재현 테스트로 정확성 확인. **진짜 버그는 1건(Low)뿐.** 아래는 "고장 수리"가 아니라 **성능·구조·정리**다.
> 검증 상태: `tsc --noEmit` 클린 · `vitest run` 32/32(+1 skip) · 작업 트리 클린.

---

## 검토 이력 & 신뢰도 (왜 이 리스트를 믿어도 되는가)

3축(성능·코드품질·버그)을 병렬 서브에이전트로 훑고, 하중을 지는 주장은 직접 코드로 교차검증했다. 그 과정에서 **내 판단 2건이 수정**됐고, 후속 검토에서 **#1 캐시 키 1건이 보강**됐다 — 이 리스트는 그 수정을 반영한 확정본이다.

- **정정**: 초기 CSS 권고에서 "Environment가 `NEON` 토큰을 읽는다"고 했으나 **과장이었음** — Environment는 `theme.ts`를 import하지 않고 네온값을 하드코딩 복제. 검증하니 팔레트가 **3중 복제**(theme / Environment 머티리얼 / Environment 캔버스)로 흩어져 있었고, 이게 항목 **#5**가 됐다. (핵심 결론 "토큰은 TS에 둬라"는 오히려 강화됨 — Controls가 `new THREE.Color(NEON.cyan)`로 WebGL에 토큰을 직접 소비하므로.)
- **오탐 제거**: 미사용 export 러프 스캔이 `pinIndexByNumber`·`OIL_DRY_PER_FRAME`·`OIL_DRY_MAX`·`maxConsecutiveStrikes`를 후보로 올렸으나, tests/·파일 내부 호출까지 확인하니 **전부 live**. 죽은 코드로 단정하지 않았다.
- **톤 하향**: `SHAKE_*`는 죽은 코드가 아니라 **의도된 off 스위치**(근거 주석 포함)라 유지. 확정 죽은 코드는 `playHit()` 하나뿐.
- **보강(후속 검토)**: #1 캐시 키에서 볼 물성(`ball.massKg`/`speedScale`) 누락을 발견 — 스킵 최적화 자체는 유효하나, `setSpec()`이 조준 중 호출되는 정상 경로([Ball.ts:100](../src/scene/Ball.ts:100))라 키에서 빠지면 무게 교체 시 조준선이 스테일로 남는다. 키에 추가(#1 fix 반영).

---

## 🔴 Tier 1 — 실행 우선 (실이득·동작 보존·저리스크)

- [x] **1. 조준선 매 프레임 재빌드 제거** `[성능·High]` · [Controls.ts](../src/input/Controls.ts) — ✅ 완료(캐시 가드 + 모듈 스크래치 Color, 런타임 캐시 히트/미스 실측 검증)
  조준 중(가장 오래 머무는 상태)마다 `THREE.Color` 4개 신규 + `path`/`positions`/`coreColors`/`caseColors` 배열 재빌드 + `setPositions`/`setColors` **4회**(LineGeometry 속성 버퍼 통째 재업로드)가 매 렌더 프레임 실행됨.
  **fix**: `(aim, spin, aimAid, oilEndZ, ball.massKg, ball.speedScale)` 캐시 키로 입력 안 바뀌면 재빌드 스킵 + `Color` 인스턴스 재사용(모듈/인스턴스 레벨). ⚠️ `resolution.set`은 리사이즈 반영이 필요하니 캐시 가드 밖에 두거나 리사이즈에서 무효화.
  ⚠️ **볼 물성을 키에서 빼지 말 것** — `speed`([Controls.ts:503](../src/input/Controls.ts:503))가 `ball.speedScale`, `inject`([Controls.ts:509](../src/input/Controls.ts:509))가 `ball.massKg`에 의존하고 `setSpec()`은 "AIMING 중에만 권장"([Ball.ts:100](../src/scene/Ball.ts:100))이라 **조준 중 무게 교체가 정상 경로**. `aim`/`spin`만 키로 쓰면 무게만 바꿨을 때(코어스터치 리셋으로 둘 다 0인 경우 등) 이전 볼 물리로 그린 조준선이 스테일로 남는다. (물성 대신 스펙 버전 카운터도 가능.)
  *검증됨: `aim`은 이산 대입([Controls.ts:383](../src/input/Controls.ts:383)), `spin`은 0.1 양자화 대입([Controls.ts:362](../src/input/Controls.ts:362)) — 매 프레임 스무딩 없음 → 캐시 적중 잦음.*

- [x] **2. 전광판 매 프레임 캔버스 재드로우 스로틀** `[성능·High]` · [Environment.ts:306](../src/scene/Environment.ts:306) — ✅ 완료(~1/24s 스로틀 `lastDraw` 가드, preview 검증)
  `update()`가 **모든 상태(메뉴·유휴 포함)** 매 프레임 `drawScreen()`(그라디언트2 + 태양 + 그리드 33선 + 마퀴) + 768×256 텍스처 재업로드를 무조건 실행 — 바로 옆 섀도우맵 정적화 최적화([Boot.ts](../src/core/Boot.ts))와 모순.
  **fix**: `if (this.time - this.lastDraw > 1/24) { … }`로 ~24fps 스로틀. 스크롤·마퀴·announce 펄스(~2.5Hz) 모두 24fps에서 무손실, 비용 절반↓.

- [x] **3. `Stats.loadStats` localStorage 형태 미검증** `[버그·Low]` · [Stats.ts:32](../src/game/Stats.ts:32) — ✅ 완료(엔트리별 `{...emptyStats(), ...v}` 병합 방어)
  `JSON.parse(raw) as Record<...>`는 컴파일러를 속이는 캐스트 — 형태 검증 없음. `try/catch`는 파싱 throw만 잡고 "유효 JSON·잘못된 형태"는 통과. 손상/레거시 `{"full":{}}`가 있으면 [Stats.ts:49](../src/game/Stats.ts:49) `all[mode] ?? emptyStats()`에서 `{}`가 truthy라 통과 → `Math.max(undefined, score)` = **NaN**이 되고 다시 저장돼 "평균 NaN·스트라이크 NaN%"로 고착.
  **fix**: 로드 시 필드 병합 — `clean[k] = { ...emptyStats(), ...v }` (rewards.ts/settings.ts와 동일 방어). *정상 플레이로는 발생 안 하는 유일한 실버그.*

---

## 🟠 Tier 2 — CSS / 구조 재편

> 핵심 원칙: **성질별 3층 분리** — 정적/애니메이션만 진짜 `.css`로 빼고, 토큰은 TS 단일소스 유지(WebGL이 읽음), 런타임 계산 인라인은 TS에 두되 일관성·팩토링만 고친다. 인라인 스타일 전체를 `.css`로 옮기는 건 이 구조(캔버스 + 명령형 DOM 오버레이, 프레임워크 없음)와 안 맞는다.

- [x] **4. 정적 CSS·@keyframes를 `.css` 파일로 추출** `[구조·High]` — ✅ 완료([ui.css](../src/ui/styles/ui.css) 신설, main.ts import, theme/StillCut/Menu의 `<style>` 제거, preview 검증)
  현재 @keyframes **12개가 4개 파일에 분산**(index.html 2 · [theme.ts](../src/ui/theme.ts) 2 · [StillCut.ts](../src/ui/StillCut.ts) 6 · [Menu.ts](../src/ui/Menu.ts) 2) + `.neon-range` 의사요소 + `@media(pointer:coarse)`가 `<style>` 문자열로 박힘(의사요소·미디어쿼리는 인라인 불가라 어차피 강제됨).
  **fix**: `src/ui/styles/ui.css` 신설 → 위 전부 이동, `main.ts`에 `import './ui/styles/ui.css'` 한 줄(Vite 네이티브, 설정 0). 문법 하이라이트·린팅·HMR 회복.
  ※ index.html 부팅 로더 CSS는 **그대로 둔다** — 모듈보다 먼저 로드돼야 "즉시 타이핑" 연출이 되는 의도된 배치.

- [x] **5. 네온 팔레트 3중 복제 단일소스화** `[구조·High]` — ✅ 완료(theme.ts `ensureNeonStyles`가 `:root --neon-*` 방출→ui.css `var()`+relative color 소비 / Environment가 `NEON` import해 머티리얼·포스터·캔버스 하드코딩 제거)
  같은 네온값이 서로 안 물린 채 3곳에 하드코딩: [theme.ts:12](../src/ui/theme.ts:12) `NEON`(DOM) · [Environment.ts:198](../src/scene/Environment.ts:198) 씬 머티리얼(`0xff2d78`/`0x22d3ee`/`0xdfe8ff`) · [Environment.ts:299](../src/scene/Environment.ts:299) 캔버스 문자열(`'#ff2d78'` 등).
  **fix**: `theme.ts`를 유일 소스로 두고 ⓐ 부팅 시 `:root { --neon-cyan: … }` CSS변수 emit(#4의 `.css`가 `var()`로 소비) ⓑ **Environment도 `NEON` import**해 하드코딩 제거. → CSS·DOM-JS·WebGL 세 세계가 상수 하나 공유, 드리프트 0.

- [x] **6. `Menu.ts`가 `theme.ts`를 쓰게** `[유지보수·High]` · [Menu.ts](../src/ui/Menu.ts) — ✅ 완료(로컬 `css` 복제 제거→theme import, 정확일치 팔레트 gold/cyan/text를 `NEON` 토큰화. 폰트·비토큰 색은 스케일 시스템 부재로 유지)
  최대 파일인데 디자인 시스템을 인라인 복제 — `NEON.gold` 15× · cyan 8× · `rgba(255,255,255,…)` 29× · 폰트 문자열 40× 하드코딩, `theme.ts` import 0. (`Hud.ts`·`Controls.ts`는 올바르게 import함.)
  **fix**: `theme.ts`의 `NEON`/`FONT_UI`/`css`/`rgba` import로 교체. 팔레트 단일 편집점 확보.

- [ ] **7. 공용 컴포넌트 빌더 도입** `[유지보수·Med]` · [Menu.ts:512](../src/ui/Menu.ts:512) — ⬜ **보류**(리뷰 후 별도 패스 권장)
  프라이머리 버튼 스타일 블록이 4곳 손복사(start/재시작/handoff/resume), "장착" 배지·볼 스와치도 중복.
  **fix**: `primaryButton(label, accent)`/`ghostButton`/`pill` 팩토리로 접기(파일 내 `chipButton`이 이미 패턴 증명).
  ⚠️ 4개 버튼이 그라디언트·텍스트색·패딩·마진·minHeight가 제각각이라 바이트 동일 팩토리는 파라미터가 많고 회귀 위험. Menu.ts가 이미 #4·#6로 많이 바뀐 상태 → 이 변경집합 리뷰/커밋 후 집중 패스로 하는 게 안전.

- [ ] **8. god-method 분해(부분 완료)** `[유지보수·Med]`
  ✅ `GameState.update()` → `computeTimeScale()`/`updateRollAudio()` 추출 + 슬로모 이징을 순수함수 `slowmoScale()`로 export → **단위테스트 5건 추가**([tests/slowmo.test.ts](../tests/slowmo.test.ts)). ⬜ **남음**: `showMenu()` 218줄([Menu.ts:325](../src/ui/Menu.ts:325)) → 섹션별 빌더(`buildModeSection`/…) 분해. 순수 가독성 처링이고 Menu.ts가 이미 많이 바뀜 → #7과 함께 별도 패스 권장.

- [x] **9. "양쪽 동기" 중복 export 단일화** `[유지보수·Med, 잠재버그]` — ✅ 완료(`gauss`/`ENTRY_DIST`는 ai.ts에서 export→Controls import / 핀 프로파일은 `constants.PIN_PROFILE`로 승격해 Pin·Environment 공유. Boot 순환 import 회피 위해 Pin.ts 대신 constants에 둠)
  `gauss()`/`ENTRY_DIST`가 [Controls.ts:47](../src/input/Controls.ts:47)↔`ai.ts`에 복제("ai.ts와 동일" 주석), 핀 프로파일이 [Environment.ts:124](../src/scene/Environment.ts:124)↔`Pin.ts`에 복제("바꾸면 양쪽" 주석).
  **fix**: 한쪽에서 export해 공유 — 노이즈 모델/핀 모양 변경 시 sim(AI)↔라이브(플레이어)·씬↔장식핀 어긋남 방지.

---

## 🟡 Tier 3 — 정리·마이너

- [x] **10. 죽은 코드 `playHit()` 삭제** `[정리]` · [SoundManager.ts:206](../src/audio/SoundManager.ts:206) — ✅ 완료
  실제 호출 0(주석 2곳만 언급). **유일한 확정 죽은 public 메서드.** (고아가 된 `lastPlay` 필드 + `playHit` 참조하던 주석 2곳(Boot·constants)도 함께 정리.)
  ※ `SHAKE_*`([constants.ts:104](../src/game/constants.ts:104))는 `SHAKE_ENABLED=false`인 **의도된 off 스위치**(근거 주석 포함)라 **삭제하지 말고 유지**.

- [x] **11. `tsconfig` `noUnusedLocals`/`noUnusedParameters` 켜기** `[정리]` — ✅ 완료
  두 플래그 ON 후 tsc가 딱 2건만 지적(코드베이스가 이미 깨끗) → 정리: `SoundManager.crash`의 미사용 `magnitude`(호출부 항상 0) 제거, `Controls`의 미사용 `engine` 프로퍼티 → 평범 파라미터로(생성자에서만 씀). SHAKE 상수는 `export`라 미지적(유지).

- [x] **12. 미세 성능** `[성능·Low]` — ✅ 완료
  `notifyImpact`의 `.some()`(매 물리 스텝 클로저) → for 루프([GameState.ts:256](../src/game/GameState.ts:256)) · Boot onFrame의 무조건 `style.display` 쓰기 → `matchVisible` 캐시로 변경 시에만([Boot.ts:74](../src/core/Boot.ts:74), null 센티넬로 초기 1회 강제, 섀도우 토글 패턴과 통일).

---

## ⚪ Tier 4 — 문서 드리프트

- [x] **13. `BallPicker.ts`(삭제됨) 참조 정리** ✅ — [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md)·[GAME_DESIGN.md](./GAME_DESIGN.md)가 존재하는 파일처럼 참조 + 코멘트 4곳([GameState.ts:160](../src/game/GameState.ts:160)·[Ball.ts:100](../src/scene/Ball.ts:100) 등)을 "메뉴 무게 슬라이더"로 갱신.
- [x] **14. AI 이름 stale 수정** ✅ — [PROGRESS.md](./PROGRESS.md) "다음 세션 첫 할 일 #2"의 "미확정=흥부/홍길동/놀부"는 stale. 코드는 **초보/중수/고수**(난이도 티어, 내부 key kim/han/yoon)로 **이미 해결**됨.

---

## ✅ 검증 완료 — 손대지 말 것 (건드리면 손해)

재조사 방지용. 아래는 리뷰에서 "잘 돼 있음"으로 확인된 것들이다.

- **코어 루프/엔진** ([Loop.ts](../src/core/Loop.ts)·[Engine.ts](../src/core/Engine.ts)) — 고정 timestep accumulator + 보간, 벡터 재사용(hot path 무할당), timeScale/pause 인프라. 성능 clean.
- **CameraRig·Replay** — 모듈 레벨 스크래치 벡터/쿼터니언 재사용, Float32Array 스냅샷. 무할당.
- **점수 엔진·상태머신** — 300/275/블리츠/10프레임 보너스, `maxConsecutiveStrikes`(프레임 경계), 스플릿(슬리퍼 2-8/3-9 비스플릿·7-10), settle 타임아웃 vs 핀 안착 레이스 — 전부 재현 테스트로 정확.
- **타입 규율** — `as any`/`: any`/`@ts-ignore`/`debugger`/`TODO` 0건. 디버그 글로벌은 타입 선언으로 노출.
- **미사용 의심 export 4개** — `pinIndexByNumber`/`OIL_DRY_PER_FRAME`/`OIL_DRY_MAX`/`maxConsecutiveStrikes` 전부 live(내부+테스트 사용). 지우지 말 것.

---

## 📋 로드맵 (제품 판단 — 코드 결함 아님)

문서 기준 남은 것들. 코드 리뷰 대상이 아니라 방향 결정 사항.

- iPhone 실기 검증 (브라우저 375/402px만 검증된 기능 다수)
- 손맛 튜닝 — 릴리스 타이밍(실플레이)·오일 프리셋
- P5 보상 — glow 스킨 bloom 승격·stretch 업적·애니 스킨
- 실물 에셋 — GLTF 핀·공, HDRI, 실음원(환호 등)
- hotseat 플레이어별 볼 색 구분 (쉬움)

---

## 추천 착수 순서

**#4 + #5 + #6**(CSS 3층 분리 + 팔레트 단일소스 — 구조가 가장 깔끔해지고 #7 유지보수와 함께 해소) → **#1 + #2**(성능, 모바일 체감) → **#10 + #11 + #13 + #14**(정리·문서). Tier 1 #3(Stats)은 어디든 끼워 넣기 쉬움.
