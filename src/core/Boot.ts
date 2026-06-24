import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './Engine';
import { Loop } from './Loop';
import { Lane } from '../scene/Lane';
import { Environment } from '../scene/Environment';
import { Lobby } from '../scene/Lobby';
import { Transition, type LogSeg } from '../ui/Transition';
import { Ball } from '../scene/Ball';
import { PinSet } from '../scene/PinSet';
import { Replay } from '../scene/Replay';
import { GameState, type MatchConfig } from '../game/GameState';
import { Hud } from '../ui/Hud';
import { MenuUI } from '../ui/Menu';
import { Controls } from '../input/Controls';
import { CameraRig } from '../camera/CameraRig';
import { SoundManager } from '../audio/SoundManager';
import { makeBallSpec } from '../game/BallSpec';
import { PIN_CONTACT_Z } from '../game/constants';
import { ACHIEVEMENTS, evaluateAchievements, loadRewards, recordRewards, resetRewards, resolveSkin } from '../game/rewards';
import { loadSettings, saveSettings } from '../game/settings';
import { isCoarsePointer } from './device';

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

  // UI 전용 센터링: 데스크탑 와이드 화면에서 HUD·하단 도크가 좌우로 퍼지지 않게 가운데 칼럼(1440px)
  // 가장자리로 모은다. 3D 캔버스는 풀화면 그대로(레인 원근 유지). 가장자리에 붙는 UI(메뉴·상태·스핀·
  // 파워)의 left/right에 var(--col-edge)를 더하면 칼럼 안으로 당겨진다. 폰은 0이라 무영향(중앙 요소는 무변경).
  document.documentElement.style.setProperty('--col-edge', 'max(0px, calc((100vw - 1440px) / 2))');

  const engine = new Engine();
  const { game, controls, cameraRig, environment, sound, exitBtn, island, gearBtn, refreshIsland, lobby, replay } = buildScene(engine);
  let shadowMoving = true; // 그림자 정적화 상태 추적 (§6)
  const loop = new Loop(
    engine,
    (dt) => {
      replay.record(game.state); // update 전 캡처 — SETTLING 종료 프레임까지 녹화 (§12.2)
      game.update(dt); // 물리 스텝마다 상태머신 (+레인 마찰 전환)
    },
    (dt) => {
      // 리플레이 재생 중: 메시·카메라를 리플레이가 소유 → 컨트롤/카메라릭 스킵, 전광판만 유지.
      // (물리·sync는 loop.paused로 정지. 종료 시 Engine.snapToBodies + cameraRig.resync로 라이브 인계.)
      if (replay.active) {
        replay.update(dt);
        environment.update(dt);
        return;
      }
      controls.update(dt); // 렌더 프레임마다 UI(조준선·게이지) — dt 기반 파워 차징(프레임레이트 독립)
      if (game.state === 'LOBBY') lobby.update(dt); // 로비 아바타 이동(비물리) — 카메라가 따라붙기 전에
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
      // 로비는 매치가 아니다 — 메뉴/아일랜드 숨김 + 메뉴 BGM 유지. 로비 전용 버튼은 상태로 토글.
      const inMatch = game.state !== 'MENU' && game.state !== 'GAME_OVER' && game.state !== 'LOBBY';
      if (inMatch && exitBtn.style.display === 'none') refreshIsland(); // 매치 진입 시 진행도 1회 갱신
      exitBtn.style.display = inMatch ? 'block' : 'none';
      island.style.display = inMatch ? 'block' : 'none';
      gearBtn.style.display = game.state === 'LOBBY' && !lobby.consoleActive ? 'block' : 'none'; // 로비에서만, 콘솔 도킹 중엔 숨김 (§13 스텝5·A2.2)
      sound.setMenuMusic(!inMatch); // 메뉴·로비·결과 화면에서 배경음악 (매치 시작하면 페이드아웃). 멱등.
    },
  );
  game.setTimeScale = (s) => {
    loop.timeScale = s; // AI 턴 빨리감기 (P2 슬로모도 같은 인프라)
  };
  replay.setPaused = (p) => {
    loop.paused = p; // 리플레이 재생 중 라이브 물리·sync 정지 (§12.2)
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

  // 부팅 완료 → 터미널 로더에 신호. 타이핑이 끝나면 'TAP TO START'가 뜨고, 탭하면 로더가
  // 페이드아웃되며 그 시점에 가로 권장 안내를 띄운다. 연출은 index.html의 인라인 스크립트가 담당.
  const w2 = window as Window & { __loaderReady?: (onDismiss: () => void) => void };
  if (w2.__loaderReady) {
    w2.__loaderReady(() => maybeShowOrientationHint());
  } else {
    // 로더 스크립트 부재 등 예외 — 폴백: 즉시 제거 + 안내
    document.getElementById('loading')?.remove();
    maybeShowOrientationHint();
  }
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
  gearBtn: HTMLButtonElement;
  refreshIsland: () => void;
  lobby: Lobby;
  replay: Replay;
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
  const lobby = new Lobby(engine);
  cameraRig.setLobbyAvatar(lobby.avatar); // §11 M4 — LOBBY 팔로우 대상 주입
  const transition = new Transition(); // 로비↔레인 로딩 전환 (터미널 로더 톤)
  // 특별샷 리플레이 (§12.2) — onStep에서 녹화, onEvent(strike/spare/splitConverted)에서 재생.
  // 종료 후 cameraRig.resync로 라이브 카메라가 현재 위치부터 부드럽게 인계받는다.
  const replay = new Replay(engine, ball, pins, () => cameraRig.resync());

  // 결과/시작 콘솔 (로드맵 P1). 다이제틱 메뉴 A1(§13): 메뉴는 이제 로비 시작 콘솔로만 열린다 —
  // 부팅은 로비 직행, 모든 매치는 로비(콘솔/NPC)에서 출발하므로 결과 복귀는 항상 로비.
  const menu = new MenuUI(
    (cfg) => startLaneMatch(cfg), // 콘솔 '게임 시작' → 레인 전환 + startMatch (config-bypass 해소)
    () => returnFromMatch(), // 결과 '🚶 로비로' (아래 정의)
    (lb) => game.setHumanBallSpec(makeBallSpec(lb)), // 볼 무게 (인게임 HUD 대신 메뉴에서 선택)
    (id) => game.setBallSkin(resolveSkin(id)), // 볼 스킨 (보상, 외형 전용)
    settings, // 시작 메뉴 사운드 토글이 읽는 현재 설정 (pause 모달과 동일 객체)
    (v) => {
      settings.sound = v;
      sound.enabled = v; // setter가 끄면 BGM·럼블 즉시 정지, 켜면 다음 프레임에 BGM 재개
      saveSettings(settings);
    },
    () => closeLobbyPanel(), // '← 로비' 백버튼 → 로비 패널 닫고 로비로 (아래 정의)
  );
  game.setBallSkin(resolveSkin(loadRewards().selectedSkin)); // 저장된 장착 스킨 초기 적용
  // 시작 콘솔 스크린 라이브 프리뷰 갱신 (§13 A2) — 로비 진입·패널 닫기 시 현재 레인 설정으로 다시 그린다.
  const refreshConsole = () => lobby.setConsoleSummary(menu.getConfigSummary());
  // 부팅 → 로비 직행 (§13 A1). 로더 불투명 구간에 로비 활성화 (DOM 메뉴 게이트 폐기).
  game.toLobby();
  engine.setScreen('lobby');
  lobby.setActive(true);
  refreshConsole();

  // --- 오픈월드 로비 (docs/OPEN_WORLD_LOBBY.md) — 다이제틱 메뉴 A1(§13): 로비가 홈, 콘솔/NPC가 진입점 ---
  // 전환 로딩 로그 (터미널 톤) — swap()이 불투명 구간에 실행돼 씬 교체를 가린다.
  const LANE_LINES: LogSeg[][] = [
    [['> ', 'dim'], ['entering lane... ', ''], ['OK', 'ok']],
    [['> ', 'dim'], ['racking pins ', ''], ['[||||||||||]', 'ac'], [' 10/10', '']],
  ];
  const LOBBY_LINES: LogSeg[][] = [
    [['> ', 'dim'], ['entering lobby... ', ''], ['OK', 'ok']],
    [['> ', 'dim'], ['NEON LANES', 'ac']],
  ];
  let lobbyPanelOpen = false; // 로비 패널(콘솔 showMenu / 락커 showSkinLocker) 열림 — Esc·중복 오픈 가드
  // 로비로 복귀 (전환 경유) — 결과/포기 후 + DEV 진입. 부팅 직행은 위에서 transition 없이 처리.
  const enterLobby = () => {
    transition.play(LOBBY_LINES, () => {
      menu.hide();
      lobbyPanelOpen = false;
      game.toLobby();
      engine.setScreen('lobby');
      lobby.setActive(true);
      refreshConsole(); // 매치 결과/포기 후 복귀 — 콘솔 프리뷰를 현재 설정으로 (§13 A2)
    });
  };
  // 레인 매치 시작 (로비 콘솔 '게임 시작' + NPC 대결 공용) — 로비 출발이라 결과는 항상 로비 복귀.
  const startLaneMatch = (cfg: MatchConfig) => {
    lobbyPanelOpen = false;
    transition.play(LANE_LINES, () => {
      lobby.setActive(false);
      engine.setScreen('lane');
      game.startMatch(cfg);
    });
  };
  // 매치 종료/포기 후 복귀 — 항상 로비 (게이트 폐기로 솔로·vs AI·hotseat 단일화, §13.4).
  const returnFromMatch = () => enterLobby();
  // 로비 다이제틱 패널 (§13) — 락커·보드는 근접 E/탭 → DOM 패널(공용 lobbyPanelOpen 가드). 패널 동안 이동/프롬프트 정지.
  // ⚠️ 시작 콘솔은 A2.2부터 DOM이 아니라 in-world(레이캐스트·카메라 도킹) — lobby.enterConsole()이 직접 처리(아래 배선).
  const closeLobbyPanel = () => {
    lobbyPanelOpen = false;
    menu.hide();
    lobby.suspend(false);
    refreshConsole(); // 락커/보드에서 무게·스킨 등이 바뀌었을 수 있으니 콘솔 유휴 프리뷰 갱신 (§13 A2)
  };
  const openLocker = () => {
    if (lobbyPanelOpen) return;
    lobbyPanelOpen = true;
    lobby.suspend(true);
    menu.showSkinLocker(closeLobbyPanel); // '← 로비' 백버튼 = 패널 닫기
  };
  const openBoard = () => {
    if (lobbyPanelOpen) return;
    lobbyPanelOpen = true;
    lobby.suspend(true);
    menu.showStats(closeLobbyPanel); // 통계 보드 (§13 스텝4)
  };
  lobby.onOpenLocker = openLocker;
  lobby.onOpenBoard = openBoard;
  // 시작 콘솔 = in-world (§13 A2.2) — 근접 E/탭은 lobby.enterConsole()이 직접 호출. 여기선 컨트롤러·카메라 도킹만 배선.
  lobby.consoleCtrl = {
    cycle: (axis) => menu.cycleConsole(axis),
    weight: (d) => menu.adjustWeight(d),
    state: () => menu.getConsoleState(),
    start: () => startLaneMatch(menu.buildMatchConfig()), // in-world 선택으로 매치 시작 (config-bypass 해소 유지)
  };
  lobby.onDockConsole = (pos, target) => cameraRig.dockConsole(pos, target);
  lobby.onUndockConsole = () => cameraRig.undockConsole();
  lobby.onChallenge = (profile) => {
    // NPC 대결 = vs AI 풀게임 (§6 "NPC 선택 = 상대 선택"). 빠른 시작 — 판 세팅은 콘솔에서.
    startLaneMatch({ mode: 'full', players: [{ name: '나' }, { name: profile.name, ai: profile }] });
  };

  // 게임 이벤트 → 연출. 모든 이벤트 텍스트는 전광판(diegetic)에만 표시 — HUD 중앙 배너 중복 제거.
  game.onEvent = (e) => {
    switch (e.type) {
      case 'strike': {
        const label =
          e.streak >= 4 ? `${e.streak} BAGGER!!` : e.streak === 3 ? 'TURKEY!!' : e.streak === 2 ? 'DOUBLE!' : 'STRIKE!';
        // 전광판은 리플레이의 핀 임팩트 순간에 맞춰 띄운다(싱크, §12.2). 리플레이 미발동 시 즉시.
        const announce = () => environment.announce(label, '#ff2d78');
        if (!replay.start(label, announce)) announce();
        break;
      }
      case 'spare': {
        const announce = () => environment.announce('SPARE!', '#22d3ee');
        if (!replay.start('SPARE!', announce)) announce();
        break;
      }
      case 'gutter':
        environment.announce('GUTTER', '#9aa6bd'); // 탈색조 — 아쉬운 투구
        break;
      case 'split':
        environment.announce(`${e.label} 스플릿!`, '#ef6a6a');
        break;
      case 'splitConverted': {
        const announce = () => environment.announce(`${e.label} 변환!`, '#4ade80');
        if (!replay.start(`${e.label} 변환`, announce)) announce();
        break;
      }
      case 'turn':
        // AI 차례: 전광판 배너. 사람 차례 + 로컬 교대전(isHotseat): 기기 핸드오프 차단 오버레이 +
        // 입력 잠금. (vs AI에서 사람으로 돌아오는 건 같은 사람이라 핸드오프 불필요 → isHotseat 게이트.)
        if (e.ai) {
          environment.announce(`${e.playerName} 차례`, '#aab3c2');
        } else if (game.isHotseat) {
          game.inputLocked = true;
          menu.showHandoff(e.playerName, () => {
            game.inputLocked = false;
          });
        }
        break;
      case 'gameOver': {
        replay.cancel(); // 마지막 결정타(스트라이크/스페어) 리플레이가 결과화면과 겹치지 않게 즉시 접음
        const sm = e.summary;
        // 로컬 교대전(사람 2인)은 파티 모드 — 소유자 업적/하이스코어를 건드리지 않는다
        // (GameState.gameOver의 통계 생략과 동일 기준). 솔로·vs AI만 업적 평가.
        const hotseat = sm.players.filter((p) => !p.ai).length > 1;
        const fresh = hotseat
          ? []
          : evaluateAchievements(
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
        menu.showResult(sm, fresh, '🚶 로비로'); // 게이트 폐기 — 복귀는 항상 로비 (§13.4)
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
      // 핀 구역 접촉 = 카메라 연출만. 임팩트 사운드·슬로모는 GameState.notifyImpact가
      // 접촉 시간(ttc) 기반으로 매 스텝 구동(속도 무관 동기) — 여기서 호출하지 않는다.
      cameraRig.addShake(mag); // 셰이크 토글 OFF(SHAKE_ENABLED) — 현재 no-op
      cameraRig.pushIn(); // 임팩트 push-in (PUSHIN_ENABLED, DIST 0.6)
    }
    // (굴림 접촉음은 제거 — 실제 roll.wav 지속음이 굴림 사운드를 담당. 접촉마다 합성 '틱'을
    //  리버브 경유로 쏘던 게 roll 샘플과 중복·거슬림이었음.)
  };
  // 투구당 1회 핀 크래시 — 던질 때 서 있던 핀 수로 세기 (개별 contact 폭주 → '여러 번' 해결)
  game.onPinImpact = (standing) => {
    sound.playRackCrash(standing);
    // 임팩트 햅틱 — Android Chrome만 지원(iOS Safari 미지원), feature-detect 후 호출 (§6)
    if (settings.haptics && typeof navigator.vibrate === 'function') navigator.vibrate(standing > 2 ? 30 : 12);
  };
  // 공 굴림 럼블 — 매 스텝 공 속도로 지속 저역음 (임팩트 직전 긴장감)
  game.onRoll = (v, inGutter) => sound.setRoll(v, inGutter);

  // 인게임 '메뉴로' 버튼 — 게임 중 포기하고 메뉴 복귀 (가시성은 Loop onFrame에서 상태별 토글).
  // 좌상단 safe-area, 점수판(상단)과 안 겹치게 작게. Esc(데스크톱)도 동일 동작.
  const exitBtn = document.createElement('button');
  exitBtn.textContent = '☰ 메뉴';
  exitBtn.style.cssText = [
    'position:fixed',
    'top:calc(8px + env(safe-area-inset-top))',
    'left:calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-left))',
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
  // 설정 적용+저장 핸들러 (사운드·햅틱·그래픽) — 인게임 일시정지 모달과 로비 설정 기어(§13 스텝5)가 공유.
  // 토글은 즉시 적용 후 저장 (물리·점수·기록 무영향).
  const applySound = (v: boolean) => {
    settings.sound = v;
    sound.enabled = v; // setter가 끄면 BGM·럼블 즉시 정지, 켜면 다음 프레임 BGM 재개
    saveSettings(settings);
  };
  const applyHaptics = (v: boolean) => {
    settings.haptics = v;
    saveSettings(settings);
  };
  const applyQuality = (q: typeof settings.quality) => {
    settings.quality = q;
    engine.setQuality(q === 'high');
    saveSettings(settings);
  };
  const forfeit = () => {
    // 핸드오프 오버레이 중엔 일시정지 진입 금지 — pause가 핸드오프를 덮으면 inputLocked가 안 풀린 채
    // 게임으로 복귀하는 교착이 생긴다(핸드오프는 '내 차례 시작' 버튼으로만 닫힘).
    if (game.state === 'MENU' || game.state === 'LOBBY' || game.state === 'GAME_OVER' || game.inputLocked) return;
    // 인게임 일시정지 모달: 계속하기 + 안전 설정(사운드·햅틱·그래픽) + 포기.
    // (네이티브 confirm()은 iOS 웹뷰/시뮬레이터에서 안 떠 못 씀 — 앱 내부 오버레이로 처리.)
    menu.showPause({
      settings,
      onSound: applySound,
      onHaptics: applyHaptics,
      onQuality: applyQuality,
      onResume: () => menu.hide(),
      onForfeit: () => returnFromMatch(), // 포기 → 로비 복귀 (게이트 폐기, §13.4)
    });
  };
  exitBtn.onclick = forfeit;
  document.body.appendChild(exitBtn);
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (lobbyPanelOpen) closeLobbyPanel(); // 로비 패널 열림 → 닫고 로비로
    else if (game.state === 'LOBBY') return; // 로비가 홈 — Esc 무동작
    else forfeit();
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

  // 로비 설정 기어 (§13 스텝5) — 상주 우상단 버튼. 다이제틱 예외(월드 오브젝트 아님, §13.3).
  // 인게임 설정은 ☰→일시정지에 있으나 로비엔 일시정지가 없어 이 기어가 사운드/품질 접근로. 가시성은 onFrame에서 LOBBY일 때만.
  const gearBtn = document.createElement('button');
  gearBtn.textContent = '⚙️';
  gearBtn.setAttribute('aria-label', '설정');
  gearBtn.style.cssText = [
    'position:fixed',
    'top:calc(8px + env(safe-area-inset-top))',
    'right:calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-right))',
    'z-index:30',
    'display:none',
    'width:40px',
    'height:40px',
    'border-radius:10px',
    'border:1px solid rgba(255,255,255,0.2)',
    'background:rgba(14,17,27,0.82)',
    'color:#e8edf5',
    'font:700 18px/1 system-ui, sans-serif',
    'cursor:pointer',
    'backdrop-filter:blur(4px)',
  ].join(';');
  // 기어 → 로비 설정 패널 (다른 로비 패널과 같은 lobbyPanelOpen 가드·suspend 공유). 백버튼 = 닫기.
  gearBtn.onclick = () => {
    if (lobbyPanelOpen) return;
    lobbyPanelOpen = true;
    lobby.suspend(true);
    menu.showSettings({ settings, onSound: applySound, onHaptics: applyHaptics, onQuality: applyQuality, onBack: () => closeLobbyPanel() });
  };
  document.body.appendChild(gearBtn);

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
    __sound?: SoundManager;
    __enterLobby?: () => void;
    __lobby?: Lobby;
    __replay?: Replay;
    __unlockAllRewards?: () => void;
    __resetRewards?: () => void;
  };
  w.__ball = ball;
  w.__pins = pins;
  w.__engine = engine;
  w.__game = game;
  w.__cameraRig = cameraRig;
  w.__sound = sound;
  w.__enterLobby = enterLobby; // [DEV] 콘솔에서 로비 진입 (검증용)
  w.__lobby = lobby; // [DEV] 로비 인스턴스 (검증용)
  w.__replay = replay; // [DEV] 리플레이 인스턴스 (검증용)
  // [DEV] 보상 디버그 — 콘솔에서 호출 후 새로고침
  w.__unlockAllRewards = () => {
    recordRewards(ACHIEVEMENTS.map((a) => a.id));
    console.log('[rewards] 전체 해금 완료 — 새로고침하세요');
  };
  w.__resetRewards = () => {
    resetRewards();
    console.log('[rewards] 초기화 완료 — 새로고침하세요');
  };

  return { game, controls, cameraRig, environment, sound, exitBtn, island, gearBtn, refreshIsland, lobby, replay };
}
