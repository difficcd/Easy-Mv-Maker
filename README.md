<h1 align="center">🎬 Easy MV Maker</h1>

<p align="center">
  <b>타임라인 기반 프레임 애니메이션 · 그리기 스튜디오</b><br/>
  <i>Timeline-based frame-animation & drawing studio — built for the Galaxy Tab (pen + finger).</i>
</p>

<p align="center">
  <code>Vite</code> · <code>React 18</code> · <code>Canvas</code> · <code>Capacitor (Android)</code>
</p>

---

## ✨ 기능 · Features

| | 한국어 | English |
|---|---|---|
| 🖌 | 도트펜·마커·지우개·채우기·올가미·텍스트 | Dot pen, marker, eraser, bucket fill, lasso, text |
| ✍️ | S펜만 그림 · 손가락은 이동/줌 (팜 리젝션) | Stylus draws; finger pans/pinch-zooms (palm rejection) |
| 🎞 | 멀티트랙 타임라인 (드래그·리사이즈·스냅) | Multi-track timeline (drag, resize, snap) |
| 🗂 | 컷 = 레이어/폴더 · 이름변경 · 접기 · 다중선택 · 트랙 그룹핑 | Cuts with layers/folders, rename, collapse, multi-select, track grouping |
| 🎬 | 컷 애니메이션: 진입/진출·변형(스퀴즈)·이동·이징·왕복/횟수 | Cut anim: in/out, deform, move, easing, ping-pong/count |
| 🦿 | 파츠 애니메이션: 올가미 영역을 이동·회전·크기·경로로 | Part anim: lasso a region → move/rotate/scale/path |
| 🧅 | 어니언 스킨 · 반복 재생 | Onion skin · loop playback |
| 💾 | 자동저장(IndexedDB) · `.emv` 파일 · 서버 DB | Autosave (IndexedDB), `.emv` files, server DB |
| 🎥 | WebM 내보내기 (오디오 포함) | WebM export (with audio) |
| 📱 | PWA + Android(Capacitor) 패키징 | PWA + Android (Capacitor) packaging |

## 🚀 시작 · Quick start

```bash
npm install
npm run dev        # web(:5173, LAN+QR) + API(:8787)
npm run build      # production build
```

탭에서 같은 Wi-Fi로 터미널의 **QR을 스캔**하면 바로 열립니다.
Scan the **QR** printed by `npm run dev` from a tablet on the same Wi-Fi.

## 📱 Android (Capacitor)

```bash
npm run android:sync   # build + sync
npm run android:open   # open Android Studio → run / build APK
```

## 🗂 구조 · Layout

```
src/App.jsx        # UI + 상태 (main component)
src/canvasUtils.js # 순수 헬퍼: 그리기·애니메이션·기하 (pure helpers)
src/db.js          # IndexedDB 자동저장 (autosave)
server/index.js    # 프로젝트 저장 API (Express, /api)
ARCHITECTURE.md    # 코드 맵 (read before editing)
```

> 펜 = 그리기, 손가락 = 탐색. 애니메이션은 ▶ 재생 시에만 보입니다.<br/>
> Pen draws, finger navigates. Animations play only while ▶ playing.
