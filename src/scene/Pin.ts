import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  PIN_HEIGHT,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  DUCKPIN_PIN_HEIGHT,
  DUCKPIN_PIN_RADIUS,
  DUCKPIN_PIN_MASS,
  DUCKPIN_PIN_RESTITUTION,
  CG_PIN,
  CG_WORLD,
  CG_BALL,
  cgroups,
} from '../game/constants';

export const PIN_RADIUS = 0.06; // 콜라이더 반경 (도안 §4.4: ≥0.06, 터널링 방지)

// 핀 실루엣 프로파일 [반경, 높이] (LatheGeometry, 도안 §5.3). 콜라이더는 단순 cylinder.
// 텐핀 = 길쭉한 병(높이 0.38). 덕핀(#5) = 짧고 통통한 통(높이 0.24, 벨리 굵음).
const TENPIN_PROFILE: [number, number][] = [
  [0.0, 0.0], [0.024, 0.0], [0.03, 0.03], [0.038, 0.1], [0.03, 0.15],
  [0.02, 0.21], [0.016, 0.24], [0.024, 0.29], [0.026, 0.31], [0.018, 0.36],
  [0.008, 0.38], [0.0, 0.38],
];
const DUCKPIN_PROFILE: [number, number][] = [
  [0.0, 0.0], [0.03, 0.0], [0.045, 0.02], [0.052, 0.06], [0.052, 0.11],
  [0.046, 0.15], [0.036, 0.19], [0.03, 0.21], [0.018, 0.235], [0.0, 0.24],
];

/** 프로파일 + 높이 → 중심 정렬된 LatheGeometry (body 중심과 맞춤). */
function makePinGeometry(profile: [number, number][], height: number): THREE.LatheGeometry {
  const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 20);
  geo.translate(0, -height / 2, 0);
  return geo;
}

/**
 * 볼링 핀 1개: 시각(capsule 근사) + 물리(cylinder 콜라이더).
 * 시각 메시 ≠ 콜라이더 (도안 §5.3). 병 모양·줄무늬는 M7.
 */
export class Pin {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly home: { x: number; z: number };
  private collider: RAPIER.Collider; // 모드 형상 변경 시 재생성(remove+create) — makeCollider 팩토리로 새 shape·질량 일관 재구성
  private pinHeight = PIN_HEIGHT; // 현재 핀 높이 — 덕핀(#5)은 0.24. place()·isStanding 게이트가 참조.
  private pinRadius = PIN_RADIUS; // 현재 콜라이더 반경
  private isDuck = false; // 현재 덕핀 형상인가 — setDuckpin 멱등 가드(불필요한 콜라이더 재생성 회피)

  constructor(
    private readonly engine: Engine,
    x: number,
    z: number,
  ) {
    const RAPIER = getRapier();
    this.home = { x, z };

    this.mesh = new THREE.Mesh(
      makePinGeometry(TENPIN_PROFILE, PIN_HEIGHT),
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
    this.collider = this.makeCollider();
    engine.add({ mesh: this.mesh, body: this.body });
  }

  /**
   * 현재 형상(pinHeight·pinRadius·isDuck)으로 콜라이더를 만들어 body에 붙인다. 생성자 + setDuckpin 공용.
   * 마찰 결합 Max: 레인 바닥이 Min 결합(공의 오일 시뮬용, Lane.ts)이라 그대로 두면 핀-레인 마찰이 오일값으로
   * 끌려가 핀이 토플 대신 미끄러진다. Max > Min 우선순위라 핀-레인은 항상 0.3 고정(공-레인은 영향 없음).
   */
  private makeCollider(): RAPIER.Collider {
    const RAPIER = getRapier();
    return this.engine.world.createCollider(
      RAPIER.ColliderDesc.cylinder(this.pinHeight / 2, this.pinRadius)
        .setMass(this.isDuck ? DUCKPIN_PIN_MASS : PIN_MASS)
        .setRestitution(this.isDuck ? DUCKPIN_PIN_RESTITUTION : PIN_RESTITUTION)
        .setFriction(0.3)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max)
        // 충돌 그룹(장애물 레인 #3): 핀은 레인(WORLD)·공(BALL)·핀끼리(PIN)만 충돌하고 배리어와는 안 닿는다.
        .setCollisionGroups(cgroups(CG_PIN, CG_WORLD | CG_BALL | CG_PIN))
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );
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
    this.body.setTranslation({ x, y: this.pinHeight / 2, z }, true);
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

  /** 현재 핀 높이 (m) — PinSet.isStanding 게이트가 모드별 높이를 쓰게 노출 (덕핀 #5). */
  get height(): number {
    return this.pinHeight;
  }

  /**
   * 핀 형상을 모드별로 교체 — 덕핀(#5)은 짧고 통통한 핀(높이↓·질량↓). 메시 지오메트리 +
   * 콜라이더 shape/mass를 함께 갈고, 휴지 위치를 새 높이에 맞춰 다시 세운다. 텐핀(false)은 표준 복귀.
   * PinSet.setDuckpin이 표준 10핀에 일괄 호출 (startMatch에서 모드 진입 시 1회).
   */
  setDuckpin(on: boolean) {
    if (on === this.isDuck) return; // 형상 변화 없으면 생략 — 텐핀 모드는 콜라이더 재생성을 안 탐(거동 불변)
    this.isDuck = on;
    this.pinHeight = on ? DUCKPIN_PIN_HEIGHT : PIN_HEIGHT;
    this.pinRadius = on ? DUCKPIN_PIN_RADIUS : PIN_RADIUS;
    this.mesh.geometry.dispose();
    this.mesh.geometry = makePinGeometry(on ? DUCKPIN_PROFILE : TENPIN_PROFILE, this.pinHeight);
    // 콜라이더 재생성(remove+create) — 생성자와 동일한 makeCollider 팩토리로 새 형상·질량을 일관되게 구성.
    // createCollider가 body 질량/관성을 새 shape로 자동 산출한다(별도 recompute 불필요).
    this.engine.world.removeCollider(this.collider, false);
    this.collider = this.makeCollider();
    this.reset(); // 새 높이에 맞춰 다시 세움 (y = pinHeight/2)
  }
}
