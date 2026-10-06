import { useEffect, useState, type ReactNode } from 'react'
import { ArrowLeft, FileUp, History, LoaderCircle, ShieldCheck, Sparkles, Trash2, UserPlus } from 'lucide-react'
import { deleteSnapshots, listSnapshots, type Snapshot } from '../storage'
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

/** Lists snapshots to restore; deleting one (or all) is irreversible, so it asks inline first. */
export function SnapshotsDialog({ intro, onRestore, onClose }: { intro?: string; onRestore: (snapshot: Snapshot) => void; onClose: () => void }) {
  const [snapshots, setSnapshots] = useState<Snapshot[] | null>(null)
  const [confirming, setConfirming] = useState<string | null>(null) // a snapshot's savedAt, or 'all'
  const [failed, setFailed] = useState(false)
  const reload = () => listSnapshots().then(setSnapshots).catch(() => setSnapshots([]))
  useEffect(() => { void reload() }, [])
  const remove = async (savedAt?: string) => {
    setConfirming(null)
    try { await deleteSnapshots(savedAt); setFailed(false) } catch { setFailed(true) }
    await reload()
  }
  return <div className="overlay" onMouseDown={onClose} onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); if (confirming) setConfirming(null); else onClose() } }}>
    <div className="dialog" role="dialog" aria-label={t('snapshots.title')} onMouseDown={(event) => event.stopPropagation()}>
      <h2>{t('snapshots.title')}</h2>
      <p>{intro ?? t('snapshots.intro')}</p>
      {!snapshots ? <LoaderCircle className="spin" /> : !snapshots.length ? <p className="muted">{t('snapshots.empty')}</p> :
        <div className="choice-list" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {snapshots.map((snapshot) => confirming === snapshot.savedAt
            ? <div key={snapshot.savedAt} className="snapshot-row confirming" role="group" aria-label={t('snapshots.deleteOne')}>
              <span>{t('snapshots.deleteOne')}</span>
              <button className="btn btn-sm btn-secondary btn-danger" autoFocus onClick={() => void remove(snapshot.savedAt)}>{t('snapshots.delete')}</button>
              <button className="btn btn-sm btn-secondary" onClick={() => setConfirming(null)}>{t('dialog.cancel')}</button>
            </div>
            : <div key={snapshot.savedAt} className="snapshot-row">
              <button onClick={() => onRestore(snapshot)}>
                <History size={16} />
                <span><strong>{snapshot.title}</strong><small>{formatDateTime(snapshot.savedAt)} · {t('snapshots.people', { count: snapshot.people })}</small></span>
              </button>
              <button className="icon-btn" onClick={() => setConfirming(snapshot.savedAt)} aria-label={t('snapshots.deleteTitle')} title={t('snapshots.deleteTitle')}><Trash2 size={16} /></button>
            </div>)}
        </div>}
      {failed && <p className="snapshot-error" role="alert">{t('snapshots.deleteFailed')}</p>}
      <div className="dialog-actions">
        {confirming === 'all' ? <>
          <span className="snapshot-confirm-all">{t('snapshots.deleteAllConfirm', { count: snapshots?.length ?? 0 })}</span>
          <button className="btn btn-secondary btn-danger" autoFocus onClick={() => void remove()}>{t('snapshots.deleteAll')}</button>
          <button className="btn btn-secondary" onClick={() => setConfirming(null)}>{t('dialog.cancel')}</button>
        </> : <>
          {!!snapshots?.length && <button className="btn btn-secondary btn-danger snapshot-delete-all" onClick={() => setConfirming('all')}><Trash2 size={15} />{t('snapshots.deleteAll')}</button>}
          <button className="btn btn-secondary" onClick={onClose}>{t('dialog.close')}</button>
        </>}
      </div>
    </div>
  </div>
}

export function Welcome({ onNew, onOpen, onDemo, snapshots, onSnapshots }: { onNew: () => void; onOpen: () => void; onDemo: () => void; snapshots: number; onSnapshots: () => void }) {
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
        {snapshots > 0 && <button className="link-btn" onClick={onSnapshots}><History size={13} />{t('welcome.snapshots', { count: snapshots })}</button>}
        <a className="link-btn" href={pageUrl('home', getLocale())}><ArrowLeft size={13} />{tr('common.backHome')}</a>
      </div>
    </div>
  </div>
}
