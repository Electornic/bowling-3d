import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  PIN_HEIGHT,
  PIN_MASS,
  PIN_RESTITUTION,
  PIN_LINEAR_DAMPING,
  PIN_PROFILE,
  PIN_STRIPES,
  PIN_COLLISION_GROUPS,
} from '../game/constants';

export const PIN_RADIUS = 0.06; // 콜라이더 반경 (도안 §4.4: ≥0.06, 터널링 방지)

/**
 * 병 실루엣 + 목 빨간 띠 지오메트리 (base가 y=0). 진짜 핀과 옆 레인 장식 핀이 공유한다 —
 * 한쪽만 줄무늬가 있으면 같은 화면에서 바로 눈에 띈다.
 * 띠는 텍스처가 아니라 정점색이다: LatheGeometry의 v는 **프로파일 인덱스** 기반이라 높이와
 * 선형이 아니어서 UV로 띠 위치를 맞추기 까다롭다. PIN_PROFILE에 띠 경계점이 박혀 있어 또렷하다.
 */
export function makePinGeometry(radialSegments: number): THREE.LatheGeometry {
  const geo = new THREE.LatheGeometry(
    PIN_PROFILE.map(([r, y]) => new THREE.Vector2(r, y)),
    radialSegments,
  );
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const white = new THREE.Color(0xf2f2f2);
  const red = new THREE.Color(0xc62828);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const c = PIN_STRIPES.some(([a, b]) => y >= a - 1e-6 && y <= b + 1e-6) ? red : white;
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * 볼링 핀 1개: 시각(LatheGeometry 병 실루엣 + 목 줄무늬) + 물리(cylinder 콜라이더).
 * 시각 메시 ≠ 콜라이더 (도안 §5.3).
 */
export class Pin {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  readonly home: { x: number; z: number };

  constructor(engine: Engine, x: number, z: number) {
    const RAPIER = getRapier();
    this.home = { x, z };

    // 병 실루엣 프로파일 (LatheGeometry, 도안 §5.3) — constants.PIN_PROFILE 단일소스 공유(#9). 콜라이더는 단순 cylinder 유지.
    const pinGeo = makePinGeometry(32); // 20→32: 가까이서 각이 지던 것 해소
    pinGeo.translate(0, -PIN_HEIGHT / 2, 0); // 중심 정렬 (body 중심과 맞춤)
    this.mesh = new THREE.Mesh(
      pinGeo,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.32, // 플라스틱 코팅 — 구 0.4보다 살짝 광택
        metalness: 0.05,
      }),
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
        .setCollisionGroups(PIN_COLLISION_GROUPS) // 거터볼 잠금을 위해 핀만 별도 소속
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );

    engine.add({ mesh: this.mesh, body: this.body });
  }

  /** 핀을 home 위치에 똑바로 세워 리셋 (속도 0) */
  reset() {
    this.mesh.visible = true;
    this.body.setLinearDamping(PIN_LINEAR_DAMPING); // 스윕이 0으로 낮춰뒀을 수 있다
    this.body.setTranslation({ x: this.home.x, y: PIN_HEIGHT / 2, z: this.home.z }, true);
    this.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /**
   * 핀세터 사이클용 — 지정 높이에 고정한다(매 프레임 호출 전제). pose를 주면 그 위치·자세로,
   * 생략하면 home 스폿에 똑바로. 리스팟은 pose를 실제 자세→직립으로 보간해 넘겨 튐을 없앤다.
   * 다이나믹 바디를 키네마틱으로 바꾸는 대신 매 프레임 위치·자세·속도를 덮어써서
   * 중력이 누적되지 않게 한다. 사이클이 끝나면 reset()이 정확히 스폿에 내려놓는다.
   */
  hold(y: number, pose?: { x: number; z: number; q: RAPIER.Rotation }) {
    this.mesh.visible = true;
    this.body.setTranslation({ x: pose?.x ?? this.home.x, y, z: pose?.z ?? this.home.z }, true);
    this.body.setRotation(pose?.q ?? { x: 0, y: 0, z: 0, w: 1 }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** 쓰러진 핀(데드우드)을 레인 밖으로 치움 (도안 §6 CLEAR_DEADWOOD) */
  stash() {
    this.mesh.visible = false;
    this.body.setLinearDamping(PIN_LINEAR_DAMPING);
    this.body.setTranslation({ x: this.home.x, y: -50, z: this.home.z }, false);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, false);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, false);
  }
}
