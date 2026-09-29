import { importGedcomBytes } from './parser'
import { exportGedcom } from './serializer'
import { errorToData } from '../../shared/errors'
import { setLocale, type Locale } from '../../shared/i18n'
import type { TreeDocument } from '../model/tree'

type Request = { locale: Locale } & ({ operation: 'import'; bytes: ArrayBuffer; fileName: string } | { operation: 'export'; tree: TreeDocument })

self.onmessage = (event: MessageEvent<Request>) => {
  setLocale(event.data.locale)
  try {
    self.postMessage(event.data.operation === 'import'
      ? { ok: true, tree: importGedcomBytes(event.data.bytes, event.data.fileName) }
      : { ok: true, text: exportGedcom(event.data.tree) })
  } catch (error) {
    self.postMessage({ ok: false, error: errorToData(error) })
  }
}
