<h1 align="center">Easy MV Maker</h1>

<p align="center">
  타임라인 기반 프레임 애니메이션 · 드로잉 스튜디오, 캔버스 내장.<br>
  브라우저에서 돌아갑니다 — PC든 태블릿이든. 펜이나 마우스가 그리고, 손가락은 화면을 옮깁니다.
</p>

<p align="center">
  <a href="https://github.com/difficcd/Easy-Mv-Maker/actions/workflows/ci.yml"><img src="https://github.com/difficcd/Easy-Mv-Maker/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=000" alt="React 19">
  <img src="https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=fff" alt="Vite 8">
  <img src="https://img.shields.io/badge/TypeScript-checkJs-3178C6?logo=typescript&logoColor=fff" alt="TypeScript checkJs">
  <img src="https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff" alt="HTML5 Canvas 2D">
  <img src="https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff" alt="Express API">
  <img src="https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff" alt="Capacitor Android">
</p>

<p align="center">
  <img src="docs/screenshot.png" alt="Easy MV Maker — 도구 패널, 캔버스, 컷/레이어 트리, 타임라인" width="900">
</p>

<p align="center"><sub>위 강조색은 사용자가 정한 것 — 색 하나가 UI 전체를 이끕니다.</sub></p>

<p align="center">
  <a href="https://github.com/difficcd/Easy-Mv-Maker/wiki/Home-ko"><b>사용 안내 (위키)</b></a> — 시작하기, 카메라, 파츠 애니메이션과 효과, 영상 가져오기, 내보내기, 컷이 많을 때 · English: <a href="README.md">README.md</a>
</p>

## 기능

**그리기**
- 점 펜, 마커, 에어브러시(블러 / 자글자글 모드), 지우개, 채우기, 올가미, 텍스트, 리퀴파이(펜을 따라 픽셀을 밀어냄)
- 도형 도구: 직선, 곡선, 사각형, 타원. 각각 보통 선으로 저장되어 현재 브러시를 따르고, 지워지고, 레이어와 함께 자글거립니다
- 올가미 선택: 이동, 크기, 회전(선택 위 손잡이 또는 슬라이더), 기울기와 굽힘(슬라이더, 또는 선택 안에서 Ctrl 드래그); Ctrl+T는 레이어 전체 선택
- 이동 도구는 선택된 것만 옮깁니다 — 탭한 텍스트, 아니면 활성 레이어; 텍스트가 레이어에 딸려 가는 일은 없습니다
- 채우기는 클릭한 색에 맞추므로 이미 채운 영역 위에 다시 칠할 수 있습니다
- 펜이 그리고, 손가락은 이동·핀치 줌(팜 리젝션)
- 선 스무딩(리샘플 → Chaikin → Catmull-Rom); 그리는 중인 선은 별도 오버레이 캔버스에 점진적으로 그려집니다

**모션과 효과**
- 자글자글 선 — 이미 그린 선에 거는 떨림, 진폭·파장·최소 굵기 설정
- 컷별 카메라: 팬, 줌, 기울기, 그린 경로, 프리셋, 핸드헬드 흔들림 — 프레임 전체가 움직이고 모든 레이어가 따라갑니다
- 컷 안 시작/끝 구간을 가진 레이어 효과: 모자이크(블록 크기, 속도, 레이어와 함께 움직이는 선택 영역)와 노이즈 — 선이 찢어지고 빨강·청록으로 갈라지고 눈발이 앉되 선 있는 곳에만, 그래서 투명 배경에서도 됩니다; 노이즈는 텍스트에도 걸 수 있습니다
- 컷 애니메이션(등장/퇴장, 변형, 이동, 이징) + 파츠 애니메이션(영역을 올가미로: 이동 / 회전 / 크기 / 경로)
- 키프레임 트위닝 — 거리장 기반 형태 모핑, 중심 정렬
- 그린 곡선을 따르는 흔들림, 끝이 뿌리를 뒤따르는 지연, 슬라이스별 전단을 쓰는 굽힘 프로파일
- 모션 프리셋, 텍스트 애니메이션, 리치 텍스트
- 모든 효과는 시간의 순수 함수 — 무작위 없음 — 그래서 내보내기가 재생과 정확히 같은 프레임을 다시 그립니다

