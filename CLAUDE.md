# bowling-3d

브라우저 3D 볼링 게임 — **Three.js + Rapier(WASM), TypeScript, Vite**. 정식 10프레임 룰, 슬립 기반 훅 물리, AI 라이벌·로컬 2인 교대전, 업적→코스메틱 스킨. **외부 에셋 0개** — 도형·텍스처·사운드·UI 전부 procedural(`public/assets` 없음).

## 명령

```bash
npm run dev            # 개발 서버 (localhost:5173)
npm test               # Vitest (점수·게임플레이)
npm run build          # tsc 타입체크 + vite build → dist/
npm run app:dev        # Tauri 데스크톱 창  (app:build · ios:dev · android:dev)
node sim-carry.mjs     # 핀 캐리 밸런스 오프라인 시뮬 (--pinDamp 등 CLI 그리드 스캔)
```

## 문서 지도

- **어떻게 만들어졌나** (구조·좌표계·물리·상태머신·점수룰) → [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md)
- **왜 이렇게 했나** (밸런스·튜닝·연출·UI 결정 + 검증된 불변식) → [docs/DECISIONS.md](docs/DECISIONS.md)
- 기능별: [REWARDS](docs/REWARDS.md) · [OIL_META_AND_AUTO](docs/OIL_META_AND_AUTO.md) · [MOBILE_SUPPORT](docs/MOBILE_SUPPORT.md) · [APP_PACKAGING](docs/APP_PACKAGING.md)
- 세션 로그(동결) → [docs/archive/](docs/archive/)

## 작업 시 함정 (검증됨 — 건드리기 전 확인)

- **좌표계**: world `+x = 화면 왼쪽` (카메라가 −z→+z를 봄). 입력·연출에서 부호 반전 필요.
- **마찰 결합**: 레인 `Min` / 핀 `Max` (Rapier 규칙 우선순위로 접촉쌍별 정책 분리) — 임의로 바꾸지 말 것. → DECISIONS §4
- **스핀**: 측면력 *세기*는 스핀 양과 무관. 손맛은 `spin^0.7` 입력곡선(`SPIN_POW`)이 만든다. → DECISIONS §3
- **점수**: 순수함수 — flat rolls 배열에서 매번 재계산, 누적 저장 안 함.
- **튜닝 상수**: `src/game/constants.ts`가 단일 소스 (물리·연출·밸런스).
- **sleeping 바디**엔 힘·임펄스 전 `wakeUp=true` 필수.
- **조준선 캐시 키**엔 볼 물성 포함 (조준 중 무게 교체가 정상 경로). → DECISIONS §10
- **미사용처럼 보이는 export 4개**(`pinIndexByNumber`/`OIL_DRY_PER_FRAME`/`OIL_DRY_MAX`/`maxConsecutiveStrikes`)는 live — 지우지 말 것.
- **UI 토큰**은 `src/ui/theme.ts` (WebGL이 읽음) — `.css`로 빼지 말 것. `index.html` 부팅 로더 CSS도 그대로 둘 것.

## 디버그 (브라우저 콘솔)

```js
__game / __ball / __pins / __engine / __cameraRig     // 전역 핸들
// 수동 물리 스텝 (백그라운드 탭에서 rAF 멈출 때)
__game.throwBall(0, 1, 0);
for (let i = 0; i < 600; i++) { __engine.step(1/60); __game.update(1/60); }
__unlockAllRewards();  __resetRewards();               // 보상 해금/초기화 (호출 후 새로고침)
```
