/**
 * Copied verbatim from lazycow-studio src/release-kit.ts (2026-11-27), the
 * product-video side of Plan 025 P5 (ADR 0074). Do not edit here: change it in
 * lazycow first, then copy it again. The JSON Schema copy is
 * packages/server/src/__tests__/fixtures/lazycow-release-kit.schema.json.
 */
/**
 * FILE: src/release-kit.ts
 * PURPOSE: The release kit's TypeScript type (lazycow.release-kit, version 1): what any tool exports for Lazycow Studio's
 *          product videos. The same contract as docs/product-kit.schema.json; py/studio/product.py validate_manifest is
 *          the check the studio runs. docs/product-kit.md says what each field does.
 * USAGE: copy this file into the exporting side (it imports nothing), or read the JSON Schema.
 * NOTES: Unknown fields are ignored; a different `version` is refused. Asset URLs are https (absolute, or relative to the
 *        manifest's link, inheriting nothing from its query: signed kits give every asset its own absolute signed URL);
 *        in a kit folder on the computer they are paths inside that folder.
 */
export type ReleaseKitAsset = {
  url: string;
  type?: "image/png" | "image/jpeg" | "image/webp" | "video/mp4" | "video/webm" | "video/quicktime" | "font/woff2" | "font/woff" | "font/ttf" | "font/otf";
  /** When given, the download must be exactly this many bytes. */
  bytes?: number;
  /** When given, the download must have this SHA-256 (lowercase hex). */
  sha256?: string;
};

export type ReleaseKitViewport = {
  /** CSS pixels or points, 100-8000. */
  width: number;
  height: number;
  /** Default: from the shape (tall = phone, wide and 960+ = desktop, else tablet). */
  device?: "phone" | "tablet" | "desktop";
  platform?: "ios" | "android" | "web";
};

/** #rrggbb */
export type ReleaseKitColor = `#${string}`;

export type ReleaseKitScreen = {
  /** ^[a-z0-9][a-z0-9-]{0,39}$, unique across screens and recordings. */
  id: string;
  /** The screen's name (Home, Search): shown above its caption, matched with changelog lines and recordings. */
  surface?: string;
  viewport: ReleaseKitViewport;
  /** The screen before this release (optional): the video reveals `after` over it. */
  before?: ReleaseKitAsset;
  after: ReleaseKitAsset;
  caption?: string;
  /** Where the camera drifts to, 0-1 of the picture. Default { x: 0.5, y: 0.35 }. */
  focus?: { x: number; y: number };
};

export type ReleaseKitRecording = {
  id: string;
  surface?: string;
  viewport: ReleaseKitViewport;
  /** MP4, MOV or WebM, up to 120 s; its sound is dropped. */
  file: ReleaseKitAsset;
  caption?: string;
  /** Seconds of the recording to use. */
  trim?: { from?: number; to?: number };
};

export type ReleaseKit = {
  schema: "lazycow.release-kit";
  version: 1;
  app: { name: string; tagline?: string; url?: string; stores?: ("app-store" | "google-play" | "web")[] };
  release?: { version?: string; date?: string; title?: string };
  brand?: {
    colors?: { background?: ReleaseKitColor; text?: ReleaseKitColor; primary?: ReleaseKitColor; accent?: ReleaseKitColor };
    /** A bundled family name (docs/product-kit.md › Fonts) or a font file (woff2, woff, ttf, otf). */
    font?: { family?: string; file?: ReleaseKitAsset };
    /** PNG, JPEG or WebP; no SVG. */
    logo?: ReleaseKitAsset;
    /** The end card's call to action. Default "Get <app name>". */
    cta?: string;
  };
  /** Words the video shows, for a kit in another language. */
  labels?: { before?: string; after?: string; news?: string };
  /** At most 24. A kit needs at least one screen or recording. */
  screens?: ReleaseKitScreen[];
  /** At most 8. */
  recordings?: ReleaseKitRecording[];
  /** At most 30 lines of 140 characters. */
  changelog?: (string | { text: string; surface?: string })[];
  /** ISO 8601: when the kit's signed links stop working. */
  expiresAt?: string;
  /** Who made the kit; ignored by the studio. */
  source?: { name?: string; url?: string };
};
