# 게임 모드 확장 — 5종 (노탭 · 파워 스로 · 덕핀/캔들핀 · 장애물 레인 · PBA 오일 패턴)

> 작성: 2026-06-22 (게임성 리서치 세션). 코어 물리 + 타격감 + 모바일 + 패키징 완성 후
> "게임성으로 더 넣을 게 있나" 논의 → 웹 레퍼런스 서치 → 이 게임 제약
> (**에셋 0 · 절차적 생성 · 슬립 기반 훅 물리 · 솔로/로컬 · 비과금/리텐션 비목표**)에 맞춰 5종 확정.
>
> **상태: 설계만(미구현).** 난이도·선행·구현 순서는 ↓ [§6 구현 순서](#6-구현-순서-추천).
> **v2 (2026-06-22): 자체 검토 반영** — 노탭 점수 적용 지점(`score()`)·스플릿 가드·`scoreLastFrame` 다중 분기, 파워 스로 **레인폭 비호환**, 라운드형 모드 **솔로 한정**, 장애물 레인 **예측선 의존**, 핀 생성/제거 인프라 부재, 덕핀/캔들핀의 훅 무력화 트레이드오프를 보강. (검토 대조: 이 세션에서 실제 코드 읽고 확인.)
> **v3 (2026-06-22): 오일 레퍼런스 + 보상/메뉴 정책 반영** — 하우스 vs 스포츠 패턴의 본질이 *길이*가 아니라 *오일 비율/퍼널*임을 서치로 확인(§2 재작성, 동물 패턴 실측 길이 반영) → PBA 오일의 "진짜 가치 = 퍼널 축 추가"로 격상. 새 모드의 **보상/업적·`Menu` 성장** 정책을 §0에 추가.
> **v4 (2026-06-22): 코드 재검증 반영** — §1 노탭 변환 공식의 **풀랙 게이트 누락 버그** 수정(`standingAtThrow===10`이 없으면 일반 프레임 2구 스페어가 `[1,10]`으로 오기록 → `frameScores`가 11핀 오픈으로 읽어 점수가 깨짐). push·스플릿·`scoreNormalFrame`·`scoreLastFrame` 수정이 **단일 술어 "풀랙 + knocked≥임계 = 스트라이크"**로 통합됨을 명시. 스플릿 오감지 근거 정정(1핀은 `splits.ts`에서 이미 제외 → 8핀 한정). 오일 프리셋 예시 숫자를 기존 short/house/long과 정합. (재검증: 이 세션에서 `score()`·`splits.ts`·`oil.ts` 실측 대조.)
> 5종은 전부 **신규 에셋 0**이고, 기존 시스템(스페어 챌린지 라운드 흐름 · `oil.ts` 가변 모듈 · 순수 점수함수) 위에 얹힌다.
>
> 관련 문서: [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) (P1 경량 모드 · P3 오일) ·
> [OIL_META_AND_AUTO.md](./OIL_META_AND_AUTO.md) (오일 모델 한계·확장) ·
> [GAME_DESIGN.md](./GAME_DESIGN.md) (좌표·물리 상수·상태머신) · [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) (훅 손맛).

---

## 0. 공통 아키텍처 — 새 모드가 꽂히는 자리

5종이 손대는 공통 지점. **여기를 먼저 이해해야 각 모드의 "구현 메모"가 읽힌다.**

| 시스템 | 현재 | 확장 지점 |
|---|---|---|
| `GameMode` | `'full' \| 'blitz' \| 'spare'` ([GameState.ts](../src/game/GameState.ts)) | 새 모드는 여기 유니온에 추가. **노탭은 모드가 아니라 토글**(아래 §1) |
| `MatchConfig` | `mode · players · oilPattern · aimAid` | 새 옵션 필드(`noTap` 임계, `ballPerFrame` 등) 추가 |
| `GameState.startMatch` | mode → `frames` 결정 · 핀 셋업(`resetAll`/`setLayout`) · `resetOil` · ballSpec | mode 분기 추가 (프레임 수·핀 배치·오일·공 스펙) |
| 점수 | `Scoreboard.frameScores(rolls, frames)` **순수함수** — flat한 투구 배열에서 매번 재계산 | **2구/프레임 가정**이라 3구 모드(덕핀/캔들핀)는 ball-per-frame 파라미터화 필요 |
| 라운드형 흐름 | `GameState.scoreSpareMode` — 1구/라운드, 스테이지 전진, `PinSet.setLayout(SPARE_LEAVES[n])` | **파워 스로·장애물 레인이 이 패턴을 그대로 재사용** |
| 핀 | `PinSet` 10개 고정(`PIN_ROWS` 4행), Boot에서 1회 생성·`Engine.add` 트래킹 | 가변 핀 수 = 파워 스로 선행. 핀 형상은 `Pin.ts` `LatheGeometry` 프로파일(절차적) |
| 공 | `BALL_RADIUS = 0.109` 전역 상수 · `BallSpec`(무게만 가변, 지름 고정) | 덕핀/캔들핀은 공 지름을 모드별 가변으로 빼야 함 |
| 메뉴/HUD | `Menu` 모드 칩 + 옵션 · `Hud` 점수판(2구 프레임 가정 렌더) | 모드 칩 추가 · 모드별 표시(3구 프레임, 핀 카운트) |

### 한눈에 보기

| 모드 | 한 줄 | 난이도 | 주 선행 | 재사용 |
|---|---|---|---|---|
| **노탭** | 1구 9(8)핀↑ = 스트라이크 | 낮음~중간 | 점수 모디파이어 배선 | full/blitz에 토글로 얹음 |
| **PBA 오일** | 명명 패턴 선택 (길이+퍼널) | 낮음(프리셋)~높음(퍼널축) | `oil.ts` 확장 (+퍼널 축) | 기존 오일 선택 UI |
| **장애물 레인** | 장벽을 훅으로 감아 돌기 | 중간 | 배리어 오브젝트 + 예측선 | 스페어 챌린지 라운드 흐름 |
| **파워 스로** | 벽+다핀(10→91) 한 방 쓸기 | 중간~높음 | 가변 핀 랙 + **넓은 레인** | 스페어 챌린지 라운드 흐름 |
| **덕핀/캔들핀** | 3구/프레임, 작은 공·다른 핀 | 높음 | 3구 점수 + 공 지름 가변 | — (별도 룰셋) |

### ⚠️ 가로지르는 제약 (여러 모드 공통 — v2 추가)

- **멀티 지원 경계:** full·blitz는 표준 프레임 흐름이라 AI 라이벌·핫시트를 지원하지만, **스페어/장애물/파워 스로는 `scoreSpareMode`(라운드형) 기반 = 솔로 전용**이다(`MatchConfig` 주석 "스페어 챌린지는 솔로만"). 새 라운드형 모드가 vs AI·2인을 지원하려면 라운드형 흐름에 **플레이어 회전을 새로 넣어야** 함 → 별도 결정(§6 선행).
- **예측선 의존:** 조준 가이드는 훅 곡선을 숨긴다(README, `aimAid`). 훅 정밀이 *필수*인 모드(장애물 레인)는 `aimAid='easy'`(풀 곡선) 강제 같은 처리가 선행.
- **`isStanding`의 레인폭 가드:** [PinSet.ts:41](../src/scene/PinSet.ts)은 `|x| > LANE_WIDTH/2(=0.525)`면 핀을 **쓰러짐**으로 친다. 레인보다 넓은 배치(파워 스로 다핀 랙)는 이 판정과 충돌(§4).
- **핀 동적 생성/제거 부재:** 핀은 Boot에서 1회 생성되고 **제거 경로가 없다**(구조 감사 발견). 핀 수를 모드별로 바꾸는 모드(파워 스로)는 바디 추가/제거 인프라가 선행.
- **보상/업적 정책 (v3):** 새 모드가 업적·스킨([REWARDS.md](./REWARDS.md))을 줄지 모드별 결정. 단 **통계 제외 모드(노탭 등 '비공식')는 랭크 플레이와 같은 업적을 주지 말 것**(통계 정책과 일관). 장애물/파워 스로 같은 챌린지형은 "코스 클리어" 전용 업적이 자연스럽다.
- **`Menu` 성장 압력 (v3):** 모드 칩·옵션이 늘수록 이미 998줄인 [Menu.ts](../src/ui/Menu.ts)(구조 감사의 분할 권고 대상)에 쌓인다 → 5개 모드 UI를 얹기 전 **`Menu` 분할이 소프트 선행**.

---

## 1. 노탭 (No-Tap) — *최우선, 즉효*

**레퍼런스:** [BOWL.com 대체 게임](https://bowl.com/welcome/alternate-bowling-games) · [Brunswick No-Tap](https://brunswickbowling.com/bowling-centers/equipment-parts-supplies/center-operations/sync/scoring/games/no-tap) · [No-Tap 스코어링(LiveAbout)](https://www.liveabout.com/no-tap-bowling-scoring-420894)

### 룰
1구에 **임계 핀 수 이상**을 쓰러뜨리면 스트라이크로 처리(점수 10 + 보너스). 통상 **9-pin no-tap**(9개↑ = 스트라이크), 더 쉬운 8/7-pin도 있음. 약한 플레이어 핸디캡·캐주얼 진입용. 10프레임/블리츠 양쪽에 얹힌다.

### 구현 메모
- **모드 아님 → 토글.** `MatchConfig`에 `noTap?: number`(기본 10=비활성, 9/8 선택). full·blitz와 직교. 스페어 챌린지는 제외(라운드형이라 무의미).
- **핵심 트릭 — "10으로 기록".** 1구에 `knocked >= noTap`면 그 투구를 `rolls`에 **`10`(STRIKE)으로 기록**한다. 그러면 [Scoreboard.ts](../src/game/Scoreboard.ts)의 순수 점수함수·보너스 룩어헤드가 **무수정**으로 작동(보너스·스페어가 9→10으로 일관 처리). 실제 쓰러진 수를 보여주려면 HUD에만 부가 표기.
- **⚠️ 기록·판정이 한 술어로 묶인다 — 풀랙 게이트가 핵심 (v4 정정).** 노탭 스트라이크의 정의는 **"풀랙(`standingAtThrow===10`)에서 `knocked >= noTap`"** 하나뿐이고, 아래가 모두 이 술어로 통일된다. ① *점수 기록*(rolls에 10): push는 상위 [GameState.ts](../src/game/GameState.ts) `score()`에서 `scoreNormalFrame`/`scoreLastFrame` **호출 전에** `p.rolls[...].push(knocked)`로 일어나므로([GameState.ts:387](../src/game/GameState.ts)), 변환은 그 지점에서 **`knocked >= noTap && this.standingAtThrow === 10 ? 10 : knocked`**. ⚠️ **`standingAtThrow===10`을 빼면 버그**: `standingAtThrow`는 투구 직전 갱신되므로([GameState.ts:233](../src/game/GameState.ts)), 1구 1핀 → 2구 9핀 정리(스페어)에서 2구의 `knocked=9 ≥ noTap(9)`가 되어 `rolls=[1,10]`으로 오기록 → `frameScores`가 스페어도 스트라이크도 아닌 **11핀 오픈으로 읽어 점수가 조용히 깨진다.** ② *스트라이크 판정*: `scoreNormalFrame`의 `const strike = p.ball===1 && standing===0`을 `standing <= (10 - noTap)`로(1구는 항상 풀랙이라 게이트 내포). **판정을 안 바꾸면 9핀에서 2구를 또 던지게 된다.**
- **⚠️ 스플릿 감지 가드 — 8핀 노탭 한정 (v4 정정).** `score()`의 스플릿 감지 `if (p.ball===1 && standingAtThrow===10 && standing>0)`는 **8핀 노탭에서만** 손대면 된다: 잔여 2핀이 7-10 등 스플릿을 이뤄 "스트라이크"에 스플릿 이벤트가 뜰 수 있다. **9핀 노탭(1핀)은 [splits.ts](../src/game/splits.ts)의 `if (pins.length < 2) return none`로 이미 스플릿이 아니다** — v2의 "1핀 오감지"는 부정확했다. ①의 풀랙 술어로 "노탭 스트라이크면 감지 건너뜀"을 깔면 8핀까지 함께 정리된다.
- **⚠️ `scoreLastFrame` 다중 분기 — 단 `earnedBonus`는 공짜 (v4 보강).** 10프레임 채점은 strike/spare emit · `resetAll`/`respot`에 `standing === 0`을 **여러 분기**에서 쓴다 → 전부 ①의 풀랙 술어(`standing <= (10 - noTap)` + 풀랙)로 통일. **단 보너스 투구 판정 `earnedBonus = f[0]===10 || ...`([GameState.ts:469](../src/game/GameState.ts))은 record-as-10이면 `f[0]`가 이미 10이라 무수정으로 맞는다** — "Scoreboard 무수정"이 보너스 로직까지 확장된다(①의 풀랙 게이트가 전제).
- **UI:** `Menu`에 "노탭" 칩(끔/9핀/8핀). `Hud`에 모드 라벨.

### 난이도·리스크
**낮음~중간.** 점수는 record-as-10으로 공짜고, 분산돼 보이던 수정도 ①의 단일 술어("풀랙 + knocked≥임계")로 묶으면 한 군데에 모인다. 진짜 함정은 풀랙 게이트를 빠뜨려 일반 프레임 스페어를 오기록하는 것(v4) → **`frameScores`/`score()` 단위 테스트로 노탭 rolls 케이스(1-then-9 등)를 고정**하면 회귀가 잡힌다.
- **통계 제외는 권고가 아니라 필수 (v2).** record-as-10이면 `rollStats`가 `fr[0] === 10`을 스트라이크로 세어 **9핀이 스트라이크로 집계 → 스트라이크%·평균 정의가 깨진다**. 노탭 게임은 하이스코어/통계 저장을 **반드시 제외**(핫시트와 동일 정책, `gameOver`에서 게이트). 굳이 남기려면 노탭 전용 별도 기록 키로 분리.

### 열린 질문
- 8/7핀까지 줄 것인가, 9핀만 줄 것인가.
- 노탭 칩이 켜졌을 때 결과 화면에 "비공식 기록(노탭)" 배지를 보여줄지.

---

## 2. PBA 동물 오일 패턴 — *최우선, `oil.ts` 확장*

**레퍼런스:** [PBA Pro Bowling 2026 (Steam)](https://store.steampowered.com/app/3127230/PBA_Pro_Bowling_2026/) — 진화하는 실제 오일 패턴이 핵심 재미. PBA "동물 시리즈"(Cheetah/Viper/Scorpion/Shark/Chameleon/Bear)는 **길이**(35~48ft)와 **분포**가 달라 라인 전략이 통째로 바뀐다.

### 룰
명명 패턴을 선택 → 훅이 깨지는 지점·정도가 달라 **최적 라인이 이동**. 짧은 패턴(Cheetah)=외곽 직진·과훅 위험, 긴 패턴(Shark)=직진 강요·포켓각 만들기 어려움.

### 구현 메모
- [oil.ts](../src/game/oil.ts)가 이미 **단일 가변 모듈**로 `endZ`(훅 브레이크 지점)+`ramp`(스냅 날카로움)를 노출하고, 물리(`Lane`/`Ball`)·예측선(`Controls`)이 같은 값을 본다. `OilPattern` 유니온과 `OIL_PRESETS` 맵에 **패턴만 추가**하면 끝:
  ```ts
  // 예 (endZ = 길이 프록시; 짧을수록 일찍 깨짐)
  cheetah:  { endZ: 9.0,  ramp: 3.5 },  // 33ft (최단 — short(9.5)보다 일찍 깨짐, 고득점·외곽 정밀)
  scorpion: { endZ: 11.5, ramp: 3.5 },  // 42ft (house~long 사이)
  shark:    { endZ: 13.5, ramp: 3.5 },  // 48ft (최장·최난 — long(12.5)보다 늦게 깨짐, 고레브 유리)
  // ↑ 기존 프리셋(short 9.5 < house 10.5 < long 12.5)과 단조 정합. 실수치는 sim-carry 재측정.
  ```
- **검증:** [sim-carry.mjs](../sim-carry.mjs) `--oilEnd` 스캔으로 패턴별 직구/훅 윈도우 재측정(기존 house/short/long과 동일 방식). 게임-시뮬 상수 동기 유지.
- **UI:** 오일 선택 UI가 이미 있음(house/short/long) → 패턴 추가만.

### ⚠️ 모델 한계 & 핵심 결정 (v3 — 오일 레퍼런스 반영)
**실제 패턴은 두 축이다: ① 길이(오일 거리) · ② 오일 비율/모양(=관용도).** 난이도를 가르는 건 주로 ②다 ([BowlersMart](https://www.bowlersmart.com/tournaments/understanding-oil-patterns/) · [thesportofbowling](https://www.thesportofbowling.com/oil-patterns/)):
- **하우스 샷** = 비율 ~8:1\~10:1, 가운데 많고 바깥 마른 "역삼각" → **퍼널 효과**(바깥으로 빠진 공이 마른 보드를 만나 포켓으로 되감김) → 관용적 → 고득점.
- **스포츠/동물 패턴** = 비율 3:1\~4:1 이하, **평평** → 퍼널 없음 → 미스 = 거터. 리그 평균이 25\~35핀 떨어진다.

**그런데 우리 `oil.ts`는 ①(길이=`endZ`)만 모델링하고 ②(좌우 비율/퍼널)는 미모델이다.** 그래서:
- **그냥 `endZ` 프리셋만 추가하면 동물 패턴 = house/short/long의 길이 변형 재탕**(전부 "하우스 같은 관용적 패턴")이라 **이름만 다른 중복**이 되고, 정작 동물 패턴을 유명하게 만든 "어렵다(스포츠=평평)"가 안 나온다.
- **진짜 가치 = `oil.ts`에 좌우 오일 비율(퍼널 세기) 축 추가.** 마찰을 `f(z)` → `f(z, x)`로(가운데=오일↑/저마찰, 바깥=마름/고마찰=훅↑). 그러면 하우스(퍼널) vs 스포츠/동물(평평)이 **체감상 진짜 다른 난이도**가 되고, **이건 이 게임의 기존 "직구 250"(=하우스가 너무 후함, [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) P0.5) 문제와 같은 레버다** — 평평한 스포츠 패턴이 직구 천장을 자연히 눌러준다.

**결정(권장): 동물 패턴은 "퍼널 축 추가"와 한 묶음으로.** 퍼널 축 없이 길이 프리셋만 내면 화장(化粧)에 그친다.
- 퍼널 축 도입 시 house/short/long="관용 퍼널·길이 3종", 동물="평평(스포츠)·길이별" → **②값이 달라 중복 아님**(둘 다 유지 가능).
- ⚠️ 마찰을 `f(z,x)`로 바꾸면 단일 바닥 콜라이더 마찰 트릭([Lane.ts](../src/scene/Lane.ts))·`sim-carry`·예측선이 영향 → 난이도 **중간~높음**으로 상향. [OIL_META_AND_AUTO.md](./OIL_META_AND_AUTO.md)와 통합 설계.
- **난이도 ≠ 길이:** Cheetah(33ft)는 *최단인데 프로 최고 득점*(쉬움) — 우리 길이-only 모델에선 "일찍 꺾임"일 뿐. UI는 난이도 등급이 아니라 "라인 차이"로 표기.

### 난이도·열린 질문
**낮음~중간**(프리셋만) / **중간~높음**(분포 모양까지).
- ⚠️ **상표:** "PBA"·동물 패턴명은 PBA 상표. 비공개 취미 프로젝트엔 무방하나, 공개 배포 시 오리지널 동물 테마명("표범 라인" 등)으로 바꾸거나 "inspired by" 표기 권장.
- 몇 종을 넣을지(3~6종). 마름(`advanceOilDrying`)과 어떻게 조합되는지.

---

## 3. 장애물 레인 (Spin Control) — *훅 물리를 콘텐츠로*

**레퍼런스:** [Wii Sports Club *Spin Control*](https://strategywiki.org/wiki/Wii_Sports/Bowling_Training) — 레인에 배리어를 놓아 특정 스핀을 강요. [Wii Sports Bowling(Fandom)](https://wiisports.fandom.com/wiki/Bowling_(sport)).

### 룰
레인 위 **장벽(배리어)**을 훅으로 감아 돌아 핀을 친다. 직구로는 막히고 **스핀이 필수**가 되게 스테이지를 설계. 스페어 챌린지처럼 **코스(10스테이지)**로.

> 💡 이 게임의 간판은 슬립 기반 훅인데 정작 훅은 *선택*이다. 장애물 레인은 훅을 **반드시 써야 풀리는 퍼즐**로 만들어 핵심 자산을 회수한다.

### 구현 메모
- **라운드 흐름 재사용:** `GameState.scoreSpareMode`(1구/라운드, 클리어 판정, 스테이지 전진) 패턴 복제. `SPARE_LEAVES` → `OBSTACLE_STAGES`(각 스테이지 = 서 있는 핀 + 배리어 배치).
- **배리어 오브젝트(신규, 소형):** 정적 콜라이더(`RAPIER.RigidBodyDesc.fixed()` + `ColliderDesc.cuboid`) + 네온 박스 메시([Environment.ts](../src/scene/Environment.ts) 스타일 재사용). 레인 좌표 `(x, z)`에 배치. `Engine.add`로 메시-바디 트래킹.
  - ⚠️ 충돌 그룹: 공↔배리어만 막고, 배리어가 핀 물리/굴림 사운드에 끼어들지 않게. Rapier collision groups로 격리.
- **⚠️ 예측선 강제 (v2):** 조준 가이드가 훅 곡선을 숨기는데(README) 장애물은 훅 정밀이 필수라, 이 모드는 `aimAid='easy'`(풀 곡선 표시)를 강제하거나 전용 가이드를 줘야 가혹하지 않다(§0 가로지르는 제약).
- **오일 조합:** 훅이 충분히 살아야 하므로 스테이지는 `short` 오일 고정 또는 전용 오일로(드라이 존 길게). [oil.ts](../src/game/oil.ts) `resetOil` 재사용.
- **카메라:** 장벽이 보이게 톱다운/하이앵글 옵션 검토([CameraRig.ts](../src/camera/CameraRig.ts)).

### 난이도·열린 질문
**중간.** 배리어 오브젝트 + 스테이지 데이터 + 코스 흐름(스페어 모드 복제).
- "직구로는 못 풀린다"를 어떻게 **보장**하나 → 스테이지를 sim/플레이테스트로 설계. 배리어 위치 자동 검증 스크립트(`sim-carry` 확장) 후보.
- 배리어 충돌 손맛(공이 튕기나 vs 막히나).
- **솔로 전용**(scoreSpareMode 기반, §0) — vs AI/2인 지원 여부 결정.
- 별도 모드 vs 스페어 챌린지 안의 "장애물 코스".

---

## 4. 파워 스로 (Power Throws) — *캐리 물리 쇼케이스*

**레퍼런스:** [Wii Sports *Power Throws*](https://strategywiki.org/wiki/Wii_Sports/Bowling_Training) — 거터를 벽으로 막고 핀을 **10→20→…→91개**로 늘려 한 구에 최대한 많이.

### 룰
거터 대신 **벽**(공이 안 빠짐), 핀 다수의 삼각 랙. 한 구로 최대한 쓸기. 10스테이지(핀 수 증가) 클리어식.

### 구현 메모
- **⚠️ 레인폭 비호환 — 가장 큰 함정 (v2).** [PinSet.ts:41](../src/scene/PinSet.ts) `isStanding`은 `Math.abs(t.x) > LANE_WIDTH/2(=0.525)`면 **쓰러짐**으로 친다. 13행 삼각 랙은 폭 ~3.6m라 **바깥 핀이 세워지자마자 "쓰러짐" 판정**된다. → 파워 스로는 **레인폭 자체를 넓혀야** 하고, 그러면 `isStanding`·거터·`settleGutterPerch`·카메라가 전부 `LANE_WIDTH=1.05` 가정에 묶여 있어 **모드별 레인 지오메트리 분기**가 선행(벽으로 거터를 막는 것과 별개 문제).
- **가변 핀 랙(주 비용):** 현재 `PinSet`은 `PIN_ROWS`(4행 10핀) 하드코딩 → **N행 삼각 랙** 생성으로 일반화 필요.
  - ⚠️ **핀 생성/제거 인프라 없음 (v2):** 핀은 Boot에서 1회 생성·`Engine.add` 트래킹되며 **제거 경로가 없다**(구조 감사 발견과 직결). 모드별로 핀을 늘렸다 줄이려면 바디 추가/제거 인프라가 선행.
  - ⚠️ **성능:** 다수 동적 바디 + CCD는 **모바일 부담**. 핀 수 상한(예: ~55핀)·품질 적응([MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md)) 연계. `sleep`/슬립 임계 점검.
- **벽:** [Lane.ts](../src/scene/Lane.ts) 거터 대신 레인 끝 수직 벽 콜라이더(공 튕겨 복귀).
- **점수·흐름:** 표준 프레임 점수가 아님 → **라운드형**(스페어 모드처럼 1구/스테이지, 쓰러뜨린 수 누적/클리어). `scoreSpareMode` 패턴 재사용. `POWER_STAGES`(핀 수 배열).
- **카메라:** 넓은 랙 → 풀백/와이드 뷰.

### 난이도·열린 질문
**중간~높음.** 레인폭 분기 + 가변 핀 랙 + 핀 제거 인프라가 핵심 비용.
- 고정 스테이지(10→91) vs 엔드리스.
- 91핀에서 물리 안정성·프레임레이트(특히 모바일) — 상한을 낮춰(예: ~55핀) 타협할지.
- 벽 반발 손맛 튜닝.
- **솔로 전용**(scoreSpareMode 기반, §0) — 멀티 지원 여부.

---

## 5. 덕핀 / 캔들핀 (Duckpin / Candlepin) — *다른 손맛, 별도 룰셋*

**레퍼런스:** [BOWL.com 대체 게임](https://bowl.com/welcome/alternate-bowling-games) · [Galaxy Bowling 3D(텐핀/캔들핀/덕핀)](https://www.bananatic.com/blog/the-best-bowling-games-of-all-time).

### 룰
프레임당 **3구**. **덕핀** = 작은 공(손가락 구멍 없음)·작고 통통한 핀. **캔들핀** = 얇은 원통(양끝 동일)·작은 공, 게다가 **쓰러진 핀(데드우드)을 안 치움**(다음 구의 장애물·도구로 남김 — 가장 어려움).

### 구현 메모
- **3구 점수(공통 선행):** [Scoreboard.ts](../src/game/Scoreboard.ts) `frameScores`는 **2구/프레임 가정**. 덕핀/캔들핀 스코어링(스트라이크=1구 전멸→10+다음 2구, 스페어=프레임 내 전멸→10+다음 1구, 오픈=3구 합)을 위해 **ball-per-frame 파라미터화 또는 별도 스코어러**. 가장 큰 점수 변경.
- **핀 형상(절차적이라 가능):** [Pin.ts](../src/scene/Pin.ts)의 `LatheGeometry` 프로파일 교체 — 캔들핀=거의 균일 반경 원통, 덕핀=땅딸막. 콜라이더(`cylinder(PIN_HEIGHT/2, PIN_RADIUS)`)·질량·반발도 모드별로.
- **공 지름(전역 상수 분리):** [constants.ts](../src/game/constants.ts) `BALL_RADIUS = 0.109`가 전역(거터 perch 보정 등 곳곳 참조). 덕핀/캔들핀은 더 작은 공 → **`BALL_RADIUS`를 모드/스펙 가변으로** 빼야 함([BallSpec.ts](../src/game/BallSpec.ts) 확장). 파급 큼.
- **물리 재튜닝:** 가벼운 공·핀 → 캐리 전면 재튜닝([sim-carry.mjs](../sim-carry.mjs) 재측정).
- **캔들핀 데드우드 유지:** `PinSet.respot`(선 핀 리셋 + 데드우드 치움)을 **스킵**하고 쓰러진 핀을 그대로 둠 → 다음 구의 장애물. 별도 분기.
- **⚠️ HUD 재작업 (v2):** [Hud.ts](../src/ui/Hud.ts)는 2구 프레임 가정으로 점수판을 그린다(~295줄) → 3구 프레임 표시는 실작업.

### 난이도·열린 질문
**높음.** 공 지름 가변 + 3구 점수 + 핀 형상 + 캐리 재튜닝 전반.
- **⚠️ 핵심 메커닉 무력화 (v2):** 작은 공이라 이 게임 간판인 **훅/오일이 사실상 안 쓰인다**. "고비용 + 차별 자산 미사용"이라 우선순위 최후미가 맞다 — 변형 다양성을 위해 넣는 것이지 깊이를 더하는 모드는 아님. (PBA 오일·장애물 레인이 훅을 *살리는* 쪽이라 대조적.)
- **덕핀 먼저, 캔들핀 후속** 권장(캔들핀의 데드우드 유지 + 얇은 핀 + 최난 스코어링은 추가 비용).
- 둘 다 넣을지, 덕핀 한 종만 넣을지.
- 공 지름 가변화가 거터/perch/조준 보조 등에 주는 회귀 점검.

---

## 6. 구현 순서 (추천)

**값 빨리 / 구조 리스크 늦게** 원칙. 위 §1~§5는 이 순서로 정렬돼 있다.

1. **노탭** — 낮음·즉효. record-as-10이라 점수는 거의 공짜. 손댈 곳(push 변환·스플릿 가드·`scoreNormalFrame`/`scoreLastFrame`)이 **단일 술어 "풀랙 + knocked≥임계"로 통합**되며(v4), `standingAtThrow===10` 게이트만 빠뜨리지 않으면 된다. `MatchConfig` 옵션 플러밍의 첫 사례.
2. **PBA 오일** — 두 갈래. **(a) 화장판**: `endZ` 프리셋만 추가(낮음, 단 house/short/long과 중복). **(b) 본판**: 좌우 퍼널 축(`f(z,x)`)을 `oil.ts`에 추가(중간~높음) → 하우스 vs 스포츠가 진짜 갈리고 "직구 250" 레버와 연결. **(b) 권장.** `sim-carry`로 검증.
3. **장애물 레인** — 중간. 스페어 챌린지 흐름 + 배리어 오브젝트 + **예측선(easy) 강제**. **훅 차별점 회수(전략적 가치 최상).**
4. **파워 스로** — 중간~높음. **넓은 레인 분기** + 가변 핀 랙 + 핀 제거 인프라 + 모바일 성능. (라운드 흐름은 장애물과 공유.)
5. **덕핀/캔들핀** — 높음. 3구 점수 + 공 지름 가변 + 핀 형상 + 재튜닝 + HUD. 훅을 안 쓰는 모드라 ROI 최저 → **덕핀 먼저**, 캔들핀은 별도 후속.

### 공통 선행(묶어서 하면 이득)
- **`MatchConfig` 옵션 플러밍** — 노탭(#1)에서 처음 깔고 이후 재사용.
- **라운드형 흐름 → "스테이지 코스" 추상 추출** — `scoreSpareMode`(1구/라운드, 클리어, 스테이지 전진)를 재사용 가능한 추상으로 빼는 것이 **장애물(#3)·파워 스로(#4)의 명시적 선행**. 이때 "라운드형 모드의 멀티(AI/2인) 지원 여부"를 함께 결정 — 현재는 솔로 전용(§0).
- **모드별 레인 지오메트리 분기** — `LANE_WIDTH`/거터/`isStanding`이 1.05m 단일 레인을 가정 → **파워 스로(#4)의 선행**.
- **`Scoreboard` ball-per-frame 파라미터화** — 덕핀/캔들핀(#5) 선행(노탭은 record-as-10이라 불필요).
- **`BALL_RADIUS` 가변화 + 핀 생성/제거 인프라** — 덕핀(공 지름)·파워 스로(핀 풀)의 구조적 비용. 별도 PR 권장.

---

## 7. 레퍼런스 (서치 출처)

- [PBA Pro Bowling 2026 — Steam](https://store.steampowered.com/app/3127230/PBA_Pro_Bowling_2026/) / [리뷰(Pure Xbox)](https://www.purexbox.com/news/2025/12/pba-pro-bowling-2026-reviews-suggest-its-one-of-the-best-bowling-games-ever-on-xbox)
- [Wii Sports Bowling — Fandom](https://wiisports.fandom.com/wiki/Bowling_(sport)) / [Training(StrategyWiki)](https://strategywiki.org/wiki/Wii_Sports/Bowling_Training) — Spin Control · Power Throws · 100-Pin Pro
- [BOWL.com — Alternate Bowling Games](https://bowl.com/welcome/alternate-bowling-games) — Baker · No-Tap · Duckpin · Candlepin
- [Brunswick — No-Tap](https://brunswickbowling.com/bowling-centers/equipment-parts-supplies/center-operations/sync/scoring/games/no-tap) / [No-Tap 스코어링(LiveAbout)](https://www.liveabout.com/no-tap-bowling-scoring-420894)
- [Best Bowling Games — Bananatic](https://www.bananatic.com/blog/the-best-bowling-games-of-all-time) (Galaxy Bowling 3D: 텐핀/캔들핀/덕핀)
- **오일 패턴(v3):** [BowlersMart — Understanding Oil Patterns](https://www.bowlersmart.com/tournaments/understanding-oil-patterns/) · [The Sport of Bowling — Oil Patterns](https://www.thesportofbowling.com/oil-patterns/) · [BOWL.com — PBA 패턴 뱅크](https://bowl.com/oil-pattern-bank/pba) · [PBA — Oil Patterns](https://www.pba.com/player-resources/oil-patterns) — 하우스 vs 스포츠 비율·퍼널, 동물 패턴 길이(Cheetah 33 / Viper 37 / Chameleon 39 / Scorpion 42 / Shark 48 ft)
