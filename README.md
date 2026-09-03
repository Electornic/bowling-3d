# STARLITE LANES

브라우저에서 돌아가는 3D 볼링 게임 (데스크톱·모바일 터치 지원). 정식 10프레임 룰(스트라이크/스페어 보너스), 슬립 기반 훅(스핀) 물리, 오일 패턴, 미드센추리 볼링장(인쇄 마스킹 유닛·옆벽 그래픽 밴드)까지 구현했다. **풀게임/블리츠/스페어 챌린지** 모드와 **AI 라이벌 3인**(난이도 사다리) 대결, 승리로 **업적**을 달성하면 **코스메틱 볼 스킨**이 해금된다(컬렉션 시트 — 외형 전용·물리/AI 사다리 무영향, 과금·가챠 없음). 화면은 **에셋 없이 코드로만** 만든다 — 도형·텍스처·UI 전부 절차적이고, 한국어/영어/일본어/중국어 4개 언어를 지원한다. 외부 파일은 사운드 셋(`roll.wav` 383KB · `strike.wav` 388KB · 메뉴 BGM `mi_music-reggae-ruckus-157890.mp3` 1.5MB)뿐이고 그 밖의 소리(핀세터 기계음·피트·UI 틱·차임)는 합성이다.

## 기술 스택

