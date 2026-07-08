import { DEFAULT_SDK_CONFIG, type SdkPreviewConfig } from '../../lib/sdkSnippets'
import type { RemoteSdkConfig } from './sdk-install-types'

export function fromRemoteConfig(remote: RemoteSdkConfig): SdkPreviewConfig {
  return {
    position: remote.widget?.position ?? DEFAULT_SDK_CONFIG.position,
    theme: remote.widget?.theme ?? DEFAULT_SDK_CONFIG.theme,
    trigger: remote.widget?.launcher ?? remote.widget?.trigger ?? DEFAULT_SDK_CONFIG.trigger,
    triggerText: remote.widget?.triggerText ?? DEFAULT_SDK_CONFIG.triggerText,
    attachToSelector: remote.widget?.attachToSelector ?? DEFAULT_SDK_CONFIG.attachToSelector,
    bannerVariant: remote.widget?.bannerVariant ?? DEFAULT_SDK_CONFIG.bannerVariant,
    bannerPosition: remote.widget?.bannerPosition ?? DEFAULT_SDK_CONFIG.bannerPosition,
    bannerMessage: remote.widget?.bannerMessage ?? DEFAULT_SDK_CONFIG.bannerMessage,
    bannerLabel: remote.widget?.bannerLabel ?? DEFAULT_SDK_CONFIG.bannerLabel,
    bannerBugCta: remote.widget?.bannerBugCta ?? DEFAULT_SDK_CONFIG.bannerBugCta,
    bannerFeatureCta: remote.widget?.bannerFeatureCta ?? DEFAULT_SDK_CONFIG.bannerFeatureCta,
    // `false` must survive (?? keeps it); `null`/undefined → default (show caption).
    screenshotSensitiveHint:
      remote.widget?.screenshotSensitiveHint ?? DEFAULT_SDK_CONFIG.screenshotSensitiveHint,
    capture: {
      console: remote.capture?.console ?? DEFAULT_SDK_CONFIG.capture.console,
      network: remote.capture?.network ?? DEFAULT_SDK_CONFIG.capture.network,
      performance: remote.capture?.performance ?? DEFAULT_SDK_CONFIG.capture.performance,
      screenshot: remote.capture?.screenshot ?? DEFAULT_SDK_CONFIG.capture.screenshot,
      elementSelector: remote.capture?.elementSelector ?? DEFAULT_SDK_CONFIG.capture.elementSelector,
    },
    native: {
      triggerMode: remote.native?.triggerMode ?? DEFAULT_SDK_CONFIG.native.triggerMode,
      minDescriptionLength: remote.native?.minDescriptionLength ?? DEFAULT_SDK_CONFIG.native.minDescriptionLength,
    },
  }
}

export function toRemoteConfig(config: SdkPreviewConfig, enabled: boolean): RemoteSdkConfig {
  return {
    enabled,
    widget: {
      position: config.position,
      theme: config.theme,
      trigger: config.trigger,
      launcher: config.trigger,
      triggerText: config.triggerText.trim() ? config.triggerText : null,
      attachToSelector: config.attachToSelector.trim() || null,
      bannerVariant: config.bannerVariant,
      bannerPosition: config.bannerPosition,
      bannerMessage: config.bannerMessage.trim() || null,
      bannerLabel: config.bannerLabel.trim() || null,
      bannerBugCta: config.bannerBugCta.trim() || null,
      bannerFeatureCta: config.bannerFeatureCta,
      screenshotSensitiveHint:
        typeof config.screenshotSensitiveHint === 'string'
          ? config.screenshotSensitiveHint.trim() || true
          : config.screenshotSensitiveHint,
    },
    capture: config.capture,
    native: config.native,
  }
}
