import type { Ball } from '../scene/Ball';
import type { PinSet } from '../scene/PinSet';
import type { Lane } from '../scene/Lane';
import type { Hud } from '../ui/Hud';
import {
  LANE_WIDTH,
  BALL_RADIUS,
  GUTTER_WIDTH,
  GUTTER_DEPTH,
  PIN_DECK_END,
  SETTLE_TIMEOUT,
  SLOWMO_SCALE,
  SLOWMO_REAL_SEC,
} from './constants';
import { totalScore } from './Scoreboard';
import { makeBallSpec, type BallSpec } from './BallSpec';
import { computeAiThrow, type AiProfile } from './ai';
import { detectSplit } from './splits';
import { recordGame } from './Stats';
import { resetOil, advanceOilDrying } from './oil';
import { CLASSIC_SKIN, RIVAL_SKINS, type BallSkin } from './rewards';

/**
 * 슬로모 배속 이징 (#8 추출 · 순수함수라 단위테스트 가능) — 진행도 p=timer/total(1→0)에 ease-out (1-p)²로
 * SLOWMO_SCALE에서 1.0으로 부드럽게 복원. 충돌 직후 즉시 떨궜다(하드컷 "툭 끊김" 제거) 후반에 빠르게 정상속도.
 */
export function slowmoScale(timer: number, total: number): number {
  const p = Math.max(0, Math.min(1, timer / total));
  const restore = (1 - p) * (1 - p);
  return SLOWMO_SCALE + (1 - SLOWMO_SCALE) * restore;
}

export type GameStateName = 'MENU' | 'AIMING' | 'ROLLING' | 'SETTLING' | 'GAME_OVER';
export type GameMode = 'full' | 'blitz' | 'spare';

export interface MatchPlayerConfig {
  name: string;
  ai?: AiProfile;
}

export interface MatchConfig {
  mode: GameMode;
  players: MatchPlayerConfig[]; // [0] = 사람 (스페어 챌린지는 솔로만)
  // 오일 패턴 선택은 없다 — 하우스 하나(oil.ts 주석). 예전 `oilPattern?` 옵션과 프리셋 3종은 2026-09-02에 걷었다.
}

interface PlayerState {
  name: string;
  ai?: AiProfile;
  frame: number; // 1..frames
  ball: number; // 프레임 내 투구 번호
  rolls: number[][];
  conversions: number; // spare 모드 성공 수
  strikeStreak: number; // 더블/터키 연출용
  done: boolean;
}

export interface PlayerSummary {
  name: string;
  ai: boolean;
  score: number;
  /** AI 라이벌 식별 key (사람은 undefined) — 보상 격파 판정용 */
  aiKey?: string;
  /** 프레임별 투구 — 보상 turkey 판정용 */
  rolls: number[][];
}

export interface GameSummary {
  mode: GameMode;
  frames: number;
  players: PlayerSummary[];
  /** 승자 인덱스. 솔로=0, 무승부=-1 */
  winner: number;
  newBest: boolean;
  best: number;
}

/** P2 연출/사운드의 공통 의존 — 상태머신이 노출하는 게임 이벤트 */
export type GameEvent =
  | { type: 'strike'; streak: number }
  | { type: 'spare' }
  | { type: 'gutter' }
  | { type: 'splitConverted'; label: string }
  | { type: 'gameOver'; summary: GameSummary };
// ⚠️ 'split'(발생)·'turn'(차례 교대)은 **일부러 없다.** 둘 다 emit만 하고 받는 쪽이 없었다 —
// 스플릿 발생 배너는 핀을 보면 아는 정보를 2구 조준 정면에 띄우는 부정 피드백이라 걷었고,
// 현재 차례는 점수판 골드 하이라이트가 이미 말한다. 되살릴 거면 소비처부터 만들 것.

/** 스페어 챌린지 코스 (쉬움 → 어려움, 클래식 리브) */
export const SPARE_LEAVES: number[][] = [
  [6, 10],
  [2, 4, 5, 8], // 버킷
  [3, 10], // 베이비 스플릿
  [2, 7],
  [1, 2, 4, 7], // 피켓 펜스
  [5, 7],
  [4, 6],
  [6, 7, 10],
  [4, 7, 10],
  [7, 10], // 피날레
];

/** 거터 골 바닥에 앉은 공의 중심 y (= 골 윗면 −GUTTER_DEPTH + 반지름). settleGutterPerch의 기준. */
const GUTTER_SEAT_Y = BALL_RADIUS - GUTTER_DEPTH;
/** '앉았다'로 볼 여유. 얹힌 공은 레인면 위(y≈BALL_RADIUS=0.109)라 앉은 값(0.061)과 4.8cm 벌어진다 — 그 중간. */
const SEAT_EPS = 0.024;

