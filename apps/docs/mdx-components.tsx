import { useMDXComponents as getDocsComponents } from 'nextra-theme-docs'
import { Playground } from './components/Playground'

export const useMDXComponents = (components?: Record<string, unknown>) => ({
  ...getDocsComponents(),
  Playground,
  ...(components ?? {}),
})
