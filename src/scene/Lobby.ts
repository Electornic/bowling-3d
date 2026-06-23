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
 * 앞쪽 한계(포털) 도달=레인 입장(onEnterLane), NPC 근접+E/탭=대결(onChallenge).
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

/** 네온 사인 플레인 (텍스트, 절차적). */
function makeSign(text: string): THREE.Mesh {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.font = 'bold 60px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = '#22d3ee';
  g.shadowBlur = 24;
  g.fillStyle = '#c7f6ff';
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
  private nearNpc: AiProfile | null = null;
  private readonly keys = new Set<string>();
  private joy: { wrap: HTMLDivElement; x: number; y: number } | null = null;
  private active = false;
  private facing = 0;
  private time = 0;
  private triggered = false;

  /** 레인 입장(포털 도달) — Boot가 로딩 전환 + startMatch(솔로)로 연결 */
  onEnterLane?: () => void;
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
    this.prompt.textContent = '▶ 레인 입장 — [W]로 포털 진입';
    this.prompt.style.cssText = bubbleCss('calc(64px + env(safe-area-inset-top))', 'rgba(34,211,238,0.55)', '0 0 18px rgba(34,211,238,0.3)');
    this.prompt.style.pointerEvents = 'none';
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
      if (e.code === 'KeyE') {
        if (this.nearNpc) this.challenge(this.nearNpc); // §6 "대결하기 [E]"
        return;
      }
      if (!MOVE_CODES.has(e.code)) return;
      this.keys.add(e.code);
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    if (isCoarsePointer()) this.joy = this.buildJoystick();
  }

  /** 로비 진입/이탈 — 위치 리셋 + 입력/아바타·NPC·UI 토글 (로비 씬은 setScreen으로 렌더 제어). */
  setActive(b: boolean) {
    this.active = b;
    this.avatar.visible = b;
    for (const n of this.npcs) n.group.visible = b;
    this.prompt.style.display = 'none';
    this.bubble.style.display = 'none';
    this.nearNpc = null;
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
      this.triggered = false;
    }
  }

  /** Boot.onFrame에서 state==='LOBBY'일 때 호출 (프레임 dt) */
  update(dt: number) {
    if (!this.active) return;
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

    // NPC 근접 — 가장 가까운 반경 내 NPC 대사 버블 (§6). 없으면 포털 근접 프롬프트.
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
    if (near) {
      this.prompt.style.display = 'none';
      this.bubble.style.display = 'block';
      this.bubble.innerHTML =
        `<div style="font-weight:800;margin-bottom:3px">${near.profile.name} <span style="opacity:.7;font-weight:600">· ${near.profile.tagline}</span></div>` +
        `<div style="font-size:11px;color:#ffd54a">⚔ 대결하기 — [E] / 탭</div>`;
    } else {
      this.bubble.style.display = 'none';
      this.prompt.style.display = p.z > WALK_Z_FRONT - 0.9 ? 'block' : 'none';
    }

    // 포털 도달 = 레인 입장 (1회). clamp가 WALK_Z_FRONT에서 멈추므로 그 지점에서 발동.
    if (!this.triggered && p.z >= WALK_Z_FRONT - 0.02) {
      this.triggered = true;
      this.prompt.style.display = 'none';
      this.onEnterLane?.();
    }
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
