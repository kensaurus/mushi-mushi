/**
 * `_shared/radar/repo-scan.ts` — store-policy facts read from repo files
 * (Capacitor, Expo and bare React Native layouts) and the
 * `storage_sql_delete` scan. A fact that is not found is null, never a
 * guess; comment lines never produce a finding.
 */
import { describe, expect, it } from 'vitest'
import {
  extractRepoFacts,
  isRepoScanPath,
  REPO_SCAN_PATHS,
  scanStorageSqlDelete,
} from '../../supabase/functions/_shared/radar/repo-scan.ts'

// ── fixtures (trimmed copies of real layouts) ────────────────────────────────

const CAPACITOR_VARIABLES = `ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    // targetSdkVersion = 33  (old value, kept for reference)
    targetSdkVersion = 35
    androidxActivityVersion = '1.9.2'
}
`
const CAPACITOR_APP_GRADLE = `apply plugin: 'com.android.application'

android {
    namespace "com.glotit.app"
    compileSdk rootProject.ext.compileSdkVersion
    defaultConfig {
        applicationId "com.glotit.app"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
        versionCode 1102000
        versionName "1.102.0"
    }
}
`
const CAPACITOR_PBXPROJ = `/* Begin XCBuildConfiguration section */
		504EC3171FED79650016851F /* Debug */ = {
			buildSettings = {
				IPHONEOS_DEPLOYMENT_TARGET = 15.0;
				SDKROOT = iphoneos;
			};
		};
		504EC3181FED79650016851F /* Release */ = {
			buildSettings = {
				IPHONEOS_DEPLOYMENT_TARGET = 14.0;
			};
		};
`
const CAPACITOR_WORKFLOW = `name: Build mobile (Capacitor)
on:
  workflow_dispatch:
jobs:
  ios:
    runs-on: macos-15
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      # - uses: maxim-lobanov/setup-xcode@v1 with xcode-version: '15.4'  (old)
      - uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: '26.0'
      - run: npx cap sync ios
`

const RN_ROOT_GRADLE = `buildscript {
    ext {
        buildToolsVersion = "35.0.0"
        minSdkVersion = 24
        compileSdkVersion = 35
        targetSdkVersion = 34
    }
}
`
const RN_APP_GRADLE = `android {
    defaultConfig {
        applicationId "com.yenyen"
        minSdkVersion rootProject.ext.minSdkVersion
        targetSdkVersion rootProject.ext.targetSdkVersion
    }
}
`
const RN_PODFILE = `# platform :ios, '11.0'
platform :ios, '13.4'
target 'YenYen' do
end
`
const RN_WORKFLOW = `jobs:
  ios:
    runs-on: macos-14
    steps:
      - run: xcodebuild -workspace ios/YenYen.xcworkspace
`

const EXPO_APP_JSON = JSON.stringify({
  expo: {
    name: 'Help Her Take Photo',
    platforms: ['ios', 'android'],
    plugins: [
      'expo-router',
      ['expo-build-properties', { android: { targetSdkVersion: 36 }, ios: { deploymentTarget: '15.1' } }],
    ],
  },
})
const EXPO_EAS = JSON.stringify({ build: { production: { ios: { image: 'macos-sequoia-15.5-xcode-16.4' } }, preview: { ios: { image: 'latest' } } } })

describe('extractRepoFacts', () => {
  it('resolves a Capacitor target SDK through variables.gradle and takes the lowest deployment target', () => {
    const facts = extractRepoFacts({
      'android/variables.gradle': CAPACITOR_VARIABLES,
      'android/app/build.gradle': CAPACITOR_APP_GRADLE,
      'ios/App/App.xcodeproj/project.pbxproj': CAPACITOR_PBXPROJ,
      '.github/workflows/build-mobile-capacitor.yml': CAPACITOR_WORKFLOW,
    })
    expect(facts).toEqual({
      androidTargetSdk: 35,
      androidTargetSdkSource: 'android/variables.gradle',
      xcodeMajor: 26,
      xcodeSource: '.github/workflows/build-mobile-capacitor.yml',
      iosDeploymentTarget: '14.0',
      iosDeploymentTargetSource: 'ios/App/App.xcodeproj/project.pbxproj',
      hasAndroid: true,
      hasIos: true,
    })
  })

  it('an explicit Xcode pin beats the runner image; a commented-out pin is ignored', () => {
    const facts = extractRepoFacts({ '.github/workflows/ios.yml': CAPACITOR_WORKFLOW.replace("xcode-version: '26.0'", 'xcode-version: latest-stable') })
    // Only the runner image is left: macos-15 ships Xcode 16 (the commented '15.4' pin does not count).
    expect(facts.xcodeMajor).toBe(16)
  })

  it('reads a bare React Native repo: root ext block, Podfile platform and runner image', () => {
    const facts = extractRepoFacts({
      'android/build.gradle': RN_ROOT_GRADLE,
      'android/app/build.gradle': RN_APP_GRADLE,
      'ios/Podfile': RN_PODFILE,
      '.github/workflows/ios.yml': RN_WORKFLOW,
    })
    expect(facts).toMatchObject({
      androidTargetSdk: 34,
      androidTargetSdkSource: 'android/build.gradle',
      xcodeMajor: 15,
      iosDeploymentTarget: '13.4',
      iosDeploymentTargetSource: 'ios/Podfile',
      hasAndroid: true,
      hasIos: true,
    })
  })

  it('reads an Expo app: expo-build-properties and the EAS image Xcode', () => {
    const facts = extractRepoFacts({ 'app.json': EXPO_APP_JSON, 'eas.json': EXPO_EAS })
    expect(facts).toMatchObject({
      androidTargetSdk: 36,
      androidTargetSdkSource: 'app.json',
      xcodeMajor: 16,
      xcodeSource: 'eas.json',
      iosDeploymentTarget: '15.1',
      hasAndroid: true,
      hasIos: true,
    })
  })

  it('reads expo.android.targetSdkVersion and honours a single-platform Expo app', () => {
    const facts = extractRepoFacts({ 'app.json': JSON.stringify({ expo: { platforms: ['android'], android: { targetSdkVersion: 35 } } }) })
    expect(facts).toMatchObject({ androidTargetSdk: 35, hasAndroid: true, hasIos: false, xcodeMajor: null })
  })

  it('reads targetSdk = N in a Kotlin build script', () => {
    expect(extractRepoFacts({ 'android/app/build.gradle.kts': 'android { defaultConfig { targetSdk = 36 } }' }).androidTargetSdk).toBe(36)
  })

  it('leaves a fact null when it is not there, never guessed', () => {
    const facts = extractRepoFacts({ 'package.json': '{}', 'android/app/build.gradle': 'android { }' })
    expect(facts).toMatchObject({
      androidTargetSdk: null,
      androidTargetSdkSource: null,
      xcodeMajor: null,
      iosDeploymentTarget: null,
      hasAndroid: true,
      hasIos: false,
    })
    expect(extractRepoFacts({ 'app.json': 'not json' })).toMatchObject({ hasAndroid: false, hasIos: false })
  })

  it('does not map macos-latest, which moves', () => {
    expect(extractRepoFacts({ '.github/workflows/ios.yml': 'jobs:\n  b:\n    runs-on: macos-latest\n' }).xcodeMajor).toBeNull()
  })
})

