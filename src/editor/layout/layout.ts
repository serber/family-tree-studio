import { graphlib, layout } from '@dagrejs/dagre'
import { marriageOrders, type Family, type Positions, type TreeDocument } from '../model/tree'
import { CARD_HEIGHT, CARD_WIDTH, JUNCTION_SIZE, familyNodeId } from './geometry'

/**
 * Only structure is sent to the layout Worker: no names, dates, or GEDCOM source. `marriageOrder`
 * lists the unions of people married more than once, earliest first (derived from marriage years).
 */
export interface LayoutInput { personIds: string[]; families: Pick<Family, 'id' | 'partnerIds' | 'childIds'>[]; marriageOrder?: Record<string, string[]> }
export interface LayoutResult { positions: Positions; durationMs: number }

export const PARTNER_GAP = 28
const RANK_GAP = 44

export function layoutInput(tree: TreeDocument): LayoutInput {
  return {
    personIds: Object.keys(tree.people),
    families: Object.values(tree.families).map(({ id, partnerIds, childIds }) => ({ id, partnerIds, childIds })),
    marriageOrder: marriageOrders(tree.families),
  }
}

/**
 * People connected by marriages form one horizontal block, ordered along the chain of unions
 * (a person with two spouses sits between them). Blocks are laid out in layers with dagre; each
 * union is a small junction node between its block and the children's blocks. Spouses are
 * therefore always adjacent, and shared ancestors or repeated marriages never duplicate a person.
 */
export function layoutTree(input: LayoutInput): LayoutResult {
  const start = performance.now()
  const blocks = buildBlocks(input)
  const blockOf = new Map<string, number>()
  blocks.forEach((members, index) => members.forEach((id) => blockOf.set(id, index)))

  const graph = new graphlib.Graph()
  graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: RANK_GAP, marginx: 40, marginy: 40, ranker: 'network-simplex' })
  graph.setDefaultEdgeLabel(() => ({}))
  blocks.forEach((members, index) => graph.setNode(`b${index}`, { width: blockWidth(members.length), height: CARD_HEIGHT }))
  // Position of each edge among its siblings: a union by where its partners sit in the block, a child among the union's children.
  const edgeIndex = new Map<string, number>()
  input.families.forEach((family) => {
    const junction = familyNodeId(family.id)
    graph.setNode(junction, { width: JUNCTION_SIZE, height: JUNCTION_SIZE })
    const parentBlocks = new Set(family.partnerIds.map((id) => blockOf.get(id)!))
    parentBlocks.forEach((block) => {
      graph.setEdge(`b${block}`, junction, { weight: 4, minlen: 1 })
      const seats = family.partnerIds.filter((id) => blockOf.get(id) === block).map((id) => blocks[block].indexOf(id))
      edgeIndex.set(`b${block}>${junction}`, seats.reduce((sum, seat) => sum + seat, 0) / seats.length)
    })
    const childBlocks = [...new Set(family.childIds.map((id) => blockOf.get(id)!))].filter((block) => !parentBlocks.has(block))
    childBlocks.forEach((block, childIndex) => { graph.setEdge(junction, `b${block}`, { weight: 1, minlen: 1 }); edgeIndex.set(`${junction}>b${block}`, childIndex) })
  })
  layout(graph, { customOrder: (layered) => orderRanks(layered, edgeIndex) })

  const positions: Positions = {}
  const place = (members: string[], node: { x: number; y: number }) => {
    const left = node.x - blockWidth(members.length) / 2
    members.forEach((id, offset) => { positions[id] = { x: left + offset * (CARD_WIDTH + PARTNER_GAP), y: node.y - CARD_HEIGHT / 2 } })
  }
  blocks.forEach((members, index) => place(members, graph.node(`b${index}`)))

  // A couple is drawn with each partner above their own parents when possible: swap two-person
  // blocks whose partners' parents lie in the opposite order.
  const parentX = new Map<string, number>()
  for (const family of input.families) {
    const junction = graph.node(familyNodeId(family.id))
    for (const id of family.childIds) parentX.set(id, junction.x)
  }
  blocks.forEach((members, index) => {
    if (members.length !== 2) return
    const [a, b] = members
    const ax = parentX.get(a)
    const bx = parentX.get(b)
    const centre = graph.node(`b${index}`).x
    const shouldSwap = ax !== undefined && bx !== undefined ? ax > bx : ax !== undefined ? ax > centre : bx !== undefined ? bx < centre : false
    if (shouldSwap) { members.reverse(); place(members, graph.node(`b${index}`)) }
  })

  // A couple's junction sits on the marriage line between the partners, at mid-card height;
  // a single parent's junction sits just below the card; a parentless sibling group keeps dagre's spot.
  for (const family of input.families) {
    const node = graph.node(familyNodeId(family.id))
    const partners = family.partnerIds.map((id) => positions[id])
    let x = node.x
    let y = node.y
    if (partners.length === 2) {
      x = (partners[0].x + partners[1].x) / 2 + CARD_WIDTH / 2
      y = partners[0].y + CARD_HEIGHT / 2
    } else if (partners.length === 1) {
      x = partners[0].x + CARD_WIDTH / 2
      y = partners[0].y + CARD_HEIGHT + 14
    }
    positions[familyNodeId(family.id)] = { x: x - JUNCTION_SIZE / 2, y: y - JUNCTION_SIZE / 2 }
  }
  return { positions, durationMs: performance.now() - start }
}

