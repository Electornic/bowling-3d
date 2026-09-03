# 3D 웹 볼링 게임 — 설계 도안

> 정식 1인 볼링 게임 (10프레임 / 스트라이크·스페어 점수 / 조준·파워·스핀 / 볼 무게 선택 / 카메라 연출)
> 스택: **Three.js** (렌더링) + **Rapier** (물리, Rust→WASM) + **Vite** (번들러) + **TypeScript**
>
> ※ §13(부록 A) = 핵심 물리 가정 ↔ 실제 Rapier API 검증 결과. §14(부록 B) = 수학·물리 공식 레퍼런스. 구현 전 필독.

---

## 이 문서의 역할 (2026-09-02 정리)

**이 문서는 *설계 의도*다.** 게임은 도안을 벗어난 지점이 많고, 코드 주석이 `도안 §N`으로 이 문서를
참조하므로 **절 번호는 고정**한다. 현재 어떻게 굴러가는지는 **코드와 커밋 메시지가 단일 소스**다.

각 절에 `> **현재 상태**` 블록이 있으면 그게 구현 실황이고, 블록 위 본문은 당시 의도다.
사운드는 분량이 커져 [SOUND.md](SOUND.md)로 분리했다.

### 구현과 갈린 절 (요약)

| 절 | 상태 |
|---|---|
| §1 사운드 스택 | howler.js **미채택** → Web Audio 직접 |
| §2 폴더 구조 | **크게 다름** — `public/` 없음, `AssetFactory`·`Frame`·`Throw`·`rules` 없음, 도안에 없던 파일 20개 |
| §3 규격 | `LANE_LENGTH` 상수는 없다 → `HEADPIN_Z` |
| §4 / §4.4 물리 | contact force 이벤트 **미채택**, 마찰값 다수 변경, 오일 2존 |
| §4.1 오일 패턴 | "(폴리싱) 흉내 가능" → **구현됨** (`oil.ts`) |
| §4.2 거터 | 문턱이 **둘**로 갈렸다 (2026-09-02 래치 수정) |
| §5.1 부팅 | "Loading…" 오버레이 → 핀 랙 세팅 연출 |
| §5.3 AssetFactory | **파일 없음** (GLTF 단계 미도달, procedural 유지) |
| §6 상태머신 | `BOOT`·`PLAYING`·`SCORING`·`CLEAR_DEADWOOD`·`BETWEEN_FRAMES` **없음** (실제 5개) |
| §7 파울 | **미구현** (파울라인은 시각 메시만) |
| §7.1 테스트 | Scoreboard 단위테스트 → **4층 구조 23파일** |
| §8 조작 | `Throw.ts` 없음, 릴리스 정확도 노이즈 시스템 추가 |
| §9 카메라 | 4줄 → 리플레이·슬로모·푸시인·종횡비 유도까지 확장 |
| §10 사운드 | → **[SOUND.md](SOUND.md)** |
| §11 마일스톤 | M0~M7 **전부 완료** (체크박스가 비어 있었다) |
| §12 P2 | "범위 밖" 목록이 **대부분 구현됨** |

---

## 1. 기술 스택 & 이유

| 역할 | 선택 | 이유 |
|------|------|------|
| 3D 렌더링 | three.js | 웹 3D 표준, 자료 압도적, 씬/카메라/조명 API 직관적 |
| 물리 엔진 | @dimforge/rapier3d-compat | 빠르고 정확. 굴림(rolling)·충돌이 핵심인 볼링에 적합 |
| 빌드 | Vite | 빠른 HMR, WASM·TS 기본 지원 |
| 언어 | TypeScript | 벡터·상태 많아서 타입이 버그를 크게 줄여줌 |
| 사운드 | ~~howler.js~~ → **Web Audio 직접** | howler 미채택(의존성 0). 상세 [SOUND.md](SOUND.md) |
| 테스트 | Vitest | 점수 로직(순수함수) 단위테스트, Vite와 통합 |
| 상태 | 순수 JS 상태머신 | 게임 흐름이 단순해 라이브러리 불필요 |

> `rapier3d-compat`를 쓰는 이유: WASM을 비동기 init 없이 번들에 포함시켜 Vite에서 셋업이 가장 쉬움.

---

## 2. 폴더 구조

> **현재 상태 (2026-09-02).** 아래는 **실제 트리**로 교체했다. 도안 원안과 갈린 지점: `public/`
> 디렉터리 자체가 없고(에셋은 `src/audio/`에 함께 번들), `AssetFactory.ts`·`Frame.ts`·`Throw.ts`·
> `rules.ts`는 **만들어지지 않았다**(각각 §5.3·§7·§8·§4.3 참고). 반대로 도안에 없던 `i18n/`·
> `game/ai.ts`·`game/oil.ts`·`game/rewards.ts`·`scene/Replay.ts`·`ui/StillCut.ts` 등이 생겼다.

```
bowling-3d/
├─ index.html              뷰포트/제스처 잠금 + 부팅 로더 연출(인라인)
├─ package.json
├─ vite.config.ts
├─ sim-carry.mjs           핀 캐리 스캔 (상수를 복사해 씀 — 값이 갈릴 수 있다)
├─ src-tauri/              Tauri v2 (데스크톱·모바일 패키징)
├─ docs/
│   ├─ GAME_DESIGN.md      ← 이 문서 (설계 의도)
│   ├─ SOUND.md            사운드 현재 상태·백로그
│   ├─ MOBILE_SUPPORT.md
│   ├─ APP_PACKAGING.md
│   └─ legacy/             그때의 근거·측정 기록 (현재 상태로는 믿지 말 것)
├─ tests/                  4층 구조 — 상세 §7.1
│   └─ unit/ · scenarios/ · sim/ · geometry/ · helpers/
└─ src/
    ├─ main.ts
    ├─ core/
    │   ├─ Boot.ts           배선의 단일 지점 (+ 세로 안내·햅틱·visibilitychange)
    │   ├─ Engine.ts         three 렌더러 + rapier world, 적응형 pixelRatio
    │   ├─ Loop.ts           고정 timestep accumulator (onStep/onFrame 2축)
    │   └─ device.ts         coarse pointer 등 기기 판정
    ├─ scene/
    │   ├─ Lane.ts           레인 + 거터 + 킥백 (오일 시각화 포함)
    │   ├─ Ball.ts · Pin.ts · PinSet.ts
    │   ├─ Environment.ts    볼링장 인테리어·전광판·파울라인 (전부 procedural)
    │   └─ Replay.ts         스트라이크 리플레이
    ├─ game/
    │   ├─ GameState.ts      상태머신 5개 + 모드·멀티플레이어·AI 턴 (§6)
    │   ├─ Scoreboard.ts     10프레임 점수 (파울 미구현 — §7)
    │   ├─ constants.ts      물리·카메라·조준 상수 단일 소스 (§4.4)
    │   ├─ BallSpec.ts       볼 무게 6~16 lb 함수 생성 (§4.5)
    │   ├─ predict.ts        조준선 적분기 (Rapier와 테스트로 대조)
    │   ├─ ai.ts             AI 라이벌 3인 사다리
    │   ├─ oil.ts            오일 패턴·마름 (§4.1)
    │   └─ splits.ts · Stats.ts · rewards.ts · settings.ts · screenStore.ts
    ├─ input/Controls.ts     포인터+키보드, 터치 ⓑ 상대 조준 (MOBILE_SUPPORT §2)
    ├─ camera/CameraRig.ts   조준·추적·푸시인·리플레이 (§9)
    ├─ audio/
    │   ├─ SoundManager.ts   → SOUND.md
    │   └─ roll.wav · strike.wav · mi_music-reggae-ruckus-157890.mp3
    ├─ i18n/                 자체 소형 i18n + ko/en/ja/zh
    └─ ui/
        ├─ Hud.ts            점수 시트(HUD·결과 공유) · 남은 핀 인디케이터
        ├─ Menu.ts           시작·일시정지·설정·컬렉션·언어
        ├─ StillCut.ts       스트라이크/스페어/거터/스플릿 코믹 패널
        └─ PinDeck.ts · screenMedia.ts · theme.ts
```

---

## 3. 좌표계 & 실제 규격 (게임 단위 = 1m)

