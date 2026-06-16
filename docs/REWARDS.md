# 보상 시스템 설계 — 업적(뱃지) + 코스메틱 볼 스킨

> 작성: 2026-06-16 (11차 세션, ③ 승리 보상). **상태: 설계 v2.1 — 미구현.**
> v2.1 = 코드 대조(렌더 파이프라인 검증) + 레퍼런스 검토 + **UI 결정 A(전용 스킨 시트, §10)** 반영. 관련: [PROGRESS.md](./PROGRESS.md) · [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) · [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md)(AI 사다리 = 불가침) · [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md).

---

## 검토 반영 (v1 → v2)

코드 대조 + 레퍼런스로 v1을 정정:

1. **§11 렌더 가정이 거꾸로였음** — `Engine.ts:80`에 **`PMREMGenerator`+`scene.environment`(RoomEnvironment) 이미 존재** → 크롬/메탈릭 스킨은 *지금 바로* 잘 나옴(미룰 게 아니라 간판). 반대로 **bloom 없음 + `ACESFilmicToneMapping`** 이라 emissive 네온 글로우가 제일 약발 안 받음. → **스킨을 "마감(finish) 축"으로 재구성**하고, 네온 글로우는 **bloom 도입을 전제**로.
2. **스킨은 retention 엔진이 아니라 폴리시** — 레퍼런스: 코스메틱 동기부여는 상당 부분 *사회적 과시*에서 오는데 이 게임은 **오프라인 솔로(vs AI)** 라 그 채널이 없음. 살아남는 근거는 (a) 공이 매 투구 보임=자기 personalization, (b) 업적=숙련감(intrinsic). → **업적이 본체, 스킨은 곁들이**로 기대치 조정.
3. **업적 축소·마스터리 프레이밍** — 그라인드성(`blitz 90+` 류) 컷. "수집"이 아니라 "스킬 이정표". (함정: pointsification·체크리스트화·무의미 그라인드.)
4. **`decorColor`로 알려진 이슈 동시 해결** — `Ball.ts:52` "어두운 공에서 구멍 묻힘 = 알려진 사양" 주석을 스킨 작업이 같이 고침.

