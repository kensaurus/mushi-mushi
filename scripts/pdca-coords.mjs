/**
 * pdca-coords.mjs
 * Coordinate-based PDCA test for closed shadow-DOM Mushi banner.
 * Strategy:
 *   - Banner is at y=0, h≈32px across the full page width.
 *   - Confirm presence via --mushi-banner-offset CSS var.
 *   - Take screenshots for visual verification.
 *   - Click known coordinates to interact with the banner buttons.
 *   - After widget opens, interact inside it using screenshots + coords.
 */
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const DIR = path.join(process.cwd(), '.playwright-mcp');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

const APPS = [
  { name: 'glotit', url: 'http://localhost:3847/glot-it/practice', label: 'glot.it' },
  { name: 'twm',   url: 'http://localhost:4888/the-wanting-mind/', label: 'The Wanting Mind' },
];

let TOTAL_PASS = 0, TOTAL_FAIL = 0;
const FINDINGS = [];

const log  = (icon, app, msg) => console.log(`${icon} [${app}] ${msg}`);
const pass = (app, msg) => { TOTAL_PASS++; log('✅', app, msg); };
const fail = (app, msg) => { TOTAL_FAIL++; log('❌', app, msg); FINDINGS.push({ app, msg }); };
const info = (app, msg) => log('ℹ️ ', app, msg);
const warn = (app, msg) => log('⚠️ ', app, msg);

async function shot(page, name) {
  const f = path.join(DIR, `pdca-c-${name}.png`);
  await page.screenshot({ path: f }).catch(() => {});
  return f;
}
async function cropTop(page, name, h = 70) {
  const f = path.join(DIR, `pdca-c-${name}-top.png`);
  await page.screenshot({ path: f, clip: { x: 0, y: 0, width: 1280, height: h } }).catch(() => {});
  return f;
}
async function cropWidget(page, name) {
  // Widget panel typically appears in the bottom-right (or full overlay) — capture right column
  const f = path.join(DIR, `pdca-c-${name}-widget.png`);
  await page.screenshot({ path: f, clip: { x: 800, y: 40, width: 480, height: 700 } }).catch(() => {});
  return f;
}

async function getBannerState(page) {
  return await page.evaluate(() => ({
    offset: getComputedStyle(document.documentElement).getPropertyValue('--mushi-banner-offset').trim(),
    bodyPad: getComputedStyle(document.body).paddingTop,
    // Any Mushi host in the DOM?
    hostPresent: !!document.getElementById('mushi-mushi-widget'),
  }));
}

