import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import {
  Background, BackgroundVariant, Handle, MiniMap, Panel, Position, ReactFlow, useReactFlow, useStore,
  type Edge, type Node, type NodeProps, type ReactFlowState,
} from '@xyflow/react'
import { Check, Crosshair, GitBranch, Maximize, Minus, Plus, UserPlus } from 'lucide-react'
import { CARD_HEIGHT, CARD_WIDTH, JUNCTION_SIZE, familyNodeId } from '../layout/geometry'
import { lifespan, type Person, type Positions, type TreeDocument } from '../model/tree'
import { formatNumber } from '../../shared/i18n'
import { useLocale } from '../../shared/i18n/react'
import { t } from '../i18n'

export type AddAction = 'father' | 'mother' | 'son' | 'daughter' | 'partner' | 'brother' | 'sister'

type Review = 'verified' | 'unverified' | undefined
type PersonNodeType = Node<{ person: Person; hasFather: boolean; hasMother: boolean; review: Review }, 'person'>
type JunctionNodeType = Node<{ lineage: boolean }, 'family'>
type TreeNode = PersonNodeType | JunctionNodeType
type Detail = 'overview' | 'compact' | 'full'

const DetailContext = createContext<Detail>('full')
const ActionContext = createContext<(action: AddAction, personId: string) => void>(() => {})
const selectDetail = (state: ReactFlowState): Detail => state.transform[2] < 0.2 ? 'overview' : state.transform[2] < 0.45 ? 'compact' : 'full'
const selectZoom = (state: ReactFlowState) => state.transform[2]

function AddPill({ label, hint, onClick }: { label: string; hint: string; onClick: () => void }) {
  return <button className="add-pill nodrag nopan" onClick={(event) => { event.stopPropagation(); onClick() }} title={`${label} (${hint})`}>
    <Plus size={12} strokeWidth={2.6} />{label}<kbd>{hint}</kbd>
  </button>
}

const PersonNode = memo(function PersonNode({ data, selected }: NodeProps<PersonNodeType>) {
  useLocale()
  const detail = useContext(DetailContext)
  const act = useContext(ActionContext)
  const { person } = data
  const given = [person.givenName, person.patronymic].filter(Boolean).join(' ')
  const unnamed = !person.surname && !given
  const years = lifespan(person)
  const partnerLabel = t('relation.partnerOf', { sex: person.sex })
  return (
    <div className={`person-card sex-${person.sex} detail-${detail} ${selected ? 'is-selected' : ''} ${data.review ? `is-${data.review}` : ''}`}>
      {data.review === 'verified' && <span className="review-badge ok" title={t('review.verified')}><Check size={11} strokeWidth={3.2} /></span>}
      {data.review === 'unverified' && <span className="review-badge todo" title={t('review.unverified')}>!</span>}
      <Handle type="target" id="t" position={Position.Top} isConnectable={false} />
      <Handle type="source" id="l" position={Position.Left} isConnectable={false} />
      <Handle type="source" id="r" position={Position.Right} isConnectable={false} />
      {detail === 'overview' ? <div className="person-text"><div className="person-surname">{person.surname || given || '?'}</div></div>
        : <div className="person-text">
          {unnamed ? <div className="person-surname person-unnamed">{t('person.unnamed')}</div> : <>
            <div className="person-surname">{person.surname || <span className="person-unnamed">{t('person.surnameMissing')}</span>}</div>
            <div className="person-given">{given || <span className="person-unnamed">{t('person.givenMissing')}</span>}</div>
          </>}
          {detail === 'full' && years && <div className="person-years">{years}</div>}
        </div>}
      <Handle type="source" id="b" position={Position.Bottom} isConnectable={false} />
      {selected && detail !== 'overview' && <>
        <div className="card-actions top">
          {!data.hasFather && <AddPill label={t('relation.father')} hint={t('keys.father')} onClick={() => act('father', person.id)} />}
          {!data.hasMother && <AddPill label={t('relation.mother')} hint={t('keys.mother')} onClick={() => act('mother', person.id)} />}
          <AddPill label={t('relation.brother')} hint={t('keys.brother')} onClick={() => act('brother', person.id)} />
          <AddPill label={t('relation.sister')} hint={t('keys.sister')} onClick={() => act('sister', person.id)} />
        </div>
        <div className="card-actions bottom">
          <AddPill label={t('relation.son')} hint={t('keys.son')} onClick={() => act('son', person.id)} />
          <AddPill label={t('relation.daughter')} hint={t('keys.daughter')} onClick={() => act('daughter', person.id)} />
          <AddPill label={partnerLabel} hint={t('keys.partner')} onClick={() => act('partner', person.id)} />
        </div>
      </>}
    </div>
  )
})