```
        z+ (핀 방향, 앞)
        ▲
        │   [핀 10개]   ← z ≈ +18.3
        │
        │   ───────── 레인 ─────────
        │
   파울라인 z = 0
        │   [공 시작]   ← z ≈ -1
        └────────────────────────▶ x+ (오른쪽)
   y+ = 위(높이)
```

표준 볼링 규격을 그대로 미터 단위로 사용:

| 항목 | 실제 규격 | 게임 값 |
|------|-----------|---------|
| 레인 길이 (파울라인→1번핀) | 18.29 m | `HEADPIN_Z = 18.29` ⚠️ `LANE_LENGTH` 상수는 **없다** |
| 레인 폭 | 1.05 m | `LANE_WIDTH = 1.05` |
| 공 지름 (무게 무관 고정) | 21.8 cm | `BALL_RADIUS = 0.109` |
| 핀 높이 | 38 cm | `PIN_HEIGHT = 0.38` |
| 핀 무게 | ~1.5 kg | `PIN_MASS = 1.5` |
| 핀 간격 (중심거리) | 30.48 cm | `PIN_SPACING = 0.3048` |

> 공 무게는 고정값이 아니라 선택형 → §4.5 볼 무게 시스템. 지름은 무게와 무관하게 항상 동일(실제 USBC 규정과 동일).
> 거터(gutter)는 레인 양옆에 폭 ~0.23m 홈. 공이 빠지면 0점 처리.

### 핀 10개 배치 (정삼각형, 1번핀이 맨 앞)

행 간격 = `PIN_SPACING * cos(30°) ≈ 0.264`, 좌우 간격 = `PIN_SPACING`.
1번핀 `HEADPIN_Z = 18.29`(파울라인→1번핀), 핀덱 끝 `PIN_DECK_END = HEADPIN_Z + 3 * 0.264 ≈ 19.08`(마지막 행 7~10번핀). ← 전환 트리거 기준(§4.2)

```
        7   8   9   10      ← 4번째 행 (z 가장 큼)
          4   5   6         ← 3번째 행
            2   3           ← 2번째 행
              1             ← 1번째 행 (z 가장 작음, 공쪽)
```

핀 좌표 생성 의사코드:
```ts
const rows = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];
rows.forEach((cols, r) => cols.forEach(c => {
  const x = c * PIN_SPACING;
  const z = HEADPIN_Z + r * 0.264;
  spawnPin(x, PIN_HEIGHT/2, z);
}));
```

---

## 4. 물리 설정 (Rapier)

핵심은 "공은 무겁게 잘 구르고, 핀은 가볍게 잘 넘어지고, 레인은 미끄럽게".

| 바디 | 타입 | 콜라이더 | 핵심 파라미터 |
|------|------|----------|----------------|
| 레인 바닥 | fixed | cuboid | friction 낮게, restitution ~0 |
| 공 | dynamic | ball | friction 0.2, restitution 0.1, **CCD on**, angularDamping 낮게 |
| 핀 | dynamic | cylinder(또는 capsule) | 무게중심 살짝 아래, restitution 0.2, ~~**CONTACT_FORCE_EVENTS on**~~ ← 미채택 |
| 벽/거터 | fixed | cuboid | 공/핀 튕김 처리 |

- **고정 timestep** (1/60s) + accumulator: 물리 결정성·안정성. 렌더는 보간.
- 핀 쓰러짐 판정: 핀의 up벡터(로컬 y)와 월드 y의 각도가 **45° 초과**거나, y위치가 임계 이하면 "쓰러짐". (정밀 규칙은 4.3)

> **현재 상태 (2026-09-02).** 실제 값은 [constants.ts](../src/game/constants.ts)가 단일 소스다. 갈린 것:
> - **레인 마찰은 한 값이 아니라 2존**이다 — `LANE_FRICTION_OIL = 0.015`(스키드) / `LANE_FRICTION_DRY = 0.14`(훅).
>   콜라이더엔 OIL을 걸고 `CoefficientCombineRule.Min`을 쓴다([Lane.ts:68](../src/scene/Lane.ts)). 거터는 0.08.
> - **`CONTACT_FORCE_EVENTS`는 켜지 않았다.** 충돌음을 임펄스로 받는 설계를 폐기했다 — 이유는 [SOUND.md §3](SOUND.md).
>   즉 §13 부록 A의 "함정 2"는 **더 이상 우리 문제가 아니다.**
> - 핀은 `PIN_RESTITUTION = 0.3` · `PIN_LINEAR_DAMPING = 0.7`(도안 표에 없던 값).
> - 공은 `BALL_FRICTION = 0.1`(도안 0.2) · `BALL_LINEAR_DAMPING = 0` · `BALL_ANGULAR_DAMPING = 0.1`.

### 4.1 스핀 (훅볼) — 슬립 기반 측면력

볼링공이 휘는 원인은 마그누스가 아니라 **지면 동마찰**. 던진 직후 회전이 노면 속도와 안 맞아 **미끄러지고(slip)**, 회전축이 기울면 마찰이 옆으로 밀어 휜다. 실제 궤적은 3단계: **스키드(미끄럼·거의 직진) → 훅(마찰 물려 급격히 휨) → 롤(회전=전진 일치, 다시 직진)**.

구현 방식 비교:
- **(A) 순수 물리**: 기울인 angvel만 주고 Rapier 마찰에 맡김. 정직하지만 훅이 약하고 튜닝이 어려움 → 비추.
- **(B) 슬립 기반 측면력 주입 (채택)**: 물리 원리대로 측면 마찰력을 매 스텝 직접 계산해 적용. 제어 쉽고 게임답게 휨.

```ts
// 매 물리 스텝 (world.step 직전)
const v = ball.linvel();
const ω = ball.angvel();                                   // 플레이어가 준 스핀
const contactVel = add(v, cross(ω, [0, -BALL_RADIUS, 0])); // 공 바닥 표면속도
const slip = [contactVel.x, 0, contactVel.z];              // 수평 성분 = 미끄럼

if (length(slip) > SLIP_EPS) {
  // ⚠️ REF_MASS(고정) 사용 → 실제 가속도 a=F/m 이 mass에 반비례
  //    → 가벼운 공이 더 많이 휜다 (§4.5 볼 무게와 연동)
  const f = scale(normalize(slip), -FRICTION_K * REF_MASS * 9.81);
  ball.applyImpulse(scale(f, dt), true);   // ⚠️ addForce 아님! 아래 주의 참고
}
// slip → 0 (롤링 시작) 되면 힘 사라지고 직진 → 자연스러운 훅→롤
```

> ⚠️ **검증으로 확정된 구현 디테일** (§13 부록 A): Rapier의 `addForce`는 *지속력*이라 매 스텝 유지된다. 프레임마다 다른 측면력을 주려면 `resetForces()` 후 다시 주거나, 위처럼 **`applyImpulse(F·dt)`(순간충격)** 로 적용하는 게 안전하다.

- **시각적 회전은 angvel로** 실제로 돌려주고(표면 무늬), **궤적 제어는 측면력으로** 하는 하이브리드.
- 플레이어 입력은 스핀량 하나면 충분: `-1`(좌훅) ~ `+1`(우훅) → ω의 기울기를 결정.
- ~~(폴리싱) `FRICTION_K`를 z위치 함수로(앞=낮음/뒤=높음) 만들면 **오일 패턴**까지 흉내 가능.~~
  → **구현됨** ([oil.ts](../src/game/oil.ts)). 마찰값은 constants에 고정이고 **geometry(`endZ`·ramp)만 가변**이다.
  하우스 샷 하나로 정리(39 ft)했고, 프레임마다 `advanceOilDrying`이 endZ를 최대 1.5m 당긴다.
  ⚠️ 광택 시트는 마름을 따라가지 않는다(알려진 불일치 — CLAUDE.md).

### 4.2 공 빠짐 — 거터 & 레인 끝

**거터볼 (양옆 홈)**: 공 중심 x가 레인 폭을 벗어나면 거터.
```ts
if (Math.abs(ballX) > LANE_WIDTH / 2 - BALL_RADIUS) inGutter = true;
```
- *물리*: 레인 양옆에 실제 거터(낮은 홈)+안쪽 낮은 벽 콜라이더 → 공이 핀존까지 못 가 **자동 0핀**.
- *판정*: 동시에 `inGutter` 플래그로 HUD "거터!" 표시 + SETTLING 조기 종료(타임아웃 안 기다림).

