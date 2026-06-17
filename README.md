# Easy MV Maker

태블릿(갤럭시 탭)에 맞춘, 캔버스 내장 타임라인 기반 프레임 애니메이션·그리기 스튜디오. 펜과 손가락을 구분합니다.

## 기능
- 도트펜·마커·지우개·채우기·올가미·텍스트
- 펜은 그리기, 손가락은 이동·핀치 줌 (팜 리젝션)
- 멀티트랙 타임라인: 컷 드래그·리사이즈·스냅·반복재생
- 컷 = 레이어/폴더 · 이름변경·접기·다중선택·트랙 그룹핑
- 컷 애니메이션(진입/진출·변형·이동·이징) + 파츠 애니메이션(올가미 영역 이동·회전·크기·경로)
- 어니언 스킨 · 자동저장 · `.emv`/서버 저장 · WebM 내보내기 · PWA/Android 패키징

## 시작
```bash
npm install
npm run dev      # 웹(:5173, LAN+QR) + API(:8787)
npm run build
```
태블릿은 같은 Wi-Fi에서 `npm run dev`가 출력하는 QR을 스캔.

## Android (Capacitor)
```bash
npm run android:sync     # 웹 빌드 + 동기화
npm run android:open     # Android Studio 실행 -> 실행 / APK 생성
```

## 기술 스택
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=000)
![Canvas](https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff)
![Capacitor](https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff)
![Android](https://img.shields.io/badge/Android-Gradle-3DDC84?logo=android&logoColor=000)

---

# Easy MV Maker (English)

Timeline-based frame-animation and drawing studio with a built-in canvas, made for the Galaxy Tab (pen vs. finger).

## Features
- Dot pen, marker, eraser, bucket fill, lasso, text
- Pen draws; finger pans and pinch-zooms (palm rejection)
- Multi-track timeline: drag, resize, snap, loop playback
- Cuts with layers/folders; rename, collapse, multi-select, track grouping
- Cut animation (in/out, deform, move, easing) + part animation (lasso a region: move/rotate/scale/path)
- Onion skin, autosave, `.emv`/server save, WebM export, PWA/Android packaging

## Quick Start
```bash
npm install
npm run dev      # web (:5173, LAN + QR) + API (:8787)
npm run build
```
On a tablet, scan the QR printed by `npm run dev` (same Wi-Fi).

## Android (Capacitor)
```bash
npm run android:sync     # build web + sync
npm run android:open     # open Android Studio -> run / build APK
```

## Tech Stack
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=000)
![Canvas](https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff)
![Capacitor](https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff)
![Android](https://img.shields.io/badge/Android-Gradle-3DDC84?logo=android&logoColor=000)