const AI_THINK_TIME = 0.9; // AI 투구 전 대기 (s, 시뮬 시간)
const AI_FAST_FORWARD = 1; // AI 턴 ROLLING/SETTLING 빨리감기 배속 (1=실시간, 공 굴림을 그대로 봄. 빨리감기 원하면 2~3)

/**
 * 투구 루프 상태머신 (도안 §6 + 로드맵 P1/P1.5).
 *
 *   MENU ──startMatch──▶ AIMING ──throwBall──▶ ROLLING ──핀존통과/거터/정지──▶ SETTLING
 *                           ▲                                                    │ 모두 정지
 *                           │                                                    ▼
 *                           └── 다음 투구/프레임/플레이어 교대 ◀── score() ──▶ GAME_OVER
 *
 * 점수 상태(frame/ball/rolls)는 플레이어별 분리, 물리 객체(PinSet/Ball)는 공유 (로드맵 P1.5).
 */
export class GameState {
  state: GameStateName = 'MENU';
  mode: GameMode = 'full';
  frames = 10;
  current = 0;
  /** 게임 이벤트 (스트라이크/스페어/스플릿/게임오버) — 연출·사운드 연결점 */
  onEvent?: (e: GameEvent) => void;
  /** AI 턴 빨리감기용 Loop.timeScale 주입 (Boot에서 연결) */
  setTimeScale?: (scale: number) => void;
  /** 투구당 1회 핀 임팩트 사운드 (Boot에서 SoundManager 연결). 인자 = 던질 때 서 있던 핀 수. */
  onPinImpact?: (standingCount: number) => void;
  /** 공 굴림 지속음 세기 (Boot에서 SoundManager.setRoll 연결). speed=공 속도(m/s), inGutter=거터 홈 진입. */
  /** 릴리스 — throwBall 순간 1회(사람·AI 공통). power 0~1로 사운드가 착지 '둥'의 세기를 정한다. */
  onThrow?: (power: number) => void;
  /** 굴림 럼블. timeScale = 그 스텝의 Loop.timeScale(슬로모 0.32~1) — 사운드가 피치·톤을 화면 배속에 맞춘다. */
  onRoll?: (speed: number, inGutter: boolean, timeScale: number) => void;

  private players: PlayerState[] = [];
  private settleTimer = 0;
  private gutterSettled = false; // 이번 투구에서 거터 perch 보정을 1회 적용했는가 (재스냅 방지)
  private standingAtThrow = 10;
  /** 이번 투구가 시작될 때 서 있던 핀 수 — 리플레이가 크래시를 다시 울릴 때 같은 세기를 쓴다. */
  get impactStanding(): number {
    return this.standingAtThrow;
  }
  private aiWait = 0;
  private pendingSplit: string | null = null;
  private humanSpec: BallSpec = makeBallSpec(10);
  private humanSkin: BallSkin = CLASSIC_SKIN; // 장착 볼 스킨 (보상) — 외형만
  private slowmoTimer = 0; // 남은 슬로모 시간 (sim s) — Loop.timeScale로 환산 적용
  private slowmoTotal = 1; // 발동 시점 timer 값 (진행도 0..1 산출 → 복원 이징)
  private slowmoUsed = false; // 투구당 1회 (매 throwBall 리셋)
  private wasCycling = false; // 직전 프레임의 핀세터 가동 여부 — 종료 순간 1회 HUD 갱신용

  constructor(
    private readonly ballObj: Ball,
    private readonly pins: PinSet,
    private readonly hud: Hud,
    private readonly lane: Lane,
  ) {
    this.refreshHud();
  }

  // --- 디버그/호환 접근자 (현재 플레이어 기준) ---
  get frame(): number {
    return this.currentPlayer?.frame ?? 1;
  }
  get ball(): number {
    return this.currentPlayer?.ball ?? 1;
  }

  /**
   * 던질 수 있는가 — 조준 상태이고 **핀세터가 멎어 있을 때만**.
   *
   * 예전엔 핀세터 사이클이 조준과 겹쳐 돌았다(runCycle 직후 곧장 AIMING). 그래서 레이크가
   * 데드우드를 밀고 있는데 다음 공을 던질 수 있었고, throwBall이 finishCycle()로 연출을
   * 중간에 끊어 핀이 순간이동으로 제자리에 나타났다. 실제 볼링장은 직렬이다 — 핀세터가
   * 다 돌아야 다음 투구를 한다. Controls(입력)·AI(대기)·Hud(표시)가 전부 이 하나를 본다.
   */
  get readyToThrow(): boolean {
    return this.state === 'AIMING' && !this.pins.cycling;
  }
  get rolls(): number[][] {
    return this.currentPlayer?.rolls ?? [[]];
  }
  get currentPlayer(): PlayerState | undefined {
    return this.players[this.current];
  }