**레인 끝 피트 (정상 통과)**: 핀 뒤로 공/핀이 떨어지는 영역. 트리거 존으로만 사용.
```ts
// ⚠️ LANE_LENGTH(=1번핀 18.29)가 아니라 핀덱 끝(PIN_DECK_END≈19.08) 기준!
//    LANE_LENGTH로 하면 뒷줄 핀 치기 전에 SETTLING 신호가 떠버림 (핀존 한가운데)
if (ballZ > PIN_DECK_END + 0.5) { /* 핀존 통과 완료 → SETTLING 신호 */ }
```

**ROLLING → SETTLING 전환 조건** (셋 중 하나):
1. 공이 핀존 통과 (`ballZ > PIN_DECK_END`)
2. 거터 진입 (`inGutter`)
3. 모든 바디 속도 ≈ 0 (어딘가 박혀 멈춤)

> **현재 상태 (2026-09-02) — 문턱이 둘로 갈렸다.** 위 `LANE_WIDTH/2 − BALL_RADIUS`(=0.416)는
> **SETTLING 전환** 문턱이고, "거터볼로 확정"하는 **래치** 문턱은 `LANE_WIDTH/2`(=0.525)로 더 뒤다.
> 그래서 래치를 ROLLING 분기 안에 두면 공이 0.416에서 빠져나간 뒤 0.525를 넘어도 코드가 안 돌아
> **사실상 영영 안 걸렸다** (두 문턱을 한 스텝에 건너뛰려면 횡속 6.5 m/s 필요, 실제 훅은 1~2 m/s대).
> 래치는 상태 분기 **밖**에 있어야 한다(`GameState.latchLaneExit`).
>
> **"공이 핀존까지 못 가 자동 0핀"은 물리로 보장되지 않는다.** 거터를 규격 깊이(`GUTTER_DEPTH` =
> 0.0476, 1.875in)로 낮춘 뒤 골에 앉은 공이 코너 핀(7·10)에 11.6mm 파고든다 — 보장하는 건 래치다.
> 실측(`GUTTER_SIM=1`): 옛 배치 거터볼 60개 중 래치 0회·**무효 핀폴 113핀** → 현재 **0핀**(래치 60/60).
> 배경·가드(`z ≤ PIN_DECK_END`)·perch 보정(`GUTTER_SEAT_Y`)은 CLAUDE.md의 커플링 절에 정리돼 있다.

### 4.3 핀 쓰러짐 정밀 판정 (엣지케이스)

각도 임계 하나로는 흔들리는 핀을 잘못 셀 수 있음. **반드시 SETTLING이 끝난 뒤(모두 정지) 1회 스냅샷으로만 판정**.

| 상황 | 판정 |
|------|------|
| 똑바로 섬 | 기울기 < 45° **그리고** 거의 정지 → 살아있음 |
| 기울어 쓰러짐 | 기울기 ≥ 45° → 쓰러짐 |
| 흔들리다 다시 섬 | SETTLING 끝까지 대기 후 최종 자세로만 판정 (중간 상태 무시) |
| 핀끼리 기댐 | 각도 기준 적용 — 기댄 둘 다 ≥45°면 둘 다 쓰러짐 |
| 레인 밖 튕겨나감 | y가 핀덱 아래로 떨어지거나 핀덱 밖 → 쓰러짐(제거) 처리 |

### 4.4 물리 상수 초기값 (튜닝 시작점)

M1부터 0부터 찍지 않도록 출발 숫자를 고정. 이후 손맛 보며 조정.

| 상수 | 초기값 | 비고 |
|------|--------|------|
| `GRAVITY` | -9.81 | 월드 중력 y |
| `TIMESTEP` | 1/60 | 고정 물리 스텝 |
| `REF_MASS` | 5.0 kg | 스핀 측면력 기준 질량(≈11lb=슬라이더 중앙, 균형). §4.1·4.5 |
| 공 friction / restitution | **0.1** / 0.1 | CCD on. mass는 BallSpec(§4.5). `BALL_FRICTION`은 0.1이다(도안 0.2에서 변경) |
| 공 linear / angular damping | 0 / 0.1 | 선형 감쇠는 2026-09-02 실척도 재매핑에서 0.05 → **0** — 레인 감속은 마찰(슬립)이 다 낸다(constants.BALL_LINEAR_DAMPING 주석) |
| 핀 mass / friction / restitution | 1.5 / 0.3 / 0.2 | 무게중심 약간 아래. 콜라이더 반경 ≥0.06 (얇으면 CCD로도 터널링) |
| 레인 friction / restitution | **0.015~0.14** / 0.0 | 단일값 아님 — 오일 2존(`LANE_FRICTION_OIL`/`_DRY`). 거터는 0.08 |
| `FRICTION_K` (스핀 측면력) | **0.16** | =마찰계수. 현실값 0.04~0.2. 초기 0.1 → 현재 0.16. 드라이 존에서만 작용(hookFactor 게이트) |
| `SLIP_EPS` | 0.05 m/s | 이하면 롤링으로 간주 |
| `MIN_SPEED` / `MAX_SPEED` | 6.5 / 10.5 m/s | 파워 게이지 매핑(무게 보정은 §4.5). 초기 5/12 → 2026-09-02 실척도 재매핑(릴리스 14.5~23.5 mph, 골드 띠가 USBC 최적 21→17 mph에 앉음). 측정 도구 `BALL_SIM=1 npx vitest run tests/ball-motion-sim.test.ts` |
| `SETTLE_VEL_EPS` | 0.05 | 정지 판정 속도 |
| `SETTLE_TIMEOUT` | 4 s | 무한대기 방지 |
| `POST_BALL_HOLD` | 0.7 s | 공이 사라진(피트 착지·정지) 뒤 프레임을 닫기까지의 최소 홀드. 거터·빗나감은 정착 조건이 즉시 참이라 공이 시야에서 사라지는 순간 닫혔다(0.07 s) → 한 박자(2026-09-03, [SOUND.md §2.10](SOUND.md)). 타임아웃은 이 홀드를 못 잘라먹는다 |
| `PIN_FALL_ANGLE` | 45° | 쓰러짐 각도 임계 |
| ~~`CONTACT_FORCE_THRESHOLD`~~ | — | **상수 자체가 없다.** contact force 방식 폐기 → [SOUND.md §3](SOUND.md) |
| `HEADPIN_Z` / `PIN_DECK_END` | 18.29 / 19.08 | 1번핀 / 핀덱 끝 z. 전환 트리거 기준(§3·§4.2) |
| `maxCcdSubsteps` | 1 (모바일 2~4) | CCD 정밀도. 저FPS(모바일 30) 충돌 누락 보완(§12) |

> **현재 상태 — 도안 표에 없는 상수들.** 아래는 도안 이후 생겼고 전부 [constants.ts](../src/game/constants.ts)에 있다.
> `SPIN_RATE`(14) · `SPIN_POW`(0.7) · `ROLL_RATIO`(0.85) — 발사 회전/구름 비율.
> `AIM_RANGE`(0.08) · `AIM_GAIN`(1.0) — 조준 범위·터치 게인(MOBILE_SUPPORT §2.4).
> `RELEASE_SWEET_LO/HI`(0.6/0.9) · `RELEASE_SIGMA_MIN/MAX`(0/6cm) · `RELEASE_TOL`(0.3) — **릴리스
> 정확도 노이즈**(§8). `SLOWMO_SCALE`(0.32) · `SLOWMO_REAL_SEC`(0.45) · `PUSHIN_*` — 카메라 연출(§9).
> `PIN_CONTACT_Z` · `KICKBACK_START_Z` · `PIN_BAY_*` — 핀덱 지오메트리·카메라 커플링(CLAUDE.md).
>
> ⚠️ `TIMESTEP`의 실제 이름은 [Loop.ts](../src/core/Loop.ts)의 `FIXED_DT`이고 **그게 단일 소스**다.
> ⚠️ 물리·AI에 닿는 값은 눈으로 A/B 하지 말고 sim으로 잴 것 — `BALL_SIM` · `AI_CAL` · `AI_SIM` 게이트.

