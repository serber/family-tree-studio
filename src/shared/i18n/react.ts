import { useSyncExternalStore } from 'react'
import { getLocale, onLocaleChange, type Locale } from './index'

/**
 * The current locale; re-renders the component on a language switch.
 * Components that read `t()` and may be skipped by memoization call this to subscribe.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale, getLocale)
}
