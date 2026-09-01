import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine } from '../core/Engine';
import { getRapier } from '../core/Boot';
import {
  BALL_RADIUS,
  BALL_START_Z,
  MIN_SPEED,
  MAX_SPEED,
  SLIP_EPS,
  FRICTION_K,
  REF_MASS,
  SPIN_RATE,
  effectiveSpin,
  ROLL_RATIO,
  BALL_FRICTION,
  BALL_GROUPS_ALL,
  BALL_GROUPS_NO_PINS,
} from '../game/constants';
import { hookFactor } from '../game/oil';
import type { BallSpec } from '../game/BallSpec';
import { CLASSIC_SKIN, type BallSkin } from '../game/rewards';

/**
 * 볼링 공: 시각 메시 + 물리 강체. 무게는 BallSpec에서 주입 (도안 §4.5).
 * CCD on (터널링 방지 §4·§13).
 */
export class Ball {
  readonly mesh: THREE.Mesh;
  readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private spec: BallSpec;
  private skin: BallSkin = CLASSIC_SKIN;
  private readonly gripMats: THREE.MeshStandardMaterial[] = [];
  private readonly weightMat: THREE.MeshStandardMaterial; // 무게 각인 (파운드)

  constructor(engine: Engine, spec: BallSpec) {
    const RAPIER = getRapier();
    this.spec = spec;

    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 32, 16),
      new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.25, metalness: 0.3 }),
    );
    this.mesh.castShadow = true;

    // 표면 마킹 (회전이 '보이게' — 무지 구는 ωz가 커도 도는 게 안 보인다). 자식이라 공과 함께 회전.
    const placeMark = (dir: THREE.Vector3, radius: number, color: number): THREE.Mesh => {
      const m = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 16),
        new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
      );
      m.position.copy(dir).multiplyScalar(BALL_RADIUS + 0.0006); // 표면 바로 위 (z-fight 방지)
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir); // 법선 = 바깥
      this.mesh.add(m);
      return m;
    };
    // 손가락 구멍 3개 (grip 주변 작은 삼각형, 어두움)
    // NOTE: setSpec은 공 본체색만 바꾸고 구멍색은 고정(0x0a0a0a)이라 어두운 공에선 대비가 낮아 묻힘 — 알려진 사양(유지)
    const grip = new THREE.Vector3(0.4, 0.9, 0.3).normalize();
    const tan = new THREE.Vector3(0, 1, 0).cross(grip).normalize();
    const bitan = grip.clone().cross(tan).normalize();
    for (let i = 0; i < 3; i++) {
      const a = (i * 2 * Math.PI) / 3;
      const dir = grip
        .clone()
        .addScaledVector(tan, Math.cos(a) * 0.2)
        .addScaledVector(bitan, Math.sin(a) * 0.2)
        .normalize();
      this.gripMats.push(placeMark(dir, 0.013, 0x0a0a0a).material as THREE.MeshStandardMaterial);
    }
    // 로고 점 (밝은색 — 어두운 공에서도 회전 추적용 기준점)
    placeMark(new THREE.Vector3(-0.5, -0.1, -0.85).normalize(), 0.024, 0xeae0c8);

    // 무게 각인 — 실제 하우스볼처럼 손가락 구멍 옆에 파운드 수를 새긴다.
    // 구멍 무리는 grip에서 11°(+마크 반경 7°) 안쪽이라, 37° 떨어뜨려 안 겹치게 한다
    // (각인 반높이 14° → 가장 가까운 모서리가 23°, 구멍 바깥 18°와 5° 여유).
    // 크기 40°×28° ≈ 7.6×5.3cm — 실제 하우스볼처럼 공 면을 큼직하게 차지한다.
    // 방향은 grip에서 플레이어(−z) 쪽으로 기울여 조준 화면에서 보이는 면에 오도록.
    const towardPlayer = new THREE.Vector3(0, 0, -1).projectOnPlane(grip).normalize();
    const weightDir = grip.clone().addScaledVector(towardPlayer, 0.75).normalize();
    this.weightMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, // applyMaterial이 스킨 decorColor로 덮어쓴다
      transparent: true,
      roughness: 0.6,
      metalness: 0,
      depthWrite: false,
    });
    const weightMesh = new THREE.Mesh(
      makeSpherePatch(
        BALL_RADIUS + 0.0006,
        weightDir,
        new THREE.Vector3(0, 1, 0), // 정지 상태에서 숫자가 똑바로 서 보이게
        THREE.MathUtils.degToRad(20),
        THREE.MathUtils.degToRad(14),
      ),
      this.weightMat,
    );
    weightMesh.castShadow = false; // 표면에 붙은 각인이라 그림자는 공 본체가 낸다
    this.mesh.add(weightMesh);
    this.applyWeightLabel();
    this.applyMaterial(); // 각인 색은 공 색에 종속 — 생성 시점에 한 번 맞춘다

    this.body = engine.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, BALL_RADIUS, BALL_START_Z)
        .setCcdEnabled(true)
        .setLinearDamping(0.05)
        .setAngularDamping(0.1),
    );
    this.collider = engine.world.createCollider(
      RAPIER.ColliderDesc.ball(BALL_RADIUS)
        .setMass(spec.massKg)
        .setRestitution(0.1)
        .setFriction(BALL_FRICTION)
        .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2),
      this.body,
    );

    engine.add({ mesh: this.mesh, body: this.body });
  }

  /** 조준선 예측 시뮬레이션용 (Controls) */
  get massKg() {
    return this.spec.massKg;
  }
  get speedScale() {
    return this.spec.maxSpeedScale;
  }

  /** 볼 무게/색 교체 (메뉴 무게 슬라이더, AIMING 중에만 권장). 도안 §4.5 */
  setSpec(spec: BallSpec) {
    this.spec = spec;
    this.collider.setMass(spec.massKg);
    this.applyWeightLabel();
    this.applyMaterial();
  }

  /** 표면 각인 텍스처를 현재 무게로 다시 굽는다 (무게가 바뀔 때만). */
  private applyWeightLabel() {
    const prev = this.weightMat.map;
    this.weightMat.map = makeWeightTexture(this.spec.pounds);
    this.weightMat.needsUpdate = true;
    prev?.dispose(); // 무게 슬라이더를 돌리면 매번 새로 굽는다 — 이전 것 즉시 반납
  }

  /** 코스메틱 스킨 적용 — 외형만(물리/AI 사다리 무영향, docs/legacy/REWARDS.md §3). */
  setSkin(skin: BallSkin) {
    this.skin = skin;
    this.applyMaterial();
  }

  /** spec(무게색) + skin(외형)을 합쳐 머티리얼에 반영. */
  private applyMaterial() {
    const mat = this.mesh.material as THREE.MeshStandardMaterial;
    const s = this.skin;
    mat.color.setHex(s.useWeightColor ? this.spec.color : s.color ?? this.spec.color);
    mat.roughness = s.roughness ?? 0.25;
    mat.metalness = s.metalness ?? 0.3;
    mat.envMapIntensity = s.envMapIntensity ?? 1;
    mat.emissive.setHex(s.emissive ?? 0x000000);
    mat.emissiveIntensity = s.emissiveIntensity ?? 1;
    mat.needsUpdate = true;
    const decor = s.decorColor ?? 0x0a0a0a; // 어두운 스킨엔 밝은 그립(알려진 이슈 해결)
    for (const g of this.gripMats) g.color.setHex(decor);
    // 각인은 그립(구멍)과 규칙이 다르다 — 구멍은 '뚫린 곳'이라 늘 어둡지만, 각인은 파인 홈이
    // 빛을 받아 대체로 **밝게** 읽힌다(실제 하우스볼 사진). 공 밝기로 뒤집어 대비를 보장한다.
    this.weightMat.color.setHex(luminance(mat.color) < 0.55 ? 0xf2f4f8 : 0x15171c);
  }

  /** aim ∈ [-1,1] 횡방향, power ∈ [0,1], spin ∈ [-1,1] 좌/우 훅. 도안 §8 발사 변환. */
  launch(aim: number, power: number, spin = 0) {
    const speed = (MIN_SPEED + power * (MAX_SPEED - MIN_SPEED)) * this.spec.maxSpeedScale;
    const len = Math.hypot(aim, 1);
    const vx = (aim / len) * speed;
    const vz = (1 / len) * speed;
    this.body.setLinvel({ x: vx, y: 0, z: vz }, true);
    // 굴림축을 진행 방향에 정렬(ω = n̂×v/R · ROLL_RATIO) — 대각 투구의 가짜 슬립 제거.
    // 거기에 스핀(ωz)을 더해 의도된 측면 슬립만 훅으로 작용.
    this.body.setAngvel(
      {
        x: (vz / BALL_RADIUS) * ROLL_RATIO,
        y: 0,
        z: -(vx / BALL_RADIUS) * ROLL_RATIO + effectiveSpin(spin) * SPIN_RATE,
      },
      true,
    );
  }

  /**
   * 스핀(훅) 측면력: 슬립 기반 (도안 §4.1). ROLLING 중 매 물리 스텝 호출.
   * 접촉점 수평 슬립 = (vx + ωz·R, vz − ωx·R). 슬립 반대로 동마찰 임펄스.
   * REF_MASS 고정이라 가벼운 공일수록 가속도(F/m)가 커 더 휜다.
   * hookFactor(z) 게이트 — 오일 존에선 0(직진), 드라이 존에서 1(레이트 훅).
   */
  applySpinForce(dt: number) {
    const t = this.body.translation();
    const hook = hookFactor(t.z);
    if (hook <= 0) return;
    if (t.y > BALL_RADIUS + 0.005) return; // 접지 마찰 모델 — 공중(바운드 중)엔 주입 금지
    const v = this.body.linvel();
    const w = this.body.angvel();
    const slipX = v.x + w.z * BALL_RADIUS;
    const slipZ = v.z - w.x * BALL_RADIUS;
    const slipMag = Math.hypot(slipX, slipZ);
    if (slipMag <= SLIP_EPS) return;
    const fMag = FRICTION_K * REF_MASS * 9.81 * hook;
    this.body.applyImpulse(
      { x: -(slipX / slipMag) * fMag * dt, y: 0, z: -(slipZ / slipMag) * fMag * dt },
      true, // wakeUp (도안 §4.6)
    );
  }

  /**
   * 핀과의 충돌 on/off. 거터로 빠진 공을 잠그는 용도 — 규격 깊이(47.6mm) 거터는 얕아서
   * 공이 레인 모서리 위로 기대며 코너 핀(7·10)까지 11.6mm 파고든다(실측). 실제 채널은 곡면이라
   * 공이 가운데 앉아 안 닿지만 Rapier엔 오목 프리미티브가 없다. 형상 튜닝은 확률이고 이건 보장이다.
   * USBC도 "공이 레인을 벗어나면 그 투구의 핀폴은 인정하지 않는다"이므로 규칙과 일치한다.
   */
  setPinCollision(on: boolean) {
    this.collider.setCollisionGroups(on ? BALL_GROUPS_ALL : BALL_GROUPS_NO_PINS);
  }

  reset() {
    this.body.setTranslation({ x: 0, y: BALL_RADIUS, z: BALL_START_Z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.setPinCollision(true); // 다음 투구를 위해 잠금 해제
  }
}

/**
 * 무게 각인 텍스처 — **속 빈 외곽선** 숫자, 투명 배경. 색은 머티리얼이 입힌다(스킨 decorColor).
 *
 * 실제 하우스볼은 숫자를 파낸 것이라, 채워진 글자가 아니라 홈이 빛을 받는 **윤곽선**으로 보인다.
 * 단위 표기('LBS')도 없다 — 숫자만 크게 하나. 처음엔 채운 글자 + LBS로 만들었는데
 * 스티커처럼 보였다.
 */
function makeWeightTexture(pounds: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 224;
  const g = c.getContext('2d')!;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = 'bold 178px ui-sans-serif, system-ui, -apple-system, sans-serif';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 9;
  g.lineJoin = 'round';
  g.miterLimit = 2;
  g.strokeText(String(pounds), 160, 118);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8; // 비스듬히 볼 때 선이 끊기지 않게
  return t;
}

/**
 * 구면에 딱 붙는 사각 데칼 패치.
 *
 * 평면(CircleGeometry)으로는 안 된다 — 반경 0.03짜리 원판을 반경 0.109 구에 얹으면
 * 가장자리가 3.6mm 파묻혀 잘린다(기존 구멍 마크는 반경 0.013이라 0.8mm뿐이라 티가 안 났다).
 * 여기선 모든 정점을 구면 위에 올리고 UV만 평면으로 펴서 왜곡 없이 붙인다.
 * (구 전체 UV를 쓰는 방법도 있지만 equirect라 극 근처에서 글자가 가로로 눌린다 —
 *  각인 위치가 극에서 31°라 2배 눌렸을 것이다.)
 */
function makeSpherePatch(
  radius: number,
  dir: THREE.Vector3,
  upHint: THREE.Vector3,
  halfX: number,
  halfY: number,
  seg = 10,
): THREE.BufferGeometry {
  const n = dir.clone().normalize();
  const up = upHint.clone().projectOnPlane(n).normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= seg; j++) {
    const ty = (j / seg) * 2 - 1;
    for (let i = 0; i <= seg; i++) {
      const tx = (i / seg) * 2 - 1;
      // right축 회전은 −up 쪽으로 가므로 부호를 뒤집어 j 증가 = 위쪽으로 맞춘다
      p.copy(n).applyAxisAngle(right, -ty * halfY).applyAxisAngle(up, tx * halfX);
      nor.push(p.x, p.y, p.z);
      pos.push(p.x * radius, p.y * radius, p.z * radius);
      uv.push(i / seg, j / seg);
    }
  }
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i;
      const b = a + 1;
      const c2 = a + seg + 1;
      const d = c2 + 1;
      idx.push(a, b, c2, b, d, c2); // 법선이 바깥(+n)을 보는 감김
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

const _lumC = new THREE.Color();

/**
 * 지각 휘도 — **sRGB 값 기준**.
 *
 * ⚠️ `material.color`는 색관리 때문에 선형(linear-sRGB) 값을 들고 있다. 거기서 바로 재면
 * 중간톤이 실제보다 훨씬 어둡게 나온다 — 밝은 파랑(#4aa3ff)이 선형에선 0.35라
 * '어두운 공'으로 오판돼 흰 각인이 붙었다. sRGB로 되돌린 뒤 재야 눈으로 본 밝기와 맞는다.
 */
function luminance(c: THREE.Color): number {
  _lumC.copy(c).convertLinearToSRGB();
  return 0.2126 * _lumC.r + 0.7152 * _lumC.g + 0.0722 * _lumC.b;
}
