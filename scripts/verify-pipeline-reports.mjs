#!/usr/bin/env node
/**
 * verify-pipeline-reports.mjs
 * Submit test reports to each Mushi project and print the resulting report IDs
 * for DB verification of reporter identity, screenshot_url, and sdk_version.
 */
import fs from 'fs';
import crypto from 'crypto';

const API_BASE = 'https://dxptnwrhwsqckaftyymj.supabase.co/functions/v1/api';

function readEnvKey(file, key) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(new RegExp(`^${key}=(.+)$`, 'm'));
    return match ? match[1].replace(/['"]/g, '').trim() : null;
  } catch { return null; }
}

const apps = [
  {
    name: 'glot.it',
    keyFile: 'C:/Users/kensa/Documents/GitHub/glot.it/.env.local',
    keyVar: 'NEXT_PUBLIC_MUSHI_API_KEY',
    projectId: '542b34e0-019e-41fe-b900-7b637717bb86',
    userId: `playwright-glotit-${Date.now()}`,
    userName: 'Playwright glot.it',
    url: 'http://localhost:3847/glot-it/',
  },
  {
    name: 'the-wanting-mind',
    keyFile: 'C:/Users/kensa/Documents/GitHub/the-wanting-mind/.env',
    keyVar: 'VITE_MUSHI_API_KEY',
    projectId: '2ac49170-e89a-4d82-a982-bcbda1d3244d',
    userId: `playwright-twm-${Date.now()}`,
    userName: 'Playwright TWM',
    url: 'http://localhost:4888/the-wanting-mind/',
  },
  {
    name: 'yen-yen',
    keyFile: 'C:/Users/kensa/Documents/GitHub/yen-yen/.env',
    keyVar: 'EXPO_PUBLIC_MUSHI_API_KEY',
    projectId: '6e7e0c3a-a777-4f1e-a699-6515993cf3bd',
    userId: `playwright-yenyen-${Date.now()}`,
    userName: 'Playwright yen-yen',
    url: 'mushi://yen-yen-app',
  },
  {
    name: 'hhtp',
    keyFile: 'C:/Users/kensa/Documents/GitHub/help-her-take-photo/.env.local',
    keyVar: 'EXPO_PUBLIC_MUSHI_API_KEY',
    projectId: 'e4523271-f609-465f-8b27-00199b39f050',
    userId: `playwright-hhtp-${Date.now()}`,
    userName: 'Playwright HHTP',
    url: 'http://localhost:5173/',
  },
];

async function submitReport(app) {
  const apiKey = readEnvKey(app.keyFile, app.keyVar);
  if (!apiKey) {
    console.log(`⚠️   ${app.name}: no API key in ${app.keyFile} (${app.keyVar}) — skipping`);
    return null;
  }

  const reporterToken = `mushi_playwright_${crypto.randomBytes(8).toString('hex')}`;
  const body = {
    projectId: app.projectId,
    category: 'other',
    description: `Playwright pipeline verification: banner height offset fix + screenshot taint fix + reporter identity wiring (${app.name})`,
    userCategory: 'other',
    reporterToken,
    environment: {
      userAgent: 'Mozilla/5.0 (compatible; Playwright/verify-all)',
      platform: 'web',
      language: 'en',
      viewport: { width: 1280, height: 720 },
      url: app.url,
      referrer: '',
      timestamp: new Date().toISOString(),
      timezone: 'Asia/Tokyo',
    },
    createdAt: new Date().toISOString(),
    sdkPackage: '@mushi-mushi/web',
    sdkVersion: '1.17.0',
    metadata: {
      user: {
        id: app.userId,
        name: app.userName,
        email: `${app.userId}@playwright.local`,
      },
      playwright_verify: true,
      verified_at: new Date().toISOString(),
    },
  };

  try {
    const resp = await fetch(`${API_BASE}/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Mushi-Api-Key': apiKey,
      },
      body: JSON.stringify(body),
    });
    const json = await resp.json();
    if (json.ok || json.data?.reportId || json.reportId) {
      const id = json.data?.reportId ?? json.data?.id ?? json.reportId ?? 'unknown';
      console.log(`✅  ${app.name}: HTTP ${resp.status}  report_id=${id}`);
      return id;
    } else {
      console.log(`❌  ${app.name}: HTTP ${resp.status}  error=${JSON.stringify(json.error)}`);
      return null;
    }
  } catch (err) {
    console.log(`❌  ${app.name}: fetch error: ${err.message}`);
    return null;
  }
}

const ids = await Promise.all(apps.map(submitReport));
console.log('\nReport IDs:', ids.filter(Boolean).join(', '));
