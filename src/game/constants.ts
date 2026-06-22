/**
 * 게임 단위 = 1m. 표준 볼링 규격을 그대로 사용 (도안 §3, §4.4).
 */

// --- 좌표·규격 ---
export const LANE_LENGTH = 18.29; // 파울라인(z=0) → 1번핀
export const LANE_WIDTH = 1.05;
export const BALL_RADIUS = 0.109; // 지름 21.8cm (무게 무관 고정)
export const PIN_HEIGHT = 0.38;
export const PIN_MASS = 1.5;
export const PIN_SPACING = 0.3048; // 핀 중심거리 12인치
export const GUTTER_WIDTH = 0.23;
export const BALL_START_Z = -1; // 공 시작 (파울라인 뒤)

// --- 핀 배치 (정삼각형) ---
export const HEADPIN_Z = 18.29; // 1번핀
export const ROW_GAP = PIN_SPACING * Math.cos(Math.PI / 6); // ≈0.264 행 간격
export const PIN_DECK_END = HEADPIN_Z + 3 * ROW_GAP; // ≈19.08 마지막 행 (전환 트리거 기준 §4.2)

// --- 파워 스로(#4) — 넓은 레인 + 거대 삼각 랙 (GAME_MODES_EXPANSION §4) ---
// 표준 레인(LANE_WIDTH 1.05)은 4행 10핀 가정이라 그 이상의 삼각 랙은 폭이 안 맞는다
// (10행 바닥줄 폭 ≈2.74m). 파워 스로는 거터 대신 벽으로 막은 별도 '와이드 아레나'(PowerArena)를
// 켜고, PinSet은 isStanding x-게이트를 POWER_LANE_HALF로 넓힌다. 일반 모드 지오메트리는 불변.
export const POWER_MAX_ROWS = 10; // 최대 행 수 = 마지막 스테이지 (10행 = 55핀). 모바일 성능 상한(§4 — 91핀 타협).
// 와이드 아레나 반폭 (m). 10행 바닥줄 바깥 핀 중심 = (POWER_MAX_ROWS-1)/2·PIN_SPACING ≈1.372,
// + 핀반경 0.06 + 여유 → 1.55. 벽 안쪽 면이 여기. 핀이 벽 밖으로 못 나가고 공도 안 빠진다.
export const POWER_LANE_HALF = 1.55;
// 행별 핀 열 오프셋 (PIN_SPACING 배수). 행 0=헤드핀 ... 행 3=뒷줄. PinSet·splits 공용.
export const PIN_ROWS: readonly (readonly number[])[] = [
  [0],
  [-0.5, 0.5],
  [-1, 0, 1],
  [-1.5, -0.5, 0.5, 1.5],
];

// --- 덕핀(#5) — 작은 공 + 통통하고 짧은 핀 (GAME_MODES_EXPANSION §5) ---
// 표준 레인·거터·랙 배치를 그대로 쓰되, 공/핀 형상만 모드별로 갈아끼운다(Ball.setRadius·Pin.setDuckpin).
// 공: 지름 21.8cm(BALL_RADIUS 0.109) → 덕핀 ≈12.2cm(0.56×, 핑거홀 없음, §5 실측 12.1~12.7cm).
export const DUCKPIN_BALL_RADIUS = 0.061;
// 핀: 텐핀(높이 0.38)보다 짧고(9.4in≈0.24) 상대적으로 통통. 콜라이더 반경은 ≥0.06 유지(터널링 방지, §4.4)
// — 높이가 0.24로 줄어 같은 0.06이라도 비율상 더 뚱뚱해진다(0.06/0.24=0.25 vs 텐핀 0.06/0.38=0.16).
export const DUCKPIN_PIN_HEIGHT = 0.24;
export const DUCKPIN_PIN_RADIUS = 0.06;
// 캐리 튜닝(§5, 플레이테스트): 작은 공(지름 0.122)은 표준 핀 간격(0.305) 사이로 빠져나가 직접 타격이 적다.
// → 핀을 가볍게(1.5→0.55kg)·탄성 높게(0.3→0.55) 만들어 맞은 핀이 이웃으로 튀는 연쇄(체인) 캐리를 키운다.
// 텐핀 PIN_RESTITUTION(0.3)은 훅 우위 밸런스에 묶여 못 올리지만, 덕핀은 훅이 사실상 무의미해 별도값 가능.
export const DUCKPIN_PIN_MASS = 0.55;
export const DUCKPIN_PIN_RESTITUTION = 0.55;

