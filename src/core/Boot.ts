import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './Engine';
import { Loop } from './Loop';
import { Lane } from '../scene/Lane';
import { Environment } from '../scene/Environment';
import { Ball } from '../scene/Ball';
import { PinSet } from '../scene/PinSet';
import { GameState } from '../game/GameState';
import { Hud } from '../ui/Hud';
import { BallPicker } from '../ui/BallPicker';
import { MenuUI } from '../ui/Menu';
import { Controls } from '../input/Controls';
import { CameraRig } from '../camera/CameraRig';
import { SoundManager } from '../audio/SoundManager';
import { makeBallSpec } from '../game/BallSpec';

let _rapier: typeof RAPIER | null = null;

/** RAPIER 네임스페이스 접근자 (init 이후에만 유효) */
export function getRapier(): typeof RAPIER {
  if (!_rapier) throw new Error('RAPIER not initialized — call boot() first');
  return _rapier;
}

/**
 * 부팅 시퀀스 (도안 §5.1):
 * RAPIER WASM init → Engine 생성 → 씬·게임·UI 구성 → 루프 시작 → 로딩 제거
 */
export async function boot() {
  await RAPIER.init();
  _rapier = RAPIER;

  const engine = new Engine();
  const { game, controls, cameraRig } = buildScene(engine);
  const loop = new Loop(
    engine,
    (dt) => game.update(dt), // 물리 스텝마다 상태머신 (+레인 마찰 전환)
    (dt) => {
      controls.update(); // 렌더 프레임마다 UI(조준선·게이지)
      cameraRig.update(dt); // 상태별 카메라 연출
    },
  );
  game.setTimeScale = (s) => {
    loop.timeScale = s; // AI 턴 빨리감기 (P2 슬로모도 같은 인프라)
  };
  loop.start();

  document.getElementById('loading')?.remove();
}

/**
 * 씬 + 게임 + UI 조립 (M5).
 * 입력은 Controls(마우스 조준/파워 차징 + Q/E 스핀), 무게는 BallPicker 슬라이더.
 */
function buildScene(engine: Engine): {
  game: GameState;
  controls: Controls;
  cameraRig: CameraRig;
} {
  const lane = new Lane(engine);
  new Environment(engine); // 볼링장 배경 (옆 레인·벽·천장·네온, 시각 전용)
  const pins = new PinSet(engine);
  const ball = new Ball(engine, makeBallSpec(10));
  const hud = new Hud();
  const game = new GameState(ball, pins, hud, lane);
  const controls = new Controls(engine, game, ball);
  new BallPicker(game);
  const cameraRig = new CameraRig(engine, game, ball);

  // 메뉴/결과 화면 (로드맵 P1) — 시작 시 메뉴부터
  const menu = new MenuUI(
    (cfg) => game.startMatch(cfg),
    () => game.toMenu(),
  );
  menu.showMenu();

  // 게임 이벤트 → 연출 (P2 연속 스트라이크/스플릿 피드백 선반영)
  game.onEvent = (e) => {
    switch (e.type) {
      case 'strike': {
        const label =
          e.streak >= 4 ? `${e.streak} BAGGER!!` : e.streak === 3 ? 'TURKEY!!' : e.streak === 2 ? 'DOUBLE!' : 'STRIKE!';
        hud.banner(label);
        break;
      }
      case 'spare':
        hud.banner('SPARE!', '#7dd3fc');
        break;
      case 'split':
        hud.banner(`${e.label} 스플릿!`, '#ef6a6a');
        break;
      case 'splitConverted':
        hud.banner(`${e.label} 스플릿 변환! 🔥`, '#4ade80', 2000);
        break;
      case 'turn':
        if (e.ai) hud.banner(`${e.playerName}의 차례`, '#aab3c2', 1000);
        break;
      case 'gameOver':
        menu.showResult(e.summary);
        break;
    }
  };

  // 충돌음: contact force 크기 → 합성음 (도안 §10)
  const sound = new SoundManager();
  engine.onContact = (mag) => sound.playHit(mag);

  // 초기 카메라 (이후 CameraRig가 상태별로 보간) — AIMING 뷰와 동일
  engine.camera.position.set(0, 1.12, -2.7);
  engine.camera.lookAt(0, -0.05, 7.5);

  // 검증/디버그용 전역 노출
  const w = window as Window & {
    __ball?: Ball;
    __pins?: PinSet;
    __engine?: Engine;
    __game?: GameState;
    __cameraRig?: CameraRig;
  };
  w.__ball = ball;
  w.__pins = pins;
  w.__engine = engine;
  w.__game = game;
  w.__cameraRig = cameraRig;

  return { game, controls, cameraRig };
}
