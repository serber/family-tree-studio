import type { GedcomSource } from '../gedcom/types'
import { shortYear, yearOf } from './dates'
import { getLocale, t } from '../../shared/i18n'
import { genitiveName, splitPatronymic } from './names'

export type Sex = 'M' | 'F' | 'U'

export interface Person {
  id: string
  givenName: string
  patronymic: string
  surname: string
  /** Surname at birth (урождённая), stored as a second GEDCOM NAME with TYPE birth. */
  birthSurname: string
  sex: Sex
  /** GEDCOM date values; see model/dates.ts for Russian input/output. */
  birthDate: string
  birthPlace: string
  deathDate: string
  deathPlace: string
  note: string
}

export interface Family {
  id: string
  /** At most two partners. Order is not significant; GEDCOM roles are derived on export. */
  partnerIds: string[]
  childIds: string[]
  marriageDate: string
  marriagePlace: string
}

// The editable projection is deliberately separate from the original GEDCOM.
// Every document has a source: imported text, or a generated empty skeleton for new trees.
export interface TreeDocument {
  schemaVersion: 2
  id: string
  title: string
  people: Record<string, Person>
  families: Record<string, Family>
  gedcom: GedcomSource
  /**
   * Next numeric suffix for new person (I<n>) and family (F<n>) IDs. It only grows, so an ID removed
   * from the source is never reused for a different person, and it starts above every xref in the source.
   */
  nextIds: { person: number; family: number }
  /**
   * Review marks: person ID → ISO time when the user confirmed the card was checked against the source.
   * Kept in the draft and backups only; never written to GEDCOM and never affects layout.
   */
  verified?: Record<string, string>
}

export type PersonFields = Omit<Person, 'id'>
export type FamilyFields = Pick<Family, 'marriageDate' | 'marriagePlace'>
export type Positions = Record<string, { x: number; y: number }>

export const personTextFields = ['givenName', 'patronymic', 'surname', 'birthSurname', 'birthDate', 'birthPlace', 'deathDate', 'deathPlace', 'note'] as const

export function emptyPerson(id: string, fields: Partial<PersonFields> = {}): Person {
  return { id, givenName: '', patronymic: '', surname: '', birthSurname: '', sex: 'U', birthDate: '', birthPlace: '', deathDate: '', deathPlace: '', note: '', ...fields }
}

export function emptyFamily(id: string, fields: Partial<Omit<Family, 'id'>> = {}): Family {
  return { id, partnerIds: [], childIds: [], marriageDate: '', marriagePlace: '', ...fields }
}

/** "Имя Отчество" as written in GEDCOM given-name portion. */
export function givenWithPatronymic(person: Pick<Person, 'givenName' | 'patronymic'>): string {
  return [person.givenName, person.patronymic].filter(Boolean).join(' ')
}

/** "Фамилия Имя Отчество" — the canonical Russian listing order. */
export function fullName(person: Person): string {
  return [person.surname, person.givenName, person.patronymic].filter(Boolean).join(' ') || t('editor.person.unnamed')
}

/** "Имя Фамилия" for compact mentions. */
export function shortName(person: Person): string {
  return [person.givenName, person.surname].filter(Boolean).join(' ') || t('editor.person.unnamed')
}

export function lifespan(person: Person): string {
  const birth = shortYear(person.birthDate)
  const death = shortYear(person.deathDate)
  if (!birth && !death) return ''
  return death ? `${birth || '?'} – ${death}` : birth
}

export function initials(person: Person): string {
  return ((person.givenName[0] ?? '') + (person.surname[0] ?? '')).toLocaleUpperCase('ru') || '?'
}

// ---------------------------------------------------------------------------
// Relationship index

export interface TreeIndex {
  /** Families in which the person is a child. */
  asChild: Map<string, string[]>
  /** Families in which the person is a partner. */
  asPartner: Map<string, string[]>
}

export function buildIndex(tree: TreeDocument): TreeIndex {
  const asChild = new Map<string, string[]>()
  const asPartner = new Map<string, string[]>()
  const add = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key)
    if (list) list.push(value)
    else map.set(key, [value])
  }
  for (const family of Object.values(tree.families)) {
    for (const id of family.childIds) add(asChild, id, family.id)
    for (const id of family.partnerIds) add(asPartner, id, family.id)
  }
  return { asChild, asPartner }
}

export interface Relatives {
  parents: string[]
  partners: string[]
  children: string[]
  siblings: string[]
  parentFamilies: Family[]
  partnerFamilies: Family[]
}

