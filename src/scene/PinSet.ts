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
  GUTTER_WIDTH,
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
// 총 4.05초. 첫 판정은 2.45초였는데 "너무 빠르다" — 실기계는 5~8초고 그중 눈에 보이는
// 테이블·스윕 구간만도 4초 안팎이다. 조준과 병렬로 도니 길어져도 체감 대기는 그대로 0이지만,
// 플레이어가 다 끝나기 전에 던지면 finishCycle()이 스냅한다(결과는 동일, 연출만 잘림).
const CY_GUARD = 0.55;
const CY_GRIP = 1.15;
const CY_LIFT = 1.55;
const CY_SWEEP = 2.55;
const CY_RETURN = 3.0;
const CY_SET = 3.6;
const CY_END = 4.05;
const BAR_Y_UP = 1.2; // 스윕 바 대기 높이(마스킹 뒤)
// 쓸기 높이. 바 높이 0.52라 아래 끝이 -0.17 — 거터 바닥(-0.13)보다 낮아야 거터의 핀까지 민다.
// 예전 0.15(아래 끝 0.0)는 레인 위만 훑고 거터를 그냥 지나쳤다.
const BAR_Y_DOWN = 0.09;
const BAR_H = 0.52; // 바 높이 — 거터 바닥까지 닿는다
// 폭: 레인 + 양쪽 거터 전체. 실제 스윕도 "핀 스탠드 구간 및 인접 거터"를 함께 치운다
// (AMF 특허 US2250503). 예전 LANE_WIDTH+0.1은 거터에 닿지도 않았다.
const BAR_W = LANE_WIDTH + 2 * GUTTER_WIDTH + 0.06;
const BAR_Z0 = HEADPIN_Z - 0.45; // 볼러 쪽 — 가드 위치이자 쓸기 시작점
const BAR_Z1 = PIN_DECK_END + 0.35; // 피트 쪽 끝 — 데드우드를 넘겨버리는 지점
const TABLE_Y_UP = 1.5; // 테이블 대기(마스킹 뒤)
const TABLE_Y_GRIP = 0.43; // 핀 머리를 무는 높이
const TABLE_Y_LIFT = 0.93; // 물고 올라간 높이
const TABLE_PIN_DROP = TABLE_Y_GRIP - PIN_HEIGHT / 2; // 테이블 y → 물린 핀 y 오프셋
// 판금 테이블 치수. 실제 pin table은 슬래브가 아니라 **구멍 뚫린 판금**이다(AMF 특허 US5876290:
// "generally planar ... with a plurality of pin openings, and lips ... around the periphery of each
// of the openings"). 볼러가 보는 건 그 판의 밑면 — 핀 삼각형과 같은 배치의 구멍 10개다.
const TBL_THICK = 0.05; // 판 두께
const TBL_HOLE_R = 0.05; // 구멍 반경 — 목(23mm)보다 크고 배(60mm)보다 작다
const TBL_PAD = 0.19; // 핀 삼각형 바깥 여백
// 실루엣: 판 하나(두께 5cm)만 있으면 18m 밖에서 '떠 있는 막대'로 보인다. 이 거리에선 디테일이
// 아니라 **덩어리감**이 읽힌다 — 위로 요크 몸통, 아래로 스포팅 컵을 붙여 세로 폭을
// 0.05m → 0.32m(6.4배)로 키운다.
const CUP_R = 0.052; // 컵 반경 — 핀 크라운(0.0295)보다 크고 구멍(0.05)에 맞물린다
const CUP_H = 0.075; // 컵 길이. 잡으면 핀 머리 위 50mm가 컵 안으로 들어간다
const CUP_Y = -TBL_THICK / 2 - CUP_H / 2; // 판 바로 아래에 매달림
const YOKE_Y = TBL_THICK / 2 + 0.075; // 판 위 몸통 중심
// 핑거는 컵보다 더 아래로 내려 실루엣의 톱니를 만든다. 겸사겸사 위치도 바로잡힌다 —
// 잡는 높이가 월드 0.285~0.345로 핀 목(0.254~0.32)에 정확히 걸린다(실제 respot cell도 목을 문다).
const FINGER_Y = -0.115;
const GRIP_OPEN = TBL_HOLE_R + 0.014; // 벌어진 핑거 간격(중심에서)
const GRIP_CLOSED = 0.026; // 목을 문 간격 — 목 반지름 23mm에 맞물린다
const M4 = new THREE.Matrix4(); // 인스턴스 행렬 스크래치(무할당)
const Q_FROM = new THREE.Quaternion(); // 리스팟 자세 보간 스크래치
const Q_TO = new THREE.Quaternion();
const SWEEP_PUSH_Z = 3.2; // 스윕이 데드우드를 미는 속도(m/s) — 피트까지 굴러가는 데 충분
const SWEEP_PUSH_Y = 0.45; // 살짝 튀어올라야 바닥에 끌리지 않고 넘어간다

