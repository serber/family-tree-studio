import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, CheckCheck, ChevronDown, CircleHelp, Download, FilePlus2, FileUp, History, ListTree, LoaderCircle, Network, Redo2, Save, Search, Sparkles, Table2, Undo2, Upload } from 'lucide-react'
import type { DraftMeta } from '../storage'
import { BrandMark } from '../../shared/components/BrandMark'
import { LangSwitch } from '../../shared/components/LangSwitch'
import { formatDateTime, getLocale, t as tr } from '../../shared/i18n'
import { pageUrl } from '../../shared/routes'
import { t } from '../i18n'
import { DEMO_SIZE } from '../model/demo'

export type View = 'tree' | 'table' | 'issues'

interface Props {
  title: string
  onTitleChange: (title: string) => void
  onTitleCommit: () => void
  view: View
  onView: (view: View) => void
  issueCount: number
  canUndo: boolean
  canRedo: boolean
  undoLabel?: string
  redoLabel?: string
  onUndo: () => void
  onRedo: () => void
  onSearch: () => void
  saveState: 'saved' | 'pending' | 'error'
  meta: DraftMeta
  onRetrySave: () => void
  onHelp: () => void
  review: { on: boolean; verified: number; total: number }
  onToggleReview: () => void
  file: {
    onNew: () => void
    onOpenGedcom: () => void
    onSaveGedcom: () => void
    onDownloadBackup: () => void
    onOpenBackup: () => void
    onSnapshots: () => void
    onDemo: () => void
  }
}

export function TopBar(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false) }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', escape) }
  }, [menuOpen])
  const item = (label: string, icon: React.ReactNode, action: () => void, hint?: string) =>
    <button role="menuitem" onClick={() => { setMenuOpen(false); action() }}>{icon}{label}{hint && <kbd>{hint}</kbd>}</button>
  const exportedAt = props.meta.exportedAt ? new Date(props.meta.exportedAt) : undefined

  return <header className="topbar">
    <a className="brand" href={pageUrl('home', getLocale())} title={tr('common.homeTitle', { page: t('app.name') })} aria-label={tr('common.home')}><BrandMark /></a>
    <input className="title-input" value={props.title} aria-label={t('topbar.treeTitle')} onChange={(event) => props.onTitleChange(event.target.value)} onBlur={props.onTitleCommit}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur() }} />
    <nav className="view-tabs" aria-label={t('topbar.views')}>
      <button aria-pressed={props.view === 'tree'} onClick={() => props.onView('tree')} title={t('views.tree')}><Network size={15} /><span className="label">{t('views.tree')}</span></button>
      <button aria-pressed={props.view === 'table'} onClick={() => props.onView('table')} title={t('views.table')}><Table2 size={15} /><span className="label">{t('views.table')}</span></button>
      <button aria-pressed={props.view === 'issues'} onClick={() => props.onView('issues')} title={t('views.issuesTitle')}><ListTree size={15} /><span className="label">{t('views.issues')}</span>{props.issueCount > 0 && <span className="badge">{props.issueCount > 999 ? '999+' : props.issueCount}</span>}</button>
    </nav>
    <button className="review-toggle" aria-pressed={props.review.on} onClick={props.onToggleReview} title={t('review.toggleTitle')}>
      <CheckCheck size={15} />
      {props.review.on ? <>
        <span data-testid="review-progress">{t('review.progress', { verified: props.review.verified, total: props.review.total })}</span>
        <span className="review-progress" aria-hidden="true"><span style={{ width: `${props.review.total ? props.review.verified / props.review.total * 100 : 0}%` }} /></span>
      </> : <span className="label">{t('review.toggle')}</span>}
    </button>
    <span className="spacer" />
    <button className="search-trigger" onClick={props.onSearch} aria-label={t('topbar.search')}><Search size={15} /><span>{t('topbar.searchPlaceholder')}</span><kbd>Ctrl K</kbd></button>
    <span className="toolbar-divider" />
    <button className="icon-btn" onClick={props.onUndo} disabled={!props.canUndo} aria-label={t('topbar.undo')} title={props.undoLabel ? t('topbar.undoTitle', { label: props.undoLabel }) : t('topbar.undoPlain')}><Undo2 size={17} /></button>
    <button className="icon-btn" onClick={props.onRedo} disabled={!props.canRedo} aria-label={t('topbar.redo')} title={props.redoLabel ? t('topbar.redoTitle', { label: props.redoLabel }) : t('topbar.redoPlain')}><Redo2 size={17} /></button>
    <span className="toolbar-divider" />
    {props.saveState === 'error'
      ? <button className="save-status error" data-testid="save-status" onClick={props.onRetrySave} title={t('save.retryTitle')}><AlertTriangle size={14} /><span>{t('save.error')}</span></button>
      : <span className={`save-status ${props.saveState === 'saved' && props.meta.changedSinceExport ? 'unexported' : ''}`} data-testid="save-status" role="status"
        title={props.meta.changedSinceExport ? t('save.unexportedTitle') : exportedAt ? t('save.exportedAt', { date: formatDateTime(exportedAt) }) : ''}>
        {props.saveState === 'pending' ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
        <span>{t(props.saveState === 'pending' ? 'save.pending' : props.meta.changedSinceExport ? 'save.local' : 'save.exported')}</span>
      </span>}
    <div className="menu-wrap" ref={menuRef}>
      <button className="btn btn-secondary" onClick={() => setMenuOpen(!menuOpen)} aria-haspopup="menu" aria-expanded={menuOpen}>{t('file.menu')}<ChevronDown size={14} /></button>
      {menuOpen && <div className="menu" role="menu">
        {item(t('file.saveGedcom'), <Save size={16} />, props.file.onSaveGedcom, 'Ctrl S')}
        {item(t('file.openGedcom'), <FileUp size={16} />, props.file.onOpenGedcom)}
        {item(t('file.newTree'), <FilePlus2 size={16} />, props.file.onNew)}
        <hr />
        {item(t('file.downloadBackup'), <Download size={16} />, props.file.onDownloadBackup)}
        {item(t('file.openBackup'), <Upload size={16} />, props.file.onOpenBackup)}
        {item(t('file.snapshots'), <History size={16} />, props.file.onSnapshots)}
        <hr />
        <div className="menu-label">{t('file.examples')}</div>
        {item(t('file.demo', { count: DEMO_SIZE }), <Sparkles size={16} />, props.file.onDemo)}
        <hr />
        <div className="menu-note">{t('file.note')}</div>
      </div>}
    </div>
    <LangSwitch />
    <button className="icon-btn" onClick={props.onHelp} aria-label={t('topbar.help')} title={t('topbar.helpTitle')}><CircleHelp size={18} /></button>
  </header>
}
