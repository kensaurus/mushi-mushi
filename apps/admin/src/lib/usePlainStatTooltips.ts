/**
 * Shared mode gate for StatCard tooltip copy — beginner/quickstart get plain English.
 */

import { useAdminMode } from './mode'

export type PlainStatTooltipOpts = { plainLanguage?: boolean; plainStageLabels?: boolean }

export function usePlainStatTooltips(): PlainStatTooltipOpts {
  const { isAdvanced } = useAdminMode()
  const plain = !isAdvanced
  return { plainLanguage: plain, plainStageLabels: plain }
}