const FamilyNode = memo(function FamilyNode({ data }: NodeProps<JunctionNodeType>) {
  return <div className={`family-junction ${data.lineage ? 'is-lineage' : ''}`}>
    <Handle type="target" id="l" position={Position.Left} isConnectable={false} />
    <Handle type="target" id="r" position={Position.Right} isConnectable={false} />
    <Handle type="target" id="t" position={Position.Top} isConnectable={false} />
    <Handle type="source" id="b" position={Position.Bottom} isConnectable={false} />
  </div>
})

const nodeTypes = { person: PersonNode, family: FamilyNode }
const defaultEdgeOptions = { type: 'smoothstep', selectable: false, focusable: false, interactionWidth: 0, pathOptions: { borderRadius: 10 } }
const miniColor = (node: Node) => {
  if (node.type === 'family') return 'transparent'
  const data = node.data as PersonNodeType['data']
  if (data.review) return node.selected ? 'var(--accent)' : data.review === 'verified' ? 'var(--ok)' : 'var(--todo)'
  const sex = data.person.sex
  return node.selected ? 'var(--accent)' : sex === 'M' ? 'var(--male)' : sex === 'F' ? 'var(--female)' : 'var(--unknown)'
}

export interface CanvasCommand { kind: 'reveal' | 'center' | 'fit'; id?: string; nonce: number }

interface Props {
  tree: TreeDocument
  positions: Positions
  selectedId: string | null
  /** Ancestors, descendants, and the selected person; others are dimmed. Null disables highlighting. */
  lineage: Set<string> | null
  newIds: Set<string>
  command: CanvasCommand | null
  onSelect: (id: string | null) => void
  onAction: (action: AddAction, personId: string) => void
  onOpen: (id: string) => void
  onAddFirst: () => void
  layoutMs?: number
  highlight: boolean
  onToggleHighlight: () => void
  /** Viewport commands wait while the canvas is hidden (zero size would produce NaN transforms). */
  visible: boolean
  /** Review mode: person ID → verification time; null when review mode is off. */
  review: Record<string, string> | null
}

