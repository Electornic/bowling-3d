import type { Ball } from '../scene/Ball';
import type { PinSet } from '../scene/PinSet';
import type { Lane } from '../scene/Lane';
import type { Hud } from '../ui/Hud';
import {
  LANE_WIDTH,
  BALL_RADIUS,
  GUTTER_WIDTH,
  PIN_DECK_END,
  SETTLE_TIMEOUT,
  PIN_CONTACT_Z,
  SLOWMO_SCALE,
  SLOWMO_REAL_SEC,
} from './constants';
import { totalScore } from './Scoreboard';
import { makeBallSpec, type BallSpec } from './BallSpec';
import { computeAiThrow, type AiProfile } from './ai';
import { detectSplit } from './splits';
import { recordGame } from './Stats';
import { resetOil, advanceOilDrying, type OilPattern } from './oil';
import { CLASSIC_SKIN, type BallSkin } from './rewards';

export type GameStateName = 'MENU' | 'AIMING' | 'ROLLING' | 'SETTLING' | 'GAME_OVER';
export type GameMode = 'full' | 'blitz' | 'spare';
/** 예측선 난이도 (조준 보조) — P3. UI 전용, 점수·물리 무영향. */
export type AimAid = 'easy' | 'normal' | 'pro';

export interface MatchPlayerConfig {
  name: string;
  ai?: AiProfile;
}

export interface MatchConfig {
  mode: GameMode;
  players: MatchPlayerConfig[]; // [0] = 사람 (스페어 챌린지는 솔로만)
  oilPattern?: OilPattern; // 오일 패턴 (기본 'house') — P3 라인 읽기 숙련
  aimAid?: AimAid; // 예측선 난이도 (기본 'easy' — §2.7 스마트 기본값) — P3, UI 전용
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
  | { type: 'split'; label: string }
  | { type: 'splitConverted'; label: string }
  | { type: 'turn'; playerIndex: number; playerName: string; ai: boolean }
  | { type: 'gameOver'; summary: GameSummary };

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
  aimAid: AimAid = 'easy'; // 예측선 난이도 (Controls가 읽음) — P3, UI 전용. 기본 easy(§2.7 스마트 기본값)

  /** 게임 이벤트 (스트라이크/스페어/스플릿/게임오버) — 연출·사운드 연결점 */
  onEvent?: (e: GameEvent) => void;
  /** AI 턴 빨리감기용 Loop.timeScale 주입 (Boot에서 연결) */
  setTimeScale?: (scale: number) => void;
  /** 투구당 1회 핀 임팩트 사운드 (Boot에서 SoundManager 연결). 인자 = 던질 때 서 있던 핀 수. */
  onPinImpact?: (standingCount: number) => void;

  private players: PlayerState[] = [];
  private settleTimer = 0;
  private gutterSettled = false; // 이번 투구에서 거터 perch 보정을 1회 적용했는가 (재스냅 방지)
  private standingAtThrow = 10;
  private aiWait = 0;
  private pendingSplit: string | null = null;
  private humanSpec: BallSpec = makeBallSpec(10);
  private humanSkin: BallSkin = CLASSIC_SKIN; // 장착 볼 스킨 (보상) — 외형만
  private slowmoTimer = 0; // 남은 슬로모 시간 (sim s) — Loop.timeScale로 환산 적용
  private slowmoUsed = false; // 투구당 1회 (매 throwBall 리셋)

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
  get rolls(): number[][] {
    return this.currentPlayer?.rolls ?? [[]];
  }
  get currentPlayer(): PlayerState | undefined {
    return this.players[this.current];
  }

  /** 입력(Controls/BallPicker)이 사람 차례인지 확인 */
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
    this.aimAid = config.aimAid ?? 'easy'; // 예측선 난이도 (P3, UI 전용) — 기본 easy(§2.7)
    const oilPattern = config.oilPattern ?? 'house';
    resetOil(oilPattern); // 오일 프리셋 적용 + 마름 초기화 (P3)
    this.lane.applyOilVisual(oilPattern); // 광택 시트 길이를 프리셋에 맞춤 (읽기 단서)
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

  /** BallPicker → 사람 공 스펙. AI 턴엔 저장만 하고 사람 차례에 적용. */
  setHumanBallSpec(spec: BallSpec) {
    this.humanSpec = spec;
    if (this.state === 'AIMING' && this.isHumanTurn()) this.ballObj.setSpec(spec);
  }

  /** 메뉴 스킨 시트 → 사람 볼 스킨 (외형만, 물리 무영향). AI 턴엔 저장만. */
  setBallSkin(skin: BallSkin) {
    this.humanSkin = skin;
    if (this.state === 'AIMING' && this.isHumanTurn()) this.ballObj.setSkin(skin);
  }

  /** 입력에서 호출: 공 발사 (spin ∈ [-1,1] 좌/우 훅) */
  throwBall(aim: number, power: number, spin = 0) {
    if (this.state !== 'AIMING' || !this.players.length) return;
    this.standingAtThrow = this.pins.standingCount();
    this.ballObj.launch(aim, power, spin);
    this.state = 'ROLLING';
    this.settleTimer = 0;
    this.slowmoUsed = false;
    this.slowmoTimer = 0;
    this.gutterSettled = false;
    this.refreshHud();
  }

