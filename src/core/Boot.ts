import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './Engine';
import { Loop } from './Loop';
import { Lane } from '../scene/Lane';
import { Environment } from '../scene/Environment';
import { Ball } from '../scene/Ball';
import { PinSet } from '../scene/PinSet';
import { GameState } from '../game/GameState';
import { Hud } from '../ui/Hud';
import { MenuUI } from '../ui/Menu';
import { Controls } from '../input/Controls';
import { CameraRig } from '../camera/CameraRig';
import { SoundManager } from '../audio/SoundManager';
import { makeBallSpec } from '../game/BallSpec';
import { PIN_CONTACT_Z } from '../game/constants';
import { ACHIEVEMENTS, evaluateAchievements, loadRewards, recordRewards, resetRewards, resolveSkin } from '../game/rewards';
import { loadSettings, saveSettings } from '../game/settings';
import { isCoarsePointer, STAGE_MAX_W } from './device';

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
  const { game, controls, cameraRig, environment, sound, exitBtn, island, refreshIsland } = buildScene(engine);
  let shadowMoving = true; // 그림자 정적화 상태 추적 (§6)
  const loop = new Loop(
    engine,
    (dt) => game.update(dt), // 물리 스텝마다 상태머신 (+레인 마찰 전환)
    (dt) => {
      controls.update(dt); // 렌더 프레임마다 UI(조준선·게이지) — dt 기반 파워 차징(프레임레이트 독립)
      cameraRig.update(dt); // 상태별 카메라 연출
      environment.update(dt); // 전광판 애니메이션
      // 그림자 정적화: 공·핀이 멈춘 상태(AIMING/MENU/GAME_OVER)엔 셰도우맵 재렌더 중단,
      // ROLLING/SETTLING에만 갱신 (시간 대부분이 조준이라 이득 큼).
      const moving = game.state === 'ROLLING' || game.state === 'SETTLING';
      if (moving !== shadowMoving) {
        shadowMoving = moving;
        engine.renderer.shadowMap.autoUpdate = moving;
        if (!moving) engine.renderer.shadowMap.needsUpdate = true; // 정지 직전 1회 갱신
      }
      // 인게임 '메뉴로' 버튼 + 상단 업적 아일랜드: 매치 중(MENU/GAME_OVER 외)에만 노출.
      const inMatch = game.state !== 'MENU' && game.state !== 'GAME_OVER';
      if (inMatch && exitBtn.style.display === 'none') refreshIsland(); // 매치 진입 시 진행도 1회 갱신
      exitBtn.style.display = inMatch ? 'block' : 'none';
      island.style.display = inMatch ? 'block' : 'none';
    },
  );
  game.setTimeScale = (s) => {
    loop.timeScale = s; // AI 턴 빨리감기 (P2 슬로모도 같은 인프라)
  };
  loop.start();

  // 비가시(탭 전환·잠금) 시 렌더·오디오 정지 → 배터리/발열 절감 (§6)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      loop.stop();
      sound.suspend();
    } else {
      sound.resume();
      loop.start();
    }
  });

  // 세로 화면이면 가로 권장 1회 안내 (비차단, §5)
  maybeShowOrientationHint();

  // 데스크탑 센터링: 세로 게임을 가운데 칼럼(STAGE_MAX_W)으로 모은다. transform이 걸린 부모는
  // position:fixed 자식의 컨테이닝 블록이 되므로(CSS), 기존 fixed UI(캔버스·HUD·도크)를 좌표 변경
  // 없이 스테이지 기준으로 재배치할 수 있다. body 자식을 일괄 이동(동적 append 없음). 폰은 100vw라 무변경.
  const stage = document.createElement('div');
  stage.id = 'stage';
  stage.style.cssText = [
    'position:fixed',
    'top:0',
    'left:50%',
    'transform:translateX(-50%)', // ← fixed 자식의 기준이 되는 핵심
    `width:min(100vw, ${STAGE_MAX_W}px)`,
    'height:100dvh',
    'overflow:hidden',
  ].join(';');
  document.body.style.background = '#000'; // 칼럼 양옆(데스크탑) 레터박스
  const bodyKids = Array.from(document.body.children);
  document.body.appendChild(stage);
  for (const k of bodyKids) stage.appendChild(k);

  document.getElementById('loading')?.remove();
}

/**
 * 세로(portrait) 터치 기기에서 "가로로 돌리면 더 잘 보여요" 1회 안내 (MOBILE_SUPPORT.md §5).
 * 비차단 오버레이 — 일정 시간 뒤 또는 가로 전환 시 사라진다. 강제 잠금은 하지 않음.
 */