  /** 입력(Controls)이 사람 차례인지 확인 */
  isHumanTurn(): boolean {
    return !this.currentPlayer?.ai;
  }

  /** 새 매치 시작 — 리셋 체크리스트 (로드맵 P1) 전부 여기서 */
  startMatch(config: MatchConfig) {
    this.mode = config.mode;
    this.frames = config.mode === 'full' ? 10 : config.mode === 'blitz' ? 3 : SPARE_LEAVES.length;
    this.players = config.players.map((p) => ({
      name: p.name,
      ai: p.ai,
      frame: 1,
      ball: 1,
      rolls: [[]],
      conversions: 0,
      strikeStreak: 0,
      done: false,
    }));
    this.current = 0;
    this.settleTimer = 0;
    this.aiWait = 0;
    this.pendingSplit = null;
    this.slowmoTimer = 0;
    this.slowmoUsed = false;
    resetOil(); // 오일 새로 깔기 = 마름 초기화 (P3)
    this.lane.applyOilVisual(); // 광택 시트 길이를 오일 길이에 맞춤 (읽기 단서)
    if (this.mode === 'spare') this.pins.setLayout(SPARE_LEAVES[0]);
    else this.pins.resetAll();
    this.standingAtThrow = this.pins.standingCount();
    this.ballObj.reset();
    this.applyBallSpecForTurn();
    this.state = 'AIMING';
    this.setTimeScale?.(1);
    this.refreshHud();
  }

  /** 메뉴로 복귀 (결과 화면에서) */
  toMenu() {
    this.state = 'MENU';
    this.players = [];
    this.pins.resetAll();
    this.ballObj.reset();
    this.slowmoTimer = 0;
    this.slowmoUsed = false;
    this.setTimeScale?.(1);
    this.refreshHud();
  }

  /** 메뉴 무게 슬라이더 → 사람 공 스펙. AI 턴엔 저장만 하고 사람 차례에 적용. */
  setHumanBallSpec(spec: BallSpec) {
    this.humanSpec = spec;
    // 메뉴 프리뷰(#1) OR 게임 중 사람 차례에 라이브 반영.
    if (this.state === 'MENU' || (this.state === 'AIMING' && this.isHumanTurn())) this.ballObj.setSpec(spec);
  }

  /** 메뉴 스킨 시트 → 사람 볼 스킨 (외형만, 물리 무영향). AI 턴엔 저장만. */
  setBallSkin(skin: BallSkin) {
    this.humanSkin = skin;
    // 라이브 반영: 메뉴 프리뷰(뒤에 보이는 씬 공, #1) OR 게임 중 사람 차례.
    if (this.state === 'MENU' || (this.state === 'AIMING' && this.isHumanTurn())) {
      this.ballObj.setSkin(skin);
    }
  }

  /** 입력에서 호출: 공 발사 (spin ∈ [-1,1] 좌/우 훅) */
  throwBall(aim: number, power: number, spin = 0) {
    if (!this.readyToThrow || !this.players.length) return;
    // 안전망 — readyToThrow가 이미 막지만, 디버그(__game.throwBall)나 미래의 우회 경로가
    // 사이클 중간의 핀 높이를 세어버리지 않게 최종 상태로 확정하고 시작한다.
    this.pins.finishCycle();
    this.standingAtThrow = this.pins.standingCount();
    this.ballObj.launch(aim, power, spin);
    this.onThrow?.(power); // 릴리스 트랜지언트 — 굴림 럼블은 0에서 페이드인이라 이게 없으면 '던진' 순간이 없다
    this.state = 'ROLLING';
    this.settleTimer = 0;
    this.slowmoUsed = false;
    this.slowmoTimer = 0;
    this.gutterSettled = false;
    this.refreshHud();
  }

