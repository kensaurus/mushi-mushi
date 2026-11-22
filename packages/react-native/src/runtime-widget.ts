// SPDX-License-Identifier: MIT
// Copyright (c) 2024–2026 kensaurus LLC — Mushi Mushi
/**
 * FILE: packages/react-native/src/runtime-widget.ts
 * PURPOSE: Apply the console's widget settings (`GET /v1/sdk/config`) to the
 *          React Native widget under ADR 0068: a value the app sets in code
 *          always wins; the console fills only what the code left unset.
 *
 *          Only what the console sends when someone set it is applied:
 *          - `widget.accent` (+ `accentText`), served only when a colour is chosen;
 *          - `widget.position`, bottom-left or bottom-right (the button has no
 *            top corners). The console's default, bottom-right, is also this
 *            SDK's default, so an untouched console changes nothing.
 *          The `native` block (trigger mode, minimum description length) is not
 *          applied: the server always sends its defaults there ('both', 20),
 *          which would switch on shake-to-report and raise the minimum on
 *          every app that never asked for it.
 */

import type { MushiRuntimeSdkConfig } from '@mushi-mushi/core'
import type { MushiRNTheme } from './theme'

type ButtonPosition = 'bottom-right' | 'bottom-left'

export interface RNWidgetLook {
  buttonPosition?: ButtonPosition
  theme?: Partial<MushiRNTheme>
}

const HEX = /^#[0-9a-f]{6}$/i

/**
 * The effective button position and theme: the host's values, with the
 * console's colour and corner filling only what the host left unset.
 */
export function mergeRuntimeWidget(host: RNWidgetLook | undefined, runtime: MushiRuntimeSdkConfig | null | undefined): RNWidgetLook {
  const out: RNWidgetLook = { buttonPosition: host?.buttonPosition, theme: host?.theme }
  if (!runtime || runtime.enabled === false) return out
  const widget = runtime.widget

  const position = widget?.position
  if (!out.buttonPosition && (position === 'bottom-left' || position === 'bottom-right')) {
    out.buttonPosition = position
  }

  const accent = typeof widget?.accent === 'string' && HEX.test(widget.accent) ? widget.accent : undefined
  if (accent && !host?.theme?.accent) {
    const accentText = typeof widget?.accentText === 'string' ? widget.accentText : undefined
    out.theme = {
      ...host?.theme,
      accent,
      // The host's own text colour wins; otherwise the server's readable pair.
      ...(host?.theme?.accentFg ? {} : accentText ? { accentFg: accentText } : {}),
    }
  }
  return out
}
