import { useEffect, useRef, useState } from 'react'
import { AppError, errorFromData, type ErrorData } from '../shared/errors'
import type { LayoutInput, LayoutResult } from './layout/layout'
import type { Positions } from './model/tree'

/** `docId` identifies the document the positions belong to, so a new document never shows stale positions. */
export interface LayoutState { positions: Positions; docId?: string; busy: boolean; durationMs?: number; error?: Error }

/**
 * Runs layout in a persistent Worker whenever the structure key changes.
 * Previous positions stay on screen until the new result arrives; stale results are ignored.
 */
export function useLayout(input: LayoutInput, structureKey: string, docId: string, attempt: number): LayoutState {
  const [state, setState] = useState<LayoutState>({ positions: {}, busy: true })
  const workerRef = useRef<Worker | null>(null)
  const requestRef = useRef(0)
  const inputRef = useRef({ input, docId })
  inputRef.current = { input, docId }

  useEffect(() => () => { workerRef.current?.terminate(); workerRef.current = null }, [])

  useEffect(() => {
    const requestId = ++requestRef.current
    if (!workerRef.current) workerRef.current = new Worker(new URL('./layout/layout.worker.ts', import.meta.url), { type: 'module' })
    const worker = workerRef.current
    setState((previous) => ({ ...previous, busy: true, error: undefined }))
    const timeout = setTimeout(() => {
      if (requestId !== requestRef.current) return
      worker.terminate()
      workerRef.current = null
      setState((previous) => ({ ...previous, busy: false, error: new AppError('layoutTimeout') }))
    }, 60_000)
    worker.onmessage = (event: MessageEvent<LayoutResult & { requestId: number; ok: boolean; error?: ErrorData }>) => {
      if (event.data.requestId !== requestRef.current) return
      clearTimeout(timeout)
      if (event.data.ok) setState({ positions: event.data.positions, docId: requestDoc, busy: false, durationMs: event.data.durationMs })
      else setState((previous) => ({ ...previous, busy: false, error: errorFromData(event.data.error, 'layoutFailed') }))
    }
    worker.onerror = () => {
      clearTimeout(timeout)
      setState((previous) => ({ ...previous, busy: false, error: new AppError('layoutWorkerFailed') }))
    }
    const requestDoc = inputRef.current.docId
    worker.postMessage({ requestId, input: inputRef.current.input })
    return () => clearTimeout(timeout)
  }, [structureKey, attempt])

  return state
}

/** True when keyboard focus is in a text field, where single-key shortcuts must not fire. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null
  if (!element) return false
  if (element.isContentEditable || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
  return element.tagName === 'INPUT' && !['file', 'checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes((element as HTMLInputElement).type)
}
