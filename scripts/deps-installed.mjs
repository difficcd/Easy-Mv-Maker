// The packages installed here are the ones the lockfile asks for.
//
// Found during the 2026-10-21 inspection (docs/process/), by having it happen: a dependency PR
// merged on GitHub, the working copy was pulled but never reinstalled, and `npm run check` went on
// passing - on eslint 10.10 while CI, which runs `npm ci`, was on 10.12. A gate that passes on a
// different toolchain from the one CI uses is not the same gate, and nothing said so. Every
// earlier figure in that session had been measured on the stale tree.
//
// So the gate checks first that it is standing on the right packages. `npm ls` already knows: a
// package below its declared range is "invalid", one not there at all is "missing". Only those two
// fail - an extraneous package is clutter, not a different toolchain.

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

/**
 * The problems `npm ls --json` reports that mean the installed tree is not the declared one.
 *
 * @param {{problems?: string[]}} ls parsed `npm ls --json` output
 * @returns {string[]}
 */
export function driftOf(ls) {
    return (ls?.problems || []).filter(p => /^(invalid|missing):/.test(p));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let raw;
    try {
        raw = execFileSync('npm', ['ls', '--depth=0', '--json'], { encoding: 'utf8', shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
        // npm ls exits non-zero when it finds problems, but still prints its JSON.
        raw = e.stdout || '{}';
    }
    const drift = driftOf(JSON.parse(raw || '{}'));
    if (drift.length) {
        console.error(`The installed packages are not the ones package.json and the lockfile ask for:`);
        for (const p of drift) console.error(`  ${p}`);
        console.error(`
Every other check below would run on a different toolchain from CI's. Run \`npm ci\`, then check
again. (This usually means a dependency PR was merged and pulled without reinstalling.)`);
        process.exit(1);
    }
    console.log('Installed packages passed - they match what package.json asks for.');
}
