// Records an animated demo of Localize Extractor.
//
// Flow: render the mock UI screenshot -> upload it -> wait for OCR ->
// click words to generate keys -> group a phrase -> show the JSON output.
// Playwright captures a .webm video, which record-demo.sh converts to a GIF.
//
// Prereq: the frontend dev server must be running (default http://localhost:5173).
// The backend/Ollama are optional — without them the app falls back to local
// key generation, which is fine for the demo.

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_URL = process.env.APP_URL || 'http://localhost:5173';
const OUT_DIR = join(__dirname, 'recording');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();

// 1. Turn the HTML mock into a PNG screenshot to feed the app.
const mockPage = await context.newPage();
await mockPage.goto('file://' + join(__dirname, 'sample-ui.html'));
const sampleBuffer = await mockPage.locator('.screen').screenshot();
await mockPage.close();

// 2. Open the app and upload the sample screenshot.
await page.goto(APP_URL);
await sleep(1200);
await page.setInputFiles('#file-upload-main', {
  name: 'login-screen.png',
  mimeType: 'image/png',
  buffer: sampleBuffer,
});

// 3. Wait for Tesseract OCR to finish (word boxes appear).
await page.waitForSelector('.word-box', { timeout: 60000 });
await sleep(1500);

// 4. Click a few individual words — each generates a localization key.
const boxes = page.locator('.word-box');
const total = await boxes.count();
const pickCount = Math.min(4, total);
for (let i = 0; i < pickCount; i++) {
  const idx = Math.floor((i + 0.5) * (total / pickCount));
  await boxes.nth(Math.min(idx, total - 1)).click();
  await sleep(1400);
}

// 5. Show the populated JSON output for a beat.
await page.locator('.json-editor').scrollIntoViewIfNeeded();
await sleep(2500);

await context.close(); // finalizes the video
await browser.close();
console.log('Recording saved to', OUT_DIR);
