import type { TreeDocument } from './tree'

// Snapshot history. Documents are immutable with structural sharing, so each entry is cheap.

const LIMIT = 300

interface Entry { tree: TreeDocument; label: string }
export interface EditorState {
  tree: TreeDocument
  past: Entry[]
  future: Entry[]
  /** Consecutive changes with the same key (e.g. typing in one field) merge into one undo step. */
  coalesceKey?: string
}

export type EditorAction =
  | { type: 'replace'; tree: TreeDocument }
  | { type: 'apply'; tree: TreeDocument; label: string; coalesceKey?: string }
  | { type: 'seal' }
  | { type: 'undo' }
  | { type: 'redo' }

export function initialEditorState(tree: TreeDocument): EditorState {
  return { tree, past: [], future: [] }
}

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case 'replace':
      return initialEditorState(action.tree)
    case 'apply': {
      if (action.tree === state.tree) return state
      if (action.coalesceKey && action.coalesceKey === state.coalesceKey) return { ...state, tree: action.tree, future: [] }
      return { tree: action.tree, past: [...state.past.slice(-(LIMIT - 1)), { tree: state.tree, label: action.label }], future: [], coalesceKey: action.coalesceKey }
    }
    case 'seal':
      return state.coalesceKey ? { ...state, coalesceKey: undefined } : state
    case 'undo': {
      const entry = state.past.at(-1)
      if (!entry) return state
      return { tree: entry.tree, past: state.past.slice(0, -1), future: [...state.future, { tree: state.tree, label: entry.label }] }
    }
    case 'redo': {
      const entry = state.future.at(-1)
      if (!entry) return state
      return { tree: entry.tree, past: [...state.past, { tree: state.tree, label: entry.label }], future: state.future.slice(0, -1) }
    }
  }
}
