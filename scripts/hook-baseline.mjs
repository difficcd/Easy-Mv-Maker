// 훅 의존성 경고가 '늘어났는지'만 본다.
//
// 왜 0을 요구하지 않는가: 남아 있는 경고는 대부분 의도적이다. 이 앱은 매 프레임 그리는 캔버스와
// 무거운 캐시를 다뤄서, 린터가 시키는 대로 의존성을 다 넣으면 effect가 계속 재실행되며 예전에 실제로
// 났던 "Maximum update depth exceeded" 무한 루프로 되돌아간다. 그래서 현재 상태를 기준선으로
// 못박고, 로직을 커스텀 훅으로 옮기는 등의 변경에서 새 경고가 생기면(= stale closure 위험이 늘면)
// 실패시킨다. 기준선을 의도적으로 바꿀 때는 UPDATE=1 로 실행한다.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const BASELINE = 'scripts/hook-baseline.json';
// eslint를 node로 직접 실행한다. 윈도우에서 .cmd 래퍼를 spawn하면 EINVAL이 난다.
const eslintBin = 'node_modules/eslint/bin/eslint.js';

let out = '';
try {
    out = execFileSync(process.execPath, [eslintBin, 'src', '-f', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
} catch (e) {
    // eslint는 문제가 있으면 종료코드가 0이 아니지만, 결과 JSON은 stdout으로 나온다.
    out = e.stdout || '';
    if (!out) { console.error('eslint 실행 실패:', e.message); process.exit(1); }
}

const results = JSON.parse(out);
let errors = 0;
const counts = {};
for (const f of results) {
    const file = f.filePath.split(/[\\/]/).pop();
    for (const m of f.messages) {
        if (m.severity === 2) errors++;
        const key = `${file}:${m.ruleId}`;
        counts[key] = (counts[key] || 0) + 1;
    }
}

if (process.env.UPDATE === '1' || !existsSync(BASELINE)) {
    writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + '\n');
    console.log('훅 경고 기준선을 기록했습니다:', JSON.stringify(counts));
    process.exit(errors ? 1 : 0);
}

const base = JSON.parse(readFileSync(BASELINE, 'utf8'));
const grown = [];
for (const [k, n] of Object.entries(counts)) {
    const was = base[k] || 0;
    if (n > was) grown.push(`  ${k}: ${was} → ${n}`);
}

if (errors) {
    console.error(`훅 규칙 위반(error) ${errors}건 — 훅 호출 위치가 잘못되었습니다.`);
    process.exit(1);
}
if (grown.length) {
    console.error('훅 의존성 경고가 늘었습니다 (stale closure 위험):');
    console.error(grown.join('\n'));
    console.error('의도한 변경이면  UPDATE=1 node scripts/hook-baseline.mjs  로 기준선을 갱신하세요.');
    process.exit(1);
}

const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`훅 검사 통과 — 경고 ${total}건(기준선 이내), 위반 0건`);
