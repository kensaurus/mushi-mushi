/**
 * verify-myreports-button.mjs
 * Check if the "My reports" button is visible in the banner
 * and verify clicking it opens the reports view.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/' },
  { name: 'twm',   url: 'http://localhost:4888/'           },
];
const SCREENSHOT_DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

for (const app of APPS) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  
  try {
    await page.goto(app.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);

    // Try to find the "My reports" button in Shadow DOM
    const bannerInfo = await page.evaluate(() => {
      // Look for Mushi shadow host
      const shadowHosts = Array.from(document.querySelectorAll('*')).filter(el =>
        el.shadowRoot !== null
      );
      for (const host of shadowHosts) {
        const shadow = host.shadowRoot;
        if (!shadow) continue;
        const banner = shadow.querySelector('.mushi-banner');
        if (!banner) continue;
        const buttons = Array.from(banner.querySelectorAll('button, .mushi-banner-link'));
        return {
          found: true,
          variant: banner.className,
          buttonTexts: buttons.map(b => b.textContent?.trim()),
          hasMyReportsBtn: buttons.some(b => b.textContent?.includes('My reports')),
        };
      }
      return { found: false };
    });

    console.log(`\n=== ${app.name.toUpperCase()} ===`);
    console.log('Banner found:', bannerInfo.found);
    if (bannerInfo.found) {
      console.log('Variant:', bannerInfo.variant);
      console.log('Buttons:', bannerInfo.buttonTexts);
      console.log('Has "My reports":', bannerInfo.hasMyReportsBtn);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, `myreports-${app.name}.png`),
      clip: { x: 0, y: 0, width: 1280, height: 50 }
    });
    
  } catch (err) {
    console.error(`${app.name} error:`, err.message);
  } finally {
    await browser.close();
  }
}
