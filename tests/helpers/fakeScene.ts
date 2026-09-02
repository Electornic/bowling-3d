/**
 * 가짜 씬 — `GameState` 상태머신을 Three·Rapier 없이 **끝까지** 굴린다.
 *
 * 왜 되는가: `GameState`는 `Ball`·`PinSet`·`Hud`·`Lane`을 전부 `import type`으로만 받는다.
 * 런타임 의존이 0이라 협력자 넷을 스텁으로 갈아끼우면 상태머신 전체(`throwBall` → ROLLING →
 * SETTLING → `score` → `nextBall`/`finishFrame` → `gameOver`)가 밀리초 단위로 돈다.
 * 실물리 sim([headless.ts](./headless.ts))이 "공이 어떻게 구르는가"를 재는 자리라면,
 * 여기는 "사용자가 겪는 흐름이 규칙대로 흘러가는가"를 재는 자리다. 둘은 겹치지 않는다.
 *
 * ## 스텁이 진짜와 갈리지 않게 하는 장치
 * 각 스텁은 `implements Pick<진짜클래스, GameState가 쓰는 멤버들>` 로 선언돼 있다. tsconfig의
 * `include`에 `tests`가 들어 있고 `npm run build`가 tsc를 돌리므로, 진짜 클래스의 **시그니처가
 * 바뀌면 빌드가 깨진다**. 새 멤버를 GameState가 쓰기 시작하면 `as unknown as` 캐스트가 그걸
 * 못 잡으니, 멤버를 추가할 땐 아래 `Used*` 타입에도 함께 적을 것.
 *
 * ## 스텁이 **일부러** 안 흉내내는 것
 * - **발사 물리.** `launch(aim, …)`는 aim을 그냥 x기울기로 쓴다(실제 `launchState` 아님).
 *   조준·훅·속도 척도는 `sim/ball-motion-sim`·`sim/predict`가 재는 값이지 여기 관심사가 아니다.
 * - **핀 충돌.** 무엇이 쓰러지는지는 물리가 아니라 **테스트 스크립트**가 정한다. 캐리는
 *   `sim-carry.mjs`의 몫이다.
 * - **핀세터 연출.** 타임라인 길이만 흉내내고(아래 `CYCLE_SEC`) 중간 포즈는 없다.
 */
import {
  LANE_WIDTH,
  BALL_RADIUS,
  BALL_START_Z,
  PIN_HEIGHT,
  PIN_ROWS,
  PIN_SPACING,
  HEADPIN_Z,
  ROW_GAP,
} from '../../src/game/constants';
import { PIN_NUMBERS, pinIndexByNumber } from '../../src/game/splits';
import { GameState, type MatchConfig, type GameEvent, type GameSummary } from '../../src/game/GameState';
import type { HudView } from '../../src/ui/Hud';
import type { Ball } from '../../src/scene/Ball';
import type { PinSet } from '../../src/scene/PinSet';
import type { Hud } from '../../src/ui/Hud';
import type { Lane } from '../../src/scene/Lane';
import type { BallSpec } from '../../src/game/BallSpec';
import type { BallSkin } from '../../src/game/rewards';

/** Loop의 고정 물리 스텝. Loop.FIXED_DT는 export가 아니라 여기 다시 적는다(값이 갈려도 페이싱만 달라짐). */
export const DT = 1 / 60;

/**
 * 핀세터 사이클 길이 — [PinSet.ts](../../src/scene/PinSet.ts)의 `CY_END` 타임라인을 비춘 값.
 * export가 아니라 복사지만, **드리프트가 무해하다**: 테스트는 초를 단정하지 않고
 * `cycling`이 내려갈 때까지 펌프한다(`drainCycle`). 사이클의 *존재*만 계약이다.
 */
const CYCLE_SEC = { respot: 4.05, rack: 3.05 } as const;

/** 공을 굴릴 기본 전진 속도(m/s) — 실제 릴리스 속도대(6.5~10.5) 안이면 무엇이든 무방. */
const ROLL_VZ = 8;
/** 임팩트로 핀이 '움직이는' 스텝 수 — notifyImpact(|v|>0.5)가 잡고, 그 뒤 멎어 allSettled가 참이 된다. */
const IMPACT_STEPS = 6;

interface Vec3 { x: number; y: number; z: number }
const v3 = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });

