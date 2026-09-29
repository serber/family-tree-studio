import { AppError } from '../../shared/errors'
import { fatherNameFromPatronymic, surnameForSex } from './names'
import { buildIndex, emptyFamily, emptyPerson, relativesOf, type Family, type FamilyFields, type Person, type PersonFields, type Sex, type TreeDocument } from './tree'

// Pure structural edits. Each returns a new document and never mutates its input.
// Errors are Russian messages meant for the UI.

export interface OpResult { tree: TreeDocument; personId?: string; familyId?: string }

/** Allocates collision-free IDs from the document counters. Include `counters()` in the resulting document. */
export function idAllocator(tree: TreeDocument) {
  const next = { ...tree.nextIds }
  return {
    person(): string {
      while (Object.hasOwn(tree.people, `I${next.person}`)) next.person++
      return `I${next.person++}`
    },
    family(): string {
      while (Object.hasOwn(tree.families, `F${next.family}`)) next.family++
      return `F${next.family++}`
    },
    counters: () => next,
  }
}

function withPeople(tree: TreeDocument, people: Person[]): TreeDocument['people'] {
  const next = { ...tree.people }
  for (const person of people) next[person.id] = person
  return next
}

function withFamilies(tree: TreeDocument, families: Family[], removed: string[] = []): TreeDocument['families'] {
  const next = { ...tree.families }
  for (const family of families) next[family.id] = family
  for (const id of removed) delete next[id]
  return next
}

/** A family is meaningful when it links at least two people. */
function isMeaningful(family: Family): boolean {
  return family.partnerIds.length + family.childIds.length >= 2
}

function oppositeSex(sex: Sex): Sex {
  return sex === 'M' ? 'F' : sex === 'F' ? 'M' : 'U'
}

function fatherOf(tree: TreeDocument, family: Family | undefined): Person | undefined {
  if (!family) return undefined
  const partners = family.partnerIds.map((id) => tree.people[id])
  return partners.find((person) => person.sex === 'M') ?? (partners.length === 1 && partners[0].sex !== 'F' ? partners[0] : undefined)
}