export function TreeCanvas({ tree, positions, selectedId, lineage, newIds, command, onSelect, onAction, onOpen, onAddFirst, layoutMs, highlight, onToggleHighlight, visible, review }: Props) {
  const detail = useStore(selectDetail)
  const flow = useReactFlow()
  const cache = useRef(new Map<string, TreeNode>())

  const parentSexes = useMemo(() => {
    const result = new Map<string, { father: boolean; mother: boolean }>()
    for (const family of Object.values(tree.families)) {
      const father = family.partnerIds.some((id) => tree.people[id]?.sex === 'M')
      const mother = family.partnerIds.some((id) => tree.people[id]?.sex === 'F')
      const full = family.partnerIds.length >= 2
      for (const child of family.childIds) {
        const previous = result.get(child) ?? { father: false, mother: false }
        result.set(child, { father: previous.father || father || full, mother: previous.mother || mother || full })
      }
    }
    return result
  }, [tree.families, tree.people])

  const nodes = useMemo(() => {
    const next: TreeNode[] = []
    const seen = new Map<string, TreeNode>()
    for (const person of Object.values(tree.people)) {
      const position = positions[person.id]
      if (!position) continue
      const selected = person.id === selectedId
      const className = [lineage && !lineage.has(person.id) ? 'is-dimmed' : '', newIds.has(person.id) ? 'is-new' : ''].filter(Boolean).join(' ')
      const parents = parentSexes.get(person.id)
      const hasFather = !!parents?.father
      const hasMother = !!parents?.mother
      const reviewState: Review = review ? (review[person.id] ? 'verified' : 'unverified') : undefined
      const old = cache.current.get(person.id) as PersonNodeType | undefined
      const node: PersonNodeType = old && old.data.person === person && old.selected === selected && old.className === className &&
        old.position === position && old.data.hasFather === hasFather && old.data.hasMother === hasMother && old.data.review === reviewState ? old
        : { id: person.id, type: 'person', position, data: { person, hasFather, hasMother, review: reviewState }, selected, className, width: CARD_WIDTH, height: CARD_HEIGHT, draggable: false, connectable: false, ariaLabel: `${person.surname} ${person.givenName}`.trim() || t('person.unnamed') }
      seen.set(person.id, node)
      next.push(node)
    }
    for (const family of Object.values(tree.families)) {
      const id = familyNodeId(family.id)
      const position = positions[id]
      if (!position) continue
      const inLineage = !!lineage && family.childIds.some((child) => lineage.has(child)) && family.partnerIds.some((partner) => lineage.has(partner))
      const className = lineage && !inLineage ? 'is-dimmed' : ''
      const old = cache.current.get(id) as JunctionNodeType | undefined
      const node: JunctionNodeType = old && old.position === position && old.data.lineage === inLineage && old.className === className ? old
        : { id, type: 'family', position, data: { lineage: inLineage }, className, width: JUNCTION_SIZE, height: JUNCTION_SIZE, selectable: false, draggable: false, focusable: false, connectable: false }
      seen.set(id, node)
      next.push(node)
    }
    cache.current = seen
    return next
  }, [tree.people, tree.families, positions, selectedId, lineage, newIds, parentSexes, review])

  // Couples: a straight marriage line from each partner's side to the junction between them.
  // Children: a stepped line from the junction down to each child.
  const edges = useMemo<Edge[]>(() => Object.values(tree.families).flatMap((family) => {
    const junctionId = familyNodeId(family.id)
    const junction = positions[junctionId]
    if (!junction) return []
    const inLineage = !!lineage && family.childIds.some((child) => lineage.has(child)) && family.partnerIds.some((partner) => lineage.has(partner))
    const edgeClass = (personId: string) => lineage ? (inLineage && lineage.has(personId) ? 'is-lineage' : 'is-dimmed') : ''
    const couple = family.partnerIds.length === 2
    return [
      ...family.partnerIds.map((id): Edge => {
        const left = (positions[id]?.x ?? 0) + CARD_WIDTH / 2 < junction.x
        return couple
          ? { id: `${family.id}:p:${id}`, source: id, target: junctionId, sourceHandle: left ? 'r' : 'l', targetHandle: left ? 'l' : 'r', type: 'straight', className: edgeClass(id) }
          : { id: `${family.id}:p:${id}`, source: id, target: junctionId, sourceHandle: 'b', targetHandle: 't', type: 'straight', className: edgeClass(id) }
      }),
      ...family.childIds.map((id): Edge => ({ id: `${family.id}:c:${id}`, source: junctionId, target: id, sourceHandle: 'b', targetHandle: 't', className: edgeClass(id) })),
    ]
  }), [tree.families, lineage, positions])

  // Keep the selected card fixed on screen when a relayout moves it.
  const previousPositions = useRef<Positions>(positions)
  useEffect(() => {
    const before = previousPositions.current
    previousPositions.current = positions
    if (before === positions || !selectedId || !visible) return
    const from = before[selectedId]
    const to = positions[selectedId]
    if (!from || !to || (from.x === to.x && from.y === to.y)) return
    const viewport = flow.getViewport()
    void flow.setViewport({ x: viewport.x - (to.x - from.x) * viewport.zoom, y: viewport.y - (to.y - from.y) * viewport.zoom, zoom: viewport.zoom })
  }, [positions, selectedId, flow, visible])

  // Commands: reveal (pan only if off-screen), center, fit.
  const handled = useRef(0)
  useEffect(() => {
    if (!command || command.nonce === handled.current || !visible) return
    if (command.kind === 'fit') {
      handled.current = command.nonce
      void flow.fitView({ padding: 0.08, duration: 400, minZoom: 0.02, maxZoom: 1 })
      return
    }
    const position = command.id ? positions[command.id] : undefined
    if (!position) return
    handled.current = command.nonce
    const centre = { x: position.x + CARD_WIDTH / 2, y: position.y + CARD_HEIGHT / 2 }
    const viewport = flow.getViewport()
    const element = document.querySelector('.canvas .react-flow')
    const width = element?.clientWidth ?? window.innerWidth
    const height = element?.clientHeight ?? window.innerHeight
    const screenX = centre.x * viewport.zoom + viewport.x
    const screenY = centre.y * viewport.zoom + viewport.y
    const margin = 140
    const onScreen = screenX > margin && screenX < width - margin && screenY > margin && screenY < height - margin
    if (command.kind === 'center' || !onScreen || viewport.zoom < 0.45) {
      void flow.setCenter(centre.x, centre.y, { zoom: command.kind === 'center' ? Math.max(viewport.zoom, 0.9) : Math.max(viewport.zoom, 0.75), duration: 350 })
    }
  }, [command, positions, flow, visible])

  const handleClick = useCallback((_event: unknown, node: TreeNode) => { if (node.type === 'person') onSelect(node.id) }, [onSelect])
  const handleDoubleClick = useCallback((_event: unknown, node: TreeNode) => { if (node.type === 'person') onOpen(node.id) }, [onOpen])
  const peopleCount = Object.keys(tree.people).length

  return <DetailContext.Provider value={detail}>
    <ActionContext.Provider value={onAction}>
      <ReactFlow<TreeNode>
        nodes={nodes} edges={edges} nodeTypes={nodeTypes} defaultEdgeOptions={defaultEdgeOptions}
        onNodeClick={handleClick} onNodeDoubleClick={handleDoubleClick} onPaneClick={() => onSelect(null)}
        minZoom={0.02} maxZoom={2} nodesDraggable={false} nodesConnectable={false} elementsSelectable={false}
        edgesFocusable={false} nodesFocusable={false} deleteKeyCode={null} selectionKeyCode={null} multiSelectionKeyCode={null}
        panOnScroll panActivationKeyCode={null} zoomOnDoubleClick={false} onlyRenderVisibleElements
        defaultViewport={{ x: 80, y: 80, zoom: 0.9 }} attributionPosition="top-right"
      >
        <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="var(--border-strong)" />
        <MiniMap nodeColor={miniColor} nodeStrokeWidth={0} pannable zoomable ariaLabel={t('canvas.minimap')} position="bottom-right" />
        <Panel position="bottom-left" className="canvas-stats">{t('canvas.stats', { people: peopleCount, families: Object.keys(tree.families).length })}{layoutMs !== undefined ? ` · ${t('canvas.layoutMs', { ms: formatNumber(Math.round(layoutMs)) })}` : ''}</Panel>
        <ViewControls selectedId={selectedId} positions={positions} highlight={highlight} onToggleHighlight={onToggleHighlight} />
      </ReactFlow>
      {peopleCount === 0 && <div className="canvas-empty"><div>
        <strong style={{ fontSize: 17, color: 'var(--text)' }}>{t('canvas.empty')}</strong>
        <span>{t('canvas.emptyHint')}</span>
        <button className="btn btn-primary btn-lg" onClick={onAddFirst}><UserPlus size={18} />{t('canvas.addFirst')}</button>
      </div></div>}
    </ActionContext.Provider>
  </DetailContext.Provider>
}

