/**
 * normalizeSdkConfig / coerceSdkConfigUpdate — pure logic, mirrors sdk-config.ts.
 * Run: cd packages/server && deno test supabase/functions/_shared/sdk-config.test.ts
 *
 * This is the parity/regression test for the normalizeSdkConfig split-brain
 * incident: routes/public.ts and api/helpers.ts used to carry two different
 * implementations (see sdk-config.ts file header). These tests pin the
 * merged behavior so a future edit can't silently reintroduce either half
 * of that regression — in particular the missing `reporterNotificationsEnabled`
 * emission, which meant disabling reporter notifications in the console had
 * zero effect on the live SDK.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts'
import { coerceSdkConfigUpdate, normalizeSdkConfig, type SdkConfigRow } from './sdk-config.ts'

Deno.test('normalizeSdkConfig — null row yields all-default, explicit-only-empty shape', () => {
  const result = normalizeSdkConfig(null)
  assertEquals(result.enabled, true)
  assertEquals(result.version, null)
  // Explicit-only emission: nothing set → widget/capture carry no keys at all,
  // so the SDK's runtime merge never clobbers host-wired config.
  assertEquals(result.widget, {})
  assertEquals(result.capture, {})
  assertEquals(result.native, { triggerMode: 'both', minDescriptionLength: 20 })
  assertEquals(result.reporterNotificationsEnabled, true)
  assertEquals(result.assistant, { enabled: false, label: 'Ask', greeting: null, suggestions: [] })
})

Deno.test('normalizeSdkConfig — values equal to the column default are still omitted', () => {
  const row: SdkConfigRow = {
    sdk_widget_position: 'bottom-right',
    sdk_widget_theme: 'auto',
    sdk_widget_launcher: 'auto',
    sdk_banner_variant: 'brand',
    sdk_banner_position: 'top',
    sdk_capture_console: true,
    sdk_capture_network: true,
    sdk_capture_performance: false,
    sdk_capture_screenshot: 'on-report',
    sdk_capture_element_selector: false,
  }
  const result = normalizeSdkConfig(row)
  assertEquals(result.widget, {})
  assertEquals(result.capture, {})
})

Deno.test('normalizeSdkConfig — non-default values are emitted explicitly', () => {
  const row: SdkConfigRow = {
    sdk_widget_position: 'top-left',
    sdk_widget_launcher: 'banner',
    sdk_capture_console: false,
    sdk_capture_element_selector: true,
    sdk_capture_screenshot: 'off',
  }
  const result = normalizeSdkConfig(row)
  assertEquals(result.widget.position, 'top-left')
  assertEquals(result.widget.launcher, 'banner')
  assertEquals(result.capture.console, false)
  assertEquals(result.capture.elementSelector, true)
  assertEquals(result.capture.screenshot, 'off')
})

Deno.test('normalizeSdkConfig — reporterNotificationsEnabled reflects the DB column (regression pin)', () => {
  assertEquals(normalizeSdkConfig({ reporter_notifications_enabled: false }).reporterNotificationsEnabled, false)
  assertEquals(normalizeSdkConfig({ reporter_notifications_enabled: true }).reporterNotificationsEnabled, true)
  assertEquals(normalizeSdkConfig({}).reporterNotificationsEnabled, true)
})

Deno.test('normalizeSdkConfig — screenshotSensitiveHint: unset omitted, empty string maps to false', () => {
  assertEquals(normalizeSdkConfig({}).widget.screenshotSensitiveHint, undefined)
  assertEquals(normalizeSdkConfig({ sdk_screenshot_sensitive_hint: '' }).widget.screenshotSensitiveHint, false)
  assertEquals(
    normalizeSdkConfig({ sdk_screenshot_sensitive_hint: 'Careful, this is a demo account' }).widget
      .screenshotSensitiveHint,
    'Careful, this is a demo account',
  )
})

Deno.test('normalizeSdkConfig — assistant block reflects project_settings columns and truncates', () => {
  const result = normalizeSdkConfig({
    assistant_enabled: true,
    assistant_label: '  Support Bot  ',
    assistant_greeting: 'x'.repeat(500),
    assistant_suggestions: ['  How do I reset my password?  ', '', 42, 'Where is billing?'],
  })
  assertEquals(result.assistant.enabled, true)
  assertEquals(result.assistant.label, 'Support Bot')
  assertEquals(result.assistant.greeting?.length, 400)
  assertEquals(result.assistant.suggestions, ['How do I reset my password?', 'Where is billing?'])
})

Deno.test('coerceSdkConfigUpdate — accepts valid enum values and rejects invalid ones', () => {
  const updates = coerceSdkConfigUpdate({
    widget: { position: 'top-left', theme: 'not-a-real-theme' },
    capture: { elementSelector: true, screenshot: 'auto' },
  })
  assertEquals(updates.sdk_widget_position, 'top-left')
  assertEquals('sdk_widget_theme' in updates, false)
  assertEquals(updates.sdk_capture_element_selector, true)
  assertEquals(updates.sdk_capture_screenshot, 'auto')
})

Deno.test('coerceSdkConfigUpdate — clamps minDescriptionLength to [0, 1000]', () => {
  assertEquals(coerceSdkConfigUpdate({ native: { minDescriptionLength: 5000 } }).sdk_min_description_length, 1000)
  assertEquals(coerceSdkConfigUpdate({ native: { minDescriptionLength: -50 } }).sdk_min_description_length, 0)
  assertEquals(coerceSdkConfigUpdate({ native: { minDescriptionLength: 42 } }).sdk_min_description_length, 42)
})

Deno.test('coerceSdkConfigUpdate — screenshotSensitiveHint boolean/string/null mapping', () => {
  assertEquals(
    coerceSdkConfigUpdate({ widget: { screenshotSensitiveHint: true } }).sdk_screenshot_sensitive_hint,
    null,
  )
  assertEquals(coerceSdkConfigUpdate({ widget: { screenshotSensitiveHint: false } }).sdk_screenshot_sensitive_hint, '')
  assertEquals(
    coerceSdkConfigUpdate({ widget: { screenshotSensitiveHint: 'Custom caption' } }).sdk_screenshot_sensitive_hint,
    'Custom caption',
  )
  assertEquals(
    coerceSdkConfigUpdate({ widget: { screenshotSensitiveHint: null } }).sdk_screenshot_sensitive_hint,
    null,
  )
})
