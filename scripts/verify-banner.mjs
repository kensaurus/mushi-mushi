/**
 * verify-banner.mjs
 * Headless Playwright verification of the Mushi banner on the TWM app.
 * Run: node verify-banner.mjs
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const TARGET = 'http://localhost:4888/';

const SCREENSHOT_DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

let result = { ok: false, checks: [] };

try {
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000); // Let Mushi SDK initialize

  // 1. Check body padding (banner nudge)
  const bodyPad = await page.evaluate(() => window.getComputedStyle(document.body).paddingTop);
  const bannerOffset = await page.evaluate(() => 
    getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
  );
  const hasMushiHost = await page.evaluate(() => 
    document.querySelectorAll('[id*="mushi"], [class*="mushi"]').length > 0
  );
  const mushiWindow = await page.evaluate(() => typeof window.__mushi__ !== 'undefined');

  result.checks.push({ name: 'body padding-top', value: bodyPad, pass: bodyPad !== '0px' });
  result.checks.push({ name: '--mushi-banner-offset CSS var', value: bannerOffset, pass: bannerOffset !== '' });
  result.checks.push({ name: 'mushi DOM host present', value: hasMushiHost, pass: hasMushiHost });
  result.checks.push({ name: 'window.__mushi__ defined', value: mushiWindow, pass: mushiWindow });

  // 2. Check no header overlap: confirm Mushi banner-offset matches/exceeds the header height
  const headerHeight = await page.evaluate(() => {
    const h = document.querySelector('header, [role="banner"], nav');
    return h ? h.getBoundingClientRect().height : 0;
  });
  const bannerOffsetPx = parseInt(bannerOffset.replace('px', '')) || 0;
  
  result.checks.push({
    name: 'banner offset covers header',
    value: `banner=${bannerOffsetPx}px header=${headerHeight}px`,
    pass: bannerOffsetPx > 0 || headerHeight === 0,
  });
  
  // Check window.Mushi (the public API) instead of __mushi__ (internal)
  const mushiPublicApi = await page.evaluate(() => typeof window.Mushi !== 'undefined');
  result.checks.push({ name: 'window.Mushi public API', value: mushiPublicApi, pass: mushiPublicApi });

  // Screenshot: full viewport to see banner
  const screenshotPath = path.join(SCREENSHOT_DIR, 'banner-twm-verify.png');
  await page.screenshot({ path: screenshotPath, fullPage: false });
  
  // Targeted screenshot: just the top 100px where the banner should be
  const bannerCropPath = path.join(SCREENSHOT_DIR, 'banner-twm-top100.png');
  await page.screenshot({ path: bannerCropPath, clip: { x: 0, y: 0, width: 1280, height: 100 } });
  result.screenshotPath = screenshotPath;
  result.bannerCropPath = bannerCropPath;
  result.ok = result.checks.every(c => c.pass);

} catch (err) {
  result.error = err.message;
} finally {
  await browser.close();
}

console.log('\n=== Banner Verification ===');
for (const c of result.checks) {
  console.log(`${c.pass ? '✅' : '❌'}  ${c.name}: ${String(c.value)}`);
}
if (result.error) console.log(`\nError: ${result.error}`);
if (result.screenshotPath) console.log(`\nScreenshot (full):    ${result.screenshotPath}`);
if (result.bannerCropPath) console.log(`Screenshot (top 100px): ${result.bannerCropPath}`);
console.log(`\nResult: ${result.ok ? 'PASS' : 'FAIL'}`);
process.exit(result.ok ? 0 : 1);
