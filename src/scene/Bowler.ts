import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { BALL_START_Z } from '../game/constants';

/**
 * 절차적 로우폴리 볼러 (에셋 0, §7a) — 공 뒤에 서서 굴린다. 슬라이스 3b.
 *
 * 물리는 Ball이 담당하고 이 볼러는 **시각 모션만** 낸다: RELEASING 동안 백스윙→다운스윙→릴리스
 * 키프레임을 GameState.releaseProgress(0→1)에 동기하고, progress=1(= Ball.launch 프레임)에서 팔이
 * 앞으로 뻗어 "던진" 인상을 준다(§5.1 "릴리스 페이즈"). ROLLING 진입 후엔 update()가 팔로스루에서
 * idle 자세로 자연 복귀시킨다. 로비 NPC([Lobby.makeFigure])와 같은 캡슐 톤이라 로비↔레인 인물이 일관.
 *
 * 캐릭터/애니메이션 시스템이 없어 어깨 1축(X) 회전으로 스윙을 근사 — 에셋 0·로우폴리 철학(§7·§8).
 */

const BOWLER_Z = BALL_START_Z - 0.7; // 공(z=-1) 뒤 0.7m. 카메라(z=-2.7)와 공 사이라 화면 하단에 잡힌다.
const BOWLER_X = 0.26; // 약간 우측 — 레인 중앙(조준선) 시야를 안 가리게
const IDLE_THETA = -0.35; // 준비/복귀 어깨각 (팔 살짝 앞아래, 공 든 자세)
const BACK_THETA = 2.2; // 백스윙 정점 (팔 뒤위)
const RELEASE_THETA = -0.85; // 릴리스 (팔 앞아래로 뻗음)
const BACKSWING_FRAC = 0.45; // progress 중 백스윙이 차지하는 비율 (나머지는 다운스윙)

/**
 * 스윙 진행도(0→1) → 어깨 X회전각.
 * 어깨 피벗에 팔을 −y로 매단 구조라: θ=0 팔 수직 아래, θ>0 팔 뒤(−z)로, θ<0 팔 앞(+z)으로.
 */
function swingTheta(p: number): number {
  if (p <= BACKSWING_FRAC) {
    const u = p / BACKSWING_FRAC; // 0→1
    const e = 1 - (1 - u) * (1 - u); // ease-out (들어올림은 부드럽게)
    return IDLE_THETA + (BACK_THETA - IDLE_THETA) * e;
  }
  const u = (p - BACKSWING_FRAC) / (1 - BACKSWING_FRAC); // 0→1
  const e = u * u; // ease-in (다운스윙 가속)
  return BACK_THETA + (RELEASE_THETA - BACK_THETA) * e;
}

export class Bowler {
  private readonly group: THREE.Group;
  private readonly shoulder: THREE.Group; // 스윙 팔 피벗(어깨)
  private theta = IDLE_THETA; // 현재 어깨각 — update()가 이어받아 idle 복귀

  constructor(engine: Engine) {
    this.group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x2bd4ee,
      emissive: 0x0b3b45,
      emissiveIntensity: 0.5,
      roughness: 0.4,
      metalness: 0.1,
    });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xffe0b8, roughness: 0.6 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.5, 6, 14), bodyMat);
    torso.position.y = 0.62;
    torso.castShadow = true;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 18, 12), skinMat);
    head.position.y = 1.06;
    head.castShadow = true;

    for (const sx of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.4, 4, 8), bodyMat);
      leg.position.set(sx * 0.09, 0.24, 0);
      leg.castShadow = true;
      this.group.add(leg);
    }

    // 왼팔 고정 (균형용)
    const leftArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.36, 4, 8), skinMat);
    leftArm.position.set(-0.23, 0.7, 0.02);
    leftArm.rotation.z = 0.2;
    leftArm.castShadow = true;

    // 스윙 오른팔 — 어깨 피벗 그룹에 팔을 −y로 매달아 어깨를 중심으로 회전
    this.shoulder = new THREE.Group();
    this.shoulder.position.set(0.21, 0.92, 0);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.4, 4, 8), skinMat);
    arm.position.y = -0.24;
    arm.castShadow = true;
    this.shoulder.add(arm);
    this.shoulder.rotation.x = IDLE_THETA;

    this.group.add(torso, head, leftArm, this.shoulder);
    this.group.position.set(BOWLER_X, 0, BOWLER_Z); // rotation.y=0 → +z(레인)를 향함(카메라는 뒤통수 쪽)
    this.group.visible = false;
    engine.addVisual(this.group); // 레인 씬
  }

  /** 매치(레인) 진입/이탈 — 표시 토글 + idle 자세 리셋. */
  setVisible(b: boolean) {
    if (this.group.visible === b) return;
    this.group.visible = b;
    if (b) {
      this.theta = IDLE_THETA;
      this.shoulder.rotation.x = this.theta;
      this.group.rotation.x = 0;
    }
  }

  /** AIMING(progress=0, 준비) / RELEASING(0→1, 스윙) 포즈를 직접 세팅. */
  setSwing(progress: number) {
    this.theta = swingTheta(progress);
    this.shoulder.rotation.x = this.theta;
    // 다운스윙~릴리스에 상체를 살짝 앞으로 숙임 (발밑 피벗이라 자연스러운 굽힘)
    this.group.rotation.x = Math.max(0, progress - 0.5) * 0.32;
  }

  /** ROLLING/SETTLING — 릴리스 자세에서 idle로 자연 복귀(팔로스루). */
  update(dt: number) {
    const k = 1 - Math.exp(-4 * dt); // 프레임레이트 독립 스무딩
    this.theta += (IDLE_THETA - this.theta) * k;
    this.shoulder.rotation.x = this.theta;
    this.group.rotation.x += (0 - this.group.rotation.x) * k;
  }
}