const smooth = (k: number) => k * k * (3 - 2 * k);
// ②→③ 반환점 전용. 양쪽 다 smoothstep이면 경계에서 속도가 0으로 죽어 테이블이 바닥에서
// '딱 멈췄다' 다시 올라간다. 하강은 가속만(도착 속도 최대), 상승은 감속만(출발 속도 최대)으로
// 두면 속도 크기가 이어지고 부호만 뒤집혀 — 멈춤 없이 반전으로 읽힌다.
const easeIn = (k: number) => k * k;
const easeOut = (k: number) => 1 - (1 - k) * (1 - k);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 핀 10개 묶음: 배치 / 쓰러짐 판정 / 리셋 (도안 §3·§4.3).
 */
export class PinSet {
  readonly pins: Pin[] = [];

  // 핀세터 사이클 — cycleT < 0 이면 유휴. runCycle()로 시작, update(dt)가 굴리고, finishCycle()이 확정.
  private cycleT = -1;
  private cycleSweep: Pin[] = []; // 이번 사이클에 치울 데드우드
  private cycleRack = false; // rack 모드면 ②③(집기·들기)을 건너뛴다 — 집을 핀이 없다
  private readonly cyclePushed = new Set<Pin>(); // 스윕이 이미 밀어낸 핀(중복 가속 방지)
  // 리스팟 시작 시점의 실제 포즈. hold()가 곧장 home·직립으로 덮으면 기울어 있던 핀이 한 프레임에
  // 튀어 오른다 — 여기서 출발해 ③ 동안 보간해야 '집어서 바로 세운다'로 읽힌다.
  private readonly cycleFrom = new Map<Pin, { x: number; z: number; q: THREE.Quaternion }>();
  private cycleHold: Pin[] = []; // ①~③ 동안 공중에 들려 있는 핀 (스윕을 피해 있는 잔존 핀)
  private cyclePlace: Pin[] = []; // ④에서 스폿으로 내려놓을 핀
  // hold와 place를 나눠야 하는 이유: rack 모드는 '전부 쓸어내고 새로 10개를 내린다'라서
  // 치울 핀과 내려놓을 핀이 같은 객체다. 하나로 합쳐두면 스윕이 stash한 핀을 같은 프레임의
  // hold()가 즉시 되살려 데드우드가 영영 안 사라진다(실측: rack 사이클 내내 10개 보임).
  private readonly sweepBar: THREE.Mesh;
  private readonly pinTable: THREE.Group; // 판 + 핑거 묶음 (y만 움직인다)
  private readonly fingers: THREE.InstancedMesh; // 구멍당 2개 × 10 = 20
  private readonly holeXZ: { x: number; z: number }[] = []; // 테이블 로컬 구멍 좌표

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
      new THREE.BoxGeometry(BAR_W, BAR_H, 0.05),
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
    // 상자 슬래브로 만들었더니 여전히 짜쳤는데, 실제 판의 정체성은 **구멍 10개**였다.
    const deckMidZ = (HEADPIN_Z + PIN_DECK_END) / 2;
    const halfW = LANE_WIDTH / 2 - 0.02;
    const halfD = (PIN_DECK_END - HEADPIN_Z) / 2 + TBL_PAD;
    // Shape는 XY 평면 — 나중에 rotateX(-90°)로 눕힌다. 그때 shape의 +y가 월드 -z가 되므로
    // 구멍의 z는 부호를 뒤집어 넣는다. 구멍 배치는 핀과 같은 PIN_ROWS/PIN_SPACING에서 뽑아
    // 어긋날 여지를 없앤다.
    const plate = new THREE.Shape();
    plate.moveTo(-halfW, -halfD);
    plate.lineTo(halfW, -halfD);
    plate.lineTo(halfW, halfD);
    plate.lineTo(-halfW, halfD);
    plate.closePath();
    PIN_ROWS.forEach((cols, r) => {
      for (const c of cols) {
        const hx = c * PIN_SPACING;
        const hz = HEADPIN_Z + r * ROW_GAP - deckMidZ;
        this.holeXZ.push({ x: hx, z: hz });
        const hole = new THREE.Path();
        hole.absarc(hx, -hz, TBL_HOLE_R, 0, Math.PI * 2, true);
        plate.holes.push(hole);
      }
    });
    // bevel = 구멍 둘레와 판 외곽의 '립'. 판금이 접혀 올라간 그 느낌을 싸게 낸다.
    const plateGeo = new THREE.ExtrudeGeometry(plate, {
      depth: TBL_THICK,
      bevelEnabled: true,
      bevelThickness: 0.008,
      bevelSize: 0.006,
      bevelSegments: 1,
      curveSegments: 14,
    });
    plateGeo.rotateX(-Math.PI / 2);
    plateGeo.translate(0, -TBL_THICK / 2, 0);
    const steel = new THREE.MeshStandardMaterial({
      color: 0x8b939e, // 강판 — 이전 0x20262f는 거의 검정이라 어두운 핀덱에 묻혔다
      metalness: 0.9,
      roughness: 0.28,
    });
    this.pinTable = new THREE.Group();
    this.pinTable.add(new THREE.Mesh(plateGeo, steel));

