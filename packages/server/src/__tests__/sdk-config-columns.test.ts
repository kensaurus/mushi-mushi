/**
 * The console's GET/PUT `/v1/admin/projects/:id/sdk-config` select list
 * (SDK_CONFIG_CONSOLE_COLUMNS) must carry every column normalizeSdkConfig
 * reads for the widget/capture/native blocks.
 *
 * QA #29 (2026-10-04): the list omitted `sdk_screenshot_sensitive_hint`, so a
 * saved privacy caption never read back, the checkbox snapped back to ticked,
 * and the next save of any other field sent `true` and wiped it. A
 * normalize/coerce round trip alone passed; the bug was the SELECT.
 */
import { describe, expect, it } from 'vitest'
import {
  coerceSdkConfigUpdate,
  normalizeSdkConfig,
  SDK_CONFIG_CONSOLE_COLUMNS,
  SDK_CONFIG_CONSOLE_SELECT,
  type SdkConfigRow,
} from '../../supabase/functions/_shared/sdk-config'

/** Every console-editable column set to a non-default value, so each one is emitted. */
const FULL_ROW: SdkConfigRow = {
  project_id: 'p1',
  sdk_config_enabled: false,
  sdk_widget_position: 'top-left',
  sdk_widget_theme: 'dark',
  sdk_widget_trigger_text: 'Bug?',
  sdk_widget_launcher: 'banner',
  sdk_widget_attach_selector: '#report-bug',
  sdk_banner_variant: 'neon',
  sdk_banner_position: 'bottom',
  sdk_banner_bug_cta: 'Report it',
  sdk_banner_feature_cta: false,
  sdk_banner_message: 'Beta!',
  sdk_banner_label: 'Beta',
  sdk_screenshot_sensitive_hint: '',
  sdk_capture_console: false,
  sdk_capture_network: false,
  sdk_capture_performance: true,
  sdk_capture_screenshot: 'off',
  sdk_capture_element_selector: true,
  sdk_native_trigger_mode: 'shake',
  sdk_min_description_length: 5,
  sdk_config_updated_at: '2026-10-04T00:00:00Z',
  widget_brand_footer: false,
}

function pickSelected(row: SdkConfigRow): SdkConfigRow {
  const cols = new Set<string>(SDK_CONFIG_CONSOLE_COLUMNS)
  return Object.fromEntries(Object.entries(row).filter(([k]) => cols.has(k))) as SdkConfigRow
}

describe('SDK_CONFIG_CONSOLE_COLUMNS', () => {
  it('reads back everything the console can save (no column dropped by the select)', () => {
    const full = normalizeSdkConfig(FULL_ROW)
    const selected = normalizeSdkConfig(pickSelected(FULL_ROW))
    expect(selected.widget).toEqual(full.widget)
    expect(selected.capture).toEqual(full.capture)
    expect(selected.native).toEqual(full.native)
    expect(selected.enabled).toBe(full.enabled)
  })

  it('includes the screenshot privacy caption column (QA #29)', () => {
    expect(SDK_CONFIG_CONSOLE_SELECT).toContain('sdk_screenshot_sensitive_hint')
    expect(normalizeSdkConfig(pickSelected(FULL_ROW)).widget.screenshotSensitiveHint).toBe(false)
  })

  it('every column coerceSdkConfigUpdate can write is read back', () => {
    const writable = Object.keys(
      coerceSdkConfigUpdate({
        enabled: true,
        widget: {
          position: 'top-left',
          theme: 'dark',
          triggerText: 'x',
          launcher: 'banner',
          attachToSelector: '#x',
          bannerVariant: 'neon',
          bannerPosition: 'bottom',
          bannerBugCta: 'x',
          bannerFeatureCta: false,
          brandFooter: false,
          bannerMessage: 'x',
          bannerLabel: 'x',
          screenshotSensitiveHint: 'x',
        },
        capture: { console: false, network: false, performance: true, screenshot: 'off', elementSelector: true },
        native: { triggerMode: 'shake', minDescriptionLength: 5 },
      }),
    )
    const selected = new Set<string>(SDK_CONFIG_CONSOLE_COLUMNS)
    expect(writable.filter((c) => !selected.has(c))).toEqual([])
  })
})

describe('coerceSdkConfigUpdate bannerBugCta', () => {
  it('null clears a custom bug button label back to the default (QA #259)', () => {
    expect(coerceSdkConfigUpdate({ widget: { bannerBugCta: null } }).sdk_banner_bug_cta).toBeNull()
  })

  it('an absent field leaves the column untouched', () => {
    expect('sdk_banner_bug_cta' in coerceSdkConfigUpdate({ widget: {} })).toBe(false)
  })
})

describe('attach launcher (QA bug 121)', () => {
  it('saves and reads back attach mode and its selector', () => {
    const updates = coerceSdkConfigUpdate({ widget: { launcher: 'attach', attachToSelector: '  #report-button ' } })
    expect(updates.sdk_widget_launcher).toBe('attach')
    expect(updates.sdk_widget_attach_selector).toBe('#report-button')
    const widget = normalizeSdkConfig({
      sdk_widget_launcher: 'attach',
      sdk_widget_attach_selector: '#report-button',
    }).widget as Record<string, unknown>
    expect(widget.launcher).toBe('attach')
    expect(widget.attachToSelector).toBe('#report-button')
  })

  it('a cleared selector saves as null', () => {
    expect(coerceSdkConfigUpdate({ widget: { attachToSelector: null } }).sdk_widget_attach_selector).toBeNull()
    expect(coerceSdkConfigUpdate({ widget: { attachToSelector: '  ' } }).sdk_widget_attach_selector).toBeNull()
  })
})