레퍼런스: [achievement 함정](https://www.wayline.io/blog/achievement-trap-gamification-ruining-games) · [실패 회피](https://www.designthegame.com/learning/tutorial/avoiding-common-achievement-failures) · [reward 심리(사회적 맥락)](https://breakingac.com/news/2025/feb/14/the-psychology-of-gaming-rewards-why-achievements-feel-so-satisfying/) · [SDT/intrinsic](https://digitalthrivingplaybook.org/big-idea/self-determination-theory-for-multiplayer-games/) · 장르: [Switch Sports](https://diamondlobby.com/switch-sports/how-to-unlock-new-bowling-balls/)(코스메틱-온리) vs [Bowling Crew](https://bowlingcrew.com/blogs/entry/33-balls-a-complete-guide/)(스탯 업글=회피).

---

## 한 줄 요약

**행동 → 업적(뱃지) → 코스메틱 볼 스킨**의 한 루프. **업적 = 본체**(숙련 이정표, intrinsic), **스킨 = 시각 폴리시**(매 투구 보이는 트로피). 스킨은 **외형만 — 물리/성능 무영향**(AI 사다리 보호). 과금·가챠 없음. 절차적 머티리얼 + localStorage. 신규 3D/오디오 에셋 0. **bloom은 v1에서 분리** — 마감 스킨만으로 먼저 출시, bloom은 별도 폴리시 태스크(§14·§16#6).

---

## 1. 목표 / 비목표 / 기대치

**목표**
- "이겼다 → 그래서 뭐?"의 공백을 **숙련 이정표**로 메움(다음 목표 제공).
- 기존 구조(AI 라이벌 사다리·`Stats`·모드)에 **얹기만**.

**비목표 (명시적 배제)**
- ❌ 과금·IAP·가챠. ❌ **스탯 업그레이드 볼**(페이투윈 + AI 사다리 붕괴). ❌ 화폐/시즌패스. ❌ 신규 에셋 의존.

**⚠️ 기대치 (레퍼런스 기반 — 과투자 방지)**
- 이 게임은 **오프라인 솔로**라 코스메틱의 사회적 동기부여가 없음 → **스킨은 리텐션 엔진이 아니라 마감 폴리시**로 본다. 가치의 본체는 **업적이 주는 숙련/유능감**(intrinsic)과 "다음 목표". 스킨은 그 성취의 *눈에 보이는 보상*(공이 늘 화면에 있으니 자기 personalization으로 작동). **작게, 스킬 기반으로, 컬렉션 그라인드 금지.**

---

## 2. 레퍼런스 근거

| 캠프 | 예시 | 모델 | 우리 |
|---|---|---|---|
| **A. 라이브서비스** | Bowling Crew / King | 볼 수집 + **스탯 업글** + 가챠 스킨 + 시즌 | ❌ 페이투윈·밸런스 붕괴 |
| **B. 콘솔 캐주얼** | Switch Sports | **플레이→코스메틱**, 과금 0·성능 0 | ✅ 채택 |

설계 이론: 코스메틱-온리가 공정, 업적은 강한 동기부여, "항상 노릴 다음 상품"이 리텐션 핵심. **단** 솔로 오프라인에선 코스메틱 효과가 감소(§1 기대치). 함정: pointsification·체크리스트화·그라인드.

---

## 3. 핵심 원칙 (불변식)

1. **스킨 = 머티리얼 파라미터만** (`color`/`roughness`/`metalness`/`emissive`/`envMapIntensity`/`decorColor`). `massKg`·`maxSpeedScale` 불가침 → 물리·AI 사다리 무영향.
2. **무게(6~16lb)가 유일한 성능 노브**. 스킨과 직교.
3. **업적이 본체, 스킨은 폴리시** (§1 기대치). 그라인드형 업적 금지 — 스킬/마스터리만.
4. **저장 graceful** (localStorage 실패 시 조용히 무시).
5. **멱등** — 해금된 업적 재토스트·재기록 안 함.
6. **그린필드** — 기존 achievement/unlock/skin 코드 0.

---

## 4. 루프 개요

```
  플레이 행동(스킬)          업적 달성(뱃지)            볼 스킨 해금
 ───────────────         ──────────────────        ──────────────
  한프로 격파       →      🏅 "프로 사냥꾼"      →      크롬 볼(반사)
  200점 돌파        →      🏅 "200 클럽"        →      볼트 볼(글로우)
  3연속 스트라이크   →      🏅 "터키"            →      선셋 볼(글로우)
                                                          │
                                              스킨 시트에서 선택 → 매 투구 적용
```

---

## 5. 데이터 모델

### 5.1 Achievement (코드 상수, 신규 `game/rewards.ts`)
```ts
interface Achievement {
  id: AchievementId;        // 'beat_han', 'score_200' … (저장 키)
  badge: string;            // '프로 사냥꾼'
  desc: string;             // 해금 조건 설명
  icon: string;             // 이모지 🏅 (에셋 0)
  reward: SkinId;
  tier: 'core' | 'stretch';
}
```

### 5.2 BallSkin (코드 상수)
```ts
interface BallSkin {
  id: SkinId;
  label: string;
  finish: 'matte' | 'satin' | 'metallic' | 'chrome' | 'glow' | 'animated';
  useWeightColor?: boolean; // classic만 — 무게 기반 색 유지
  color?: number;
  roughness?: number;
  metalness?: number;
  envMapIntensity?: number; // 크롬/메탈릭 반사 강도 (씬 environment 활용)
  emissive?: number;        // 글로우 색 (bloom과 함께 빛남)
  emissiveIntensity?: number;
  decorColor?: number;      // 그립·로고 마크 색 (어두운 공 대비)
  animate?: 'pulse' | 'hue';// Ball.update에서 시간 갱신 (animated만)
}
```

### 5.3 저장 (`bowling3d.rewards.v1`)
기존 `bowling3d.stats.v1` 컨벤션(try/catch graceful).
```ts
interface RewardStore {
  earned: AchievementId[];  // 단일 진실원 (해금 스킨 = earned에서 파생)
  selectedSkin: SkinId;     // 기본 'classic'
}
```

---

## 6. 업적 카탈로그 (마스터리 — 그라인드 없음)

전부 **`gameOver` 시점 데이터**로 판정(§8). 스킬/사다리 기반만 — "수집용 채우기" 업적 없음.

### Core (v1, 6개)
| id | 뱃지 | 아이콘 | 조건 | 보상 스킨 |
|---|---|---|---|---|
| `first_game` | 첫 발걸음 | 🎳 | 첫 게임 종료(온보딩 — 시스템 존재 알림) | `satin` |
| `beat_kim` | 입문 졸업 | 🥉 | 김부장 격파(`winner===0` ∧ rival `kim`) | `ember` |
| `beat_han` | 프로 사냥꾼 | 🏅 | 한프로 격파(rival `han`) — 가장 어려운 라이벌 | `chrome` ⭐ |
| `beat_yoon` | 하이롤러 | 🎰 | 도박사 윤 격파(rival `yoon`) | `galaxy` |
| `score_200` | 200 클럽 | 💯 | 풀게임 200+ (`mode==='full'`) | `volt` |
| `turkey` | 터키 🦃 | 🦃 | 한 게임 3연속 스트라이크(rolls 판정) | `sunset` |

### Stretch (P5, 마스터리 정점)
| id | 뱃지 | 조건 | 보상 스킨 |
|---|---|---|---|
| `perfect_300` | 퍼펙트 | `mode==='full'` ∧ 300점 | `holo` 👑 |
| `spare_master` | 스페어 장인 | 스페어 챌린지 올클리어 | `obsidian` |
| `clean_game` | 클린 게임 | 풀게임 오픈 프레임 0(전부 X/스페어) | `pulse` |

> ❌ **컷**: `blitz_ace(3프레임 90+)` 류 점수-임계 그라인드 — 무의미 그라인드 함정(레퍼런스). 블리츠 보상이 필요하면 "블리츠에서 라이벌 격파" 같은 *스킬* 조건으로만 재도입.
>
> 💡 **core v1은 정적 스킨만** — 애니 스킨(`pulse`/`holo`)은 전부 stretch(P5)로 몰아 **`Ball.update` 훅 의존을 v1에서 제거**(bloom만 있으면 됨). turkey는 정적 글로우 `sunset`.

---

## 7. 스킨 카탈로그 (마감 축 — 파이프라인 검증 반영)

`MeshStandardMaterial`(holo만 `MeshPhysicalMaterial`). **전부 물리 무관.** 씬에 `scene.environment`(IBL) 있음 → 메탈릭/크롬 반사 네이티브 지원. emissive 글로우는 **bloom 전제**(§11).

| id | 라벨 | finish | 핵심 파라미터(개략) | 파이프라인 |
|---|---|---|---|---|
| `classic` | 클래식 | metallic | `useWeightColor`, rough .25, metal .3 (현재) | 기본·항상 해금 |
| `satin` | 새틴 | satin | 라이트, metal .45, rough .4 | ✅ 네이티브 |
| `chrome` | 크롬 | chrome | color `#dfe6ee`, metal 1.0, rough .04, **envMapInt 1.4**, decor `#1a2230` | ✅ **environment 반사 즉시** |
| `obsidian` | 옵시디언 | matte | color `#0c0e14`, metal .1, rough .95, decor `#cfd6e6` | ✅ 네이티브 |
| `sunset` | 선셋 | glow | color `#ff5e8a`, emissive `#ff3a6e` int .8 | bloom 필요(글로우) |
| `ember` | 엠버 | glow | color `#331100`, emissive `#ff7a18` int 1.1 | bloom 필요 |
| `volt` | 볼트 | glow | color `#1a1a00`, emissive `#fff200` int 1.0 | bloom 필요 |
| `galaxy` | 갤럭시 | glow | color `#1a1247`, metal .5, emissive `#5a2ad6` int .7 | bloom 권장(메탈+글로우) |
| `pulse` | 펄스 | animated | emissive `#4ade80` int .4↔1.2 맥동(`animate:'pulse'`) | bloom + `Ball.update` 훅 |
| `holo` | 홀로 | animated | `MeshPhysicalMaterial` iridescence 1.0 (또는 `animate:'hue'` 폴백) | ✅ three 0.184 지원(r129+) |

> classic 외 색 지정 스킨은 무게 색을 덮어씀(의도). bloom 미도입/저사양 시 glow 스킨은 "밝은 색"으로 우아하게 강등(§11).

---

## 8. 평가 로직 — 단일 훅 + 순수 함수

**`gameOver` 한 곳에서만 평가**(인게임 즉시 토스트는 P5 옵션).

```ts
interface EvalInput {
  mode: GameMode; humanScore: number;
  winner: number;          // 0=인간 / -1=무승부 / 1+=AI
  rivalKeys: string[];     // 매치 AI key (예: ['han'])
  rolls: number[][]; frames: number;
  stats: ModeStats | undefined;
  spareCleared?: boolean;
}
// 이번 게임으로 "새로" 달성된 id만 (이미 earned 제외)
function evaluateAchievements(input: EvalInput, alreadyEarned: AchievementId[]): AchievementId[];
```
- DOM·전역 의존 0 → **vitest 케이스 테스트**(§15). `winner===0`만 격파 인정. 멱등은 `alreadyEarned`.

**Boot 훅 (스케치):**
```ts
case 'gameOver': {
  const human = game.players[0];
  const input = {
    mode: game.mode, humanScore: e.summary.players[0].score, winner: e.summary.winner,
    rivalKeys: game.players.slice(1).map(p => p.ai?.key).filter(Boolean),
    rolls: human.rolls, frames: e.summary.frames,
    stats: loadStats()[game.mode], spareCleared: /* 스페어 판정 */,
  };
  const fresh = evaluateAchievements(input, loadRewards().earned);
  if (fresh.length) { recordRewards(fresh); }
  menu.showResult(e.summary, fresh);   // 결과 화면 해금 토스트
  break;
}
```

---

## 9. 스킨 적용 시임

- **`scene/Ball.ts`** — 현재 `setSpec()`(`Ball.ts:97`)는 mass + 본체색만. 신규 `setSkin(skin: BallSkin)`:
  - `classic`(`useWeightColor`)면 `spec.color`, 아니면 skin 파라미터(`color`/`roughness`/`metalness`/`envMapIntensity`/`emissive`+`Intensity`).
  - **그립·로고 마크를 `decorColor`로 재색** — `Ball.ts:52`에 "어두운 공에서 구멍 묻힘 = 알려진 사양"으로 박힌 이슈를 **이 작업이 같이 해결**(어두운 스킨엔 밝은 그립).
  - `animate` 스킨(`pulse`/`holo`)은 신규 **`Ball.update(dt)`** 에서 맥동/hue 회전 — **전부 P5 전용**. core v1엔 애니 스킨이 없어 `update()` 훅은 P5에서만 배선(현재 Ball엔 없음).
- `setSpec`(무게)와 `setSkin`(외형) 분리 호출. 둘 다 `AIMING`에서 인간 볼에 반영.
- 적용 시점: 시트 선택 시 + `startMatch`/`setHumanBallSpec` 시 `selectedSkin` 재적용.

---

## 10. UI (결정 A — 전용 스킨 시트)

스킨은 외형 전용·"한 번 정하면 끝"이라 무게(성능 노브)와 달리 **시작 플로우를 막지 않는다.** 같은 backdrop 패널의 **세 번째 뷰**로 분리(별도 *화면* X) — `showMenu()`↔`showResult()`가 쓰는 `replaceChildren` 패널 스왑 패턴 재사용이라 신규 인프라 ≈0.

### 10.1 메뉴 진입점 (무게 슬라이더 아래, 한 줄)
`🎨 스킨 · {현재 장착} ▸` 버튼 하나만 — 장착 스킨 미리보기 + 시트 진입. **시작 버튼은 안 밀림**(무게=필수 노브 우선, 스킨=선택 폴리시).

### 10.2 스킨 시트 (`Menu.showSkins()`, 신규 뷰)
`chipButton(label, desc)` 재사용. 해금=색 스와치+골드 테두리(장착), **잠금=회색+🔒+해금 조건 한 줄**. 콜백 `onSkinChange(id)` → `game.setBallSkin(id)` + `selectedSkin` 저장. `← 메뉴로` 복귀.

> **이 시트가 곧 컬렉션/업적 화면 겸용** — 별도 그리드 안 만듦(중복 UI 회피, §1 "작게"). 잠금+조건 목록이 "다음에 뭘 노릴까" = **솔로 게임의 리텐션 후크**(§1 — 사회적 과시 대신 이게 동기 엔진이라 *읽을 수 있게* 보여줘야 함 → 인라인 가로 스트립 기각).

### 10.3 해금 토스트 (결과 화면)
`Menu.showResult(summary, freshAchievements)` 확장. `✨ 새 기록!` 옆에 `🏅 NEW · 프로 사냥꾼 → 크롬 볼!`(여러 개 스택) + 방금 딴 스킨 **`장착하기` 버튼**(최고 의도 타이밍 — 메뉴/시트 안 거쳐도 즉시 장착) + `SoundManager` 합성 "딩"(에셋 0).

> **4면 분리**: 메뉴(진입)·시트(컬렉션)·결과(해금+즉시 장착)·**공(인게임 실사용, 추가 UI 0)**. 각자 역할만 — 안 겹침. 보상의 *실페이오프*는 결국 매 투구 보이는 공.

---

## 11. 렌더 파이프라인 정합 (✅ 코드 검증됨)

v1의 잘못된 가정을 코드로 정정:

1. **envMap 있음** — `Engine.ts:80-82` `PMREMGenerator`+`scene.environment=RoomEnvironment`, `environmentIntensity 0.4`. → **크롬/메탈릭 스킨은 신규 인프라 0으로 반사**(per-material `envMapIntensity`로 강도 조절). 크롬은 미룰 게 아니라 **1차 간판 보상**(가장 어려운 `beat_han`).
2. **bloom 없음 + `ACESFilmicToneMapping`**(`Engine.ts:57`) — emissive는 *자체 발광/밝기*만 오르고 헤일로 없음 + ACES가 하이라이트를 눌러 "네온 글로우"가 약함. → **결정: `UnrealBloomPass` 1개 도입(full-scene)**(공뿐 아니라 선셋 배경·네온 라인 등 **씬 전체 신스웨이브 톤**이 살아남 = 투자 가치). `EffectComposer` 경로로 전환. **단 아래 3개 함정(웹서치 검증) 처리 필수:**
   - **(A) 네이티브 AA 유실 — 확정 이슈.** EffectComposer 쓰면 캔버스 `antialias:true`가 무력화돼 엣지가 거칠어짐(three 표준 권장이 `antialias:false` + 컴포저 자체 MSAA). → renderer `antialias:false`로 바꾸고 **컴포저 렌더타깃 `samples:4`(WebGL2 MSAA)** + `OutputPass`로 복구. 9차에 잡은 **거터 벽 엣지크롤/점멸 재확인이 P2 게이트**.
   - **(B) ACES 톤매핑 이전.** 컴포저 경로는 renderer 톤매핑을 우회 → 색 틀어짐. `ACESFilmicToneMapping`을 **`OutputPass`로 이전**. 안 하면 현재 룩과 달라짐.
   - **(C) 모바일 비용 — 확정.** UnrealBloomPass는 mip 체인이라 BloomPass보다 비쌈; 실사례 고사양서도 40fps·GPU 90% 보고. → **저사양/coarse-pointer는 bloom OFF 기본**([MOBILE_SUPPORT.md] 저사양 분기). 이때 glow 스킨은 emissive 밝기만 남아 "밝은 색"으로 **우아하게 강등**(안 깨짐). `THREE.Color`를 렌더 루프서 매번 생성 금지(GC).
   - *대안 검토*: 공만 빛내는 **selective bloom**은 컴포저 2개 + 레이어 마스킹(비bloom 머티리얼 스왑)이라 코드량↑ → full-scene이 더 단순 + 씬 전체 톤 이득이라 채택. (selective는 P5 이후 정밀화 옵션.)
3. **`MeshPhysicalMaterial` iridescence**(`holo`) — ✅ `three ^0.184.0`에서 지원 확인됨(r129+). `animate:'hue'`(emissive 색상 회전) 폴백은 저사양 단순화용으로만 선택 보유(필수 아님).
4. **`Ball.update()` 없음** — `pulse`/`holo` 시간 애니는 신규 update 훅 필요. **core v1은 정적 스킨만이라 이 훅 불요** — 배선은 P5(애니 스킨)에서만.
5. **Lane은 의도적 무광**(`Lane.ts:80` `envMapIntensity:0`) — 레인 반사 시밍 회피용. 볼 스킨과 무관(볼만 반사 켬).

> **⚠️ 권장 — bloom을 보상 시스템과 분리(decouple).** bloom은 *렌더러 재작성*(EffectComposer 전환 + 위 A/B/C + 실기 AA·발열 재검증)이라 보상 로직과 결합도 0인데 리스크는 제일 큼. → **보상 P1~P4를 마감 스킨(`classic`/`satin`/`chrome`/`obsidian`)만으로 먼저 출시**(glow는 일단 "밝은 색"으로 동작), **bloom은 별도 비주얼 폴리시 태스크(자체 브랜치)** 로 떼서 천천히. 보상 출시가 렌더러 수술에 안 묶임.
>
> **⚠️ 단 트레이드오프**: 그러면 core 6개 중 glow 보상 4개(`ember`/`galaxy`/`volt`/`sunset`)가 출시 시점엔 밋밋 = 6개 중 4개가 약발 안 받음. → bloom을 v1에 같이 넣든지, **core 보상의 finish/glow 비중을 재조정**(예: 한두 개를 마감 계열 보상으로 교체)할지 결정 필요. **(미결 — §16 #6)**

---

## 12. 통합 지점 표 (코드 훅 — 검증됨)

| 시임 | 파일 · 심볼 | 용도 |
|---|---|---|
| 저장 컨벤션 | `game/Stats.ts` `KEY='bowling3d.stats.v1'`, `loadStats`/`recordGame`, try/catch | 병렬 `game/rewards.ts` |
| 게임 이벤트 | `game/GameState.ts` `GameEvent`(`strike{streak}`/`gameOver{summary}`) | 트리거 |
| 승자·라이벌 | `GameSummary{winner, players[].ai:boolean, score}`; `players[0]`=인간, `GameState.players[i].ai:AiProfile.key` | 격파 판정 |
| 이벤트 배선 | `core/Boot.ts` `game.onEvent` `case 'gameOver'`→`menu.showResult` | 평가·토스트·기록 주입 |
| AI 프로필 | `game/ai.ts` `AiProfile{key:'kim'|'han'|'yoon', …}` | 라이벌 식별 |
| 볼 머티리얼 | `scene/Ball.ts:37`(`MeshStandardMaterial`), `setSpec`(`:97`), 그립 고정 `0x0a0a0a`(`:52` 주석) | `setSkin()` + `decorColor` |
| 렌더 | `core/Engine.ts:57`(ACES), `:80`(PMREM/environment) — bloom 없음 | `EffectComposer`+`UnrealBloomPass` 추가 |
| 볼 스펙 | `game/BallSpec.ts`(`{label, massKg, maxSpeedScale, color}`) | 무게=유일 성능 노브 ✓ |
| 메뉴 | `ui/Menu.ts` `chipButton`/`refreshChips`, 무게 슬라이더, `showResult`, `applyPanel`/`NEON` | 진입 버튼·시트(`showSkins`)·토스트 |

---

## 13. 엣지 케이스 / 불변식

- **무승부(`-1`)·패배**: 격파 업적 불인정.
- **라이벌 매칭**: `players.slice(1)`의 `ai.key`(현재 매치당 1인, 배열이라 다인 확장 호환).
- **터키(rolls)**: 1~9프레임 `rolls[f][0]===10`, 10프레임은 한 프레임 다중 X → 투구 평탄화 후 "연속 스트라이크 ≥3"(순수함수 + vitest로 고정).
- **클린 게임**: 전 프레임 X 또는 스페어(10프레임 보너스 주의).
- **멱등**: `alreadyEarned` 제외.
- **localStorage 실패**: 폴백 `{earned:[], selectedSkin:'classic'}`, write 실패 무시.
- **기존 세이브 호환**: 신규 키 → `stats.v1` 무영향.
- **bloom 저사양 off**: glow 스킨 강등(밝은 색), 깨짐 없음.

---

## 14. 구현 단계

- **P1 — 데이터·평가·저장**(DOM 무관, 테스트 우선): `game/rewards.ts`(Achievement/Skin 상수 + `evaluateAchievements` 순수함수 + `loadRewards`/`recordRewards`). vitest.
- **P2 — 볼 적용 (bloom 없이)**: `Ball.setSkin()`(정적만, `Ball.update` 불요) + `decorColor` 그립 재색. 마감 스킨(classic/satin/chrome/obsidian)은 파이프라인 네이티브로 완성. glow 스킨(sunset/ember/volt/galaxy)은 일단 emissive "밝은 색"으로 동작(bloom 전 강등 상태). **렌더러 무수술 — P1~P4가 여기 안 묶임.**
- **P3 — 스킨 시트**: 메뉴 진입 버튼(`🎨 스킨 · {장착} ▸`) + `Menu.showSkins()` 뷰(잠금+조건 표시) + `selectedSkin` 저장/적용.
- **P4 — 토스트**: `showResult` 해금 토스트 + 해금 사운드.
- **P5(선택)** — `Ball.update` 훅 + 애니 스킨(`pulse`/`holo`) + stretch 업적(perfect/spare_master/clean) + 인게임 즉시 토스트.
- **별도 태스크 — bloom 비주얼 폴리시**(자체 브랜치, §11·§16#6 결정): `EffectComposer`+`UnrealBloomPass` 도입(A: `antialias:false`+`samples:4` MSAA, B: ACES→`OutputPass`, C: 저사양 off 기본) + 거터 벽 점멸 재검증. 완료 시 glow 스킨이 강등→네온으로 **자동 승격**. **보상 출시와 독립.**

---

## 15. 테스트

`evaluateAchievements` 순수함수 → **vitest 행동 검증**: 한프로 격파 win→`beat_han`, 무승부/패배→0; 200/300 경계·모드별; 터키 3연속 O / 2연속 X / 10프레임 X3; 멱등; 스페어 올클·클린 판정. (기존 22/22 회귀 없음.)

---

## 16. 결정 현황

| # | 항목 | 결정 |
|---|---|---|
| 1 | 스킨 범위 | ✅ **마감 축 + bloom 도입.** v1 = classic/satin/chrome/obsidian(네이티브) + sunset/ember/volt/galaxy(정적 글로우). **애니 스킨(pulse/holo)·`Ball.update`는 P5.** |
| 2 | 업적 범위 | ✅ **core 6**(first_game/beat_kim/beat_han/beat_yoon/score_200/turkey). stretch 3은 P5. 그라인드형 컷. |
| 3 | 인게임 즉시 토스트 | ✅ v1은 **결과 화면 일괄**, 즉시 토스트는 P5. |
| 4 | 컬렉션 진입점 | ✅ **전용 스킨 시트(결정 A)** — 같은 패널 3번째 뷰 `Menu.showSkins()`, 메뉴엔 한 줄 진입 버튼. 별도 *화면* X. 결과 토스트에 `장착하기`. (인라인 스트립 기각 — 조건 가독성, §10.2.) |
| 5 | 네이밍 | ✅ 초안 락, 폴리시 때 미세 조정. |
| 6 | bloom 출시 결합 | ✅ **분리 출시.** 보상 P1~P4는 마감 스킨만으로(렌더러 무수술), bloom은 별도 비주얼 폴리시 태스크(자체 브랜치, §14). glow 보상 4개는 bloom 전까진 "밝은 색"으로 동작 → bloom 완료 시 자동 승격. 보상 카탈로그 재조정은 안 함(obsidian=stretch 등 a 유지). |
| ⚠️ | bloom 모바일 비용 | **확정(웹서치)** — UnrealBloomPass mip 체인, 고사양서도 40fps·GPU 90% 사례. 저사양 off 기본(§11-C). 실기 확인. |
| ✅ | holo iridescence | **`three ^0.184.0` 지원 확인됨**(`MeshPhysicalMaterial.iridescence`, r129+). P5에서 그대로 사용. |
| ⚠️ | bloom AA 회귀 | `renderer.render`→`composer.render` 전환 시 캔버스 네이티브 MSAA(`Engine.ts:54` antialias)가 컴포저 렌더타깃에서 유실될 수 있음 → 9차에 잡은 거터 벽 엣지크롤/점멸 재발 위험. **완화**: 컴포저 렌더타깃 `samples`(WebGL2 MSAA) 또는 SMAA/FXAA 패스, 도입 후 거터 벽 재확인(P2 체크). |
| ⚠️ | dim IBL 크롬 가독 | `scene.environmentIntensity=0.4`(`Engine.ts:82`, 레인 과노출 방지 톤다운) + RoomEnvironment라 chrome가 거울 아닌 *브러시드 스틸*로 보일 소지. `envMapIntensity`는 per-material(레인 무관)이라 1.4→2~3 상향 가능. **간판(beat_han) 약속 전 실측.** |

---

## 참고

- 밸런스 불가침: [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md)(AI 사다리 = 중립 볼 튜닝). 스킨은 성능 무개입.
- 모바일: [MOBILE_SUPPORT.md](./MOBILE_SUPPORT.md)(bloom/저사양 정합).
- 레퍼런스: "검토 반영" 섹션 링크.
