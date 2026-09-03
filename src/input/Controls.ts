import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import { isCoarsePointer } from '../core/device';
import { t, onLocaleChange } from '../i18n';
import {
  BALL_START_Z,
  AIM_RANGE,
  AIM_GAIN,
  RELEASE_SWEET_LO,
  RELEASE_SWEET_HI,
  RELEASE_SIGMA_MIN,
  RELEASE_SIGMA_MAX,
  RELEASE_TOL,
} from '../game/constants';
import { oilEndZ } from '../game/oil';
import { predictPath } from '../game/predict'; // 조준선 적분 — 발사 물리와 같은 상수, tests/predict.test.ts가 Rapier와 대조
import { gauss, ENTRY_DIST } from '../game/ai'; // 릴리스 타이밍 노이즈(#9) — ai와 동일 구현 단일소스 공유

/** 하단 도크(스핀·파워)의 공용 베이스라인. 둘이 겹치면 syncDockLayout()이 파워바만 위로 올린다. */
const DOCK_BOTTOM = 'calc(10px + env(safe-area-inset-bottom))';
/** 도크 패널 사이 최소 간격(px) — 겹침 판정과 회피 높이에 같은 값을 쓴다. */
const DOCK_GAP = 8;
import { css, INK, HOUSE, FONT_UI, rgba, ensureHouseStyles, applyPanel } from '../ui/theme';


// 조준선 색 — 매 재빌드마다 THREE.Color를 새로 할당하던 것을 모듈 스크래치로 재사용(무할당, #1).
// tan/dark는 불변 상수, spinCol은 스핀 따라 .set()으로 갱신, tmp는 lerp 스크래치.
const AIM_DARK = 0x0a0e16; // 외곽선 어두운색(케이스 머티리얼 고정색)
const AIM_SPIN_COL = new THREE.Color(); // 스핀색 스크래치(중립→방향색, |spin| 비례)
const AIM_DIR_COL = new THREE.Color(); // 방향색 스크래치(L=시안 / R=앰버) — 선·화살촉이 공유
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
/**
 * 조준선 코어의 중립색. `0xa8b2c8`(회청색)이었는데 **밝은 레인 위에서 명도 대비가 거의 없어**
 * 선이 뿌옇게 보였다 — 화살촉만 또렷했던 건 거기는 색을 HOUSE.cream로 고정하기 때문이다.
 * 화살촉과 같은 아이스로 맞춰 선-촉이 한 몸으로 읽히게 한다(스핀 색 물듦은 그대로).
 */
const AIM_NEUTRAL = 0xdfe8ff;
/**
 * 조준선 획 굵기(px). 8/4였는데 **너무 쨍했다** — 한 획 안에서 코어(명도 ≈94%)와 케이스(`0a0e16`,
 * ≈4%)가 20:1로 붙어 있어, 씬에 그려진 선이 아니라 위에 붙인 스티커로 읽힌다. 조명을 안 받는
 * `LineMaterial`이라 화면에서 가장 밝은 것과 가장 어두운 것을 이 선 하나가 동시에 갖는다.
 *
 * 비율(2:1)은 유지한 채 무게만 뺀다 — 대비 구조는 그대로라 밝은 레인 위 가독성은 안 잃는다.
 *
 * ⚠️ **알파로 누그러뜨리려 하지 말 것.** Line2는 정점마다 라운드 캡을 그려 인접 세그먼트가 선폭
 * 절반씩 겹친다 — opacity<1이면 이음매마다 알파가 두 번 곱해져 얼룩이 돌아온다(9d7f977·678018f).
 * 두 머티리얼이 `transparent:true, opacity:1`인 게 그 이유다. 톤은 **색값으로만** 조절한다.
 */
const AIM_CASE_W = 6;
const AIM_CORE_W = 3;
const AIM_TIP = new THREE.Vector3(); // 조준선 끝점 월드좌표 스크래치 — 카메라 거리 계산(무할당)
const AIM_NDC_A = new THREE.Vector3(); // 데시메이션용 NDC 스크래치 (직전 유지 정점)
const AIM_NDC_B = new THREE.Vector3(); // 데시메이션용 NDC 스크래치 (후보 정점)
// 끝 마감: 조준선 폴리라인(Line2) 끝에 같은 획(core+case)으로 화살촉(∧)을 이어 붙인다 — 별도 마커/오브젝트가
// 아니라 라인 지오메트리의 일부라 항상 선과 한 몸으로 자연스럽게 이어진다. 화살촉은 끝 접선(실제 진행 방향,
// 훅 포함) 을 가리켜 "여기로 이렇게 굴러간다"를 함께 표현. 끝은 페이드 없이 또렷한 네온(우훅=앰버/그외=시안·아이스).
const ARROW_PX = 0.03; // [튜닝] 화살촉 팔 길이 = 이 값 × 카메라거리(m). 거리 비례라 멀어도 화면상 크기 유지
const ARROW_MIN = 0.13; // [튜닝] 팔 길이 하한(월드 m)
const ARROW_MAX = 0.3; // [튜닝] 팔 길이 상한(월드 m)
const ARROW_HALF = 0.5; // [튜닝] 화살촉 반각(rad, ≈29°) — 작을수록 뾰족/슬림
/** 화살촉 곡선 분할 수 — 좌↔우를 한 줄로 잇는 베지어를 몇 조각으로 근사할지(8이면 육안으로 각이 없다). */
const HEAD_SEGS = 8;
/**
 * 조준선 정점의 최소 화면 간격(px). **케이스 선폭에서 파생된다** — 그보다 촘촘하면 세그먼트가
 * 겹쳐 얼룩진다. 상수로 박아두면 선을 얇게 만들 때 같이 안 따라와 곡선만 괜히 거칠어진다.
 */