  /**
   * 임팩트 평가 — **매 물리 스텝 update()가 부른다.** (Boot의 engine.onContact가 아니다.
   * 그쪽은 카메라 push-in만 맡는다.)
   *
   * 판정 기준은 z도 접촉 시간도 아니라 **핀이 실제로 움직였는가**다(|v| > 0.5 m/s).
   * 고정 z 트리거는 핀이 이미 치워진 자리(2구)나 핀 옆을 스쳐 지나갈 때 헛발동했다.
   * 발동하면 투구당 1회 슬로모 + 크래시 사운드. 거터·빗나감엔 둘 다 없다.
   */
  notifyImpact() {
    // ROLLING뿐 아니라 SETTLING도 허용 — 코너/사이드 핀(7·10, 스페어)은 공이 레인 끝(inGutter)이나
    // 핀덱 z를 먼저 넘겨 SETTLING으로 전환된 뒤에야 맞아 움직인다. ROLLING만 게이트하면 그 임팩트음이
    // 통째로 씹혀 "사이드 핀 무음"이 됐다. slowmoUsed가 여전히 투구당 1회를 보장.
    if (this.slowmoUsed || (this.state !== 'ROLLING' && this.state !== 'SETTLING')) return;
    // 실제로 핀이 맞아 움직이기 시작한 순간에만 발동. 거터·빗나감·핀 옆 통과(어떤 핀도
    // 안 움직임)엔 사운드·슬로모 둘 다 없음. z평면 통과 기준은 핀이 이미 치워진 자리(2구)나
    // 핀을 안 건드리고 지나가도 헛발동했다 → 핀 실제 움직임으로 판정(가장 견고).
    // 매 물리 스텝 호출이라 .some() 클로저 할당을 피해 for 루프로(#12). 동작 동일.
    let hit = false;
    for (const p of this.pins.pins) {
      if (p.body.translation().y < -1) continue; // 치워진 핀(stash y=-50, 중력으로 낙하 중) 제외 — 2구 시작 시 헛발동 방지.
      const v = p.body.linvel();
      if (v.x * v.x + v.y * v.y + v.z * v.z > 0.25) { hit = true; break; } // |v| > 0.5 m/s = 충돌로 움직임
    }
    if (hit) {
      this.slowmoUsed = true;
      this.slowmoTimer = SLOWMO_REAL_SEC * SLOWMO_SCALE; // 실시간 SLOWMO_REAL_SEC (배속 보정)
      this.slowmoTotal = this.slowmoTimer; // 진행도 기준값 (복원 이징)
      this.onPinImpact?.(this.standingAtThrow); // 투구당 1회 크래시
    }
  }

  /** Loop의 물리 스텝마다 호출 */
  update(dt: number) {
    // 핀세터 연출은 상태머신과 독립으로 굴린다 — 얼리 리턴 뒤에 두면 마지막 프레임 직후
    // GAME_OVER로 넘어갈 때 핀이 공중에 뜬 채 얼어붙는다.
    this.pins.update(dt);
    // 사이클이 방금 끝났으면 HUD를 한 번 갱신 — '핀 정리 중…' 라벨과 남은 핀 수가
    // 연출 종료 시점에 맞춰 확정된다(사이클 중 standingCount는 중간값이라 못 믿는다).
    if (this.wasCycling && !this.pins.cycling) this.refreshHud();
    this.wasCycling = this.pins.cycling;
    if (this.state === 'MENU' || this.state === 'GAME_OVER' || !this.players.length) return;

    // 오일/드라이 마찰 전환 (단일 바닥 콜라이더, Lane.updateFriction 참고).
    // Loop가 아니라 여기 두는 이유: 수동 스텝 디버그(__engine.step + __game.update)에서도 동작해야 함
    this.lane.updateFriction(this.ballObj.body.translation().z);

    // 굴림 럼블 오디오 + 임팩트(사운드·슬로모) + 시간 배속 — 각각 헬퍼로 분리(#8).
    this.latchLaneExit(); // 레인 이탈 래치 (상태 분기보다 앞 — 그 이유는 메서드 주석)
    this.notifyImpact(); // 핀이 움직였는지로 임팩트 판정 (고정 z 트리거 폐기 — 그 주석 참고)
    const timeScale = this.computeTimeScale(dt); // AI 빨리감기(P1.5) vs 임팩트 슬로모(P2, 우선)
    this.setTimeScale?.(timeScale);
    this.updateRollAudio(timeScale); // notifyImpact 뒤 — 슬로모가 걸린 그 스텝부터 굴림음도 같이 늘어진다

    const ai = this.currentPlayer?.ai;
    if (this.state === 'AIMING') {
      // 핀세터가 도는 동안은 생각 시간도 세지 않는다 — 안 그러면 사이클이 끝나는 순간
      // 이미 AI_THINK_TIME이 차 있어 AI가 뜸 없이 즉발한다.
      if (ai && !this.pins.cycling) {
        this.aiWait += dt;
        if (this.aiWait >= AI_THINK_TIME) {
          this.aiWait = 0;
          const xs = this.pins
            .standingMask()
            .map((s, i) => (s ? this.pins.pins[i].home.x : null))
            .filter((x): x is number => x !== null);
          const t = computeAiThrow(ai, xs);
          this.throwBall(t.aim, t.power, t.spin);
        }
      }
    } else if (this.state === 'ROLLING') {
      this.ballObj.applySpinForce(dt); // 훅 측면력 (도안 §4.1)
      const t = this.ballObj.body.translation();
      const inGutter = Math.abs(t.x) > LANE_WIDTH / 2 - BALL_RADIUS;
      // 레인 이탈 래치는 여기 두지 않는다 — latchLaneExit() 주석 참고 (상태 분기 밖에서 돈다).
      // 핀존 통과 / 거터 / 레인 밖 낙하 (도안 §4.2 전환 조건)
      if (t.z > PIN_DECK_END || inGutter || t.y < -2) {
        this.state = 'SETTLING';
        this.settleTimer = 0;
        this.refreshHud(); // 상태 표시 갱신 (없으면 ROLLING으로 멈춰 보임)
      }
    } else if (this.state === 'SETTLING') {
      this.settleTimer += dt;
      this.settleGutterPerch(); // 레인 끝 모서리에 얹힌 느린 거터볼을 골로 굴려넣음 (perch 버그 보정)
      const done = this.pins.allSettled() && this.ballGoneOrStopped();
      if (done || this.settleTimer > SETTLE_TIMEOUT) {
        this.score();
      }
    }
  }

