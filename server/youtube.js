// Local-only: audio and video from a URL via yt-dlp (+ ffmpeg for merged formats). Not for the
// deployed build. For personal, authorised use; respect the source's terms and copyright.

import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { isYouTubeUrl } from './youtubeUrl.js';
import { audioType, videoType } from './paths.js';

/** @param {import('express').Express} app */
export function youtubeRoutes(app) {
    // Local-only: extract audio from a URL (YouTube etc) via yt-dlp + ffmpeg. Not for the
    // deployed build. For personal/authorized use; respect source ToS and copyright.

    app.get('/api/youtube-audio', async (req, res) => {
        const url = String(req.query.url || '');
        if (!isYouTubeUrl(url)) { res.status(400).json({ error: 'not a YouTube address' }); return; }
        const dir = path.join(os.tmpdir(), `yt_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(dir, { recursive: true });
        try {
            // bestaudio in its native container — no ffmpeg needed; browser plays m4a/webm.
            //
            // Through runYtdlp, like the video route below, rather than wiring 'error' and 'close' by
            // hand. A failed spawn emits BOTH of those - measured, not assumed: a missing binary gives
            // error then close(-4058) - so the hand-wired version answered the request twice, once
            // with the useful "yt-dlp 실행 불가 (설치 필요)" and again with whatever friendlyYtError
            // made of an empty stderr. A promise can only settle once, which is the whole reason
            // runYtdlp exists.
            const { code, err } = await runYtdlp(['-f', 'bestaudio/best', '--no-playlist', '--extractor-args', 'youtube:player_client=default,web_safari,android', '-o', path.join(dir, 'audio.%(ext)s'), url]);
            if (err.startsWith('SPAWN:')) { res.status(500).json({ error: 'yt-dlp 실행 불가 (설치 필요): ' + err.slice(6) }); return; }
            if (code !== 0) { res.status(500).json({ error: friendlyYtError(err) }); return; }
            // .part is a half-written download. The video route already skipped these; this one took
            // whatever readdir happened to return first, and readdir promises no order.
            const files = (await fs.readdir(dir)).filter(f => !f.endsWith('.part'));
            if (!files.length) { res.status(500).json({ error: '오디오 파일 없음' }); return; }
            const f = files[0];
            res.setHeader('Content-Type', audioType(path.extname(f).toLowerCase()));
            res.send(await fs.readFile(path.join(dir, f)));
        } catch (e) {
            res.status(500).json({ error: String(e) });
        } finally {
            fs.rm(dir, { recursive: true, force: true }).catch(() => { });
        }
    });

    // Local-only: fetch a video by URL for frame extraction. Progressive single-file formats
    // only, so no ffmpeg merge is needed. Personal/authorized use; respect source ToS.
    // Map yt-dlp stderr to something actionable instead of a raw dump.
    const friendlyYtError = (err) => {
        const e = err.toLowerCase();
        if (e.includes('sign in') || e.includes('bot')) return '유튜브가 봇으로 판단해 차단했습니다. 잠시 후 재시도하거나 다른 영상을 사용하세요.';
        if (e.includes('age')) return '연령 제한 영상이라 받을 수 없습니다.';
        if (e.includes('private')) return '비공개 영상입니다.';
        if (e.includes('unavailable') || e.includes('removed')) return '영상을 찾을 수 없거나 삭제되었습니다.';
        if (e.includes('geo') || e.includes('country')) return '지역 제한 영상입니다.';
        if (e.includes('live')) return '라이브 스트림은 지원하지 않습니다.';
        if (e.includes('requested format') || e.includes('no video formats')) return '받을 수 있는 단일 파일 포맷이 없습니다 (ffmpeg 없이 병합 불가).';
        // YouTube signs its media URLs with a challenge that yt-dlp solves in JavaScript. When the
        // installed yt-dlp is too old to solve the current one it fetches an unsigned URL and the
        // download comes back 403 - extraction having succeeded moments earlier, which is what makes
        // this look like a network fault. It is not: it is a version problem, and saying "network
        // error" sends people to check their connection instead of running one command.
        if (e.includes('403') || e.includes('signature solving failed') || e.includes('n challenge')) {
            return 'yt-dlp가 최신이 아니라 유튜브가 다운로드를 거부했습니다 (403). 서버에서 yt-dlp를 업데이트하세요: python -m pip install -U yt-dlp';
        }
        if (e.includes('unable to download') || e.includes('network') || e.includes('timed out')) return '네트워크 오류로 받지 못했습니다.';
        return '영상 받기 실패: ' + err.slice(-300);
    };
    const runYtdlp = (args) => new Promise((resolve) => {
        const p = spawn('yt-dlp', args);
        let err = '';
        p.stderr.on('data', d => { err += d; });
        p.on('error', (e) => resolve({ code: -1, err: 'SPAWN:' + e.message }));
        p.on('close', (code) => resolve({ code, err }));
    });
    // Locate ffmpeg so yt-dlp can merge DASH video+audio (needed for 1080p). Returns the containing
    // dir (for --ffmpeg-location) or null. Checks env, PATH, and the winget install location.
    const findFfmpegDir = () => {
        const candidates = [];
        if (process.env.FFMPEG_PATH) candidates.push(path.dirname(process.env.FFMPEG_PATH));
        const la = process.env.LOCALAPPDATA;
        if (la) {
            candidates.push(path.join(la, 'Microsoft', 'WinGet', 'Links'));
            try {
                const pkgs = path.join(la, 'Microsoft', 'WinGet', 'Packages');
                for (const d of fsSync.readdirSync(pkgs)) {
                    if (!/ffmpeg/i.test(d)) continue;
                    const stack = [path.join(pkgs, d)];
                    while (stack.length) {
                        const cur = stack.pop();
                        let ents = []; try { ents = fsSync.readdirSync(cur, { withFileTypes: true }); } catch { continue; }
                        if (ents.some(e => e.isFile() && e.name.toLowerCase() === 'ffmpeg.exe')) { candidates.push(cur); break; }
                        for (const e of ents) if (e.isDirectory()) stack.push(path.join(cur, e.name));
                    }
                }
            } catch { }
        }
        candidates.push('C:\\ffmpeg\\bin');
        for (const c of candidates) {
            try { if (fsSync.existsSync(path.join(c, 'ffmpeg.exe')) || fsSync.existsSync(path.join(c, 'ffmpeg'))) return c; } catch { }
        }
        return null;
    };
    const FFMPEG_DIR = findFfmpegDir();
    console.log('[mv-api] ffmpeg:', FFMPEG_DIR ? path.join(FFMPEG_DIR, 'ffmpeg.exe') : 'not found (YouTube capped at ~720p progressive)');

    app.get('/api/youtube-video', async (req, res) => {
        const url = String(req.query.url || '');
        if (!isYouTubeUrl(url)) { res.status(400).json({ error: 'not a YouTube address' }); return; }
        const maxH = Math.max(144, Math.min(2160, Number(req.query.maxHeight) || 1080));
        const dir = path.join(os.tmpdir(), `ytv_${Date.now()}_${Math.random().toString(36).slice(2)}`);
        await fs.mkdir(dir, { recursive: true });
        // With ffmpeg present, prefer merged bestvideo+bestaudio (unlocks 1080p+); otherwise fall back
        // to progressive single-file formats (≤720p). Each entry widens on retry.
        const merged = [
            `bv*[height<=${maxH}][ext=mp4]+ba[ext=m4a]/bv*[height<=${maxH}]+ba/b[height<=${maxH}]`,
            `bv*+ba/b`,
        ];
        const progressive = [
            `best[height<=${maxH}][ext=mp4]/best[height<=${maxH}]`,
            'best[ext=mp4]/best',
            'worst[ext=mp4]/worst',
        ];
        const formats = FFMPEG_DIR ? [...merged, ...progressive] : progressive;
        const ffArgs = FFMPEG_DIR ? ['--ffmpeg-location', FFMPEG_DIR, '--merge-output-format', 'mp4'] : [];
        try {
            let lastErr = '';
            for (const fmt of formats) {
                const { code, err } = await runYtdlp(['-f', fmt, ...ffArgs, '--no-playlist', '--no-warnings',
                    '--extractor-args', 'youtube:player_client=default,web_safari,android',
                    '-o', path.join(dir, 'video.%(ext)s'), url]);
                if (err.startsWith('SPAWN:')) { res.status(500).json({ error: 'yt-dlp 실행 불가 (설치 필요): ' + err.slice(6) }); return; }
                lastErr = err;
                const files = code === 0 ? (await fs.readdir(dir)).filter(f => !f.endsWith('.part')) : [];
                if (files.length) {
                    const f = files[0];
                    res.setHeader('Content-Type', videoType(path.extname(f).toLowerCase()));
                    res.send(await fs.readFile(path.join(dir, f)));
                    return;
                }
            }
            res.status(500).json({ error: friendlyYtError(lastErr) });
        } catch (e) {
            res.status(500).json({ error: String(e) });
        } finally {
            fs.rm(dir, { recursive: true, force: true }).catch(() => { });
        }
    });
}
