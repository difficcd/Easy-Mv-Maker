# Easy MV Maker

Timeline-based frame-animation and drawing studio with a built-in canvas, optimized for the Galaxy Tab (pen vs. finger).

This repo contains:
- A Vite + React single-page web app
- An Android wrapper via Capacitor for release builds (APK/AAB)
- A small local project-storage API (Express)

## Features
- Tools: dot pen, marker, eraser, bucket fill, lasso, text
- Pen vs. finger: stylus draws; finger pans (1 finger) and pinch-zooms (2 fingers) — palm rejection
- Multi-track timeline with cuts (drag, resize, snap, scrub, loop)
- Cuts with layers and folders; rename, collapse, multi-select / multi-copy, track grouping
- Cut animation: in/out (fade/scale/slide), deform (squash/stretch), move, easing, ping-pong + count
- Part animation: lasso a region, then animate it (move / rotate / scale / along a drawn path)
- Onion skin, bucket fill that respects line boundaries
- Persistence: autosave (IndexedDB), `.emv` JSON files, and server-side project DB
- WebM export (with audio), PWA install, Android packaging

## Quick Start (Web)
Requirements: Node.js

```bash
npm install
npm run dev      # web (:5173, LAN host + QR) + API (:8787)
npm run build
npm run preview
```

For tablet testing, scan the QR printed by `npm run dev` from a device on the same Wi-Fi.

## Android (Capacitor)
Requirements: Android Studio + SDK.

```bash
npm install
npx cap add android      # one-time
npm run android:sync     # build web + sync into android/
npm run android:open     # open Android Studio -> run / Generate Signed Bundle / APK
```

Do not commit `android/**/build/` or `android/.gradle/` (already ignored).

## Tech Stack

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=000)
![Canvas](https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff)
![Capacitor](https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff)
![Android](https://img.shields.io/badge/Android-Gradle-3DDC84?logo=android&logoColor=000)

Core libraries: React (UI/state), lucide-react (icons), Express (project API), Capacitor (Android).
Platform APIs: HTML Canvas 2D, Pointer Events (`pointerType` pen vs. finger), IndexedDB (autosave), File System Access API (with download/upload fallback).

## Repo Layout
- `src/App.jsx` — main app (UI, state, timeline, canvas tools, save/load)
- `src/canvasUtils.js` — pure helpers (drawing, animation math, geometry)
- `src/db.js` — IndexedDB autosave
- `server/index.js` — Express project-storage API (`/api`)
- `android/`, `capacitor.config.json` — Capacitor Android project
- `ARCHITECTURE.md` — code map (read before editing)

====

# Easy MV Maker (한국어)

태블릿(갤럭시 탭)에 맞춘, 캔버스 내장 타임라인 기반 프레임 애니메이션·그리기 스튜디오입니다. 펜과 손가락을 구분합니다.

구성:
- Vite + React 단일 페이지 웹 앱
- Capacitor 기반 Android 래퍼(APK/AAB 빌드)
- 로컬 프로젝트 저장 API(Express)

## 기능
- 도구: 도트펜, 마커, 지우개, 채우기, 올가미, 텍스트
- 펜/손가락 구분: 스타일러스만 그림, 손가락은 이동(한 손가락)·핀치 줌(두 손가락) — 팜 리젝션
- 멀티트랙 타임라인: 컷 드래그·리사이즈·스냅·스크럽·반복재생
- 컷 = 레이어/폴더, 이름변경·접기·다중선택/다중복사·트랙 그룹핑
- 컷 애니메이션: 진입/진출(페이드·확대·슬라이드), 변형(스퀴즈/스트레치), 이동, 이징, 왕복+횟수
- 파츠 애니메이션: 올가미로 영역을 떼어 이동·회전·크기·경로 따라 애니메이션
- 어니언 스킨, 경계를 존중하는 채우기
- 저장: 자동저장(IndexedDB), `.emv` JSON 파일, 서버 프로젝트 DB
- WebM 내보내기(오디오 포함), PWA 설치, Android 패키징

## 빠른 시작 (웹)
요구사항: Node.js

```bash
npm install
npm run dev      # 웹(:5173, LAN 호스트 + QR) + API(:8787)
npm run build
npm run preview
```

태블릿 테스트는 같은 Wi-Fi에서 `npm run dev`가 출력하는 QR을 스캔하면 됩니다.

## Android (Capacitor)
요구사항: Android Studio + SDK.

```bash
npm install
npx cap add android      # 최초 1회
npm run android:sync     # 웹 빌드 + android/ 동기화
npm run android:open     # Android Studio 실행 -> 실행 / 서명된 번들·APK 생성
```

`android/**/build/`, `android/.gradle/`는 커밋하지 않습니다(이미 무시됨).

## 기술 스택

![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=000)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=fff)
![JavaScript](https://img.shields.io/badge/JavaScript-ESM-F7DF1E?logo=javascript&logoColor=000)
![Canvas](https://img.shields.io/badge/HTML5%20Canvas-2D-E34F26?logo=html5&logoColor=fff)
![Express](https://img.shields.io/badge/Express-API-000000?logo=express&logoColor=fff)
![Capacitor](https://img.shields.io/badge/Capacitor-Android-119EFF?logo=capacitor&logoColor=fff)
![Android](https://img.shields.io/badge/Android-Gradle-3DDC84?logo=android&logoColor=000)

핵심 라이브러리: React(UI/상태), lucide-react(아이콘), Express(프로젝트 API), Capacitor(Android).
플랫폼 API: HTML Canvas 2D, Pointer Events(`pointerType`로 펜/손가락 구분), IndexedDB(자동저장), File System Access API(다운로드/업로드 폴백).

## 저장소 구조
- `src/App.jsx` — 메인 앱(UI, 상태, 타임라인, 캔버스 도구, 저장/열기)
- `src/canvasUtils.js` — 순수 헬퍼(그리기, 애니메이션 계산, 기하)
- `src/db.js` — IndexedDB 자동저장
- `server/index.js` — Express 프로젝트 저장 API(`/api`)
- `android/`, `capacitor.config.json` — Capacitor Android 프로젝트
- `ARCHITECTURE.md` — 코드 맵(편집 전 참고)
