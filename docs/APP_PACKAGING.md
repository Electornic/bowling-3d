# 데스크톱 · 모바일 앱 패키징 (Tauri v2)

> 웹 게임(`dist/`)을 **Windows · macOS · Android · iOS** 네이티브 앱으로 감싸는 가이드.
> 셸은 [Tauri v2](https://v2.tauri.app) 단독 — 한 툴체인으로 4개 플랫폼 전부.
> 게임 코드(Three.js + Rapier)는 4개 타겟에서 **100% 그대로 공유**되고, 달라지는 건 `src-tauri/`의 네이티브 셸 설정뿐이다.

---

## 0. 구조

```
bowling-3d/
├── src/            # 게임 (모든 플랫폼 공유)
├── dist/           # vite build 산출물 — Tauri가 이걸 감쌈
└── src-tauri/      # Tauri 셸
    ├── tauri.conf.json   # 앱 메타/창/번들 설정
    ├── Cargo.toml        # Rust 의존성
    ├── src/lib.rs        # 네이티브 진입점 (mobile_entry_point 포함)
    └── gen/              # android/ios 네이티브 프로젝트 (mobile init 후 생성)
```

핵심 설정([src-tauri/tauri.conf.json](../src-tauri/tauri.conf.json)):
- `identifier`: `com.electornic.bowling3d` — OS 앱 ID(맥 번들ID·Android applicationId·iOS bundle id). **스토어 등록 전 본인 도메인으로 바꿀 것.**
- `build.frontendDist`: `../dist`, `build.devUrl`: `http://localhost:5173`
- `build.beforeBuildCommand`: `npm run build` (Tauri 빌드가 자동으로 vite build 실행)

---

## 1. 공통 준비물

| | 필요 | 현재 상태(2026-06) |
|---|---|---|
| Rust | `rustup` 툴체인 | ✅ 설치됨 (1.94) |
| Node | 20.19+ (권장 24 LTS — Node 20은 2026-04 EOL) | ✅ (24) |

```bash
npm install            # @tauri-apps/cli, @tauri-apps/api 포함
```

---

## 2. 데스크톱 (Windows / macOS)

| OS | 빌드 위치 | 비고 |
|---|---|---|
| macOS | Mac에서 | `.app` / `.dmg` |
| Windows | **Windows에서** | `.msi` / `.exe`. Mac에서 Win 인스톨러 크로스컴파일은 사실상 불가 → Windows 머신 또는 CI 필요 |

```bash
npm run app:dev        # 개발 (핫리로드, 데스크톱 창)
npm run app:build      # 프로덕션 번들 (현재 OS용)
```

> 서명 없이 배포하면 macOS Gatekeeper / Windows SmartScreen 경고가 뜬다. 개인용은 무시 가능,
> 정식 배포는 Apple Developer 인증서 / Windows 코드사이닝 인증서 필요.

---

## 3. 모바일 (Android / iOS)

### 3.1 Android

준비물:
- Android Studio(SDK·에뮬레이터) + **NDK** — 이 머신엔 이미 설치됨(NDK `27.1.12297006`).
- CLI에서 쓰려면 환경변수만 export하면 된다(Android Studio는 자기 컨텍스트에만 잡아둠).
  `~/.zshrc`에 추가해두면 매번 `npm run android:*`가 바로 동작:

```bash
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.1.12297006"
export JAVA_HOME="$(/usr/libexec/java_home)"
```

> 미설치 머신이면: Android Studio 설치 후 SDK Manager에서 NDK + CMake 체크,
> 또는 `sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.1.12297006"`.

초기화 & 실행:
```bash
npm run tauri android init     # gen/android 생성 (1회)
npm run android:dev            # 에뮬레이터/실기기 실행
npm run android:build          # APK/AAB
```

> Play 스토어: 개발자 등록 $25(1회). Android WebView는 Chromium 기반이라 WebGL/WASM 호환 양호.

### 3.2 iOS

준비물:
- **Mac 필수** + Xcode (✅ 26.4 설치됨)
- Apple Developer Program $99/년 (실기기·스토어)

```bash
npm run tauri ios init         # gen/apple 생성 (1회)
npm run ios:dev                # 시뮬레이터/실기기 실행
npm run ios:build              # .ipa
```

> ⚠️ **iOS는 WKWebView를 쓴다.** WebGL/WASM 동작하나 (1) 120Hz 기기에서도 **60Hz로 고정**,
> (2) App Store **가이드라인 4.2**(최소 기능)로 "웹사이트 래핑"이라 반려될 수 있음 → 햅틱·오프라인 등
> 앱다운 요소를 갖춰 심사 대비. 우리 물리는 고정 timestep이라 60Hz 캡은 *시각 부드러움*만 영향, 게임성은 무관.

---

## 4. CI — main 푸시 시 Android APK 자동 릴리스

[.github/workflows/release-android.yml](../.github/workflows/release-android.yml):

- **트리거**: `main` 푸시(또는 Actions 탭에서 수동 실행).
- **태그**: `vYYMMDDNN` — 한국시간 날짜 + 같은 날 N번째 배포면 `NN`이 `01,02,…`로 자동 증가
  (기존 `vYYMMDD??` 태그 중 최댓값 +1).
- **산출물**: `aarch64` **debug APK**(= debug 키로 서명 → 시크릿 없이 바로 설치 가능),
  GitHub **Release**에 `bowling-3d-<태그>.apk`로 첨부 + 커밋 기반 릴리스 노트 자동 생성.

설치: Release에서 APK 받아 안드로이드에 사이드로드("출처를 알 수 없는 앱" 허용). `aarch64`라 실기기 거의 전부 호환(x86 에뮬은 제외).

> ⚠️ **첫 실행 전 1회**: 릴리스 생성에 쓰기 권한이 필요하다. 워크플로에 `permissions: contents: write`는 있지만 403이 나면
> **Settings → Actions → General → Workflow permissions → "Read and write permissions"** 로 변경. CI Node는 로컬과 같은 **24**.

> **debug → 정식 서명 APK로 올리려면**: 키스토어를 만들어 secrets(`ANDROID_KEYSTORE`(base64), `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`)에 넣고,
> 빌드를 `--debug` 없이(release) 한 뒤 `apksigner`로 서명하는 스텝을 추가. 같은 키로 서명해야 업데이트 설치가 됨(빌드마다 키가 바뀌면 재설치 필요).

> **나머지 플랫폼**: iOS는 Apple 서명/프로비저닝 필요(IPA 사이드로딩은 등록 기기 한정 → TestFlight 권장), Windows/macOS 데스크톱은 각 OS 러너 추가. 필요해지면 잡을 덧붙이면 된다.

---

## 5. 알려진 함정 (dependency pin)

`src-tauri/Cargo.lock`에 다음 핀이 걸려 있다 — **`cargo update`로 풀지 말 것**:

| 크레이트 | 핀 | 이유 |
|---|---|---|
| `brotli` | 8.0.2 | 8.0.3은 `alloc-no-stdlib` 2.x/3.x를 섞어 끌어와 컴파일 실패(트레잇 불일치) |
| `alloc-stdlib` | 0.2.2 | `alloc-no-stdlib`를 2.x로 통일해 위 충돌 해소 |

`cargo update`가 필요하면 이 둘은 `--precise`로 되돌리거나 `-p <crate>`에서 제외할 것.
brotli가 정합된 신규 버전을 내면 핀 해제 가능.

---

## 부록 — 명령 요약

| 목적 | 명령 |
|---|---|
| 데스크톱 개발 | `npm run app:dev` |
| 데스크톱 빌드 | `npm run app:build` |
| Android 개발/빌드 | `npm run android:dev` / `npm run android:build` |
| iOS 개발/빌드 | `npm run ios:dev` / `npm run ios:build` |
| 모바일 최초 init | `npm run tauri android init` / `npm run tauri ios init` |
