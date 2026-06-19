/**
 * verify-banner-twm.mjs
 * Navigate the TWM language picker to see the Mushi banner behind it.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const TARGET = 'http://localhost:4888/';
const SCREENSHOT_DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

try {
  await page.goto(TARGET, { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  const padBefore = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  const offset = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
  );
  console.log('Before dismiss — body padding:', padBefore, ' --mushi-banner-offset:', offset);

  // Try to dismiss the language picker
  const continueBtn = await page.$('button');
  const allButtons = await page.$$eval('button', btns => btns.map(b => b.textContent?.trim()));
  console.log('Buttons on page:', allButtons);

  // Click the button that contains "Continue" or "English"
  const continueText = allButtons.find(t => t && (t.includes('Continue') || t.includes('English')));
  if (continueText) {
    await page.click(`button:has-text("${continueText.slice(0, 20)}")`);
    await page.waitForTimeout(2000);
  }

  const padAfter = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  console.log('After dismiss — body padding:', padAfter);

  // Screenshot of top 100px to see if banner is visible
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'twm-top-after-setup.png'), clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'twm-full-after-setup.png'), fullPage: false });

  // Check if banner is visually at top by pixel-sampling
  const topPixels = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    return null; // Can't easily pixel-sample from JS without drawImage
  });

  console.log('\nScreenshots saved to .playwright-mcp/');
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
