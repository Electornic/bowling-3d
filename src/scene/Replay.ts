import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import type { Ball } from './Ball';
import type { PinSet } from './PinSet';
import type { GameStateName } from '../game/GameState';
import { HEADPIN_Z, CAM_APPROACH_Z, PIN_DECK_END, PIN_CONTACT_Z } from '../game/constants';

const OBJ_COUNT = 11; // 공 1 + 핀 10
const FLOATS = 7; // 객체당 x,y,z, qx,qy,qz,qw
const REC_STRIDE = 2; // N 물리 스텝마다 1 스냅샷 (FIXED_DT=1/60 → 30/s)
const SNAP_DT = REC_STRIDE / 60; // 스냅샷 간 sim 간격 (Loop FIXED_DT와 일치해야 함)
const MAX_SNAPS = 360; // 안전 상한 (~24s sim) — 초과분은 녹화 중단(끝부분 누락, 임팩트는 앞쪽이라 무해)
const PLAYBACK_SPEED = 0.8; // 약간의 슬로모(드라마). sim-시간 buffer를 실시간 dt·이 배율로 진행
const END_HOLD = 0.7; // 마지막(핀 산개) 프레임 프리즈 유지 (실시간 s) — §12.2 프리즈 프레임

/**
 * 특별샷 리플레이 (docs/OPEN_WORLD_LOBBY.md §12.2) — 스냅샷 방식.
 *
 * ROLLING/SETTLING 동안 공+핀 transform을 sim-시간 균등 간격(REC_STRIDE 스텝마다)으로 링버퍼에
 * 녹화하고, strike/spare/splitConverted 시 보간 재생한다. 재생 중엔 Loop를 일시정지(setPaused)해
 * 라이브 물리를 얼리고 메시를 직접 몬다(녹화 버퍼가 진실). 종료 시 Engine.snapToBodies로 라이브
 * (리셋된 랙)에 즉시 일치 → 보간 튐 없이 복귀. 카메라는 게임플레이(후방 로우)와 대비되는 측면 3/4.
 *
 * 슬로모(임팩트)·AI 빨리감기는 sim-dt를 바꾸지 않으므로 buffer 간격이 균등 → 재생은 항상 정상 속도.
 */
export class Replay {
  /** 재생 중 여부 — Boot.onFrame이 이 값으로 분기(true면 update()만 호출, 카메라/컨트롤은 리플레이 소유). */
  active = false;
  /** Loop.paused 토글 주입 (Boot가 배선) — game.setTimeScale과 같은 패턴(루프는 buildScene 밖에서 생성). */
  setPaused?: (paused: boolean) => void;

  private snaps: Float32Array[] = [];
  private lastState: GameStateName | '' = '';
  private stepCount = 0;
  private playTime = 0; // 재생 경과 (sim s)
  private cutoff = 0; // 공이 레일을 벗어나는(핀덱 통과) 시각(sim s) — 여기까지 따라가고 프리즈(빈 핏 꼬리 컷)
  private crashTime = 0; // 핀 임팩트 시각(sim s) — 전광판 announce를 여기에 싱크
  private crashFired = false;
  private onCrash?: () => void; // 임팩트 순간 1회 콜백 (전광판 announce) — 스킵/취소 시에도 보장 발화

  private readonly _q0 = new THREE.Quaternion();
  private readonly _q1 = new THREE.Quaternion();

  private readonly banner: HTMLDivElement;
  private readonly skipLayer: HTMLDivElement;

  constructor(
    private readonly engine: Engine,
    private readonly ball: Ball,
    private readonly pins: PinSet,
    private readonly onFinish?: () => void, // 종료 직후 1회 (예: cameraRig.resync)
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

    // 상단 중앙 배너 — 업적 아일랜드(z30, top≈8px) 아래에 앉도록 top을 내린다.
    this.banner = document.createElement('div');
    this.banner.style.cssText = [
      'position:fixed',
      'top:calc(54px + env(safe-area-inset-top))',
      'left:50%',
      'transform:translateX(-50%)',
      'z-index:31',
      'display:none',
      'padding:8px 16px',
      'border-radius:999px',
      'border:1px solid rgba(34,211,238,0.45)',
      'background:rgba(14,17,27,0.9)',
      'color:#e8edf5',
      "font:800 13px/1 system-ui, sans-serif",
      'letter-spacing:0.02em',
      'white-space:nowrap',
      'pointer-events:none', // 스킵은 레이어가 처리 — 배너는 통과
      'box-shadow:0 0 18px rgba(34,211,238,0.25)',
    ].join(';');
    document.body.appendChild(this.banner);
  }

