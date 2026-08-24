import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { Pin } from './Pin';
import {
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
  PIN_HEIGHT,
  SETTLE_VEL_EPS,
  LANE_WIDTH,
  PIN_ROWS,
  PIN_DECK_END,
} from '../game/constants';
import { PIN_NUMBERS } from '../game/splits';

const UP_COS_45 = Math.cos(Math.PI / 4); // ≈0.707

// ── 핀세터 사이클 타임라인(초) ────────────────────────────────────────────────
// 실제 기계(AMF 82-30 계열) 순서를 그대로 따른다. 이전 버전은 스윕과 리프트를 동시에 시작하고
// **테이블이 아예 없어서**, 핀이 저 혼자 떠오르는 바람에 기계가 아니라 줄넘기로 읽혔다.
// 핀을 드는 물체가 보이지 않으면 어떤 이징을 써도 뜀뛰기다 — 순서보다 이게 핵심 수정이다.
//   ① 스윕이 먼저 '가드' 위치로 내려온다(쓸기 위해서가 아니라 기계 보호용)
//   ② 테이블이 내려와 선 핀의 목을 문다   ③ 테이블이 핀을 들고 올라간다
//   ④ 스윕 전진 — 데드우드를 피트로   ⑤ 스윕 가드 복귀
//   ⑥ 테이블 하강 — 핀을 스폿에 놓음   ⑦ 테이블·스윕 상승
// 총 2.45초. 조준·점수집계와 겹쳐 돌므로 체감 대기는 여전히 0이다.
const CY_GUARD = 0.3;
const CY_GRIP = 0.65;
const CY_LIFT = 0.9;
const CY_SWEEP = 1.45;
const CY_RETURN = 1.75;
const CY_SET = 2.15;
const CY_END = 2.45;
const BAR_Y_UP = 1.2; // 스윕 바 대기 높이(마스킹 뒤)
const BAR_Y_DOWN = 0.15; // 가드/쓸기 높이
const BAR_Z0 = HEADPIN_Z - 0.45; // 볼러 쪽 — 가드 위치이자 쓸기 시작점
const BAR_Z1 = PIN_DECK_END + 0.35; // 피트 쪽 끝 — 데드우드를 넘겨버리는 지점
const TABLE_Y_UP = 1.5; // 테이블 대기(마스킹 뒤)
const TABLE_Y_GRIP = 0.43; // 핀 머리를 무는 높이
const TABLE_Y_LIFT = 0.93; // 물고 올라간 높이
const TABLE_PIN_DROP = TABLE_Y_GRIP - PIN_HEIGHT / 2; // 테이블 y → 물린 핀 y 오프셋

