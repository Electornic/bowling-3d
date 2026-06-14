import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import {
  BALL_START_Z,
  BALL_RADIUS,
  MIN_SPEED,
  MAX_SPEED,
  FRICTION_K,
  REF_MASS,
  SLIP_EPS,
  SPIN_RATE,
  ROLL_RATIO,
  HEADPIN_Z,
  AIM_RANGE,
  BALL_FRICTION,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
  hookFactor,
} from '../game/constants';
import { css, NEON, FONT_UI, rgba, ensureNeonStyles } from '../ui/theme';

const PREVIEW_N = 32; // 조준선 예측 시뮬 점 개수 (전체 경로 계산용)
const PREVIEW_DRAW_N = 8; // 실제로 그리는 앞부분 점 수 — 짧은 방향 가이드만 (훅 결과는 숨김)
const PREVIEW_DT = 0.08; // 예측 시뮬 스텝 (s)
// 예측 모델 = 주입 측면력(∝1/mass) + Rapier 접촉 마찰(질량 무관, μ=min 결합) 2성분.
// 실제 물리 대비 잔차 보정 계수 (시뮬 5케이스 평균오차 ~1cm)
const PREVIEW_HOOK_GAIN = 1.0;

/**
 * 포인터(마우스+터치) + 키보드 입력 추상화 (도안 §8).
 * - 마우스 X → 조준(aim), 스핀까지 반영된 **곡선 예측 조준선** 표시
 * - 캔버스 누르고 있으면 파워 게이지 핑퐁 차징, 떼면 발사 (차징 중 조준선도 파워 반영)
 * - 스핀: Q/E 키 또는 하단 스핀 바 **드래그**(좌=훅L, 우=훅R), 수치 피드백
 * UI 요소(슬라이더 등) 위 포인터는 무시(canvas 타겟만 차징/조준).
 */
export class Controls {
  private aim = 0;
  private spin = 0;
  private power = 0;
  private charging = false;
  private chargeDir = 1;
  private draggingSpin = false;

  private readonly aimLine: THREE.Line;
  private readonly powerWrap: HTMLDivElement;
  private readonly gaugeFill: HTMLDivElement;
  private readonly spinWrap: HTMLDivElement;
  private readonly spinTrack: HTMLDivElement;
  private readonly spinFill: HTMLDivElement;
  private readonly spinThumb: HTMLDivElement;
  private readonly spinValue: HTMLSpanElement;

  constructor(
    private readonly engine: Engine,
    private readonly game: GameState,
    private readonly ball: Ball,
  ) {
    ensureNeonStyles();

    // 곡선 조준선 (스핀 훅 예측 경로)
    const pts = Array.from({ length: PREVIEW_N }, () => new THREE.Vector3(0, 0.02, BALL_START_Z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.aimLine = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: 0xff8800, transparent: true, opacity: 0.95 }),
    );
    this.aimLine.geometry.setDrawRange(0, PREVIEW_DRAW_N); // 앞부분만 짧게 그림 (전체 경로는 계산만)
    engine.scene.add(this.aimLine);

    // === 파워 게이지 (우측 하단 — 중앙은 공과 겹침) ===
    const powerWrap = (this.powerWrap = document.createElement('div'));
    css(powerWrap, {
      position: 'fixed',
      bottom: '24px',
      right: '24px',
      width: '240px',
      zIndex: '20',
      pointerEvents: 'none',
    });
    const powerLabel = document.createElement('div');
    powerLabel.textContent = 'POWER';
    css(powerLabel, {
      font: FONT_UI,
      fontSize: '10px',
      letterSpacing: '0.16em',
      color: NEON.dim,
      margin: '0 2px 4px',
    });
    const gaugeTrack = document.createElement('div');
    css(gaugeTrack, {
      width: '100%',
      height: '14px',
      background: 'rgba(255,255,255,0.1)',
      border: `1px solid ${rgba(NEON.cyan, 0.25)}`,
      borderRadius: '8px',
      overflow: 'hidden',
    });
    this.gaugeFill = document.createElement('div');
    css(this.gaugeFill, {
      width: '0%',
      height: '100%',
      background: 'linear-gradient(90deg,#4ade80,#facc15,#ef4444)',
      boxShadow: '0 0 12px rgba(250,204,21,0.5)',
    });
    gaugeTrack.appendChild(this.gaugeFill);
    powerWrap.appendChild(powerLabel);
    powerWrap.appendChild(gaugeTrack);
    document.body.appendChild(powerWrap);

    // === 스핀 게이지 (파워 위) — Q/E 또는 드래그로 좌/우 훅 설정 ===
    const spinWrap = (this.spinWrap = document.createElement('div'));
    css(spinWrap, {
      position: 'fixed',
      bottom: '72px',
      right: '24px',
      width: '240px',
      zIndex: '20',
      pointerEvents: 'none',
    });