function maybeShowOrientationHint() {
  if (!isCoarsePointer()) return;
  const portrait = matchMedia('(orientation: portrait)');
  if (!portrait.matches) return;

  const el = document.createElement('div');
  el.textContent = '↻ 가로로 돌리면 더 잘 보여요';
  el.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:calc(16px + env(safe-area-inset-bottom))',
    'transform:translateX(-50%)',
    'padding:8px 16px',
    'border-radius:999px',
    'background:rgba(14,17,27,0.92)',
    'border:1px solid rgba(34,211,238,0.4)',
    'color:#e8edf5',
    "font:600 12px/1.4 system-ui, sans-serif",
    'z-index:50',
    'pointer-events:none',
    'box-shadow:0 6px 26px rgba(0,0,0,0.5)',
  ].join(';');
  document.body.appendChild(el);

  const dismiss = () => el.remove();
  setTimeout(dismiss, 3500);
  portrait.addEventListener('change', (e) => {
    if (!e.matches) dismiss();
  });
}

/**
 * 씬 + 게임 + UI 조립 (M5).
 * 입력은 Controls(마우스 조준/파워 차징 + Q/E 스핀), 무게는 BallPicker 슬라이더.
 */
function buildScene(engine: Engine): {
  game: GameState;
  controls: Controls;
  cameraRig: CameraRig;
  environment: Environment;
  sound: SoundManager;
  exitBtn: HTMLButtonElement;
  island: HTMLButtonElement;
  refreshIsland: () => void;
} {
  const settings = loadSettings();
  engine.setQuality(settings.quality === 'high'); // 저장된 그래픽 품질 적용 (기본 high)

  const lane = new Lane(engine);
  const environment = new Environment(engine); // 볼링장 배경 (옆 레인·벽·천장·네온·전광판)
  const pins = new PinSet(engine);
  const ball = new Ball(engine, makeBallSpec(10));
  const hud = new Hud();
  const game = new GameState(ball, pins, hud, lane);
  const controls = new Controls(engine, game, ball);
  const cameraRig = new CameraRig(engine, game, ball);

  // 메뉴/결과 화면 (로드맵 P1) — 시작 시 메뉴부터
  const menu = new MenuUI(
    (cfg) => game.startMatch(cfg),
    () => game.toMenu(),
    (lb) => game.setHumanBallSpec(makeBallSpec(lb)), // 볼 무게 (인게임 HUD 대신 메뉴에서 선택)
    (id) => game.setBallSkin(resolveSkin(id)), // 볼 스킨 (보상, 외형 전용)
  );
  game.setBallSkin(resolveSkin(loadRewards().selectedSkin)); // 저장된 장착 스킨 초기 적용
  menu.showMenu();

  // 게임 이벤트 → 연출. 모든 이벤트 텍스트는 전광판(diegetic)에만 표시 — HUD 중앙 배너 중복 제거.
  game.onEvent = (e) => {
    switch (e.type) {
      case 'strike': {
        const label =
          e.streak >= 4 ? `${e.streak} BAGGER!!` : e.streak === 3 ? 'TURKEY!!' : e.streak === 2 ? 'DOUBLE!' : 'STRIKE!';
        environment.announce(label, '#ff2d78');
        break;
      }
      case 'spare':
        environment.announce('SPARE!', '#22d3ee');
        break;
      case 'gutter':
        environment.announce('GUTTER', '#9aa6bd'); // 탈색조 — 아쉬운 투구
        break;
      case 'split':
        environment.announce(`${e.label} 스플릿!`, '#ef6a6a');
        break;
      case 'splitConverted':
        environment.announce(`${e.label} 변환!`, '#4ade80');
        break;
      case 'turn':
        if (e.ai) environment.announce(`${e.playerName} 차례`, '#aab3c2');
        break;
      case 'gameOver': {
        const sm = e.summary;
        const fresh = evaluateAchievements(
          {
            mode: sm.mode,
            humanScore: sm.players[0].score,
            winner: sm.winner,
            rivalKeys: sm.players.slice(1).map((p) => p.aiKey).filter((k): k is string => !!k),
            rolls: sm.players[0].rolls,
            frames: sm.frames,
          },
          loadRewards().earned,
        );
        if (fresh.length) {
          recordRewards(fresh);
          sound.playUnlock();
        }
        menu.showResult(sm, fresh);
        break;
      }
    }
  };

  // 충돌 신호 → 사운드 + 타격감 (P2). 공이 핀 구역(PIN_CONTACT_Z)에 들어선 접촉만
  // '임팩트'로 취급: 크래시 사운드 구분 + 카메라 셰이크 + 슬로모. 그 전 굴림 접촉은
  // 기존 playHit 그대로 (굴림 거동 불변).
  const sound = new SoundManager();
  sound.enabled = settings.sound; // 저장된 사운드 on/off 적용
  engine.onContact = (mag) => {
    if (ball.body.translation().z > PIN_CONTACT_Z) {
      // 핀 구역 개별 충돌은 무음 — 임팩트 사운드는 notifyImpact가 투구당 1회 명령(game.onPinImpact)
      cameraRig.addShake(mag); // 셰이크 토글 OFF(SHAKE_ENABLED) — 현재 no-op
      cameraRig.pushIn(); // 임팩트 push-in (PUSHIN_ENABLED, DIST 0.6 — ac0ef80 재활성)
      game.notifyImpact();
    } else if (game.state === 'ROLLING') {
      sound.playHit(mag); // 굴림음 — ROLLING 중에만 (정지/조준 중 접촉력 이벤트 잡음 방지)
    }
  };
  // 투구당 1회 핀 크래시 — 던질 때 서 있던 핀 수로 세기 (개별 contact 폭주 → '여러 번' 해결)
  game.onPinImpact = (standing) => {
    sound.playRackCrash(standing);
    // 임팩트 햅틱 — Android Chrome만 지원(iOS Safari 미지원), feature-detect 후 호출 (§6)
    if (settings.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(standing > 2 ? 30 : 12);
  };

  // 인게임 '메뉴로' 버튼 — 게임 중 포기하고 메뉴 복귀 (가시성은 Loop onFrame에서 상태별 토글).
  // 좌상단 safe-area, 점수판(상단)과 안 겹치게 작게. Esc(데스크톱)도 동일 동작.
  const exitBtn = document.createElement('button');
  exitBtn.textContent = '☰ 메뉴';
  exitBtn.style.cssText = [
    'position:fixed',
    'top:calc(8px + env(safe-area-inset-top))',
    'left:calc(8px + env(safe-area-inset-left))',
    'z-index:30',
    'display:none',
    'padding:8px 12px',
    'min-height:40px',
    'border-radius:10px',
    'border:1px solid rgba(255,255,255,0.2)',
    'background:rgba(14,17,27,0.82)',
    'color:#e8edf5',
    'font:700 13px/1 system-ui, sans-serif',
    'cursor:pointer',
    'backdrop-filter:blur(4px)',
  ].join(';');
  const forfeit = () => {
    if (game.state === 'MENU' || game.state === 'GAME_OVER') return;
    // 인게임 일시정지 모달: 계속하기 + 안전 설정(사운드·햅틱·그래픽) + 포기. 토글은 즉시 적용 후 저장.
    // (네이티브 confirm()은 iOS 웹뷰/시뮬레이터에서 안 떠 못 씀 — 앱 내부 오버레이로 처리.)
    menu.showPause({
      settings,
      onSound: (v) => {
        settings.sound = v;
        sound.enabled = v;
        saveSettings(settings);
      },
      onHaptics: (v) => {
        settings.haptics = v;
        saveSettings(settings);
      },
      onQuality: (q) => {
        settings.quality = q;
        engine.setQuality(q === 'high');
        saveSettings(settings);
      },
      onResume: () => menu.hide(),
      onForfeit: () => {
        game.toMenu();
        menu.showMenu();
      },
    });
  };
  exitBtn.onclick = forfeit;
  document.body.appendChild(exitBtn);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') forfeit();
  });

  // 인게임 상단 중앙 '업적 아일랜드' (Dynamic Island 느낌의 알약 pill) — 탭하면 컬렉션(업적+스킨) 모달.
  // 좌(☰ 메뉴)·우(상태바) 사이 중앙. 진행도 🏆 N/총 표시, 매치 진입 시 onFrame에서 refreshIsland로 갱신.
  const island = document.createElement('button');
  const refreshIsland = () => {
    const earned = loadRewards().earned;
    const n = ACHIEVEMENTS.filter((a) => earned.includes(a.id)).length;
    island.textContent = `🏆 ${n}/${ACHIEVEMENTS.length}`;
  };
  refreshIsland();
  island.style.cssText = [
    'position:fixed',
    'top:calc(8px + env(safe-area-inset-top))',
    'left:50%',
    'transform:translateX(-50%)',
    'z-index:30',
    'display:none',
    'padding:8px 14px',
    'min-height:40px',
    'border-radius:999px', // 알약형 = Dynamic Island
    'border:1px solid rgba(255,213,74,0.4)',
    'background:rgba(14,17,27,0.82)',
    'color:#ffd54a',
    'font:800 13px/1 system-ui, sans-serif',
    'letter-spacing:0.02em',
    'cursor:pointer',
    'backdrop-filter:blur(4px)',
    'box-shadow:0 0 16px rgba(255,213,74,0.18)',
  ].join(';');
  island.onclick = () => {
    if (game.state === 'MENU' || game.state === 'GAME_OVER') return;
    menu.showCollection(() => menu.hide()); // 닫으면 게임으로 복귀(메뉴 X)
  };
  document.body.appendChild(island);

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
    __unlockAllRewards?: () => void;
    __resetRewards?: () => void;
  };
  w.__ball = ball;
  w.__pins = pins;
  w.__engine = engine;
  w.__game = game;
  w.__cameraRig = cameraRig;
  // [DEV] 보상 디버그 — 콘솔에서 호출 후 새로고침
  w.__unlockAllRewards = () => {
    recordRewards(ACHIEVEMENTS.map((a) => a.id));
    console.log('[rewards] 전체 해금 완료 — 새로고침하세요');
  };
  w.__resetRewards = () => {
    resetRewards();
    console.log('[rewards] 초기화 완료 — 새로고침하세요');
  };

  return { game, controls, cameraRig, environment, sound, exitBtn, island, refreshIsland };
}