describe('REPO_SCAN_PATHS / isRepoScanPath', () => {
  it('lists the files the readers need and accepts project-named Xcode projects', () => {
    expect(REPO_SCAN_PATHS).toContain('android/variables.gradle')
    expect(REPO_SCAN_PATHS).toContain('.github/workflows/')
    expect(isRepoScanPath('ios/YenYen.xcodeproj/project.pbxproj')).toBe(true)
    expect(isRepoScanPath('./.github/workflows/ci.yml')).toBe(true)
    expect(isRepoScanPath('src/index.ts')).toBe(false)
  })
})

describe('scanStorageSqlDelete', () => {
  it('flags SQL deletes of storage rows with 1-based lines, including a quoted, multi-line form', () => {
    const sql = [
      '-- delete from storage.objects where bucket_id = \'old\';  (comment, ignored)',
      'begin;',
      "DELETE FROM storage.objects WHERE bucket_id = 'avatars';",
      'delete',
      '  from "storage"."objects" where created_at < now() - interval \'30 days\';',
      'truncate table storage.objects;',
      'delete from storage.objects_backup;',
      'commit;',
    ].join('\n')
    const findings = scanStorageSqlDelete('supabase/migrations/20260101_cleanup.sql', sql)
    expect(findings.map((f) => f.line)).toEqual([3, 4, 6])
    for (const f of findings) {
      expect(f).toMatchObject({ ruleId: 'storage_sql_delete', severity: 'warn', filePath: 'supabase/migrations/20260101_cleanup.sql' })
      expect(f.fix).toContain('.remove([')
      expect(f.fix).toContain('https://supabase.com/docs/guides/storage/management/delete-objects')
    }
    expect(findings[0].evidence).toEqual({ snippet: "DELETE FROM storage.objects WHERE bucket_id = 'avatars';" })
  })

  it('skips block comments and trailing SQL comments', () => {
    const sql = "/*\n delete from storage.objects;\n*/\nselect 1; -- delete from storage.objects\nselect '--' as x;\n"
    expect(scanStorageSqlDelete('scripts/cleanup.sql', sql)).toEqual([])
  })

  it('flags SQL inside TypeScript and a client pointed at the storage schema', () => {
    const ts = [
      "import { createClient } from '@supabase/supabase-js'",
      '// await db.query(`delete from storage.objects`)  -- commented out',
      'export async function purge(db, admin) {',
      '  await db.query(`delete from storage.objects where owner = $1`, [id])',
      '  await admin',
      "    .schema('storage')",
      "    .from('objects')",
      '    .delete()',
      "    .eq('bucket_id', 'tmp')",
      "  await admin.from('objects').select('*')",
      '}',
    ].join('\n')
    const findings = scanStorageSqlDelete('scripts/purge.ts', ts)
    expect(findings.map((f) => f.line)).toEqual([4, 7])
    expect(findings[1].message).toContain("'storage' schema")
  })

  it('does not flag the Storage API, a select, or file types it does not scan', () => {
    const ok = "await supabase.storage.from('avatars').remove(['a.png'])\nconst rows = await sql`select * from storage.objects`\n"
    expect(scanStorageSqlDelete('src/cleanup.ts', ok)).toEqual([])
    expect(scanStorageSqlDelete('docs/notes.md', 'delete from storage.objects;')).toEqual([])
  })

  it('skips Python comments', () => {
    const py = "# cur.execute('delete from storage.objects')\ncur.execute(\"DELETE FROM storage.objects WHERE id = %s\", (i,))\n"
    expect(scanStorageSqlDelete('jobs/cleanup.py', py).map((f) => f.line)).toEqual([2])
  })
})

describe('repo-scan-core is shared with the CLI', () => {
  it('the server and CLI copies are byte-identical', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const server = readFileSync(resolve(__dirname, '../../supabase/functions/_shared/radar/repo-scan-core.ts'), 'utf8')
    const cli = readFileSync(resolve(__dirname, '../../../cli/src/radar/repo-scan-core.ts'), 'utf8')
    expect(cli).toBe(server)
  })
})
