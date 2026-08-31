import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { makePinGeometry, PIN_RADIUS } from './Pin';
import { getRapier } from '../core/Boot';
import type { Engine } from '../core/Engine';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  GUTTER_DEPTH,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  PIN_DECK_END,
  KICKBACK_START_Z,
  PIN_BAY_TOP,
  PIN_BAY_CANOPY_TOP,
  PIN_BAY_FRONT_Z,
  HEADPIN_Z,
  PIN_SPACING,
  ROW_GAP,
  PIN_HEIGHT,
  PIN_PROFILE,
  PIN_STRIPES,
  BALL_RADIUS,
  BALL_START_Z,
} from '../game/constants';
import { NEON, rgba } from '../ui/theme'; // 네온 팔레트 단일소스(#5) — 씬 머티리얼·캔버스가 theme.ts와 같은 상수 공유(드리프트 0)

const LANE_START_Z = -2; // Lane.ts와 동일
const LANE_END_Z = PIN_DECK_END + 1.5;
const LANE_UNIT = LANE_WIDTH + GUTTER_WIDTH * 2 + 0.1; // 레인 1칸 폭(거터+레일)
const HALL_HALF_W = LANE_UNIT * 2.5 + 0.4; // 좌우 각 2개 옆 레인 + 여유

/**
 * 절차적 나무 보드 텍스처 (에셋 0). 톤이 조금씩 다른 세로 판자 + 이음매 + 가로 결.
 * BoxGeometry 윗면 기준 u=가로(판자), v=길이 방향.
 */
export function makeWoodTexture(light = '#c89048', dark = '#96682c', boards = 39): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  // 256→512: 판자를 39장(실제 레인 규격)으로 늘려도 이음매가 또렷하게 유지되도록 해상도 ↑.
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  const lo = new THREE.Color(dark);
  const hi = new THREE.Color(light);
  const bw = c.width / boards;
  for (let i = 0; i < boards; i++) {
    const h = Math.abs(Math.sin(i * 127.1 + 311.7)); // 결정적 의사난수 (판자 톤)
    // 톤 대비 완화(이전 0.3+0.7 → 0.6+0.35): 판자별 명암차를 줄여 원근으로 모일 때 '빗금' 인상↓.
    g.fillStyle = `#${lo.clone().lerp(hi, 0.6 + 0.35 * h).getHexString()}`;
    g.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, c.height);
    g.fillStyle = 'rgba(0,0,0,0.18)'; // 이음매 — 판자가 가늘고 촘촘해진 만큼 살짝 옅게(이전 0.3)
    g.fillRect(Math.floor(i * bw), 0, 1, c.height);
  }
  g.fillStyle = 'rgba(0,0,0,0.05)'; // 가로 결
  for (let y = 0; y < c.height; y += 14) g.fillRect(0, y, c.width, 1); // 해상도 2배 → 간격도 2배(밀도 유지)
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8; // 가는 판자가 원경(빗각)에서 어른거리지(알리아싱) 않게 (이전 4)
  return tex;
}

/**
 * 옆벽 그래픽 밴드 텍스처 — 핀 실루엣이 반복되는 수평 밴드. 에셋 0.
 *
 * ⚠️ **콘텐츠 제약이 형상에서 나온다.** 옆벽은 시선과 거의 평행해서 가로폭이 22~97%로 압축된다
 * (실측: MENU z=9.5에서 22% · AIMING z=3.5에서 56% · 정면에 가까운 건 게임오버 와이드샷뿐).
 * 가로 압축은 **세로 획의 모양은 보존하고 간격만 줄인다.** 그래서
 *   · 원 · 가로 텍스트 · 원근 그리드 → 압축되면 왜곡이 즉시 보인다
 *     (구 광고판이 신스웨이브 '해'였고, 그게 계란으로 눌려 보이던 게 이 문제였다)
 *   · 세로 모티프 반복 → 모양 그대로, 간격만 촘촘해진다  ← 이걸 쓴다
 *
 * 핀 실루엣은 constants.PIN_PROFILE을 그대로 쓴다 — 진짜 핀·배경 장식 핀과 같은 단일소스(#9).
 */
function makePosterTexture(accent: string, accent2: string): THREE.CanvasTexture {
  const W = 1024;
  const H = 164; // 밴드 실물 비율 5.0:0.8 = 6.25에 맞춤
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  // 바탕 — 벽 상부(#2b3140)보다 어둡게 깔아 밴드가 '벽에 붙은 판'으로 분리된다
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#141a26');
  bg.addColorStop(1, '#0b0f18');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);

  const pinTop = PIN_PROFILE[PIN_PROFILE.length - 1][1]; // 0.380m
  const k = (H * 0.66) / pinTop; // m → px
  const baseY = H * 0.86;
  const pitch = W / 10;
  const drawPin = (cx: number, alpha: number) => {
    g.save();
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(cx - PIN_PROFILE[0][0] * k, baseY - PIN_PROFILE[0][1] * k);
    for (const [r, y] of PIN_PROFILE) g.lineTo(cx - r * k, baseY - y * k); // 왼쪽 윤곽 위로
    for (let i = PIN_PROFILE.length - 1; i >= 0; i--) {
      g.lineTo(cx + PIN_PROFILE[i][0] * k, baseY - PIN_PROFILE[i][1] * k); // 오른쪽 윤곽 아래로
    }
    g.closePath();
    g.fillStyle = '#e9edf5';
    g.fill();
    g.clip(); // 목 띠를 핀 실루엣 안으로 가둔다
    g.fillStyle = accent;
    for (const [y0, y1] of PIN_STRIPES) {
      g.fillRect(cx - 0.07 * k, baseY - y1 * k, 0.14 * k, (y1 - y0) * k);
    }
    g.restore();
  };
  // 교대 투명도로 리듬 — 압축되면 간격이 좁아지므로 전부 같은 밀도면 울타리처럼 보인다
  for (let i = 0; i < 10; i++) drawPin(pitch * (i + 0.5), i % 2 ? 0.5 : 1);

  // 상·하 네온 룰 — 수평선은 압축돼도 '선'이라 형태 왜곡이 없다(원과 정반대)
  g.fillStyle = accent;
  g.fillRect(0, 4, W, 3);
  g.fillStyle = accent2;
  g.fillRect(0, H - 7, W, 3);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // 법선각 78°까지 가므로 필수 — 없으면 핀이 뭉개진다
  return tex;
}

/**
 * 옆벽 상부 텍스처 — 코브 라이트 워시(세로 그라디언트) + 패널 이음매(가로 반복). 에셋 0.
 *
 * 벽면(BoxGeometry 측면) UV는 **u=z(길이) · v=y(높이)** 다. 그래서 u로 반복시키면 이음매가
 * z 방향으로 늘어서 **원근 수렴선**이 되고, v의 그라디언트는 높이별 밝기가 된다.
 * 예전 옆벽은 31.6m 박스 하나에 단색이라 화면의 30%가 정보량 0이었다 — 그걸 메우는 게 목적.
 *
 * @param coveFrac 코브 라이트 높이를 이 텍스처의 v(0=아래, 1=위)로 환산한 위치.
 */
function makeWallTexture(coveFrac: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 256;
  const g = c.getContext('2d')!;
  // three는 flipY=true라 v=1이 캔버스 위쪽 → 캔버스 y = (1-v)*height
  const coveY = (1 - coveFrac) * c.height;
  g.fillStyle = '#2b3140'; // 상부 벽 본색 (쿨 슬레이트)
  g.fillRect(0, 0, c.width, c.height);
  // 코브 워시 — 코브 띠에서 아래로 길게, 위로 짧게 감쇠 (실제 간접조명이 벽을 훑는 모양)
  const wash = g.createLinearGradient(0, coveY - 74, 0, coveY + 150);
  wash.addColorStop(0, 'rgba(223,232,255,0)');
  wash.addColorStop(0.3, 'rgba(223,232,255,0.36)');
  wash.addColorStop(1, 'rgba(223,232,255,0)');
  g.fillStyle = wash;
  g.fillRect(0, 0, c.width, c.height);
  // 패널 이음매 — 한 타일에 2줄이라 반복 시 등간격이 유지된다
  g.fillStyle = 'rgba(0,0,0,0.32)';
  g.fillRect(0, 0, 2, c.height);
  g.fillRect(c.width / 2, 0, 2, c.height);
  // 바닥쪽 감쇠 — 웨인스코트와 만나는 선이 또렷해진다
  const foot = g.createLinearGradient(0, c.height - 76, 0, c.height);
  foot.addColorStop(0, 'rgba(0,0,0,0)');
  foot.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = foot;
  g.fillRect(0, 0, c.width, c.height);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping; // 높이 방향은 한 번만 (그라디언트가 반복되면 안 된다)
  t.anisotropy = 8;
  return t;
}

// --- 옆 레인 앰비언트 (배경에서 실제로 게임이 돌아간다) ---
//
// 레퍼런스: Wii Sports Bowling이 옆 레인에서 Mii들이 실제로 치는 걸 보여준다(Resort도 동일) —
// 이 장르에서 옆 레인 활동은 옵션이 아니라 표준이다.
// 기법도 레퍼런스를 따른다: 배경 활동은 **물리가 아니라 캔드(정해둔) 연출**이 정석이다.
// 그래서 리지드바디를 하나도 안 쓴다 — 4레인 × (핀 10 + 공 1)을 물리로 돌리면 동적 바디가
// 5배가 되는데, 그 거리·각도에서 물리의 이득은 0이다.
//
// ⚠️ **Lane courtesy가 이 연출의 핵심 규칙이다.** 실측으로 옆 레인 핀덱이 화면 중앙에서
// k=1 → 150px · k=2 → 297px(내 핀 무리 폭은 84px)에 **같은 높이로** 놓인다. 즉 옆 레인 액션은
// 주변시가 아니라 **내 조준 타겟 바로 옆**이고, 주변부 모션은 비자발적 주의 전환을 강제한다.
// 해법이 실제 볼링 규칙에 있다 — 인접 레인 볼러가 준비 중이거나 투구를 지켜보는 중이면
// 어프로치에 올라가지 않고 기다리며, 리그 표준은 "one lane courtesy in both directions"다.
// → **k=1(인접)은 내가 어프로치에 서 있는 동안 던지지 않고, k=2는 계속 던진다.**
//   게임적 타협이 아니라 디제틱하게 정확하고, 방해가 가장 큰 자리만 정확히 비운다.
// [튜닝] 공이 파울라인 → 포켓. **투구마다 난수** — 사람마다 공 속도가 다르고, 고정이면 랜덤한
// 간격으로 똑같은 클립이 재생되는 것처럼 읽힌다(실측: 한 투구 소요가 6.82~6.93s로 변동 1.6%).
//
// ⚠️ 물리적 정확도보다 **느리게** 잡는다. 실측으로 플레이어 공은 파울라인→핀앞(18.13m)을 2.12s에
// 가고(9.36 → 7.31 m/s 감속) 구 앰비언트 2.3s는 같은 구간 환산 2.18s로 사실상 동일했는데,
// 그래도 옆 레인이 훨씬 빨라 보였다. **플레이어 공은 카메라가 1.8m 뒤에서 따라가 화면상 거의
// 제자리에 머물기 때문**이다 — 눈이 비교하는 기준이 그거라 옆 레인은 느려야 맞다.
const AMB_ROLL_MIN = 3.0;
const AMB_ROLL_MAX = 4.0;
/**
 * 공이 핀을 지난 뒤 물리가 잦아들 때까지 두는 시간(s).
 *
 * ⚠️ 예전엔 여기가 캔드 애니메이션(`AMB_FALL_T` 0.5s + 거리 지연)이었다. 값 검증은 통과했지만
 * 실측하니 **실제 넘어짐의 시간축이 뒤집혀 있었다**: 각속도가 출발 9.49 rad/s → 착지 0.47로
 * 단조 감소(물리 기준 √(3g/L)=8.8 rad/s로 **가속해 부딪혀야** 한다). 거기에 핀이 서 있는 핀을
 * 관통(4투구 223 프레임-쌍, 최소 4.5mm)하고 꼭대기가 레인을 4.2cm 파고들었다.
 * 셋 다 "물리가 없다"는 한 원인의 증상이라 강체로 바꿨다 (근거·수치는 updateAmbient 주석).
 */
