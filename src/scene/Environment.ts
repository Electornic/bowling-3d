import * as THREE from 'three';
import { makePinGeometry } from './Pin';
import type { Engine } from '../core/Engine';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  GUTTER_DEPTH,
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
const AMB_ROLL_T = 2.3; // [튜닝] 공이 파울라인 → 포켓 (실플레이 ~2.2s)
const AMB_FALL_T = 0.5; // [튜닝] 핀 하나가 넘어지는 시간 (이동량이 커져 0.42→0.5)
/** 직립 핀 무게중심 높이. 메시 원점은 **밑동**이라 회전 보정에 이 값이 필요하다. */
const AMB_PIN_CY = PIN_HEIGHT / 2;
/** 누운 핀 무게중심 높이 ≈ 최대 반경. 예전엔 보정이 없어 몸통 절반이 바닥에 묻혔다. */
const AMB_PIN_LIE_Y = 0.058;
// 충격점에서 먼 핀일수록 늦게 넘어진다 — **이 지연이 '연쇄'를 만든다.** 예전엔 넘어질 핀 전부가
// 같은 u로 동시에 눕는 바람에 "공이 굴러감 → 스위치가 켜짐"처럼 읽혔다(사용자 지적).
const AMB_FALL_SPREAD = 0.3;
const AMB_HOLD_T = 0.7; // [튜닝] 넘어진 채 유지
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
const AMB_GAP_MAX = 14;
/** 랙 하강 시작 높이. 개구부(PIN_BAY_TOP 0.6) 위에서 시작해 캐노피에 가려 있다가 내려온다. */
const AMB_SET_LIFT = 0.62;
/** 공을 숨기는 지점(포켓 앞). 핀 정중앙까지 굴리면 공(r 0.109)이 핀을 16cm 파고든다. */
const AMB_BALL_HIDE = 0.16;
/** 레이크가 남은 직립 핀을 눕히는 축 — +x 회전이면 up이 +z(다운레인)로 눕는다. */
const AMB_KNOCK_AXIS = new THREE.Vector3(1, 0, 0);
// 레이크 포즈. 값은 플레이 레인 스윕 바(PinSet)의 튜닝값을 그대로 따른다 — 같은 볼링장의 같은
// 기계이므로 눈높이가 다르면 안 된다. 대기 높이 1.2는 캐노피(0.6~1.95) 안이라 가려진다.
const AMB_RAKE_Y_UP = 1.2;
const AMB_RAKE_Y_DOWN = 0.16;
const AMB_RAKE_Z0 = HEADPIN_Z - 0.45; // 가드 위치(볼러 쪽) = 쓸기 시작점
const AMB_RAKE_Z1 = LANE_END_Z + 0.3; // 쓸기 끝 — 베이 뒷벽(20.55~20.65) 뒤라 핀·레이크 모두 은폐
/** 핀 테이블 밑면이 핀 꼭대기보다 이만큼 위 — 테이블이 핀을 '물고' 내려오는 것처럼 보이게. */
const AMB_TABLE_OFF = PIN_HEIGHT + 0.03;

type AmbPhase = 'idle' | 'roll' | 'fall' | 'hold' | 'guard' | 'sweep' | 'set' | 'rack' | 'lift';

interface AmbPin {
  mesh: THREE.Mesh;
  home: THREE.Vector3; // 직립 위치
  /** fall이 끝난 자리 — sweep이 여기서 이어간다. 없으면 스윕 첫 프레임에 home으로 되돌아가 튄다. */
  rest: THREE.Vector3;
  down: boolean; // 이번 투구에 넘어지는가
  axis: THREE.Vector3; // 넘어짐 회전축
  dir: THREE.Vector3; // 넘어짐 방향(수평)
  /** 넘어지며 **무게중심이 이동하는 거리**(m). 실제 핀은 밑동이 스폿을 떠나 날아간다. */
  travel: number;
  angle: number; // 최종 기울기(rad)
  /** 넘어지기 시작하는 지연(s) — 충격점 거리에 비례. 연쇄를 만드는 유일한 장치. */
  delay: number;
  /** 넘어지며 살짝 뜨는 높이 — 밑동이 스폿을 떠난다는 신호. */
  hop: number;
}

