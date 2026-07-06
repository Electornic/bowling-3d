# 진행 상황 & 다음 세션 핸드오프

> 마지막 구현: 2026-06-17 (13·14차 — ③ 승리 보상(업적+스킨) + 컬렉션 시트 UI 리디자인 + 인게임 UX 수정([DEV] 전체해금 제거·포기 오버레이·메뉴버튼 위치·safe-area·패널 폭); **`f46e7be` 커밋**·브라우저(375/402px) 검증 완료·iPhone 실기 미검증. 12차 P3 오일 메타 `d57c9a6`, 10·11차 UI/점수판 `9a46796`·iPhone 확인)
> 마지막 구현: 2026-06-20 (로컬 2인 교대전(hotseat) + 턴 핸드오프 — 메뉴 `👥 2인` 칩+이름 입력, `Menu.showHandoff`+`GameState.inputLocked`(직전 사람 조준이 다음 사람에게 새는 오발사 차단), 결과 `🏆 [이름] 승리!`. **코어 변경 0**(P1.5 멀티 구조 재사용)·UI만. hotseat는 기록/업적 저장 생략(파티 모드). tsc 0·vitest 32/32·빌드 OK·dev 런타임 확인·**미커밋**. 상세 ↓ "남은 작업")
> 마지막 갱신: 2026-06-20 (로컬 2인 교대전 문서 반영. 이전 갱신: 15차 문서 정합 — 13·14차 `f46e7be` "미커밋" 표기 일괄 정정)
> 설계 문서는 [GAME_DESIGN.md](./GAME_DESIGN.md), 게임성 로드맵은 [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) 참고.

---

## 한 줄 요약

**게임 루프 + 타격감 + 모바일 + 패키징까지 완성.** 메뉴 → (풀게임/블리츠/스페어 챌린지) × (혼자/AI 라이벌 3인) → 결과/하이스코어 → 재시작. 핀 캐리 튜닝으로 훅이 최적해. P2 연출 본편(슬로모·임팩트 사운드·접근 카메라·전광판)·모바일 터치·Tauri/Android APK까지 구현됨. **9차에 거터 벽 점멸 해결(z-fighting — Environment 레일 제거) + UI 전면 개편. 10차에 인게임 UI 개선(파워 게이지 실체화·하단 도크 통합·조준선 고대비/곡률압축/파워분리·공 가림 해소). 11차에 점수판(Hud) 개선(방향 A "한 줄 꽉 채우기" + 멀티 비활성 미니, `9a46796`·iPhone 확인 완료). 12차에 P3 오일 메타(프리셋 3종+레인 마름)+예측선 난이도 3단(`d57c9a6`, 실기 일부 잔여), 상세 [UI_REVAMP.md](./UI_REVAMP.md)·[OIL_META_AND_AUTO.md](./OIL_META_AND_AUTO.md).** 10~12차 전부 커밋 완료. 13차에 ③ 승리 보상(업적+스킨) 구현, 14차에 보상 UI를 "컬렉션 시트"로 리디자인(미리보기 볼+업적 섹션) + 인게임 UX 버그 수정(포기 오버레이·메뉴버튼 위치·safe-area·패널 폭) + [DEV]전체해금 제거(**13·14차 = `f46e7be` 커밋**). **로컬 2인 교대전(hotseat)+핸드오프 구현(2026-06-20, 코어 변경 0·UI만).** 남은 건 AI 이름 확정 · iPhone 실기 검증 · P3 릴리스 타이밍 · 보상 P5/bloom · ④에셋.

## 14차 세션에 한 일 (보상 UI 컬렉션 리디자인 + 인게임 UX 버그 수정)

13차 보상 시스템을 실제로 iPhone에서 보다가 나온 UI/UX 문제들을 수정. **전부 브라우저(375/402px) 실관측 검증, tsc 0 · vitest 32/32 · 13차분과 함께 `f46e7be` 커밋.**

- **보상 스킨 시트 → "컬렉션" 시트로 리디자인** ([Menu.ts](../src/ui/Menu.ts) `showSkins`): 16px 점 스와치가 휑하던 문제 → **42px 미리보기 볼**(CSS 그라데이션으로 메탈릭/새틴/글로우/크롬 마감 근사, 3D 미사용 `skinPreviewStyle()`) + 장착 골드테두리/`장착` 배지 + 잠금 시 🔒+해금조건. **업적 섹션 신설**(6개 ✓/🔒 + 해금 스킨 + `N/6 달성`·`N/7 해금` 진행도, `collectionHeader()`). 제목 `볼 스킨`→`🎨 컬렉션`, 메뉴 진입 버튼도 `🎨 컬렉션 ·`. → REWARDS.md §10 "전용 스킨 시트"가 이 구현으로 갱신됨(컬렉션+업적 한 시트).
- **[DEV] 보상 전체해금 줄 제거** ([Boot.ts](../src/core/Boot.ts)): 13차 ④의 `recordRewards(ACHIEVEMENTS…)` 부팅 자동해금 제거 → 실제 진행 상태로 시작(잠금조건/토스트가 보임). 테스트는 콘솔 `__unlockAllRewards()`/`__resetRewards()` 유지. **(13차 핸드오프 "커밋 전 제거 필수" 완료.)**
- **포기 = 네이티브 confirm() → 앱 내부 오버레이** ([Menu.ts](../src/ui/Menu.ts) `showForfeitConfirm` + [Boot.ts](../src/core/Boot.ts) `forfeit`): iOS 시뮬레이터/웹뷰/PWA에서 `confirm()`이 안 뜨고 falsy 반환 → 포기 먹통이던 버그. 메뉴/결과와 같은 DOM 오버레이(`게임을 포기할까요?` + 계속하기/포기)로 교체, 전 플랫폼 동작. **(13차 ① "Esc/☰ → confirm" 노트를 대체.)**
- **☰ 메뉴 버튼 위치** ([Hud.ts](../src/ui/Hud.ts)): 점수판이 상단 중앙정렬 풀폭(≈96vw)이라 좌상단 ☰ 버튼이 플레이어1 이름칸과 겹침 → 점수판 `top` `10px`→`56px`(버튼 높이 40+여백 아래)로 내려 세로 분리(프레임 폭=가독성 유지).
- **상단 safe-area 침범 해소** ([Menu.ts](../src/ui/Menu.ts) 백드롭): 컬렉션 시트가 `maxHeight:90dvh` 꽉 차 중앙정렬 시 상단 여백 41px<노치 59pt → 침범. 백드롭에 `padding: max(env(safe-area-inset-*), 12~16px)`+`border-box`+`height:100dvh`, 패널 `maxHeight 90dvh→100%`. 메뉴/결과/컬렉션/포기 오버레이 전부 안전(시뮬 인셋 59px 주입 시 상단 여백 59px 확인).
- **패널 폭 통일** ([Menu.ts](../src/ui/Menu.ts) 패널): 모바일 `minWidth:auto`라 내용 좁은 컬렉션이 메뉴보다 홀쭉 → `width: min(360px,92vw)`+`border-box`로 뷰 무관 고정폭(402px서 360px, 오버플로 없음 확인).
- **남은 것**: iPhone 실기 검증 · (큰 거) P3 릴리스 타이밍 · 보상 P5/bloom · ④ 실물 에셋. (AI 이름은 **초보/중수/고수**로 확정됨. 커밋은 `f46e7be`로 완료.)