function ViewControls({ selectedId, positions, highlight, onToggleHighlight }: { selectedId: string | null; positions: Positions; highlight: boolean; onToggleHighlight: () => void }) {
  const flow = useReactFlow()
  const zoom = useStore(selectZoom)
  const centre = () => {
    const position = selectedId ? positions[selectedId] : undefined
    if (position) void flow.setCenter(position.x + CARD_WIDTH / 2, position.y + CARD_HEIGHT / 2, { zoom: Math.max(zoom, 0.9), duration: 300 })
  }
  return <Panel position="bottom-center" className="canvas-controls">
    <button className="icon-btn" onClick={() => void flow.zoomOut({ duration: 160 })} aria-label={t('canvas.zoomOut')} title={t('canvas.zoomOut')}><Minus size={16} /></button>
    <span className="zoom-value">{Math.round(zoom * 100)}%</span>
    <button className="icon-btn" onClick={() => void flow.zoomIn({ duration: 160 })} aria-label={t('canvas.zoomIn')} title={t('canvas.zoomIn')}><Plus size={16} /></button>
    <span className="sep" />
    <button className="btn btn-ghost btn-sm" onClick={centre} disabled={!selectedId} title={t('canvas.toSelectedTitle')}><Crosshair size={15} />{t('canvas.toSelected')}</button>
    <button className="btn btn-ghost btn-sm" onClick={() => void flow.fitView({ padding: 0.08, duration: 400, minZoom: 0.02, maxZoom: 1 })} title={t('canvas.fitTitle')}><Maximize size={15} />{t('canvas.fit')}</button>
    <span className="sep" />
    <button className="btn btn-ghost btn-sm" aria-pressed={highlight} onClick={onToggleHighlight} title={t('canvas.lineageTitle')}><GitBranch size={15} />{t(highlight ? 'canvas.lineageOn' : 'canvas.lineageOff')}</button>
  </Panel>
}
