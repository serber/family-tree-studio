import { AppError } from '../../shared/errors'
import { t } from '../../shared/i18n'
import { splitPatronymic } from '../model/names'
import { nextIdsFor, type Family, type Person, type TreeDocument } from '../model/tree'
import type { GedcomLine, GedcomWarning, ParsedGedcom } from './types'

export const child = (node: GedcomLine | undefined, tag: string): GedcomLine | undefined => node?.children.find((entry) => entry.tag === tag)
export const pointer = (value: string): string | undefined => /^@([^@\s]+)@$/.exec(value)?.[1]

export function payload(node: GedcomLine | undefined, version: ParsedGedcom['version']): string {
  if (!node) return ''
  const decode = (value: string) => version === '7.0' && value.startsWith('@@') ? value.slice(1) : value
  let result = decode(node.value)
  for (const line of node.children) {
    if (line.tag === 'CONT') result += '\n' + decode(line.value)
    if (line.tag === 'CONC') result += decode(line.value)
  }
  return version === '5.5.1' ? result.replaceAll('@@', '@') : result
}

export function parseGedcom(text: string): ParsedGedcom {
  if (text.includes('\u0000')) throw new AppError('nulChars')
  const bom = text.startsWith('\uFEFF') ? '\uFEFF' : ''
  const body = bom ? text.slice(1) : text
  const physical = body.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter((line) => line.length > 0) ?? []
  const lines: GedcomLine[] = []
  const records: GedcomLine[] = []
  const recordsById = new Map<string, GedcomLine>()
  const stack: GedcomLine[] = []
  for (const [index, physicalLine] of physical.entries()) {
    const ending = /(?:\r\n|\r|\n)$/.exec(physicalLine)?.[0] ?? ''
    const raw = ending ? physicalLine.slice(0, -ending.length) : physicalLine
    const match = /^(\d+) (?:@([^@\s]+)@ )?([A-Za-z0-9_]+)(?: (.*))?$/.exec(raw)
    if (!match) throw new AppError('badLine', { line: index + 1 })
    const level = Number(match[1])
    if (level > 99 || (level > 0 && !stack[level - 1])) throw new AppError('badNesting', { line: index + 1 })
    const node: GedcomLine = { index, raw, ending, level, xref: match[2], tag: match[3], value: match[4] ?? '', children: [] }
    if (level === 0) records.push(node)
    else {
      node.parent = stack[level - 1]
      node.parent.children.push(node)
    }
    stack.length = level
    stack.push(node)
    lines.push(node)
    if (node.xref) {
      if (level !== 0) throw new AppError('xrefLevel', { line: index + 1 })
      if (recordsById.has(node.xref)) throw new AppError('duplicateXref', { xref: node.xref })
      recordsById.set(node.xref, node)
    }
  }
  if (records[0]?.tag !== 'HEAD' || records.at(-1)?.tag !== 'TRLR') throw new AppError('headTrlr')
  if (records.filter((record) => record.tag === 'HEAD').length !== 1 || records.filter((record) => record.tag === 'TRLR').length !== 1) throw new AppError('duplicateHead')
  const declaredVersion = child(child(records[0], 'GEDC'), 'VERS')?.value
  const version = declaredVersion === '5.5.1' ? '5.5.1' : /^7\.0(?:\.\d+)?$/.test(declaredVersion ?? '') ? '7.0' : undefined
  if (!version) throw declaredVersion ? new AppError('unsupportedVersion', { version: declaredVersion }) : new AppError('missingVersion')
  const charset = child(records[0], 'CHAR')?.value.toUpperCase()
  if (charset && charset !== 'UTF-8' && charset !== 'ASCII') throw new AppError('unsupportedCharset', { charset })
  if (version === '5.5.1' && !charset) throw new AppError('missingCharset')
  if (version === '7.0' && charset === 'ASCII') throw new AppError('gedcom7Ascii')
  const encoding = charset === 'ASCII' ? 'ASCII' : 'UTF-8'
  if (encoding === 'ASCII' && /[^\x00-\x7F]/.test(body)) throw new AppError('asciiNonAscii')
  return { lines, records, recordsById, version, encoding, bom, ending: lines.find((line) => line.ending)?.ending ?? '\n' }
}

export function nameParts(value: string): { before: string; surname: string; after: string; hasSlashes: boolean } {
  const match = /^(.*?)\/([^/]*)\/(.*)$/s.exec(value)
  return match ? { before: match[1], surname: match[2], after: match[3], hasSlashes: true } : { before: value, surname: '', after: '', hasSlashes: false }
}

/** Given-name portion and surname of a NAME structure, preferring GIVN/SURN when present. */
export function nameFields(name: GedcomLine | undefined, version: ParsedGedcom['version']): { given: string; surname: string } {
  const parts = nameParts(payload(name, version))
  return {
    given: child(name, 'GIVN') ? payload(child(name, 'GIVN'), version) : parts.before.trim(),
    surname: child(name, 'SURN') ? payload(child(name, 'SURN'), version) : parts.surname.trim(),
  }
}

/** The additional NAME recording a birth/maiden surname (the first NAME is the primary one). */
export function birthNameOf(record: GedcomLine): GedcomLine | undefined {
  return record.children.filter((entry) => entry.tag === 'NAME').slice(1).find((entry) => /^(?:birth|maiden)$/i.test(child(entry, 'TYPE')?.value ?? ''))
}

export function inlineNoteOf(record: GedcomLine): GedcomLine | undefined {
  return record.children.find((entry) => entry.tag === 'NOTE' && !pointer(entry.value))
}