  /**
   * 레인 이탈 래치 — 공 중심이 레인 폭을 벗어나면 그 투구 내내 핀 충돌을 끈다(다시 안 켠다).
   * `ballObj.reset()`이 다음 투구에서 되돌린다. USBC상 공이 레인을 벗어난 뒤의 핀폴은 인정되지
   * 않으므로 규칙과도 일치한다. 무엇을 막는지는 `Ball.setPinCollision` 주석 참고 — 규격 깊이
   * 거터(47.6mm)는 얕아서 홈에 앉은 공이 코너 핀(7·10)에 11.6mm 파고든다.
   *
   * ⚠️ **상태 분기 안에 두지 말 것** (2026-09-02, 이 자리로 옮긴 이유).
   * 예전엔 ROLLING 분기 안에 있었는데, SETTLING 전환 문턱(`|x| > LANE_WIDTH/2 − BALL_RADIUS` = 0.416)이
   * 래치 문턱(`|x| > LANE_WIDTH/2` = 0.525)보다 **앞**이라 공이 0.416에서 SETTLING으로 빠져나간 뒤
   * 0.525를 넘어도 이 코드가 더는 안 돌았다. 두 문턱을 한 스텝(1/60s)에 건너뛰려면 횡속 6.5 m/s가
   * 필요한데 실제 훅은 1~2 m/s대라 **사실상 한 번도 발동하지 않았다.**
   * 실측(`GUTTER_SIM=1`, 플레이어 조준 범위 ±AIM_RANGE 안): 거터 홈까지 빠진 60투구 중 래치 발동 0 ·
   * 무효 핀폴 58투구 / **113핀**. 이 자리로 옮기니 **0핀**, 레인에 남은 투구 79개는 핀폴 전부 동일(오탐 0).
   */
  private latchLaneExit() {
    const t = this.ballObj.body.translation();
    // z 가드: 핀덱을 지난 뒤(피트 안)엔 새로 잠그지 않는다. 거기선 이미 핀폴이 끝났고, 잠그면
    // 피트로 굴러떨어지는 핀이 공을 통과해 버린다. 레인에서 이미 걸린 래치는 그대로 유지된다(래치니까).
    if (t.z <= PIN_DECK_END && Math.abs(t.x) > LANE_WIDTH / 2) this.ballObj.setPinCollision(false);
  }

  /** 공 굴림 럼블 오디오 — 레인 위 굴림/안착 중 공 속도로 지속 저역음, 그 외 0. (#8 update()에서 추출) */
  private updateRollAudio(timeScale: number): void {
    if (!this.onRoll) return;
    const rolling = this.state === 'ROLLING' || this.state === 'SETTLING';
    const tr = this.ballObj.body.translation();
    const onLane = tr.z < PIN_DECK_END; // 핀덱 뒤로 넘어가면(핀 충돌·핏 진입) 굴림음 차단
    const inGutter = Math.abs(tr.x) > LANE_WIDTH / 2; // 레인 끝을 넘어 거터 홈 → 홀로우 음색
    const rv = this.ballObj.body.linvel();
    this.onRoll(rolling && onLane ? Math.hypot(rv.x, rv.y, rv.z) : 0, inGutter, timeScale);
  }