### 4.5 볼 무게 시스템 (6~16 lb 다이나믹)

실제 볼링공은 **지름이 모두 같고(USBC: 둘레 27인치 고정) 무게만 6~16 lb** 다르다. 게임도 **`BALL_RADIUS` 고정, 무게만 6~16 lb를 슬라이더로 무단계 선택**. 무게 하나가 아래 4가지를 연속으로 바꾼다. (질량은 `ColliderDesc.setMassProperties` 또는 `setDensity`로 주입)

정규화 `t = (lb − 6) / (16 − 6) ∈ [0,1]`, 질량 `massKg = lb × 0.45359`.

| 영향 | 공식/방식 | 효과 |
|------|-----------|------|
| 질량(파괴력) | `massKg → setMassProperties` | 무거울수록 운동량 `mv`↑ → 파괴력↑·deflection↓ **(Rapier 자동)** |
| 훅(휨) | 측면력 고정 `REF_MASS` → `a=F/m ∝ 1/mass` | 가벼울수록 더 휨 **(자동, §4.1)** |
| 컨트롤(속도) | `maxSpeedScale = lerp(1.0, 0.82, t)` | 무거울수록 도달속도↓ → "묵직함" |
| 색(연출) | 무게별 하우스 볼 테이블 `houseBallColor(lb)` (6 핑크 … 10 터쿼이즈 … 14 브릭 … 16 블랙) | 실제 공용 공처럼 무게=색. 2026-09-02, 전엔 2점 lerp |

대표값 감각:
| 무게 | 느낌 | 대상 |
|------|------|------|
| **6 lb** | 최경량 — 가장 잘 휨, 핀 잘 튕김(split↑), 빠름 | 곡선·입문 |
| **10 lb** | 밸런스 | 무난 |
| **13 lb** | 표준 성인 | 일반 |
| **16 lb** | 최중량 — 거의 직진, 포켓 관통, 묵직 | 파워·프로 |

데이터(프리셋 배열 대신 **함수로 생성** → 무단계 지원):
```ts
function makeBallSpec(pounds: number): BallSpec {   // pounds ∈ [6, 16]
  const t = (pounds - 6) / 10;
  return {
    label: `${pounds} lb`,
    massKg: pounds * 0.45359,
    maxSpeedScale: lerp(1.0, 0.82, t),
    color: lerpColor(COLOR_LIGHT, COLOR_DARK, t),
  };
}
// UI: 슬라이더 6~16 lb, step 0.5, 기본값 10
```

> 주의: 핀-공 무게차가 클수록(16lb vs 1.5kg 핀) 솔버가 흔들릴 수 있음 → CCD·작은 timestep으로 안정화(§12·§13).

### 4.6 Sleeping & wakeUp (검증: 외부 사례 + Rapier 문서)

Rapier는 **느리게 움직이는 바디를 몇 초 후 자동 sleeping** 처리해 시뮬에서 제외(성능). 다른 바디가 충돌하면 자동으로 깨어난다. **하지만 직접 주는 힘·임펄스·속도는 sleeping 바디에 안 먹히므로 `wakeUp=true`가 필수** (Rapier 문서: *"Forces and impulses require awakening bodies to take effect"*).

- **스핀 측면력**: `applyImpulse(impulse, true)` — §4.1 코드 두 번째 인자 `true`가 바로 이것(wakeUp).
- **공 발사**: 대기 중 sleeping 든 공에 `setLinvel`/`applyImpulse` 줄 때 깨우기.
- **SETTLING에 역이용**: 핀이 sleeping = 확실히 정지 → `rigidBody.isSleeping()`을 정지 판정에 쓰면 속도 임계보다 깔끔(`SETTLE_TIMEOUT`과 병행).
- `canSleep`은 기본(true) 유지 — 성능 이득. 굴러가는 공에 힘 적용할 때만 wakeUp 주의.

---

## 5. 부팅 & 렌더링 인프라

### 5.1 부팅 시퀀스 (Boot.ts)

```
1. (rapier3d-compat는 자동 / 일반 rapier3d면 await RAPIER.init())
2. three 렌더러·씬·카메라 생성, 조명·그림자 셋업
3. 에셋(지오메트리·머티리얼) 생성 → 레인·핀·공 스폰, 사운드 프리로드
4. 첫 프레임 렌더 → DOM 로딩 오버레이 제거
5. MENU 상태로 진입
```
> **현재 상태.** 로더는 "Loading…" 텍스트가 아니라 **핀 랙 세팅 → 공이 굴러와 스트라이크** 연출이다
> ([index.html](../index.html) 인라인 — 단일 청크 2.9MB 로딩 시간을 이 연출이 덮는다). 'IT UP'이 밀려나고
> 'STRIKE●'만 남으면 부팅 완료. **사운드는 프리로드가 아니라** 첫 user gesture 뒤 지연 디코드다([SOUND.md §1](SOUND.md)).
> 로더의 TAP이 그 gesture 역할을 겸한다.

### 5.2 렌더링 인프라 (Engine.ts)

- **렌더러**: `WebGLRenderer({ antialias: true })`, `setPixelRatio(Math.min(devicePixelRatio, 2))` (레티나 과부하 방지).
- **컬러/톤매핑**: `ACESFilmicToneMapping` + sRGB 출력 → 어둡게 안 보이는 문제 방지.
- **조명**: `AmbientLight`(은은한 전체) + `DirectionalLight`(레인 위에서, 그림자 캐스터).
- **그림자**: directional `castShadow`, 공·핀 `castShadow`, 레인 `receiveShadow`. shadowMap 해상도는 옵션화(저사양 대비).
- **리사이즈**: window `resize` → `camera.aspect` 갱신 + `updateProjectionMatrix()` + `renderer.setSize()` (debounce).
- **배경/분위기**: 초기엔 단색 + `Fog`로 깊이감. 볼링장 배경은 폴리싱(M7).

### 5.3 에셋 파이프라인 (AssetFactory)

> **현재 상태 — `AssetFactory.ts`는 만들어지지 않았고 2차(GLTF) 단계에 도달하지 않았다.**
> 1차 procedural에 머물러 있고, 그게 결과적으로 이 게임의 정체성이 됐다(README "에셋 없이 코드로만").
> `GLTFLoader`·`TextureLoader` 사용 **0건** — 텍스처도 파일이 아니라 캔버스로 그린다.
> 각 씬 객체가 자기 지오메트리를 직접 만든다([Ball.ts](../src/scene/Ball.ts)·[Pin.ts](../src/scene/Pin.ts)·
> [Lane.ts](../src/scene/Lane.ts)·[Environment.ts](../src/scene/Environment.ts)). 핀 실루엣은 `PIN_PROFILE`
> (constants) 회전체다. **외부 에셋은 사운드 셋뿐**([SOUND.md §6](SOUND.md)).
> 아래 "단계적 교체" 전략은 그래서 *미실행 계획*으로 남는다 — 다만 🔑 철칙(시각 메시 ≠ 콜라이더)은 유효하다.

3D 볼링이므로 핀·공·레인은 3D 지오메트리, UI·표면은 2D 텍스처. **단계적 교체** 전략:

- **1차 (M0~M6): procedural 코드 도형** — 에셋 파일 0개.
  - 공 = `SphereGeometry`(반지름 `BALL_RADIUS` 고정), 표면 텍스처로 회전 가시화.
  - 핀 = `LatheGeometry`(병 실루엣 프로파일 회전) 또는 `CapsuleGeometry` 근사.
  - 레인/거터 = `BoxGeometry` + 나무결 텍스처(2D).
- **2차 (M7): GLTF 3D 모델** — `GLTFLoader`로 시각 메시만 교체. 무료 모델(라이선스 확인) 또는 Blender 제작. 필요 시 DRACO/KTX2 압축.
- **🔑 철칙: 시각 메시 ≠ 콜라이더.** 핀 모델이 정교해도 물리 콜라이더는 단순 cylinder/capsule 유지 → 성능·안정성·터널링이 여기서 갈림. `AssetFactory`가 이 교체점을 캡슐화(로직은 콜라이더만, 외형은 자유).
- **텍스처(2D)**: 공 무늬, 레인 나무결, 핀 줄무늬, 배경/스카이박스. `TextureLoader`로 로드, 부팅 때 프리로드.

