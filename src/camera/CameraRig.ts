import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { GameState } from '../game/GameState';
import type { Ball } from '../scene/Ball';
import {
  HEADPIN_Z, CAM_APPROACH_Z, PIN_SPACING,
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
// 팔로우 거리는 **상수가 아니다** — 임팩트 파킹 지점에서 유도한다(아래 approachZFor).
// 릴리스→임팩트가 한 줄의 순수 체이스가 되면서(update 안 주석) 체이스 거리가 곧 임팩트 간격이
// 됐고, 임팩트 간격은 핀 랙을 가로 화각에 담아야 해서 종횡비에서 정해지기 때문이다.
// 실측 간격: 데스크톱 1.44m · 세로폰 3.13m. 1.44를 상수로 박으면 세로폰에서 임팩트에 카메라가
// **후퇴**한다. 공 지름은 화면 세로의 10.3% → 20.2%(데스크톱).
//
// 상수 FOLLOW_DIST(4.5 → 2.5 → 1.8 → 2.9)는 2026-09-01에 걷어냈다. 마지막 2.9의 근거
// ("리드 보정이 지연을 없애 명목값이 곧 실효값이 되므로, 눈으로 튜닝해 온 그림을 지키려면 중간
// 파워의 실효값을 써야 한다")를 포함한 히스토리는 `git log -S FOLLOW_DIST`에 있다.
// ⚠️ 그래서 파일 위 실측표의 거리 열(4.5/2.5)은 **옛 구조의 기록**이다 — 지금은 그 자리에
// 상수가 없다. 표에서 지금도 유효한 건 "가까울수록 훅이 잘 보인다"는 훅 진폭 쪽이다.

// 핀덱 파킹 포즈 — **핀 베이 개구부(PIN_BAY_TOP)가 이 값을 지배한다.**
// 예전엔 여기서 높이를 1.25로 끌어올려 핀 앞에서 '일어서는' 비트를 만들었는데, 베이 개구부가
// 0.6으로 내려오면서 그 시선이 캐노피 아랫단에 막혔다 — 뒷줄 핀 꼭대기가 12cm 잘렸다(실측).
// 지금은 반대로 **낮게 깔면서 파고든다**.
//
// ⚠️ 2026-09-01부터 이건 '접근할 때만 쓰는 별도 포즈'가 아니다. 위치 블렌드를 걷어내면서
//  · y는 체이스 높이 그 자체가 됐다(FOLLOW_Y가 이 값을 받아 쓴다. 0.60 → 0.45는 그 주석 참고).
//  · z는 고정 목적지가 아니라 체이스의 **클램프 상한**이고, 실제 값은 종횡비에서 유도된다
//    (approachZFor. 이 상수는 그 유도의 최근접 상한 = 데스크톱 값이다).
// 리플레이 카메라(Replay.placeCamera: 레인 위 공 기준 py 0.529)보다 이제 8cm **낮다** —
// 인계는 여전히 붙어 있지만 부호가 뒤집혔다(전광판 점유율 역전. FOLLOW_Y 주석 끝 참고).
//
// ⚠️ 이 값들은 PIN_BAY_TOP과 커플링돼 있다 — 바꾸면 tests/camera-sightline.test.ts가 잡는다.
export const APPROACH_POS = { y: 0.45, z: 16.85 } as const;
export const APPROACH_TARGET = { y: 0.18, z: 19.45 } as const;

/**
 * 팔로우 높이(m) — 위치 블렌드가 없으니 **릴리스부터 임팩트까지 같은 높이**다. 그래서 파킹
 * 높이(APPROACH_POS.y)와 하나의 값이다.
 *
 * 거리가 2.9 → 1.44m로 줄면 공이 화면 아래로 밀린다 — 가까운 공을 내려다보는 각이 4m 앞의
 * 시선 타깃보다 빨리 커지기 때문이다. 그래서 높이는 **올리는 게 아니라 내려야** 한다
 * (실측 공 중심 ndc: 0.78 → −0.885 / 0.60 → −0.666 / 0.45 → −0.469. −1이 화면 아래끝).
 *
 * ⚠️ 조준 AIM_Y(0.75)보다 **낮다**. 예전 팔로우(0.78)는 릴리스에서 0.03m 올라갔는데 이제
 * 0.30m 내려간다 — 스무딩(λ8)이 삼켜서 계단이 아니라 가라앉는 움직임으로 보인다.
 *
 * 캐노피 시선은 오히려 **더 안전해진다**: 카메라가 개구부 앞모서리(PIN_BAY_TOP 0.6)보다 낮아
 * 시선 기울기가 완만해진다 — 서 있는 핀 여유 0.093 → 0.180m, 튀는 핀(0.518) 0.035 → 0.106m.
 * 전광판 점유율도 27.9% → 12.4%로 내려간다. ⚠️ 그 바람에 **리플레이 파킹(18.3%)이 라이브보다
 * 더 보여주는 역전**이 생겼다. 리플레이 카메라가 공 위 0.42m라 0.529에 앉기 때문이고, 맞추려면
 * 리플레이 프레이밍을 다시 재야 하므로 별건으로 둔다(테스트는 간격 상한으로 지킨다).
 */
const FOLLOW_Y: number = APPROACH_POS.y; // (as const 리터럴 타입이 py로 전파되지 않게 number)

/** 뒷줄 코너 핀까지의 반폭 (≈0.457) — 프레임에 담아야 하는 대상. */
const RACK_HALF_W = 1.5 * PIN_SPACING;
/** 프레임 여유 15% — 현재 APPROACH_POS.z를 재현하는 값이다(아래 주석). */
const RACK_MARGIN = 1.15;

/**
 * 핀덱 접근 거리 — **종횡비에서 유도한다.**
 *
 * `PerspectiveCamera.fov`는 세로축이라 종횡비와 무관하게 고정되고 `Engine.onResize`도 fov를
 * 재계산하지 않는다. 그래서 세로 화면에선 **가로 화각만** 좁아진다. 실측(fov 40):
 *   데스크톱 aspect 0.998 → 가로 화각 39.9° · 헤드핀 거리 가시폭 1.046m
 *   세로폰   aspect 0.462 → 가로 화각 19.1° · 가시폭 0.484m
 * 핀 랙이 0.914m이므로 세로폰에선 랙이 가시폭의 **189%** — 뒷줄 코너 핀 2개가 프레임을
 * 벗어난다(실측 ndc ±1.199). ⚠️ 구 메모 "핀은 어떤 FOV·거리에서도 프레임을 안 벗어난다"는
 * 데스크톱 종횡비에서만 맞았다.
 *
 * 고치는 축은 fov가 아니라 **거리**다. 1.44m를 유지하며 랙을 담으려면 세로 fov가 76°까지 가야
 * 하고, fov는 조준 포즈(AIM_Y)와 **세트로만 바꾸는** 값이라 게임 전체 프레이밍이 바뀐다.
 *
 * 공식의 근거: 현재 상수 `APPROACH_POS.z = 16.85`는 "랙 반폭 × 1.15가 가로 화각에 꽉 차는 거리"와
 * **정확히 일치한다** — 0.457×1.15 ÷ tan(19.95°) = 1.443 → 18.29 − 1.443 = 16.847.
 * 이미 그 프레이밍으로 튜닝된 값이므로, 같은 식을 실제 종횡비로 풀면 데스크톱에서는 기존 값을
 * 그대로 재현하고 좁은 화면에서만 뒤로 물러난다(세로폰 → z ≈ 15.16, 1.7m 후퇴).
 *
 * 캐노피 시선(tests/camera-sightline.test.ts)은 안 깨진다: 카메라 y(0.45)가 캐노피 앞모서리
 * (0.6)보다 낮고 핀 꼭대기(0.38)는 더 낮아, 시선이 카메라에서 항상 **내려가** 모서리를 안 넘는다.
 * 뒤로 물러나면 기울기가 완만해질 뿐 부호는 그대로다.
 *
 * ⚠️ 카메라가 아니라 (fov, aspect)를 받는다 — 체이스 거리가 이 값에서 유도되므로 테스트가
 * 종횡비별 포즈를 직접 재야 하기 때문이다.
 */
export function approachZFor(fov: number, aspect: number): number {
  const tanH = Math.tan((fov * Math.PI) / 360) * aspect; // 가로 half-FOV의 tan
  if (!(tanH > 1e-4)) return APPROACH_POS.z;
  const need = (RACK_HALF_W * RACK_MARGIN) / tanH;
  // 넓은 화면에서 **더 가까이 붙지는 않는다** — 기존 튜닝값이 최근접 상한이다.
  return Math.min(APPROACH_POS.z, HEADPIN_Z - need);
}
// 게임오버 와이드샷도 같은 제약을 받는다. 예전 (y 3.2, z 12.5)는 시선이 캐노피에 완전히 막혔다
// (여유 −0.33). 높이를 낮추고 뒤로 빼서 넓은 그림은 유지한다.
export const GAMEOVER_POS = { y: 1.15, z: 8.5 } as const;
const FOLLOW_SMOOTH = 8; // 스무딩 λ. 6이면 8m/s에서 지연만 1.7m라 실효 추적거리가 크게 부푼다.
/**
 * 상태별 카메라 연출 (도안 §9). 목표 위치/타겟을 프레임레이트 독립 스무딩으로 보간.
 * AIMING 로우앵글(원근 강조) → ROLLING 공 뒤 실시간 팔로우 → SETTLING 핀 클로즈업.
 * 임팩트 타격감은 push-in이 맡는다 — 스무딩된 base 위에 시선 방향 offset을 얹는다(셰이크 없음).
 */
export class CameraRig {
  private readonly target = new THREE.Vector3(0, 0.1, 8);
  private readonly basePos = new THREE.Vector3(); // 스무딩된 base 위치 (push-in offset 누적 방지)
  private inited = false;
  private push = 0; // 현재 push-in 진행도 0..1 (실시간 이징)
  private pushHold = 0; // 남은 최대근접 유지 시간 (실시간 s)
  private menuTime = 0; // MENU 카메라 슬로우 스웨이용

  constructor(
    private readonly engine: Engine,
    private readonly game: GameState,
    private readonly ball: Ball,
  ) {}

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


  /**
   * @param dt 실시간 프레임 간격(스케일 없음) — push-in·메뉴 스웨이가 쓴다.
   * @param timeScale Loop.timeScale. 팔로우 스무딩은 **월드 시간**으로 돌아야 한다 — 슬로모(0.32)로
   *   공이 느려지는데 카메라만 실시간으로 스무딩하면 밀려 있던 거리(속도에 따라 1m 안팎)가 슬로모
   *   동안 훅 당겨진다. 슬로모는 핀 임팩트에서만 걸리니 하필 제일 주목하는 순간에 그게 온다.
   */
  update(dt: number, timeScale = 1) {
    const cam = this.engine.camera;
    if (!this.inited) {
      this.basePos.copy(cam.position); // Boot가 세팅한 초기 AIMING 위치에서 시작
      this.inited = true;
    }
    const b = this.ball.mesh.position; // raw 물리 위치(60fps 끊김) 대신 보간된 메시 위치를 추적

    // 기본 = 공 뒤 로우 체이스 (ROLLING·거터 SETTLING 공용, 상수는 파일 상단).
    // 하한이 조준 위치라 릴리스에서 뒤로 밀리지 않는다. 핀덱 근처(z>13)는 정지.
    // 속도 리드 — 스무딩이 만드는 정상상태 지연(v/λ)을 목표에서 미리 상쇄한다.
    // 이게 없으면 **목표는 위치로, 추격은 시간으로** 정해져 공이 빠를수록 카메라가 뒤처진다:
    // 실측 실효 추적거리 2.13m(7.4m/s) ~ 3.02m(11.0m/s), 임팩트 순간 랙 폭도 파워에 따라 11% 차이.
    // 공 크기·훅 진폭·임팩트 프레이밍이 파워마다 달라 보이던 원인이 이것이다.
    // ⚠️ 리드는 **따라가는 목표에만** 쓴다. 뒤에 오는 접근 블렌드(u)나 시선(tz)에 같이 먹이면
    // 고정 목적지에 미리 도착하는 꼴이라, 카메라가 공을 앞질러 핀덱에 가서 기다린다
    // (시뮬 실측: 최소 간격 1.4m → 0.6m, 카메라 최고속도 13.8 → 17.0 m/s). 실제로 그렇게 보였다.
    const lead = clamp(this.ball.body.linvel().z, 0, 14) / FOLLOW_SMOOTH;
    // 체이스 거리와 파킹 지점은 **같은 식에서 나온다** — 파킹은 별도 목적지가 아니라 이 클램프의
    // 상한이고, 거리는 헤드핀에서 거기까지다. 그래서 공이 헤드핀에 닿는 순간 체이스가 상한에
    // 정확히 도달한다(b.z = HEADPIN_Z → pz = parkZ). 블렌드 없이 도착이 이어지는 이유다.
    const parkZ = approachZFor(cam.fov, cam.aspect);
    const fDist = HEADPIN_Z - parkZ;
    let px = clamp(b.x * 0.4, -1, 1);
    let py = FOLLOW_Y;
    let pz = clamp(b.z + lead - fDist, AIM_PZ, parkZ);
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
        // **위치는 순수 체이스 그대로** 둔다 (위 pz 주석) — 여기서 진행도(u)에 태우는 건
        // 시선(target)과 횡(px)뿐이다. 시선이 공에서 핀덱으로 옮겨가며 프레이밍을 완성하고,
        // px는 거터로 빠진 공을 따라 화면이 기우는 걸 막으려고 0으로 모은다.
        // (거터로 빠지면(b.y) u=1로 바로 핀덱 시선 — 결과를 보여줘야 하므로.)
        // u는 **공의 실제 위치**로 잰다(리드 금지 — 위 주석). 리드를 먹이면 고정 목적지에 미리
        // 도착하는 꼴이라 카메라가 공을 앞질러 핀덱에서 기다린다.
        //
        // 예전엔 위치도 여기서 고정 핀덱 포즈로 smoothstep 블렌드했고, 그 블렌드가 만드는
        // dolly 서지(공 6.0m/s에 카메라 10.0m/s)를 DOLLY_MAX_RATE 1.35로 눌렀다. 블렌드를
        // 걷어내니 서지의 원인 자체가 없어져 상한도 같이 걷어냈다 — 실측 z 12~17 카메라/공
        // 속도비 0.97~1.39 → 1.00~1.00, 간격도 1.37~1.39m로 전 구간 고정.
        const span = HEADPIN_Z - CAM_APPROACH_Z;
        const u = b.y <= -1.5 ? 1 : clamp((b.z - CAM_APPROACH_Z) / span, 0, 1);
        const e = u * u * (3 - 2 * u); // smoothstep
        px = lerp(px, 0, e);
        tx = lerp(tx, 0, e); ty = lerp(ty, APPROACH_TARGET.y, e); tz = lerp(tz, APPROACH_TARGET.z, e);
        break;
      }
      default: // GAME_OVER
        px = 0; py = GAMEOVER_POS.y; pz = GAMEOVER_POS.z;
        tx = 0; ty = 0.3; tz = 18.8;
    }

    // 프레임레이트 독립 스무딩 (도안 §B.6). **월드 시간**으로 돈다(위 timeScale 주석).
    const k = 1 - Math.exp(-FOLLOW_SMOOTH * dt * timeScale);
    this.basePos.lerp(_v.set(px, py, pz), k);
    cam.position.copy(this.basePos);

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
