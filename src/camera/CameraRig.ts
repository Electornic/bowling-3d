import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import { HEADPIN_Z } from '../game/constants';

const _v = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;

/**
 * 상태별 카메라 연출 (도안 §9). 목표 위치/타겟을 프레임레이트 독립 스무딩으로 보간.
 * AIMING 로우앵글(원근 강조) → ROLLING 공 뒤 실시간 팔로우 → SETTLING 핀 클로즈업.
 */
export class CameraRig {
  private readonly target = new THREE.Vector3(0, 0.1, 8);

  constructor(
    private readonly engine: Engine,
    private readonly game: GameState,
    private readonly ball: Ball,
  ) {}

  update(dt: number) {
    const cam = this.engine.camera;
    const b = this.ball.mesh.position; // raw 물리 위치(60fps 끊김) 대신 보간된 메시 위치를 추적

    // 기본 = 공 뒤 4.5m 팔로우 캠 (ROLLING·거터 SETTLING 공용).
    // 스무딩 지연(≈v/6 ≈ 1.5m)이 있어도 공은 늘 전방에 잡힌다. 핀덱 근처(z>13)는 정지.
    let px = clamp(b.x * 0.4, -1, 1);
    let py = 1.5;
    let pz = clamp(b.z - 4.5, -4.0, 13.0);
    let tx = clamp(b.x * 0.8, -1.2, 1.2);
    let ty = 0.1;
    let tz = Math.min(b.z + 4, 20);

    switch (this.game.state) {
      case 'AIMING':
        // 낮고 가까운 1인칭 느낌 — 레인이 화면을 채우고 원근이 살도록
        px = 0; py = 1.12; pz = -2.7;
        tx = 0; ty = -0.05; tz = 7.5;
        break;
      case 'ROLLING':
        break; // 팔로우 유지
      case 'SETTLING':
        // 공이 아직 레인을 굴러가는 중(거터샷 포함)이면 팔로우 유지 —
        // 즉시 핀 클로즈업으로 날아가면 공을 놓치고 카메라가 휙 도는 문제(§9)
        if (b.y <= -1.5 || b.z >= HEADPIN_Z - 2.5) {
          px = 0; py = 2.3; pz = 14.5;
          tx = 0; ty = 0.3; tz = 18.8;
        }
        break;
      default: // GAME_OVER
        px = 0; py = 3.2; pz = 12.5;
        tx = 0; ty = 0.3; tz = 18.8;
    }

    const k = 1 - Math.exp(-6 * dt); // 프레임레이트 독립 스무딩 (도안 §B.6)
    cam.position.lerp(_v.set(px, py, pz), k);
    this.target.lerp(_v.set(tx, ty, tz), k);
    cam.lookAt(this.target);
  }
}