## 13차 세션에 한 일 (구현 상황 점검 + 문서 정합 + ③ 승리 보상 구현)

전반부는 상태 검증 + 문서 정합(코드 무변경), 후반부에 ③ 승리 보상(업적+스킨) 구현. **이후 14차분과 함께 `f46e7be` 커밋(작성 당시엔 미커밋).**

- **검증(점검 시점)**: `tsc --noEmit` 클린 · `vitest run` 22/22(+1 AI_SIM skip) · `npm run build` 프로덕션 OK(번들 2.8MB→gzip 1MB) · 작업 트리 클린 · `develop`=`origin/develop` 동기, `main`보다 4커밋 앞섬.
- **정정**: 10·11차(`9a46796`)·12차(`d57c9a6`)가 전부 커밋됐는데 문서 곳곳이 "미커밋"으로 남아 모순(헤더·체크리스트는 커밋됨으로 적힘) → "미커밋" 표기 일괄 정정(PROGRESS·OIL_META_AND_AUTO·UI_REVAMP). 실기 검증 상태는 10·11차=완료, 12차=잔여로 정리.
- **[REWARDS.md](./REWARDS.md) 코드 참조 재검증 + 모순 정리**: §11/§12 라인 참조 거의 정확(`Engine.ts:54/57/80-82`·`Ball.ts:37/52/97`·`Stats`/`GameState`/`BallSpec`/`ai` 심볼 일치, `GameSummary{winner, frames, players[].ai:boolean, score}` 일치). 미세 드리프트(Lane `envMapIntensity:0` `:80`→`:81`, `AiProfile.key`는 `string`). **모순 2건 해소**: ① §11 glow 트레이드오프 "(미결)" ↔ §16 #6 "재조정 안 함" → §16으로 통일(수용) ② obsidian이 §16 #1=v1인데 §6=stretch → §6 기준(P5)으로 통일, v1=7종 확정. 크롬 가독성을 §14 P2 완료 게이트로 명시.
- **③ 승리 보상 구현([REWARDS.md](./REWARDS.md) §14 P1~P4, bloom 분리)**: 신규 `src/game/rewards.ts`(스킨 7종 카탈로그 + 업적 core 6 + localStorage `bowling3d.rewards.v1` + 순수함수 `evaluateAchievements`/`maxConsecutiveStrikes`). `Ball.setSkin()`+`applyMaterial()`(머티리얼 파라미터만 — 물리/AI 사다리 무영향) + `decorColor` 그립 재색(`Ball.ts:52` 묻힘 이슈 동시 해결). `GameState`: `PlayerSummary`에 `aiKey`/`rolls` 추가, `setBallSkin`(외형만), AI는 classic 고정. `Menu`: 스킨 시트(`showSkins` — 잠금+해금조건, 컬렉션 겸용) + 결과 화면 해금 토스트+즉시 장착 버튼. `Boot`: gameOver에서 평가·기록·`SoundManager.playUnlock()` 딩, 저장 스킨 부팅 시 적용. **검증: tsc 클린 · vitest 32/32(+1 skip, 신규 rewards 10) · 프로덕션 빌드 OK.** glow 4종(ember/volt/galaxy/sunset)은 bloom 전까지 "밝은 색" 강등(설계대로). **남은 것: 브라우저/iPhone에서 스킨 시트·해금 토스트·크롬 가독성(`envMapIntensity` 실측, §14 P2 게이트) 확인. P5(stretch 업적·obsidian/holo/pulse·애니 스킨·bloom)는 미착수.**

- **인게임 메뉴/포기 + AI 라이벌 리네이밍(이름 미확정)**: ① [Boot.ts](../src/core/Boot.ts)에 게임 중 좌상단 "☰ 메뉴" 버튼(Loop onFrame에서 매치 중에만 노출) + Esc → confirm 후 `toMenu()`+메뉴 복귀(기록 미저장). ② AI 칩 "난이도" 단어 충돌 제거: `AiProfile.difficulty` 필드 제거, 칩=이름만(평균점수 숨김), 라이벌 식별은 `key`(kim/han/yoon) 유지 → 저장 호환. ③ **AI 이름 미확정** — 현실(김부장)→별명(꾸준이)→동물(거북이)→전래동화(흥부/홍길동/놀부)까지 돌렸으나 "삘 안 옴". 가설: 네온 신스웨이브 톤에 정겨운 이름이 안 붙음 → 쿨/스타일리시(**정석·제로·올인** / **PULSE·BLADE·JOKER**) 후보로 다음 세션 결정. **현재 코드엔 흥부/홍길동/놀부**가 들어가 있음(임시). ④ **[DEV] Boot.ts에 보상 전체해금 1줄**(`recordRewards(ACHIEVEMENTS…)`) — 사용자 테스트용, **커밋/배포 전 제거 필수**(있으면 해금 토스트 안 뜸). 검증: tsc 클린·vitest 32/32·빌드 OK. **→ 14차에 부팅 자동해금 제거(콘솔 `__unlockAllRewards()`만 유지), `f46e7be` 커밋.**

## 12차 세션에 한 일 (P3 숙련 깊이 — 오일 메타 + 예측선, `d57c9a6` 커밋)

물리 상수였던 오일 상태를 가변 모듈로 분리하고(공통 선행), 그 위에 오일 프리셋·예측선 난이도·레인 마름을 올렸다. **기본값(하우스+이지)은 현 거동을 픽셀 단위로 보존** — sim-carry 기본 윈도우가 baseline과 완전 동일(직구 4/31·훅 7/31)임을 확인해 안전 증명.

