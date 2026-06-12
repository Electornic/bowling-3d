import type { Ball } from '../scene/Ball';
import type { PinSet } from '../scene/PinSet';
import type { Lane } from '../scene/Lane';
import type { Hud } from '../ui/Hud';
import { LANE_WIDTH, BALL_RADIUS, PIN_DECK_END, SETTLE_TIMEOUT } from './constants';
import { totalScore } from './Scoreboard';

export type GameStateName = 'AIMING' | 'ROLLING' | 'SETTLING' | 'GAME_OVER';

/**
 * 투구 루프 상태머신 (도안 §6). M3 범위: 흐름 + 데드우드 + 프레임 진행.
 * 정식 점수 계산(스트라이크/스페어 보너스)은 M4 Scoreboard에서.
 *
 *   AIMING ──throwBall──▶ ROLLING ──핀존통과/거터/정지──▶ SETTLING
 *      ▲                                                      │ 모두 정지
 *      │                                                      ▼
 *      └─ 2구 준비(데드우드 제거) ◀── SCORING ──프레임종료──▶ 다음 프레임/GAME_OVER
 */
export class GameState {
  state: GameStateName = 'AIMING';
  frame = 1; // 1..10
  ball = 1; // 프레임 내 투구 번호
  rolls: number[][] = [[]]; // 프레임별 쓰러뜨린 핀 기록

  private settleTimer = 0;
  private standingAtThrow = 10; // 이번 투구 직전 서 있던 핀 수

  constructor(
    private readonly ballObj: Ball,
    private readonly pins: PinSet,
    private readonly hud: Hud,
    private readonly lane: Lane,
  ) {
    this.refreshHud();
  }

  /** 입력에서 호출: 공 발사 (spin ∈ [-1,1] 좌/우 훅) */
  throwBall(aim: number, power: number, spin = 0) {
    if (this.state !== 'AIMING') return;
    this.standingAtThrow = this.pins.standingCount();
    this.ballObj.launch(aim, power, spin);
    this.state = 'ROLLING';
    this.refreshHud();
  }

  /** Loop의 물리 스텝마다 호출 */
  update(dt: number) {
    // 오일/드라이 마찰 전환 (단일 바닥 콜라이더, Lane.updateFriction 참고).
    // Loop가 아니라 여기 두는 이유: 수동 스텝 디버그(__engine.step + __game.update)에서도 동작해야 함
    this.lane.updateFriction(this.ballObj.body.translation().z);
    if (this.state === 'ROLLING') {
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

  /** SETTLING 완료 → 핀 카운트 → 프레임 진행 결정 (정지 후 1회, 도안 §4.3) */
  private score() {
    const standing = this.pins.standingCount();
    const knocked = this.standingAtThrow - standing;
    this.rolls[this.frame - 1].push(Math.max(0, knocked));

    if (this.frame < 10) {
      this.scoreNormalFrame(standing);
    } else {
      this.scoreTenthFrame(standing);
    }
    this.refreshHud();
  }

  /** 프레임 1~9: 스트라이크(1구 전멸) 또는 2구 완료 시 다음 프레임 */
  private scoreNormalFrame(standing: number) {
    const strike = this.ball === 1 && standing === 0;
    if (strike || this.ball === 2) {
      this.advanceFrame();
    } else {
      this.pins.clearDeadwood(); // 데드우드 제거, 선 핀 유지
      this.ball = 2;
      this.ballObj.reset();
      this.state = 'AIMING';
    }
  }

  /** 프레임 10: 스트라이크/스페어 시 보너스 투구 (최대 3구, 도안 §7) */
  private scoreTenthFrame(standing: number) {
    const f = this.rolls[9];
    if (this.ball === 1) {
      // 스트라이크면 새 핀으로, 아니면 데드우드 치우고 2구
      if (standing === 0) this.pins.resetAll();
      else this.pins.clearDeadwood();
      this.ball = 2;
      this.ballObj.reset();
      this.state = 'AIMING';
    } else if (this.ball === 2) {
      const earnedBonus = f[0] === 10 || f[0] + f[1] === 10; // 1구 스트라이크 또는 스페어
      if (earnedBonus) {
        if (standing === 0) this.pins.resetAll();
        else this.pins.clearDeadwood();
        this.ball = 3;
        this.ballObj.reset();
        this.state = 'AIMING';
      } else {
        this.state = 'GAME_OVER';
      }
    } else {
      this.state = 'GAME_OVER'; // 3구 종료
    }
  }

  /** 다음 프레임으로 (프레임 1~9에서만 호출) */
  private advanceFrame() {
    this.frame += 1;
    this.ball = 1;
    this.rolls.push([]);
    this.pins.resetAll();
    this.ballObj.reset();
    this.state = 'AIMING';
  }

  private refreshHud() {
    this.hud.update({
      frame: this.frame,
      ball: this.ball,
      standing: this.pins.standingCount(),
      state: this.state,
      rolls: this.rolls,
      score: totalScore(this.rolls.flat()),
    });
  }
}
