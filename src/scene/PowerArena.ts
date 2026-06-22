import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  POWER_LANE_HALF,
  POWER_MAX_ROWS,
  HEADPIN_Z,
  ROW_GAP,
  LANE_FRICTION_OIL,
} from '../game/constants';
import { makeWoodTexture } from './Environment';

/**
 * 파워 스로(#4) 와이드 아레나 — 거터 대신 벽으로 막은 넓은 레인 + 거대 삼각 랙 바닥 (§4).
 *
 * 표준 레인(Lane, 폭 1.05)은 바깥 핀이 거터/벽에 걸려 못 선다. 파워 모드는 Lane이 거터·벽·바닥
 * 콜라이더를 끄고(Lane.setPowerMode) 이 아레나를 켠다: 폭 2·POWER_LANE_HALF 바닥(윗면 y=0,
 * 표준과 동일 높이라 핀이 같은 자세로 섬) + 양옆·뒤 벽(공·핀이 밖으로 안 빠지고 튕겨 복귀).
 *
 * Barrier와 같은 풀 패턴 — 메시는 부팅 때 한 번 만들고 visible 토글, 콜라이더는 setActive마다
 * 생성/제거(Engine에 remove 경로가 없어 createCollider/removeCollider로 토글 — Barrier.apply/stash와 동일).
 * 바닥은 저마찰(LANE_FRICTION_OIL, Min 결합)로 공이 속도를 유지해 랙을 강하게 쓸어버린다(파워 판타지).
 */

const START_Z = -2; // 공 시작(z=-1) 뒤 여유 — Lane 생성자와 동일
const BACK_Z = HEADPIN_Z + (POWER_MAX_ROWS - 1) * ROW_GAP + 1.2; // 최대 랙 마지막 행 뒤 여유 (뒷벽 위치)
const MID_Z = (START_Z + BACK_Z) / 2;
const LEN = BACK_Z - START_Z;
const FLOOR_THICK = 0.1; // 윗면 y=0 → 중심 y=-FLOOR_THICK/2
const WALL_H = 0.6; // 벽 높이 (공·핀 튕김 차단)
const WALL_T = 0.05; // 벽 반두께

class Piece {
  readonly body: RAPIER.RigidBody;
  constructor(
    world: RAPIER.World,
    pos: { x: number; y: number; z: number },
    readonly makeDesc: () => RAPIER.ColliderDesc,
  ) {
    const RAPIER = getRapier();
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z));
  }
}

export class PowerArena {
  private readonly world: RAPIER.World;
  private readonly meshes: THREE.Mesh[] = [];
  private readonly pieces: Piece[] = [];
  private colliders: RAPIER.Collider[] = [];
  private active = false;

  constructor(engine: Engine) {
    const RAPIER = getRapier();
    this.world = engine.world;

    // --- 바닥 (윗면 y=0, 저마찰) ---
    const wood = makeWoodTexture('#b3823f', '#7c5524'); // 표준 레인보다 살짝 어둡게 — '특수 코스' 구분
    wood.repeat.set(3, 8);
    const floorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(POWER_LANE_HALF * 2, FLOOR_THICK, LEN),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.05 }),
    );
    floorMesh.position.set(0, -FLOOR_THICK / 2, MID_Z);
    floorMesh.receiveShadow = true;
    this.addMesh(engine, floorMesh);
    this.pieces.push(
      new Piece(this.world, { x: 0, y: -FLOOR_THICK / 2, z: MID_Z }, () =>
        RAPIER.ColliderDesc.cuboid(POWER_LANE_HALF, FLOOR_THICK / 2, LEN / 2)
          .setFriction(LANE_FRICTION_OIL)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min)
          .setRestitution(0),
      ),
    );

    // --- 양옆 벽 (안쪽 면 = ±POWER_LANE_HALF) ---
    const wallMat = new THREE.MeshStandardMaterial({
      color: 0x10141d,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.5,
      roughness: 0.5,
      metalness: 0.1,
    });
    for (const side of [-1, 1]) {
      const wx = side * (POWER_LANE_HALF + WALL_T);
      const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(WALL_T * 2, WALL_H, LEN), wallMat);
      wallMesh.position.set(wx, WALL_H / 2, MID_Z);
      wallMesh.receiveShadow = true;
      this.addMesh(engine, wallMesh);
      this.pieces.push(
        new Piece(this.world, { x: wx, y: WALL_H / 2, z: MID_Z }, () =>
          RAPIER.ColliderDesc.cuboid(WALL_T, WALL_H / 2, LEN / 2).setRestitution(0.3).setFriction(0.2),
        ),
      );
    }

    // --- 뒷벽 (랙 뒤 — 핀이 핏으로 넘어가 시야 밖으로 안 사라지게) ---
    const backMesh = new THREE.Mesh(new THREE.BoxGeometry(POWER_LANE_HALF * 2, WALL_H, WALL_T * 2), wallMat);
    backMesh.position.set(0, WALL_H / 2, BACK_Z);
    backMesh.receiveShadow = true;
    this.addMesh(engine, backMesh);
    this.pieces.push(
      new Piece(this.world, { x: 0, y: WALL_H / 2, z: BACK_Z }, () =>
        RAPIER.ColliderDesc.cuboid(POWER_LANE_HALF, WALL_H / 2, WALL_T).setRestitution(0.2).setFriction(0.3),
      ),
    );

    this.setActive(false); // 메시 숨김 (콜라이더는 아직 미생성)
  }

  private addMesh(engine: Engine, mesh: THREE.Mesh) {
    mesh.visible = false;
    engine.addVisual(mesh);
    this.meshes.push(mesh);
  }

  /** 파워 모드 진입/이탈 — 콜라이더 생성/제거 + 메시 표시 토글 (멱등). */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    for (const m of this.meshes) m.visible = on;
    if (on) {
      this.colliders = this.pieces.map((p) => this.world.createCollider(p.makeDesc(), p.body));
    } else {
      for (const c of this.colliders) this.world.removeCollider(c, false);
      this.colliders = [];
    }
  }
}