1. **오일 상태 파라미터화** — `src/game/oil.ts` 신설. `hookFactor`/`OIL_END_Z`/`HOOK_RAMP`를 constants에서 분리, 가변 `endZ`/`ramp`로. Lane·Ball·Controls 예측선이 모두 여기서 읽어 **물리와 예측선이 같은 오일 상태**를 본다(정합 공짜). 마찰값(LANE_FRICTION_*·FRICTION_K)은 constants 고정 → sim-carry `--oilEnd/--hookRamp`로 그대로 검증.
2. **오일 프리셋 3종** (`OIL_PRESETS`, 메뉴 선택) — 하우스(10.5, =현 동작)/숏(9.5, 일찍 깨져 과훅→라인 재독)/롱(12.5, 늦게 깨져 직진 강요). geometry(endZ)만 이동, ramp 3.5 고정. sim-carry 윈도우: 하우스 직구4/훅7 → 숏 직구6/훅3 → 롱 직구4/훅3(진입각↓). 오일 광택 시트 길이도 프리셋에 맞춰 시각 단서화(`Lane.applyOilVisual`).
3. **예측선 난이도 3단** (`aimAid`, 메뉴 선택, **점수·물리 무영향**) — 이지=풀 곡선(현 동작)/노멀=오일 존 끝까지만(직진 구간만, 훅 숨김→직접 읽기)/프로=짧은 방향 표식. `Controls.updateAimArrow` 적분 종료 z만 분기.
4. **레인 마름** (`advanceOilDrying`, full 모드만) — 프레임 진행마다 오일 존이 0.12m/프레임 앞으로(상한 1.5m). 후반 frame9 ≈ oilEnd 9.42 → 훅 윈도우 7→3 완만 전환(`OIL_DRY_PER_FRAME`로 튜닝). 예측선도 공유 오일 읽어 자동 반영. (광택 시트는 시작 프리셋 기준 — 마름 시각 반영은 후속.)
5. **AI 오일별 재캘리브레이션** (옵션 c) — 훅형(윤) 조준의 `HOOK_DRIFT`를 `oilEndZ()` 함수로(`0.33 − 0.070×(endZ−10.5)`, sim-carry 총휨 적합: 하우스0.33/숏0.40/롱0.19). 직구형(김/한)은 spin=0이라 오일 무관. 마름도 endZ를 줄여 자동 반영. **프리셋별 매치 sim(N=80) 검증**: house 133/233/174 · short 138/236/166 · long 132/225/163 — 사다리 순서(한>윤>김)·밴드 유지, **윤이 숏/롱에서 안 무너짐**(보정 없으면 숏 과훅→노즈히트→붕괴). 테스트에 `AI_SIM_OIL` 프리셋 루프 추가.

검증: tsc 클린 + vitest 22/22(+1 skip) + **프로덕션 빌드 OK** + sim-carry(기본=baseline 동일, 프리셋 분기, 마름 전환) + **AI 매치 sim 프리셋 3종 정상**(`AI_SIM=1 AI_SIM_N=80`). **남은 것: dev/iPhone 실기 — 메뉴 신규 2행 레이아웃, 조준 보조 3단 선 형태, 숏/롱 손맛, 후반 마름 체감.** 릴리스 타이밍(P3 3축)은 다음 세션으로 격리(코어 손맛+AI 캘리브레이션 얽힘, aim 노이즈 측정 도구 선행 필요). **별건 미결: "캐주얼이 오일을 직접 고를까 / 오토 튜닝" — 구현분 + 자동의 기준 정의를 [OIL_META_AND_AUTO.md](./OIL_META_AND_AUTO.md)에 분리 정리(자동의 목표부터 확정 필요).**

## 11차 세션에 한 일 (점수판 Hud 개선 — `9a46796` 커밋·iPhone 확인 완료)

> 상세·결정·검증은 [UI_REVAMP.md](./UI_REVAMP.md) "점수판(Hud) 개선" 섹션. 전부 `src/ui/Hud.ts`, **`9a46796` 커밋·iPhone 확인 완료**(인게임 HUD는 메뉴 오버레이로 프리뷰 직접 관측 불가 → 동일 CSS 격리 주입으로 측정).

발단: 이전 계획의 솔로 안(가로 스크롤 / 2행 5+5) **둘 다 사용자가 기각**. 재검토 결과 계산상 솔로는 이미 한 줄이 iPhone 17 Pro에 거의 들어감(여유 ~14px) → "2행"은 솔로에선 없어도 되는 문제였음.

1. **방향 A "한 줄 꽉 채우기" 채택** — `row`를 `width:fit-content`+`maxWidth:96vw`로, 프레임·셀을 `flex:0 1 auto|${CELL}px`+`min-width:0`로. 여유 있으면 기본 크기(`CELL` 13/17px), 좁으면 모든 셀이 동일 basis라 **균일 축소**(스크롤 0). 정석 "한 줄 10프레임" 관례 유지(2행 기각 사유 해소). `overflowX:auto` 제거.
2. **멀티 = 2인 모두 풀 시트 세로 스택** — (미니 접기 시도했다가 철회: active 행이 항상 10칸+이름이라 HUD **최대 폭을 이미 정함** → 비활성을 풀로 깔아도 폭 추가 0, 세로 ~1줄만. 직관 비교 우선.) 빈 프레임이 안 찌그러지게 행에 정해진 폭 `min(96vw, NAT_SHEET+NAME_W)` + 셀 `flex:1 1 0` ([[verify-fit-to-width-empty-state]] — fit-content는 빈 칸에서 collapse).
3. **누적 총점 폰트 = 기본 유지**(`SCORE_FS` 12/14) — 처음엔 +1 했다가 셀이 flex로 좁아져(프레임 ~26px) 3자리(176/300)가 답답(폭 90%)해 원복(12px=84%).

⚠️ **버그·수정**: 1차에 `fit-content`+`flex:0 1 CELLpx`로 했더니 iPhone에서 **초반 빈 칸이 폭 0으로 collapse**(점수판이 작은 캡슐로 찌그러짐). 원인은 `fit-content`가 빈 내용을 0으로 산정. → **`row{width:min(96vw,자연폭)}` + 셀 `flex:1 1 0`(basis 0, 내용 무관 비례 분배)** 로 교정. 1차 격리 측정이 "채운 점수표"라 빈칸을 놓쳤음 → **빈 상태로 재검증**.

검증: tsc 클린 + vitest 22/22 + 프리뷰 격리 재측정(빈칸·채운칸 / 320·393px / 솔로·멀티 전부 한 줄·넘침 0) + iPhone 실기 확인. `9a46796` 커밋(10차분과 묶음).