/** Rapier RigidBody 중 GameState·스텁이 실제로 만지는 부분만. */
class FakeBody {
  private t: Vec3;
  private v: Vec3 = v3();
  private w: Vec3 = v3();
  private sleeping = false;

  constructor(x: number, y: number, z: number) {
    this.t = v3(x, y, z);
  }
  translation(): Vec3 { return { ...this.t }; }
  linvel(): Vec3 { return { ...this.v }; }
  angvel(): Vec3 { return { ...this.w }; }
  isSleeping(): boolean { return this.sleeping; }
  setTranslation(p: Vec3, _wake?: boolean) { this.t = { ...p }; this.sleeping = false; }
  setLinvel(v: Vec3, _wake?: boolean) { this.v = { ...v }; this.sleeping = false; }
  setAngvel(w: Vec3, _wake?: boolean) { this.w = { ...w }; this.sleeping = false; }
  sleep() { this.sleeping = true; this.v = v3(); this.w = v3(); }
  /** Loop이 onStep 직전에 부르는 engine.step에 해당 — 등속 적분. */
  integrate(dt: number) {
    this.t.x += this.v.x * dt;
    this.t.y += this.v.y * dt;
    this.t.z += this.v.z * dt;
  }
}

// --- Ball ------------------------------------------------------------------

type UsedBall = Pick<Ball, 'launch' | 'reset' | 'setSpec' | 'setSkin' | 'setPinCollision' | 'applySpinForce'>;

export class FakeBall implements UsedBall {
  readonly body = new FakeBody(0, BALL_RADIUS, BALL_START_Z);
  /** 이번 투구에서 핀 충돌이 꺼졌는가 (레인 이탈 래치). */
  pinCollisionOff = false;
  spinForceCalls = 0;
  resets = 0;
  spec: BallSpec | null = null;
  skin: BallSkin | null = null;

  launch(aim: number, power: number, _spin = 0) {
    // aim은 x기울기로만 쓴다(주석 참조) — 거터를 만들려면 큰 aim을 준다.
    const vz = ROLL_VZ * power;
    this.body.setTranslation(v3(0, BALL_RADIUS, BALL_START_Z));
    this.body.setLinvel(v3(aim * vz, 0, vz));
  }
  reset() {
    this.resets += 1;
    this.pinCollisionOff = false;
    this.body.setTranslation(v3(0, BALL_RADIUS, BALL_START_Z));
    this.body.setLinvel(v3());
    this.body.setAngvel(v3());
  }
  setSpec(spec: BallSpec) { this.spec = spec; }
  setSkin(skin: BallSkin) { this.skin = skin; }
  setPinCollision(on: boolean) { this.pinCollisionOff = !on; }
  applySpinForce(_dt: number) { this.spinForceCalls += 1; }
}

// --- PinSet ----------------------------------------------------------------

type UsedPinSet = Pick<PinSet, 'runCycle' | 'finishCycle' | 'update' | 'standingCount' | 'standingMask' | 'allSettled' | 'resetAll' | 'setLayout'>;

/** 핀 하나 — GameState는 `.body`(임팩트 판정)와 `.home.x`(AI 조준)만 본다. */
class FakePin {
  readonly home: { x: number; z: number };
  readonly body: FakeBody;
  standing = true;
  stashed = false;
  private moving = 0;

  constructor(x: number, z: number) {
    this.home = { x, z };
    this.body = new FakeBody(x, PIN_HEIGHT / 2, z);
  }
  place() {
    this.standing = true;
    this.stashed = false;
    this.moving = 0;
    this.body.setTranslation(v3(this.home.x, PIN_HEIGHT / 2, this.home.z));
    this.body.setLinvel(v3());
  }
  /** 핀세터가 치움 — 실제 `Pin.stash()`가 y=-50으로 내린다(notifyImpact이 y<-1을 제외한다). */
  stash() {
    this.standing = false;
    this.stashed = true;
    this.moving = 0;
    this.body.setTranslation(v3(this.home.x, -50, this.home.z));
    this.body.setLinvel(v3());
  }
  /** 공에 맞아 넘어짐 — 데크에 눕고 잠깐 움직인다. */
  knockDown(steps = IMPACT_STEPS) {
    this.standing = false;
    this.moving = steps;
    this.body.setTranslation(v3(this.home.x, 0.06, this.home.z));
    this.body.setLinvel(v3(0.9, 0, 1.4)); // |v| > 0.5 → notifyImpact 발동
  }
  /** 스치기만 하고 안 넘어짐 — 임팩트는 잡히되 서 있는 상태 유지. */
  jostle(steps = IMPACT_STEPS) {
    this.moving = steps;
    this.body.setLinvel(v3(0.6, 0, 0.3));
  }
  integrate(_dt: number) {
    if (this.moving > 0 && --this.moving === 0) this.body.setLinvel(v3());
  }
  get settled(): boolean { return this.moving === 0; }
}

