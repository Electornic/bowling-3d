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
  RELEASE_SWEET_LO,
  RELEASE_SWEET_HI,
  RELEASE_SIGMA_MIN,
  RELEASE_SIGMA_MAX,
  RELEASE_TOL,
} from '../game/constants';
import { hookFactor, oilEndZ } from '../game/oil';
import { css, NEON, FONT_UI, rgba, ensureNeonStyles, applyPanel } from '../ui/theme';

const PREVIEW_DT = 0.08; // 예측 경로 적분 스텝 (s)
// 파워 차징 속도(단위 /초). 기존엔 프레임당 +0.018(프레임레이트 의존 — 고주사율/저FPS에서 속도가
// 달라지는 버그)이었다. ×60fps = 1.08/s로 환산해 dt를 곱하면 어떤 FPS에서도 0→1 약 0.93초로 일정.
const CHARGE_RATE = 1.08;
// 스트라이크 최적 파워 존(흐리게 암시 — UI_REVAMP.md 결정②). carry sim상 윈도우는 "풀파워 근방"이나
// 풀스핀은 미드파워가 더 휘어 *정확한* 최적은 플레이별로 갈림 → 넓고 은은한 상단~중상 띠로만 힌트.
// 꼭대기(=최대)는 직진 과속이라 살짝 못 미치게 둔다. 정밀 조준은 실력에 맡김(난이도 보존).
// 시각 골드 띠 = 릴리스 타이밍 '정확 구간'과 동일하게 constants에서 공용(P3) — 띠 안에서 떼면 정확.
const POWER_SWEET_LO = RELEASE_SWEET_LO;
const POWER_SWEET_HI = RELEASE_SWEET_HI;