interface AmbientLane {
  /** true = 인접 레인(k=1) — lane courtesy 대상 */
  courtesy: boolean;
  cx: number;
  pins: AmbPin[];
  ball: THREE.Mesh;
  rng: () => number;
  rake: THREE.Group; // 스윕 바(레이크) — 기계가 보여야 '오뚜기'가 아니라 리셋으로 읽힌다
  table: THREE.Mesh; // 핀 테이블 — 새 랙을 내려놓는 판
  phase: AmbPhase;
  t: number;
  wait: number;
  entryX: number;
  pocketX: number; // 이번 투구가 들어간 포켓(레인 중앙 대비) — 넘어짐 패턴의 기준점
  fallSpan: number; // fall 페이즈 전체 길이 = AMB_FALL_T + 최대 지연
}

/**
 * 옆 레인용 레이크(스윕 바) — 플레이 레인 스윕 바(PinSet)의 축약판.
 *
 * 이게 없으면 사이클이 "핀이 몇 개 눕는다 → 오뚜기처럼 일어난다"로 읽힌다(사용자 지적).
 * 기계가 보여야 같은 움직임이 '리셋'으로 읽힌다. 형상·색은 플레이 레인과 같게 맞춘다 —
 * 같은 볼링장의 같은 기계라 눈높이가 다르면 오히려 이상해진다.
 * 물리는 없다: 핀은 레이크 z를 넘으면 함께 밀리는 방식(플레이 레인도 시각은 같은 원리).
 */
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

