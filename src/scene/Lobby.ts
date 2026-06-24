import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { isCoarsePointer } from '../core/device';
import { AI_PROFILES, type AiProfile } from '../game/ai';

/**
 * 오픈월드 로비 — **별도 공간(라운지)** (docs/OPEN_WORLD_LOBBY.md 슬라이스 1·2).
 * 레인/핀이 없는 독립 네온 라운지를 engine.lobbyScene에 짓고, 그 안에서 절차적 캡슐 아바타로 걸어다니며
 * NPC 라이벌과 대결하거나(§6) 입장 포털로 레인에 들어간다(§1). 레인 전환은 Boot가 로딩 오버레이로 가린다.
 * 이동은 §10 권고대로 **비물리(위치 적분 + 경계 클램프)** — 평평한 단일 바닥이라 Rapier KCC 불필요.
 *
 * 좌표: 플레이어 −z에서 +z(포털)로 전진. 걸을 사각형 = x∈±WALK_X, z∈[BACK, FRONT](§11 H4).
 * 월드 오브젝트 근접+E/탭=콘솔(레인 설정)·락커(스킨 컬렉션, §13), NPC 근접+E/탭=대결(onChallenge).
 */

const WALK_X = 4.2;
const WALK_Z_BACK = -8.5;
const WALK_Z_FRONT = -2.5; // 앞쪽 한계 = 입장 포털 트리거
const SPEED = 3.2; // m/s
const START_Z = -6;
const NPC_RADIUS = 1.5; // 이 거리 안이면 대사·대결 프롬프트 (§6 근접 트리거)
const PORTAL_Z = -1.9;

const NPC_STYLE: Record<string, { body: number; emissive: number; label: string }> = {
  kim: { body: 0x4ade80, emissive: 0x103a1e, label: '#4ade80' },
  yoon: { body: 0xf59e0b, emissive: 0x3a2406, label: '#fbbf24' },
  han: { body: 0xff2d78, emissive: 0x3a0a1e, label: '#ff6aa6' },
};
const NPC_POS: Record<string, [number, number]> = {
  kim: [-2.6, -5.4],
  yoon: [2.6, -5.4],
  han: [0, -7.6],
};

interface Npc {
  profile: AiProfile;
  group: THREE.Group;
}

/**
 * 로비 월드 오브젝트 인터랙터블 (§13 다이제틱 메뉴 A1) — 콘솔/락커 공용.
 * 근접(반경 내 가장 가까운 1개) → 공유 액션 프롬프트 노출, E/탭 → onActivate.
 * NPC 대결은 별도(프로필·대사 버블)라 여기엔 포함하지 않는다.
 */
interface Interactable {
  kind: 'console' | 'locker' | 'board';
  x: number;
  z: number;
  radius: number;
  label: string; // 공유 프롬프트 텍스트 ([E]/탭 안내 포함)
  onActivate: () => void;
}

/** 시작 콘솔 스크린(§13 A2)이 비추는 현재 레인 설정 요약 — Menu.getConfigSummary() 반환과 구조 호환. */
export interface ConsoleSummary {
  mode: string;
  opponent: string;
  difficulty: string;
  oil: string;
  weight: string;
}

/** A2.2 in-world 콘솔의 전체 상태 (요약 + 조준 + custom 플래그) — Menu.getConsoleState()와 구조 호환. */
export interface ConsoleState extends ConsoleSummary {
  aim: string;
  custom: boolean; // true면 오일·조준 행을 인터랙티브 화면에 추가 노출
}

/**
 * A2.2 in-world 콘솔 컨트롤러 — Boot가 주입(Menu 사이클러/CameraRig 도킹/startLaneMatch 브리지).
 * Lobby는 설정 상태를 직접 들지 않고 이 콜백으로만 만진다(단일 소스 = Menu).
 */
export interface ConsoleController {
  cycle(axis: 'mode' | 'opponent' | 'difficulty' | 'oil' | 'aim'): void;
  weight(delta: number): void;
  state(): ConsoleState;
  start(): void; // 현재 설정으로 매치 시작 (씬 전환 = Boot)
}

/** 절차적 로우폴리 인물 (에셋 0) — 캡슐 몸통 + 구 머리 + 앞면 바이저(방향 표식). */
function makeFigure(body: number, emissive: number): THREE.Group {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: body, emissive, emissiveIntensity: 0.6, roughness: 0.4, metalness: 0.1 });
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffe0b8, roughness: 0.6 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.52, 6, 14), bodyMat);
  torso.position.y = 0.55;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 18, 12), headMat);
  head.position.y = 1.02;
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ color: 0x0e1118, emissive: 0x22d3ee, emissiveIntensity: 1.4 }),
  );
  visor.position.set(0, 1.03, 0.13);
  g.add(torso, head, visor);
  return g;
}

