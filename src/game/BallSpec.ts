/**
 * 볼 무게 시스템 (도안 §4.5). 지름은 고정, 무게만 6~16 lb.
 * 무게가 질량(파괴력)·색·속도(컨트롤)를 연속으로 바꾼다.
 * 훅(휨)은 §4.1 측면력이 고정 REF_MASS 기준이라 가벼울수록 자동으로 더 휨.
 */
export interface BallSpec {
  label: string;
  /** 파운드 정수값 — 공 표면 각인에 쓴다(massKg 역산은 반올림 오차로 라벨과 어긋날 수 있다). */
  pounds: number;
  massKg: number;
  color: number;
  maxSpeedScale: number;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * 무게별 **하우스 볼 색** (2026-09-02). 실제 볼링장 공용 공은 무게마다 색이 정해져 있어 선반이 무지개가 된다 —
 * 사람들은 무게를 숫자가 아니라 색으로 찾는다. 카탈로그(Brunswick·Ebonite 등)마다 배색은 다르지만
 * "무게 = 색" 규칙은 공통이라, 우리 것도 6→16으로 난색→한색→무채색 순의 무지개로 짰다.
 * 예전엔 밝은 파랑→어두운 자주 2점 lerp였는데 인접 무게가 구분되지 않았고 팔레트와도 무관했다.
 * 기본 무게 10lb = 하우스 터쿼이즈, 14lb = 브릭 — 팔레트 색이 실제 무게 자리에 앉게 맞췄다.
 * 마감은 하나(광택 폴리에스터, rewards.ts CLASSIC_SKIN) — 색만 바뀌는 게 실물이다.
 */
const HOUSE_BALL_COLORS: readonly number[] = [
  0xe7649b, // 6  핑크
  0xf08a3c, // 7  오렌지
  0xe8c33a, // 8  옐로
  0x8cbf4a, // 9  라임
  0x3aa8a0, // 10 터쿼이즈 (하우스 팔레트 · 기본 무게)
  0x3b7fd6, // 11 블루
  0x5b4bc4, // 12 바이올렛
  0x9a3fa8, // 13 퍼플
  0xc8102e, // 14 브릭 (하우스 팔레트)
  0x7a3a26, // 15 마룬
  0x1f232b, // 16 블랙
];

/** 무게 → 하우스 볼 색. 메뉴 스와치도 이걸 써서 3D 공과 같은 색을 낸다. */
export function houseBallColor(pounds: number): number {
  const lb = Math.round(Math.min(16, Math.max(6, pounds)));
  return HOUSE_BALL_COLORS[lb - 6];
}

/** pounds ∈ [6, 16] */
export function makeBallSpec(pounds: number): BallSpec {
  const lb = Math.min(16, Math.max(6, pounds));
  const t = (lb - 6) / 10;
  return {
    label: `${lb} lb`,
    pounds: lb,
    massKg: lb * 0.45359,
    maxSpeedScale: lerp(1.0, 0.82, t),
    color: houseBallColor(lb),
  };
}
