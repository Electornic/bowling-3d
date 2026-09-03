/**
 * 핀세터 기계 사운드 큐 — PinSet(플레이 레인)과 Environment(옆 레인 앰비언트)가 **같은 어휘**로 SoundManager에
 * 단계 전환을 알린다. 타입만 있는 파일이라 런타임 비용은 0이다(둘 다 `import type`).
 *
 * 단계는 프리폴 핀세터 공통 순서다 — AMF 82-70 계열도 Brunswick GS-X도 같다(PinSet.ts 상단 타임라인). 소리의 기준 기계는
 * GS-X(machineSynth.ts). 큐는 **그 단계가 시작되는 순간** 한 번 오고, `dur`가 그 단계의 길이다 — 사운드는 단계 동안 울릴
 * 지속음(벨트 구동 모터)을 그 길이로 예약하고, 직전 단계가 끝나며 나는 타격음(스윕 보드가 가드에 닿는 클랙, 브레이크 스톱,
 * 핀이 놓이는 탁)을 시작 시각에 얹는다.
 *
 *   guard  ① 스윕 보드가 가드 위치로 하강           grip   ② 테이블 하강, 선 핀을 집는다(리스팟만)
 *   lift   ③ 테이블이 핀을 들고 상승(리스팟만)      sweep  ④ 스윕 전진 — 데드우드를 피트로 (pins = 쓸려 나가는 핀 수)
 *   return ⑤ 스윕 가드 복귀                         set    ⑥ 테이블 하강 — 핀을 스폿에 놓음 (pins = 놓는 핀 수)
 *   raise  ⑦ 테이블·스윕 상승 (pins = 놓은 핀 수)   done   사이클 종료. cut=true면 연출이 잘린 것(투구가 먼저 시작) —
 *                                                          예약된 소리를 전부 즉시 끊고 '기계 귀환' 클랙은 내지 않는다
 */
export type MachinePhase = 'guard' | 'grip' | 'lift' | 'sweep' | 'return' | 'set' | 'raise' | 'done';

export interface MachineCue {
  phase: MachinePhase;
  /** 이 단계의 길이(초). done은 0. */
  dur: number;
  /**
   * 핀 수 — sweep: 피트로 쓸려 나가는 데드우드 수(클래터 밀도) · set·raise: 놓이는 핀 수(리스팟은 들고 있던 수, 새 랙은 10) ·
   * 그 외 0.
   */
  pins: number;
  /** done 전용 — true면 중간에 잘린 종료 */
  cut?: boolean;
}

/** 어느 레인의 기계인가. cx = 레인 중심 x(m). 플레이 레인은 0, 옆 레인은 Environment가 자기 오프셋을 넘긴다. */
export interface MachineLane {
  key: string;
  cx: number;
}

/**
 * 옆 레인의 공 큐 — 기계 큐와 별개로 Environment가 보낸다.
 *  roll  : 공이 출발했다. speed = 캔드 경로의 평균 속도(m/s) — 굴림 럼블의 게인·피치 기준
 *  crash : 핀이 처음 움직인 스텝(GameState.notifyImpact와 같은 기준). pins = 그 순간 서 있던 핀 수(크래시 세기)
 *  stop  : 굴림을 끊는다(crash를 못 잡고 settle로 넘어간 경우의 안전망)
 */
export type AmbBallCue = { kind: 'roll'; speed: number } | { kind: 'crash'; pins: number } | { kind: 'stop' };
