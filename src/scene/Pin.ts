import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  PIN_HEIGHT,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  CG_PIN,
  CG_WORLD,
  CG_BALL,
  cgroups,
} from '../game/constants';

export const PIN_RADIUS = 0.06; // 콜라이더 반경 (도안 §4.4: ≥0.06, 터널링 방지)

/**
 * 볼링 핀 1개: 시각(capsule 근사) + 물리(cylinder 콜라이더).
 * 시각 메시 ≠ 콜라이더 (도안 §5.3). 병 모양·줄무늬는 M7.
 */
export class Pin {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly home: { x: number; z: number };

  constructor(engine: Engine, x: number, z: number) {
    const RAPIER = getRapier();
    this.home = { x, z };

    // 병 실루엣 프로파일 (LatheGeometry, 도안 §5.3). 콜라이더는 단순 cylinder 유지.
    const profile = [
      [0.0, 0.0], [0.024, 0.0], [0.03, 0.03], [0.038, 0.1], [0.03, 0.15],
      [0.02, 0.21], [0.016, 0.24], [0.024, 0.29], [0.026, 0.31], [0.018, 0.36],
      [0.008, 0.38], [0.0, 0.38],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const pinGeo = new THREE.LatheGeometry(profile, 20);
    pinGeo.translate(0, -PIN_HEIGHT / 2, 0); // 중심 정렬 (body 중심과 맞춤)
    this.mesh = new THREE.Mesh(
      pinGeo,
      new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4, metalness: 0.05 }),
    );
    this.mesh.castShadow = true;

    this.body = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, PIN_HEIGHT / 2, z)
        .setCcdEnabled(true)
        // P0.5 캐리 밸런스: 날아가는 핀 감속 → 직구 천장 억제 (constants.ts 주석)
        .setLinearDamping(PIN_LINEAR_DAMPING),
    );
    // 마찰 결합 Max: 레인 바닥이 Min 결합(공의 오일 시뮬용, Lane.ts)이라 그대로 두면
    // 핀-레인 마찰까지 오일값으로 끌려가 핀이 토플 대신 멀리 미끄러진다.
    // Rapier 규칙 우선순위 Max > Min이라 핀-레인은 항상 max(0.3, 레인) = 0.3 고정,
    // 공-레인(Average vs Min → Min)은 영향 없음.
    engine.world.createCollider(
      RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
        .setMass(PIN_MASS)
        .setRestitution(PIN_RESTITUTION)
        .setFriction(0.3)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        // 충돌 그룹(장애물 레인 #3): 핀은 레인(WORLD)·공(BALL)·핀끼리(PIN)만 충돌하고 배리어와는 안 닿는다.
        // 배리어가 핀 물리·리스팟에 끼어들지 않게 격리(constants.ts cgroups 주석). 일반 모드 거동은 불변.
        .setCollisionGroups(cgroups(CG_PIN, CG_WORLD | CG_BALL | CG_PIN))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );

    engine.add({ mesh: this.mesh, body: this.body });
  }

  /** 핀을 home 위치에 똑바로 세워 리셋 (속도 0) */
  reset() {
    this.place(this.home.x, this.home.z);
  }

  /**
   * 핀을 임의 (x,z)에 똑바로 세움 (속도 0, 깨움). 파워 스로(#4) 삼각 랙처럼 home과 다른
   * 자리에 세울 때 사용 — home은 안 건드린다(파워 종료 후 reset()이 표준 자리로 복귀 가능).
   */
  place(x: number, z: number) {
    this.mesh.visible = true;
    this.body.setTranslation({ x, y: PIN_HEIGHT / 2, z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * 쓰러진 핀(데드우드)을 레인 밖으로 치움 (도안 §6 CLEAR_DEADWOOD).
   * 슬립까지 재워 미사용 핀이 매 스텝 적분되지 않게 한다 — 파워 풀(최대 55개 중 미사용분)이
   * 일반 모드에서 영구 낙하 적분하는 부담을 없앤다. place()/reset()의 setTranslation(wakeUp=true)이 다시 깨운다.
   */
  stash() {
    this.mesh.visible = false;
    this.body.setTranslation({ x: this.home.x, y: -50, z: this.home.z }, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
    this.body.sleep();
  }
}