## 10차 세션에 한 일 (인게임 UI 개선 — `9a46796` 커밋·iPhone 확인 완료)

> 상세 설계·진단·레퍼런스·결정·체크리스트는 [UI_REVAMP.md](./UI_REVAMP.md). 전부 `src/input/Controls.ts` + 문서, **`9a46796` 커밋·iPhone 확인 완료**.

1. **P1 파워 게이지 실체화** — 빈 캡슐 → ⚡ 아이콘 + 흐린 최적존 띠(0.6~0.9) + 진입 경계선.
2. **P2 하단 도크 통합** — 스핀 좌하단 2단(헤더+트랙)·파워 우하단 세로 같은 베이스라인, 액센트 시안 통일·중립 썸 ice(purple 제거).
3. **P3 조준선 고대비 + 끝점 링** — 페이드 늦춰(중반에 녹던 것) 중립 흰선 가독성↑ + 경로 끝 스핀색 타깃 링.
4. **P4 공 가림 해소** — P2 도크가 가운데 비워 공·조준선 밑동 노출.
5. **조준선 거동 수렴** — 차징 풀파워 "버벅"(끝점 스텝 스냅) 발견 → 하드클램프("맥시멈 고정" 느낌)·파워비례 자라남(핑퐁 펌프질 부자연) 거쳐 **파워와 분리해 고정**(대표 `p=0.6`)으로 수렴. 길이는 `REF_Z=14` 곡선을 `DRAW_Z=5`로 **곡률 보존 압축**(짧아도 훅 보임).

검증: tsc 클린 + 데스크톱 프리뷰 + iPhone 실기 확인(조준선 안정/곡률·폰 도크 46vw). `9a46796` 커밋.

## 9차 세션에 한 일 (UI 전면 개편 + 거터 벽 점멸 해결, 커밋 `9fcc1de`)

1. **거터 벽 점멸 해결** — 원인은 AA/반사가 아니라 **z-fighting**: Lane 거터 바깥벽과 Environment 레일이 동일 평면(x=±0.755) 겹쳐 깊이 경쟁. Environment 레일 생략으로 해소. pixelRatio 비저사양 3→2 롤백. (8차 "WIP"였던 것 종결.)
2. **조준 표시 Line2화** — 점/메시 → 굵기 지원 곡선 라인(외곽선+코어 2겹, L=시안/R=앰버/0=흰색, 끝 페이드).
3. **하단 컨트롤 개편** — 스핀 풀폭 단일 줄, 파워 우측 세로, **볼 무게 인게임 제거 → 시작 메뉴 이동 + BallPicker.ts 삭제**. 나무 텍스처 39판자.

> ⚠️ 이 커밋의 UI는 10차에서 다시 개선됨(위) — 빈 게이지·입력 비대칭·조준선 가독성·공 가림 문제가 남아 있었음.

## 8차 세션에 한 일 (거터볼 끝까지 굴림 + 렌더링 + 점멸 조사)

> 발단: P2 ⑥(충돌 시각효과)를 "카메라 셰이크/FOV 펀치"로 시도했으나 **"볼이 핀에 닿는데 화면 진동은 비현실적"** 피드백 → 카메라 효과 전면 폐기. 충격은 핀 물리(fly-out)·사운드로 표현하는 방침 확정. 그 과정에서 거터볼 버그·렌더링 점멸 발견.

1. **느린 거터볼 "끝까지 안 굴러가고 레인 끝에 멈춤" 수정** (검증 완료) — 헤드리스 repro(`__engine.step`+`__game.update` 동기 스텝)로 원인 규명:
   - **거터 채널이 공보다 좁음**: 바깥 벽([Lane.ts](../src/scene/Lane.ts))이 거터 바닥을 2.5cm 침범 → 실효 채널 0.205m < 공 지름 0.218m → 공이 레인 끝 날카로운 모서리에 끼어(perch) 그 위를 타고 가다 멈춤. → **벽을 바깥으로 이동(`wx = side*(half+gw+0.025)`)해 거터 정상 폭(0.23m)**.
   - **거터 진입 시 골로 안착 + 끝까지 굴림**: `GameState.settleGutterPerch()` — 공 중심이 레인 끝(±LANE_WIDTH/2) 넘으면 거터 골로 떨궈넣고 핀 쪽 끝까지 갈 속도 부여(투구당 1회 플래그). 정상 투구 오탐 0(repro 확인).
2. **핀 선형감쇠 0.8→0.7** (`PIN_LINEAR_DAMPING`) — 손맛(덜 묵직). sim-carry에 `--flyout` 감쇠 스윕 + 흩어짐 메트릭 추가해 트레이드오프 측정: **0.35 밑은 직구가 훅 추월(훅-최적 붕괴)=마지노선**, 반발 올리기는 즉시 훅-최적 깨짐(폐기). AI 매치 sim 재실행 → **사다리 135/232/167 불변**(노이즈 수준, 재튜닝 불요).
3. **임팩트 사운드 서브베이스** ([SoundManager.ts](../src/audio/SoundManager.ts) `crash`) — 큰 스트라이크에 70→34Hz 흉부 thump(intensity 게이트, 작은 히트엔 0).

검증: tsc 클린 + vitest 22/22 + 헤드리스 repro(거터볼 z≈20 뒤끝 도달, 정상투구 오탐0) + iPhone 실플레이 OK. develop 브랜치 `140c18e` 커밋·푸시.

## 7차 세션에 한 일 (① 스핀 손맛 + ② AI 난이도 사다리)

계획·검토 문서: [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) (웹서치 물리 정합 재검토 포함).

