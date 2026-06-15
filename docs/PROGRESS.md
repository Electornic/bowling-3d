# 진행 상황 & 다음 세션 핸드오프

> 마지막 구현: 2026-06-15 (7차 세션 — ① 스핀 손맛 `spin^0.7` + ② AI 난이도 사다리 130/228/169)
> 마지막 갱신: 2026-06-15 (7차 세션 — 스핀/AI 배치 구현 완료 [SPIN_FEEL_AND_AI_LADDER.md])
> 설계 문서는 [GAME_DESIGN.md](./GAME_DESIGN.md), 게임성 로드맵은 [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) 참고.

---

## 한 줄 요약

**게임 루프 + 타격감 + 모바일 + 패키징까지 완성.** 메뉴 → (풀게임/블리츠/스페어 챌린지) × (혼자/AI 라이벌 3인) → 결과/하이스코어 → 재시작. 핀 캐리 튜닝으로 훅이 최적해. P2 연출 본편(슬로모·임팩트 사운드·접근 카메라·전광판)·모바일 터치·Tauri/Android APK까지 구현됨. **7차에 ① 스핀 손맛(`spin^0.7`)·② AI 난이도 사다리(130/228/169) 완료. 남은 건 P2 ⑥ 충돌 시각효과(다음 배치 1순위) + P3 숙련 깊이 + ③승리보상·④에셋** → [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md).

## 7차 세션에 한 일 (① 스핀 손맛 + ② AI 난이도 사다리)

계획·검토 문서: [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) (웹서치 물리 정합 재검토 포함).

1. **① 스핀 손맛 — `spin^0.7` 입력 곡선** (`constants.ts` `SPIN_POW=0.7`/`effectiveSpin()`, [Ball.ts](../src/scene/Ball.ts) 발사·[Controls.ts](../src/input/Controls.ts) 예측선 공용). sim-carry 확장(스핀 레버 CLI + 파워×스핀 그리드 + 막판 곡률 출력)으로 **물리 레버 전수 스캔**: `ROLL_RATIO`/`SLIP_EPS`/`FRICTION_K`/`OIL_END_Z`/`HOOK_RAMP` 전부 **저/미드스핀 dead zone을 못 살림(가드만 붕괴) 확정**. 훅은 횡슬립 비율 ∝ 스핀이라 어떤 물리 레버도 풀스핀 가드를 안 깨고 약스핀을 못 살린다 → 스핀 *입력*을 `spin^0.7`로 리매핑(1.0 고정점 = 풀스핀·전 가드 −30cm·4/31·7/31·65cm **자동 불변**, 저/미드 막판스냅 **+40%**). 사용자 손맛 OK.
2. **② AI 난이도 사다리** — 헤드리스 매치 sim 신규([tests/ai-match-sim.test.ts](../tests/ai-match-sim.test.ts): vitest `.ts`·`runIf(AI_SIM)` 가드·`constants`/`computeAiThrow`/`totalScore` import·투구별 Rapier 핀=드리프트 0). **캘리브레이션 버그 발견·수정**: AI 직구가 `POCKET_X_STRAIGHT=0`(헤드핀 정면=노즈히트=스플릿)을 노려 스트라이크가 안 났음(점수가 jitter 무관 ~120-156에 뭉친 진짜 원인) → 미세스윕으로 실제 포켓 −7cm 확인 → `POCKET_X_STRAIGHT` 0→**−0.07**, `POCKET_X_HOOK` 0.067→**0.05**. jitter 튜닝(N=200): **김부장 130(쉬움)·한프로 228(어려움)·도박사 윤 169±28(고변동·sd 최대)**, 김↔한 98점차. `HOOK_DRIFT_FULL=0.33`은 `effectiveSpin(1)=1`이라 ①과 무관히 유효(윤 재측정 불필요). 메뉴 칩에 `난이도` 표시([Menu.ts](../src/ui/Menu.ts), `AiProfile.difficulty` 신규).

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

**P2 ⑥ 핀 충돌 시각효과** — 7차로 ① 스핀·② AI가 끝나, [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) §4 백로그에서 **비용 대비 체감이 가장 큰 1순위**. 충돌 지점 임팩트 플래시/스파크 + 닿은 핀 발광. `engine.onContact`에 위치·force가 들어오니 배선은 깔끔(슬로모·push-in·크래시음은 이미 있음 — **시각효과만 잔여**). 함께 검토: ③ 승리 보상(보상 정의 미정 — 새 볼 언락/칭호/연출 중 택), ④ 절차적 에셋 다듬기.