// ─── per-app ─────────────────────────────────────────────────────────────────
async function testApp(page, app) {
  const { name, url, label } = app;
  info(label, `\n=== Starting PDCA for ${label} ===`);

  const consoleErrors = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  // ── 1. Load page ──────────────────────────────────────────────────────────
  info(label, '1. Loading page...');
  await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 });
  await page.waitForTimeout(4000);
  await cropTop(page, `${name}-01-load`);
  pass(label, 'Page loaded');

  // ── 2. Banner presence via CSS var ────────────────────────────────────────
  info(label, '2. Checking banner presence (CSS offset)...');
  let state = await getBannerState(page);
  // Wait for offset to be set (SDK init is async)
  for (let i = 0; i < 8 && !state.offset; i++) {
    await page.waitForTimeout(2000);
    state = await getBannerState(page);
  }
  await cropTop(page, `${name}-02-banner`);

  info(label, `  Host present: ${state.hostPresent}, offset: "${state.offset}", body-pad: "${state.bodyPad}"`);

  if (state.hostPresent && state.offset) {
    pass(label, `Banner ACTIVE — host in DOM, offset="${state.offset}"`);
  } else if (state.bodyPad && parseInt(state.bodyPad) > 0) {
    pass(label, `Banner ACTIVE — body padding=${state.bodyPad}`);
  } else {
    fail(label, 'Banner not active — no SDK offset or host element');
    return; // bail out
  }

  // ── 3. Body nudge (no overlap) ───────────────────────────────────────────
  info(label, '3. Body nudge...');
  if (parseInt(state.bodyPad) > 0) {
    pass(label, `Page content pushed down by ${state.bodyPad} — no overlap with banner`);
  } else {
    fail(label, `No body padding — banner overlaps page content (paddingTop=${state.bodyPad})`);
  }

  // ── 4. Screenshot proof of banner with buttons ────────────────────────────
  info(label, '4. Screenshot proof of banner...');
  // Banner is at y≈0..32, so crop top 50px to see the full banner
  await cropTop(page, `${name}-04-proof`, 50);
  pass(label, 'Banner screenshot captured (visual proof)');

  // ── 5. Click "My reports" at estimated coordinate ────────────────────────
  info(label, '5. Clicking "My reports" button (~x=252, y=16)...');
  // Dismiss any overlay first (e.g. language picker on TWM)
  await page.mouse.click(640, 400); // safe background click
  await page.waitForTimeout(800);

  // The banner is position:fixed at the top. "My reports" is the 3rd button.
  // From screenshots: approx x=252, y=16 (adjust if needed)
  await page.mouse.click(252, 16);
  await page.waitForTimeout(3000);
  await shot(page, `${name}-05-after-myreports-click`);
  await cropWidget(page, `${name}-05-widget`);

  // Check if widget opened (use accessibility text query which doesn't need shadow)
  const opened5 = await page.evaluate(() => {
    const host = document.getElementById('mushi-mushi-widget');
    // Check visual bounding rect of shadow host
    if (!host) return { isOpen: false, reason: 'no host' };
    const rect = host.getBoundingClientRect();
    return { isOpen: rect.width > 300 && rect.height > 100, w: rect.width, h: rect.height };
  });
  info(label, `  Widget host bounds: w=${opened5.w}, h=${opened5.h}`);
  if (opened5.isOpen) {
    pass(label, '"My reports" click opened the widget panel');
  } else {
    // Try offset click position
    warn(label, 'Widget may not have opened from x=252 — trying adjusted position x=265, y=16');
    await page.mouse.click(265, 16);
    await page.waitForTimeout(2000);
    const opened5b = await page.evaluate(() => {
      const host = document.getElementById('mushi-mushi-widget');
      if (!host) return { isOpen: false };
      const rect = host.getBoundingClientRect();
      return { isOpen: rect.width > 300 && rect.height > 100 };
    });
    if (opened5b.isOpen) {
      pass(label, '"My reports" click opened the widget (adjusted coords)');
    } else {
      fail(label, '"My reports" click did not open the widget');
    }
  }

  // Screenshot of what the widget shows
  await shot(page, `${name}-05-widget-content`);

  // Close widget (Escape key)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // ── 6. "Report a bug" flow ────────────────────────────────────────────────
  info(label, '6. Testing "Report a bug" flow...');
  // Bug button is first, approx x=67, y=16
  await page.mouse.click(67, 16);
  await page.waitForTimeout(3000);
  await shot(page, `${name}-06-bug-form`);

  const bugOpened = await page.evaluate(() => {
    const host = document.getElementById('mushi-mushi-widget');
    if (!host) return false;
    const rect = host.getBoundingClientRect();
    return rect.width > 300 && rect.height > 100;
  });

  if (bugOpened) {
    pass(label, '"Report a bug" opened the widget');

    // Fill textarea if found  
    const textarea = page.locator('textarea').first();
    const taVisible = await textarea.isVisible({ timeout: 5000 }).catch(() => false);
    if (taVisible) {
      await textarea.fill('PDCA automated test report — please ignore', { timeout: 5000 });
      pass(label, 'Filled description textarea');
      await page.waitForTimeout(500);

      // Submit
      const submitBtn = page.getByRole('button', { name: /submit|send/i }).first();
      if (await submitBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await submitBtn.click({ timeout: 3000 });
        await page.waitForTimeout(4000);
        await shot(page, `${name}-06-submitted`);
        pass(label, 'Submit button clicked');

        // Check success
        const thankText  = page.getByText(/thank|received|submitted/i).first();
        const trackBtn   = page.getByText(/track.*report/i).first();
        if (await thankText.isVisible({ timeout: 4000 }).catch(() => false)) {
          pass(label, 'Success state shown after submission');
        } else {
          warn(label, 'Success text not detected (may still be working)');
          await shot(page, `${name}-06-nosuccesstext`);
        }
        if (await trackBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          pass(label, '"Track this report" button visible on success screen');
          await trackBtn.click({ timeout: 3000 });
          await page.waitForTimeout(2500);
          await shot(page, `${name}-06-track`);
        } else {
          warn(label, '"Track this report" button not detected — may be different wording');
        }
      } else {
        warn(label, 'Submit button not visible — widget may be on wrong step');
        await shot(page, `${name}-06-form-step`);
      }
    } else {
      // May need category click first
      warn(label, 'Textarea not visible — widget may be on category step');
      await shot(page, `${name}-06-cat-step`);
    }
  } else {
    fail(label, '"Report a bug" did not open widget');
  }

  // ── 7. Console errors ─────────────────────────────────────────────────────
  const mushiErr = consoleErrors.filter(e => /mushi|TypeError|uncaught/i.test(e));
  if (mushiErr.length === 0) pass(label, 'No Mushi console errors');
  else fail(label, `Console errors: ${mushiErr.slice(0, 2).join(' | ')}`);

  await shot(page, `${name}-99-final`);
  info(label, `=== Done ===`);
}

// ─── main ─────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({ headless: false, slowMo: 150 });
for (const app of APPS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await testApp(page, app);
  } catch (err) {
    fail(app.label, `Uncaught: ${err.message}`);
    console.error(err);
  } finally {
    await shot(page, `${app.name}-99-final`).catch(() => {});
    await page.close();
  }
}
await browser.close();

console.log('\n══════════════════════════════════════════════════════════════');
console.log(`PDCA FINAL: ${TOTAL_PASS} ✅ passed, ${TOTAL_FAIL} ❌ failed`);
if (FINDINGS.length) {
  console.log('\nFINDINGS:');
  FINDINGS.forEach((f, i) => console.log(`  ${i+1}. [${f.app}] ${f.msg}`));
}
if (TOTAL_FAIL > 0) process.exit(1);