### 5.4 배경 & 환경 (볼링장 분위기)

> **현재 상태 — `.hdr` 파일은 쓰지 않는다.** three 내장 `RoomEnvironment`를 `PMREMGenerator.fromScene`으로
> 구워 `scene.environment`에 넣고 `environmentIntensity = 0.4`로 눌렀다([Engine.ts:99](../src/core/Engine.ts))
> — 반사·앰비언트는 얻고 에셋 0은 지켰다. `RGBELoader` 사용 0건. `Fog(0x101018, 24, 60)`도 함께 쓴다
> (배경 벽 z≈21은 또렷, 그 너머만 페이드). 볼링장 인테리어는 3D 메시로 **구현됐고**
> ([Environment.ts](../src/scene/Environment.ts)) 전광판은 신스웨이브 → **미드센추리 마스킹 유닛**으로 바뀌었다.
> 즉 아래 3단계 중 1·3은 갔고 2(HDRI)는 건너뛰었다.

실내 볼링장이라 **HDRI environment map**이 최적 — 배경 이미지 + 조명·반사를 동시에 준다.
- 로드: `RGBELoader`로 `.hdr` → `PMREMGenerator.fromEquirectangular` → `scene.environment`(반사·앰비언트 조명) + `scene.background`(보이는 배경).
- **단계적 적용**:
  1. (M0~M6) 단색 + `Fog`(§5.2) — 가장 가벼움.
  2. (M7) 실내 HDRI environment — 분위기·조명 한 방에.
  3. (M7+) 3D 인테리어 메시 — 거터 너머 벽, 핀 뒤 백월·핀세터, 천장·모니터.
- **⚠️ 카메라 이동 주의 (검색 확인)**: 볼링은 카메라가 레인 따라 z로 ~18m 이동 → 작은 skybox 큐브/돔은 "안에 있는 게" 티남. HDRI는 무한 원경처럼 처리돼 이동에 강함 → **큐브맵보다 HDRI 권장**. 3D 룸을 쓸 땐 충분히 크게.
- 볼링장 전용 HDRI는 드묾 → 일반 실내/창고 HDRI + 레인 주변 디테일 메시로 "볼링장처럼" 연출.

---

## 6. 게임 상태머신

바깥 루프(앱 흐름)와 안쪽 루프(투구 1회)로 구성.

```
BOOT ──▶ MENU ──(Start)──▶ PLAYING ──(10프레임 종료)──▶ GAME_OVER ──(Restart)──┐
 부팅     시작화면            │  투구 루프(아래)                  최종점수/재시작   │
 +볼선택                      └────────────────────────────────────────────────┘
```

**PLAYING 내부 (투구 1회 루프):**
```
   ┌─────────┐  마우스 드래그로 조준·파워·스핀 결정
   │ AIMING  │
   └────┬────┘  릴리스(클릭 뗌). 파울라인 넘으면 foul 플래그
        ▼
   ┌─────────┐  공 발사, 물리 시뮬레이션
   │ ROLLING │
   └────┬────┘  4.2의 전환 조건(핀존 통과/거터/정지)
        ▼
   ┌──────────┐ 모든 바디 속도 ≈ 0 (또는 SETTLE_TIMEOUT)
   │ SETTLING │
   └────┬─────┘
        ▼
   ┌─────────┐  4.3 정밀 판정으로 쓰러진 핀 카운트 → Frame 기록 → 점수 갱신
   │ SCORING │
   └────┬────┘
        ├─ 프레임 안 끝남(2구째) → CLEAR_DEADWOOD → AIMING
        ├─ 프레임 끝남(스트라이크/2구 완료) → BETWEEN_FRAMES → AIMING
        └─ 10프레임 종료 → GAME_OVER
```

**CLEAR_DEADWOOD** (P0 핵심): 2구 전에 **1구에서 쓰러진 핀을 레인에서 제거**하고, **선 핀은 위치 그대로 유지**, 공만 시작 위치로 리셋. 이걸 안 하면 2구가 쓰러진 핀에 막히거나 다시 쳐서 판정이 깨짐.

**BETWEEN_FRAMES**: 프레임 종료 시 핀 10개 전체 리셋 + 짧은 전환 연출 후 다음 프레임 AIMING.

**MENU / GAME_OVER**: DOM 메뉴(Menu.ts)로 Start/Restart 버튼 제공. MENU에서 볼 무게 선택(메뉴 무게 슬라이더). GAME_OVER는 최종 점수·프레임별 점수 표시.

> **현재 상태 — 상태는 5개다.** `BOOT`·`PLAYING`·`SCORING`·`CLEAR_DEADWOOD`·`BETWEEN_FRAMES`는
> **만들어지지 않았다.** 실제 유니온([GameState.ts:33](../src/game/GameState.ts)):
>
> ```ts
> type GameStateName = 'MENU' | 'AIMING' | 'ROLLING' | 'SETTLING' | 'GAME_OVER';
> ```
>
> ```
> MENU ──startMatch──▶ AIMING ──throwBall──▶ ROLLING ──핀존통과/거터/정지──▶ SETTLING
>                         ▲                                                    │ 모두 정지
>                         └── 다음 투구/프레임/플레이어 교대 ◀── score() ──▶ GAME_OVER
> ```
>
> 도안이 상태로 뺐던 것들은 **함수·연출로 흡수됐다** — 채점은 `score()`, 데드우드 제거와 랙 리셋은
> `PinSet.runCycle()`(§5 핀세터 4.05초 시퀀스)이 담당한다. ⚠️ 핀세터 사이클은 예전엔 조준과 겹쳐 돌아
> 레이크가 데드우드를 밀는 중에 다음 공을 던질 수 있었다 — 지금은 `throwBall`이 `finishCycle()`로 확정한다.
>
> **도안에 없는 축 3개가 추가됐다:**
> - **모드** — `GameMode = 'full' | 'blitz' | 'spare'` (스페어 챌린지는 `SPARE_LEAVES` 10코스)
> - **멀티플레이어** — 점수 상태는 플레이어별, 물리 객체(PinSet/Ball)는 공유
> - **AI 라이벌** — 사다리 3인([ai.ts](../src/game/ai.ts)), `AI_THINK_TIME` 후 자동 투구 + 턴 빨리감기
>
> 이벤트는 `GameEvent` 5종(`strike`/`spare`/`gutter`/`splitConverted`/`gameOver`)으로 나간다.
> `split`(발생)·`turn`(차례 교대)은 **일부러 없다** — 소비처가 없었다(GameState.ts 주석).

---

## 7. 점수 계산 (정식 10프레임 룰)

```
프레임 1~9: 각 2구. 10핀 다 쓰러뜨리면 프레임 종료.
  - 스트라이크(1구 10핀): 10 + 다음 2구 합
  - 스페어(2구 합 10핀): 10 + 다음 1구
  - 오픈(미만): 쓰러뜨린 핀 합
프레임 10: 스트라이크/스페어 시 보너스 투구 → 최대 3구.
파울(foul): 파울라인 밟거나 넘어 릴리스 → 그 투구 0핀('F' 표기). 옵션으로 on/off.
```

데이터 구조:
```ts
interface Roll { pins: number; foul?: boolean; }
interface Frame { rolls: Roll[]; }
// 누적 점수는 Scoreboard가 전체 frames 보고 매번 재계산 (단순·버그 적음)
function totalScore(frames: Frame[]): number[] { /* 프레임별 누적 반환 */ }
```

> 핵심 원칙: **점수는 저장하지 말고 매번 rolls에서 재계산.** 보너스 룩어헤드가 단순해짐. ← 유효

