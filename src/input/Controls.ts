import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import { isCoarsePointer } from '../core/device';
import {
  BALL_START_Z,
  BALL_RADIUS,
  MIN_SPEED,
  MAX_SPEED,
  FRICTION_K,
  REF_MASS,
  SLIP_EPS,
  SPIN_RATE,
  effectiveSpin,
  ROLL_RATIO,
  HEADPIN_Z,
  AIM_RANGE,
  AIM_GAIN,
  BALL_FRICTION,
  LANE_FRICTION_OIL,
  LANE_FRICTION_DRY,
  hookFactor,
} from '../game/constants';
import { css, NEON, FONT_UI, rgba, ensureNeonStyles, applyPanel } from '../ui/theme';

const PREVIEW_DT = 0.08; // 예측 경로 적분 스텝 (s)
// 파워 차징 속도(단위 /초). 기존엔 프레임당 +0.018(프레임레이트 의존 — 고주사율/저FPS에서 속도가
// 달라지는 버그)이었다. ×60fps = 1.08/s로 환산해 dt를 곱하면 어떤 FPS에서도 0→1 약 0.93초로 일정.
const CHARGE_RATE = 1.08;

/**
 * 포인터(마우스+터치) + 키보드 입력 추상화 (도안 §8 / MOBILE_SUPPORT.md §2).
 * - 마우스: X → 조준(aim) hover 상시 갱신, 누르고 있으면 파워 핑퐁 차징, 떼면 발사.
 * - 터치(ⓑ): hover가 없어 **누른 채 좌우 드래그**로 조준(anchor 기준 상대), 동시에 파워 핑퐁
 *   차징, 떼면 발사. `isPrimary`/`pointerId`로 단일 포인터만 차징, `pointercancel`로 고착 방지.
 * - 스핀: Q/E 키 또는 하단 스핀 바 **드래그**(좌=훅L, 우=훅R), 수치 피드백.
 *   터치 환경에선 스핀 바 히트영역·썸을 키운다(§3.1).
 * UI 요소(슬라이더 등) 위 포인터는 무시(canvas 타겟만 차징/조준).
 */
export class Controls {
  private aim = 0;
  private spin = 0;
  private power = 0;
  private charging = false;
  private chargeDir = 1;
  private draggingSpin = false;
  private wasAiming = false;

  // 터치 ⓑ — 상대 조준 anchor + 단일 포인터 추적 (멀티터치 오발사·pointercancel 고착 방지)
  private readonly coarse = isCoarsePointer();
  private activePointerId: number | null = null;
  private anchorX = 0;
  private anchorAim = 0;

  private readonly aimGroup: THREE.Group;
  private readonly aimCoreGeo: LineGeometry;
  private readonly aimCaseGeo: LineGeometry;
  private readonly aimCoreMat: LineMaterial;
  private readonly aimCaseMat: LineMaterial;
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

    // 조준 곡선 라인 — Line2(굵기 지원)로 실제 예측 경로를 그린다. THREE.Line은 브라우저가 linewidth를
    // 무시해 1px로만 나와 밝은 레인에서 안 보였음. 어두운 외곽선(case) + 밝은 코어(core) 2겹이라
    // 중립(흰색)도 또렷하고, 끝으로 갈수록 레인색으로 페이드(updateAimArrow). 두 겹은 좌표는 같고 색만 다름.
    const seed = [0, 0.02, BALL_START_Z, 0, 0.02, BALL_START_Z + 0.5];
    this.aimCoreGeo = new LineGeometry();
    this.aimCoreGeo.setPositions(seed);
    this.aimCoreGeo.setColors([1, 1, 1, 1, 1, 1]);
    this.aimCaseGeo = new LineGeometry();
    this.aimCaseGeo.setPositions(seed);
    this.aimCaseGeo.setColors([0, 0, 0, 0, 0, 0]);
    this.aimCaseMat = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: 8,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    this.aimCoreMat = new LineMaterial({
      color: 0xffffff,
      vertexColors: true,
      linewidth: 4,
      transparent: true,
      opacity: 1,
      depthWrite: false,
    });
    this.aimCaseMat.resolution.set(window.innerWidth, window.innerHeight);
    this.aimCoreMat.resolution.set(window.innerWidth, window.innerHeight);
    const caseLine = new Line2(this.aimCaseGeo, this.aimCaseMat);
    const coreLine = new Line2(this.aimCoreGeo, this.aimCoreMat);
    caseLine.renderOrder = 5;
    coreLine.renderOrder = 6;
    caseLine.frustumCulled = false;
    coreLine.frustumCulled = false;
    this.aimGroup = new THREE.Group();
    this.aimGroup.add(caseLine, coreLine);
    this.aimGroup.visible = false;
    engine.scene.add(this.aimGroup);

