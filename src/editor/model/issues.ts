import { isRecognizedDate, yearOf } from './dates'
import { buildIndex, normalizeSearch, type TreeDocument, type TreeIndex } from './tree'

// Consistency checks that help catch transcription mistakes. They never block editing.
// An issue holds IDs and numbers only; the UI words it in the current language (`editor.issues`).

export type IssueKind = 'noName' | 'noSex' | 'isolated' | 'badDate' | 'deathBeforeBirth' | 'parentTooYoung' | 'parentTooOld' | 'bornAfterParentDeath' | 'duplicate'
export interface Issue {
  kind: IssueKind
  personId: string
  /** The other person: the parent for parent checks, the possible twin for duplicates. */
  relatedId?: string
  /** Message values besides the names: years, ages, the date event and its text. */
  values?: Record<string, string | number>
}

export function findIssues(tree: TreeDocument, index: TreeIndex = buildIndex(tree)): Issue[] {
  const issues: Issue[] = []
  const people = Object.values(tree.people)
  const many = people.length > 1
  for (const person of people) {
    if (!person.givenName && !person.surname) issues.push({ kind: 'noName', personId: person.id })
    if (person.sex === 'U') issues.push({ kind: 'noSex', personId: person.id })
    if (many && !index.asChild.has(person.id) && !index.asPartner.has(person.id)) issues.push({ kind: 'isolated', personId: person.id })
    for (const [event, value] of [['birth', person.birthDate], ['death', person.deathDate]] as const) {
      if (!isRecognizedDate(value)) issues.push({ kind: 'badDate', personId: person.id, values: { event, value } })
    }
    const birth = yearOf(person.birthDate)
    const death = yearOf(person.deathDate)
    if (birth !== undefined && death !== undefined && death < birth) issues.push({ kind: 'deathBeforeBirth', personId: person.id, values: { birth, death } })
  }
  for (const family of Object.values(tree.families)) for (const childId of family.childIds) {
    const child = tree.people[childId]
    const childBirth = yearOf(child.birthDate)
    if (childBirth === undefined) continue
    for (const parentId of family.partnerIds) {
      const parent = tree.people[parentId]
      const parentBirth = yearOf(parent.birthDate)
      const parentDeath = yearOf(parent.deathDate)
      const age = parentBirth === undefined ? undefined : childBirth - parentBirth
      if (age !== undefined && age < 13) issues.push({ kind: 'parentTooYoung', personId: childId, relatedId: parentId, values: { age, year: childBirth } })
      if (age !== undefined && age > (parent.sex === 'F' ? 55 : 80)) issues.push({ kind: 'parentTooOld', personId: childId, relatedId: parentId, values: { age, year: childBirth } })
      if (parentDeath !== undefined && childBirth > parentDeath + (parent.sex === 'M' ? 1 : 0)) issues.push({ kind: 'bornAfterParentDeath', personId: childId, relatedId: parentId, values: { year: childBirth, death: parentDeath } })
    }
  }
  const byName = new Map<string, string[]>()
  for (const person of people) {
    if (!person.givenName || !person.surname) continue
    const key = normalizeSearch(`${person.surname} ${person.givenName} ${person.patronymic}`)
    byName.set(key, [...(byName.get(key) ?? []), person.id])
  }
  for (const ids of byName.values()) for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = tree.people[ids[i]]
    const b = tree.people[ids[j]]
    const yearA = yearOf(a.birthDate)
    const yearB = yearOf(b.birthDate)
    const sameParents = (index.asChild.get(a.id) ?? []).some((id) => (index.asChild.get(b.id) ?? []).includes(id))
    if ((yearA !== undefined && yearA === yearB) || sameParents || (yearA === undefined && yearB === undefined && !index.asChild.has(a.id) && !index.asChild.has(b.id))) {
      issues.push({ kind: 'duplicate', personId: a.id, relatedId: b.id })
    }
  }
  return issues
}