export function personFromRecord(record: GedcomLine, parsed: ParsedGedcom): Person {
  const primary = nameFields(child(record, 'NAME'), parsed.version)
  const { givenName, patronymic } = splitPatronymic(primary.given)
  const sex = child(record, 'SEX')?.value
  const birthName = birthNameOf(record)
  const eventValue = (tag: string, sub: string) => payload(child(child(record, tag), sub), parsed.version)
  return {
    id: record.xref!,
    givenName,
    patronymic,
    surname: primary.surname,
    birthSurname: birthName ? nameFields(birthName, parsed.version).surname : '',
    sex: sex === 'M' || sex === 'F' ? sex : 'U',
    birthDate: eventValue('BIRT', 'DATE'),
    birthPlace: eventValue('BIRT', 'PLAC'),
    deathDate: eventValue('DEAT', 'DATE'),
    deathPlace: eventValue('DEAT', 'PLAC'),
    note: payload(inlineNoteOf(record), parsed.version),
  }
}

function assertAcyclic(people: Record<string, Person>, families: Record<string, Family>) {
  const children = new Map(Object.keys(people).map((id) => [id, new Set<string>()]))
  const indegree = new Map(Object.keys(people).map((id) => [id, 0]))
  for (const family of Object.values(families)) for (const parent of family.partnerIds) for (const id of family.childIds) {
    const edges = children.get(parent)!
    if (!edges.has(id)) { edges.add(id); indegree.set(id, indegree.get(id)! + 1) }
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([id]) => id)
  for (let cursor = 0; cursor < queue.length; cursor++) for (const id of children.get(queue[cursor])!) {
    indegree.set(id, indegree.get(id)! - 1)
    if (indegree.get(id) === 0) queue.push(id)
  }
  if (queue.length !== Object.keys(people).length) throw new AppError('ancestryCycle')
}

export function importGedcomText(text: string, fileName = 'family.ged'): TreeDocument {
  const parsed = parseGedcom(text)
  const people: Record<string, Person> = Object.create(null)
  const families: Record<string, Family> = Object.create(null)
  const warnings: GedcomWarning[] = []
  const warn = (code: string, values: Record<string, string | number>) => { if (warnings.length < 100) warnings.push({ code, values }) }
  for (const record of parsed.records) if (record.tag === 'INDI') {
    if (!record.xref) throw new AppError('personNoXref', { line: record.index + 1 })
    people[record.xref] = personFromRecord(record, parsed)
  }
  if (Object.keys(people).length > 5000) throw new AppError('tooManyPeople', { max: 5000 })
  for (const line of parsed.lines) {
    const target = pointer(line.value)
    if (target && target !== 'VOID' && !parsed.recordsById.has(target)) warn('missingRef', { line: line.index + 1, target })
  }
  for (const record of parsed.records) if (record.tag === 'FAM') {
    if (!record.xref) throw new AppError('familyNoXref', { line: record.index + 1 })
    const resolvePeople = (tags: string[]) => [...new Set(record.children.filter((entry) => tags.includes(entry.tag)).flatMap((entry) => {
      const id = pointer(entry.value)
      if (id && people[id]) return [id]
      warn('familyLinkHidden', { xref: record.xref!, tag: entry.tag, value: entry.value })
      return []
    }))]
    const partnerIds = resolvePeople(['HUSB', 'WIFE'])
    if (partnerIds.length > 2) throw new AppError('tooManyPartners', { xref: record.xref })
    const marriage = child(record, 'MARR')
    families[record.xref] = {
      id: record.xref, partnerIds, childIds: resolvePeople(['CHIL']),
      marriageDate: payload(child(marriage, 'DATE'), parsed.version), marriagePlace: payload(child(marriage, 'PLAC'), parsed.version),
    }
    if (people[`family:${record.xref}`]) throw new AppError('xrefConflict')
  }
  for (const record of parsed.records) if (record.tag === 'INDI') {
    for (const entry of record.children.filter((node) => node.tag === 'FAMC' || node.tag === 'FAMS')) {
      const family = families[pointer(entry.value) ?? '']
      if (family && !(entry.tag === 'FAMC' ? family.childIds : family.partnerIds).includes(record.xref!)) warn('unconfirmedLink', { xref: record.xref!, tag: entry.tag, value: entry.value })
    }
  }
  assertAcyclic(people, families)
  return {
    schemaVersion: 2,
    id: `gedcom-${crypto.randomUUID()}`,
    title: fileName.replace(/\.ged$/i, '') || t('editor.defaults.importedTitle'),
    people, families,
    gedcom: { text, fileName, version: parsed.version, encoding: parsed.encoding, warnings },
    nextIds: nextIdsFor(parsed.recordsById.keys()),
  }
}

export function importGedcomBytes(bytes: ArrayBuffer, fileName: string): TreeDocument {
  const raw = new Uint8Array(bytes)
  if (raw.byteLength > 20 * 1024 * 1024) throw new AppError('fileTooLarge', { max: 20 })
  if ((raw[0] === 0xFF && raw[1] === 0xFE) || (raw[0] === 0xFE && raw[1] === 0xFF)) throw new AppError('utf16')
  const preview = new TextDecoder('latin1').decode(raw.subarray(0, 16_384))
  const declared = /(?:^|[\r\n])1 CHAR ([^\r\n]+)/.exec(preview)?.[1].toUpperCase()
  if (declared && !['UTF-8', 'ASCII'].includes(declared)) throw new AppError('unsupportedCharset', { charset: declared })
  let text: string
  try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new AppError('invalidUtf8') }
  return importGedcomText(text, fileName)
}
