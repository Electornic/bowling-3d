import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getRapier } from './Boot';
import { isCoarsePointer } from './device';
import { GRAVITY } from '../game/constants';

/**
 * 저사양(주로 모바일) 판정 — 부팅 1회 (MOBILE_SUPPORT.md §6).
 *
 * 이 판정이 **실제로 가르는 건 둘뿐**이다: pixelRatio 상한(1.5 vs 2)과 shadow map 크기
 * (512 vs 1024). antialias는 아래에서 보듯 **항상 ON**이라 이 판정과 무관하다 — 끄면
 * 고대비 모서리(거터 벽)가 카메라 이동 중 떨리는 edge crawl이 생긴다.
 */
function isLowEnd(): boolean {
  // 실제 저메모리 신호(Chrome/Android의 deviceMemory ≤4GB)일 때만 저사양 처리. 화면폭만으로는
  // 판정하지 않는다 — iOS Safari엔 deviceMemory API가 없어, 작은화면 기준이면 플래그십(iPhone 등)이
  // 저사양으로 오판돼 antialias가 꺼지고 저해상도로 렌더되어 고대비 모서리(거터 벽 등)가 카메라
  // 이동 시 떨리는(edge crawl) 점멸이 생겼다.
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return isCoarsePointer() && mem !== undefined && mem <= 4;
}

/**
 * 현재 창 크기의 안전한 aspect — **0이 들어오는 순간이 있다.** 탭 숨김·모바일 주소창
 * 애니메이션·앱 복귀 직후, 그리고 숨은 탭에서의 부팅. 그대로 쓰면 aspect가 NaN(0/0) 또는
 * Infinity(w/0)가 되어 투영 행렬이 오염되고, **그 프레임에 투영을 써서 계산된 것들이 NaN으로
 * 굳는다** (조준 화살촉이 화면 공간에서 만들어져 정확히 이 피해를 입었다 — 캐시에 남아
 * 크기가 정상으로 돌아와도 계속 깨져 보였다).
 *
 * null이면 "아직 유효한 크기가 아니다" — 생성자는 16/9로 시작하고 onResize는 건너뛴다.
 * 예전엔 이 방어가 두 곳에 복붙돼 있었고 주석이 "서로 한 쌍"이라고만 적어뒀다.
 */
function safeAspect(): number | null {
  const w = window.innerWidth;
  const h = window.innerHeight;
  return w >= 1 && h >= 1 ? w / h : null;
}

/** three 메시 ↔ rapier 강체 페어 */
export interface PhysicsObject {
  mesh: THREE.Object3D;
  body: RAPIER.RigidBody;
}

/** 보간을 위해 이전/현재 물리 상태를 함께 추적 */
interface Tracked extends PhysicsObject {
  prevPos: THREE.Vector3;
  curPos: THREE.Vector3;
  prevQuat: THREE.Quaternion;
  curQuat: THREE.Quaternion;
}

