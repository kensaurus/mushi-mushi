/**
 * probe-banner-coords.mjs — quick coordinate probe for the Mushi banner buttons.
 * Uses CDP to inject into the shadow root and read getBoundingClientRect.
 */
import { chromium } from 'playwright';

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/practice' },
  { name: 'twm',   url: 'http://localhost:4888/the-wanting-mind/' },
];

const browser = await chromium.launch({ headless: true });

for (const app of APPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(app.url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  // Use page.evaluate with CDP's Runtime.callFunctionOn to access closed shadow
  // Strategy: iterate all elements, find shadow host by id, use internal devtools
  const coords = await page.evaluate(() => {
    const host = document.getElementById('mushi-mushi-widget');
    if (!host) return { error: 'no host' };
    // We can't access host.shadowRoot (it's closed), but we can read host's position
    const hostRect = host.getBoundingClientRect();
    return {
      host: { x: hostRect.x, y: hostRect.y, w: hostRect.width, h: hostRect.height },
    };
  });
  console.log(app.name, 'host coords:', JSON.stringify(coords));

  // Get the CSS variable to confirm banner is active
  const cssState = await page.evaluate(() => ({
    offset: getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim(),
    bodyPad: getComputedStyle(document.body).paddingTop,
  }));
  console.log(app.name, 'css state:', JSON.stringify(cssState));
  await page.close();
}

await browser.close();
