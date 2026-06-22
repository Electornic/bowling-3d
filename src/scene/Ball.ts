import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  BALL_RADIUS,
  BALL_START_Z,
  MIN_SPEED,
  MAX_SPEED,
  SLIP_EPS,
  FRICTION_K,
  REF_MASS,
  SPIN_RATE,
  effectiveSpin,
  ROLL_RATIO,
  BALL_FRICTION,
  CG_BALL,
  CG_WORLD,
  CG_PIN,
  CG_BARRIER,
  cgroups,
} from '../game/constants';
import { hookFactor } from '../game/oil';
import type { BallSpec } from '../game/BallSpec';
import { CLASSIC_SKIN, type BallSkin } from '../game/rewards';

/**
 * 볼링 공: 시각 메시 + 물리 강체. 무게는 BallSpec에서 주입 (도안 §4.5).
 * CCD on (터널링 방지 §4·§13).
 */
export class Ball {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  private collider: RAPIER.Collider; // 반경 변경 시 재생성(remove+create) — makeCollider 팩토리로 새 shape·질량 일관 재구성
  private spec: BallSpec;
  private skin: BallSkin = CLASSIC_SKIN;
  private _radius = BALL_RADIUS; // 현재 공 반경 — 모드별 가변(덕핀 #5). 기본 = 표준 BALL_RADIUS.
  private readonly gripMats: THREE.MeshStandardMaterial[] = [];

