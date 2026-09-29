import { localizedPath, type Locale } from './i18n'

/** The product's pages, as locale-free paths (see `localizedPath`). */
export const PAGES = {
  home: '/',
  editor: '/editor/',
  viewer: '/viewer/',
} as const

export type Page = keyof typeof PAGES

export function pageUrl(page: Page, locale: Locale): string {
  return localizedPath(PAGES[page], locale)
}
