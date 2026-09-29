import { AppError, errorFromData, type ErrorData } from '../../shared/errors'
import { getLocale } from '../../shared/i18n'
import type { TreeDocument } from '../model/tree'
import { downloadFile, safeFileName } from '../storage'

type Request = { operation: 'import'; bytes: ArrayBuffer; fileName: string } | { operation: 'export'; tree: TreeDocument }

function runWorker<T>(request: Request): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./gedcom.worker.ts', import.meta.url), { type: 'module' })
    const cleanup = () => { clearTimeout(timer); worker.terminate() }
    const timer = setTimeout(() => { cleanup(); reject(new AppError('gedcomTimeout')) }, 60_000)
    worker.onmessage = (event: MessageEvent<T & { ok: boolean; error?: ErrorData }>) => {
      cleanup()
      if (event.data.ok) resolve(event.data)
      else reject(errorFromData(event.data.error, 'gedcomFailed'))
    }
    worker.onerror = () => { cleanup(); reject(new AppError('gedcomWorkerFailed')) }
    worker.postMessage({ ...request, locale: getLocale() }, request.operation === 'import' ? [request.bytes] : [])
  })
}

export async function readGedcom(file: File): Promise<TreeDocument> {
  if (file.size > 20 * 1024 * 1024) throw new AppError('fileTooLarge', { max: 20 })
  const result = await runWorker<{ tree: TreeDocument }>({ operation: 'import', bytes: await file.arrayBuffer(), fileName: file.name })
  return result.tree
}

/** Exports in a Worker and downloads `<title>.ged`. */
export async function writeGedcom(tree: TreeDocument): Promise<void> {
  const result = await runWorker<{ text: string }>({ operation: 'export', tree })
  downloadFile(result.text, `${safeFileName(tree.title)}.ged`, 'text/plain;charset=utf-8')
}
