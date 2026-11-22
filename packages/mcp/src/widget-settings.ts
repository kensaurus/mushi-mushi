/**
 * get_widget_settings / set_widget_settings: the console's widget editor over
 * MCP (GET|PUT /v1/admin/projects/:id/sdk-config). The hosted server keeps
 * the same logic in packages/server/supabase/functions/_shared/widget-settings.ts;
 * keep the two in step (packages/server/src/__tests__/mcp-widget-settings.test.ts
 * checks that the two files match).
 */

export const WIDGET_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const
export const WIDGET_THEMES = ['auto', 'light', 'dark', 'inherit'] as const
export const WIDGET_LAUNCHERS = ['auto', 'banner', 'edge-tab', 'attach', 'manual', 'hidden'] as const

export interface WidgetSettingsInput {
  accent?: string
  position?: (typeof WIDGET_POSITIONS)[number]
  theme?: (typeof WIDGET_THEMES)[number]
  triggerText?: string
  launcher?: (typeof WIDGET_LAUNCHERS)[number]
}

export interface WidgetSettingsView {
  projectId: string | null
  enabled: boolean
  canEdit: boolean | null
  widget: {
    position: string
    theme: string
    triggerText: string | null
    accent: string
    accentText: string | null
    launcher: string
  }
}

/** The PUT body for the fields the caller sent; '' trigger text and 'auto' accent clear them. */
export function widgetSettingsBody(input: WidgetSettingsInput): { widget: Record<string, unknown> } {
  const widget: Record<string, unknown> = {}
  if (input.accent !== undefined) {
    const a = input.accent.trim()
    widget.accent = a === '' || a.toLowerCase() === 'auto' ? null : a
  }
  if (input.position !== undefined) widget.position = input.position
  if (input.theme !== undefined) widget.theme = input.theme
  if (input.triggerText !== undefined) widget.triggerText = input.triggerText.trim() ? input.triggerText : null
  if (input.launcher !== undefined) widget.launcher = input.launcher
  return { widget }
}

/** The SDK config response with the defaults filled in, so "unset" reads as what the widget shows. */
export function widgetSettingsView(data: unknown): WidgetSettingsView {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const w = (d.widget && typeof d.widget === 'object' ? d.widget : {}) as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  return {
    projectId: str(d.projectId),
    enabled: d.enabled !== false,
    canEdit: typeof d.canEdit === 'boolean' ? d.canEdit : null,
    widget: {
      position: str(w.position) ?? 'bottom-right',
      theme: str(w.theme) ?? 'auto',
      triggerText: str(w.triggerText),
      accent: str(w.accent) ?? 'auto',
      accentText: str(w.accentText),
      launcher: str(w.launcher) ?? 'auto',
    },
  }
}

/** Widget keys whose shown value differs between two views. */
export function changedWidgetKeys(before: WidgetSettingsView, after: WidgetSettingsView): string[] {
  return (Object.keys(after.widget) as Array<keyof WidgetSettingsView['widget']>).filter(
    (k) => before.widget[k] !== after.widget[k],
  )
}
