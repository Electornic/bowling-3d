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
  RELEASE_SWEET_LO,
  RELEASE_SWEET_HI,
  RELEASE_SIGMA_MIN,
  RELEASE_SIGMA_MAX,
  RELEASE_TOL,
} from '../game/constants';
import { hookFactor, oilEndZ } from '../game/oil';
import { gauss, ENTRY_DIST } from '../game/ai'; // 릴리스 타이밍 노이즈(#9) — ai와 동일 구현 단일소스 공유
import { css, NEON, FONT_UI, rgba, ensureNeonStyles, applyPanel } from '../ui/theme';

const PREVIEW_DT = 0.08; // 예측 경로 적분 스텝 (s)

// 조준선 색 — 매 재빌드마다 THREE.Color를 새로 할당하던 것을 모듈 스크래치로 재사용(무할당, #1).
// tan/dark는 불변 상수, spinCol은 스핀 따라 .set()으로 갱신, tmp는 lerp 스크래치.
const AIM_TAN = new THREE.Color(0xcdb892); // 레인색(끝 페이드 타겟)
const AIM_DARK = new THREE.Color(0x0a0e16); // 외곽선 어두운색
const AIM_SPIN_COL = new THREE.Color(); // 스핀색 스크래치(중립→방향색, |spin| 비례)
const AIM_DIR_COL = new THREE.Color(); // 방향색 스크래치(L=시안 / R=앰버) — 선·화살촉이 공유
const AIM_TMP_COL = new THREE.Color(); // lerp 스크래치
// 스핀 크기 = 조준선 색 농도. 예전엔 방향만 아는 하드 스위치라 0.3과 1.0이 화면상 같아 보였고,
// 카메라를 near로 당긴 뒤로는 곡률로도 구분이 안 됐다(최대 스핀도 조준 화면에선 거의 직선).
// 바닥값 — 0에서 곧장 올라가면 약한 스핀(0.1)이 흰색에 묻혀 '방향 없음'으로 읽힌다. 0.3부터 시작해
// 있다/없다는 항상 보이게 하고, 그 위를 크기에 비례시킨다.
const SPIN_TINT_FLOOR = 0.22;
// 데스크톱 스핀 HUD 노출 시간(초). 값이 바뀐 뒤 이만큼만 떠 있다 사라진다.
const SPIN_HUD_HOLD = 1.4;
// 스핀 해상도 — 한쪽 20단계. 값 공간 전체(휠·드래그)가 이 배수만 갖는다.
const SPIN_STEP = 0.05;
// 휠 레이트 리밋(ms). 부호만 쓰는 구현이라 이벤트 1개 = 1스텝인데, 트랙패드 관성은 이벤트를 수백 개
// 뿜어서 한 번 튕기면 값이 끝까지 날아갔다(원하는 값에 못 멈춤). 시간으로 막으면 1초에 최대 ~16스텝이라
// 관성이 아무리 뿜어도 그 위로 못 올라가고, 디텐트 마우스는 원래 이보다 느려 영향을 안 받는다 —
// 두 기기가 같은 속도로 수렴한다. deltaY 크기가 아니라 시간을 재는 게 핵심(트랙패드 delta는 못 믿는다).
const SPIN_WHEEL_MIN_MS = 60;
// 중립색(스핀 0)을 흰색에서 흐린 청회색으로 내렸다. 흰색 기준이면 앰버(#ffd86b)가 흰색 바로 옆이라
// 그 사이를 아무리 나눠도 0.3과 1.0이 구분이 안 된다(실측: 둘 다 거의 흰색). 중립을 낮추면 크기가
// 채도뿐 아니라 **밝기**로도 표현돼 폭이 넓어진다 — 스핀 0은 차분한 가이드, 풀스핀은 형광 네온.
const AIM_NEUTRAL = 0xa8b2c8;
const AIM_TIP = new THREE.Vector3(); // 조준선 끝점 월드좌표 스크래치 — 링 위치·카메라 거리(무할당)
// 끝 마감: 조준선 폴리라인(Line2) 끝에 같은 획(core+case)으로 화살촉(∧)을 이어 붙인다 — 별도 마커/오브젝트가
// 아니라 라인 지오메트리의 일부라 항상 선과 한 몸으로 자연스럽게 이어진다. 화살촉은 끝 접선(실제 진행 방향,
// 훅 포함) 을 가리켜 "여기로 이렇게 굴러간다"를 함께 표현. 끝은 페이드 없이 또렷한 네온(우훅=앰버/그외=시안·아이스).
const ARROW_PX = 0.03; // [튜닝] 화살촉 팔 길이 = 이 값 × 카메라거리(m). 거리 비례라 멀어도 화면상 크기 유지
const ARROW_MIN = 0.13; // [튜닝] 팔 길이 하한(월드 m)
const ARROW_MAX = 0.3; // [튜닝] 팔 길이 상한(월드 m)
const ARROW_HALF = 0.5; // [튜닝] 화살촉 반각(rad, ≈29°) — 작을수록 뾰족/슬림
// 끝 페이드(C) — 중간은 레인색으로 녹이되 화살촉 직전 되살려 '떠 보임' 제거.
const FADE_MAX = 0.82; // [튜닝] 최대 페이드(레인색 혼합) — 중간부 소멸 강도
const FADE_PEAK = 0.8; // [튜닝] 페이드가 최대가 되는 지점(0~1). 이후 화살촉 향해 하강
const FADE_RECOVER = 0.72; // [튜닝] 끝에서 페이드 되돌리는 비율 — 화살촉 연결 또렷도(1=완전 복원)
// 파워 차징 속도(단위 /초). 기존엔 프레임당 +0.018(프레임레이트 의존 — 고주사율/저FPS에서 속도가
// 달라지는 버그)이었다. ×60fps = 1.08/s로 환산해 dt를 곱하면 어떤 FPS에서도 0→1 약 0.93초로 일정.
const CHARGE_RATE = 1.08;
// 스트라이크 최적 파워 존(흐리게 암시 — UI_REVAMP.md 결정②). carry sim상 윈도우는 "풀파워 근방"이나
// 풀스핀은 미드파워가 더 휘어 *정확한* 최적은 플레이별로 갈림 → 넓고 은은한 상단~중상 띠로만 힌트.
// 꼭대기(=최대)는 직진 과속이라 살짝 못 미치게 둔다. 정밀 조준은 실력에 맡김(난이도 보존).
// 시각 골드 띠 = 릴리스 타이밍 '정확 구간'과 동일하게 constants에서 공용(P3) — 띠 안에서 떼면 정확.
const POWER_SWEET_LO = RELEASE_SWEET_LO;
const POWER_SWEET_HI = RELEASE_SWEET_HI;