    // 스핀=좌하단 · 파워=우하단으로 분리 — 각자 글래스 패널. 가운데 레인을 비워 조준 화살표(바나나
    // 곡선)가 그 위로 펼쳐져 보이게 한다. (단일 하단 도크는 공·화살표 밑동을 가려서 폐기.)

    // === 파워 게이지 (우측 하단 — 중앙은 공과 겹침) ===
    const powerWrap = (this.powerWrap = document.createElement('div'));
    applyPanel(powerWrap, NEON.cyan);
    css(powerWrap, {
      position: 'fixed', // 우측 세로 파워바 (가운데 레인을 비움)
      bottom: this.coarse ? 'calc(96px + env(safe-area-inset-bottom))' : 'calc(20px + env(safe-area-inset-bottom))',
      right: this.coarse ? 'calc(10px + env(safe-area-inset-right))' : 'calc(24px + env(safe-area-inset-right))',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '10px 8px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    });
    // POWER 텍스트 라벨 제거 — 글자가 바(14px)보다 넓어 게이지가 한쪽으로 치우쳐 보였음.
    // 세로 게이지는 차오르면 의미가 자명하므로 라벨 없이 바만 둔다(중앙 정렬).
    const gaugeTrack = document.createElement('div');
    css(gaugeTrack, {
      position: 'relative',
      width: '14px',
      height: this.coarse ? '26vh' : '180px',
      background: 'rgba(255,255,255,0.1)',
      border: `1px solid ${rgba(NEON.cyan, 0.25)}`,
      borderRadius: '8px',
      overflow: 'hidden',
    });
    this.gaugeFill = document.createElement('div');
    css(this.gaugeFill, {
      position: 'absolute',
      left: '0',
      bottom: '0', // 아래에서 위로 차오름
      width: '100%',
      height: '0%',
      background: 'linear-gradient(0deg,#4ade80,#facc15,#ef4444)', // 아래=초록 위=빨강
      boxShadow: '0 0 12px rgba(250,204,21,0.5)',
    });
    gaugeTrack.appendChild(this.gaugeFill);
    powerWrap.appendChild(gaugeTrack);

    // === 스핀 게이지 (파워 위) — Q/E 또는 드래그로 좌/우 훅 설정 ===
    const spinWrap = (this.spinWrap = document.createElement('div'));
    applyPanel(spinWrap, NEON.purple);
    css(spinWrap, {
      position: 'fixed', // 하단 풀폭 스핀바 — 단일 줄로 얇게(공이 위로 보이게)
      bottom: 'calc(10px + env(safe-area-inset-bottom))',
      left: this.coarse ? 'calc(12px + env(safe-area-inset-left))' : '50%',
      right: this.coarse ? 'calc(12px + env(safe-area-inset-right))' : '',
      transform: this.coarse ? '' : 'translateX(-50%)',
      width: this.coarse ? 'auto' : '440px',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '6px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
    });

    // 헤더: "스핀" 라벨 + 현재 수치
    const spinLabel = document.createElement('span');
    spinLabel.textContent = '스핀';
    css(spinLabel, {
      font: FONT_UI,
      fontSize: '10px',
      letterSpacing: '0.12em',
      color: NEON.dim,
      textTransform: 'uppercase',
      flex: '0 0 auto',
    });
    this.spinValue = document.createElement('span');
    css(this.spinValue, {
      font: "700 12px/1 ui-monospace, 'SF Mono', monospace",
      color: NEON.dim,
      flex: '0 0 auto',
      minWidth: '66px',
      textAlign: 'right',
    });

    // 드래그 가능한 트랙 (중앙=0, 좌/우로 차오름).
    // 터치(coarse): 히트영역 44px(투명) + 내부 얇은 시각 바 + 큰 썸 (§3.1). 데스크톱: 10px 바 자체가 시각.
    const TRACK_HIT = this.coarse ? 44 : 10; // 세로 터치 히트영역
    const THUMB = this.coarse ? 28 : 16; // 썸 지름
    const spinTrack = (this.spinTrack = document.createElement('div'));
    css(spinTrack, {
      position: 'relative',
      flex: '1',
      minWidth: '0',
      height: `${TRACK_HIT}px`,
      background: this.coarse ? 'transparent' : 'rgba(255,255,255,0.1)',
      border: this.coarse ? 'none' : `1px solid ${rgba(NEON.purple, 0.25)}`,
      borderRadius: '999px',
      pointerEvents: 'auto',
      cursor: 'ew-resize',
      touchAction: 'none',
    });
    // 터치 모드의 얇은 시각 바 (히트영역과 분리)
    if (this.coarse) {
      const line = document.createElement('div');
      css(line, {
        position: 'absolute',
        left: '0',
        top: '50%',
        marginTop: '-5px',
        width: '100%',
        height: '10px',
        background: 'rgba(255,255,255,0.1)',
        border: `1px solid ${rgba(NEON.purple, 0.25)}`,
        borderRadius: '999px',
      });
      spinTrack.appendChild(line);
    }
    const tick = document.createElement('div'); // 중앙 눈금
    css(tick, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '2px',
      height: '16px',
      marginLeft: '-1px',
      marginTop: '-8px',
      background: rgba(NEON.ice, 0.5),
    });
    this.spinFill = document.createElement('div');
    css(this.spinFill, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0%',
      height: '10px',
      marginTop: '-5px',
      borderRadius: '999px',
    });
    this.spinThumb = document.createElement('div');
    css(this.spinThumb, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${THUMB}px`,
      height: `${THUMB}px`,
      marginLeft: `${-THUMB / 2}px`,
      marginTop: `${-THUMB / 2}px`,
      borderRadius: '50%',
      background: '#fff',
      border: `2px solid ${NEON.purple}`,
      boxShadow: `0 0 8px ${rgba(NEON.purple, 0.8)}`,
    });
    spinTrack.appendChild(this.spinFill);
    spinTrack.appendChild(tick);
    spinTrack.appendChild(this.spinThumb);

    const spinHint = document.createElement('div');
    spinHint.textContent = this.coarse ? '드래그로 좌/우 스핀' : '드래그 또는 Q ◀ ▶ E';
    css(spinHint, {
      font: FONT_UI,
      fontSize: '9px',
      letterSpacing: '0.04em',
      color: rgba(NEON.ice, 0.62),
      textAlign: 'center',
      margin: '4px 0 0',
    });

    spinWrap.appendChild(spinLabel);
    spinWrap.appendChild(spinTrack);
    spinWrap.appendChild(this.spinValue);

    document.body.appendChild(spinWrap); // 하단 풀폭 스핀바
    document.body.appendChild(powerWrap); // 우측 세로 파워바

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
      if (e.pointerType === 'touch') {
        // ⓑ: hover가 없어 누른 채 좌우 드래그로만 조준 — anchor 기준 상대(닿은 위치 편향 제거).
        // 화면폭 절반 드래그 = ±AIM_RANGE (AIM_GAIN=1.0). 부호는 데스크톱 매핑과 동일 방향.
        if (this.charging && e.pointerId === this.activePointerId) {
          const dx = e.clientX - this.anchorX;
          const delta = ((2 * AIM_RANGE) / window.innerWidth) * dx * AIM_GAIN;
          this.aim = Math.max(-AIM_RANGE, Math.min(AIM_RANGE, this.anchorAim - delta));
        }
        return;
      }
      // 마우스: world +x가 화면 왼쪽 → 부호 반전(마우스 방향 = 공 방향). hover로 상시 갱신.
      if (!this.onCanvas(e)) return;
      this.aim = (1 - (e.clientX / window.innerWidth) * 2) * AIM_RANGE;
    });

    window.addEventListener('pointerdown', (e) => {
      // AI 턴(로드맵 P1.5 입력 락)·메뉴에선 차징 불가
      if (!this.onCanvas(e) || this.game.state !== 'AIMING' || !this.game.isHumanTurn()) return;
      // 이미 차징 중인 손가락이 있으면 둘째 손가락은 무시 (멀티터치 오발사·파워 리셋 방지)
      if (this.activePointerId !== null) return;
      this.activePointerId = e.pointerId;
      this.anchorX = e.clientX;
      this.anchorAim = this.aim;
      this.charging = true;
      this.power = 0;
      this.chargeDir = 1;
    });

    window.addEventListener('pointerup', (e) => {
      // 차징 손가락이 아닌 포인터(둘째 손가락·스핀 드래그)는 발사 트리거 금지
      if (e.pointerId !== this.activePointerId) {
        this.draggingSpin = false;
        return;
      }
      this.draggingSpin = false;
      this.activePointerId = null;
      if (!this.charging) return;
      this.charging = false;
      this.game.throwBall(this.aim, this.power, this.spin);
      this.power = 0;
      this.spin = 0;
    });

    // OS 제스처(컨트롤센터 스와이프·전화 수신 등)로 포인터 취소 → 차징/스핀 영구 고착 방지.
    // 발사는 하지 않는다 (의도치 않은 투구 방지).
    window.addEventListener('pointercancel', (e) => {
      this.draggingSpin = false;
      if (e.pointerId === this.activePointerId) {
        this.activePointerId = null;
        this.charging = false;
        this.power = 0;
      }
    });

    // 스핀 바 드래그 (캔버스 차징과 독립 — div 타겟이라 onCanvas=false, activePointerId 미사용)
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

  /** 매 렌더 프레임 (Loop onFrame, dt=프레임 초): 파워 차징 + 조준선/스핀 게이지 갱신 */
  update(dt: number) {
    if (this.charging) {
      this.power += this.chargeDir * CHARGE_RATE * dt;
      if (this.power >= 1) {
        this.power = 1;
        this.chargeDir = -1;
      } else if (this.power <= 0) {
        this.power = 0;
        this.chargeDir = 1;
      }
    }
    this.gaugeFill.style.height = `${this.power * 100}%`;

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
    this.spinWrap.style.display = inGame ? '' : 'none';
    this.powerWrap.style.display = inGame ? '' : 'none';

    const aiming = this.game.state === 'AIMING' && this.game.isHumanTurn();
    // 터치는 hover가 없어 aim이 갱신되지 않으므로, 새 조준 턴 진입 시 정중앙에서 시작 (드리프트 방지)
    if (this.coarse && aiming && !this.wasAiming) this.aim = 0;
    this.wasAiming = aiming;
    this.aimGroup.visible = aiming;
    if (aiming) this.updateAimArrow();
  }

  /**
   * 조준 곡선 라인 갱신 — 실제 발사 물리와 같은 수식으로 예측 경로를 적분(검증 오차 ~1cm)해
   * Line2(외곽선+코어 2겹)로 그린다. 오일 존 직진 → 드라이 존 레이트 훅. Z_CAP까지만, 끝은 페이드.
   */
  private updateAimArrow() {
    const Z_CAP = 10; // 그리는 끝 z — 짧게(끝까지 안 감). 핀 z=18.29. 늘리면 훅이 더 보이나 길어짐.
    const p = this.charging ? this.power : 0.55;
    const speed = (MIN_SPEED + p * (MAX_SPEED - MIN_SPEED)) * this.ball.speedScale;
    const nrm = Math.hypot(this.aim, 1);
    let vx = (this.aim / nrm) * speed;
    let vz = (1 / nrm) * speed;
    let wzR = -vx * ROLL_RATIO + effectiveSpin(this.spin) * SPIN_RATE * BALL_RADIUS; // ωz·R
    const wxR = vz * ROLL_RATIO; // ωx·R
    const inject = (FRICTION_K * REF_MASS * 9.81) / this.ball.massKg;

    // 경로 적분 (발사 물리와 동일 게이트). z가 Z_CAP/핀에 닿으면 종료.
    const path: number[][] = [[0, BALL_START_Z]];
    let x = 0;
    let z = BALL_START_Z;
    for (let i = 0; i < 80 && z < Z_CAP && z < HEADPIN_Z; i++) {
      const slipX = vx + wzR;
      const slipZ = vz - wxR;
      const mag = Math.hypot(slipX, slipZ);
      const hook = hookFactor(z); // 오일 직진 → 드라이 레이트 훅
      if (mag > SLIP_EPS) {
        const laneFric = LANE_FRICTION_OIL + (LANE_FRICTION_DRY - LANE_FRICTION_OIL) * hook;
        const rapier = Math.min(BALL_FRICTION, laneFric) * 9.81;
        const a = inject * hook + rapier;
        vx -= (slipX / mag) * a * PREVIEW_DT;
        vz -= (slipZ / mag) * a * PREVIEW_DT;
        wzR -= (slipX / mag) * rapier * 2.5 * PREVIEW_DT; // 마찰이 회전도 정렬 → 스핀 감쇠
      }
      x += vx * PREVIEW_DT;
      z += vz * PREVIEW_DT;
      path.push([x, z]);
    }
    if (path.length < 2) return;

    const positions: number[] = [];
    for (let i = 0; i < path.length; i++) positions.push(path[i][0], 0.02, path[i][1]);

    // 색: L=시안 / R=앰버 / 0=흰색. 끝으로 갈수록 레인색(tan)으로 페이드 → 레인에 자연스럽게 녹아듦.
    const spinCol = new THREE.Color(this.spin < 0 ? NEON.cyan : this.spin > 0 ? NEON.amber : 0xffffff);
    const tan = new THREE.Color(0xcdb892);
    const dark = new THREE.Color(0x0a0e16);
    const tmp = new THREE.Color();
    const coreColors: number[] = [];
    const caseColors: number[] = [];
    const last = path.length - 1;
    for (let i = 0; i <= last; i++) {
      const fade = Math.min(1, Math.pow(i / last, 1.1) * 1.15); // 중반쯤 레인색에 완전히 녹아 사라짐
      tmp.copy(spinCol).lerp(tan, fade);
      coreColors.push(tmp.r, tmp.g, tmp.b);
      tmp.copy(dark).lerp(tan, fade);
      caseColors.push(tmp.r, tmp.g, tmp.b);
    }
    this.aimCoreGeo.setPositions(positions);
    this.aimCoreGeo.setColors(coreColors);
    this.aimCaseGeo.setPositions(positions);
    this.aimCaseGeo.setColors(caseColors);
    this.aimCoreMat.resolution.set(window.innerWidth, window.innerHeight);
    this.aimCaseMat.resolution.set(window.innerWidth, window.innerHeight);
  }
}