**타임라인과 구조**
- 멀티트랙 타임라인: 드래그, 크기 조절, 스냅, 반복 재생, 파트 묶기
- 재생 속도는 프로젝트 기본값으로 두거나, 영화에 굳혀서 모든 컷 길이·이징·텍스트 속도를 그에 맞게 다시 재는 것도 가능
- 레이어와 중첩 폴더를 가진 컷; 이름 바꾸기, 접기, 다중 선택
- 어니언 스킨
- 숫자 칸(속도, 좌표…)은 슬라이더 범위에 갇히지 않고 자유 입력을 받습니다

**입출력**
- 자동저장, `.emv` 저장/열기, 서버 저장
- 5분마다 서버 자동 백업, 최신 12개 보관 — UI를 막지 않고 백그라운드에서
- 로컬 파일이나 URL에서 영상 가져오기: 프레임 추출, 장면 전환 감지, 음원 트랙(내보내기 때 스스로 풀리는 소리 끄기)
- 가져오기는 기본으로 원본 영상 크기에 맞추므로 세로 쇼츠가 레터박스 없이 캔버스를 채웁니다; 가로·세로 프리셋도 있음
- 고정 프레임 격자로 녹화하는 WebM/MP4 내보내기(그리기 루프 샘플링에서 오는 끊김 없음), 시작/끝 범위 지정; PWA, 안드로이드 패키징

**UI**
- 영어·한국어·일본어, 설정에서 전환
- 도움말 창은 "이 기능 어디 있나" 목록으로 시작: 효과마다 어느 줄, 어느 아이콘, 어느 패널인지
- 도킹 패널: 헤더를 잡아 왼쪽·오른쪽 가장자리로 끌면 도킹, 가운데에 놓으면 떠 있는 창. 배치는 기억됩니다
- Tab이 모든 패널을 숨겨 캔버스만 남기고, 다시 누르면 있던 그대로 복구
- 재생바를 끌면 애니메이션째 스크럽 — 정지 그림이 지나가는 게 아니라 동작이 보입니다
- 사용자 테마 색 — 색 하나에서 HSL 램프를 만들어 앱 전체(재생 바, 패널, 버튼 포함)에 적용, 무채색 채도도 조절 가능
- 사용자 정의 단축키
- 긴 작업은 전체 화면 오버레이 대신 구석 칩으로 진행 상황을 알립니다

## 빠른 시작

```bash
npm install
npm run dev      # 웹 (:5173, LAN + QR) + API (:8787)
npm run build
```

태블릿에서는 `npm run dev`가 찍어 주는 QR을 스캔하세요 (같은 Wi-Fi). 5173이 쓰이고 있으면 Vite가 5174, 5175…로 옮깁니다 — 터미널의 주소를 확인하세요.

**요구 사항**: Node 18+. URL에서 영상을 가져오려면 `yt-dlp`, 1080p 같은 병합 포맷은 추가로 `ffmpeg`. 나머지는 둘 다 없어도 됩니다.

### 검사

```bash
npm run check      # 아래 전부를 순서대로, 그리고 프로덕션 빌드
npm test           # node --test, 테스트 프레임워크 의존성 없음
npm run typecheck  # tsc --noEmit (allowJs/checkJs, 파일은 .jsx 그대로)
npm run lint       # eslint-plugin-react-hooks
npm run smoke      # 빌드된 앱을 헤드리스 브라우저에서 띄워 선 하나 긋기
```

`npm run check`가 관문입니다: 타입 검사, 단위 테스트, 정적 가드 여섯, 빌드. 같은 단계가 모든 푸시와 PR에서 CI로 돕니다.

| 가드 | 실패 조건 |
|---|---|
| `scripts/hook-baseline.mjs` | React 훅 의존성 경고가 고정된 기준선보다 늘어남 |
| `scripts/helper-index.mjs` | 공유 export가 `HELPERS.md`에 없음 |
| `scripts/unreachable.mjs` | App 수준 이름 중 아무 데서도 닿지 않는 것 |
| `scripts/unused-imports.mjs` | 파일 안 아무것도 쓰지 않는 import |
| `scripts/stroke-writes.mjs` | `commitStroke`를 거치지 않고 레이어에 선을 추가하는 쓰기 |
| `scripts/i18n-check.mjs` | 영어 항목 없는 `tr()` 리터럴, 또는 소스에 키가 더는 없는 사전 항목 |