1. **① 스핀 손맛 — `spin^0.7` 입력 곡선** (`constants.ts` `SPIN_POW=0.7`/`effectiveSpin()`, [Ball.ts](../src/scene/Ball.ts) 발사·[Controls.ts](../src/input/Controls.ts) 예측선 공용). sim-carry 확장(스핀 레버 CLI + 파워×스핀 그리드 + 막판 곡률 출력)으로 **물리 레버 전수 스캔**: `ROLL_RATIO`/`SLIP_EPS`/`FRICTION_K`/`OIL_END_Z`/`HOOK_RAMP` 전부 **저/미드스핀 dead zone을 못 살림(가드만 붕괴) 확정**. 훅은 횡슬립 비율 ∝ 스핀이라 어떤 물리 레버도 풀스핀 가드를 안 깨고 약스핀을 못 살린다 → 스핀 *입력*을 `spin^0.7`로 리매핑(1.0 고정점 = 풀스핀·전 가드 −30cm·4/31·7/31·65cm **자동 불변**, 저/미드 막판스냅 **+40%**). 사용자 손맛 OK.
2. **② AI 난이도 사다리** — 헤드리스 매치 sim 신규([tests/ai-match-sim.test.ts](../tests/ai-match-sim.test.ts): vitest `.ts`·`runIf(AI_SIM)` 가드·`constants`/`computeAiThrow`/`totalScore` import·투구별 Rapier 핀=드리프트 0). **캘리브레이션 버그 발견·수정**: AI 직구가 `POCKET_X_STRAIGHT=0`(헤드핀 정면=노즈히트=스플릿)을 노려 스트라이크가 안 났음(점수가 jitter 무관 ~120-156에 뭉친 진짜 원인) → 미세스윕으로 실제 포켓 −7cm 확인 → `POCKET_X_STRAIGHT` 0→**−0.07**, `POCKET_X_HOOK` 0.067→**0.05**. jitter 튜닝(N=200): **김부장 130(쉬움)·한프로 228(어려움)·도박사 윤 169±28(고변동·sd 최대)**, 김↔한 98점차. `HOOK_DRIFT_HOUSE=0.33`(12차에 `HOOK_DRIFT_FULL`에서 리네임)은 `effectiveSpin(1)=1`이라 ①과 무관히 유효(윤 재측정 불필요). 메뉴 칩에 `난이도` 표시([Menu.ts](../src/ui/Menu.ts), `AiProfile.difficulty` 신규).

검증: tsc 클린 + **vitest 22/22**(+ 매치 sim 1 skipped, `AI_SIM=1`로 실행) + 브라우저 메뉴 확인. 인사이트는 `knowledge-hub-private/game-dev/ai-difficulty-via-aim-variance.md`에 정리.

## 6차 세션에 한 일 (P2 다듬기 + UI + 모바일 + 패키징)

> ⚠️ GAMEPLAY_ROADMAP.md는 5차(v5)에서 멈춰 P2/모바일을 "남은 작업"으로 적고 있으나 **아래 작업으로 대부분 해소됨** — 로드맵은 다음 갱신 시 v6 반영 필요.

1. **P2 타격감 다듬기** (`3597b60`) — 임팩트 사운드를 투구당 1회 크래시로 통일(`game.notifyImpact`→`onPinImpact`, 충돌 윈도우 누적 드럼난타 제거), 어택을 '나무 크랙'으로 재설계. 임팩트 트리거를 `PIN_CONTACT_Z`(실접촉 거리)로 당김(닿기 전 소리 해소). 카메라 핀 접근뷰(볼 진행도 `u` 연속 종속 smoothstep). 핀 `clearDeadwood`→`respot`(1·2구 사이 선 핀 제 스폿 재배치 = 자동 핀세터, AI 조준도 동반 교정).
2. **UI 네온 통일 + 전광판 일원화** (`801bd34`) — 공통 네온 토큰(`ui/theme.ts`), 커스텀 네온 볼무게 슬라이더, 스핀 바 드래그 입력(Q/E 병행), 모든 이벤트 텍스트를 전광판으로 일원화(HUD 중앙 배너 중복 제거), 거터 어나운스, 조준선 앞부분만 표시(훅 결과 숨김).
3. **모바일/터치 대응** (`ac0ef80`) — 터치 발사(드래그 조준 + 홀드 차징), 멀티터치·pointercancel 견고성, 반응형 UI(컴팩트 칩·전체폭 게이지 도크·≥44px), safe-area·햅틱(Android)·저사양 적응. **버그픽스: 파워 차징 dt 기반화**(FPS에 따라 차징 속도 변하던 것). 임팩트 push-in **재활성**(`PUSHIN_DIST` 0.6). [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md) 신규.
4. **Tauri v2 패키징 + Android APK CI** (`c447a2b`, `cda1e4a`) — `src-tauri/` 4플랫폼 스캐폴딩, main 푸시 시 `vYYMMDDNN` 태그로 APK 빌드→GitHub Release CI, Hud 상단 safe-area inset. [APP_PACKAGING.md](./APP_PACKAGING.md) 신규.

검증: tsc 클린 + **vitest 22/22** + 실플레이 확인 (각 커밋 메시지 참조).

## 5차 세션에 한 일 (로드맵 P0.5 → P1 → P1.5)

1. **P0.5 핀 캐리 밸런스** — sim-carry.mjs를 CLI 파라미터화(`--pinRest --pinDamp --pinMass --pinFric --ballRest --pinComY`)하고 그리드 스캔. **핀 선형 감쇠 0.8 + 핀 반발 0.3** 확정 (`PIN_LINEAR_DAMPING`/`PIN_RESTITUTION`, constants.ts): 직구 풀파워 윈도우 8/31→**4/31**, 훅 풀파워 7/31 유지 = 직구의 1.75배(목표 2배에 1카운트 부족, 인접 조합 전부 열세 — 부족분은 P3 릴리스 타이밍 레버가 후보). 감쇠가 "날아가는 핀의 운 좋은 체인"을 죽이는 게 직구만 선택적으로 깎는 유일한 레버였음. 단일 레버(반발↓/마찰↑/질량↑/COM↓)는 전부 훅을 더 깎음.
2. **P1 게임 루프** — `GameStateName`에 MENU 추가, `GameState.startMatch(config)/toMenu()` (리셋 체크리스트 반영). 신규: `ui/Menu.ts`(시작/결과 오버레이), `game/Stats.ts`(localStorage `bowling3d.stats.v1`, 모드별 최고/평균/스트라이크%/스페어%), `game/splits.ts`(인접 그래프 스플릿 감지 — 슬리퍼 2-8/3-9는 비스플릿, USBC 근사), `Scoreboard.frameScores/totalScore`에 `frames` 파라미터(블리츠 3프레임) + `rollStats`(통계 분류), `PinSet.setLayout`(스페어 챌린지 10 클래식 리브).
3. **P1.5 AI 라이벌** — `game/ai.ts` 3인 프로필(김부장 안정 직구/한프로 스페어 장인/도박사 윤 풀스핀 도박). 점수 상태(frame/ball/rolls) 플레이어별 분리 + 프레임 교대, AI 턴 입력 락(Controls/BallPicker 가드 `isHumanTurn`), AI 턴 빨리감기 `Loop.timeScale=3`(accumulator 유입만 스케일 — 물리 dt 불변, P2 슬로모와 공용 인프라), Hud 2인 시트(현재 플레이어 골드). AI 조준은 sim 캘리브레이션(직구 진입 x≈aim×19.29, 풀스핀 풀파워 훅 드리프트 0.33m, 포켓 직구 0cm/훅 +6.7cm). 사람/AI 볼 스펙 턴별 적용(`setHumanBallSpec`).
4. **P2 선반영** — `GameState.onEvent`(strike/spare/split/splitConverted/turn/gameOver), `Hud.banner` 텍스트 팝(STRIKE!/DOUBLE!/TURKEY!/N BAGGER!, 스플릿/변환), 결과 화면 새 기록 배지.

