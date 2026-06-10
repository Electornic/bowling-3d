# 3D 웹 볼링 게임 — 설계 도안

> 정식 1인 볼링 게임 (10프레임 / 스트라이크·스페어 점수 / 조준·파워·스핀 / 볼 무게 선택 / 카메라 연출)
> 스택: **Three.js** (렌더링) + **Rapier** (물리, Rust→WASM) + **Vite** (번들러) + **TypeScript**
>
> ※ §13(부록 A) = 핵심 물리 가정 ↔ 실제 Rapier API 검증 결과. §14(부록 B) = 수학·물리 공식 레퍼런스. 구현 전 필독.

---

## 1. 기술 스택 & 이유

| 역할 | 선택 | 이유 |
|------|------|------|
| 3D 렌더링 | three.js | 웹 3D 표준, 자료 압도적, 씬/카메라/조명 API 직관적 |
| 물리 엔진 | @dimforge/rapier3d-compat | 빠르고 정확. 굴림(rolling)·충돌이 핵심인 볼링에 적합 |
| 빌드 | Vite | 빠른 HMR, WASM·TS 기본 지원 |
| 언어 | TypeScript | 벡터·상태 많아서 타입이 버그를 크게 줄여줌 |
| 사운드 | howler.js (또는 Web Audio 직접) | 프리로드·동시재생·볼륨 제어 간편 |
| 테스트 | Vitest | 점수 로직(순수함수) 단위테스트, Vite와 통합 |
| 상태 | 순수 JS 상태머신 | 게임 흐름이 단순해 라이브러리 불필요 |

> `rapier3d-compat`를 쓰는 이유: WASM을 비동기 init 없이 번들에 포함시켜 Vite에서 셋업이 가장 쉬움.

---

## 2. 폴더 구조