interface LayeredNode { rank: number; order: number; edgeObj?: { v: string; w: string } }

/**
 * Replaces dagre's crossing minimisation, whose result can swap whole branches when one person is
 * added. Ranks are ordered top-down: every node follows its anchor (the parent with the longest
 * ancestry), and siblings keep their recorded order, so child groups keep the left-to-right order of
 * their parents. A node without parents (e.g. the parents of someone who married in) is placed right
 * after the relative on its rank whose line its descendants marry into, or at the end of the rank.
 * The result depends only on the structure and the recorded order, never on earlier layouts.
 */
function orderRanks(graph: graphlib.Graph, edgeIndex: Map<string, number>): void {
  const label = (id: string) => graph.node(id) as unknown as LayeredNode
  const nodes = graph.nodes()
  const sequence = new Map(nodes.map((id, index) => [id, index]))
  const byRank = new Map<number, string[]>()
  for (const id of nodes) {
    const rank = label(id).rank
    const row = byRank.get(rank)
    if (row) row.push(id)
    else byRank.set(rank, [id])
  }
  const ranks = [...byRank.keys()].sort((a, b) => a - b)

  // Anchors depend only on structure, so they are known before any rank is ordered.
  const height = new Map<string, number>()
  const anchor = new Map<string, string>()
  for (const rank of ranks) {
    for (const id of byRank.get(rank)!) {
      let best: string | undefined
      for (const parent of (graph.predecessors(id) ?? []) as string[]) {
        if (best === undefined || height.get(parent)! > height.get(best)! || (height.get(parent) === height.get(best) && sequence.get(parent)! < sequence.get(best)!)) best = parent
      }
      height.set(id, best === undefined ? 0 : height.get(best)! + 1)
      if (best !== undefined) anchor.set(id, best)
    }
  }
  // Long edges are split into dummy nodes that remember the original edge.
  const siblingIndex = (id: string) => {
    const from = anchor.get(id)!
    const edge = label(from).edgeObj ?? label(id).edgeObj ?? { v: from, w: id }
    return edgeIndex.get(`${edge.v}>${edge.w}`) ?? 0
  }
  // For a parentless node: walk down its own line to the first node anchored in another line, then
  // climb that line's anchors back up to this rank.
  const attachPoint = (id: string): string | undefined => {
    const rank = label(id).rank
    const queue = [id]
    const seen = new Set(queue)
    for (let index = 0; index < queue.length && index < 5000; index++) {
      const current = queue[index]
      for (const next of (graph.successors(current) ?? []) as string[]) {
        if (seen.has(next)) continue
        seen.add(next)
        if (anchor.get(next) === current) { queue.push(next); continue }
        let target: string | undefined = next
        while (target !== undefined && label(target).rank > rank) target = anchor.get(target)
        if (target !== undefined && target !== id && label(target).rank === rank) return target
      }
    }
    return undefined
  }

  const order = new Map<string, number>()
  for (const rank of ranks) {
    const rankNodes = byRank.get(rank)!
    const row = rankNodes.filter((id) => anchor.has(id))
    const key = new Map(row.map((id) => [id, [order.get(anchor.get(id)!)!, siblingIndex(id), sequence.get(id)!]]))
    row.sort((a, b) => { const x = key.get(a)!, y = key.get(b)!; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] })
    const lastAfter = new Map<string, string>()
    for (const id of rankNodes) {
      if (anchor.has(id)) continue
      const target = attachPoint(id)
      const at = target === undefined ? -1 : row.indexOf(lastAfter.get(target) ?? target)
      if (at < 0) row.push(id)
      else row.splice(at + 1, 0, id)
      if (target !== undefined) lastAfter.set(target, id)
    }
    row.forEach((id, index) => { order.set(id, index); label(id).order = index })
  }
}