export class FakePinSet implements UsedPinSet {
  readonly pins: FakePin[] = [];
  /** 돈 사이클 기록 — 'respot'/'rack' 선택이 규칙대로인지 단정하는 데 쓴다. */
  readonly cycles: ('respot' | 'rack')[] = [];
  private cycleT = -1;
  private cycleMode: 'respot' | 'rack' = 'rack';

  constructor() {
    PIN_ROWS.forEach((cols, r) => {
      for (const c of cols) this.pins.push(new FakePin(c * PIN_SPACING, HEADPIN_Z + r * ROW_GAP));
    });
  }

  get cycling(): boolean { return this.cycleT >= 0; }

  runCycle(mode: 'respot' | 'rack') {
    this.finishCycle(); // 겹쳐 들어오면 앞 사이클 확정 — 진짜와 같은 순서
    this.cycles.push(mode);
    this.cycleMode = mode;
    this.cycleT = 0;
  }

  /**
   * 진짜는 최종 상태를 사이클 **시작**에 확정해두고 연출만 시간축에 편다. 여기선 끝에 계산하는데,
   * 사이클 중 standing이 바뀔 경로가 스텁엔 없어 결과가 같다(진짜의 `finishCycle` 스냅과 동일).
   */
  finishCycle() {
    if (this.cycleT < 0) return;
    this.cycleT = -1;
    if (this.cycleMode === 'rack') for (const p of this.pins) p.place();
    else for (const p of this.pins) (p.standing ? p.place() : p.stash());
  }

  update(dt: number) {
    if (this.cycleT < 0) return;
    this.cycleT += dt;
    if (this.cycleT >= CYCLE_SEC[this.cycleMode]) this.finishCycle();
  }

  standingCount(): number { return this.pins.reduce((n, p) => n + (p.standing ? 1 : 0), 0); }
  standingMask(): boolean[] { return this.pins.map((p) => p.standing); }
  allSettled(): boolean { return this.pins.every((p) => p.settled); }
  resetAll() { for (const p of this.pins) p.place(); }
  setLayout(standingPinNumbers: number[]) {
    this.pins.forEach((p, i) => (standingPinNumbers.includes(PIN_NUMBERS[i]) ? p.place() : p.stash()));
  }

  integrate(dt: number) { for (const p of this.pins) p.integrate(dt); }
  /** 현재 서 있는 핀의 **번호** 목록 (테스트가 읽기 좋은 형태). */
  standingNumbers(): number[] { return this.pins.map((p, i) => (p.standing ? PIN_NUMBERS[i] : 0)).filter((n) => n > 0).sort((a, b) => a - b); }
}

// --- Hud / Lane ------------------------------------------------------------

type UsedHud = Pick<Hud, 'update'>;

export class FakeHud implements UsedHud {
  /** GameState가 `refreshHud()`로 밀어넣은 뷰 전부 — HUD 계약 단정용. */
  readonly views: HudView[] = [];
  update(d: HudView) { this.views.push(structuredClone(d)); }
  get last(): HudView { return this.views[this.views.length - 1]; }
}

type UsedLane = Pick<Lane, 'updateFriction' | 'applyOilVisual'>;

export class FakeLane implements UsedLane {
  frictionZ: number[] = [];
  oilVisualCalls = 0;
  updateFriction(z: number) { this.frictionZ.push(z); }
  applyOilVisual() { this.oilVisualCalls += 1; }
}

// --- 드라이버 ---------------------------------------------------------------

export interface ThrowScript {
  /** 이번 투구 뒤 **서 있어야 할** 핀 번호. 가장 표현력이 좋다(현재 선 핀의 부분집합이어야 한다). */
  leave?: number[];
  /** 현재 선 핀 중 몇 개를 쓰러뜨릴지(핀 번호 오름차순 앞에서부터). `leave`와 함께 쓰지 않는다. */
  knock?: number;
  /** 거터 — 공이 레인 밖으로 나가고 핀은 하나도 안 건드린다. */
  gutter?: boolean;
  /** 핀이 영영 안 멎는 상황 — SETTLE_TIMEOUT 정산 경로. */
  neverSettle?: boolean;
  /** 핀을 건드려 움직이게는 하되 쓰러뜨리지 않음(임팩트는 나고 점수는 0). */
  jostleOnly?: boolean;
}

