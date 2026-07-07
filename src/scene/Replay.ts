import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import type { Ball } from './Ball';
import type { PinSet } from './PinSet';
import type { GameStateName } from '../game/GameState';
import { HEADPIN_Z, CAM_APPROACH_Z, PIN_DECK_END } from '../game/constants';

const OBJ_COUNT = 11; // 공 1 + 핀 10
const FLOATS = 7; // 객체당 x,y,z, qx,qy,qz,qw
const REC_STRIDE = 2; // N 물리 스텝마다 1 스냅샷 (FIXED_DT=1/60 → 30/s)
const SNAP_DT = REC_STRIDE / 60; // 스냅샷 간 sim 간격
const MAX_SNAPS = 360; // 안전 상한 (~24s sim) — 초과분 녹화 중단(임팩트는 앞쪽이라 무해)
const REPLAY_WINDOW = 1.3; // [튜닝] 임팩트 직전 이 sim초 구간만 재생 — 짧은 리플레이(풀 레인 주행 스킵)
const PLAYBACK_SPEED = 0.9; // [튜닝] 재생 배율 — 실시간 dt·이 배율로 sim buffer 진행 (↑=빠름, 1.0=실시간). 0.65→0.8→0.9 더 스냅.
const END_HOLD = 0.65; // [튜닝] 핀 정리 완료 프레임 프리즈 유지(실시간 s) — 스틸컷 슬램이 얹히는 구간. 1.0→0.8→0.65 꼬리 더 짧게(슬램은 유지).
const PIN_STILL_EPS = 0.008; // [튜닝] 스냅 간 핀 10개 위치 이동량 합(m). 이하 = 정지 — 리플레이 프리즈(종료) 시점 판정
const PIN_STILL_HOLD = 4; // [튜닝] 연속 '정지' 스냅 수(~0.13s sim). 이만큼 지속돼야 핀 정리 완료로 확정(단발 정지 오검 방지)

/**
 * 특별샷 리플레이 (스냅샷 방식, item 2 폴리싱 — 스트라이크 전용).
 *
 * ROLLING/SETTLING 동안 공+핀 transform을 sim-시간 균등 간격으로 링버퍼에 녹화하고, strike 시
 * 임팩트 직전 REPLAY_WINDOW 구간을 보간 재생한다. 재생 중엔 Loop를 일시정지(setPaused)해 라이브
 * 물리를 얼리고 메시를 직접 몬다(버퍼가 진실). cutoff(공이 레일 이탈)에서 프리즈하며 onFreeze로
 * 스틸컷을 띄우고, END_HOLD 뒤 Engine.snapToBodies로 라이브(리셋된 랙)에 즉시 일치 → 점프 없이 복귀.
 * 카메라는 공 뒤 로우 체이스. 탭(skipLayer)으로 즉시 스킵.
 */
export class Replay {
  /** 재생 중 여부 — Boot.onFrame이 이 값으로 분기(true면 update()만, 카메라/컨트롤은 리플레이 소유). */
  active = false;
  /** Loop.paused 토글 주입 (Boot가 배선). */
  setPaused?: (paused: boolean) => void;

  private snaps: Float32Array[] = [];
  private lastState: GameStateName | '' = '';
  private stepCount = 0;
  private playTime = 0; // 재생 경과 (sim s)
  private cutoff = 0; // 공이 레일을 벗어나는 시각(sim s) — 여기까지 재생하고 프리즈
  private frozen = false;
  private onFreeze?: () => void; // cutoff(프리즈) 도달 시 1회 — Boot가 스틸컷을 띄운다

  private readonly _q0 = new THREE.Quaternion();
  private readonly _q1 = new THREE.Quaternion();
  // 헤드핀 도달 시 카메라를 '핀 앞'에 고정(래치)하는 포즈 — 공이 피트로 떨어져도 핏을 안 쫓게. start마다 리셋.
  private parkedCam: { px: number; py: number; pz: number; lx: number; ly: number; lz: number } | null = null;
  private readonly skipLayer: HTMLDivElement;

