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
 * 레인 바닥 + 양옆 거터(낮은 홈) + 바깥 벽 + 핀덱 뒤 피트 (도안 §3·§4.2).
 * 공이 레인 가장자리를 벗어나면 거터로 떨어져(낮아져) 핀을 못 건드림 → 자동 0점.
 * 플레이 바닥은 핀덱 바로 뒤(deckEnd)에서 끊기고, 그 뒤는 낮은 피트라 공/핀이 굴러떨어진다
 * (레인 끝에 얹혀 멈추는 어색함 제거 — 실제 볼링 피트). 리플레이/라이브 카메라는 핀 앞에 파킹해 핏을 안 쫓는다.
 */
export class Lane {
  private readonly floor: RAPIER.Collider;
  private readonly oilMesh: THREE.Mesh;

  constructor(engine: Engine) {
    const RAPIER = getRapier();

    const startZ = -2; // 공 시작(z=-1) 뒤 여유
    const deckEnd = PIN_DECK_END + 0.4; // 플레이 바닥 끝 = 핀덱 뒤 짧은 여유. 이 뒤는 피트로 낙하.
    const len = deckEnd - startZ;
    const midZ = (startZ + deckEnd) / 2;
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

    // 물리 바닥은 전장 단일 콜라이더(오일/드라이 2분할하면 이음새 모서리에 공이 걸려 튐).
    // 마찰 차등(레이트 훅)은 updateFriction()이 공 위치 기준으로 매 스텝 전환.
    const floorBody = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.05, midZ),
    );
    // 마찰 결합 Min: 기본 Average면 공 마찰(0.1)과 평균돼 오일 존이 0.05 밑으로 못 내려감 (constants.ts 주석 참고)
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

    // --- 양옆 거터(낮은 홈, 윗면 y=-0.13) + 바깥 벽 (데크 길이) ---
    for (const side of [-1, 1]) {
      const gx = side * (half + gw / 2);
      const gutter = new THREE.Mesh(
        new THREE.BoxGeometry(gw, 0.1, len),
        new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 1, envMapIntensity: 0 }), // 무광
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

      // 거터 바깥 벽 (코스 이탈 방지). 벽 반두께(0.025)만큼 더 바깥에 둬 안쪽 면이 거터 바깥 끝에 맞게.
      const wx = side * (half + gw + 0.025);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.3, len),
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

    // --- 핀덱 뒤 피트(pit): 데크가 deckEnd에서 끊겨 공/핀이 낮은 바닥으로 굴러떨어진다.
    //     낙하 깊이 y<-1 확보(리플레이 cutoff·시각적 '사라짐'). 뒷벽은 Environment 마스킹 월(≈21.03) 앞·아래라 안 겹침.
    const PIT_DEPTH = 0.85; // 데크 윗면(y=0) 대비 피트 바닥 깊이 — 얕게: 낙하 짧아 포물선 완만
    const PIT_LEN = 0.7; // deckEnd(≈19.48) → 뒷벽(≈20.18). 짧게 잡아 공의 수평 비행(포물선)을 바로 끊고 수직 낙하
    const pitHalfW = half + gw + 0.1; // 레인+거터 전폭 커버
    const pitMid = deckEnd + PIT_LEN / 2;
    const pitBackZ = deckEnd + PIT_LEN;
    const pitFloorTop = -PIT_DEPTH;
    const pitMat = new THREE.MeshStandardMaterial({ color: 0x0a0d12, roughness: 1, metalness: 0, envMapIntensity: 0 });

    // 피트 바닥 (마찰 높게 → 떨어진 공/핀이 빨리 정착)
    const pitFloor = new THREE.Mesh(new THREE.BoxGeometry(pitHalfW * 2, 0.1, PIT_LEN), pitMat);
    pitFloor.position.set(0, pitFloorTop - 0.05, pitMid);
    pitFloor.receiveShadow = true;
    engine.addVisual(pitFloor);
    const pitBody = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, pitFloorTop - 0.05, pitMid),
    );
    // 반발 결합 Min: 기본 Average면 공 반발(0.1)과 평균나 ~0.05가 남아 낙하 시 튕긴다 → Min으로 0 (툭 빠짐)
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(pitHalfW, 0.05, PIT_LEN / 2)
        .setFriction(0.75)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      pitBody,
    );

    // 피트 뒷벽(보이는 어두운 벽) + 양옆 벽(콜라이더만) — 공/핀 이탈 방지. 피트 바닥~데크 위 살짝까지.
    const wallTop = 0.35;
    const wallH = wallTop - pitFloorTop;
    const wallCY = pitFloorTop + wallH / 2;
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(pitHalfW * 2, wallH, 0.1), pitMat);
    backWall.position.set(0, wallCY, pitBackZ);
    backWall.receiveShadow = true;
    engine.addVisual(backWall);
    const backBody = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, wallCY, pitBackZ),
    );
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(pitHalfW, wallH / 2, 0.05)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      backBody,
    );

    for (const side of [-1, 1]) {
      const sideBody = engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(side * pitHalfW, wallCY, pitMid),
      );
      engine.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.05, wallH / 2, PIT_LEN / 2)
          .setRestitution(0)
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
        sideBody,
      );
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