> **현재 상태 — 파울(foul)은 구현되지 않았다.** `Roll.foul` 필드도, 'F' 표기도, on/off 옵션도 없다
> ([Scoreboard.ts](../src/game/Scoreboard.ts)). 파울라인은 **시각 메시로만** 존재한다
> ([Environment.ts:843](../src/scene/Environment.ts)). 그래서 §7.1 표의 "파울 포함" 케이스와 §12의
> 파울 관련 메모도 미실행이다.
>
> 파울 대신 들어간 것이 **릴리스 정확도 노이즈**다(§8) — 파워 게이지의 골드 띠(`RELEASE_SWEET_LO/HI`)
> 밖에서 릴리스하면 조준에 σ만큼 오차가 붙는다. 실수를 0점으로 벌하는 대신 정확도로 벌한다.
>
> 점수 쪽에 도안 이후 추가된 것: `RollStats`(스트라이크/스페어 기회·성공 집계)와
> [Stats.ts](../src/game/Stats.ts)(localStorage 누적 — §12 P2 항목).

### 7.1 점수 로직 테스트 전략 (Vitest)

`Scoreboard`는 입력(rolls)→출력(점수) 순수함수라 단위테스트 최적. 손으로 검증 어려운 보너스 룩어헤드를 자동 검증.

> **현재 상태 — 테스트는 4층 23파일로 커졌다.** 어디에 새 테스트를 넣을지는 CLAUDE.md가 단일 소스다.
>
> | 층 | 내용 |
> |---|---|
> | `tests/unit/` | 순수함수 — scoreboard · splits · rewards · slowmo |
> | `tests/scenarios/` | **기본값.** 가짜 씬으로 GameState를 끝까지 굴리는 E2E 8파일 (frame-flow · full-game · multiplayer · modes · gutter-and-settle · split · feedback · persistence) |
> | `tests/sim/` | 실물리 측정 (Rapier) — 대부분 env 게이트(`BALL_SIM`·`AI_CAL`·`AI_SIM`·`GUTTER_SIM`). `predict.test.ts`는 항상 실행 |
> | `tests/geometry/` | 씬 상수 커플링 회귀 — camera-sightline · pindeck-layout |
> | `tests/helpers/` | headless.ts(Rapier) · fakeScene.ts(가짜 씬) · laneWorld.ts(거터 포함 실지오메트리) |
>
> 현재 **151 passed / 7 skipped**(게이트된 sim은 기본 skip이 정상). 파울 케이스는 §7대로 미구현이라 없다.
> ⚠️ `SoundManager`를 참조하는 테스트는 **없다** — 오디오 검증은 [SOUND.md §7](SOUND.md).

표준 테스트 케이스:
| 케이스 | rolls | 기대 총점 |
|--------|-------|-----------|
| 올 거터 | 0×20 | 0 |
| 올 스트라이크(퍼펙트) | 12스트라이크 | 300 |
| 올 스페어 + 5 | (5,5)×10 + 5 | 150 |
| 올 9핀(오픈) | (9,0)×10 | 90 |
| 마지막 프레임 스페어 보너스 | … (5,5),(5) | +5 반영 |
| 파울 포함 | (F,7)… | F=0 처리 |

---

## 8. 조작 (Controls)

입력은 **포인터(마우스+터치) + 키보드 보조**를 한 추상 인터페이스로 통합.

```ts
interface ThrowInput {
  aim: number;     // 발사 각도 (x 성분, -1~+1)
  power: number;   // 0~1 → MIN_SPEED~MAX_SPEED (볼 무게로 maxSpeedScale 보정)
  spin: number;    // -1(좌훅)~+1(우훅)
  release(): void; // 발사 트리거
}
```

- **포인터**: `pointerdown/move/up`으로 마우스·터치 동시 지원.
  - 좌우 드래그 → `aim`, 끌어당긴 거리 → `power`(게이지 표시), 릴리스 직전 좌우 플릭 → `spin`.
- **키보드(보조)**: ←→ 조준, ↑↓/스페이스 홀드로 파워, 릴리스.
- 디바이스별 raw 이벤트 → 위 추상 입력으로 매핑. 게임 로직은 추상 입력만 봄.

> **현재 상태.** `Throw.ts`는 **만들어지지 않았다** — 발사 변환은 `GameState.throwBall()`에 있고,
> 조준선 예측은 별도 적분기 [predict.ts](../src/game/predict.ts)로 분리해 Rapier와 테스트로 대조한다.
> 도안과 갈린 조작 3가지:
> - **파워는 드래그 거리가 아니라 '핑퐁 게이지'다** — 누르면 게이지가 오르내리고(`chargeDir`) 떼는
>   순간의 값이 파워다. 그래서 **릴리스 타이밍이 스킬**이 된다.
> - **릴리스 정확도 노이즈** — 골드 띠(`RELEASE_SWEET_LO/HI` = 0.6~0.9) 안에서 떼면 σ=0(완벽 정확,
>   300점 가능). 밖이면 `RELEASE_TOL`(0.3) 거리에서 σ_MAX=6cm까지 조준에 오차가 붙는다.
>   꼭대기 1.0은 직진 과속이라 **일부러 띠 밖**이다.
> - **스핀은 Q/E 키가 아니라 마우스 휠**이다(하단 바는 정밀 확인용 트랜지언트). 게이트가 "터치냐"가
>   아니라 **"휠이 있냐"** 로 바뀌었다 — 휠 없는 마우스에선 스핀 입력이 아예 없던 버그 때문.
>   터치는 하단 드래그 바 + 상대 조준 anchor(MOBILE_SUPPORT §2).
>
> 조준 난이도 설정은 **폐기**됐고 예측선 길이가 '보통과 어려움 사이'로 고정됐다.

발사 변환(Throw.ts):
```ts
const speed = (MIN_SPEED + power * (MAX_SPEED - MIN_SPEED)) * ballSpec.maxSpeedScale;
const dir = normalize([aim, 0, 1]);     // 주로 +z, aim만큼 횡방향
ball.setLinvel(scale(dir, speed));
ball.setAngvel(spinToAngvel(spin));      // 4.1 스핀
```

---

## 9. 카메라 연출 (CameraRig)

- **AIMING**: 공 뒤 살짝 위, 레인을 내려다보는 3인칭.
- **ROLLING**: 공을 부드럽게 추적(lerp), 핀 가까워지면 핀존으로 시선 이동.
- **SCORING**: 핀 클로즈업 줌, 스트라이크면 짧은 연출.
- 구현: 상태별 목표 위치/타겟을 정하고 `position.lerp`, `lookAt` 보간.

> **현재 상태 — 이 절이 가장 많이 자랐다.** `SCORING` 상태가 없으므로(§6) 카메라도 다르게 배선됐다.
> 값의 커플링은 CLAUDE.md의 "서로를 모르는 채 커플링된 상수들"이 단일 소스다 — **여기 값을 손대기 전에
> 반드시 그쪽을 볼 것.** 핵심만:
> - **릴리스 팔로우는 상수가 아니라 임팩트 포즈에서 유도된다.** `approachZFor(fov, aspect)`가 파킹 z를
>   정하고 체이스 거리는 `HEADPIN_Z − 그 값`이다. 파킹은 별도 목적지가 아니라 **클램프 상한**이다.
>   높이도 하나뿐 — `APPROACH_POS.y`가 곧 팔로우 높이. ⚠️ 위치 블렌드·dolly 속도 상한을 **다시 넣지 말 것**
>   (서지의 원인이었다).
> - ⚠️ **세로폰은 가로 화각이 좁아 더 물러난다** — 실측 임팩트 간격 데스크톱 1.44m vs 세로폰 3.13m.
>   "데스크톱에서 좋아 보이는 값"이 모바일에서 반대로 동작할 수 있다.
> - **핀 베이 개구부 ↔ 카메라 포즈**가 얽혀 있어 시선이 개구부 앞모서리를 넘으면 핀이 잘린다.
>   [tests/geometry/camera-sightline.test.ts](../tests/geometry/camera-sightline.test.ts)가 이 커플링을 붙잡는다.
> - **푸시인**(`PUSHIN_*`) — 임팩트 시 핀덱으로 살짝 lean-in(방송 카메라 느낌).
> - **슬로모**(`SLOWMO_SCALE` 0.32, 투구당 1회) — `Loop.timeScale`로 유입 시간만 스케일한다.
>   ⚠️ **물리 dt는 절대 스케일하지 않는다**(결정성).
> - **리플레이**([Replay.ts](../src/scene/Replay.ts)) — 스트라이크면 짧은 리플레이 → 프리즈에 스틸컷 슬램.
>   리플레이 카메라 높이는 라이브와 같다(`REPLAY_CAM_Y = APPROACH_POS.y`). ⚠️ 높이만 낮추면 **반대로 나빠진다**
>   — 점유율을 지배하는 건 높이가 아니라 피치라, `REPLAY_LOOK_Y_OFF`와 함께 내려야 한다.

