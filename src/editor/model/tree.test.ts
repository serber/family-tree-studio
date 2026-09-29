import { setLocale } from '../../shared/i18n'
import { describe, expect, it } from 'vitest'
import { createDemo } from './demo'
import { editorReducer, initialEditorState } from './history'
import { findIssues } from './issues'
import { addChild, addParent, addPartner, addPerson, addSibling, deletePerson, mergePeople, nextUnverified, setVerified, linkChild, linkParent, linkPartner, linkSibling, unlinkParent, unlinkPartner, updatePerson } from './ops'
import { buildIndex, emptyFamily, isTreeDocument, lineageOf, migrateDocument, orderUnions, parentageLabel, relativesOf, searchPeople, type TreeDocument } from './tree'
import { createSkeleton } from '../gedcom/skeleton'

function emptyTree(): TreeDocument {
  return { schemaVersion: 2, id: 'test', title: 'Test', people: {}, families: {}, gedcom: createSkeleton(), nextIds: { person: 1, family: 1 } }
}

describe('demo genealogy', () => {
  it.each([100, 1000, 3000])('creates exactly %i people with valid, acyclic family references', (count) => {
    const tree = createDemo(count)
    expect(Object.keys(tree.people)).toHaveLength(count)
    expect(isTreeDocument(tree)).toBe(true)
    const partnerCount = new Map<string, number>()
    for (const family of Object.values(tree.families)) {
      expect(new Set([...family.partnerIds, ...family.childIds]).size).toBe(family.partnerIds.length + family.childIds.length)
      for (const parent of family.partnerIds) partnerCount.set(parent, (partnerCount.get(parent) ?? 0) + 1)
    }
    expect([...partnerCount.values()].some((value) => value > 1)).toBe(true)
    expect(findIssues(tree).filter((issue) => issue.kind !== 'duplicate')).toEqual([])
    expect(createDemo(count)).toEqual(tree)
  })
})

describe('search and relationships', () => {
  it('finds Russian names regardless of word order, case, or ё/е, and ranks exact words first', () => {
    const tree = createDemo(100)
    tree.people.I1.givenName = 'Пётр'
    expect(searchPeople(tree.people, 'леснов ПЕТР').map((person) => person.id)).toContain('I1')
    expect(searchPeople(tree.people, 'i100')[0].id).toBe('I100')
    expect(searchPeople(tree.people, '   ')).toEqual([])
    const results = searchPeople(tree.people, 'анна')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((person) => /анн/i.test(person.givenName + person.surname + person.patronymic))).toBe(true)
  })

  it('collects partners, children, siblings, and lineage across repeated marriages', () => {
    const tree = createDemo(100)
    const index = buildIndex(tree)
    const [id] = [...index.asPartner].find(([, families]) => families.length > 1)!
    const relatives = relativesOf(tree, id, index)
    expect(relatives.partners).toHaveLength(2)
    expect(new Set(relatives.children)).toEqual(new Set(relatives.partnerFamilies.flatMap((family) => family.childIds)))
    const child = relatives.children[0]
    expect(lineageOf(tree, child, index).ancestors.has(id)).toBe(true)
    expect(lineageOf(tree, id, index).descendants.has(child)).toBe(true)
    setLocale('ru')
    expect(parentageLabel(tree, child, index)).toMatch(/^(сын|дочь) .+ и .+/)
    setLocale('en')
    expect(parentageLabel(tree, child, index)).toMatch(/^(son|daughter) of .+ and .+/)
  })
})

