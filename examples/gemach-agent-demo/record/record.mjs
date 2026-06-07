/* Drives the GDEX demo UI and records a video, then converts to mp4 + gif. */
import { chromium } from 'playwright';
import { existsSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.DEMO_URL || 'http://localhost:4317';
const OUT = join(__dirname, 'out');
const SIZE = { width: 1440, height: 900 };

function findFfmpeg() {
  const base = join(os.homedir(), '.cache', 'ms-playwright');
  if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) {
    if (d.startsWith('ffmpeg-')) {
      const p = join(base, d, 'ffmpeg-linux');
      if (existsSync(p)) return p;
    }
  }
  return null;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: SIZE,
    deviceScaleFactor: 2,
    recordVideo: { dir: OUT, size: SIZE },
  });
  const page = await context.newPage();

  console.log('navigating to', URL);
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  // Wait until the backend has signed in (BTC price populated)
  await page.waitForFunction(() => {
    const el = document.querySelector('.chip.price b');
    return el && el.textContent && el.textContent.includes('$') && !el.textContent.includes('$0.00');
  }, undefined, { timeout: 60000 });
  await page.waitForTimeout(2500); // let the dashboard settle for the opening frames

  console.log('starting flow…');
  await page.click('[data-testid="run-demo"]');

  // Wait for the flow to complete
  await page.waitForFunction(() => window.__demoFinished === true, undefined, { timeout: 240000 });
  console.log('flow complete; holding final frame');
  await page.waitForTimeout(4000);

  const video = page.video();
  await context.close(); // flushes the video file
  await browser.close();

  const raw = await video.path();
  const webm = join(OUT, 'gdex-ui-demo.webm');
  if (raw !== webm) renameSync(raw, webm);
  console.log('RAW VIDEO READY:', webm);
}

main().catch((e) => { console.error('record failed:', e); process.exit(1); });