---

## 10. 사운드 (SoundManager)

> ⚠️ **이 절은 설계 의도이고 구현과 대부분 갈렸다 — 현재 상태는 [SOUND.md](SOUND.md)가 단일 소스다.**
> 갈린 것: howler.js 미채택 · `CONTACT_FORCE_EVENTS` 미채택(임팩트는 **투구당 1회**, 세기는 서 있던
> 핀 수로) · 핀-핀 딸각 없음 · 프리로드 아니라 지연 디코드 · 보이스 풀링 불필요(폭주 자체가 없음) ·
> 메뉴 BGM은 합성 칩튠 → **mp3 트랙**(2026-09-02). 대조표는 [SOUND.md §3](SOUND.md).
> **아래 "이벤트별 음원" 표(어떤 이벤트에 소리가 필요한가)는 여전히 유효**하고, 대부분 미구현이다 —
> 백로그는 [SOUND.md §5](SOUND.md).

볼링은 **타격감의 절반이 소리**. 충돌음은 물리 임펄스 크기에 연동.

- **라이브러리**: howler.js (프리로드·동시재생·볼륨 간편) 또는 Web Audio 직접.
- **충돌음 세기 받기 (검증 완료, §13)**: 핀·공 콜라이더에 `setActiveEvents(ActiveEvents.CONTACT_FORCE_EVENTS)`를 켜고, `world.step(eventQueue)` 후 `eventQueue.drainContactForceEvents(e => …)`에서 `e.totalForceMagnitude()`로 충돌 세기를 읽어 볼륨·피치에 매핑. **이 옵트인을 안 하면 충돌음이 통째로 안 나옴.**
- **이벤트별 음원**:
  | 이벤트 | 트리거 | 비고 |
  |--------|--------|------|
  | 공 릴리스/굴림 | 발사 | 굴러가는 루프음, 속도에 볼륨 |
  | 공-핀 충돌 | contact force event | 충돌 임펄스로 볼륨·피치 |
  | 핀-핀 충돌 | contact force event | 가벼운 딸각 |
  | 스트라이크 | 10핀 전부 | 환호/효과음 |
  | 거터 | inGutter | 허무한 굴림음 |
  | UI | 버튼 클릭 | 메뉴 피드백 |
- 부팅 때 프리로드. 음소거 토글 제공. 다중 충돌 폭주 방지: 최소 간격/보이스 풀링(§12).

---

## 11. 개발 마일스톤 (이 순서로 커밋)

- [x] **M0 셋업+인프라**: Vite+TS+three+rapier, 부팅 시퀀스, 조명/그림자/리사이즈, procedural 도형, 빈 씬에 큐브 낙하 확인
- [x] **M1 레인+공**: 레인·거터·벽, 공 1개 굴리기(임시 키보드 발사), 볼 무게→mass 주입, 물리 상수 1차 튜닝
- [x] **M2 핀**: 핀 10개 배치, 충돌·4.3 정밀 쓰러짐 판정
- [x] **M3 게임 흐름**: 상태머신(MENU→PLAYING→GAME_OVER), 데드우드 제거, 프레임 진행, 핀 리셋
- [x] **M4 점수**: Scoreboard 10프레임+스트라이크/스페어/파울, **Vitest 테스트**, HUD 표시
- [x] **M5 조작+볼선택**: 포인터+키보드 추상화, 조준선, 파워 게이지, 스핀, BallPicker 슬라이더(6~16 lb)
- [x] **M6 카메라**: 상태별 카메라 연출
- [~] **M7 폴리싱**: 사운드(contact force), GLTF 모델·텍스처, 오일 패턴 스핀, 모바일 터치, 배경/조명, 하이스코어(P2)

> M0~M2 = 프로토타입(검증), M3~M4 = 게임다움, M5~M7 = 재미·완성도.

> **현재 상태 (2026-09-02) — M0~M6 완료, M7만 부분.** M7 세부:
> ✅ 사운드(방식은 도안과 다름 — [SOUND.md](SOUND.md)) · ✅ 오일 패턴(`oil.ts`) · ✅ 모바일 터치
> ([MOBILE_SUPPORT.md](MOBILE_SUPPORT.md) M0·M1 완료) · ✅ 배경/조명(procedural) · ✅ 하이스코어(§12)
> · ❌ **GLTF 모델·텍스처** — 미도달이고, procedural이 게임 정체성이 되면서 사실상 폐기됐다(§5.3).
>
> 도안에 아예 없던 것도 완성됐다: **i18n 4개 언어**(자체 소형 레이어, ko 원본 + tsc가 누락 검출) ·
> **AI 라이벌 사다리** · **모드 3종** · **보상/스킨 해금** · **리플레이·스틸컷 연출** · **Tauri 패키징**.

---

## 12. 리스크 & 메모

- **Rapier WASM 로딩**: `rapier3d-compat`로 비동기 init 회피. 안 되면 `await RAPIER.init()`.
- **`addForce` 지속력 함정**: 매 스텝 유지됨 → `applyImpulse(F·dt)` 또는 `resetForces()` 병행(§4.1, §13).
- **터널링(공이 핀 통과)**: 빠른 공+얇은 핀. 공 CCD on + timestep 작게.
- **무게 차로 솔버 불안정**: 16lb 공 vs 1.5kg 핀. CCD·작은 timestep·적절 restitution으로 안정화.
- **SETTLING 무한대기**: 핀 미세 진동으로 안 멈춤 → 속도 임계 + 타임아웃(4s) 병행.
- **데드우드 제거 타이밍**: 반드시 SETTLING·SCORING 완료 후 제거. 너무 일찍 치우면 굴러오던 핀까지 사라짐.
- **핀 판정은 정지 후 1회만**: 흔들리는 중 판정 금지(4.3).
- ~~**contact force event 옵트인 필수**: 안 켜면 사운드 무음(§10, §13).~~ ← **무효.** 그 설계를 폐기해
  옵트인 자체가 필요 없다([SOUND.md §3](SOUND.md)).
- **Sleeping 바디엔 힘 안 먹힘**: 스핀 측면력·발사는 `wakeUp=true` 필수(§4.6). 실제 사례에서 흔한 함정.
- **모바일 30FPS 다운그레이드**: 모바일 브라우저가 rAF를 30FPS로 떨궈 충돌 놓침 → `maxCcdSubsteps` 상향(2~4)으로 보완(외부 사례 확인).
- **성능**: 핀10+공1은 가벼움. 그림자·AA·shadowMap 해상도가 더 부담 → 옵션화.
- ~~**사운드 동시재생**: 핀 다중 충돌 시 같은 음 폭주 → 최소 간격/풀링으로 제한.~~ ← **무효.**
  임팩트가 투구당 1회라 폭주가 발생하지 않는다.
- 초기엔 3D 모델 없이 **코드 도형**으로 시작(§5.3). 비주얼은 M7.

### P2 (이번 범위 밖, 나중에)
하이스코어·통계(localStorage) · 스플릿 감지/표시 · 일시정지·설정 메뉴 · 그래픽 품질 옵션 · 접근성(키보드 전용 플레이)

> **현재 상태 — "범위 밖" 목록이 거의 다 구현됐다.**
>
> | P2 항목 | 상태 |
> |---|---|
> | 하이스코어·통계(localStorage) | ✅ [Stats.ts](../src/game/Stats.ts) |
> | 스플릿 감지/표시 | ✅ [splits.ts](../src/game/splits.ts) — 단 **'발생' 배너는 일부러 걷었다**(부정 피드백). 성공만 연출 |
> | 일시정지·설정 메뉴 | ✅ [settings.ts](../src/game/settings.ts) + Menu (사운드·햅틱·품질·언어·볼 무게 영속) |
> | 그래픽 품질 옵션 | ✅ `quality: 'high' \| ...` — 단 **antialias는 항상 ON**이고 `pixelRatio`만 적응한다([Engine.ts](../src/core/Engine.ts), MOBILE_SUPPORT §6) |
> | 접근성(키보드 전용) | ⚠️ 부분 — 키보드 조작은 있으나 전용 플레이로 검증되지 않았다 |
>
> P2에 없었는데 들어온 것: **보상·스킨 해금**([rewards.ts](../src/game/rewards.ts)) · **전광판 꾸미기**
> ([screenStore.ts](../src/game/screenStore.ts)) · **i18n 4개 언어**.