  constructor(
    private readonly engine: Engine,
    spec: BallSpec,
  ) {
    const RAPIER = getRapier();
    this.spec = spec;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.25, metalness: 0.3 }),
    );
    this.mesh.castShadow = true;

    // 표면 마킹 (회전이 '보이게' — 무지 구는 ωz가 커도 도는 게 안 보인다). 자식이라 공과 함께 회전.
    const placeMark = (dir: THREE.Vector3, radius: number, color: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
      );
      m.position.copy(dir).multiplyScalar(BALL_RADIUS + 0.0006); // 표면 바로 위 (z-fight 방지)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); // 법선 = 바깥
      this.mesh.add(m);
      return m;
    };
    // 손가락 구멍 3개 (grip 주변 작은 삼각형, 어두움)
    // NOTE: setSpec은 공 본체색만 바꾸고 구멍색은 고정(0x0a0a0a)이라 어두운 공에선 대비가 낮아 묻힘 — 알려진 사양(유지)
    const grip = new THREE.Vector3(0.4, 0.9, 0.3).normalize();
    const tan = new THREE.Vector3(0, 1, 0).cross(grip).normalize();
    const bitan = grip.clone().cross(tan).normalize();
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      const dir = grip
        .clone()
        .addScaledVector(tan, Math.cos(a) * 0.2)
        .addScaledVector(bitan, Math.sin(a) * 0.2)
        .normalize();
      this.gripMats.push(placeMark(dir, 0.013, 0x0a0a0a).material as THREE.MeshStandardMaterial);
    }
    // 로고 점 (밝은색 — 어두운 공에서도 회전 추적용 기준점)
    placeMark(new THREE.Vector3(-0.5, -0.1, -0.85).normalize(), 0.024, 0xeae0c8);

    this.body = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, BALL_RADIUS, BALL_START_Z)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1),
    );
    this.collider = this.makeCollider();
    engine.add({ mesh: this.mesh, body: this.body });
  }

  /** 현재 반경(_radius)·질량(spec)으로 콜라이더를 만들어 body에 붙인다. 생성자 + setRadius 공용. */
  private makeCollider(): RAPIER.Collider {
    const RAPIER = getRapier();
    return this.engine.world.createCollider(
      RAPIER.ColliderDesc.ball(this._radius)
        .setMass(this.spec.massKg)
        .setRestitution(0.1)
        .setFriction(BALL_FRICTION)
        // 충돌 그룹(장애물 레인 #3): 공은 레인·벽(WORLD)·핀(PIN)·배리어(BARRIER) 전부와 충돌.
        .setCollisionGroups(cgroups(CG_BALL, CG_WORLD | CG_PIN | CG_BARRIER))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );
  }

  /** 조준선 예측 시뮬레이션용 (Controls) */
  get massKg() {
    return this.spec.massKg;
  }
  get speedScale() {
    return this.spec.maxSpeedScale;
  }
  /** 현재 공 반경 (m) — 거터 perch·조준 등 외부 계산이 모드별 실제 반경을 쓰게 노출 (덕핀 #5). */
  get radius() {
    return this._radius;
  }

  /**
   * 공 반경 교체 — 덕핀(#5)은 작은 공. 콜라이더 반경(setRadius) + 메시 스케일을 함께 바꾸고
   * 휴지 위치를 새 반경에 맞춰 리셋한다. 무게(setSpec)와 직교 — startMatch에서 모드별 1회 호출.
   */
  setRadius(r: number) {
    if (r === this._radius) return; // 같은 반경이면 생략 — 텐핀은 콜라이더 재생성을 안 탐(거동 불변)
    this._radius = r;
    // 콜라이더 재생성(remove+create) — 생성자와 같은 makeCollider 팩토리로 새 반경·질량을 일관되게 재구성.
    this.engine.world.removeCollider(this.collider, false);
    this.collider = this.makeCollider();
    // 구 + 표면 마킹(자식)을 함께 축소. 마킹은 생성자에서 BALL_RADIUS 기준으로 배치돼 비례가 유지된다.
    this.mesh.scale.setScalar(r / BALL_RADIUS);
    this.reset();
  }

  /** 볼 무게/색 교체 (BallPicker, AIMING 중에만 권장). 도안 §4.5 */
  setSpec(spec: BallSpec) {
    this.spec = spec;
    this.collider.setMass(spec.massKg);
    this.applyMaterial();
  }

  /** 코스메틱 스킨 적용 — 외형만(물리/AI 사다리 무영향, REWARDS.md §3). */
  setSkin(skin: BallSkin) {
    this.skin = skin;
    this.applyMaterial();
  }

  /** spec(무게색) + skin(외형)을 합쳐 머티리얼에 반영. */
  private applyMaterial() {
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    const s = this.skin;
    mat.color.setHex(s.useWeightColor ? this.spec.color : s.color ?? this.spec.color);
    mat.roughness = s.roughness ?? 0.25;
    mat.metalness = s.metalness ?? 0.3;
    mat.envMapIntensity = s.envMapIntensity ?? 1;
    mat.emissive.setHex(s.emissive ?? 0x000000);
    mat.emissiveIntensity = s.emissiveIntensity ?? 1;
    mat.needsUpdate = true;
    const decor = s.decorColor ?? 0x0a0a0a; // 어두운 스킨엔 밝은 그립(알려진 이슈 해결)
    for (const g of this.gripMats) g.color.setHex(decor);
  }

  /** aim ∈ [-1,1] 횡방향, power ∈ [0,1], spin ∈ [-1,1] 좌/우 훅. 도안 §8 발사 변환. */
  launch(aim: number, power: number, spin = 0) {
    const speed = (MIN_SPEED + power * (MAX_SPEED - MIN_SPEED)) * this.spec.maxSpeedScale;
    const len = Math.hypot(aim, 1);
    const vx = (aim / len) * speed;
    const vz = (1 / len) * speed;
    this.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    // 굴림축을 진행 방향에 정렬(ω = n̂×v/R · ROLL_RATIO) — 대각 투구의 가짜 슬립 제거.
    // 거기에 스핀(ωz)을 더해 의도된 측면 슬립만 훅으로 작용.
    this.body.setAngvel(
      {
        x: (vz / this._radius) * ROLL_RATIO,
        y: 0,
        z: -(vx / this._radius) * ROLL_RATIO + effectiveSpin(spin) * SPIN_RATE,
      },
      true,
    );
  }

  /**
   * 스핀(훅) 측면력: 슬립 기반 (도안 §4.1). ROLLING 중 매 물리 스텝 호출.
   * 접촉점 수평 슬립 = (vx + ωz·R, vz − ωx·R). 슬립 반대로 동마찰 임펄스.
   * REF_MASS 고정이라 가벼운 공일수록 가속도(F/m)가 커 더 휜다.
   * hookFactor(z) 게이트 — 오일 존에선 0(직진), 드라이 존에서 1(레이트 훅).
   */
  applySpinForce(dt: number) {
    const t = this.body.translation();
    const hook = hookFactor(t.z);
    if (hook <= 0) return;
    if (t.y > this._radius + 0.005) return; // 접지 마찰 모델 — 공중(바운드 중)엔 주입 금지
    const v = this.body.linvel();
    const w = this.body.angvel();
    const slipX = v.x + w.z * this._radius;
    const slipZ = v.z - w.x * this._radius;
    const slipMag = Math.hypot(slipX, slipZ);
    if (slipMag <= SLIP_EPS) return;
    const fMag = FRICTION_K * REF_MASS * 9.81 * hook;
    this.body.applyImpulse(
      { x: -(slipX / slipMag) * fMag * dt, y: 0, z: -(slipZ / slipMag) * fMag * dt },
      true, // wakeUp (도안 §4.6)
    );
  }

  reset() {
    this.body.setTranslation({ x: 0, y: this._radius, z: BALL_START_Z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