const AMB_SETTLE_T = 1.4;
// [튜닝] 넘어진 채 유지 — 기계가 반응하는 타이밍도 매번 조금씩 다르다.
// (기계 구간 자체는 고정 유지 — 플레이 레인과 같은 기계라 여기가 흔들리면 '배속'으로 돌아간다.)
const AMB_HOLD_MIN = 0.4;
const AMB_HOLD_MAX = 1.3;
// ⚠️ 기계 타이밍은 **플레이 레인 핀세터(PinSet의 CY_*)와 같아야 한다.** 같은 볼링장의 같은
// 기계인데 옆에서 더 빠르게 돌면 배속으로 보인다 — 실제로 그렇게 보였다(사용자 지적).
// PinSet rack 경로: 가드 0.55 → 스윕 1.00 → 복귀 0.45 → 세팅 0.60 → 종료 0.45 = 3.05s.
// 예전 값(0.25/0.50/0.40/0.55/0.35 = 2.05s)은 특히 가드·스윕이 2배 빨랐다.
const AMB_GUARD_T = 0.55; // 레이크 하강 (PinSet CY_GUARD)
const AMB_SWEEP_T = 1.0; // 레이크 전진 (CY_LIFT→CY_SWEEP)
const AMB_SET_T = 0.45; // 레이크 복귀 (CY_SWEEP→CY_RETURN)
const AMB_RACK_T = 0.6; // 새 랙 하강 (CY_RETURN→CY_SET)
const AMB_LIFT_T = 0.45; // 테이블·레이크가 기계 안으로 (CY_SET→CY_END)
const AMB_GAP_MIN = 6; // [튜닝] 다음 투구까지 대기(초). 너무 잦으면 산만해진다 — 주 노브
/**
 * courtesy 상한(초). 상대가 계속 안 던지면 실제 볼링장에서도 그냥 간다 —
 * 홀드 창이 좁아졌어도(던지는 동안만) 차징을 무한히 붙잡는 등의 경우에 인접 레인이 굶지 않게.
 */
const AMB_COURTESY_MAX = 8;
const AMB_GAP_MAX = 14;
/** 랙 하강 시작 높이. 개구부(PIN_BAY_TOP 0.6) 위에서 시작해 캐노피에 가려 있다가 내려온다. */
const AMB_SET_LIFT = 0.62;
/** 공이 핀덱을 **통과해** 사라지는 z. 예전엔 핀 앞(0.16m)에서 숨겼지만 이제 실제로 쳐야 한다. */
const AMB_BALL_END_Z = PIN_DECK_END + 0.55;
/**
 * 공을 캔드 경로에서 **물리에 넘기는** z (헤드핀 앞).
 *
 * ⚠️ 왜 넘기는가: 키네마틱 바디는 무한 질량이라 반작용을 안 받는다. 핀에 v·(1+e)를 그대로 주는데
 * 실제 공(6.35kg)은 질량비 M/(M+m)=0.81만큼만 준다 — **약 25% 과잉**이다. 실측으로도 옆 레인
 * 핀 꼭대기가 0.70m까지 떴다(플레이 레인 실측은 24구 82,278 핀프레임에서 **최대 0.518**).
 * 그래서 접근(속도·훅 = 지각되는 부분)까지만 캔드로 몰고, **충돌 순간엔 진짜 질량으로 부딪히게** 한다.
 */
const AMB_BALL_HANDOFF_Z = HEADPIN_Z - 0.8;
/** 하우스 볼 14lb. 질량비가 핀이 튀는 높이를 정하므로 진짜 공과 같은 값이어야 한다. */
const AMB_BALL_MASS = 6.35;
/** 옆 레인 레인면 y — 시각 바닥(중심 -0.06, 두께 0.1)의 윗면. 플레이 레인보다 1cm 낮다. */
const AMB_FLOOR_TOP = -0.01;
/** 직립 핀 몸통 중심 높이(= 강체 원점). 콜라이더가 cylinder라 밑동이 아니라 중심 기준이다. */
const AMB_PIN_CY = AMB_FLOOR_TOP + PIN_HEIGHT / 2;
/** 쓸어낸 핀이 머무는 은폐 구간 끝. 베이 뒷벽 뒤라 안 보인다 — 물리 바닥·킥백을 여기까지 깐다. */
const AMB_SWEEP_END_Z = LANE_END_Z + 0.5;
/** 직립 자세 · 정지 — holdAmbPin이 매 프레임 쓰는 무할당 상수. */
const AMB_UPRIGHT = { x: 0, y: 0, z: 0, w: 1 };
const ZERO3 = { x: 0, y: 0, z: 0 };
// 레이크 포즈. 값은 플레이 레인 스윕 바(PinSet)의 튜닝값을 그대로 따른다 — 같은 볼링장의 같은
// 기계이므로 눈높이가 다르면 안 된다. 대기 높이 1.2는 캐노피(0.6~1.95) 안이라 가려진다.
const AMB_RAKE_Y_UP = 1.2;
const AMB_RAKE_Y_DOWN = 0.16;
const AMB_RAKE_Z0 = HEADPIN_Z - 0.45; // 가드 위치(볼러 쪽) = 쓸기 시작점
const AMB_RAKE_Z1 = LANE_END_Z + 0.3; // 쓸기 끝 — 베이 뒷벽(20.55~20.65) 뒤라 핀·레이크 모두 은폐
/** 핀 테이블 밑면이 핀 꼭대기보다 이만큼 위 — 테이블이 핀을 '물고' 내려오는 것처럼 보이게. */
const AMB_TABLE_OFF = PIN_HEIGHT + 0.03;

type AmbPhase = 'idle' | 'roll' | 'settle' | 'hold' | 'guard' | 'sweep' | 'set' | 'rack' | 'lift';

interface AmbPin {
  mesh: THREE.Mesh;
  /** 다이나믹 강체. 낙하는 물리가 하고, 기계 사이클 동안만 매 프레임 자세를 덮어쓴다(Pin.hold와 같은 방식). */
  body: RAPIER.RigidBody;
  /** 직립 스폿. y는 항상 AMB_PIN_CY — 콜라이더가 cylinder라 강체 원점이 몸통 **중심**이다. */
  home: { x: number; z: number };
}

interface AmbientLane {
  /** true = 인접 레인(k=1) — lane courtesy 대상 */
  courtesy: boolean;
  cx: number;
  pins: AmbPin[];
  ball: THREE.Mesh;
  /** 공. 접근은 키네마틱(캔드 경로), 헤드핀 앞에서 다이나믹으로 넘어가 진짜 질량으로 부딪힌다. */
  ballBody: RAPIER.RigidBody;
  /** 이미 물리에 넘어갔는가 — true면 더 이상 경로가 몰지 않는다. */
  ballLive: boolean;
  rng: () => number;
  rake: THREE.Group; // 스윕 바(레이크) — 기계가 보여야 '오뚜기'가 아니라 리셋으로 읽힌다
  /** 레이크 블레이드의 키네마틱 콜라이더 — 서 있는 핀을 물리로 눕히며 쓴다(특수 처리 불필요). */
  rakeBody: RAPIER.RigidBody;
  table: THREE.Mesh; // 핀 테이블 — 새 랙을 내려놓는 판
  phase: AmbPhase;
  t: number;
  wait: number;
  entryX: number;
  rollT: number; // 이번 투구의 공 속도(파울라인→포켓 소요 s) — 투구마다 뽑는다
  holdT: number; // 이번 투구의 넘어진 채 유지 시간
  /** courtesy로 막힌 동안 뽑아두는 디싱크 지연 — 인접 두 레인이 해제 프레임에 동시 출발하는 것 방지 */
  desync: number;
  pocketX: number; // 이번 투구가 들어간 포켓(레인 중앙 대비) — 공이 실제로 들어가는 자리
}

/**
 * 옆 레인용 레이크(스윕 바) — 플레이 레인 스윕 바(PinSet)의 축약판.
 *
 * 이게 없으면 사이클이 "핀이 몇 개 눕는다 → 오뚜기처럼 일어난다"로 읽힌다(사용자 지적).
 * 기계가 보여야 같은 움직임이 '리셋'으로 읽힌다. 형상·색은 플레이 레인과 같게 맞춘다 —
 * 같은 볼링장의 같은 기계라 눈높이가 다르면 오히려 이상해진다.
 * 블레이드에 키네마틱 콜라이더가 붙어 **핀을 실제로 민다** — 서 있던 핀은 밀리며 알아서 눕는다.
 * (플레이 레인 스윕은 여전히 z 비교로 미는 시각 처리다. 눈높이만 같으면 되고, 이쪽이 더 정확하다.)
 */
/**
 * 옆 레인 정적 콜라이더 — 바닥·거터·킥백·뒷벽. 치수는 플레이 레인(Lane.ts)을 cx로 평행이동한 것이고
 * 시각 메시와 같은 자리를 쓴다(윗면 AMB_FLOOR_TOP = 플레이 레인보다 1cm 아래).
 *
 * ⚠️ 킥백은 Lane.ts의 KICK_T(0.05)가 아니라 **0.10**이다. 옆 레인 핀엔 CCD를 안 켰는데
 * (배경 40개 × CCD는 비싸다) 60Hz에서 4 m/s로 날아가는 핀은 스텝당 0.067m를 지나 5cm 벽을
 * 그냥 통과한다. 벽은 메시가 없어(시각 벽은 별도) 두껍게 해도 보이는 게 없다.
 *
 * **0.10이 상한이다.** 안쪽 면은 Lane.ts와 같은 cx±(half+gw)=±0.755에 고정하고 두께는 바깥으로만
 * 자라는데, 옆 레인1의 내측벽에서 '바깥'은 곧 플레이 레인 쪽이다. 0.10이면 벽이 x 0.755~0.855 —
 * 플레이 레인 **캐핑 보드가 이미 차지한 자리**에 정확히 겹쳐 무해하다. 0.15로 하면 0.705까지
 * 내려와 플레이 레인 거터(0.525~0.755) 안으로 5cm 들어가고, 거터볼이 안 보이는 벽에 부딪힌다.
 *
 * 바닥·킥백은 AMB_SWEEP_END_Z까지 이어진다 — 레이크가 쓸어낸 핀이 베이 뒷벽 뒤에서 멈춰야 하고,
 * 거기까지 바닥이 없으면 핀이 허공으로 떨어진다.
 */
