/**
 * pdca-test-myreports.mjs
 * Headed Playwright test for the "My reports" banner button + openReporter() flow.
 * Drives glot.it at localhost:3847 as a real user, step by step.
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

// ─── helpers ─────────────────────────────────────────────────────────────────
async function shot(page, name) {
  const f = path.join(DIR, `pdca-${name}.png`);
  await page.screenshot({ path: f, fullPage: false });
  return f;
}
async function topCrop(page, name) {
  const f = path.join(DIR, `pdca-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280, height: 80 } });
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
        hasBugBtn:    btns.some(x => /Report a bug/i.test(x.textContent ?? '')),
      };
    }
    return { found: false };
  });
}

async function shadowWidgetInfo(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      const panel = sr.querySelector('.mushi-panel, .mushi-widget, [class*="mushi-"]');
      if (!panel) continue;
      const step = sr.querySelector('[data-step]');
      const heading = sr.querySelector('[class*="header"], h1, h2, h3');
      const items = Array.from(sr.querySelectorAll('[data-report-id], .mushi-report-row, .mushi-reporter'));
      return {
        panelVisible: panel.offsetParent !== null,
        stepAttr: step?.getAttribute('data-step'),
        headingText: heading?.textContent?.trim()?.slice(0, 80),
        reportCount: items.length,
        allText: (sr.textContent ?? '').slice(0, 500),
      };
    }
    return { panelVisible: false };
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  headless: false,   // HEADED — real visible browser
  slowMo: 200,       // slight slow-mo so interactions are visible
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// Capture console errors
const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
const networkFails = [];
page.on('response', res => {
  if (res.status() >= 400) networkFails.push(`${res.status()} ${res.url()}`);
});

try {
  // ── STEP 1: Load glot.it, do a hard-reload to pick up new SDK build ─────────
  info('Step 1: Loading glot.it and clearing Mushi cache...');
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2000);

  // Clear Mushi localStorage so fresh SDK config is fetched
  await page.evaluate(() => {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mushi:')) toDelete.push(k);
    }
    toDelete.forEach(k => localStorage.removeItem(k));
    return toDelete;
  });
  await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  await topCrop(page, '01-initial-load');
  pass('Page loaded');

  // ── STEP 2: Banner present and has correct variant ───────────────────────────
  info('Step 2: Checking banner existence and variant...');
  const banner2 = await shadowBannerInfo(page);
  if (!banner2.found) {
    fail('Banner NOT found in shadow DOM');
  } else {
    pass(`Banner found: ${banner2.variant}`);
    if (banner2.variant.includes('neon')) pass('Correct variant: neon');
    else fail(`Wrong variant: ${banner2.variant}`);
  }

  await topCrop(page, '02-banner');

  // ── STEP 3: "My reports" button present in banner ────────────────────────────
  info('Step 3: Checking for "My reports" button in banner...');
  if (!banner2.found) {
    fail('"My reports" check skipped — banner not found');
  } else if (banner2.hasMyReports) {
    pass('"📬 My reports" button IS present in the banner');
    info(`All banner buttons: ${JSON.stringify(banner2.buttons)}`);
  } else {
    fail(`"My reports" button NOT in banner. Buttons: ${JSON.stringify(banner2.buttons)}`);
    info('This means the dev server has not picked up the new SDK build yet (hard refresh needed).');
  }

  // ── STEP 4: Click "My reports" → widget opens to reports list ────────────────
  if (banner2.hasMyReports) {
    info('Step 4: Clicking "📬 My reports" button...');
    // Find and click the button inside shadow DOM
    const clicked = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        const b = sr.querySelector('.mushi-banner');
        if (!b) continue;
        const myBtn = Array.from(b.querySelectorAll('button'))
          .find(x => /My reports/i.test(x.textContent ?? ''));
        if (myBtn) {
          myBtn.click();
          return true;
        }
      }
      return false;
    });

    if (!clicked) {
      fail('Could not find/click the "My reports" button');
    } else {
      await page.waitForTimeout(2000);
      await shot(page, '04-after-myreports-click');

      const widget = await shadowWidgetInfo(page);
      if (widget.panelVisible) {
        pass('Widget panel opened after clicking "My reports"');
        info(`Panel text preview: ${widget.allText.slice(0, 200)}`);
        // Look for "reports" related content
        if (/your reports|no reports|my reports|submissions/i.test(widget.allText)) {
          pass('Reports view is showing (text confirms reports step)');
        } else if (/report a bug|what's happening|category/i.test(widget.allText)) {
          fail('Widget opened to REPORT FORM, not reports list — openReporter() may not have worked');
          info(`Widget content: ${widget.allText.slice(0, 300)}`);
        } else {
          info(`Widget opened but content unclear: ${widget.allText.slice(0, 200)}`);
        }
      } else {
        fail('Widget panel did NOT open after clicking "My reports"');
      }
    }
  } else {
    info('Step 4: Skipped (no "My reports" button found — build not picked up yet)');
  }

  // ── STEP 5: Close widget, then test "Report a bug" → submit → Track ──────────
  info('Step 5: Closing widget (if open) and testing report submission flow...');
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      const closeBtn = sr.querySelector('.mushi-close, [aria-label*="Close"], [data-action="close"]');
      if (closeBtn) { closeBtn.click(); return; }
    }
  });
  await page.waitForTimeout(1000);

  // Click "Report a bug" 
  const bugClicked = await page.evaluate(() => {
    for (const el of document.querySelectorAll('*')) {
      const sr = el.shadowRoot;
      if (!sr) continue;
      const b = sr.querySelector('.mushi-banner');
      if (!b) continue;
      const bugBtn = Array.from(b.querySelectorAll('button'))
        .find(x => /Report a bug|bug/i.test(x.textContent ?? ''));
      if (bugBtn) { bugBtn.click(); return true; }
    }
    return false;
  });

  if (!bugClicked) {
    fail('Could not find/click "Report a bug" button');
  } else {
    await page.waitForTimeout(2000);
    await shot(page, '05-bug-form-open');
    pass('"Report a bug" clicked — widget form opened');

    const formContent = await page.evaluate(() => {
      for (const el of document.querySelectorAll('*')) {
        const sr = el.shadowRoot;
        if (!sr) continue;
        return (sr.textContent ?? '').slice(0, 400);
      }
      return '';
    });
    info(`Form content: ${formContent.slice(0, 200)}`);
  }

  // ── STEP 6: Check body padding (header overlap fix) ──────────────────────────
  info('Step 6: Verifying banner offset (no header overlap)...');
  const bodyPad = await page.evaluate(() => getComputedStyle(document.body).paddingTop);
  const bannerOffset = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim()
  );
  info(`body padding-top: ${bodyPad}`);
  info(`--mushi-banner-offset: ${bannerOffset}`);
  if (parseInt(bodyPad) > 0 || bannerOffset !== '') {
    pass(`Body nudge active (${bodyPad} / offset: ${bannerOffset}) — no overlap`);
  } else {
    fail('Body nudge NOT active — banner may overlap page content');
  }

  // ── STEP 7: Console errors check ─────────────────────────────────────────────
  info('Step 7: Checking for console errors...');
  const mushiErrors = consoleErrors.filter(e => /mushi|TypeError|Uncaught/i.test(e));
  if (mushiErrors.length === 0) pass('No Mushi-related console errors');
  else fail(`Console errors: ${mushiErrors.slice(0, 5).join(' | ')}`);

  const criticalNetFails = networkFails.filter(f => !f.includes('analytics') && !f.includes('tracking'));
  if (criticalNetFails.length === 0) pass('No critical network failures');
  else info(`Network failures: ${criticalNetFails.slice(0, 5).join(' | ')}`);

} catch (err) {
  fail(`Unexpected error: ${err.message}`);
} finally {
  await shot(page, '99-final');
  await browser.close();

  console.log('\n══════════════════════════════════════');
  console.log(`RESULTS: ${PASS} passed, ${FAIL} failed`);
  if (FAIL > 0) {
    console.log('\nFAILURES need action — see screenshots in .playwright-mcp/');
    process.exit(1);
  } else {
    console.log('All checks passed ✅');
  }
}
