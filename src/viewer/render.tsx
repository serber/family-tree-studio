import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { setLocale, type Locale } from '../shared/i18n'
import { ViewerApp } from './ViewerApp'

/** Build-time pre-render of the visualizer's static markup (scripts/pages.ts); the chart is drawn after hydration. */
export function render(locale: Locale): string {
  setLocale(locale)
  return renderToString(<StrictMode><ViewerApp /></StrictMode>)
}
