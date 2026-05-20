import type { MushiLocale } from './types';
import { en } from './en';
import { ja } from './ja';
import { th } from './th';
import { es } from './es';

export type { MushiLocale } from './types';

const locales: Record<string, MushiLocale> = { en, ja, th, es };

export function getLocale(code?: string): MushiLocale {
  // `undefined` or the sentinel `'auto'` both fall through to navigator.language.
  const resolved =
    code && code !== 'auto'
      ? code
      : typeof navigator !== 'undefined'
        ? (navigator.language ?? navigator.languages?.[0])
        : undefined;
  if (!resolved) return en;
  const base = resolved.split('-')[0].toLowerCase();
  return locales[base] ?? en;
}

export function getAvailableLocales(): string[] {
  return Object.keys(locales);
}
