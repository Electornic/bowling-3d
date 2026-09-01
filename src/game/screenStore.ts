import { t } from '../i18n';

/**
 * 전광판 커스텀 **비디오** 저장소 (히든 보상 §2차).
 *
 * 왜 IndexedDB인가: 이미지·GIF는 data URL로 줄여서 localStorage(보상 스토어)에 넣지만,
 * 비디오는 수 MB~수십 MB라 localStorage 쿼터(보통 5MB)에 애초에 안 들어간다.
 * 그래서 비디오만 여기로 빼고, 보상 스토어에는 **마커 문자열**(VIDEO_MARKER)만 남긴다
 * — "뭔가 설정돼 있다"는 판정과 해금·초기화 경로를 한 곳(rewards.ts)에 유지하기 위해서다.
 */

const DB_NAME = 'starlite.screen';
/**
 * 구 DB 정리 — 이름 변경으로 DB 이름이 `bowling3d.screen` → `starlite.screen`이 됐다.
 * localStorage와 달리 **인계하지 않는다**: 값이 수십 MB 비디오라 옮기는 비용이 크고, 커스텀 전광판은
 * 사용자가 직접 올린 옵트인 콘텐츠라 다시 올리면 된다. 대신 **구 DB를 지워 쿼터 누수를 막는다** —
 * 안 지우면 브라우저에 수십 MB가 영구히 남는다(참조하는 코드는 이제 없다).
 * ⚠️ 2026-10 이후엔 지워도 된다.
 */
let legacyDropped = false;
function dropLegacyDb(): void {
  if (legacyDropped) return;
  legacyDropped = true;
  try {
    indexedDB.deleteDatabase('bowling3d.screen');
  } catch {
    /* 지원 안 하는 환경 — 무해하게 넘긴다 */
  }
}
const DB_VERSION = 1;
const STORE = 'media';
const KEY = 'custom';

export interface ScreenVideo {
  blob: Blob;
  /** 원본 파일명 — UI 표시용 */
  name: string;
  /** 초 단위 길이 (프로브 실패 시 0) */
  duration: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    dropLegacyDb(); // 구 DB 쿼터 누수 방지 (한 번만 실제로 실행된다)
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(t('store.idbOpenFailed')));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        // 지역명 `t` 금지 — i18n `t()`를 가린다(실제로 아래 줄에서 "not callable"로 터졌다).
        const trans = db.transaction(STORE, mode);
        const req = run(trans.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error(t('store.idbFailed')));
        trans.oncomplete = () => db.close();
      }),
  );
}

/** 비디오 저장 (이전 것을 덮어쓴다 — 항상 한 개만 보관). */
export async function saveScreenVideo(v: ScreenVideo): Promise<void> {
  await tx('readwrite', (s) => s.put(v, KEY));
}

/** 저장된 비디오. 없거나 실패하면 null (시크릿 모드 등에서 조용히 기본 전광판). */
export async function loadScreenVideo(): Promise<ScreenVideo | null> {
  try {
    const v = await tx<ScreenVideo | undefined>('readonly', (s) => s.get(KEY));
    return v && v.blob instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

/** 저장된 비디오 삭제. */
export async function clearScreenVideo(): Promise<void> {
  try {
    await tx('readwrite', (s) => s.delete(KEY));
  } catch {
    // 지우기 실패는 치명적이지 않음 — 마커만 지워도 화면은 기본으로 돌아간다
  }
}
