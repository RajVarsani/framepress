#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';
import ffmpeg from 'ffmpeg-static';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const help = `framepress <url> [options]
  --demo                 Render a bundled art study
  --style ember        ember | indexed | phosphor
  --out clip.mp4         Output path (default: demo.mp4)
  --seconds 6            Duration
  --fps 60               Frames per second (1–120)
  --width 1280 --height 720
  --ready '#canvas'      Wait for a visible element before capture
  --browser /path        Chrome/Chromium executable (or CHROME_PATH)
  --force                Replace an existing output
  --help

Uses installed Chrome. Streams frames into bundled FFmpeg.
Controls main-window requestAnimationFrame and performance.now.
For exact custom rendering expose window.__demoRender(timeInSeconds).
CSS animations, workers, video and native timers are not frame-locked.`;
let browser, encoder, partial;
let cancelled = false;
const cancel = () => { cancelled = true; encoder?.kill('SIGTERM'); void browser?.close(); };
process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
try {
  const { values: v, positionals } = parseArgs({ allowPositionals: true, options: {
    demo: { type: 'boolean' }, style: { type: 'string', default: 'ember' }, out: { type: 'string', default: 'demo.mp4' },
    seconds: { type: 'string', default: '6' }, fps: { type: 'string', default: '60' },
    width: { type: 'string', default: '1280' }, height: { type: 'string', default: '720' },
    ready: { type: 'string' }, browser: { type: 'string' }, force: { type: 'boolean' }, help: { type: 'boolean' },
  }});
  if (v.help) { console.log(help); process.exit(0); }
  const width = Number(v.width), height = Number(v.height), fps = Number(v.fps), seconds = Number(v.seconds);
  if (![width, height, fps].every(Number.isInteger) || width < 2 || height < 2 || width > 7680 || height > 7680 || width % 2 || height % 2 || fps < 1 || fps > 120 || !Number.isFinite(seconds) || seconds <= 0 || seconds > 600) throw Error('Use even dimensions 2–7680, fps 1–120 and duration 0–600 seconds.');
  if ((!v.demo && positionals.length !== 1) || (v.demo && positionals.length)) throw Error(help);
  if (!['indexed', 'phosphor', 'ember'].includes(v.style)) throw Error('Style must be ember, indexed or phosphor.');
  const url = v.demo ? pathToFileURL(fileURLToPath(new URL(`../examples/${v.style}.html`, import.meta.url))).href : new URL(positionals[0]).href;
  if (!['http:', 'https:', 'file:'].includes(new URL(url).protocol)) throw Error('URL must use http, https or file.');
  const out = resolve(v.out);
  if (!out.endsWith('.mp4')) throw Error('Output must end in .mp4');
  let exists = false; try { await access(out); exists = true; } catch {}
  if (exists && !v.force) throw Error(`${out} exists. Choose another path or use --force.`);
  await mkdir(dirname(out), { recursive: true });
  partial = `${out}.${process.pid}.partial.mp4`;
  const start = performance.now();
  const frames = Math.max(1, Math.round(seconds * fps));
  console.log(`\n  ◈  FRAMEPRESS\n  ${width} × ${height} / ${fps} fps / ${frames} frames\n`);
  browser = await chromium.launch({ headless: true, ...(v.browser || process.env.CHROME_PATH ? { executablePath: v.browser || process.env.CHROME_PATH } : { channel: 'chrome' }), args: ['--mute-audio'] });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    let time = 0, next = 0;
    const callbacks = new Map();
    Object.defineProperty(performance, 'now', { value: () => time });
    window.requestAnimationFrame = callback => { callbacks.set(++next, callback); return next; };
    window.cancelAnimationFrame = id => callbacks.delete(id);
    window.__recorderStep = async ms => {
      time = ms;
      if (typeof window.__demoRender === 'function') await window.__demoRender(ms / 1000);
      else { const batch = [...callbacks.values()]; callbacks.clear(); for (const callback of batch) callback(ms); }
    };
  });
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // Prime applications that create their canvas inside the first animation frame.
  await page.evaluate(() => window.__recorderStep(0));
  if (v.ready) await page.locator(v.ready).waitFor({ state: 'visible', timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  if (errors.length) throw Error(errors.join('\n'));
  const cdp = await page.context().newCDPSession(page);
  encoder = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-framerate', String(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', partial], { stdio: ['pipe', 'ignore', 'pipe'] });
  let encodingError = ''; encoder.stderr.on('data', b => { encodingError = (encodingError + b).slice(-4000); });
  encoder.stdin.on('error', () => {});
  const encoded = new Promise((res, rej) => { encoder.once('error', rej); encoder.once('close', code => code === 0 ? res() : rej(Error(`FFmpeg exited ${code}: ${encodingError}`))); });
  // Attach immediately so an early encoder failure cannot become an unhandled rejection.
  encoded.catch(() => {});
  for (let i = 0; i < frames; i++) {
    if (cancelled) throw Error('Recording cancelled.');
    if (encoder.exitCode !== null) throw Error(`FFmpeg stopped: ${encodingError}`);
    await page.evaluate(ms => window.__recorderStep(ms), i * 1000 / fps);
    if (errors.length) throw Error(errors.join('\n'));
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 96, fromSurface: true });
    if (!encoder.stdin.write(Buffer.from(data, 'base64'))) await Promise.race([once(encoder.stdin, 'drain'), encoded.then(() => { throw Error('Encoder ended before all frames were written.'); })]);
    if (i % 30 === 0 || i === frames - 1) process.stdout.write(`\r  ${'━'.repeat(Math.floor((i + 1) / frames * 24)).padEnd(24, '─')}  ${Math.round((i + 1) / frames * 100)}%`);
  }
  encoder.stdin.end(); await encoded;
  await rename(partial, out); partial = undefined;
  const elapsed = (performance.now() - start) / 1000;
  console.log(`\n\n  ✓ ${out}\n  ${(frames / elapsed).toFixed(1)} render fps · ${elapsed.toFixed(1)}s elapsed · ${(frames / fps).toFixed(2)}s video\n`);
} catch (e) { console.error(`\n  ${e.message}`); process.exitCode = 1; }
finally {
  encoder?.kill('SIGTERM'); await browser?.close().catch(() => {});
  if (partial) await rm(partial, { force: true });
  process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel);
}