// --- 핀 캐리 밸런스 (P0.5, sim-carry.mjs 그리드 스캔으로 확정) ---
// 선형 감쇠: 날아가는 핀을 감속시켜 "운 좋은 체인 스트라이크"를 억제. 0.8이면 직구 풀파워
// 윈도우 8/31→4/31, 훅 7/31 유지(1.75배). ⓓ 손맛 재튜닝(8차): 0.8은 핀이 날다 눈에 띄게
// 브레이크 걸려 "묵직/둔함"으로 읽혀 0.8→0.7로 완화(흩어짐 ~+20%, 역동성↑). 0.7은 윈도우 노이즈
// 안이라 캐리 영향 미미 — sim-carry는 --pinDamp/--flyout로 검증, AI 사다리는 ai-match-sim으로 재확인.
// 0.35 밑은 직구가 훅 추월(훅-최적 붕괴)이라 마지노선. 반발 0.3: 미드 캐리 핀-핀 전달 복원(올리면 훅 우위 깨짐 — 손대지 말 것).
export const PIN_RESTITUTION = 0.3;
export const PIN_LINEAR_DAMPING = 0.7;

// --- 충돌 그룹 (Rapier collision groups — 장애물 레인 #3) ---
// Rapier collisionGroups = u32 = (membership<<16)|filter. 두 콜라이더 A·B는
//   (A.mem & B.filter) != 0  AND  (B.mem & A.filter) != 0  일 때만 충돌한다(양방향 동의).
// 기본값은 0xFFFFFFFF(모든 그룹 소속·모든 그룹과 충돌)라, 배리어만 그룹을 줘선 핀과 격리되지 않는다
// (공·핀이 둘 다 0xFFFF면 배리어 필터가 둘을 구분 못 함). 그래서 공·핀·배리어 셋 다 비트를 부여:
//   공      = BALL,    충돌 ↔ WORLD|PIN|BARRIER
//   핀      = PIN,     충돌 ↔ WORLD|BALL|PIN          (배리어 제외 — 배리어가 핀 물리에 안 낌)
//   배리어  = BARRIER, 충돌 ↔ BALL                    (공만 막음)
// 레인·거터·벽은 기본값(0xFFFF) 유지 — 멤버십에 WORLD 비트를 포함하므로 공·핀과 그대로 충돌한다.
export const CG_BALL = 0b0001;
export const CG_PIN = 0b0010;
export const CG_WORLD = 0b0100;
export const CG_BARRIER = 0b1000;
/** (membership, filter) → Rapier collisionGroups u32. ColliderDesc.setCollisionGroups에 넘긴다. */
export const cgroups = (membership: number, filter: number): number =>
  ((membership & 0xffff) << 16) | (filter & 0xffff);

// --- 물리 (도안 §4.4 튜닝 시작값) ---
export const GRAVITY = -9.81;
export const TIMESTEP = 1 / 60;
export const REF_MASS = 5.0; // 스핀 측면력 기준 질량 (≈11lb = 슬라이더 중앙)
export const FRICTION_K = 0.16; // 스핀 측면력 계수 — 드라이 존에서만 작용 (hookFactor 게이트)

