# MILJEONG

**밀정** — 1910년대 일제강점기 경성을 배경으로 한 소셜 추리 멀티플레이 게임입니다.
독립투사들은 거사를 준비하며 조직에 숨어든 **밀정**을 찾아내고, 밀정은 정체를 숨긴 채 투사들을 하나씩 제거합니다.
(웹 브라우저와 Capacitor 모바일 앱으로 플레이, 4~10인)

## 요구사항

- Node.js 22
- npm (워크스페이스 사용)
- 모바일 빌드 시: Android Studio(Android), Xcode(iOS, Mac 필요)

## 명령어

```bash
npm install          # 의존성 설치
npm run dev          # 서버(2567)와 클라이언트(Vite) 동시 실행
npm test             # 전체 단위/통합 테스트
npm run typecheck    # 전체 타입 검사
npm run e2e          # Playwright E2E 테스트
```

> **E2E 사전 준비:** `npm run e2e`는 Chromium 실행 파일이 필요합니다. 기본 경로(`/opt/pw-browsers/chromium`)가 없는 일반 환경에서는 `PW_CHROMIUM=<chrome/chromium 실행 파일 경로>`를 지정하세요. 브라우저가 없다면 `npx playwright install chromium`으로 설치한 뒤 그 경로를 `PW_CHROMIUM`에 지정합니다.

## 게임 방법

세부 규칙은 [설계 문서](docs/superpowers/specs/2026-10-14-miljeong-mvp-design.md)를 참고하세요.

### 역할

- 4~6명: 밀정 1명 / 7~10명: 밀정 2명, 나머지는 독립투사.
- 밀정끼리는 서로를 알고, 투사는 누가 밀정인지 모릅니다. 역할은 서버가 무작위로 배정합니다.

### 독립투사 — 거사 준비 임무

- 1인당 미니게임 임무 5개가 배정됩니다: 독립선언서 등사, 암호문 해독, 군자금 세기, 태극기 접어 숨기기, 전보 송신.
- 임무 지점에 다가가 "임무" 버튼으로 수행하면 전체 **거사 게이지**가 오릅니다 (유령이 된 투사의 임무도 포함).

### 밀정

- **밀고**: 가까운 투사를 지목해 끌려가게 합니다(유령이 됨). 쿨다운 30초. 그 자리에 흔적이 남습니다.
- **방해 공작** (공용 쿨다운 40초): **정전**(투사 시야 축소, 전신국 차단기로 해제), **일경 검문**(통로 한 곳을 15초간 차단). 방해 공작은 동시에 하나만 활성화할 수 있습니다.
- **위장**: 임무 지점에서 임무를 하는 척할 수 있습니다(게이지는 오르지 않음).

### 신고와 비상종

- 흔적 근처에서 **신고**하거나, 서점 뒷방의 **비상종**(1인 1회, 시작 15초 후부터, 방해 공작 중에는 사용 불가)으로 회의를 소집합니다. 방해 공작 중에도 신고는 가능합니다.

### 회의와 투표

- 소집되면 생존자 전원이 서점 뒷방으로 모이고 흔적과 방해 공작이 사라집니다.
- 토론 60초 → 투표 30초. 1인 1표, 대상은 생존자 또는 건너뛰기. 단독 최다 득표(건너뛰기 초과)면 조직에서 **축출**됩니다.
- 채팅은 회의 중 생존자만 가능하고, 유령은 유령끼리만 채팅합니다.

### 연결 끊김

- 게임 중 연결이 끊기면 30초 안에 재접속해야 하며, 이후에는 이탈한 것으로 처리됩니다.

### 승리 조건

1. 살아 있는 밀정이 0명 → 독립투사 승리
2. 살아 있는 투사 수 ≤ 살아 있는 밀정 수 → 밀정 승리
3. 거사 게이지 100% → 독립투사 승리

## 모바일 빌드 (Capacitor)

`android/`, `ios/` 폴더는 저장소에 포함되어 있지 않습니다. 본인의 PC에서 아래 순서로 생성하세요.

> **중요:** Capacitor 앱 안에서는 `location.hostname`이 `localhost`입니다. 따라서 기기용 빌드에서는 서버 주소를 자동으로 추정할 수 없으며, 반드시 `VITE_SERVER_URL`을 지정해 빌드해야 합니다.

```bash
npm install
# 서버 주소를 지정해 웹 번들 빌드 + 네이티브 프로젝트로 동기화
VITE_SERVER_URL=wss://your-server.example.com npm run cap:sync -w packages/client

cd packages/client
npx cap add android   # 최초 1회
npx cap add ios       # 최초 1회 (Mac 필요)
npx cap open android  # Android Studio에서 실행/빌드
npx cap open ios      # Xcode에서 실행/빌드 (Mac 필요)
```

웹 코드를 수정할 때마다 `npm run cap:sync -w packages/client`를 다시 실행하세요.

### 가로 화면 고정

네이티브 프로젝트 생성 후 직접 설정합니다.

- **Android**: `packages/client/android/app/src/main/AndroidManifest.xml`의 `<activity>`에 `android:screenOrientation="sensorLandscape"` 추가.
- **iOS**: Xcode에서 타깃 > General > Deployment Info > Device Orientation을 Landscape Left/Right만 체크 (`Info.plist`의 `UISupportedInterfaceOrientations`).

## 서버 배포

- 게임 서버는 `packages/server` (Colyseus, 기본 포트 2567)입니다. `npm start -w packages/server`로 실행합니다.
- 프로덕션에서는 TLS 뒤에 두고 클라이언트를 `VITE_SERVER_URL=wss://...`로 빌드해야 합니다. HTTPS 페이지나 모바일 앱에서 `ws://`는 차단될 수 있습니다.
- 개발 중 웹에서는 `VITE_SERVER_URL`이 없으면 `ws://<접속 호스트명>:2567`을 사용합니다. 모바일 앱에서는 이 방식이 동작하지 않습니다.

## 프로젝트 구조

```
MILJEONG/
├─ packages/
│  ├─ shared/   게임 규칙 (순수 TS, 엔진·네트워크 무관)
│  ├─ server/   Colyseus 게임 서버 (서버 권위)
│  └─ client/   Phaser 클라이언트 + Capacitor 설정
└─ docs/superpowers/
   ├─ specs/2026-10-14-miljeong-mvp-design.md   설계 문서
   └─ plans/2026-10-14-miljeong-mvp.md          구현 계획
```

- [설계 문서](docs/superpowers/specs/2026-10-14-miljeong-mvp-design.md)
- [구현 계획](docs/superpowers/plans/2026-10-14-miljeong-mvp.md)

## 라이선스

[LICENSE](LICENSE) 참고.