| 역할 | 선택 |
|---|---|
| 3D 렌더링 | [Three.js](https://threejs.org/) |
| 물리 | [Rapier](https://rapier.rs/) (`@dimforge/rapier3d-compat`, Rust→WASM) |
| 빌드/테스트 | Vite + Vitest |
| 언어 | TypeScript |

## 실행

```bash
npm install
npm run dev      # 개발 서버 http://localhost:5173
npm test         # 점수 계산 단위테스트 (Vitest)
npm run build    # 프로덕션 번들 (tsc 타입체크 + vite build → dist/)
```

## 데스크톱 · 모바일 앱

같은 코드를 [Tauri v2](https://v2.tauri.app)로 **Windows · macOS · Android · iOS** 네이티브 앱으로 패키징한다(셸은 `src-tauri/`).

```bash
npm run app:dev      # 데스크톱 개발 창
npm run app:build    # 데스크톱 번들 (현재 OS)
npm run ios:dev      # iOS (Mac + Xcode)
npm run android:dev  # Android (SDK/NDK 필요)
```

준비물·스토어·플랫폼별 주의는 [docs/APP_PACKAGING.md](docs/APP_PACKAGING.md) 참고.

## 조작

**데스크톱 (마우스 + 키보드)**
- **마우스 이동** — 조준 (공 앞 짧은 방향 가이드 표시 — 훅 결과는 안 보여줌)
- **마우스 꾹 눌렀다 떼기** — 파워 차징 → 발사
- **마우스 휠 또는 좌하단 스핀 바 드래그** — 좌/우 스핀 (조준선 색이 방향·세기를 함께 보여준다)
- **Esc** — 일시정지 (설정·볼 무게·컬렉션·포기)

**모바일 (터치)**
- **누른 채 좌우 드래그** — 조준(상대 드래그) + 동시에 파워 차징, 떼면 발사
- **좌하단 스핀 바 드래그** — 좌/우 스핀
- **세로 화면이 주력**이다. 볼링 레인은 좁고 깊어서 가로로 들면 모든 게 2.2배 작아진다(iPhone 15 실측: 공 지점 레인 폭이 화면 가로의 7.8%). 가로로 돌리면 세로로 돌려달라는 안내가 뜬다.
- 더블탭/핀치 줌·당겨서새로고침 차단, safe-area·저사양 품질 적응 적용

볼 무게(6~16 lb)·조준 난이도·모드·상대는 **시작 메뉴**에서 고른다. 무게는 일시정지 모달에서도 바꿀 수 있다(다음 투구부터 적용).

## 물리 구현 하이라이트

- **스키드 → 훅 → 롤 3단계 궤적**: 볼링공이 휘는 건 마그누스가 아니라 지면 동마찰. 슬립 기반 측면력을 매 스텝 `applyImpulse(F·dt)`로 주입하고, 오일 존(앞 10.5m)/드라이 존 마찰 차등으로 실제 볼링처럼 막판에 꺾인다.
- **마찰 결합 규칙 트릭**: 레인은 `Min` 결합(오일 시뮬), 핀은 `Max` 결합(항상 접지) — Rapier의 규칙 우선순위(Max > Min > Average)로 바닥 콜라이더 하나를 공유하면서 접촉 쌍별 마찰 정책을 분리.
- **Ghost collision 회피**: 바닥을 구간별 콜라이더로 분할하면 이음새에서 공이 튄다(엔진 공통 함정). 전장 단일 콜라이더 + 공 위치 기준 동적 `setFriction`으로 해결.
- **점수는 순수함수**: 누적 점수를 저장하지 않고 flat한 투구 배열에서 매번 재계산 → 스트라이크/스페어 보너스 룩어헤드가 단순해짐 (Vitest로 퍼펙트/올스페어/파울 등 검증).
- 고정 timestep(1/60) + accumulator, 렌더 보간, CCD. 핀 임팩트는 **투구당 한 번**만 울린다 — 개별 contact마다 소리를 내면 슬로모 구간에서 '탭탭탭'으로 들려서, 핀이 실제로 움직이기 시작한 순간을 한 사건으로 잡는다.
- **절차적 네온 볼링장**: 옆 레인 4개(배경에서 실제로 물리가 돌아간다)·벽·천장 조명·옆벽 그래픽 밴드·핀 뒤 애니메이션 전광판(신스웨이브 선셋+스크롤 그리드)까지 캔버스로 그려 에셋 없이 분위기. 스트라이크/스페어/거터는 **점수판 아래 스틸컷 밴드** 하나로 통일했다 — 예전엔 전광판 캔버스에 글자를 직접 그리는 경로가 따로 있었지만 연출 언어가 둘로 갈리고 커스텀 전광판까지 덮어서 걷어냈다.
- **UI 네온 통일**: 점수판·볼무게·파워·스핀 오버레이를 공통 토큰(`src/ui/theme.ts`)으로 씬과 같은 네온 글래스 룩으로 통일.

## 문서

현재 문서는 셋이다. 나머지는 `docs/legacy/`로 내렸다 — 아래 "지난 설계 기록" 참고.

- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — 설계 도안 (좌표계·물리 상수·상태머신·Rapier API 검증 부록)
- [docs/MOBILE_SUPPORT.md](docs/MOBILE_SUPPORT.md) — 모바일/터치 대응 설계·구현 (발사 인터랙션·반응형 UI·뷰포트/제스처·성능 적응)
- [docs/APP_PACKAGING.md](docs/APP_PACKAGING.md) — Tauri v2 데스크톱/모바일 앱 패키징 (Win·Mac·Android·iOS 빌드·스토어·함정)

### 지난 설계 기록 (`docs/legacy/`)

기능이 실제로 어떻게 굴러가는지는 **코드와 커밋 메시지가 단일 소스**다. 아래는 그때의 근거·측정·
대안 검토가 남아 있는 기록이라, "왜 이 값인가"를 물을 때만 열면 된다. **현재 상태의 서술로는
믿지 말 것** — 특히 `PROGRESS.md`는 2026-07-13에서 멈춰 있다.

- [docs/legacy/REWARDS.md](docs/legacy/REWARDS.md) — 보상 시스템 설계 (업적 뱃지 + 코스메틱 볼 스킨·컬렉션)
- [docs/legacy/SPIN_FEEL_AND_AI_LADDER.md](docs/legacy/SPIN_FEEL_AND_AI_LADDER.md) — 스핀 손맛 + AI 난이도 사다리 튜닝
- [docs/legacy/OIL_META_AND_AUTO.md](docs/legacy/OIL_META_AND_AUTO.md) — 오일 패턴 메타 & 오토 튜닝 설계 노트
- [docs/legacy/UI_REVAMP.md](docs/legacy/UI_REVAMP.md) — 인게임 UI 개편 설계 (네온 글래스 토큰 통일)
- [docs/legacy/POLISH_BACKLOG.md](docs/legacy/POLISH_BACKLOG.md) — 마감 백로그 (미착수 항목 번호가 코드 주석에서 참조됨)
- [docs/legacy/GAMEPLAY_ROADMAP.md](docs/legacy/GAMEPLAY_ROADMAP.md) — 게임성 로드맵·브레인스토밍 기록
- [docs/legacy/PROGRESS.md](docs/legacy/PROGRESS.md) — 세션별 진행 기록 (⚠️ 2026-07-13 이후 갱신 없음)

## 디버그

브라우저 콘솔에 전역 노출: `__game` `__ball` `__pins` `__engine` `__environment` `__cameraRig` `__sound` `__controls`

보상 디버그(호출 후 새로고침): `__unlockAllRewards()` — 업적/스킨 전체 해금, `__resetRewards()` — 진행 초기화.

```js
// 수동 물리 스텝 (숨은 탭에선 rAF가 아예 안 돈다 — visibilitychange가 루프를 멈춘다)
__game.throwBall(0, 1, 0);
for (let i = 0; i < 600; i++) { __engine.step(1/60); __game.update(1/60); __engine.sync(1); }
```

⚠️ `__engine.step()`에 **dt를 빼면 안 된다.** 생략하면 `world.timestep`이 undefined가 되어 NaN →
WASM 패닉이 나고, 그 뒤 모든 호출이 "recursive use of an object"로 실패한다(에러는 엉뚱한 함수에서 뜬다).