/** A person's unions in marriage order: dated marriages by year; undated ones keep their recorded position. */
export function orderUnions(families: Family[]): Family[] {
  const dated = families.map((family, slot) => ({ family, slot, year: yearOf(family.marriageDate) })).filter((entry) => entry.year !== undefined)
  const byYear = [...dated].sort((a, b) => a.year! - b.year!)
  const result = [...families]
  dated.forEach((entry, index) => { result[entry.slot] = byYear[index].family })
  return result
}

/** Marriage order of every person with more than one union (family IDs), for the layout. */
export function marriageOrders(families: Record<string, Family>): Record<string, string[]> {
  const unions = new Map<string, Family[]>()
  for (const family of Object.values(families)) for (const id of family.partnerIds) unions.set(id, [...(unions.get(id) ?? []), family])
  const result: Record<string, string[]> = {}
  for (const [id, list] of unions) if (list.length > 1) result[id] = orderUnions(list).map((family) => family.id)
  return result
}

export function relativesOf(tree: TreeDocument, personId: string, index = buildIndex(tree)): Relatives {
  const parentFamilies = (index.asChild.get(personId) ?? []).map((id) => tree.families[id])
  const partnerFamilies = orderUnions((index.asPartner.get(personId) ?? []).map((id) => tree.families[id]))
  const unique = (ids: string[]) => [...new Set(ids)].filter((id) => id !== personId)
  return {
    parents: unique(parentFamilies.flatMap((family) => family.partnerIds)),
    siblings: unique(parentFamilies.flatMap((family) => family.childIds)),
    partners: unique(partnerFamilies.flatMap((family) => family.partnerIds)),
    children: unique(partnerFamilies.flatMap((family) => family.childIds)),
    parentFamilies,
    partnerFamilies,
  }
}

/** Ancestors (upward) and descendants (downward) of a person, excluding the person. */
export function lineageOf(tree: TreeDocument, personId: string, index = buildIndex(tree)) {
  const walk = (start: string, next: (id: string) => string[]) => {
    const seen = new Set<string>()
    const queue = [start]
    for (let cursor = 0; cursor < queue.length; cursor++) for (const id of next(queue[cursor])) {
      if (!seen.has(id) && id !== start) { seen.add(id); queue.push(id) }
    }
    return seen
  }
  const ancestors = walk(personId, (id) => (index.asChild.get(id) ?? []).flatMap((familyId) => tree.families[familyId].partnerIds))
  const descendants = walk(personId, (id) => (index.asPartner.get(id) ?? []).flatMap((familyId) => tree.families[familyId].childIds))
  return { ancestors, descendants }
}

/** One-line description to tell namesakes apart: "сын Петра и Анны", "son of Pyotr and Anna". */
export function parentageLabel(tree: TreeDocument, personId: string, index = buildIndex(tree)): string {
  const person = tree.people[personId]
  const parents = relativesOf(tree, personId, index).parents.map((id) => tree.people[id])
  if (!parents.length) return ''
  // Russian puts the parents' given names in the genitive; English uses them as they are.
  const genitive = getLocale() === 'ru'
  const names = parents.map((parent) => parent.givenName ? (genitive ? genitiveName(parent.givenName, parent.sex) : parent.givenName) : shortName(parent))
  return t('editor.person.parentage', { sex: person.sex, names: names.join(t('editor.person.parentsJoin')) })
}

// ---------------------------------------------------------------------------
// Search

export function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase('ru').replaceAll('ё', 'е').trim()
}

export function searchPeople(people: Record<string, Person>, query: string, limit = Infinity): Person[] {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: { person: Person; score: number }[] = []
  for (const person of Object.values(people)) {
    const words = normalizeSearch(`${person.surname} ${person.givenName} ${person.patronymic} ${person.birthSurname}`).split(/\s+/).filter(Boolean)
    const extra = normalizeSearch(`${person.id} ${yearOf(person.birthDate) ?? ''} ${yearOf(person.deathDate) ?? ''} ${person.birthPlace}`)
    let score = 0
    let matched = true
    for (const term of terms) {
      if (words.some((word) => word === term)) score += 3
      else if (words.some((word) => word.startsWith(term))) score += 2
      else if (words.some((word) => word.includes(term)) || extra.includes(term)) score += 1
      else { matched = false; break }
    }
    if (matched) scored.push({ person, score })
  }
  scored.sort((a, b) => b.score - a.score || fullName(a.person).localeCompare(fullName(b.person), 'ru'))
  return scored.slice(0, limit).map((entry) => entry.person)
}