  // --- 녹화 (Boot.onStep에서 game.update 직전에 호출; pre-update state로 SETTLING 종료 프레임까지 포함) ---
  /** state = update 전 게임 상태. ROLLING 진입 시 버퍼 리셋, ROLLING/SETTLING 동안 균등 녹화. */
  record(state: GameStateName) {
    if (state === 'ROLLING' && this.lastState !== 'ROLLING') {
      this.snaps = []; // 새 투구 → 버퍼 리셋
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

  // --- 트리거 (Boot.onEvent: strike/spare/splitConverted) ---
  start(label: string, onCrash?: () => void): boolean {
    if (this.snaps.length < 2) return false; // 녹화 부족 — 미발동(호출측이 즉시 announce)
    this.active = true;
    this.playTime = 0;
    this.onCrash = onCrash;
    this.crashFired = false;
    // 레일을 벗어난 뒤(공이 핏으로 떨어질 때 — y↓ 또는 핀덱 한참 통과)까지 따라가고 거기서 프리즈.
    // 공 낙하까지 자연스럽게 보여주되, 공이 사라진 뒤의 긴 핀 정산 꼬리는 잘라낸다.
    this.cutoff = (this.snaps.length - 1) * SNAP_DT;
    for (let i = 0; i < this.snaps.length; i++) {
      const s = this.snaps[i];
      if (s[1] < -1.0 || s[2] > PIN_DECK_END + 2.0) {
        this.cutoff = i * SNAP_DT;
        break;
      }
    }
    // 핀 임팩트 시각 — 공이 핀에 닿는 첫 스냅샷. 전광판 announce를 여기에 맞춰 띄워 리플레이와 싱크.
    this.crashTime = this.cutoff;
    for (let i = 0; i < this.snaps.length; i++) {
      if (this.snaps[i][2] > PIN_CONTACT_Z) {
        this.crashTime = i * SNAP_DT;
        break;
      }
    }
    this.banner.textContent = `🎬 리플레이 · ${label}  —  탭하여 건너뛰기`;
    this.banner.style.display = 'block';
    this.skipLayer.style.display = 'block';
    this.setPaused?.(true);
    return true;
  }

  /** 게임오버 등으로 리플레이를 즉시 접고 라이브 복귀(마지막 결정타가 결과화면과 겹치지 않게). */
  cancel() {
    this.finish();
  }

  // --- 재생 (Boot.onFrame, active일 때만; dt=실시간 프레임) ---
  update(dt: number) {
    if (!this.active) return;
    this.playTime += dt * PLAYBACK_SPEED;
    if (!this.crashFired && this.playTime >= this.crashTime) {
      this.crashFired = true;
      this.onCrash?.(); // 전광판 announce를 핀 임팩트 순간에 — 리플레이와 싱크
    }
    if (this.playTime >= this.cutoff + END_HOLD) {
      this.finish();
      return;
    }
    this.applyFrame(Math.min(this.playTime, this.cutoff)); // cutoff(레일 이탈) 이후 END_HOLD 동안 프리즈
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
    ); // 공 x·y·z 추적
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
   * 지면에 선(업라이트) 로우 체이스 — 공이 핏으로 빠질 때까지 졸졸 따라간다. 눈높이(y≈0.5)에서
   * 수평으로 공 앞 레인을 보며(내려다보지 않음 = '하늘에서 관찰' 아님) 훅을 정면에서, 핀 크래시를
   * 통과한다. 시선이 항상 공보다 앞(fz+2.5)이라 시점이 안 깨지고, 핀덱 너머(핏 입구)에서 추종을 멈춘다.
   */
  private placeCamera(bx: number, by: number, bz: number) {
    const cam = this.engine.camera;
    const u = THREE.MathUtils.clamp((bz - CAM_APPROACH_Z) / (HEADPIN_Z - CAM_APPROACH_Z), 0, 1);
    const e = u * u * (3 - 2 * u); // smoothstep
    const trail = THREE.MathUtils.lerp(2.0, 1.4, e); // 핀 근처선 1.4m 뒤로 바짝
    const fz = Math.min(bz, PIN_DECK_END + 2.0); // 핏 안쪽까지 따라감(레일 벗어난 뒤까지)
    // 공보다 살짝 위에서 졸졸. 공이 핏으로 떨어지면(by↓) 카메라·시선이 함께 내려가 '낙하'를 담는다
    // — 핀 너머 빈 공간(어둠)을 수평으로 보는 대신 '공'을 추적.
    cam.position.set(bx * 0.7, Math.max(0.45, by + 0.55), fz - trail);
    cam.lookAt(bx, by + 0.05, bz + 1.2);
  }

  private finish() {
    if (!this.active) return;
    this.active = false;
    if (!this.crashFired) {
      this.crashFired = true;
      this.onCrash?.(); // 스킵/취소(임팩트 도달 전 종료) 시에도 전광판은 띄운다
    }
    this.banner.style.display = 'none';
    this.skipLayer.style.display = 'none';
    this.engine.snapToBodies(); // 메시·보간을 라이브(리셋된 랙)로 즉시 일치 → 점프 없는 복귀
    this.setPaused?.(false);
    this.onFinish?.(); // cameraRig.resync — 다음 프레임부터 현재 위치에서 스무딩 인계
  }
}
