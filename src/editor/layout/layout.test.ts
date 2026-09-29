import { expect, it } from 'vitest'
import { createDemo } from '../model/demo'
import { addChild, addParent, addPartner, addPerson, updateFamily } from '../model/ops'
import type { TreeDocument } from '../model/tree'
import { createSkeleton } from '../gedcom/skeleton'
import { layoutInput, layoutTree, PARTNER_GAP } from './layout'
import { CARD_HEIGHT, CARD_WIDTH, familyNodeId } from './geometry'

it('places every person and union, parents above children, spouses side by side, without overlaps', () => {
  const tree = createDemo(300)
  const { positions } = layoutTree(layoutInput(tree))
  expect(Object.keys(positions)).toHaveLength(300 + Object.keys(tree.families).length)
  for (const family of Object.values(tree.families)) {
    const junction = positions[familyNodeId(family.id)]
    for (const parent of family.partnerIds) expect(positions[parent].y).toBeLessThan(junction.y)
    for (const child of family.childIds) expect(junction.y).toBeLessThan(positions[child].y)
    if (family.partnerIds.length === 2) {
      const [a, b] = family.partnerIds.map((id) => positions[id])
      expect(a.y).toBe(b.y)
      expect(Math.abs(a.x - b.x)).toBe(CARD_WIDTH + PARTNER_GAP)
      // The junction lies on the marriage line in the gap between the two cards.
      expect(junction.y).toBeGreaterThan(a.y)
      expect(junction.y).toBeLessThan(a.y + CARD_HEIGHT)
      expect(junction.x).toBeGreaterThan(Math.min(a.x, b.x) + CARD_WIDTH - 1)
      expect(junction.x).toBeLessThan(Math.max(a.x, b.x))
    }
  }
  const cards = Object.keys(tree.people).map((id) => positions[id])
  for (let i = 0; i < cards.length; i++) {
    expect(Number.isFinite(cards[i].x) && Number.isFinite(cards[i].y)).toBe(true)
    for (let j = i + 1; j < cards.length; j++) {
      const overlap = Math.abs(cards[i].x - cards[j].x) < CARD_WIDTH && Math.abs(cards[i].y - cards[j].y) < CARD_HEIGHT
      expect(overlap).toBe(false)
    }
  }
})

it('puts a person with two spouses between them', () => {
  let result = addPerson(createDemo(2), { givenName: 'Центр' })
  const centre = result.personId!
  result = addPartner(result.tree, centre)
  const first = result.personId!
  result = addPartner(result.tree, centre)
  const second = result.personId!
  const { positions } = layoutTree(layoutInput(result.tree))
  const xs = [first, centre, second].map((id) => positions[id].x)
  expect(Math.min(xs[0], xs[2])).toBeLessThan(xs[1])
  expect(Math.max(xs[0], xs[2])).toBeGreaterThan(xs[1])
})