const MIN_SEG_PX = AIM_CASE_W + 1;
// 파워 차징 속도(단위 /초). 기존엔 프레임당 +0.018(프레임레이트 의존 — 고주사율/저FPS에서 속도가
// 달라지는 버그)이었다. ×60fps = 1.08/s로 환산해 dt를 곱하면 어떤 FPS에서도 0→1 약 0.93초로 일정.
const CHARGE_RATE = 1.08;
// 스트라이크 최적 파워 존(흐리게 암시 — docs/legacy/UI_REVAMP.md 결정②). carry sim상 윈도우는 "풀파워 근방"이나
// 풀스핀은 미드파워가 더 휘어 *정확한* 최적은 플레이별로 갈림 → 넓고 은은한 상단~중상 띠로만 힌트.
// 꼭대기(=최대)는 직진 과속이라 살짝 못 미치게 둔다. 정밀 조준은 실력에 맡김(난이도 보존).
// 시각 골드 띠 = 릴리스 타이밍 '정확 구간'과 동일하게 constants에서 공용(P3) — 띠 안에서 떼면 정확.
const POWER_SWEET_LO = RELEASE_SWEET_LO;
const POWER_SWEET_HI = RELEASE_SWEET_HI;

// 릴리스 타이밍(P3) 노이즈용 gauss()·ENTRY_DIST(aim↔진입x 변환 거리)는 ai.ts에서 import(#9) — 예전엔 여기 복제였다.

