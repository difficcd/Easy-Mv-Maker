# 작업 방식

혼자 만드는 프로젝트지만 브랜치와 PR을 거칩니다. 이유는 세 가지입니다: PR마다 Vercel
프리뷰가 생겨 병합 전에 실제 배포본으로 확인할 수 있고, CI가 관문이 되어 깨진 코드가
main에 들어오지 못하며, "왜 이렇게 했는지"가 코드와 함께 남습니다.

## 한 바퀴

```bash
gh issue create                       # 무엇을 왜 하는지 먼저 적는다
git switch -c fix/12-짧은-설명         # 이슈 번호를 브랜치에
# ... 작업 ...
npm run check                         # 통과하지 않으면 커밋하지 않는다
git commit -m "fix: ..."
git push -u origin HEAD
gh pr create --fill                   # 본문에 Closes #12
gh pr checks                          # CI
gh pr merge --squash --delete-branch
```

## 검증

```bash
npm run check   # 타입체크 → 테스트 → 훅 경고 기준선 → 빌드
```

**이것이 통과해도 증명되는 것은 많지 않습니다.** `undefined`를 반환하는 컴포넌트는 합법적인
React이고 유효한 JS라, 화면이 비어 있는데도 타입체크와 빌드가 모두 통과한 적이 있습니다.
구조를 바꿨다면 해당 화면이 실제로 뜨는지 눈으로 확인하세요.

훅 기준선(`scripts/hook-baseline.mjs`)은 `react-hooks/exhaustive-deps` 경고 **개수**를
지킵니다. 줄면 통과, 늘면 실패입니다. 늘었다면 대개 effect가 컴포넌트 안에서 매번 새로
만들어지는 함수를 참조하게 된 경우이고, 해법은 의존성에 넣는 것이 아니라 ref를 경유하는
것입니다 — 넣으면 매 렌더마다 effect가 다시 돕니다.

## 커밋

하나의 커밋은 하나의 논리적 변경입니다. 판단 기준은 **이 커밋만 되돌렸을 때 말이 되는가**.
대략 100줄 이상이거나 의미 있는 기능 하나가 될 때 커밋하고, 버그 하나마다 쪼개지 않습니다.

```
<type>: <명령형 한 줄>

<왜 이렇게 했는지. 무엇을 했는지는 diff가 말해준다.>
```

`feat` `fix` `refactor` `perf` `docs` `test` `chore`

성능 변경이면 측정값을 본문에 넣으세요. 6개월 뒤에 그 숫자가 유일한 근거가 됩니다.

## 코드를 어디에 둘 것인가

`src/` 폴더는 그 파일이 무엇에 손대도 되는지를 뜻합니다. 자세한 것은
[ARCHITECTURE.md](ARCHITECTURE.md) — **App.jsx를 고치기 전에 읽으세요.**

```
core/     순수 로직 — React·DOM·canvas 금지. 전부 테스트가 있습니다.
canvas/   그리기. 넘겨받은 2D 컨텍스트 외에는 순수합니다.
ui/       컴포넌트
hooks/    상태와 동작을 잇는 훅
```

새 로직은 App.jsx가 아니라 모듈에 둡니다. 인자의 함수인 것은 테스트 옆에 있어야 합니다.
불순한 부분은 인자로 받으면 됩니다 — `measureTextBox`가 컨텍스트를, `cloneCutContents`가
비트맵 복사기를, `loadKeymap`이 storage를 받는 이유입니다.

`core/`의 파일이 React를 import하거나 `document`를 찾고 있다면 폴더가 틀렸거나, 그것이
필요한 부분은 컴포넌트에 남겼어야 한다는 신호입니다.

## 문서

`ARCHITECTURE.md`는 틀리면 없느니만 못합니다. 한동안 캔버스 크기를 854×480(실제
1920×1080)이라 적어두고, 이미 있는 비트맵 수집기를 없다고 적어두고 있었습니다. 구조를
바꿨다면 같은 PR에서 고치세요.
