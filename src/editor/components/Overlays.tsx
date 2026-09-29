import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, FileUp, History, LoaderCircle, ShieldCheck, Sparkles, UserPlus } from 'lucide-react'
import { listSnapshots, type Snapshot } from '../storage'
import { BrandMark } from '../../shared/components/BrandMark'
import { LangSwitch } from '../../shared/components/LangSwitch'
import { formatDateTime, getLocale, t as tr } from '../../shared/i18n'
import { useLocale } from '../../shared/i18n/react'
import { pageUrl } from '../../shared/routes'
import { t } from '../i18n'

export interface ConfirmRequest { title: string; message: ReactNode; confirmLabel: string; danger?: boolean; resolve: (ok: boolean) => void }
export interface ChoiceRequest { title: string; message?: string; options: { id: string; label: string; detail?: string }[]; resolve: (id: string | null) => void }

export function ConfirmDialog({ request }: { request: ConfirmRequest }) {
  const close = (ok: boolean) => request.resolve(ok)
  return <div className="overlay" onMouseDown={() => close(false)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); close(false) } }}>
    <div className="dialog" role="alertdialog" aria-modal="true" aria-label={request.title} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{request.title}</h2>
      <div>{typeof request.message === 'string' ? <p>{request.message}</p> : request.message}</div>
      <div className="dialog-actions">
        <button className="btn btn-secondary" onClick={() => close(false)}>{t('dialog.cancel')}</button>
        <button className={`btn ${request.danger ? 'btn-secondary btn-danger' : 'btn-primary'}`} autoFocus onClick={() => close(true)}>{request.confirmLabel}</button>
      </div>
    </div>
  </div>
}

export function ChoiceDialog({ request }: { request: ChoiceRequest }) {
  return <div className="overlay" onMouseDown={() => request.resolve(null)} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); request.resolve(null) } }}>
    <div className="dialog" role="dialog" aria-modal="true" aria-label={request.title} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{request.title}</h2>
      {request.message && <p>{request.message}</p>}
      <div className="choice-list">
        {request.options.map((option, position) => <button key={option.id} autoFocus={position === 0} onClick={() => request.resolve(option.id)}>
          <span><strong>{option.label}</strong>{option.detail && <small>{option.detail}</small>}</span>
        </button>)}
      </div>
      <div className="dialog-actions"><button className="btn btn-secondary" onClick={() => request.resolve(null)}>{t('dialog.cancel')}</button></div>
    </div>
  </div>
}

export interface ToastState { message: string; undo?: boolean; error?: boolean; nonce: number }

export function Toast({ toast, onUndo, onClose }: { toast: ToastState; onUndo: () => void; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.error ? 8000 : 5000)
    return () => clearTimeout(timer)
  }, [toast.nonce, toast.error, onClose])
  return <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
    <span>{toast.message}</span>
    {toast.undo && <button onClick={() => { onUndo(); onClose() }}>{t('toast.undo')}</button>}
    <button onClick={onClose} aria-label={t('toast.close')}>✕</button>
  </div>
}

/**
 * Shortcut list: message key under `editor.shortcuts` and the keys to press.
 * Letter shortcuts bind physical keys (KeyJ…), so each language shows its own
 * layout's letters: `keys.*` in the catalog.
 */
const shortcuts: [string, string[]][] = [
  ['search', ['Ctrl', 'K']], ['save', ['Ctrl', 'S']],
  ['undo', ['Ctrl', 'Z']], ['redo', ['Ctrl', 'Shift', 'Z']],
  ['addFather', ['keys.father']], ['addMother', ['keys.mother']],
  ['addSon', ['keys.son']], ['addDaughter', ['keys.daughter']],
  ['addPartner', ['keys.partner']], ['addSibling', ['keys.brother', 'keys.sister']],
  ['parentChild', ['↑', '↓']], ['neighbour', ['←', '→']],
  ['history', ['Alt', '←', '→']], ['editName', ['Enter']],
  ['showSelected', ['1']], ['wholeTree', ['0']],
  ['delete', ['Delete']], ['deselect', ['Esc']],
  ['review', ['keys.space']],
]

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return <div className="overlay" onMouseDown={onClose} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="dialog shortcuts" role="dialog" aria-label={t('shortcuts.label')} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{t('shortcuts.title')}</h2>
      <p>{t('shortcuts.intro')}</p>
      <div className="shortcut-grid">
        {shortcuts.map(([label, keys]) => <div key={label}><span>{t(`shortcuts.${label}`)}</span><span>{keys.map((key) => <kbd key={key}>{key.startsWith('keys.') ? t(key) : key}</kbd>)}</span></div>)}
      </div>
      <div className="dialog-actions"><button className="btn btn-primary" autoFocus onClick={onClose}>{t('shortcuts.ok')}</button></div>
    </div>
  </div>
}

export function SnapshotsDialog({ onRestore, onClose }: { onRestore: (snapshot: Snapshot) => void; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  useEffect(() => { listSnapshots().then(setSnapshots).catch(() => setSnapshots([])) }, [])
  return <div className="overlay" onMouseDown={onClose} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose() } }}>
    <div className="dialog" role="dialog" aria-label={t('snapshots.title')} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{t('snapshots.title')}</h2>
      <p>{t('snapshots.intro')}</p>
      {!snapshots ? <LoaderCircle className="spin" /> : !snapshots.length ? <p className="muted">{t('snapshots.empty')}</p> :
        <div className="choice-list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {snapshots.map((snapshot) => <button key={snapshot.savedAt} onClick={() => onRestore(snapshot)}>
            <History size={16} />
            <span><strong>{snapshot.title}</strong><small>{formatDateTime(snapshot.savedAt)} · {t('snapshots.people', { count: snapshot.people })}</small></span>
          </button>)}
        </div>}
      <div className="dialog-actions"><button className="btn btn-secondary" onClick={onClose}>{t('dialog.close')}</button></div>
    </div>
  </div>
}

export function Welcome({ onNew, onOpen, onDemo }: { onNew: () => void; onOpen: () => void; onDemo: () => void }) {
  useLocale()
  return <div className="welcome">
    <div className="welcome-card">
      <div className="welcome-head">
        <a className="brand" href={pageUrl('home', getLocale())} title={tr('common.home')}><BrandMark size={16} />{tr('common.product')}</a>
        <LangSwitch />
      </div>
      <h1>{t('welcome.title')}</h1>
      <p>{t('welcome.intro')}</p>
      <div className="welcome-actions">
        <button className="welcome-option primary" onClick={onNew}><UserPlus size={22} /><span><strong>{t('welcome.new')}</strong><small>{t('welcome.newHint')}</small></span></button>
        <button className="welcome-option" onClick={onOpen}><FileUp size={22} /><span><strong>{t('welcome.open')}</strong><small>{t('welcome.openHint')}</small></span></button>
        <button className="welcome-option" onClick={onDemo}><Sparkles size={22} /><span><strong>{t('welcome.demo')}</strong><small>{t('welcome.demoHint')}</small></span></button>
      </div>
      <div className="welcome-foot">
        <span><ShieldCheck size={15} />{t('welcome.privacy')}</span>
        <a className="link-btn" href={pageUrl('home', getLocale())}><ArrowLeft size={13} />{tr('common.backHome')}</a>
      </div>
    </div>
  </div>
}