검증: tsc 클린 + vitest **22/22**(신규: 블리츠 점수·rollStats·detectSplit 15케이스) + 브라우저 라이브 확인(AI 매치 교대·AI 스트라이크/스페어 처리·2인 점수표·턴 락 정상 — 실플레이로 확인됨).

⚠️ 주의: 핀에 선형 감쇠 0.8이 들어가 핀 날아가는 속도가 이전보다 묵직해 보일 수 있음 — P0 손맛 확인 항목에 포함할 것.

## 4차 세션에 한 일 (버그 2건 + 부수 수정)

1. **레인 중간 "퉁" 튕김 수정** — 원인: 물리 바닥을 오일/드라이 2분할한 cuboid의 이음새(z=10.5) 모서리에 공이 걸려 최대 68cm 점프, 착지(z≈16.6)까지 드라이 존 훅이 통째로 무효. → 바닥을 전장 단일 콜라이더로 합치고(`Lane.ts`) `Lane.updateFriction(ballZ)`이 매 물리 스텝 오일↔드라이 마찰을 hookFactor 램프로 전환. 호출은 `GameState.update` 안 (수동 스텝 디버그 `__engine.step + __game.update`에서도 동작해야 해서 Loop가 아님). 수정 후 튐 0cm.
2. **벽에 기댄 핀 잔존 버그 수정** — 원인: `PinSet.isStanding`이 기울기·높이만 검사 → 거터 벽에 기댄 핀(기울기 45° 미만)이 "서 있음"으로 남아 영영 못 치는 선 핀이 됨. → `|x| > LANE_WIDTH/2`면 자세 무관 쓰러짐 처리 (도안 §4.3 "레인 밖 튕겨나감" 항목이 미구현이었던 것).
3. **공중 훅 주입 차단** — `Ball.applySpinForce`에 접지 체크 추가. 바운드 중에도 측면 임펄스가 들어가 공중에서 휘던 것 제거.
4. **예측 조준선 모델 개선** — 주입력(∝1/mass)만 쓰던 모델에 Rapier 접촉 마찰 성분(질량 무관, 오일/드라이 μ 반영, 스핀 감쇠 근사)을 추가하고 `PREVIEW_HOOK_GAIN` 1.4→0.9. 4개 대표 케이스 평균오차 30cm→3.3cm.

5. **스핀 "밋밋함" 해결 — 레이트 훅 강화** ("스핀 풀로 줘도 밋밋해" 피드백):
   - **근본 원인**: Rapier 마찰 결합 기본값이 Average → 레인 오일(0.04)이 공 마찰(0.1)과 평균돼 오일 존 μ가 0.05 밑으로 못 내려감 → 슬립(훅 연료)이 오일 존에서 일찍 닫혀 훅의 절반이 오일 존에서 새고, 막판 스냅이 안 나옴.
   - 레인 바닥 콜라이더에 `setFrictionCombineRule(Min)` + `LANE_FRICTION_OIL` 0.04→0.015, `FRICTION_K` 0.12→0.16, `SPIN_RATE` 9→14.
   - 결과 (풀스핀 미드파워 10lb): 오일 끝 −8cm(직진 스키드) → 헤드핀 −61cm, **훅의 87%가 드라이 존** = 스키드→스냅. 풀파워는 −33cm(빠르면 덜 휨, 현실적). 무게 역전도 해소(6lb −63 vs 16lb −66).
   - 예측선도 Min 결합 반영, `PREVIEW_HOOK_GAIN` 1.0 (5케이스 평균오차 ~1cm).

6. **선 핀이 멀리 미끄러져 "리셋 안 된 듯" 보이는 문제** (5번의 부작용): 레인 Min 결합이 핀-레인 마찰까지 오일값으로 끌어내려(0.22→0.14) 핀이 토플 대신 슬라이드. → 핀 콜라이더에 `setFrictionCombineRule(Max)` — Rapier 규칙 우선순위(Max>Min)로 핀-레인은 항상 0.3 고정, 공-레인 오일 시뮬은 무영향. 결과: 센터 풀파워 8핀 + 생존 핀 스팟 이탈 0.8cm/0cm (수정 전 수십 cm). 핀-공 마찰도 0.2→0.3으로 올라 토플이 더 잘 됨. 참고: 2구 전 선 핀을 제자리에 두는 것 자체는 룰대로(데드우드만 제거).

검증: tsc·vitest 7/7 + 브라우저 수동 스텝 e2e (튐 0cm, 상태머신 정상, 풀스핀 궤적 시뮬과 일치 −8/−19/−38/−61cm, 보상 조준 풀스핀 포켓 훅인 8핀).

기타: `vite.config.ts`에 PORT 환경변수 지원 (프리뷰/CI 임의 포트용), `.claude/launch.json` 추가.

**튜닝 관찰 (다음 세션 참고)**:
- 풀스핀 미드파워 −61cm는 레인 반폭(52.5cm) 초과 → 조준 보상 필수 (실제 볼링과 동일). 너무 세면 `SPIN_RATE` 12로.
- 핀 둔감(저파워 센터 히트 1핀)은 6번 Max 결합으로 상당 부분 개선 추정 (핀-레인 0.3, 핀-공 0.3) — 실플레이로 확인. 더 필요하면 핀 무게중심 하향, restitution 조정이 다음 후보.

## 3차 세션에 한 일 (사용자 피드백 4건)