  /**
   * Loop.timeScale 값 산출 (#8 update()에서 추출) — AI 턴 빨리감기(P1.5) vs 임팩트 슬로모(P2), 슬로모 우선.
   * 슬로모 활성 시 slowmoTimer를 dt만큼 소모(sim 시간)하고 이징된 배속(slowmoScale)을 반환. 아니면 빨리감기/1.
   */
  private computeTimeScale(dt: number): number {
    if (this.slowmoTimer > 0) {
      this.slowmoTimer -= dt;
      return slowmoScale(this.slowmoTimer, this.slowmoTotal);
    }
    const ai = this.currentPlayer?.ai;
    const fastForward = !!ai && (this.state === 'ROLLING' || this.state === 'SETTLING');
    return fastForward ? AI_FAST_FORWARD : 1;
  }

  private ballGoneOrStopped(): boolean {
    const b = this.ballObj.body;
    const v = b.linvel();
    const t = b.translation();
    const speed = Math.hypot(v.x, v.y, v.z);
    return speed < 0.15 || t.y < -2 || t.z > PIN_DECK_END + 1;
  }

  /**
   * 느린 거터볼이 레인 끝 모서리에 얹힌 채(perch) 정산되는 버그 보정. 거터 홈(윗면 y=-0.13)이
   * 공 반지름(0.109)보다 얕아, 느린 공이 레인 끝(±LANE_WIDTH/2) 날카로운 모서리에 균형을 잡고
   * 골로 안 빠진다(물리 빗면 시도는 회귀). 정산 순간 거터 x구역(|x|>레인끝-r)에 있으면서 아직
   * 골로 안 내려갔으면(y>-0.05) 거터 골 중앙에 결정적으로 안착시켜 표시 위치를 정리한다.
   * 이미 정산 끝난 죽은 공이라 점수·물리 부작용 없음.
   */
  private settleGutterPerch() {
    if (this.gutterSettled) return;
    const b = this.ballObj.body;
    const t = b.translation();
    // 공 중심이 레인 끝(±LANE_WIDTH/2)을 넘었는데 아직 골에 안 앉았으면, 공이 거터 홈으로 빠지지 못하고
    // 레인 끝 날카로운 모서리에 얹혀 그 위를 타고 가는 상태다(거터 홈이 공 반지름보다 얕아 생기는 perch).
    // 이때 거터 골로 떨궈 넣고, 현실 볼링처럼 핀 쪽 끝까지 굴러가 '빠지도록' 전진 속도를 부여한다
    // (골 마찰 0.08 기준 뒤끝 도달 속도, 정산은 z>핀덱에서 자연히 일어남).
    //
    // "골에 앉았다"의 기준은 GUTTER_SEAT_Y다. 예전엔 상수 없이 `t.y <= -0.01`과 `y = -0.13 + BALL_RADIUS`를
    // 하드코딩하고 있었는데, 그 −0.13은 Lane.ts가 규격 깊이 GUTTER_DEPTH(0.0476)로 옮기기 전의 옛 거터
    // 깊이였다. 그대로 두면 ① 앉은 공 중심이 실제로는 +0.061인데 가드가 −0.01이라 **이미 골에 잘 앉은
    // 공까지 매번 보정**하고 ② 그 보정이 공을 골 바닥보다 8.2cm 아래로 처박아 한 프레임 파묻혔다 튀어나온다.
    if (Math.abs(t.x) < LANE_WIDTH / 2 || t.y <= GUTTER_SEAT_Y + SEAT_EPS || t.z > PIN_DECK_END) return;
    this.gutterSettled = true;
    const side = Math.sign(t.x);
    const roll = Math.min(8, Math.sqrt(2 * 0.785 * (PIN_DECK_END + 1 - t.z + 0.5)));
    b.setTranslation({ x: side * (LANE_WIDTH / 2 + GUTTER_WIDTH / 2), y: GUTTER_SEAT_Y, z: t.z }, true);
    b.setLinvel({ x: 0, y: 0, z: roll }, true);
    b.setAngvel({ x: roll / BALL_RADIUS, y: 0, z: 0 }, true);
  }

  private emit(e: GameEvent) {
    this.onEvent?.(e);
  }

