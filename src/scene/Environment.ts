import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  PIN_DECK_END,
  HEADPIN_Z,
  PIN_SPACING,
  ROW_GAP,
  PIN_PROFILE,
  MOOD,
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
  // 무드 상태(B): 스코어 이벤트를 텍스트 없이 에너지로만 반영. update(dt)에서 매 프레임 이징, drawScreen이 소비.
  private energy: number = MOOD.baseEnergy; // 지속 열기(스트라이크 연속). base로 자연 냉각
  private flash = 0; // 순간 버스트(스트라이크=1 / 스페어=spareFlash). 지수 감쇠
  private dip = 0; // 거터 브라운아웃(1→0). 지수 감쇠
  private readonly tint = new THREE.Color(NEON.cyan); // 현재 무드 틴트(이징됨) — 하우스 기본=시안
  private readonly tintTarget = new THREE.Color(NEON.cyan); // 목표 틴트(현재 플레이어 색)

  constructor(engine: Engine) {
    const len = LANE_END_Z - LANE_START_Z;
    const midZ = (LANE_START_Z + LANE_END_Z) / 2;
    const half = LANE_WIDTH / 2;

    const woodNeighbor = makeWoodTexture('#a8763a', '#7d5524');
    woodNeighbor.repeat.set(1, 7);
    const matLane = new THREE.MeshStandardMaterial({ map: woodNeighbor, roughness: 0.55 });
    const matGutter = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.7 });
    const matRail = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.85 });
    // 배경 장식 핀 — 진짜 핀(Pin.ts)과 같은 병 실루엣 LatheGeometry. (예전 단순 원뿔 실린더라 어색했음.)
    // base가 y=0, 꼭대기 y≈0.38. 배경이라 세그먼트는 적게(12). 프로파일은 constants.PIN_PROFILE 단일소스 공유(#9).
    const pinProfile = PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y));
    const pinGeo = new THREE.LatheGeometry(pinProfile, 12);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.5 });

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
          gut.position.set(cx + s2 * (half + GUTTER_WIDTH / 2), -0.18, midZ);
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
      // 레인 사이 레일(칸막이) — 반복 구조물 = 원근 단서.
      // k=0(플레이 레인 경계, x≈±0.805)은 건너뜀 — Lane.ts 거터 바깥 벽(x≈±0.78)과 같은 평면에
      // 겹쳐 z-fighting(=거터 벽 점멸)을 일으켰다. 플레이 레인 경계 벽은 Lane이 단독으로 그린다.
      for (let k = 1; k <= 2; k++) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, len), matRail);
        rail.position.set(side * (LANE_UNIT / 2 + k * LANE_UNIT), 0.1, midZ);
        engine.addVisual(rail);
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
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.5, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x12161f, roughness: 0.85 }),
    );
    canopy.position.set(0, 1.55, HEADPIN_Z + 0.6);
    engine.addVisual(canopy);
    const neon = (color: THREE.ColorRepresentation, y: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(HALL_HALF_W * 2, 0.07, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.4 }),
      );
      m.position.set(0, y, HEADPIN_Z - 0.52);
      engine.addVisual(m);
    };
    neon(NEON.pink, 1.36); // 핑크
    neon(NEON.cyan, 1.22); // 시안

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
    const scrW = HALL_HALF_W * 1.95; // 마스킹 월을 거의 꽉 채우는 풀사이즈
    const scrH = scrW * (256 / 768);
    const screenY = 2.3;
    const bezel = new THREE.Mesh(
      new THREE.BoxGeometry(scrW + 0.3, scrH + 0.3, 0.12),
      new THREE.MeshStandardMaterial({ color: 0x04060b, roughness: 0.8 }),
    );
    bezel.position.set(0, screenY, LANE_END_Z + 0.18);
    engine.addVisual(bezel);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(scrW, scrH),
      new THREE.MeshBasicMaterial({ map: this.screenTex, toneMapped: false }),
    );
    screen.position.set(0, screenY, LANE_END_Z + 0.11); // 마스킹 월 앞, 핀 위
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

  /** 턴 전환 → 현재 플레이어 네온 색으로 무드 틴트 크로스페이드 (Boot: turn 이벤트) */
  setActivePlayerTint(colorHex: string) {
    this.tintTarget.set(colorHex);
  }

  /**
   * 스코어 이벤트 → 비텍스트 무드 펄스 (Boot.onEvent). 텍스트는 스틸컷이 담당, 여기선 "에너지"만.
   * strike: 연속수만큼 열기↑ + 풀 플래시 / spare: 작은 플래시 / gutter: 브라운아웃(열기는 자연 냉각).
   */
  pulse(kind: 'strike' | 'spare' | 'gutter', streak = 0) {
    if (kind === 'strike') {
      this.energy = Math.max(this.energy, Math.min(1, MOOD.baseEnergy + MOOD.streakStep * streak));
      this.flash = 1;
    } else if (kind === 'spare') {
      this.flash = Math.max(this.flash, MOOD.spareFlash);
    } else {
      this.dip = 1; // 거터 = 순간 디밍/플리커
    }
  }

  /** 매 렌더 프레임 호출 (Boot.onFrame) — 무드 상태 적분 + 전광판 애니메이션 갱신 */
  update(dt: number) {
    this.time += dt;
    // 무드는 매 프레임 dt 정확히 적분 (재드로우 스로틀과 무관 — 엔벨로프 타이밍 보존).
    this.energy += (MOOD.baseEnergy - this.energy) * (1 - Math.exp(-dt / MOOD.energyTau));
    this.flash *= Math.exp(-dt / MOOD.flashTau);
    this.dip *= Math.exp(-dt / MOOD.dipTau);
    this.tint.lerp(this.tintTarget, 1 - Math.exp(-dt / MOOD.tintTau));
    // 재드로우 스로틀(#2): drawScreen()은 그라디언트2 + 태양 + 그리드 33선 + 마퀴 + 무드 오버레이를
    // 매번 다시 그리고 768×256 텍스처를 통째 재업로드한다. 스크롤·마퀴·플래시/충격파는 24fps에서
    // 충분히 매끄러우므로 ~1/24초 간격으로만 갱신 → 렌더 비용 절반↓ (무드 적분은 위에서 매 프레임).
    if (this.time - this.lastDraw >= 1 / 24) {
      this.lastDraw = this.time;
      this.drawScreen();
      this.screenTex.needsUpdate = true;
    }
  }

  /** 전광판 한 프레임 렌더 (신스웨이브 + 무드 반응: 틴트/열기/플래시/디밍) */
  private drawScreen() {
    const ctx = this.screenCtx;
    const W = ctx.canvas.width;
    const H = ctx.canvas.height;
    const t = this.time;
    const cx = W / 2;
    const horizon = H * 0.5;
    // 무드: 열기(+아이들 호흡) → 팔레트 밝기·태양 반경·스크롤 속도. 플래시/디밍은 순간 오버레이.
    const glow = Math.max(0, Math.min(1, this.energy + MOOD.idleBreath * Math.sin(t * 1.7)));
    const tintCss = '#' + this.tint.getHexString();

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1a0b30');
    sky.addColorStop(0.5, '#0a0418');
    sky.addColorStop(1, '#040209');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 태양 (수평선 위 반원 + 가로 스트라이프) — 열기로 반경↑
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, horizon);
    ctx.clip();
    const sunR = H * 0.36 * (1 + 0.16 * glow);
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

    // 바닥 그리드 (스크롤) — 열기로 스크롤 가속 + 라인 밝기↑
    ctx.lineWidth = 2;
    const scroll = (t * (0.3 + 0.9 * glow)) % 1;
    for (let i = 0; i < 16; i++) {
      const f = (i + scroll) / 16;
      const y = horizon + (H - horizon) * f * f;
      ctx.strokeStyle = rgba(NEON.cyan, (0.1 + 0.55 * f) * (0.8 + 0.5 * glow));
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

    // 플레이어 틴트 워시 — 전체를 현재 플레이어 색으로 은은히 바이어스(열기 클수록 진하게)
    ctx.fillStyle = rgba(tintCss, 0.06 + 0.1 * glow);
    ctx.fillRect(0, 0, W, H);

    // 상단 스크롤 마퀴 (브랜딩 — 정보 아님, 항상 유지)
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

    // 플래시(스트라이크/스페어) — 골드 블룸 + 밖으로 퍼지는 충격파 링. 가산합성으로 '쾅'.
    if (this.flash > 0.02) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba('#ffe6b0', 0.5 * this.flash);
      ctx.fillRect(0, 0, W, H);
      const ringR = H * 0.9 * (1 - this.flash); // flash 1→0 감쇠에 따라 반경 0→max 확장
      ctx.strokeStyle = rgba('#fff2cc', this.flash * 0.9);
      ctx.lineWidth = 6 * this.flash + 1;
      ctx.beginPath();
      ctx.arc(cx, horizon, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 디밍(거터) — 전체 브라운아웃 + 빠른 플리커
    if (this.dip > 0.02) {
      const flick = 0.7 + 0.3 * Math.sin(t * 48);
      ctx.fillStyle = rgba('#000000', 0.6 * this.dip * flick);
      ctx.fillRect(0, 0, W, H);
    }
  }
}
