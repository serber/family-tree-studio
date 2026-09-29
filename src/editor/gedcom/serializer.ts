import { AppError } from '../../shared/errors'
import { givenWithPatronymic, personTextFields, type Family, type Person, type TreeDocument } from '../model/tree'
import { birthNameOf, child, importGedcomText, inlineNoteOf, nameParts, parseGedcom, payload, pointer } from './parser'
import type { GedcomLine, ParsedGedcom } from './types'

type Version = ParsedGedcom['version']

const encode = (value: string, version: Version) => version === '5.5.1' ? value.replaceAll('@', '@@') : value.startsWith('@') ? '@' + value : value

/**
 * Splits unescaped GEDCOM 5.5.1 text into CONC chunks whose escaped UTF-8 size fits the budget.
 * The conservative budget also fits the 255-character line limit. Splitting before escaping keeps
 * each `@@` on one line; breaks avoid spaces because some readers trim them at line edges.
 */
function splitForConc(value: string, budget: number): string[] {
  const encoder = new TextEncoder()
  const size = (character: string) => character === '@' ? 2 : encoder.encode(character).length
  const result: string[] = []
  let current: string[] = []
  let bytes = 0
  for (const character of value) {
    if (current.length && bytes + size(character) > budget) {
      let cut = current.length
      while (cut > 0 && (current[cut - 1] === ' ' || (current[cut] ?? character) === ' ')) cut--
      if (cut === 0) cut = current.length
      result.push(current.slice(0, cut).join(''))
      current = current.slice(cut)
      bytes = current.reduce((total, entry) => total + size(entry), 0)
    }
    current.push(character)
    bytes += size(character)
  }
  result.push(current.join(''))
  return result
}

function renderPayload(level: number, tag: string, value: string, version: Version): string[] {
  const result: string[] = []
  value.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').forEach((paragraph, index) => {
    const lineTag = index === 0 ? tag : 'CONT'
    const lineLevel = index === 0 ? level : level + 1
    const prefix = `${lineLevel} ${lineTag}`
    const chunks = version === '5.5.1' ? splitForConc(paragraph, 235).map((chunk) => encode(chunk, version)) : [encode(paragraph, version)]
    result.push(prefix + (chunks[0] ? ` ${chunks[0]}` : ''))
    chunks.slice(1).forEach((chunk) => result.push(`${level + 1} CONC ${chunk}`))
  })
  return result
}

function nameValue(given: string, surname: string): string {
  return surname ? `${given} /${surname}/`.trim() : given
}

function validatePerson(person: Person, keys: readonly (typeof personTextFields)[number][] = personTextFields) {
  for (const key of keys) {
    const value = person[key]
    if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) throw new AppError('controlChars', { id: person.id })
    if (key !== 'note' && /[\r\n]/.test(value)) throw new AppError('multilineField', { id: person.id })
    if ((key === 'givenName' || key === 'patronymic' || key === 'surname' || key === 'birthSurname') && value.includes('/')) throw new AppError('slashInName', { id: person.id })
  }
}

function validateFamily(family: Family) {
  for (const value of [family.marriageDate, family.marriagePlace]) {
    if (/[\x00-\x1F\x7F]/.test(value)) throw new AppError('multilineMarriage', { id: family.id })
  }
}

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id))

/**
 * Exports the document by patching its original GEDCOM source.
 * Unchanged records keep their exact text. Edited supported fields are patched in place, relationship
 * changes add or remove only the affected link lines, deleted records are removed together with pointers
 * to them, and new people and families are appended before the trailer.
 */