/** 머리 위 이름 라벨 — 카메라를 늘 향하는 Sprite + 캔버스 텍스처(에셋 0). */
function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d')!;
  g.font = 'bold 36px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 14;
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
  s.scale.set(1.3, 0.33, 1);
  return s;
}

/** 네온 그리드 바닥 텍스처 — 레인(나무결)과 확연히 다른 라운지 톤. */
function makeGridTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0a0814';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(34,211,238,0.6)';
  g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i <= 8; i++) {
    const p = i * 32;
    g.moveTo(p, 0);
    g.lineTo(p, 256);
    g.moveTo(0, p);
    g.lineTo(256, p);
  }
  g.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(8, 8);
  return t;
}

/** 네온 사인 플레인 (텍스트, 절차적). glow/fill 색을 받아 포털(시안)·락커(마젠타) 등 톤 구분. */
function makeSign(text: string, glow = '#22d3ee', fill = '#c7f6ff'): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 60px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = glow;
  g.shadowBlur = 24;
  g.fillStyle = fill;
  g.fillText(text, 256, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 0.85),
    new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, depthWrite: false }),
  );
}

export class Lobby {
  /** 카메라 팔로우 대상 (CameraRig.setLobbyAvatar로 주입) */
  readonly avatar: THREE.Group;
  private readonly pad: THREE.Mesh; // 포털 바닥 링 (펄스)
  private readonly padMat: THREE.MeshBasicMaterial;
  private readonly prompt: HTMLDivElement;
  private readonly npcs: Npc[] = [];
  private readonly bubble: HTMLDivElement;
  private readonly interactables: Interactable[] = []; // 콘솔·락커 등 월드 오브젝트 (§13 A1)
  private readonly consoleCanvas: HTMLCanvasElement; // 시작 콘솔 스크린 라이브 프리뷰 (§13 A2)
  private readonly consoleTex: THREE.CanvasTexture; // consoleCanvas → 콘솔 스크린 메시 머티리얼 map
  private consoleScreen!: THREE.Mesh; // 콘솔 스크린 메시 (A2.2 레이캐스트 대상)
  private _consoleActive = false; // A2.2 in-world 콘솔 활성 (카메라 도킹 + 인터랙티브 화면)
  private readonly raycaster = new THREE.Raycaster(); // A2.2 포인터 → 스크린 히트
  private readonly pointer = new THREE.Vector2();
  private activeBands: { id: string; y0: number; y1: number }[] = []; // 인터랙티브 화면 히트 밴드(정규화 y, 상단=0)
  private lastIdle: ConsoleSummary | null = null; // 마지막 유휴 요약(콘솔 이탈 시 복귀 렌더)
  private lockerBall: THREE.Mesh | null = null; // 스킨 락커 위 떠 있는 미리보기 볼 (idle 보브)
  private nearNpc: AiProfile | null = null;
  private nearTarget: Interactable | null = null; // 근접 중인 월드 오브젝트 (E/탭 시 onActivate) — 구 nearPortal 일반화
  private readonly keys = new Set<string>();
  private joy: { wrap: HTMLDivElement; x: number; y: number } | null = null;
  private active = false;
  private suspended = false; // 콘솔 패널 등 오버레이 동안 이동·프롬프트 정지 (아바타는 유지)
  private facing = 0;
  private time = 0;

  /** 시작 콘솔 컨트롤러 (§13 A2.2, Boot 주입) — 사이클/무게/상태/시작 브리지. 콘솔은 in-world(레이캐스트)로 동작. */
  consoleCtrl?: ConsoleController;
  /** 콘솔 카메라 도킹/해제 (§13 A2.2, Boot가 CameraRig로 배선). */
  onDockConsole?: (pos: THREE.Vector3, target: THREE.Vector3) => void;
  onUndockConsole?: () => void;
  /** 스킨 락커 근접 + E/탭 — Boot가 컬렉션 패널(showSkinLocker)을 연다 (§13 스텝3) */
  onOpenLocker?: () => void;
  /** 통계 보드 근접 + E/탭 — Boot가 통계 패널(showStats)을 연다 (§13 스텝4) */
  onOpenBoard?: () => void;
  /** NPC 대결 (근접 + E/탭) — Boot가 로딩 전환 + startMatch(vs AI)로 연결 */
  onChallenge?: (profile: AiProfile) => void;

