import { ArrowRight, Orbit, ShieldCheck, UserPen } from 'lucide-react'
import { BrandMark } from '../shared/components/BrandMark'
import { LangSwitch } from '../shared/components/LangSwitch'
import { t } from '../shared/i18n'
import { useLocale } from '../shared/i18n/react'
import { pageUrl } from '../shared/routes'

/** The home page: what the product is and the way into each tool. Pre-rendered at build time. */
export function Landing() {
  const locale = useLocale()
  return <div className="landing">
    <header className="landing-header">
      <a className="brand" href={pageUrl('home', locale)}><BrandMark />{t('common.product')}</a>
      <LangSwitch mode="link" />
    </header>

    <main className="landing-hero">
      <h1>{t('landing.title')}</h1>
      <p className="landing-intro">{t('landing.intro')}</p>

      <nav className="landing-actions" aria-label={t('common.product')}>
        <a className="landing-action landing-action-primary" href={pageUrl('editor', locale)}>
          <span className="landing-action-icon"><UserPen size={20} /></span>
          <span className="landing-action-text"><strong>{t('landing.editor')}</strong><small>{t('landing.editorHint')}</small></span>
          <ArrowRight className="landing-action-arrow" size={18} />
        </a>
        <a className="landing-action" href={pageUrl('viewer', locale)}>
          <span className="landing-action-icon"><Orbit size={20} /></span>
          <span className="landing-action-text"><strong>{t('landing.viewer')}</strong><small>{t('landing.viewerHint')}</small></span>
          <ArrowRight className="landing-action-arrow" size={18} />
        </a>
      </nav>

      <p className="landing-note"><ShieldCheck size={15} />{t('landing.privacy')}</p>
    </main>

    <footer className="landing-footer">{t('landing.gedcom')}</footer>
  </div>
}