// 릴리스 타이밍(P3) 노이즈용 gauss()·ENTRY_DIST(aim↔진입x 변환 거리)는 ai.ts에서 import(#9) — 예전엔 여기 복제였다.

/**
 * 포인터(마우스+터치) + 키보드 입력 추상화 (도안 §8 / MOBILE_SUPPORT.md §2).
 * - 마우스: X → 조준(aim) hover 상시 갱신, 누르고 있으면 파워 핑퐁 차징, 떼면 발사.
 * - 터치(ⓑ): hover가 없어 **누른 채 좌우 드래그**로 조준(anchor 기준 상대), 동시에 파워 핑퐁
 *   차징, 떼면 발사. `isPrimary`/`pointerId`로 단일 포인터만 차징, `pointercancel`로 고착 방지.
 * - 스핀: 데스크톱은 **휠**(레이트 리밋 + SPIN_STEP), 터치는 하단 스핀 바 **드래그**(좌=훅L, 우=훅R).
 *   터치 환경에선 스핀 바 히트영역·썸을 키운다(§3.1).
 * UI 요소(슬라이더 등) 위 포인터는 무시(canvas 타겟만 차징/조준).
 */
export class Controls {
  private aim = 0;
  private spin = 0;
  private power = 0;
  private charging = false;