// 핀 포즈 계산용 스크래치 (hot path 무할당)
const _aq = new THREE.Quaternion();
const _av = new THREE.Vector3();

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
    const pinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
    // 앰비언트 공 — 4레인 공용. 어둡고 채도 낮게: 배경 모션이 내 조준에서 시선을 덜 끌어야 한다
    // (주변부 모션은 비자발적 주의 전환을 강제한다 — 위 Lane courtesy 주석 참고).
    const ambBallGeo = new THREE.SphereGeometry(BALL_RADIUS, 16, 12);
    const ambBallMat = new THREE.MeshStandardMaterial({ color: 0x2e3646, roughness: 0.35, metalness: 0.1 });

    // --- 옆 레인 ×2 (양쪽, 장식용) ---
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 2; k++) {
        const cx = side * k * LANE_UNIT;
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
            const home = new THREE.Vector3(cx + (c2 - r / 2) * PIN_SPACING, 0, HEADPIN_Z + r * ROW_GAP); // base가 y=0
            pin.position.copy(home);
            engine.addVisual(pin);
            pins.push({
              mesh: pin,
              home,
              rest: home.clone(),
              down: false,
              axis: new THREE.Vector3(1, 0, 0),
              dir: new THREE.Vector3(0, 0, 1),
              travel: 0,
              angle: 0,
              delay: 0,
              hop: 0,
            });
          }
        }
        const ball = new THREE.Mesh(ambBallGeo, ambBallMat);
        ball.visible = false;
        engine.addVisual(ball);
        // 주차 중엔 캐노피에 가려 안 보이지만, 그려는 진다 → 레인당 6드로우콜이 상시 낭비.
        // guard에서 켜고 lift 끝에서 끈다(사이클의 60%가 주차 상태다).
        const rake = makeAmbRake(cx);
        rake.visible = false;
        engine.addVisual(rake);
        const table = makeAmbTable(cx);
        table.visible = false;
        engine.addVisual(table);
        this.ambient.push({
          courtesy: k === 1,
          cx,
          pins,
          ball,
          rake,
          table,
          rng: mulberry32(0x9e3779b9 ^ (side * 977 + k * 131)),
          phase: 'idle',
          t: 0,
          // 초기 위상만 흩어 놓는다 — 4레인이 동시에 던지면 배경이 아니라 이벤트가 된다
          wait: 1.5 + k * 2.3 + (side < 0 ? 1.7 : 0),
          entryX: 0,
          pocketX: 0,
          fallSpan: AMB_FALL_T,
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
  update(dt: number, courtesyHold: boolean) {
    this.time += dt;
    this.updateAmbient(dt, courtesyHold);
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
   * 옆 레인 앰비언트 사이클 (리지드바디 0개):
   *   idle → roll → fall → hold → guard → sweep → set → rack → lift → idle
   *
   * 예전엔 roll → fall → sweep → set 넷뿐이었고, 그래서 **"공이 굴러감 → 핀 몇 개가 눕는다 →
   * 오뚜기처럼 일어난다"의 반복**으로 읽혔다(사용자 지적). 빠져 있던 게 셋이다:
   *  ① **인과** — 어느 핀이 넘어지는지가 공과 무관한 난수였고, 공은 매번 레인 정중앙으로 수렴했다.
   *     지금은 포켓으로 들어가고, 넘어질 확률·방향·순서가 전부 **충격점 거리**에서 나온다.
   *  ② **연쇄** — 넘어질 핀이 같은 u로 동시에 눕었다(스위치처럼). 지금은 거리에 비례한 지연이 붙어
   *     헤드핀부터 뒷줄로 번진다.
   *  ③ **기계** — 레이크도 테이블도 없어 핀이 스스로 일어나는 것처럼 보였다. 지금은 레이크가
   *     내려와(guard) 쓸고(sweep) 돌아오고(set), 테이블이 새 랙을 내려놓고(rack) 둘이 올라간다(lift).
   */
  private updateAmbient(dt: number, courtesyHold: boolean) {
    for (const L of this.ambient) {
      L.t += dt;
      switch (L.phase) {
        case 'idle':
          // lane courtesy — 인접 레인은 내가 어프로치에 서 있는 동안 '올라서지' 않는다
          if (L.t >= L.wait && !(L.courtesy && courtesyHold)) {
            L.entryX = (L.rng() - 0.5) * 0.34;
            // 포켓(1-3 또는 1-2 사이). 정중앙으로 수렴하면 매 투구가 똑같아 보인다.
            L.pocketX = (L.rng() < 0.5 ? -1 : 1) * (0.045 + L.rng() * 0.03);
            // ⚠️ 위치를 먼저 잡고 보이게 한다 — 순서가 반대면 1프레임 동안 공이 (0,0,0)에 번쩍인다
            this.placeAmbBall(L, 0);
            L.ball.visible = true;
            L.phase = 'roll';
            L.t = 0;
          }
          break;
        case 'roll': {
          const u = Math.min(1, L.t / AMB_ROLL_T);
          this.placeAmbBall(L, u);
          if (u >= 1) {
            L.ball.visible = false; // 핀 무리에 가려지는 지점 — 그 뒤는 안 보이니 굴리지 않는다
            this.rollAmbient(L);
            L.phase = 'fall';
            L.t = 0;
          }
          break;
        }
        case 'fall': {
          // 핀마다 자기 지연을 가진 진행도 — 이게 연쇄를 만든다
          for (const p of L.pins) {
            if (!p.down) continue;
            const pu = THREE.MathUtils.clamp((L.t - p.delay) / AMB_FALL_T, 0, 1);
            if (pu <= 0) continue; // 아직 차례가 안 온 핀은 그대로 서 있다
            const e = 1 - (1 - pu) * (1 - pu); // ease-out — 맞는 순간 빠르고 끝에서 잦아든다
            this.layAmbPin(p, p.home.x, p.home.z, e, pu);
          }
          if (L.t >= L.fallSpan) {
            for (const p of L.pins) p.rest.copy(p.mesh.position); // sweep이 이 자리에서 이어간다
            L.phase = 'hold';
            L.t = 0;
          }
          break;
        }
        case 'hold':
          if (L.t >= AMB_HOLD_T) {
            L.rake.visible = true; // 기계 노출 시작 (주차 중엔 그리지 않는다)
            L.table.visible = true;
            L.phase = 'guard';
            L.t = 0;
          }
          break;
        case 'guard': {
          const u = Math.min(1, L.t / AMB_GUARD_T);
          L.rake.position.set(L.cx, THREE.MathUtils.lerp(AMB_RAKE_Y_UP, AMB_RAKE_Y_DOWN, smooth(u)), AMB_RAKE_Z0);
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
          // **레이크가 닿은 핀만** 밀린다. 전부 한꺼번에 옮기면 '레이크가 쓴다'로 안 읽힌다.
          for (const p of L.pins) {
            const pushed = rz + 0.07;
            if (pushed <= p.rest.z) continue;
            if (p.down) {
              p.mesh.position.set(p.rest.x, p.rest.y, pushed); // 이미 누운 핀은 그대로 밀린다
            } else {
              // 서 있던 핀은 밀리면서 눕는다(26cm에 걸쳐) — 안 눕히면 체스말처럼 미끄러진다
              const over = Math.min(1, (pushed - p.rest.z) / 0.26);
              this.layAmbPin(p, p.rest.x, pushed, over, over);
            }
          }
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
          if (u >= 1) {
            for (const p of L.pins) {
              p.mesh.quaternion.identity();
              p.down = false;
              p.mesh.position.set(p.home.x, p.home.y + AMB_SET_LIFT, p.home.z);
            }
            L.phase = 'rack';
            L.t = 0;
          }
          break;
        }
        case 'rack': {
          // 테이블이 핀 위에 붙어 함께 내려온다 — 이게 '기계가 놓는다'로 읽히게 하는 부분
          const u = Math.min(1, L.t / AMB_RACK_T);
          const base = AMB_SET_LIFT * (1 - smooth(u));
          for (const p of L.pins) p.mesh.position.set(p.home.x, p.home.y + base, p.home.z);
          L.table.position.y = base + AMB_TABLE_OFF;
          if (u >= 1) {
            for (const p of L.pins) p.mesh.position.copy(p.home);
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
   * 넘어지는 핀의 포즈를 **무게중심 궤적**으로 놓는다.
   *
   * 예전엔 quaternion만 돌리고 위치는 home 근처에 뒀다. 메시 원점이 핀 **밑동**이라
   * ① 밑동이 스폿에 박힌 채 문짝처럼 회전하고 ② 90°에서 몸통 절반(반경 6cm)이 바닥에 묻혔다.
   * 이게 "오뚜기처럼 쓰러진다"의 정체였다 — 오뚜기는 밑이 무거워 제자리에서 기울기만 하니까.
   * 실제 핀은 밑동이 스폿을 떠나 날아가듯 넘어지고, 누운 뒤엔 바닥 **위에** 놓인다.
   * 그래서 무게중심이 그릴 궤적을 먼저 정하고, 회전을 반영해 메시 원점을 역산한다.
   *
   * @param baseX,baseZ 무게중심 궤적의 시작 지점(핀 스폿 또는 밀리는 위치)
   * @param e 자세 진행도(이징 적용됨) · @param hopU 뜀 진행도(0→1 포물선용, 이징 없는 원값)
   */
  private layAmbPin(p: AmbPin, baseX: number, baseZ: number, e: number, hopU: number) {
    _aq.setFromAxisAngle(p.axis, p.angle * e);
    _av.set(0, AMB_PIN_CY, 0).applyQuaternion(_aq); // 회전된 '밑동→무게중심' 벡터
    const cy = THREE.MathUtils.lerp(AMB_PIN_CY, AMB_PIN_LIE_Y, e) + p.hop * 4 * hopU * (1 - hopU);
    p.mesh.quaternion.copy(_aq);
    p.mesh.position.set(
      baseX + p.dir.x * p.travel * e - _av.x,
      cy - _av.y,
      baseZ + p.dir.z * p.travel * e - _av.z,
    );
  }

  /**
   * 앰비언트 공을 진행도 u(0~1)에 놓는다.
   * 훅 — 진입 x에서 시작해 (1−u²)로 **포켓**으로 휘어 들어간다(후반에 꺾이는 실제 훅 모양).
   * z는 핀 앞에서 끝난다 — 정중앙까지 가면 공이 핀을 16cm 파고든다(AMB_BALL_HIDE).
   */
  private placeAmbBall(L: AmbientLane, u: number) {
    L.ball.position.set(
      L.cx + L.pocketX + L.entryX * 2.2 * (1 - u * u),
      BALL_RADIUS - 0.01, // 옆 레인 바닥이 플레이 레인보다 1cm 낮다
      THREE.MathUtils.lerp(BALL_START_Z, HEADPIN_Z - AMB_BALL_HIDE, u),
    );
  }

  /**
   * 이번 투구의 결과를 **공이 들어간 자리에서** 만든다.
   * 넘어질 핀 · 넘어지는 방향 · 넘어지는 순서가 모두 충격점(포켓 × 헤드핀) 거리에서 나온다 —
   * 예전엔 셋 다 공과 무관한 난수였고, 그래서 공과 핀이 인과로 묶이지 않았다.
   */
  private rollAmbient(L: AmbientLane) {
    const ix = L.cx + L.pocketX;
    let maxDelay = 0;
    for (const p of L.pins) {
      const dx = p.home.x - ix;
      const dz = p.home.z - HEADPIN_Z;
      const d = Math.hypot(dx, dz);
      // 가까운 핀은 거의 확실히, 먼 핀(뒷줄 코너 d≈0.95)은 절반 이하 → 코너 잔존이 자연히 생긴다
      p.down = L.rng() < THREE.MathUtils.clamp(1.35 - d * 0.95, 0.3, 1);
      if (!p.down) {
        // 이번엔 서 있지만, 나중에 레이크가 밀 때 같은 궤적 계산을 쓴다 → 데이터는 채워둔다
        p.delay = 0;
        p.dir.set(0, 0, 1); // 레이크는 다운레인으로 민다
        p.axis.copy(AMB_KNOCK_AXIS);
        p.angle = Math.PI / 2;
        p.travel = 0.12;
        p.hop = 0.02;
        continue;
      }
      p.delay = d * AMB_FALL_SPREAD + L.rng() * 0.04; // 헤드핀부터 뒷줄로 번지는 연쇄
      maxDelay = Math.max(maxDelay, p.delay);
      // 충격점에서 **방사형**으로 흩어진다 + 다운레인 바이어스(공이 실어준 방향).
      // 헤드핀은 충격점과 거의 같은 자리라 방사 방향이 정의되지 않는데, 바이어스가 그걸 메운다.
      p.dir.set(dx, 0, dz + 0.55).normalize();
      p.axis.set(p.dir.z, 0, -p.dir.x).normalize(); // 이 축 +회전 = up이 dir 쪽으로 눕는다
      // 90° 또는 270° — 둘 다 '누운' 자세로 끝나지만 270°는 한 바퀴 더 굴러 텀블링이 된다.
      // 90° 고정이면 10개가 전부 같은 방식으로 기울어 기계적으로 보인다.
      p.angle = Math.PI / 2 + (L.rng() < 0.35 ? Math.PI : 0);
      // 무게중심 이동 0.25~0.9m. 예전 0.05~0.17m로는 '제자리에서 기울었다'로 보였다.
      p.travel = 0.25 + L.rng() * 0.65;
      p.hop = 0.04 + L.rng() * 0.1;
      // ⚠️ 킥백 안에 가둔다. 물리가 없으니 막아줄 게 없어서, 코너 핀이 옆으로 크게 날면
      //    킥백 벽(레인 중앙 ±0.805)을 넘어 **옆 레인으로 넘어간다**. 여유 0.72까지만 허용.
      if (Math.abs(p.dir.x) > 1e-3) {
        const lat = p.home.x - ix + L.pocketX; // 레인 중앙 대비 이 핀의 x
        const room = ((p.dir.x > 0 ? 0.72 : -0.72) - lat) / p.dir.x;
        p.travel = Math.min(p.travel, Math.max(0.12, room));
      }
    }
    L.fallSpan = AMB_FALL_T + maxDelay;
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