// ---------------------------------------------------------------------------
// Validation and migration of stored documents

const isString = (value: unknown): value is string => typeof value === 'string'
const isWarning = (value: unknown): boolean => isString(value) || (!!value && typeof value === 'object' && isString((value as { code?: unknown }).code))

export function isTreeDocument(value: unknown): value is TreeDocument {
  if (!value || typeof value !== 'object') return false
  const tree = value as TreeDocument
  if (tree.schemaVersion !== 2 || !isString(tree.id) || !isString(tree.title) ||
    !tree.people || typeof tree.people !== 'object' || !tree.families || typeof tree.families !== 'object' ||
    Array.isArray(tree.people) || Array.isArray(tree.families)) return false
  const source = tree.gedcom
  if (!source || !isString(source.text) || !isString(source.fileName) || !['5.5.1', '7.0'].includes(source.version) ||
    !['UTF-8', 'ASCII'].includes(source.encoding) || !Array.isArray(source.warnings) || !source.warnings.every(isWarning)) return false
  if (!tree.nextIds || !Number.isSafeInteger(tree.nextIds.person) || !Number.isSafeInteger(tree.nextIds.family)) return false
  if (tree.verified !== undefined && (!tree.verified || typeof tree.verified !== 'object' || Array.isArray(tree.verified) || !Object.values(tree.verified).every(isString))) return false
  return Object.entries(tree.people).every(([id, person]) => person && person.id === id &&
    personTextFields.every((key) => isString(person[key])) && ['M', 'F', 'U'].includes(person.sex)) &&
    Object.entries(tree.families).every(([id, family]) => family && family.id === id &&
      isString(family.marriageDate) && isString(family.marriagePlace) &&
      Array.isArray(family.partnerIds) && Array.isArray(family.childIds) && family.partnerIds.length <= 2 &&
      [...family.partnerIds, ...family.childIds].every((ref) => isString(ref) && Object.hasOwn(tree.people, ref)))
}

/** Upgrades a schema-1 document (prototype drafts) to schema 2. Returns undefined for unknown shapes. */
export function migrateDocument(value: unknown, skeleton: () => GedcomSource): TreeDocument | undefined {
  if (isTreeDocument(value)) return value
  const old = value as { schemaVersion?: number; id?: unknown; title?: unknown; people?: Record<string, Record<string, unknown>>; families?: Record<string, Record<string, unknown>>; gedcom?: GedcomSource }
  if (!old || old.schemaVersion !== 1 || !old.people || !old.families || typeof old.people !== 'object' || typeof old.families !== 'object' || Array.isArray(old.people) || Array.isArray(old.families)) return undefined
  const text = (entry: Record<string, unknown>, key: string) => isString(entry[key]) ? entry[key] as string : ''
  const people: Record<string, Person> = {}
  for (const [id, entry] of Object.entries(old.people)) {
    const { givenName, patronymic } = splitPatronymic(text(entry, 'givenName'))
    const sex = entry.sex === 'M' || entry.sex === 'F' ? entry.sex : 'U'
    people[id] = emptyPerson(id, { givenName, patronymic, surname: text(entry, 'surname'), sex, birthDate: text(entry, 'birthDate'), deathDate: text(entry, 'deathDate'), note: text(entry, 'note') })
  }
  const families: Record<string, Family> = {}
  for (const [id, entry] of Object.entries(old.families)) {
    families[id] = emptyFamily(id, { partnerIds: (entry.partnerIds as string[]).slice(0, 2), childIds: [...(entry.childIds as string[])] })
  }
  const gedcom = old.gedcom ?? skeleton()
  const next = nextIdsFor([...Object.keys(people), ...Object.keys(families), ...[...gedcom.text.matchAll(/^0 @([^@\s]+)@/gm)].map((match) => match[1])])
  const migrated = { schemaVersion: 2 as const, id: isString(old.id) ? old.id : `tree-${crypto.randomUUID()}`, title: isString(old.title) ? old.title : t('editor.defaults.importedTitle'), people, families, gedcom, nextIds: next }
  return isTreeDocument(migrated) ? migrated : undefined
}

/** Initial ID counters above the numeric suffix of every given identifier. */
export function nextIdsFor(ids: Iterable<string>): TreeDocument['nextIds'] {
  let max = 0
  for (const id of ids) {
    const match = /(\d+)$/.exec(id)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return { person: max + 1, family: max + 1 }
}
