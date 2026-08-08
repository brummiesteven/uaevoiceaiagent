import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
const base = process.env.HOME + '/Library/Caches/ms-playwright';
const dir = readdirSync(base).find(d => d.startsWith('chromium-'));
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const ids = ['q1','q2','demo','q2-tools','q3','q4','q5','q6'];
const b = await chromium.launch({ executablePath: exe });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto('http://127.0.0.1:8124/slides.html');
for (const id of ids) {
  await p.evaluate((cur) => document.querySelectorAll('.f').forEach(f => f.classList.toggle('on', f.id === cur)), id);
  await p.waitForTimeout(150);
  await p.screenshot({ path: `frames/${id}.png` });
}
await b.close();
console.log('done');