// 릴리스 타이밍(P3): aim↔진입x 변환 거리 (ai.ts ENTRY_DIST와 동일). 노이즈를 진입x cm로 환산.
const ENTRY_DIST = HEADPIN_Z - BALL_START_Z; // ≈19.29
/** 표준정규 난수 (Box-Muller) — 릴리스 타이밍 실행 노이즈용 (ai.ts gauss와 동일). */
function gauss(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

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
  private readonly aimEndMarker: THREE.Mesh;
  private readonly aimEndMat: THREE.MeshBasicMaterial;
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
    // 끝점 타깃 링 (UI_REVAMP 결정③: 짧은 끝점만 — z=Z_CAP 도달점 방향만, 훅 최종 포켓은 숨김).
    // 라인이 끝에서 페이드돼도 스핀색 링이 "여기로 간다"를 또렷이 앵커한다.
    this.aimEndMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.aimEndMarker = new THREE.Mesh(new THREE.RingGeometry(0.05, 0.09, 28), this.aimEndMat);
    this.aimEndMarker.rotation.x = -Math.PI / 2; // 레인 바닥에 눕힘
    this.aimEndMarker.renderOrder = 7;
    this.aimEndMarker.frustumCulled = false;
    this.aimGroup.add(this.aimEndMarker);
    this.aimGroup.visible = false;
    engine.scene.add(this.aimGroup);

    // 하단 도크 통합(UI_REVAMP P2): 스핀=좌하단 컴팩트 · 파워=우하단 세로, 같은 글래스+시안 액센트로 한 쌍.
    // 가운데를 비워 공·조준 화살표(바나나 곡선) 밑동이 그대로 보이게 한다(공 가림 해소, 진단④).

    // === 파워 게이지 (우측 하단 — 중앙은 공과 겹침) ===
    const powerWrap = (this.powerWrap = document.createElement('div'));
    applyPanel(powerWrap, NEON.cyan);
    css(powerWrap, {
      position: 'fixed', // 우측 세로 파워바 (가운데 레인을 비움)
      bottom: 'calc(10px + env(safe-area-inset-bottom))', // 스핀과 같은 베이스라인 (스핀이 더는 풀폭이 아님)
      right: this.coarse
        ? 'calc(var(--col-edge, 0px) + 10px + env(safe-area-inset-right))'
        : 'calc(var(--col-edge, 0px) + 24px + env(safe-area-inset-right))',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '10px 8px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '6px',
    });
    // ⚡ 아이콘 — 세로 게이지 위. 이전엔 "POWER" 텍스트가 바(14px)보다 넓어 패널이 불균형해 뺐는데,
    // 아이콘 1자는 바 폭과 비슷해 균형 유지 + "이게 파워"임을 한눈에 (빈 캡슐 문제 해소, UI_REVAMP 진단①).
    const powerIcon = document.createElement('div');
    powerIcon.textContent = '⚡';
    css(powerIcon, {
      fontSize: '13px',
      lineHeight: '1',
      opacity: '0.9',
      filter: `drop-shadow(0 0 4px ${rgba(NEON.cyan, 0.6)})`,
    });
    powerWrap.appendChild(powerIcon);

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
    // 최적 파워 존(흐리게 암시) — 은은한 골드 띠 + 진입 하단 경계선만. 정확 눈금은 의도적으로 없음.
    const zoneBand = document.createElement('div');
    css(zoneBand, {
      position: 'absolute',
      left: '0',
      bottom: `${POWER_SWEET_LO * 100}%`,
      width: '100%',
      height: `${(POWER_SWEET_HI - POWER_SWEET_LO) * 100}%`,
      background: rgba(NEON.gold, 0.13),
    });
    const zoneLine = document.createElement('div'); // 존 진입 경계 (은은한 골드 글로우 라인)
    css(zoneLine, {
      position: 'absolute',
      left: '-1px',
      right: '-1px',
      bottom: `${POWER_SWEET_LO * 100}%`,
      height: '1.5px',
      background: rgba(NEON.gold, 0.5),
      boxShadow: `0 0 6px ${rgba(NEON.gold, 0.45)}`,
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
    gaugeTrack.appendChild(zoneBand); // 뒤: 존 띠
    gaugeTrack.appendChild(this.gaugeFill); // 중간: 차오르는 채움
    gaugeTrack.appendChild(zoneLine); // 앞: 경계선(채움 위로도 보이게)
    powerWrap.appendChild(gaugeTrack);

    // === 스핀 게이지 (파워 위) — Q/E 또는 드래그로 좌/우 훅 설정 ===
    const spinWrap = (this.spinWrap = document.createElement('div'));
    applyPanel(spinWrap, NEON.cyan); // 파워와 동일 액센트로 통일 (입력 쌍)
    css(spinWrap, {
      position: 'fixed', // 좌하단 컴팩트 — 풀폭 폐기(공·조준선 밑동 가림). 2단: 헤더(라벨+값) / 트랙.
      bottom: 'calc(10px + env(safe-area-inset-bottom))',
      left: this.coarse
        ? 'calc(var(--col-edge, 0px) + 12px + env(safe-area-inset-left))'
        : 'calc(var(--col-edge, 0px) + 24px + env(safe-area-inset-left))',
      width: this.coarse ? 'min(46vw, 280px)' : '300px',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '8px 12px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
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
      border: this.coarse ? 'none' : `1px solid ${rgba(NEON.cyan, 0.25)}`,
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
        border: `1px solid ${rgba(NEON.cyan, 0.25)}`,
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
      border: `2px solid ${NEON.ice}`,
      boxShadow: `0 0 8px ${rgba(NEON.ice, 0.8)}`,
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

    const spinHeader = document.createElement('div'); // 2단 상단: 라벨 ↔ 현재 수치
    css(spinHeader, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    spinHeader.appendChild(spinLabel);
    spinHeader.appendChild(this.spinValue);

    spinWrap.appendChild(spinHeader);
    spinWrap.appendChild(spinTrack);

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
      // AI 턴(로드맵 P1.5 입력 락)·메뉴·핸드오프(교대전)에선 차징 불가
      if (!this.onCanvas(e) || this.game.state !== 'AIMING' || !this.game.isHumanTurn() || this.game.inputLocked) return;
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
      // 릴리스 타이밍(P3): 골드 띠 안에서 떼면 정확, 벗어날수록 진입x에 gaussian 노이즈(σ cm).
      // **플레이어 전용** — AI는 이 경로를 안 거친다(computeAiThrow 자체 jitter). aim에만 더함(파워/스핀 보존).
      const sigmaCm = this.releaseSigma(this.power);
      const aimNoise = sigmaCm > 0 ? (gauss() * sigmaCm) / 100 / ENTRY_DIST : 0;
      this.game.throwBall(this.aim + aimNoise, this.power, this.spin);
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
      if (this.game.state !== 'AIMING' || !this.game.isHumanTurn() || this.game.inputLocked) return;
      this.draggingSpin = true;
      this.setSpinFromPointer(e.clientX);
      e.preventDefault();
    });
    window.addEventListener('keydown', (e) => {
      if (this.game.state !== 'AIMING' || !this.game.isHumanTurn() || this.game.inputLocked) return;
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
    this.spinThumb.style.borderColor = s === 0 ? NEON.ice : dirColor;
    this.spinThumb.style.boxShadow = `0 0 8px ${rgba(s === 0 ? NEON.ice : dirColor, 0.85)}`;
    if (s === 0) {
      this.spinValue.textContent = '0';
      this.spinValue.style.color = NEON.dim;
    } else {
      this.spinValue.textContent = s < 0 ? `◀ L ${Math.abs(s).toFixed(1)}` : `R ${s.toFixed(1)} ▶`;
      this.spinValue.style.color = dirColor;
    }

    // 메뉴/AI 턴/핸드오프(교대전)엔 입력 UI 전체 숨김 (로드맵 P1/P1.5/P4)
    const inGame = this.game.state !== 'MENU' && this.game.isHumanTurn() && !this.game.inputLocked;
    this.spinWrap.style.display = inGame ? '' : 'none';
    this.powerWrap.style.display = inGame ? '' : 'none';

    const aiming = this.game.state === 'AIMING' && this.game.isHumanTurn() && !this.game.inputLocked;
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
    // 곡률 보존 압축: REF_Z까지의 훅 곡선을 적분해 '모양'을 확보한 뒤, 시작점 기준 k배로 비례 축소해
    // DRAW_Z 길이에 욱여넣는다. 짧게 그려도(DRAW_Z) 긴 거리(REF_Z)의 곡률이 그대로 보임(축소판 바나나).
    // 그냥 DRAW_Z까지만 적분하면 그 구간이 오일존(직진)이라 곡률이 거의 안 보였음. 균일 스케일이라 초기
    // 조준 방향(각도)은 불변. 조준선은 차징(파워 핑퐁)에 안 흔들리게 대표 파워로 고정(파워 체감은 게이지).
    const REF_Z = 14; // 곡률 기준 길이 — 드라이존(오일 끝 뒤) 훅까지 포함해 더 휜 모양을 5에 압축
    const DRAW_Z = 5; // 실제 그리는 길이 (짧게)
    const p = 0.6;
    // 조준 보조(P3): easy=풀 곡선(REF_Z까지) / normal=오일 존 끝까지만(직진 구간만, 훅 숨김) / pro=짧은 방향 표식.
    // normal/pro 종료점은 오일 존 안(hook=0)이라 곡선이 안 생겨 "스키드만 보여주고 훅은 직접 읽어라"가 된다.
    const aid = this.game.aimAid;
    const endZ = aid === 'easy' ? REF_Z : aid === 'normal' ? oilEndZ() : BALL_START_Z + 4;
    const speed = (MIN_SPEED + p * (MAX_SPEED - MIN_SPEED)) * this.ball.speedScale;
    const nrm = Math.hypot(this.aim, 1);
    let vx = (this.aim / nrm) * speed;
    let vz = (1 / nrm) * speed;
    let wzR = -vx * ROLL_RATIO + effectiveSpin(this.spin) * SPIN_RATE * this.ball.radius; // ωz·R (덕핀 #5: 작은 공 반경 반영)
    const wxR = vz * ROLL_RATIO; // ωx·R
    const inject = (FRICTION_K * REF_MASS * 9.81) / this.ball.massKg;

    // 경로 적분 (발사 물리와 동일 게이트). z가 Z_CAP/핀에 닿으면 종료.
    const path: number[][] = [[0, BALL_START_Z]];
    let x = 0;
    let z = BALL_START_Z;
    for (let i = 0; i < 80 && z < endZ && z < HEADPIN_Z; i++) {
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
    // 마지막 점을 정확히 endZ(파워 비례 길이)에 트림 — 적분 스텝(풀파워 ~0.96m) 단위로 끝점이 튀던 "버벅"
    // 제거. endZ가 파워의 연속 함수라 끝점이 매끄럽게 전진/후퇴한다(스텝 스냅 없음).
    if (path.length >= 2) {
      const a = path[path.length - 2];
      const b = path[path.length - 1];
      if (b[1] > endZ && b[1] !== a[1]) {
        const t = (endZ - a[1]) / (b[1] - a[1]);
        b[0] = a[0] + (b[0] - a[0]) * t;
        b[1] = endZ;
      }
    }
    if (path.length < 2) return;

    // REF_Z 곡선을 DRAW_Z로 비례 축소 (시작점 기준 균일 스케일 k)
    const k = (DRAW_Z - BALL_START_Z) / (REF_Z - BALL_START_Z);
    const sz = (z0: number) => BALL_START_Z + (z0 - BALL_START_Z) * k;
    const positions: number[] = [];
    for (let i = 0; i < path.length; i++) positions.push(path[i][0] * k, 0.02, sz(path[i][1]));

    // 색: L=시안 / R=앰버 / 0=흰색. 끝으로 갈수록 레인색(tan)으로 페이드 → 레인에 자연스럽게 녹아듦.
    const spinCol = new THREE.Color(this.spin < 0 ? NEON.cyan : this.spin > 0 ? NEON.amber : 0xffffff);
    const tan = new THREE.Color(0xcdb892);
    const dark = new THREE.Color(0x0a0e16);
    const tmp = new THREE.Color();
    const coreColors: number[] = [];
    const caseColors: number[] = [];
    const last = path.length - 1;
    for (let i = 0; i <= last; i++) {
      const fade = Math.min(0.82, Math.pow(i / last, 2.0)); // 대부분 또렷, 끝만 살짝 페이드(중립 흰색 가독성↑)
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

    // 끝점 링: 경로 끝(방향 도달점)에 스핀색으로 또렷하게 — 페이드된 라인 끝을 재앵커
    const end = path[last];
    this.aimEndMarker.position.set(end[0] * k, 0.021, sz(end[1]));
    this.aimEndMat.color.copy(spinCol);
  }

  /**
   * 릴리스 타이밍 → aim 실행 노이즈 σ(cm) (P3). 골드 띠 [LO,HI] 안=정확(σ_MIN), 밖으로 멀수록 σ_MAX까지 선형.
   * 노이즈 단위는 진입 x cm — AI aimJitterCm와 동일 모델이라 사람·AI 분산이 같은 척도다.
   */
  private releaseSigma(power: number): number {
    const dist =
      power < POWER_SWEET_LO ? POWER_SWEET_LO - power : power > POWER_SWEET_HI ? power - POWER_SWEET_HI : 0;
    const t = Math.min(1, dist / RELEASE_TOL);
    return RELEASE_SIGMA_MIN + (RELEASE_SIGMA_MAX - RELEASE_SIGMA_MIN) * t;
  }
}