/**
 * 렌더링(three) + 물리(rapier world) 코어 (도안 §5.2).
 * 고정 timestep 물리 + 렌더 보간(§B.6)으로 부드러운 움직임을 보장한다.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly world: RAPIER.World;
  private readonly eventQueue: RAPIER.EventQueue;
  /** 충돌 이벤트 콜백 (contact force 크기) — 사운드 연결용 (도안 §10) */
  onContact?: (magnitude: number) => void;
  private readonly objects: Tracked[] = [];
  private readonly lowEnd = isLowEnd(); // 저사양 판정 1회 — pixelRatio·shadow·품질 토글에서 공용

  constructor() {
    const RAPIER = getRapier();

    // --- 렌더러 --- (antialias 항상 ON으로 엣지 크롤 방지; 저사양만 pixelRatio 1.5 상한, MOBILE_SUPPORT.md §6)
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(this.pixelRatioCap(true)); // 부팅 기본 = high
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft = 그림자 가장자리 부드럽게 (셰도우 시밍↓)
    document.body.appendChild(this.renderer.domElement);

    // 캔버스 위 브라우저 제스처 차단: 롱프레스 메뉴(contextmenu) + 멀티터치 핀치줌(touchstart>1)
    const canvas = this.renderer.domElement;
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener(
      'touchstart',
      (e) => {
        if (e.touches.length > 1) e.preventDefault();
      },
      { passive: false },
    );

    // --- 씬 ---
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x101018);
    this.scene.fog = new THREE.Fog(0x101018, 24, 60); // 배경 벽(z≈21)은 또렷, 그 너머만 페이드

    // 실내 환경맵 (절차적, 에셋 0) → 반사·간접광으로 질감 향상 (도안 §5.4)
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.4; // 환경 반사 톤 다운 (레인 과노출 방지)

    // --- 카메라 ---
    this.camera = new THREE.PerspectiveCamera(
      // 40: 광각일수록 거리가 과장돼 핀이 멀고 작아 보인다(52에선 핀이 화면에서 거의 안 읽혔다).
      // 조여서 거리를 압축 — 핀·훅이 커진다. **조준 카메라 높이(CameraRig.AIM_Y)와 세트로만 바꿀 것**:
      // FOV만 줄이면 조준 화면에서 공이 화면 아래로 떨어진다(fov 45에서 y=-1.09, 52에서도 -0.92로
      // 이미 하단에 걸침). 높이를 0.75로 낮춰야 fov 37까지 공이 남는다. 핀은 전 구간 프레임 안.
      40,
      safeAspect() ?? 16 / 9, // 숨은 탭에서 부팅하면 창 크기가 0이다 (safeAspect 주석)
      0.1,
      200,
    );
    this.camera.position.set(0, 4, -6);
    this.camera.lookAt(0, 0, 4);

    // --- 조명 ---
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const dir = new THREE.DirectionalLight(0xffffff, 1.3);
    dir.position.set(6, 14, -2);
    dir.castShadow = true;
    dir.shadow.mapSize.set(this.lowEnd ? 512 : 1024, this.lowEnd ? 512 : 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 50;
    const r = 14;
    dir.shadow.camera.left = -r;
    dir.shadow.camera.right = r;
    dir.shadow.camera.top = r;
    dir.shadow.camera.bottom = -r;
    dir.shadow.normalBias = 0.03; // 표면 노멀 오프셋 — 수직 벽 등 빗각 면의 셰도우 에크니(줄무늬 점멸) 제거
    dir.shadow.bias = -0.0003;
    this.scene.add(dir);

    // 보조 필 라이트 (그림자 없음) — DirectionalLight가 하나뿐이라 좌우 옆벽 **내측면 중 한쪽만**
    // 빛을 받고 있었다(실측 픽셀 휘도 0.098 vs 0.055, 1.8배 차이 → 벽이 '면'으로 안 읽히는 원인 중 하나).
    // dir이 +x쪽(6,14,-2)에 있어 법선 −x인 면(월드 +x 벽의 안쪽)이 완전히 그늘이었다.
    // ⚠️ 거의 **수평으로 눕힌** 게 핵심이다 — y 성분이 0.09뿐이라 레인 윗면(법선 +y, 이미 휘도
    // 0.869로 클리핑 근처)에는 거의 안 얹히고, 법선 ±x인 벽면만 채운다. 위로 올리면 레인이 뜬다.
    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
    fill.position.set(-18, 1.6, 6);
    this.scene.add(fill);

    // 바운스 라이트 (그림자 없음) — **아래에서 위로** 쏜다. 조명이 둘 다 위에 있어서 천장 아랫면과
    // 보 밑면(법선 −y)이 앰비언트만 받아 0.044로 깔렸다. 위를 향한 면(법선 +y)은 N·L<0이라
    // **레인·바닥은 전혀 밝아지지 않는다** — 천장만 골라 때리는 조명이다.
    // 물리적으로도 근거가 있다: 실제 볼링장 천장은 밝은 메이플 레인에 반사된 빛으로 떠 있다.
    // 그래서 색도 나무색(0xffe9c8)이다.
    const bounce = new THREE.DirectionalLight(0xffe9c8, 0.4);
    bounce.position.set(0, -8, 8);
    this.scene.add(bounce);

    // --- 물리 월드 ---
    this.world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    this.world.integrationParameters.maxCcdSubsteps = 4; // 저FPS(모바일) 터널링 보완 (도안 §12)
    this.eventQueue = new RAPIER.EventQueue(true);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const aspect = safeAspect();
    if (aspect === null) return; // 유효한 크기가 올 때까지 건너뛴다 (safeAspect 주석)
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  /**
   * 그래픽 품질 토글 (일시정지 설정) — pixelRatio만 조절한다.
   * high = 부팅 기본(저사양 1.5 / 그 외 2), perf = 1.0(픽셀 ~1/4 → fill-rate↓ → 발열·배터리↓).
   * 셰도우 on/off는 머티리얼 셰이더 재컴파일(needsUpdate)이 필요해 런타임 토글에서 제외 — 모바일 부하의
   * 지배 인자는 fill-rate라 pixelRatio만으로 충분.
   */
  setQuality(high: boolean) {
    this.renderer.setPixelRatio(this.pixelRatioCap(high));
    this.renderer.setSize(window.innerWidth, window.innerHeight); // pixelRatio 변경 반영
  }

  /** 품질별 pixelRatio — 생성자와 setQuality가 같은 식을 쓰게. perf는 1.0(픽셀 ~1/4). */
  private pixelRatioCap(high: boolean): number {
    return Math.min(window.devicePixelRatio, high ? (this.lowEnd ? 1.5 : 2) : 1);
  }

  /** 물리 강체 + 시각 메시 등록 (보간 상태 초기화) */
  add(o: PhysicsObject) {
    const t = o.body.translation();
    const q = o.body.rotation();
    this.objects.push({
      mesh: o.mesh,
      body: o.body,
      prevPos: new THREE.Vector3(t.x, t.y, t.z),
      curPos: new THREE.Vector3(t.x, t.y, t.z),
      prevQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w),
      curQuat: new THREE.Quaternion(q.x, q.y, q.z, q.w),
    });
    this.scene.add(o.mesh);
  }

  /** 시각 전용 메시(레인 등) */
  addVisual(mesh: THREE.Object3D) {
    this.scene.add(mesh);
  }

  /** 고정 timestep 물리 진행 + 보간용 prev/cur 갱신. 충돌 이벤트 drain (§10). */
  step(dt: number) {
    for (const o of this.objects) {
      o.prevPos.copy(o.curPos);
      o.prevQuat.copy(o.curQuat);
    }
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    const onContact = this.onContact;
    if (onContact) {
      this.eventQueue.drainContactForceEvents((e) => onContact(e.totalForceMagnitude()));
    }
    for (const o of this.objects) {
      const t = o.body.translation();
      o.curPos.set(t.x, t.y, t.z);
      const q = o.body.rotation();
      o.curQuat.set(q.x, q.y, q.z, q.w);
    }
  }

  /**
   * 물리 → 시각, alpha(0~1) 보간으로 부드럽게 (도안 §B.6).
   * 큰 점프(리셋·순간이동, >2m)는 보간 스킵하고 즉시 반영.
   */
  sync(alpha: number) {
    for (const o of this.objects) {
      if (o.prevPos.distanceToSquared(o.curPos) > 4) {
        o.mesh.position.copy(o.curPos);
        o.mesh.quaternion.copy(o.curQuat);
      } else {
        o.mesh.position.lerpVectors(o.prevPos, o.curPos, alpha);
        o.mesh.quaternion.slerpQuaternions(o.prevQuat, o.curQuat, alpha);
      }
    }
  }

  /**
   * 보간 상태(prev/cur)와 시각 메시를 현재 물리 바디 위치로 즉시 일치. 리플레이가 메시를 직접 몰거나
   * 일시정지로 step을 건너뛴 뒤 라이브 복귀할 때 호출 — 다음 step의 prev=옛위치로 인한 보간 튐 방지(item 2).
   */
  snapToBodies() {
    for (const o of this.objects) {
      const t = o.body.translation();
      o.curPos.set(t.x, t.y, t.z);
      o.prevPos.copy(o.curPos);
      const q = o.body.rotation();
      o.curQuat.set(q.x, q.y, q.z, q.w);
      o.prevQuat.copy(o.curQuat);
      o.mesh.position.copy(o.curPos);
      o.mesh.quaternion.copy(o.curQuat);
    }
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
