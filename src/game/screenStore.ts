/**
 * 전광판 커스텀 **비디오** 저장소 (히든 보상 §2차).
 *
 * 왜 IndexedDB인가: 이미지·GIF는 data URL로 줄여서 localStorage(보상 스토어)에 넣지만,
 * 비디오는 수 MB~수십 MB라 localStorage 쿼터(보통 5MB)에 애초에 안 들어간다.
 * 그래서 비디오만 여기로 빼고, 보상 스토어에는 **마커 문자열**(VIDEO_MARKER)만 남긴다
 * — "뭔가 설정돼 있다"는 판정과 해금·초기화 경로를 한 곳(rewards.ts)에 유지하기 위해서다.
 */

const DB_NAME = 'bowling3d.screen';
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
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB를 열지 못했습니다.'));
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 작업 실패'));
        t.oncomplete = () => db.close();
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