describe('structural operations', () => {
  it('builds a family around one person with Russian name suggestions', () => {
    let result = addPerson(emptyTree(), { givenName: 'Мария', patronymic: 'Николаевна', surname: 'Орлова', sex: 'F' })
    const maria = result.personId!
    result = addParent(result.tree, maria, 'M')
    expect(result.tree.people[result.personId!]).toMatchObject({ givenName: 'Николай', surname: 'Орлов', sex: 'M' })
    result = addParent(result.tree, maria, 'F')
    expect(result.tree.people[result.personId!]).toMatchObject({ surname: 'Орлова', sex: 'F' })
    expect(() => addParent(result.tree, maria, 'M')).toThrow('bothParentsReplace')
    result = addSibling(result.tree, maria, 'M')
    expect(result.tree.people[result.personId!]).toMatchObject({ surname: 'Орлов', patronymic: '' })
    result = addPartner(result.tree, maria)
    expect(result.tree.people[result.personId!]).toMatchObject({ sex: 'M', surname: 'Орлов' })
    const husband = result.personId!
    result = addChild(updatePerson(result.tree, husband, { givenName: 'Сергей', surname: 'Белов' }), maria, 'F')
    expect(result.tree.people[result.personId!]).toMatchObject({ surname: 'Белова', patronymic: '' })
    expect(relativesOf(result.tree, maria).children).toEqual([result.personId])
    expect(isTreeDocument(result.tree)).toBe(true)
  })

  it('attaches a new spouse to an existing single-parent family instead of creating another union', () => {
    let result = addPerson(emptyTree(), { givenName: 'Иван', sex: 'M' })
    const ivan = result.personId!
    result = addChild(result.tree, ivan, 'M')
    const child = result.personId!
    result = addPartner(result.tree, ivan)
    expect(Object.keys(result.tree.families)).toHaveLength(1)
    expect(relativesOf(result.tree, child).parents).toEqual([ivan, result.personId])
    result = addPartner(result.tree, ivan)
    expect(Object.keys(result.tree.families)).toHaveLength(2)
    expect(() => addChild(result.tree, ivan, 'F')).toThrow('chooseChildFamily')
  })

  it('links existing people, merges sibling groups, and prevents ancestry cycles', () => {
    let tree = emptyTree()
    const ids: string[] = []
    for (const name of ['Дед', 'Отец', 'Сын', 'Дочь', 'Бабушка']) { const result = addPerson(tree, { givenName: name }); tree = result.tree; ids.push(result.personId!) }
    const [grandfather, father, son, daughter, grandmother] = ids
    tree = linkParent(tree, father, grandfather).tree
    tree = linkSibling(tree, son, daughter).tree
    tree = linkChild(tree, father, son).tree
    expect(relativesOf(tree, daughter).parents).toEqual([father])
    expect(Object.keys(tree.families)).toHaveLength(2)
    expect(() => linkParent(tree, grandfather, son)).toThrow('parentIsDescendant')
    expect(() => linkChild(tree, son, grandfather)).toThrow('childIsAncestor')
    expect(() => linkPartner(tree, father, son)).toThrow('partnerLineage')
    tree = linkPartner(tree, grandfather, grandmother).tree
    expect(relativesOf(tree, father).parents).toEqual([grandfather, grandmother])
    tree = linkParent(tree, son, grandmother).tree
    expect(relativesOf(tree, son).parents).toContain(grandmother)
  })

  it('unlinks and deletes without leaving meaningless families', () => {
    let result = addPerson(emptyTree(), { givenName: 'А', sex: 'M' })
    const a = result.personId!
    result = addPartner(result.tree, a)
    const b = result.personId!
    expect(unlinkPartner(result.tree, a, b).families).toEqual({})
    result = addChild(result.tree, a, 'M')
    const c = result.personId!
    expect(() => unlinkPartner(result.tree, a, b)).toThrow('sharedChildren')
    const unlinked = unlinkParent(result.tree, c, a)
    expect(relativesOf(unlinked, c).parents).toEqual([b])
    expect(relativesOf(unlinked, a).partners).toEqual([b])
    const deleted = deletePerson(deletePerson(result.tree, b), c)
    expect(deleted.families).toEqual({})
    expect(Object.keys(deleted.people)).toEqual([a])
  })

  it('never reuses IDs, even after undoing a deletion of the newest person', () => {
    let result = addPerson(emptyTree())
    result = addPerson(result.tree)
    const removed = deletePerson(result.tree, result.personId!)
    expect(addPerson(removed).personId).toBe('I3')
  })
})