  /**
   * 파워 차징 중 = 플레이어가 **스탠스에 들어서 던지는 중**.
   * 옆 레인 lane courtesy 창을 정하는 데 쓴다(Boot). game.state는 AIMING 하나로 '고민 중'과
   * '던지는 중'을 구분할 수 없어서 — 조준은 시간 제한이 없으므로 그걸로 홀드하면 인접 레인이
   * 영구 대기가 된다.
   */
  get isCharging(): boolean {
    return this.charging;
  }
  private chargeDir = 1;
  private draggingSpin = false;
  private wasAiming = false;
  // 데스크톱 스핀 HUD 트랜지언트 — 남은 노출 시간(초)과 직전 프레임 스핀값
  private spinHudT = 0;
  private lastSpinShown = 0;
  private lastWheelMs = 0; // 휠 레이트 리밋 타임스탬프
  // 조준선 재빌드 캐시 키(#1) — 입력(조준·스핀·보조·오일끝·볼물성) 불변이면 재적분·재업로드 스킵.
  private lastAimKey = '';

  // 터치 ⓑ — 상대 조준 anchor + 단일 포인터 추적 (멀티터치 오발사·pointercancel 고착 방지)
  private readonly coarse = isCoarsePointer();
  /**
   * 휠을 **실제로 본 적 있는가.** 스핀 바 노출의 기준은 "터치냐"가 아니라 "휠이 있느냐"다 —
   * 휠 없는 마우스나 태블릿에선 바가 유일한 스핀 입력이므로 숨으면 입력이 사라진다.
   * ⚠️ 휠 존재는 **사전 감지가 불가능하다**(`matchMedia('(wheel)')` 같은 건 없다). wheel 이벤트가
   * 올 때만 알 수 있으므로 **바를 기본으로 두고 휠이 나타나면 강등**한다(fail-safe 방향).
   */
  private wheelSeen = false;
  private spinHint!: HTMLDivElement;
  private activePointerId: number | null = null;
  private anchorX = 0;
  private anchorAim = 0;

  private readonly aimGroup: THREE.Group;
  private readonly aimCoreGeo: LineGeometry;
  private readonly aimCaseGeo: LineGeometry;
  private readonly aimCoreMat: LineMaterial;
  private readonly aimCaseMat: LineMaterial;
  private readonly camera: THREE.PerspectiveCamera; // 화살촉 팔 길이를 카메라 거리에 비례시킬 때 사용
  private readonly powerWrap: HTMLDivElement;
  private readonly gaugeFill: HTMLDivElement;
  private readonly spinWrap: HTMLDivElement;
  private readonly spinTrack: HTMLDivElement;
  private readonly spinFill: HTMLDivElement;
  private readonly spinThumb: HTMLDivElement;

  constructor(
    engine: Engine, // aimGroup을 씬에 추가 + 카메라 참조 저장(화살촉 거리 스케일 A)에 사용
    private readonly game: GameState,
    private readonly ball: Ball,
  ) {
    ensureNeonStyles();
    this.camera = engine.camera; // 화살촉 거리 스케일(A) — updateAimArrow의 tip↔카메라 거리

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
    // 끝 화살촉(∧)은 별도 메시가 아니라 updateAimArrow에서 조준선 폴리라인(Line2) 끝에 stroke로 이어 붙인다.
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

    // === 스핀 게이지 (파워 위) — 휠(데스크톱) 또는 드래그(터치)로 좌/우 훅 설정 ===
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
      // **휠을 보기 전까진 상시 노출** — 그때까진 이 바가 유일한 스핀 입력일 수 있다(태블릿·휠 없는
      // 마우스). 첫 wheel 이벤트에서 트랜지언트로 강등된다(demoteSpinBarToIndicator).
      opacity: '1',
      transition: 'opacity 0.28s ease',
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
      // 데스크톱은 휠이 입력을 담당하고 바는 표시기 — 숨겨진 상태로 클릭되면 사고라 아예 끈다.
      pointerEvents: 'auto', // 휠 강등 시 none으로 바뀐다 — 그전까진 드래그가 유일한 입력일 수 있다
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

    const spinHint = (this.spinHint = document.createElement('div'));
    spinHint.textContent = '드래그로 좌/우 스핀'; // 휠을 보면 '휠 ◀ ▶'로 바뀐다
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

    spinWrap.appendChild(spinHeader);
    spinWrap.appendChild(spinTrack);

    document.body.appendChild(spinWrap); // 하단 풀폭 스핀바
    document.body.appendChild(powerWrap); // 우측 세로 파워바

    this.bindEvents();
  }