function buildAmbLanePhysics(engine: Engine, cx: number) {
  const RAPIER = getRapier();
  const half = LANE_WIDTH / 2;
  const gw = GUTTER_WIDTH;
  const KICK_T = 0.1;
  const floorLen = AMB_SWEEP_END_Z - LANE_START_Z;
  const floorMid = (LANE_START_Z + AMB_SWEEP_END_Z) / 2;
  const fixedAt = (x: number, y: number, z: number) =>
    engine.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));

  // 레인 바닥 — 마찰 0.2. 핀 콜라이더가 Max 결합이라 핀-레인은 max(0.3, 0.2)=0.3으로 플레이 레인과 같다.
  engine.world.createCollider(
    RAPIER.ColliderDesc.cuboid(half, 0.05, floorLen / 2).setFriction(0.2),
    fixedAt(cx, AMB_FLOOR_TOP - 0.05, floorMid),
  );
  for (const s2 of [-1, 1]) {
    // 거터 바닥 (마찰 0.08 — Lane.ts 거터와 동일)
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(gw / 2, 0.05, floorLen / 2).setFriction(0.08),
      fixedAt(cx + s2 * (half + gw / 2), -GUTTER_DEPTH - 0.05, floorMid),
    );
    // 킥백 벽 — 핀덱 구간에만(플레이 레인과 같은 z 범위). 여기가 있어야 핀이 옆 레인으로 안 넘어간다.
    const kickLen = AMB_SWEEP_END_Z - KICKBACK_START_Z;
    // 높이는 시각 개구부(PIN_BAY_TOP 0.6)가 아니라 **−0.10 ~ 1.20**이다. 메시가 없어 안 보이고,
    // 0.6 위는 어차피 캐노피에 가린다. 두 가지를 막는다:
    //  · 아래로 — 거터 바닥(−0.0476)이 벽 밑면(−0.01)보다 낮아 3.8cm 틈이 있었다(거터 핀이 빠진다).
    //  · 위로 — 튀어오른 핀이 벽을 넘어 월드 밖으로 떨어졌다(실측 y −1.28까지).
    const kickY0 = -0.1;
    const kickY1 = 1.2;
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(KICK_T / 2, (kickY1 - kickY0) / 2, kickLen / 2),
      fixedAt(
        cx + s2 * (half + gw + KICK_T / 2),
        (kickY0 + kickY1) / 2,
        (KICKBACK_START_Z + AMB_SWEEP_END_Z) / 2,
      ),
    );
  }
  // 뒷벽 — 쓸려간 핀이 여기서 멈춘다(베이 뒷벽 뒤라 안 보인다).
  engine.world.createCollider(
    RAPIER.ColliderDesc.cuboid(half + gw, PIN_BAY_TOP / 2, 0.05),
    fixedAt(cx, AMB_FLOOR_TOP + PIN_BAY_TOP / 2, AMB_SWEEP_END_Z),
  );
}

function makeAmbRake(cx: number): THREE.Group {
  const W = LANE_WIDTH + 2 * GUTTER_WIDTH + 0.06;
  const H = 0.14;
  const T = 0.014;
  const g = new THREE.Group();
  g.add(
    new THREE.Mesh(
      new THREE.BoxGeometry(W, H, T),
      new THREE.MeshStandardMaterial({ color: 0x8f98a6, metalness: 0.85, roughness: 0.35 }),
    ),
  );
  const lip = new THREE.Mesh(
    new THREE.BoxGeometry(W, 0.026, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xb3bbc7, metalness: 0.9, roughness: 0.28 }),
  );
  lip.position.y = H / 2 - 0.013;
  g.add(lip);
  // 네온 액센트 — 멀리서 '바가 지나간다'를 읽히게 하는 신호(플레이 레인과 동일 의도)
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(W * 0.985, 0.014, 0.014),
    new THREE.MeshStandardMaterial({ color: 0x0a1a20, emissive: 0x22d3ee, emissiveIntensity: 2.4, roughness: 1 }),
  );
  accent.position.set(0, H / 2 - 0.036, -T / 2 - 0.007);
  g.add(accent);
  // 매달린 팔 — 없으면 판이 허공에 떠서 미끄러지는 것처럼 보인다
  const armMat = new THREE.MeshStandardMaterial({ color: 0x4d5560, metalness: 0.8, roughness: 0.38 });
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.6, 0.06), armMat);
    post.position.set(side * (W / 2 - 0.03), H / 2 + 0.3, 0);
    g.add(post);
  }
  g.position.set(cx, AMB_RAKE_Y_UP, AMB_RAKE_Z0); // 대기 = 캐노피 안(가려짐)
  return g;
}

/** 옆 레인용 핀 테이블 — 새 랙을 내려놓는 판. 이게 있어야 하강이 '기계'로 읽힌다. */
function makeAmbTable(cx: number): THREE.Mesh {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(LANE_WIDTH - 0.04, 0.06, PIN_DECK_END - HEADPIN_Z + 0.18),
    new THREE.MeshStandardMaterial({ color: 0x3a4250, metalness: 0.7, roughness: 0.42 }),
  );
  m.position.set(cx, AMB_SET_LIFT + AMB_TABLE_OFF, (HEADPIN_Z + PIN_DECK_END) / 2);
  return m;
}

/** smoothstep — 기계 동작은 등속이면 순간 출발·순간 정지로 보인다(플레이 레인과 같은 처리). */
const smooth = (u: number) => u * u * (3 - 2 * u);

/**
 * 결정적 의사난수 (레인별 시드) — 새로고침마다 달라지면 눈으로 검증이 안 된다.
 * 앰비언트는 점수·물리에 무영향이라 품질은 중요하지 않고 재현성만 필요하다.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 볼링장 배경 (시각 전용, 충돌체 없음).
 * 옆 레인×4 + 어프로치 바닥 + 양쪽 벽 + 천장(조명 스트립) + 핀덱 마스킹·네온 + 레인 마커.
 * 목적: 화면을 채우는 실내감 + 원근감 단서(수렴선·반복 구조물).
 */
export class Environment {
  // 핀 뒤 애니메이션 전광판 (절차적 캔버스, 매 프레임 갱신)
  private readonly screenCtx: CanvasRenderingContext2D;
  private readonly screenTex: THREE.CanvasTexture;
  private time = 0;
  private lastDraw = -1; // 전광판 마지막 재드로우 시각(#2 스로틀). -1 = 첫 프레임 강제 드로우.
  private announceText = '';
  private announceColor: string = NEON.pink;
  private announceUntil = 0;
  // 커스텀 전광판 (히든 보상). null이면 기본 신스웨이브를 그린다.
  private customImg: HTMLImageElement | null = null;
  private customReady = false;
  // GIF는 <img> 애니메이션에 기대지 않고 프레임을 직접 디코드해 돌린다 (아래 startGif 주석 참고).
  private gifDecoder: ImageDecoder | null = null;
  private gifFrame: VideoFrame | null = null;
  private gifTimer: number | null = null;
  // 옆 레인 앰비언트 (배경 게임). 물리 없음 — 캔드 연출.
  private readonly ambient: AmbientLane[] = [];
  // 커스텀 비디오 (§2차). 이미지/GIF와 배타 — 하나만 켜진다.
  private videoEl: HTMLVideoElement | null = null;
  private videoUrl: string | null = null;