it.each([100, 1000, 3000])('draws siblings left to right in their recorded order (%i people)', (count) => {
  const tree = createDemo(count)
  const { positions } = layoutTree(layoutInput(tree))
  for (const family of Object.values(tree.families)) {
    const xs = family.childIds.map((id) => positions[id].x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  }
})

it('keeps the order in which children were added, including married children', () => {
  let result = addPerson(createDemo(2), { givenName: 'Отец', sex: 'M' })
  const father = result.personId!
  result = addPartner(result.tree, father)
  const children: string[] = []
  for (const sex of ['F', 'F', 'M', 'M'] as const) { result = addChild(result.tree, father, sex); children.push(result.personId!) }
  // Marry the first and last child so their blocks are wider and pulled by spouses.
  result = addPartner(result.tree, children[0])
  result = addPartner(result.tree, children[3])
  const { positions } = layoutTree(layoutInput(result.tree))
  const xs = children.map((id) => positions[id].x)
  for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
})

const emptyTree = (): TreeDocument => ({ schemaVersion: 2, id: 'test', title: 'Test', people: {}, families: {}, gedcom: createSkeleton(), nextIds: { person: 1, family: 1 } })

/** Two brothers, each with his own children, under one father. */
function twoBranches(firstCount: number, secondCount: number) {
  let result = addPerson(emptyTree(), { givenName: 'Дед', sex: 'M' })
  const grandfather = result.personId!
  result = addChild(result.tree, grandfather, 'M')
  const first = result.personId!
  result = addChild(result.tree, grandfather, 'M')
  const second = result.personId!
  const firstChildren: string[] = []
  const secondChildren: string[] = []
  for (let i = 0; i < firstCount; i++) { result = addChild(result.tree, first, i % 2 ? 'F' : 'M'); firstChildren.push(result.personId!) }
  for (let i = 0; i < secondCount; i++) { result = addChild(result.tree, second, i % 2 ? 'F' : 'M'); secondChildren.push(result.personId!) }
  return { tree: result.tree, first, second, firstChildren, secondChildren }
}

const xOf = (tree: TreeDocument) => layoutTree(layoutInput(tree)).positions

it('keeps cousin groups in the order of their fathers when a child is added (regression: groups swapped sides)', () => {
  const family = twoBranches(5, 3)
  let tree = family.tree
  // Marry two of the younger brother's children, as in the reported file, so the groups differ in width.
  tree = addPartner(tree, family.secondChildren[0]).tree
  tree = addPartner(tree, family.secondChildren[2]).tree
  const before = xOf(tree)
  const after = xOf(addChild(tree, family.second, 'F').tree)
  for (const positions of [before, after]) {
    expect(positions[family.first].x).toBeLessThan(positions[family.second].x)
    const firstRight = Math.max(...family.firstChildren.map((id) => positions[id].x))
    const secondLeft = Math.min(...family.secondChildren.map((id) => positions[id].x))
    expect(firstRight).toBeLessThan(secondLeft)
  }
  // Everyone keeps their left-to-right order.
  const sorted = (positions: typeof before) => Object.keys(tree.people).filter((id) => positions[id].y === positions[family.firstChildren[0]].y).sort((a, b) => positions[a].x - positions[b].x)
  expect(sorted(after)).toEqual(sorted(before))
})

it('places the parents of an in-law next to the family they married into without splitting sibling groups', () => {
  const family = twoBranches(3, 2)
  let result = addPartner(family.tree, family.firstChildren[1])
  const wife = result.personId!
  result = addParent(result.tree, wife, 'M')
  const inLaw = result.personId!
  result = addChild(result.tree, inLaw, 'M')
  const wifeBrother = result.personId!
  const positions = xOf(result.tree)
  const x = (id: string) => positions[id].x
  // Rank of the fathers: first brother, then the in-law, then the second brother.
  expect(x(family.first)).toBeLessThan(x(inLaw))
  expect(x(inLaw)).toBeLessThan(x(family.second))
  // The wife sits beside her husband on her father's side; her brother does not split the husband's siblings.
  expect(x(wife)).toBeGreaterThan(x(family.firstChildren[1]))
  expect(x(wifeBrother)).toBeGreaterThan(Math.max(...family.firstChildren.map(x), x(wife)))
  expect(x(wifeBrother)).toBeLessThan(Math.min(...family.secondChildren.map(x)))
})

it('lays out the same structure identically every time', () => {
  const tree = createDemo(500)
  expect(xOf(tree)).toEqual(xOf(tree))
})

it('draws the first marriage on the left and the next one on the right, by marriage year when known', () => {
  let result = addPerson(emptyTree(), { givenName: 'Муж', sex: 'M' })
  const husband = result.personId!
  result = addPartner(result.tree, husband)
  const first = result.personId!
  const firstFamily = result.familyId!
  result = addChild(result.tree, husband, 'M', firstFamily)
  const firstChild = result.personId!
  result = addPartner(result.tree, husband)
  const second = result.personId!
  const secondFamily = result.familyId!
  result = addChild(result.tree, husband, 'M', secondFamily)
  const secondChild = result.personId!
  let positions = xOf(result.tree)
  expect(positions[first].x).toBeLessThan(positions[husband].x)
  expect(positions[husband].x).toBeLessThan(positions[second].x)
  expect(positions[firstChild].x).toBeLessThan(positions[secondChild].x)
  // Marriage years override the recorded order.
  let tree = updateFamily(result.tree, firstFamily, { marriageDate: '1905' })
  tree = updateFamily(tree, secondFamily, { marriageDate: 'ABT 1890' })
  positions = xOf(tree)
  expect(positions[second].x).toBeLessThan(positions[husband].x)
  expect(positions[husband].x).toBeLessThan(positions[first].x)
  expect(positions[secondChild].x).toBeLessThan(positions[firstChild].x)
})
