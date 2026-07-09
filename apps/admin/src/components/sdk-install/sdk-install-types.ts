import type {
  BannerPosition,
  BannerVariant,
  SdkPreviewConfig,
  WidgetPosition,
  WidgetTheme,
  WidgetTrigger,
} from '../../lib/sdkSnippets'

/** Subset of assistant config used by the live widget preview mock. */
export interface AssistantPreviewState {
  enabled: boolean
  label: string
  greeting: string
}

export interface RemoteSdkConfig {
  enabled?: boolean
  widget?: {
    position?: WidgetPosition
    theme?: WidgetTheme
    trigger?: WidgetTrigger
    triggerText?: string | null
    attachToSelector?: string | null
    launcher?: WidgetTrigger
    bannerVariant?: BannerVariant
    bannerPosition?: BannerPosition
    bannerBugCta?: string | null
    bannerFeatureCta?: boolean
    bannerMessage?: string | null
    bannerLabel?: string | null
    screenshotSensitiveHint?: boolean | string | null
  }
  capture?: SdkPreviewConfig['capture']
  native?: SdkPreviewConfig['native']
}

export interface SdkInstallCardProps {
  /** The project's external `project_id` (the value the SDK sends back to the
   *  ingest endpoint) — not the internal UUID. */
  projectId: string
  /** Project slug — drives Expo env-var snippets and default framework tab. */
  projectSlug?: string | null
  /** Optional linked-repo package.json text for frameworkDetect auto-tab. */
  linkedPackageJson?: string | null
  /** Plaintext API key, only available the moment after a mint. */
  apiKey?: string | null
  /** Active key prefixes (e.g. `mushi_a1b2c3d4`) when the full secret is not in memory. */
  keyPrefixes?: string[]
  /** When true, drops outer padding and the descriptive subhead so the card
   *  reads as a sub-block inside another card rather than a full section. */
  compact?: boolean
  /** Show live connection / ingest status chip above the snippet. */
  showConnectionStatus?: boolean
}