describe('merging duplicates', () => {
  it('moves links to the kept person, fills empty fields, and combines identical unions', () => {
    // The same grandfather was entered twice: once as the father's father, once as the aunt's father.
    let result = addPerson(emptyTree(), { givenName: 'Иван', surname: 'Орлов', sex: 'M' })
    const father = result.personId!
    result = addParent(result.tree, father, 'M')
    const grandfather = result.personId!
    result = addPartner(result.tree, grandfather)
    const grandmother = result.personId!
    let tree = updatePerson(result.tree, grandfather, { givenName: 'Пётр', birthDate: '1880' })
    result = addPerson(tree, { givenName: 'Анна', surname: 'Орлова', sex: 'F' })
    const aunt = result.personId!
    result = addParent(result.tree, aunt, 'M')
    const duplicate = result.personId!
    tree = updatePerson(result.tree, duplicate, { givenName: 'Пётр', deathPlace: 'Тверь', note: 'Со слов тёти' })
    tree = linkPartner(tree, duplicate, grandmother).tree

    const merged = mergePeople(tree, grandfather, duplicate)
    expect(merged.people[duplicate]).toBeUndefined()
    expect(merged.people[grandfather]).toMatchObject({ birthDate: '1880', deathPlace: 'Тверь', note: 'Со слов тёти' })
    expect(new Set(relativesOf(merged, grandfather).children)).toEqual(new Set([father, aunt]))
    expect(relativesOf(merged, grandfather).partners).toEqual([grandmother])
    expect(Object.keys(merged.families)).toHaveLength(1)
    expect(isTreeDocument(merged)).toBe(true)
  })

  it('refuses merges that would make someone their own ancestor or mix sexes', () => {
    let result = addPerson(emptyTree(), { givenName: 'Отец', sex: 'M' })
    const father = result.personId!
    result = addChild(result.tree, father, 'M')
    expect(() => mergePeople(result.tree, father, result.personId!)).toThrow('mergeOwnParent')
    const woman = addPerson(result.tree, { sex: 'F' })
    expect(() => mergePeople(woman.tree, father, woman.personId!)).toThrow('mergeSexMismatch')
  })
})

describe('review marks', () => {
  it('marks people, walks to the nearest unverified relative, and drops marks of removed people', () => {
    let result = addPerson(emptyTree(), { givenName: 'Иван', sex: 'M' })
    const ivan = result.personId!
    result = addChild(result.tree, ivan, 'M')
    const son = result.personId!
    result = addChild(result.tree, son, 'F')
    const granddaughter = result.personId!
    const stranger = addPerson(result.tree, { givenName: 'Чужой' })
    let tree = setVerified(stranger.tree, ivan, true, '2026-09-24T10:00:00.000Z')
    expect(tree.verified).toEqual({ [ivan]: '2026-09-24T10:00:00.000Z' })
    expect(setVerified(tree, ivan, true)).toBe(tree)
    expect(nextUnverified(tree, ivan)).toBe(son)
    tree = setVerified(tree, son, true)
    expect(nextUnverified(tree, ivan)).toBe(granddaughter)
    tree = setVerified(tree, granddaughter, true)
    expect(nextUnverified(tree, ivan)).toBe(stranger.personId)
    tree = setVerified(tree, stranger.personId!, true)
    expect(nextUnverified(tree, ivan)).toBeUndefined()
    expect(isTreeDocument(tree)).toBe(true)
    expect(Object.keys(deletePerson(tree, son).verified!)).not.toContain(son)
    expect(setVerified(tree, son, false).verified![son]).toBeUndefined()
  })
})