/** Whether `candidate` is `personId` or one of its descendants (linking it as an ancestor would create a cycle). */
export function isSelfOrDescendant(tree: TreeDocument, personId: string, candidate: string, index = buildIndex(tree)): boolean {
  const queue = [personId]
  const seen = new Set(queue)
  for (let cursor = 0; cursor < queue.length; cursor++) {
    if (queue[cursor] === candidate) return true
    for (const familyId of index.asPartner.get(queue[cursor]) ?? []) for (const child of tree.families[familyId].childIds) {
      if (!seen.has(child)) { seen.add(child); queue.push(child) }
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Field edits

export function updatePerson(tree: TreeDocument, id: string, fields: Partial<PersonFields>): TreeDocument {
  const before = tree.people[id]
  if (!before) return tree
  const after = { ...before, ...fields }
  if ((Object.keys(fields) as (keyof PersonFields)[]).every((key) => before[key] === after[key])) return tree
  return { ...tree, people: { ...tree.people, [id]: after } }
}

export function updateFamily(tree: TreeDocument, id: string, fields: Partial<FamilyFields>): TreeDocument {
  const before = tree.families[id]
  if (!before) return tree
  const after = { ...before, ...fields }
  if ((Object.keys(fields) as (keyof FamilyFields)[]).every((key) => before[key] === after[key])) return tree
  return { ...tree, families: { ...tree.families, [id]: after } }
}

// ---------------------------------------------------------------------------
// Creating relatives

export function addPerson(tree: TreeDocument, fields: Partial<PersonFields> = {}): OpResult {
  const ids = idAllocator(tree)
  const person = emptyPerson(ids.person(), fields)
  return { tree: { ...tree, nextIds: ids.counters(), people: withPeople(tree, [person]) }, personId: person.id }
}

/** Adds a new father or mother. Reuses the first parent family when it has room. */
export function addParent(tree: TreeDocument, childId: string, sex: 'M' | 'F'): OpResult {
  const ids = idAllocator(tree)
  const child = tree.people[childId]
  const index = buildIndex(tree)
  const parentFamilies = (index.asChild.get(childId) ?? []).map((id) => tree.families[id])
  const family = parentFamilies.find((entry) => entry.partnerIds.length < 2 && !entry.partnerIds.some((id) => tree.people[id].sex === sex))
  if (!family && parentFamilies.some((entry) => entry.partnerIds.length >= 2)) throw new AppError('bothParentsReplace')
  if (!family && parentFamilies.length) throw new AppError(sex === 'M' ? 'fatherExists' : 'motherExists')
  const id = ids.person()
  const birthSurname = child.birthSurname || child.surname
  let fields: Partial<PersonFields>
  if (sex === 'M') {
    fields = { sex, surname: surnameForSex(birthSurname, 'M'), givenName: fatherNameFromPatronymic(child.patronymic) }
  } else {
    const father = fatherOf(tree, family)
    fields = { sex, surname: surnameForSex(father?.surname ?? birthSurname, 'F') }
  }
  const parent = emptyPerson(id, fields)
  const updated = family ? { ...family, partnerIds: [...family.partnerIds, id] } : emptyFamily(ids.family(), { partnerIds: [id], childIds: [childId] })
  return { tree: { ...tree, nextIds: ids.counters(), people: withPeople(tree, [parent]), families: withFamilies(tree, [updated]) }, personId: id, familyId: updated.id }
}

/** Adds a new spouse. Joins a family where the person is the only parent, otherwise creates a new union. */
export function addPartner(tree: TreeDocument, personId: string, sex?: Sex): OpResult {
  const ids = idAllocator(tree)
  const person = tree.people[personId]
  const index = buildIndex(tree)
  const single = (index.asPartner.get(personId) ?? []).map((id) => tree.families[id]).find((family) => family.partnerIds.length === 1)
  const partnerSex = sex ?? oppositeSex(person.sex)
  const id = ids.person()
  const surname = partnerSex === 'F' && person.sex === 'M' ? surnameForSex(person.surname, 'F')
    : partnerSex === 'M' && person.sex === 'F' ? surnameForSex(person.surname, 'M') : ''
  const partner = emptyPerson(id, { sex: partnerSex, surname })
  const family = single ? { ...single, partnerIds: [...single.partnerIds, id] } : emptyFamily(ids.family(), { partnerIds: [personId, id] })
  return { tree: { ...tree, nextIds: ids.counters(), people: withPeople(tree, [partner]), families: withFamilies(tree, [family]) }, personId: id, familyId: family.id }
}

/** Families to which a new child of `parentId` could be added. More than one means the UI must ask. */
export function childFamilyOptions(tree: TreeDocument, parentId: string): Family[] {
  return (buildIndex(tree).asPartner.get(parentId) ?? []).map((id) => tree.families[id])
}

/** Adds a new son or daughter. `familyId` selects the union ('new' for a separate one); omitted, the only union is used or one is created. */
export function addChild(tree: TreeDocument, parentId: string, sex: Sex, familyId?: string): OpResult {
  const ids = idAllocator(tree)
  const options = childFamilyOptions(tree, parentId)
  if (!familyId && options.length > 1) throw new AppError('chooseChildFamily')
  // 'new' starts a separate single-parent family (e.g. a child from an unrecorded relationship).
  const existing = familyId === 'new' ? undefined : familyId ? tree.families[familyId] : options[0]
  const family = existing ?? emptyFamily(ids.family(), { partnerIds: [parentId] })
  const father = fatherOf(tree, family)
  const surnameSource = (father ?? tree.people[parentId]).surname
  const id = ids.person()
  const child = emptyPerson(id, { sex, surname: surnameForSex(surnameSource, sex) })
  const updated = { ...family, childIds: [...family.childIds, id] }
  return { tree: { ...tree, nextIds: ids.counters(), people: withPeople(tree, [child]), families: withFamilies(tree, [updated]) }, personId: id, familyId: updated.id }
}

/** Adds a brother or sister. Creates a parentless family when the person has no recorded parents. */
export function addSibling(tree: TreeDocument, personId: string, sex: Sex): OpResult {
  const ids = idAllocator(tree)
  const person = tree.people[personId]
  const index = buildIndex(tree)
  const existing = (index.asChild.get(personId) ?? []).map((id) => tree.families[id])[0]
  const family = existing ?? emptyFamily(ids.family(), { childIds: [personId] })
  const father = fatherOf(tree, existing)
  const id = ids.person()
  const surname = father ? surnameForSex(father.surname, sex) : surnameForSex(person.birthSurname || person.surname, sex)
  const sibling = emptyPerson(id, { sex, surname })
  const updated = { ...family, childIds: [...family.childIds, id] }
  return { tree: { ...tree, nextIds: ids.counters(), people: withPeople(tree, [sibling]), families: withFamilies(tree, [updated]) }, personId: id, familyId: updated.id }
}

// ---------------------------------------------------------------------------
// Linking existing people

/** Records `parentId` as a parent of `childId`. */
export function linkParent(tree: TreeDocument, childId: string, parentId: string): OpResult {
  const ids = idAllocator(tree)
  const index = buildIndex(tree)
  if (isSelfOrDescendant(tree, childId, parentId, index)) throw new AppError('parentIsDescendant')
  const relatives = relativesOf(tree, childId, index)
  if (relatives.parents.includes(parentId)) throw new AppError('alreadyParent')
  const parentFamilies = relatives.parentFamilies
  // Prefer an existing union of the new parent with the child's current single parent.
  const single = parentFamilies.find((family) => family.partnerIds.length === 1)
  if (single) {
    const partnerFamily = (index.asPartner.get(parentId) ?? []).map((id) => tree.families[id]).find((family) => family.partnerIds.includes(single.partnerIds[0]))
    if (partnerFamily) {
      const updatedSingle = { ...single, childIds: single.childIds.filter((id) => id !== childId) }
      const updatedUnion = { ...partnerFamily, childIds: [...partnerFamily.childIds, childId] }
      const removed = isMeaningful(updatedSingle) ? [] : [single.id]
      const kept = removed.length ? [updatedUnion] : [updatedSingle, updatedUnion]
      return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, kept, removed) }, familyId: partnerFamily.id }
    }
    const updated = { ...single, partnerIds: [...single.partnerIds, parentId] }
    return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [updated]) }, familyId: updated.id }
  }
  const empty = parentFamilies.find((family) => family.partnerIds.length === 0)
  if (empty) {
    const updated = { ...empty, partnerIds: [parentId] }
    return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [updated]) }, familyId: updated.id }
  }
  if (parentFamilies.length) throw new AppError('bothParents')
  // Join the parent's only union without children of other parents, or create one.
  const own = (index.asPartner.get(parentId) ?? []).map((id) => tree.families[id])
  const target = own.length === 1 && own[0].partnerIds.length === 1 ? own[0] : undefined
  const family = target ? { ...target, childIds: [...target.childIds, childId] } : emptyFamily(ids.family(), { partnerIds: [parentId], childIds: [childId] })
  return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [family]) }, familyId: family.id }
}

