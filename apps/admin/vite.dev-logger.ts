/**
 * FILE: vite.dev-logger.ts
 * PURPOSE: Quieter Vite dev logging — 24-hour timestamps, no HMR spam.
 */

import { createLogger, type Logger, type LogErrorOptions, type LogOptions } from 'vite'

const time24 = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
})

/** HMR/page-reload and dependency re-optimize lines dominate the terminal. */
const QUIET_INFO = /hmr update|page reload|hmr invalidate|re-optimizing dependencies/i

function line(msg: string, options?: LogOptions): string {
  const env = options?.environment ? `${options.environment} ` : ''
  return `${time24.format(new Date())} [vite] ${env}${msg}`
}

/** Vite logger with 24h timestamps and filtered HMR noise. */
export function createDevLogger(): Logger {
  const inner = createLogger('info', { allowClearScreen: false })
  const warned = new Set<string>()

  return {
    hasWarned: false,
    info(msg, options) {
      if (QUIET_INFO.test(msg)) return
      console.log(line(msg, options))
    },
    warn(msg, options) {
      this.hasWarned = true
      console.warn(line(msg, options))
    },
    warnOnce(msg, options) {
      if (warned.has(msg)) return
      warned.add(msg)
      this.warn(msg, options)
    },
    error(msg, options?: LogErrorOptions) {
      this.hasWarned = true
      console.error(line(msg, options))
    },
    clearScreen() {
      inner.clearScreen('info')
    },
    hasErrorLogged(error) {
      return inner.hasErrorLogged(error)
    },
  }
}