    // 헤더: "스핀" 라벨 + 현재 수치
    const spinHead = document.createElement('div');
    css(spinHead, {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      margin: '0 2px 4px',
    });
    const spinLabel = document.createElement('span');
    spinLabel.textContent = '스핀';
    css(spinLabel, {
      font: FONT_UI,
      fontSize: '10px',
      letterSpacing: '0.16em',
      color: NEON.dim,
      textTransform: 'uppercase',
    });
    this.spinValue = document.createElement('span');
    css(this.spinValue, { font: "700 12px/1 ui-monospace, 'SF Mono', monospace", color: NEON.dim });
    spinHead.appendChild(spinLabel);
    spinHead.appendChild(this.spinValue);

    // 드래그 가능한 트랙 (중앙=0, 좌/우로 차오름)
    const spinTrack = (this.spinTrack = document.createElement('div'));
    css(spinTrack, {
      position: 'relative',
      width: '100%',
      height: '10px',
      background: 'rgba(255,255,255,0.1)',
      border: `1px solid ${rgba(NEON.purple, 0.25)}`,
      borderRadius: '999px',
      pointerEvents: 'auto',
      cursor: 'ew-resize',
      touchAction: 'none',
    });
    const tick = document.createElement('div'); // 중앙 눈금
    css(tick, {
      position: 'absolute',
      left: '50%',
      top: '-3px',
      width: '2px',
      height: '16px',
      marginLeft: '-1px',
      background: rgba(NEON.ice, 0.5),
    });
    this.spinFill = document.createElement('div');
    css(this.spinFill, {
      position: 'absolute',
      left: '50%',
      top: '0',
      width: '0%',
      height: '100%',
      borderRadius: '999px',
    });
    this.spinThumb = document.createElement('div');
    css(this.spinThumb, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '16px',
      height: '16px',
      marginLeft: '-8px',
      marginTop: '-8px',
      borderRadius: '50%',
      background: '#fff',
      border: `2px solid ${NEON.purple}`,
      boxShadow: `0 0 8px ${rgba(NEON.purple, 0.8)}`,
    });
    spinTrack.appendChild(this.spinFill);
    spinTrack.appendChild(tick);
    spinTrack.appendChild(this.spinThumb);

    const spinHint = document.createElement('div');
    spinHint.textContent = '드래그 또는 Q ◀ ▶ E';
    css(spinHint, {
      font: FONT_UI,
      fontSize: '9px',
      letterSpacing: '0.04em',
      color: rgba(NEON.ice, 0.4),
      textAlign: 'center',
      margin: '4px 0 0',
    });

    spinWrap.appendChild(spinHead);
    spinWrap.appendChild(spinTrack);
    spinWrap.appendChild(spinHint);
    document.body.appendChild(spinWrap);

    this.bindEvents();
  }

  private onCanvas(e: PointerEvent): boolean {
    return (e.target as HTMLElement)?.tagName === 'CANVAS';
  }

  /** 스핀 바 위 포인터 x → spin ∈ [-1,1] (0.1 단위, Q/E와 동일 해상도) */
  private setSpinFromPointer(clientX: number) {
    const r = this.spinTrack.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width; // 0..1
    const s = Math.max(-1, Math.min(1, ratio * 2 - 1));
    this.spin = Math.round(s * 10) / 10;
  }

  private bindEvents() {
    window.addEventListener('pointermove', (e) => {
      if (this.draggingSpin) {
        this.setSpinFromPointer(e.clientX);
        return;
      }
      if (!this.onCanvas(e)) return;
      // 카메라(-z에서 +z 방향)는 world +x가 화면 왼쪽 → 부호 반전해야 마우스 방향 = 공 방향
      this.aim = (1 - (e.clientX / window.innerWidth) * 2) * AIM_RANGE;
    });
    window.addEventListener('pointerdown', (e) => {
      // AI 턴(로드맵 P1.5 입력 락)·메뉴에선 차징 불가
      if (!this.onCanvas(e) || this.game.state !== 'AIMING' || !this.game.isHumanTurn()) return;
      this.charging = true;
      this.power = 0;
      this.chargeDir = 1;
    });
    window.addEventListener('pointerup', () => {
      this.draggingSpin = false;
      if (!this.charging) return;
      this.charging = false;
      this.game.throwBall(this.aim, this.power, this.spin);
      this.power = 0;
      this.spin = 0;
    });
    // 스핀 바 드래그 (캔버스 차징과 독립 — div 타겟이라 onCanvas=false)
    this.spinTrack.addEventListener('pointerdown', (e) => {
      if (this.game.state !== 'AIMING' || !this.game.isHumanTurn()) return;
      this.draggingSpin = true;
      this.setSpinFromPointer(e.clientX);
      e.preventDefault();
    });
    window.addEventListener('keydown', (e) => {
      if (this.game.state !== 'AIMING' || !this.game.isHumanTurn()) return;
      if (e.code === 'KeyQ') this.spin = Math.max(-1, Math.round((this.spin - 0.2) * 10) / 10);
      else if (e.code === 'KeyE') this.spin = Math.min(1, Math.round((this.spin + 0.2) * 10) / 10);
    });
  }

  /** 매 렌더 프레임 (Loop onFrame): 파워 차징 + 조준선/스핀 게이지 갱신 */
  update() {
    if (this.charging) {
      this.power += this.chargeDir * 0.018;
      if (this.power >= 1) {
        this.power = 1;
        this.chargeDir = -1;
      } else if (this.power <= 0) {
        this.power = 0;
        this.chargeDir = 1;
      }
    }
    this.gaugeFill.style.width = `${this.power * 100}%`;

    // 스핀 게이지: 중앙에서 좌(Q/드래그, 시안)/우(E/드래그, 앰버)로 차오름 + 썸 + 수치
    const s = this.spin;
    const dirColor = s < 0 ? NEON.cyan : NEON.amber;
    this.spinFill.style.width = `${Math.abs(s) * 50}%`;
    this.spinFill.style.left = s < 0 ? `${50 - Math.abs(s) * 50}%` : '50%';
    this.spinFill.style.background = dirColor;
    this.spinThumb.style.left = `${50 + s * 50}%`;
    this.spinThumb.style.borderColor = s === 0 ? NEON.purple : dirColor;
    this.spinThumb.style.boxShadow = `0 0 8px ${rgba(s === 0 ? NEON.purple : dirColor, 0.85)}`;
    if (s === 0) {
      this.spinValue.textContent = '0';
      this.spinValue.style.color = NEON.dim;
    } else {
      this.spinValue.textContent = s < 0 ? `◀ L ${Math.abs(s).toFixed(1)}` : `R ${s.toFixed(1)} ▶`;
      this.spinValue.style.color = dirColor;
    }

    // 메뉴/AI 턴엔 입력 UI 전체 숨김 (로드맵 P1/P1.5)
    const inGame = this.game.state !== 'MENU' && this.game.isHumanTurn();
    this.powerWrap.style.display = inGame ? '' : 'none';
    this.spinWrap.style.display = inGame ? '' : 'none';

    const aiming = this.game.state === 'AIMING' && this.game.isHumanTurn();
    this.aimLine.visible = aiming;
    if (aiming) this.updateAimLine();
  }

  /**
   * 예측 조준선: Ball.launch + applySpinForce와 같은 수식으로 짧게 전방 시뮬.
   * 주입 측면력(hookFactor 게이트, ∝1/mass)에 Rapier 자체 접촉 마찰 성분
   * (질량 무관, 오일/드라이 μ 따라 변함)을 더해 실제 궤적을 근사한다.
   * 차징 중에는 현재 파워 기준, 평소엔 중간 파워 기준 경로.
   */
  private updateAimLine() {
    const p = this.charging ? this.power : 0.55;
    const speed = (MIN_SPEED + p * (MAX_SPEED - MIN_SPEED)) * this.ball.speedScale;
    const n = Math.hypot(this.aim, 1);
    let vx = (this.aim / n) * speed;
    let vz = (1 / n) * speed;
    let wzR = -vx * ROLL_RATIO + this.spin * SPIN_RATE * BALL_RADIUS; // ωz·R (마찰로 감쇠)
    const wxR = vz * ROLL_RATIO; // ωx·R
    const inject = (FRICTION_K * REF_MASS * 9.81) / this.ball.massKg;

    let x = 0;
    let z = BALL_START_Z;
    const pos = this.aimLine.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < PREVIEW_N; i++) {
      pos.setXYZ(i, x, 0.02, z);
      if (z >= HEADPIN_Z) continue; // 핀에 닿으면 나머지 점은 끝점에 고정
      const slipX = vx + wzR;
      const slipZ = vz - wxR;
      const mag = Math.hypot(slipX, slipZ);
      const hook = hookFactor(z); // 오일 존 직진 → 드라이 존 레이트 훅 (발사 물리와 동일 게이트)
      if (mag > SLIP_EPS) {
        const laneFric = LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hook;
        const rapier = Math.min(BALL_FRICTION, laneFric) * 9.81; // 접촉 마찰 (레인 combine=Min)
        const a = (inject * hook + rapier) * PREVIEW_HOOK_GAIN;
        vx -= (slipX / mag) * a * PREVIEW_DT;
        vz -= (slipZ / mag) * a * PREVIEW_DT;
        // 마찰은 회전도 진행에 정렬시킴 → 스핀 감쇠 (균일 구: 슬립 닫힘의 2.5배율)
        wzR -= (slipX / mag) * rapier * PREVIEW_HOOK_GAIN * 2.5 * PREVIEW_DT;
      }
      x += vx * PREVIEW_DT;
      z += vz * PREVIEW_DT;
    }
    pos.needsUpdate = true;
  }
}