/** Records a union between two existing people. */
export function linkPartner(tree: TreeDocument, personId: string, partnerId: string): OpResult {
  const ids = idAllocator(tree)
  if (personId === partnerId) throw new AppError('selfLink')
  const index = buildIndex(tree)
  const relatives = relativesOf(tree, personId, index)
  if (relatives.partners.includes(partnerId)) throw new AppError('alreadyPartners')
  if (isSelfOrDescendant(tree, personId, partnerId, index) || isSelfOrDescendant(tree, partnerId, personId, index)) throw new AppError('partnerLineage')
  const single = relatives.partnerFamilies.find((family) => family.partnerIds.length === 1)
  const family = single ? { ...single, partnerIds: [...single.partnerIds, partnerId] } : emptyFamily(ids.family(), { partnerIds: [personId, partnerId] })
  return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [family]) }, familyId: family.id }
}

/** Records an existing person as a child of a union (or of a single parent). */
export function linkChild(tree: TreeDocument, parentId: string, childId: string, familyId?: string): OpResult {
  const ids = idAllocator(tree)
  const index = buildIndex(tree)
  if (isSelfOrDescendant(tree, childId, parentId, index)) throw new AppError('childIsAncestor')
  const options = (index.asPartner.get(parentId) ?? []).map((id) => tree.families[id])
  if (!familyId && options.length > 1) throw new AppError('chooseChildFamily')
  const family = familyId ? tree.families[familyId] : options[0]
  if (family?.childIds.includes(childId)) throw new AppError('alreadyChild')
  const childFamilies = (index.asChild.get(childId) ?? []).map((id) => tree.families[id])
  const target = family ?? emptyFamily(ids.family(), { partnerIds: [parentId] })
  const merged = new Set([...target.partnerIds, ...childFamilies.flatMap((entry) => entry.partnerIds)])
  if (merged.size > 2 && childFamilies.length) throw new AppError('otherParents')
  // A parentless sibling group or single-parent family of the child is merged into the target union.
  const absorbed = childFamilies.filter((entry) => entry.partnerIds.every((id) => target.partnerIds.includes(id)))
  const children = [...target.childIds]
  for (const entry of absorbed) for (const id of entry.childIds) if (!children.includes(id)) children.push(id)
  if (!children.includes(childId)) children.push(childId)
  const updated = { ...target, childIds: children }
  const removed = absorbed.map((entry) => entry.id).filter((id) => id !== target.id)
  return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [updated], removed) }, familyId: updated.id }
}