describe('edit history', () => {
  it('coalesces typing into one step, keeps structural edits atomic, and clears redo on new edits', () => {
    const tree = emptyTree()
    let state = initialEditorState(tree)
    const added = addPerson(state.tree)
    state = editorReducer(state, { type: 'apply', tree: added.tree, label: 'add' })
    const id = added.personId!
    for (const value of ['И', 'Ив', 'Иван']) state = editorReducer(state, { type: 'apply', tree: updatePerson(state.tree, id, { givenName: value }), label: 'name', coalesceKey: `${id}:givenName` })
    expect(state.past).toHaveLength(2)
    const withChild = addChild(state.tree, id, 'M')
    state = editorReducer(state, { type: 'apply', tree: withChild.tree, label: 'child' })
    state = editorReducer(state, { type: 'undo' })
    expect(Object.keys(state.tree.people)).toEqual([id])
    expect(state.tree.people[id].givenName).toBe('Иван')
    state = editorReducer(state, { type: 'undo' })
    expect(state.tree.people[id].givenName).toBe('')
    state = editorReducer(state, { type: 'redo' })
    expect(state.tree.people[id].givenName).toBe('Иван')
    state = editorReducer(state, { type: 'apply', tree: updatePerson(state.tree, id, { surname: 'Петров' }), label: 'surname' })
    expect(state.future).toHaveLength(0)
    expect(editorReducer(state, { type: 'redo' })).toBe(state)
  })
})

describe('consistency checks', () => {
  it('reports impossible dates, isolated people, unknown sex, unrecognized dates, and likely duplicates', () => {
    let result = addPerson(emptyTree(), { givenName: 'Иван', surname: 'Петров', sex: 'M', birthDate: '1900', deathDate: '1950' })
    const father = result.personId!
    result = addChild(result.tree, father, 'M')
    let tree = updatePerson(result.tree, result.personId!, { givenName: 'Пётр', birthDate: '1960' })
    tree = addPerson(tree, { givenName: 'Иван', surname: 'Петров', sex: 'M', birthDate: 'ABT 1900' }).tree
    tree = addPerson(tree, { givenName: 'Анна', sex: 'F', birthDate: 'весной', deathDate: '1800', }).tree
    const kinds = findIssues(tree).map((issue) => issue.kind).sort()
    expect(kinds).toEqual(['badDate', 'bornAfterParentDeath', 'duplicate', 'isolated', 'isolated'])
  })
})

describe('stored document migration', () => {
  it('upgrades prototype schema-1 drafts and splits patronymics', () => {
    const old = { schemaVersion: 1, id: 'demo-2', title: 'Old', people: { I0001: { id: 'I0001', givenName: 'Иван Петрович', surname: 'Орлов', birthDate: '1900', deathDate: '', note: '', sex: 'M' }, I0002: { id: 'I0002', givenName: 'Анна', surname: '', birthDate: '', deathDate: '', note: '', sex: 'F' } }, families: { F1: { id: 'F1', partnerIds: ['I0001'], childIds: ['I0002'] } } }
    const tree = migrateDocument(old, createSkeleton)!
    expect(tree.people.I0001).toMatchObject({ givenName: 'Иван', patronymic: 'Петрович' })
    expect(tree.families.F1.marriageDate).toBe('')
    expect(tree.nextIds.person).toBeGreaterThan(2)
    expect(isTreeDocument(tree)).toBe(true)
    expect(migrateDocument({ schemaVersion: 1, people: [], families: [] }, createSkeleton)).toBeUndefined()
  })
})

it('orders a person\'s marriages by year and keeps undated ones in their recorded place', () => {
  const families = [emptyFamily('F1', { marriageDate: '1910' }), emptyFamily('F2'), emptyFamily('F3', { marriageDate: 'ABT 1895' }), emptyFamily('F4', { marriageDate: '1900' })]
  expect(orderUnions(families).map((family) => family.id)).toEqual(['F3', 'F2', 'F4', 'F1'])
  expect(orderUnions([emptyFamily('F1'), emptyFamily('F2')]).map((family) => family.id)).toEqual(['F1', 'F2'])
})
