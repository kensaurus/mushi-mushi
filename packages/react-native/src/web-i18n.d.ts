declare module '@mushi-mushi/web/i18n' {
  export type { MushiLocale } from '../../web/src/i18n/types'
  export function getLocale(code?: string): import('../../web/src/i18n/types').MushiLocale
  export function getAvailableLocales(): string[]
}