/** Records two existing people as siblings (same parents). */
export function linkSibling(tree: TreeDocument, personId: string, siblingId: string): OpResult {
  const ids = idAllocator(tree)
  if (personId === siblingId) throw new AppError('selfLink')
  const index = buildIndex(tree)
  const own = (index.asChild.get(personId) ?? []).map((id) => tree.families[id])[0]
  const other = (index.asChild.get(siblingId) ?? []).map((id) => tree.families[id])[0]
  if (own && other) {
    if (own.id === other.id) throw new AppError('alreadySiblings')
    throw new AppError('bothHaveParents')
  }
  if (isSelfOrDescendant(tree, personId, siblingId, index) || isSelfOrDescendant(tree, siblingId, personId, index)) throw new AppError('siblingLineage')
  const family = own ?? other ?? emptyFamily(ids.family())
  const joining = own ? siblingId : personId
  const updated = { ...family, childIds: own || other ? [...family.childIds, joining] : [personId, siblingId] }
  return { tree: { ...tree, nextIds: ids.counters(), families: withFamilies(tree, [updated]) }, familyId: updated.id }
}

// ---------------------------------------------------------------------------
// Removing links and people

export function unlinkFromFamily(tree: TreeDocument, familyId: string, personId: string): TreeDocument {
  const family = tree.families[familyId]
  if (!family) return tree
  const updated = { ...family, partnerIds: family.partnerIds.filter((id) => id !== personId), childIds: family.childIds.filter((id) => id !== personId) }
  return { ...tree, families: isMeaningful(updated) ? withFamilies(tree, [updated]) : withFamilies(tree, [], [familyId]) }
}

/** Removes the parent–child link between two people, wherever it is recorded. */
export function unlinkParent(tree: TreeDocument, childId: string, parentId: string): TreeDocument {
  const ids = idAllocator(tree)
  let next = tree
  for (const family of Object.values(tree.families)) {
    if (!family.childIds.includes(childId) || !family.partnerIds.includes(parentId)) continue
    if (family.partnerIds.length === 1) next = unlinkFromFamily(next, family.id, childId)
    else {
      // Keep the child with the other parent: move the child to a single-parent family.
      const other = family.partnerIds.find((id) => id !== parentId)!
      const withoutChild = { ...family, childIds: family.childIds.filter((id) => id !== childId) }
      const own = emptyFamily(ids.family(), { partnerIds: [other], childIds: [childId] })
      next = { ...next, nextIds: ids.counters(), families: withFamilies(next, isMeaningful(withoutChild) ? [withoutChild, own] : [own], isMeaningful(withoutChild) ? [] : [family.id]) }
    }
  }
  return next
}

export function unlinkPartner(tree: TreeDocument, personId: string, partnerId: string): TreeDocument {
  let next = tree
  for (const family of Object.values(tree.families)) {
    if (!family.partnerIds.includes(personId) || !family.partnerIds.includes(partnerId)) continue
    if (family.childIds.length === 0) next = { ...next, families: withFamilies(next, [], [family.id]) }
    else {
      // Children stay with both parents recorded; separating a couple with children would erase parentage.
      throw new AppError('sharedChildren')
    }
  }
  return next
}

export function unlinkSibling(tree: TreeDocument, personId: string, siblingId: string): TreeDocument {
  const family = Object.values(tree.families).find((entry) => entry.childIds.includes(personId) && entry.childIds.includes(siblingId))
  if (!family) return tree
  if (family.partnerIds.length) throw new AppError('siblingsViaParents')
  return unlinkFromFamily(tree, family.id, siblingId)
}

export function deletePerson(tree: TreeDocument, personId: string): TreeDocument {
  if (!tree.people[personId]) return tree
  const people = { ...tree.people }
  delete people[personId]
  const changed: Family[] = []
  const removed: string[] = []
  for (const family of Object.values(tree.families)) {
    if (!family.partnerIds.includes(personId) && !family.childIds.includes(personId)) continue
    const updated = { ...family, partnerIds: family.partnerIds.filter((id) => id !== personId), childIds: family.childIds.filter((id) => id !== personId) }
    if (isMeaningful(updated)) changed.push(updated)
    else removed.push(family.id)
  }
  return { ...tree, people, families: withFamilies(tree, changed, removed), verified: withoutMark(tree.verified, personId) }
}