  /**
   * 충돌 신호 (Boot에서 engine.onContact 배선). 굴러온 공이 핀 구역에 닿는
   * 첫 임팩트면 투구당 1회 슬로모 발동 (거터볼 제외 — 레인 위 공만).
   * 트리거 빈도를 줄이려면: PIN_CONTACT_Z 상향, ball===1 게이트 추가, 또는 magnitude 임계 추가.
   */
  notifyImpact() {
    if (this.slowmoUsed || this.state !== 'ROLLING') return;
    const t = this.ballObj.body.translation();
    if (t.z > PIN_CONTACT_Z && Math.abs(t.x) < LANE_WIDTH / 2) {
      this.slowmoUsed = true;
      this.slowmoTimer = SLOWMO_REAL_SEC * SLOWMO_SCALE; // 실시간 SLOWMO_REAL_SEC (배속 보정)
      this.onPinImpact?.(this.standingAtThrow); // 투구당 1회 크래시 (개별 contact 사운드 대신)
    }
  }

  /** Loop의 물리 스텝마다 호출 */
  update(dt: number) {
    if (this.state === 'MENU' || this.state === 'GAME_OVER' || !this.players.length) return;

    // 오일/드라이 마찰 전환 (단일 바닥 콜라이더, Lane.updateFriction 참고).
    // Loop가 아니라 여기 두는 이유: 수동 스텝 디버그(__engine.step + __game.update)에서도 동작해야 함
    this.lane.updateFriction(this.ballObj.body.translation().z);

    // 시간 배속 (물리 dt는 그대로, accumulator 유입만 스케일 — Loop.timeScale).
    // AI 턴 빨리감기(P1.5) vs 임팩트 슬로모(P2) — 슬로모가 활성일 땐 그게 우선.
    const ai = this.currentPlayer?.ai;
    const fastForward = !!ai && (this.state === 'ROLLING' || this.state === 'SETTLING');
    let scale = fastForward ? AI_FAST_FORWARD : 1;
    if (this.slowmoTimer > 0) {
      // dt는 sim 시간. 슬로모 중 scale배로 흐르므로, 실시간 T초 = sim (T·scale)초 소비.
      // 따라서 timer를 (REAL_SEC·SCALE) sim초로 잡으면 실시간 REAL_SEC 동안 지속된다.
      this.slowmoTimer -= dt;
      scale = SLOWMO_SCALE;
    }
    this.setTimeScale?.(scale);

    if (this.state === 'AIMING') {
      if (ai) {
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
    // 공 중심이 레인 끝(±LANE_WIDTH/2)을 넘었는데 아직 골(y≈-0.02)에 안 떨어졌으면, 공이 거터 홈으로
    // 빠지지 못하고 레인 끝 날카로운 모서리에 얹혀 그 위를 타고 가는 상태다(거터 홈이 공 반지름보다 얕아
    // 생기는 perch). 이때 거터 골로 떨궈 넣고, 현실 볼링처럼 핀 쪽 끝까지 굴러가 '빠지도록' 전진 속도를
    // 부여한다(골 마찰 0.08 기준 뒤끝 도달 속도, 정산은 z>핀덱에서 자연히 일어남).
    if (Math.abs(t.x) < LANE_WIDTH / 2 || t.y <= -0.01 || t.z > PIN_DECK_END) return;
    this.gutterSettled = true;
    const side = Math.sign(t.x);
    const roll = Math.min(8, Math.sqrt(2 * 0.785 * (PIN_DECK_END + 1 - t.z + 0.5)));
    b.setTranslation({ x: side * (LANE_WIDTH / 2 + GUTTER_WIDTH / 2), y: -0.13 + BALL_RADIUS, z: t.z }, true);
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

    // 스플릿 감지: 프레임 1구(풀랙) 후 (로드맵 P1)
    if (p.ball === 1 && this.standingAtThrow === 10 && standing > 0) {
      const info = detectSplit(this.pins.standingMask());
      if (info.isSplit) {
        this.pendingSplit = info.label;
        this.emit({ type: 'split', label: info.label });
      }
    }

    if (p.frame < this.frames) {
      this.scoreNormalFrame(standing);
    } else {
      this.scoreLastFrame(standing);
    }
    this.refreshHud();
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
      this.pins.respot(); // 선 핀은 제자리에 똑바로 재배치 + 데드우드 치움 (자동 핀세터 리스팟)
      p.ball = 2;
      this.ballObj.reset();
      this.state = 'AIMING';
      this.aiWait = 0;
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

    if (p.ball === 1) {
      if (standing === 0) this.pins.resetAll();
      else this.pins.respot();
      p.ball = 2;
      this.ballObj.reset();
      this.state = 'AIMING';
      this.aiWait = 0;
    } else if (p.ball === 2) {
      const earnedBonus = f[0] === 10 || f[0] + f[1] === 10; // 1구 스트라이크 또는 스페어
      if (earnedBonus) {
        if (standing === 0) this.pins.resetAll();
        else this.pins.respot();
        p.ball = 3;
        this.ballObj.reset();
        this.state = 'AIMING';
        this.aiWait = 0;
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
      this.aiWait = 0;
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
        const switched = next !== this.current;
        this.current = next;
        this.pins.resetAll();
        this.ballObj.reset();
        this.applyBallSpecForTurn();
        this.state = 'AIMING';
        this.aiWait = 0;
        if (switched && this.players.length > 1) {
          const np = this.players[next];
          this.emit({ type: 'turn', playerIndex: next, playerName: np.name, ai: !!np.ai });
        }
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
    // 통계는 사람([0])만 기록
    const { newBest, best } = recordGame(
      this.mode,
      scores[0],
      this.players[0].rolls,
      this.frames,
    );
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
    if (p?.ai) {
      this.ballObj.setSpec(makeBallSpec(p.ai.ballLb));
      this.ballObj.setSkin(CLASSIC_SKIN); // AI는 항상 기본 스킨
    } else {
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
      standing: this.pins.standingCount(),
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