export function exportGedcom(tree: TreeDocument): string {
  const source = tree.gedcom
  const baseline = importGedcomText(source.text, source.fileName)
  const parsed = parseGedcom(source.text)
  const version = parsed.version
  const lines = parsed.lines
  const replace = new Map<number, string[]>()
  const insert = new Map<number, string[]>()

  const lastIndex = (node: GedcomLine) => {
    let index = node.index + 1
    while (index < lines.length && lines[index].level > node.level) index++
    return index - 1
  }
  const insertAt = (index: number, newLines: string[]) => insert.set(index, [...(insert.get(index) ?? []), ...newLines])
  /** Inserts after the node's whole subtree: as its last children, or as following siblings (by level). */
  const insertAfter = (node: GedcomLine, newLines: string[]) => insertAt(lastIndex(node) + 1, newLines)
  const removeSubtree = (node: GedcomLine) => { for (let index = node.index; index <= lastIndex(node); index++) replace.set(index, []) }
  const render = (level: number, tag: string, value: string) => renderPayload(level, tag, value, version)

  function update(node: GedcomLine, value: string) {
    const continuations = node.children.filter((line) => line.tag === 'CONT' || line.tag === 'CONC')
    if (continuations.some((line) => line.children.length > 0)) throw new AppError('contNesting', { line: node.index + 1 })
    for (const line of continuations) replace.set(line.index, [])
    const hasOtherChildren = node.children.some((line) => line.tag !== 'CONT' && line.tag !== 'CONC')
    replace.set(node.index, value || hasOtherChildren ? render(node.level, node.tag, value) : [])
  }

  /** Applies changed DATE/PLAC values of an event, keeping every other substructure. */
  function updateEvent(record: GedcomLine, tag: string, changes: [sub: string, value: string][]) {
    if (!changes.length) return
    const event = child(record, tag)
    if (!event) {
      const values = changes.filter(([, value]) => value)
      if (values.length) insertAfter(record, [`1 ${tag}`, ...values.flatMap(([sub, value]) => render(2, sub, value))])
      return
    }
    const removed = new Set<GedcomLine>()
    let added = false
    for (const [sub, value] of changes) {
      const node = child(event, sub)
      if (node) {
        update(node, value)
        if (!value && node.children.every((line) => line.tag === 'CONT' || line.tag === 'CONC')) removed.add(node)
      } else if (value) {
        insertAfter(event, render(event.level + 1, sub, value))
        added = true
      }
    }
    const remaining = event.children.filter((line) => !removed.has(line))
    if (!added && !remaining.length && !event.value) replace.set(event.index, [`${event.level} ${tag} Y`])
    else if (added && event.value === 'Y') replace.set(event.index, [`${event.level} ${tag}`])
  }

  function rewriteName(record: GedcomLine, name: GedcomLine, before: { given: string; surname: string }, after: { given: string; surname: string }) {
    const rawName = payload(name, version)
    const slashCount = [...rawName].filter((character) => character === '/').length
    if (slashCount !== 0 && slashCount !== 2) throw new AppError('nameDelimiters', { xref: record.xref! })
    const parts = nameParts(rawName)
    function substitute(text: string, from: string, to: string): string {
      if (from === to) return text
      if (!from) return text.trim() ? `${text.trimEnd()} ${to} ` : `${to} `
      // Match whole words only: GIVN "Jo" must not rewrite part of "John" in NAME.
      const word = new RegExp(`(?<![\\p{L}\\p{N}])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}])`, 'gu')
      const matches = [...text.matchAll(word)]
      if (matches.length !== 1) throw new AppError('nameMismatch', { xref: record.xref! })
      const index = matches[0].index
      const result = text.slice(0, index) + to + text.slice(index + from.length)
      return to ? result : result.replace(/ {2,}/g, ' ').replace(/^ /, '')
    }
    const given = substitute(parts.before, before.given, after.given)
    const surname = parts.hasSlashes ? substitute(parts.surname, before.surname, after.surname) : after.surname
    const nextName = parts.hasSlashes ? `${given}/${surname}/${parts.after}` : surname ? `${given.trimEnd()} /${surname}/` : given.trimEnd()
    update(name, nextName.trimEnd() || '//')
    for (const [tag, key] of [['GIVN', 'given'], ['SURN', 'surname']] as const) {
      const structured = child(name, tag)
      if (structured && before[key] !== after[key]) update(structured, after[key])
    }
  }

  function renderNames(person: Person): string[] {
    const given = givenWithPatronymic(person)
    const result: string[] = []
    if (given || person.surname) {
      result.push(...render(1, 'NAME', nameValue(given, person.surname)))
      if (given) result.push(...render(2, 'GIVN', given))
      if (person.surname) result.push(...render(2, 'SURN', person.surname))
    }
    if (person.birthSurname) result.push(...renderBirthName(person))
    return result
  }

  function renderBirthName(person: Person): string[] {
    return [...render(1, 'NAME', nameValue(givenWithPatronymic(person), person.birthSurname)), `2 TYPE ${version === '7.0' ? 'BIRTH' : 'birth'}`, ...render(2, 'SURN', person.birthSurname)]
  }

  function renderEvent(tag: string, date: string, place: string): string[] {
    if (!date && !place) return []
    return [`1 ${tag}`, ...(date ? render(2, 'DATE', date) : []), ...(place ? render(2, 'PLAC', place) : [])]
  }

  function roleFor(sex: Person['sex'], hasHusband: boolean, hasWife: boolean): 'HUSB' | 'WIFE' {
    if (sex === 'M') return hasHusband ? 'WIFE' : 'HUSB'
    if (sex === 'F') return hasWife ? 'HUSB' : 'WIFE'
    return hasHusband ? 'WIFE' : 'HUSB'
  }

  // --- Classify records -------------------------------------------------------------------------
  const deletedPeople = Object.keys(baseline.people).filter((id) => !Object.hasOwn(tree.people, id))
  const deletedFamilies = Object.keys(baseline.families).filter((id) => !Object.hasOwn(tree.families, id))
  const deleted = new Set([...deletedPeople, ...deletedFamilies])
  const newPeople = Object.values(tree.people).filter((person) => !Object.hasOwn(baseline.people, person.id))
  const newFamilies = Object.values(tree.families).filter((family) => !Object.hasOwn(baseline.families, family.id))
  for (const record of [...newPeople, ...newFamilies]) {
    if (parsed.recordsById.has(record.id)) throw new AppError('idTaken', { id: record.id })
  }
  newPeople.forEach((person) => validatePerson(person))
  newFamilies.forEach(validateFamily)

  // Relationship sets per person, before and after.
  const linksOf = (families: Record<string, Family>) => {
    const famc = new Map<string, string[]>()
    const fams = new Map<string, string[]>()
    for (const family of Object.values(families)) {
      for (const id of family.childIds) famc.set(id, [...(famc.get(id) ?? []), family.id])
      for (const id of family.partnerIds) fams.set(id, [...(fams.get(id) ?? []), family.id])
    }
    return { famc, fams }
  }
  const beforeLinks = linksOf(baseline.families)
  const afterLinks = linksOf(tree.families)

  // --- Deleted records and pointers to them --------------------------------------------------------
  for (const id of deleted) removeSubtree(parsed.recordsById.get(id)!)
  for (const line of lines) {
    const target = pointer(line.value)
    if (line.level > 0 && target && deleted.has(target) && !replace.has(line.index)) removeSubtree(line)
  }

  // --- Existing people --------------------------------------------------------------------------
  for (const original of Object.values(baseline.people)) {
    const current = tree.people[original.id]
    if (!current) continue
    const record = parsed.recordsById.get(original.id)!
    const changed = new Set(personTextFields.filter((key) => original[key] !== current[key]))
    validatePerson(current, [...changed])

    if (changed.has('givenName') || changed.has('patronymic') || changed.has('surname')) {
      const name = child(record, 'NAME')
      const before = { given: givenWithPatronymic(original), surname: original.surname }
      const after = { given: givenWithPatronymic(current), surname: current.surname }
      if (name) rewriteName(record, name, before, after)
      else insertAt(record.index + 1, [...render(1, 'NAME', nameValue(after.given, after.surname)), ...(after.given ? render(2, 'GIVN', after.given) : []), ...(after.surname ? render(2, 'SURN', after.surname) : [])])
    }
    if (changed.has('birthSurname')) {
      const birthName = birthNameOf(record)
      if (birthName && !current.birthSurname) removeSubtree(birthName)
      else if (birthName) rewriteName(record, birthName, { given: '', surname: original.birthSurname }, { given: '', surname: current.birthSurname })
      else {
        const primary = child(record, 'NAME')
        if (primary) insertAfter(primary, renderBirthName(current))
        else insertAt(record.index + 1, renderBirthName(current))
      }
    }
    if (current.sex !== original.sex) {
      const sex = child(record, 'SEX')
      if (sex) replace.set(sex.index, [`${sex.level} SEX ${current.sex}`])
      else if (current.sex !== 'U') {
        const names = record.children.filter((line) => line.tag === 'NAME')
        if (names.length) insertAfter(names.at(-1)!, ['1 SEX ' + current.sex])
        else insertAt(record.index + 1, ['1 SEX ' + current.sex])
      }
    }
    updateEvent(record, 'BIRT', ([['DATE', 'birthDate'], ['PLAC', 'birthPlace']] as const).filter(([, key]) => changed.has(key)).map(([sub, key]) => [sub, current[key]]))
    updateEvent(record, 'DEAT', ([['DATE', 'deathDate'], ['PLAC', 'deathPlace']] as const).filter(([, key]) => changed.has(key)).map(([sub, key]) => [sub, current[key]]))
    if (changed.has('note')) {
      const note = inlineNoteOf(record)
      if (note) update(note, current.note)
      else if (current.note) insertAfter(record, render(1, 'NOTE', current.note))
    }

    // Links: only relationships that changed are touched, so pre-existing inconsistencies are preserved.
    for (const tag of ['FAMC', 'FAMS'] as const) {
      const before = (tag === 'FAMC' ? beforeLinks.famc : beforeLinks.fams).get(original.id) ?? []
      const after = (tag === 'FAMC' ? afterLinks.famc : afterLinks.fams).get(original.id) ?? []
      if (sameSet(before, after)) continue
      const linkLines = record.children.filter((line) => line.tag === tag)
      for (const line of linkLines) {
        const target = pointer(line.value)
        if (target && before.includes(target) && !after.includes(target)) removeSubtree(line)
      }
      const missing = after.filter((id) => !before.includes(id) && !linkLines.some((line) => pointer(line.value) === id))
      if (!missing.length) continue
      const anchor = [...record.children].reverse().find((line) => line.tag === 'FAMC' || line.tag === 'FAMS')
      const newLines = missing.map((id) => `1 ${tag} @${id}@`)
      if (anchor) insertAfter(anchor, newLines)
      else insertAfter(record, newLines)
    }
  }

  // --- Existing families ------------------------------------------------------------------------
  for (const original of Object.values(baseline.families)) {
    const current = tree.families[original.id]
    if (!current) continue
    const record = parsed.recordsById.get(original.id)!
    if (original.marriageDate !== current.marriageDate || original.marriagePlace !== current.marriagePlace) validateFamily(current)
    updateEvent(record, 'MARR', ([['DATE', 'marriageDate'], ['PLAC', 'marriagePlace']] as const).filter(([, key]) => original[key] !== current[key]).map(([sub, key]) => [sub, current[key]]))

    if (!sameSet(original.partnerIds, current.partnerIds)) {
      const partnerLines = record.children.filter((line) => line.tag === 'HUSB' || line.tag === 'WIFE')
      const kept: GedcomLine[] = []
      for (const line of partnerLines) {
        const target = pointer(line.value)
        if (target && original.partnerIds.includes(target) && !current.partnerIds.includes(target)) removeSubtree(line)
        else if (!replace.has(line.index)) kept.push(line)
      }
      let hasHusband = kept.some((line) => line.tag === 'HUSB')
      let hasWife = kept.some((line) => line.tag === 'WIFE')
      const newLines: string[] = []
      for (const id of current.partnerIds.filter((entry) => !original.partnerIds.includes(entry))) {
        const role = roleFor(tree.people[id].sex, hasHusband, hasWife)
        if (role === 'HUSB') hasHusband = true
        else hasWife = true
        newLines.push(`1 ${role} @${id}@`)
      }
      if (newLines.length) {
        if (partnerLines.length) insertAfter(partnerLines.at(-1)!, newLines)
        else insertAt(record.index + 1, newLines)
      }
    }
    if (original.childIds.join() !== current.childIds.join()) {
      const childLines = record.children.filter((line) => line.tag === 'CHIL')
      for (const line of childLines) {
        const target = pointer(line.value)
        if (target && original.childIds.includes(target) && !current.childIds.includes(target)) removeSubtree(line)
      }
      const added = current.childIds.filter((id) => !original.childIds.includes(id)).map((id) => `1 CHIL @${id}@`)
      if (added.length) {
        const anchor = childLines.at(-1) ?? record.children.filter((line) => line.tag === 'HUSB' || line.tag === 'WIFE').at(-1)
        if (anchor) insertAfter(anchor, added)
        else insertAt(record.index + 1, added)
      }
    }
  }

  // --- New records ------------------------------------------------------------------------------
  const created: string[] = []
  for (const person of newPeople) {
    created.push(`0 @${person.id}@ INDI`, ...renderNames(person))
    if (person.sex !== 'U') created.push(`1 SEX ${person.sex}`)
    created.push(...renderEvent('BIRT', person.birthDate, person.birthPlace), ...renderEvent('DEAT', person.deathDate, person.deathPlace))
    for (const id of afterLinks.famc.get(person.id) ?? []) created.push(`1 FAMC @${id}@`)
    for (const id of afterLinks.fams.get(person.id) ?? []) created.push(`1 FAMS @${id}@`)
    if (person.note) created.push(...render(1, 'NOTE', person.note))
  }
  for (const family of newFamilies) {
    created.push(`0 @${family.id}@ FAM`)
    let hasHusband = false
    let hasWife = false
    const partners = [...family.partnerIds].sort((a, b) => Number(tree.people[b].sex === 'M') - Number(tree.people[a].sex === 'M'))
    for (const id of partners) {
      const role = roleFor(tree.people[id].sex, hasHusband, hasWife)
      if (role === 'HUSB') hasHusband = true
      else hasWife = true
      created.push(`1 ${role} @${id}@`)
    }
    for (const id of family.childIds) created.push(`1 CHIL @${id}@`)
    created.push(...renderEvent('MARR', family.marriageDate, family.marriagePlace))
  }
  if (created.length) insertAt(parsed.records.at(-1)!.index, created)

  if (!replace.size && !insert.size) return source.text
  let output = parsed.bom
  for (const line of lines) {
    const added = insert.get(line.index)
    if (added) output += added.join(parsed.ending) + parsed.ending
    const replacement = replace.get(line.index)
    output += replacement ? replacement.length ? replacement.join(parsed.ending) + line.ending : '' : line.raw + line.ending
  }
  if (parsed.encoding === 'ASCII' && /[^\x00-\x7F]/.test(output.slice(parsed.bom.length))) throw new AppError('asciiOverflow')
  return output
}
