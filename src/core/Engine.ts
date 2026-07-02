import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getRapier } from './Boot';
import { isCoarsePointer } from './device';

/**
 * 저사양(주로 모바일) 판정 — 부팅 1회 (MOBILE_SUPPORT.md §6).
 * deviceMemory(Chrome)·coarse 포인터·화면폭 휴리스틱. antialias는 생성자 옵션이라
 * 런타임 토글 불가 → 여기서 한 번 결정. pixelRatio·shadowMap도 이 판정으로 낮춘다.
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
 * 로비 따뜻한 볼링장 IBL용 절차 씬 (리얼 재테마, 에셋 0). 구 네온 팔레트 대신 천장 형광 + 우드/카펫
 * 간접 반사 + 핀덱 쪽 약한 쿨화이트를 방향별 발광 패널로 배치 → PMREMGenerator.fromScene으로 구워
 * 로비 PBR 표면을 따뜻하게 데운다. IBL은 그림자를 못 만들므로 lobbyScene 디렉셔널 라이트는 유지. (1회 생성)
 */
function makeBowlingEnvScene(): THREE.Scene {
  const s = new THREE.Scene();
  s.background = new THREE.Color(0x2a2f3a); // 밝은 쿨뉴트럴 앵커 (전방위 간접광↑ → 도박장 어둠 탈피)
  // [색, 위치, 크기] — 볼링장 조명: 천장 형광(전반 간접) + 좌우 우드 반사 + 레인쪽 핀덱 쿨화이트(대비).
  const panels: [number, [number, number, number], [number, number, number]][] = [
    [0xfffaf0, [0, 9, -3], [22, 0.5, 22]], // 천장 — 밝은 형광 (전반 간접광↑)
    [0xffe2b4, [9, 3, 0], [0.5, 6, 16]], // 우측 — 따뜻한 우드 반사(밝게)
    [0xffe2b4, [-9, 3, 0], [0.5, 6, 16]], // 좌측 — 따뜻한 우드 반사(밝게)
    [0xf0f4ff, [0, 3.5, -11], [18, 6, 0.5]], // 레인쪽 — 핀덱 쿨화이트(따뜻함과 대비)
    [0x40342a, [0, 1, 7], [16, 5, 0.5]], // 뒤 — 우드(밝게)
  ];
  for (const [color, [px, py, pz], [sx, sy, sz]] of panels) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), new THREE.MeshBasicMaterial({ color }));
    m.position.set(px, py, pz);
    s.add(m);
  }
  return s;
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
  /** 로비(대기실) 전용 씬 — 레인 씬과 분리해 렌더 (OPEN_WORLD_LOBBY 슬라이스 2: 별도 공간). */
  readonly lobbyScene: THREE.Scene;
  private rendered!: THREE.Scene; // 현재 렌더 대상 (기본 레인 씬, setScreen으로 스왑)
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
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.lowEnd ? 1.5 : 2));
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

    // --- 로비 씬 (별도 공간, 슬라이스 2) --- 레인 씬과 분리 → 자체 배경·조명, 환경맵은 공유.
    this.lobbyScene = new THREE.Scene();
    this.lobbyScene.background = new THREE.Color(0x33384a); // 밝은 쿨뉴트럴 (도박장 어둠/웜 탈피 — 현대 볼링장)
    this.lobbyScene.fog = new THREE.Fog(0x33384a, 14, 40);
    // 밝은 볼링장 IBL (리얼 재테마) — 천장 형광·우드 반사 + 쿨뉴트럴 앵커로 PBR 표면을 밝게 채운다.
    // 1회 생성(매 프레임 금지 — fill-rate 폭주 방지). 카펫은 매트(반사↓), 우드/메탈 소품이 이 env를 반사한다.
    this.lobbyScene.environment = pmrem.fromScene(makeBowlingEnvScene(), 0.04).texture;
    this.lobbyScene.environmentIntensity = 0.7; // 간접광↑ (도박장 어둠 탈피) — 단 매트 카펫이라 과반사는 아님
    this.lobbyScene.add(new THREE.AmbientLight(0xfff2e2, 1.0)); // 밝은 뉴트럴-웜 앰비언트
    const lobbyDir = new THREE.DirectionalLight(0xfffaf0, 1.45); // 밝은 주광 (천장 조명 느낌)
    lobbyDir.position.set(2, 10, -3);
    this.lobbyScene.add(lobbyDir);
    this.rendered = this.scene; // 기본 = 레인 씬 (MENU 시네마틱 배경도 레인)

    // --- 카메라 ---
    this.camera = new THREE.PerspectiveCamera(
      52, // 60은 광각이라 레인이 얇고 멀어 보임 — 살짝 조여 레인 비중↑
      window.innerWidth / window.innerHeight,
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

    // --- 물리 월드 ---
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.integrationParameters.maxCcdSubsteps = 4; // 저FPS(모바일) 터널링 보완 (도안 §12)
    this.eventQueue = new RAPIER.EventQueue(true);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
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
    const cap = high ? (this.lowEnd ? 1.5 : 2) : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    this.renderer.setSize(window.innerWidth, window.innerHeight); // pixelRatio 변경 반영
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

  /** 로비 씬에 시각 객체 추가 (레인 씬과 분리, 슬라이스 2). */
  addLobby(obj: THREE.Object3D) {
    this.lobbyScene.add(obj);
  }

  /** 렌더 대상 화면 전환 — 'lobby'면 로비 씬, 아니면 레인 씬. 전환 순간은 로딩 오버레이가 덮는다. */
  setScreen(which: 'lane' | 'lobby') {
    this.rendered = which === 'lobby' ? this.lobbyScene : this.scene;
  }

  /** 고정 timestep 물리 진행 + 보간용 prev/cur 갱신. 충돌 이벤트 drain (§10). */
  step(dt: number) {
    for (const o of this.objects) {
      o.prevPos.copy(o.curPos);
      o.prevQuat.copy(o.curQuat);
    }
    this.world.timestep = dt;
    this.world.step(this.eventQueue);
    if (this.onContact) {
      this.eventQueue.drainContactForceEvents((e) => this.onContact!(e.totalForceMagnitude()));
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
   * 보간 상태(prev/cur)와 시각 메시를 현재 물리 바디 위치로 즉시 일치시킨다.
   * 리플레이처럼 메시를 직접 몰고(혹은 일시정지로 step을 건너뛰어 prev/cur가 정지한) 뒤
   * 라이브로 복귀할 때 호출 — 다음 step의 prev=옛위치로 인한 보간 튐/순간이동 lerp를 막는다.
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
    this.renderer.render(this.rendered, this.camera);
  }
}
