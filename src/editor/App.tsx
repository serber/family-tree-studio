import { useCallback, useDeferredValue, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { FileSearch, FileUp, LoaderCircle, Maximize, Save, ShieldCheck, UserPlus } from 'lucide-react'
import { TreeCanvas, type AddAction, type CanvasCommand } from './components/TreeCanvas'
import { Inspector, type LinkKind } from './components/Inspector'
import { CommandPalette, type PaletteCommand } from './components/CommandPalette'
import { IssuesView, PeopleTable } from './components/Views'
import { ChoiceDialog, ConfirmDialog, ShortcutsDialog, SnapshotsDialog, Toast, Welcome, type ChoiceRequest, type ConfirmRequest, type ToastState } from './components/Overlays'
import { TopBar, type View } from './components/TopBar'
import { createDemo } from './model/demo'
import { editorReducer, initialEditorState } from './model/history'
import { findIssues } from './model/issues'
import {
  addChild, addParent, addPartner, addPerson, addSibling, childFamilyOptions, deletePerson, isSelfOrDescendant,
  linkChild, linkParent, linkPartner, linkSibling, mergePeople, nextUnverified, setVerified, unlinkParent, unlinkPartner, unlinkSibling, updateFamily, updatePerson, type OpResult,
} from './model/ops'
import { buildIndex, fullName, lifespan, lineageOf, marriageOrders, relativesOf, shortName, type Person, type PersonFields, type TreeDocument } from './model/tree'
import { layoutInput } from './layout/layout'
import { createSkeleton } from './gedcom/skeleton'
import { readGedcom, writeGedcom } from './gedcom/client'
import { downloadBackup, loadDraft, parseDraft, requestPersistentStorage, saveDraft, snapshotNow, type Draft, type DraftMeta, type Snapshot } from './storage'
import { isTyping, useLayout } from './hooks'
import { AppError } from '../shared/errors'
import { formatDateTime } from '../shared/i18n'
import { useLocale } from '../shared/i18n/react'
import { errorMessage, t } from './i18n'

const SELECTED_KEY = 'rodnye:selected'
const HIGHLIGHT_KEY = 'rodnye:highlight-lineage'
const REVIEW_KEY = 'rodnye:review-mode'
const NO_MARKS: Record<string, string> = {}

function createNewTree(): { tree: TreeDocument; personId: string } {
  const empty: TreeDocument = { schemaVersion: 2, id: `tree-${crypto.randomUUID()}`, title: t('defaults.newTitle'), people: {}, families: {}, gedcom: createSkeleton(), nextIds: { person: 1, family: 1 } }
  const result = addPerson(empty)
  return { tree: result.tree, personId: result.personId! }
}

function readStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeStorage(key: string, value: string | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* private mode */ }
}

interface Start { tree: TreeDocument; meta: DraftMeta; select?: string; focus?: boolean }

export default function App() {
  useLocale()
  const [boot, setBoot] = useState<{ draft?: Draft; error?: string; ready: boolean }>({ ready: false })
  const [start, setStart] = useState<Start | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const gedcomInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    loadDraft().then((draft) => {
      if (!active) return
      setBoot({ ready: true, draft })
      if (draft) setStart({ tree: draft.tree, meta: draft.meta, select: readStorage(SELECTED_KEY) ?? undefined })
    }).catch((reason: unknown) => { if (active) setBoot({ ready: false, error: reason instanceof Error ? reason.message : t('errors.storageRead') }) })
    return () => { active = false }
  }, [retry])

  if (boot.error) return <div className="startup"><div><ShieldCheck size={32} /><h1>{t('startup.failedTitle')}</h1><p>{boot.error}</p><p>{t('startup.failedHint')}</p><button className="btn btn-primary" onClick={() => { setBoot({ ready: false }); setRetry((value) => value + 1) }}>{t('startup.retry')}</button></div></div>
  if (!boot.ready) return <div className="startup"><div><LoaderCircle className="spin" /><p>{t('startup.loading')}</p></div></div>
  if (start) return <ReactFlowProvider><Editor start={start} /></ReactFlowProvider>

  const openFile = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      const tree = await readGedcom(file)
      setStart({ tree, meta: { changedSinceExport: false }, select: Object.keys(tree.people)[0] })
    } catch (reason) { setError(errorMessage(reason)) }
    finally { setBusy(false) }
  }
  return <>
    <Welcome
      onNew={() => { const { tree, personId } = createNewTree(); setStart({ tree, meta: { changedSinceExport: true }, select: personId, focus: true }) }}
      onOpen={() => gedcomInput.current?.click()}
      onDemo={() => setStart({ tree: createDemo(100), meta: { changedSinceExport: false }, select: 'I1' })} />
    <input ref={gedcomInput} type="file" accept=".ged,.GED" hidden data-testid="gedcom-input" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openFile(file); event.target.value = '' }} />
    {busy && <div className="file-busy"><div><LoaderCircle className="spin" size={26} />{t('busy.reading')}</div></div>}
    {error && <div className="toast error" role="alert"><span>{error}</span><button onClick={() => setError('')}>✕</button></div>}
  </>
}

