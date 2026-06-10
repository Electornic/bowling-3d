import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import {
  LANE_WIDTH,
  GUTTER_WIDTH,
  PIN_DECK_END,
  HEADPIN_Z,
  PIN_SPACING,
  ROW_GAP,
} from '../game/constants';

const LANE_START_Z = -2; // Lane.ts와 동일
const LANE_END_Z = PIN_DECK_END + 1.5;
const LANE_UNIT = LANE_WIDTH + GUTTER_WIDTH * 2 + 0.1; // 레인 1칸 폭(거터+레일)
const HALL_HALF_W = LANE_UNIT * 2.5 + 0.4; // 좌우 각 2개 옆 레인 + 여유

/**
 * 절차적 나무 보드 텍스처 (에셋 0). 톤이 조금씩 다른 세로 판자 + 이음매 + 가로 결.
 * BoxGeometry 윗면 기준 u=가로(판자), v=길이 방향.
 */
export function makeWoodTexture(light = '#c89048', dark = '#96682c', boards = 9): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  const lo = new THREE.Color(dark);
  const hi = new THREE.Color(light);
  const bw = c.width / boards;
  for (let i = 0; i < boards; i++) {
    const h = Math.abs(Math.sin(i * 127.1 + 311.7)); // 결정적 의사난수 (판자 톤)
    g.fillStyle = `#${lo.clone().lerp(hi, 0.3 + 0.7 * h).getHexString()}`;
    g.fillRect(Math.floor(i * bw), 0, Math.ceil(bw) + 1, c.height);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(Math.floor(i * bw), 0, 1, c.height); // 이음매
  }
  g.fillStyle = 'rgba(0,0,0,0.05)'; // 가로 결
  for (let y = 0; y < c.height; y += 7) g.fillRect(0, y, c.width, 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * 볼링장 배경 (시각 전용, 충돌체 없음).
 * 옆 레인×4 + 어프로치 바닥 + 양쪽 벽 + 천장(조명 스트립) + 핀덱 마스킹·네온 + 레인 마커.
 * 목적: 화면을 채우는 실내감 + 원근감 단서(수렴선·반복 구조물).
 */
export class Environment {
  constructor(engine: Engine) {
    const len = LANE_END_Z - LANE_START_Z;
    const midZ = (LANE_START_Z + LANE_END_Z) / 2;
    const half = LANE_WIDTH / 2;

    const woodNeighbor = makeWoodTexture('#a8763a', '#7d5524');
    woodNeighbor.repeat.set(1, 7);
    const matLane = new THREE.MeshStandardMaterial({ map: woodNeighbor, roughness: 0.55 });
    const matGutter = new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.7 });
    const matRail = new THREE.MeshStandardMaterial({ color: 0x2a3140, roughness: 0.85 });
    const pinGeo = new THREE.CylinderGeometry(0.045, 0.06, 0.36, 10);
    const pinMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.5 });

    // --- 옆 레인 ×2 (양쪽, 장식용) ---
    for (const side of [-1, 1]) {
      for (let k = 1; k <= 2; k++) {
        const cx = side * k * LANE_UNIT;
        const floor = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH, 0.1, len), matLane);
        floor.position.set(cx, -0.06, midZ); // 플레이 레인보다 1cm 낮게 (구분감)
        floor.receiveShadow = true;
        engine.addVisual(floor);
        for (const s2 of [-1, 1]) {
          const gut = new THREE.Mesh(new THREE.BoxGeometry(GUTTER_WIDTH, 0.1, len), matGutter);
          gut.position.set(cx + s2 * (half + GUTTER_WIDTH / 2), -0.18, midZ);
          engine.addVisual(gut);
        }
        // 장식 핀 (정삼각형 10개)
        for (let r = 0; r < 4; r++) {
          for (let c2 = 0; c2 <= r; c2++) {
            const pin = new THREE.Mesh(pinGeo, pinMat);
            pin.position.set(cx + (c2 - r / 2) * PIN_SPACING, 0.18, HEADPIN_Z + r * ROW_GAP);
            engine.addVisual(pin);
          }
        }
      }
      // 레인 사이 레일(칸막이) — 반복 구조물 = 원근 단서
      for (let k = 0; k <= 2; k++) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, len), matRail);
        rail.position.set(side * (LANE_UNIT / 2 + k * LANE_UNIT), 0.1, midZ);
        engine.addVisual(rail);
      }
    }

    // --- 어프로치(투구 구역) 바닥 ---
    const woodApproach = makeWoodTexture('#8a6234', '#64461f', 12);
    woodApproach.repeat.set(8, 3);
    const approach = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.1, 7),
      new THREE.MeshStandardMaterial({ map: woodApproach, roughness: 0.6 }),
    );
    approach.position.set(0, -0.05, LANE_START_Z - 3.5);
    approach.receiveShadow = true;
    engine.addVisual(approach);

    // --- 핀덱 뒤 마스킹 월 + 네온 띠 ---
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 3.6, 0.25),
      new THREE.MeshStandardMaterial({ color: 0x0b0e14, roughness: 0.9 }),
    );
    wall.position.set(0, 1.8, LANE_END_Z + 0.45);
    engine.addVisual(wall);

    // 핀 위 캐노피(마스킹 유닛) + 전면 네온 2줄
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.5, 2.2),
      new THREE.MeshStandardMaterial({ color: 0x12161f, roughness: 0.85 }),
    );
    canopy.position.set(0, 1.55, HEADPIN_Z + 0.6);
    engine.addVisual(canopy);
    const neon = (color: number, y: number) => {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(HALL_HALF_W * 2, 0.07, 0.05),
        new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 2.4 }),
      );
      m.position.set(0, y, HEADPIN_Z - 0.52);
      engine.addVisual(m);
    };
    neon(0xff2d78, 1.36); // 핑크
    neon(0x22d3ee, 1.22); // 시안

    // --- 양쪽 벽 + 천장 + 조명 스트립 ---
    const matWall = new THREE.MeshStandardMaterial({ color: 0x161b26, roughness: 0.9 });
    for (const side of [-1, 1]) {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4.5, len + 9), matWall);
      sw.position.set(side * HALL_HALF_W, 2.0, midZ - 3);
      engine.addVisual(sw);
    }
    const ceiling = new THREE.Mesh(
      new THREE.BoxGeometry(HALL_HALF_W * 2, 0.2, len + 9),
      new THREE.MeshStandardMaterial({ color: 0x0e1118, roughness: 0.95 }),
    );
    ceiling.position.set(0, 4.1, midZ - 3);
    engine.addVisual(ceiling);
    const stripMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: 0xdfe8ff,
      emissiveIntensity: 1.6,
    });
    for (const x of [-2.4, 0, 2.4]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, len + 7), stripMat);
      strip.position.set(x, 3.96, midZ - 3); // 천장 수렴선 = 강한 원근 단서
      engine.addVisual(strip);
    }

    // --- 플레이 레인 마커 (파울라인·에임 화살표·스팟) — 거리·속도 지각 단서 ---
    const matMark = new THREE.MeshStandardMaterial({ color: 0x46280e, roughness: 0.6 });
    const foul = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x551515, roughness: 0.6 }));
    foul.rotation.x = -Math.PI / 2;
    foul.position.set(0, 0.004, 0);
    engine.addVisual(foul);

    const tri = new THREE.Shape();
    tri.moveTo(0, -0.1);
    tri.lineTo(-0.035, 0.05);
    tri.lineTo(0.035, 0.05);
    tri.closePath();
    const triGeo = new THREE.ShapeGeometry(tri); // rotX(-90°) 후 +z(다운레인) 방향
    for (let i = -3; i <= 3; i++) {
      const arrow = new THREE.Mesh(triGeo, matMark);
      arrow.rotation.x = -Math.PI / 2;
      arrow.position.set(i * 0.131, 0.004, 4.7 - Math.abs(i) * 0.28);
      engine.addVisual(arrow);
    }
    const dotGeo = new THREE.CircleGeometry(0.022, 12);
    for (let i = -2; i <= 2; i++) {
      const dot = new THREE.Mesh(dotGeo, matMark);
      dot.rotation.x = -Math.PI / 2;
      dot.position.set(i * 0.18, 0.004, 2.13);
      engine.addVisual(dot);
    }
  }
}
