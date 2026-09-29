import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { setLocale, type Locale } from '../shared/i18n'
import { Landing } from './Landing'

/** Build-time pre-render of the home page in one language (scripts/pages.ts). */
export function render(locale: Locale): string {
  setLocale(locale)
  return renderToString(<StrictMode><Landing /></StrictMode>)
}
