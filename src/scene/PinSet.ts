import type { Engine } from '../core/Engine';
import { Pin } from './Pin';
import {
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  SETTLE_VEL_EPS,
  LANE_WIDTH,
  PIN_ROWS,
  POWER_LANE_HALF,
} from '../game/constants';
import { PIN_NUMBERS } from '../game/splits';
import { POWER_MAX_PINS, powerRackPositions } from '../game/power';

const UP_COS_45 = Math.cos(Math.PI / 4); // ≈0.707

/**
 * 핀 묶음: 배치 / 쓰러짐 판정 / 리셋 (도안 §3·§4.3).
 *
 * 일반 모드는 표준 10핀(`pins`, PIN_ROWS 4행)만 쓴다 — 기존 메서드 거동 불변.
 * 파워 스로(#4)는 더 큰 삼각 랙이 필요해 풀(`pins` + `powerExtras` = 최대 POWER_MAX_PINS)을
 * 부팅 때 미리 만들고(핀 동적 생성/제거 인프라 부재 — Barrier와 동일), `setPowerRack`이 스테이지마다
 * 핀을 삼각 슬롯에 place()한다. 파워 활성 시 카운트/정지 판정은 `powerActive` 기준, x-게이트는 넓어진다.
 */
export class PinSet {
  readonly pins: Pin[] = []; // 표준 10핀 (일반·스페어·장애물 모드 공용 — home 보존)
  private readonly powerExtras: Pin[] = []; // 파워 전용 여분 핀 (평소 stash+sleep)
  private powerMode = false; // 파워 스로 활성 — isStanding x-게이트·카운트 집합 전환
  private powerActive: Pin[] = []; // 현재 파워 랙을 이루는 핀들 (pins+powerExtras의 부분집합)

  constructor(engine: Engine) {
    PIN_ROWS.forEach((cols, r) => {
      for (const c of cols) {
        const x = c * PIN_SPACING;
        const z = HEADPIN_Z + r * ROW_GAP;
        this.pins.push(new Pin(engine, x, z));
      }
    });
    // 파워 풀 여분 — 부팅 때 한 번 생성하고 즉시 stash(sleep)로 치움. setPowerRack이 place()로 깨운다.
    for (let i = this.pins.length; i < POWER_MAX_PINS; i++) {
      const p = new Pin(engine, 0, 0);
      p.stash();
      this.powerExtras.push(p);
    }
  }

  /** 카운트/정지 판정 대상 집합 (파워 활성 시 랙 핀, 아니면 표준 10핀) */
  private get activeSet(): Pin[] {
    return this.powerMode ? this.powerActive : this.pins;
  }

  /**
   * 똑바로 서 있는지 (도안 §4.3/B.4):
   * 핀의 up축 기울기 < 45° AND 핀덱 위에 있음.
   * ⚠️ 반드시 모두 정지(SETTLING 완료)한 뒤 1회만 호출할 것.
   */
  private isStanding(pin: Pin): boolean {
    const t = pin.body.translation();
    // 레인 밖(거터·벽)으로 튕겨난 핀은 자세와 무관하게 쓰러짐 — 벽에 기대 선 핀이
    // "서 있음"으로 남아 영영 못 치는 케이스 방지 (도안 §4.3 "레인 밖 튕겨나감").
    // 파워 스로는 와이드 아레나라 게이트를 POWER_LANE_HALF로 넓힌다(랙 바깥 핀이 즉시 쓰러짐 처리되는 걸 방지).
    const halfW = this.powerMode ? POWER_LANE_HALF : LANE_WIDTH / 2;
    if (Math.abs(t.x) > halfW) return false;
    const q = pin.body.rotation();
    // 회전된 (0,1,0)의 y성분 = cos(tilt)
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    return upY > UP_COS_45 && t.y > pin.height * 0.25; // 덕핀(#5)은 핀이 짧아 게이트도 모드별 높이 기준
  }

  /** 현재 서 있는 핀 수 */
  standingCount(): number {
    return this.activeSet.reduce((n, p) => n + (this.isStanding(p) ? 1 : 0), 0);
  }

  /** 쓰러진 핀 수 (= 이번 투구 점수 후보) */
  fallenCount(): number {
    return this.activeSet.length - this.standingCount();
  }

  /** 서 있는지 여부 마스크 (인덱스별) — 표준 10핀 기준 (AI·스플릿 판정 전용, 파워 미사용) */
  standingMask(): boolean[] {
    return this.pins.map((p) => this.isStanding(p));
  }

  /** 모든 핀이 정지(또는 sleeping)했는지 — SETTLING 종료 판정 (도안 §4.6) */
  allSettled(): boolean {
    return this.activeSet.every((p) => {
      if (p.body.isSleeping()) return true;
      const v = p.body.linvel();
      return Math.hypot(v.x, v.y, v.z) < SETTLE_VEL_EPS;
    });
  }

  /**
   * 자동 핀세터 리스팟 (1·2구 사이): 선 핀은 제 스폿(home)에 똑바로 다시 세우고,
   * 데드우드(쓰러진 핀)는 치운다. 실제 핀세터도 잔존 핀을 집어 올려 스폿에 재배치하므로,
   * 밀리거나 기운 핀이 그대로 남지 않는다 (도안 §6).
   */
  respot() {
    for (const p of this.pins) {
      if (this.isStanding(p)) p.reset();
      else p.stash();
    }
  }

  /** 핀 전체를 똑바로 다시 세움 (BETWEEN_FRAMES) */
  resetAll() {
    for (const p of this.pins) p.reset();
  }

  /** 지정한 핀 번호만 세우고 나머지는 치움 (스페어 챌린지, 로드맵 P1) */
  setLayout(standingPinNumbers: number[]) {
    this.pins.forEach((p, i) => {
      if (standingPinNumbers.includes(PIN_NUMBERS[i])) p.reset();
      else p.stash();
    });
  }

  /**
   * 파워 스로(#4): rows행 삼각 랙으로 핀을 배치. 풀(표준 10핀 + 여분)에서 필요한 수만큼 꺼내
   * 삼각 슬롯에 place()하고 나머지는 stash. 표준 핀이 앞 4행을 home과 동일 위치로 채운다.
   * 호출 후 powerMode=on → 카운트/정지/게이트가 랙 기준으로 동작.
   */
  setPowerRack(rows: number) {
    for (const p of this.pins) p.stash();
    for (const p of this.powerExtras) p.stash();
    const pool = [...this.pins, ...this.powerExtras];
    const pos = powerRackPositions(rows);
    this.powerActive = pos.map((pt, i) => {
      const pin = pool[i];
      pin.place(pt.x, pt.z);
      return pin;
    });
    this.powerMode = true;
  }

  /** 파워 모드 해제 — 여분 핀 치우고 표준 모드로 복귀 (다른 모드 시작·메뉴 복귀). */
  clearPower() {
    for (const p of this.powerExtras) p.stash();
    this.powerActive = [];
    this.powerMode = false;
  }

  /**
   * 덕핀(#5) 핀 형상 토글 — 표준 10핀에 일괄 적용. on=짧고 통통한 덕핀 핀, off=텐핀 복귀.
   * startMatch가 모드 진입마다 호출(다른 모드로 나갈 때 표준 형상 복귀를 보장). 파워 여분 핀은
   * 덕핀을 안 쓰므로(파워는 항상 텐핀 랙) 건드리지 않는다.
   */
  setDuckpin(on: boolean) {
    for (const p of this.pins) p.setDuckpin(on);
  }
}
