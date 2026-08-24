import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import {
  HEADPIN_Z, CAM_APPROACH_Z,
  SHAKE_ENABLED, SHAKE_MAX, SHAKE_DECAY, SHAKE_FORCE_REF, SHAKE_KICK,
  PUSHIN_ENABLED, PUSHIN_DIST, PUSHIN_HOLD, PUSHIN_RATE,
} from '../game/constants';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

// 릴리스 카메라 — 공 뒤 로우 체이스 (2026-08-19 실측으로 확정)
//
// 이전 값(팔로우 4.5m·높이 1.5·하한 -4.0·λ6)은 초기 커밋 이후 한 번도 튜닝된 적이 없었고,
// 조준 카메라와 서로를 모른 채 각각 정해져 있었다. 그래서 릴리스 순간 카메라가 조준 위치보다
// **뒤로 0.81m, 위로 0.38m** 움직였다 — 공은 앞으로 가는데 카메라는 멀어지는 방향.
// "굴리면 공이 툭 작아진다"의 정체가 원근이 아니라 이 계단식 전환이었다.
//
// 실측 (1280x720, 동일 투구):   릴리스지름  최소지름   후퇴    상승   훅 진폭
//   구 4.5m 상수                  9.9%      3.6%    0.69m  0.34m   20.4px
//   현 2.5m 상수                 10.6%      6.0%    0      0.11m   38.9px
//
// 훅 진폭 = 백엔드(오일 끝~임팩트 직전)에서 공이 레인 대비 화면에서 움직이는 폭. 눈에 보이는 훅의
// 크기다. 가까울수록 잘 보인다 — 횡변위의 화면 픽셀은 거리에 반비례하므로. "멀리서 봐야 궤적이
// 보인다"는 직관은 경로의 존재에는 맞지만 꺾임의 해상도에는 반대다. 핀은 어느 거리에서도 프레임을
// 벗어나지 않는다(전 구간 검증).
// 조준 카메라 높이. 1.12였는데 FOV를 52→40으로 조이면서 낮췄다 — 좁은 FOV에서 1.12면 공이
// 화면 아래로 떨어진다(Engine.ts 카메라 주석). 0.75면 fov 37까지 공이 남고 핀도 프레임 안이며
// 레인 세로 점유율은 현행과 같다. 팔로우 0.85와도 이어져 릴리스 전환이 연속이 된다.
const AIM_Y = 0.75;
const AIM_PZ = -2.7; // 조준 카메라 z. 팔로우 하한이 이보다 뒤면 릴리스에서 후퇴가 생긴다 → 하한으로 쓴다.
const FOLLOW_DIST = 2.5; // 공 뒤 거리(m)
const FOLLOW_Y = 0.85; // 팔로우 높이(m). 조준 AIM_Y(0.75)에서 살짝 올라가며 릴리스가 이어진다
// (버그였던 상승과 반대 방향). 핀덱 접근 블렌드가 1.25로 끌어올리므로 낮게 깔수록 핀 앞에서
// '일어서는' 비트가 산다: 높이 0.85→1.18, 시선 6.6°→10.8°. 1.5였을 땐 오히려 내려가서 그 비트가
// 아예 없었다(9.3°→11.1°, 2도뿐).
const FOLLOW_SMOOTH = 8; // 스무딩 λ. 6이면 8m/s에서 지연만 1.7m라 실효 추적거리가 크게 부푼다.

/**
 * 상태별 카메라 연출 (도안 §9). 목표 위치/타겟을 프레임레이트 독립 스무딩으로 보간.
 * AIMING 로우앵글(원근 강조) → ROLLING 공 뒤 실시간 팔로우 → SETTLING 핀 클로즈업.
 * 임팩트 시 카메라 셰이크 (P2 타격감) — 스무딩된 base 위치 위에 감쇠 offset을 얹는다.
 */
export class CameraRig {
  private readonly target = new THREE.Vector3(0, 0.1, 8);
  private readonly basePos = new THREE.Vector3(); // 셰이크 전 스무딩 위치 (offset 누적 방지)
  private inited = false;
  private shake = 0; // 현재 셰이크 진폭 (m), 매 프레임 감쇠
  private push = 0; // 현재 push-in 진행도 0..1 (실시간 이징)
  private pushHold = 0; // 남은 최대근접 유지 시간 (실시간 s)
  private menuTime = 0; // MENU 카메라 슬로우 스웨이용

  constructor(
    private readonly engine: Engine,
    private readonly game: GameState,
    private readonly ball: Ball,
  ) {}

  /** 임팩트 신호 (Boot에서 engine.onContact 배선). contact force → 셰이크 누적. */
  addShake(magnitude: number) {
    if (!SHAKE_ENABLED) return; // 셰이크 OFF — 슬로모+사운드만으로 손맛 검증 중
    const kick = (Math.min(magnitude, SHAKE_FORCE_REF) / SHAKE_FORCE_REF) * SHAKE_KICK;
    this.shake = Math.min(SHAKE_MAX, this.shake + kick);
  }

