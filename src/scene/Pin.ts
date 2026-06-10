import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import { PIN_HEIGHT, PIN_MASS } from '../game/constants';

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
        .setCcdEnabled(true),
    );
    engine.world.createCollider(
      RAPIER.ColliderDesc.cylinder(PIN_HEIGHT / 2, PIN_RADIUS)
        .setMass(PIN_MASS)
        .setRestitution(0.2)
        .setFriction(0.3)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );

    engine.add({ mesh: this.mesh, body: this.body });
  }

  /** 핀을 home 위치에 똑바로 세워 리셋 (속도 0) */
  reset() {
    this.mesh.visible = true;
    this.body.setTranslation({ x: this.home.x, y: PIN_HEIGHT / 2, z: this.home.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** 쓰러진 핀(데드우드)을 레인 밖으로 치움 (도안 §6 CLEAR_DEADWOOD) */
  stash() {
    this.mesh.visible = false;
    this.body.setTranslation({ x: this.home.x, y: -50, z: this.home.z }, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  }
}
