/**
 * 한국어 — **원본 사전.** 새 문자열은 여기에 먼저 넣는다.
 * 여기에 키를 추가하면 en/ja/zh가 그 키를 채울 때까지 **tsc가 실패한다**(의도된 것 — 미번역 방지).
 *
 * 자리표시자는 `{name}` 형태. 복수형이 필요한 키만 `키_one`을 함께 둔다(영어만 실제로 다르다).
 */
export const ko = {
  // ─── HUD ───
  'hud.state.aiming': '조준',
  'hud.state.rolling': '롤링!',
  'hud.state.counting': '핀 카운트…',
  'hud.state.gameover': '게임 종료',
  'hud.resetting': '핀 정리 중…',
  'hud.stateLine.gameover': '🎳 게임 종료',
  'hud.stateLine.spare': '스페어 {frame}/{frames} · 성공 {made}',
  'hud.stateLine.frame': '{frame}F · {ball}구 · {label}',
  'hud.pill.gameover': '🎳 {total}',
  'hud.pill.spare': '{frame}/{frames} · 성공 {made}',
  'hud.pill.frame': '{frame}F {ball}구 · {total}{suffix}',

  // ─── 조작 UI ───
  'controls.spin': '스핀',
  'controls.spin.hintDrag': '드래그로 좌/우 스핀',
  'controls.spin.hintWheel': '휠 ◀ ▶',

  // ─── 인게임 알림·버튼 ───
  'boot.rotatePortrait': '↻ 세로로 돌려주세요',
  'boot.menu': '☰ 메뉴',
  'boot.onFire': '{streak}연속 · ON FIRE',
  'boot.strike': '스트라이크',
  'boot.spareCleared': '스페어 정리',
  'boot.zeroPins': '0 핀',
  'boot.split': '{label} 스플릿!',
  'boot.splitConverted': '{label} 변환!',
  'boot.turn': '{name} 차례',

  // ─── 시작 메뉴 ───
  'menu.me': '나',
  'menu.start': '게임 시작',
  'menu.section.mode': '모드',
  'menu.section.rival': '상대',
  'menu.section.aim': '조준 난이도',
  'menu.section.weight': '볼 무게',
  'menu.rival.solo': '혼자',
  'menu.rival.solo.desc': '연습 모드',
  'menu.skinEntry': '🎨 컬렉션 · {label} ▸',
  'menu.statsFooter': '풀게임 — {full}<br>블리츠 — {blitz}<br>스페어 챌린지 — {spare}',
  'menu.help.touch': '누른 채 좌우로 조준 · 떼면 파워 발사 · 하단 바 = 스핀',
  'menu.help.mouse': '마우스 이동 = 조준 · 꾹 눌렀다 떼기 = 파워 발사 · 휠 = 좌/우 스핀',
  'menu.sound.off': '사운드 끄기',
  'menu.sound.on': '사운드 켜기',
  'menu.toMenu': '메뉴로',

  // ─── 결과 화면 ───
  'menu.result.spare': '스페어 {score}/10 성공!',
  'menu.result.final': '최종 {score}점',
  'menu.result.draw': '무승부!',
  'menu.result.win': '🏆 승리!',
  'menu.result.lose': '패배… {name}의 승리',
  'menu.result.unit': '점',
  'menu.result.newRecord': '✨ 새 기록!',
  'menu.result.newUnlock': '{icon} NEW · {badge} → {skin}',
  'menu.result.equip': '{label} 장착하기',
  'menu.result.equipped': '✓ {label} 장착됨',
  'menu.result.frameHint': '프레임별 점수는 상단 점수표에서 확인',
  'menu.result.retry': '다시 하기',

  // ─── 일시정지 ───
  'menu.pause.title': '⏸ 일시정지',
  'menu.pause.sound': '🔊 사운드',
  'menu.pause.haptics': '📳 햅틱',
  'menu.pause.graphics': '🖼️ 그래픽',
  'menu.pause.collection': '🏆 컬렉션 · 업적 {n}/{total} ▸',
  'menu.pause.resume': '▶ 계속하기',
  'menu.pause.forfeit': '포기하고 나가기',
  'menu.pause.forfeitNote': '포기 시 현재 게임 기록은 저장되지 않아요.',
  'menu.pause.help.touch': '🎯 <b>드래그</b> 조준 · <b>홀드</b> 파워 · <b>하단 바</b> 스핀',
  'menu.pause.help.mouse': '🎯 <b>마우스</b> 조준 · <b>꾹 눌렀다 떼기</b> 파워 · <b>휠</b> 스핀',
  'menu.on': '켜짐',
  'menu.off': '꺼짐',
  'menu.quality.high': '고품질',
  'menu.quality.perf': '성능',

  // ─── 컬렉션 ───
  'menu.collection.title': '🎨 컬렉션',
  'menu.collection.finish': '{finish} 마감',
  'menu.collection.equip': '장착',
  'menu.collection.locked': '잠김',
  'menu.collection.achUnlock': '{desc} · {skin} 해금',
  'menu.tab.skins': '볼 스킨',
  'menu.tab.achievements': '업적',
  'menu.tab.screen': '전광판',
  'menu.back.menu': '← 메뉴로',
  'menu.back.game': '← 게임으로',
  'menu.back.pause': '← 일시정지',

  // ─── 전광판 커스텀 ───
  'menu.screen.default': '기본 · 신스웨이브',
  'menu.screen.video': '🎬 영상',
  'menu.screen.hint': '이미지 · GIF · 영상 — 영상은 무음으로 반복 재생됩니다.',
  'menu.screen.videoStatus': '🎬 {name}{dur} · 무음 반복',
  'menu.screen.processing': '처리 중…',
  'menu.screen.noSpace': '저장 공간이 부족합니다. 더 작은 파일로 시도해주세요.',
  'menu.screen.failed': '적용하지 못했습니다.',
  'menu.screen.pickOther': '다른 파일 고르기',
  'menu.screen.pick': '이미지 · 영상 고르기',
  'menu.screen.reset': '기본으로 되돌리기',

  // ─── 언어 선택 ───
  'menu.section.lang': '언어',
  'lang.auto': '자동 · 기기 설정',

  // ─── 모드 ───
  'mode.full': '풀게임',
  'mode.full.desc': '10프레임 정식 룰',
  'mode.blitz': '블리츠',
  'mode.blitz.desc': '3프레임 스피드전',
  'mode.spare': '스페어 챌린지',
  'mode.spare.desc': '클래식 리브 10연속 픽업 (솔로)',

  // ─── 조준 난이도 ───
  'aim.easy': '쉬움',
  'aim.easy.desc': '훅 끝까지 그리는 풀 예측선',
  'aim.normal': '보통',
  'aim.normal.desc': '오일 존(직진 구간)까지만 — 훅은 직접 읽기',
  'aim.hard': '어려움',
  'aim.hard.desc': '조준 방향 표식만 — 라인은 온전히 실력',

  // ─── 볼 마감 ───
  'finish.matte': '무광',
  'finish.satin': '새틴',
  'finish.metallic': '메탈릭',
  'finish.chrome': '크롬',
  'finish.glow': '글로우',

  // ─── 볼 스킨 ───
  'skin.classic': '클래식',
  'skin.satin': '새틴',
  'skin.ember': '엠버',
  'skin.chrome': '크롬',
  'skin.galaxy': '갤럭시',
  'skin.volt': '볼트',
  'skin.sunset': '선셋',

  // ─── AI 라이벌 ───
  'ai.kim': '초보',
  'ai.kim.tagline': '착실한 직구 — 꾸준하지만 포켓을 자주 놓친다',
  'ai.yoon': '중수',
  'ai.yoon.tagline': '풀스핀 한 방 승부 — 대박 아니면 쪽박',
  'ai.han': '고수',
  'ai.han.tagline': '빈틈없는 정밀 직구 — 포켓도 스페어도 놓치지 않는다',

  // ─── 업적 ───
  'ach.first_game': '첫 발걸음',
  'ach.first_game.desc': '첫 게임 완주',
  'ach.beat_kim': '입문 졸업',
  'ach.beat_kim.desc': '초보 격파',
  'ach.beat_han': '명인 격파',
  'ach.beat_han.desc': '고수 격파',
  'ach.beat_yoon': '하이롤러',
  'ach.beat_yoon.desc': '중수 격파',
  'ach.score_200': '200 클럽',
  'ach.score_200.desc': '풀게임 200점 돌파',
  'ach.turkey': '터키',
  'ach.turkey.desc': '한 게임 3연속 스트라이크',

  // ─── 통계 요약 ───
  'stats.none': '기록 없음',
  'stats.full': '최고 {best} · 평균 {avg} · 스트라이크 {strikePct}% · 스페어 {sparePct}% ({count}판)',
  'stats.full_one': '최고 {best} · 평균 {avg} · 스트라이크 {strikePct}% · 스페어 {sparePct}% ({count}판)',
  'stats.blitz': '최고 {best} ({count}판)',
  'stats.blitz_one': '최고 {best} ({count}판)',
  'stats.spare': '최고 {best}/10 ({count}판)',
  'stats.spare_one': '최고 {best}/10 ({count}판)',

  // ─── 미디어 처리 오류 ───
  'media.seconds': '{sec}초',
  'media.videoNote': '{dim} · {dur}{size} · 무음 반복',
  'media.readFailed': '파일을 읽지 못했습니다.',
  'media.decodeFailed': '이미지를 해석하지 못했습니다.',
  'media.imageOnly': '이미지 파일만 됩니다 (PNG · JPG · GIF · WebP).',
  'media.gifTooBig': 'GIF가 너무 큽니다 ({size} · 최대 {max}). 프레임 수나 크기를 줄여주세요.',
  'media.gifKept': 'GIF · 원본 유지 {size}',
  'media.canvasFailed': '캔버스를 만들지 못했습니다.',
  'media.notVideo': '영상 파일이 아닙니다.',
  'media.videoTooBig': '영상이 너무 큽니다 ({size} · 최대 {max}).',
  'media.videoTimeout': '영상을 읽는 데 너무 오래 걸립니다.',
  'media.videoUnsupported': '이 브라우저가 재생할 수 없는 형식입니다 (MP4/H.264 권장).',
  'media.noVideoTrack': '영상 트랙이 없습니다.',
  'store.idbOpenFailed': 'IndexedDB를 열지 못했습니다.',
  'store.idbFailed': 'IndexedDB 작업 실패',

  // ─── 로더(index.html) ───
  'loader.aria': '로딩 중',
} as const;