  /** SETTLING 완료 → 핀 카운트 → 프레임 진행 결정 (정지 후 1회, 도안 §4.3) */
  private score() {
    const p = this.currentPlayer!;
    const standing = this.pins.standingCount();
    const knocked = Math.max(0, this.standingAtThrow - standing);
    p.rolls[p.frame - 1].push(knocked);

    // 거터(쓰러뜨린 핀 0) — 스트라이크/스페어처럼 메인 배너 연출 (모드 무관)
    if (knocked === 0) this.emit({ type: 'gutter' });

    if (this.mode === 'spare') {
      this.scoreSpareMode(standing);
      return;
    }

    // 스플릿 감지: 풀랙에 던진 공이 핀을 남겼을 때 (로드맵 P1).
    // 게이트가 standingAtThrow === 10 뿐인 이유: 10프레임은 1구 스트라이크 뒤 2·3구도 새 랙이라
    // 사실상 '1구'다. p.ball === 1까지 요구하면 그 보너스 랙에서 난 스플릿을 메꿔도 splitConverted가
    // 안 떠서, 볼링에서 제일 어려운 샷이 제일 극적인 자리에서 아무 반응 없이 지나간다.
    // 일반 프레임 2구가 걸리는 경우(1구 거터 후 2구 스플릿)는 그 프레임이 곧 끝나며
    // finishFrame이 pendingSplit을 지우므로 화면에 드러나지 않는다.
    if (this.standingAtThrow === 10 && standing > 0) {
      // 발생 자체는 연출하지 않는다(위 GameEvent 주석) — 메꿨을 때 splitConverted가 쓰려고 들고만 있는다.
      const info = detectSplit(this.pins.standingMask());
      if (info.isSplit) this.pendingSplit = info.label;
    }

    if (p.frame < this.frames) {
      this.scoreNormalFrame(standing);
    } else {
      this.scoreLastFrame(standing);
    }
    this.refreshHud();
  }

  /**
   * 다음 투구 준비 — 핀세터를 돌리고 공을 되돌려 조준으로 되돌아간다.
   * 프레임 안에서 다음 구로 넘어가는 자리(2구·10프레임 보너스)마다 같은 네 줄이라 묶었다.
   * @param cycle 'respot' = 선 핀은 스폿에 되놓고 데드우드만 쓸어냄 · 'rack' = 새 10개
   */
  private nextBall(cycle: 'respot' | 'rack') {
    this.pins.runCycle(cycle);
    this.ballObj.reset();
    this.state = 'AIMING';
    this.aiWait = 0;
  }

  /** 일반 프레임: 스트라이크(1구 전멸) 또는 2구 완료 시 프레임 종료 */
  private scoreNormalFrame(standing: number) {
    const p = this.currentPlayer!;
    const strike = p.ball === 1 && standing === 0;
    if (strike) {
      p.strikeStreak += 1;
      this.emit({ type: 'strike', streak: p.strikeStreak });
    }
    if (strike || p.ball === 2) {
      if (!strike) {
        p.strikeStreak = 0;
        if (standing === 0) {
          // 스페어 — 스플릿을 메꿨으면 그 연출이 우선
          if (this.pendingSplit) this.emit({ type: 'splitConverted', label: this.pendingSplit });
          else this.emit({ type: 'spare' });
        }
      }
      this.finishFrame();
    } else {
      p.ball = 2;
      this.nextBall('respot');
    }
  }

  /** 마지막 프레임: 스트라이크/스페어 시 보너스 투구 (최대 3구, 도안 §7) */
  private scoreLastFrame(standing: number) {
    const p = this.currentPlayer!;
    const f = p.rolls[this.frames - 1];

    // 이벤트: 풀랙을 한 구에 전멸 = 스트라이크, 잔여 핀 정리 = 스페어
    if (standing === 0) {
      if (this.standingAtThrow === 10) {
        p.strikeStreak += 1;
        this.emit({ type: 'strike', streak: p.strikeStreak });
      } else if (this.pendingSplit) {
        this.emit({ type: 'splitConverted', label: this.pendingSplit });
        this.pendingSplit = null;
      } else {
        this.emit({ type: 'spare' });
      }
    } else {
      p.strikeStreak = 0;
    }

    // 다 치웠으면 새 랙, 남았으면 그 핀을 스폿에 되놓는다 — 10프레임 보너스 규칙 그대로.
    const cycle = standing === 0 ? 'rack' : 'respot';
    if (p.ball === 1) {
      p.ball = 2;
      this.nextBall(cycle);
    } else if (p.ball === 2) {
      const earnedBonus = f[0] === 10 || f[0] + f[1] === 10; // 1구 스트라이크 또는 스페어
      if (earnedBonus) {
        p.ball = 3;
        this.nextBall(cycle);
      } else {
        this.finishFrame();
      }
    } else {
      this.finishFrame(); // 3구 종료
    }
  }