  constructor(engine: Engine) {
    const RAPIER = getRapier(); // 옆 레인 핀·공·레이크를 강체로 올린다 (도안 §5.2와 같은 월드)
    const len = LANE_END_Z - LANE_START_Z;
    const midZ = (LANE_START_Z + LANE_END_Z) / 2;
    const half = LANE_WIDTH / 2;

    const woodNeighbor = makeWoodTexture('#a8763a', '#7d5524');
    woodNeighbor.repeat.set(1, 7);
    const matLane = new THREE.MeshStandardMaterial({ map: woodNeighbor, roughness: 0.55 });
    const matGutter = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.7 });
    const matCap = new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 1, metalness: 0, envMapIntensity: 0 }); // Lane.ts 캐핑과 동일 톤
    // 배경 장식 핀 — 진짜 핀(Pin.ts)과 같은 병 실루엣 LatheGeometry. (예전 단순 원뿔 실린더라 어색했음.)
    // base가 y=0, 꼭대기 y≈0.38. 배경이라 세그먼트는 적게(12). 프로파일은 constants.PIN_PROFILE 단일소스 공유(#9).
    // 진짜 핀과 같은 헬퍼 — 목 빨간 띠까지 공유한다(한쪽만 민무늬면 같은 화면에서 티가 난다).
    // 세그먼트는 12→16만: 장식이라 항상 멀리 있고 4레인 × 10개 = 40개다.
    const pinGeo = makePinGeometry(16);
    // 원점을 밑동 → 몸통 **중심**으로. cylinder 콜라이더의 원점이 중심이라 Engine.sync가 그대로 맞는다
    // (Pin.ts의 진짜 핀도 같은 이유로 같은 보정을 한다).
    pinGeo.translate(0, -PIN_HEIGHT / 2, 0);
    const pinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    // 앰비언트 공 — 4레인 공용. 어둡고 채도 낮게: 배경 모션이 내 조준에서 시선을 덜 끌어야 한다
    // (주변부 모션은 비자발적 주의 전환을 강제한다 — 위 Lane courtesy 주석 참고).
    const ambBallGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    const ambBallMat = new THREE.MeshStandardMaterial({ color: 0x2e3646, roughness: 0.35, metalness: 0.1 });

    // --- 옆 레인 ×2 (양쪽, 장식용) ---
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 2; k++) {
        const cx = side * k * LANE_UNIT;
        buildAmbLanePhysics(engine, cx); // 바닥·거터·킥백·뒷벽 — 핀이 실제로 놓이고 튕길 면
        const floor = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH, 0.1, len), matLane);
        floor.position.set(cx, -0.06, midZ); // 플레이 레인보다 1cm 낮게 (구분감)
        floor.receiveShadow = true;
        engine.addVisual(floor);
        for (const s2 of [-1, 1]) {
          const gut = new THREE.Mesh(new THREE.BoxGeometry(GUTTER_WIDTH, 0.1, len), matGutter);
          // 윗면을 플레이 레인 거터와 같은 -GUTTER_DEPTH로. 예전 -0.18(윗면 -0.13)은 옛 거터 깊이가
          // 남은 값이라, 홀을 평탄화하고 나니 옆 레인만 도랑처럼 깊게 파여 보였다.
          gut.position.set(cx + s2 * (half + GUTTER_WIDTH / 2), -GUTTER_DEPTH - 0.05, midZ);
          engine.addVisual(gut);
        }
        // 핀 10개 (정삼각형) — 더는 '장식'이 아니다. 앰비언트 사이클에서 실제로 넘어지고 다시 선다.
        // ⚠️ castShadow를 켜지 말 것 — Boot이 조준/메뉴 중 shadowMap.autoUpdate를 끄므로(정적화)
        //    움직이는 물체가 그림자를 지면 멈춘 그림자가 남는다. 배경이라 그림자 없어도 티가 안 난다.
        const pins: AmbPin[] = [];
        for (let r = 0; r < 4; r++) {
          for (let c2 = 0; c2 <= r; c2++) {
            const pin = new THREE.Mesh(pinGeo, pinMat);
            const hx = cx + (c2 - r / 2) * PIN_SPACING;
            const hz = HEADPIN_Z + r * ROW_GAP;
            pin.position.set(hx, AMB_PIN_CY, hz);
            const body = engine.world.createRigidBody(
              RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(hx, AMB_PIN_CY, hz)
                .setLinearDamping(PIN_LINEAR_DAMPING),
            );
            // 진짜 핀(Pin.ts)과 같은 질량·반발·마찰. **ActiveEvents는 켜지 않는다** —
            // contact force 이벤트는 Engine.onContact로 흘러 clack 사운드가 되므로, 배경 레인이
            // 소리를 내면 내 투구와 구분이 안 된다.
            engine.world.createCollider(
              RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
                .setMass(PIN_MASS)
                .setRestitution(PIN_RESTITUTION)
                .setFriction(0.3)
                .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max),
              body,
            );
            engine.add({ mesh: pin, body }); // addVisual이 아니다 — 보간 대상으로 등록
            pins.push({ mesh: pin, body, home: { x: hx, z: hz } });
          }
        }
        const ball = new THREE.Mesh(ambBallGeo, ambBallMat);
        ball.visible = false;
        // 키네마틱 — 훅 경로·소요시간(3~4s)은 튜닝된 캔드 값 그대로 두고, 핀만 물리로 친다.
        // 다이나믹으로 굴리면 그 두 값이 물리에 넘어가 "옆 레인이 빨라 보인다"를 다시 열게 된다.
        const ballBody = engine.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, -50, BALL_START_Z),
        );
        engine.world.createCollider(
          RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(AMB_BALL_MASS).setFriction(0.05).setRestitution(0.2),
          ballBody,
        );
        engine.add({ mesh: ball, body: ballBody });
        // 주차 중엔 캐노피에 가려 안 보이지만, 그려는 진다 → 레인당 6드로우콜이 상시 낭비.
        // guard에서 켜고 lift 끝에서 끈다(사이클의 60%가 주차 상태다).
        const rake = makeAmbRake(cx);
        rake.visible = false;
        engine.addVisual(rake);
        // 블레이드만 콜라이더로. 이게 있어서 '서 있던 핀을 눕히며 쓴다'가 특수 처리 없이 나온다.
        const rakeBody = engine.world.createRigidBody(
          RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, AMB_RAKE_Y_UP, AMB_RAKE_Z0),
        );
        engine.world.createCollider(
          RAPIER.ColliderDesc.cuboid((LANE_WIDTH + 2 * GUTTER_WIDTH + 0.06) / 2, 0.07, 0.04),
          rakeBody,
        );
        const table = makeAmbTable(cx);
        table.visible = false;
        engine.addVisual(table);
        this.ambient.push({
          courtesy: k === 1,
          cx,
          pins,
          ball,
          ballBody,
          rake,
          rakeBody,
          table,
          rng: mulberry32(0x9e3779b9 ^ (side * 977 + k * 131)),
          phase: 'idle',
          t: 0,
          // 초기 위상만 흩어 놓는다 — 4레인이 동시에 던지면 배경이 아니라 이벤트가 된다
          wait: 1.5 + k * 2.3 + (side < 0 ? 1.7 : 0),
          entryX: 0,
          rollT: AMB_ROLL_MIN,
          holdT: AMB_HOLD_MIN,
          desync: 0,
          pocketX: 0,
          ballLive: false,
        });
      }
      // 레인 사이 캐핑 보드 — 실제 볼링장은 레인들이 한 평면으로 붙어 있고 솟은 칸막이가 없다.
      // k=0(플레이 레인 경계, x≈±0.805)은 건너뜀 — 그 자리는 Lane.ts의 캐핑이 정확히 차지한다.
      // 원근 단서는 이제 능선이 아니라 레인/거터/캐핑이 만드는 색 띠의 수렴선이 담당한다
      // (천장 조명 스트립 3줄 + 레인 화살표가 보강).
      for (let k = 1; k <= 2; k++) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), matCap);
        cap.position.set(side * (LANE_UNIT / 2 + k * LANE_UNIT), -0.05, midZ); // 윗면 y=0
        cap.receiveShadow = true;
        engine.addVisual(cap);
      }
    }

    // --- 어프로치(투구 구역) 바닥 ---
    const woodApproach = makeWoodTexture('#8a6234', '#64461f', 12);
    woodApproach.repeat.set(8, 3);
    const approach = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.1, 7),
      new THREE.MeshStandardMaterial({ map: woodApproach, roughness: 0.6 }),
    );
    approach.position.set(0, -0.05, LANE_START_Z - 3.5);
    approach.receiveShadow = true;
    engine.addVisual(approach);

    // --- 핀덱 뒤 마스킹 월 + 네온 띠 ---
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 3.6, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.9 }),
    );
    wall.position.set(0, 1.8, LANE_END_Z + 0.45);
    engine.addVisual(wall);

    // 핀 위 캐노피(마스킹 유닛) + 전면 네온 2줄
    // 캐노피 = 베이 천장. 앞면은 네온 띠(z≈17.77) 바로 뒤에 두고, 뒤로는 마스킹 월까지 이어
    // 붙여 베이 위를 닫는다 — 예전엔 z 19.99에서 끊겨 베이 천장에 구멍이 났고,
    // 그 틈으로 뒷벽이 보여 핀이 '박스 안'이 아니라 평면 위에 놓인 것처럼 읽혔다.
    const bayFrontZ = PIN_BAY_FRONT_Z;
    const maskFaceZ = LANE_END_Z + 0.45 - 0.125; // 마스킹 월 앞면
    const canopyLen = maskFaceZ - bayFrontZ;
    const canopyH = PIN_BAY_CANOPY_TOP - PIN_BAY_TOP;
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, canopyH, canopyLen),
      new THREE.MeshStandardMaterial({ color: 0x12161f, roughness: 0.85 }),
    );
    canopy.position.set(0, PIN_BAY_TOP + canopyH / 2, bayFrontZ + canopyLen / 2);
    engine.addVisual(canopy);

    // --- 핀 베이 측벽(킥백) — 레인 5개 전부 ---
    // 실제 볼링장은 레인마다 핀덱이 양옆 킥백 + 위 캐노피 + 뒤 마스킹 월로 둘러싸인 박스 안에 있다.
    // 이게 없으면 핀이 '안으로 들어가 있는' 느낌이 안 나고, 플레이 레인에만 있으면 더 어색하다.
    // 시각 전용 — 플레이 레인의 물리 킥백 콜라이더는 Lane.ts가 같은 높이(PIN_BAY_TOP)로 만든다.
    const matKick = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 1, metalness: 0, envMapIntensity: 0 });
    const bayLen = maskFaceZ - KICKBACK_START_Z;
    for (const side of [-1, 1]) {
      for (let k = 0; k <= 2; k++) {
        const kick = new THREE.Mesh(new THREE.BoxGeometry(0.1, PIN_BAY_TOP, bayLen), matKick);
        kick.position.set(side * (LANE_UNIT / 2 + k * LANE_UNIT), PIN_BAY_TOP / 2, KICKBACK_START_Z + bayLen / 2);
        kick.receiveShadow = true;
        engine.addVisual(kick);
      }
    }

    // 베이 뒷벽 — 개구부 높이만큼(y 0~PIN_BAY_TOP) 홀 전폭을 막는다. 전광판(z≈20.69) **앞**에
    // 둬야 아랫단을 가린다. 이게 없으면 핀 뒤로 전광판이 비쳐 '뚫린' 것처럼 보인다.
    // 플레이 레인 피트는 y<0이라 안 가려진다(공이 떨어지는 건 그대로 보인다).
    const bayBack = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, PIN_BAY_TOP, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 1, metalness: 0, envMapIntensity: 0 }),
    );
    bayBack.position.set(0, PIN_BAY_TOP / 2, LANE_END_Z + 0.02); // 전광판(+0.11)보다 앞
    bayBack.receiveShadow = true;
    engine.addVisual(bayBack);
    // (마스킹 유닛 아랫단 네온 트림 2줄은 제거했다 — 전광판을 개구부 바로 위까지 내린 뒤로는
    //  전광판과 핀 사이를 가로지르는 굵은 띠로만 읽혔다. 낮은 접근 카메라에선 특히 화면을 먹었다.)

    // --- 양쪽 벽 (3단) + 천장(코퍼드) + 조명 ---
    //
    // 예전엔 옆벽 = 31.6m 박스 1개에 단색(#161b26), 천장 = 평면 1개에 스트립 3줄이었다.
    // 실측(레이캐스트)에서 **가로 화면 조준 시 맨살 옆벽이 29.7%** — 플레이 레인(14.4%)의 두 배가
    // 정보량 0인 검은 면이었고, 세로 화면에선 가로 FOV가 좁아 그 자리를 **천장 17.6%**가 대신했다.
    // 픽셀 휘도로도 레인 0.869 vs 벽 0.055~0.098 · 천장 0.044 — 20:1이라 '면'이 아니라 '구멍'으로 읽혔다.
    //
    // 그래서 밝히는 게 아니라 **구조를 넣는다**(실제 볼링장 벽·천장이 그렇다):
    //  · 벽 = 하부 웨인스코트(우드) / 체어 레일 / 코브 워시 상부 → 수평 수렴선 2줄 + 판자·이음매 리듬
    //  · 천장 = 스트립 3줄은 그대로 두고 그 **사이사이**를 보(beam)로 메워 코퍼드 격자
    // 세로·가로가 서로 다른 면 때문에 휑하므로 둘 다 손대야 한다(한쪽만 하면 한쪽은 그대로다).
    const WALL_LEN = len + 9;
    const WALL_Z = midZ - 3;
    const WAINSCOT_TOP = 1.0; // 체어 레일 높이 (실제 웨인스코트 ~0.9~1.1m)
    const WALL_STRUCT_TOP = 4.25; // 벽 상단 — 천장(4.0~4.2)과 겹쳐 이음선을 감춘다
    const CEIL_UNDER = 4.0; // 천장 아랫면
    // 코브는 옆벽 광고판(y 1.8~3.0) **위**에 둔다 — 겹치면 광고판이 코브 선을 4번 끊는다.
    const COVE_Y = 3.25;

    const wallTex = makeWallTexture((COVE_Y - WAINSCOT_TOP) / (WALL_STRUCT_TOP - WAINSCOT_TOP));
    wallTex.repeat.set(Math.round(WALL_LEN / 1.6), 1); // 패널 폭 ≈0.8m (타일당 이음매 2줄)
    const matWallUp = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, metalness: 0 });
    // 웨인스코트 — makeWoodTexture의 판자(u축)가 벽면에선 **세로결**이 된다. z로 반복돼 리듬을 만든다.
    const wainTex = makeWoodTexture('#5a3f20', '#3a2712', 10);
    wainTex.repeat.set(Math.round(WALL_LEN / 1.5), 1); // 판자 폭 ≈0.15m
    const matWain = new THREE.MeshStandardMaterial({ map: wainTex, roughness: 0.8 });
    const matRail = new THREE.MeshStandardMaterial({ color: 0x394153, roughness: 0.7 });
    const matCove = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: NEON.ice,
      emissiveIntensity: 1.35, // 천장 스트립(1.6)보다 살짝 죽여 시선이 위로 안 끌리게
    });
    for (const side of [-1, 1]) {
      const up = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, WALL_STRUCT_TOP - WAINSCOT_TOP, WALL_LEN),
        matWallUp,
      );
      up.position.set(side * HALL_HALF_W, (WAINSCOT_TOP + WALL_STRUCT_TOP) / 2, WALL_Z);
      engine.addVisual(up);

      const wain = new THREE.Mesh(new THREE.BoxGeometry(0.3, WAINSCOT_TOP + 0.25, WALL_LEN), matWain);
      wain.position.set(side * HALL_HALF_W, (WAINSCOT_TOP - 0.25) / 2, WALL_Z); // 아래 -0.25(바닥 아래)까지
      wain.receiveShadow = true;
      engine.addVisual(wain);

      // 체어 레일·코브는 벽면보다 살짝 튀어나오게(두께 ↑) — 얇은 그림자선이 생겨 수평선이 또렷해진다.
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.07, WALL_LEN), matRail);
      rail.position.set(side * HALL_HALF_W, WAINSCOT_TOP, WALL_Z);
      engine.addVisual(rail);

      const cove = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.07, WALL_LEN), matCove);
      cove.position.set(side * HALL_HALF_W, COVE_Y, WALL_Z);
      engine.addVisual(cove);
    }

    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.2, WALL_LEN),
      // 0x0e1118 → 살짝 올림. 보를 얹을 '바탕'이 필요해서지, 밝히려는 게 아니다(실제 천장도 어둡다).
      new THREE.MeshStandardMaterial({ color: 0x171c26, roughness: 0.95 }),
    );
    ceiling.position.set(0, CEIL_UNDER + 0.1, WALL_Z);
    engine.addVisual(ceiling);

    // 조명 스트립 3줄 — 그대로 유지. 실측/스크린샷에서 **수렴선 역할을 제대로 하고 있던** 유일한
    // 천장 요소다. 보를 이 위에 겹쳐 끊지 않도록, 보는 스트립 사이 x 구간에만 넣는다(아래).
    const STRIP_X = [-2.4, 0, 2.4];
    const STRIP_HALF_W = 0.15;
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: NEON.ice,
      emissiveIntensity: 1.6,
    });
    for (const x of STRIP_X) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(STRIP_HALF_W * 2, 0.06, len + 7), stripMat);
      strip.position.set(x, 3.96, WALL_Z); // 천장 수렴선 = 강한 원근 단서
      engine.addVisual(strip);
    }

    // 천장 보(beam) — 레인 직각으로 2.5m마다. 스트립이 지나는 x 구간은 비워 4토막으로 넣는다
    // (스트립을 가로질러 끊으면 애써 살아 있던 수렴선이 죽는다). 세그먼트 폭이 달라 스케일을
    // 인스턴스마다 넣는다. InstancedMesh라 4×13=52개가 드로우콜 1개.
    const BEAM_GAP = 2.5;
    const beamZ0 = WALL_Z - WALL_LEN / 2 + 0.5;
    const beamRows = Math.floor((WALL_LEN - 1.0) / BEAM_GAP) + 1;
    const gaps: [number, number][] = []; // 스트립 사이·바깥의 x 구간
    let edge = -HALL_HALF_W;
    for (const x of STRIP_X) {
      gaps.push([edge, x - STRIP_HALF_W]);
      edge = x + STRIP_HALF_W;
    }
    gaps.push([edge, HALL_HALF_W]);
    const beamGeo = new THREE.BoxGeometry(1, 0.2, 0.22); // 폭 1 = 인스턴스 스케일로 늘린다
    const matBeam = new THREE.MeshStandardMaterial({ color: 0x323b4c, roughness: 0.9 }); // 천장(0x171c26)보다 밝게 — 바운스광에서 격자가 읽히도록
    const beams = new THREE.InstancedMesh(beamGeo, matBeam, beamRows * gaps.length);
    const _m = new THREE.Matrix4();
    let bi = 0;
    for (let r = 0; r < beamRows; r++) {
      for (const [x0, x1] of gaps) {
        _m.makeScale(x1 - x0, 1, 1);
        _m.setPosition((x0 + x1) / 2, CEIL_UNDER - 0.1, beamZ0 + r * BEAM_GAP);
        beams.setMatrixAt(bi++, _m);
      }
    }
    beams.instanceMatrix.needsUpdate = true;
    engine.addVisual(beams);

    // 다운라이트 — 스트립이 없는 **바깥 구간**(|x|>2.55)이 천장에서 가장 어두웠다. 보 사이 칸 중앙에
    // 하나씩 박는다. 아래를 향한 원판(rotX +90° → 법선 -y). 여기도 InstancedMesh 1개.
    const DOWN_X = [-3.5, 3.5];
    const downGeo = new THREE.CircleGeometry(0.085, 12);
    const downs = new THREE.InstancedMesh(
      downGeo,
      new THREE.MeshStandardMaterial({
        color: 0x000000,
        emissive: 0xfff2d8, // 코브·스트립의 시안과 대비되는 따뜻한 백색 (실제 다운라이트)
        emissiveIntensity: 2.2,
        side: THREE.DoubleSide,
      }),
      (beamRows - 1) * DOWN_X.length,
    );
    const _q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
    const _s = new THREE.Vector3(1, 1, 1);
    const _p = new THREE.Vector3();
    let di = 0;
    for (let r = 0; r < beamRows - 1; r++) {
      for (const x of DOWN_X) {
        _p.set(x, CEIL_UNDER - 0.012, beamZ0 + (r + 0.5) * BEAM_GAP);
        downs.setMatrixAt(di++, _m.compose(_p, _q, _s));
      }
    }
    downs.instanceMatrix.needsUpdate = true;
    engine.addVisual(downs);

    // --- 핀 뒤 애니메이션 전광판 (절차적, 에셋 0) ---
    const sc = document.createElement('canvas');
    sc.width = 768;
    sc.height = 256;
    this.screenCtx = sc.getContext('2d')!;
    this.screenTex = new THREE.CanvasTexture(sc);
    this.screenTex.colorSpace = THREE.SRGBColorSpace;
    // rotateY(π) 단독이면 텍스트 정상 — 별도 미러 보정 불필요(repeat.x=-1 넣으면 오히려 뒤집힘)
    // 전광판은 **마스킹 유닛(캐노피) 앞면**에 붙인다 — 개구부 바로 위부터 시작.
    // 예전엔 뒤쪽 마스킹 월(z≈20.69)에 있어서 캐노피 위로만 보였고, 그 사이 캐노피 앞면이
    // 높이 1.35m짜리 시커먼 띠로 남았다. 실제 볼링장도 마스킹 유닛 면이 디스플레이다.
    // 아래로는 네온 트림 바로 위(PIN_BAY_TOP+0.28)까지만 내려온다 — 개구부는 안 가린다.
    // 화면을 마스킹 유닛에 **꽉 채운다** — 위아래 검은 띠를 없애는 게 목적이다.
    //  · 폭: 홀 전폭(양옆 벽까지)
    //  · 아랫단: 정확히 개구부 상단(PIN_BAY_TOP) — 핀 베이와 맞닿아 틈이 없다
    //  · 윗단: 3:1 비율로 따라오면 3.55, 마스킹 월 상단(3.6) 바로 아래
    // 베젤(검은 테)은 제거했다. 전광판이 뒤쪽 마스킹 월에 있던 시절의 액자인데,
    // 캐노피 앞면으로 옮긴 뒤로는 화면 위아래로 0.15씩 삐져나온 **검은 띠**로만 보였다.
    // (아래쪽은 캐노피 면 0.6~0.73까지 겹쳐 0.28짜리 띠가 됐다.)
    const scrW = HALL_HALF_W * 2;
    const scrH = scrW * (256 / 768);
    const scrBottom = PIN_BAY_TOP;
    const screenY = scrBottom + scrH / 2;
    const screenZ = bayFrontZ - 0.03; // 캐노피 앞면 바로 앞
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(scrW, scrH),
      new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }),
    );
    screen.position.set(0, screenY, screenZ);
    screen.rotation.y = Math.PI; // 플레이어(−z)를 향함
    engine.addVisual(screen);
    this.drawScreen(); // 초기 1프레임

    // --- 옆벽 그래픽 밴드 (정적, 절차적) ---
    //
    // 예전엔 1.7×1.2 '액자'에 전광판과 같은 신스웨이브 선셋을 넣었다. 세 가지가 겹쳐 있었다:
    //  ① 옆벽은 시선과 거의 평행이라 가로폭이 22~56%로 압축된다 → 가로 그림이 세로로 눌리고,
    //     하필 콘텐츠가 **원**(해)이라 계란이 됐다. 세로형으로 뒤집는 건 정반대 처방이다 —
    //     압축이 그 위에 곱해져 바늘이 된다(1.2×1.7이면 보이는 비 0.15). **더 가로로 길어야** 한다.
    //     실측 보이는 비: 1.7×1.2 = 0.31~1.38 / 5.0×0.8 = 1.35~6.08(전 포즈 가로형 유지).
    //  ② MeshBasicMaterial + toneMapped:false라 조명과 톤매핑을 둘 다 무시했다. 벽이 검을 때는
    //     네온 사인으로 맞았지만, 벽이 코브 워시를 받는 면이 된 뒤로는 **화면에서 유일하게 빛을
    //     안 받는 물체**라 붙여놓은 스티커로 읽혔다. → MeshStandardMaterial.
    //  ③ 전광판(홀 전폭)과 같은 그림이라 한 화면에 같은 이미지가 5개(큰 것 1 + 미니 4)였다.
    //     → 핀 실루엣 반복 밴드(makePosterTexture 주석 참고).
    // 실제 볼링장 옆벽에 있는 것도 액자가 아니라 레인을 따라 달리는 긴 그래픽 밴드다.
    const AD_W = 5.0;
    const AD_H = 0.8;
    const wallFaceX = HALL_HALF_W - 0.15; // 벽 내측면
    const adGeo = new THREE.PlaneGeometry(AD_W, AD_H);
    // 프레임 — 레일·코브와 같은 문법(돌출 → 그림자선). 바깥면을 벽에 7.5mm 박아 뜬 틈을 없앤다.
    const frameGeo = new THREE.BoxGeometry(0.05, AD_H + 0.1, AD_W + 0.1);
    const matFrame = new THREE.MeshStandardMaterial({ color: 0x2a3142, roughness: 0.75 });
    // 액센트는 홀 팔레트에 맞춰 웜(골드)·쿨(시안) 한 쌍. 구 핑크/퍼플은 전광판 색이라 뺐다.
    const ads = [
      { tex: makePosterTexture(NEON.gold, NEON.amber), z: 3.5 },
      { tex: makePosterTexture(NEON.cyan, NEON.ice), z: 9.5 },
    ];
    for (const side of [-1, 1]) {
      for (const ad of ads) {
        const frame = new THREE.Mesh(frameGeo, matFrame);
        frame.position.set(side * (wallFaceX - 0.0175), 2.4, ad.z); // 내측면이 벽에서 42.5mm 돌출
        engine.addVisual(frame);

        const band = new THREE.Mesh(
          adGeo,
          new THREE.MeshStandardMaterial({ map: ad.tex, roughness: 0.85, metalness: 0 }),
        );
        band.position.set(side * (wallFaceX - 0.048), 2.4, ad.z); // 프레임 내측면보다 5.5mm 앞
        band.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; // 플레이어 쪽(레인 중앙)을 향함
        engine.addVisual(band);
      }
    }

    // --- 플레이 레인 마커 (파울라인·에임 화살표·스팟) — 거리·속도 지각 단서 ---
    const matMark = new THREE.MeshStandardMaterial({ color: 0x46280e, roughness: 0.6 });
    const foul = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x551515, roughness: 0.6 }));
    foul.rotation.x = -Math.PI / 2;
    foul.position.set(0, 0.004, 0);
    engine.addVisual(foul);

    const tri = new THREE.Shape();
    tri.moveTo(0, -0.1);
    tri.lineTo(-0.035, 0.05);
    tri.lineTo(0.035, 0.05);
    tri.closePath();
    const triGeo = new THREE.ShapeGeometry(tri); // rotX(-90°) 후 +z(다운레인) 방향
    for (let i = -3; i <= 3; i++) {
      const arrow = new THREE.Mesh(triGeo, matMark);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(i * 0.131, 0.004, 4.7 - Math.abs(i) * 0.28);
      engine.addVisual(arrow);
    }
    const dotGeo = new THREE.CircleGeometry(0.022, 12);
    for (let i = -2; i <= 2; i++) {
      const dot = new THREE.Mesh(dotGeo, matMark);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(i * 0.18, 0.004, 2.13);
      engine.addVisual(dot);
    }
  }

  /** 이벤트(스트라이크/스페어 등)를 전광판에 큼지막하게 띄움 (Boot.onEvent에서 호출) */
  announce(text: string, color: string = NEON.pink) {
    this.announceText = text;
    this.announceColor = color;
    this.announceUntil = this.time + 2.2;
  }

  /**
   * 매 렌더 프레임 호출 (Boot.onFrame) — 전광판 애니메이션 + 옆 레인 앰비언트.
   *
   * @param courtesyHold 플레이어가 어프로치에 서 있는가(조준·투구·안착 중). true면 **인접 레인만**
   *   새 투구를 시작하지 않는다 — 실제 볼링의 lane courtesy(양방향 한 레인). 이미 굴러가는 투구는
   *   끊지 않는다: 규칙도 "던지기 전에 기다린다"이고, 중간에 멈추면 그게 더 눈에 띈다.
   */
  update(dt: number, courtesyHold: boolean, physScale = 1) {
    this.time += dt; // 전광판은 실시간 — 빨리감기·슬로모와 무관하다
    // ⚠️ 앰비언트는 **물리 시간**으로 돈다. onFrame이 주는 dt는 스케일이 안 걸린 실제 프레임
    // 간격인데(Loop.tick은 timeScale을 물리 accumulator에만 적용한다), 옆 레인 핀은 이제 강체라
    // 월드와 함께 느려지고 빨라진다. 실시간 dt를 그대로 넣으면 임팩트 슬로모 동안 **옆 레인 핀만
    // 슬로모로 눕고 공은 정상 속도로 굴러간다.** (현재 AI_FAST_FORWARD=1이라 빨리감기는 꺼져
    // 있지만, 2~3으로 올리면 반대 방향으로 같은 어긋남이 난다.)
    // 리플레이 중엔 loop.paused로 물리가 멈추므로 0이 넘어온다.
    this.updateAmbient(dt * physScale, courtesyHold);
    // 커스텀 영상 자가 복구 — 브라우저는 백그라운드 탭에서 무음 영상 재생을 멈춰 세우고,
    // 돌아와도 스스로 재개하지 않는다. 한 번 멈추면 영영 정지 화면이 되므로 매 프레임 확인한다
    // (boolean 두 번이라 비용은 없다시피 하고, 자동재생 정책상 muted는 항상 통과한다).
    if (this.videoEl && this.videoEl.paused && !document.hidden) {
      void this.videoEl.play().catch(() => {});
    }
    // 재드로우 스로틀(#2): drawScreen()은 그라디언트2 + 태양 + 그리드 33선 + 마퀴를 매번 다시 그리고
    // 768×256 텍스처를 통째 재업로드한다. 스크롤(0.3/s)·마퀴(80px/s)·announce 펄스(~2.5Hz)는 모두
    // 24fps에서 무손실이므로 ~1/24초 간격으로만 갱신 → 렌더 비용 절반↓ (섀도우맵 정적화와 결 맞춤).
    if (this.time - this.lastDraw >= 1 / 24) {
      this.lastDraw = this.time;
      this.drawScreen();
      this.screenTex.needsUpdate = true;
    }
  }

  /** 전광판 한 프레임 렌더 (신스웨이브 + 스크롤 마퀴 + 이벤트 어나운스) */
  /**
   * 옆 레인 앰비언트 사이클 — 핀 10개가 **다이나믹 강체**, 공·레이크가 키네마틱:
   *   idle → roll → settle → hold → guard → sweep → set → rack → lift → idle
   *
   * 사이클 **타이밍**은 전부 예전 캔드 버전 그대로다(투구 3~4s · 기계 구간은 PinSet의 CY_*와 정합 ·
   * 간격 6~14s · lane courtesy). 바뀐 건 **넘어짐을 누가 계산하느냐**뿐이다.
   *
   * 예전엔 핀마다 (축·각도·이동거리·지연)을 뽑아 0.5초 이징으로 보간했다. 인과·연쇄·기계 셋을
   * 차례로 덧대며 좋아지긴 했지만, 실측하니 **캔드 방식으로는 못 고치는 것 셋이 남아 있었다**:
   *  ① **회전의 시간축이 뒤집혔다** — 이징이 ease-out이라 각속도가 출발 9.49 → 착지 0.47 rad/s로
   *     단조 감소했다. 실제 핀은 √(3g/L)=8.8 rad/s로 **가속해서 데크에 부딪힌다.** 그래서
   *     "넘어진다"가 아니라 "놓인다"로 읽혔다(사용자 지적).
   *  ② **핀이 서 있는 핀을 관통** — 4투구 223 프레임-쌍, 최소 간격 4.5mm. 맞은 핀은 무반응.
   *  ③ **꼭대기가 레인을 4.2cm 파고듦** — 무게중심 높이를 회전과 무관하게 선형 보간해서.
   * 셋 다 착지점 완화(relaxAmbLanding)·킥백 클램프 같은 기하 보정으로는 증상만 눌렀을 뿐이다.
   * 강체로 바꾸니 셋이 한꺼번에 사라졌고 그 보정 코드도 전부 지웠다.
   *
   * 전환 후 실측(6투구 · 45개 낙하): 각속도가 **착지로 갈수록 커진다** 5.29 → 6.83, 착지 7.35 rad/s
   * (기준 8.8). 핀끼리 최소 간격 0.9mm → **55.1mm**(관통 아닌 접촉). 핀 최저점 −0.0375로 거터
   * 바닥(−0.0476) **위**. 낙하 방향 폭 124° → 343°. 봉쇄 98,000 핀샘플에 레인 이탈 0건.
   *
   * 비용: world.step p50 0.05 → 0.20ms(강체 11→94). 프레임 예산 13.3ms에 렌더가 0.7ms뿐이라
   * 데스크탑에선 여유가 크다. **모바일은 미측정** — 부담되면 옆 레인 수(k≤2)를 줄이는 게 첫 노브다.
   */
  private updateAmbient(dt: number, courtesyHold: boolean) {
    for (const L of this.ambient) {
      L.t += dt;
      switch (L.phase) {
        case 'idle':
          // lane courtesy — 인접 레인은 내가 던지는 동안 '올라서지' 않는다.
          // 단 AMB_COURTESY_MAX를 넘겨 기다렸으면 그냥 간다(실제로도 그렇고, 굶지 않게).
          const blocked = L.courtesy && courtesyHold;
          // 막힌 동안 레인별 디싱크 지연을 **한 번** 뽑는다. 안 하면 인접 두 레인이 홀드가 풀리는
          // 같은 프레임에 동시 출발해 내 투구 리듬에 동기화된다. 실제로도 동시에 준비되면
          // '오른쪽 볼러 우선권'으로 한쪽이 먼저 간다.
          if (blocked && L.t >= L.wait && L.desync === 0) L.desync = 0.15 + L.rng() * 1.85;
          const ready = L.wait + L.desync;
          const held = blocked && L.t < ready + AMB_COURTESY_MAX;
          if (L.t >= ready && !held) {
            L.desync = 0;
            L.rollT = AMB_ROLL_MIN + L.rng() * (AMB_ROLL_MAX - AMB_ROLL_MIN);
            L.holdT = AMB_HOLD_MIN + L.rng() * (AMB_HOLD_MAX - AMB_HOLD_MIN);
            L.entryX = (L.rng() - 0.5) * 0.34;
            // 포켓(1-3 또는 1-2 사이). 정중앙으로 수렴하면 매 투구가 똑같아 보인다.
            L.pocketX = (L.rng() < 0.5 ? -1 : 1) * (0.045 + L.rng() * 0.03);
            // ⚠️ 위치를 먼저 잡고(순간이동) 보이게 한다 — 순서가 반대거나 다음 물리 스텝을 기다리면
            //    한 프레임 동안 공이 주차 위치에 번쩍인다.
            this.placeAmbBall(L, 0, true);
            L.ball.visible = true;
            L.phase = 'roll';
            L.t = 0;
          }
          break;
        case 'roll': {
          const u = Math.min(1, L.t / L.rollT);
          // 헤드핀 앞까지만 캔드 경로가 몬다(속도·훅 = 지각되는 부분). 그 뒤는 물리가 소유해
          // 진짜 질량으로 부딪히고 스스로 감속한다 — AMB_BALL_HANDOFF_Z 주석 참고.
          if (!L.ballLive) {
            this.placeAmbBall(L, u);
            if (L.ballBody.translation().z >= AMB_BALL_HANDOFF_Z) this.releaseAmbBall(L, u);
          } else if (L.ballBody.translation().z > PIN_DECK_END + 0.35) {
            this.parkAmbBall(L); // 데크를 지났다 = 피트로 굴러간 셈
          }
          if (u >= 1) {
            L.phase = 'settle';
            L.t = 0;
          }
          break;
        }
        case 'settle':
          // 넘어짐은 물리가 전부 한다 — 여기엔 그 코드가 없는 게 맞다.
          // 예전 'fall'은 핀마다 (축·각도·이동거리·지연)을 뽑아 0.5초 동안 보간했고, 그게
          // 회전 시간축 역전·핀끼리 관통·바닥 관통 셋의 공통 원인이었다.
          if (L.ballLive && L.ballBody.translation().z > PIN_DECK_END + 0.35) this.parkAmbBall(L);
          if (L.t >= AMB_SETTLE_T) {
            if (L.ballLive) this.parkAmbBall(L); // 아직 굴러가도 여기서 끝 — 곧 레이크가 내려온다
            L.phase = 'hold';
            L.t = 0;
          }
          break;
        case 'hold':
          if (L.t >= L.holdT) {
            L.rake.visible = true; // 기계 노출 시작 (주차 중엔 그리지 않는다)
            L.table.visible = true;
            L.phase = 'guard';
            L.t = 0;
          }
          break;
        case 'guard': {
          const u = Math.min(1, L.t / AMB_GUARD_T);
          L.rake.position.set(L.cx, THREE.MathUtils.lerp(AMB_RAKE_Y_UP, AMB_RAKE_Y_DOWN, smooth(u)), AMB_RAKE_Z0);
          this.syncAmbRake(L);
          if (u >= 1) {
            L.phase = 'sweep';
            L.t = 0;
          }
          break;
        }
        case 'sweep': {
          const u = Math.min(1, L.t / AMB_SWEEP_T);
          const rz = THREE.MathUtils.lerp(AMB_RAKE_Z0, AMB_RAKE_Z1, smooth(u));
          L.rake.position.set(L.cx, AMB_RAKE_Y_DOWN, rz);
          // 핀을 손으로 밀던 코드가 통째로 사라졌다 — 블레이드 콜라이더가 밀고, 서 있던 핀은
          // 밀리면서 알아서 눕는다('26cm에 걸쳐 눕힌다' 같은 특수 처리가 필요 없어졌다).
          this.syncAmbRake(L);
          if (u >= 1) {
            L.phase = 'set';
            L.t = 0;
          }
          break;
        }
        case 'set': {
          // 레이크 복귀. 핀은 이미 베이 뒷벽 뒤라, 여기서 새 랙 시작 위치로 옮겨도 안 보인다.
          const u = Math.min(1, L.t / AMB_SET_T);
          L.rake.position.set(L.cx, AMB_RAKE_Y_DOWN, THREE.MathUtils.lerp(AMB_RAKE_Z1, AMB_RAKE_Z0, smooth(u)));
          this.syncAmbRake(L);
          if (u >= 1) {
            // 쓸려간 핀은 베이 뒷벽 뒤(AMB_SWEEP_END_Z)에 있고, 랙 시작 높이는 개구부(0.6) 위라
            // 캐노피에 가린다 — 순간이동이 안 보이는 구간이 둘 다 확보돼 있다.
            for (const p of L.pins) this.holdAmbPin(p, AMB_PIN_CY + AMB_SET_LIFT);
            L.phase = 'rack';
            L.t = 0;
          }
          break;
        }
        case 'rack': {
          // 테이블이 핀 위에 붙어 함께 내려온다 — 이게 '기계가 놓는다'로 읽히게 하는 부분
          const u = Math.min(1, L.t / AMB_RACK_T);
          const base = AMB_SET_LIFT * (1 - smooth(u));
          for (const p of L.pins) this.holdAmbPin(p, AMB_PIN_CY + base);
          L.table.position.y = base + AMB_TABLE_OFF;
          if (u >= 1) {
            // 마지막으로 정확히 스폿에 내려놓고 **손을 뗀다** — 이후로는 물리가 소유한다.
            // 속도 0으로 바닥에 딱 놓이므로 Rapier가 곧 sleep 시킨다(대기 중 비용 ≈ 0).
            for (const p of L.pins) this.holdAmbPin(p, AMB_PIN_CY);
            L.phase = 'lift';
            L.t = 0;
          }
          break;
        }
        case 'lift': {
          // 테이블·레이크가 기계 안(캐노피 뒤)으로 — 새 랙만 남는다
          const u = Math.min(1, L.t / AMB_LIFT_T);
          const e = smooth(u);
          L.table.position.y = THREE.MathUtils.lerp(AMB_TABLE_OFF, AMB_SET_LIFT + AMB_TABLE_OFF, e);
          L.rake.position.set(L.cx, THREE.MathUtils.lerp(AMB_RAKE_Y_DOWN, AMB_RAKE_Y_UP, e), AMB_RAKE_Z0);
          this.syncAmbRake(L);
          if (u >= 1) {
            L.rake.visible = false; // 기계가 안으로 들어갔다 — 이제 그릴 필요 없다
            L.table.visible = false;
            L.phase = 'idle';
            L.t = 0;
            L.wait = AMB_GAP_MIN + L.rng() * (AMB_GAP_MAX - AMB_GAP_MIN);
          }
          break;
        }
      }
    }
  }

  /**
   * 공을 캔드 경로에서 물리로 넘긴다. **속도를 그대로 물려주는 게 핵심** — 여기서 값이 바뀌면
   * "옆 레인이 빨라/느려 보인다"가 다시 열린다(그 지각 문제로 이미 한 번 되돌아간 적이 있다).
   */
  private releaseAmbBall(L: AmbientLane, u: number) {
    const RAPIER = getRapier();
    const vz = (AMB_BALL_END_Z - BALL_START_Z) / L.rollT; // 경로 z는 등속 lerp
    const vx = (L.entryX * 2.2 * -2 * u) / L.rollT; // x(u)=…+entryX·2.2·(1−u²) 의 시간미분
    L.ballBody.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    L.ballBody.setLinvel({ x: vx, y: 0, z: vz }, true);
    L.ballBody.setAngvel({ x: vz / BALL_RADIUS, y: 0, z: 0 }, true); // 굴러가는 회전(구르기 마찰과 정합)
    L.ballLive = true;
  }

  /** 공을 월드 밖으로 치우고 다시 키네마틱으로 되돌린다(다음 투구가 경로로 몰 수 있게). */
  private parkAmbBall(L: AmbientLane) {
    const RAPIER = getRapier();
    L.ball.visible = false;
    L.ballBody.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    L.ballBody.setTranslation({ x: L.cx, y: -50, z: BALL_START_Z }, true);
    L.ballLive = false;
  }

  /** 레이크 메시 자세를 키네마틱 콜라이더에 반영 — 이게 있어야 블레이드가 핀을 실제로 민다. */
  private syncAmbRake(L: AmbientLane) {
    const q = L.rake.position;
    L.rakeBody.setNextKinematicTranslation({ x: q.x, y: q.y, z: q.z });
  }

  /**
   * 기계 사이클 동안 핀을 스폿 위 지정 높이에 똑바로 고정한다.
   * 다이나믹 바디를 키네마틱으로 바꾸는 대신 매 프레임 위치·자세·속도를 덮어써 중력이 누적되지
   * 않게 하는 방식 — 플레이 레인 `Pin.hold()`와 **같은 처리**다(기계가 둘이면 안 된다).
   */
  private holdAmbPin(p: AmbPin, y: number) {
    p.body.setTranslation({ x: p.home.x, y, z: p.home.z }, true);
    p.body.setRotation(AMB_UPRIGHT, true);
    p.body.setLinvel(ZERO3, true);
    p.body.setAngvel(ZERO3, true);
  }

  /**
   * 앰비언트 공을 진행도 u(0~1)에 놓는다 — **키네마틱 강체**를 몰고, 메시는 Engine.sync가 따라온다.
   * 훅 — 진입 x에서 시작해 (1−u²)로 **포켓**으로 휘어 들어간다(후반에 꺾이는 실제 훅 모양).
   *
   * ⚠️ 예전엔 핀 앞 0.16m에서 멈추고 숨겼다(공이 핀을 파고드는 걸 감추려고). 이제는 실제로 쳐야
   * 하므로 핀덱을 **통과**한다(AMB_BALL_END_Z). 속도·훅 모양은 그대로다 — 여기가 바뀌면
   * "옆 레인이 빨라 보인다"가 다시 열린다.
   */
  private placeAmbBall(L: AmbientLane, u: number, teleport = false) {
    const t = {
      x: L.cx + L.pocketX + L.entryX * 2.2 * (1 - u * u),
      y: BALL_RADIUS + AMB_FLOOR_TOP,
      z: THREE.MathUtils.lerp(BALL_START_Z, AMB_BALL_END_Z, u),
    };
    // 첫 프레임은 순간이동이어야 한다 — setNextKinematicTranslation은 다음 물리 스텝에야 반영돼
    // 그 사이 한 프레임 동안 공이 주차 위치(y=-50)에 보인다.
    if (teleport) L.ballBody.setTranslation(t, true);
    else L.ballBody.setNextKinematicTranslation(t);
  }

  private drawScreen() {
    const ctx = this.screenCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const t = this.time;
    const cx = W / 2;
    const horizon = H * 0.5;

    if (this.customReady) {
      this.drawCustomBackground(ctx, W, H, this.customImg);
    } else {
      this.drawSynthwave(ctx, W, H, t, cx, horizon);
    }

    // 상단 스크롤 마퀴 — 커스텀 전광판일 땐 끈다(사용자 이미지를 가리지 않게).
    // 어나운스는 게임 정보라 커스텀 위에도 계속 띄운다.
    if (!this.customReady) {
      ctx.save();
      ctx.font = 'bold 26px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.shadowColor = NEON.cyan;
      ctx.shadowBlur = 12;
      const msg = '★  NEON LANES  ★  STRIKE IT UP  ★  ';
      const mw = ctx.measureText(msg).width;
      const off = (t * 80) % mw;
      for (let x = -off; x < W; x += mw) ctx.fillText(msg, x, 8);
      ctx.restore();
    }

    // 이벤트 어나운스 (스트라이크/스페어)
    if (this.time < this.announceUntil) {
      const left = this.announceUntil - this.time;
      const pulse = 1 + 0.1 * Math.sin(t * 16);
      // 커스텀 배경 위에선 글자가 묻힐 수 있다 → 뒤에 어두운 띠를 깔아 가독성 확보
      if (this.customReady) {
        const band = ctx.createLinearGradient(0, horizon - 52, 0, horizon + 64);
        band.addColorStop(0, 'rgba(4,6,12,0)');
        band.addColorStop(0.5, 'rgba(4,6,12,0.66)');
        band.addColorStop(1, 'rgba(4,6,12,0)');
        ctx.fillStyle = band;
        ctx.fillRect(0, horizon - 52, W, 116);
      }
      ctx.save();
      ctx.translate(cx, horizon + 6);
      ctx.scale(pulse, pulse);
      ctx.globalAlpha = Math.min(1, left * 1.8);
      ctx.font = 'bold 76px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = this.announceColor;
      ctx.shadowBlur = 34;
      ctx.fillStyle = this.announceColor;
      ctx.fillText(this.announceText, 0, 0);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeText(this.announceText, 0, 0);
      ctx.restore();
    }
  }

  /**
   * 커스텀 이미지를 cover로 깔고, 마퀴가 앉는 상단만 어둡게 눌러 가독성을 지킨다.
   * GIF는 DOM에 붙은 <img>가 프레임을 넘기고 drawImage가 '현재 프레임'을 가져온다.
   */
  private drawCustomBackground(ctx: CanvasRenderingContext2D, W: number, H: number, img: HTMLImageElement | null) {
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, W, H);
    // 비디오 > 직접 디코드한 GIF 프레임 > <img> 순으로 그린다.
    const vid = this.videoEl && this.videoEl.readyState >= 2 ? this.videoEl : null;
    const src: CanvasImageSource | null = vid ?? this.gifFrame ?? img;
    const sw = vid ? vid.videoWidth : this.gifFrame ? this.gifFrame.displayWidth : (img?.naturalWidth ?? 0);
    const sh = vid ? vid.videoHeight : this.gifFrame ? this.gifFrame.displayHeight : (img?.naturalHeight ?? 0);
    if (!src) return;
    if (!sw || !sh) return;
    const s = Math.max(W / sw, H / sh);
    const dw = sw * s;
    const dh = sh * s;
    ctx.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    const scrim = ctx.createLinearGradient(0, 0, 0, 46);
    scrim.addColorStop(0, 'rgba(4,6,12,0.72)');
    scrim.addColorStop(1, 'rgba(4,6,12,0)');
    ctx.fillStyle = scrim;
    ctx.fillRect(0, 0, W, 46);
  }

  /** 기본 배경 — 신스웨이브(하늘 그라디언트 + 태양 + 스크롤 그리드). */
  private drawSynthwave(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, cx: number, horizon: number) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1a0b30');
    sky.addColorStop(0.5, '#0a0418');
    sky.addColorStop(1, '#040209');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 태양 (수평선 위 반원 + 가로 스트라이프)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizon);
    ctx.clip();
    const sunR = H * 0.36;
    const sun = ctx.createLinearGradient(0, horizon - sunR, 0, horizon);
    sun.addColorStop(0, NEON.amber);
    sun.addColorStop(0.55, '#ff6aa6'); // 핑크 중간톤 — 팔레트 토큰 아님(그라디언트 전용)이라 리터럴 유지
    sun.addColorStop(1, NEON.pink);
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, horizon, sunR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0a0418';
    for (let i = 0; i < 5; i++) {
      const yy = horizon - sunR * 0.5 + (i * sunR * 0.5) / 5;
      ctx.fillRect(cx - sunR, yy, sunR * 2, ((sunR * 0.5) / 5) * (0.3 + i * 0.13));
    }
    ctx.restore();

    // 바닥 그리드 (스크롤)
    ctx.lineWidth = 2;
    const scroll = (t * 0.3) % 1;
    for (let i = 0; i < 16; i++) {
      const f = (i + scroll) / 16;
      const y = horizon + (H - horizon) * f * f;
      ctx.strokeStyle = rgba(NEON.cyan, 0.1 + 0.55 * f);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(NEON.pink, 0.45);
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * (W * 0.045), horizon);
      ctx.lineTo(cx + i * (W * 0.6), H);
      ctx.stroke();
    }

  }

  /**
   * 커스텀 전광판 이미지 적용 (null=기본 신스웨이브로 복귀).
   *
   * ⚠️ GIF 애니메이션을 텍스처로 돌리려면 <img>가 **문서에 붙어 렌더돼야** 한다 —
   *    WebGL은 GIF를 못 풀고, 떼어놓은 Image는 브라우저가 프레임을 안 넘긴다.
   *    그래서 1px짜리 투명 엘리먼트로 DOM에 심어두고 drawScreen이 매 프레임 긁어간다
   *    (전광판은 어차피 24fps로 재드로우 중이라 추가 비용이 사실상 없다).
   */
  setCustomScreen(src: string | null) {
    this.stopVideo();
    this.stopGif();
    this.customImg?.remove();
    this.customImg = null;
    this.customReady = false;
    this.lastDraw = -1; // 다음 update에서 즉시 재드로우
    if (!src) return;
    const img = new Image();
    img.decoding = 'sync';
    // ⚠️ 브라우저는 **가려지거나 안 그려지는 이미지의 GIF 프레임을 안 넘긴다.**
    //    display:none·visibility:hidden은 물론이고, z-index로 캔버스 뒤에 깔아 완전히
    //    가려도 멈춘다(처음에 zIndex:-1로 뒀다가 GIF가 정지 화면으로 나왔다).
    //    그래서 **맨 위**에 두되 2px·거의 투명으로 눈에 안 띄게 한다.
    Object.assign(img.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0.004',
      pointerEvents: 'none',
      zIndex: '2147483647',
    } satisfies Partial<CSSStyleDeclaration>);
    img.onload = () => {
      this.customReady = true;
      this.lastDraw = -1;
    };
    img.onerror = () => {
      this.customReady = false; // 깨진 data URL이면 조용히 기본 배경 유지
    };
    img.src = src;
    document.body.appendChild(img);
    this.customImg = img;
    if (src.startsWith('data:image/gif')) void this.startGif(src);
  }

  /**
   * GIF를 **직접 디코드해서** 프레임을 돌린다 (WebCodecs ImageDecoder).
   *
   * 왜 <img>에 안 맡기나: 브라우저는 '보이지 않는' 이미지의 GIF 프레임을 안 넘긴다 —
   * display:none·visibility:hidden은 물론이고 다른 요소에 완전히 가려도, 백그라운드 탭이어도
   * 멈춘다. 즉 <img>+drawImage 방식은 **렌더링 휴리스틱에 운을 거는 것**이고 실제로 멈췄다.
   * 여기선 우리 타이머로 프레임을 넘기므로 그 변수들이 사라진다.
   *
   * 메모리: 전체 프레임을 미리 풀지 않고 **한 장씩** 디코드해 최신 것만 들고 있는다
   * (60프레임짜리를 통째로 펴면 수십 MB가 된다). VideoFrame은 GC 대상이 아니라 close()가 필수다.
   * ImageDecoder가 없는 브라우저(Safari 등)에선 조용히 <img> 경로로 남는다 — 정지 화면이라도 나온다.
   */
  private async startGif(src: string) {
    if (typeof ImageDecoder === 'undefined') return;
    let data: Uint8Array;
    try {
      const b64 = src.slice(src.indexOf(',') + 1);
      const bin = atob(b64);
      data = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    } catch {
      return;
    }
    const dec = new ImageDecoder({ data, type: 'image/gif' });
    this.gifDecoder = dec;
    try {
      await dec.tracks.ready;
    } catch {
      return;
    }
    if (this.gifDecoder !== dec) return; // 대기 중 교체됨
    const track = dec.tracks.selectedTrack;
    if (!track || track.frameCount < 2) return; // 정지 GIF — <img>로 충분

    let i = 0;
    const step = async () => {
      if (this.gifDecoder !== dec) return;
      let frame: VideoFrame;
      try {
        frame = (await dec.decode({ frameIndex: i % track.frameCount })).image;
      } catch {
        return; // 디코드 실패 → 마지막 프레임에서 정지
      }
      if (this.gifDecoder !== dec) {
        frame.close();
        return;
      }
      this.gifFrame?.close();
      this.gifFrame = frame;
      this.customReady = true;
      this.lastDraw = -1; // 다음 update에서 즉시 반영
      i++;
      const durMs = (frame.duration ?? 100_000) / 1000; // µs → ms
      this.gifTimer = window.setTimeout(step, Math.max(20, durMs));
    };
    void step();
  }

  /**
   * 커스텀 비디오 적용 (null=해제). 이미지/GIF와 배타.
   *
   * 항상 **muted + loop + playsInline**이다:
   *  · muted — 게임 사운드(BGM·굴림음)와 싸우면 안 된다. 겸사 자동재생 정책도 통과한다.
   *  · playsInline — iOS가 전체화면으로 뺏어가는 걸 막는다(텍스처로 써야 하므로 치명적).
   * 프레임은 전광판 재드로우 주기(24fps)에 샘플링된다 — 매 비디오 프레임마다 강제로
   * 다시 그리면 스로틀(#2)의 이점이 사라지므로 일부러 안 한다.
   */
  setCustomVideo(blob: Blob | null) {
    this.stopGif();
    this.stopVideo();
    this.customImg?.remove();
    this.customImg = null;
    this.customReady = false;
    this.lastDraw = -1;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.preload = 'auto';
    // GIF와 같은 이유로 DOM에 심는다 — 안 그려지는 비디오는 프레임 갱신이 멈출 수 있다.
    Object.assign(v.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '2px',
      height: '2px',
      opacity: '0.004',
      pointerEvents: 'none',
      zIndex: '2147483647',
    } satisfies Partial<CSSStyleDeclaration>);
    v.onloadeddata = () => {
      this.customReady = true;
      this.lastDraw = -1;
    };
    v.onerror = () => {
      this.customReady = false; // 재생 불가 → 조용히 기본 배경
    };
    v.src = url;
    document.body.appendChild(v);
    this.videoEl = v;
    this.videoUrl = url;
    // muted라 정책상 통과하지만, 실패해도 게임이 멈추면 안 되므로 삼킨다.
    void v.play().catch(() => {});
  }

  private stopVideo() {
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.removeAttribute('src');
      this.videoEl.load(); // 디코더 즉시 해제
      this.videoEl.remove();
    }
    this.videoEl = null;
    if (this.videoUrl) URL.revokeObjectURL(this.videoUrl); // 안 풀면 Blob이 탭 수명 내내 남는다
    this.videoUrl = null;
  }

  private stopGif() {
    if (this.gifTimer !== null) clearTimeout(this.gifTimer);
    this.gifTimer = null;
    this.gifFrame?.close();
    this.gifFrame = null;
    this.gifDecoder?.close();
    this.gifDecoder = null;
  }
}
