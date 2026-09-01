import RAPIER from '@dimforge/rapier3d-compat';
import { Engine } from './Engine';
import { Loop } from './Loop';
import { Lane } from '../scene/Lane';
import { Environment } from '../scene/Environment';
import { Ball } from '../scene/Ball';
import { PinSet } from '../scene/PinSet';
import { Replay } from '../scene/Replay';
import { StillCut } from '../ui/StillCut';
import { GameState } from '../game/GameState';
import { Hud } from '../ui/Hud';
import { MenuUI } from '../ui/Menu';
import { Controls } from '../input/Controls';
import { CameraRig } from '../camera/CameraRig';
import { SoundManager } from '../audio/SoundManager';
import { makeBallSpec } from '../game/BallSpec';
import { PIN_CONTACT_Z } from '../game/constants';
import { ACHIEVEMENTS, evaluateAchievements, loadRewards, recordRewards, resetRewards, resolveSkin, VIDEO_MARKER } from '../game/rewards';
import { loadScreenVideo, clearScreenVideo } from '../game/screenStore';
import { loadSettings, saveSettings, type Settings } from '../game/settings';
import { css, NEON, PANEL_BG, rgba } from '../ui/theme';
import { setLocale, resolveLocale, t, onLocaleChange } from '../i18n';
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
  const { game, controls, cameraRig, environment, sound, exitBtn, pauseHook, replay } = buildScene(engine);
  let shadowMoving = true; // 그림자 정적화 상태 추적 (§6)
  let matchVisible: boolean | null = null; // 인게임 UI(exitBtn) 표시 상태 캐시(#12) — null=초기 1회 강제 쓰기
  const loop = new Loop(
    engine,
    (dt) => {
      replay.record(game.state); // update 전 캡처 — SETTLING 종료 프레임까지 녹화 (item 2)
      game.update(dt); // 물리 스텝마다 상태머신 (+레인 마찰 전환)
    },
    (dt) => {
      // 리플레이 재생 중: 메시·카메라를 리플레이가 소유 → 컨트롤/카메라릭 스킵. (물리·sync는 loop.paused로
      // 정지, 종료 시 Engine.snapToBodies + cameraRig.resync로 라이브 인계.)
      if (replay.active) {
        replay.update(dt);
        // 물리 시간 0 — loop.paused로 라이브 물리가 얼어 있으니 옆 레인 사이클도 같이 멈춰야 한다.
        // (리플레이 = 내 투구를 되짚는 중이므로 인접 레인은 courtesy 대기이기도 하다.)
        environment.update(dt, true, 0);
        return;
      }
      // 일시정지 모달이 열려 있으면 onFrame은 계속 돌지만(Loop.paused는 물리만 멈춘다) 시간에
      // 기대는 것들은 다 얼려야 한다. 안 그러면 물리는 멈춘 채 **파워 차징만 계속 올라가고**
      // 옆 레인 사이클은 페이즈를 넘겨 핀이 순간이동한다. render는 계속 돌아 화면은 살아 있다.
      if (loop.paused) {
        environment.update(dt, true, 0); // 전광판만 실시간, 앰비언트 물리시간 0
        return;
      }
      controls.update(dt); // 렌더 프레임마다 UI(조준선·게이지) — dt 기반 파워 차징(프레임레이트 독립)
      cameraRig.update(dt, loop.timeScale); // 상태별 카메라 연출 (팔로우 스무딩은 월드 시간)
      // 전광판 애니메이션 + 옆 레인 앰비언트. 두 번째 인자 = lane courtesy 홀드:
      // 내가 **던지는 동안**만 인접 레인이 새 투구를 미룬다. 실제 리그 표준이 "one lane courtesy
      // in both directions"이고, 실측으로 옆 레인 핀덱이 화면 중앙 150px(k=1)·297px(k=2)에 있어
      // 방해가 가장 큰 자리만 정확히 비우는 게 된다.
      //
      // ⚠️ 예전엔 AIMING 전체를 홀드에 넣었는데, **조준은 시간 제한이 없다.** 그래서 레인 3에서
      //    플레이하면 2·4번이 사실상 영구 대기로 계속 놀고 있었다(사용자 지적). 실제 courtesy는
      //    "남이 던지는 동안 기다린다"이지 "남이 고민하는 동안 얼어 있는다"가 아니다.
      //    그래서 차징 시작(=스탠스 진입)부터 안착까지로 좁혔다 — 투구당 5~8초.
      //    AI 턴도 자연히 포함된다(AI 투구는 ROLLING/SETTLING을 거치고 isCharging은 false).
      const delivering = controls.isCharging || game.state === 'ROLLING' || game.state === 'SETTLING';
      environment.update(dt, delivering, loop.timeScale); // 옆 레인 강체가 월드와 같은 시간축을 쓰게 (일시정지는 위에서 걸러짐)
      // 그림자 정적화: 공·핀이 멈춘 상태(AIMING/MENU/GAME_OVER)엔 셰도우맵 재렌더 중단,
      // ROLLING/SETTLING에만 갱신 (시간 대부분이 조준이라 이득 큼).
      const moving = game.state === 'ROLLING' || game.state === 'SETTLING';
      if (moving !== shadowMoving) {
        shadowMoving = moving;
        engine.renderer.shadowMap.autoUpdate = moving;
        if (!moving) engine.renderer.shadowMap.needsUpdate = true; // 정지 직전 1회 갱신
      }
      // 인게임 '메뉴로' 버튼: 매치 중(MENU/GAME_OVER 외)에만 노출.
      const inMatch = game.state !== 'MENU' && game.state !== 'GAME_OVER';
      if (inMatch !== matchVisible) { // 변경 시에만 DOM 쓰기(#12, 위 섀도우 토글과 통일). null 센티넬로 초기 1회 강제.
        matchVisible = inMatch;
        exitBtn.style.display = inMatch ? 'block' : 'none';
      }
      sound.setMenuMusic(!inMatch); // 메뉴·결과 화면에서만 배경음악 (매치 시작하면 페이드아웃). 멱등.
    },
  );
  game.setTimeScale = (s) => {
    loop.timeScale = s; // AI 턴 빨리감기 (P2 슬로모도 같은 인프라)
  };
  // 일시정지 사유가 **둘**이라 하나의 loop.paused를 공유한다 — 합산하지 않으면 한쪽이 풀 때
  // 다른 쪽 정지가 같이 풀린다(리플레이가 끝나면서 일시정지 모달 뒤의 게임이 되살아나는 식).
  let replayPaused = false;
  let menuPaused = false;
  const applyPause = () => {
    loop.paused = replayPaused || menuPaused;
  };
  replay.setPaused = (p) => {
    replayPaused = p; // 리플레이 재생 중 라이브 물리·sync 정지 (item 2)
    applyPause();
  };
  pauseHook.set = (p) => {
    menuPaused = p; // 일시정지 모달 — 열려 있는 동안 물리·상태머신을 실제로 멈춘다
    applyPause();
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

  // 부팅 완료 → 부팅 로더에 신호. 타이핑이 끝나면 'TAP TO START'가 뜨고, 탭하면 로더가
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
 * 터치 기기가 **가로**일 때 세로로 돌려달라고 알린다 (웹 폴백).
 *
 * ⚠️ 이 함수는 예전에 정반대였다 — "가로로 돌리면 더 잘 보여요"로 **가로를 권장**했다
 * (구 docs/MOBILE_SUPPORT.md §5 기본안). 실측이 그 반대를 말한다:
 *   `PerspectiveCamera.fov`는 세로축이라 종횡비와 무관하게 고정된다. 볼링 레인은 **좁고 깊은**
 *   피사체라 가로에선 짧은 변이 세로가 되며 모든 게 2.2배 작아진다 — iPhone 15 실측으로
 *   공 지점의 레인 폭이 화면 가로의 **7.8%**(세로 37%)였고, 화면 대부분이 벽·천장이었다.
 *   훅 진폭도 거리에 반비례해 가까울수록 잘 보이므로 멀어질 이유가 없다.
 * 그래서 **세로를 주력 방향으로 확정**했다.
 *
 * 플랫폼별 강도가 다르다:
 *  · 안드로이드 APK — AndroidManifest 의 `screenOrientation="portrait"` 로 **진짜 락**. OS가 아예
 *    회전을 안 시키므로 이 오버레이가 뜰 일이 없다.
 *  · iOS Safari — **방향 잠금 API가 없다**(`screen.orientation.lock`은 안드로이드 크롬 전용 +
 *    풀스크린 필요). 화면을 세로로 유지하는 유일한 방법은 앱 전체 역회전인데, 그건 `vw`/`vh`
 *    27곳과 `window.innerWidth` 기반 **조준 매핑**(Controls의 `aim = 1 - clientX/innerWidth·2`)까지
 *    좌표계를 갈아야 해서 레이아웃 문제가 **입력 버그**로 번진다. 그래서 웹은 이 안내로 둔다.
 */
function maybeShowOrientationHint() {
  if (!isCoarsePointer()) return;
  const landscape = matchMedia('(orientation: landscape)');

  const el = document.createElement('div');
  el.textContent = t('boot.rotatePortrait');
  css(el, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(16px + env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    padding: '8px 16px',
    borderRadius: '999px',
    background: 'rgba(14,17,27,0.92)',
    border: `1px solid ${rgba(NEON.turquoise, 0.4)}`,
    color: NEON.text,
    font: '600 12px/1.4 system-ui, sans-serif', // 안내 문구라 FONT_UI(13px)보다 한 단계 작다
    zIndex: '50',
    pointerEvents: 'none',
    boxShadow: '0 6px 26px rgba(0,0,0,0.5)',
  });

  // 가로인 동안만 붙어 있는다 — 시간제한 해제(구 3.5초)가 아니라 **방향에 종속**이다.
  // 세로로 돌리면 사라지고, 다시 가로로 돌리면 다시 뜬다.
  const apply = () => {
    if (landscape.matches) {
      if (!el.isConnected) document.body.appendChild(el);
    } else {
      el.remove();
    }
  };
  apply();
  landscape.addEventListener('change', apply);
}

/**
 * 인게임 '메뉴로' 버튼 — 좌상단 safe-area, 점수판(상단)과 안 겹치게 작게.
 * Esc(데스크톱)도 같은 동작. **가시성은 Loop onFrame이 매치 상태로 토글한다**(여기선 숨김으로 시작).
 */
function createExitButton(onForfeit: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = t('boot.menu');
  css(btn, {
    position: 'fixed',
    top: 'calc(8px + env(safe-area-inset-top))',
    left: 'calc(var(--col-edge, 0px) + 8px + env(safe-area-inset-left))',
    zIndex: '30',
    display: 'none',
    padding: '8px 12px',
    minHeight: '40px', // 터치 타깃 하한
    borderRadius: '3px', // applyPanel과 같은 라운드 — 10px는 패널과 어긋났다
    border: '1px solid rgba(255,255,255,0.2)',
    background: PANEL_BG, // 반투명 0.82 + blur(4px) → 불투명 단색 (패널과 같은 서피스)
    color: NEON.text,
    font: '700 13px/1 system-ui, sans-serif', // 버튼이라 FONT_UI(600/1.4)보다 굵고 타이트하게
    cursor: 'pointer',
  });
  // 텍스트를 여기서 **한 번만** 받으므로(가시성만 onFrame이 토글) 언어 변경을 직접 구독한다.
  onLocaleChange(() => {
    btn.textContent = t('boot.menu');
  });
  btn.onclick = onForfeit;
  document.body.appendChild(btn);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') onForfeit();
  });
  return btn;
}

