/**
 * Banner visibility for the Integrations hub.
 */

/** Whether the integrations banner should show above the healthy OK state. */
export function isIntegrationsBannerVisible(
  topPriority: string | undefined,
  hasAnyProject: boolean,
): boolean {
  if (!hasAnyProject) return true
  return topPriority !== 'healthy'
}
