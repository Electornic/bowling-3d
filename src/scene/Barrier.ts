import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import { CG_BALL, CG_BARRIER, cgroups } from '../game/constants';
import type { BarrierSpec } from '../game/obstacles';

/**
 * 장애물 레인(#3)의 네온 배리어 — 정적(fixed) 콜라이더 + 발광 박스 메시.
 *
 * 충돌 그룹으로 **공만 막고 핀 물리엔 안 낀다**(constants.ts cgroups 주석). 배리어 z(≤16)는
 * 임팩트 트리거 z(PIN_CONTACT_Z 18.11)보다 앞이라 공-배리어 접촉은 Boot.onContact에서 자동 no-op
 * → 슬로모·크래시·셰이크 없이 물리적 튕김만. 굴림음(onRoll)은 공 속도 기반이라 그대로 유지.
 *
 * 핀처럼 부팅 때 풀(pool)로 한 번 생성하고 스테이지마다 위치·크기·표시를 갈아끼운다
 * (핀 동적 생성/제거 인프라 부재 — 구조 감사). cuboid는 크기 가변이 까다로워 apply마다
 * 콜라이더를 교체(removeCollider→createCollider)한다 — 스테이지 전환은 AIMING 사이라 안전.
 */

const DEF_W = 0.22; // x폭
const DEF_H = 0.4; // 높이 (공 지름 0.218을 확실히 막음)
const DEF_D = 0.1; // z깊이
const STASH_Y = -50; // 미사용 배리어를 레인 밑으로 (핀 stash와 동일 관례)

const UNIT_GEO = new THREE.BoxGeometry(1, 1, 1); // 공유 단위 박스 — 메시 scale로 크기 표현

class Barrier {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  private readonly mat: THREE.MeshStandardMaterial;
  private collider: RAPIER.Collider | null = null;
  private readonly world: RAPIER.World;

  constructor(engine: Engine) {
    const RAPIER = getRapier();
    this.world = engine.world;
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x0a0a12,
      emissive: 0x22d3ee,
      emissiveIntensity: 1.3,
      roughness: 0.4,
      metalness: 0.1,
      transparent: true,
      opacity: 0.86,
    });
    this.mesh = new THREE.Mesh(UNIT_GEO, this.mat);
    this.mesh.visible = false;
    this.mesh.castShadow = true;
    this.body = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, STASH_Y, 0),
    );
    engine.add({ mesh: this.mesh, body: this.body }); // Engine 보간/렌더 추적 (메시 scale은 sync가 안 건드림)
  }

  /** 스펙대로 배치·표시. 콜라이더를 새 크기로 교체. */
  apply(spec: BarrierSpec) {
    const RAPIER = getRapier();
    const w = spec.w ?? DEF_W;
    const h = spec.h ?? DEF_H;
    const d = spec.d ?? DEF_D;
    const y = h / 2; // 바닥(y=0)에 세움
    this.body.setTranslation({ x: spec.x, y, z: spec.z }, false);
    if (this.collider) this.world.removeCollider(this.collider, false);
    this.collider = this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setRestitution(0.2) // 살짝 튕기되 과하지 않게 — 훅 라인을 죽이지 않음
        .setFriction(0.4)
        .setCollisionGroups(cgroups(CG_BARRIER, CG_BALL)), // 공만 막음 (핀·레인과 비충돌 — 격리)
      this.body,
    );
    this.mesh.scale.set(w, h, d);
    this.mesh.position.set(spec.x, y, spec.z); // 첫 프레임 깜빡임 방지 (Engine.sync도 곧 덮어씀)
    this.mat.emissive.setHex(spec.color ?? 0x22d3ee);
    this.mesh.visible = true;
  }

  /** 미사용 — 숨기고 콜라이더 제거(공을 안 막게)·레인 밑으로 치움. */
  stash() {
    this.mesh.visible = false;
    if (this.collider) {
      this.world.removeCollider(this.collider, false);
      this.collider = null;
    }
    this.body.setTranslation({ x: 0, y: STASH_Y, z: 0 }, false);
  }
}

/**
 * 배리어 풀 — 스테이지별 배치를 갈아끼운다(PinSet.setLayout과 같은 패턴).
 * pool = 한 스테이지 최대 배리어 수(현 OBSTACLE_STAGES 최대 3) 이상.
 */
export class BarrierSet {
  private readonly barriers: Barrier[] = [];

  constructor(engine: Engine, pool = 4) {
    for (let i = 0; i < pool; i++) this.barriers.push(new Barrier(engine));
  }

  /** 이 스테이지의 배리어들만 표시, 나머지는 치움. */
  setLayout(specs: BarrierSpec[]) {
    this.barriers.forEach((b, i) => {
      if (i < specs.length) b.apply(specs[i]);
      else b.stash();
    });
  }

  /** 전부 치움 (장애물 외 모드 시작·메뉴 복귀). */
  clear() {
    for (const b of this.barriers) b.stash();
  }
}