  constructor(engine: Engine) {
    // --- 라운지 환경 (별도 공간, 레인·핀 없음) → engine.lobbyScene ---
    const grid = makeGridTexture();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 16),
      new THREE.MeshStandardMaterial({ map: grid, emissiveMap: grid, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.6, metalness: 0.1 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -5);
    engine.addLobby(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: 0x12101e, roughness: 0.9 });
    for (const sx of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, 16), wallMat);
      wall.position.set(sx * 6.4, 2, -5);
      engine.addLobby(wall);
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 12),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: sx < 0 ? 0xff2d78 : 0x22d3ee, emissiveIntensity: 2 }),
      );
      strip.position.set(sx * 6.2, 2.7, -5);
      engine.addLobby(strip);
    }

    // 입장 포털 (앞쪽) — 아치 + 안쪽 글로우 + 네온 사인 + 바닥 펄스 링
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(1.0, 0.07, 14, 44),
      new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x22d3ee, emissiveIntensity: 1.8, roughness: 0.4 }),
    );
    arch.position.set(0, 1.15, PORTAL_Z);
    engine.addLobby(arch);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 40),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.12, side: THREE.DoubleSide, toneMapped: false, depthWrite: false }),
    );
    glow.position.set(0, 1.15, PORTAL_Z - 0.02);
    engine.addLobby(glow);
    const sign = makeSign('▶ 레인 입장');
    sign.position.set(0, 2.5, PORTAL_Z);
    engine.addLobby(sign);

    this.padMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      toneMapped: false,
      depthWrite: false,
    });
    this.pad = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.0, 40), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    this.pad.position.set(0, 0.02, PORTAL_Z);
    this.pad.renderOrder = 3;
    engine.addLobby(this.pad);

    // 시작 콘솔 (§13 A1) — 포털 옆 다이제틱 터미널. 근접 → E/탭으로 레인 설정 패널이 열린다.
    const consoleBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.95, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x12101e, emissive: 0x0a2730, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.3 }),
    );
    consoleBase.position.set(1.35, 0.48, PORTAL_Z + 0.25);
    consoleBase.rotation.y = -0.4;
    engine.addLobby(consoleBase);
    // 스크린은 단색 평면이 아니라 CanvasTexture(§13 A2) — 현재 레인 설정을 다이제틱하게 비추는 라이브 프리뷰.
    // (하이브리드: 화면=프리뷰, 실제 변경은 근접 E/탭 → DOM 패널. Boot가 setConsoleSummary로 갱신.)
    // 체이스캠이 +z를 보므로 스크린 법선이 플레이어(−z)를 향하게 회전(−2.74 ≈ 베이스 −0.4를 플레이어축으로 미러).
    this.consoleCanvas = document.createElement('canvas');
    this.consoleCanvas.width = 512;
    this.consoleCanvas.height = 356;
    this.consoleTex = new THREE.CanvasTexture(this.consoleCanvas);
    this.consoleTex.colorSpace = THREE.SRGBColorSpace;
    this.drawConsoleIdle(null); // 부팅 플레이스홀더 — Boot가 곧 실제 설정으로 갱신
    this.consoleScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.35),
      new THREE.MeshBasicMaterial({ map: this.consoleTex, transparent: true, toneMapped: false, side: THREE.DoubleSide }),
    );
    // 베이스 위·앞으로 띄운 홀로 패널 — 도킹(A2.2) 시 베이스가 스크린을 가리지 않게 + 유휴 시 키오스크 위 떠있는 터미널.
    this.consoleScreen.position.set(1.27, 1.1, -2.0);
    this.consoleScreen.rotation.y = -2.74;
    engine.addLobby(this.consoleScreen);

    // 스킨 락커 (§13 스텝3) — 콘솔 반대편(좌측) 다이제틱 키오스크. 근접 → E/탭으로 컬렉션 패널.
    // 좌측 벽 네온이 마젠타라 락커도 마젠타 톤으로 통일(콘솔=시안과 대비 → 두 오브젝트 구분).
    const LOCKER_X = -3.0;
    const LOCKER_Z = -2.1;
    const lockerBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 1.5, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x16101e, emissive: 0x2a0a1e, emissiveIntensity: 0.6, roughness: 0.5, metalness: 0.3 }),
    );
    lockerBody.position.set(LOCKER_X, 0.75, LOCKER_Z);
    lockerBody.rotation.y = 0.4; // 중앙을 향해 살짝 틀기 (콘솔 -0.4의 미러)
    engine.addLobby(lockerBody);
    const lockerScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.66),
      new THREE.MeshBasicMaterial({ color: 0xff2d78, transparent: true, opacity: 0.82, toneMapped: false, side: THREE.DoubleSide }),
    );
    // 0.4rad 회전한 전면에 디스플레이 부착 (법선 방향으로 살짝 띄움)
    lockerScreen.position.set(LOCKER_X + Math.sin(0.4) * 0.24, 0.95, LOCKER_Z + Math.cos(0.4) * 0.24);
    lockerScreen.rotation.y = 0.4;
    engine.addLobby(lockerScreen);
    // 떠 있는 미리보기 볼 — "스킨" 상징. update()에서 천천히 보브/회전.
    const lockerBall = new THREE.Mesh(
      new THREE.SphereGeometry(0.17, 24, 16),
      new THREE.MeshStandardMaterial({ color: 0xff6aa6, emissive: 0xff2d78, emissiveIntensity: 0.5, roughness: 0.2, metalness: 0.5 }),
    );
    lockerBall.position.set(LOCKER_X, 1.72, LOCKER_Z);
    engine.addLobby(lockerBall);
    this.lockerBall = lockerBall;
    const lockerSign = makeSign('🎨 스킨', '#ff2d78', '#ffd5e6');
    lockerSign.scale.set(0.62, 0.62, 0.62); // 포털 사인보다 작게 (보조 오브젝트)
    lockerSign.position.set(LOCKER_X, 2.25, LOCKER_Z);
    engine.addLobby(lockerSign);

    // 통계 보드 (§13 스텝4) — 우측 벽면(시안 네온 쪽) 리더보드. 근접 → 통계 패널(showStats).
    // 콘솔·락커가 전방 자립형인 것과 달리 보드는 벽 부착형(다양성). 사인은 실내(-x)를 향해 가독.
    const BOARD_X = 6.1;
    const BOARD_Z = -3.4;
    const boardFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.5, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x10131c, emissive: 0x06222a, emissiveIntensity: 0.5, roughness: 0.5, metalness: 0.3 }),
    );
    boardFrame.position.set(BOARD_X, 1.85, BOARD_Z);
    engine.addLobby(boardFrame);
    const boardScreen = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 1.0),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.16, toneMapped: false, side: THREE.DoubleSide }),
    );
    boardScreen.position.set(BOARD_X - 0.07, 1.7, BOARD_Z);
    boardScreen.rotation.y = -Math.PI / 2; // 우측 벽 → 실내(-x)를 향함
    engine.addLobby(boardScreen);
    const boardSign = makeSign('📊 기록', '#22d3ee', '#c7f6ff');
    boardSign.scale.set(0.72, 0.72, 0.72);
    boardSign.position.set(BOARD_X - 0.08, 2.35, BOARD_Z);
    boardSign.rotation.y = -Math.PI / 2;
    engine.addLobby(boardSign);

    // 월드 오브젝트 인터랙터블 등록 (§13 A1) — 근접 판정·프롬프트·activate 공용 경로.
    // 콘솔=포털 전방 중앙, 락커=좌측, 보드=우측 벽. onActivate는 Boot 주입 콜백을 지연 호출(late-bind).
    this.interactables.push(
      { kind: 'console', x: 0, z: -2.6, radius: 1.5, label: '▶ 레인 설정 — [E] / 탭', onActivate: () => this.enterConsole() },
      { kind: 'locker', x: LOCKER_X, z: LOCKER_Z, radius: 1.4, label: '🎨 스킨 락커 — [E] / 탭', onActivate: () => this.onOpenLocker?.() },
      { kind: 'board', x: 4.0, z: BOARD_Z, radius: 1.6, label: '📊 통계 — [E] / 탭', onActivate: () => this.onOpenBoard?.() },
    );

    // --- 플레이어 아바타 (시안) ---
    this.avatar = makeFigure(0x2bd4ee, 0x0b3b45);
    this.avatar.position.set(0, 0, START_Z);
    this.avatar.visible = false;
    engine.addLobby(this.avatar);

    // --- NPC 라이벌 (ai.ts kim/yoon/han을 캐릭터로 승격, §6) ---
    for (const profile of AI_PROFILES) {
      const style = NPC_STYLE[profile.key] ?? { body: 0x8899aa, emissive: 0x223344, label: '#cdd7e5' };
      const pos = NPC_POS[profile.key] ?? [0, -7];
      const group = new THREE.Group();
      const label = makeLabel(profile.name, style.label);
      label.position.set(0, 1.6, 0);
      group.add(makeFigure(style.body, style.emissive), label);
      group.position.set(pos[0], 0, pos[1]);
      group.visible = false;
      engine.addLobby(group);
      this.npcs.push({ profile, group });
    }

    // --- DOM 진입 프롬프트 (포털) ---
    this.prompt = document.createElement('div');
    this.prompt.textContent = '▶ 레인 설정 — [E] / 탭';
    this.prompt.style.cssText = bubbleCss('calc(64px + env(safe-area-inset-top))', 'rgba(34,211,238,0.55)', '0 0 18px rgba(34,211,238,0.3)');
    this.prompt.style.cursor = 'pointer';
    this.prompt.onclick = () => this.activateTarget();
    document.body.appendChild(this.prompt);

    // --- DOM NPC 대사 버블 (근접 시) — 탭하면 대결 ---
    this.bubble = document.createElement('div');
    this.bubble.style.cssText = bubbleCss('50%', 'rgba(255,213,74,0.5)', '0 0 20px rgba(0,0,0,0.5)');
    this.bubble.style.transform = 'translate(-50%, -50%)';
    this.bubble.style.cursor = 'pointer';
    this.bubble.style.maxWidth = 'min(86vw, 420px)';
    this.bubble.style.textAlign = 'center';
    this.bubble.onclick = () => {
      if (this.nearNpc) this.challenge(this.nearNpc);
    };
    document.body.appendChild(this.bubble);

    // --- 입력: 키보드 ---
    const MOVE_CODES = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (this._consoleActive) { // 콘솔 활성 중엔 이동/대결 입력 차단, Esc만 이탈
        if (e.code === 'Escape') this.exitConsole();
        return;
      }
      if (e.code === 'KeyE') {
        if (this.nearNpc) this.challenge(this.nearNpc); // §6 "대결하기 [E]"
        else this.activateTarget(); // §13 근접 월드 오브젝트(콘솔/락커) activate
        return;
      }
      if (!MOVE_CODES.has(e.code)) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    if (isCoarsePointer()) this.joy = this.buildJoystick();

    // A2.2 — 콘솔 활성 중 포인터 탭 → 스크린 레이캐스트 → 밴드 액션 (마우스 클릭·터치 공용, 활성 아닐 땐 무시).
    engine.renderer.domElement.addEventListener('pointerdown', (e) => {
      if (!this._consoleActive) return;
      const rect = engine.renderer.domElement.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointer, engine.camera);
      const hit = this.raycaster.intersectObject(this.consoleScreen, false)[0];
      if (hit?.uv) this.handleConsoleHit(hit.uv.x, 1 - hit.uv.y); // uv 원점=좌하단 → 캔버스 v(상단=0)로 뒤집기
    });
  }

  /** 로비 진입/이탈 — 위치 리셋 + 입력/아바타·NPC·UI 토글 (로비 씬은 setScreen으로 렌더 제어). */
  setActive(b: boolean) {
    this.active = b;
    this._consoleActive = false; // 콘솔 도킹/활성 해제 (로비 진입·이탈·매치 시작 공통 — 복귀 시 재도킹 방지)
    this.onUndockConsole?.();
    this.avatar.visible = b;
    for (const n of this.npcs) n.group.visible = b;
    this.prompt.style.display = 'none';
    this.bubble.style.display = 'none';
    this.nearNpc = null;
    this.nearTarget = null;
    this.suspended = false;
    if (this.joy) {
      this.joy.wrap.style.display = b ? 'block' : 'none';
      this.joy.x = 0;
      this.joy.y = 0;
    }
    this.keys.clear();
    if (b) {
      this.avatar.position.set(0, 0, START_Z);
      this.avatar.rotation.y = 0;
      this.facing = 0;
    }
  }

  /** 콘솔 등 DOM 오버레이 동안 이동·프롬프트만 정지 (아바타·NPC는 유지 — setActive와 달리 안 숨김). */
  suspend(b: boolean) {
    this.suspended = b;
    if (b) {
      this.keys.clear();
      if (this.joy) {
        this.joy.x = 0;
        this.joy.y = 0;
      }
      this.prompt.style.display = 'none';
      this.bubble.style.display = 'none';
    }
  }

  /** A2.2 — 콘솔 활성(카메라 도킹 + 인터랙티브) 여부. Boot onFrame이 기어 버튼 가시성에 사용. */
  get consoleActive(): boolean {
    return this._consoleActive;
  }

  /** 시작 콘솔 유휴 화면 갱신 (§13 A2.1) — Boot가 로비 진입·패널 닫기 시 호출. 활성 중이면 인터랙티브가 우선이라 보류. */
  setConsoleSummary(s: ConsoleSummary) {
    this.lastIdle = s;
    if (!this._consoleActive) this.drawConsoleIdle(s);
  }

  /** 콘솔 패널 공통 배경(어두운 패널 + 시안 테두리) + 타이틀. 유휴·인터랙티브 공용. */
  private consoleBg(g: CanvasRenderingContext2D, W: number, H: number) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#04141c';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(34,211,238,0.85)';
    g.lineWidth = 5;
    g.strokeRect(6, 6, W - 12, H - 12);
    g.textBaseline = 'middle';
    g.shadowColor = '#22d3ee';
    g.shadowBlur = 16;
    g.fillStyle = '#7fe9ff';
    g.font = 'bold 32px system-ui, sans-serif';
    g.textAlign = 'left';
    g.fillText('▶ 레인 설정', 26, 40);
    g.shadowBlur = 0;
  }

  /** A2.1 유휴 화면 — 설정 요약(읽기 전용). s=null이면 부팅 플레이스홀더. */
  private drawConsoleIdle(s: ConsoleSummary | null) {
    const W = this.consoleCanvas.width;
    const H = this.consoleCanvas.height;
    const g = this.consoleCanvas.getContext('2d')!;
    this.consoleBg(g, W, H);
    if (!s) {
      g.fillStyle = '#3b7e8c';
      g.font = '24px system-ui, sans-serif';
      g.fillText('booting…', 26, 108);
      this.consoleTex.needsUpdate = true;
      return;
    }
    const rows: [string, string][] = [
      ['모드', s.mode], ['상대', s.opponent], ['난이도', s.difficulty], ['오일', s.oil], ['무게', s.weight],
    ];
    let y = 90;
    for (const [k, v] of rows) {
      g.font = '22px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#4aa6b8';
      g.fillText(k, 26, y);
      g.font = 'bold 24px system-ui, sans-serif';
      g.textAlign = 'right';
      g.fillStyle = '#dffaff';
      g.fillText(v, W - 26, y);
      y += 44;
    }
    g.font = '18px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#3b7e8c';
    g.fillText('[E] · 탭 — 설정', W / 2, H - 22);
    this.consoleTex.needsUpdate = true;
  }

  /** A2.2 인터랙티브 화면 — 사이클 행 + 무게 ‹ › + 게임 시작 + ← 로비. 히트 밴드를 activeBands에 저장(레이캐스트 공용). */
  private drawConsoleActive() {
    const st = this.consoleCtrl?.state();
    const W = this.consoleCanvas.width;
    const H = this.consoleCanvas.height;
    const g = this.consoleCanvas.getContext('2d')!;
    this.consoleBg(g, W, H);
    if (!st) { this.consoleTex.needsUpdate = true; return; }
    g.font = 'bold 18px system-ui, sans-serif'; // ← 로비 (우상단)
    g.textAlign = 'right';
    g.fillStyle = '#7fbecb';
    g.fillText('← 로비', W - 22, 40);
    const rows: { id: string; label: string; value: string }[] = [
      { id: 'mode', label: '모드', value: st.mode },
      { id: 'opponent', label: '상대', value: st.opponent },
      { id: 'difficulty', label: '난이도', value: st.difficulty },
    ];
    if (st.custom) { // 커스텀 난이도일 때만 오일·조준 직접 선택 행 노출
      rows.push({ id: 'oil', label: '오일', value: st.oil });
      rows.push({ id: 'aim', label: '조준', value: st.aim });
    }
    rows.push({ id: 'weight', label: '무게', value: st.weight });
    const rowsTop = 0.18; // 타이틀 아래
    const rowsBottom = 0.82; // 게임시작 위
    const bandH = (rowsBottom - rowsTop) / rows.length;
    this.activeBands = [{ id: 'back', y0: 0, y1: rowsTop }]; // 상단 = 뒤로(← 로비)
    rows.forEach((r, i) => {
      const y0 = rowsTop + i * bandH;
      const y1 = y0 + bandH;
      this.activeBands.push({ id: r.id, y0, y1 });
      const cy = ((y0 + y1) / 2) * H;
      g.strokeStyle = 'rgba(34,211,238,0.16)'; // 행 구분선
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(18, y1 * H);
      g.lineTo(W - 18, y1 * H);
      g.stroke();
      g.font = '22px system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillStyle = '#4aa6b8';
      g.fillText(r.label, 26, cy);
      g.textAlign = 'right';
      g.font = 'bold 24px system-ui, sans-serif';
      g.fillStyle = '#dffaff';
      g.fillText(r.id === 'weight' ? `‹  ${r.value}  ›` : `${r.value}  ›`, W - 26, cy);
    });
    const by0 = rowsBottom; // 게임 시작 버튼 (하단)
    this.activeBands.push({ id: 'start', y0: by0, y1: 1 });
    g.fillStyle = 'rgba(34,211,238,0.18)';
    g.fillRect(16, by0 * H + 6, W - 32, (1 - by0) * H - 14);
    g.strokeStyle = '#22d3ee';
    g.lineWidth = 2;
    g.strokeRect(16, by0 * H + 6, W - 32, (1 - by0) * H - 14);
    g.font = 'bold 28px system-ui, sans-serif';
    g.textAlign = 'center';
    g.shadowColor = '#22d3ee';
    g.shadowBlur = 12;
    g.fillStyle = '#dffaff';
    g.fillText('▶ 게임 시작', W / 2, ((by0 + 1) / 2) * H);
    g.shadowBlur = 0;
    this.consoleTex.needsUpdate = true;
  }

  /** 콘솔 진입 (§13 A2.2) — E/탭 활성화: 카메라 도킹 + 이동 정지 + 인터랙티브 화면 + 레이캐스트 on. */
  enterConsole() {
    if (!this.active || this._consoleActive) return;
    this._consoleActive = true;
    this.suspend(true); // 이동/프롬프트 정지(키 클리어)
    if (this.joy) this.joy.wrap.style.display = 'none';
    const sp = new THREE.Vector3(); // 도킹 포즈: 스크린 월드 위치 + 법선 앞 0.62m, 스크린 응시
    this.consoleScreen.getWorldPosition(sp);
    const n = new THREE.Vector3(0, 0, 1).applyQuaternion(this.consoleScreen.quaternion).normalize();
    this.onDockConsole?.(sp.clone().addScaledVector(n, 0.62), sp);
    this.drawConsoleActive();
  }

  /** 콘솔 이탈 (§13 A2.2) — ← 로비/Esc: 도킹 해제 + 이동 재개 + 유휴 화면(변경된 설정 반영) 복귀. */
  exitConsole() {
    if (!this._consoleActive) return;
    this._consoleActive = false;
    this.onUndockConsole?.();
    this.suspend(false);
    if (this.joy) this.joy.wrap.style.display = this.active ? 'block' : 'none';
    this.drawConsoleIdle(this.consoleCtrl?.state() ?? this.lastIdle);
  }

  /** 레이캐스트 히트(u,v: 캔버스 정규화, v 상단=0) → 밴드 액션. 사이클/무게는 재렌더, 시작/뒤로는 이탈. */
  private handleConsoleHit(u: number, v: number) {
    const band = this.activeBands.find((b) => v >= b.y0 && v < b.y1);
    if (!band) return;
    if (band.id === 'back') { this.exitConsole(); return; }
    if (band.id === 'start') { // 매치 시작 — 도킹/활성 정리 후 Boot가 씬 전환(setActive(false)도 정리)
      this._consoleActive = false;
      this.onUndockConsole?.();
      this.consoleCtrl?.start();
      return;
    }
    if (band.id === 'weight') this.consoleCtrl?.weight(u < 0.5 ? -1 : 1); // 좌=−1 / 우=+1
    else this.consoleCtrl?.cycle(band.id as 'mode' | 'opponent' | 'difficulty' | 'oil' | 'aim');
    this.drawConsoleActive();
  }

  /** Boot.onFrame에서 state==='LOBBY'일 때 호출 (프레임 dt) */
  update(dt: number) {
    if (!this.active || this.suspended) return;
    this.time += dt;

    let mx = 0;
    let mz = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) mz += 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) mz -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) mx += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) mx -= 1;
    if (this.joy) {
      mx += this.joy.x;
      mz += this.joy.y;
    }
    // 로비 체이스캠이 +z(포털)를 바라봐 월드 +x가 화면 왼쪽이다(우핸드 좌표계) — 입력 x를 뒤집어
    // A=화면 왼쪽 · D=화면 오른쪽으로 맞춘다. 키보드·조이스틱·facing이 모두 이 mx를 쓰므로 한 줄로 일괄 교정.
    // (후속: docs/OPEN_WORLD_LOBBY.md §12.4 카메라 시점 조절이 들어오면 카메라 yaw 기반 이동으로 일반화.)
    mx = -mx;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }

    const p = this.avatar.position;
    p.x = THREE.MathUtils.clamp(p.x + mx * SPEED * dt, -WALK_X, WALK_X);
    p.z = THREE.MathUtils.clamp(p.z + mz * SPEED * dt, WALK_Z_BACK, WALK_Z_FRONT);
    if (len > 0.01) {
      this.facing = Math.atan2(mx, mz);
      this.avatar.rotation.y = this.facing;
    }

    const osc = 0.5 + 0.5 * Math.sin(this.time * 4);
    this.pad.scale.setScalar(1 + osc * 0.08);
    this.padMat.opacity = 0.35 + 0.3 * osc;
    if (this.lockerBall) {
      // 스킨 락커 미리보기 볼 — 느린 보브 + 회전으로 '살아있는' 키오스크 느낌 (§13 스텝3).
      this.lockerBall.position.y = 1.72 + Math.sin(this.time * 1.6) * 0.05;
      this.lockerBall.rotation.y = this.time * 0.7;
    }

    // 근접 우선순위: NPC(대사 버블) > 월드 오브젝트(공유 액션 프롬프트). 한 프레임에 하나만 노출.
    let near: Npc | null = null;
    let best = NPC_RADIUS;
    for (const n of this.npcs) {
      const d = Math.hypot(p.x - n.group.position.x, p.z - n.group.position.z);
      if (d < best) {
        best = d;
        near = n;
      }
    }
    this.nearNpc = near?.profile ?? null;
    // 월드 오브젝트(콘솔/락커, §13 A1) — NPC가 없을 때만, 반경 내 가장 가까운 1개를 nearTarget으로.
    let target: Interactable | null = null;
    if (!near) {
      let bestD = Infinity;
      for (const it of this.interactables) {
        const d = Math.hypot(p.x - it.x, p.z - it.z);
        if (d <= it.radius && d < bestD) {
          bestD = d;
          target = it;
        }
      }
    }
    this.nearTarget = target;

    if (near) {
      this.prompt.style.display = 'none';
      this.bubble.style.display = 'block';
      this.bubble.innerHTML =
        `<div style="font-weight:800;margin-bottom:3px">${near.profile.name} <span style="opacity:.7;font-weight:600">· ${near.profile.tagline}</span></div>` +
        `<div style="font-size:11px;color:#ffd54a">⚔ 대결하기 — [E] / 탭</div>`;
    } else if (target) {
      this.bubble.style.display = 'none';
      this.prompt.textContent = target.label;
      this.prompt.style.display = 'block';
    } else {
      this.bubble.style.display = 'none';
      this.prompt.style.display = 'none';
    }
  }

  /** 근접 중인 월드 오브젝트 활성화 (E/탭) — 콘솔=showMenu, 락커=showSkinLocker. 실제 패널은 Boot 콜백. */
  private activateTarget() {
    if (!this.active || this.suspended) return;
    this.nearTarget?.onActivate();
  }

  /** NPC 대결 — 실제 씬 전환/매치 시작은 Boot.onChallenge(로딩 전환)가 담당. */
  private challenge(profile: AiProfile) {
    if (!this.active) return;
    this.onChallenge?.(profile);
  }

  /** 좌하단 고정 가상 조이스틱 (DOM, 의존성 0). knob 드래그 → x/y ∈ [-1,1] (y: +=전진). */
  private buildJoystick(): { wrap: HTMLDivElement; x: number; y: number } {
    const R = 56;
    const wrap = document.createElement('div');
    wrap.style.cssText = [
      'position:fixed',
      'left:calc(20px + env(safe-area-inset-left))',
      'bottom:calc(24px + env(safe-area-inset-bottom))',
      `width:${R * 2}px`,
      `height:${R * 2}px`,
      'border-radius:50%',
      'background:rgba(14,17,27,0.5)',
      'border:1px solid rgba(34,211,238,0.35)',
      'z-index:25',
      'display:none',
      'touch-action:none',
    ].join(';');
    const knob = document.createElement('div');
    knob.style.cssText = [
      'position:absolute',
      'left:50%',
      'top:50%',
      'width:48px',
      'height:48px',
      'margin:-24px 0 0 -24px',
      'border-radius:50%',
      'background:rgba(34,211,238,0.85)',
      'box-shadow:0 0 14px rgba(34,211,238,0.6)',
    ].join(';');
    wrap.appendChild(knob);
    document.body.appendChild(wrap);

    const state = { wrap, x: 0, y: 0 };
    let id: number | null = null;
    const setFrom = (clientX: number, clientY: number) => {
      const r = wrap.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let dx = (clientX - cx) / R;
      let dy = (clientY - cy) / R;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      state.x = dx;
      state.y = -dy;
      knob.style.left = `${50 + dx * 50}%`;
      knob.style.top = `${50 + dy * 50}%`;
    };
    const reset = () => {
      id = null;
      state.x = 0;
      state.y = 0;
      knob.style.left = '50%';
      knob.style.top = '50%';
    };
    wrap.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      wrap.setPointerCapture(e.pointerId);
      setFrom(e.clientX, e.clientY);
      e.preventDefault();
    });
    wrap.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) setFrom(e.clientX, e.clientY);
    });
    wrap.addEventListener('pointerup', (e) => {
      if (e.pointerId === id) reset();
    });
    wrap.addEventListener('pointercancel', () => reset());
    return state;
  }
}

/** 로비 DOM 프롬프트/버블 공통 스타일. */
function bubbleCss(top: string, border: string, shadow: string): string {
  return [
    'position:fixed',
    'left:50%',
    `top:${top}`,
    'transform:translateX(-50%)',
    'padding:9px 16px',
    'border-radius:14px',
    'background:rgba(14,17,27,0.92)',
    `border:1px solid ${border}`,
    'color:#e8edf5',
    "font:700 13px/1.45 system-ui, sans-serif",
    'letter-spacing:0.01em',
    'z-index:25',
    'display:none',
    `box-shadow:${shadow}`,
  ].join(';');
}