/**
 * 포인터(마우스+터치) 입력 (도안 §8 / MOBILE_SUPPORT.md §2). **키보드는 안 쓴다** —
 * 예전엔 Q/E로 스핀을 줬는데 휠로 옮겼다(Esc만 Boot이 따로 듣는다).
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
  private dockShown = false; // 하단 도크 노출 상태 — false→true 전환에서 겹침을 다시 잡는다
  /**
   * 휠을 **실제로 본 적 있는가.** 스핀 바 노출의 기준은 "터치냐"가 아니라 "휠이 있느냐"다 —
   * 휠 없는 마우스나 태블릿에선 바가 유일한 스핀 입력이므로 숨으면 입력이 사라진다.
   * ⚠️ 휠 존재는 **사전 감지가 불가능하다**(`matchMedia('(wheel)')` 같은 건 없다). wheel 이벤트가
   * 올 때만 알 수 있으므로 **바를 기본으로 두고 휠이 나타나면 강등**한다(fail-safe 방향).
   */
  private wheelSeen = false;
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
    ensureHouseStyles();
    this.camera = engine.camera; // 화살촉 거리 스케일(A) — updateAimArrow의 tip↔카메라 거리

    // 조준 곡선 라인 — Line2(굵기 지원)로 실제 예측 경로를 그린다. THREE.Line은 브라우저가 linewidth를
    // 무시해 1px로만 나와 밝은 레인에서 안 보였음. 어두운 외곽선(case) + 밝은 코어(core) 2겹이라
    // 중립(아이스)도 또렷하다. 두 겹은 좌표는 같고 색·굵기만 다르다.
    const seed = [0, 0.02, BALL_START_Z, 0, 0.02, BALL_START_Z + 0.5];
    this.aimCoreGeo = new LineGeometry();
    this.aimCoreGeo.setPositions(seed);
    this.aimCaseGeo = new LineGeometry();
    this.aimCaseGeo.setPositions(seed);
    // ⚠️ 케이스는 **불투명**이다(opacity 1). 반투명이면 세그먼트가 겹치는 이음매마다 알파가 두 번
    // 곱해져 그 자리만 진해진다 — Line2는 정점마다 라운드 캡을 그려서 인접 세그먼트가 선폭의 절반씩
    // 겹치므로, 겹침은 정점 간격을 벌려도 남는다. 얼룩의 나머지 절반이 이것이었다(앞의 절반은
    // 원근 압축으로 정점이 2.6px까지 붙던 것 — updateAimArrow의 데시메이션 주석).
    this.aimCaseMat = new LineMaterial({
      color: AIM_DARK, // 외곽선은 고정 — 페이드를 걷어내며 정점색이 필요 없어졌다
      linewidth: AIM_CASE_W,
      transparent: true, // 알파는 안 쓰지만 렌더 순서를 코어와 맞추려면 필요하다(둘 다 depthWrite:false)
      opacity: 1,
      depthWrite: false,
    });
    this.aimCoreMat = new LineMaterial({
      color: AIM_NEUTRAL, // 매 갱신마다 스핀 색으로 덮어쓴다(updateAimArrow)
      linewidth: AIM_CORE_W,
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

    // 하단 도크 통합(docs/legacy/UI_REVAMP.md P2): 스핀=좌하단 컴팩트 · 파워=우하단 세로 한 쌍.
    // 가운데를 비워 공·조준 화살표(바나나 곡선) 밑동이 그대로 보이게 한다(공 가림 해소, 진단④).
    //
    // 2026-09-02 톤앤매너 정리(사용자: "전반적인 톤앤매너에 맞게") — 도크 둘과 핀 인디케이터(PinDeck)가 마지막으로 남은
    // 글래스 시절 위젯이었다(시안 테두리 + 999px 알약 트랙 + 글로우 채움 + ⚡ 이모지). 점수 시트·메뉴는 이미 인쇄물 문법
    // (크림 규선·머스터드 잉크 블록·자간 라벨·3px 모서리)이라 그 문법으로 맞춘다: 테두리 = 크림 규선, 트랙 = 잉크 홈(3px),
    // 존 = 인쇄 해칭, 채움 = 하드 스톱 3색 띠(sage/mustard/brick — 존 경계와 같은 위치), 노브 = 페이더 캡, 라벨 = 활자.
    // 글로우·이모지·그라데 확산은 전부 걷었다. 바탕(PANEL_BG 슬레이트)은 그대로다 — 톤은 구조·액센트로 낸다(theme.ts 합의).

    // === 파워 게이지 (우측 하단 — 중앙은 공과 겹침) ===
    const powerWrap = (this.powerWrap = document.createElement('div'));
    applyPanel(powerWrap, HOUSE.cream); // 크림 규선 — 점수 시트 RULE과 같은 인쇄 문법
    css(powerWrap, {
      position: 'fixed', // 우측 세로 파워바 (가운데 레인을 비움)
      bottom: DOCK_BOTTOM, // 스핀과 같은 베이스라인 — 좁은 화면에선 syncDockLayout()이 위로 올린다
      right: this.coarse
        ? 'calc(var(--col-edge, 0px) + 10px + env(safe-area-inset-right))'
        : 'calc(var(--col-edge, 0px) + 24px + env(safe-area-inset-right))',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '12px 10px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '7px',
    });
    // 라벨 — 세로 게이지 위, 스핀 라벨과 같은 가로 자간 활자. 예전엔 ⚡ 이모지였다(이모지 아이콘은 83b67c5에서 전부 걷었는데
    // 여기만 남아 있었다). 한 번 세로쓰기(vertical-rl)로 놓아 봤는데 한글이 한 자씩 쌓여 "파/워"가 됐다 — 사용자: "세로로 쓰는 게 맞을까"
    // → 가로로 돌린다. 한·중 글자(18px)는 바 폭(20px) 안에 들고, 일본어(27px)·영어 "POWER"(40px)에선 패널이 그만큼 넓어진다(최대 62px).
    // 그 불균형이 옛날 텍스트를 뺀 이유였지만, 지금은 라벨이 스핀 패널과 같은 활자라 '한 세트'로 읽히는 쪽이 낫다.
    const powerLabel = document.createElement('span');
    powerLabel.textContent = t('controls.power');
    css(powerLabel, {
      font: FONT_UI,
      fontSize: '9px',
      letterSpacing: '0.14em',
      color: HOUSE.dim,
      textTransform: 'uppercase',
      whiteSpace: 'nowrap',
    });
    onLocaleChange(() => {
      powerLabel.textContent = t('controls.power');
    });
    powerWrap.appendChild(powerLabel);

    const gaugeTrack = document.createElement('div');
    css(gaugeTrack, {
      position: 'relative',
      // 14 → 20px. 주변시는 "크고 굵게, 강한 대비"만 읽는다 — 얇은 바는 위치를 당겨도 곁눈에 안 걸린다.
      width: '20px',
      // ⚠️ 예전엔 coarse에서 `26vh` 였다 — **방향에 따라 크기가 뒤집혔다**(세로 812px→211px /
      // 가로 375px→97px). 세로 바의 길이는 화면 높이에 비례하는 게 맞지만 하한이 없으면 가로에서
      // 반토막이 된다. clamp로 하한·상한을 줘서 두 방향 모두에서 충분히 길다.
      height: this.coarse ? 'clamp(190px, 30vh, 300px)' : '220px',
      background: 'rgba(0,0,0,0.38)', // 잉크 홈 — 밝은 반투명(0.12 white)은 글래스 문법이었다
      border: `1px solid ${rgba(HOUSE.cream, 0.28)}`, // 점수 시트 RULE과 같은 값
      borderRadius: '3px',
      overflow: 'hidden',
    });
    // 최적 파워 존 — 인쇄 해칭 띠 + 진입 하단 경계선(크림 규선). 정확 눈금은 의도적으로 없음.
    const lo = POWER_SWEET_LO * 100;
    const hi = POWER_SWEET_HI * 100;
    const zoneBand = document.createElement('div');
    css(zoneBand, {
      position: 'absolute',
      left: '0',
      bottom: `${lo}%`,
      width: '100%',
      height: `${hi - lo}%`,
      // 반투명 색면(0.13) → 45° 해칭. 인쇄물이 '구역'을 표시하는 방식이고, 채움이 지나가도 줄무늬로 남아 존이 계속 읽힌다.
      background: `repeating-linear-gradient(135deg, ${rgba(HOUSE.mustard, 0.34)} 0 2px, transparent 2px 6px)`,
    });
    const zoneLine = document.createElement('div'); // 존 진입 경계 — 글로우 없는 1px 규선
    css(zoneLine, {
      position: 'absolute',
      left: '0',
      right: '0',
      bottom: `${lo}%`,
      height: '1px',
      background: rgba(HOUSE.cream, 0.7),
    });
    this.gaugeFill = document.createElement('div');
    css(this.gaugeFill, {
      position: 'absolute',
      left: '0',
      bottom: '0',
      width: '100%',
      height: '100%',
      // 아래=안전 위=과다. 값을 인코딩하는 색이라 남기되 **부드러운 그라데 → 하드 스톱 3색 띠**로: 경계가 존(lo·hi)과
      // 정확히 같은 위치라 채움이 존에 들어서는 순간 색이 머스터드로 바뀐다(인쇄 미터). 채움량은 height가 아니라
      // clip-path로 드러낸다 — height로 하면 그라데가 채움 길이에 따라 늘어나 띠 위치가 움직인다.
      background: `linear-gradient(0deg, ${HOUSE.sage} 0 ${lo}%, ${HOUSE.mustard} ${lo}% ${hi}%, ${HOUSE.brick} ${hi}% 100%)`,
      clipPath: 'inset(100% 0 0 0)',
    });
    gaugeTrack.appendChild(zoneBand); // 뒤: 존 띠
    gaugeTrack.appendChild(this.gaugeFill); // 중간: 차오르는 채움
    gaugeTrack.appendChild(zoneLine); // 앞: 경계선(채움 위로도 보이게)
    powerWrap.appendChild(gaugeTrack);

    // === 스핀 게이지 (파워 위) — 휠(데스크톱) 또는 드래그(터치)로 좌/우 훅 설정 ===
    const spinWrap = (this.spinWrap = document.createElement('div'));
    applyPanel(spinWrap, HOUSE.cream); // 파워와 동일 규선으로 통일 (입력 쌍)
    css(spinWrap, {
      position: 'fixed', // 좌하단 컴팩트 — 풀폭 폐기(공·조준선 밑동 가림). 2단: 헤더(라벨+값) / 트랙.
      bottom: DOCK_BOTTOM,
      left: this.coarse
        ? 'calc(var(--col-edge, 0px) + 12px + env(safe-area-inset-left))'
        : 'calc(var(--col-edge, 0px) + 24px + env(safe-area-inset-left))',
      // ⚠️ 예전엔 `min(46vw, 280px)` — 파워의 26vh와 **반대 방향** 뷰포트 단위라 세로에선 좁고(172px)
      // 가로에선 넓었다(373px). 가로 바의 폭은 화면 폭에 비례하는 게 맞고, clamp 하한으로 세로에서도
      // 충분히 넓게 잡는다.
      width: this.coarse ? 'clamp(250px, 62vw, 340px)' : '360px',
      zIndex: '20',
      pointerEvents: 'none',
      padding: '9px 12px 10px',
      display: 'flex',
      flexDirection: 'column',
      gap: '10px', // 6 → 10: 라벨이 트랙에 붙어 보였다(사용자, 2026-09-03 "스핀과 바 사이 간격 조금 벌려")
      // **휠을 보기 전까진 상시 노출** — 그때까진 이 바가 유일한 스핀 입력일 수 있다(태블릿·휠 없는
      // 마우스). 첫 wheel 이벤트에서 트랜지언트로 강등된다(demoteSpinBarToIndicator).
      opacity: '1',
      transition: 'opacity 0.28s ease',
    });

    // 헤더: "스핀" 라벨 + 현재 수치
    const spinLabel = document.createElement('span');
    spinLabel.textContent = t('controls.spin');
    css(spinLabel, {
      font: FONT_UI,
      fontSize: '10px',
      letterSpacing: '0.12em',
      color: HOUSE.dim,
      textTransform: 'uppercase',
      flex: '0 0 auto',
    });

    // 드래그 가능한 트랙 (중앙=0, 좌/우로 차오름).
    // 터치(coarse): 히트영역 44px(투명) + 내부 얇은 시각 바 + 큰 썸 (§3.1). 데스크톱: 10px 바 자체가 시각.
    const TRACK_HIT = this.coarse ? 52 : 14; // 세로 터치 히트영역 (44→52 / 10→14)
    const THUMB = this.coarse ? 32 : 20; // 썸 지름 (28→32 / 16→20)
    /**
     * **시각 바 굵기 단일소스.** 예전엔 10px가 세 곳(터치 시각 바·채움·중앙 눈금 기준)에 각각
     * 박혀 있어서, 트랙을 키워도 정작 눈이 읽는 **채움**이 10px에 남아 굵어 보이지 않았다.
     * fine은 히트영역(TRACK_HIT 14)을 꽉 채우고, coarse는 손가락 기준으로 조금 더 굵게.
     */
    const BAR_H = this.coarse ? 16 : 14;
    const spinTrack = (this.spinTrack = document.createElement('div'));
    css(spinTrack, {
      position: 'relative',
      flex: '1',
      minWidth: '0',
      height: `${TRACK_HIT}px`,
      background: this.coarse ? 'transparent' : 'rgba(0,0,0,0.38)', // 잉크 홈(파워 트랙과 동일)
      border: this.coarse ? 'none' : `1px solid ${rgba(HOUSE.cream, 0.28)}`,
      borderRadius: '3px', // 999px 알약은 글래스 문법 — 인쇄물 모서리
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
        marginTop: `${-BAR_H / 2}px`,
        width: '100%',
        height: `${BAR_H}px`,
        background: 'rgba(0,0,0,0.38)',
        border: `1px solid ${rgba(HOUSE.cream, 0.28)}`, // 파워 트랙과 같은 규선
        borderRadius: '3px',
      });
      spinTrack.appendChild(line);
    }
    const tick = document.createElement('div'); // 중앙 눈금
    css(tick, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '2px',
      height: `${BAR_H + 8}px`, // 바보다 위아래로 4px씩 튀어나와 '중앙'을 읽히게
      marginLeft: '-1px',
      marginTop: `${-(BAR_H + 8) / 2}px`,
      background: rgba(HOUSE.cream, 0.62),
    });
    this.spinFill = document.createElement('div');
    css(this.spinFill, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: '0%',
      height: `${BAR_H}px`,
      marginTop: `${-BAR_H / 2}px`,
      borderRadius: '2px',
    });
    // 노브 = **페이더 캡**(세로로 긴 직사각 + 가운데 홈). 원판은 글래스 시절 슬라이더 문법이고, 크림 원판은 핀 인디케이터의
    // '서 있는 핀'과 같은 모양이라 뜻이 겹쳤다. 미드센추리 기기의 페이더 캡은 직사각이다. 크림 + 하드 잉크 테두리는 유지
    // (글로우는 그 전에 이미 걷었다 — 플레이 화면에서 유일하게 발광하던 요소였다).
    const THUMB_W = Math.round(THUMB * 0.62);
    const THUMB_H = THUMB + 6;
    this.spinThumb = document.createElement('div');
    css(this.spinThumb, {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: `${THUMB_W}px`,
      height: `${THUMB_H}px`,
      marginLeft: `${-THUMB_W / 2}px`,
      marginTop: `${-THUMB_H / 2}px`,
      borderRadius: '2px',
      // 가운데 홈 — 캡의 손가락 자리. 2px 잉크 선.
      background: `linear-gradient(to right, ${HOUSE.cream} 0 calc(50% - 1px), ${INK} calc(50% - 1px) calc(50% + 1px), ${HOUSE.cream} calc(50% + 1px))`,
      border: `2px solid ${INK}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.55)', // 확산 아닌 드롭섀도 — 어두운 트랙에서 캡을 떼어놓는다
    });
    spinTrack.appendChild(this.spinFill);
    spinTrack.appendChild(tick);
    spinTrack.appendChild(this.spinThumb);

    // 이 라벨은 **생성자에서 한 번만** 쓰인다(HUD처럼 매 프레임 다시 그리지 않는다) → 언어가
    // 바뀌면 스스로 갱신되지 않으므로 구독한다.
    onLocaleChange(() => {
      spinLabel.textContent = t('controls.spin');
    });

    // 헤더가 따로 있는 이유: 예전엔 오른쪽에 현재 수치가 같이 앉는 2단이었다. 수치는 걷었지만
    // (썸·채움이 이미 값을 말한다) 라벨 정렬은 이 행이 잡고 있어 그대로 둔다.
    const spinHeader = document.createElement('div');
    css(spinHeader, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    spinHeader.appendChild(spinLabel);

    spinWrap.appendChild(spinHeader);
    spinWrap.appendChild(spinTrack);

    document.body.appendChild(spinWrap); // 하단 풀폭 스핀바
    document.body.appendChild(powerWrap); // 우측 세로 파워바
    // 화면이 바뀌면 두 패널의 겹침 여부도 바뀐다(회전·창 크기·safe-area).
    // rAF로 한 번 더 재는 이유: 모바일은 회전 직후 resize가 **레이아웃이 잡히기 전에** 오는 경우가
    // 있어 그 프레임의 측정이 옛 값이다(실제로 뷰포트 전환 직후 옛 값이 남는 걸 관측했다).
    addEventListener('resize', () => {
      this.syncDockLayout();
      requestAnimationFrame(() => this.syncDockLayout());
    });

    this.bindEvents();
  }

  private onCanvas(e: Event): boolean {
    return (e.target as HTMLElement)?.tagName === 'CANVAS';
  }

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
    this.spinTrack.style.pointerEvents = 'none';
    // opacity는 update()의 트랜지언트 로직이 이어받는다(wheelSeen 게이트가 이제 열렸다).
  }

  /** 스핀 바 위 포인터 x → spin ∈ [-1,1] (SPIN_STEP 단위 — 휠과 같은 값 공간) */
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
    this.gaugeFill.style.clipPath = `inset(${(1 - this.power) * 100}% 0 0 0)`; // 위에서 가려 아래부터 드러난다(띠 위치 고정)

    // 스핀 게이지: 중앙에서 좌(시안)/우(앰버)로 차오름 + 썸. 입력은 휠 또는 바 드래그.
    const s = this.spin;
    const dirColor = s < 0 ? HOUSE.turquoise : HOUSE.amber;
    this.spinFill.style.width = `${Math.abs(s) * 50}%`;
    this.spinFill.style.left = s < 0 ? `${50 - Math.abs(s) * 50}%` : '50%';
    this.spinFill.style.background = dirColor;
    this.spinThumb.style.left = `${50 + s * 50}%`;
    // 방향은 **테두리 색**만으로 진다 — 글로우로 지던 걸 걷었으니 여기서도 box-shadow를 안 만진다.
    this.spinThumb.style.borderColor = s === 0 ? INK : dirColor;
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
    // 숨어 있는 동안엔 측정이 전부 0이라 겹침 판정을 못 한다 → 보이기 시작할 때 한 번 잡는다.
    if (inGame && !this.dockShown) this.syncDockLayout();
    this.dockShown = inGame;

    const aiming = this.game.readyToThrow && this.game.isHumanTurn();
    // 터치는 hover가 없어 aim이 갱신되지 않으므로, 새 조준 턴 진입 시 정중앙에서 시작 (드리프트 방지)
    if (this.coarse && aiming && !this.wasAiming) this.aim = 0;
    this.wasAiming = aiming;
    this.aimGroup.visible = aiming;
    if (aiming) this.updateAimArrow();
  }

  /**
   * 스핀 패널과 파워바가 가로로 겹치면 파워바를 스핀 패널 **위로** 올린다.
   *
   * 둘 다 같은 베이스라인(DOCK_BOTTOM)에 앉는데, 좁은 화면에선 스핀 패널의 최소 폭(clamp 하한)이
   * 파워바 자리까지 밀고 들어와 파워바 아랫부분이 스핀 패널에 겹쳐 보였다(모바일 실기 제보).
   * 폭은 이미 clamp로 하한이 걸려 있어 더 줄이면 트랙이 못 쓰게 되므로, **세로로 피한다.**
   *
   * 고정값이 아니라 매번 재는 이유: 스핀 패널 높이가 폰트·safe-area·언어(문자 높이)에 따라
   * 달라지고, 회전하면 겹침 여부 자체가 뒤집힌다. 데스크톱처럼 안 겹치는 화면은 그대로 둔다.
   */
  private syncDockLayout() {
    this.powerWrap.style.bottom = DOCK_BOTTOM; // 기준선으로 되돌리고 다시 잰다(누적 방지)
    const spin = this.spinWrap.getBoundingClientRect();
    if (spin.height === 0) return; // 숨김 상태 — 보일 때 다시 부른다
    const power = this.powerWrap.getBoundingClientRect();
    const overlaps = spin.right + DOCK_GAP > power.left && spin.top < power.bottom;
    if (overlaps) this.powerWrap.style.bottom = `calc(${DOCK_BOTTOM} + ${Math.round(spin.height) + DOCK_GAP}px)`;
  }

  /**
   * 조준 곡선 라인 갱신 — 실제 발사 물리와 같은 수식으로 예측 경로를 적분(검증 오차 ~1cm)해
   * Line2(외곽선+코어 2겹)로 그린다. 오일 존 직진 → 드라이 존 레이트 훅.
   * 길이는 고정(endZ 주석 참고)이고, 끝은 페이드가 아니라 **화살촉**으로 맺는다
   * (끝 페이드는 6fa4ed2에서 걷어냈다 — 선은 처음부터 끝까지 한 색이다).
   */
  private updateAimArrow() {
    // 곡률 보존 압축: REF_Z까지의 훅 곡선을 적분해 '모양'을 확보한 뒤, 시작점 기준 k배로 비례 축소해
    // DRAW_Z 길이에 욱여넣는다. 짧게 그려도(DRAW_Z) 긴 거리(REF_Z)의 곡률이 그대로 보임(축소판 바나나).
    // 그냥 DRAW_Z까지만 적분하면 그 구간이 오일존(직진)이라 곡률이 거의 안 보였음. 균일 스케일이라 초기
    // 조준 방향(각도)은 불변. 조준선은 차징(파워 핑퐁)에 안 흔들리게 대표 파워로 고정(파워 체감은 게이지).
    const REF_Z = 14; // 압축 **기준** 길이 — endZ와 무관하게 항상 이 길이의 곡률을 DRAW_Z에 담는다
    const DRAW_Z = 5; // REF_Z가 매핑되는 온스크린 길이(압축 후)
    const p = 0.6;
    /**
     * 적분 종료 z — **고정값**이다(2026-09-02). 예전엔 '조준 난이도' 설정이 셋으로 갈랐다:
     *   쉬움 `REF_Z`=14(적분 15m) · 보통 `oilEndZ()`(당시 하우스 10.5 → 11.5m) · 어려움 `BALL_START_Z+4`=3(4m)
     * 설정을 없애고 **보통과 어려움 사이**로 고정했다(사용자 결정).
     *
     * ⚠️ 체감 길이는 endZ가 아니라 **endZ × k**다(k = (DRAW_Z−BALL_START_Z)/(REF_Z−BALL_START_Z) = 0.4).
     *   보통 11.5×0.4 = 4.6m · 어려움 4×0.4 = 1.6m · **여기 7.5×0.4 = 3.0m** → 중간값 3.1m에 사실상 일치.
     *   endZ만 보고 중간을 잡으면 압축을 빼먹어 틀린다.
     *
     * 왜 `oilEndZ()`를 안 따라가나: '보통'이 브레이크에 정확히 끝난 건 "여기서 꺾인다"를 **알려주는**
     * 장치였다. 중간값은 브레이크를 표시하지 못하니 따라갈 이유가 없고, 오히려 프리셋(short 9.5 /
     * house 10.5 / long 12.5)과 마름(최대 −1.5m)에 따라 길이가 흔들려 **패턴 정보를 흘린다.**
     *
     * 미리보기는 **항상 직선**이다 — 훅은 브레이크(최소 9.0m = short 10.5 − 마름 1.5) 뒤에서 시작하고 적분은 6.5m에서 끝난다.
     * 이건 신규 제약이 아니라 구 '보통'과 같다(그쪽도 종료점이 오일 존 안이라 곡선이 안 생겼다):
     * 방향과 스키드는 보여주고 훅의 양은 온전히 플레이어가 읽는다.
     */
    const endZ = BALL_START_Z + 7.5;
    // 캐시 가드(#1): 조준·스핀·오일끝·볼물성이 그대로면 재적분·배열재빌드·버퍼 재업로드를 통째 스킵.
    // ⚠️ oilEndZ()는 **지금은 inert하지만 일부러 키에 남긴다.** 미리보기가 브레이크(최소 9.0m) 앞에서
    //    끝나므로 hookFactor(z)가 구간 전체에서 0이고, 따라서 오일 마름이 선 모양을 안 바꾼다.
    //    하지만 AIM_PREVIEW_Z를 브레이크 뒤로 늘리는 순간 의존이 되살아난다 — 그때 키에 없으면
    //    마름이 반영 안 된 선이 굳는다(찾기 어려운 종류의 정지 렌더 버그).
    // 볼물성(speedScale/massKg)도 필수 — speed/inject가 의존하고 setSpec()은 조준 중 호출되는 정상 경로.
    // resolution만 리사이즈 대응차 매 프레임 갱신하고 종료(가벼운 uniform 쓰기).
    // 카메라 **위치**는 키에 남긴다 — 팔 길이가 카메라 거리에 비례하므로(ARROW_PX × camDist),
    // 위치가 빠지면 핀세터 사이클 뒤 카메라가 조준 포즈로 복귀하는 동안 만들어진 길이가 그대로 굳는다.
    // 회전·종횡비는 이제 화살촉에 안 쓰이므로 뺀다(그만큼 재적분이 줄어든다).
    const cp = this.camera.position;
    const key = `${this.aim}|${this.spin}|${oilEndZ()}|${this.ball.massKg}|${this.ball.speedScale}|${cp.x.toFixed(2)},${cp.y.toFixed(2)},${cp.z.toFixed(2)}`;
    if (key === this.lastAimKey) {
      this.aimCoreMat.resolution.set(window.innerWidth, window.innerHeight);
      this.aimCaseMat.resolution.set(window.innerWidth, window.innerHeight);
      return;
    }
    this.lastAimKey = key;
    // 경로 적분은 predict.ts — 발사 물리(launchState·applySpinForce·레인 마찰)와 같은 상수를 import하고,
    // tests/predict.test.ts가 같은 입력을 Rapier 헤드리스 투구와 대조한다(조준선이 거짓말하면 거기서 잡힌다).
    // 끝점은 predictPath가 endZ에 정확히 트림해 준다(적분 스텝 단위로 끝이 튀던 "버벅" 제거).
    let path = predictPath({
      aim: this.aim,
      power: p,
      spin: this.spin,
      massKg: this.ball.massKg,
      speedScale: this.ball.speedScale,
      endZ,
      maxSteps: 80,
    });
    if (path.length < 2) return;

    // REF_Z 곡선을 DRAW_Z로 비례 축소 (시작점 기준 균일 스케일 k)
    const k = (DRAW_Z - BALL_START_Z) / (REF_Z - BALL_START_Z);
    const sz = (z0: number) => BALL_START_Z + (z0 - BALL_START_Z) * k;

    // ⚠️ **화면 간격으로 정점을 솎아낸다.** 적분 스텝은 시간 균등이라 월드에선 고르지만, 원근 압축
    // 때문에 먼 쪽 정점이 화면에서 51px → **2.6px**까지 붙는다(실측). 선폭(AIM_CASE_W·AIM_CORE_W)
    // 보다 짧은 세그먼트는 서로 겹치고, 당시 케이스가 반투명이라 **겹친 만큼 진해져** 선이
    // 얼룩덜룩·점선처럼 보였다(확대 시 뚜렷 — 사용자 제보). 겹치지 않을 만큼만 남기면 매끈한 한 줄.
    //
    // 간격은 **실제 투영으로 잰다.** 처음엔 거리 비례로 근사했는데, 끝부분 세그먼트는 대부분 시선
    // 방향이라 화면에서 훨씬 더 눌린다 — 근사식이 2배 과대평가해 4~8px 세그먼트가 그대로 남았다.
    // 비용은 정점당 행렬곱 하나(약 25회)라 무시할 수준이고, 카메라 위치는 이미 캐시 키에 있다.
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    const projected = (x0: number, z0: number, out: THREE.Vector3) => out.set(x0 * k, 0.02, sz(z0)).project(this.camera);
    const kept: number[][] = [path[0]];
    let lastN = projected(path[0][0], path[0][1], AIM_NDC_A);
    for (let i = 1; i < path.length - 1; i++) {
      const n2 = projected(path[i][0], path[i][1], AIM_NDC_B);
      if (Math.hypot((n2.x - lastN.x) * halfW, (n2.y - lastN.y) * halfH) >= MIN_SEG_PX) {
        kept.push(path[i]);
        lastN = AIM_NDC_A.copy(n2);
      }
    }
    kept.push(path[path.length - 1]); // 끝점은 endZ에 정확히 트림된 값이라 반드시 남긴다
    path = kept;

    const positions: number[] = [];
    for (let i = 0; i < path.length; i++) positions.push(path[i][0] * k, 0.02, sz(path[i][1]));

    // 색: 중립(아이스)에서 방향색(L=시안 / R=앰버)으로 |spin| 비례 lerp — 방향뿐 아니라 **크기**까지
    // 화면 중앙에서 읽힌다(휠로 조준 중 스핀을 굴리게 되면서 필요해진 정보).
    //
    // 예전엔 여기서 정점마다 레인색을 섞어 선 끝을 **녹였다**(FADE_MAX/PEAK/RECOVER). 그 장치는
    // "선 끝이 레인 한복판에서 뚝 잘려 보인다"를 가리려던 건데, 그 뒤에 화살촉이 생기면서 녹일 끝단
    // 자체가 없어졌다 — 끝을 도로 살리는 FADE_RECOVER가 그 모순의 증거였다. 남은 효과는 길이의
    // 60~90% 구간이 푹 꺼져 **가운데만 뿌연 선**이 되는 것뿐이라 통째로 걷어냈다(사용자 판단).
    // 그래서 선은 이제 **처음부터 끝까지 한 색**이고, 정점색·색 배열도 필요 없다(머티리얼 색 하나).
    const spinMag = Math.abs(this.spin);
    const spinT = spinMag > 0 ? SPIN_TINT_FLOOR + (1 - SPIN_TINT_FLOOR) * spinMag : 0;
    const dirCol = AIM_DIR_COL.set(this.spin < 0 ? HOUSE.turquoise : HOUSE.amber);
    this.aimCoreMat.color.copy(AIM_SPIN_COL.set(AIM_NEUTRAL).lerp(dirCol, spinT));

    // 끝 화살촉: 가이드라인과 같은 stroke(core+case)로 슬림한 ∧ 를 폴리라인에 이어 붙인다. 팁=마지막 점,
    // 거기서 뒤쪽 좌우로 두 갈래(진행 방향의 반대). 팔 길이는 카메라 거리 비례라 멀어도 화면상 크기 일정.
    //
    // 화살촉은 **레인 평면에 눕는다.** 조준 카메라가 레인과 거의 나란해서 깊이 성분이 화면에서 눌리므로
    // ∧가 아니라 납작한 가로 바로 보이는데, 그게 이 게임에서 쓰기로 한 모양이다(사용자 선택).
    // 화면 공간에서 만들어 세우는 안(뾰족한 ∧·곡선 날개)도 만들어 봤지만 되돌렸다 — 카메라에 종속되는
    // 대신 캐시·NaN 취급이 까다로워지고, 무엇보다 이 톤엔 납작한 쪽이 맞았다.
    const last = path.length - 1;
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
    const lx = ex + (bx * ca - bz * sa) * AL; // 좌 갈래 끝
    const lz = ez + (bx * sa + bz * ca) * AL;
    const rx = ex + (bx * ca + bz * sa) * AL; // 우 갈래 끝
    const rz = ez + (-bx * sa + bz * ca) * AL;
    // ⚠️ 좌→팁→우로 **꺾어** 그리면 마감이 지저분하다. 이 각도에서 화살촉은 거의 접히다시피 해서
    // 두 세그먼트가 서로 겹치는데, 당시 case가 반투명이라 겹친 자리만 진해지고 이음매가 덩어리로
    // 보였다(확대 시 뚜렷). 지금은 case가 불투명(opacity 1)이라 그 증상 자체는 없어졌지만,
    // 곡선 쪽 실루엣이 더 나아서 되돌리지 않았다 — **좌↔우를 2차 베지어 한 줄로** 잇는다.
    // 제어점은 `2·팁 − 좌우 중점`: 이러면 곡선이 t=0.5에서 **정확히 팁을 지난다** → 실루엣(팔 끝·꼭짓점)은
    // 그대로 두고 이음매만 없앤다.
    const cx = 2 * ex - (lx + rx) / 2;
    const cz = 2 * ez - (lz + rz) / 2;
    for (let i = 0; i <= HEAD_SEGS; i++) {
      const t2 = i / HEAD_SEGS;
      const m2 = 1 - t2;
      positions.push(
        m2 * m2 * lx + 2 * m2 * t2 * cx + t2 * t2 * rx,
        0.02,
        m2 * m2 * lz + 2 * m2 * t2 * cz + t2 * t2 * rz,
      );
    }
    this.aimCoreGeo.setPositions(positions);
    this.aimCaseGeo.setPositions(positions);
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
