import { ko } from './locales/ko';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { zh } from './locales/zh';

/**
 * 자체 소형 i18n 레이어 (ko/en/ja/zh).
 *
 * i18next를 안 쓴 이유: 이 프로젝트의 UI는 **의존성 0의 명령형 DOM**이다(프레임워크·바인딩 없음).
 * 필요한 건 「키 → 문자열 + 보간」뿐이라 런타임 26KB와 초기화 비동기성을 살 이유가 없다.
 *
 * 설계 규칙 셋:
 *  1. **`ko`가 원본 사전**이고 나머지는 `Record<I18nKey, string>`이다 → 번역 누락이 **tsc 에러**로 잡힌다.
 *     (누락을 허용하면 폴백으로 한국어가 조용히 섞여 나가는데, 그게 미번역보다 나쁘다.)
 *  2. 모듈 로드 시점에 문자열을 굳히지 않는다. 라벨을 들고 있던 데이터 레코드(스킨·업적·AI 프로필)는
 *     문자열 대신 **키**를 들고, 그릴 때 `t()`로 푼다 — 언어를 바꿔도 스킨 이름이 옛 언어로 남지 않는다.
 *  3. 수 일치(복수형)는 **영어에만** 있다. `{count}`를 넘기고 `키_one`을 두면 count===1에서 그쪽을 쓴다.
 */
export type LocaleCode = 'ko' | 'en' | 'ja' | 'zh';
/** 설정에 저장되는 값 — 'auto'는 기기 언어를 따른다. */
export type LocaleSetting = 'auto' | LocaleCode;

export type Dict = typeof ko;
export type I18nKey = keyof Dict;

const DICTS: Record<LocaleCode, Record<I18nKey, string>> = { ko, en, ja, zh };

export const LOCALES: readonly LocaleCode[] = ['ko', 'en', 'ja', 'zh'];
/** 언어 선택 UI는 **각 언어를 그 언어로** 적는다(번역하지 않는다) — 못 읽는 언어로 적혀 있으면 고를 수 없다. */
export const LOCALE_LABEL: Record<LocaleCode, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '简体中文',
};

/**
 * `<html lang>` 값. ⚠️ 반드시 갱신해야 한다 — `system-ui`는 한·중·일이 **한자 글리프를 공유**해서
 * lang이 틀리면 일본어 화면에 중국어 자형(직·画 등)이 나온다. 중국어는 간체이므로 `zh-Hans`.
 */
const HTML_LANG: Record<LocaleCode, string> = { ko: 'ko', en: 'en', ja: 'ja', zh: 'zh-Hans' };

let current: LocaleCode = 'ko';
const listeners = new Set<() => void>();

/**
 * 기기 언어 → 지원 로케일. 모르는 언어는 **영어**로 떨어진다(한국어보다 넓게 읽힌다).
 * `navigator.languages`를 앞에서부터 보므로 "ja-JP, en-US" 같은 순서 선호가 유지된다.
 */
export function detectLocale(): LocaleCode {
  const nav = navigator as Navigator & { languages?: readonly string[] };
  const cands = nav.languages?.length ? nav.languages : [nav.language];
  for (const raw of cands) {
    const tag = String(raw ?? '').toLowerCase();
    if (tag.startsWith('ko')) return 'ko';
    if (tag.startsWith('ja')) return 'ja';
    if (tag.startsWith('zh')) return 'zh';
    if (tag.startsWith('en')) return 'en';
  }
  return 'en';
}

export function resolveLocale(setting: LocaleSetting): LocaleCode {
  return setting === 'auto' ? detectLocale() : setting;
}

export function getLocale(): LocaleCode {
  return current;
}

/**
 * 현재 언어를 적용한다. 같은 값으로 다시 불러도 안전하다(부팅 시 1회 + 설정 변경 시).
 * `<html lang>`은 매번 맞춘다 — 값이 안 바뀌어도 index.html의 하드코딩(`lang="ko"`)과 어긋날 수 있다.
 */
export function setLocale(code: LocaleCode): void {
  const changed = code !== current;
  current = code;
  document.documentElement.lang = HTML_LANG[code];
  if (changed) for (const fn of [...listeners]) fn();
}

/**
 * 언어 변경 알림. 매 프레임 다시 그려지는 UI(HUD·점수판)나 열 때마다 재구성되는 패널(메뉴)은
 * 구독할 필요가 없다 — **생성자에서 한 번만 텍스트를 넣는 것들**(스핀 힌트·☰ 메뉴 버튼)만 쓴다.
 */
export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** `{name}` 자리표시자를 vars로 채운다. 없는 자리표시자는 그대로 남겨 눈에 띄게 한다. */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  const dict = DICTS[current];
  let s: string = dict[key] ?? ko[key];
  const n = vars?.count;
  if (typeof n === 'number' && n === 1) {
    const one = `${key}_one` as I18nKey;
    if (one in dict) s = dict[one];
  }
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = vars[name];
    return v === undefined ? whole : String(v);
  });
}
