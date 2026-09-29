import { IntlMessageFormat } from 'intl-messageformat'
import en from '../../../messages/en.json'
import ru from '../../../messages/ru.json'

/**
 * Product-wide i18n on intl-messageformat: ICU messages in messages/<locale>.json
 * (the next-intl catalog convention), one catalog per locale with a namespace per
 * area (common, landing, editor, viewer).
 *
 * The URL is the source of truth for the locale: `/…` is English, `/ru/…` is
 * English. Switching the language inside an app keeps its state and rewrites the
 * URL in place, so a reload or a shared link opens the same language.
 */

export type Locale = 'ru' | 'en'
export type MessageValues = Record<string, string | number>

export const LOCALES: readonly Locale[] = ['ru', 'en']
export const DEFAULT_LOCALE: Locale = 'en'
/** The locale served under a path prefix (`/ru/…`). */
export const PREFIXED_LOCALE: Locale = 'ru'

const catalogs: Record<Locale, unknown> = { ru, en }
const formatters = new Map<string, IntlMessageFormat>()
const listeners = new Set<() => void>()

/** Locale encoded in a pathname: a `/ru` prefix, otherwise the default. */
export function localeFromPath(pathname: string): Locale {
  return pathname === `/${PREFIXED_LOCALE}` || pathname.startsWith(`/${PREFIXED_LOCALE}/`) ? PREFIXED_LOCALE : DEFAULT_LOCALE
}

/** `path` (locale-free, starting with `/`) as a URL of the given locale. */
export function localizedPath(path: string, locale: Locale): string {
  return locale === DEFAULT_LOCALE ? path : `/${locale}${path}`
}

/** Strips the locale prefix: `/ru/editor/` → `/editor/`. */
export function unlocalizedPath(pathname: string): string {
  const stripped = pathname.replace(new RegExp(`^/${PREFIXED_LOCALE}(?=/|$)`), '')
  return stripped || '/'
}

// Workers and Node (tests) have no page URL: they stay on the default locale.
let current: Locale = typeof window !== 'undefined' ? localeFromPath(window.location.pathname) : DEFAULT_LOCALE

export function getLocale(): Locale {
  return current
}

/** BCP 47 tag for Intl APIs (numbers, dates). */
export function intlLocale(locale: Locale = current): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}

/** Switches the language in place: updates the URL, `<html lang>` and notifies subscribers. */
export function setLocale(locale: Locale): void {
  if (locale === current) return
  current = locale
  formatters.clear()
  if (typeof window !== 'undefined') {
    const { pathname, search, hash } = window.location
    window.history.replaceState(window.history.state, '', localizedPath(unlocalizedPath(pathname), locale) + search + hash)
    document.documentElement.lang = locale
  }
  for (const listener of listeners) listener()
}

/** Subscribes to language switches; returns the unsubscribe function. */
export function onLocaleChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function lookup(catalog: unknown, path: string): string | null {
  let node: unknown = catalog
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[part]
  }
  return typeof node === 'string' ? node : null
}

/** Whether the current catalog (or the English fallback) has this key. */
export function hasMessage(key: string): boolean {
  return lookup(catalogs[current], key) !== null || lookup(catalogs.en, key) !== null
}

/** Translates a dot-path key; a missing key falls back to English, then to the key itself. */
export function t(key: string, values?: MessageValues, locale: Locale = current): string {
  const message = lookup(catalogs[locale], key) ?? lookup(catalogs.en, key)
  if (message === null) return key
  if (!values && !message.includes('{')) return message
  const cacheKey = `${locale}|${key}`
  let formatter = formatters.get(cacheKey)
  if (!formatter) {
    formatter = new IntlMessageFormat(message, intlLocale(locale))
    formatters.set(cacheKey, formatter)
  }
  return String(formatter.format(values ?? {}))
}

/** Binds `t` to a namespace: `scoped('viewer')('actions.load')` reads `viewer.actions.load`. */
export function scoped(namespace: string) {
  return (key: string, values?: MessageValues) => t(`${namespace}.${key}`, values)
}

/** Number in the current locale, e.g. 3 000 / 3,000. */
export function formatNumber(value: number): string {
  return value.toLocaleString(intlLocale())
}

/** Date and time in the current locale. */
export function formatDateTime(value: Date | string, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString(intlLocale(), options)
}

/** Keeps the tab title equal to the page's SEO title (`meta.<page>.title`) in the current language. */
export function syncDocumentTitle(page: 'home' | 'editor' | 'viewer'): () => void {
  const apply = () => { document.title = t(`meta.${page}.title`) }
  apply()
  return onLocaleChange(apply)
}
