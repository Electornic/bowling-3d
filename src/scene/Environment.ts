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

/** 옆벽 네온 광고판 — 미니 신스웨이브 엠블럼(텍스트 없음 → 좌우 미러 무관). 에셋 0. */
function makePosterTexture(accent: string, accent2: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, 256);
  bg.addColorStop(0, '#180a2e');
  bg.addColorStop(1, '#06030f');
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  // 미니 선셋
  const sun = g.createLinearGradient(0, 80, 0, 168);
  sun.addColorStop(0, accent2);
  sun.addColorStop(1, accent);
  g.fillStyle = sun;
  g.beginPath();
  g.arc(128, 168, 66, Math.PI, 0);
  g.fill();
  g.fillStyle = '#06030f';
  for (let i = 0; i < 5; i++) g.fillRect(58, 126 + i * 9, 140, 4);
  // 바닥 그리드
  g.strokeStyle = accent;
  g.globalAlpha = 0.5;
  g.lineWidth = 2;
  for (let i = 1; i <= 6; i++) {
    const y = 170 + i * i * 2.0;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  for (let i = -5; i <= 5; i++) {
    g.beginPath();
    g.moveTo(128 + i * 12, 170);
    g.lineTo(128 + i * 64, 256);
    g.stroke();
  }
  g.globalAlpha = 1;
  // 네온 프레임
  g.strokeStyle = accent;
  g.shadowColor = accent;
  g.shadowBlur = 18;
  g.lineWidth = 8;
  g.strokeRect(10, 10, 236, 236);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
        // 장식 핀 (정삼각형 10개)
        for (let r = 0; r < 4; r++) {
          for (let c2 = 0; c2 <= r; c2++) {
            const pin = new THREE.Mesh(pinGeo, pinMat);
            pin.position.set(cx + (c2 - r / 2) * PIN_SPACING, 0, HEADPIN_Z + r * ROW_GAP); // base가 y=0 (병 프로파일)
            engine.addVisual(pin);
          }
        }
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

    // --- 양쪽 벽 + 천장 + 조명 스트립 ---
    const matWall = new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, len + 9), matWall);
      sw.position.set(side * HALL_HALF_W, 2.0, midZ - 3);
      engine.addVisual(sw);
    }
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.2, len + 9),
      new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.95 }),
    );
    ceiling.position.set(0, 4.1, midZ - 3);
    engine.addVisual(ceiling);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: NEON.ice,
      emissiveIntensity: 1.6,
    });
    for (const x of [-2.4, 0, 2.4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, len + 7), stripMat);
      strip.position.set(x, 3.96, midZ - 3); // 천장 수렴선 = 강한 원근 단서
      engine.addVisual(strip);
    }

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

    // --- 옆벽 네온 광고판 (정적, 절차적) ---
    const adGeo = new THREE.PlaneGeometry(1.7, 1.2);
    const ads = [
      { tex: makePosterTexture(NEON.pink, NEON.amber), z: 3.5 },
      { tex: makePosterTexture(NEON.cyan, NEON.purple), z: 9.5 },
    ];
    for (const side of [-1, 1]) {
      for (const ad of ads) {
        const panel = new THREE.Mesh(
          adGeo,
          new THREE.MeshBasicMaterial({ map: ad.tex, toneMapped: false }),
        );
        panel.position.set(side * (HALL_HALF_W - 0.18), 2.4, ad.z);
        panel.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
        engine.addVisual(panel);
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

  /** 매 렌더 프레임 호출 (Boot.onFrame) — 전광판 애니메이션 갱신 */
  update(dt: number) {
    this.time += dt;
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
