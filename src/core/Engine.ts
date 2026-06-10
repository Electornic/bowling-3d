import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type RAPIER from '@dimforge/rapier3d-compat';
import { getRapier } from './Boot';

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

  constructor() {
    const RAPIER = getRapier();

    // --- 렌더러 ---
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild(this.renderer.domElement);

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
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 50;
    const r = 14;
    dir.shadow.camera.left = -r;
    dir.shadow.camera.right = r;
    dir.shadow.camera.top = r;
    dir.shadow.camera.bottom = -r;
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

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