**미확정 손맛 체크 (선택, 시간 나면)** — ① 스핀은 사용자 확인됨. 남은 건:
- **핀 액션 느낌** — 핀 선형 감쇠 0.8이 묵직하면 `PIN_LINEAR_DAMPING`·`PIN_RESTITUTION` 조정 (단, sim-carry.mjs로 직구/훅 윈도우 재측정 필수)
- 팔로우 카메라(공 뒤 4.5·높이 1.5 — `CameraRig.ts`), 조준 감도(`AIM_RANGE` 0.08)

## 남은 작업 (우선순위 순)

> 게임성 개선 방향은 [GAMEPLAY_ROADMAP.md](./GAMEPLAY_ROADMAP.md) 참고(단 v5에서 멈춤 — P2/모바일 완료 미반영). P0.5/P1/P1.5는 5차, P2 본편·모바일·패키징은 6차 완료.

- [x] **(P0) 스핀 손맛** → [SPIN_FEEL_AND_AI_LADDER.md](./SPIN_FEEL_AND_AI_LADDER.md) ① — **7차 완료** (`spin^0.7` 입력곡선, 물리 레버 전수 스캔으로 dead zone 원인 규명 후 채택)
- [x] **(P1.5 후처리) AI 난이도 사다리** → 같은 문서 ② — **7차 완료** (130/228/169, 매치 sim 튜닝 + 직구/훅 포켓 캘리브레이션 버그 수정)
- [ ] **(P2) ⑥ 충돌 시각효과** — P2 본편 중 유일 잔여, **다음 배치 1순위**. 충돌 지점 플래시/스파크 + 닿은 핀 발광 (`engine.onContact`에 위치·force 있음, 배선 깔끔)
- [ ] **(P3) 숙련 깊이** — 오일 상태 파라미터화(hookFactor/OIL_END_Z 전역 → 객체) 선행 후 예측선 난이도/오일 프리셋/레인 전환, 릴리스 타이밍(직구 천장 추가 억제 레버)
- [ ] 실물 에셋 — GLTF 핀·공, HDRI, 실제 음원 (P4)

**6차 완료분(이전 '남은 작업'에서 해소)**: ~~(P2) 타격감 본편~~ — 슬로모·임팩트 사운드·접근 카메라·전광판 구현(⑥ 시각효과만 잔여). ~~모바일 터치 검증 + 터치 스핀 입력~~ — 터치 발사·반응형 UI 구현(터치 전용 스핀은 바 드래그로 대체, Q/E 병행).

## 소스 구조

```
src/
  core/    Boot(부팅·조립·이벤트 배선) · Engine(렌더+물리+보간) · Loop(고정 timestep+alpha+timeScale)
  scene/   Lane(레인+거터) · Environment(볼링장 배경+나무텍스처) · Ball(공·스핀) · Pin(병모양) · PinSet(배치·판정·setLayout)
  game/    GameState(상태머신+모드+멀티플레이어) · Scoreboard(점수·rollStats) · BallSpec(무게)
           constants(튜닝 상수 집결) · ai(라이벌 프로필) · splits(스플릿 감지) · Stats(localStorage 기록)
  input/   Controls(마우스+키보드, 곡선 조준선·스핀/파워 게이지, AI 턴 락)
  camera/  CameraRig(상태별 뷰, MENU 스웨이)
  audio/   SoundManager(합성 충돌음)
  ui/      Hud(2인 점수표+배너) · BallPicker · Menu(시작/결과 오버레이)
tests/     scoreboard.test.ts · gameplay.test.ts
```

**디버그 전역**: `window.__game / __ball / __pins / __engine / __cameraRig`
수동 시뮬: `__engine.step(1/60); __game.update(1/60)` 루프 (백그라운드 탭은 rAF 멈춤 주의)

## 검증된 핵심 가정 (Rapier)

- 스핀 훅 = 주입 측면력 + **Rapier 자체 접촉 마찰의 추가 훅** (실측 합계가 주입 모델의 ~1.6배 → 예측선은 `PREVIEW_HOOK_GAIN` 보정)
- 좌표 주의: **world +x = 화면 왼쪽** (카메라가 −z에서 +z를 봄) — 입력·연출에서 부호 반전 필요
- 볼 무게 = `collider.setMass`, 6~16lb 슬라이더 / 충돌음 = `drainContactForceEvents` / CCD+`maxCcdSubsteps=4`
- 점수 = flat rolls 재계산, 10프레임 보너스 (Vitest 7/7)
