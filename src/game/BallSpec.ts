import * as THREE from 'three';

/**
 * 볼 무게 시스템 (도안 §4.5). 지름은 고정, 무게만 6~16 lb.
 * 무게가 질량(파괴력)·색·속도(컨트롤)를 연속으로 바꾼다.
 * 훅(휨)은 §4.1 측면력이 고정 REF_MASS 기준이라 가벼울수록 자동으로 더 휨.
 */
export interface BallSpec {
  label: string;
  massKg: number;
  color: number;
  maxSpeedScale: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const COLOR_LIGHT = new THREE.Color(0x4aa3ff); // 가벼움 = 밝은 파랑
const COLOR_DARK = new THREE.Color(0x5a1030); // 무거움 = 어두운 자주

/** pounds ∈ [6, 16] */
export function makeBallSpec(pounds: number): BallSpec {
  const lb = Math.min(16, Math.max(6, pounds));
  const t = (lb - 6) / 10;
  return {
    label: `${lb} lb`,
    massKg: lb * 0.45359,
    maxSpeedScale: lerp(1.0, 0.82, t),
    color: COLOR_LIGHT.clone().lerp(COLOR_DARK, t).getHex(),
  };
}
