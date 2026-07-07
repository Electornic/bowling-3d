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
    // alphaMap으로 길이방향 양끝을 서서히 죽인다 — 앞끝(oilEndZ)의 또렷한 가로선이
    // '레인 두 개 이어붙인' 이음새로 보이던 문제 제거(하드엣지→소프트 페이드). 가운데 광택은 유지.
    const oil = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_WIDTH, oilEndZ() - startZ),
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        roughness: 0.12,
        alphaMap: makeOilFadeAlpha(),
      }),
    );
    oil.rotation.x = -Math.PI / 2;
    oil.position.set(0, 0.0015, (startZ + oilEndZ()) / 2);
    engine.addVisual(oil);
    this.oilMesh = oil;

    // --- 양옆 거터(낮은 홈, 윗면 y=-0.13) + 바깥 벽(킥백) — 전 길이 ---
    // 실제 볼링처럼 핀덱 옆도 거터+벽. 옆으로 튄 핀은 벽(킥백)에 맞고 데크로 튕기거나 거터에 데드우드로 눕는다.
    // 공(거터볼)은 거터 홈(y=-0.13, 벽보다 아래)을 그대로 흘러 뒤 피트로 빠진다.
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

      // 거터 바깥 벽 = 킥백. 튄 핀을 데크로 되튕겨 옆 레인으로 날아가는 걸 줄인다(실제 킥백 17~24"). 벽 반두께(0.025)만큼 바깥.
      const wx = side * (half + gw + 0.025);
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.4, len),
        new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 1, metalness: 0, envMapIntensity: 0 }),
      );
      wall.position.set(wx, 0.15, midZ); // 바닥 -0.05 ~ 위 0.35 (구 top 0.25보다 높여 튕김 강화)
      wall.receiveShadow = true;
      engine.addVisual(wall);

      const wBody = engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(wx, 0.15, midZ),
      );
      engine.world.createCollider(RAPIER.ColliderDesc.cuboid(0.025, 0.2, len / 2), wBody);
    }

    // --- 핀덱 뒤 피트(pit): 데크가 deckEnd에서 끊겨 공/핀이 낮은 바닥으로 굴러떨어진다(핀 뒤에만, 실제 볼링).
    //     뒷벽은 Environment 마스킹 월(≈21.03) 앞·아래라 안 겹침. 옆은 피트가 아니라 거터+킥백(위 참고).
    const PIT_DEPTH = 0.85; // 데크 윗면(y=0) 대비 피트 바닥 깊이 — 얕게: 낙하 짧아 포물선 완만
    const PIT_LEN = 1.4; // deckEnd(≈19.48) → 뒷벽(≈20.88). 공이 뒷벽에 닿기 전 포물선으로 레인 레벨 아래(피트 안)까지 내려오게 충분히 길게 — 짧으면(구 0.7) 빠른 공이 레인 높이에서 뒷벽을 정면으로 때려 '퉁' 튕김. 마스킹월(≈21.03) 앞이라 여유.
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
    // 마찰 0(Min): 구르는(탑스핀) 공이 뒷벽에 닿을 때 마찰로 벽을 타고 올라 '퉁' 튕기는 걸 막는다.
    // 마찰이 없으면 전진속도만 죽고(반발 0) 회전은 벽에 토크를 못 줘 그대로 수직 낙하.
    engine.world.createCollider(
      RAPIER.ColliderDesc.cuboid(pitHalfW, wallH / 2, 0.05)
        .setFriction(0)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setRestitution(0)
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min),
      backBody,
    );

    for (const side of [-1, 1]) {
      // 피트 양옆 벽(콜라이더만, 뒤 피트 구간) — 떨어진 공/핀 이탈 방지.
      const sideBody = engine.world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(side * pitHalfW, wallCY, pitMid),
      );
      engine.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.05, wallH / 2, PIT_LEN / 2)
          .setFriction(0) // 뒷벽과 동일 — 벽 타고 오르는 '퉁' 방지
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
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

/**
 * 오일 광택 시트의 길이방향 알파 페이드 (alphaMap용, green 채널).
 * 양끝(파울라인 쪽·브레이크 지점 쪽)을 0으로 서서히 죽여 하드엣지를 없앤다 —
 * 앞끝(oilEndZ)의 또렷한 가로선이 '레인 두 개 이어붙인' 이음새로 보이던 문제 제거.
 * 대칭 그라데이션이라 plane UV 방향과 무관하게 양끝 모두 페이드된다.
 */
function makeOilFadeAlpha(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.0, '#000'); // 한쪽 끝 → 투명
  grad.addColorStop(0.2, '#fff'); // 본체 (광택 유지 구간)
  grad.addColorStop(0.8, '#fff');
  grad.addColorStop(1.0, '#000'); // 반대 끝 → 투명 (브레이크 지점 하드엣지 제거)
  g.fillStyle = grad;
  g.fillRect(0, 0, 2, 256);
  return new THREE.CanvasTexture(c);
}
