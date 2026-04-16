import type { MushiLocale } from './types';
import { en } from './en';
import { ja } from './ja';
import { th } from './th';
import { es } from './es';

export type { MushiLocale } from './types';

const locales: Record<string, MushiLocale> = { en, ja, th, es };

export function getLocale(code?: string): MushiLocale {
  if (!code) return en;
  const base = code.split('-')[0].toLowerCase();
  return locales[base] ?? en;
}

export function getAvailableLocales(): string[] {
  return Object.keys(locales);
}
