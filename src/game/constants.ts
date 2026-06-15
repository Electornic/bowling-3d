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
// 행별 핀 열 오프셋 (PIN_SPACING 배수). 행 0=헤드핀 ... 행 3=뒷줄. PinSet·splits 공용.
export const PIN_ROWS: readonly (readonly number[])[] = [
  [0],
  [-0.5, 0.5],
  [-1, 0, 1],
  [-1.5, -0.5, 0.5, 1.5],
];

// --- 핀 캐리 밸런스 (P0.5, sim-carry.mjs 그리드 스캔으로 확정) ---
// 선형 감쇠: 날아가는 핀을 감속시켜 "운 좋은 체인 스트라이크"를 억제. 0.8이면 직구 풀파워
// 윈도우 8/31→4/31, 훅 7/31 유지(1.75배). ⓓ 손맛 재튜닝(8차): 0.8은 핀이 날다 눈에 띄게
// 브레이크 걸려 "묵직/둔함"으로 읽혀 0.8→0.7로 완화(흩어짐 ~+20%, 역동성↑). 0.7은 윈도우 노이즈
// 안이라 캐리 영향 미미 — sim-carry는 --pinDamp/--flyout로 검증, AI 사다리는 ai-match-sim으로 재확인.
// 0.35 밑은 직구가 훅 추월(훅-최적 붕괴)이라 마지노선. 반발 0.3: 미드 캐리 핀-핀 전달 복원(올리면 훅 우위 깨짐 — 손대지 말 것).
export const PIN_RESTITUTION = 0.3;
export const PIN_LINEAR_DAMPING = 0.7;

// --- 물리 (도안 §4.4 튜닝 시작값) ---
export const GRAVITY = -9.81;
export const TIMESTEP = 1 / 60;
export const REF_MASS = 5.0; // 스핀 측면력 기준 질량 (≈11lb = 슬라이더 중앙)
export const FRICTION_K = 0.16; // 스핀 측면력 계수 — 드라이 존에서만 작용 (hookFactor 게이트)

// --- 오일 패턴 → 레이트 훅 (스키드→훅) ---
// 앞 구간은 오일로 미끄러져 직진, OIL_END_Z부터 마찰이 살아나며 훅이 "막판에" 꺾인다.
// ⚠️ 레인 콜라이더는 마찰 결합 Min 필수 (Lane.ts) — 기본 Average면 공 마찰(0.1)과
//    평균돼 오일 존 슬립이 일찍 닫혀 훅의 절반이 오일 존에서 새어나간다.
export const LANE_FRICTION_OIL = 0.015; // 오일 존 (직진 스키드 — 슬립 보존)
export const LANE_FRICTION_DRY = 0.14; // 드라이 존 (Rapier 자체 마찰도 훅에 가세)
export const BALL_FRICTION = 0.1;
export const OIL_END_Z = 10.5; // 오일 존 끝 — 훅 램프 시작
export const HOOK_RAMP = 3.5; // 풀 훅까지 램프 길이 (m)

/** 주입 측면력 게이트: 오일 존 0 → 드라이 존 1 (smoothstep) */
export function hookFactor(z: number): number {
  const t = Math.min(1, Math.max(0, (z - OIL_END_Z) / HOOK_RAMP));
  return t * t * (3 - 2 * t);
}
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
export const SETTLE_VEL_EPS = 0.05;
export const SETTLE_TIMEOUT = 4; // s
export const PIN_FALL_ANGLE = Math.PI / 4; // 45° 쓰러짐 임계

// --- P2 타격감 (juice) ---
// 공이 이 z를 넘으면 '핀 임팩트'로 취급 (셰이크·크래시 사운드·슬로모 트리거).
// 그 전(레인 굴림 중) 접촉은 기존 playHit 그대로 — 굴림 거동은 안 건드린다.
export const PIN_CONTACT_Z = HEADPIN_Z - 0.18; // ≈18.11 — 공(R0.109)+핀(R0.06)이 헤드핀에 실제 닿는 z. 임팩트(사운드·슬로모) 트리거.
// 스트라이크/포켓 슬로모: 임팩트 순간 timeScale를 떨궜다가 복원 (Loop.timeScale 인프라 공용).
// ⚠️ 물리 dt는 불변 — accumulator 유입만 스케일 (Loop 주석 참고).
export const SLOWMO_SCALE = 0.32; // 슬로모 배속 (낮을수록 더 느림)
export const SLOWMO_REAL_SEC = 0.85; // 슬로모 지속 (실시간 s) — 복원 정책 필수
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