/**
 * 저장된 외형·무게를 초기 적용. 영상 전광판만 IndexedDB라 비동기 —
 * 부팅을 막지 않고 늦게 붙인다(로더가 걷히기 전에 끝나는 게 보통).
 */
function applySavedCosmetics(game: GameState, environment: Environment, settings: Settings) {
  game.setHumanBallSpec(makeBallSpec(settings.ballLb)); // 메뉴 프리뷰 공에도 반영된다
  game.setBallSkin(resolveSkin(loadRewards().selectedSkin));
  const savedScreen = loadRewards().customScreen;
  if (savedScreen === VIDEO_MARKER) {
    void loadScreenVideo().then((v) => {
      if (v) environment.setCustomVideo(v.blob);
    });
  } else {
    environment.setCustomScreen(savedScreen);
  }
}

/**
 * 게임 이벤트 → 연출 배선.
 * 텍스트 연출은 **스틸컷 밴드 하나로 통일**한다(전광판 캔버스 글자·HUD 중앙 배너 없음).
 */
function wireGameEvents(d: {
  game: GameState;
  replay: Replay;
  stillCut: StillCut;
  menu: MenuUI;
  sound: SoundManager;
}) {
  const { game, replay, stillCut, menu, sound } = d;
  game.onEvent = (e) => {
    switch (e.type) {
      case 'strike': {
        const label =
          e.streak >= 4 ? `${e.streak} BAGGER!!` : e.streak === 3 ? 'TURKEY!!' : e.streak === 2 ? 'DOUBLE!' : 'STRIKE!';
        const sub = e.streak >= 2 ? t('boot.onFire', { streak: e.streak }) : t('boot.strike');
        // 스트라이크 = 풀연출: 짧은 리플레이 → 프리즈에 스틸컷 슬램. 녹화 부족 시 즉시 스틸컷.
        if (!replay.start(() => stillCut.show('strike', label, sub))) stillCut.show('strike', label, sub);
        break;
      }
      case 'spare':
        stillCut.show('spare', 'SPARE!', t('boot.spareCleared')); // 스페어 = 스틸컷만 (리플레이 X)
        break;
      case 'gutter':
        stillCut.show('gutter', 'GUTTER', t('boot.zeroPins')); // 거터 = 디플레이팅 스틸컷 (축하 X)
        break;
      case 'splitConverted':
        // 스플릿은 **성공만** 연출한다. '발생' 배너는 핀을 보면 아는 정보를 2구 조준 정면에 2.2초
        // 띄우는 부정 피드백이었고, 라벨도 볼링 용어가 아니라 남은 핀 번호 나열이었다.
        // AI 턴 배너도 걷었다 — 점수판이 현재 차례를 골드 액센트로 이미 표시한다(Hud.renderSheet).
        stillCut.show('split', 'SPLIT CONVERTED!', t('boot.splitConverted', { label: e.label }));
        break;
      case 'gameOver': {
        replay.cancel(); // 마지막 결정타 리플레이가 결과화면과 겹치지 않게 즉시 접음
        stillCut.hide();
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
}

/** 검증/디버그용 전역 (헤드리스 검증이 이걸로 게임을 직접 몬다 — CLAUDE.md '프리뷰에서 검증할 때'). */
function exposeDebugGlobals(o: {
  ball: Ball;
  pins: PinSet;
  engine: Engine;
  environment: Environment;
  game: GameState;
  cameraRig: CameraRig;
  sound: SoundManager;
  controls: Controls;
  stillCut: StillCut;
}) {
  const w = window as Window & {
    __ball?: Ball;
    __pins?: PinSet;
    __engine?: Engine;
    __environment?: Environment;
    __game?: GameState;
    __cameraRig?: CameraRig;
    __sound?: SoundManager;
    __controls?: Controls;
    /** [DEV] 스틸컷 4종을 눈으로 확인하려면 — 실제로 스트라이크가 날 때까지 던질 수 없다.
        예: `__stillCut.show('strike','STRIKE!','3연속 · ON FIRE')` */
    __stillCut?: StillCut;
    __unlockAllRewards?: () => void;
    __resetRewards?: () => void;
  };
  w.__ball = o.ball;
  w.__pins = o.pins;
  w.__engine = o.engine;
  w.__environment = o.environment; // 옆 레인 앰비언트 상태 확인용
  w.__game = o.game;
  w.__cameraRig = o.cameraRig;
  w.__sound = o.sound;
  w.__controls = o.controls;
  w.__stillCut = o.stillCut;
  // [DEV] 보상 디버그 — 콘솔에서 호출 후 새로고침
  w.__unlockAllRewards = () => {
    recordRewards(ACHIEVEMENTS.map((a) => a.id));
    console.log('[rewards] 전체 해금 완료 — 새로고침하세요');
  };
  w.__resetRewards = () => {
    resetRewards(); // 키를 통째로 지우므로 customScreen 마커도 같이 날아간다
    void clearScreenVideo(); // 영상 실물은 IndexedDB에 따로 있다 — 같이 지워야 용량이 회수된다
    o.environment.setCustomScreen(null); // 화면은 즉시 기본으로 (새로고침 없이도 확인 가능)
    console.log('[rewards] 초기화 완료 — 새로고침하세요');
  };
}

/**
 * 씬 + 게임 + UI 조립 (M5).
 * 입력은 Controls(마우스 조준/파워 차징 + 휠 스핀), 무게는 시작 메뉴 무게 슬라이더.
 */
function buildScene(engine: Engine): {
  game: GameState;
  controls: Controls;
  cameraRig: CameraRig;
  environment: Environment;
  sound: SoundManager;
  exitBtn: HTMLButtonElement;
  /** boot()이 주입 — 일시정지 모달 개폐를 Loop에 전달한다(replay.setPaused와 같은 방식). */
  pauseHook: { set: (paused: boolean) => void };
  replay: Replay;
} {
  const settings = loadSettings();
  // ⚠️ **UI를 만들기 전에** 로케일을 적용해야 한다 — Hud·Controls·Menu는 생성자에서 문자열을 넣는
  // 것들이 있어서, 나중에 적용하면 첫 화면만 기본 언어(ko)로 뜬다.
  setLocale(resolveLocale(settings.lang));
  // 로더는 모듈보다 먼저 그려지는 정적 HTML이라 aria-label이 한국어로 박혀 있다 — 로케일이
  // 정해진 지금 맞춰 준다(로더는 부팅이 끝날 때까지 떠 있으므로 스크린리더가 읽기 전에 도달한다).
  document.getElementById('loading')?.setAttribute('aria-label', t('loader.aria'));
  engine.setQuality(settings.quality === 'high'); // 저장된 그래픽 품질 적용 (기본 high)

  const lane = new Lane(engine);
  const environment = new Environment(engine); // 볼링장 배경 (옆 레인·벽·천장·네온·전광판)
  const pins = new PinSet(engine);
  const ball = new Ball(engine, makeBallSpec(10));
  const hud = new Hud();
  const game = new GameState(ball, pins, hud, lane);
  const controls = new Controls(engine, game, ball);
  const cameraRig = new CameraRig(engine, game, ball);
  // ⚠️ **MenuUI보다 먼저 만든다.** 아래 메뉴 콜백들이 `sound`를 캡처하는데, 예전엔 선언이
  // 100줄 아래에 있어서 MenuUI가 생성자에서 그 콜백을 부르는 순간 TDZ ReferenceError가 될
  // 자리였다(지금은 안 부르지만 그건 우연이다).
  const sound = new SoundManager();
  sound.enabled = settings.sound; // 저장된 사운드 on/off 적용

  // 메뉴/결과 화면 (로드맵 P1) — 시작 시 메뉴부터
  const menu = new MenuUI(
    (cfg) => game.startMatch(cfg),
    () => game.toMenu(),
    (lb) => {
      // 볼 무게 — 시작 메뉴와 일시정지 모달이 같은 콜백을 쓴다. 적용 시점(즉시/다음 투구)은
      // setHumanBallSpec이 가르고, 여기선 다음 실행에서도 같은 공으로 시작하게 저장만 더한다.
      settings.ballLb = lb;
      saveSettings(settings);
      game.setHumanBallSpec(makeBallSpec(lb));
    },
    (id) => game.setBallSkin(resolveSkin(id)), // 볼 스킨 (보상, 외형 전용)
    (media) => {
      // 전광판 커스텀 (히든 보상). 이미지/GIF와 영상은 배타 — Environment가 서로를 정리한다.
      if (!media) environment.setCustomScreen(null);
      else if (media.kind === 'image') environment.setCustomScreen(media.src);
      else environment.setCustomVideo(media.blob);
    },
    settings, // 시작 메뉴 사운드 토글이 읽는 현재 설정 (pause 모달과 동일 객체)
    (v) => {
      settings.sound = v;
      sound.enabled = v; // setter가 끄면 BGM·럼블 즉시 정지, 켜면 다음 프레임에 BGM 재개
      saveSettings(settings);
    },
    (lang) => {
      settings.lang = lang;
      saveSettings(settings);
      // setLocale이 <html lang>을 맞추고 정적 라벨 구독자(☰ 메뉴·스핀 힌트)를 깨운다.
      // 메뉴 패널 자체는 호출부가 다시 그린다(showLangs가 스스로 재렌더).
      setLocale(resolveLocale(lang));
    },
  );
  applySavedCosmetics(game, environment, settings);
  menu.showMenu();

  // item 2 — 스틸컷 오버레이 + 특별샷 리플레이(스냅샷). onStep 녹화, onEvent 발화.
  // 리플레이 종료 후 cameraRig.resync로 라이브 카메라가 현재 위치부터 부드럽게 인계.
  //
  // ⚠️ 여기서 스틸컷을 **끄지 않는다.** 예전엔 종료 콜백이 `stillCut.hide()`를 불렀는데, 스트라이크
  // 스틸컷은 리플레이 *프리즈* 때 뜨고 종료는 그 END_HOLD(0.65 재생초 ÷ PLAYBACK_SPEED 0.9 =
  // 실시간 0.72초) 뒤라, 제일 큰 연출이 1.6초가 아니라 **0.72초 만에 잘려 나갔다** — 인트로
  // 애니메이션(0.55초)을 빼면 착지하자마자 사라지는 셈. 밴드는 자기 타이머로 살게 두고, 정리는
  // gameOver에서만 명시적으로 한다(결과 화면과 겹치지 않게).
  const stillCut = new StillCut();
  const replay = new Replay(engine, ball, pins, () => cameraRig.resync());

  wireGameEvents({ game, replay, stillCut, menu, sound });

  // 충돌 신호 → 사운드 + 타격감 (P2). 공이 핀 구역(PIN_CONTACT_Z)에 들어선 접촉만
  // '임팩트'로 취급: 크래시 사운드 구분 + 카메라 셰이크 + 슬로모. 그 전 굴림 접촉은
  // 기존 굴림 접촉 그대로 (별도 사운드 없음, 굴림 거동 불변).
  engine.onContact = () => {
    if (ball.body.translation().z > PIN_CONTACT_Z) {
      // 핀 구역 접촉 = 카메라 연출만. 임팩트 사운드·슬로모는 GameState.notifyImpact가
      // **핀이 실제로 움직였는지**로 매 스텝 판정한다 — 여기서 호출하지 않는다.
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

  // boot()이 실제 구현을 꽂는다 — 일시정지 모달 개폐를 Loop.paused로 전달한다.
  const pauseHook = { set: (_paused: boolean) => {} };

  const forfeit = () => {
    if (game.state === 'MENU' || game.state === 'GAME_OVER') return;
    // ⚠️ 모달을 띄우는 것만으로는 아무것도 멈추지 않는다(오버레이가 입력만 가린다). 실제로
    // 멈추지 않으면 ROLLING 중에 열었을 때 공이 모달 뒤에서 계속 굴러 프레임이 끝나고,
    // AI 턴이면 AI가 계속 던진다. Loop.paused는 물리 step·onStep·sync만 건너뛰고
    // onFrame·render는 돌리며, 누적기가 멈춰 재개 시 따라잡기 폭주도 없다.
    pauseHook.set(true);
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
      onResume: () => {
        pauseHook.set(false);
        menu.hide();
      },
      onForfeit: () => {
        pauseHook.set(false);
        game.toMenu();
        menu.showMenu();
      },
    });
  };
  const exitBtn = createExitButton(forfeit);

  // 초기 카메라 (이후 CameraRig가 상태별로 보간) — AIMING 뷰와 동일
  engine.camera.position.set(0, 1.12, -2.7);
  engine.camera.lookAt(0, -0.05, 7.5);

  exposeDebugGlobals({ ball, pins, engine, environment, game, cameraRig, sound, controls, stillCut });

  return { game, controls, cameraRig, environment, sound, exitBtn, pauseHook, replay };
}