  /** 스페어 챌린지: 라운드당 1구, 전부 치우면 성공 (로드맵 P1 경량 모드) */
  private scoreSpareMode(standing: number) {
    const p = this.currentPlayer!;
    if (standing === 0) {
      p.conversions += 1;
      this.emit({ type: 'spare' });
    }
    if (p.frame >= this.frames) {
      this.gameOver();
    } else {
      p.frame += 1;
      p.ball = 1;
      p.rolls.push([]);
      this.pins.setLayout(SPARE_LEAVES[p.frame - 1]);
      this.ballObj.reset();
      this.state = 'AIMING';
      this.aiWait = 0; // 스페어 모드는 핀세터 사이클 없이 레이아웃을 갈아끼운다 — nextBall을 안 쓴다
    }
    this.refreshHud();
  }

  /** 현재 플레이어의 프레임 종료 → 다음 플레이어/프레임 교대 (로드맵 P1.5) */
  private finishFrame() {
    const p = this.currentPlayer!;
    this.pendingSplit = null;
    p.frame += 1;
    p.ball = 1;
    if (p.frame > this.frames) p.done = true;
    else p.rolls.push([]);

    // 레인 마름 (P3): 프레임이 진행될수록 오일이 닳아 훅이 일찍 산다. full 모드만 체감.
    // 공유 레인이라 방금 끝낸 플레이어의 완료 프레임 수를 근사로 사용(멀티는 약간 과소계상, v1 허용).
    if (this.mode === 'full') advanceOilDrying(p.frame - 1);

    // 교대: 다음 미완료 플레이어. 전원 완료면 게임 종료.
    for (let i = 1; i <= this.players.length; i++) {
      const next = (this.current + i) % this.players.length;
      if (!this.players[next].done) {
        this.current = next;
        this.pins.runCycle('rack');
        this.ballObj.reset();
        this.applyBallSpecForTurn();
        this.state = 'AIMING';
        this.aiWait = 0;
        return;
      }
    }
    this.gameOver();
  }

  private playerScore(p: PlayerState): number {
    return this.mode === 'spare' ? p.conversions : totalScore(p.rolls.flat(), this.frames);
  }

  private gameOver() {
    const scores = this.players.map((p) => this.playerScore(p));
    let winner = 0;
    if (this.players.length > 1) {
      const max = Math.max(...scores);
      const tops = scores.filter((s) => s === max).length;
      winner = tops > 1 ? -1 : scores.indexOf(max);
    }
    // 사람은 항상 players[0] 하나 — 솔로든 vs AI든 소유자 기록으로 남긴다.
    const { newBest, best } = recordGame(this.mode, scores[0], this.players[0].rolls, this.frames);
    this.state = 'GAME_OVER';
    this.setTimeScale?.(1);
    this.refreshHud();
    this.emit({
      type: 'gameOver',
      summary: {
        mode: this.mode,
        frames: this.frames,
        players: this.players.map((p, i) => ({ name: p.name, ai: !!p.ai, score: scores[i], aiKey: p.ai?.key, rolls: p.rolls })),
        winner,
        newBest,
        best,
      },
    });
  }

  private applyBallSpecForTurn() {
    const p = this.currentPlayer;
    if (!p) return;
    if (p.ai) {
      // AI = 난이도별 색(신스랭크 + 은은한 글로우). key로 매핑, 미상은 클래식 폴백.
      this.ballObj.setSpec(makeBallSpec(p.ai.ballLb));
      this.ballObj.setSkin(RIVAL_SKINS[p.ai.key] ?? CLASSIC_SKIN);
    } else {
      // 사람 = 내 스킨.
      this.ballObj.setSpec(this.humanSpec);
      this.ballObj.setSkin(this.humanSkin);
    }
  }

  private refreshHud() {
    this.hud.update({
      state: this.state,
      mode: this.mode,
      frames: this.frames,
      current: this.current,
      resetting: this.pins.cycling, // 핀세터 가동 중 — 조준 대신 '핀 정리 중…'
      // 남은 핀 인디케이터용. 이 호출 지점들(상태 전이 + 사이클 종료)이 곧 마스크가 확정되는
      // 시점이라 그대로 넘긴다 — 사이클 중 값은 HUD가 resetting으로 걸러 안 그린다.
      standing: this.pins.standingMask(),
      players: this.players.map((p) => ({
        name: p.name,
        ai: !!p.ai,
        frame: p.frame,
        ball: p.ball,
        rolls: p.rolls,
        conversions: p.conversions,
      })),
    });
  }
}
