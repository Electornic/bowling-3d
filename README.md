# bowling-3d 🎳

브라우저에서 돌아가는 3D 볼링 게임 (데스크톱·모바일 터치 지원). 정식 10프레임 룰(스트라이크/스페어 보너스), 슬립 기반 훅(스핀) 물리, 오일 패턴, 네온/신스웨이브 볼링장(애니메이션 전광판·옆벽 광고판)까지 구현했다. **외부 에셋 0개** — 도형·텍스처·사운드·UI 전부 코드로 생성.

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
npm run dev    # http://localhost:5173
npm test       # 점수 계산 단위테스트
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
- **Q / E 또는 스핀 바 드래그** — 좌/우 스핀 (하단 게이지, 수치 표시)
- **우상단 볼 무게** — 6~16 lb 슬라이더 + 색 스와치 (무거울수록 느리지만 묵직, 색이 짙어짐)

**모바일 (터치)**
- **누른 채 좌우 드래그** — 조준(상대 드래그) + 동시에 파워 차징, 떼면 발사
- **하단 스핀 바 드래그** — 좌/우 스핀 (전체폭 도크)
- **좌하단 볼 무게 칩** — 탭하면 슬라이더 펼침
- 가로 화면 권장(세로도 플레이 가능). 더블탭/핀치 줌·당겨서새로고침 차단, safe-area·저사양 품질 적응 적용

## 물리 구현 하이라이트

- **스키드 → 훅 → 롤 3단계 궤적**: 볼링공이 휘는 건 마그누스가 아니라 지면 동마찰. 슬립 기반 측면력을 매 스텝 `applyImpulse(F·dt)`로 주입하고, 오일 존(앞 10.5m)/드라이 존 마찰 차등으로 실제 볼링처럼 막판에 꺾인다.
- **마찰 결합 규칙 트릭**: 레인은 `Min` 결합(오일 시뮬), 핀은 `Max` 결합(항상 접지) — Rapier의 규칙 우선순위(Max > Min > Average)로 바닥 콜라이더 하나를 공유하면서 접촉 쌍별 마찰 정책을 분리.
- **Ghost collision 회피**: 바닥을 구간별 콜라이더로 분할하면 이음새에서 공이 튄다(엔진 공통 함정). 전장 단일 콜라이더 + 공 위치 기준 동적 `setFriction`으로 해결.
- **점수는 순수함수**: 누적 점수를 저장하지 않고 flat한 투구 배열에서 매번 재계산 → 스트라이크/스페어 보너스 룩어헤드가 단순해짐 (Vitest로 퍼펙트/올스페어/파울 등 검증).
- 고정 timestep(1/60) + accumulator, 렌더 보간, CCD, contact force 이벤트 기반 충돌음.
- **절차적 네온 볼링장**: 옆 레인·벽·천장 조명·옆벽 광고판·핀 뒤 애니메이션 전광판(신스웨이브 선셋+스크롤 그리드)까지 캔버스로 그려 에셋 없이 분위기. 스트라이크/스페어/거터는 전광판에 큼지막하게 어나운스(중복 방지로 화면 오버레이 배너는 없앰).
- **UI 네온 통일**: 점수판·볼무게·파워·스핀 오버레이를 공통 토큰(`src/ui/theme.ts`)으로 씬과 같은 네온 글래스 룩으로 통일.

## 문서

- [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) — 설계 도안 (좌표계·물리 상수·상태머신·Rapier API 검증 부록)
- [docs/MOBILE_SUPPORT.md](docs/MOBILE_SUPPORT.md) — 모바일/터치 대응 설계·구현 (발사 인터랙션·반응형 UI·뷰포트/제스처·성능 적응)
- [docs/APP_PACKAGING.md](docs/APP_PACKAGING.md) — Tauri v2 데스크톱/모바일 앱 패키징 (Win·Mac·Android·iOS 빌드·스토어·함정)
- [docs/PROGRESS.md](docs/PROGRESS.md) — 세션별 진행 기록·튜닝 노트·다음 할 일

## 디버그

브라우저 콘솔에 전역 노출: `__game` `__ball` `__pins` `__engine` `__cameraRig`

```js
// 수동 물리 스텝 (백그라운드 탭에서 rAF 멈출 때)
__game.throwBall(0, 1, 0);
for (let i = 0; i < 600; i++) { __engine.step(1/60); __game.update(1/60); }
```