function withoutMark(verified: TreeDocument['verified'], personId: string): TreeDocument['verified'] {
  if (!verified || !(personId in verified)) return verified
  const next = { ...verified }
  delete next[personId]
  return next
}

// ---------------------------------------------------------------------------
// Review marks

export function setVerified(tree: TreeDocument, personId: string, verified: boolean, at = new Date().toISOString()): TreeDocument {
  if (!tree.people[personId] || verified === !!tree.verified?.[personId]) return tree
  return { ...tree, verified: verified ? { ...tree.verified, [personId]: at } : withoutMark(tree.verified, personId) }
}

/**
 * The next person to review: the closest unverified relative by family links (so review proceeds
 * branch by branch), otherwise any unverified person. Undefined when everyone is verified.
 */
export function nextUnverified(tree: TreeDocument, fromId: string | null, index = buildIndex(tree)): string | undefined {
  const verified = tree.verified ?? {}
  if (fromId && tree.people[fromId]) {
    const seen = new Set([fromId])
    const queue = [fromId]
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const relatives = relativesOf(tree, queue[cursor], index)
      for (const id of [...relatives.parents, ...relatives.partners, ...relatives.children, ...relatives.siblings]) {
        if (seen.has(id)) continue
        if (!verified[id]) return id
        seen.add(id)
        queue.push(id)
      }
    }
  }
  return Object.keys(tree.people).find((id) => id !== fromId && !verified[id])
}

// ---------------------------------------------------------------------------
// Merging duplicates

/**
 * Merges `removeId` into `keepId`: every family link moves to the kept person, empty fields are
 * filled from the removed one (notes are joined), and unions that become identical are combined.
 */
export function mergePeople(tree: TreeDocument, keepId: string, removeId: string): TreeDocument {
  if (keepId === removeId) throw new AppError('mergeSelf')
  const keep = tree.people[keepId]
  const remove = tree.people[removeId]
  if (!keep || !remove) return tree
  if (keep.sex !== 'U' && remove.sex !== 'U' && keep.sex !== remove.sex) throw new AppError('mergeSexMismatch')
  const merged: Person = { ...keep }
  for (const key of ['givenName', 'patronymic', 'surname', 'birthSurname', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace'] as const) {
    if (!merged[key]) merged[key] = remove[key]
  }
  if (merged.sex === 'U') merged.sex = remove.sex
  merged.note = [keep.note, remove.note].filter(Boolean).filter((note, position, notes) => notes.indexOf(note) === position).join('\n\n')

  const replaceId = (ids: string[]) => [...new Set(ids.map((id) => id === removeId ? keepId : id))]
  let families = Object.values(tree.families).map((family) => ({ ...family, partnerIds: replaceId(family.partnerIds), childIds: replaceId(family.childIds) }))
  for (const family of families) {
    if (family.partnerIds.some((id) => family.childIds.includes(id))) throw new AppError('mergeOwnParent')
  }
  // Combine unions with the same partners (e.g. both duplicates were married to the same spouse).
  const byPartners = new Map<string, Family>()
  const result: Family[] = []
  for (const family of families) {
    const key = family.partnerIds.length ? [...family.partnerIds].sort().join('+') : `solo:${family.id}`
    const existing = byPartners.get(key)
    if (!existing) { byPartners.set(key, family); result.push(family); continue }
    for (const id of family.childIds) if (!existing.childIds.includes(id)) existing.childIds.push(id)
    existing.marriageDate ||= family.marriageDate
    existing.marriagePlace ||= family.marriagePlace
  }
  families = result.filter(isMeaningful)
  const people = { ...tree.people, [keepId]: merged }
  delete people[removeId]
  const next: TreeDocument = { ...tree, people, families: Object.fromEntries(families.map((family) => [family.id, family])), verified: withoutMark(tree.verified, removeId) }
  // Merging two people from different generations could close an ancestry loop.
  const index = buildIndex(next)
  for (const id of Object.keys(next.people)) {
    for (const familyId of index.asChild.get(id) ?? []) for (const parent of next.families[familyId].partnerIds) {
      if (isSelfOrDescendant(next, id, parent, index)) throw new AppError('mergeOwnAncestor')
    }
  }
  return next
}