type Palette = { mode: 'search' } | { mode: 'pick'; title: string; filter: (person: Person) => boolean; onPick: (id: string) => void }

function Editor({ start }: { start: Start }) {
  const locale = useLocale()
  const [state, dispatch] = useReducer(editorReducer, start.tree, initialEditorState)
  const tree = state.tree
  const index = useMemo(() => buildIndex(tree), [tree.families]) // eslint-disable-line react-hooks/exhaustive-deps
  const [selectedId, setSelectedId] = useState<string | null>(start.select && start.tree.people[start.select] ? start.select : null)
  const navigation = useRef<{ back: string[]; forward: string[] }>({ back: [], forward: [] })
  const [, forceNavRender] = useState(0)
  const [view, setView] = useState<View>('tree')
  const [palette, setPalette] = useState<Palette | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [choiceRequest, setChoiceRequest] = useState<ChoiceRequest | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [meta, setMeta] = useState<DraftMeta>(start.meta)
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved')
  const [saveAttempt, setSaveAttempt] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [command, setCommand] = useState<CanvasCommand | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(start.focus && start.select ? { id: start.select, nonce: 1 } : null)
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const [highlight, setHighlight] = useState(() => readStorage(HIGHLIGHT_KEY) !== 'off')
  useEffect(() => { writeStorage(HIGHLIGHT_KEY, highlight ? 'on' : 'off') }, [highlight])
  const [reviewMode, setReviewMode] = useState(() => readStorage(REVIEW_KEY) === 'on')
  useEffect(() => { writeStorage(REVIEW_KEY, reviewMode ? 'on' : 'off') }, [reviewMode])
  const marks = tree.verified ?? NO_MARKS
  const verifiedCount = useMemo(() => Object.keys(marks).filter((id) => tree.people[id]).length, [marks, tree.people])
  const [showHelp, setShowHelp] = useState(false)
  const [showSnapshots, setShowSnapshots] = useState(false)
  const [layoutAttempt, setLayoutAttempt] = useState(0)
  const gedcomInput = useRef<HTMLInputElement>(null)
  const backupInput = useRef<HTMLInputElement>(null)
  const nonce = useRef(1)
  const next = () => ++nonce.current

  // --- Layout: only structure (IDs and links) triggers a relayout, never text edits.
  const peopleKey = useMemo(() => Object.keys(tree.people).join(','), [tree.people])
  const familiesKey = useMemo(() => Object.values(tree.families).map((family) => `${family.id}:${family.partnerIds.join('+')}>${family.childIds.join('+')}`).join(';'), [tree.families])
  // Marriage order (by marriage year) of people married more than once decides which spouse is drawn first.
  const marriageKey = useMemo(() => JSON.stringify(marriageOrders(tree.families)), [tree.families])
  const structureKey = `${tree.id}|${peopleKey}|${familiesKey}|${marriageKey}`
  const input = useMemo(() => layoutInput(tree), [structureKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const layout = useLayout(input, structureKey, tree.id, layoutAttempt)
  const layoutValid = layout.docId === tree.id

  const deferredTree = useDeferredValue(tree)
  const deferredIndex = useMemo(() => buildIndex(deferredTree), [deferredTree])
  const issues = useMemo(() => findIssues(deferredTree, deferredIndex), [deferredTree, deferredIndex])
  const lineage = useMemo(() => {
    if (!highlight || !selectedId || !tree.people[selectedId]) return null
    const { ancestors, descendants } = lineageOf(tree, selectedId, index)
    const relatives = relativesOf(tree, selectedId, index)
    return new Set([selectedId, ...ancestors, ...descendants, ...relatives.partners, ...relatives.siblings])
  }, [highlight, selectedId, tree, index])
  const suggestions = useMemo(() => {
    const count = (values: string[]) => {
      const counts = new Map<string, number>()
      for (const value of values) if (value.trim()) counts.set(value.trim(), (counts.get(value.trim()) ?? 0) + 1)
      return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 400).map(([value]) => value)
    }
    const people = Object.values(deferredTree.people)
    return {
      surnames: count(people.flatMap((person) => [person.surname, person.birthSurname])),
      maleNames: count(people.filter((person) => person.sex !== 'F').map((person) => person.givenName)),
      femaleNames: count(people.filter((person) => person.sex !== 'M').map((person) => person.givenName)),
      places: count([...people.flatMap((person) => [person.birthPlace, person.deathPlace]), ...Object.values(deferredTree.families).map((family) => family.marriagePlace)]),
    }
  }, [deferredTree])

  // --- Autosave: serialized writes; the first successful save asks for persistent storage.
  const saveQueue = useRef(Promise.resolve())
  const firstTree = useRef(tree)
  const persisted = useRef(false)
  useEffect(() => {
    if (tree !== firstTree.current) setMeta((current) => current.changedSinceExport ? current : { ...current, changedSinceExport: true })
  }, [tree])
  useEffect(() => {
    let active = true
    setSaveState('pending')
    const timer = setTimeout(() => {
      saveQueue.current = saveQueue.current.catch(() => {}).then(() => saveDraft(tree, meta))
      saveQueue.current.then(() => {
        if (active) setSaveState('saved')
        if (!persisted.current) { persisted.current = true; void requestPersistentStorage() }
      }).catch(() => { if (active) setSaveState('error') })
    }, 500)
    return () => { active = false; clearTimeout(timer) }
  }, [tree, meta, saveAttempt])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (saveState !== 'saved') { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [saveState])
  useEffect(() => { writeStorage(SELECTED_KEY, selectedId) }, [selectedId])

  // Initial view for each document: center on the selected person, or fit small trees.
  const viewedDoc = useRef<string | null>(null)
  useEffect(() => {
    if (!layoutValid || viewedDoc.current === tree.id) return
    viewedDoc.current = tree.id
    const people = Object.keys(tree.people).length
    if (selectedId && people > 40) setCommand({ kind: 'center', id: selectedId, nonce: next() })
    else setCommand({ kind: 'fit', nonce: next() })
  }, [layoutValid, tree.id, tree.people, selectedId])

  // --- Helpers
  const showError = useCallback((error: unknown) => setToast({ message: errorMessage(error), error: true, nonce: next() }), [])
  const ask = useCallback((request: Omit<ConfirmRequest, 'resolve'>) => new Promise<boolean>((resolve) => setConfirmRequest({ ...request, resolve: (ok) => { setConfirmRequest(null); resolve(ok) } })), [])
  const choose = useCallback((request: Omit<ChoiceRequest, 'resolve'>) => new Promise<string | null>((resolve) => setChoiceRequest({ ...request, resolve: (id) => { setChoiceRequest(null); resolve(id) } })), [])

  const selectedRef = useRef(selectedId)
  selectedRef.current = selectedId
  const select = useCallback((id: string | null, options: { reveal?: boolean; record?: boolean } = {}) => {
    const current = selectedRef.current
    if (current !== id) {
      if (options.record !== false && current && id) { navigation.current.back.push(current); navigation.current.forward = [] }
      selectedRef.current = id
      setSelectedId(id)
      forceNavRender((value) => value + 1)
    }
    if (id && options.reveal !== false) setCommand({ kind: 'reveal', id, nonce: next() })
  }, [])

  const goBack = useCallback(() => {
    const target = navigation.current.back.pop()
    if (!target || !tree.people[target]) return
    if (selectedId) navigation.current.forward.push(selectedId)
    select(target, { record: false })
  }, [select, selectedId, tree.people])
  const goForward = useCallback(() => {
    const target = navigation.current.forward.pop()
    if (!target || !tree.people[target]) return
    if (selectedId) navigation.current.back.push(selectedId)
    select(target, { record: false })
  }, [select, selectedId, tree.people])

  const apply = useCallback((nextTree: TreeDocument, label: string, coalesceKey?: string) => dispatch({ type: 'apply', tree: nextTree, label, coalesceKey }), [])

  /** Runs a structural operation; selects and focuses a newly created person. */
  const run = useCallback((label: string, op: () => OpResult | TreeDocument, options: { toast?: string } = {}) => {
    try {
      const result = op()
      const nextTree = 'schemaVersion' in result ? result : result.tree
      if (nextTree === tree) return
      dispatch({ type: 'apply', tree: nextTree, label })
      const created = 'schemaVersion' in result ? undefined : result.personId && !tree.people[result.personId] ? result.personId : undefined
      if (created) {
        select(created)
        setFocusRequest({ id: created, nonce: next() })
        setNewIds(new Set([created]))
        setTimeout(() => setNewIds(new Set()), 1200)
      }
      if (options.toast) setToast({ message: options.toast, undo: true, nonce: next() })
    } catch (error) { showError(error) }
  }, [tree, select, showError])

  // --- Relatives
  const familyLabel = useCallback((personId: string, familyId: string) => {
    const family = tree.families[familyId]
    const partner = family.partnerIds.find((id) => id !== personId)
    return partner ? t('family.with', { name: fullName(tree.people[partner]) }) : t('family.noSecondParent')
  }, [tree])

  const pickChildFamily = useCallback(async (personId: string, allowNew: boolean): Promise<string | undefined | null> => {
    const options = childFamilyOptions(tree, personId)
    if (options.length <= 1) return undefined
    const id = await choose({
      title: t('childFamily.title'),
      message: t('childFamily.message', { name: shortName(tree.people[personId]) }),
      options: [
        ...options.map((family) => ({ id: family.id, label: familyLabel(personId, family.id), detail: t('childFamily.children', { count: family.childIds.length }) })),
        ...(allowNew ? [{ id: 'new', label: t('childFamily.otherParent'), detail: t('childFamily.otherParentDetail') }] : []),
      ],
    })
    return id
  }, [tree, choose, familyLabel])

  const addRelative = useCallback(async (action: AddAction, personId: string, familyId?: string) => {
    const person = tree.people[personId]
    if (!person) return
    const name = shortName(person)
    switch (action) {
      case 'father': return run(t('history.add', { relation: 'father', name }), () => addParent(tree, personId, 'M'))
      case 'mother': return run(t('history.add', { relation: 'mother', name }), () => addParent(tree, personId, 'F'))
      case 'partner': return run(t('history.add', { relation: 'partner', name }), () => addPartner(tree, personId))
      case 'brother': return run(t('history.add', { relation: 'brother', name }), () => addSibling(tree, personId, 'M'))
      case 'sister': return run(t('history.add', { relation: 'sister', name }), () => addSibling(tree, personId, 'F'))
      case 'son': case 'daughter': {
        const target = familyId ?? await pickChildFamily(personId, true)
        if (target === null) return
        return run(t('history.add', { relation: action, name }), () => addChild(tree, personId, action === 'son' ? 'M' : 'F', target))
      }
    }
  }, [tree, run, pickChildFamily])

  const linkRelative = useCallback((kind: LinkKind, familyId?: string) => {
    if (!selectedId) return
    const person = tree.people[selectedId]
    const relatives = relativesOf(tree, selectedId, index)
    const titles: Record<LinkKind, string> = {
      parent: t('pick.parent', { name: fullName(person) }),
      partner: t('pick.partner', { name: fullName(person) }),
      child: t('pick.child', { name: fullName(person) }),
      sibling: t('pick.sibling', { name: fullName(person) }),
    }
    const filter = (candidate: Person) => {
      if (candidate.id === selectedId) return false
      if (kind === 'parent') return !relatives.parents.includes(candidate.id) && !isSelfOrDescendant(tree, selectedId, candidate.id, index)
      if (kind === 'child') return !relatives.children.includes(candidate.id) && !isSelfOrDescendant(tree, candidate.id, selectedId, index)
      if (kind === 'partner') return !relatives.partners.includes(candidate.id)
      return !relatives.siblings.includes(candidate.id)
    }
    setPalette({
      mode: 'pick', title: titles[kind], filter,
      onPick: async (otherId) => {
        setPalette(null)
        const other = shortName(tree.people[otherId])
        if (kind === 'parent') run(t('history.link', { kind, name: other }), () => linkParent(tree, selectedId, otherId))
        else if (kind === 'partner') run(t('history.link', { kind, name: other }), () => linkPartner(tree, selectedId, otherId))
        else if (kind === 'sibling') run(t('history.link', { kind, name: other }), () => linkSibling(tree, selectedId, otherId))
        else {
          const target = familyId ?? await pickChildFamily(selectedId, false)
          if (target === null) return
          run(t('history.link', { kind, name: other }), () => linkChild(tree, selectedId, otherId, target))
        }
      },
    })
  }, [selectedId, tree, index, run, pickChildFamily])

  const unlinkRelative = useCallback((kind: LinkKind, otherId: string) => {
    if (!selectedId) return
    const a = shortName(tree.people[selectedId])
    const b = shortName(tree.people[otherId])
    const ops: Record<LinkKind, () => TreeDocument> = {
      parent: () => unlinkParent(tree, selectedId, otherId),
      child: () => unlinkParent(tree, otherId, selectedId),
      partner: () => unlinkPartner(tree, selectedId, otherId),
      sibling: () => unlinkSibling(tree, selectedId, otherId),
    }
    run(t('history.unlink', { a, b }), ops[kind], { toast: t('toast.unlinked', { a, b }) })
  }, [selectedId, tree, run])

  const removePerson = useCallback((id: string) => {
    const person = tree.people[id]
    if (!person) return
    const relatives = relativesOf(tree, id, index)
    const fallback = relatives.parents[0] ?? relatives.partners[0] ?? relatives.children[0] ?? relatives.siblings[0] ?? null
    run(t('history.delete', { name: shortName(person) }), () => deletePerson(tree, id), { toast: t('toast.deleted', { name: fullName(person) }) })
    select(fallback, { record: false })
    navigation.current.back = navigation.current.back.filter((entry) => entry !== id)
  }, [tree, index, run, select])

  const merge = useCallback(async (keepId: string, removeId: string) => {
    const keep = tree.people[keepId]
    const remove = tree.people[removeId]
    if (!keep || !remove) return
    const ok = await ask({
      title: t('merge.title'),
      message: <p>{t('merge.message', { keep: fullName(keep), keepYears: lifespan(keep) || t('merge.noDates'), remove: fullName(remove), removeYears: lifespan(remove) || t('merge.noDates') })}</p>,
      confirmLabel: t('merge.confirm'),
    })
    if (!ok) return
    run(t('history.merge', { name: shortName(keep) }), () => mergePeople(tree, keepId, removeId), { toast: t('toast.merged', { remove: fullName(remove), keep: fullName(keep) }) })
    select(keepId, { record: false })
    navigation.current.back = navigation.current.back.filter((entry) => entry !== removeId)
  }, [tree, ask, run, select])

  const pickDuplicate = useCallback(() => {
    if (!selectedId) return
    setPalette({
      mode: 'pick', title: t('pick.duplicate', { name: fullName(tree.people[selectedId]) }),
      filter: (candidate) => candidate.id !== selectedId,
      onPick: (otherId) => { setPalette(null); void merge(selectedId, otherId) },
    })
  }, [selectedId, tree, merge])

  const markVerified = useCallback((id: string, verified: boolean) => {
    const person = tree.people[id]
    if (person) apply(setVerified(tree, id, verified), t(verified ? 'history.verified' : 'history.unverified', { name: shortName(person) }))
  }, [tree, apply])

  /** Explicit navigation only: marking a person never moves the selection. */
  const goToNextUnverified = useCallback((from: string | null) => {
    const target = nextUnverified(tree, from)
    if (target) select(target)
    else setToast({ message: t('toast.allVerified'), nonce: next() })
  }, [tree, select])

  const addFirst = useCallback(() => run(t('history.newPerson'), () => addPerson(tree)), [tree, run])

  // --- Documents
  const replaceDocument = useCallback(async (nextTree: TreeDocument, options: { confirm?: string; select?: string; focus?: boolean; exported?: boolean }) => {
    // Ask only when there is work that has not been downloaded (undo history resets on reload, so it is not a signal).
    const hasWork = Object.keys(tree.people).length > 0 && meta.changedSinceExport
    if (options.confirm && hasWork && !await ask({ title: t('replace.title'), message: options.confirm, confirmLabel: t('replace.confirm') })) return
    try { await snapshotNow(tree) } catch { /* the snapshot is a convenience; replacement proceeds */ }
    dispatch({ type: 'replace', tree: nextTree })
    navigation.current = { back: [], forward: [] }
    setMeta({ changedSinceExport: !options.exported })
    setSelectedId(options.select ?? null)
    setView('tree')
    setPalette(null)
    firstTree.current = nextTree
    if (options.focus && options.select) setFocusRequest({ id: options.select, nonce: next() })
  }, [tree, meta.changedSinceExport, ask])

  const replaceWarning = t('replace.warning')

  const openGedcom = useCallback(async (file: File) => {
    setBusy(t('busy.reading'))
    try {
      const imported = await readGedcom(file)
      setBusy(null)
      await replaceDocument(imported, { confirm: `${t('replace.openFile', { name: file.name, count: Object.keys(imported.people).length })} ${replaceWarning}`, select: Object.keys(imported.people)[0], exported: true })
    } catch (error) { showError(error) } finally { setBusy(null) }
  }, [replaceDocument, showError, replaceWarning])

  const openBackup = useCallback(async (file: File) => {
    try {
      if (file.size > 200 * 1024 * 1024) throw new AppError('backupTooLarge', { max: 200 })
      const draft = parseDraft(JSON.parse(await file.text()))
      await replaceDocument(draft.tree, { confirm: `${t('replace.openBackup', { name: draft.tree.title, count: Object.keys(draft.tree.people).length })} ${replaceWarning}`, exported: true })
    } catch (error) { showError(error instanceof SyntaxError ? new AppError('notBackup') : error) }
  }, [replaceDocument, showError, replaceWarning])

  const saveGedcom = useCallback(async () => {
    setBusy(t('busy.exporting'))
    try {
      await writeGedcom(tree)
      setMeta({ changedSinceExport: false, exportedAt: new Date().toISOString() })
      setToast({ message: t('toast.gedcomSaved'), nonce: next() })
    } catch (error) { showError(error) } finally { setBusy(null) }
  }, [tree, showError])

  const fileActions = useMemo(() => ({
    onNew: () => { const created = createNewTree(); void replaceDocument(created.tree, { confirm: replaceWarning, select: created.personId, focus: true }) },
    onOpenGedcom: () => gedcomInput.current?.click(),
    onSaveGedcom: () => void saveGedcom(),
    onDownloadBackup: () => { downloadBackup(tree); setMeta({ changedSinceExport: false, exportedAt: new Date().toISOString() }) },
    onOpenBackup: () => backupInput.current?.click(),
    onSnapshots: () => setShowSnapshots(true),
    onDemo: (count: number) => void replaceDocument(createDemo(count), { confirm: replaceWarning, select: 'I1', exported: true }),
  }), [replaceDocument, saveGedcom, tree, replaceWarning])

  const restoreSnapshot = useCallback((snapshot: Snapshot) => {
    setShowSnapshots(false)
    void replaceDocument(snapshot.tree, { confirm: `${t('replace.restore', { date: formatDateTime(snapshot.savedAt) })} ${replaceWarning}` })
  }, [replaceDocument, replaceWarning])

  // --- Keyboard
  const spatialMove = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
    if (!selectedId) return
    const positions = layout.positions
    const origin = positions[selectedId]
    if (!origin) return
    const relatives = relativesOf(tree, selectedId, index)
    const nearest = (ids: string[]) => ids.filter((id) => positions[id]).sort((a, b) => Math.abs(positions[a].x - origin.x) - Math.abs(positions[b].x - origin.x))[0]
    let target: string | undefined
    if (direction === 'up') target = nearest(relatives.parents)
    else if (direction === 'down') target = nearest(relatives.children)
    else {
      let best: string | undefined
      let bestDistance = Infinity
      for (const id of Object.keys(tree.people)) {
        const point = positions[id]
        if (!point || Math.abs(point.y - origin.y) > 4 || id === selectedId) continue
        const distance = direction === 'left' ? origin.x - point.x : point.x - origin.x
        if (distance > 0 && distance < bestDistance) { best = id; bestDistance = distance }
      }
      target = best
    }
    if (target) select(target)
  }, [selectedId, layout.positions, tree, index, select])

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (palette || confirmRequest || choiceRequest || showHelp || showSnapshots) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.code === 'KeyK') { event.preventDefault(); setPalette({ mode: 'search' }); return }
      if (mod && event.code === 'KeyS') { event.preventDefault(); void saveGedcom(); return }
      if (mod && (event.code === 'KeyZ' || event.code === 'KeyY')) {
        if (isTyping(event.target)) return
        event.preventDefault()
        dispatch({ type: event.code === 'KeyY' || event.shiftKey ? 'redo' : 'undo' })
        return
      }
      if (isTyping(event.target)) {
        if (event.key === 'Escape') (event.target as HTMLElement).blur()
        return
      }
      if (mod) return
      if (event.code === 'Slash' && event.shiftKey) { event.preventDefault(); setShowHelp(true); return }
      if (event.key === '/' || (event.code === 'Slash' && !event.shiftKey)) { event.preventDefault(); setPalette({ mode: 'search' }); return }
      if (event.code === 'Digit0') { setView('tree'); setCommand({ kind: 'fit', nonce: next() }); return }
      if (event.key === 'Escape') { if (selectedId) select(null, { reveal: false }); return }
      if (event.code === 'Space' && reviewMode) {
        event.preventDefault()
        if (selectedId) markVerified(selectedId, !marks[selectedId])
        return
      }
      if (!selectedId) return
      if (event.altKey && event.key === 'ArrowLeft') { event.preventDefault(); goBack(); return }
      if (event.altKey && event.key === 'ArrowRight') { event.preventDefault(); goForward(); return }
      if (event.altKey) return
      const arrows: Record<string, 'up' | 'down' | 'left' | 'right'> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
      if (arrows[event.key] && view === 'tree') { event.preventDefault(); spatialMove(arrows[event.key]); return }
      if (event.code === 'Digit1') { setView('tree'); setCommand({ kind: 'center', id: selectedId, nonce: next() }); return }
      if (event.key === 'Enter') { event.preventDefault(); setFocusRequest({ id: selectedId, nonce: next() }); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removePerson(selectedId); return }
      const actions: Record<string, AddAction> = { KeyJ: 'father', KeyV: 'mother', KeyC: 'son', KeyL: 'daughter', KeyG: 'partner' }
      if (event.code === 'Comma') { event.preventDefault(); void addRelative(event.shiftKey ? 'sister' : 'brother', selectedId); return }
      if (actions[event.code] && !event.shiftKey) { event.preventDefault(); void addRelative(actions[event.code], selectedId) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [palette, confirmRequest, choiceRequest, showHelp, showSnapshots, selectedId, view, select, goBack, goForward, spatialMove, removePerson, addRelative, saveGedcom, reviewMode, marks, markVerified])

  const paletteCommands = useMemo<PaletteCommand[]>(() => [
    { id: 'add', label: t('commands.add'), icon: <UserPlus size={17} />, run: addFirst, keywords: t('commands.addKeywords') },
    { id: 'save', label: t('commands.save'), hint: 'Ctrl S', icon: <Save size={17} />, run: () => void saveGedcom(), keywords: t('commands.saveKeywords') },
    { id: 'open', label: t('commands.open'), icon: <FileUp size={17} />, run: () => gedcomInput.current?.click(), keywords: t('commands.openKeywords') },
    { id: 'fit', label: t('commands.fit'), hint: '0', icon: <Maximize size={17} />, run: () => { setView('tree'); setCommand({ kind: 'fit', nonce: next() }) } },
    { id: 'review', label: t(reviewMode ? 'commands.reviewOff' : 'commands.reviewOn'), icon: <FileSearch size={17} />, run: () => setReviewMode((value) => !value), keywords: t('commands.reviewKeywords') },
    { id: 'next-unverified', label: t('commands.nextUnverified'), icon: <FileSearch size={17} />, run: () => { setReviewMode(true); goToNextUnverified(selectedId) }, keywords: t('commands.nextUnverifiedKeywords') },
    { id: 'issues', label: t('commands.issues', { count: issues.length }), icon: <FileSearch size={17} />, run: () => setView('issues'), keywords: t('commands.issuesKeywords') },
  ], [addFirst, saveGedcom, issues.length, reviewMode, goToNextUnverified, selectedId, locale])

  const [recent, setRecent] = useState<string[]>([])
  useEffect(() => { if (selectedId) setRecent((current) => [selectedId, ...current.filter((id) => id !== selectedId)].slice(0, 12)) }, [selectedId])

  const selectedPerson = selectedId ? tree.people[selectedId] : undefined
  const openInTree = useCallback((id: string) => { setView('tree'); select(id, { reveal: false }); setCommand({ kind: 'center', id, nonce: next() }) }, [select])

  return <div className="app">
    <TopBar
      title={tree.title} onTitleChange={(title) => apply({ ...tree, title }, t('history.title'), 'title')} onTitleCommit={() => dispatch({ type: 'seal' })}
      view={view} onView={setView} issueCount={issues.length}
      canUndo={state.past.length > 0} canRedo={state.future.length > 0} undoLabel={state.past.at(-1)?.label} redoLabel={state.future.at(-1)?.label}
      onUndo={() => dispatch({ type: 'undo' })} onRedo={() => dispatch({ type: 'redo' })}
      onSearch={() => setPalette({ mode: 'search' })} saveState={saveState} meta={meta} onRetrySave={() => setSaveAttempt((value) => value + 1)}
      onHelp={() => setShowHelp(true)} file={fileActions}
      review={{ on: reviewMode, verified: verifiedCount, total: Object.keys(tree.people).length }} onToggleReview={() => setReviewMode((value) => !value)} />
    <div className="workspace">
      <main className="main-view">
        <div className="canvas" hidden={view !== 'tree'} aria-label={t('canvas.label')}>
          {layout.busy && layoutValid && <div className="layout-busy"><LoaderCircle className="spin" size={14} />{t('canvas.relayout')}</div>}
          {!layoutValid && Object.keys(tree.people).length > 0 && <div className="canvas-loading"><div>{layout.error ? <><strong>{t('canvas.layoutFailed')}</strong><span>{errorMessage(layout.error)}</span><button className="btn btn-primary" onClick={() => setLayoutAttempt((value) => value + 1)}>{t('canvas.retry')}</button></> : <><LoaderCircle className="spin" size={26} /><strong>{t('canvas.placing', { count: Object.keys(tree.people).length })}</strong></>}</div></div>}
          <TreeCanvas tree={tree} positions={layoutValid ? layout.positions : {}} selectedId={selectedId} lineage={lineage} newIds={newIds} command={command}
            onSelect={(id) => { select(id, { reveal: false }); if (id && !tree.people[id]?.givenName.trim()) setFocusRequest({ id, nonce: next() }) }} onAction={(action, id) => void addRelative(action, id)} onOpen={(id) => setFocusRequest({ id, nonce: next() })}
            onAddFirst={addFirst} layoutMs={layoutValid ? layout.durationMs : undefined} highlight={highlight} onToggleHighlight={() => setHighlight((value) => !value)} visible={view === 'tree'} review={reviewMode ? marks : null} />
        </div>
        {view === 'table' && <PeopleTable tree={deferredTree} index={deferredIndex} review={reviewMode ? deferredTree.verified ?? NO_MARKS : null} selectedId={selectedId} onSelect={(id) => select(id, { reveal: false })} onOpen={openInTree} />}
        {view === 'issues' && <IssuesView tree={deferredTree} index={deferredIndex} issues={issues} selectedId={selectedId} onSelect={(id) => select(id, { reveal: false })} onShow={openInTree} onMerge={(keepId, removeId) => void merge(keepId, removeId)} />}
      </main>
      {selectedPerson && <Inspector
        key={selectedPerson.id} tree={tree} index={index} person={selectedPerson} focusRequest={focusRequest} onFocusHandled={() => setFocusRequest(null)} suggestions={suggestions}
        canBack={navigation.current.back.length > 0} canForward={navigation.current.forward.length > 0} onBack={goBack} onForward={goForward}
        onChange={(fields: Partial<PersonFields>, coalesceKey) => apply(updatePerson(tree, selectedPerson.id, fields), t('history.edit', { name: shortName(selectedPerson) }), coalesceKey && `${selectedPerson.id}:${coalesceKey}`)}
        onCommit={() => dispatch({ type: 'seal' })}
        onFamilyChange={(familyId, fields, coalesceKey) => apply(updateFamily(tree, familyId, fields), t('history.editMarriage'), coalesceKey && `${familyId}:${coalesceKey}`)}
        onAdd={(action, familyId) => void addRelative(action, selectedPerson.id, familyId)}
        onLink={linkRelative} onUnlink={unlinkRelative}
        onSelect={(id) => select(id)} onCenter={() => { setView('tree'); setCommand({ kind: 'center', id: selectedPerson.id, nonce: next() }) }}
        onDelete={() => removePerson(selectedPerson.id)} onMerge={pickDuplicate}
        review={reviewMode ? { verifiedAt: marks[selectedPerson.id] } : null} onVerify={(value) => markVerified(selectedPerson.id, value)}
        onNextUnverified={() => goToNextUnverified(selectedPerson.id)} onClose={() => select(null, { reveal: false })} />}
    </div>

    <datalist id="dl-surnames">{suggestions.surnames.map((value) => <option key={value} value={value} />)}</datalist>
    <datalist id="dl-male">{suggestions.maleNames.map((value) => <option key={value} value={value} />)}</datalist>
    <datalist id="dl-female">{suggestions.femaleNames.map((value) => <option key={value} value={value} />)}</datalist>
    <datalist id="dl-places">{suggestions.places.map((value) => <option key={value} value={value} />)}</datalist>
    <input ref={gedcomInput} type="file" accept=".ged,.GED" hidden data-testid="gedcom-input" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openGedcom(file); event.target.value = '' }} />
    <input ref={backupInput} type="file" accept=".json,application/json" hidden data-testid="backup-input" onChange={(event) => { const file = event.target.files?.[0]; if (file) void openBackup(file); event.target.value = '' }} />

    {palette?.mode === 'search' && <CommandPalette tree={tree} index={index} commands={paletteCommands} recentIds={recent}
      onPick={(id) => { setPalette(null); if (view !== 'tree' && view !== 'table') setView('tree'); select(id) }} onClose={() => setPalette(null)} />}
    {palette?.mode === 'pick' && <CommandPalette tree={tree} index={index} title={palette.title} filter={palette.filter} recentIds={recent} placeholder={t('pick.placeholder')}
      onPick={palette.onPick} onClose={() => setPalette(null)} />}
    {confirmRequest && <ConfirmDialog request={confirmRequest} />}
    {choiceRequest && <ChoiceDialog request={choiceRequest} />}
    {showHelp && <ShortcutsDialog onClose={() => setShowHelp(false)} />}
    {showSnapshots && <SnapshotsDialog onRestore={restoreSnapshot} onClose={() => setShowSnapshots(false)} />}
    {toast && <Toast toast={toast} onUndo={() => dispatch({ type: 'undo' })} onClose={() => setToast(null)} />}
    {busy && <div className="file-busy" role="status"><div><LoaderCircle className="spin" size={26} />{busy}<small>{t('busy.local')}</small></div></div>}
  </div>
}