const smooth = (k: number) => k * k * (3 - 2 * k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 핀 10개 묶음: 배치 / 쓰러짐 판정 / 리셋 (도안 §3·§4.3).
 */
export class PinSet {
  readonly pins: Pin[] = [];

  // 핀세터 사이클 — cycleT < 0 이면 유휴. runCycle()로 시작, update(dt)가 굴리고, finishCycle()이 확정.
  private cycleT = -1;
  private cycleSweep: Pin[] = []; // 이번 사이클에 치울 데드우드
  private cycleHold: Pin[] = []; // ①~③ 동안 공중에 들려 있는 핀 (스윕을 피해 있는 잔존 핀)
  private cyclePlace: Pin[] = []; // ④에서 스폿으로 내려놓을 핀
  // hold와 place를 나눠야 하는 이유: rack 모드는 '전부 쓸어내고 새로 10개를 내린다'라서
  // 치울 핀과 내려놓을 핀이 같은 객체다. 하나로 합쳐두면 스윕이 stash한 핀을 같은 프레임의
  // hold()가 즉시 되살려 데드우드가 영영 안 사라진다(실측: rack 사이클 내내 10개 보임).
  private readonly sweepBar: THREE.Mesh;
  private readonly pinTable: THREE.Mesh;

  constructor(engine: Engine) {
    PIN_ROWS.forEach((cols, r) => {
      for (const c of cols) {
        const x = c * PIN_SPACING;
        const z = HEADPIN_Z + r * ROW_GAP;
        this.pins.push(new Pin(engine, x, z));
      }
    });

    // 스윕 바(레이크) — 물리 바디가 아니라 순수 비주얼이다. 데드우드를 실제로 밀어내면 핀이 튀거나
    // 끼는 사고가 나므로, 바가 지나가는 z를 넘긴 핀을 stash()로 치우는 방식이 훨씬 싸고 안정적이다.
    this.sweepBar = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH + 0.1, 0.3, 0.05),
      new THREE.MeshStandardMaterial({
        color: 0x161c28,
        metalness: 0.65,
        roughness: 0.35,
        emissive: 0x0d2f3a, // 은은한 시안 — 어두운 핀덱에서 실루엣이 읽히게
        emissiveIntensity: 0.9,
      }),
    );
    this.sweepBar.position.set(0, BAR_Y_UP, BAR_Z0);
    this.sweepBar.visible = false;
    engine.scene.add(this.sweepBar);

    // 핀 테이블(스포팅 테이블) — 핀을 무는 기계 뭉치. 이게 보여야 핀의 상하 운동이 기계로 읽힌다.
    // 핀덱 삼각형을 덮는 판 하나로 충분하다(그리퍼 셀까지 모델링할 필요 없음 — 거리에서 안 읽힌다).
    const deckMidZ = (HEADPIN_Z + PIN_DECK_END) / 2;
    this.pinTable = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_WIDTH - 0.05, 0.07, PIN_DECK_END - HEADPIN_Z + 0.42),
      new THREE.MeshStandardMaterial({
        color: 0x20262f,
        metalness: 0.75,
        roughness: 0.3,
        emissive: 0x0d2f3a,
        emissiveIntensity: 0.5,
      }),
    );
    this.pinTable.position.set(0, TABLE_Y_UP, deckMidZ);
    this.pinTable.visible = false;
    engine.scene.add(this.pinTable);
  }

  /**
   * 핀세터 사이클 시작 (비동기·논블로킹). 최종 상태는 **시작 시점에 확정**해두고 연출만 시간축에
   * 펼치므로, 중간에 finishCycle()로 끊어도 결과가 같다.
   * - `respot` 1·2구 사이: 선 핀은 들어올렸다 제자리에, 데드우드만 쓸어냄
   * - `rack` 프레임 사이: 전부 쓸어내고 10개를 새로 내림
   */
  runCycle(mode: 'respot' | 'rack') {
    this.finishCycle(); // 겹쳐 들어오면 앞 사이클을 먼저 확정 (상태 꼬임 방지)
    if (mode === 'respot') {
      // 잔존 핀은 랙이 집어 올려 스윕을 피했다가 제 스폿에 그대로 되돌아간다
      this.cycleHold = this.pins.filter((p) => this.isStanding(p));
      this.cycleSweep = this.pins.filter((p) => !this.isStanding(p));
      this.cyclePlace = this.cycleHold;
    } else {
      // 프레임 사이 — 남은 게 있든 없든 전부 쓸어내고, 새 랙 10개가 ④에서 처음 나타난다
      this.cycleHold = [];
      this.cycleSweep = [...this.pins];
      this.cyclePlace = [...this.pins];
    }
    this.cycleT = 0;
  }

  /** 사이클 진행 중인가 — 투구 직전 가드용 */
  get cycling(): boolean {
    return this.cycleT >= 0;
  }

  /**
   * 사이클을 즉시 최종 상태로 확정. 연출 도중 다음 투구가 시작되면 반드시 이걸 먼저 불러야
   * standingCount()가 연출 중간값을 읽지 않는다.
   */
  finishCycle() {
    if (this.cycleT < 0) return;
    this.cycleT = -1;
    for (const p of this.cycleSweep) p.stash();
    for (const p of this.cyclePlace) p.reset(); // rack이면 sweep과 겹치는데, reset이 뒤라 결과는 '세워짐'
    this.cycleSweep = [];
    this.cycleHold = [];
    this.cyclePlace = [];
    this.sweepBar.visible = false;
    this.sweepBar.position.set(0, BAR_Y_UP, BAR_Z0);
    this.pinTable.visible = false;
    this.pinTable.position.y = TABLE_Y_UP;
  }

  /** Loop 물리 스텝마다 — 사이클 연출 진행 */
  update(dt: number) {
    if (this.cycleT < 0) return;
    this.cycleT += dt;
    const t = this.cycleT;
    const bar = this.sweepBar;
    const tbl = this.pinTable;
    const spotY = PIN_HEIGHT / 2;
    /** 물린 핀을 테이블에 붙여 함께 움직인다 — '기계가 든다'로 읽히게 하는 부분 */
    const carry = (tableY: number, pins: Pin[]) => {
      for (const p of pins) p.hold(tableY - TABLE_PIN_DROP);
    };

    if (t < CY_GUARD) {
      // ① 스윕 가드 하강 — 핀은 아직 그대로
      const k = smooth(t / CY_GUARD);
      bar.visible = true;
      bar.position.set(0, lerp(BAR_Y_UP, BAR_Y_DOWN, k), BAR_Z0);
    } else if (t < CY_GRIP) {
      // ② 테이블 하강 → 목을 문다. 아직 핀은 스폿에 서 있다(물리는 그대로).
      const k = smooth((t - CY_GUARD) / (CY_GRIP - CY_GUARD));
      tbl.visible = true;
      tbl.position.y = lerp(TABLE_Y_UP, TABLE_Y_GRIP, k);
    } else if (t < CY_LIFT) {
      // ③ 테이블이 핀을 들고 상승
      const k = smooth((t - CY_GRIP) / (CY_LIFT - CY_GRIP));
      tbl.position.y = lerp(TABLE_Y_GRIP, TABLE_Y_LIFT, k);
      carry(tbl.position.y, this.cycleHold);
    } else if (t < CY_SWEEP) {
      // ④ 스윕 전진 — 지나간 z의 데드우드가 피트로
      const k = (t - CY_LIFT) / (CY_SWEEP - CY_LIFT);
      tbl.position.y = TABLE_Y_LIFT;
      carry(TABLE_Y_LIFT, this.cycleHold);
      const z = lerp(BAR_Z0, BAR_Z1, k);
      bar.position.set(0, BAR_Y_DOWN, z);
      for (const p of this.cycleSweep) {
        if (p.body.translation().z <= z) p.stash();
      }
    } else if (t < CY_RETURN) {
      // ⑤ 스윕 가드 복귀
      const k = smooth((t - CY_SWEEP) / (CY_RETURN - CY_SWEEP));
      carry(TABLE_Y_LIFT, this.cycleHold);
      bar.position.set(0, BAR_Y_DOWN, lerp(BAR_Z1, BAR_Z0, k));
    } else if (t < CY_SET) {
      // ⑥ 테이블 하강 — 스폿에 놓는다. rack이면 새 10개가 여기서 처음 나타난다.
      const k = smooth((t - CY_RETURN) / (CY_SET - CY_RETURN));
      bar.position.set(0, BAR_Y_DOWN, BAR_Z0);
      tbl.position.y = lerp(TABLE_Y_LIFT, TABLE_Y_GRIP, k);
      carry(tbl.position.y, this.cyclePlace);
    } else if (t < CY_END) {
      // ⑦ 테이블·스윕 상승 — 핀은 스폿에 고정된 채 남는다
      const k = smooth((t - CY_SET) / (CY_END - CY_SET));
      tbl.position.y = lerp(TABLE_Y_GRIP, TABLE_Y_UP, k);
      bar.position.set(0, lerp(BAR_Y_DOWN, BAR_Y_UP, k), BAR_Z0);
      for (const p of this.cyclePlace) p.hold(spotY);
    } else {
      this.finishCycle();
    }
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
}