// --- 오일 패턴 → 레이트 훅 (스키드→훅) ---
// 앞 구간은 오일로 미끄러져 직진, 오일 존 끝부터 마찰이 살아나며 훅이 "막판에" 꺾인다.
// ⚠️ 레인 콜라이더는 마찰 결합 Min 필수 (Lane.ts) — 기본 Average면 공 마찰(0.1)과
//    평균돼 오일 존 슬립이 일찍 닫혀 훅의 절반이 오일 존에서 새어나간다.
// 오일 존 geometry(endZ·ramp)와 hookFactor()는 매치(프리셋)·프레임(마름)마다 가변이라 oil.ts로 분리(P3).
// 마찰값은 프리셋 불변이라 여기 유지 — sim-carry는 --oilEnd/--hookRamp만으로 프리셋을 재현.
export const LANE_FRICTION_OIL = 0.015; // 오일 존 (직진 스키드 — 슬립 보존)
export const LANE_FRICTION_DRY = 0.14; // 드라이 존 (Rapier 자체 마찰도 훅에 가세)
export const BALL_FRICTION = 0.1;
export const SLIP_EPS = 0.05; // 이하면 롤링으로 간주
export const SPIN_RATE = 14; // 발사 스핀 ωz = spin·SPIN_RATE (rad/s) — 훅 연료. 풀스핀 미드파워 총휨 ~61cm
// 약스핀 저역 부스트 (SPIN_FEEL_AND_AI_LADDER.md ①): 발사 각속도에 |spin|^SPIN_POW.
// 1.0이 고정점이라 풀스핀·전 가드(−30cm·윈도우 4/31·7/31·65cm) 불변, 저/미드 스핀만 훅↑.
// sim-carry --spinPow 0.7 검증: 저스핀 막판스냅 −2.8→−4.1cm(+40%), 풀스핀·윈도우 베이스라인 동일.
export const SPIN_POW = 0.7;
/** 스핀 슬라이더 입력(−1..1)을 발사 곡선으로 리매핑 — Ball 발사·Controls 예측선 공용. */
export function effectiveSpin(spin: number): number {
  return Math.sign(spin) * Math.pow(Math.abs(spin), SPIN_POW);
}
export const ROLL_RATIO = 0.75; // 발사 시 진행방향 굴림 비율 (1=노슬립, 낮을수록 스키드↑=훅 연료↑)
export const MIN_SPEED = 5;
export const MAX_SPEED = 12;
// 마우스 화면폭 전체 → aim ±AIM_RANGE. 레인은 ±1.6°밖에 안 되므로(0.525/18.3)
// 1.0이면 화면 4%만 벗어나도 거터행 — ±4.6°로 눌러야 조준이 가능하다.
export const AIM_RANGE = 0.08;
// 터치(ⓑ 상대 드래그) 조준 게인 (MOBILE_SUPPORT.md §2.4). 1.0 = 화면폭 절반 드래그로
// ±AIM_RANGE(최대 조준)에 도달. 높이면 적게 끌어도 크게 꺾여 정밀도↓, 낮추면 그 반대.
export const AIM_GAIN = 1.0;
// --- P3 릴리스 타이밍 (실행 텐션, GAMEPLAY_ROADMAP P0.5 레버② / P3) ---
// 노이즈 0인 마우스 조준에 *실행 분산*을 되돌려준다. 파워 게이지 골드 띠(=정확 릴리스 구간) 안에서
// 떼면 정확, 벗어날수록 aim에 gaussian 노이즈. 노이즈 단위 = 진입 x cm (AI aimJitterCm와 동일 모델).
// **플레이어 전용** — Controls 발사 경로에만 주입(AI는 computeAiThrow 자체 jitter 보유, throwBall 직행).
// 측정 근거(sim-carry --noise, N=400): σ=0이면 직구·훅 모두 100% 스트라이크(=현 "직구 250" 문제),
// σ↑하면 좁은 직구 윈도우가 넓은 훅보다 빨리 무너짐 — σ4에서 직구23%/훅41%(훅 1.8배), σ6에서 21%/32%.
export const RELEASE_SWEET_LO = 0.6; // 정확 릴리스 구간 하단 (파워 게이지 골드 띠와 일치 — Controls가 공용)
export const RELEASE_SWEET_HI = 0.9; // 상단 (꼭대기 1.0은 직진 과속이라 일부러 구간 밖 — 풀파워 직구에 소량 노이즈)
export const RELEASE_SIGMA_MIN = 0; // 구간 안 릴리스 노이즈 (cm). 0 = 완벽 타이밍은 완벽 정확(300 가능, 실력 천장 보존).
//   ⚠️ 숙련 플레이어가 직구로 띠를 매번 맞히면 직구 천장이 안 잡힌다. 그걸 막으려면 이 값을 1~2로 올려
//   완벽 릴리스에도 바닥 분산을 주거나(300 포기), RELEASE_SWEET_* 폭을 좁혀 띠 적중을 어렵게 한다.
export const RELEASE_SIGMA_MAX = 6; // 최악 릴리스 노이즈 (cm). sim --noise 기준 σ6 = 직구 21%/훅 32% 스트라이크.
export const RELEASE_TOL = 0.3; // 구간 밖 이 거리(파워 단위)에서 σ_MAX 도달. 0.3 → power 1.0(띠+0.1)≈σ2, 패닉 릴리스(≤0.3)≈σ_MAX.