1. **점수판 직관화** → `Hud.ts` 전면 재작성: 진짜 볼링 점수표 (10프레임 박스, X·/·– 마크 골드 표기, 보너스 확정 시점까지만 누적 점수 표시, 현재 프레임 골드 하이라이트, 10프레임 3칸). `Scoreboard.frameScores` 재사용.
2. **레인 얇은 느낌** → FOV 60→52(광각 완화) + AIMING 카메라 (0, 1.12, −2.7)·타겟 (0, −0.05, 7.5)로 재구도. 레인이 화면 하단을 넓게 채움.
3. **실시간 팔로우 카메라** → ROLLING이 와이드 고정 대신 **공 뒤 4.5m 추적** (`CameraRig.ts`: px=clamp(b.x·0.4), py=1.5, pz=clamp(b.z−4.5, −4, 13)). 거터샷도 따라가다가 핀덱 근처에서 클로즈업 전환. 스무딩 지연(v/6≈1.5m)이 있어 빠른 공도 안 놓침.
4. **스핀 = 보정값 느낌 → 오일 패턴 레이트 훅**:
   - 레인 물리 바닥을 2분할: 오일 존(`z<10.5`, 마찰 0.04 — 직진) / 드라이 존(마찰 0.14)
   - 주입 측면력에 `hookFactor(z)` smoothstep 게이트 (OIL_END_Z=10.5, HOOK_RAMP=3.5, FRICTION_K=0.12)
   - 검증(풀스핀·10lb): 오일 존 11.5m 동안 −0.16m vs 드라이 존 8m 동안 −0.38m — **막판 기울기 3배** = 스키드→훅
   - 조준 예측선도 동일 게이트 적용 (`PREVIEW_HOOK_GAIN` 1.4)
   - 오일 존 시각 힌트: 레인 앞부분에 미세 광택 시트

## 실행 방법

```bash
cd bowling-3d
npm run dev        # http://localhost:5173
npm test           # Vitest (점수 로직, 7개 통과)
```

**조작**: 마우스 이동=조준(곡선 예측선) · 마우스 꾹 눌렀다 떼기=파워 발사 · Q/E=좌/우 스핀(하단 게이지) · 우상단 슬라이더=볼 무게(6~16lb)

## 이번 세션(2차)에 한 일

사용자 피드백 4건 → 전부 처리:

1. **거터 카메라 이상** → SETTLING 즉시 핀 클로즈업으로 날아가던 것을, 공이 핀덱 근처(z ≥ HEADPIN_Z−2.5) 도달까지 와이드뷰 유지로 수정 (`CameraRig.ts`)
2. **스핀 어려움** → 원인 3개 발견·수정:
   - **조준 좌우 반전** (카메라 기준 world +x = 화면 왼쪽인데 부호 그대로) → 반전 수정
   - **조준 감도 과대** (화면 전체 = ±45°, 레인은 ±1.6°) → `AIM_RANGE=0.08`(±4.6°)로 스케일
   - **피드백 부재** → 스핀 게이지(하단 우측, Q파랑/E주황) + **스핀 반영 곡선 예측 조준선** (발사 수식과 동일한 전방 시뮬, `PREVIEW_HOOK_GAIN=1.6` 경험 보정)
   - 훅 과대(풀스핀이 z≈10m에 거터행) → `FRICTION_K` 0.1→0.045. 검증: aim 0.035+풀스핀 → 바깥으로 갔다 헤드핀으로 훅인, 9+핀
   - 대각 투구의 가짜 슬립 제거 — 발사 굴림축을 진행 방향에 정렬 (`ω=n̂×v/R·ROLL_RATIO`)
3. **풀스크린/볼링장 배경** → `scene/Environment.ts` 신규: 옆 레인×4(장식 핀 포함)·어프로치 바닥·양쪽 벽·천장+조명 스트립 3줄·핀덱 마스킹 월+네온 2줄(핑크/시안)·레인 마커(파울라인/화살표 7개/스팟 5개)·절차적 나무보드 텍스처(`makeWoodTexture`)
4. **원근감** → AIMING 카메라를 낮고 가깝게 (1.7,−3.5)→(1.15,−2.6), 천장 조명 수렴선·옆 레인 반복 구조가 깊이 단서

기타: ROLLING→SETTLING 전환 시 HUD 미갱신 수정, 파워/스핀 게이지 우측 하단 이동(공과 겹침), 레인 광택·안개(24~60) 조정.

## ⚠️ 다음 세션 첫 할 일

1. **iPhone 실기 검증 (묶음)** — 보상 컬렉션 시트/해금 토스트 · 인게임 ☰ 메뉴·Esc(앱내 오버레이) 포기 · AI 라이벌 칩(이름만) · **크롬 가독성**(`envMapIntensity` 실측 — §14 P2 게이트, 거울 아니면 1.4→2~3) · glow 4종 강등 외형 · 12차 P3(`d57c9a6`: 메뉴 오일/예측선 행·조준 보조 3단·숏/롱 손맛·후반 마름). **브라우저 375/402px는 검증 완료 — 실기만 남음.**
2. **AI 이름 확정 ✅** — **초보/중수/고수**(난이도 티어, 내부 key kim/yoon/han)로 확정됨. (13차엔 흥부/홍길동/놀부 임시였고 정석·제로·올인 / PULSE·BLADE·JOKER 후보도 검토했으나 최종은 난이도 티어명.)
3. **착수 선택** — P3 릴리스 타이밍(직구 천장 억제, aim 노이즈 측정 도구 선행) / bloom 비주얼 폴리시(glow 스킨 네온 승격, [REWARDS.md](./REWARDS.md) §14 별도 태스크) / P5 stretch 보상(perfect/spare_master/clean + obsidian/holo/pulse) / ④ 절차적 에셋.

**참고**: 거터 벽 점멸=9차 z-fighting 해결, ⑥ 충돌 임팩트=핀 fly-out·사운드로 완료. 손맛 노브: 팔로우 카메라(`CameraRig.ts`)·조준 감도(`AIM_RANGE` 0.08).

## 남은 작업 (우선순위 순)

> 게임성 개선 방향은 [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) 참고(단 v5에서 멈춤 — P2/모바일 완료 미반영). P0.5/P1/P1.5는 5차, P2 본편·모바일·패키징은 6차 완료.

