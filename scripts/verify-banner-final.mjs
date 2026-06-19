/**
 * verify-banner-final.mjs
 * Final verification: clear Mushi localStorage cache, reload, confirm neon banner renders.
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
  // 1. Clear Mushi localStorage cache so new server config is used
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.evaluate(() => {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mushi:')) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    console.log('Cleared mushi keys:', toDelete);
  });

  // 2. Reload to pick up new server config  
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  const pad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  const offset = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
  );
  const lsConfig = await page.evaluate(() => {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.includes('sdk-config')) keys.push(k);
      }
      if (!keys.length) return null;
      return JSON.parse(localStorage.getItem(keys[0]) || 'null');
    } catch { return null; }
  });

  console.log('body padding-top:', pad);
  console.log('--mushi-banner-offset:', offset);
  console.log('New sdk-config launcher:', lsConfig?.config?.widget?.launcher);
  console.log('New sdk-config bannerVariant:', lsConfig?.config?.widget?.bannerVariant);

  // Take top-100px crop
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'banner-final-top100.png'),
    clip: { x: 0, y: 0, width: 1280, height: 100 }
  });
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, 'banner-final-full.png'),
    fullPage: false
  });

  console.log('\nScreenshots saved.');
} catch (err) {
  console.error('Error:', err.message);
} finally {
  await browser.close();
}