  /**
   * 외부 연출(리플레이 item 2)이 카메라를 직접 몰고 난 뒤 호출 — 다음 update가 현재 카메라
   * 위치(basePos)부터 다시 스무딩하도록 리셋해, 리플레이 종료 시 위치 점프(snap)를 없앤다.
   */
  resync() {
    this.inited = false;
  }

  /** 임팩트 push-in 신호 (Boot onContact). 핀 접촉마다 호출 → 근접 유지시간 갱신. */
  pushIn() {
    if (!PUSHIN_ENABLED) return;
    this.pushHold = PUSHIN_HOLD;
  }


  update(dt: number) {
    const cam = this.engine.camera;
    if (!this.inited) {
      this.basePos.copy(cam.position); // Boot가 세팅한 초기 AIMING 위치에서 시작
      this.inited = true;
    }
    const b = this.ball.mesh.position; // raw 물리 위치(60fps 끊김) 대신 보간된 메시 위치를 추적

    // 기본 = 공 뒤 로우 체이스 (ROLLING·거터 SETTLING 공용, 상수는 파일 상단).
    // 하한이 조준 위치라 릴리스에서 뒤로 밀리지 않는다. 핀덱 근처(z>13)는 정지.
    let px = clamp(b.x * 0.4, -1, 1);
    let py = FOLLOW_Y;
    let pz = clamp(b.z - FOLLOW_DIST, AIM_PZ, 13.0);
    let tx = clamp(b.x * 0.8, -1.2, 1.2);
    let ty = 0.1;
    let tz = Math.min(b.z + 4, 20);

    switch (this.game.state) {
      case 'MENU':
        // 와이드 시네마틱 + 느린 좌우 스웨이 (메뉴 배경)
        this.menuTime += dt;
        px = 1.4 + Math.sin(this.menuTime * 0.25) * 0.5;
        py = 1.7;
        pz = -3.4;
        tx = 0; ty = 0.2; tz = 9;
        break;
      case 'AIMING':
        // 낮고 가까운 1인칭 느낌 — 레인이 화면을 채우고 원근이 살도록
        px = 0; py = AIM_Y; pz = AIM_PZ;
        tx = 0; ty = -0.05; tz = 7.5;
        break;
      case 'ROLLING':
      case 'SETTLING': {
        // 볼 진행도(u)에 카메라를 연속 종속 — 임계 스위치 대신 팔로우→수평·근접 핀덱뷰를 비례 보간.
        // 볼 속도를 그대로 타서 '굴러감 → 당겨짐 → 핀 밀고 들어감'이 끊김 없이 이어진다.
        // (거터로 빠지면(b.y) u=1로 바로 핀덱뷰 — 결과를 보여줘야 하므로.)
        const span = HEADPIN_Z - CAM_APPROACH_Z;
        const u = b.y <= -1.5 ? 1 : clamp((b.z - CAM_APPROACH_Z) / span, 0, 1);
        const e = u * u * (3 - 2 * u); // smoothstep
        px = lerp(px, 0, e); py = lerp(py, 1.25, e); pz = lerp(pz, 15.8, e);
        tx = lerp(tx, 0, e); ty = lerp(ty, 0.5, e); tz = lerp(tz, 19.4, e);
        break;
      }
      default: // GAME_OVER
        px = 0; py = 3.2; pz = 12.5;
        tx = 0; ty = 0.3; tz = 18.8;
    }

    const k = 1 - Math.exp(-FOLLOW_SMOOTH * dt); // 프레임레이트 독립 스무딩 (도안 §B.6)
    this.basePos.lerp(_v.set(px, py, pz), k);
    cam.position.copy(this.basePos);

    // 임팩트 셰이크: base 위에 랜덤 offset, 실시간 감쇠 (offset은 cam에만, base엔 누적 안 됨)
    if (this.shake > 1e-4) {
      cam.position.x += (Math.random() * 2 - 1) * this.shake;
      cam.position.y += (Math.random() * 2 - 1) * this.shake;
      cam.position.z += (Math.random() * 2 - 1) * this.shake * 0.5;
      this.shake *= Math.exp(-SHAKE_DECAY * dt);
    }

    this.target.lerp(_v.set(tx, ty, tz), k);

    // 임팩트 push-in: 시선 방향(핀 쪽)으로 dolly-in. hold 동안 1로 접근, 만료 후 0으로 복귀.
    // base/target엔 누적 안 됨(매 프레임 cam.position에만 가산) — 셰이크와 동일 정책.
    if (this.pushHold > 0) this.pushHold -= dt;
    const pushTarget = this.pushHold > 0 ? 1 : 0;
    this.push += (pushTarget - this.push) * (1 - Math.exp(-PUSHIN_RATE * dt));
    if (this.push > 1e-3) {
      _v2.subVectors(this.target, cam.position).normalize();
      cam.position.addScaledVector(_v2, this.push * PUSHIN_DIST);
    }

    cam.lookAt(this.target);
  }
}