---

## 13. 부록 A — 구현 가능성 검증 (Rapier 공식 문서 대조)

도안의 핵심 물리 가정을 Rapier 3D JS 공식 문서로 1:1 검증한 결과. **전부 실재하는 API.**

| 도안 가정 | 실제 API | 비고 |
|-----------|----------|------|
| 스핀 측면력(매 스텝 힘) | `RigidBody.addForce` / `addForceAtPoint` | ⚠️ 지속력 → `applyImpulse(F·dt)` 또는 `resetForces()` 권장 |
| 발사 속도·회전 | `setLinvel` / `setAngvel` (Desc & Body) | OK |
| 터널링 방지 | `RigidBodyDesc.setCcdEnabled(true)` | OK |
| 충돌음 세기 | `EventQueue.drainContactForceEvents` → `TempContactForceEvent.totalForceMagnitude()` / `maxForceMagnitude()` | ⚠️ **미채택** — 검증은 유효하나 이 경로를 쓰지 않는다([SOUND.md §3](SOUND.md)) |
| 볼 무게 | `ColliderDesc.setMassProperties(mass, com, inertia, frame)` 또는 `Collider.setDensity` | OK — 지름 고정, mass만 변경 |
| 정지 판정 | `RigidBody.linvel()` / `angvel()` / `isSleeping()` | OK — sleeping을 정지 판정에 활용(§4.6) |
| 힘·임펄스 적용 | `applyImpulse(imp, wakeUp)` / `addForce(f, wakeUp)` | ⚠️ sleeping 바디엔 `wakeUp=true` 필수(§4.6) |
| CCD 정밀도 | `IntegrationParameters.maxCcdSubsteps` (기본 1) | 모바일·고속 시 상향 |

**검증으로 드러난 3대 함정 (구현 시 반드시 반영):**
1. `addForce`는 한 번 주면 매 스텝 유지 → 프레임별 가변 힘은 `applyImpulse(F·dt)`로.
2. ~~contact force 이벤트는 기본 OFF → 콜라이더에서 명시적으로 켜야 사운드 가능.~~
   ← **우리에겐 무효.** API 검증 자체는 맞지만 그 설계를 폐기했다([SOUND.md §3](SOUND.md)).
3. 순수 쿨롱 마찰은 휨이 질량 무관 → 볼 무게가 휨에 영향 주게 하려면 측면력을 고정 `REF_MASS` 기준으로(가속도 1/mass) 설계(§4.1·4.5).
4. **Sleeping 바디엔 힘·임펄스가 안 먹힘** → 스핀·발사 시 항상 `wakeUp=true`. 핀은 sleeping을 정지 판정에 역이용(§4.6).
5. **모바일은 rAF가 30FPS로 떨어져 충돌을 놓침** → `maxCcdSubsteps` 상향으로 보완. (둘 다 실제 three.js+Rapier 볼링 사례에서 확인된 함정)

---

## 14. 부록 B — 수학·물리 공식 레퍼런스

구현 시 바로 참조할 공식 모음. 모두 표준 식이며 쓰이는 모듈을 함께 표기. (벡터는 3D, ŷ=(0,1,0))

### B.1 벡터 (Throw · 스핀 · 카메라)
- 길이: `|v| = √(x²+y²+z²)`
- 정규화: `v̂ = v / |v|`  (0벡터 예외 처리)
- 내적: `a·b = aₓbₓ+a_yb_y+a_zb_z = |a||b|cosθ`  → 사잇각·투영
- 외적: `a×b = (a_yb_z−a_zb_y, a_zbₓ−aₓb_z, aₓb_y−a_ybₓ)`  → 토크·표면속도
- 선형보간: `lerp(a,b,t) = a + (b−a)t`

### B.2 강체 운동·충돌 (볼 무게 · 핀 파괴력)
- 운동량: `p = m·v`  (무거운 공이 핀을 더 밀고 덜 튕김)
- 운동에너지: `KE = ½m|v|²`
- 뉴턴 2법칙: `F = m·a`,  중력 `F_g = m·g` (g=9.81)
- **충격량**: `J = F·Δt = Δp = m·Δv`  → Rapier `applyImpulse` (§4.1 함정의 근거)
- 동마찰력: `F_k = μ_k·N`,  평지 `N=m·g`  → 가속도 `a = F/m`
- 반발(restitution) `e`: 충돌 후 법선속도 `v'ₙ = −e·vₙ`

### B.3 회전·구름·스핀 (§4.1의 뿌리)
- 균일 구 관성모멘트: `I = (2/5)·m·R²`
- 각운동량 `L = I·ω`,  토크 `τ = r×F = I·α`
- **순수 구름(미끄럼 없음) 조건**: `|v| = ω·R`  (접촉점 속도 0) ← 스핀의 핵심
- 접촉점(공 바닥) 속도: `v_p = v_cm + ω × r_p`,  `r_p = (0, −R, 0)`
- 미끄럼: `slip = 수평성분(v_p)`;  `|slip| > SLIP_EPS` 면 미끄럼 중
- 스핀 측면력: `F = −μ·REF_MASS·g · slip̂`  → 적용 `impulse = F·Δt`
  (REF_MASS 고정 → `a=F/m ∝ 1/mass` → 가벼운 공 더 휨, §4.5)
- 휨(곡률) 반경 근사: `R_curve ≈ |v|² / a_lat`  (조준 보조선 예측용)

### B.4 기하 — 핀 배치·판정 (PinSet)
- 핀 좌표(행 r=0..3, 열 c): `x = c·SPACING`,  `z = HEADPIN_Z + r·SPACING·cos30°`
  (`cos30° = √3/2 ≈ 0.866` = 정삼각형 행 간격)
- 핀 기울기: 로컬 up `û = R·ŷ`;  `tilt = acos(û·ŷ) = acos(û_y)`
  `tilt ≥ PIN_FALL_ANGLE(45°)` ⟺ `û_y ≤ cos45° ≈ 0.707` → 쓰러짐
- 포켓: 우투 1–3번 핀 사이, 좌투 1–2번. 이상 진입각 ≈ 6° (참고)
- 거터 판정: `|x| > LANE_WIDTH/2 − BALL_RADIUS`  (§4.2)

### B.5 발사·조준 (Throw · Controls)
- 방향: `dir = normalize(aim, 0, 1)`  (aim ∈ [−1,1] = 횡 성분)
- 속도: `speed = (MIN_SPEED + power·(MAX_SPEED−MIN_SPEED))·maxSpeedScale`
- 스핀→각속도: `ω = spin · SPIN_GAIN · (기울인 축)`
- 조준 보조선(곡선): 측면 가속 `a_lat`을 작은 Δt로 적분해 미래 위치 샘플
  `pₙ₊₁ = pₙ + vₙΔt + ½aΔt²`,  `vₙ₊₁ = vₙ + aΔt`

### B.6 시뮬레이션 루프·보간 (Loop · CameraRig)
- 고정 timestep accumulator:
  ```
  acc += min(frameTime, MAX_FRAME);
  while (acc ≥ dt) { physics.step(dt); acc −= dt; }
  alpha = acc / dt;  renderPos = lerp(prevPos, currPos, alpha)
  ```
- 프레임레이트 독립 스무딩(카메라): `p += (target − p)·(1 − e^(−λΔt))`
- 회전 보간: `quaternion.slerp(q0, q1, t)`

### B.7 볼 무게 매핑 (BallSpec · §4.5)
- lb→kg: `kg = lb × 0.45359237`
- 정규화: `t = (lb − 6) / (16 − 6)`
- 컨트롤: `maxSpeedScale = lerp(1.0, 0.82, t)`