  private onCanvas(e: Event): boolean {
    return (e.target as HTMLElement)?.tagName === 'CANVAS';
  }

  /** 스핀 바 위 포인터 x → spin ∈ [-1,1] (SPIN_STEP 단위 — 휠과 같은 값 공간) */
  /**
   * 휠을 처음 본 순간 — 스핀 바를 **주 입력에서 표시기로 강등**한다.
   *
   * 터치(coarse)는 강등하지 않는다: 휠이 붙어 있어도(태블릿+트랙패드) 손가락 드래그가 여전히
   * 자연스러운 주 입력이고, 바를 숨기면 터치 사용자가 스핀을 못 만진다.
   * 데스크톱만 강등해서 기존 확정 동작(휠이 주 조작 · 바는 정밀 확인용 트랜지언트)으로 복귀한다.
   */
  private noteWheelSeen() {
    if (this.wheelSeen) return;
    this.wheelSeen = true;
    if (this.coarse) return;
    this.spinHint.textContent = '휠 ◀ ▶';
    this.spinTrack.style.pointerEvents = 'none';
    // opacity는 update()의 트랜지언트 로직이 이어받는다(wheelSeen 게이트가 이제 열렸다).
  }

  private setSpinFromPointer(clientX: number) {
    const r = this.spinTrack.getBoundingClientRect();
    const ratio = (clientX - r.left) / r.width; // 0..1
    const s = Math.max(-1, Math.min(1, ratio * 2 - 1));
    this.spin = Math.round(s / SPIN_STEP) * SPIN_STEP;
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
      // AI 턴(로드맵 P1.5 입력 락)·메뉴·**핀세터 가동 중**엔 차징 불가 (game.readyToThrow)
      if (!this.onCanvas(e) || !this.game.readyToThrow || !this.game.isHumanTurn()) return;
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
      if (!this.game.readyToThrow || !this.game.isHumanTurn()) return;
      this.draggingSpin = true;
      this.setSpinFromPointer(e.clientX);
      e.preventDefault();
    });
    // 휠 = 스핀 (데스크톱 주 조작). 조준은 마우스 X, 파워는 버튼이라 마우스가 이미 두 축을 쓴다.
    // 스핀 바로 손을 옮기면 캔버스 복귀 시 조준이 그 자리로 튀어 "스핀→조준" 순서가 강제됐다.
    // 휠은 커서를 안 움직이는 유일한 축 — 조준을 유지한 채, 차징 중에도 스핀만 바꿀 수 있다.
    // 트랙패드 관성 스크롤은 deltaY가 폭주하므로 크기를 버리고 부호만 쓴다(1노치 = 0.1, 드래그와 동해상도).
    window.addEventListener(
      'wheel',
      (e) => {
        // ⚠️ 아래 early-return **앞에서** 표시한다 — 휠 이벤트가 왔다는 사실 자체가 "휠이 있다"는
        //    증거이고, 조준 중이 아니거나 바 위에서 굴렸을 때도 그 증거는 유효하다.
        this.noteWheelSeen();
        if (!this.game.readyToThrow || !this.game.isHumanTurn()) return;
        if (!this.onCanvas(e)) return; // 스핀 바 위에선 드래그가 담당
        const now = performance.now();
        if (now - this.lastWheelMs < SPIN_WHEEL_MIN_MS) {
          e.preventDefault(); // 리밋에 걸린 이벤트도 스크롤은 막는다
          return;
        }
        this.lastWheelMs = now;
        const step = Math.sign(e.deltaY) * SPIN_STEP; // 아래 = 오른쪽 훅(R) · 위 = 왼쪽 훅(L)
        this.spin = Math.max(-1, Math.min(1, Math.round((this.spin + step) * 100) / 100));
        e.preventDefault();
      },
      { passive: false }, // 기본 스크롤 차단 (body가 overflow:hidden이라 실효는 없지만 명시)
    );
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
    // 데스크톱 트랜지언트 노출: 값이 바뀐 뒤 SPIN_HUD_HOLD 동안만 띄운다. 발사 직후 throwBall이
    // spin을 0으로 리셋하며 값이 '변하는' 것도 노출로 세지 않도록 조준 중일 때만 타이머를 건다.
    // lastSpinShown은 매 프레임 갱신 — 안 그러면 리셋된 0이 다음 조준 턴에서 변화로 잡힌다.
    if (!this.coarse && this.wheelSeen) {
      const aimingNow = this.game.readyToThrow && this.game.isHumanTurn();
      if (s !== this.lastSpinShown && aimingNow) this.spinHudT = SPIN_HUD_HOLD;
      this.lastSpinShown = s;
      if (this.spinHudT > 0) this.spinHudT = Math.max(0, this.spinHudT - dt);
      this.spinWrap.style.opacity = this.spinHudT > 0 ? '1' : '0';
    }


    // 메뉴/AI 턴엔 입력 UI 전체 숨김 (로드맵 P1/P1.5)
    const inGame = this.game.state !== 'MENU' && this.game.isHumanTurn();
    this.spinWrap.style.display = inGame ? '' : 'none';
    this.powerWrap.style.display = inGame ? '' : 'none';

    const aiming = this.game.readyToThrow && this.game.isHumanTurn();
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
    const DRAW_Z = 5; // 실제 그리는 온스크린 길이(압축 후). 게임플레이 도움량은 aid별 endZ가 결정 — 이건 시각 길이만.
    const p = 0.6;
    // 조준 난이도(P3): easy=풀 곡선(REF_Z까지) / normal=오일 존 끝까지만(직진 구간만, 훅 숨김) / hard=짧은 방향 표식.
    // normal/pro 종료점은 오일 존 안(hook=0)이라 곡선이 안 생겨 "스키드만 보여주고 훅은 직접 읽어라"가 된다.
    const aid = this.game.aimAid;
    const endZ = aid === 'easy' ? REF_Z : aid === 'normal' ? oilEndZ() : BALL_START_Z + 4;
    // 캐시 가드(#1): 조준·스핀·보조·오일끝·볼물성이 그대로면 재적분·배열재빌드·버퍼 재업로드를 통째 스킵.
    // oilEndZ()는 aid와 별개로 반드시 키에 — hookFactor(z)가 모든 aid에서 오일 endZ에 의존(마름 반영).
    // 볼물성(speedScale/massKg)도 필수 — speed/inject가 의존하고 setSpec()은 조준 중 호출되는 정상 경로.
    // resolution만 리사이즈 대응차 매 프레임 갱신하고 종료(가벼운 uniform 쓰기).
    const key = `${this.aim}|${this.spin}|${aid}|${oilEndZ()}|${this.ball.massKg}|${this.ball.speedScale}`;
    if (key === this.lastAimKey) {
      this.aimCoreMat.resolution.set(window.innerWidth, window.innerHeight);
      this.aimCaseMat.resolution.set(window.innerWidth, window.innerHeight);
      return;
    }
    this.lastAimKey = key;
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

    // 색: 중립(청회색)에서 방향색(L=시안 / R=앰버)으로 |spin| 비례 lerp — 방향뿐 아니라 **크기**까지 화면
    // 중앙에서 읽힌다(휠로 조준 중 스핀을 굴리게 되면서 필요해진 정보). 끝으로 갈수록 레인색(tan)으로
    // 페이드 → 레인에 자연스럽게 녹아듦. 모듈 스크래치 재사용(무할당) — tan/dark 불변, tmp는 lerp용.
    const spinMag = Math.abs(this.spin);
    const spinT = spinMag > 0 ? SPIN_TINT_FLOOR + (1 - SPIN_TINT_FLOOR) * spinMag : 0;
    const dirCol = AIM_DIR_COL.set(this.spin < 0 ? NEON.cyan : NEON.amber); // 화살촉과 공유
    const spinCol = AIM_SPIN_COL.set(AIM_NEUTRAL).lerp(dirCol, spinT);
    const tan = AIM_TAN;
    const dark = AIM_DARK;
    const tmp = AIM_TMP_COL;
    const coreColors: number[] = [];
    const caseColors: number[] = [];
    const last = path.length - 1;
    for (let i = 0; i <= last; i++) {
      // C: 중간은 레인색으로 녹이되(자연 소멸) 끝 화살촉 직전에선 페이드를 되돌려 또렷하게 — 화살촉이
      // 선에서 떨어져 '떠 보이던' 문제 제거. 오르막(제곱) 후 FADE_PEAK 지나 하강.
      const t = i / last;
      const rise = Math.pow(Math.min(t / FADE_PEAK, 1), 2.0);
      const settle = t > FADE_PEAK ? (t - FADE_PEAK) / (1 - FADE_PEAK) : 0;
      const fade = FADE_MAX * rise * (1 - FADE_RECOVER * settle);
      tmp.copy(spinCol).lerp(tan, fade);
      coreColors.push(tmp.r, tmp.g, tmp.b);
      tmp.copy(dark).lerp(tan, fade);
      caseColors.push(tmp.r, tmp.g, tmp.b);
    }
    // 끝 화살촉: 가이드라인과 같은 stroke(core+case)로 슬림한 ∧ 를 폴리라인에 이어 붙인다. 팁=마지막 점,
    // 거기서 뒤쪽 좌우로 두 갈래(진행 방향의 반대). 팔 길이는 카메라 거리 비례라 멀어도 화면상 크기 일정.
    const ex = positions[positions.length - 3]; // path[last].x * k
    const ez = positions[positions.length - 1]; // sz(path[last].z)
    let dx = ex - path[last - 1][0] * k;
    let dz = ez - sz(path[last - 1][1]);
    const dm = Math.hypot(dx, dz) || 1;
    dx /= dm;
    dz /= dm; // 진행 방향 단위벡터(끝 접선 — 훅 곡률 반영)
    const camDist = this.camera.position.distanceTo(AIM_TIP.set(ex, 0.02, ez));
    const AL = Math.min(ARROW_MAX, Math.max(ARROW_MIN, ARROW_PX * camDist)); // 팔 길이(월드 m) — 거리 비례
    const ca = Math.cos(ARROW_HALF);
    const sa = Math.sin(ARROW_HALF);
    const bx = -dx;
    const bz = -dz; // 뒤 방향
    positions.push(
      ex + (bx * ca - bz * sa) * AL, 0.02, ez + (bx * sa + bz * ca) * AL, // 좌 갈래
      ex, 0.02, ez, // 팁으로 복귀(겹침)
      ex + (bx * ca + bz * sa) * AL, 0.02, ez + (-bx * sa + bz * ca) * AL, // 우 갈래
    );
    // 끝을 또렷하게: 팁 vertex + 화살촉 3점을 페이드 없는 네온으로, case는 어두운 외곽으로 고정 —
    // 끝이 레인색에 녹지 않고 선의 뾰족한 끝으로 맺힌다. 농도는 선 본체와 같은 spinT를 써서
    // 중립(아이스)→방향색으로 같이 물든다 — 선은 옅은데 촉만 진하면 크기 신호가 어긋난다.
    tmp.set(NEON.ice).lerp(dirCol, spinT);
    coreColors[last * 3] = tmp.r;
    coreColors[last * 3 + 1] = tmp.g;
    coreColors[last * 3 + 2] = tmp.b;
    caseColors[last * 3] = dark.r;
    caseColors[last * 3 + 1] = dark.g;
    caseColors[last * 3 + 2] = dark.b;
    for (let n = 0; n < 3; n++) {
      coreColors.push(tmp.r, tmp.g, tmp.b);
      caseColors.push(dark.r, dark.g, dark.b);
    }

    this.aimCoreGeo.setPositions(positions);
    this.aimCoreGeo.setColors(coreColors);
    this.aimCaseGeo.setPositions(positions);
    this.aimCaseGeo.setColors(caseColors);
    this.aimCoreMat.resolution.set(window.innerWidth, window.innerHeight);
    this.aimCaseMat.resolution.set(window.innerWidth, window.innerHeight);
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
