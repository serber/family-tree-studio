import { LOCALES, localizedPath, setLocale, t, unlocalizedPath, type Locale } from '../i18n'
import { useLocale } from '../i18n/react'

/**
 * RU / EN toggle.
 * `button` (apps): switches in place — the page keeps its state and the URL follows the language.
 * `link` (content pages): plain links to the other language's URL, crawlable with hreflang.
 */
export function LangSwitch({ mode = 'button' }: { mode?: 'button' | 'link' }) {
  const locale = useLocale()
  return <div className="lang-switch" role="group" aria-label={t('common.language')}>
    {LOCALES.map((code: Locale) => mode === 'link'
      ? <a key={code} lang={code} hrefLang={code} aria-current={code === locale ? 'true' : undefined}
        href={localizedPath(unlocalizedPath(typeof window === 'undefined' ? '/' : window.location.pathname), code)}>{code.toUpperCase()}</a>
      : <button key={code} type="button" lang={code} aria-pressed={code === locale} onClick={() => setLocale(code)}>{code.toUpperCase()}</button>)}
  </div>
}