function blockWidth(size: number): number {
  return size * CARD_WIDTH + (size - 1) * PARTNER_GAP
}

/**
 * Groups people connected by unions and orders each group along its chain of marriages. Earlier
 * marriages go to the left: a person married twice sits between the first spouse (left) and the second.
 */
function buildBlocks(input: LayoutInput): string[][] {
  const partners = new Map<string, { id: string; family: string }[]>()
  const link = (a: string, b: string, family: string) => {
    const list = partners.get(a)
    if (!list) partners.set(a, [{ id: b, family }])
    else if (!list.some((entry) => entry.id === b)) list.push({ id: b, family })
  }
  for (const family of input.families) {
    const [a, b] = family.partnerIds
    if (a && b) { link(a, b, family.id); link(b, a, family.id) }
  }
  // Position of a union among the person's marriages; unions without a known order keep the recorded one.
  const unionIndex = (person: string, family: string) => {
    const index = input.marriageOrder?.[person]?.indexOf(family) ?? -1
    return index < 0 ? 0 : index
  }
  for (const [person, list] of partners) if (list.length > 1) list.sort((a, b) => unionIndex(person, a.family) - unionIndex(person, b.family))
  const assigned = new Set<string>()
  const blocks: string[][] = []
  for (const id of input.personIds) {
    if (assigned.has(id)) continue
    // Collect the connected component, then walk it depth-first from an end of the chain.
    const component: string[] = []
    const stack = [id]
    const seen = new Set([id])
    while (stack.length) {
      const current = stack.pop()!
      component.push(current)
      for (const next of partners.get(current) ?? []) if (!seen.has(next.id)) { seen.add(next.id); stack.push(next.id) }
    }
    // Start at the end of the chain whose marriage came first for the partner it is married to.
    const degree = (entry: string) => partners.get(entry)?.length ?? 0
    const startKey = (entry: string) => { const first = partners.get(entry)?.[0]; return first ? unionIndex(first.id, first.family) : 0 }
    const startId = component.reduce((best, entry) => degree(entry) < degree(best) || (degree(entry) === degree(best) && startKey(entry) < startKey(best)) ? entry : best, component[0])
    const order: string[] = []
    const visited = new Set<string>()
    const walk = (current: string) => {
      visited.add(current)
      order.push(current)
      for (const next of partners.get(current) ?? []) if (!visited.has(next.id)) walk(next.id)
    }
    if (component.length > 2000) order.push(...component)
    else walk(startId)
    order.forEach((entry) => assigned.add(entry))
    blocks.push(order)
  }
  return blocks
}