- [x] **(P0) 스핀 손맛** → [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) ① — **7차 완료** (`spin^0.7` 입력곡선)
- [x] **(P1.5 후처리) AI 난이도 사다리** → 같은 문서 ② — **7차 완료** (8차에 135/232/167 재확인, 감쇠 0.7에도 불변)
- [x] **(P2) ⑥ 충돌 임팩트** — **8차 완료** (핀 fly-out: 거터볼 끝까지 굴림 수정 + 감쇠 0.7 / 임팩트 서브베이스). ⑥ *카메라 시각효과(셰이크/FOV/플래시)는 비현실적이라 폐기* — 충격은 핀 물리로 표현.
- [x] **거터 벽 점멸** — **9차 해결** (z-fighting: Environment 레일 제거, `9fcc1de`)
- [x] **인게임 UI 개선** — **10차** (P1~P4 + 조준선 수렴, `9a46796`·iPhone 확인 완료) → [UI_REVAMP.md](./UI_REVAMP.md)
- [x] **점수판(Hud) 개선** — **11차** (방향 A 한 줄 fit + 멀티 미니, `9a46796`·iPhone 확인 완료) → [UI_REVAMP.md](./UI_REVAMP.md)
- [~] **(P3) 숙련 깊이** — **12차에 오일 메타(파라미터화+프리셋 3종+레인 마름) + 예측선 난이도 3단 구현**(`d57c9a6` 커밋·iPhone 실기 미검증). **15차에 릴리스 타이밍 구현**(아래). 남은 축: 없음(P3 3축 = 오일·예측선·릴리스 전부 구현, 손맛 튜닝만).
- [~] **(P3) 릴리스 타이밍 — 15차 구현(실플레이 손맛 튜닝 대기)**. 선행 측정 도구: `sim-carry.mjs --noise`(스타일×σ 기대 핀/스트라이크율, σ=0이면 직구·훅 100% 스트라이크=현 문제, σ4 직구23%/훅41% — 노이즈가 좁은 직구를 빨리 깎고 넓은 훅은 살림 정량 확인). 구현: 파워 골드 띠(`RELEASE_SWEET_LO/HI`=0.6~0.9) 안에서 떼면 정확, 밖으로 멀수록 aim에 gaussian σ(`RELEASE_SIGMA_MAX`=6cm, `RELEASE_TOL`=0.3) — **플레이어 전용**(Controls 발사 경로, AI 무영향). 항상 ON(토글 없음). **피드백 팝업 없음 — 순수 손맛(사용자 결정, 15차)**: PERFECT/GOOD/빗나감 텍스트 팝업을 넣었다가 톤이 아케이드틱하다고 제거. 트레이드오프: 빗나간 게 타이밍 탓인지 안 보여 "억울한 랜덤"으로 읽힐 위험을 감수(필요 시 게이지 플래시 같은 은은한 피드백으로 복원 가능). **튜닝 노브**(`constants.ts`): 숙련자가 직구로 띠를 매번 맞혀 천장이 안 잡히면 `RELEASE_SIGMA_MIN`↑(완벽 릴리스에도 바닥 분산·300 포기) 또는 띠 폭 축소. tsc 클린·vitest 32 통과·빌드 OK·sim 기본 윈도우 불변.
- [~] **③ 승리 보상** — **13차 구현 + 14차 컬렉션 시트 UI 리디자인**(업적 core 6 + 스킨 7종 + 컬렉션 시트/해금 토스트, §14 P1~P4·bloom 분리; **`f46e7be` 커밋**·브라우저 검증 완료·iPhone 실기 미검증) → [REWARDS.md](./REWARDS.md). 남은 것: iPhone 실기 검증 + P5(stretch·애니 스킨·bloom 승격)
- [x] **로컬 2인 교대전 (hotseat) + 핸드오프** — **2026-06-20 구현**. 코어 변경 0(점수 분리·턴 회전·Hud 2인·입력락이 P1.5에 이미 있음) — UI만: 메뉴 `👥 2인` 칩+이름 입력(`Menu`), 턴 전환 핸드오프 오버레이(`Menu.showHandoff`+`GameState.inputLocked`로 직전 조준 누수·오발사 차단, `Boot` 턴 이벤트 배선), 결과 `🏆 [이름] 승리!`. hotseat는 파티 모드라 하이스코어·통계·업적 저장 생략(`GameState.gameOver`·`Boot`). tsc 0·vitest 32/32·빌드 OK·dev 런타임 확인(핸드오프/입력락/메뉴 칩·이름입력). 미커밋. 잔여: 플레이어별 볼 색 구분(쉬움).
- [ ] 실물 에셋 — GLTF 핀·공, HDRI, 실제 음원 (P4)

**6차 완료분(이전 '남은 작업'에서 해소)**: ~~(P2) 타격감 본편~~ — 슬로모·임팩트 사운드·접근 카메라·전광판 구현(⑥ 시각효과만 잔여). ~~모바일 터치 검증 + 터치 스핀 입력~~ — 터치 발사·반응형 UI 구현(터치 전용 스핀은 바 드래그로 대체, Q/E 병행).

## 소스 구조

```
src/
  core/    Boot(부팅·조립·이벤트 배선) · Engine(렌더+물리+보간) · Loop(고정 timestep+alpha+timeScale)
  scene/   Lane(레인+거터) · Environment(볼링장 배경+나무텍스처) · Ball(공·스핀) · Pin(병모양) · PinSet(배치·판정·setLayout)
  game/    GameState(상태머신+모드+멀티플레이어) · Scoreboard(점수·rollStats) · BallSpec(무게)
           constants(튜닝 상수 집결) · ai(라이벌 프로필) · splits(스플릿 감지) · Stats(localStorage 기록)
  input/   Controls(마우스+키보드, 곡선 조준선·스핀/파워 게이지, AI 턴·핸드오프 락)
  camera/  CameraRig(상태별 뷰, MENU 스웨이)
  audio/   SoundManager(합성 충돌음)
  ui/      Hud(2인 점수표+배너) · BallPicker · Menu(시작/결과/핸드오프 오버레이)
tests/     scoreboard.test.ts · gameplay.test.ts
```

**디버그 전역**: `window.__game / __ball / __pins / __engine / __cameraRig`
수동 시뮬: `__engine.step(1/60); __game.update(1/60)` 루프 (백그라운드 탭은 rAF 멈춤 주의)

## 검증된 핵심 가정 (Rapier)

- 스핀 훅 = 주입 측면력 + **Rapier 자체 접촉 마찰의 추가 훅** (실측 합계가 주입 모델의 ~1.6배 → 예측선은 `PREVIEW_HOOK_GAIN` 보정)
- 좌표 주의: **world +x = 화면 왼쪽** (카메라가 −z에서 +z를 봄) — 입력·연출에서 부호 반전 필요
- 볼 무게 = `collider.setMass`, 6~16lb 슬라이더 / 충돌음 = `drainContactForceEvents` / CCD+`maxCcdSubsteps=4`
- 점수 = flat rolls 재계산, 10프레임 보너스 (Vitest 7/7)
