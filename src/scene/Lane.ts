import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  PIN_DECK_END,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
} from '../game/constants';
import { hookFactor, oilEndZ, OIL_PRESETS, type OilPattern } from '../game/oil';
import { makeWoodTexture } from './Environment';

/**
 * 레인 바닥 + 양옆 거터(낮은 홈) + 바깥 벽 (도안 §3·§4.2).
 * 공이 레인 가장자리를 벗어나면 거터로 떨어져(낮아져) 핀을 못 건드림 → 자동 0점.
 * 바깥 벽은 공이 코스 밖으로 이탈하는 것만 막는다.
 */
export class Lane {
  private readonly floor: RAPIER.Collider;
  private readonly oilMesh: THREE.Mesh;

  constructor(engine: Engine) {
    const RAPIER = getRapier();

    const startZ = -2; // 공 시작(z=-1) 뒤 여유
    const endZ = PIN_DECK_END + 1.5; // 핀덱 뒤 여유(피트)
    const len = endZ - startZ;
    const midZ = (startZ + endZ) / 2;
    const half = LANE_WIDTH / 2;
    const gw = GUTTER_WIDTH;

    // --- 레인 바닥 (윗면 y=0, 오일 먹인 나무 보드) ---
    const wood = makeWoodTexture('#c89048', '#96682c');
    wood.repeat.set(1, 7);
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH, 0.1, len),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.48, metalness: 0.05 }),
    );
    floor.position.set(0, -0.05, midZ);
    floor.receiveShadow = true;
    engine.addVisual(floor);

    // 물리 바닥은 전장 단일 콜라이더 — 오일/드라이로 2분할하면 이음새(z=OIL_END_Z)
    // 모서리에 공이 걸려 수십 cm 튀어오른다(CCD가 내부 엣지를 잡음).
    // 마찰 차등(레이트 훅)은 updateFriction()이 공 위치 기준으로 매 스텝 전환.
    const floorBody = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, midZ),
    );
    // 마찰 결합 Min: 기본 Average면 공 마찰(0.1)과 평균돼 오일 존이 0.05 밑으로
    // 못 내려감 → 슬립이 오일 존에서 닫혀 막판 훅이 죽는다 (constants.ts 주석 참고)
    this.floor = engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(half, 0.05, len / 2)
        .setFriction(LANE_FRICTION_OIL)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0),
      floorBody,
    );

    // 오일 존 시각 힌트: 미세한 광택 시트 (어디서부터 꺾이는지 읽힌다)
    const oil = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH, oilEndZ() - startZ),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        roughness: 0.12,
      }),
    );
    oil.rotation.x = -Math.PI / 2;
    oil.position.set(0, 0.0015, (startZ + oilEndZ()) / 2);
    engine.addVisual(oil);
    this.oilMesh = oil;

    // --- 양옆 거터(낮은 홈, 윗면 y=-0.13) + 바깥 벽 ---
    for (const side of [-1, 1]) {
      const gx = side * (half + gw / 2);
      const gutter = new THREE.Mesh(
        new THREE.BoxGeometry(gw, 0.1, len),
        new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1, envMapIntensity: 0 }), // 무광 — 반사 시밍 제거
      );
      gutter.position.set(gx, -0.18, midZ); // 레인보다 0.13 낮음 → 공이 빠지면 핀 못 닿음
      gutter.receiveShadow = true;
      engine.addVisual(gutter);

      const gBody = engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(gx, -0.18, midZ),
      );
      engine.world.createCollider(
        RAPIER.ColliderDesc.cuboid(gw / 2, 0.05, len / 2).setFriction(0.08),
        gBody,
      );

      // 거터 바깥 벽 (코스 이탈 방지). 벽 반두께(0.025)만큼 더 바깥에 둬 안쪽 면이 거터 바깥 끝
      // (half+gw)에 맞게 — 안 그러면 벽이 거터 바닥을 침범해 채널이 공 지름보다 좁아지고 공이 낀다.
      const wx = side * (half + gw + 0.025);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.3, len),
        // 무광(roughness 1 + envMapIntensity 0) — 어두운 경계 벽이라 반사 불필요.
        // ⚠️ 카메라 이동 시 '거터 벽 점멸'의 실제 원인은 무광/반사가 아니라 Environment 레일(k=0)과
        //    이 벽이 같은 평면(x=±0.755 안쪽 면)에 겹친 z-fighting이었다 → Environment.ts에서 k=0 생략으로 해소.
        new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 1, metalness: 0, envMapIntensity: 0 }),
      );
      wall.position.set(wx, 0.1, midZ);
      wall.receiveShadow = true;
      engine.addVisual(wall);

      const wBody = engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(wx, 0.1, midZ),
      );
      engine.world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 0.15, len / 2), wBody);
    }
  }

  /**
   * 공 z 위치 기준 오일→드라이 마찰 전환 (hookFactor와 동일 램프). 매 물리 스텝 호출.
   * 핀도 같은 바닥을 쓰지만, 공이 오일 존에 있는 동안 핀은 정지(sleeping) 상태라
   * 마찰값이 낮아도 영향 없고, 공이 핀에 닿을 때(z>OIL_END_Z)는 항상 드라이 값이다.
   */
  updateFriction(ballZ: number) {
    this.floor.setFriction(
      LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hookFactor(ballZ),
    );
  }

  /** 오일 광택 시트를 프리셋 endZ에 맞춤 — "어디서 꺾이는지"의 시각 단서 (P3). startMatch에서 호출. */
  applyOilVisual(pattern: OilPattern) {
    const startZ = -2; // 생성자와 동일 (공 시작 뒤 여유)
    const ez = OIL_PRESETS[pattern].endZ;
    this.oilMesh.geometry.dispose();
    this.oilMesh.geometry = new THREE.PlaneGeometry(LANE_WIDTH, ez - startZ);
    this.oilMesh.position.set(0, 0.0015, (startZ + ez) / 2);
  }
}
