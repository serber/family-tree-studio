import { useEffect, useRef } from 'react'
import { BrandMark } from '../shared/components/BrandMark'
import { LangSwitch } from '../shared/components/LangSwitch'
import { t as tr } from '../shared/i18n'
import { useLocale } from '../shared/i18n/react'
import { pageUrl } from '../shared/routes'
import { mountViewer, type ViewerElements } from './app'
import { t } from './i18n'

/**
 * The visualizer page. React owns the static markup and its text; `mountViewer`
 * owns everything inside the chart, the settings panel, both selects and the
 * status line, and fills them imperatively (D3). React never re-renders those
 * nodes' children, and the `hidden` flags it sets once are only changed by the app.
 */
export function ViewerApp() {
  const locale = useLocale()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const root = rootRef.current!
    const find = <T extends HTMLElement>(ref: string) => root.querySelector<T>(`[data-ref="${ref}"]`)!
    const elements: ViewerElements = {
      root,
      chart: find('chart'),
      status: find('status'),
      fileInput: find('fileInput'),
      sampleBtn: find('sampleBtn'),
      rootSelect: find('rootSelect'),
      settingsPanel: find('settingsPanel'),
      printSizeSelect: find('printSizeSelect'),
      exportBtn: find('exportBtn'),
      fitBtn: find('fitBtn'),
      legendUnknown: find('legendUnknown'),
      searchInput: find('searchInput'),
      backBtn: find('backBtn'),
    }
    return mountViewer(elements)
  }, [])

  return <div className="viewer" ref={rootRef}>
    <aside className="viewer-sidebar">
      <header className="viewer-header">
        <div className="viewer-title-row">
          <a className="brand" href={pageUrl('home', locale)} title={tr('common.home')}>
            <BrandMark />
            <span className="brand-text">{tr('common.product')}<small>{t('app.heading')}</small></span>
          </a>
          <LangSwitch />
        </div>
        <p className="viewer-subtitle">{t('app.subtitle')}</p>
        <div className="legend">
          <span><i className="legend-swatch legend-swatch-male" />{t('legend.male')}</span>
          <span><i className="legend-swatch legend-swatch-female" />{t('legend.female')}</span>
          <span data-ref="legendUnknown" hidden><i className="legend-swatch legend-swatch-unknown" />{t('legend.unknown')}</span>
        </div>
      </header>

      <div className="data-actions">
        <label className="btn btn-secondary file-btn">{t('actions.load')}
          <input type="file" data-ref="fileInput" accept=".ged,.gedcom,.txt" />
        </label>
        <button className="btn btn-secondary" data-ref="sampleBtn" type="button">{t('actions.sample')}</button>
      </div>

      <label className="viewer-field">
        <span className="viewer-field-label">{t('fields.rootFamily')}</span>
        <select className="input select" data-ref="rootSelect" disabled />
      </label>

      <label className="viewer-field">
        <span className="viewer-field-label">{t('fields.search')}</span>
        <input className="input" data-ref="searchInput" type="search" autoComplete="off" placeholder={t('fields.searchPlaceholder')} />
      </label>

      <div className="settings-panels" data-ref="settingsPanel" />

      <div className="viewer-field">
        <label className="viewer-field-label" htmlFor="printSize">{t('fields.canvasSize')}</label>
        <select className="input select" id="printSize" data-ref="printSizeSelect" />
        <button className="btn btn-primary btn-lg btn-block" data-ref="exportBtn" type="button">{t('actions.export')}</button>
      </div>
    </aside>

    <main className="viewer-stage">
      <div className="viewer-chart" data-ref="chart" />
      <footer className="viewer-bar">
        <span className="viewer-status" data-ref="status" role="status" />
        <button className="link-btn" data-ref="backBtn" type="button" hidden>{t('actions.back')}</button>
        <button className="link-btn" data-ref="fitBtn" type="button">{t('actions.fit')}</button>
      </footer>
    </main>
  </div>
}
