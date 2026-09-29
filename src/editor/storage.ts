import { del, get, set } from 'idb-keyval'
import { AppError } from '../shared/errors'
import { createSkeleton } from './gedcom/skeleton'
import { migrateDocument, type TreeDocument } from './model/tree'

// One working draft per browser origin, plus rolling snapshots for recovery.
// The `rodnye:` key prefix predates the Family Tree Studio name; it is kept so existing drafts still open.

export interface DraftMeta {
  /** When the document was last downloaded as GEDCOM or JSON. */
  exportedAt?: string
  /** Whether there are edits made after the last download. */
  changedSinceExport: boolean
  selectedId?: string
}
export interface Draft { version: 2; tree: TreeDocument; savedAt: string; meta: DraftMeta }
export interface Snapshot { savedAt: string; title: string; people: number; tree: TreeDocument }

const DRAFT_KEY = 'rodnye:draft:v1'
const SNAPSHOTS_KEY = 'rodnye:snapshots:v1'
const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000
const SNAPSHOT_LIMIT = 12
const LARGE_SOURCE = 2_000_000

export async function loadDraft(): Promise<Draft | undefined> {
  const value: unknown = await get(DRAFT_KEY)
  if (value === undefined) return undefined
  return parseDraft(value)
}

/** Validates a stored or downloaded draft; upgrades prototype drafts (version 1). */
export function parseDraft(value: unknown): Draft {
  const draft = value as { version?: number; tree?: unknown; savedAt?: unknown; meta?: DraftMeta }
  const tree = draft && (draft.version === 1 || draft.version === 2) ? migrateDocument(draft.tree, () => createSkeleton()) : undefined
  if (!tree) throw new AppError('draftFormat')
  const meta = draft.version === 2 && draft.meta && typeof draft.meta.changedSinceExport === 'boolean' ? draft.meta : { changedSinceExport: true }
  return { version: 2, tree, savedAt: typeof draft.savedAt === 'string' ? draft.savedAt : new Date().toISOString(), meta }
}

export async function saveDraft(tree: TreeDocument, meta: DraftMeta): Promise<void> {
  const savedAt = new Date().toISOString()
  await set(DRAFT_KEY, { version: 2, tree, savedAt, meta } satisfies Draft)
  await maybeSnapshot(tree, savedAt)
}

async function maybeSnapshot(tree: TreeDocument, savedAt: string) {
  const snapshots = await listSnapshots()
  const latest = snapshots[0]
  if (latest && latest.tree.id === tree.id && Date.parse(savedAt) - Date.parse(latest.savedAt) < SNAPSHOT_INTERVAL_MS) return
  const limit = tree.gedcom.text.length > LARGE_SOURCE ? 3 : SNAPSHOT_LIMIT
  const next = [{ savedAt, title: tree.title, people: Object.keys(tree.people).length, tree }, ...snapshots].slice(0, limit)
  await set(SNAPSHOTS_KEY, next)
}

/** Snapshots, newest first. Invalid entries are skipped. */
export async function listSnapshots(): Promise<Snapshot[]> {
  const value: unknown = await get(SNAPSHOTS_KEY)
  if (!Array.isArray(value)) return []
  return value.flatMap((entry: Snapshot) => {
    const tree = migrateDocument(entry?.tree, () => createSkeleton())
    return tree && typeof entry.savedAt === 'string' ? [{ ...entry, tree }] : []
  })
}

/** Takes a snapshot immediately, e.g. before replacing the document. */
export async function snapshotNow(tree: TreeDocument): Promise<void> {
  const snapshots = await listSnapshots()
  const limit = tree.gedcom.text.length > LARGE_SOURCE ? 3 : SNAPSHOT_LIMIT
  await set(SNAPSHOTS_KEY, [{ savedAt: new Date().toISOString(), title: tree.title, people: Object.keys(tree.people).length, tree }, ...snapshots].slice(0, limit))
}

export async function clearDraft(): Promise<void> {
  await del(DRAFT_KEY)
}

/** Asks the browser not to evict site data under storage pressure. Returns whether storage is persistent. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    return (await navigator.storage.persisted()) || (await navigator.storage.persist())
  } catch {
    return false
  }
}

export function downloadFile(content: string, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFileName(title: string): string {
  return title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'family-tree'
}

export function downloadBackup(tree: TreeDocument): void {
  const draft: Draft = { version: 2, tree, savedAt: new Date().toISOString(), meta: { changedSinceExport: false } }
  downloadFile(JSON.stringify(draft), `${safeFileName(tree.title)}.treestudio.json`, 'application/json')
}