    // 요크 몸통 — 컵을 지지하는 기계 덩어리. 실루엣 상단을 채운다.
    const yoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.15, 0.7),
      new THREE.MeshStandardMaterial({ color: 0x4d5560, metalness: 0.8, roughness: 0.38 }),
    );
    yoke.position.y = YOKE_Y;
    this.pinTable.add(yoke);

    // 스포팅 컵 10개 — 구멍이 뚫린 판보다 이게 훨씬 잘 읽힌다. 판 밑면은 거의 안 보이지만
    // 아래로 매달린 컵은 옆에서도 보여 아랫변을 톱니로 만든다(= 기계로 읽히는 실루엣).
    const cups = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(CUP_R, CUP_R, CUP_H, 12, 1, true), // openEnded — 핀이 안으로 들어간다
      new THREE.MeshStandardMaterial({
        color: 0x6f7885,
        metalness: 0.85,
        roughness: 0.3,
        side: THREE.DoubleSide, // 열린 원통이라 안쪽 면도 보여야 한다
      }),
      this.holeXZ.length,
    );
    this.holeXZ.forEach((h, i) => {
      M4.makeTranslation(h.x, CUP_Y, h.z);
      cups.setMatrixAt(i, M4);
    });
    cups.instanceMatrix.needsUpdate = true;
    this.pinTable.add(cups);

    // 그리퍼 핑거 — 구멍마다 양쪽 2개. 목을 무는 순간이 보여야 '기계가 집는다'가 완성된다.
    this.fingers = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.012, 0.06, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xb8c0cb, metalness: 0.95, roughness: 0.22 }),
      this.holeXZ.length * 2,
    );
    this.pinTable.add(this.fingers);
    this.setGrip(0);
    this.pinTable.position.set(0, TABLE_Y_UP, deckMidZ);
    this.pinTable.visible = false;
    engine.scene.add(this.pinTable);
  }

  /** 그리퍼 개폐 — k=0 벌어짐, k=1 목을 문 상태 */
  private setGrip(k: number) {
    const spread = lerp(GRIP_OPEN, GRIP_CLOSED, k);
    let n = 0;
    for (const h of this.holeXZ) {
      for (const side of [-1, 1]) {
        M4.makeTranslation(h.x + side * spread, FINGER_Y, h.z);
        this.fingers.setMatrixAt(n++, M4);
      }
    }
    this.fingers.instanceMatrix.needsUpdate = true;
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
      // 프레임 사이 — 남은 게 있든 없든 전부 쓸어내고, 새 랙 10개가 ⑥에서 처음 나타난다
      this.cycleHold = [];
      this.cycleSweep = [...this.pins];
      this.cyclePlace = [...this.pins];
    }
    this.cycleRack = mode === 'rack';
    this.cyclePushed.clear();
    this.cycleFrom.clear();
    for (const p of this.cycleHold) {
      const tr = p.body.translation();
      const rt = p.body.rotation();
      this.cycleFrom.set(p, { x: tr.x, z: tr.z, q: new THREE.Quaternion(rt.x, rt.y, rt.z, rt.w) });
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
    this.cyclePushed.clear();
    this.cycleFrom.clear();
    this.sweepBar.visible = false;
    this.sweepBar.position.set(0, BAR_Y_UP, BAR_Z0);
    this.pinTable.visible = false;
    this.pinTable.position.y = TABLE_Y_UP;
    this.setGrip(0);
  }

  /** Loop 물리 스텝마다 — 사이클 연출 진행 */
  update(dt: number) {
    if (this.cycleT < 0) return;
    this.cycleT += dt;
    // rack(스트라이크·2구 후)은 집어 올릴 핀이 없다. 그런데도 ②③을 돌면 테이블이 **빈손으로**
    // 내려갔다 올라오는 헛동작 0.85초가 생긴다 — 실제 기계는 그 경우 레이크가 쓸고 새 랙이
    // 내려오는 게 전부다. 가드 이후 구간을 통째로 건너뛰어 3.05초로 줄인다.
    const t = this.cycleT + (this.cycleRack && this.cycleT > CY_GUARD ? CY_LIFT - CY_GUARD : 0);
    const bar = this.sweepBar;
    const tbl = this.pinTable;
    // 테이블 가시성은 **여기 한 줄에서만** 정한다. 구간마다 흩어서 대입했더니 앞 사이클 상태가
    // 새어 rack에서도 0.54초에 나타났다(실측). respot은 ②부터, rack은 ⑥부터 — rack은 ②③을
    // 건너뛰므로 그 전에는 애초에 존재하지 않는다.
    tbl.visible = this.cycleRack ? t >= CY_RETURN : t >= CY_GUARD;
    const spotY = PIN_HEIGHT / 2;
    /** 물린 핀을 테이블에 붙여 함께 움직인다 — '기계가 든다'로 읽히게 하는 부분 */
    const carry = (tableY: number, pins: Pin[]) => {
      for (const p of pins) p.hold(tableY - TABLE_PIN_DROP);
    };
    /** ③ 전용 — 잡힌 순간의 실제 포즈에서 home·직립으로 보간하며 올린다(순간이동 제거) */
    const carryFrom = (tableY: number, s01: number) => {
      const y = tableY - TABLE_PIN_DROP;
      for (const p of this.cycleHold) {
        const f = this.cycleFrom.get(p);
        if (!f) {
          p.hold(y);
          continue;
        }
        Q_FROM.copy(f.q);
        Q_TO.identity();
        Q_FROM.slerp(Q_TO, s01);
        p.hold(y, {
          x: lerp(f.x, p.home.x, s01),
          z: lerp(f.z, p.home.z, s01),
          q: { x: Q_FROM.x, y: Q_FROM.y, z: Q_FROM.z, w: Q_FROM.w },
        });
      }
    };

    if (t < CY_GUARD) {
      // ① 스윕 가드 하강 — 핀은 아직 그대로
      const k = smooth(t / CY_GUARD);
      bar.visible = true;
      bar.position.set(0, lerp(BAR_Y_UP, BAR_Y_DOWN, k), BAR_Z0);
      this.setGrip(0); // 벌린 채 대기
    } else if (t < CY_GRIP) {
      // ② 테이블 하강 → 목을 문다. 아직 핀은 스폿에 서 있다(물리는 그대로).
      const k = (t - CY_GUARD) / (CY_GRIP - CY_GUARD);
      tbl.position.y = lerp(TABLE_Y_UP, TABLE_Y_GRIP, easeIn(k)); // 바닥에 속도를 실은 채 도착
      // 반환점에서 정확히 다 물리도록 하강 후반 40%에 걸쳐 닫는다. 핑거는 목 둘레로 '가로로'
      // 좁혀지므로 내려오면서 닫혀도 핀을 관통하는 것처럼 보이지 않는다.
      this.setGrip(smooth(Math.max(0, (k - 0.6) / 0.4)));
    } else if (t < CY_LIFT) {
      // ③ 테이블이 핀을 들고 상승
      const k = easeOut((t - CY_GRIP) / (CY_LIFT - CY_GRIP)); // 멈춤 없이 곧바로 반전해 상승
      tbl.position.y = lerp(TABLE_Y_GRIP, TABLE_Y_LIFT, k);
      this.setGrip(1);
      // 들어올리는 동안 자세·위치를 함께 편다 — 기울어 있던 핀이 한 프레임에 튀지 않는다
      carryFrom(tbl.position.y, k);
    } else if (t < CY_SWEEP) {
      // ④ 스윕 전진 — 지나간 z의 데드우드가 피트로
      // 선형이면 바가 순간 최고속으로 출발해 순간 정지한다 — 다른 구간과 달리 여기만 이징이 없었다
      const k = smooth((t - CY_LIFT) / (CY_SWEEP - CY_LIFT));
      tbl.position.y = TABLE_Y_LIFT;
      carry(TABLE_Y_LIFT, this.cycleHold);
      const z = lerp(BAR_Z0, BAR_Z1, k);
      bar.position.set(0, BAR_Y_DOWN, z);
      // 데드우드는 지우는 게 아니라 **민다**. 즉시 stash하면 바 앞에서 핀이 사라져 버린다.
      // 속도만 주고 물리에 맡기면 피트로 굴러 넘어가고, 남은 건 finishCycle()이 치운다.
      for (const p of this.cycleSweep) {
        if (this.cyclePushed.has(p)) continue;
        if (p.body.translation().z > z) continue;
        this.cyclePushed.add(p);
        // 핀의 평상시 선형 감쇠(흩어짐 억제용)가 밀기를 먹어버린다 — 3.2m/s로 밀어도 0.34m에서
        // 멈춰 피트(z≈19.5)에 못 닿았다(실측). 밀리는 동안만 0으로 두고 reset/stash가 되돌린다.
        p.body.setLinearDamping(0);
        p.body.setLinvel({ x: 0, y: SWEEP_PUSH_Y, z: SWEEP_PUSH_Z }, true);
        p.body.setAngvel({ x: 6, y: 0, z: 0 }, true); // 앞으로 구르는 회전
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
      tbl.position.y = lerp(this.cycleRack ? TABLE_Y_UP : TABLE_Y_LIFT, TABLE_Y_GRIP, k);
      carry(tbl.position.y, this.cyclePlace);
    } else if (t < CY_END) {
      // ⑦ 테이블·스윕 상승 — 핀은 스폿에 고정된 채 남는다
      const k = smooth((t - CY_SET) / (CY_END - CY_SET));
      this.setGrip(1 - k); // 놓으면서 벌어진다
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
