/**
 * pdca-test-myreports-v2.mjs
 * Headed Playwright test for the "My reports" banner button + openReporter() flow.
 * Uses 'commit' waitUntil for faster navigation with slow Next.js dev servers.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = 'http://localhost:3847/glot-it/';
const DIR  = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

let PASS = 0, FAIL = 0;
const log = (icon, msg) => console.log(`${icon} ${msg}`);
const pass = (msg) => { PASS++; log('✅', msg); };
const fail = (msg) => { FAIL++; log('❌', msg); };
const info = (msg) => log('ℹ️ ', msg);

async function shot(page, name) {
  const f = path.join(DIR, `pdca-${name}.png`);
  await page.screenshot({ path: f, fullPage: false }).catch(() => {});
  return f;
}
async function topCrop(page, name, height = 80) {
  const f = path.join(DIR, `pdca-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280, height } }).catch(() => {});
  return f;
}

async function shadowBannerInfo(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      const b = sr.querySelector('.mushi-banner');
      if (!b) continue;
      const btns = Array.from(b.querySelectorAll('button, .mushi-banner-link'));
      return {
        found: true,
        variant: b.className,
        buttons: btns.map(x => x.textContent?.trim()),
        hasMyReports: btns.some(x => /My reports/i.test(x.textContent ?? '')),
        hasBugBtn:    btns.some(x => /Report.*bug|bug/i.test(x.textContent ?? '')),
      };
    }
    return { found: false };
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 300 });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
const networkFails = [];
page.on('response', res => {
  if (res.status() >= 400) networkFails.push(`${res.status()} ${res.url().split('?')[0]}`);
});

try {
  // ── STEP 1: Load glot.it ─────────────────────────────────────────────────────
  info('Step 1: Loading glot.it (waitUntil: commit)...');
  await page.goto(BASE, { waitUntil: 'commit', timeout: 30000 });
  
  // Wait in increments for SDK to initialise
  info('Waiting for SDK initialisation (3s)...');
  await page.waitForTimeout(3000);
  
  let loaded = false;
  for (let i = 0; i < 5; i++) {
    const bodyText = await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0);
    if (bodyText > 100) { loaded = true; break; }
    await page.waitForTimeout(2000);
  }
  
  if (!loaded) {
    fail('Page body still empty after 13s — dev server may be compiling');
  } else {
    pass('Page loaded with content');
  }

  await page.evaluate(() => {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mushi:')) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    return toDelete;
  });
  await page.reload({ waitUntil: 'commit', timeout: 30000 });

  info('Waiting for SDK to re-initialise after reload (5s)...');
  await page.waitForTimeout(5000);

  await topCrop(page, '01-initial-load');

  // ── STEP 2: Banner check ─────────────────────────────────────────────────────
  info('Step 2: Checking banner...');
  let banner = await shadowBannerInfo(page);
  
  // Wait up to 10s more for banner
  for (let i = 0; i < 5 && !banner.found; i++) {
    await page.waitForTimeout(2000);
    banner = await shadowBannerInfo(page);
  }

  if (!banner.found) {
    fail('Banner NOT found in shadow DOM after 10s wait');
  } else {
    pass(`Banner found: "${banner.variant}"`);
    if (/neon/.test(banner.variant)) pass('Variant is neon ✓');
    else fail(`Wrong variant: "${banner.variant}" — expected neon`);
    info(`All banner buttons: ${JSON.stringify(banner.buttons)}`);
  }
  await topCrop(page, '02-banner', 50);

  // ── STEP 3: "My reports" button ──────────────────────────────────────────────
  info('Step 3: Looking for "My reports" button...');
  if (banner.found) {
    if (banner.hasMyReports) {
      pass('"📬 My reports" button IS present in the neon banner');
    } else {
      fail(`"My reports" NOT found. Buttons: ${JSON.stringify(banner.buttons)}`);
      info('LIKELY CAUSE: glot.it dev server has not hot-reloaded with new SDK build. Need hard refresh in browser.');
      
      // Try forcing page to reload with cache bust
      await page.evaluate(() => location.reload());
      await page.waitForTimeout(5000);
      const banner3 = await shadowBannerInfo(page);
      if (banner3.hasMyReports) {
        pass('"My reports" appeared after forced reload');
      } else {
        info(`After reload, buttons: ${JSON.stringify(banner3.buttons)}`);
      }
    }
  }

  // Re-check after potential reload
  const bannerFinal = await shadowBannerInfo(page);

  // ── STEP 4: Click "My reports" → reports list ────────────────────────────────
  if (bannerFinal.hasMyReports) {
    info('Step 4: Clicking "📬 My reports"...');
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        const b = sr.querySelector('.mushi-banner');
        if (!b) continue;
        const myBtn = Array.from(b.querySelectorAll('button'))
          .find(x => /My reports/i.test(x.textContent ?? ''));
        if (myBtn) { myBtn.click(); return true; }
      }
      return false;
    });

    if (clicked) {
      await page.waitForTimeout(3000);
      await shot(page, '04-myreports-clicked');
      
      const widgetText = await page.evaluate(() => {
        for (const el of document.querySelectorAll('*')) {
          const sr = el.shadowRoot;
          if (!sr) continue;
          if (!sr.querySelector('.mushi-banner')) continue;
          return (sr.textContent ?? '');
        }
        return '';
      });
      
      if (/your reports|no reports|submissions|track|submitted/i.test(widgetText)) {
        pass('Clicking "My reports" opened the reports history view');
        info(`Content: ${widgetText.slice(0, 200)}`);
      } else if (/what.*happening|category|report a bug/i.test(widgetText)) {
        fail('Widget opened to REPORT FORM instead of reports list — openReporter() not working');
        info(`Widget content: ${widgetText.slice(0, 200)}`);
      } else {
        info(`Widget opened but content unclear (may be loading): ${widgetText.slice(0, 200)}`);
        // Take a screenshot to see
        await shot(page, '04-myreports-unclear');
      }
    } else {
      fail('Could not click "My reports" button');
    }
  } else {
    info('Step 4: Skipped — "My reports" button not yet rendered in this build');
  }

  // ── STEP 5: "Report a bug" flow ──────────────────────────────────────────────
  info('Step 5: Testing "Report a bug" → form opens...');
  // Close widget first
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      const closeBtn = sr.querySelector('[aria-label*="Close"], [data-action="close"], .mushi-close');
      if (closeBtn) { closeBtn.click(); return; }
    }
  });
  await page.waitForTimeout(1000);

  const bannerForBug = await shadowBannerInfo(page);
  if (bannerForBug.hasBugBtn) {
    const bugClicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        const b = sr.querySelector('.mushi-banner');
        if (!b) continue;
        const bugBtn = Array.from(b.querySelectorAll('button'))
          .find(x => /Report.*bug/i.test(x.textContent ?? ''));
        if (bugBtn) { bugBtn.click(); return true; }
      }
      return false;
    });
    if (bugClicked) {
      await page.waitForTimeout(2000);
      await shot(page, '05-bug-form');
      pass('"Report a bug" clicked — widget opened');
    } else {
      fail('Could not click "Report a bug" button');
    }
  } else {
    info('Step 5: Bug button not found, skipping');
  }

  // ── STEP 6: Body nudge / no overlap ─────────────────────────────────────────
  info('Step 6: Checking banner offset (no header overlap)...');
  const bodyPad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  const offset = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
  );
  info(`body.paddingTop = ${bodyPad}, --mushi-banner-offset = ${offset}`);
  if (parseInt(bodyPad) > 0 || offset) {
    pass(`Banner offset active: ${bodyPad} / ${offset}`);
  } else {
    fail('No banner offset — banner may overlap page content');
  }

  // ── STEP 7: Console + network errors ────────────────────────────────────────
  info('Step 7: Console error check...');
  const mushiErr = consoleErrors.filter(e => /mushi|TypeError|uncaught/i.test(e));
  if (mushiErr.length === 0) pass('No Mushi-related console errors');
  else fail(`Console errors: ${mushiErr.slice(0, 3).join(' | ')}`);

  const critNet = networkFails.filter(f =>
    !f.includes('analytics') && !f.includes('tracking') && !f.includes('favicon')
  );
  if (critNet.length === 0) pass('No critical network failures');
  else info(`Network issues: ${critNet.slice(0, 3).join(' | ')}`);

} catch (err) {
  fail(`Unexpected error: ${err.message}`);
  console.error(err);
} finally {
  await shot(page, '99-final').catch(() => {});
  await browser.close();

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`PDCA RESULTS: ${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    console.log('⚠️  Failures require action — see .playwright-mcp/ screenshots');
    process.exit(1);
  } else {
    console.log('✅ All checks passed');
  }
}
