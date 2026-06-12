import type { Engine } from '../core/Engine';
import { Pin } from './Pin';
import {
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  PIN_HEIGHT,
  SETTLE_VEL_EPS,
  LANE_WIDTH,
} from '../game/constants';

// 정삼각형 배치 (도안 §3). 행 0=헤드핀(1번) ... 행 3=뒷줄(7~10번)
const ROWS = [[0], [-0.5, 0.5], [-1, 0, 1], [-1.5, -0.5, 0.5, 1.5]];

const UP_COS_45 = Math.cos(Math.PI / 4); // ≈0.707

/**
 * 핀 10개 묶음: 배치 / 쓰러짐 판정 / 리셋 (도안 §3·§4.3).
 */
export class PinSet {
  readonly pins: Pin[] = [];

  constructor(engine: Engine) {
    ROWS.forEach((cols, r) => {
      for (const c of cols) {
        const x = c * PIN_SPACING;
        const z = HEADPIN_Z + r * ROW_GAP;
        this.pins.push(new Pin(engine, x, z));
      }
    });
  }

  /**
   * 똑바로 서 있는지 (도안 §4.3/B.4):
   * 핀의 up축 기울기 < 45° AND 핀덱 위에 있음.
   * ⚠️ 반드시 모두 정지(SETTLING 완료)한 뒤 1회만 호출할 것.
   */
  private isStanding(pin: Pin): boolean {
    const t = pin.body.translation();
    // 레인 밖(거터·벽)으로 튕겨난 핀은 자세와 무관하게 쓰러짐 — 벽에 기대 선 핀이
    // "서 있음"으로 남아 영영 못 치는 케이스 방지 (도안 §4.3 "레인 밖 튕겨나감")
    if (Math.abs(t.x) > LANE_WIDTH / 2) return false;
    const q = pin.body.rotation();
    // 회전된 (0,1,0)의 y성분 = cos(tilt)
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY > UP_COS_45 && t.y > PIN_HEIGHT * 0.25;
  }

  /** 현재 서 있는 핀 수 */
  standingCount(): number {
    return this.pins.reduce((n, p) => n + (this.isStanding(p) ? 1 : 0), 0);
  }

  /** 쓰러진 핀 수 (= 이번 투구 점수 후보) */
  fallenCount(): number {
    return this.pins.length - this.standingCount();
  }

  /** 서 있는지 여부 마스크 (인덱스별) */
  standingMask(): boolean[] {
    return this.pins.map((p) => this.isStanding(p));
  }

  /** 모든 핀이 정지(또는 sleeping)했는지 — SETTLING 종료 판정 (도안 §4.6) */
  allSettled(): boolean {
    return this.pins.every((p) => {
      if (p.body.isSleeping()) return true;
      const v = p.body.linvel();
      return Math.hypot(v.x, v.y, v.z) < SETTLE_VEL_EPS;
    });
  }

  /** 쓰러진 핀(데드우드)을 레인 밖으로 치움. 선 핀은 그대로 유지 (도안 §6) */
  clearDeadwood() {
    for (const p of this.pins) {
      if (!this.isStanding(p)) p.stash();
    }
  }

  /** 핀 전체를 똑바로 다시 세움 (BETWEEN_FRAMES) */
  resetAll() {
    for (const p of this.pins) p.reset();
  }
}