  constructor(
    private readonly engine: Engine,
    private readonly ball: Ball,
    private readonly pins: PinSet,
    private readonly onFinish?: () => void, // 종료 직후 1회 (예: cameraRig.resync + 스틸컷 hide)
  ) {
    // 전체화면 스킵 레이어 — 버튼(z=30) 아래(z=25)에 둬 탭이 버튼 클릭을 가리지 않게 한다.
    this.skipLayer = document.createElement('div');
    this.skipLayer.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:25',
      'display:none',
      'cursor:pointer',
      'background:transparent',
    ].join(';');
    this.skipLayer.onpointerdown = () => {
      if (this.active) this.finish();
    };
    document.body.appendChild(this.skipLayer);
  }

  /** state = update 전 게임 상태. ROLLING 진입 시 버퍼 리셋, ROLLING/SETTLING 동안 균등 녹화. */
  record(state: GameStateName) {
    if (state === 'ROLLING' && this.lastState !== 'ROLLING') {
      this.snaps = [];
      this.stepCount = 0;
    }
    this.lastState = state;
    if (state !== 'ROLLING' && state !== 'SETTLING') return;
    if (this.stepCount % REC_STRIDE === 0 && this.snaps.length < MAX_SNAPS) {
      this.snaps.push(this.capture());
    }
    this.stepCount++;
  }

  private capture(): Float32Array {
    const a = new Float32Array(OBJ_COUNT * FLOATS);
    this.writeBody(a, 0, this.ball.body);
    const pins = this.pins.pins;
    for (let i = 0; i < pins.length; i++) this.writeBody(a, (i + 1) * FLOATS, pins[i].body);
    return a;
  }

  private writeBody(a: Float32Array, off: number, body: RAPIER.RigidBody) {
    const t = body.translation();
    a[off] = t.x;
    a[off + 1] = t.y;
    a[off + 2] = t.z;
    const q = body.rotation();
    a[off + 3] = q.x;
    a[off + 4] = q.y;
    a[off + 5] = q.z;
    a[off + 6] = q.w;
  }

  /** strike 이벤트에서 호출. onFreeze = cutoff 도달 시 1회(스틸컷). 녹화 부족 시 false → 호출측이 즉시 스틸컷. */
  start(onFreeze?: () => void): boolean {
    if (this.snaps.length < 2) return false; // 녹화 부족 — 미발동
    this.active = true;
    this.frozen = false;
    this.parkedCam = null; // 새 리플레이마다 파킹 해제 (다시 공을 따라가다 핀 앞에서 래치)
    this.onFreeze = onFreeze;
    // 임팩트 = 공이 레일을 벗어나는(핏 낙하 y↓ 또는 핀덱 한참 통과) 첫 스냅. 리드인·프리즈 계산의 기준점.
    let impact = this.snaps.length - 1;
    for (let i = 0; i < this.snaps.length; i++) {
      const s = this.snaps[i];
      if (s[1] < -0.5 || s[2] > PIN_DECK_END + 2.0) {
        impact = i;
        break;
      }
    }
    // 프리즈(종료) = 임팩트 이후 핀이 멎는(정리 완료) 시각. 공이 먼저 핏으로 빠져도 핀이 다 쓰러질 때까지 재생.
    // (버퍼는 strike=allSettled 후 발화라 정리 프레임까지 담겨 있고, 카메라는 이미 핀 앞 파킹.) 미정지면 버퍼 끝.
    this.cutoff = this.pinSettleTime(impact);
    // 짧은 리플레이 — 임팩트 직전 REPLAY_WINDOW 구간부터 시작(풀 레인 주행 스킵).
    this.playTime = Math.max(0, impact * SNAP_DT - REPLAY_WINDOW);
    this.skipLayer.style.display = 'block';
    this.setPaused?.(true);
    return true;
  }

  /** 게임오버 등으로 즉시 접고 라이브 복귀. */
  cancel() {
    this.finish();
  }

  /**
   * 임팩트(fromIdx) 이후 핀 10개가 멎는(정리 완료) 첫 시각(sim s) — 리플레이 프리즈 지점.
   * 스냅 간 총 이동이 PIN_STILL_EPS 이하로 PIN_STILL_HOLD 연속 유지되면 정지로 확정.
   * 버퍼 내내 안 멎으면(느린 롤·SETTLE_TIMEOUT) 버퍼 끝까지 재생.
   */
  private pinSettleTime(fromIdx: number): number {
    const last = this.snaps.length - 1;
    let still = 0;
    for (let i = Math.max(fromIdx, 1); i <= last; i++) {
      if (this.pinMovement(this.snaps[i - 1], this.snaps[i]) < PIN_STILL_EPS) {
        if (++still >= PIN_STILL_HOLD) return i * SNAP_DT;
      } else {
        still = 0;
      }
    }
    return last * SNAP_DT;
  }

  /** 두 스냅 사이 핀 10개 위치 이동량 합(m). 공(offset 0)은 제외 — 핏에서 굴러도 정리 판정에 영향 없게. */
  private pinMovement(a: Float32Array, b: Float32Array): number {
    let sum = 0;
    for (let p = 1; p <= 10; p++) {
      const o = p * FLOATS;
      sum += Math.abs(a[o] - b[o]) + Math.abs(a[o + 1] - b[o + 1]) + Math.abs(a[o + 2] - b[o + 2]);
    }
    return sum;
  }

  update(dt: number) {
    if (!this.active) return;
    this.playTime += dt * PLAYBACK_SPEED;
    if (!this.frozen && this.playTime >= this.cutoff) {
      this.frozen = true;
      this.onFreeze?.(); // 프리즈 순간 스틸컷 슬램
    }
    if (this.playTime >= this.cutoff + END_HOLD) {
      this.finish();
      return;
    }
    this.applyFrame(Math.min(this.playTime, this.cutoff)); // cutoff 이후 END_HOLD 동안 프리즈
  }

  private applyFrame(t: number) {
    const last = this.snaps.length - 1;
    const f = t / SNAP_DT;
    let i = Math.floor(f);
    let a = f - i;
    if (i >= last) {
      i = last;
      a = 0;
    }
    const s0 = this.snaps[i];
    const s1 = this.snaps[Math.min(i + 1, last)];
    this.applyBody(this.ball.mesh, s0, s1, 0, a);
    const pins = this.pins.pins;
    for (let p = 0; p < pins.length; p++) this.applyBody(pins[p].mesh, s0, s1, (p + 1) * FLOATS, a);
    this.placeCamera(
      THREE.MathUtils.lerp(s0[0], s1[0], a),
      THREE.MathUtils.lerp(s0[1], s1[1], a),
      THREE.MathUtils.lerp(s0[2], s1[2], a),
    );
  }

  private applyBody(mesh: THREE.Object3D, s0: Float32Array, s1: Float32Array, off: number, a: number) {
    mesh.position.set(
      THREE.MathUtils.lerp(s0[off], s1[off], a),
      THREE.MathUtils.lerp(s0[off + 1], s1[off + 1], a),
      THREE.MathUtils.lerp(s0[off + 2], s1[off + 2], a),
    );
    this._q0.set(s0[off + 3], s0[off + 4], s0[off + 5], s0[off + 6]);
    this._q1.set(s1[off + 3], s1[off + 4], s1[off + 5], s1[off + 6]);
    mesh.quaternion.slerpQuaternions(this._q0, this._q1, a);
  }

  /**
   * 지면에 선 로우 체이스 — 공을 핀덱 진입까지 따라가다 헤드핀 도달 시 '핀 앞'에 파킹(래치)한다.
   * 이후 공이 피트로 굴러떨어져도 카메라는 핀덱을 향해 고정 → 핏으로 다이빙하지 않고 크래시를 지켜본다.
   */
  private placeCamera(bx: number, by: number, bz: number) {
    const cam = this.engine.camera;
    if (this.parkedCam) {
      const p = this.parkedCam;
      cam.position.set(p.px, p.py, p.pz);
      cam.lookAt(p.lx, p.ly, p.lz);
      return;
    }
    const u = THREE.MathUtils.clamp((bz - CAM_APPROACH_Z) / (HEADPIN_Z - CAM_APPROACH_Z), 0, 1);
    const e = u * u * (3 - 2 * u); // smoothstep
    const trail = THREE.MathUtils.lerp(2.0, 1.4, e); // 핀 근처선 1.4m 뒤로 바짝
    const fz = Math.min(bz, HEADPIN_Z); // 헤드핀 넘어가면 전진 정지 → 핀 앞
    const px = bx * 0.7;
    const py = Math.max(0.45, by + 0.55);
    const pz = fz - trail;
    const lx = bx;
    const ly = by + 0.05;
    const lz = Math.min(bz + 1.2, PIN_DECK_END + 0.4); // 시선은 핀덱까지만 (핏 아래로 안 쫓음)
    cam.position.set(px, py, pz);
    cam.lookAt(lx, ly, lz);
    if (bz >= HEADPIN_Z) this.parkedCam = { px, py, pz, lx, ly, lz }; // 핀 도달 → 파킹 래치
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    if (!this.frozen) {
      this.frozen = true;
      this.onFreeze?.(); // 스킵/취소(프리즈 도달 전 종료) 시에도 스틸컷은 띄운다
    }
    this.skipLayer.style.display = 'none';
    this.engine.snapToBodies(); // 메시·보간을 라이브(리셋된 랙)로 즉시 일치 → 점프 없는 복귀
    this.setPaused?.(false);
    this.onFinish?.(); // cameraRig.resync + 스틸컷 정리
  }
}
