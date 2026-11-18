// Records a clean demo video of the running demo page (npm run demo must be up).
// Usage: node demo/record.mjs [outDir]  -> writes a .webm into outDir
import { chromium } from 'playwright';

const outDir = process.argv[2] ?? '.';
const size = { width: 1280, height: 800 };
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: 1, colorScheme: 'light', recordVideo: { dir: outDir, size } });
const page = await ctx.newPage();
const pause = (ms) => page.waitForTimeout(ms);
const waitResult = () => page.waitForSelector('#out .status', { timeout: 180_000 });

await page.goto('http://localhost:4321');
await page.waitForSelector('#pick option', { state: 'attached' });
await page.selectOption('#pick', 'case-004');
await page.waitForFunction(() => document.querySelector('#inv').value.includes('Tirupur'));
await pause(3000);

// 1. A clean shipment: should pass with no false alarm.
await page.hover('#go');
await pause(500);
await page.click('#go');
await waitResult();
await pause(3500);

// 2. Change one quantity on the invoice (60 -> 66) so the line no longer adds up.
await page.evaluate(() => {
    const ta = document.querySelector('#inv');
    const i = ta.value.indexOf('     60 PCS') + 5;
    ta.focus();
    ta.setSelectionRange(i, i + 2);
    ta.scrollTop = 0;
});
await pause(800);
await page.keyboard.type('66', { delay: 250 });
await pause(1500);
await page.hover('#go');
await pause(500);
await page.click('#go');
await waitResult();
await pause(4000);

// 3. Show the keyed entry, then back to the verdict.
await page.mouse.move(900, 500);
await page.mouse.wheel(0, 450);
await pause(3000);
await page.mouse.wheel(0, -450);
await pause(2500);

const video = page.video();
await ctx.close();
await browser.close();
console.log(await video.path());