export interface RollOpts {
  /** 기본 true — 끝에 핀세터가 멎을 때까지 진행한다. false면 사이클 중간에서 손을 뗀다. */
  drain?: boolean;
}

export interface RollResult {
  knocked: number;
  standingAfter: number[];
  state: GameState['state'];
}

export interface MatchDriver {
  readonly game: GameState;
  readonly ball: FakeBall;
  readonly pins: FakePinSet;
  readonly hud: FakeHud;
  readonly lane: FakeLane;
  /** 발생한 게임 이벤트 전부(순서 보존). */
  readonly events: GameEvent[];
  /** `setTimeScale`로 넘어온 값 전부 — 슬로모·빨리감기 단정용. */
  readonly timeScales: number[];
  /** `onPinImpact(standingAtThrow)` 호출 인자 전부 — 투구당 1회가 계약. */
  readonly impacts: number[];
  /** `onRoll(speed, inGutter)` 호출 전부 — 굴림 럼블 오디오 계약. */
  readonly rollAudio: { speed: number; inGutter: boolean }[];
  /** gameOver 요약 (아직이면 null). */
  readonly summary: GameSummary | null;

  /**
   * 사람 차례 한 투구 — 던지고, 정산하고, 핀세터가 멎을 때까지 진행한다.
   * `{ drain: false }`면 사이클을 **돌아가는 채로** 남긴다(핀세터 게이팅을 보려는 테스트용).
   */
  roll(script?: ThrowScript, opts?: RollOpts): RollResult;
  /** AI 차례 한 투구 — AI가 스스로 던질 때까지 펌프한 뒤 script대로 정산한다. */
  aiRoll(script?: ThrowScript, opts?: RollOpts): RollResult;
  /** 물리 스텝 n번 (engine.step → game.update 순서 그대로). */
  step(n?: number, dt?: number): void;
  /** 핀세터가 멎을 때까지 진행 — `roll`이 끝에 자동으로 부른다. */
  drainCycle(): void;
}