export const SETTLE_VEL_EPS = 0.05;
export const SETTLE_TIMEOUT = 4; // s
export const PIN_FALL_ANGLE = Math.PI / 4; // 45° 쓰러짐 임계

// --- P2 타격감 (juice) ---
// 공이 이 z를 넘으면 '핀 임팩트'로 취급 (셰이크·크래시 사운드·슬로모 트리거).
// 그 전(레인 굴림 중) 접촉은 기존 playHit 그대로 — 굴림 거동은 안 건드린다.
// 공이 헤드핀에 실제 닿는 z (공R0.109+핀R0.06≈0.18). 임팩트 트리거의 '접촉 시점' 기준.
export const PIN_CONTACT_Z = HEADPIN_Z - 0.18; // ≈18.11 (Boot 임팩트 push-in 카메라 트리거)
// 스트라이크/포켓 슬로모: 임팩트 순간 timeScale를 떨궜다가 복원 (Loop.timeScale 인프라 공용).
// ⚠️ 물리 dt는 불변 — accumulator 유입만 스케일 (Loop 주석 참고).
export const SLOWMO_SCALE = 0.32; // 슬로모 진입 배속 (낮을수록 더 느림) — 충돌 순간 깊이
// 슬로모 지속 (실시간 s). 0.85→0.45 단축: 히트스톱 표준(50~100ms)에 비해 인게임 슬로모는
// 길어도 되지만, 0.85s는 매 투구마다 "렉 걸린 듯" 길게 읽혔다(사용자 피드백). realism 목표상
// 시간왜곡은 최소화 — 짧게 떨궜다가 ease-out으로 복원(GameState.update, 하드컷 제거).
export const SLOWMO_REAL_SEC = 0.45;
// 카메라 셰이크: 임팩트 contact force 누적 → 진폭, 실시간 감쇠.
// 토글 OFF — 볼링 손맛은 슬로모+사운드+핀물리가 들고 있고, 화면 셰이크(평행이동 화이트노이즈)는
// 톤이 어긋나고 과하게 읽힘. 일단 끄고 실플레이 검증(P0). 허전하면 셰이크 복원이 아니라
// 핀 쪽 push-in(dolly/FOV)으로 채우는 방향.
export const SHAKE_ENABLED = false;
export const SHAKE_MAX = 0.12; // 최대 진폭 (m)
export const SHAKE_DECAY = 10; // 감쇠율 (1/s, 클수록 빨리 잦아듦 — ~0.4s)
export const SHAKE_FORCE_REF = 150; // 단일 contact force 기준값 (force/이값 비율 × KICK)
export const SHAKE_KICK = 0.05; // contact 1건당 진폭 기여 상한 (크래시는 여러 건 누적 → SHAKE_MAX)
// 임팩트 push-in (셰이크 대체 연출). 충돌 시 카메라가 시선 방향(핀 쪽)으로 dolly-in →
// 잠깐 유지 → 부드럽게 복귀. 좌우 흔들림 없이 "들여다보는" 흥분. dt는 실시간(Loop.onFrame)이라
// 슬로모(실시간 0.85s)와 자연 동기. 허전/과함은 아래 상수로 튜닝.
export const PUSHIN_ENABLED = true; // 임팩트 시 핀덱으로 살짝 lean-in (방송 카메라 느낌). 접근 카메라와 이중되지 않게 DIST는 작게.
export const PUSHIN_DIST = 0.6; // 최대 근접 dolly 거리 (m, 시선 방향) — 접근 카메라(CAM_APPROACH_Z)와 겹쳐 과하지 않게 '살짝'만
export const PUSHIN_HOLD = 0.45; // 최대 근접 유지 (실시간 s) — 핀 접촉마다 갱신
export const PUSHIN_RATE = 9; // 진입/복귀 스무딩 (1/s, 클수록 빠릿)
// 핀 접근 카메라 (P2): 공이 이 z를 넘으면 로우·와이드 팔로우 → 수평·근접 핀덱 뷰로 이징.
// 임팩트/핀 쓰러짐이 잘 보이게. 스무딩(k)이 전환을 흡수해 휙 도는 휘프팬 없이 dolly-in처럼 당겨짐.
export const CAM_APPROACH_Z = HEADPIN_Z - 6; // ≈12.29 (레인 마지막 1/3에서 전환)
