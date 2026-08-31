import { t } from '../i18n';
/**
 * 전광판 커스텀 이미지 처리 (히든 보상 §1차 — 정지 이미지 + GIF).
 *
 * 저장은 localStorage(보상 스토어)라 원본을 그대로 넣으면 5MB 쿼터를 한 방에 넘긴다.
 * 그래서 여기서 **전광판 캔버스 크기로 줄이고 다시 인코딩**한 뒤 넘긴다.
 *
 * ⚠️ GIF만 예외로 원본을 유지한다 — 캔버스로 다시 그리면 첫 프레임만 남아 애니메이션이 죽는다.
 *    대신 용량 상한을 걸어 쿼터를 지킨다.
 */

/** 전광판 캔버스 해상도 (Environment.drawScreen과 동일) */
export const SCREEN_W = 768;
export const SCREEN_H = 256;

/** GIF 원본 상한. localStorage 쿼터(보통 5MB)에 스킨·업적까지 같이 들어가므로 여유를 둔다. */
const GIF_MAX_BYTES = 2 * 1024 * 1024;

export interface ScreenMedia {
  /** localStorage에 저장할 data URL */
  src: string;
  /** 사용자에게 보여줄 처리 결과 한 줄 */
  note: string;
}

/** data URL의 실제 바이트 수 (base64 4글자 → 3바이트). */
function dataUrlBytes(url: string): number {
  const i = url.indexOf(',');
  if (i < 0) return 0;
  const b64 = url.slice(i + 1);
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('media.readFailed')));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(t('media.decodeFailed')));
    img.src = src;
  });
}

const kb = (n: number) => `${Math.round(n / 1024)}KB`;

/**
 * 파일 → 전광판에 쓸 data URL.
 * 정지 이미지는 768×256에 cover로 맞춰 JPEG 재인코딩, GIF는 원본 유지(용량 검사만).
 * 실패 시 사용자에게 보여줄 메시지를 담아 throw.
 */
export async function fileToScreenSource(file: File): Promise<ScreenMedia> {
  if (!file.type.startsWith('image/')) {
    throw new Error(t('media.imageOnly'));
  }

  const raw = await readAsDataURL(file);

  if (file.type === 'image/gif') {
    const bytes = dataUrlBytes(raw);
    if (bytes > GIF_MAX_BYTES) {
      throw new Error(t('media.gifTooBig', { size: kb(bytes), max: kb(GIF_MAX_BYTES) }));
    }
    // 애니메이션 보존을 위해 원본 그대로. 화면 맞춤은 그릴 때 cover로 처리한다.
    return { src: raw, note: t('media.gifKept', { size: kb(bytes) }) };
  }

  const img = await loadImage(raw);
  const c = document.createElement('canvas');
  c.width = SCREEN_W;
  c.height = SCREEN_H;
  const g = c.getContext('2d');
  if (!g) throw new Error(t('media.canvasFailed'));
  // cover — 전광판을 꽉 채우고 넘치는 쪽을 잘라낸다(레터박스 검은 띠 방지)
  const s = Math.max(SCREEN_W / img.width, SCREEN_H / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  g.drawImage(img, (SCREEN_W - dw) / 2, (SCREEN_H - dh) / 2, dw, dh);
  // cover라 캔버스가 꽉 차서 투명 영역이 없다 → JPEG로 충분하고 PNG보다 훨씬 작다
  const out = c.toDataURL('image/jpeg', 0.85);
  return {
    src: out,
    note: `${img.width}×${img.height} → ${SCREEN_W}×${SCREEN_H} · ${kb(dataUrlBytes(out))}`,
  };
}

// --- 비디오 (§2차) -------------------------------------------------------

/**
 * 비디오 원본 상한. IndexedDB는 여유롭지만 무제한은 아니고, 무엇보다 사용자가 4K 원본을
 * 그대로 넣으면 디코드 비용만 커진다(전광판은 768×256이라 화질 이득이 0이다).
 */
const VIDEO_MAX_BYTES = 40 * 1024 * 1024;

export interface ScreenVideoPick {
  blob: Blob;
  name: string;
  duration: number;
  note: string;
}

/**
 * 파일 → 전광판용 비디오. 트랜스코딩은 하지 않는다(브라우저에서 싸게 할 방법이 없다).
 * 대신 **재생 가능 여부를 실제로 확인**하고 용량 상한만 건다 — canPlayType은 컨테이너만
 * 보고 ''를 돌려주는 경우가 많아 믿을 수 없어서, 메타데이터를 실제로 읽혀 본다.
 */
export async function fileToScreenVideo(file: File): Promise<ScreenVideoPick> {
  if (!file.type.startsWith('video/')) throw new Error(t('media.notVideo'));
  if (file.size > VIDEO_MAX_BYTES) {
    throw new Error(t('media.videoTooBig', { size: kb(file.size), max: kb(VIDEO_MAX_BYTES) }));
  }

  const url = URL.createObjectURL(file);
  try {
    const meta = await new Promise<{ duration: number; w: number; h: number }>((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata';
      v.muted = true;
      const done = () => {
        clearTimeout(timer);
        v.removeAttribute('src');
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(t('media.videoTimeout')));
      }, 10_000);
      v.onloadedmetadata = () => {
        done();
        resolve({ duration: v.duration, w: v.videoWidth, h: v.videoHeight });
      };
      v.onerror = () => {
        done();
        reject(new Error(t('media.videoUnsupported')));
      };
      v.src = url;
    });
    if (!meta.w || !meta.h) throw new Error(t('media.noVideoTrack'));
    const secs = Number.isFinite(meta.duration) ? Math.round(meta.duration) : 0;
    return {
      blob: file,
      name: file.name,
      duration: secs,
      note: t('media.videoNote', {
        dim: `${meta.w}×${meta.h}`,
        dur: secs ? `${t('media.seconds', { sec: secs })} · ` : '',
        size: kb(file.size),
      }),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}