/** 매치 하나를 세우고 드라이버를 돌려준다. */
export function createMatch(config: MatchConfig): MatchDriver {
  const ball = new FakeBall();
  const pins = new FakePinSet();
  const hud = new FakeHud();
  const lane = new FakeLane();
  const game = new GameState(
    ball as unknown as Ball,
    pins as unknown as PinSet,
    hud as unknown as Hud,
    lane as unknown as Lane,
  );

  const events: GameEvent[] = [];
  const timeScales: number[] = [];
  const impacts: number[] = [];
  const rollAudio: { speed: number; inGutter: boolean }[] = [];
  let summary: GameSummary | null = null;
  game.onEvent = (e) => {
    events.push(e);
    if (e.type === 'gameOver') summary = e.summary;
  };
  game.setTimeScale = (s) => timeScales.push(s);
  game.onPinImpact = (n) => impacts.push(n);
  game.onRoll = (speed, inGutter) => rollAudio.push({ speed, inGutter });

  // 콜백 배선 뒤에 시작해야 startMatch의 setTimeScale(1)·첫 HUD 갱신까지 기록된다.
  game.startMatch(config);

  const step = (n = 1, dt = DT) => {
    for (let i = 0; i < n; i++) {
      // Loop.tick 순서 그대로: engine.step(FIXED_DT) → onStep → game.update
      ball.body.integrate(dt);
      pins.integrate(dt);
      game.update(dt);
    }
  };

  const drainCycle = () => {
    for (let i = 0; i < 1000 && pins.cycling; i++) step();
    if (pins.cycling) throw new Error('핀세터 사이클이 안 끝난다 — CYCLE_SEC 또는 update 배선을 볼 것');
  };

  /** 스크립트를 실제 핀 상태로 옮긴다. 반환 = 이번에 넘어뜨린 수. */
  const applyScript = (s: ThrowScript): number => {
    if (s.gutter) return 0;
    const standingIdx = pins.pins.map((p, i) => (p.standing ? i : -1)).filter((i) => i >= 0);
    if (s.jostleOnly) {
      for (const i of standingIdx) pins.pins[i].jostle(s.neverSettle ? Infinity : IMPACT_STEPS);
      return 0;
    }
    let toKnock: number[];
    if (s.leave) {
      const keep = new Set(s.leave.map(pinIndexByNumber));
      for (const n of s.leave) {
        if (!standingIdx.includes(pinIndexByNumber(n))) throw new Error(`leave: ${n}번 핀은 지금 서 있지 않다`);
      }
      toKnock = standingIdx.filter((i) => !keep.has(i));
    } else {
      const n = s.knock ?? standingIdx.length;
      if (n > standingIdx.length) throw new Error(`knock: ${n}개는 선 핀(${standingIdx.length})보다 많다`);
      // 핀 번호 오름차순으로 앞에서부터 — 결정적이고 읽기 쉬운 순서
      toKnock = [...standingIdx].sort((a, b) => PIN_NUMBERS[a] - PIN_NUMBERS[b]).slice(0, n);
    }
    for (const i of toKnock) pins.pins[i].knockDown(s.neverSettle ? Infinity : IMPACT_STEPS);
    return toKnock.length;
  };

  /** 던진 뒤(state=ROLLING) 정산이 끝날 때까지 굴린다. */
  const settle = (s: ThrowScript, o: RollOpts): RollResult => {
    const before = pins.standingCount();
    if (s.gutter) {
      // 레인 밖으로 밀어낸다 — GameState가 inGutter를 보고 SETTLING으로 넘긴다.
      const v = ball.body.linvel();
      ball.body.setLinvel(v3(LANE_WIDTH, 0, v.z));
    }

    let scripted = false;
    for (let i = 0; i < 4000; i++) {
      // 공이 핀 자리에 닿는 순간 스크립트 적용 (핀덱 앞에서 한 번)
      if (!scripted && ball.body.translation().z >= HEADPIN_Z - BALL_RADIUS) {
        scripted = true;
        applyScript(s);
      }
      step();
      if (game.state !== 'ROLLING' && game.state !== 'SETTLING') break;
    }
    if (game.state === 'ROLLING' || game.state === 'SETTLING') {
      throw new Error(`정산이 안 끝난다 (state=${game.state}) — 스크립트나 공 운동을 볼 것`);
    }
    if (o.drain !== false) drainCycle();
    return { knocked: Math.max(0, before - pins.standingCount()), standingAfter: pins.standingNumbers(), state: game.state };
  };

  return {
    game, ball, pins, hud, lane, events, timeScales, impacts, rollAudio,
    get summary() { return summary; },
    step,
    drainCycle,
    roll(script = {}, opts = {}) {
      if (!game.readyToThrow) throw new Error(`던질 수 없는 상태다 (state=${game.state}, cycling=${pins.cycling})`);
      // aim: 거터면 레인 밖으로 나갈 만큼, 아니면 직진.
      game.throwBall(script.gutter ? 0.2 : 0, 1, 0);
      return settle(script, opts);
    },
    aiRoll(script = {}, opts = {}) {
      for (let i = 0; i < 2000 && game.state !== 'ROLLING'; i++) step();
      if (game.state !== 'ROLLING') throw new Error(`AI가 던지지 않았다 (state=${game.state})`);
      return settle(script, opts);
    },
  };
}

/**
 * localStorage 스텁 설치 — `Stats.recordGame`(gameOver 경로)이 쓴다. node 환경엔 없어서
 * 저장이 조용히 실패하는데(try/catch), 통계 누적을 단정하려면 실물이 필요하다.
 * 반환값을 호출하면 원복된다(`afterEach`에 걸 것).
 */
export function installLocalStorage(): () => void {
  const map = new Map<string, string>();
  const stub = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  };
  const g = globalThis as { localStorage?: Storage };
  const had = 'localStorage' in g;
  const prev = g.localStorage;
  g.localStorage = stub as unknown as Storage;
  return () => { if (had) g.localStorage = prev; else delete g.localStorage; };
}

/**
 * 편의: 오픈 프레임 n개를 빠르게 소화한다(9-0). 10프레임 규칙처럼 **끝 프레임**이 관심사일 때
 * 앞 9프레임을 한 줄로 지나가려고 쓴다.
 */
export function playOpenFrames(m: MatchDriver, count: number, first = 9): void {
  for (let i = 0; i < count; i++) {
    m.roll({ knock: first });
    m.roll({ knock: 0 });
  }
}