단위 테스트 약 1,150개가 `src/core`, `src/canvas`, `src/engine`, `src/export`의 순수 모듈을
덮습니다 — 기하, 이징, 키프레임 샘플링, 컷 리듀서, 레이어 트리 이동, 올가미 오려내기, 타임라인
스냅, 시간 배율 굳히기, GIF·zip 라이터. DOM도 프레임워크도 필요 없어 Node 내장 러너를 씁니다.
실제로 그리는 함수들 — 선을 픽셀로, 노이즈, 모자이크, 채우기 — 는 `@napi-rs/canvas`(브라우저
없는 Skia 2D 캔버스) 위에서 `canvas/canvasFactory.js`를 통해 돌리고 진짜 픽셀로 검증합니다.
프레임 추출은 실제 video 요소가 필요해 스모크 테스트에 맡깁니다. 효과의 비용은 시간이 아니라 횟수로
지킵니다: `test/canvas/opBudget.test.js`가 노이즈·모자이크 한 프레임의 캔버스 연산 수가 지금보다
늘면 실패합니다.

```bash
npm run bench      # 순수 핫패스 측정
```

캔버스 쪽 효과의 측정과 무엇을 왜 바꿨는지는 [docs/perf/](docs/perf/)에 — 조사 하나당 파일 하나.

메모이제이션을 더하기 전에 알아둘 것: 16.7ms 프레임 기준으로 렌더마다 파생되는 값은 시간이
가는 곳이 아닙니다. 컷 1,000개의 파트 집계 0.026ms, `strokeSig` 1μs 미만, 레이어 100개
평탄화 0.017ms. 이걸 `useMemo`로 감싸면 아끼는 것보다 의존성 검사가 더 듭니다. 이 앱의 비용은
캔버스 다시 그리기와 비트맵 디코딩이고, 그래서 있는 캐시는 레이어별 캔버스 캐시, 꼬리 점진
렌더링, rAF 스로틀, 자글자글 경로용 WeakMap — `useMemo`가 아닙니다.

`scripts/hook-baseline.mjs`는 훅 의존성 경고가 **늘어날 때만** 실패합니다. 남은 경고는 대부분
의도된 것(프레임마다의 캔버스 작업, 무거운 캐시)이라 0이 목표가 아니고, 커스텀 훅 추출 같은
데서 새로 생기는 stale closure 위험을 잡는 가드입니다. 기준선을 일부러 옮기려면 `UPDATE=1 node
scripts/hook-baseline.mjs`.

> 정적 검사를 다 통과해도 컴포넌트가 마운트된다는 증명은 아닙니다 — `undefined`를 돌려주는
> 컴포넌트는 React에서 합법입니다. 구조를 바꿨으면 해당 화면을 열어 눈으로 보세요.

## 안드로이드 (Capacitor)

설치 가능한 APK를 CI가 빌드하니 Android SDK 없이도 받을 수 있습니다:

- **태그 릴리스** — `v*` 태그를 푸시하면 APK가
  [Releases](https://github.com/difficcd/Easy-Mv-Maker/releases)에 올라갑니다.
- **아무 커밋** — Actions 탭에서 *Android APK* 워크플로를 돌리고 그 실행의 아티팩트를 받습니다.

디버그 변형이고 표준 디버그 키로 서명되어 있어, 안드로이드가 그 출처의 설치를 허용할지 묻습니다.
릴리스 빌드에는 진짜 키스토어가 필요하고, 키스토어는 일부러 이 저장소 밖에 둡니다.

SDK가 있다면 로컬에서:

```bash
npm run android:sync     # 웹 빌드 + android/ 로 동기화
npm run android:open     # Android Studio 열기 -> 실행, 또는 Build > Generate Signed Bundle / APK
```

`npx cap sync`가 `dist/`를 `android/`로 복사합니다. 기기에서 라이브 리로드가 필요하면 Capacitor의
`server.url`을 잠시 쓰되, 그대로 배포하지는 마세요.

## 구조

```
src/
  App.jsx          컴포넌트: 상태와 배선 (~2,100줄)
  tools/           그리기 도구를 디스패치 테이블로: 포인터 다운·이동에 각 도구가 하는 일
  core/            순수 로직 - 리듀서, 타임라인 기하, 올가미, 도형, 저장, 내보내기 계획
  canvas/          2D 컨텍스트에 그리는 모든 것: 선, 텍스트, 흔들림 슬라이스, 레이어 합성
  engine/          한 프레임 평가: 어느 컷이 켜져 있고 시간 t에 각 레이어가 어떻게 보이는지
  export/          GIF·zip 바이트 라이터, 영상 녹화 배관, 다운로드
  hooks/           제 자리를 얻은 App 상태: 캔버스 뷰, 레이어 캐시, 재생, 오디오, 히스토리,
                   자동저장, 패널, 도구 설정, 단축키, 드래그 제스처
  ui/              패널; ui/dialogs/ 는 대화상자 하나당 파일 하나
  styles/          영역별 스타일시트, styles/index.css가 캐스케이드 순서대로 import
  i18n.js          영어 사전(~710 항목)과 tr() 조회; i18n.ja.js는 일본어
  globals.d.ts     앰비언트 선언 (EyeDropper, Capacitor, File System Access…)
server/            API: index.js가 배선, projects·backups·youtube가 라우트 모듈, paths.js가 모든 경로를 만듦
scripts/           위 검사 가드들, 핫패스 벤치마크, 폰트 서브셋
test/              단위 테스트 (node --test), src/ 구조를 그대로 — src/core는 test/core — 그리고 smoke/
```

`core/`, `engine/`, `export/` 아래 어떤 것도 캔버스나 React를 건드리지 않고, `tools/`는 React도
자기 소유의 컨텍스트도 건드리지 않습니다 — `ImageData`가 필요하면 생성자를 인자로 받습니다.
`canvas/`는 자기 것이 아니라 건네받은 컨텍스트에 그립니다. 그 분리가 테스트를 프레임워크 없이
유지시킵니다. [ARCHITECTURE.md](ARCHITECTURE.md)는 `App.jsx`를 고치기 전에 읽을 지도이고,
[HELPERS.md](HELPERS.md)는 모든 공유 export의 목록입니다.

한국어 원문이 gettext 식으로 번역 키를 겸하므로, 항목이 빠지면 빈 라벨 대신 한국어가 보입니다.
일본어는 불완전해도 되고 영어로 폴백합니다. 조회 함수 이름이 `t`가 아니라 `tr`인 건 `t`가 이미
수십 곳에서 지역 변수이기 때문입니다.

## 참고

**서버는 로컬 전용입니다.** 같은 Wi-Fi의 태블릿에서 내 컴퓨터에 닿기 위한 편의 장치이고, 그
이상에 노출되도록 쓰이지 않았습니다:

- 인증이 전혀 없습니다. :8787에 닿는 누구나 모든 프로젝트를 읽고, 덮어쓰고, 지우고, 다운로드를
  일으킬 수 있습니다.
- 태블릿이 닿아야 하므로 모든 인터페이스에서 듣습니다. 믿을 수 없는 네트워크에서는 그 네트워크의
  모두라는 뜻입니다.
- 에셋 업로드는 요청당 최대 1GB의 원시 본문을 받으므로, 열린 포트는 디스크를 채우는 길이기도
  합니다.
- 경로 탐색은 막혀 있습니다 — 프로젝트 id는 파일시스템에 닿기 전에 정제됩니다 — 하지만 방어하는
  악의적 입력은 그것뿐입니다.

내가 통제하는 네트워크에서 내 방화벽 뒤에 두세요. 포트 포워딩하지 마세요.

영상 가져오기는 로컬·개인 용도입니다. 원본 서비스의 약관과 저작권을 지키세요.

## 라이선스

아직 정하지 않았습니다 — 당분간 모든 권리 보유. 유료 앱이 될 수도 있는 개인 프로젝트라, 후회할
라이선스를 고르기보다 선택지를 열어 둡니다. 쓰거나 이어서 만들고 싶으면 이슈를 열어 주세요;
정리해 드리겠습니다.
