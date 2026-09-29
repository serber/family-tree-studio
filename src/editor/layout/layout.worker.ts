import { layoutTree, type LayoutInput } from './layout'
import { errorToData } from '../../shared/errors'

self.onmessage = (event: MessageEvent<{ requestId: number; input: LayoutInput }>) => {
  const { requestId, input } = event.data
  try {
    self.postMessage({ requestId, ok: true, ...layoutTree(input) })
  } catch (error) {
    self.postMessage({ requestId, ok: false, error: errorToData(error) })
  }
}