```
bowling-3d/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ docs/
│   └─ GAME_DESIGN.md        ← 이 문서
├─ public/
│   └─ assets/               정적 에셋 (Vite가 그대로 서빙)
│       ├─ models/           GLTF (2차, M7)
│       ├─ textures/         공 무늬·레인 나무결·핀 줄무늬 (2D)
│       └─ sounds/           충돌·스트라이크·UI 음원
├─ tests/
│   └─ scoreboard.test.ts    점수 계산 단위테스트 (Vitest)
└─ src/
    ├─ main.ts               진입점
    ├─ core/
    │   ├─ Boot.ts           부팅: RAPIER init → 에셋 → 첫 프레임 → 로딩 제거
    │   ├─ Engine.ts         three 렌더러 + rapier world, 조명/그림자/리사이즈
    │   └─ Loop.ts           rAF + accumulator 고정 timestep, 렌더 보간
    ├─ scene/
    │   ├─ Lane.ts           레인 바닥 + 거터 + 벽 (시각+콜라이더)
    │   ├─ Ball.ts           공: 메시 + rigidBody (BallSpec로 mass 주입)
    │   ├─ Pin.ts            핀 1개: 메시 + rigidBody
    │   ├─ PinSet.ts         핀 10개 배치/리셋/쓰러짐 판정/데드우드 제거
    │   └─ AssetFactory.ts   procedural 도형 생성 ↔ (M7) GLTF 로딩 교체점
    ├─ game/
    │   ├─ GameState.ts      상태머신 (BOOT→MENU→PLAYING→GAME_OVER)
    │   ├─ Frame.ts          프레임 1개 데이터 (투구 결과)
    │   ├─ Scoreboard.ts     10프레임 점수 계산 (스트라이크/스페어/보너스/파울)
    │   ├─ Throw.ts          조준→파워→스핀 입력을 공 초기 속도/회전으로 변환
    │   ├─ BallSpec.ts       볼 무게 프리셋(7/10/14/16 lb)과 물리·연출 파라미터
    │   └─ rules.ts          파울·핀판정·데드우드 규칙 상수와 판정 함수
    ├─ input/
    │   └─ Controls.ts       포인터(마우스+터치)+키보드 → 추상 입력
    ├─ camera/
    │   └─ CameraRig.ts      투구 추적 + 결과 줌 연출
    ├─ audio/
    │   └─ SoundManager.ts   프리로드 + 충돌음(임펄스 기반)+UI음
    └─ ui/
        ├─ Hud.ts            점수판, 프레임 표시, 파워 게이지
        ├─ BallPicker.ts     볼 무게 선택 UI
        └─ Menu.ts           시작 화면 / 게임오버 / 재시작
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
| 레인 길이 (파울라인→1번핀) | 18.29 m | `LANE_LENGTH = 18.29` |
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
| 핀 | dynamic | cylinder(또는 capsule) | 무게중심 살짝 아래, restitution 0.2, **CONTACT_FORCE_EVENTS on** |
| 벽/거터 | fixed | cuboid | 공/핀 튕김 처리 |

- **고정 timestep** (1/60s) + accumulator: 물리 결정성·안정성. 렌더는 보간.
- 핀 쓰러짐 판정: 핀의 up벡터(로컬 y)와 월드 y의 각도가 **45° 초과**거나, y위치가 임계 이하면 "쓰러짐". (정밀 규칙은 4.3)

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
- (폴리싱) `FRICTION_K`를 z위치 함수로(앞=낮음/뒤=높음) 만들면 **오일 패턴**까지 흉내 가능.

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
| 공 friction / restitution | 0.2 / 0.1 | CCD on. mass는 BallSpec(§4.5) |
| 공 linear / angular damping | 0.05 / 0.1 | 너무 크면 안 굴러감 |
| 핀 mass / friction / restitution | 1.5 / 0.3 / 0.2 | 무게중심 약간 아래. 콜라이더 반경 ≥0.06 (얇으면 CCD로도 터널링) |
| 레인 friction / restitution | 0.15 / 0.0 | 미끄럽게 |
| `FRICTION_K` (스핀 측면력) | 0.1 | =마찰계수. 현실값 0.04~0.2 (1.5는 측면가속 14.7m/s²=중력 1.5배라 과함). 게임용 증폭은 0.2까지 |
| `SLIP_EPS` | 0.05 m/s | 이하면 롤링으로 간주 |
| `MIN_SPEED` / `MAX_SPEED` | 5 / 12 m/s | 파워 게이지 매핑(무게 보정은 §4.5) |
| `SETTLE_VEL_EPS` | 0.05 | 정지 판정 속도 |
| `SETTLE_TIMEOUT` | 4 s | 무한대기 방지 |
| `PIN_FALL_ANGLE` | 45° | 쓰러짐 각도 임계 |
| `CONTACT_FORCE_THRESHOLD` | 튜닝 | 이 이상 충돌만 사운드 이벤트 발생 |
| `HEADPIN_Z` / `PIN_DECK_END` | 18.29 / 19.08 | 1번핀 / 핀덱 끝 z. 전환 트리거 기준(§3·§4.2) |
| `maxCcdSubsteps` | 1 (모바일 2~4) | CCD 정밀도. 저FPS(모바일 30) 충돌 누락 보완(§12) |

### 4.5 볼 무게 시스템 (6~16 lb 다이나믹)

실제 볼링공은 **지름이 모두 같고(USBC: 둘레 27인치 고정) 무게만 6~16 lb** 다르다. 게임도 **`BALL_RADIUS` 고정, 무게만 6~16 lb를 슬라이더로 무단계 선택**. 무게 하나가 아래 4가지를 연속으로 바꾼다. (질량은 `ColliderDesc.setMassProperties` 또는 `setDensity`로 주입)

정규화 `t = (lb − 6) / (16 − 6) ∈ [0,1]`, 질량 `massKg = lb × 0.45359`.

| 영향 | 공식/방식 | 효과 |
|------|-----------|------|
| 질량(파괴력) | `massKg → setMassProperties` | 무거울수록 운동량 `mv`↑ → 파괴력↑·deflection↓ **(Rapier 자동)** |
| 훅(휨) | 측면력 고정 `REF_MASS` → `a=F/m ∝ 1/mass` | 가벼울수록 더 휨 **(자동, §4.1)** |
| 컨트롤(속도) | `maxSpeedScale = lerp(1.0, 0.82, t)` | 무거울수록 도달속도↓ → "묵직함" |
| 색(연출) | `lerpColor(밝음, 어두움, t)` | 무게 시각 구분 |

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
로딩 중 "Loading…" DOM 오버레이 표시 (WASM·에셋 준비 시간 가림).

### 5.2 렌더링 인프라 (Engine.ts)

- **렌더러**: `WebGLRenderer({ antialias: true })`, `setPixelRatio(Math.min(devicePixelRatio, 2))` (레티나 과부하 방지).
- **컬러/톤매핑**: `ACESFilmicToneMapping` + sRGB 출력 → 어둡게 안 보이는 문제 방지.
- **조명**: `AmbientLight`(은은한 전체) + `DirectionalLight`(레인 위에서, 그림자 캐스터).
- **그림자**: directional `castShadow`, 공·핀 `castShadow`, 레인 `receiveShadow`. shadowMap 해상도는 옵션화(저사양 대비).
- **리사이즈**: window `resize` → `camera.aspect` 갱신 + `updateProjectionMatrix()` + `renderer.setSize()` (debounce).
- **배경/분위기**: 초기엔 단색 + `Fog`로 깊이감. 볼링장 배경은 폴리싱(M7).

### 5.3 에셋 파이프라인 (AssetFactory)

3D 볼링이므로 핀·공·레인은 3D 지오메트리, UI·표면은 2D 텍스처. **단계적 교체** 전략:

- **1차 (M0~M6): procedural 코드 도형** — 에셋 파일 0개.
  - 공 = `SphereGeometry`(반지름 `BALL_RADIUS` 고정), 표면 텍스처로 회전 가시화.
  - 핀 = `LatheGeometry`(병 실루엣 프로파일 회전) 또는 `CapsuleGeometry` 근사.
  - 레인/거터 = `BoxGeometry` + 나무결 텍스처(2D).
- **2차 (M7): GLTF 3D 모델** — `GLTFLoader`로 시각 메시만 교체. 무료 모델(라이선스 확인) 또는 Blender 제작. 필요 시 DRACO/KTX2 압축.
- **🔑 철칙: 시각 메시 ≠ 콜라이더.** 핀 모델이 정교해도 물리 콜라이더는 단순 cylinder/capsule 유지 → 성능·안정성·터널링이 여기서 갈림. `AssetFactory`가 이 교체점을 캡슐화(로직은 콜라이더만, 외형은 자유).
- **텍스처(2D)**: 공 무늬, 레인 나무결, 핀 줄무늬, 배경/스카이박스. `TextureLoader`로 로드, 부팅 때 프리로드.

### 5.4 배경 & 환경 (볼링장 분위기)

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

**MENU / GAME_OVER**: DOM 메뉴(Menu.ts)로 Start/Restart 버튼 제공. MENU에서 볼 무게 선택(BallPicker). GAME_OVER는 최종 점수·프레임별 점수 표시.

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

> 핵심 원칙: **점수는 저장하지 말고 매번 rolls에서 재계산.** 보너스 룩어헤드가 단순해짐.

### 7.1 점수 로직 테스트 전략 (Vitest)

`Scoreboard`는 입력(rolls)→출력(점수) 순수함수라 단위테스트 최적. 손으로 검증 어려운 보너스 룩어헤드를 자동 검증.

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

---

## 10. 사운드 (SoundManager)

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

- [ ] **M0 셋업+인프라**: Vite+TS+three+rapier, 부팅 시퀀스, 조명/그림자/리사이즈, procedural 도형, 빈 씬에 큐브 낙하 확인
- [ ] **M1 레인+공**: 레인·거터·벽, 공 1개 굴리기(임시 키보드 발사), 볼 무게→mass 주입, 물리 상수 1차 튜닝
- [ ] **M2 핀**: 핀 10개 배치, 충돌·4.3 정밀 쓰러짐 판정
- [ ] **M3 게임 흐름**: 상태머신(MENU→PLAYING→GAME_OVER), 데드우드 제거, 프레임 진행, 핀 리셋
- [ ] **M4 점수**: Scoreboard 10프레임+스트라이크/스페어/파울, **Vitest 테스트**, HUD 표시
- [ ] **M5 조작+볼선택**: 포인터+키보드 추상화, 조준선, 파워 게이지, 스핀, BallPicker 슬라이더(6~16 lb)
- [ ] **M6 카메라**: 상태별 카메라 연출
- [ ] **M7 폴리싱**: 사운드(contact force), GLTF 모델·텍스처, 오일 패턴 스핀, 모바일 터치, 배경/조명, 하이스코어(P2)

> M0~M2 = 프로토타입(검증), M3~M4 = 게임다움, M5~M7 = 재미·완성도.

---

## 12. 리스크 & 메모

- **Rapier WASM 로딩**: `rapier3d-compat`로 비동기 init 회피. 안 되면 `await RAPIER.init()`.
- **`addForce` 지속력 함정**: 매 스텝 유지됨 → `applyImpulse(F·dt)` 또는 `resetForces()` 병행(§4.1, §13).
- **터널링(공이 핀 통과)**: 빠른 공+얇은 핀. 공 CCD on + timestep 작게.
- **무게 차로 솔버 불안정**: 16lb 공 vs 1.5kg 핀. CCD·작은 timestep·적절 restitution으로 안정화.
- **SETTLING 무한대기**: 핀 미세 진동으로 안 멈춤 → 속도 임계 + 타임아웃(4s) 병행.
- **데드우드 제거 타이밍**: 반드시 SETTLING·SCORING 완료 후 제거. 너무 일찍 치우면 굴러오던 핀까지 사라짐.
- **핀 판정은 정지 후 1회만**: 흔들리는 중 판정 금지(4.3).
- **contact force event 옵트인 필수**: 안 켜면 사운드 무음(§10, §13).
- **Sleeping 바디엔 힘 안 먹힘**: 스핀 측면력·발사는 `wakeUp=true` 필수(§4.6). 실제 사례에서 흔한 함정.
- **모바일 30FPS 다운그레이드**: 모바일 브라우저가 rAF를 30FPS로 떨궈 충돌 놓침 → `maxCcdSubsteps` 상향(2~4)으로 보완(외부 사례 확인).
- **성능**: 핀10+공1은 가벼움. 그림자·AA·shadowMap 해상도가 더 부담 → 옵션화.
- **사운드 동시재생**: 핀 다중 충돌 시 같은 음 폭주 → 최소 간격/풀링으로 제한.
- 초기엔 3D 모델 없이 **코드 도형**으로 시작(§5.3). 비주얼은 M7.

### P2 (이번 범위 밖, 나중에)
하이스코어·통계(localStorage) · 스플릿 감지/표시 · 일시정지·설정 메뉴 · 그래픽 품질 옵션 · 접근성(키보드 전용 플레이)

---

## 13. 부록 A — 구현 가능성 검증 (Rapier 공식 문서 대조)

도안의 핵심 물리 가정을 Rapier 3D JS 공식 문서로 1:1 검증한 결과. **전부 실재하는 API.**

| 도안 가정 | 실제 API | 비고 |
|-----------|----------|------|
| 스핀 측면력(매 스텝 힘) | `RigidBody.addForce` / `addForceAtPoint` | ⚠️ 지속력 → `applyImpulse(F·dt)` 또는 `resetForces()` 권장 |
| 발사 속도·회전 | `setLinvel` / `setAngvel` (Desc & Body) | OK |
| 터널링 방지 | `RigidBodyDesc.setCcdEnabled(true)` | OK |
| 충돌음 세기 | `EventQueue.drainContactForceEvents` → `TempContactForceEvent.totalForceMagnitude()` / `maxForceMagnitude()` | ⚠️ 콜라이더 `setActiveEvents(CONTACT_FORCE_EVENTS)` + threshold + `world.step(eventQueue)` 필요 |
| 볼 무게 | `ColliderDesc.setMassProperties(mass, com, inertia, frame)` 또는 `Collider.setDensity` | OK — 지름 고정, mass만 변경 |
| 정지 판정 | `RigidBody.linvel()` / `angvel()` / `isSleeping()` | OK — sleeping을 정지 판정에 활용(§4.6) |
| 힘·임펄스 적용 | `applyImpulse(imp, wakeUp)` / `addForce(f, wakeUp)` | ⚠️ sleeping 바디엔 `wakeUp=true` 필수(§4.6) |
| CCD 정밀도 | `IntegrationParameters.maxCcdSubsteps` (기본 1) | 모바일·고속 시 상향 |

**검증으로 드러난 3대 함정 (구현 시 반드시 반영):**
1. `addForce`는 한 번 주면 매 스텝 유지 → 프레임별 가변 힘은 `applyImpulse(F·dt)`로.
2. contact force 이벤트는 기본 OFF → 콜라이더에서 명시적으로 켜야 사운드 가능.
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
